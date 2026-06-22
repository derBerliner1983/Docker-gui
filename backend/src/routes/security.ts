import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth } from '../middleware/auth';
import { safeExec, privExec, hasBinary } from '../lib/privilege';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

type Status = 'ok' | 'warn' | 'critical' | 'info';

interface Finding {
  id: string;
  category: string;
  title: string;
  status: Status;
  detail: string;
  recommendation: string;
}

function privSafe(cmd: string): string {
  try { return privExec(cmd, { timeout: 6000 }); } catch { return ''; }
}

function sshChecks(): Finding[] {
  const conf = safeExec('cat /etc/ssh/sshd_config 2>/dev/null') + '\n' + safeExec('cat /etc/ssh/sshd_config.d/*.conf 2>/dev/null');
  const findings: Finding[] = [];
  if (!conf.trim()) return findings;

  const rootLogin = conf.match(/^\s*PermitRootLogin\s+(\S+)/im)?.[1]?.toLowerCase();
  findings.push(
    rootLogin === 'yes'
      ? { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH erlaubt', status: 'critical', detail: `PermitRootLogin ${rootLogin}`, recommendation: 'Setze "PermitRootLogin no" in /etc/ssh/sshd_config und nutze einen normalen Benutzer mit sudo.' }
      : { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH deaktiviert', status: 'ok', detail: `PermitRootLogin ${rootLogin ?? 'prohibit-password'}`, recommendation: '' }
  );

  const pwAuth = conf.match(/^\s*PasswordAuthentication\s+(\S+)/im)?.[1]?.toLowerCase();
  findings.push(
    pwAuth === 'no'
      ? { id: 'ssh-pw', category: 'SSH', title: 'SSH nur per Schlüssel (kein Passwort)', status: 'ok', detail: 'PasswordAuthentication no', recommendation: '' }
      : { id: 'ssh-pw', category: 'SSH', title: 'SSH-Passwort-Anmeldung aktiv', status: 'warn', detail: `PasswordAuthentication ${pwAuth ?? 'yes (Standard)'}`, recommendation: 'Nutze SSH-Schlüssel und setze "PasswordAuthentication no", um Brute-Force zu verhindern.' }
  );
  return findings;
}

function firewallCheck(): Finding[] {
  if (!hasBinary('ufw')) {
    return [{ id: 'fw', category: 'Firewall', title: 'Keine Firewall (ufw) installiert', status: 'warn', detail: 'ufw nicht gefunden', recommendation: 'Installiere und aktiviere ufw: apt install ufw && ufw enable.' }];
  }
  const status = safeExec('ufw status 2>/dev/null') || privSafe('ufw status');
  const active = /Status:\s*active/i.test(status);
  return [active
    ? { id: 'fw', category: 'Firewall', title: 'Firewall aktiv', status: 'ok', detail: 'ufw active', recommendation: '' }
    : { id: 'fw', category: 'Firewall', title: 'Firewall installiert, aber inaktiv', status: 'critical', detail: 'ufw inactive', recommendation: 'Aktiviere die Firewall: ufw enable (Standard: eingehend blockieren).' }];
}

function updatesCheck(): Finding[] {
  const findings: Finding[] = [];
  if (hasBinary('apt-get')) {
    const upg = safeExec('apt list --upgradable 2>/dev/null', 10000);
    const secCount = (upg.match(/-security/g) ?? []).length;
    const total = upg.split('\n').filter((l) => l.includes('/')).length;
    findings.push(
      secCount > 0
        ? { id: 'updates-sec', category: 'Updates', title: `${secCount} Sicherheitsupdates verfügbar`, status: 'critical', detail: `${total} Updates gesamt`, recommendation: 'Spiele die Updates unter „System-Updates" oder mit "apt upgrade" ein.' }
        : { id: 'updates-sec', category: 'Updates', title: 'Keine offenen Sicherheitsupdates', status: 'ok', detail: `${total} normale Updates`, recommendation: '' }
    );
    const unattended = safeExec('dpkg -l unattended-upgrades 2>/dev/null | grep -c ^ii').trim();
    findings.push(
      unattended !== '0' && unattended !== ''
        ? { id: 'auto-upd', category: 'Updates', title: 'Automatische Updates aktiv', status: 'ok', detail: 'unattended-upgrades installiert', recommendation: '' }
        : { id: 'auto-upd', category: 'Updates', title: 'Keine automatischen Sicherheitsupdates', status: 'warn', detail: 'unattended-upgrades fehlt', recommendation: 'Installiere unattended-upgrades für automatische Sicherheitspatches.' }
    );
  }
  if (safeExec('test -f /var/run/reboot-required && echo y').trim() === 'y') {
    findings.push({ id: 'reboot', category: 'Updates', title: 'Neustart erforderlich', status: 'warn', detail: 'reboot-required gesetzt', recommendation: 'Starte den Server neu, um Kernel-/Sicherheitsupdates zu aktivieren.' });
  }
  return findings;
}

function intrusionCheck(): Finding[] {
  const f2b = safeExec('systemctl is-active fail2ban 2>/dev/null').trim();
  return [f2b === 'active'
    ? { id: 'f2b', category: 'Intrusion', title: 'fail2ban aktiv', status: 'ok', detail: 'Brute-Force-Schutz läuft', recommendation: '' }
    : { id: 'f2b', category: 'Intrusion', title: 'Kein Brute-Force-Schutz (fail2ban)', status: 'warn', detail: 'fail2ban inaktiv/fehlt', recommendation: 'Installiere fail2ban, um wiederholte Login-Versuche automatisch zu sperren.' }];
}

function accountChecks(): Finding[] {
  const findings: Finding[] = [];
  const empty = privSafe("awk -F: '($2==\"\"){print $1}' /etc/shadow").trim();
  if (empty) {
    findings.push({ id: 'empty-pw', category: 'Konten', title: 'Benutzer ohne Passwort', status: 'critical', detail: empty.replace(/\n/g, ', '), recommendation: 'Setze für diese Konten ein Passwort oder sperre sie (passwd -l <user>).' });
  } else {
    findings.push({ id: 'empty-pw', category: 'Konten', title: 'Keine Konten ohne Passwort', status: 'ok', detail: '', recommendation: '' });
  }
  // Multiple UID 0 accounts
  const uid0 = safeExec("awk -F: '($3==0){print $1}' /etc/passwd").trim().split('\n').filter(Boolean);
  if (uid0.length > 1) {
    findings.push({ id: 'uid0', category: 'Konten', title: 'Mehrere Root-Konten (UID 0)', status: 'critical', detail: uid0.join(', '), recommendation: 'Nur "root" sollte UID 0 haben. Entferne zusätzliche UID-0-Konten.' });
  }
  return findings;
}

function portsCheck(): Finding[] {
  const out = safeExec('ss -tlnH 2>/dev/null');
  const publicPorts = out.split('\n')
    .map((l) => l.trim().split(/\s+/)[3])
    .filter((a) => a && (a.startsWith('0.0.0.0') || a.startsWith('*') || a.startsWith('[::]')))
    .map((a) => a.split(':').pop())
    .filter(Boolean);
  const unique = [...new Set(publicPorts)];
  return [unique.length > 6
    ? { id: 'ports', category: 'Netzwerk', title: `${unique.length} öffentlich erreichbare Ports`, status: 'warn', detail: unique.join(', '), recommendation: 'Prüfe offene Ports und beschränke sie per Firewall auf das Nötige.' }
    : { id: 'ports', category: 'Netzwerk', title: `${unique.length} öffentliche Ports`, status: 'info', detail: unique.join(', ') || 'keine', recommendation: '' }];
}

async function dockerChecks(): Promise<Finding[]> {
  const findings: Finding[] = [];
  try {
    const containers = await docker.listContainers({ all: false });
    const privileged: string[] = [];
    const sockMount: string[] = [];
    await Promise.all(containers.map(async (c) => {
      const info = await docker.getContainer(c.Id).inspect().catch(() => null);
      if (!info) return;
      const name = info.Name.replace(/^\//, '');
      if (info.HostConfig?.Privileged) privileged.push(name);
      if ((info.Mounts ?? []).some((m) => m.Source === '/var/run/docker.sock')) sockMount.push(name);
    }));
    findings.push(privileged.length
      ? { id: 'priv', category: 'Docker', title: `${privileged.length} privilegierte Container`, status: 'critical', detail: privileged.join(', '), recommendation: 'Vermeide --privileged. Vergib nur einzelne benötigte Capabilities.' }
      : { id: 'priv', category: 'Docker', title: 'Keine privilegierten Container', status: 'ok', detail: '', recommendation: '' });
    if (sockMount.length) {
      findings.push({ id: 'sock', category: 'Docker', title: `Docker-Socket in ${sockMount.length} Container(n)`, status: 'warn', detail: sockMount.join(', '), recommendation: 'Ein gemounteter docker.sock = Root auf dem Host. Nur wenn unbedingt nötig und vertrauenswürdig.' });
    }
  } catch {
    /* docker not available */
  }
  return findings;
}

export async function securityRoutes(fastify: FastifyInstance) {
  fastify.get('/api/security/scan', { preHandler: requireAuth }, async (_req, reply) => {
    const findings: Finding[] = [
      ...sshChecks(),
      ...firewallCheck(),
      ...updatesCheck(),
      ...intrusionCheck(),
      ...accountChecks(),
      ...portsCheck(),
      ...(await dockerChecks()),
    ];

    const counts = { ok: 0, warn: 0, critical: 0, info: 0 };
    for (const f of findings) counts[f.status]++;

    let score = 100 - counts.critical * 20 - counts.warn * 8;
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 85 ? 'Sehr gut' : score >= 65 ? 'Gut' : score >= 40 ? 'Verbesserungswürdig' : 'Kritisch';

    reply.send({ score, grade, counts, findings, scannedAt: new Date().toISOString() });
  });
}
