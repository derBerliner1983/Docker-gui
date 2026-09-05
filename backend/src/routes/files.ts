import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { requireAdmin } from '../middleware/auth';
import { privExec, privShell, privShellBuffer, isRoot, describeExecError, isPermissionError } from '../lib/privilege';
import { auditQueries } from '../db/index';

/**
 * Dateimanager.
 *
 * Der Dienst läuft als eigener Benutzer und kommt damit an viele Systempfade
 * nicht heran. Jede Operation versucht deshalb zuerst den direkten Weg über
 * Node und weicht nur bei „keine Berechtigung" auf den erhöhten Weg aus
 * (mkdir, rm, mv, chmod, chown, tee, cat stehen in der sudoers-Allowlist).
 * So bleibt der Normalfall schnell und ohne Rechteausweitung.
 *
 * Wie das Terminal ist auch dieser Bereich Administratoren vorbehalten: wer
 * hier arbeitet, kann das System genauso verändern wie auf der Kommandozeile.
 */

const MAX_TEXT_BYTES = 1024 * 1024;        // 1 MB für den eingebauten Editor
const MAX_DOWNLOAD_ESCALATED = 64 * 1024 * 1024;

/** Pfad prüfen und normalisieren. Absolut, ohne Nullbytes. */
function safePath(input: unknown): string {
  const p = typeof input === 'string' ? input.trim() : '';
  if (!p || p.includes('\0')) throw new Error('Ungültiger Pfad');
  if (!p.startsWith('/')) throw new Error('Pfad muss absolut sein (mit „/" beginnen)');
  const resolved = path.resolve(p);
  return resolved;
}

/** Dateiname ohne Pfadanteile – für „neuer Ordner" und Umbenennen. */
function safeName(input: unknown): string {
  const n = typeof input === 'string' ? input.trim() : '';
  if (!n || n === '.' || n === '..') throw new Error('Ungültiger Name');
  if (n.includes('/') || n.includes('\0')) throw new Error('Der Name darf keinen Pfad enthalten');
  if (n.length > 255) throw new Error('Der Name ist zu lang');
  return n;
}

// ── Benutzer-/Gruppennamen zu IDs (kleiner Zwischenspeicher) ────────────────
let idCache: { at: number; users: Map<number, string>; groups: Map<number, string> } | null = null;
function idMaps() {
  if (idCache && Date.now() - idCache.at < 60_000) return idCache;
  const users = new Map<number, string>();
  const groups = new Map<number, string>();
  const read = (file: string, into: Map<number, string>) => {
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const parts = line.split(':');
        if (parts.length < 3) continue;
        const id = parseInt(parts[2], 10);
        if (!Number.isNaN(id) && parts[0]) into.set(id, parts[0]);
      }
    } catch { /* ohne Namen ist die ID immer noch aussagekräftig */ }
  };
  read('/etc/passwd', users);
  read('/etc/group', groups);
  idCache = { at: Date.now(), users, groups };
  return idCache;
}

export interface FileEntry {
  name: string;
  type: 'dir' | 'file' | 'link' | 'other';
  size: number;
  mtime: string;
  /** Rechte oktal, z. B. „755". */
  mode: string;
  /** Rechte lesbar, z. B. „rwxr-xr-x". */
  modeText: string;
  owner: string;
  group: string;
  /** Ziel eines Symlinks (soweit lesbar). */
  target?: string;
}

function modeToText(mode: number): string {
  const rwx = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
  const o = mode & 0o777;
  return rwx[(o >> 6) & 7] + rwx[(o >> 3) & 7] + rwx[o & 7];
}

function entryType(st: fs.Stats, isLink: boolean): FileEntry['type'] {
  if (isLink) return 'link';
  if (st.isDirectory()) return 'dir';
  if (st.isFile()) return 'file';
  return 'other';
}

/** Verzeichnis direkt über Node lesen. */
async function listDirect(dir: string): Promise<FileEntry[]> {
  const names = await fsp.readdir(dir);
  const { users, groups } = idMaps();
  const out: FileEntry[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const lst = await fsp.lstat(full);
      const isLink = lst.isSymbolicLink();
      // Bei Symlinks interessiert für Größe/Typ das Ziel, aber der Typ bleibt „link"
      let st = lst;
      if (isLink) { try { st = await fsp.stat(full); } catch { /* toter Link */ } }
      out.push({
        name,
        type: entryType(st, isLink),
        size: st.isDirectory() ? 0 : st.size,
        mtime: lst.mtime.toISOString(),
        mode: (lst.mode & 0o777).toString(8).padStart(3, '0'),
        modeText: modeToText(lst.mode),
        owner: users.get(lst.uid) ?? String(lst.uid),
        group: groups.get(lst.gid) ?? String(lst.gid),
        ...(isLink ? { target: await fsp.readlink(full).catch(() => '') } : {}),
      });
    } catch { /* Eintrag verschwunden oder nicht lesbar – überspringen */ }
  }
  return out;
}

/**
 * Verzeichnis mit erhöhten Rechten lesen.
 * `find -printf` liefert alle Felder in einem Rutsch; Zeilenumbrüche in
 * Dateinamen wären ein Problem, deshalb trennt \x1f die Felder und \x1e die
 * Datensätze.
 */
function listEscalated(dir: string): FileEntry[] {
  // Trennzeichen oktal: „find -printf" kennt \\xNN nicht und würde es mit einer
  // Warnung wörtlich ausgeben – \\037 (0x1f) und \\036 (0x1e) versteht es.
  const fmt = '%y\\037%s\\037%T@\\037%m\\037%u\\037%g\\037%l\\037%f\\036';
  const cmd = `find ${JSON.stringify(dir)} -maxdepth 1 -mindepth 1 -printf ${JSON.stringify(fmt)}`;
  const out = privShell(cmd, { timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  const entries: FileEntry[] = [];
  for (const rec of out.split('\x1e')) {
    if (!rec.trim()) continue;
    const [y, size, mtime, mode, owner, group, target, name] = rec.split('\x1f');
    if (!name) continue;
    const type: FileEntry['type'] = y === 'd' ? 'dir' : y === 'f' ? 'file' : y === 'l' ? 'link' : 'other';
    const modeNum = parseInt(mode || '0', 8);
    entries.push({
      name,
      type,
      size: type === 'dir' ? 0 : parseInt(size || '0', 10),
      mtime: new Date(parseFloat(mtime || '0') * 1000).toISOString(),
      mode: (mode || '0').padStart(3, '0'),
      modeText: modeToText(modeNum),
      owner: owner || '?',
      group: group || '?',
      ...(type === 'link' ? { target: target || '' } : {}),
    });
  }
  return entries;
}

/** Erst direkt, bei fehlender Berechtigung mit erhöhten Rechten. */
async function withEscalation<T>(direct: () => Promise<T> | T, escalated: () => T): Promise<T> {
  try {
    return await direct();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (isRoot || (code !== 'EACCES' && code !== 'EPERM')) throw err;
    return escalated();
  }
}

export async function filesRoutes(fastify: FastifyInstance) {
  // ── Verzeichnis auflisten ──
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/files/list',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let dir: string;
      try { dir = safePath(req.query.path || '/'); } catch (e) { return reply.status(400).send({ error: (e as Error).message }); }
      try {
        const entries = await withEscalation(() => listDirect(dir), () => listEscalated(dir));
        entries.sort((a, b) => (a.type === 'dir' ? 0 : 1) - (b.type === 'dir' ? 0 : 1) || a.name.localeCompare(b.name));
        reply.send({ path: dir, parent: dir === '/' ? null : path.dirname(dir), entries });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'ENOENT') return reply.status(404).send({ error: `„${dir}" gibt es nicht.` });
        if (code === 'ENOTDIR') return reply.status(400).send({ error: `„${dir}" ist kein Verzeichnis.` });
        reply.status(500).send({
          error: isPermissionError(err)
            ? `Keine Berechtigung für „${dir}" – auch nicht mit erhöhten Rechten.`
            : describeExecError(err, `„${dir}" konnte nicht gelesen werden`),
        });
      }
    },
  );

  // ── Ordner anlegen ──
  fastify.post<{ Body: { path?: string; name?: string } }>(
    '/api/files/mkdir',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const dir = safePath(req.body?.path);
        const name = safeName(req.body?.name);
        const full = path.join(dir, name);
        await withEscalation(
          () => fsp.mkdir(full),
          () => { privExec(`mkdir ${JSON.stringify(full)}`, { timeout: 10000 }); return undefined as unknown as undefined; },
        );
        auditQueries.log.run(req.user.id, 'files.mkdir', full);
        reply.send({ ok: true, path: full });
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if (code === 'EEXIST') return reply.status(400).send({ error: 'Es gibt dort bereits einen Eintrag mit diesem Namen.' });
        reply.status(400).send({ error: describeExecError(err, 'Ordner konnte nicht angelegt werden') });
      }
    },
  );

  // ── Umbenennen / verschieben ──
  fastify.post<{ Body: { path?: string; newName?: string; targetDir?: string } }>(
    '/api/files/rename',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const from = safePath(req.body?.path);
        if (from === '/') throw new Error('Das Wurzelverzeichnis lässt sich nicht umbenennen.');
        const dir = req.body?.targetDir ? safePath(req.body.targetDir) : path.dirname(from);
        const to = path.join(dir, safeName(req.body?.newName ?? path.basename(from)));
        if (to === from) return reply.send({ ok: true, path: to });
        await withEscalation(
          () => fsp.rename(from, to),
          () => { privExec(`mv -n ${JSON.stringify(from)} ${JSON.stringify(to)}`, { timeout: 30000 }); return undefined as unknown as undefined; },
        );
        auditQueries.log.run(req.user.id, 'files.rename', `${from} → ${to}`);
        reply.send({ ok: true, path: to });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Umbenennen fehlgeschlagen') });
      }
    },
  );

  // ── Löschen ──
  fastify.post<{ Body: { path?: string; recursive?: boolean } }>(
    '/api/files/delete',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.body?.path);
        // Ein paar Pfade, deren Löschen das System sofort unbrauchbar macht.
        const FORBIDDEN = ['/', '/etc', '/usr', '/var', '/bin', '/sbin', '/lib', '/boot', '/proc', '/sys', '/dev', '/home', '/root'];
        if (FORBIDDEN.includes(target)) {
          return reply.status(400).send({ error: `„${target}" ist ein Systemverzeichnis und wird hier nicht gelöscht.` });
        }
        const st = await withEscalation(
          () => fsp.lstat(target),
          () => ({ isDirectory: () => privShell(`test -d ${JSON.stringify(target)}`, { timeout: 8000 }) !== undefined }) as unknown as fs.Stats,
        );
        const isDir = st.isDirectory();
        if (isDir && !req.body?.recursive) {
          return reply.status(400).send({ error: 'Ordner werden nur mit Bestätigung samt Inhalt gelöscht.', needsRecursive: true });
        }
        await withEscalation(
          () => fsp.rm(target, { recursive: !!req.body?.recursive, force: false }),
          () => { privExec(`rm -${req.body?.recursive ? 'r' : ''}f ${JSON.stringify(target)}`, { timeout: 60000 }); return undefined as unknown as undefined; },
        );
        auditQueries.log.run(req.user.id, 'files.delete', target);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Löschen fehlgeschlagen') });
      }
    },
  );

  // ── Rechte und Eigentümer ──
  fastify.post<{ Body: { path?: string; mode?: string; recursive?: boolean } }>(
    '/api/files/chmod',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.body?.path);
        const mode = String(req.body?.mode ?? '').trim();
        if (!/^[0-7]{3,4}$/.test(mode)) throw new Error('Rechte bitte oktal angeben, z. B. 644 oder 0755.');
        const rec = req.body?.recursive ? '-R ' : '';
        await withEscalation(
          () => (req.body?.recursive ? Promise.reject(Object.assign(new Error('rekursiv'), { code: 'EPERM' })) : fsp.chmod(target, parseInt(mode, 8))),
          () => { privExec(`chmod ${rec}${mode} ${JSON.stringify(target)}`, { timeout: 60000 }); return undefined as unknown as undefined; },
        );
        auditQueries.log.run(req.user.id, 'files.chmod', `${target} → ${mode}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Rechte konnten nicht gesetzt werden') });
      }
    },
  );

  fastify.post<{ Body: { path?: string; owner?: string; group?: string; recursive?: boolean } }>(
    '/api/files/chown',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.body?.path);
        const owner = String(req.body?.owner ?? '').trim();
        const group = String(req.body?.group ?? '').trim();
        const NAME = /^[a-zA-Z0-9._-]{1,64}$/;
        if (owner && !NAME.test(owner)) throw new Error('Ungültiger Benutzername');
        if (group && !NAME.test(group)) throw new Error('Ungültiger Gruppenname');
        if (!owner && !group) throw new Error('Benutzer oder Gruppe angeben');
        const spec = group ? `${owner}:${group}` : owner;
        privExec(`chown ${req.body?.recursive ? '-R ' : ''}${spec} ${JSON.stringify(target)}`, { timeout: 60000 });
        auditQueries.log.run(req.user.id, 'files.chown', `${target} → ${spec}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Eigentümer konnte nicht gesetzt werden') });
      }
    },
  );

  // ── Textdatei lesen und schreiben (eingebauter Editor) ──
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/files/read',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.query.path);
        const st = await withEscalation(
          () => fsp.stat(target),
          () => ({ size: parseInt(privShell(`stat -c %s ${JSON.stringify(target)}`, { timeout: 8000 }).trim(), 10) }) as fs.Stats,
        );
        if (st.size > MAX_TEXT_BYTES) {
          return reply.status(413).send({ error: `Die Datei ist ${(st.size / 1024 / 1024).toFixed(1)} MB groß – der Editor öffnet bis 1 MB.` });
        }
        const content = await withEscalation(
          () => fsp.readFile(target, 'utf8'),
          () => privShell(`cat ${JSON.stringify(target)}`, { timeout: 15000, maxBuffer: MAX_TEXT_BYTES * 2 }),
        );
        reply.send({ path: target, content, size: st.size });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Datei konnte nicht gelesen werden') });
      }
    },
  );

  fastify.post<{ Body: { path?: string; content?: string } }>(
    '/api/files/write',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.body?.path);
        const content = typeof req.body?.content === 'string' ? req.body.content : '';
        if (Buffer.byteLength(content) > MAX_TEXT_BYTES) throw new Error('Der Inhalt ist größer als 1 MB.');
        await withEscalation(
          () => fsp.writeFile(target, content, 'utf8'),
          () => {
            // Umweg über eine temporäre Datei: „tee" bekommt den Inhalt über
            // die Standardeingabe, dafür bräuchte privExec einen Stream.
            const tmp = path.join('/tmp', `core-hub-write-${Date.now()}`);
            fs.writeFileSync(tmp, content, 'utf8');
            try { privExec(`cp ${JSON.stringify(tmp)} ${JSON.stringify(target)}`, { timeout: 30000 }); }
            finally { try { fs.unlinkSync(tmp); } catch { /* */ } }
            return undefined as unknown as undefined;
          },
        );
        auditQueries.log.run(req.user.id, 'files.write', target);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Datei konnte nicht gespeichert werden') });
      }
    },
  );

  // ── Herunterladen ──
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/files/download',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const target = safePath(req.query.path);
        const name = path.basename(target);
        reply.header('Content-Disposition', `attachment; filename="${name.replace(/["\\]/g, '_')}"`);
        reply.type('application/octet-stream');
        try {
          const st = await fsp.stat(target);
          if (st.isDirectory()) return reply.status(400).send({ error: 'Ordner lassen sich nicht direkt herunterladen.' });
          return reply.send(fs.createReadStream(target));
        } catch (err: unknown) {
          const code = (err as NodeJS.ErrnoException)?.code;
          if (isRoot || (code !== 'EACCES' && code !== 'EPERM')) throw err;
          // Nur mit erhöhten Rechten lesbar: über cat, mit Größenbegrenzung
          // Bewusst als Buffer: .toString() würde Binärdateien zerstören.
          const buf = privShellBuffer(`cat ${JSON.stringify(target)}`, { timeout: 60000, maxBuffer: MAX_DOWNLOAD_ESCALATED });
          return reply.send(buf);
        }
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Datei konnte nicht gelesen werden') });
      }
    },
  );

  // ── Ordner als Archiv herunterladen ──
  // Ein Ordner lässt sich nicht als einzelne Datei ausliefern; tar packt ihn
  // im Vorbeigehen. Bewusst als Datenstrom (spawn statt execSync): ein großer
  // Ordner würde sonst komplett im Arbeitsspeicher landen.
  fastify.get<{ Querystring: { path?: string } }>(
    '/api/files/download-archive',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let target: string;
      try { target = safePath(req.query.path); } catch (e) { return reply.status(400).send({ error: (e as Error).message }); }
      if (target === '/') return reply.status(400).send({ error: 'Das Wurzelverzeichnis lässt sich nicht als Archiv packen.' });

      const parent = path.dirname(target);
      const base = path.basename(target);
      // -C wechselt vorher ins Elternverzeichnis, damit im Archiv nur der
      // Ordner selbst steht und nicht der ganze Pfad ab /.
      const inner = `tar -czf - -C ${JSON.stringify(parent)} -- ${JSON.stringify(base)}`;
      const [cmd, args] = isRoot
        ? ['bash', ['-c', inner]]
        : ['sudo', ['-n', 'bash', '-c', inner]];

      const child = spawn(cmd as string, args as string[], { stdio: ['ignore', 'pipe', 'pipe'] });
      let errOut = '';
      child.stderr.on('data', (d: Buffer) => { errOut += d.toString().slice(0, 2000); });
      child.on('close', (code) => {
        if (code !== 0) req.log.warn({ path: target, code, err: errOut.trim() }, 'tar für Archiv-Download fehlgeschlagen');
      });

      auditQueries.log.run(req.user.id, 'files.download-archive', target);
      reply
        .header('Content-Disposition', `attachment; filename="${base.replace(/["\\]/g, '_')}.tar.gz"`)
        .type('application/gzip');
      return reply.send(child.stdout);
    },
  );

  // ── Suchen ──
  // Rekursiv ab dem aktuellen Ordner, Name enthält den Suchbegriff
  // (Groß-/Kleinschreibung egal). Läuft immer über find, weil das auch in
  // Unterordnern greift, die der Dienst selbst nicht lesen darf.
  fastify.get<{ Querystring: { path?: string; q?: string; limit?: string } }>(
    '/api/files/search',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let dir: string;
      try { dir = safePath(req.query.path || '/'); } catch (e) { return reply.status(400).send({ error: (e as Error).message }); }
      const q = (req.query.q ?? '').trim();
      if (q.length < 2) return reply.status(400).send({ error: 'Bitte mindestens zwei Zeichen suchen.' });
      if (q.length > 100) return reply.status(400).send({ error: 'Suchbegriff zu lang.' });
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '300', 10) || 300, 1), 1000);

      // Der Begriff geht als Muster an find. Shell-Sonderzeichen sind durch die
      // Anführungszeichen entschärft; die Glob-Zeichen von find selbst (* ? [)
      // maskieren wir, damit „a*b" wirklich nach „a*b" sucht.
      const pattern = `*${q.replace(/[*?[\\]/g, (c) => `\\${c}`)}*`;
      // %p ist der volle Pfad – bei einer Suche steht das Ergebnis ja irgendwo
      // unterhalb und nicht im aktuellen Ordner.
      const fmt = '%y\\037%s\\037%T@\\037%m\\037%u\\037%g\\037%l\\037%p\\036';
      // Pseudo-Dateisysteme auslassen: dort gibt es nichts zu finden, es kostet
      // aber Sekunden und produziert Fehlerzeilen.
      const prune = ['/proc', '/sys', '/dev', '/run'].map((d) => `-path ${JSON.stringify(d)}`).join(' -o ');
      const cmd = `find ${JSON.stringify(dir)} \\( ${prune} \\) -prune -o -iname ${JSON.stringify(pattern)} -printf ${JSON.stringify(fmt)} 2>/dev/null | head -c 4000000`;

      try {
        const out = privShell(cmd, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
        const entries: (FileEntry & { path: string })[] = [];
        for (const rec of out.split('\x1e')) {
          if (!rec.trim()) continue;
          const [y, size, mtime, mode, owner, group, target, full] = rec.split('\x1f');
          if (!full) continue;
          const type: FileEntry['type'] = y === 'd' ? 'dir' : y === 'f' ? 'file' : y === 'l' ? 'link' : 'other';
          entries.push({
            name: path.basename(full),
            path: full,
            type,
            size: type === 'dir' ? 0 : parseInt(size || '0', 10),
            mtime: new Date(parseFloat(mtime || '0') * 1000).toISOString(),
            mode: (mode || '0').padStart(3, '0'),
            modeText: modeToText(parseInt(mode || '0', 8)),
            owner: owner || '?',
            group: group || '?',
            ...(type === 'link' ? { target: target || '' } : {}),
          });
          if (entries.length >= limit) break;
        }
        reply.send({ path: dir, query: q, truncated: entries.length >= limit, entries });
      } catch (err: unknown) {
        // find endet mit 1, wenn gar nichts gefunden wurde – das ist kein Fehler.
        const out = describeExecError(err, '');
        if (/Status 1\b/.test(out) || out === '') {
          return reply.send({ path: dir, query: q, truncated: false, entries: [] });
        }
        reply.status(500).send({ error: describeExecError(err, 'Suche fehlgeschlagen') });
      }
    },
  );

  // ── Hochladen (mehrere Dateien möglich) ──
  fastify.post<{ Querystring: { path?: string } }>(
    '/api/files/upload',
    { preHandler: requireAdmin },
    async (req, reply) => {
      let dir: string;
      try { dir = safePath(req.query.path); } catch (e) { return reply.status(400).send({ error: (e as Error).message }); }
      const written: string[] = [];
      try {
        for await (const part of req.parts()) {
          if (part.type !== 'file') continue;
          const name = safeName(path.basename(part.filename || ''));
          const target = path.join(dir, name);
          const tmp = path.join('/tmp', `core-hub-upload-${Date.now()}-${name}`);
          await fsp.writeFile(tmp, await part.toBuffer());
          try {
            await withEscalation(
              () => fsp.copyFile(tmp, target),
              () => { privExec(`cp ${JSON.stringify(tmp)} ${JSON.stringify(target)}`, { timeout: 120000 }); return undefined as unknown as undefined; },
            );
            written.push(name);
          } finally { await fsp.unlink(tmp).catch(() => {}); }
        }
        if (written.length === 0) return reply.status(400).send({ error: 'Keine Datei empfangen.' });
        auditQueries.log.run(req.user.id, 'files.upload', `${dir}: ${written.join(', ')}`);
        reply.send({ ok: true, files: written });
      } catch (err: unknown) {
        reply.status(400).send({ error: describeExecError(err, 'Hochladen fehlgeschlagen') });
      }
    },
  );
}
