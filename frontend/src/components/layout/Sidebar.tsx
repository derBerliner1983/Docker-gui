import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  Moon, Sun, ChevronLeft, ChevronRight, LogOut, EyeOff, Settings as SettingsIcon,
} from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useT, tt } from '../../lib/i18n';
import { usePrefs } from '../../lib/prefs';
import { api } from '../../lib/api';
import { NAV, HIDDEN_NAV_PREF, canHide } from '../../lib/navItems';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
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
  const [proxyVisible, setProxyVisible] = useState(false);
  const { prefs, setPref } = usePrefs();
  const order = (prefs.sidebarOrder as Record<string, string[]>) || {};
  // Vom Benutzer ausgeblendete Menüpunkte (pro Konto serverseitig gespeichert)
  const hidden = (prefs[HIDDEN_NAV_PREF] as string[]) || [];
  // Aktuell gezogener Eintrag: Abschnitt + Ziel-Pfad
  const [drag, setDrag] = useState<{ section: string; to: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Kontextmenü (Rechtsklick auf einen Menüpunkt) → Ausblenden
  const [menu, setMenu] = useState<{ x: number; y: number; to: string; label: string } | null>(null);

  useEffect(() => {
    api.settings.version()
      .then((v) => { setVersion(v.current); setUpdateAvailable(v.updateAvailable); })
      .catch(() => {});
    api.ki.status().then((s) => setKiInstalled(s.installed)).catch(() => {});
    api.settings.getProxyVisibility().then((p) => setProxyVisible(p.enabled)).catch(() => {});
  }, []);

  // Kontextmenü schließen, sobald irgendwo geklickt / gescrollt / ESC gedrückt wird
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const handleNavClick = () => { if (onMobileClose) onMobileClose(); };

  /** Menüpunkt ausblenden – wieder einblenden geht in den Einstellungen. */
  const hideItem = (to: string) => {
    if (!canHide(to)) return;
    if (hidden.includes(to)) return;
    setPref(HIDDEN_NAV_PREF, [...hidden, to]);
    setMenu(null);
  };

  // Drag & Drop: nur innerhalb desselben Abschnitts umsortieren
  const onDrop = (sectionKey: string, items: { to: string }[], targetTo: string) => {
    if (!drag || drag.section !== sectionKey || drag.to === targetTo) { setDrag(null); setDragOver(null); return; }
    const current = orderItems(items, order[sectionKey]).map((i) => i.to);
    const from = current.indexOf(drag.to);
    const to = current.indexOf(targetTo);
    if (from < 0 || to < 0) { setDrag(null); setDragOver(null); return; }
    current.splice(to, 0, current.splice(from, 1)[0]);
    setPref('sidebarOrder', { ...order, [sectionKey]: current });   // pro-Benutzer serverseitig
    setDrag(null); setDragOver(null);
  };

  /** Abschnitt sichtbar? KI-Bereich nur bei installiertem Ollama, Proxy nur wenn aktiviert. */
  const visibleItems = (sectionKey: string, items: typeof NAV[number]['items']) =>
    orderItems(
      items.filter((it) => (it.to !== '/proxy' || proxyVisible) && !hidden.includes(it.to)),
      order[sectionKey],
    );

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`}>
      <div className="sidebar__header">
        <div className="sidebar__logo">⬡</div>
        {!collapsed && (
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span className="sidebar__title">{tt('Core-Hub')}</span>
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
        {NAV.map((section) => {
          // Der KI-Abschnitt erscheint nur, wenn die KI-Umgebung installiert ist.
          if (section.optional && section.labelKey === 'nav.section.ai' && !kiInstalled) return null;
          const items = visibleItems(section.labelKey, section.items);
          if (items.length === 0) return null;
          return (
            <div className="sidebar__section" key={section.labelKey}>
              <div className="sidebar__section-label">{t(section.labelKey)}</div>
              {items.map(({ to, icon: Icon, labelKey }) => {
                const label = t(labelKey);
                const isDragging = drag?.to === to;
                const isOver = dragOver === to && drag?.section === section.labelKey && drag?.to !== to;
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={to === '/ki'}
                    draggable
                    onDragStart={(e) => { setDrag({ section: section.labelKey, to }); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDrag(null); setDragOver(null); }}
                    onDragOver={(e) => { if (drag?.section === section.labelKey) { e.preventDefault(); setDragOver(to); } }}
                    onDrop={(e) => { e.preventDefault(); onDrop(section.labelKey, section.items, to); }}
                    onContextMenu={(e) => {
                      // Rechtsklick direkt auf dem Link: Menüpunkt ausblenden anbieten
                      if (!canHide(to)) return;
                      e.preventDefault();
                      setMenu({ x: e.clientX, y: e.clientY, to, label });
                    }}
                    className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
                    style={{ opacity: isDragging ? 0.4 : 1, ...(isOver ? { boxShadow: 'inset 0 2px 0 var(--color-accent)' } : {}) }}
                    title={collapsed ? label : t('sidebar.hideHint')}
                    onClick={handleNavClick}
                  >
                    <Icon className="sidebar__item-icon" />
                    <span className="sidebar__item-label">{label}</span>
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      {menu && (
        <div
          role="menu"
          className="card"
          style={{
            position: 'fixed', left: Math.min(menu.x, window.innerWidth - 240), top: Math.min(menu.y, window.innerHeight - 110),
            zIndex: 900, minWidth: 220, padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{ fontSize: 11, color: 'var(--color-faint)', padding: '4px 8px 6px' }}>{menu.label}</div>
          <button
            className="btn btn--outline btn--sm"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => hideItem(menu.to)}
          >
            <EyeOff size={13} /> {tt('Menüpunkt ausblenden')}
          </button>
          <button
            className="btn btn--outline btn--sm"
            style={{ width: '100%', justifyContent: 'flex-start', marginTop: 6 }}
            onClick={() => { setMenu(null); navigate('/settings'); handleNavClick(); }}
          >
            <SettingsIcon size={13} /> {tt('Menü in Einstellungen verwalten')}
          </button>
        </div>
      )}

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
