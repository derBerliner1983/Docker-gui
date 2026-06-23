export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : decimals)} ${sizes[i]}`;
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function timeAgo(unixTs: number): string {
  const diff = Date.now() / 1000 - unixTs;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)}h`;
  if (diff < 2592000) return `vor ${Math.floor(diff / 86400)}d`;
  return `vor ${Math.floor(diff / 2592000)} Mon.`;
}

const AVATAR_COLORS = [
  '#10B981', '#06B6D4', '#8B5CF6', '#F59E0B',
  '#EF4444', '#2563EB', '#EC4899', '#14B8A6',
];

export function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

export function containerInitial(name: string): string {
  return name.charAt(0).toUpperCase();
}

/** Übersetzt eine go-humanize-Zeitangabe (z. B. "About a minute") ins Deutsche. */
function translateTime(t: string): string {
  return t
    .replace(/Less than a second/i, 'weniger als 1 Sekunde')
    .replace(/About a minute/i, 'etwa 1 Minute')
    .replace(/About an hour/i, 'etwa 1 Stunde')
    .replace(/\b(\d+)\s+seconds?\b/gi, (_m, n) => `${n} Sekunde${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+minutes?\b/gi, (_m, n) => `${n} Minute${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+hours?\b/gi, (_m, n) => `${n} Stunde${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+days?\b/gi, (_m, n) => `${n} Tag${n === '1' ? '' : 'en'}`)
    .replace(/\b(\d+)\s+weeks?\b/gi, (_m, n) => `${n} Woche${n === '1' ? '' : 'n'}`)
    .replace(/\b(\d+)\s+months?\b/gi, (_m, n) => `${n} Monat${n === '1' ? '' : 'en'}`)
    .replace(/\b(\d+)\s+years?\b/gi, (_m, n) => `${n} Jahr${n === '1' ? '' : 'en'}`);
}

/**
 * Übersetzt den Docker-Statustext (z. B. "Up About a minute (healthy)") ins
 * Deutsche – inklusive Zustand, Zeit und Gesundheitszustand.
 */
export function germanStatus(status: string): string {
  if (!status) return '';
  let s = status.trim();

  // Gesundheits-Suffix abtrennen und übersetzen
  let health = '';
  const hm = s.match(/\((healthy|unhealthy|health:\s*starting)\)\s*$/i);
  if (hm) {
    const key = hm[1].toLowerCase().replace(/\s+/g, ' ');
    health = key === 'healthy' ? ' (gesund)' : key === 'unhealthy' ? ' (fehlerhaft)' : ' (Prüfung läuft)';
    s = s.slice(0, hm.index).trim();
  }

  let m: RegExpMatchArray | null;
  if ((m = s.match(/^Up\s+(.+)$/i)))                                     return `Läuft seit ${translateTime(m[1])}${health}`;
  if ((m = s.match(/^Exited\s+\((\d+)\)\s+(.+?)\s+ago$/i)))             return `Beendet (${m[1]}) vor ${translateTime(m[2])}${health}`;
  if ((m = s.match(/^Exited\s+\((\d+)\)/i)))                            return `Beendet (${m[1]})${health}`;
  if ((m = s.match(/^Restarting\s+\((\d+)\)\s+(.+?)\s+ago$/i)))         return `Neustart (${m[1]}) vor ${translateTime(m[2])}${health}`;
  if (/^Created$/i.test(s))                                             return 'Erstellt';
  if (/^Dead$/i.test(s))                                                return 'Tot';
  if (/^Paused$/i.test(s))                                              return `Pausiert${health}`;
  if (/^Removal In Progress$/i.test(s))                                 return 'Wird entfernt';
  return s + health;
}
