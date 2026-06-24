import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { privExec, safeExec, hasBinary } from '../lib/privilege';
import { auditQueries, db } from '../db/index';
import { ingestFirewallLog, queryFirewallLog, firewallLogStats, clearFirewallLog } from '../lib/firewalllog';

interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  direction: string; // IN | OUT | ''
  from: string;
  comment: string;
}

// ── Deaktivierte Regeln (Parkbucht): aus ufw entfernt, aber gemerkt zum Reaktivieren ──
db.exec(`
  CREATE TABLE IF NOT EXISTS firewall_disabled (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    action     TEXT NOT NULL DEFAULT 'allow',
    direction  TEXT NOT NULL DEFAULT '',
    port       TEXT NOT NULL DEFAULT '',
    proto      TEXT NOT NULL DEFAULT '',
    from_addr  TEXT NOT NULL DEFAULT '',
    profile    TEXT NOT NULL DEFAULT '',
    comment    TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
try { db.exec(`ALTER TABLE firewall_disabled ADD COLUMN profile TEXT NOT NULL DEFAULT ''`); } catch { /* Spalte existiert */ }
interface DisabledRow { id: number; action: string; direction: string; port: string; proto: string; from_addr: string; profile: string; comment: string }
const dq = {
  list:   db.prepare(`SELECT * FROM firewall_disabled ORDER BY id`),
  get:    db.prepare(`SELECT * FROM firewall_disabled WHERE id = ?`),
  insert: db.prepare(`INSERT INTO firewall_disabled (action,direction,port,proto,from_addr,profile,comment) VALUES (?,?,?,?,?,?,?)`),
  del:    db.prepare(`DELETE FROM firewall_disabled WHERE id = ?`),
};

/** Benannte ufw-Profile (z.B. "OpenSSH") shell-sicher säubern. */
function cleanProfile(p?: string): string {
  return (p ?? '').replace(/\s*\(v6\)\s*$/i, '').replace(/[^\w \-()]/g, '').trim().slice(0, 40);
}

/** Parse `ufw status numbered` output (inkl. Kommentar/Name). */
function parseUfw(out: string): FirewallRule[] {
  const rules: FirewallRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(.+?)(?:\s+#\s*(.*))?$/i);
    if (m) {
      rules.push({
        num: parseInt(m[1]),
        to: m[2].trim(),
        action: m[3].toUpperCase(),
        direction: (m[4] ?? '').toUpperCase(),
        from: m[5].trim(),
        comment: (m[6] ?? '').trim(),
        raw: line.trim(),
      });
    }
  }
  return rules;
}

/** Kommentar/Name säubern (Shell-sicher) und auf Länge begrenzen. */
function cleanComment(c?: string): string {
  return (c ?? '').replace(/[^\w \-.,:/äöüÄÖÜß()]/g, '').trim().slice(0, 60);
}

/** Build a `ufw <action> …` command from sanitised parts. Returns null if neither port nor source given. */
function buildRuleCmd(
  action: string,
  parts: { p: string; pr: string; fromIp: string; dir: string; comment?: string },
): string | null {
  const { p, pr, fromIp, dir } = parts;
  const d = dir ? ` ${dir}` : '';
  const c = parts.comment ? ` comment '${cleanComment(parts.comment)}'` : '';
  let base: string | null = null;
  if (!dir) {
    // Einfache Syntax (Standard = eingehend)
    if (fromIp) base = `ufw ${action} from ${fromIp}${p ? ` to any port ${p}` : ''}${pr ? ` proto ${pr}` : ''}`;
    else if (p) base = `ufw ${action} ${p}${pr ? `/${pr}` : ''}`;
  } else {
    // Mit Richtung → ausführliche Syntax
    if (fromIp) base = `ufw ${action}${d} from ${fromIp}${p ? ` to any port ${p}` : ''}${pr ? ` proto ${pr}` : ''}`;
    else if (p) base = `ufw ${action}${d} to any port ${p}${pr ? ` proto ${pr}` : ''}`;
  }
  return base ? base + c : null;
}

function sanitiseParts(body: { port?: string; proto?: string; from?: string; direction?: string; comment?: string }) {
  return {
    p: (body.port ?? '').replace(/[^0-9:]/g, ''),
    pr: body.proto === 'udp' ? 'udp' : body.proto === 'tcp' ? 'tcp' : '',
    fromIp: (body.from ?? '').replace(/[^0-9a-fA-F:./]/g, ''),
    dir: body.direction === 'out' ? 'out' : body.direction === 'in' ? 'in' : '',
    comment: cleanComment(body.comment),
  };
}

/** Mehrere Quell-Adressen aus einem Feld trennen (Komma/Leerzeichen/Zeilenumbruch). */
function splitAddrs(from?: string): string[] {
  return (from ?? '').split(/[\s,;]+/).map((a) => a.replace(/[^0-9a-fA-F:./]/g, '')).filter(Boolean);
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
      return reply.send({ available: false, active: false, rules: [], disabled: [], logging: false, message: 'ufw nicht installiert (apt install ufw)', listening: ports.trim() });
    }
    const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
    const active = /Status:\s*active/i.test(status);
    const disabled = (dq.list.all() as DisabledRow[]).map((d) => ({
      id: d.id, action: d.action, direction: d.direction.toUpperCase(),
      port: d.port, proto: d.proto, from: d.from_addr,
      to: d.profile || (d.port ? `${d.port}${d.proto ? '/' + d.proto : ''}` : 'Regel'),
      comment: d.comment,
    }));
    reply.send({ available: true, active, logging: readLoggingState(), rules: parseUfw(status), disabled });
  });

  fastify.post<{ Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string } }>(
    '/api/firewall',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const body = req.body ?? {};
      const { action } = body;
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const base = sanitiseParts(body);
      // Mehrere Quell-Adressen → je eine Regel (gleicher Name zum Gruppieren)
      const addrs = splitAddrs(body.from);
      const targets = addrs.length > 0 ? addrs : [''];
      const cmds = targets.map((a) => buildRuleCmd(action, { ...base, fromIp: a })).filter(Boolean) as string[];
      if (cmds.length === 0) return reply.status(400).send({ error: 'Port oder Quell-IP erforderlich' });
      try {
        for (const cmd of cmds) privExec(cmd, { timeout: 8000 });
        auditQueries.log.run(req.user.id, 'firewall.add', `${cmds.length} Regel(n): ${cmds[0].replace('ufw ', '')}`);
        reply.send({ ok: true, count: cmds.length });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Regel bearbeiten = an gleicher Position neu einfügen, alte entfernen
  fastify.put<{ Params: { num: string }; Body: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string } }>(
    '/api/firewall/:num',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const num = parseInt(req.params.num);
      if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
      const { action } = req.body ?? {};
      if (!['allow', 'deny', 'reject'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      // Beim Bearbeiten nur die erste Adresse verwenden (eine Regel = eine Position)
      const parts = sanitiseParts(req.body ?? {});
      const firstAddr = splitAddrs(req.body?.from)[0] ?? '';
      const cmd = buildRuleCmd(action, { ...parts, fromIp: firstAddr });
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

  // Regel deaktivieren: aus ufw entfernen, aber Spezifikation merken (zum Reaktivieren)
  fastify.post<{ Params: { num: string }; Body: { action?: string; port?: string; proto?: string; from?: string; direction?: string; comment?: string; profile?: string } }>(
    '/api/firewall/:num/disable',
    { preHandler: requireAdmin },
    async (req, reply) => {
      if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
      const num = parseInt(req.params.num);
      if (!num) return reply.status(400).send({ error: 'Ungültige Regelnummer' });
      const b = req.body ?? {};
      const p = sanitiseParts(b);
      const profile = cleanProfile(b.profile);
      const action = ['allow', 'deny', 'reject'].includes(b.action ?? '') ? b.action! : 'allow';
      try {
        privExec(`bash -c "yes | ufw delete ${num}"`, { timeout: 8000 });
        dq.insert.run(action, p.dir, p.p, p.pr, p.fromIp, profile, p.comment);
        auditQueries.log.run(req.user.id, 'firewall.disable', String(num));
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
      }
    }
  );

  // Deaktivierte Regel wieder aktivieren: erneut in ufw anlegen, aus der Parkbucht entfernen
  fastify.post<{ Params: { id: string } }>('/api/firewall/disabled/:id/enable', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    const row = dq.get.get(parseInt(req.params.id)) as DisabledRow | undefined;
    if (!row) return reply.status(404).send({ error: 'Regel nicht gefunden' });
    const c = row.comment ? ` comment '${cleanComment(row.comment)}'` : '';
    const cmd = row.profile
      ? `ufw ${row.action}${row.direction ? ` ${row.direction}` : ''} ${cleanProfile(row.profile)}${c}`
      : buildRuleCmd(row.action, { p: row.port, pr: row.proto, fromIp: row.from_addr, dir: row.direction, comment: row.comment });
    if (!cmd) { dq.del.run(row.id); return reply.send({ ok: true }); }
    try {
      privExec(cmd, { timeout: 8000 });
      dq.del.run(row.id);
      auditQueries.log.run(req.user.id, 'firewall.enable', cmd.replace('ufw ', ''));
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'ufw-Fehler' });
    }
  });

  // Deaktivierte Regel endgültig verwerfen
  fastify.delete<{ Params: { id: string } }>('/api/firewall/disabled/:id', { preHandler: requireAdmin }, async (req, reply) => {
    dq.del.run(parseInt(req.params.id));
    auditQueries.log.run(req.user.id, 'firewall.disabled.delete', req.params.id);
    reply.send({ ok: true });
  });

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
