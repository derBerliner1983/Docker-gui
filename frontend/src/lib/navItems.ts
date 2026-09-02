import {
  LayoutDashboard, Container, MonitorPlay, FolderOpen, Settings,
  Users, Activity, Clock, HardDrive, RefreshCw, ShieldCheck, Network, ShieldAlert,
  Bug, LayoutGrid, TerminalSquare, Boxes, Files, BrainCircuit, Orbit,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

export interface NavSection {
  labelKey: string;
  items: NavItem[];
  /** true = Abschnitt erscheint nur, wenn die zugehörige Funktion installiert ist. */
  optional?: boolean;
}

/**
 * Navigations-Struktur der Seitenleiste. Wird sowohl von der Sidebar als auch
 * von den Einstellungen (Ein-/Ausblenden von Menüpunkten) verwendet.
 */
export const NAV: NavSection[] = [
  {
    labelKey: 'nav.section.overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, labelKey: 'nav.dashboard' },
      { to: '/taskmanager', icon: Activity, labelKey: 'nav.taskmanager' },
      { to: '/terminal', icon: TerminalSquare, labelKey: 'nav.terminal' },
    ],
  },
  {
    labelKey: 'nav.section.workloads',
    items: [
      { to: '/containers', icon: Container, labelKey: 'nav.containers' },
      { to: '/apps', icon: LayoutGrid, labelKey: 'nav.apps' },
      { to: '/vms', icon: MonitorPlay, labelKey: 'nav.vms' },
      { to: '/networks', icon: Network, labelKey: 'nav.networks' },
      { to: '/proxy', icon: ShieldCheck, labelKey: 'nav.proxy' },
    ],
  },
  {
    labelKey: 'nav.section.system',
    items: [
      { to: '/security', icon: ShieldAlert, labelKey: 'nav.security' },
      { to: '/antivirus', icon: Bug, labelKey: 'nav.antivirus' },
      { to: '/updates', icon: RefreshCw, labelKey: 'nav.updates' },
      { to: '/packages', icon: Boxes, labelKey: 'nav.packages' },
      { to: '/automation', icon: Clock, labelKey: 'nav.automation' },
      { to: '/backups', icon: HardDrive, labelKey: 'nav.backups' },
      { to: '/files', icon: Files, labelKey: 'nav.files' },
      { to: '/shares', icon: FolderOpen, labelKey: 'nav.shares' },
      { to: '/users', icon: Users, labelKey: 'nav.users' },
      { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
    ],
  },
  {
    labelKey: 'nav.section.ai',
    optional: true,
    items: [
      { to: '/ki', icon: BrainCircuit, labelKey: 'nav.ai' },
      { to: '/ki/hub', icon: Orbit, labelKey: 'nav.aihub' },
    ],
  },
];

/**
 * Menüpunkte, die nicht ausgeblendet werden dürfen – sonst käme man an die
 * Einstellungen (und damit an das Wieder-Einblenden) nicht mehr heran.
 */
export const ALWAYS_VISIBLE = ['/settings'];

/** Pref-Schlüssel für die Liste der ausgeblendeten Menüpunkte. */
export const HIDDEN_NAV_PREF = 'hiddenNav';

export function canHide(to: string): boolean {
  return !ALWAYS_VISIBLE.includes(to);
}

/** Alle Menüpunkte flach – praktisch für die Einstellungen. */
export function allNavItems(): NavItem[] {
  return NAV.flatMap((s) => s.items);
}
