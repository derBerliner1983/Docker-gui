import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary, describeExecError, isRoot } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface PackageUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  repo: string;
}

/** Detect the system package manager. */
function detectPM(): 'apt' | 'dnf' | 'pacman' | null {
  if (hasBinary('apt-get')) return 'apt';
  if (hasBinary('dnf')) return 'dnf';
  if (hasBinary('pacman')) return 'pacman';
  return null;
}

function parseAptUpgradable(out: string): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const line of out.split('\n')) {
    // Format: pkg/repo newver arch [upgradable from: oldver]
    const m = line.match(/^([^/]+)\/(\S+)\s+(\S+)\s+\S+\s+\[upgradable from:\s+([^\]]+)\]/);
    if (m) {
      updates.push({ name: m[1], repo: m[2], newVersion: m[3], currentVersion: m[4] });
    }
  }
  return updates;
}

/**
 * Baut den Upgrade-Befehl als Argumentliste (für spawn, ohne Shell).
 * `pkgs` leer = alle verfügbaren Updates.
 */
function buildUpgradeArgs(pm: 'apt' | 'dnf' | 'pacman', pkgs: string[]): string[] {
  if (pm === 'apt') {
    const dpkgOpts = ['-o', 'Dpkg::Options::=--force-confdef', '-o', 'Dpkg::Options::=--force-confold'];
    const inner = pkgs.length
      ? `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${dpkgOpts.join(' ')} ${pkgs.join(' ')}`
      : `DEBIAN_FRONTEND=noninteractive apt-get upgrade -y ${dpkgOpts.join(' ')}`;
    return ['/bin/bash', '-c', inner];
  }
  if (pm === 'dnf') {
    return pkgs.length ? ['dnf', '-y', 'upgrade', ...pkgs] : ['dnf', '-y', 'upgrade'];
  }
  // Arch/CachyOS: immer -Syu, Teilupgrades mit veraltetem Index sind dort nicht unterstützt.
  return pkgs.length ? ['pacman', '-Syu', '--noconfirm', ...pkgs] : ['pacman', '-Syu', '--noconfirm'];
}

export async function updateRoutes(fastify: FastifyInstance) {
  // List available system (OS) updates
  fastify.get('/api/system/updates', { preHandler: requireAuth }, async (_req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.send({ available: false, manager: null, updates: [], message: 'Kein unterstützter Paketmanager' });

    if (pm === 'apt') {
      const out = safeExec('apt list --upgradable 2>/dev/null', 10000);
      const updates = parseAptUpgradable(out);
      const reboot = safeExec('test -f /var/run/reboot-required && echo yes').trim() === 'yes';
      return reply.send({ available: true, manager: 'apt', updates, count: updates.length, rebootRequired: reboot });
    }
    if (pm === 'dnf') {
      const out = safeExec('dnf -q check-update 2>/dev/null', 15000);
      const updates: PackageUpdate[] = out.split('\n')
        .map((l) => l.trim().split(/\s+/))
        .filter((p) => p.length >= 3 && p[0].includes('.'))
        .map((p) => ({ name: p[0], currentVersion: '', newVersion: p[1], repo: p[2] }));
      return reply.send({ available: true, manager: 'dnf', updates, count: updates.length, rebootRequired: false });
    }
    // pacman
    const out = safeExec('pacman -Qu 2>/dev/null', 10000);
    const updates: PackageUpdate[] = out.split('\n').filter(Boolean).map((l) => {
      const p = l.split(/\s+/);
      return { name: p[0], currentVersion: p[1] ?? '', newVersion: p[3] ?? '', repo: '' };
    });
    return reply.send({ available: true, manager: 'pacman', updates, count: updates.length, rebootRequired: false });
  });

  // Refresh package index (apt update)
  fastify.post('/api/system/updates/check', { preHandler: requireAdmin }, async (req, reply) => {
    const pm = detectPM();
    if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
    try {
      if (pm === 'apt') privExec('apt-get update', { timeout: 120000 });
      else if (pm === 'dnf') privExec('dnf -q makecache', { timeout: 120000 });
      else privExec('pacman -Sy', { timeout: 120000 });
      auditQueries.log.run(req.user.id, 'system.update.check', pm);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Update-Check fehlgeschlagen' });
    }
  });

  // ── Updates installieren als Live-Stream (SSE) ───────────────────────────
  // Ein volles Systemupgrade dauert bei über hundert Paketen mehrere Minuten.
  // Als einzelner HTTP-Request lief das in einen Abbruch ("Failed to fetch"),
  // weil Browser bzw. Reverse-Proxy die Verbindung vorher kappen. Deshalb wird
  // die Ausgabe zeilenweise gestreamt – die Verbindung bleibt aktiv und man
  // sieht den Fortschritt.
  fastify.get<{ Querystring: { packages?: string } }>('/api/system/updates/apply/stream', async (req, reply) => {
    // EventSource kann keine Header setzen – das JWT kommt aus dem Cookie.
    try {
      await req.jwtVerify();
      if ((req.user as { role: string }).role !== 'admin') { reply.status(403).send(); return; }
    } catch { reply.status(401).send(); return; }

    const pm = detectPM();
    if (!pm) { reply.status(400).send({ error: 'Kein Paketmanager' }); return; }

    const pkgs = (req.query?.packages ?? '')
      .split(',')
      .map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, ''))
      .filter(Boolean);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const send = (line: string) => {
      try { reply.raw.write(`data: ${JSON.stringify({ line })}\n\n`); } catch { /* geschlossen */ }
    };

    const argv = buildUpgradeArgs(pm, pkgs);
    const [bin, ...args] = isRoot ? argv : ['sudo', '-n', ...argv];
    send(`› ${argv.join(' ')}`);

    const ok = await new Promise<boolean>((resolve) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      // Ohne Puffer würde jede Teilzeile einzeln ankommen; hier zeilenweise sammeln.
      let rest = '';
      const handle = (d: Buffer) => {
        rest += d.toString();
        const lines = rest.split('\n');
        rest = lines.pop() ?? '';
        for (const l of lines) if (l.trim()) send(l);
      };
      proc.stdout.on('data', handle);
      proc.stderr.on('data', handle);
      proc.on('error', (e) => { send(`[Fehler] ${e.message}`); resolve(false); });
      proc.on('close', (code) => { if (rest.trim()) send(rest); resolve(code === 0); });
      // Anti-Timeout: alle 20 s ein Kommentar-Frame, damit Proxys nicht kappen.
      const beat = setInterval(() => { try { reply.raw.write(': ping\n\n'); } catch { /* */ } }, 20000);
      proc.on('close', () => clearInterval(beat));
    });

    send(ok ? '[✓] Fertig.' : '[!] Mit Fehler beendet – bitte Ausgabe oben prüfen.');
    auditQueries.log.run((req.user as { id: number }).id, 'system.update.apply', pkgs.join(',') || 'all');
    try { reply.raw.write(`event: done\ndata: ${JSON.stringify({ ok })}\n\n`); } catch { /* */ }
    reply.raw.end();
  });

  // Apply updates (all, or specific packages)
  fastify.post<{ Body: { packages?: string[] } }>(
    '/api/system/updates/apply',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pm = detectPM();
      if (!pm) return reply.status(400).send({ error: 'Kein Paketmanager' });
      const pkgs = (req.body?.packages ?? [])
        .map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, ''))
        .filter(Boolean);
      try {
        let cmd: string;
        if (pm === 'apt') {
          // DEBIAN_FRONTEND muss innerhalb eines bash -c gesetzt werden – sonst
          // lehnt sudo die Env-Variable als nicht erlaubt ab (/bin/bash ist in der Allowlist).
          const dpkgOpts = '-o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold';
          const inner = pkgs.length
            ? `DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade ${dpkgOpts} ${pkgs.join(' ')}`
            : `DEBIAN_FRONTEND=noninteractive apt-get upgrade -y ${dpkgOpts}`;
          cmd = `/bin/bash -c "${inner}"`;
        } else if (pm === 'dnf') {
          cmd = pkgs.length ? `dnf -y upgrade ${pkgs.join(' ')}` : 'dnf -y upgrade';
        } else {
          // Arch/CachyOS: -Syu statt -Su. Ohne frischen Paketindex scheitert das
          // Upgrade an veralteten Paketständen ("target not found"). Teilupgrades
          // sind auf Arch ohnehin nicht unterstützt, deshalb wird auch bei einer
          // Paketauswahl der Index mitgezogen.
          cmd = pkgs.length
            ? `pacman -Syu --noconfirm ${pkgs.join(' ')}`
            : 'pacman -Syu --noconfirm';
        }
        // Ein volles Systemupgrade kann bei über hundert Paketen deutlich länger
        // als zehn Minuten dauern (Download + Hooks).
        const output = privExec(cmd, { timeout: 3600000 });
        auditQueries.log.run(req.user.id, 'system.update.apply', pkgs.join(',') || 'all');
        reply.send({ ok: true, output: output.slice(-4000) });
      } catch (err: unknown) {
        reply.status(500).send({ error: describeExecError(err) });
      }
    }
  );
}
