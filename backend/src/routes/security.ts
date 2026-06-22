import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { safeExec, privExec, hasBinary } from '../lib/privilege';
import { userQueries, auditQueries } from '../db/index';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

type Status = 'ok' | 'warn' | 'critical' | 'info';

interface Finding {
  id: string;
  category: string;
  title: string;
  status: Status;
  detail: string;
  recommendation: string;
  fix?: string; // action id for one-click remediation
}

function sshServiceUnit(): string {
  // Debian uses "ssh", RHEL/Arch use "sshd"
  return safeExec('systemctl list-unit-files 2>/dev/null | grep -qE "^sshd?\\.service" && (systemctl list-unit-files | grep -qE "^ssh\\.service" && echo ssh || echo sshd) || echo ssh').trim() || 'ssh';
}

function defaultPasswordCheck(): Finding[] {
  try {
    const admin = userQueries.getByUsername.get('admin');
    if (admin && bcrypt.compareSync('admin', admin.password_hash)) {
      return [{ id: 'default-pw', category: 'Core-Hub', title: 'Standard-Passwort "admin" noch aktiv', status: 'critical', detail: 'Login admin/admin', recommendation: 'Ändere das Passwort sofort unter Einstellungen → Passwort ändern.' }];
    }
  } catch { /* */ }
  return [{ id: 'default-pw', category: 'Core-Hub', title: 'Standard-Passwort geändert', status: 'ok', detail: '', recommendation: '' }];
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
      ? { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH erlaubt', status: 'critical', detail: `PermitRootLogin ${rootLogin}`, recommendation: 'Setze "PermitRootLogin no" und nutze einen normalen Benutzer mit sudo.', fix: 'ssh-disable-root' }
      : { id: 'ssh-root', category: 'SSH', title: 'Root-Login per SSH deaktiviert', status: 'ok', detail: `PermitRootLogin ${rootLogin ?? 'prohibit-password'}`, recommendation: '' }
  );

  const pwAuth = conf.match(/^\s*PasswordAuthentication\s+(\S+)/im)?.[1]?.toLowerCase();
  findings.push(
    pwAuth === 'no'
      ? { id: 'ssh-pw', category: 'SSH', title: 'SSH nur per Schlüssel (kein Passwort)', status: 'ok', detail: 'PasswordAuthentication no', recommendation: '' }
      : { id: 'ssh-pw', category: 'SSH', title: 'SSH-Passwort-Anmeldung aktiv', status: 'warn', detail: `PasswordAuthentication ${pwAuth ?? 'yes (Standard)'}`, recommendation: 'Nutze SSH-Schlüssel und setze "PasswordAuthentication no".', fix: 'ssh-disable-password' }
  );
  return findings;
}

function firewallCheck(): Finding[] {
  if (!hasBinary('ufw')) {
    return [{ id: 'fw', category: 'Firewall', title: 'Keine Firewall (ufw) installiert', status: 'warn', detail: 'ufw nicht gefunden', recommendation: 'Installiere und aktiviere ufw (eingehend blockieren, SSH erlauben).', fix: 'firewall-install-enable' }];
  }
  const status = safeExec('ufw status 2>/dev/null') || privSafe('ufw status');
  const active = /Status:\s*active/i.test(status);
  return [active
    ? { id: 'fw', category: 'Firewall', title: 'Firewall aktiv', status: 'ok', detail: 'ufw active', recommendation: '' }
    : { id: 'fw', category: 'Firewall', title: 'Firewall installiert, aber inaktiv', status: 'critical', detail: 'ufw inactive', recommendation: 'Aktiviere die Firewall (Standard: eingehend blockieren, SSH erlauben).', fix: 'firewall-install-enable' }];
}

function hardeningChecks(): Finding[] {
  const findings: Finding[] = [];
  // MAC framework (AppArmor / SELinux)
  const apparmor = safeExec('aa-status --enabled 2>/dev/null && echo on').includes('on') || safeExec('systemctl is-active apparmor 2>/dev/null').trim() === 'active';
  const selinux = safeExec('getenforce 2>/dev/null').trim().toLowerCase() === 'enforcing';
  findings.push(apparmor || selinux
    ? { id: 'mac', category: 'Härtung', title: `Mandatory Access Control aktiv (${selinux ? 'SELinux' : 'AppArmor'})`, status: 'ok', detail: '', recommendation: '' }
    : { id: 'mac', category: 'Härtung', title: 'Kein AppArmor/SELinux aktiv', status: 'warn', detail: 'MAC-Framework inaktiv', recommendation: 'Aktiviere AppArmor (Debian/Ubuntu) oder SELinux (RHEL) für zusätzliche Isolierung.' });

  // Time sync
  const timesync = safeExec('timedatectl show -p NTPSynchronized --value 2>/dev/null').trim();
  if (timesync) {
    findings.push(timesync === 'yes'
      ? { id: 'time', category: 'Härtung', title: 'Zeitsynchronisation aktiv', status: 'ok', detail: 'NTP synchronisiert', recommendation: '' }
      : { id: 'time', category: 'Härtung', title: 'Keine Zeitsynchronisation', status: 'info', detail: 'NTP nicht synchronisiert', recommendation: 'Aktiviere NTP: timedatectl set-ntp true (wichtig für Zertifikate/Logs).' });
  }
  return findings;
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
        : { id: 'auto-upd', category: 'Updates', title: 'Keine automatischen Sicherheitsupdates', status: 'warn', detail: 'unattended-upgrades fehlt', recommendation: 'Installiere unattended-upgrades für automatische Sicherheitspatches.', fix: 'auto-updates-install' }
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
    : { id: 'f2b', category: 'Intrusion', title: 'Kein Brute-Force-Schutz (fail2ban)', status: 'warn', detail: 'fail2ban inaktiv/fehlt', recommendation: 'Installiere fail2ban, um wiederholte Login-Versuche automatisch zu sperren.', fix: 'fail2ban-install' }];
}

function antivirusCheck(): Finding[] {
  const installed = hasBinary('clamscan') || hasBinary('clamdscan');
  if (!installed) {
    return [{ id: 'av', category: 'Virenschutz', title: 'Kein Virenschutz (ClamAV) installiert', status: 'warn', detail: 'clamav nicht gefunden', recommendation: 'Installiere ClamAV, um Dateien auf Schadsoftware prüfen zu können.', fix: 'antivirus-install' }];
  }
  const findings: Finding[] = [{ id: 'av', category: 'Virenschutz', title: 'Virenschutz installiert (ClamAV)', status: 'ok', detail: '', recommendation: '' }];
  const ts = safeExec("stat -c %Y /var/lib/clamav/daily.cvd /var/lib/clamav/daily.cld 2>/dev/null | sort -n | tail -1").trim();
  if (ts) {
    const age = Math.floor((Date.now() / 1000 - parseInt(ts)) / 86400);
    if (age > 7) findings.push({ id: 'av-defs', category: 'Virenschutz', title: `Viren-Signaturen veraltet (${age} Tage)`, status: 'warn', detail: '', recommendation: 'Aktualisiere die Signaturen unter „Virenschutz" (freshclam).' });
  }
  return findings;
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
      ...defaultPasswordCheck(),
      ...sshChecks(),
      ...firewallCheck(),
      ...updatesCheck(),
      ...intrusionCheck(),
      ...antivirusCheck(),
      ...accountChecks(),
      ...portsCheck(),
      ...hardeningChecks(),
      ...(await dockerChecks()),
    ];

    const counts = { ok: 0, warn: 0, critical: 0, info: 0 };
    for (const f of findings) counts[f.status]++;

    let score = 100 - counts.critical * 20 - counts.warn * 8;
    score = Math.max(0, Math.min(100, score));
    const grade = score >= 85 ? 'Sehr gut' : score >= 65 ? 'Gut' : score >= 40 ? 'Verbesserungswürdig' : 'Kritisch';

    reply.send({ score, grade, counts, findings, scannedAt: new Date().toISOString() });
  });

  // ── SSH service status & control ──
  fastify.get('/api/security/ssh', { preHandler: requireAuth }, async (_req, reply) => {
    const unit = sshServiceUnit();
    const installed = hasBinary('sshd') || safeExec(`systemctl list-unit-files 2>/dev/null | grep -c "^${unit}.service"`).trim() !== '0';
    const active = safeExec(`systemctl is-active ${unit} 2>/dev/null`).trim() === 'active';
    const enabled = safeExec(`systemctl is-enabled ${unit} 2>/dev/null`).trim() === 'enabled';
    const port = safeExec('grep -hiE "^\\s*Port\\s+" /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null | head -1').trim().split(/\s+/)[1] || '22';
    reply.send({ installed, active, enabled, unit, port });
  });

  fastify.post<{ Body: { action: 'start' | 'stop' | 'enable' | 'disable' } }>(
    '/api/security/ssh',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      if (!['start', 'stop', 'enable', 'disable'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const unit = sshServiceUnit();
      try {
        if (action === 'enable') privExec(`systemctl enable --now ${unit}`, { timeout: 12000 });
        else if (action === 'disable') privExec(`systemctl disable --now ${unit}`, { timeout: 12000 });
        else privExec(`systemctl ${action} ${unit}`, { timeout: 12000 });
        auditQueries.log.run(req.user.id, `ssh.${action}`, unit);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'SSH-Steuerung fehlgeschlagen' });
      }
    }
  );

  // ── One-click hardening actions ──
  fastify.post<{ Body: { action: string } }>(
    '/api/security/action',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const action = req.body?.action;
      const unit = sshServiceUnit();
      try {
        let output = '';
        switch (action) {
          case 'ssh-disable-root':
            privExec(`bash -c "sed -ri 's/^[#\\s]*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config; grep -qiE '^PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin no' >> /etc/ssh/sshd_config"`);
            privExec(`systemctl reload ${unit} 2>/dev/null || systemctl restart ${unit}`, { timeout: 12000 });
            break;
          case 'ssh-disable-password':
            privExec(`bash -c "sed -ri 's/^[#\\s]*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config; grep -qiE '^PasswordAuthentication' /etc/ssh/sshd_config || echo 'PasswordAuthentication no' >> /etc/ssh/sshd_config"`);
            privExec(`systemctl reload ${unit} 2>/dev/null || systemctl restart ${unit}`, { timeout: 12000 });
            break;
          case 'firewall-install-enable':
            if (!hasBinary('ufw')) privExec('apt-get install -y ufw', { timeout: 180000 });
            privExec('bash -c "ufw default deny incoming; ufw default allow outgoing; ufw allow OpenSSH 2>/dev/null || ufw allow 22/tcp; yes | ufw enable"', { timeout: 30000 });
            break;
          case 'fail2ban-install':
            privExec('apt-get install -y fail2ban', { timeout: 180000 });
            privExec('systemctl enable --now fail2ban', { timeout: 15000 });
            break;
          case 'auto-updates-install':
            privExec('apt-get install -y unattended-upgrades', { timeout: 180000 });
            privExec('bash -c "echo unattended-upgrades unattended-upgrades/enable_auto_updates boolean true | debconf-set-selections; dpkg-reconfigure -f noninteractive unattended-upgrades"', { timeout: 30000 });
            break;
          case 'antivirus-install':
            privExec('apt-get install -y clamav clamav-daemon', { timeout: 300000 });
            break;
          default:
            return reply.status(400).send({ error: 'Unbekannte Aktion' });
        }
        auditQueries.log.run(req.user.id, 'security.fix', action);
        reply.send({ ok: true, output });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Aktion fehlgeschlagen';
        reply.status(500).send({ error: msg.includes('sudo') ? 'Keine Root-Rechte (sudoers nicht eingerichtet?)' : msg });
      }
    }
  );
}
