import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

// Die automatische Abmeldung bei Inaktivität liegt in ./prefsSync – dort ist
// die pro Konto einstellbare Abmeldezeit verfügbar.

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, token?: string) => Promise<{ totpRequired: boolean }>;
  logout: () => Promise<void>;
  /** Benutzerdaten neu vom Server holen (z.B. nach Änderung des Anzeigenamens). */
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.me()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const refreshUser = useCallback(async () => {
    try { const { user } = await api.auth.me(); setUser(user); } catch { /* Sitzung bleibt wie sie ist */ }
  }, []);

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem('token');
    setUser(null);
  }, []);

  const login = async (username: string, password: string, token?: string) => {
    const res = await api.auth.login(username, password, token);
    if (res.totpRequired) return { totpRequired: true };
    if (res.user && res.token) {
      localStorage.setItem('token', res.token);
      setUser(res.user);
      return { totpRequired: false };
    }
    throw new Error('Anmeldung fehlgeschlagen');
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refreshUser }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
