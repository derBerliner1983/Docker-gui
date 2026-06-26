import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Container, MonitorPlay, FolderOpen, Settings,
  Users, Activity, Clock, Moon, Sun, ChevronLeft, ChevronRight, LogOut, HardDrive, RefreshCw, ShieldCheck, Network, ShieldAlert, Bug, LayoutGrid, TerminalSquare, Boxes, Files, BrainCircuit,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { api } from '../../lib/api';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

const NAV = [
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
];

const ORDER_KEY = 'sidebar-order';

function loadOrder(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem(ORDER_KEY) || '{}'); }
  catch { return {}; }
}

/** Einträge eines Abschnitts nach gespeicherter Reihenfolge sortieren (Unbekanntes ans Ende). */
function orderItems<T extends { to: string }>(items: T[], saved?: string[]): T[] {
  if (!saved || saved.length === 0) return items;
  const rank = new Map(saved.map((to, i) => [to, i]));
  return [...items].sort((a, b) => {
    const ra = rank.has(a.to) ? rank.get(a.to)! : 999;
    const rb = rank.has(b.to) ? rank.get(b.to)! : 999;
    return ra - rb;
  });
}

export function Sidebar({ collapsed, onToggle, theme, onThemeToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [kiInstalled, setKiInstalled] = useState(false);
  const [order, setOrder] = useState<Record<string, string[]>>(loadOrder);
  // Aktuell gezogener Eintrag: Abschnitt + Ziel-Pfad
  const [drag, setDrag] = useState<{ section: string; to: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    api.settings.version()
      .then((v) => { setVersion(v.current); setUpdateAvailable(v.updateAvailable); })
      .catch(() => {});
    api.ki.status().then((s) => setKiInstalled(s.installed)).catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  // Drag & Drop: nur innerhalb desselben Abschnitts umsortieren
  const onDrop = (sectionKey: string, items: { to: string }[], targetTo: string) => {
    if (!drag || drag.section !== sectionKey || drag.to === targetTo) { setDrag(null); setDragOver(null); return; }
    const current = orderItems(items, order[sectionKey]).map((i) => i.to);
    const from = current.indexOf(drag.to);
    const to = current.indexOf(targetTo);
    if (from < 0 || to < 0) { setDrag(null); setDragOver(null); return; }
    current.splice(to, 0, current.splice(from, 1)[0]);
    const next = { ...order, [sectionKey]: current };
    setOrder(next);
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(next)); } catch { /* */ }
    setDrag(null); setDragOver(null);
  };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__logo">⬡</div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="sidebar__title">Core-Hub</span>
            {version && (
              <NavLink to="/settings" style={{ fontSize: 10.5, color: updateAvailable ? 'var(--color-warning)' : 'var(--color-faint)', textDecoration: 'none' }} title={updateAvailable ? t('sidebar.updateAvailable') : undefined}>
                v{version}{updateAvailable ? ' · Update ▲' : ''}
              </NavLink>
            )}
          </div>
        )}
        <button className="sidebar__collapse" onClick={onToggle} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((section) => (
          <div className="sidebar__section" key={section.labelKey}>
            <div className="sidebar__section-label">{t(section.labelKey)}</div>
            {orderItems(section.items, order[section.labelKey]).map(({ to, icon: Icon, labelKey }) => {
              const label = t(labelKey);
              const isDragging = drag?.to === to;
              const isOver = dragOver === to && drag?.section === section.labelKey && drag?.to !== to;
              return (
                <NavLink
                  key={to}
                  to={to}
                  draggable
                  onDragStart={(e) => { setDrag({ section: section.labelKey, to }); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDrag(null); setDragOver(null); }}
                  onDragOver={(e) => { if (drag?.section === section.labelKey) { e.preventDefault(); setDragOver(to); } }}
                  onDrop={(e) => { e.preventDefault(); onDrop(section.labelKey, section.items, to); }}
                  className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
                  style={{ opacity: isDragging ? 0.4 : 1, ...(isOver ? { boxShadow: 'inset 0 2px 0 var(--color-accent)' } : {}) }}
                  title={collapsed ? label : undefined}
                  onClick={handleNavClick}
                >
                  <Icon className="sidebar__item-icon" />
                  <span className="sidebar__item-label">{label}</span>
                </NavLink>
              );
            })}
          </div>
        ))}
        {kiInstalled && (
          <div className="sidebar__section">
            <div className="sidebar__section-label">{t('nav.section.ai')}</div>
            <NavLink
              to="/ki"
              className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
              title={collapsed ? t('nav.ai') : undefined}
              onClick={handleNavClick}
            >
              <BrainCircuit className="sidebar__item-icon" />
              <span className="sidebar__item-label">{t('nav.ai')}</span>
            </NavLink>
          </div>
        )}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__avatar">{user?.username.charAt(0).toUpperCase()}</div>
        {!collapsed && <span className="sidebar__username">{user?.username}</span>}
        <button className="icon-btn" onClick={onThemeToggle} title={t('sidebar.toggleTheme')}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="icon-btn" onClick={handleLogout} title={t('sidebar.logout')}>
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
