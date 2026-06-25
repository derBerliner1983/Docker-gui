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

/** Redundante Richtungs-Suffixe `(in)`/`(out)` entfernen – die Richtung steht in einer eigenen Spalte. */
function stripDirSuffix(s: string): string {
  return s.replace(/\s*\((?:in|out)\)/gi, '').replace(/\s+/g, ' ').trim();
}

/** Parse `ufw status numbered` output (inkl. Kommentar/Name). */
function parseUfw(out: string): FirewallRule[] {
  const rules: FirewallRule[] = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\[\s*(\d+)\]\s+(.+?)\s{2,}(ALLOW|DENY|REJECT|LIMIT)(?:\s+(IN|OUT))?\s+(.+?)(?:\s+#\s*(.*))?$/i);
    if (m) {
      rules.push({
        num: parseInt(m[1]),
        to: stripDirSuffix(m[2].trim()),
        action: m[3].toUpperCase(),
        direction: (m[4] ?? '').toUpperCase(),
        from: stripDirSuffix(m[5].trim()),
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
  const c = parts.comment ? ` comment '${cleanComment(parts.comment)}'` : '';
  const proto = pr ? ` proto ${pr}` : '';
  let base: string | null = null;
  if (dir === 'out') {
    // Ausgehend: die angegebene Adresse ist das Ziel (wohin der Verkehr geht)
    if (fromIp) base = `ufw ${action} out to ${fromIp}${p ? ` port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} out to any port ${p}${proto}`;
  } else if (dir === 'in') {
    // Eingehend: die angegebene Adresse ist die Quelle (woher der Verkehr kommt)
    if (fromIp) base = `ufw ${action} in from ${fromIp}${p ? ` to any port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} in to any port ${p}${proto}`;
  } else {
    // Ohne Richtung → einfache Syntax (Standard = eingehend)
    if (fromIp) base = `ufw ${action} from ${fromIp}${p ? ` to any port ${p}` : ''}${proto}`;
    else if (p) base = `ufw ${action} ${p}${pr ? `/${pr}` : ''}`;
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

/** Logging-Stufe lesen: off | low | medium | high | full. */
function readLoggingLevel(): string {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  const m = v.match(/Logging:\s*on\s*\(([a-z]+)\)/i);
  if (m) return m[1].toLowerCase();
  return /Logging:\s*on/i.test(v) ? 'low' : 'off';
}

const LOG_LEVELS = ['off', 'low', 'medium', 'high', 'full'];

function privExecSafe(cmd: string): string {
  try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
}

// ── Plausibilitäts-Assistent: Regeln gegen bekannte Risiken + offene Ports prüfen ──

/** Bekannte Ports mit Risiko-Einstufung (Teilmenge der Security-PORT_DB, hier lokal gehalten). */
const PORT_RISK: Record<string, { name: string; lanOnly: boolean; note: string }> = {
  '139':   { name: 'NetBIOS/Samba', lanOnly: true,  note: 'NIE ins Internet – Exploit-Risiko (EternalBlue/WannaCry).' },
  '445':   { name: 'SMB/Samba',     lanOnly: true,  note: 'NIE ins Internet – Exploit-Risiko (EternalBlue/WannaCry).' },
  '3306':  { name: 'MySQL/MariaDB', lanOnly: true,  note: 'Datenbank niemals direkt ins Internet.' },
  '5432':  { name: 'PostgreSQL',    lanOnly: true,  note: 'Datenbank niemals direkt ins Internet.' },
  '6379':  { name: 'Redis',         lanOnly: true,  note: 'Redis hat standardmäßig keine Auth – nur LAN.' },
  '27017': { name: 'MongoDB',       lanOnly: true,  note: 'Datenbank nur intern.' },
  '5900':  { name: 'VNC',           lanOnly: true,  note: 'VNC oft unverschlüsselt – niemals ins Internet.' },
  '3389':  { name: 'RDP',           lanOnly: true,  note: 'RDP-Brute-Force-Risiko – niemals direkt ins Internet.' },
  '2049':  { name: 'NFS',           lanOnly: true,  note: 'NFS-Freigaben nur im LAN.' },
  '111':   { name: 'RPC',           lanOnly: true,  note: 'RPC/NFS nur im LAN.' },
  '11434': { name: 'Ollama AI',     lanOnly: true,  note: 'Ollama-API ohne Auth – nur LAN oder via VPN.' },
};

/** Quell-Adresse einer Regel einordnen. */
function classifyFrom(from: string): 'any' | 'lan' | 'specific' {
  const f = from.trim().toLowerCase();
  if (!f || /anywhere/.test(f) || f === '0.0.0.0/0' || f === '::/0') return 'any';
  if (/^10\./.test(f) || /^192\.168\./.test(f) || /^172\.(1[6-9]|2\d|3[01])\./.test(f) ||
      /^169\.254\./.test(f) || /^f[cd]/.test(f) || /^fe80/.test(f)) return 'lan';
  return 'specific';
}

/** Aus dem "to"-Feld einer Regel die Portnummer ziehen (oder null bei Profil-Namen). */
function rulePort(to: string): { port: string; proto: string } | null {
  const m = to.trim().match(/^(\d+)(?::\d+)?(?:\/(tcp|udp))?$/i);
  if (!m) return null;
  return { port: m[1], proto: (m[2] ?? '').toLowerCase() };
}

/** Lauschende Ports → 'public' (0.0.0.0/extern) oder 'local' (nur 127.0.0.1). */
function listeningPorts(): Map<string, 'public' | 'local'> {
  const out = safeExec('ss -tulnH 2>/dev/null') || privExecSafe('ss -tulnH');
  const map = new Map<string, 'public' | 'local'>();
  for (const line of out.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 5) continue;
    const local = cols[4];
    const portM = local.match(/:(\d+)$/);
    if (!portM) continue;
    const port = portM[1];
    const addr = local.slice(0, local.lastIndexOf(':'));
    const isLocal = addr.startsWith('127.') || addr === '[::1]' || addr.includes('127.0.0.53');
    const scope: 'public' | 'local' = isLocal ? 'local' : 'public';
    if (map.get(port) !== 'public') map.set(port, scope);
  }
  return map;
}

/** Standard-Politik für eingehenden Verkehr (deny/allow/reject). */
function defaultIncoming(): string {
  const v = safeExec('ufw status verbose 2>/dev/null') || privExecSafe('ufw status verbose');
  const m = v.match(/Default:\s*(\w+)\s*\(incoming\)/i);
  return m ? m[1].toLowerCase() : '';
}

interface FwFinding {
  id: string;
  severity: 'critical' | 'warn' | 'info' | 'ok';
  title: string;
  detail: string;
  recommendation: string;
  ruleNum?: number;
  port?: string;
  fix?: 'disable' | 'delete';
  fixLabel?: string;
}

/** Alle Regeln gegen Risiken, offene Ports und Redundanzen prüfen. */
function analyzeFirewall(rules: FirewallRule[], listening: Map<string, 'public' | 'local'>, defIncoming: string): FwFinding[] {
  const findings: FwFinding[] = [];

  // 1) Standard-Richtlinie eingehend sollte "deny" sein
  if (defIncoming && defIncoming !== 'deny' && defIncoming !== 'reject') {
    findings.push({
      id: 'default-incoming',
      severity: 'warn',
      title: `Standard-Richtlinie (eingehend) ist „${defIncoming}"`,
      detail: `ufw default: ${defIncoming} (incoming)`,
      recommendation: 'Auf „deny (incoming)" stellen — dann sind nur ausdrücklich erlaubte Ports offen. (Wird beim Aktivieren der Firewall automatisch gesetzt.)',
    });
  }

  // 2) Pro Regel prüfen
  const seen = new Map<string, number>();
  for (const r of rules) {
    if (r.action === 'ALLOW' && r.direction === 'OUT') continue; // ausgehende Allows sind unkritisch
    const pp = rulePort(r.to);
    const fromClass = classifyFrom(r.from);
    const key = `${r.action}|${r.to}|${r.from}|${r.direction}`;

    // Doppelte Regel
    if (seen.has(key)) {
      findings.push({
        id: `dup-${r.num}`, severity: 'info',
        title: `Doppelte Regel #${r.num}`,
        detail: r.raw,
        recommendation: `Inhaltlich identisch mit Regel #${seen.get(key)}. Eine davon kann entfernt werden.`,
        ruleNum: r.num, fix: 'delete', fixLabel: 'Duplikat löschen',
      });
      continue;
    }
    seen.set(key, r.num);

    if (pp && r.action === 'ALLOW') {
      const info = PORT_RISK[pp.port];
      // Gefährliche Freigabe: LAN-only-Port für ALLE offen
      if (info?.lanOnly && fromClass === 'any') {
        findings.push({
          id: `expose-${r.num}`, severity: 'critical',
          title: `${info.name} (Port ${pp.port}) ist für ALLE erreichbar`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: `${info.note} Auf das LAN beschränken oder die Regel parken.`,
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Regel parken',
        });
      }
      // SSH aus dem Internet
      else if (pp.port === '22' && fromClass === 'any') {
        findings.push({
          id: `ssh-${r.num}`, severity: 'warn',
          title: 'SSH (Port 22) ist aus dem Internet erreichbar',
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Nur mit SSH-Schlüsseln + fail2ban betreiben — oder besser auf das LAN beschränken (z. B. von 192.168.0.0/16).',
          ruleNum: r.num, port: '22',
        });
      }
      // Verwaiste Regel: Port offen, aber kein Dienst lauscht
      else if (!listening.has(pp.port)) {
        findings.push({
          id: `orphan-${r.num}`, severity: 'info',
          title: `Port ${pp.port} ist offen, aber kein Dienst lauscht darauf`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Aktuell hört kein Programm auf diesem Port. Du kannst die Regel gefahrlos parken — sobald ein Docker-Container o. Ä. den Port braucht, einfach wieder aktivieren.',
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Port schließen (parken)',
        });
      }
      // Dienst nur auf localhost → externe Freigabe unnötig
      else if (listening.get(pp.port) === 'local') {
        findings.push({
          id: `loopback-${r.num}`, severity: 'info',
          title: `Port ${pp.port} ist offen, aber der Dienst läuft nur auf localhost`,
          detail: `Regel #${r.num}: ${r.raw}`,
          recommendation: 'Der Dienst ist von außen ohnehin nicht erreichbar (nur 127.0.0.1). Die Freigabe bringt nichts und kann geparkt werden.',
          ruleNum: r.num, port: pp.port, fix: 'disable', fixLabel: 'Regel parken',
        });
      }
    }
  }

  return findings;
}

export function buildFirewallAnalysis() {
  const status = safeExec('ufw status numbered 2>/dev/null') || privExecSafe('ufw status numbered');
  const active = /Status:\s*active/i.test(status);
  const rules = parseUfw(status);
  const listening = listeningPorts();
  const def = defaultIncoming();
  const findings = analyzeFirewall(rules, listening, def);
  const counts = {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warn: findings.filter((f) => f.severity === 'warn').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
  return { active, ruleCount: rules.length, defaultIncoming: def, listeningCount: listening.size, findings, counts };
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

  // Plausibilitäts-Assistent: Regeln prüfen und Optimierungen vorschlagen
  fastify.get('/api/firewall/analyze', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ufw')) return reply.send({ available: false, active: false, ruleCount: 0, findings: [], counts: { critical: 0, warn: 0, info: 0 } });
    try {
      reply.send({ available: true, ...buildFirewallAnalysis() });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Analyse fehlgeschlagen' });
    }
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
      // "both" → je eine Regel für ein- und ausgehend
      const dirs = body.direction === 'both' ? ['in', 'out'] : [base.dir];
      // Mehrere Quell-Adressen → je eine Regel (gleicher Name zum Gruppieren)
      const addrs = splitAddrs(body.from);
      const targets = addrs.length > 0 ? addrs : [''];
      const cmds: string[] = [];
      for (const a of targets) {
        for (const d of dirs) {
          const cmd = buildRuleCmd(action, { ...base, fromIp: a, dir: d });
          if (cmd) cmds.push(cmd);
        }
      }
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

  // Protokollierung (Verbindungsversuche) ein-/ausschalten oder Stufe setzen
  fastify.post<{ Body: { enable?: boolean; level?: string } }>('/api/firewall/logging', { preHandler: requireAdmin }, async (req, reply) => {
    if (!hasBinary('ufw')) return reply.status(503).send({ error: 'ufw nicht installiert' });
    // Stufe hat Vorrang; sonst per enable an/aus. ufw-Stufen: off/low/medium/high/full
    const target = req.body?.level && LOG_LEVELS.includes(req.body.level)
      ? req.body.level
      : (req.body?.enable ? 'on' : 'off');
    try {
      privExec(`ufw logging ${target}`, { timeout: 8000 });
      auditQueries.log.run(req.user.id, 'firewall.logging', target);
      reply.send({ ok: true, logging: target !== 'off', level: readLoggingLevel() });
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
    reply.send({ available: true, logging: readLoggingState(), level: readLoggingLevel(), source: 'Protokoll-DB', entries, total: stats.total, blocked: stats.blocked });
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
