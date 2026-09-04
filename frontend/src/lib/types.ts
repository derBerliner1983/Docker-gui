// Typen der Oberfläche – reduziert auf Dashboard und Terminal.
// Weitere Bereiche kommen später zurück; dann wachsen die Typen hier mit.

export interface User {
  id: number;
  username: string;
  /** Frei wählbarer Anzeigename; leer → Anmeldename. */
  displayName?: string;
  role: 'admin' | 'viewer';
  totpEnabled?: boolean;
}

/** Anmeldefähiges Linux-Konto des Servers (für das Terminal). */
export interface LinuxUser { name: string; uid: number; shell: string; home: string }

export type TerminalMode = 'root' | 'user' | 'login' | 'service';

export interface TerminalInfo {
  available: boolean;
  resize: boolean;
  runningAsRoot: boolean;
  /** Konto, unter dem der Core-Hub-Dienst selbst läuft. */
  serviceUser: string;
  users: LinuxUser[];
  modes: Record<TerminalMode, { available: boolean; reason: string | null }>;
  defaultMode: TerminalMode;
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
  gpu?: GpuStat[];
}

export interface GpuStat {
  name: string;
  vendor: 'nvidia' | 'amd' | 'unknown';
  utilizationPct: number | null;
  vramTotalMb: number | null;
  vramUsedMb: number | null;
  unified: boolean;
}

export interface VersionInfo {
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  behind?: number;
  method?: string;
  releaseUrl: string | null;
  repo: string;
  checkedAt: string;
  error?: string;
  /** Branch, dem die Update-Quelle folgt. */
  branch?: string;
  /** Aktuell ausgecheckter Commit (SHA) des Quell-Verzeichnisses. */
  ref?: string;
}

export interface OptimizeSuggestion {
  id: string;
  severity: 'info' | 'warn';
  title: string;
  detail: string;
  actionType?: 'process' | 'container' | 'link';
  actionTarget?: string;
  actionLabel?: string;
}

export interface MemoryModule { size: string; type: string; speed: string; locator: string }

export interface MemorySplit {
  installedBytes: number;
  kernelTotalBytes: number;
  kernelAvailableBytes: number;
  reservedBytes: number;
  modules: MemoryModule[];
  installedSource: 'dmidecode' | 'unbekannt';
}

export interface GpuMemory {
  card: string;
  name: string;
  driver: string;
  vramTotalBytes: number;
  vramUsedBytes: number;
  visibleVramBytes: number;
  gttTotalBytes: number;
  gttUsedBytes: number;
  unified: boolean;
}

export interface FirmwareInfo {
  biosVendor: string; biosVersion: string; biosDate: string;
  boardVendor: string; boardName: string; productName: string;
  available: boolean;
}

export interface KernelMemParam { key: string; value: string; note: string }

export interface KernelInfo { version: string; cmdline: string; memoryParams: KernelMemParam[] }

export interface HardwareInfo {
  cpu: { model: string; vendor: string; cores: number; threads: number };
  memory: MemorySplit;
  gpus: GpuMemory[];
  firmware: FirmwareInfo;
  kernel: KernelInfo;
  sharedMemory: boolean;
  hints: string[];
}
