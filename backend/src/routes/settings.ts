import type { FastifyInstance } from 'fastify';
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary, isRoot } from '../lib/privilege';
import { auditQueries, DB_PATH } from '../db/index';

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
    const h = execSync('git rev-parse --short=7 HEAD', {
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

export async function settingsRoutes(fastify: FastifyInstance) {
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

  // ── Version & update check (queries the GitHub releases API) ──
  fastify.get('/api/settings/version', { preHandler: requireAuth }, async (_req, reply) => {
    const result: {
      current: string; latest: string | null; updateAvailable: boolean;
      releaseUrl: string | null; repo: string; checkedAt: string; error?: string;
    } = {
      current: APP_VERSION, latest: null, updateAvailable: false,
      releaseUrl: `https://github.com/${GITHUB_REPO}`, repo: GITHUB_REPO, checkedAt: new Date().toISOString(),
    };
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'core-hub' },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as { tag_name?: string; name?: string; html_url?: string };
        const tag = (data.tag_name || data.name || '').trim();
        if (tag) {
          result.latest = tag;
          result.updateAvailable = compareVersions(tag, APP_VERSION) > 0;
          if (data.html_url) result.releaseUrl = data.html_url;
        }
      } else if (res.status === 404) {
        result.error = 'Noch keine Releases veröffentlicht';
      } else {
        result.error = `GitHub: HTTP ${res.status}`;
      }
    } catch (err) {
      result.error = err instanceof Error ? err.message : 'Versionsprüfung fehlgeschlagen';
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

  // ── In-app update via git pull + install.sh --update (SSE stream) ──
  fastify.get('/api/settings/update/stream', async (req, reply) => {
    try { await req.jwtVerify(); if ((req.user as { role: string }).role !== 'admin') { reply.status(403).send(); return; } }
    catch { reply.status(401).send(); return; }

    // Locate the repo root (production: /opt/core-hub; dev: walk up from __dirname)
    const candidates = [
      '/opt/core-hub',
      path.resolve(__dirname, '../../..'),
      path.resolve(__dirname, '../..'),
      process.cwd(),
    ];
    const repoRoot = candidates.find(d => fs.existsSync(path.join(d, 'install.sh'))) ?? '/opt/core-hub';

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (line: string) => {
      try { reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`); } catch { /* closed */ }
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

    try {
      send(`[Core-Hub] Repository: ${repoRoot}`);
      send('[1/2] git pull …');
      // git pull: run as root (via sudo) if not already root
      const gitOk = isRoot
        ? await runStream('git', ['-C', repoRoot, 'pull'], repoRoot)
        : await runStream('sudo', ['-n', 'git', '-C', repoRoot, 'pull'], repoRoot);
      if (!gitOk) { send('[!] git pull fehlgeschlagen – fahre trotzdem fort'); }

      send('[2/2] install.sh --update …');
      const installOk = isRoot
        ? await runStream('bash', ['install.sh', '--update'], repoRoot)
        : await runStream('sudo', ['-n', 'bash', 'install.sh', '--update'], repoRoot);

      if (installOk) { send('[✓] Update abgeschlossen – Dienst wird neu gestartet…'); }
      else { send('[!] Installer beendet mit Fehler. Bitte Log prüfen.'); }
    } catch (e) {
      send(`[Fehler] ${e instanceof Error ? e.message : 'Unbekannter Fehler'}`);
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
}
