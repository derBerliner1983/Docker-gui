import type {
  User, Container, SystemStats, DockerImage, SystemService, UserPublic, CreateContainerData,
  ProcessInfo, CronJob, VM, AutostartUnit, PackageUpdate, Backup, BackupSource, Share, LinuxUser,
  ProxyHost, ProxyCandidate,
} from './types';

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
    processes: () => req<{ processes: ProcessInfo[]; total: number; running: number }>('/api/system/processes'),
    killProcess: (pid: number, signal: 'TERM' | 'KILL' = 'TERM') =>
      req(`/api/system/processes/${pid}/kill`, { method: 'POST', body: JSON.stringify({ signal }) }),
    autostart: () => req<{ units: AutostartUnit[] }>('/api/system/autostart'),
    updates: () => req<{ available: boolean; manager: string | null; updates: PackageUpdate[]; count: number; rebootRequired: boolean; message?: string }>('/api/system/updates'),
    checkUpdates: () => req('/api/system/updates/check', { method: 'POST' }),
    applyUpdates: (packages?: string[]) =>
      req<{ ok: boolean; output: string }>('/api/system/updates/apply', { method: 'POST', body: JSON.stringify({ packages }) }),
  },

  backups: {
    list: () => req<{ backups: Backup[]; dir: string }>('/api/backups'),
    sources: () => req<{ containers: BackupSource[] }>('/api/backups/sources'),
    backupContainer: (containerId: string, stop: boolean) =>
      req('/api/backups/container', { method: 'POST', body: JSON.stringify({ containerId, stop }) }),
    backupDirectory: (dir: string, label?: string) =>
      req('/api/backups/directory', { method: 'POST', body: JSON.stringify({ dir, label }) }),
    backupVm: (vm: string) => req('/api/backups/vm', { method: 'POST', body: JSON.stringify({ vm }) }),
    remove: (id: number) => req(`/api/backups/${id}`, { method: 'DELETE' }),
    downloadUrl: (id: number) => `/api/backups/${id}/download`,
  },

  shares: {
    list: () => req<{ available: boolean; running: boolean; shares: Share[]; message?: string }>('/api/shares'),
    create: (share: Share) => req('/api/shares', { method: 'POST', body: JSON.stringify(share) }),
    remove: (name: string) => req(`/api/shares/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    service: (action: 'start' | 'stop' | 'restart') =>
      req('/api/shares/service', { method: 'POST', body: JSON.stringify({ action }) }),
    addUser: (username: string, password: string) =>
      req('/api/shares/user', { method: 'POST', body: JSON.stringify({ username, password }) }),
  },

  linuxUsers: {
    list: (showSystem = false) => req<{ users: LinuxUser[] }>(`/api/linux-users${showSystem ? '?system=1' : ''}`),
    groups: () => req<{ groups: string[] }>('/api/linux-groups'),
    create: (data: { username: string; password?: string; groups?: string[]; sudo?: boolean }) =>
      req('/api/linux-users', { method: 'POST', body: JSON.stringify(data) }),
    setPassword: (username: string, password: string) =>
      req(`/api/linux-users/${username}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
    remove: (username: string, removeHome: boolean) =>
      req(`/api/linux-users/${username}${removeHome ? '?removeHome=1' : ''}`, { method: 'DELETE' }),
  },

  proxy: {
    list: () => req<{ available: boolean; running: boolean; caReady: boolean; hosts: ProxyHost[]; message?: string }>('/api/proxy'),
    candidates: () => req<{ candidates: ProxyCandidate[] }>('/api/proxy/candidates'),
    create: (data: { containerId?: string; name: string; hostname: string; targetHost?: string; targetPort: number; https?: boolean }) =>
      req('/api/proxy', { method: 'POST', body: JSON.stringify(data) }),
    setHttps: (id: number, https: boolean) =>
      req(`/api/proxy/${id}/https`, { method: 'POST', body: JSON.stringify({ https }) }),
    setHttpsAll: (https: boolean) =>
      req('/api/proxy/https-all', { method: 'POST', body: JSON.stringify({ https }) }),
    remove: (id: number) => req(`/api/proxy/${id}`, { method: 'DELETE' }),
    apply: () => req('/api/proxy/apply', { method: 'POST' }),
    caUrl: () => '/api/proxy/ca',
  },

  cron: {
    list: () => req<{ jobs: CronJob[]; raw: string }>('/api/cron'),
    add: (schedule: string, command: string, comment?: string) =>
      req('/api/cron', { method: 'POST', body: JSON.stringify({ schedule, command, comment }) }),
    remove: (id: number) => req(`/api/cron/${id}`, { method: 'DELETE' }),
    saveRaw: (raw: string) => req('/api/cron/raw', { method: 'PUT', body: JSON.stringify({ raw }) }),
  },

  vms: {
    list: () => req<{ available: boolean; vms: VM[]; message?: string }>('/api/vms'),
    start: (name: string) => req(`/api/vms/${name}/start`, { method: 'POST' }),
    shutdown: (name: string) => req(`/api/vms/${name}/shutdown`, { method: 'POST' }),
    stop: (name: string) => req(`/api/vms/${name}/stop`, { method: 'POST' }),
    reboot: (name: string) => req(`/api/vms/${name}/reboot`, { method: 'POST' }),
    toggleAutostart: (name: string) => req(`/api/vms/${name}/autostart`, { method: 'POST' }),
    snapshot: (name: string) => req(`/api/vms/${name}/snapshot`, { method: 'POST' }),
    remove: (name: string) => req(`/api/vms/${name}`, { method: 'DELETE' }),
    create: (data: { name: string; memory: number; vcpus: number; diskSize: number; iso?: string; osVariant?: string }) =>
      req('/api/vms/create', { method: 'POST', body: JSON.stringify(data) }),
  },

  users: {
    list: () => req<{ users: UserPublic[] }>('/api/users'),
    create: (data: { username: string; password: string; role: string }) =>
      req('/api/users', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: number) => req(`/api/users/${id}`, { method: 'DELETE' }),
  },
};
