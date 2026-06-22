import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Container, MonitorPlay, FolderOpen, Settings,
  Users, Activity, Clock, Moon, Sun, ChevronLeft, ChevronRight, LogOut, HardDrive, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
}

const NAV = [
  {
    label: 'Übersicht',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/taskmanager', icon: Activity, label: 'Taskmanager' },
    ],
  },
  {
    label: 'Workloads',
    items: [
      { to: '/containers', icon: Container, label: 'Container' },
      { to: '/vms', icon: MonitorPlay, label: 'Virtuelle Maschinen' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/updates', icon: RefreshCw, label: 'System-Updates' },
      { to: '/automation', icon: Clock, label: 'Automatisierung' },
      { to: '/backups', icon: HardDrive, label: 'Backups' },
      { to: '/shares', icon: FolderOpen, label: 'SMB-Freigaben' },
      { to: '/users', icon: Users, label: 'Benutzer' },
      { to: '/settings', icon: Settings, label: 'Einstellungen' },
    ],
  },
];

export function Sidebar({ collapsed, onToggle, theme, onThemeToggle }: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__logo">⬡</div>
        {!collapsed && <span className="sidebar__title">Core-Hub</span>}
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
