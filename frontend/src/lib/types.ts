export interface User {
  id: number;
  username: string;
  role: 'admin' | 'viewer';
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
