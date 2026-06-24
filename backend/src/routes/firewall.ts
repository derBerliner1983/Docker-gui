import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  direction: string; // IN | OUT | ''
  from: string;
}

/** Parse `ufw status numbered` output. */
function parseUfw(out: string): FirewallRule[] {
  const rules: FirewallRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(.+)$/i);
    if (m) {
      rules.push({
        num: parseInt(m[1]),
        to: m[2].trim(),
        action: m[3].toUpperCase(),
        direction: (m[4] ?? '').toUpperCase(),
        from: m[5].trim(),
        raw: line.trim(),
      });
    }
  }
  return rules;
}

/** Build a `ufw <action> …` command from sanitised parts. Returns null if neither port nor source given. */
function buildRuleCmd(
  action: string,
  parts: { p: string; pr: string; fromIp: string; dir: string },
): string | null {
  const { p, pr, fromIp, dir } = parts;
  const d = dir ? ` ${dir}` : '';
  if (!dir) {
    // Einfache Syntax (Standard = eingehend)
    if (fromIp) return `ufw ${action} from ${fromIp}${p ? ` to any port ${p}` : ''}${pr ? ` proto ${pr}` : ''}`;
    if (p) return `ufw ${action} ${p}${pr ? `/${pr}` : ''}`;
    return null;
  }
  // Mit Richtung → ausführliche Syntax
  if (fromIp) return `ufw ${action}${d} from ${fromIp}${p ? ` to any port ${p}` : ''}${pr ? ` proto ${pr}` : ''}`;
  if (p) return `ufw ${action}${d} to any port ${p}${pr ? ` proto ${pr}` : ''}`;
  return null;
}

function sanitiseParts(body: { port?: string; proto?: string; from?: string; direction?: string }) {
  return {
    p: (body.port ?? '').replace(/[^0-9:]/g, ''),
    pr: body.proto === 'udp' ? 'udp' : body.proto === 'tcp' ? 'tcp' : '',
    fromIp: (body.from ?? '').replace(/[^0-9a-fA-F:./]/g, ''),
    dir: body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : '',
  };
}

/** Logging-Status aus `ufw status verbose` lesen (on/off). */
function readLoggingState(): boolean {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  return /Logging:\s*on/i.test(v);
}

function privExecSafe(cmd: string): string {
  try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
}

interface ConnLogEntry {
  ts: string;
  action: string;     // BLOCK | ALLOW | AUDIT | LIMIT
  direction: string;  // IN | OUT
  iface: string;
  src: string;
  dst: string;
  proto: string;
  spt: string;
  dpt: string;
}

/** UFW-Kernel-Logzeilen parsen (aus /var/log/ufw.log oder journalctl). */
function parseUfwLog(out: string, limit: number): ConnLogEntry[] {
  const entries: ConnLogEntry[] = [];
  const lines = out.split('\n');
  for (let i = lines.length - 1; i >= 0 && entries.length < limit; i--) {
    const line = lines[i];
    const am = line.match(/\[UFW\s+(BLOCK|ALLOW|AUDIT|LIMIT)\]/i);
    if (!am) continue;
    const field = (k: string) => { const m = line.match(new RegExp(`\\b${k}=([^\\s]+)`)); return m ? m[1] : ''; };
    // Zeitstempel: Syslog-Prefix "Mon DD HH:MM:SS" oder ISO am Zeilenanfang
    const tsm = line.match(/^([A-Z][a-z]{2}\s+\d+\s+\d{2}:\d{2}:\d{2})/) || line.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+)/);
    const inIf = field('IN');
    const outIf = field('OUT');
    entries.push({
      ts: tsm ? tsm[1] : '',
      action: am[1].toUpperCase(),
      direction: inIf ? 'IN' : outIf ? 'OUT' : '',
      iface: inIf || outIf,
      src: field('SRC'),
      dst: field('DST'),
      proto: field('PROTO'),
      spt: field('SPT'),
      dpt: field('DPT'),
    });
  }
  return entries;
}

export async function firewallRoutes(fastify: FastifyInstance) {
  fastify.get('/api/firewall', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ufw')) {
      const ports = safeExec("ss -tulnH 2>/dev/null | awk '{print $1, $5}' | head -60");
      return reply.send({ available: false, active: false, rules: [], logging: false, message: 'ufw nicht installiert (apt install ufw)', listening: ports.trim() });
    }
    const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
    const active = /Status:\s*active/i.test(status);
    reply.send({ available: true, active, logging: readLoggingState(), rules: parseUfw(status) });
  });

  fastify.post<{ Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string } }>(
    '/api/firewall',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const { action } = req.body ?? {};
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const cmd = buildRuleCmd(action, sanitiseParts(req.body ?? {}));
      if (!cmd) return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      try {
        privExec(cmd, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.add', cmd.replace('ufw ', ''));
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Regel bearbeiten = an gleicher Position neu einfügen, alte entfernen
  fastify.put<{ Params: { num: string }; Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string } }>(
    '/api/firewall/:num',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const num = parseInt(req.params.num);
      if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
      const { action } = req.body ?? {};
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const cmd = buildRuleCmd(action, sanitiseParts(req.body ?? {}));
      if (!cmd) return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      const insertCmd = cmd.replace(/^ufw /, `ufw insert ${num} `);
      try {
        // Neue Regel an Position NUM einfügen (alte rutscht auf NUM+1) …
        privExec(insertCmd, { timeout: 8000 });
        // … dann die alte (jetzt NUM+1) löschen
        privExec(`bash -c "yes | ufw delete ${num + 1}"`, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.edit', `${num}: ${cmd.replace('ufw ', '')}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  fastify.delete<{ Params: { num: string } }>('/api/firewall/:num', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    const num = parseInt(req.params.num);
    if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
    try {
      privExec(`bash -c "yes | ufw delete ${num}"`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.delete', String(num));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  fastify.post<{ Body: { enable: boolean } }>('/api/firewall/toggle', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    try {
      privExec(`bash -c "yes | ufw ${req.body?.enable ? 'enable' : 'disable'}"`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.toggle', String(req.body?.enable));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Protokollierung (Verbindungsversuche) ein-/ausschalten
  fastify.post<{ Body: { enable: boolean } }>('/api/firewall/logging', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    try {
      privExec(`ufw logging ${req.body?.enable ? 'on' : 'off'}`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.logging', String(req.body?.enable));
      reply.send({ ok: true, logging: !!req.body?.enable });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Verbindungsversuche / -aufrufe (UFW-Log) anzeigen
  fastify.get<{ Querystring: { limit?: string } }>('/api/firewall/log', { preHandler: requireAuth }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.send({ available: false, logging: false, entries: [], message: 'ufw nicht installiert' });
    const limit = Math.min(1000, Math.max(10, parseInt(req.query.limit ?? '300') || 300));
    // Bevorzugt das dedizierte UFW-Log, sonst der Kernel-Journal
    let raw = privExecSafe('bash -c "tail -n 4000 /var/log/ufw.log 2>/dev/null"');
    let source = '/var/log/ufw.log';
    if (!raw.trim()) {
      raw = privExecSafe('bash -c "journalctl -k -n 4000 --no-pager 2>/dev/null | grep -i ufw"');
      source = 'journalctl -k';
    }
    const entries = parseUfwLog(raw, limit);
    reply.send({ available: true, logging: readLoggingState(), source, entries });
  });
}
