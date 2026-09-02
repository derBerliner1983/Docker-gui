import { hasBinary, safeExec, privExec, describeExecError } from './privilege';
import {
  detectPM, packageNames, installCommand, removeCommand,
  isLogicalInstalled, type LogicalPackage,
} from './pkgmgr';

/**
 * Optionale System-Komponenten.
 *
 * Core-Hub bringt Oberflächen für Dienste mit, die nicht jeder braucht.
 * Wer sein System schlank halten will, soll eine Komponente samt Paket
 * entfernen können – und dann sollen auch alle Oberflächenteile verschwinden,
 * die sie voraussetzen, egal wo sie liegen (Menüpunkt, Panel, Unterseite).
 *
 * Deshalb steht hier zu jeder Komponente, welche Bereiche von ihr abhängen.
 * Das Frontend blendet sie anhand dieser Angaben aus und kann vor dem
 * Entfernen zeigen, was betroffen ist.
 */

export interface ComponentDef {
  id: string;
  name: string;
  /** Was die Komponente leistet – wird im Warnhinweis gezeigt. */
  description: string;
  /** Logisches Paket für den Paketmanager. */
  pkg: LogicalPackage;
  /** Programm, an dem sich „installiert" erkennen lässt. */
  binary: string;
  /** systemd-Units, die beim Entfernen gestoppt werden. */
  services: string[];
  /** Navigationspfade, die ohne diese Komponente verschwinden. */
  routes: string[];
  /**
   * Panels, die davon abhängen – als „seite:panel", weil Panel-Kennungen
   * für sich genommen nicht eindeutig sind („status" gibt es mehrfach).
   */
  panels: string[];
}

export const COMPONENTS: ComponentDef[] = [
  {
    id: 'docker',
    name: 'Docker',
    description: 'Container verwalten, App-Vorlagen, Container-Updates',
    pkg: 'docker', binary: 'docker', services: ['docker'],
    routes: ['/containers', '/apps'],
    panels: [],
  },
  {
    id: 'libvirt',
    name: 'Virtualisierung (KVM/libvirt)',
    description: 'Virtuelle Maschinen und VM-Netzwerke',
    pkg: 'libvirt', binary: 'virsh', services: ['libvirtd'],
    routes: ['/vms'],
    panels: [],
  },
  {
    id: 'samba',
    name: 'Samba (SMB-Freigaben)',
    description: 'Dateifreigaben im Netzwerk',
    pkg: 'samba', binary: 'smbd', services: ['smbd', 'nmbd', 'smb', 'nmb'],
    routes: ['/shares'],
    panels: [],
  },
  {
    id: 'caddy',
    name: 'Reverse-Proxy (Caddy)',
    description: 'HTTPS-Weiterleitung und Proxy für Container',
    pkg: 'caddy', binary: 'caddy', services: ['caddy'],
    routes: ['/proxy'],
    panels: ['settings:proxy'],
  },
  {
    id: 'clamav',
    name: 'Virenschutz (ClamAV)',
    description: 'Dateien auf Schadsoftware prüfen',
    pkg: 'clamav', binary: 'clamscan', services: ['clamav-daemon', 'clamav-freshclam'],
    routes: ['/antivirus'],
    panels: ['antivirus:status', 'antivirus:scan'],
  },
  {
    id: 'ufw',
    name: 'Firewall (UFW)',
    description: 'Firewall-Regeln der Sicherheitsseite',
    pkg: 'ufw', binary: 'ufw', services: [],
    routes: [],
    panels: [],
  },
  {
    id: 'fail2ban',
    name: 'fail2ban',
    description: 'Sperrt Adressen nach fehlgeschlagenen Anmeldungen',
    pkg: 'fail2ban', binary: 'fail2ban-client', services: ['fail2ban'],
    routes: [],
    panels: [],
  },
];

export interface ComponentStatus extends ComponentDef {
  installed: boolean;
  /** Läuft mindestens einer der Dienste? */
  active: boolean;
  /** Tatsächliche Paketnamen dieser Distribution (leer = hier nicht verfügbar). */
  packages: string[];
}

function serviceActive(units: string[]): boolean {
  return units.some((u) => safeExec(`systemctl is-active ${u} 2>/dev/null`).trim() === 'active');
}

export function listComponents(): ComponentStatus[] {
  return COMPONENTS.map((c) => ({
    ...c,
    installed: hasBinary(c.binary) || isLogicalInstalled(c.pkg),
    active: serviceActive(c.services),
    packages: packageNames(c.pkg),
  }));
}

export function getComponent(id: string): ComponentDef | undefined {
  return COMPONENTS.find((c) => c.id === id);
}

/**
 * Komponente entfernen: Dienste stoppen und abschalten, optional das Paket
 * deinstallieren. Gibt die einzelnen Schritte zurück, damit sichtbar ist,
 * was tatsächlich passiert ist.
 */
export function uninstallComponent(id: string, purge: boolean): string[] {
  const c = getComponent(id);
  if (!c) throw new Error(`Unbekannte Komponente: ${id}`);
  const steps: string[] = [];

  for (const unit of c.services) {
    if (safeExec(`systemctl is-active ${unit} 2>/dev/null`).trim() === 'active') {
      try { privExec(`systemctl stop ${unit}`, { timeout: 25000 }); steps.push(`${unit} gestoppt`); }
      catch (e) { steps.push(`${unit} konnte nicht gestoppt werden: ${describeExecError(e)}`); }
    }
    if (safeExec(`systemctl is-enabled ${unit} 2>/dev/null`).trim() === 'enabled') {
      try { privExec(`systemctl disable ${unit}`, { timeout: 25000 }); steps.push(`${unit} aus dem Autostart entfernt`); }
      catch { /* nicht kritisch */ }
    }
  }

  if (purge) {
    const pkgs = packageNames(c.pkg);
    if (pkgs.length === 0) throw new Error(`„${c.name}" ist auf dieser Distribution nicht als Paket bekannt.`);
    const cmd = removeCommand(pkgs);
    if (!cmd) throw new Error('Kein Entfernungsbefehl für diesen Paketmanager.');
    privExec(cmd, { timeout: 600000 });
    steps.push(`Paket entfernt: ${pkgs.join(', ')}`);
  }
  return steps;
}

/** Komponente (wieder) installieren und starten. */
export function installComponent(id: string): string[] {
  const c = getComponent(id);
  if (!c) throw new Error(`Unbekannte Komponente: ${id}`);
  const pkgs = packageNames(c.pkg);
  if (pkgs.length === 0) throw new Error(`„${c.name}" ist auf dieser Distribution nicht verfügbar (${detectPM() ?? 'kein Paketmanager'}).`);
  const cmd = installCommand(pkgs);
  if (!cmd) throw new Error('Kein Installationsbefehl für diesen Paketmanager.');
  const steps: string[] = [];
  privExec(cmd, { timeout: 900000 });
  steps.push(`Paket installiert: ${pkgs.join(', ')}`);
  // Ersten vorhandenen Dienst aktivieren – Unit-Namen unterscheiden sich je Distribution.
  for (const unit of c.services) {
    if (safeExec(`systemctl list-unit-files 2>/dev/null | grep -c "^${unit}\\.service"`).trim() !== '0') {
      try { privExec(`systemctl enable --now ${unit}`, { timeout: 30000 }); steps.push(`${unit} gestartet`); break; }
      catch { /* weiter zum nächsten Kandidaten */ }
    }
  }
  return steps;
}
