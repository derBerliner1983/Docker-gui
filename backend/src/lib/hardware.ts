import fs from 'fs';
import { safeExec, privExec, hasBinary } from './privilege';

/**
 * Auslesen der Speicher-Aufteilung.
 *
 * Auf Systemen mit gemeinsamem Speicher (z. B. AMD Ryzen AI Max / „Strix Halo",
 * Apple-Silicon-ähnliche APUs) teilen sich CPU und GPU dieselben RAM-Bausteine.
 * Wie viel davon fest an die GPU geht, wird im BIOS/UEFI eingestellt (UMA-
 * Framebuffer) – der Kernel sieht dann nur noch den Rest als Arbeitsspeicher.
 * Zusätzlich kann sich die GPU über GTT dynamisch weiteren System-RAM leihen.
 *
 * Diese Werte kommen aus verschiedenen Quellen, die hier bewusst getrennt
 * ausgewiesen werden, damit erkennbar ist, was woher stammt:
 *   • physisch verbaut   → dmidecode (SMBIOS, vom BIOS gemeldet)
 *   • für das OS nutzbar → /proc/meminfo (Kernel-Sicht)
 *   • fest für die GPU   → amdgpu-sysfs mem_info_vram_total (UMA aus dem BIOS)
 *   • dynamisch leihbar  → amdgpu-sysfs mem_info_gtt_total
 *   • Kernel-Parameter   → /proc/cmdline
 */

export interface MemorySplit {
  /** Vom BIOS gemeldeter, physisch verbauter Speicher (dmidecode). 0 = unbekannt. */
  installedBytes: number;
  /** Was der Kernel als Arbeitsspeicher sieht (/proc/meminfo MemTotal). */
  kernelTotalBytes: number;
  kernelAvailableBytes: number;
  /** Differenz „verbaut − Kernel": Firmware- und GPU-Reservierung. */
  reservedBytes: number;
  /** Einzelne Speicherriegel laut SMBIOS. */
  modules: Array<{ size: string; type: string; speed: string; locator: string }>;
  /** Quelle der „installiert"-Angabe, für die Anzeige. */
  installedSource: 'dmidecode' | 'unbekannt';
}

export interface GpuMemory {
  card: string;
  name: string;
  driver: string;
  /** Fest zugeteilter Videospeicher (bei APUs = UMA-Framebuffer aus dem BIOS). */
  vramTotalBytes: number;
  vramUsedBytes: number;
  /** Davon für die CPU direkt sichtbar (Resizable BAR). */
  visibleVramBytes: number;
  /** Dynamisch aus dem System-RAM leihbar (GTT). */
  gttTotalBytes: number;
  gttUsedBytes: number;
  /** true, wenn Speicher mit der CPU geteilt wird (APU/iGPU). */
  unified: boolean;
}

export interface FirmwareInfo {
  biosVendor: string;
  biosVersion: string;
  biosDate: string;
  boardVendor: string;
  boardName: string;
  productName: string;
  /** true, wenn die Angaben aus dmidecode stammen (sonst aus /sys/class/dmi). */
  available: boolean;
}

export interface KernelInfo {
  version: string;
  cmdline: string;
  /** Für die Speicheraufteilung relevante Boot-Parameter. */
  memoryParams: Array<{ key: string; value: string; note: string }>;
}

export interface HardwareInfo {
  cpu: { model: string; vendor: string; cores: number; threads: number };
  memory: MemorySplit;
  gpus: GpuMemory[];
  firmware: FirmwareInfo;
  kernel: KernelInfo;
  /** true, wenn CPU und GPU sich denselben Speicher teilen. */
  sharedMemory: boolean;
  hints: string[];
}

const readFile = (p: string): string => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
};

/** dmidecode braucht root – erst direkt, dann über sudo versuchen. */
function dmidecode(args: string): string {
  if (!hasBinary('dmidecode')) return '';
  const cmd = `dmidecode ${args} 2>/dev/null`;
  const direct = safeExec(cmd, 8000);
  if (direct.trim()) return direct;
  try { return privExec(cmd, { timeout: 8000 }); } catch { return ''; }
}

/** Größenangaben aus SMBIOS ("32 GB", "16384 MB") in Bytes. */
function parseSize(s: string): number {
  const m = s.trim().match(/^(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|KB|B)$/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  const unit = m[2].toUpperCase();
  const factor = unit === 'TB' ? 1024 ** 4 : unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : unit === 'KB' ? 1024 : 1;
  return Math.round(n * factor);
}

function readMemorySplit(): MemorySplit {
  const meminfo = readFile('/proc/meminfo');
  const kb = (key: string) => (parseInt(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? '0', 10) || 0) * 1024;
  const kernelTotalBytes = kb('MemTotal');
  const kernelAvailableBytes = kb('MemAvailable');

  // SMBIOS Typ 17 = einzelne Speicherriegel
  const modules: MemorySplit['modules'] = [];
  let installedBytes = 0;
  const dmi = dmidecode('-t 17');
  if (dmi) {
    for (const block of dmi.split(/\n\s*\n/)) {
      if (!/Memory Device/i.test(block)) continue;
      const size = block.match(/^\s*Size:\s*(.+)$/m)?.[1]?.trim() ?? '';
      if (!size || /No Module Installed|Not Installed/i.test(size)) continue;
      const bytes = parseSize(size);
      if (bytes <= 0) continue;
      installedBytes += bytes;
      modules.push({
        size,
        type: block.match(/^\s*Type:\s*(.+)$/m)?.[1]?.trim() ?? '',
        speed: block.match(/^\s*(?:Configured Memory Speed|Speed):\s*(.+)$/m)?.[1]?.trim() ?? '',
        locator: block.match(/^\s*Locator:\s*(.+)$/m)?.[1]?.trim() ?? '',
      });
    }
  }

  return {
    installedBytes,
    kernelTotalBytes,
    kernelAvailableBytes,
    reservedBytes: installedBytes > kernelTotalBytes ? installedBytes - kernelTotalBytes : 0,
    modules,
    installedSource: installedBytes > 0 ? 'dmidecode' : 'unbekannt',
  };
}

function readGpus(): GpuMemory[] {
  const gpus: GpuMemory[] = [];
  let cards: string[] = [];
  try { cards = fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d)); } catch { /* kein DRM */ }

  for (const card of cards) {
    const base = `/sys/class/drm/${card}/device`;
    const num = (f: string) => parseInt(readFile(`${base}/${f}`).trim(), 10) || 0;
    const vramTotalBytes = num('mem_info_vram_total');
    const gttTotalBytes = num('mem_info_gtt_total');
    if (vramTotalBytes === 0 && gttTotalBytes === 0) continue;   // keine echte GPU

    // Treibername aus dem uevent, Modellname per lspci (Slot-genau)
    const uevent = readFile(`${base}/uevent`);
    const driver = uevent.match(/^DRIVER=(.+)$/m)?.[1]?.trim() ?? '';
    const slot = uevent.match(/^PCI_SLOT_NAME=(.+)$/m)?.[1]?.trim() ?? '';
    let name = '';
    if (slot) {
      const line = safeExec(`lspci -s ${slot.replace(/[^0-9a-fA-F:.]/g, '')} 2>/dev/null`, 5000);
      name = line.replace(/^\S+\s+[^:]+:\s*/, '').trim();
    }
    if (!name) name = readFile(`${base}/product_name`).trim() || driver || 'GPU';

    gpus.push({
      card,
      name,
      driver,
      vramTotalBytes,
      vramUsedBytes: num('mem_info_vram_used'),
      visibleVramBytes: num('mem_info_vis_vram_total'),
      gttTotalBytes,
      gttUsedBytes: num('mem_info_gtt_used'),
      // Eine APU teilt sich den Speicher: GTT ist dann typischerweise so groß
      // wie ein erheblicher Teil des System-RAM.
      unified: gttTotalBytes > 0,
    });
  }
  return gpus;
}

function readFirmware(): FirmwareInfo {
  const sys = (f: string) => readFile(`/sys/class/dmi/id/${f}`).trim();
  const info: FirmwareInfo = {
    biosVendor: sys('bios_vendor'),
    biosVersion: sys('bios_version'),
    biosDate: sys('bios_date'),
    boardVendor: sys('board_vendor'),
    boardName: sys('board_name'),
    productName: sys('product_name'),
    available: false,
  };
  info.available = Boolean(info.biosVersion || info.productName || info.boardName);
  return info;
}

/** Boot-Parameter, die die Speicheraufteilung beeinflussen. */
const MEM_PARAMS: Array<{ re: RegExp; note: string }> = [
  { re: /^amdgpu\.gttsize$/,     note: 'Obergrenze für dynamisch geliehenen System-RAM (GTT) der AMD-GPU' },
  { re: /^amdgpu\.vramlimit$/,   note: 'Begrenzt den von amdgpu genutzten Videospeicher' },
  { re: /^amdgpu\.vm_size$/,     note: 'Größe des GPU-Adressraums' },
  { re: /^ttm\.pages_limit$/,    note: 'Obergrenze der TTM-Speicherseiten (betrifft GTT)' },
  { re: /^mem$/,                 note: 'Begrenzt den vom Kernel genutzten Arbeitsspeicher' },
  { re: /^memmap$/,              note: 'Reserviert Speicherbereiche für den Kernel' },
  { re: /^hugepages?$/,          note: 'Vorab reservierte Huge Pages' },
  { re: /^default_hugepagesz$/,  note: 'Standardgröße der Huge Pages' },
  { re: /^iommu$/,               note: 'IOMMU-Modus (beeinflusst GPU-Speicherzugriff)' },
  { re: /^amd_iommu$/,           note: 'AMD-IOMMU-Modus' },
  { re: /^crashkernel$/,         note: 'Für Kernel-Dumps reservierter Speicher' },
];

function readKernel(): KernelInfo {
  const cmdline = readFile('/proc/cmdline').trim();
  const memoryParams: KernelInfo['memoryParams'] = [];
  for (const token of cmdline.split(/\s+/).filter(Boolean)) {
    const [key, ...rest] = token.split('=');
    const hit = MEM_PARAMS.find((p) => p.re.test(key));
    if (hit) memoryParams.push({ key, value: rest.join('=') || '(gesetzt)', note: hit.note });
  }
  return {
    version: readFile('/proc/version').split(' ').slice(0, 3).join(' ').trim(),
    cmdline,
    memoryParams,
  };
}

function readCpu(): HardwareInfo['cpu'] {
  const cpuinfo = readFile('/proc/cpuinfo');
  const model = cpuinfo.match(/^model name\s*:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const vendor = cpuinfo.match(/^vendor_id\s*:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const threads = (cpuinfo.match(/^processor\s*:/gm) ?? []).length;
  const coreIds = new Set(
    (cpuinfo.match(/^core id\s*:\s*(\d+)$/gm) ?? []).map((l) => l.split(':')[1].trim()),
  );
  return { model, vendor, cores: coreIds.size || threads, threads };
}

export function readHardware(): HardwareInfo {
  const memory = readMemorySplit();
  const gpus = readGpus();
  const firmware = readFirmware();
  const kernel = readKernel();
  const cpu = readCpu();
  const sharedMemory = gpus.some((g) => g.unified);

  const hints: string[] = [];
  if (memory.installedSource === 'unbekannt') {
    hints.push('Der physisch verbaute Speicher konnte nicht gelesen werden (dmidecode fehlt oder keine Rechte) – es wird nur die Kernel-Sicht angezeigt.');
  } else if (memory.reservedBytes > 0) {
    hints.push('Die Differenz zwischen verbautem und für das Betriebssystem nutzbarem Speicher ist im BIOS/UEFI fest reserviert – bei APUs meist als Videospeicher (UMA-Framebuffer).');
  }
  if (sharedMemory) {
    hints.push('CPU und GPU teilen sich denselben Speicher. Der feste Anteil wird im BIOS/UEFI eingestellt; über GTT kann sich die GPU zusätzlich Arbeitsspeicher leihen.');
  }
  if (kernel.memoryParams.length === 0 && sharedMemory) {
    hints.push('Es sind keine speicherrelevanten Kernel-Parameter gesetzt – die Aufteilung stammt damit vollständig aus dem BIOS/UEFI.');
  }

  return { cpu, memory, gpus, firmware, kernel, sharedMemory, hints };
}
