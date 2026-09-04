import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api';

// Globaler Anwendungsname – gilt für alle Benutzer und wird vom Administrator
// in den Einstellungen gesetzt. Der Wert wird auch ohne Anmeldung geladen,
// damit die Anmeldeseite und der Browser-Titel gleich stimmen.

export const DEFAULT_APP_NAME = 'Core-Hub';
const CACHE_KEY = 'appName';

interface BrandingValue {
  appName: string;
  /** Nach dem Speichern in den Einstellungen aufrufen. */
  setAppName: (name: string) => void;
}

const BrandingContext = createContext<BrandingValue | null>(null);

function cached(): string {
  try { return localStorage.getItem(CACHE_KEY) || DEFAULT_APP_NAME; } catch { return DEFAULT_APP_NAME; }
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [appName, setName] = useState<string>(cached);

  const setAppName = useCallback((name: string) => {
    const value = name.trim() || DEFAULT_APP_NAME;
    setName(value);
    try { localStorage.setItem(CACHE_KEY, value); } catch { /* */ }
  }, []);

  useEffect(() => {
    api.settings.app()
      .then((r) => setAppName(r.appName))
      .catch(() => { /* Cache bleibt */ });
  }, [setAppName]);

  useEffect(() => { document.title = `${appName} · Linux Server Management`; }, [appName]);

  const value = useMemo(() => ({ appName, setAppName }), [appName, setAppName]);
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
