import { useState, useEffect, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';

type Theme = 'light' | 'dark';

function getStoredTheme(): Theme {
  return (localStorage.getItem('theme') as Theme) ?? 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
}

export function Layout({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar') === '1');
  const [theme, setTheme] = useState<Theme>(getStoredTheme);

  useEffect(() => { applyTheme(theme); }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  const toggleSidebar = () =>
    setCollapsed((c) => {
      localStorage.setItem('sidebar', c ? '0' : '1');
      return !c;
    });

  return (
    <div className="app-shell">
      <Sidebar collapsed={collapsed} onToggle={toggleSidebar} theme={theme} onThemeToggle={toggleTheme} />
      <div className="main-area">{children}</div>
    </div>
  );
}
