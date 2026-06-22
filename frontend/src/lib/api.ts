import type { User, Container, SystemStats, DockerImage, SystemService, UserPublic, CreateContainerData } from './types';

const getToken = () => localStorage.getItem('token');

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      req<{ user: User; token: string }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
    logout: () => req('/api/auth/logout', { method: 'POST' }),
    me: () => req<{ user: User }>('/api/auth/me'),
    changePassword: (currentPassword: string, newPassword: string) =>
      req('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  },

  containers: {
    list: () => req<{ containers: Container[] }>('/api/containers'),
    get: (id: string) => req<{ container: unknown }>(`/api/containers/${id}`),
    start: (id: string) => req(`/api/containers/${id}/start`, { method: 'POST' }),
    stop: (id: string) => req(`/api/containers/${id}/stop`, { method: 'POST' }),
    restart: (id: string) => req(`/api/containers/${id}/restart`, { method: 'POST' }),
    remove: (id: string) => req(`/api/containers/${id}`, { method: 'DELETE' }),
    logs: (id: string, tail = 200) => req<{ logs: string[] }>(`/api/containers/${id}/logs?tail=${tail}`),
    stats: (id: string) =>
      req<{ cpu: number; memory: { used: number; limit: number; percent: number } }>(`/api/containers/${id}/stats`),
    create: (data: CreateContainerData) =>
      req<{ id: string }>('/api/containers/create', { method: 'POST', body: JSON.stringify(data) }),
    pull: (id: string) => req(`/api/containers/${id}/pull`, { method: 'POST' }),
    setCategory: (id: string, category: string) =>
      req(`/api/containers/${id}/category`, { method: 'POST', body: JSON.stringify({ category }) }),
  },

  images: {
    list: () => req<{ images: DockerImage[] }>('/api/images'),
  },

  system: {
    stats: () => req<SystemStats>('/api/system/stats'),
    dockerVersion: () => req<{ version: string }>('/api/system/docker-version'),
    services: () => req<{ services: SystemService[] }>('/api/system/services'),
    controlService: (service: string, action: string) =>
      req('/api/system/services/control', { method: 'POST', body: JSON.stringify({ service, action }) }),
  },

  users: {
    list: () => req<{ users: UserPublic[] }>('/api/users'),
    create: (data: { username: string; password: string; role: string }) =>
      req('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) => req(`/api/users/${id}`, { method: 'DELETE' }),
  },
};
