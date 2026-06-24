import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';
import { ingestFirewallLog, queryFirewallLog, firewallLogStats, clearFirewallLog } from '../lib/firewalllog';

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
      if (req.body?.enable) {
        // Aussperr-Schutz: SSH und Web-Ports (80/443 für die Oberfläche) zuerst freigeben,
        // sonst ist Core-Hub nach dem Aktivieren nicht mehr erreichbar.
        for (const r of ['22/tcp', '80/tcp', '443/tcp']) {
          try { privExec(`ufw allow ${r}`, { timeout: 8000 }); } catch { /* evtl. schon vorhanden */ }
        }
      }
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

  // Verbindungsversuche aus der Protokoll-DB (vorher frische Logzeilen einlesen)
  fastify.get<{ Querystring: { limit?: string } }>('/api/firewall/log', { preHandler: requireAuth }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.send({ available: false, logging: false, entries: [], total: 0, blocked: 0, message: 'ufw nicht installiert' });
    const limit = Math.min(5000, Math.max(10, parseInt(req.query.limit ?? '500') || 500));
    try { ingestFirewallLog(); } catch { /* */ }
    const entries = queryFirewallLog(limit);
    const stats = firewallLogStats();
    reply.send({ available: true, logging: readLoggingState(), source: 'Protokoll-DB', entries, total: stats.total, blocked: stats.blocked });
  });

  // Protokoll leeren
  fastify.delete('/api/firewall/log', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      clearFirewallLog();
      auditQueries.log.run(req.user.id, 'firewall.log.clear', null);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Fehler' });
    }
  });
}
