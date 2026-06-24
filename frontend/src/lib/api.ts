import type {
  User, Container, SystemStats, DockerImage, SystemService, UserPublic, CreateContainerData,
  ProcessInfo, CronJob, VM, AutostartUnit, PackageUpdate, Backup, BackupSource, Share, LinuxUser,
  ProxyHost, ProxyCandidate, DockerNetwork, HostInterface, FirewallRule, FirewallDisabledRule, FirewallLogEntry, SecurityScan, SshStatus, VmNetwork,
  AntivirusStatus, BackupSchedule, AppTemplate, NotificationItem, NotificationConfig, VersionInfo,
  OptimizeSuggestion, SmtpConfig, AlertRule, PredefinedAlert, AlertMetric,
  InstalledPackage, PackageSearchResult,
  StoreSearchResult, StoreStatus, OllamaStatus, OllamaModel,
} from './types';

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
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
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
    twoFactor: {
      status: () => req<{ enabled: boolean }>('/api/auth/2fa/status'),
      setup: () => req<{ secret: string; otpauth: string }>('/api/auth/2fa/setup', { method: 'POST' }),
      enable: (token: string) => req('/api/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) }),
      disable: (password: string) => req('/api/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ password }) }),
    },
  },

  containers: {
    list: () => req<{ containers: Container[] }>('/api/containers'),
    get: (id: string) => req<{ container: unknown }>(`/api/containers/${id}`),
    start: (id: string) => req(`/api/containers/${id}/start`, { method: 'POST' }),
    stop: (id: string) => req(`/api/containers/${id}/stop`, { method: 'POST' }),
    restart: (id: string) => req(`/api/containers/${id}/restart`, { method: 'POST' }),
    remove: (id: string) => req(`/api/containers/${id}`, { method: 'DELETE' }),
    logs: (id: string, tail = 200) => req<{ logs: string[] }>(`/api/containers/${id}/logs?tail=${tail}`),
    logsSince: (id: string, since: number) => req<{ logs: string[] }>(`/api/containers/${id}/logs?tail=200&since=${since}`),
    stats: (id: string) =>
      req<{ cpu: number; memory: { used: number; limit: number; percent: number } }>(`/api/containers/${id}/stats`),
    create: (data: CreateContainerData) =>
      req<{ id: string }>('/api/containers/create', { method: 'POST', body: JSON.stringify(data) }),
    recreate: (id: string, data: {
      name?: string; image: string;
      ports?: { host: number; container: number; proto?: string }[];
      env?: string[]; volumes?: string[]; restart?: string; category?: string;
    }) => req<{ ok: boolean; id: string }>(`/api/containers/${id}/recreate`, { method: 'POST', body: JSON.stringify(data) }),
    pull: (id: string) => req(`/api/containers/${id}/pull`, { method: 'POST' }),
    setCategory: (id: string, category: string) =>
      req(`/api/containers/${id}/category`, { method: 'POST', body: JSON.stringify({ category }) }),
    setIcon: (id: string, icon: string) =>
      req(`/api/containers/${id}/icon`, { method: 'POST', body: JSON.stringify({ icon }) }),
    updates: () => req<{ updates: Record<string, { hasUpdate: boolean | null; image: string }> }>('/api/containers/updates'),
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
    optimize: () => req<{ suggestions: OptimizeSuggestion[]; checkedAt: string }>('/api/system/optimize'),
  },

  packages: {
    list: () => req<{ available: boolean; manager: string | null; packages: InstalledPackage[]; count: number }>('/api/system/packages'),
    search: (q: string) => req<{ results: PackageSearchResult[] }>(`/api/system/packages/search?q=${encodeURIComponent(q)}`),
    install: (packages: string[]) =>
      req<{ ok: boolean; output: string }>('/api/system/packages/install', { method: 'POST', body: JSON.stringify({ packages }) }),
    remove: (packages: string[], purge = false) =>
      req<{ ok: boolean; output: string }>('/api/system/packages/remove', { method: 'POST', body: JSON.stringify({ packages, purge }) }),
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
    schedules: () => req<{ schedules: BackupSchedule[] }>('/api/backups/schedules'),
    createSchedule: (data: { type: string; source: string; label?: string; schedule: string; retention?: number; stop?: boolean }) =>
      req('/api/backups/schedules', { method: 'POST', body: JSON.stringify(data) }),
    toggleSchedule: (id: number, enabled: boolean) =>
      req(`/api/backups/schedules/${id}/toggle`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    runSchedule: (id: number) => req<{ ok: boolean; file: string }>(`/api/backups/schedules/${id}/run`, { method: 'POST' }),
    removeSchedule: (id: number) => req(`/api/backups/schedules/${id}`, { method: 'DELETE' }),
  },

  appTemplates: {
    list: () => req<{ templates: AppTemplate[] }>('/api/app-templates'),
    install: (id: string, data: { name?: string; env?: Record<string, string>; ports?: Record<string, number> }) =>
      req<{ ok: boolean; id: string; name: string }>(`/api/app-templates/${id}/install`, { method: 'POST', body: JSON.stringify(data) }),
  },

  store: {
    status: () => req<StoreStatus>('/api/app-templates/store/status'),
    warm: () => req<{ ok: boolean }>('/api/app-templates/store/warm', { method: 'POST' }),
    search: (q: string, source: 'unraid' | 'dockerhub', page = 1, category = '') =>
      req<StoreSearchResult>(
        `/api/app-templates/store/search?q=${encodeURIComponent(q)}&source=${source}&page=${page}` +
        (category ? `&category=${encodeURIComponent(category)}` : ''),
      ),
    install: (data: {
      name?: string; image: string;
      ports?: { container: number; host: number; proto?: string }[];
      volumes?: { name: string; path: string }[];
      env?: Record<string, string>;
      restart?: string; templateId?: string; category?: string; icon?: string;
    }) => req<{ ok: boolean; id: string; name: string }>('/api/app-templates/store/install', { method: 'POST', body: JSON.stringify(data) }),
  },

  notifications: {
    list: () => req<{ notifications: NotificationItem[]; unread: number; config: NotificationConfig }>('/api/notifications'),
    markRead: () => req('/api/notifications/read', { method: 'POST' }),
    clear: () => req('/api/notifications', { method: 'DELETE' }),
    saveConfig: (config: NotificationConfig) => req('/api/notifications/config', { method: 'POST', body: JSON.stringify(config) }),
    test: () => req('/api/notifications/test', { method: 'POST' }),
    saveSmtp: (data: SmtpConfig) => req('/api/notifications/smtp', { method: 'POST', body: JSON.stringify(data) }),
    testSmtp: (to?: string) => req('/api/notifications/smtp/test', { method: 'POST', body: JSON.stringify({ to }) }),
  },

  alerts: {
    list: () => req<{ rules: AlertRule[]; predefined: PredefinedAlert[]; metrics: AlertMetric[] }>('/api/alerts'),
    create: (data: { name?: string; kind: 'predefined' | 'metric'; ruleKey?: string; metric?: string; threshold?: number; durationMin?: number; recipients?: string }) =>
      req('/api/alerts', { method: 'POST', body: JSON.stringify(data) }),
    toggle: (id: number, enabled: boolean) =>
      req(`/api/alerts/${id}/enabled`, { method: 'POST', body: JSON.stringify({ enabled }) }),
    remove: (id: number) => req(`/api/alerts/${id}`, { method: 'DELETE' }),
    test: (id: number) => req(`/api/alerts/${id}/test`, { method: 'POST' }),
    checkNow: () => req('/api/alerts/check', { method: 'POST' }),
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

  networks: {
    list: () => req<{ networks: DockerNetwork[] }>('/api/networks'),
    interfaces: () => req<{ interfaces: HostInterface[] }>('/api/networks/interfaces'),
    create: (data: { name: string; driver?: string; subnet?: string; gateway?: string; parent?: string; vlan?: string; internal?: boolean }) =>
      req('/api/networks', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id: string) => req(`/api/networks/${id}`, { method: 'DELETE' }),
    connect: (id: string, container: string, ip?: string, aliases?: string[]) =>
      req(`/api/networks/${id}/connect`, { method: 'POST', body: JSON.stringify({ container, ip, aliases }) }),
    disconnect: (id: string, container: string) =>
      req(`/api/networks/${id}/disconnect`, { method: 'POST', body: JSON.stringify({ container }) }),
  },

  security: {
    scan: () => req<SecurityScan>('/api/security/scan'),
    ssh: () => req<SshStatus>('/api/security/ssh'),
    sshControl: (action: 'start' | 'stop' | 'enable' | 'disable') =>
      req('/api/security/ssh', { method: 'POST', body: JSON.stringify({ action }) }),
    fix: (action: string) => req<{ ok: boolean; output: string }>('/api/security/action', { method: 'POST', body: JSON.stringify({ action }) }),
  },

  antivirus: {
    status: () => req<AntivirusStatus>('/api/antivirus'),
    install: () => req('/api/antivirus/install', { method: 'POST' }),
    update: () => req<{ ok: boolean; defsAgeDays: number | null }>('/api/antivirus/update', { method: 'POST' }),
    scan: (path: string, exclude?: string) => req('/api/antivirus/scan', { method: 'POST', body: JSON.stringify({ path, exclude }) }),
    daemon: (service: 'daemon' | 'freshclam', enable: boolean) =>
      req('/api/antivirus/daemon', { method: 'POST', body: JSON.stringify({ service, enable }) }),
  },

  vmNetworks: {
    list: () => req<{ available: boolean; networks: VmNetwork[]; message?: string }>('/api/vm-networks'),
    create: (data: { name: string; mode?: string; subnet?: string; bridge?: string; vlan?: string }) =>
      req('/api/vm-networks', { method: 'POST', body: JSON.stringify(data) }),
    start: (name: string) => req(`/api/vm-networks/${name}/start`, { method: 'POST' }),
    stop: (name: string) => req(`/api/vm-networks/${name}/stop`, { method: 'POST' }),
    autostart: (name: string) => req(`/api/vm-networks/${name}/autostart`, { method: 'POST' }),
    remove: (name: string) => req(`/api/vm-networks/${name}`, { method: 'DELETE' }),
    attach: (name: string, vm: string) => req(`/api/vm-networks/${name}/attach`, { method: 'POST', body: JSON.stringify({ vm }) }),
  },

  firewall: {
    list: () => req<{ available: boolean; active: boolean; logging: boolean; rules: FirewallRule[]; disabled?: FirewallDisabledRule[]; message?: string; listening?: string }>('/api/firewall'),
    add: (data: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string }) =>
      req('/api/firewall', { method: 'POST', body: JSON.stringify(data) }),
    update: (num: number, data: { action: 'allow' | 'deny' | 'reject'; port?: string; proto?: string; from?: string; direction?: string; comment?: string }) =>
      req(`/api/firewall/${num}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (num: number) => req(`/api/firewall/${num}`, { method: 'DELETE' }),
    disable: (num: number, data: { action?: string; port?: string; proto?: string; from?: string; direction?: string; comment?: string; profile?: string }) =>
      req(`/api/firewall/${num}/disable`, { method: 'POST', body: JSON.stringify(data) }),
    enableDisabled: (id: number) => req(`/api/firewall/disabled/${id}/enable`, { method: 'POST' }),
    removeDisabled: (id: number) => req(`/api/firewall/disabled/${id}`, { method: 'DELETE' }),
    toggle: (enable: boolean) => req('/api/firewall/toggle', { method: 'POST', body: JSON.stringify({ enable }) }),
    setLogging: (enable: boolean, level?: string) => req<{ ok: boolean; logging: boolean; level?: string }>('/api/firewall/logging', { method: 'POST', body: JSON.stringify({ enable, level }) }),
    log: (limit = 500) => req<{ available: boolean; logging: boolean; level?: string; source?: string; entries: FirewallLogEntry[]; total?: number; blocked?: number; message?: string }>(`/api/firewall/log?limit=${limit}`),
    clearLog: () => req('/api/firewall/log', { method: 'DELETE' }),
  },

  settings: {
    info: () => req<{ version: string; hostname: string; platform: string; dataDir: string; node: string; uptime: number; features: Record<string, boolean> }>('/api/settings/info'),
    version: (refresh = false) => req<VersionInfo>(`/api/settings/version${refresh ? '?refresh=1' : ''}`),
    exportUrl: () => '/api/settings/export',
    restart: () => req<{ ok: boolean; note: string }>('/api/settings/restart', { method: 'POST' }),
    import: async (file: File) => {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/settings/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      return res.json() as Promise<{ ok: boolean; restored: string[]; note: string }>;
    },
  },

  ki: {
    status: () => req<OllamaStatus>('/api/ki/status'),
    models: () => req<{ models: OllamaModel[] }>('/api/ki/models'),
    pull: (model: string) => req<{ ok: boolean; queued: boolean }>('/api/ki/pull', { method: 'POST', body: JSON.stringify({ model }) }),
    remove: (name: string) => req('/api/ki/models/' + encodeURIComponent(name), { method: 'DELETE' }),
    control: (action: 'start' | 'stop') => req('/api/ki/control', { method: 'POST', body: JSON.stringify({ action }) }),
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
