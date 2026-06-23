import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard, Container, MonitorPlay, FolderOpen, Settings,
  Users, Activity, Clock, Moon, Sun, ChevronLeft, ChevronRight, LogOut, HardDrive, RefreshCw, ShieldCheck, Network, ShieldAlert, Bug, LayoutGrid, TerminalSquare, Boxes, ArrowRightLeft, Files,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
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
    label: 'Übersicht',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/taskmanager', icon: Activity, label: 'Taskmanager' },
      { to: '/terminal', icon: TerminalSquare, label: 'Terminal' },
    ],
  },
  {
    label: 'Workloads',
    items: [
      { to: '/containers', icon: Container, label: 'Container' },
      { to: '/apps', icon: LayoutGrid, label: 'App-Vorlagen' },
      { to: '/vms', icon: MonitorPlay, label: 'Virtuelle Maschinen' },
      { to: '/networks', icon: Network, label: 'Netzwerke & VLANs' },
      { to: '/proxy', icon: ShieldCheck, label: 'HTTPS & Proxy' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/security', icon: ShieldAlert, label: 'Sicherheit' },
      { to: '/antivirus', icon: Bug, label: 'Virenschutz' },
      { to: '/updates', icon: RefreshCw, label: 'System-Updates' },
      { to: '/packages', icon: Boxes, label: 'Paketverwaltung' },
      { to: '/automation', icon: Clock, label: 'Automatisierung' },
      { to: '/backups', icon: HardDrive, label: 'Backups' },
      { to: '/migration', icon: ArrowRightLeft, label: 'Migration' },
      { to: '/files', icon: Files, label: 'Datei-Manager' },
      { to: '/shares', icon: FolderOpen, label: 'SMB-Freigaben' },
      { to: '/users', icon: Users, label: 'Benutzer' },
      { to: '/settings', icon: Settings, label: 'Einstellungen' },
    ],
  },
];

export function Sidebar({ collapsed, onToggle, theme, onThemeToggle, mobileOpen, onMobileClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [version, setVersion] = useState('');
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    api.settings.version()
      .then((v) => { setVersion(v.current); setUpdateAvailable(v.updateAvailable); })
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__logo">⬡</div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="sidebar__title">Core-Hub</span>
            {version && (
              <NavLink to="/settings" style={{ fontSize: 10.5, color: updateAvailable ? 'var(--color-warning)' : 'var(--color-faint)', textDecoration: 'none' }} title={updateAvailable ? 'Update verfügbar' : undefined}>
                v{version}{updateAvailable ? ' · Update ▲' : ''}
              </NavLink>
            )}
          </div>
        )}
        <button className="sidebar__collapse" onClick={onToggle} title={collapsed ? 'Ausklappen' : 'Einklappen'}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((section) => (
          <div className="sidebar__section" key={section.label}>
            <div className="sidebar__section-label">{section.label}</div>
            {section.items.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
                title={collapsed ? label : undefined}
                onClick={handleNavClick}
              >
                <Icon className="sidebar__item-icon" />
                <span className="sidebar__item-label">{label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar__footer">
        <div className="sidebar__avatar">{user?.username.charAt(0).toUpperCase()}</div>
        {!collapsed && <span className="sidebar__username">{user?.username}</span>}
        <button className="icon-btn" onClick={onThemeToggle} title="Theme wechseln">
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button className="icon-btn" onClick={handleLogout} title="Abmelden">
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  );
}
