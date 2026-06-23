import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from './api';
import type { User } from './types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, token?: string) => Promise<{ totpRequired: boolean }>;
  logout: () => Promise<void>;
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

  const logout = async () => {
    await api.auth.logout().catch(() => {});
    localStorage.removeItem('token');
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
