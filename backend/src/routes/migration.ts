import type { FastifyInstance } from 'fastify';
import { requireAdmin } from '../middleware/auth';
import { spawn, execFileSync } from 'child_process';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { db } from '../db/index';
import Dockerode from 'dockerode';
import { Client as Ssh2Client } from 'ssh2';
import type { SFTPWrapper, FileEntry, ConnectConfig } from 'ssh2';

// Create a directory; if it fails with EACCES, retry via sudo and chown to current user.
function mkdirSafe(p: string): void {
  try {
    fs.mkdirSync(p, { recursive: true });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== 'EACCES') throw e;
    try {
      execFileSync('sudo', ['-n', 'mkdir', '-p', p], { stdio: 'ignore', timeout: 10_000 });
      const uid = process.getuid?.() ?? -1;
      const gid = process.getgid?.() ?? -1;
      if (uid >= 0) execFileSync('sudo', ['-n', 'chown', `${uid}:${gid}`, p], { stdio: 'ignore', timeout: 10_000 });
    } catch { throw e; } // rethrow original EACCES if sudo also failed
  }
}

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const KEY_PATH = path.join(DATA_DIR, 'migration_key');
const KEY_PUB_PATH = KEY_PATH + '.pub';

// ── DB Tables ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS migration_sessions (
    session_id TEXT PRIMARY KEY,
    host       TEXT NOT NULL,
    user       TEXT NOT NULL DEFAULT 'root',
    port       INTEGER NOT NULL DEFAULT 22,
    appdata_src TEXT NOT NULL DEFAULT '/mnt/user/appdata',
    appdata_dst TEXT NOT NULL DEFAULT '/var/lib/appdata',
    password   TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS migration_phases (
    session_id  TEXT NOT NULL,
    phase       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    error       TEXT,
    started_at  TEXT,
    finished_at TEXT,
    PRIMARY KEY (session_id, phase)
  );
  CREATE TABLE IF NOT EXISTS migration_containers (
    session_id  TEXT NOT NULL,
    cname       TEXT NOT NULL,
    image       TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    volumes_json TEXT NOT NULL DEFAULT '[]',
    total_bytes INTEGER NOT NULL DEFAULT 0,
    selected    INTEGER NOT NULL DEFAULT 1,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    local_id    TEXT,
    error       TEXT,
    PRIMARY KEY (session_id, cname)
  );
`);

// Add password column to existing sessions tables (idempotent)
try { db.exec(`ALTER TABLE migration_sessions ADD COLUMN password TEXT`); } catch { /* column exists */ }

// ── Queries ────────────────────────────────────────────────────────────────────

const mq = {
  create:    db.prepare(`INSERT INTO migration_sessions (session_id,host,user,port,appdata_src,appdata_dst,password) VALUES (?,?,?,?,?,?,?)`),
  get:       db.prepare(`SELECT * FROM migration_sessions WHERE session_id = ?`),
  list:      db.prepare(`SELECT * FROM migration_sessions ORDER BY created_at DESC LIMIT 20`),
  del:       db.prepare(`DELETE FROM migration_sessions WHERE session_id = ?`),

  upsertPhase: db.prepare(`
    INSERT INTO migration_phases (session_id, phase, status, result_json, error, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, phase) DO UPDATE SET
      status      = excluded.status,
      result_json = COALESCE(excluded.result_json, migration_phases.result_json),
      error       = excluded.error,
      started_at  = COALESCE(migration_phases.started_at, datetime('now')),
      finished_at = CASE WHEN excluded.status IN ('done','error','paused')
                    THEN datetime('now') ELSE migration_phases.finished_at END
  `),
  listPhases: db.prepare(`SELECT * FROM migration_phases WHERE session_id = ? ORDER BY rowid`),

  insertContainer: db.prepare(`
    INSERT INTO migration_containers (session_id,cname,image,config_json,volumes_json,total_bytes)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(session_id,cname) DO UPDATE SET
      image=excluded.image, config_json=excluded.config_json,
      volumes_json=excluded.volumes_json, total_bytes=excluded.total_bytes
  `),
  listContainers:  db.prepare(`SELECT * FROM migration_containers WHERE session_id = ? ORDER BY cname`),
  setSelected:     db.prepare(`UPDATE migration_containers SET selected=?, sync_status='pending' WHERE session_id=? AND cname=?`),
  setAllSelected:  db.prepare(`UPDATE migration_containers SET selected=?, sync_status='pending' WHERE session_id=?`),
  updateSync:      db.prepare(`UPDATE migration_containers SET sync_status=?,local_id=?,error=? WHERE session_id=? AND cname=?`),
  delContainers:   db.prepare(`DELETE FROM migration_containers WHERE session_id=?`),
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface MigSession { session_id: string; host: string; user: string; port: number; appdata_src: string; appdata_dst: string; password: string | null; created_at: string }
interface MigContainer { session_id: string; cname: string; image: string; config_json: string; volumes_json: string; total_bytes: number; selected: number; sync_status: string; local_id: string | null; error: string | null }
interface VolumeInfo { type: string; source: string; target: string; bytes: number }

// ── SSH Helpers ────────────────────────────────────────────────────────────────

function ensureKeypair(): string {
  if (!fs.existsSync(KEY_PUB_PATH)) {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-f', KEY_PATH, '-N', '', '-C', 'core-hub-migration'], { stdio: 'ignore' });
    try { fs.chmodSync(KEY_PATH, 0o600); } catch { /* */ }
  }
  return fs.readFileSync(KEY_PUB_PATH, 'utf8').trim();
}

// Key-based: core ssh CLI args (BatchMode=yes prevents interactive prompts)
function sshKeyArgs(s: { port: number }): string[] {
  return ['-i', KEY_PATH, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-p', String(s.port)];
}

// Password-based: run a remote command via the ssh2 library (no sshpass needed)
function execSSH2(s: MigSession, cmd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = new Ssh2Client();
    let settled = false;
    const finish = (err?: Error, result?: string) => {
      if (settled) return; settled = true;
      client.end();
      if (err) reject(err); else resolve(result ?? '');
    };
    const t = setTimeout(() => finish(new Error('SSH-Timeout')), timeoutMs);
    client
      .on('ready', () => {
        client.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(t); finish(err); return; }
          let out = '', errOut = '';
          stream.on('data', (d: Buffer) => { out += d.toString(); });
          stream.stderr.on('data', (d: Buffer) => { errOut += d.toString(); });
          stream.on('close', (code: number) => { clearTimeout(t); code === 0 ? finish(undefined, out) : finish(new Error(errOut.trim() || `SSH exit ${code}`)); });
        });
      })
      .on('error', (err) => { clearTimeout(t); finish(err); })
      .connect({ host: s.host, port: s.port, username: s.user, password: s.password! });
  });
}

// Key-based: run a remote command via system ssh binary
function execSSHKey(s: MigSession, cmd: string, timeoutMs = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ssh', [...sshKeyArgs(s), `${s.user}@${s.host}`, cmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const t = setTimeout(() => { proc.kill(); reject(new Error('SSH-Timeout')); }, timeoutMs);
    proc.on('close', (code) => { clearTimeout(t); code === 0 ? resolve(out) : reject(new Error(err.trim() || `SSH exit ${code}`)); });
    proc.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

function execSSH(s: MigSession, cmd: string, timeoutMs = 60_000): Promise<string> {
  return s.password ? execSSH2(s, cmd, timeoutMs) : execSSHKey(s, cmd, timeoutMs);
}

// For rsync with password: write a temp SSH_ASKPASS script (no sshpass needed).
// SSH uses askpass automatically when there is no controlling TTY.
function makeAskpassEnv(password: string): { env: NodeJS.ProcessEnv; cleanup: () => void } {
  const scriptPath = path.join(os.tmpdir(), `ssh-askpass-${crypto.randomBytes(6).toString('hex')}.sh`);
  const escaped = password.replace(/\\/g, '\\\\').replace(/'/g, "'\\''");
  fs.writeFileSync(scriptPath, `#!/bin/sh\nprintf '%s' '${escaped}'\n`, { mode: 0o700 });
  return {
    env: { ...process.env, SSH_ASKPASS: scriptPath, SSH_ASKPASS_REQUIRE: 'force', DISPLAY: '' },
    cleanup: () => { try { fs.unlinkSync(scriptPath); } catch { /* already gone */ } },
  };
}

// Check rsync availability once at startup
let RSYNC_AVAILABLE = false;
try { execFileSync('rsync', ['--version'], { stdio: 'ignore' }); RSYNC_AVAILABLE = true; } catch { /* not installed */ }

// Open an ssh2 Client connection (supports both key and password auth)
function ssh2Connect(s: MigSession): Promise<Ssh2Client> {
  return new Promise((resolve, reject) => {
    const client = new Ssh2Client();
    const cfg: ConnectConfig = { host: s.host, port: s.port, username: s.user, readyTimeout: 20_000 };
    if (s.password) { cfg.password = s.password; }
    else { try { cfg.privateKey = fs.readFileSync(KEY_PATH); } catch (e) { reject(e); return; } }
    client.on('ready', () => resolve(client)).on('error', reject).connect(cfg);
  });
}

// Recursively copy a remote directory tree to local via SFTP.
async function sftpCopyDir(
  sftp: SFTPWrapper, remoteSrc: string, localDst: string,
  cname: string, volSrc: string, send: (m: object) => void, abort: { v: boolean }
): Promise<boolean> {
  if (abort.v) return false;
  mkdirSafe(localDst);
  let entries: FileEntry[] = [];
  try {
    entries = await new Promise<FileEntry[]>((res, rej) => sftp.readdir(remoteSrc, (e, l) => e ? rej(e) : res(l)));
  } catch { return true; } // empty or unreadable dir
  for (const entry of entries) {
    if (abort.v) return false;
    const src = `${remoteSrc}/${entry.filename}`;
    const dst = path.join(localDst, entry.filename);
    if ((entry.attrs.mode ?? 0) & 0o040000) {
      if (!await sftpCopyDir(sftp, src, dst, cname, volSrc, send, abort)) return false;
    } else {
      const fileSize = entry.attrs.size ?? 0;
      let copied = 0;
      await new Promise<void>((res, rej) => {
        mkdirSafe(path.dirname(dst));
        const rs = sftp.createReadStream(src);
        const ws = fs.createWriteStream(dst);
        rs.on('data', (chunk: Buffer) => {
          copied += chunk.length;
          const pct = fileSize > 0 ? Math.min(99, Math.floor(copied * 100 / fileSize)) : 0;
          send({ type: 'progress', container: cname, volume: volSrc, pct, speed: '–', eta: entry.filename });
        });
        rs.pipe(ws);
        ws.on('finish', res);
        rs.on('error', rej);
        ws.on('error', rej);
      });
    }
  }
  return true;
}

// Sync a single volume: rsync if available, otherwise SFTP via ssh2
async function syncVolume(
  s: MigSession, vol: VolumeInfo, localDst: string,
  cname: string, send: (m: object) => void, abort: { v: boolean },
  onKill: (cb: () => void) => void
): Promise<boolean> {
  if (RSYNC_AVAILABLE) {
    return new Promise<boolean>((resolve) => {
      const askpass = s.password ? makeAskpassEnv(s.password) : null;
      const sshStr = `ssh ${sshKeyArgs(s).join(' ')}${s.password ? ' -o PasswordAuthentication=yes -o BatchMode=no' : ''}`;
      const proc = spawn('rsync', ['-az', '--partial', '--info=progress2', '--no-human-readable', '-e', sshStr, `${s.user}@${s.host}:${vol.source}/`, `${localDst}/`],
        { stdio: ['ignore', 'pipe', 'pipe'], env: askpass?.env ?? process.env });
      let errBuf = '';
      proc.stdout.on('data', (d: Buffer) => {
        for (const line of d.toString().split('\r').filter(Boolean)) {
          const m = line.match(/^\s*([\d,]+)\s+(\d+)%\s+([\d.]+\S+)\s+([\d:]+)/);
          if (m) send({ type: 'progress', container: cname, volume: vol.source, pct: parseInt(m[2]), speed: m[3], eta: m[4] });
        }
      });
      proc.stderr.on('data', (d: Buffer) => { errBuf += d.toString(); });
      proc.on('error', (e) => { askpass?.cleanup(); send({ type: 'volume-error', container: cname, volume: vol.source, error: e.message }); resolve(false); });
      proc.on('close', (code) => { askpass?.cleanup(); if (code === 0) { send({ type: 'volume-done', container: cname, volume: vol.source }); resolve(true); } else { send({ type: 'volume-error', container: cname, volume: vol.source, error: errBuf.trim().slice(0, 300) }); resolve(false); } });
      onKill(() => proc.kill());
    });
  }

  // SFTP fallback (no rsync installed)
  send({ type: 'progress', container: cname, volume: vol.source, pct: 0, speed: 'SFTP', eta: '…' });
  let client: Ssh2Client | null = null;
  try {
    client = await ssh2Connect(s);
    const sftp = await new Promise<SFTPWrapper>((res, rej) => client!.sftp((e, s) => e ? rej(e) : res(s)));
    const ok = await sftpCopyDir(sftp, vol.source, localDst, cname, vol.source, send, abort);
    if (ok) send({ type: 'volume-done', container: cname, volume: vol.source });
    else send({ type: 'volume-error', container: cname, volume: vol.source, error: 'Abgebrochen' });
    return ok;
  } catch (e) {
    send({ type: 'volume-error', container: cname, volume: vol.source, error: e instanceof Error ? e.message : 'SFTP-Fehler' });
    return false;
  } finally {
    client?.end();
  }
}

// Pull a Docker image; resolves when fully downloaded.
function pullImage(image: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    docker.pull(image, (err: Error | null, stream: any) => {
      if (err) return reject(err);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      docker.modem.followProgress(stream, (err: Error | null) => { if (err) reject(err); else resolve(); });
    });
  });
}

// ── Routes ─────────────────────────────────────────────────────────────────────

export async function migrationRoutes(fastify: FastifyInstance) {

  // Keypair: öffentlichen SSH-Schlüssel liefern / erzeugen
  fastify.get('/api/migration/keypair', { preHandler: requireAdmin }, async (_req, reply) => {
    try {
      reply.send({ pubkey: ensureKeypair() });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'Fehler' });
    }
  });

  // Session anlegen
  fastify.post<{ Body: { host: string; user?: string; port?: number; appdataSrc?: string; appdataDst?: string; password?: string } }>(
    '/api/migration/sessions', { preHandler: requireAdmin }, async (req, reply) => {
      const { host, user = 'root', port = 22, appdataSrc = '/mnt/user/appdata', appdataDst = '/var/lib/appdata', password } = req.body ?? {};
      if (!host) return reply.status(400).send({ error: 'Host erforderlich' });
      const sid = crypto.randomUUID();
      mq.create.run(sid, host, user, port, appdataSrc, appdataDst, password || null);
      reply.status(201).send({ sessionId: sid });
    }
  );

  // Alle Sessions auflisten (password stripped from response)
  fastify.get('/api/migration/sessions', { preHandler: requireAdmin }, async (_req, reply) => {
    const sessions = (mq.list.all() as MigSession[]).map(({ password, ...s }) => ({ ...s, hasPassword: !!password }));
    reply.send({ sessions });
  });

  // Session-Details (Phasen + Container; password stripped)
  fastify.get<{ Params: { sid: string } }>('/api/migration/sessions/:sid', { preHandler: requireAdmin }, async (req, reply) => {
    const session = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!session) return reply.status(404).send({ error: 'Session nicht gefunden' });
    const { password, ...sessionPublic } = session;
    reply.send({ session: { ...sessionPublic, hasPassword: !!password }, phases: mq.listPhases.all(req.params.sid), containers: mq.listContainers.all(req.params.sid) });
  });

  // Session löschen
  fastify.delete<{ Params: { sid: string } }>('/api/migration/sessions/:sid', { preHandler: requireAdmin }, async (req, reply) => {
    mq.delContainers.run(req.params.sid);
    mq.del.run(req.params.sid);
    reply.send({ ok: true });
  });

  // ── Phase 1: Verbindung testen ─────────────────────────────────────────────

  fastify.post<{ Params: { sid: string } }>('/api/migration/:sid/connect', { preHandler: requireAdmin }, async (req, reply) => {
    const s = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!s) return reply.status(404).send({ error: 'Session nicht gefunden' });
    mq.upsertPhase.run(req.params.sid, 'connect', 'running', null, null);
    try {
      ensureKeypair();
      const dockerOut = await execSSH(s, `docker version --format '{{.Server.Version}}'`);
      const hostOut   = await execSSH(s, `hostname; cat /etc/os-release 2>/dev/null | grep PRETTY_NAME | cut -d= -f2 | tr -d '"' || uname -r`);
      const [hostname, ...rest] = hostOut.trim().split('\n');
      const result = { connected: true, dockerVersion: dockerOut.trim(), hostname: hostname.trim(), os: rest.join(' ').trim() };
      mq.upsertPhase.run(req.params.sid, 'connect', 'done', JSON.stringify(result), null);
      reply.send({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Verbindungsfehler';
      mq.upsertPhase.run(req.params.sid, 'connect', 'error', null, msg);
      reply.status(500).send({ error: msg });
    }
  });

  // ── Phase 2: Container entdecken ───────────────────────────────────────────

  fastify.post<{ Params: { sid: string } }>('/api/migration/:sid/discover', { preHandler: requireAdmin }, async (req, reply) => {
    const s = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!s) return reply.status(404).send({ error: 'Session nicht gefunden' });
    mq.upsertPhase.run(req.params.sid, 'discover', 'running', null, null);
    try {
      const idsOut = await execSSH(s, `docker ps -a --format '{{.ID}}'`, 30_000);
      const ids = idsOut.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (ids.length === 0) {
        mq.upsertPhase.run(req.params.sid, 'discover', 'done', JSON.stringify({ count: 0 }), null);
        return reply.send({ ok: true, containers: [] });
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let inspects: any[] = [];
      const inspectOut = await execSSH(s, `docker inspect ${ids.map(i => `"${i}"`).join(' ')}`, 120_000);
      try { inspects = JSON.parse(inspectOut); } catch { throw new Error('docker inspect: ungültige Ausgabe'); }

      // Größen aller Bind-Mount-Quellen ermitteln
      const srcPaths = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const c of inspects) for (const m of (c.Mounts ?? []) as any[]) if (m.Type === 'bind' && m.Source) srcPaths.add(m.Source);

      const sizeMap: Record<string, number> = {};
      if (srcPaths.size > 0) {
        try {
          const duCmd = [...srcPaths].map(p => `du -sb "${p}" 2>/dev/null || echo "0\t${p}"`).join('; ');
          const duOut = await execSSH(s, duCmd, 120_000);
          for (const line of duOut.split('\n')) { const m = line.match(/^(\d+)\t(.+)$/); if (m) sizeMap[m[2].trim()] = parseInt(m[1], 10); }
        } catch { /* Größen sind optional */ }
      }

      // Vorhandene Container leeren und neu befüllen
      mq.delContainers.run(req.params.sid);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const containers: any[] = [];
      for (const c of inspects) {
        const name = (c.Name as string).replace(/^\//, '');
        const image: string = c.Config?.Image ?? '';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const volumes: VolumeInfo[] = (c.Mounts ?? [] as any[]).map((m: any) => ({
          type: m.Type, source: m.Source, target: m.Destination,
          bytes: sizeMap[m.Source as string] ?? 0,
        }));
        const totalBytes = volumes.reduce((s, v) => s + v.bytes, 0);

        // Port-Bindings parsen
        const ports: { host: number; container: number; proto: string }[] = [];
        for (const [key, bindings] of Object.entries<{ HostPort: string }[] | null>(c.HostConfig?.PortBindings ?? {})) {
          const [cport, proto] = key.split('/');
          for (const b of bindings ?? []) { if (b.HostPort) ports.push({ host: parseInt(b.HostPort), container: parseInt(cport), proto: proto || 'tcp' }); }
        }

        const config = {
          image,
          env: ((c.Config?.Env ?? []) as string[]).filter(e => !e.startsWith('PATH=') && !e.startsWith('HOME=')),
          ports,
          restart: (c.HostConfig?.RestartPolicy?.Name as string) ?? 'unless-stopped',
        };

        mq.insertContainer.run(req.params.sid, name, image, JSON.stringify(config), JSON.stringify(volumes), totalBytes);
        containers.push({ name, image, volumes, totalBytes });
      }

      mq.upsertPhase.run(req.params.sid, 'discover', 'done', JSON.stringify({ count: containers.length }), null);
      reply.send({ ok: true, containers });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler';
      mq.upsertPhase.run(req.params.sid, 'discover', 'error', null, msg);
      reply.status(500).send({ error: msg });
    }
  });

  // ── Phase 3: Vorabprüfung ──────────────────────────────────────────────────

  fastify.post<{ Params: { sid: string } }>('/api/migration/:sid/preflight', { preHandler: requireAdmin }, async (req, reply) => {
    const s = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!s) return reply.status(404).send({ error: 'Session nicht gefunden' });
    mq.upsertPhase.run(req.params.sid, 'preflight', 'running', null, null);
    try {
      const selected = (mq.listContainers.all(req.params.sid) as MigContainer[]).filter(c => c.selected);
      const totalBytes = selected.reduce((sum, c) => sum + c.total_bytes, 0);

      // Freier Speicherplatz lokal
      let freeBytes = 0;
      try {
        const dfOut = execFileSync('df', ['-B1', '--output=avail', s.appdata_dst], { encoding: 'utf8', timeout: 5000 });
        freeBytes = parseInt(dfOut.trim().split('\n').pop() ?? '0', 10);
      } catch {
        try {
          const dfOut = execFileSync('df', ['-B1', '--output=avail', '/'], { encoding: 'utf8', timeout: 5000 });
          freeBytes = parseInt(dfOut.trim().split('\n').pop() ?? '0', 10);
        } catch { /* ignore */ }
      }

      // Port-Konflikte prüfen
      const localPorts = new Set<number>();
      try {
        const ssOut = execFileSync('ss', ['-tlnp'], { encoding: 'utf8', timeout: 5000 });
        for (const line of ssOut.split('\n')) { const m = line.match(/:(\d+)\s/); if (m) localPorts.add(parseInt(m[1])); }
      } catch { /* ignore */ }

      const conflicts: { container: string; port: number }[] = [];
      for (const c of selected) {
        const cfg = JSON.parse(c.config_json) as { ports: { host: number }[] };
        for (const p of cfg.ports ?? []) { if (localPorts.has(p.host)) conflicts.push({ container: c.cname, port: p.host }); }
      }

      const result = {
        selectedCount: selected.length,
        totalBytes,
        freeBytes,
        spaceOk: freeBytes === 0 || freeBytes > totalBytes * 1.1,
        portConflicts: conflicts,
        conflictsOk: conflicts.length === 0,
      };
      mq.upsertPhase.run(req.params.sid, 'preflight', 'done', JSON.stringify(result), null);
      reply.send({ ok: true, ...result });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler';
      mq.upsertPhase.run(req.params.sid, 'preflight', 'error', null, msg);
      reply.status(500).send({ error: msg });
    }
  });

  // ── Container-Auswahl ────────────────────────────────────────────────────

  fastify.put<{ Params: { sid: string }; Body: { all?: boolean; containers?: Record<string, boolean> } }>(
    '/api/migration/:sid/selection', { preHandler: requireAdmin }, async (req, reply) => {
      const { sid } = req.params;
      const { all, containers } = req.body ?? {};
      if (typeof all === 'boolean') mq.setAllSelected.run(all ? 1 : 0, sid);
      if (containers) for (const [name, sel] of Object.entries(containers)) mq.setSelected.run(sel ? 1 : 0, sid, name);
      reply.send({ ok: true });
    }
  );

  // ── Phase 4: Konfigurationen anlegen ──────────────────────────────────────

  fastify.post<{ Params: { sid: string } }>('/api/migration/:sid/create', { preHandler: requireAdmin }, async (req, reply) => {
    const s = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!s) return reply.status(404).send({ error: 'Session nicht gefunden' });
    mq.upsertPhase.run(req.params.sid, 'create', 'running', null, null);
    const results: { name: string; status: string; error?: string }[] = [];
    try {
      const selected = (mq.listContainers.all(req.params.sid) as MigContainer[]).filter(c => c.selected);
      for (const mc of selected) {
        // Bereits erstellte Container überspringen
        if (mc.sync_status === 'config-done' || mc.sync_status === 'done') {
          results.push({ name: mc.cname, status: 'skipped' });
          continue;
        }
        try {
          const cfg = JSON.parse(mc.config_json) as { image: string; env: string[]; ports: { host: number; container: number; proto: string }[]; restart: string };
          // Prüfen ob Name schon lokal existiert
          const existing = await docker.listContainers({ all: true, filters: JSON.stringify({ name: [mc.cname] }) });
          if (existing.some(c => c.Names.includes(`/${mc.cname}`))) {
            mq.updateSync.run('config-done', existing[0].Id, null, req.params.sid, mc.cname);
            results.push({ name: mc.cname, status: 'exists' });
            continue;
          }
          // Pull image if not already present locally
          let pulled = false;
          try { await docker.getImage(cfg.image).inspect(); }
          catch { await pullImage(cfg.image); pulled = true; }

          const portBindings: Record<string, { HostPort: string }[]> = {};
          const exposedPorts: Record<string, Record<string, never>> = {};
          for (const p of cfg.ports ?? []) {
            const key = `${p.container}/${p.proto}`;
            portBindings[key] = [{ HostPort: String(p.host) }];
            exposedPorts[key] = {};
          }
          const container = await docker.createContainer({
            Image: cfg.image, name: mc.cname,
            Env: cfg.env, ExposedPorts: exposedPorts,
            HostConfig: { PortBindings: portBindings, RestartPolicy: { Name: cfg.restart || 'unless-stopped' } },
          });
          mq.updateSync.run('config-done', container.id, null, req.params.sid, mc.cname);
          results.push({ name: mc.cname, status: pulled ? 'pulled+created' : 'created' });
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Fehler';
          mq.updateSync.run('config-error', null, msg, req.params.sid, mc.cname);
          results.push({ name: mc.cname, status: 'error', error: msg });
        }
      }
      const hasErrors = results.some(r => r.status === 'error');
      mq.upsertPhase.run(req.params.sid, 'create', hasErrors ? 'error' : 'done', JSON.stringify({ results }), null);
      reply.send({ ok: true, results });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Fehler';
      mq.upsertPhase.run(req.params.sid, 'create', 'error', null, msg);
      reply.status(500).send({ error: msg });
    }
  });

  // ── Phase 5: Datei-Sync (SSE) ─────────────────────────────────────────────
  // EventSource kann keine Custom-Header senden → Cookie-Auth via jwtVerify()

  fastify.get<{ Params: { sid: string } }>('/api/migration/:sid/sync/stream', async (req, reply) => {
    try {
      await req.jwtVerify();
      if ((req.user as { role: string }).role !== 'admin') { reply.status(403).send(); return; }
    } catch { reply.status(401).send(); return; }

    const s = mq.get.get(req.params.sid) as MigSession | undefined;
    if (!s) { reply.status(404).send(); return; }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (data: object) => { try { reply.raw.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };

    let aborted = false;
    req.raw.on('close', () => { aborted = true; });

    const pending = (mq.listContainers.all(req.params.sid) as MigContainer[])
      .filter(c => c.selected && c.sync_status !== 'done');

    if (pending.length === 0) {
      send({ type: 'complete', errors: 0, message: 'Alle Container bereits synchronisiert.' });
      reply.raw.end();
      return;
    }

    mq.upsertPhase.run(req.params.sid, 'sync', 'running', null, null);

    // Ensure the base appdata destination exists and is writable (may need sudo for /opt/…)
    try {
      mkdirSafe(s.appdata_dst);
    } catch (e) {
      send({ type: 'complete', errors: 1, message: `Zielverzeichnis ${s.appdata_dst} kann nicht erstellt werden: ${e instanceof Error ? e.message : 'Fehler'}` });
      mq.upsertPhase.run(req.params.sid, 'sync', 'error', null, `Zielverzeichnis nicht schreibbar: ${s.appdata_dst}`);
      reply.raw.end();
      return;
    }

    let syncErrors = 0;

    for (const mc of pending) {
      if (aborted) break;
      send({ type: 'container-start', container: mc.cname, image: mc.image, totalBytes: mc.total_bytes });
      mq.updateSync.run('syncing', mc.local_id, null, req.params.sid, mc.cname);

      const vols = (JSON.parse(mc.volumes_json) as VolumeInfo[]).filter(v => v.type === 'bind');
      if (vols.length === 0) {
        send({ type: 'container-done', container: mc.cname, skipped: true });
        mq.updateSync.run('done', mc.local_id, null, req.params.sid, mc.cname);
        continue;
      }

      const abortRef = { v: false };
      req.raw.once('close', () => { abortRef.v = true; });

      let containerOk = true;
      for (const vol of vols) {
        if (aborted || abortRef.v) break;
        const relPath = vol.source.startsWith(s.appdata_src) ? vol.source.slice(s.appdata_src.length) : `/${mc.cname}`;
        const localDst = path.join(s.appdata_dst, relPath);
        send({ type: 'volume-start', container: mc.cname, source: vol.source, dest: localDst, bytes: vol.bytes });
        const ok = await syncVolume(s, vol, localDst, mc.cname, send, abortRef, (cb) => req.raw.once('close', cb));
        if (!ok) { containerOk = false; break; }
      }

      if (containerOk && !aborted) {
        mq.updateSync.run('done', mc.local_id, null, req.params.sid, mc.cname);
        send({ type: 'container-done', container: mc.cname });
      } else if (!aborted) {
        mq.updateSync.run('error', mc.local_id, 'rsync fehlgeschlagen', req.params.sid, mc.cname);
        syncErrors++;
      }
    }

    if (aborted) {
      mq.upsertPhase.run(req.params.sid, 'sync', 'paused', null, 'Unterbrochen – kann fortgesetzt werden');
      send({ type: 'aborted', message: 'Sync pausiert. Beim nächsten Start wird da weitergemacht, wo abgebrochen wurde.' });
    } else {
      mq.upsertPhase.run(req.params.sid, 'sync', syncErrors > 0 ? 'error' : 'done', JSON.stringify({ syncErrors }), null);
      send({ type: 'complete', errors: syncErrors });
    }
    reply.raw.end();
  });

  // ── Phase 6: Aktivierung ──────────────────────────────────────────────────

  fastify.post<{ Params: { sid: string }; Body: { stopOnUnraid?: boolean } }>(
    '/api/migration/:sid/finalize', { preHandler: requireAdmin }, async (req, reply) => {
      const s = mq.get.get(req.params.sid) as MigSession | undefined;
      if (!s) return reply.status(404).send({ error: 'Session nicht gefunden' });
      mq.upsertPhase.run(req.params.sid, 'finalize', 'running', null, null);
      const results: { name: string; action: string; error?: string }[] = [];
      try {
        const ready = (mq.listContainers.all(req.params.sid) as MigContainer[])
          .filter(c => c.selected && c.sync_status === 'done' && c.local_id);

        if (req.body?.stopOnUnraid) {
          for (const mc of ready) {
            try { await execSSH(s, `docker stop "${mc.cname}" 2>/dev/null || true`); } catch { /* ignore */ }
          }
        }
        for (const mc of ready) {
          try {
            await docker.getContainer(mc.local_id!).start();
            results.push({ name: mc.cname, action: 'gestartet' });
          } catch (e) {
            results.push({ name: mc.cname, action: 'error', error: e instanceof Error ? e.message : 'Fehler' });
          }
        }
        const hasErrors = results.some(r => r.action === 'error');
        mq.upsertPhase.run(req.params.sid, 'finalize', hasErrors ? 'error' : 'done', JSON.stringify({ results }), null);
        reply.send({ ok: true, results });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Fehler';
        mq.upsertPhase.run(req.params.sid, 'finalize', 'error', null, msg);
        reply.status(500).send({ error: msg });
      }
    }
  );
}
