import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries } from '../db/index';

interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  from: string;
}

/** Parse `ufw status numbered` output. */
function parseUfw(out: string): FirewallRule[] {
  const rules: FirewallRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+IN| OUT)?\s+(.+)$/i);
    if (m) {
      rules.push({ num: parseInt(m[1]), to: m[2].trim(), action: m[3].toUpperCase(), from: m[4].trim(), raw: line.trim() });
    }
  }
  return rules;
}

export async function firewallRoutes(fastify: FastifyInstance) {
  fastify.get('/api/firewall', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ufw')) {
      // Fall back to showing listening ports only
      const ports = safeExec("ss -tulnH 2>/dev/null | awk '{print $1, $5}' | head -60");
      return reply.send({ available: false, active: false, rules: [], message: 'ufw nicht installiert (apt install ufw)', listening: ports.trim() });
    }
    const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
    const active = /Status:\s*active/i.test(status);
    reply.send({ available: true, active, rules: parseUfw(status) });
  });

  function privExecSafe(cmd: string): string {
    try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
  }

  fastify.post<{ Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string } }>(
    '/api/firewall',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const { action, port, proto, from } = req.body ?? {};
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const p = (port ?? '').replace(/[^0-9:]/g, '');
      const pr = proto === 'udp' ? 'udp' : proto === 'tcp' ? 'tcp' : '';
      const fromIp = (from ?? '').replace(/[^0-9a-fA-F:./]/g, '');

      let cmd: string;
      if (fromIp) {
        cmd = `ufw ${action} from ${fromIp}${p ? ` to any port ${p}` : ''}${pr ? ` proto ${pr}` : ''}`;
      } else if (p) {
        cmd = `ufw ${action} ${p}${pr ? `/${pr}` : ''}`;
      } else {
        return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      }
      try {
        privExec(cmd, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.add', cmd.replace('ufw ', ''));
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
}
