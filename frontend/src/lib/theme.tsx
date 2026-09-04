import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePrefs } from './prefs';

// Farbschema: „system" folgt der Einstellung des Betriebssystems, sonst gilt
// die feste Wahl. Gespeichert wird pro Benutzerkonto (Server) – localStorage
// dient nur als Sofort-Cache, damit beim Laden nichts aufblitzt.

export type ThemeMode = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'themeMode';
export const THEME_PREF = 'themeMode';

function isMode(v: unknown): v is ThemeMode {
  return v === 'light' || v === 'dark' || v === 'system';
}

function storedMode(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (isMode(raw)) return raw;
  // Altbestand: früher wurde nur 'light'/'dark' unter 'theme' gespeichert
  const legacy = localStorage.getItem('theme');
  return isMode(legacy) ? legacy : 'system';
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

interface ThemeContextValue {
  /** Die gewählte Einstellung (inkl. „system"). */
  mode: ThemeMode;
  /** Das tatsächlich angezeigte Farbschema. */
  theme: Theme;
  setMode: (m: ThemeMode) => void;
  /** Schnellumschalter in der Seitenleiste: hell ↔ dunkel. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { prefs, setPref, loaded } = usePrefs();
  const [mode, setModeState] = useState<ThemeMode>(storedMode);
  const [sys, setSys] = useState<Theme>(systemTheme);

  // Server-Einstellung übernimmt, sobald die Einstellungen geladen sind
  useEffect(() => {
    if (!loaded) return;
    const fromServer = prefs[THEME_PREF];
    if (isMode(fromServer) && fromServer !== mode) {
      setModeState(fromServer);
      try { localStorage.setItem(STORAGE_KEY, fromServer); } catch { /* */ }
    }
    // mode bewusst nicht in den Abhängigkeiten: sonst würde eine lokale
    // Änderung sofort wieder vom (noch alten) Serverwert überschrieben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, prefs[THEME_PREF]]);

  // Systemwechsel (z.B. Nachtmodus des Betriebssystems) live mitnehmen
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSys(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const theme: Theme = mode === 'system' ? sys : mode;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY, m); } catch { /* */ }
    setPref(THEME_PREF, m);
  }, [setPref]);

  const toggle = useCallback(() => {
    setMode(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setMode]);

  const value = useMemo(() => ({ mode, theme, setMode, toggle }), [mode, theme, setMode, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
