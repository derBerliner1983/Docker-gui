import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Moon, Sun, ChevronLeft, ChevronRight, LogOut, EyeOff,
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
  const { prefs, setPref } = usePrefs();
  const order = (prefs.sidebarOrder as Record<string, string[]>) || {};
  // Vom Benutzer ausgeblendete Menüpunkte (pro Konto serverseitig gespeichert)
  const hidden = (prefs[HIDDEN_NAV_PREF] as string[]) || [];
  // Aktuell gezogener Eintrag: Abschnitt + Ziel-Pfad
  const [drag, setDrag] = useState<{ section: string; to: string } | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  // Kontextmenü (Rechtsklick auf einen Menüpunkt) → Ausblenden
  const [menu, setMenu] = useState<{ x: number; y: number; to: string; label: string } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.settings.version()
      .then((v) => { setVersion(v.current); setUpdateAvailable(v.updateAvailable); })
      .catch(() => {});
  }, []);

  // Das Menü wird erst am Mauszeiger gerendert und danach ins sichtbare Fenster
  // geschoben. Vorher ist seine Breite unbekannt – eine feste Annahme würde es
  // je nach Sprache und Textlänge abschneiden.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    const pad = 8;
    const r = el.getBoundingClientRect();
    const left = Math.max(pad, Math.min(menu.x, window.innerWidth - r.width - pad));
    const top = Math.max(pad, Math.min(menu.y, window.innerHeight - r.height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.visibility = 'visible';
  }, [menu]);

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
      items.filter((it) => !hidden.includes(it.to)),
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
              <span style={{ fontSize: 10.5, color: updateAvailable ? 'var(--color-warning)' : 'var(--color-faint)' }} title={updateAvailable ? t('sidebar.updateAvailable') : undefined}>
                v{version}{updateAvailable ? ' · Update ▲' : ''}
              </span>
            )}
          </div>
        )}
        <button className="sidebar__collapse" onClick={onToggle} title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}>
          {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>

      <nav className="sidebar__nav">
        {NAV.map((section) => {
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

      {/* Das Kontextmenü hängt bewusst am <body>: die Sidebar hat einen
          backdrop-filter (macht sie zum Bezugsrahmen für position:fixed) und
          overflow:hidden – als Kind der Sidebar würde das Menü daran
          abgeschnitten. */}
      {menu && createPortal(
        <div
          role="menu"
          ref={menuRef}
          className="card"
          style={{
            // Breite richtet sich nach dem längsten Eintrag, damit nichts
            // abgeschnitten wird; Position setzt der Layout-Effekt oben.
            position: 'fixed', left: menu.x, top: menu.y, visibility: 'hidden',
            zIndex: 900, width: 'max-content', minWidth: 200, maxWidth: 'min(320px, calc(100vw - 16px))',
            padding: 6, boxShadow: '0 8px 24px rgba(0,0,0,.35)',
          }}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div style={{
            fontSize: 11, color: 'var(--color-faint)', padding: '4px 8px 6px',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {menu.label}
          </div>
          <button
            className="btn btn--outline btn--sm"
            style={{ width: '100%', justifyContent: 'flex-start' }}
            onClick={() => hideItem(menu.to)}
          >
            <EyeOff size={13} style={{ flexShrink: 0 }} /> {tt('Menüpunkt ausblenden')}
          </button>
        </div>,
        document.body,
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
