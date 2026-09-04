import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { LayoutContext } from '../../lib/layoutContext';
import { useTheme } from '../../lib/theme';

function isMobile() {
  return window.innerWidth < 768;
}

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === '1');
  const [mobileOpen, setMobileOpen] = useState(false);
  // Farbschema (hell/dunkel/System) liegt im ThemeProvider – die Einstellung
  // gehört zum Benutzerkonto und wird auch im Benutzer-Panel gesetzt.
  const { theme, toggle: toggleTheme } = useTheme();

  // Close mobile sidebar on route changes / resize to desktop
  useEffect(() => {
    const onResize = () => { if (!isMobile()) setMobileOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const toggleSidebar = () => {
    if (isMobile()) {
      setMobileOpen((o) => !o);
    } else {
      setCollapsed((c) => {
        localStorage.setItem('sidebar', c ? '0' : '1');
        return !c;
      });
    }
  };
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const openMobileMenu = useCallback(() => setMobileOpen(true), []);

  // Bearbeiten-Modus der Panels liegt hier, damit ihn die Topbar anbieten kann
  // (der Bleistift gehört nach oben, nicht über die Panel-Liste).
  const [editLayout, setEditLayout] = useState(false);
  const [hasPanels, setHasPanels] = useState(false);
  const registerPanels = useCallback((present: boolean) => {
    setHasPanels(present);
    if (!present) setEditLayout(false);   // Seitenwechsel beendet den Modus
  }, []);

  const ctx = useMemo(
    () => ({ openMobileMenu, editLayout, setEditLayout, registerPanels, hasPanels }),
    [openMobileMenu, editLayout, registerPanels, hasPanels],
  );

  return (
    <LayoutContext.Provider value={ctx}>
      <div className="app-shell">
        {mobileOpen && <div className="sidebar-backdrop" onClick={closeMobile} />}
        <Sidebar
          collapsed={collapsed}
          onToggle={toggleSidebar}
          theme={theme}
          onThemeToggle={toggleTheme}
          mobileOpen={mobileOpen}
          onMobileClose={closeMobile}
        />
        <div className="main-area">{children}</div>
      </div>
    </LayoutContext.Provider>
  );
}
