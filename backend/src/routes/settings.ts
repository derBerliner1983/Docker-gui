import type { FastifyInstance } from 'fastify';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary, isRoot, describeExecError } from '../lib/privilege';
import { auditQueries, appSettingsQueries, DB_PATH } from '../db/index';
import { removeCommand, packageNames } from '../lib/pkgmgr';
import {
  getUpdateSource, saveUpdateSource, listVersions, syncRemote, fetchRemote,
  gitRun, gitSafe, scrubSecrets, isValidRef, getUpdateNotes,
} from '../lib/updatesource';

function readVersion(): string {
  for (const p of [
    path.join(__dirname, '../../../VERSION'),
    path.join(process.cwd(), '../VERSION'),
    path.join(process.cwd(), 'VERSION'),
  ]) {
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v; } catch { /* try next */ }
  }
  return '0.5.0';
}

/**
 * Eindeutige Build-Kennung (kurzer Git-Hash). Wird beim Deploy von install.sh
 * in die Datei BUILD geschrieben; als Fallback (z. B. im Dev-Modus) fragen wir
 * Git direkt. So lässt sich jeder ausgelieferte Stand exakt zuordnen, auch wenn
 * die VERSION-Datei zwischen zwei Builds gleich bleibt.
 */
function readBuild(): string {
  for (const p of [
    path.join(__dirname, '../../../BUILD'),
    path.join(process.cwd(), '../BUILD'),
    path.join(process.cwd(), 'BUILD'),
  ]) {
    try { const v = fs.readFileSync(p, 'utf8').trim(); if (v) return v.replace(/[^a-zA-Z0-9.]/g, ''); } catch { /* try next */ }
  }
  try {
    const h = execSync('git -c safe.directory=* rev-parse --short=7 HEAD', {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000,
    }).toString().trim();
    if (/^[0-9a-f]{4,}$/.test(h)) return h;
  } catch { /* git nicht verfügbar */ }
  return '';
}

const BASE_VERSION = readVersion();
const BUILD_ID = readBuild();
/** Vollständige Version inkl. Build-Metadaten (SemVer „+build"). */
export const APP_VERSION = BUILD_ID ? `${BASE_VERSION}+${BUILD_ID}` : BASE_VERSION;
const GITHUB_REPO = process.env.GITHUB_REPO || 'derberliner1983/docker-gui';

/** Compare two semver-ish strings. Returns 1 if a>b, -1 if a<b, 0 if equal. */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}
const DATA_DIR = process.env.DATA_DIR || process.cwd();
const DB_FILE = DB_PATH;
const CADDYFILE = process.env.CADDYFILE || '/etc/caddy/Caddyfile';
const SMB_CONF = '/etc/samba/smb.conf';
const CADDY_PKI_DIRS = [
  '/var/lib/caddy/.local/share/caddy/pki',
  '/var/lib/caddy/.config/caddy/pki',
];

function findCaddyPki(): string | null {
  for (const d of CADDY_PKI_DIRS) if (fs.existsSync(d)) return d;
  const found = safeExec('dirname "$(find /var/lib/caddy -name root.crt 2>/dev/null | head -1)" 2>/dev/null').trim();
  // root.crt is inside pki/authorities/local — climb up to the pki dir
  if (found) {
    const idx = found.indexOf('/pki/');
    if (idx !== -1) return found.slice(0, idx + 4);
  }
  return null;
}

/** Findet das Quell-/Git-Verzeichnis (von install.sh in $DATA_DIR/source_dir gemerkt). */
function findRepoRoot(): string | null {
  let recorded = '';
  try { recorded = fs.readFileSync(path.join(DATA_DIR, 'source_dir'), 'utf8').trim(); } catch { /* keins gemerkt */ }
  const candidates = [recorded, '/opt/core-hub', path.resolve(__dirname, '../../..'), process.cwd()].filter(Boolean);
  return candidates.find((d) => fs.existsSync(path.join(d, 'install.sh'))) ?? null;
}

/** git im Repo ausführen – erst direkt, bei Rechtefehler via sudo (Klon kann root gehören). */
function gitCmd(repoRoot: string, args: string, timeout = 8000): string {
  // safe.directory mitgeben – das Quell-Verzeichnis gehört meist einem anderen
  // Benutzer als dem Dienst, sonst bricht Git mit „dubious ownership" ab.
  const cmd = `git -c safe.directory="${repoRoot}" -C "${repoRoot}" ${args}`;
  try { return execSync(cmd, { timeout, stdio: ['ignore', 'pipe', 'ignore'] }).toString(); }
  catch { return privExec(cmd, { timeout }); }
}

export async function settingsRoutes(fastify: FastifyInstance) {
  // Default beim ersten Start: IPv6 aus (nur IPv4), solange nicht ausdrücklich konfiguriert.
  try {
    if (appSettingsQueries.get.get('ipv6_enabled') == null) {
      appSettingsQueries.set.run('ipv6_enabled', '0');
      const conf = [
        '# Von Core-Hub verwaltet – IPv6 deaktiviert (nur IPv4).',
        'net.ipv6.conf.all.disable_ipv6 = 1',
        'net.ipv6.conf.default.disable_ipv6 = 1',
        'net.ipv6.conf.lo.disable_ipv6 = 1',
        '',
      ].join('\n');
      try { privExec(`bash -c ${JSON.stringify(`cat > /etc/sysctl.d/99-corehub-ipv6.conf <<'EOF'\n${conf}EOF`)}`, { timeout: 6000 }); } catch { /* */ }
      try { privExec('sysctl -w net.ipv6.conf.all.disable_ipv6=1', { timeout: 6000 }); } catch { /* */ }
      try { privExec('sysctl -w net.ipv6.conf.default.disable_ipv6=1', { timeout: 6000 }); } catch { /* */ }
    }
  } catch { /* nicht kritisch */ }

  fastify.get('/api/settings/info', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({
      version: APP_VERSION,
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      dataDir: DATA_DIR,
      node: process.version,
      uptime: process.uptime(),
      features: {
        docker: hasBinary('docker'),
        libvirt: hasBinary('virsh'),
        samba: hasBinary('smbd'),
        caddy: hasBinary('caddy'),
        clamav: hasBinary('clamscan'),
        ufw: hasBinary('ufw'),
      },
    });
  });

  // ── Version & Update-Prüfung ──
  // Primär per Git: vergleicht die lokale VERSION mit der im Remote-Repository
  // (funktioniert auch bei privaten Repos ohne GitHub-Releases). Fallback: GitHub-Releases-API.
  // ?refresh=1 holt den Remote-Stand frisch (git fetch); ohne Parameter wird der
  // bereits bekannte Stand verglichen (schnell, für das automatische Laden).
  fastify.get<{ Querystring: { refresh?: string } }>('/api/settings/version', { preHandler: requireAuth }, async (req, reply) => {
    const result: {
      current: string; latest: string | null; updateAvailable: boolean; behind: number;
      method: string; releaseUrl: string | null; repo: string; checkedAt: string; error?: string;
      branch?: string; ref?: string;
    } = {
      current: APP_VERSION, latest: null, updateAvailable: false, behind: 0, method: 'none',
      releaseUrl: `https://github.com/${GITHUB_REPO}`, repo: GITHUB_REPO, checkedAt: new Date().toISOString(),
    };
    const doFetch = req.query.refresh === '1';

    // 1) Git-basierter Vergleich
    const repoRoot = findRepoRoot();
    if (repoRoot && fs.existsSync(path.join(repoRoot, '.git'))) {
      result.method = 'git';
      try {
        // Konfigurierte Update-Quelle berücksichtigen (Repository-Umzug/Fork/Branch)
        const { upstream, branch } = syncRemote(repoRoot);
        const src = getUpdateSource();
        result.branch = branch;
        if (src.url) { result.repo = src.url; result.releaseUrl = src.url; }
        if (doFetch) { try { fetchRemote(repoRoot, 60000); } catch { /* evtl. offline */ } }
        result.ref = gitSafe(repoRoot, 'rev-parse HEAD', 6000).trim().slice(0, 40) || undefined;
        try { result.behind = parseInt(gitCmd(repoRoot, `rev-list --count HEAD..${upstream}`, 6000).trim()) || 0; } catch { /* */ }
        let remoteVer = '';
        try { remoteVer = gitCmd(repoRoot, `show ${upstream}:VERSION`, 6000).trim().replace(/[^0-9.]/g, ''); } catch { /* */ }
        if (remoteVer) {
          result.updateAvailable = compareVersions(remoteVer, BASE_VERSION) > 0 || result.behind > 0;
          result.latest = result.behind > 0 && compareVersions(remoteVer, BASE_VERSION) <= 0
            ? `${remoteVer} (+${result.behind} Commits)` : remoteVer;
        } else if (result.behind > 0) {
          result.updateAvailable = true;
          result.latest = `${BASE_VERSION} (+${result.behind} Commits)`;
        } else {
          result.latest = BASE_VERSION; // aktuell
        }
        return reply.send(result);
      } catch (e) {
        result.error = scrubSecrets(`Git-Prüfung fehlgeschlagen: ${e instanceof Error ? e.message : ''}`);
        // → GitHub-Fallback
      }
    }

    // 2) Fallback: GitHub-Releases-API (öffentliche Repos mit Releases)
    try {
      result.method = result.method === 'git' ? 'git+github' : 'github';
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'core-hub' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string; name?: string; html_url?: string };
        const tag = (data.tag_name || data.name || '').trim();
        if (tag) {
          result.latest = tag;
          result.updateAvailable = compareVersions(tag, BASE_VERSION) > 0;
          if (data.html_url) result.releaseUrl = data.html_url;
          result.error = undefined;
        }
      } else if (res.status === 404) {
        if (!result.latest && result.method === 'github') result.error = 'Keine GitHub-Releases gefunden (und kein Git-Checkout für die Versionsprüfung).';
      } else if (!result.latest) {
        result.error = result.error || `GitHub: HTTP ${res.status}`;
      }
    } catch (err) {
      if (!result.latest) result.error = result.error || (err instanceof Error ? err.message : 'Versionsprüfung fehlgeschlagen');
    }
    reply.send(result);
  });

  // ── Export full configuration as one .tar.gz (migration backup) ──
  fastify.get('/api/settings/export', { preHandler: requireAdmin }, async (req, reply) => {
    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'corehub-export-'));
    try {
      fs.mkdirSync(path.join(stage, 'data'), { recursive: true });
      // SQLite DB (use backup-safe copy via VACUUM INTO if possible, else cp)
      if (fs.existsSync(DB_FILE)) {
        const stagedDb = path.join(stage, 'data', 'core-hub.db');
        try {
          execSync(`sqlite3 ${DB_FILE} ".backup '${stagedDb}'"`, { timeout: 10000 });
        } catch {
          fs.copyFileSync(DB_FILE, stagedDb);
        }
      }
      // Caddy config + PKI (certs + internal CA)
      if (fs.existsSync(CADDYFILE)) {
        fs.mkdirSync(path.join(stage, 'caddy'), { recursive: true });
        const cf = safeExec(`cat ${CADDYFILE}`, 4000);
        fs.writeFileSync(path.join(stage, 'caddy', 'Caddyfile'), cf);
      }
      const pki = findCaddyPki();
      if (pki) {
        fs.mkdirSync(path.join(stage, 'caddy'), { recursive: true });
        // copy with sudo since /var/lib/caddy is root-owned
        privExec(`cp -r ${pki} ${path.join(stage, 'caddy', 'pki')}`);
        privExec(`chmod -R a+r ${path.join(stage, 'caddy', 'pki')}`);
      }
      // Samba managed config
      if (fs.existsSync(SMB_CONF)) {
        const smb = safeExec(`cat ${SMB_CONF}`, 4000);
        if (smb) {
          fs.mkdirSync(path.join(stage, 'samba'), { recursive: true });
          fs.writeFileSync(path.join(stage, 'samba', 'smb.conf'), smb);
        }
      }
      // Manifest
      fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify({
        app: 'core-hub', version: APP_VERSION, exportedAt: new Date().toISOString(), hostname: os.hostname(),
      }, null, 2));

      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outFile = path.join(os.tmpdir(), `core-hub-config-${ts}.tar.gz`);
      execSync(`tar czf ${outFile} -C ${stage} .`, { timeout: 60000 });

      auditQueries.log.run(req.user.id, 'settings.export', null);
      const stream = fs.createReadStream(outFile);
      reply.header('Content-Disposition', `attachment; filename="core-hub-config-${ts}.tar.gz"`);
      reply.type('application/gzip');
      stream.on('close', () => { try { fs.rmSync(outFile, { force: true }); fs.rmSync(stage, { recursive: true, force: true }); } catch { /* */ } });
      return reply.send(stream);
    } catch (err: unknown) {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* */ }
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Export fehlgeschlagen' });
    }
  });

  // ── Import a configuration archive (drag & drop restore) ──
  fastify.post('/api/settings/import', { preHandler: requireAdmin }, async (req, reply) => {
    const mp = await req.file().catch(() => null);
    if (!mp) return reply.status(400).send({ error: 'Keine Datei hochgeladen' });

    const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'corehub-import-'));
    const archive = path.join(stage, 'upload.tar.gz');
    try {
      await new Promise<void>((resolve, reject) => {
        const ws = fs.createWriteStream(archive);
        mp.file.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      });

      const extractDir = path.join(stage, 'x');
      fs.mkdirSync(extractDir);
      execSync(`tar xzf ${archive} -C ${extractDir}`, { timeout: 60000 });

      // Validate manifest
      const manifestPath = path.join(extractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) return reply.status(400).send({ error: 'Ungültiges Archiv (manifest fehlt)' });

      const restored: string[] = [];
      // Restore DB (accept new and legacy filename)
      const importedDb = [
        path.join(extractDir, 'data', 'core-hub.db'),
        path.join(extractDir, 'data', 'docker-gui.db'),
      ].find((p) => fs.existsSync(p));
      if (importedDb) {
        fs.copyFileSync(importedDb, DB_FILE + '.imported');
        restored.push('Datenbank');
      }
      // Restore Caddyfile + PKI
      const importedCaddyfile = path.join(extractDir, 'caddy', 'Caddyfile');
      if (fs.existsSync(importedCaddyfile)) {
        privExec(`mkdir -p /etc/caddy`);
        privExec(`cp ${importedCaddyfile} ${CADDYFILE}`);
        restored.push('Caddy-Konfiguration');
      }
      const importedPki = path.join(extractDir, 'caddy', 'pki');
      if (fs.existsSync(importedPki)) {
        const target = CADDY_PKI_DIRS[0];
        privExec(`mkdir -p ${path.dirname(target)}`);
        privExec(`cp -r ${importedPki} ${target}`);
        privExec(`chown -R caddy:caddy ${path.dirname(target)} 2>/dev/null || true`);
        restored.push('Zertifikate (CA)');
      }
      // Restore Samba
      const importedSmb = path.join(extractDir, 'samba', 'smb.conf');
      if (fs.existsSync(importedSmb) && hasBinary('smbd')) {
        privExec(`cp ${importedSmb} ${SMB_CONF}`);
        restored.push('SMB-Freigaben');
      }

      auditQueries.log.run(req.user.id, 'settings.import', restored.join(','));
      reply.send({
        ok: true,
        restored,
        note: 'Import erfolgreich. Bitte Core-Hub neustarten, damit die Datenbank geladen wird.',
      });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Import fehlgeschlagen' });
    } finally {
      try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  // ── Reverse-Proxy (Caddy) entfernen ──────────────────────────────────────
  // Wer keinen Reverse-Proxy braucht, soll ihn auch wieder loswerden können.
  // Wichtig: danach ist Core-Hub nur noch direkt über http://<IP>:PORT
  // erreichbar, nicht mehr über https auf 443.
  fastify.get('/api/settings/proxy/status', { preHandler: requireAdmin }, async (_req, reply) => {
    const installed = hasBinary('caddy');
    const active = safeExec('systemctl is-active caddy 2>/dev/null').trim() === 'active';
    const enabled = safeExec('systemctl is-enabled caddy 2>/dev/null').trim() === 'enabled';
    const managed = fs.existsSync(CADDYFILE)
      && /core-hub-base/.test(safeExec(`cat ${CADDYFILE} 2>/dev/null`, 4000));
    reply.send({
      installed, active, enabled, managed,
      caddyfile: CADDYFILE,
      directUrl: `http://${os.hostname()}:${process.env.PORT || 4200}`,
      packages: packageNames('caddy'),
    });
  });

  fastify.post<{ Body: { purge?: boolean } }>(
    '/api/settings/proxy/remove',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const purge = !!req.body?.purge;
      const steps: string[] = [];
      try {
        if (safeExec('systemctl is-active caddy 2>/dev/null').trim() === 'active') {
          privExec('systemctl stop caddy', { timeout: 20000 });
          steps.push('Dienst gestoppt');
        }
        if (safeExec('systemctl is-enabled caddy 2>/dev/null').trim() === 'enabled') {
          privExec('systemctl disable caddy', { timeout: 20000 });
          steps.push('Autostart deaktiviert');
        }
        // Nur die von Core-Hub erzeugte Konfiguration entfernen – eine eigene
        // Caddy-Konfiguration des Admins bleibt unangetastet.
        if (fs.existsSync(CADDYFILE) && /core-hub-base/.test(safeExec(`cat ${CADDYFILE} 2>/dev/null`, 4000))) {
          privExec(`mv ${CADDYFILE} ${CADDYFILE}.core-hub-entfernt`, { timeout: 8000 });
          steps.push(`Konfiguration gesichert nach ${CADDYFILE}.core-hub-entfernt`);
        }
        if (purge) {
          const cmd = removeCommand(['caddy']);
          if (cmd) { privExec(cmd, { timeout: 300000 }); steps.push('Paket deinstalliert'); }
        }
        // Proxy-Seite aus der Navigation nehmen – sie hat ohne Caddy keinen Zweck.
        appSettingsQueries.set.run('proxy_enabled', '0');
        steps.push('Proxy-Seite ausgeblendet');
        auditQueries.log.run(req.user.id, 'settings.proxy.remove', purge ? 'purge' : 'stop');
        reply.send({
          ok: true,
          steps,
          note: `Core-Hub ist jetzt direkt über Port ${process.env.PORT || 4200} erreichbar (http, ohne HTTPS-Weiterleitung auf 443).`,
        });
      } catch (err: unknown) {
        reply.status(500).send({ error: describeExecError(err, 'Reverse-Proxy konnte nicht entfernt werden'), steps });
      }
    },
  );

  // ── Update-Quelle (Git-Repository) verwalten ──────────────────────────────
  // Erlaubt es, das Repository nachträglich zu ändern (Umzug, eigener Fork) und
  // für private Repositories Zugangsdaten zu hinterlegen. Das Token/Passwort
  // wird verschlüsselt gespeichert und nie wieder ausgeliefert.
  fastify.get('/api/settings/update-source', { preHandler: requireAdmin }, async (_req, reply) => {
    const src = getUpdateSource();
    const repoRoot = findRepoRoot();
    // Aktuell im Checkout eingetragene origin-URL als Vorbelegung/Anhaltspunkt
    let detectedUrl = '';
    let detectedBranch = '';
    if (repoRoot && fs.existsSync(path.join(repoRoot, '.git'))) {
      detectedUrl = gitSafe(repoRoot, 'remote get-url origin', 6000).trim();
      detectedBranch = gitSafe(repoRoot, 'rev-parse --abbrev-ref HEAD', 6000).trim();
    }
    reply.send({ ...src, detectedUrl: scrubSecrets(detectedUrl), detectedBranch, repoRoot });
  });

  fastify.put<{ Body: { url?: string; branch?: string; visibility?: string; authType?: string; username?: string; secret?: string } }>(
    '/api/settings/update-source',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        const src = saveUpdateSource(req.body ?? {});
        // origin sofort mitziehen, damit die Versionsprüfung die neue Quelle nutzt
        const repoRoot = findRepoRoot();
        if (repoRoot && fs.existsSync(path.join(repoRoot, '.git'))) { try { syncRemote(repoRoot); } catch { /* */ } }
        auditQueries.log.run(req.user.id, 'settings.update-source', `${src.url || 'origin'}#${src.branch || 'default'} (${src.visibility})`);
        reply.send({ ok: true, source: src });
      } catch (err: unknown) {
        reply.status(400).send({ error: err instanceof Error ? scrubSecrets(err.message) : 'Ungültige Eingabe' });
      }
    },
  );

  // Verbindungstest gegen die konfigurierte Quelle (prüft auch die Zugangsdaten)
  fastify.post('/api/settings/update-source/test', { preHandler: requireAdmin }, async (_req, reply) => {
    const src = getUpdateSource();
    const repoRoot = findRepoRoot();
    const url = src.url || (repoRoot ? gitSafe(repoRoot, 'remote get-url origin', 6000).trim() : '');
    if (!url) return reply.status(400).send({ error: 'Keine Repository-URL konfiguriert.' });
    try {
      const out = gitRun(null, `ls-remote --heads ${JSON.stringify(url)}`, 25000);
      const branches = out.split('\n').filter(Boolean)
        .map((l) => l.split('\t')[1]?.replace('refs/heads/', '') ?? '')
        .filter(Boolean);
      reply.send({ ok: true, url, branches, count: branches.length });
    } catch (err: unknown) {
      const msg = err instanceof Error ? scrubSecrets(err.message) : 'Verbindung fehlgeschlagen';
      reply.status(400).send({
        error: /Authentication|403|401|could not read Username|Invalid username/i.test(msg)
          ? 'Zugriff verweigert – bitte Benutzername und Token/Passwort prüfen.'
          : msg,
      });
    }
  });

  // Auswählbare Stände (neueste Version, Tags, ältere Commits → Rollback)
  fastify.get<{ Querystring: { refresh?: string } }>(
    '/api/settings/update/versions',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const repoRoot = findRepoRoot();
      if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) {
        return reply.send({ available: false, versions: [], current: APP_VERSION, error: 'Kein Git-Checkout gefunden – Versionsauswahl nicht möglich.' });
      }
      try {
        if (req.query.refresh === '1') { try { fetchRemote(repoRoot, 60000); } catch { /* offline */ } }
        const versions = listVersions(repoRoot, 25);
        reply.send({ available: true, versions, current: APP_VERSION, branch: syncRemote(repoRoot).branch });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? scrubSecrets(err.message) : 'Versionsliste fehlgeschlagen' });
      }
    },
  );

  // Änderungsnotizen zu einem Stand: Titel, Text und alle Commits/Dateien
  // zwischen dem installierten Stand und dem Ziel („Was bringt das Update?").
  fastify.get<{ Querystring: { ref?: string } }>(
    '/api/settings/update/notes',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const ref = (req.query?.ref ?? '').trim();
      if (ref && !isValidRef(ref) && !/^[0-9a-f]{7,40}$/.test(ref)) {
        return reply.status(400).send({ error: 'Ungültige Versionsangabe' });
      }
      const repoRoot = findRepoRoot();
      if (!repoRoot || !fs.existsSync(path.join(repoRoot, '.git'))) {
        return reply.status(400).send({ error: 'Kein Git-Checkout gefunden – Änderungsnotizen nicht verfügbar.' });
      }
      try {
        reply.send(getUpdateNotes(repoRoot, ref));
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? scrubSecrets(err.message) : 'Änderungsnotizen fehlgeschlagen' });
      }
    },
  );

  // ── In-app update via git pull + install.sh --update (SSE stream) ──
  fastify.get<{ Querystring: { ref?: string } }>('/api/settings/update/stream', async (req, reply) => {
    try { await req.jwtVerify(); if ((req.user as { role: string }).role !== 'admin') { reply.status(403).send(); return; } }
    catch { reply.status(401).send(); return; }

    // Zielstand: leer = neuester Stand des konfigurierten Branches. Sonst ein
    // Tag/Commit aus /api/settings/update/versions (ermöglicht ein Rollback).
    const targetRef = (req.query?.ref ?? '').trim();
    if (targetRef && !isValidRef(targetRef) && !/^[0-9a-f]{7,40}$/.test(targetRef)) {
      reply.status(400).send({ error: 'Ungültige Versionsangabe' });
      return;
    }

    // Locate the git checkout to update from. install.sh records the original
    // clone directory in $DATA_DIR/source_dir; prefer that (it has a .git remote
    // and is NOT the install dir, so install.sh can copy from it safely).
    let recordedSource = '';
    try { recordedSource = fs.readFileSync(path.join(DATA_DIR, 'source_dir'), 'utf8').trim(); } catch { /* none */ }
    const candidates = [
      recordedSource,
      '/opt/core-hub',
      path.resolve(__dirname, '../../..'),
      path.resolve(__dirname, '../..'),
      process.cwd(),
    ].filter(Boolean);
    const repoRoot = candidates.find(d => fs.existsSync(path.join(d, 'install.sh'))) ?? '/opt/core-hub';
    const isGitRepo = fs.existsSync(path.join(repoRoot, '.git'));

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Ausgabe immer von möglichen Zugangsdaten befreien, bevor sie das Log erreicht.
    const send = (line: string) => {
      try { reply.raw.write(`data: ${JSON.stringify({ line: scrubSecrets(line) })}\n\n`); } catch { /* closed */ }
    };

    const runStream = (cmd: string, args: string[], cwd: string): Promise<boolean> =>
      new Promise((resolve) => {
        const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        const handle = (d: Buffer) => { for (const l of d.toString().split('\n')) { if (l.trim()) send(l); } };
        proc.stdout.on('data', handle);
        proc.stderr.on('data', handle);
        proc.on('error', (e) => { send(`[Fehler] ${e.message}`); resolve(false); });
        proc.on('close', (code) => resolve(code === 0));
      });

    const sudo = (args: string[]) => isRoot ? runStream(args[0], args.slice(1), repoRoot) : runStream('sudo', ['-n', ...args], repoRoot);

    try {
      send(`[Core-Hub] Quell-Verzeichnis: ${repoRoot}`);
      // Der Code-Wechsel passiert hier im Backend (nicht in install.sh), weil nur
      // hier die konfigurierte Quelle inkl. Zugangsdaten für private Repos bekannt
      // ist. install.sh wird deshalb mit --skip-git aufgerufen.
      let gitOk = true;
      if (!isGitRepo) {
        send('[!] Kein Git-Checkout gefunden – es wird kein Code aktualisiert, nur install.sh --update läuft.');
        send('    Tipp: Core-Hub aus einem "git clone" installieren, damit Updates automatisch geholt werden.');
      } else {
        try {
          const { upstream, branch } = syncRemote(repoRoot);
          const src = getUpdateSource();
          send(`› Quelle: ${src.url || gitSafe(repoRoot, 'remote get-url origin', 6000).trim() || 'origin'} (Branch ${branch}${src.visibility === 'private' ? ', privat' : ''})`);
          send('› git fetch …');
          fetchRemote(repoRoot, 120000);
          const target = targetRef || upstream;
          const sha = gitSafe(repoRoot, `rev-parse ${JSON.stringify(`${target}^{commit}`)}`, 10000).trim();
          if (!sha) throw new Error(`Zielstand „${target}" nicht gefunden.`);
          send(`› Wechsle auf ${target} (${sha.slice(0, 7)})${targetRef ? ' – gewählte Version' : ' – neueste Version'} …`);
          // Verwaiste, nicht getrackte Quelldateien entfernen (blockieren sonst den Wechsel)
          gitSafe(repoRoot, 'clean -fd', 30000);
          gitRun(repoRoot, `reset --hard ${sha}`, 60000);
          const newVer = gitSafe(repoRoot, 'show HEAD:VERSION', 6000).trim().replace(/[^0-9.]/g, '');
          if (newVer) send(`› Quellstand jetzt: v${newVer}`);
        } catch (e) {
          gitOk = false;
          send(`[!] Code-Wechsel fehlgeschlagen: ${scrubSecrets(e instanceof Error ? e.message : String(e))}`);
          send('    Es wird mit dem vorhandenen Quellstand fortgefahren.');
        }
      }
      // install.sh baut Backend + Frontend neu und startet den Dienst.
      send('› bash install.sh --update --skip-git …');
      const installOk = await sudo(['bash', 'install.sh', '--update', '--skip-git']);
      const ok = installOk && gitOk;

      if (ok) { send('[✓] Update abgeschlossen – Dienst wird neu gestartet…'); }
      else if (!installOk) { send('[!] Installer beendet mit Fehler. Bitte Log oben prüfen.'); }
      else { send('[!] Neubau erfolgreich, aber der Code-Wechsel schlug fehl – der alte Stand läuft weiter.'); }
      // Explizites Abschluss-Signal: das Frontend schließt daraufhin den Stream
      // (kein Auto-Reconnect) und pollt anschließend den Dienst bis er wieder online ist.
      try { reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok })}\n\n`); } catch { /* closed */ }
    } catch (e) {
      send(`[Fehler] ${scrubSecrets(e instanceof Error ? e.message : 'Unbekannter Fehler')}`);
      try { reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok: false })}\n\n`); } catch { /* closed */ }
    }
    reply.raw.end();
  });

  // Restart the Core-Hub service (applies an imported DB)
  fastify.post('/api/settings/restart', { preHandler: requireAdmin }, async (req, reply) => {
    auditQueries.log.run(req.user.id, 'settings.restart', null);
    // Promote an imported DB if present
    if (fs.existsSync(DB_FILE + '.imported')) {
      try {
        fs.copyFileSync(DB_FILE + '.imported', DB_FILE);
        fs.rmSync(DB_FILE + '.imported', { force: true });
      } catch { /* */ }
    }
    reply.send({ ok: true, note: 'Neustart wird ausgelöst…' });
    setTimeout(() => {
      try { privExec('systemctl restart core-hub', { timeout: 8000 }); } catch { process.exit(0); }
    }, 500);
  });

  // ── IPv6 an/aus (Standard: aus → nur IPv4) ──
  // Liest den aktuellen Kernel-Zustand und die gespeicherte Einstellung.
  fastify.get('/api/settings/ipv6', { preHandler: requireAuth }, async (_req, reply) => {
    const stored = appSettingsQueries.get.get('ipv6_enabled')?.value;
    // Kernel-Status: disable_ipv6=1 → IPv6 aus
    const kernel = safeExec('cat /proc/sys/net/ipv6/conf/all/disable_ipv6 2>/dev/null').trim();
    const kernelEnabled = kernel === '' ? undefined : kernel === '0';
    // Gespeicherte Einstellung hat Vorrang; Default = aus (nur IPv4)
    const enabled = stored != null ? stored === '1' : (kernelEnabled ?? false);
    reply.send({ enabled, kernelEnabled, configured: stored != null });
  });

  fastify.post<{ Body: { enable: boolean } }>('/api/settings/ipv6', { preHandler: requireAdmin }, async (req, reply) => {
    const enable = !!req.body?.enable;
    const SYSCTL_FILE = '/etc/sysctl.d/99-corehub-ipv6.conf';
    try {
      if (enable) {
        // IPv6 einschalten: sysctl sofort + persistente Datei entfernen
        try { privExec('sysctl -w net.ipv6.conf.all.disable_ipv6=0', { timeout: 6000 }); } catch { /* */ }
        try { privExec('sysctl -w net.ipv6.conf.default.disable_ipv6=0', { timeout: 6000 }); } catch { /* */ }
        try { privExec('sysctl -w net.ipv6.conf.lo.disable_ipv6=0', { timeout: 6000 }); } catch { /* */ }
        try { privExec(`rm -f ${SYSCTL_FILE}`, { timeout: 6000 }); } catch { /* */ }
      } else {
        // IPv6 ausschalten: persistente Datei schreiben + sofort anwenden
        const conf = [
          '# Von Core-Hub verwaltet – IPv6 deaktiviert (nur IPv4).',
          'net.ipv6.conf.all.disable_ipv6 = 1',
          'net.ipv6.conf.default.disable_ipv6 = 1',
          'net.ipv6.conf.lo.disable_ipv6 = 1',
          '',
        ].join('\n');
        try { privExec(`bash -c ${JSON.stringify(`cat > ${SYSCTL_FILE} <<'EOF'\n${conf}EOF`)}`, { timeout: 6000 }); } catch { /* */ }
        try { privExec('sysctl -w net.ipv6.conf.all.disable_ipv6=1', { timeout: 6000 }); } catch { /* */ }
        try { privExec('sysctl -w net.ipv6.conf.default.disable_ipv6=1', { timeout: 6000 }); } catch { /* */ }
        try { privExec('sysctl -w net.ipv6.conf.lo.disable_ipv6=1', { timeout: 6000 }); } catch { /* */ }
      }
      appSettingsQueries.set.run('ipv6_enabled', enable ? '1' : '0');
      auditQueries.log.run(req.user.id, 'settings.ipv6', enable ? 'enabled' : 'disabled');
      reply.send({ ok: true, enabled: enable });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'IPv6 konnte nicht umgestellt werden' });
    }
  });

  // ── Reverse-Proxy-Sichtbarkeit (Standard: aus → nicht in der Navigation) ──
  fastify.get('/api/settings/proxy-visibility', { preHandler: requireAuth }, async (_req, reply) => {
    const enabled = appSettingsQueries.get.get('proxy_enabled')?.value === '1';
    const backend = appSettingsQueries.get.get('proxy_backend')?.value || 'caddy';
    reply.send({ enabled, backend });
  });

  fastify.post<{ Body: { enabled?: boolean; backend?: string } }>(
    '/api/settings/proxy-visibility',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const enabled = !!req.body?.enabled;
      // Nur Caddy ist tatsächlich funktional; nginx/Traefik sind reserviert.
      const backend = ['caddy', 'nginx', 'traefik'].includes(req.body?.backend ?? '') ? req.body!.backend! : 'caddy';
      appSettingsQueries.set.run('proxy_enabled', enabled ? '1' : '0');
      appSettingsQueries.set.run('proxy_backend', backend);
      auditQueries.log.run(req.user.id, 'settings.proxy-visibility', `${enabled ? 'on' : 'off'}/${backend}`);
      reply.send({ ok: true, enabled, backend });
    },
  );
}
