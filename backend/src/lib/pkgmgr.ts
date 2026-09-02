import { hasBinary, privExec, safeExec } from './privilege';

/**
 * Distributionsunabhängige Paketverwaltung.
 *
 * Core-Hub läuft nicht nur auf Debian/Ubuntu, sondern auch auf Arch-basierten
 * Systemen (Arch, CachyOS, EndeavourOS, Manjaro) sowie – so gut es geht – auf
 * Fedora/RHEL und openSUSE. Damit die Routen nicht jedes Mal Fallunterscheidungen
 * mitschleppen müssen, liegt die Übersetzung „logisches Paket → echte Pakete“
 * und der passende Installationsbefehl hier zentral.
 */

export type PkgManager = 'apt' | 'pacman' | 'dnf' | 'zypper';

/** Erkannter Paketmanager des Systems (null, wenn keiner erkannt wurde). */
export function detectPM(): PkgManager | null {
  if (hasBinary('apt-get')) return 'apt';
  if (hasBinary('pacman')) return 'pacman';
  if (hasBinary('dnf')) return 'dnf';
  if (hasBinary('zypper')) return 'zypper';
  return null;
}

/** Logische Paketnamen, die zur Laufzeit nachinstalliert werden können. */
export type LogicalPackage = 'ufw' | 'fail2ban' | 'clamav' | 'autoupdate' | 'samba' | 'docker' | 'caddy';

const NAMES: Record<LogicalPackage, Record<PkgManager, string[]>> = {
  ufw:      { apt: ['ufw'], pacman: ['ufw'], dnf: ['ufw'], zypper: ['ufw'] },
  fail2ban: { apt: ['fail2ban'], pacman: ['fail2ban'], dnf: ['fail2ban'], zypper: ['fail2ban'] },
  clamav:   { apt: ['clamav', 'clamav-daemon'], pacman: ['clamav'], dnf: ['clamav', 'clamav-update', 'clamd'], zypper: ['clamav'] },
  // Automatische Sicherheitsupdates gibt es so nur bei Debian/Ubuntu und Fedora.
  autoupdate: { apt: ['unattended-upgrades'], pacman: [], dnf: ['dnf-automatic'], zypper: [] },
  samba:    { apt: ['samba'], pacman: ['samba'], dnf: ['samba'], zypper: ['samba'] },
  docker:   { apt: ['docker.io'], pacman: ['docker'], dnf: ['moby-engine'], zypper: ['docker'] },
  caddy:    { apt: ['caddy'], pacman: ['caddy'], dnf: ['caddy'], zypper: ['caddy'] },
};

/** Echte Paketnamen für ein logisches Paket – leer, wenn es die Distribution nicht kennt. */
export function packageNames(logical: LogicalPackage, pm = detectPM()): string[] {
  if (!pm) return [];
  return NAMES[logical]?.[pm] ?? [];
}

/** Installationsbefehl für den erkannten Paketmanager. */
export function installCommand(pkgs: string[], pm = detectPM()): string | null {
  const safe = pkgs.map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, '')).filter(Boolean);
  if (!pm || safe.length === 0) return null;
  switch (pm) {
    case 'apt':
      // DEBIAN_FRONTEND muss innerhalb von bash -c gesetzt werden (sudoers-Allowlist).
      return `/bin/bash -c "DEBIAN_FRONTEND=noninteractive apt-get install -y ${safe.join(' ')}"`;
    case 'pacman':
      return `pacman -S --noconfirm --needed ${safe.join(' ')}`;
    case 'dnf':
      return `dnf install -y ${safe.join(' ')}`;
    case 'zypper':
      return `zypper --non-interactive install ${safe.join(' ')}`;
  }
}

/**
 * Ein logisches Paket installieren. Wirft, wenn die Distribution es nicht kennt
 * oder die Installation fehlschlägt.
 */
export function installLogical(logical: LogicalPackage, timeout = 300000): string {
  const pm = detectPM();
  const names = packageNames(logical, pm);
  if (!pm) throw new Error('Kein unterstützter Paketmanager gefunden.');
  if (names.length === 0) {
    throw new Error(`„${logical}" ist auf dieser Distribution (${pm}) nicht verfügbar.`);
  }
  const cmd = installCommand(names, pm);
  if (!cmd) throw new Error('Installationsbefehl konnte nicht gebildet werden.');
  return privExec(cmd, { timeout });
}

/** Ist ein Paket installiert? */
export function isInstalled(pkg: string, pm = detectPM()): boolean {
  const name = pkg.replace(/[^a-zA-Z0-9._+-]/g, '');
  if (!name || !pm) return false;
  switch (pm) {
    case 'apt':
      return safeExec(`dpkg-query -W -f='\${db:Status-Abbrev}' ${name} 2>/dev/null`).trim().startsWith('ii');
    case 'pacman':
      return safeExec(`pacman -Qq ${name} 2>/dev/null`).trim().length > 0;
    case 'dnf':
    case 'zypper':
      return safeExec(`rpm -q ${name} 2>/dev/null`).trim().length > 0 && !safeExec(`rpm -q ${name} 2>/dev/null`).includes('not installed');
  }
}

/** Ist mindestens ein Paket eines logischen Pakets installiert? */
export function isLogicalInstalled(logical: LogicalPackage): boolean {
  const names = packageNames(logical);
  return names.length > 0 && isInstalled(names[0]);
}

/** Entfernungsbefehl für den erkannten Paketmanager. */
export function removeCommand(pkgs: string[], pm = detectPM()): string | null {
  const safe = pkgs.map((p) => p.replace(/[^a-zA-Z0-9._+-]/g, '')).filter(Boolean);
  if (!pm || safe.length === 0) return null;
  switch (pm) {
    case 'apt':
      return `/bin/bash -c "DEBIAN_FRONTEND=noninteractive apt-get remove -y ${safe.join(' ')}"`;
    case 'pacman':
      // -Rs entfernt auch nicht mehr benötigte Abhängigkeiten.
      return `pacman -Rs --noconfirm ${safe.join(' ')}`;
    case 'dnf':
      return `dnf remove -y ${safe.join(' ')}`;
    case 'zypper':
      return `zypper --non-interactive remove ${safe.join(' ')}`;
  }
}
