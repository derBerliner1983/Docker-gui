export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}

export interface BackupSchedule {
  id: number;
  type: 'container' | 'directory' | 'vm';
  source: string;
  label: string;
  schedule: string;
  retention: number;
  stop_container: number;
  enabled: number;
  last_run: string | null;
  last_status: string | null;
  last_message: string | null;
  created_at: string;
}

export interface AppTemplateEnv { key: string; label: string; default?: string; required?: boolean; secret?: boolean }
export interface AppTemplatePort { container: number; host: number; proto?: 'tcp' | 'udp' }

export interface AppTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  image: string;
  ports: AppTemplatePort[];
  volumes?: { name: string; path: string }[];
  env?: AppTemplateEnv[];
  restart?: string;
  note?: string;
  installed: boolean;
}

export interface NotificationItem {
  id: number;
  level: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string | null;
  event: string | null;
  read: number;
  created_at: string;
}

export interface NotificationConfig {
  webhookUrl: string;
  emailTo: string;
  onBackup: boolean;
  onSecurity: boolean;
  onContainer: boolean;
  onAntivirus: boolean;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
  repo: string;
  checkedAt: string;
  error?: string;
}

export interface Container {
  id: string;
  shortId: string;
  name: string;
  image: string;
  imageId: string;
  status: string;
  state: string;
  ports: string[];
  created: number;
  labels: Record<string, string>;
  category: string | null;
}

export interface SystemStats {
  cpu: { usage: number; cores: number; brand: string; speed: number; perCore: number[] };
  memory: {
    total: number; used: number; free: number; available: number; percent: number;
    breakdown: { system: number; docker: number; vm: number; free: number };
  };
  disk: { fs: string; type: string; size: number; used: number; available: number; percent: number; mount: string }[];
  network: { iface: string; rx_bytes: number; tx_bytes: number; rx_sec: number; tx_sec: number; operstate: string }[];
  os: { hostname: string; platform: string; distro: string; release: string; kernel: string; arch: string; uptime: number };
}

export interface ProcessInfo {
  pid: number;
  name: string;
  cpu: number;
  mem: number;
  memRss: number;
  user: string;
  state: string;
  command: string;
}

export interface CronJob {
  id: number;
  schedule: string;
  command: string;
  comment: string;
  enabled: boolean;
  raw: string;
}

export interface VM {
  id: string;
  name: string;
  state: string;
  vcpus: number;
  memory: number;
  autostart: boolean;
}

export interface AutostartUnit {
  name: string;
  state: string;
}

export interface PackageUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  repo: string;
}

export interface Backup {
  id: number;
  type: string;
  name: string;
  source: string | null;
  path: string;
  size: number;
  status: string;
  created_at: string;
  exists: boolean;
}

export interface BackupSource {
  id: string;
  name: string;
  state: string;
  volumes: number;
}

export interface Share {
  name: string;
  path: string;
  readOnly: boolean;
  guestOk: boolean;
  browseable: boolean;
}

export interface LinuxUser {
  username: string;
  uid: number;
  gid: number;
  home: string;
  shell: string;
  groups: string[];
  system: boolean;
}

export interface ProxyHost {
  id: number;
  containerId: string | null;
  name: string;
  hostname: string;
  targetHost: string;
  targetPort: number;
  https: boolean;
  enabled: boolean;
  url: string;
}

export interface ProxyCandidate {
  id: string;
  name: string;
  port: number;
  alreadyProxied: boolean;
}

export interface NetEndpoint {
  container: string;
  name: string;
  ipv4: string;
  mac: string;
}

export interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  subnet: string;
  gateway: string;
  parent: string;
  vlan: string;
  containers: NetEndpoint[];
  builtin: boolean;
}

export interface HostInterface {
  iface: string;
  ip4: string;
  mac: string;
  type: string;
  operstate: string;
}

export interface FirewallRule {
  num: number;
  raw: string;
  to: string;
  action: string;
  from: string;
}

export type SecurityStatus = 'ok' | 'warn' | 'critical' | 'info';

export interface SecurityFinding {
  id: string;
  category: string;
  title: string;
  status: SecurityStatus;
  detail: string;
  recommendation: string;
  fix?: string;
}

export interface SecurityScan {
  score: number;
  grade: string;
  counts: { ok: number; warn: number; critical: number; info: number };
  findings: SecurityFinding[];
  scannedAt: string;
}

export interface SshStatus {
  installed: boolean;
  active: boolean;
  enabled: boolean;
  unit: string;
  port: string;
}

export interface VmNetwork {
  name: string;
  active: boolean;
  autostart: boolean;
  persistent: boolean;
  bridge: string;
  forward: string;
}

export interface AntivirusStatus {
  installed: boolean;
  daemonActive: boolean;
  freshclamActive: boolean;
  version: string;
  defsAgeDays: number | null;
  message?: string;
  scan: {
    running: boolean;
    path: string;
    startedAt?: string;
    finishedAt?: string;
    scanned: number;
    infectedCount: number;
    infected: { file: string; virus: string }[];
    error?: string;
  };
}

export interface DockerImage {
  id: string;
  tags: string[];
  size: number;
  created: number;
}

export interface SystemService {
  name: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

export interface UserPublic {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export interface CreateContainerData {
  image: string;
  name?: string;
  ports?: Record<string, string>;
  env?: string[];
  volumes?: string[];
  category?: string;
  restart?: string;
}
