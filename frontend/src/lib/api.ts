import type {
  User, SystemStats, VersionInfo, HardwareInfo, OptimizeSuggestion, TerminalInfo,
  UpdateSource, UpdateVersion, UpdateNotes,
} from './types';

import { tt } from './i18n';

const getToken = () => localStorage.getItem('token');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...((init?.headers as Record<string, string>) ?? {}),
  };
  // Content-Type nur setzen, wenn ein Body mitgeschickt wird – sonst lehnt
  // Fastify einen leeren JSON-Body mit 400 "Bad Request" ab.
  if (init?.body != null) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; errorKey?: string; errorVars?: Record<string, string | number> };
    const rawMsg = body.error ?? `HTTP ${res.status}`;
    // Übersetzte Meldung: bevorzugt strukturierter Schlüssel + Variablen
    // (dynamische Texte), sonst der deutsche Quelltext als Schlüssel.
    // Fallback bleibt immer der deutsche Originaltext.
    const msg = body.errorKey ? tt(body.errorKey, body.errorVars) : tt(rawMsg);
    const err = new Error(msg) as Error & { data?: unknown; status?: number; raw?: string };
    err.raw = rawMsg;         // Originaltext (z.B. für substring-Prüfungen)
    err.data = body;          // Zusatzdaten (z.B. Port-Konflikt-Vorschläge) erhalten
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (username: string, password: string, token?: string) =>
      req<{ user?: User; token?: string; totpRequired?: boolean }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password, token }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }),
    me: () => req<{ user: User }>('/api/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      req('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
    updateProfile: (displayName: string) =>
      req<{ ok: boolean; displayName: string }>('/api/auth/profile', { method: 'PUT', body: JSON.stringify({ displayName }) }),
    twoFactor: {
      status: () => req<{ enabled: boolean }>('/api/auth/2fa/status'),
      setup: () => req<{ secret: string; otpauth: string }>('/api/auth/2fa/setup', { method: 'POST' }),
      enable: (token: string) => req('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) }),
      disable: (password: string) => req('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) }),
    },
  },

  terminal: {
    info: () => req<TerminalInfo>('/api/terminal/info'),
  },

  system: {
    stats: () => req<SystemStats>('/api/system/stats'),
    dockerVersion: () => req<{ version: string }>('/api/system/docker-version'),
    hardware: () => req<HardwareInfo>('/api/system/hardware'),
    optimize: () => req<{ suggestions: OptimizeSuggestion[] }>('/api/system/optimize'),
  },

  settings: {
    info: () => req<{ version: string; hostname: string; platform: string; dataDir: string; node: string; uptime: number; features: Record<string, boolean> }>('/api/settings/info'),
    version: (refresh = false) => req<VersionInfo>(`/api/settings/version${refresh ? '?refresh=1' : ''}`),
    /** Globaler Anwendungsname – auch ohne Anmeldung lesbar. */
    app: () => req<{ appName: string; defaultAppName: string }>('/api/settings/app'),
    updateApp: (appName: string) =>
      req<{ ok: boolean; appName: string }>('/api/settings/app', { method: 'PUT', body: JSON.stringify({ appName }) }),

    // ── Update-Quelle (Git-Repository) und auswählbare Stände ──
    updateSource: () => req<UpdateSource>('/api/settings/update-source'),
    saveUpdateSource: (body: {
      url: string; branch: string; visibility: 'public' | 'private';
      authType: 'token' | 'password'; username: string; secret?: string;
    }) => req<{ ok: boolean; source: UpdateSource }>('/api/settings/update-source', { method: 'PUT', body: JSON.stringify(body) }),
    testUpdateSource: () => req<{ ok: boolean; url: string; branches: string[]; count: number }>('/api/settings/update-source/test', { method: 'POST' }),
    updateVersions: (refresh = false) =>
      req<{ available: boolean; versions: UpdateVersion[]; current: string; branch?: string; error?: string }>(
        `/api/settings/update/versions${refresh ? '?refresh=1' : ''}`,
      ),
    updateNotes: (ref = '') =>
      req<UpdateNotes>(`/api/settings/update/notes${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`),
  },

  prefs: {
    get: () => req<{ prefs: Record<string, unknown> }>('/api/prefs'),
    update: (prefs: Record<string, unknown>) =>
      req<{ ok: boolean; prefs: Record<string, unknown> }>('/api/prefs', { method: 'PUT', body: JSON.stringify({ prefs }) }),
  },
};
