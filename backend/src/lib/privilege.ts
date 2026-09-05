import { execSync, execFileSync, type ExecSyncOptions } from 'child_process';

/** True if the Node process already runs as root (uid 0). */
export const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;

/**
 * Run a shell command, automatically prefixing `sudo -n` when not running as
 * root. The install.sh sets up /etc/sudoers.d/core-hub so this works without a
 * password for the whitelisted binaries.
 */
export function privExec(cmd: string, opts: ExecSyncOptions = {}): string {
  const full = isRoot ? cmd : `sudo -n ${cmd}`;
  return execSync(full, { timeout: 15000, ...opts }).toString();
}

/**
 * Wie privExec, aber über eine Shell: `sudo -n bash -c "…"`.
 *
 * Gedacht für Werkzeuge, die nicht einzeln in der sudoers-Allowlist stehen
 * (find, cat, stat, journalctl …). Sicherheitlich ändert das nichts: bash steht
 * dort ohne Einschränkung und kann ohnehin jedes Programm starten. Der Umweg
 * sorgt nur dafür, dass eine ältere Allowlist nicht zu „sudo: … can't do that"
 * führt, bevor install.sh --fix-perms gelaufen ist.
 */
export function privShell(cmd: string, opts: ExecSyncOptions = {}): string {
  return privExec(`bash -c ${JSON.stringify(cmd)}`, opts);
}

/**
 * Wie privShell, liefert die Ausgabe aber unverändert als Buffer.
 *
 * privExec ruft .toString() auf – für Binärdateien (Bilder, Archive) wäre das
 * fatal: alles, was kein gültiges UTF-8 ist, würde durch Ersatzzeichen
 * ausgetauscht und die Datei käme beschädigt beim Browser an.
 */
export function privShellBuffer(cmd: string, opts: ExecSyncOptions = {}): Buffer {
  const inner = `bash -c ${JSON.stringify(cmd)}`;
  const full = isRoot ? inner : `sudo -n ${inner}`;
  return execSync(full, { timeout: 15000, ...opts, encoding: 'buffer' }) as unknown as Buffer;
}

/** execFile variant (no shell parsing) with optional sudo prefix. */
export function privExecFile(bin: string, args: string[], opts: ExecSyncOptions = {}): string {
  if (isRoot) {
    return execFileSync(bin, args, { timeout: 15000, ...opts }).toString();
  }
  return execFileSync('sudo', ['-n', bin, ...args], { timeout: 15000, ...opts }).toString();
}

/** Best-effort command that never throws; returns '' on failure. */
export function safeExec(cmd: string, timeout = 6000): string {
  try {
    return execSync(cmd, { timeout, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/** Check whether a binary exists in PATH. */
export function hasBinary(bin: string): boolean {
  return safeExec(`command -v ${bin.replace(/[^a-zA-Z0-9_-]/g, '')} 2>/dev/null`).trim().length > 0;
}

/**
 * Auswertung fehlgeschlagener Befehle.
 *
 * Achtung, altes Fehlermuster: `privExec` stellt jedem Befehl „sudo -n " voran,
 * und Node schreibt den kompletten Befehl in die Fehlermeldung
 * („Command failed: sudo -n pacman …"). Ein `message.includes('sudo')` ist
 * deshalb IMMER wahr und meldet jeden beliebigen Fehler als fehlende
 * Root-Rechte. Entschieden wird hier stattdessen anhand der Ausgabe von sudo.
 */

/** Ausgabe (stderr + stdout) eines fehlgeschlagenen execSync-Aufrufs. */
export function execOutput(err: unknown): string {
  const e = err as { stderr?: Buffer | string; stdout?: Buffer | string; message?: string };
  const part = (v: Buffer | string | undefined) => (v == null ? '' : typeof v === 'string' ? v : v.toString());
  const out = `${part(e?.stderr)}\n${part(e?.stdout)}`.trim();
  return out || (e?.message ?? '');
}

/** Sind wirklich die sudo-Rechte das Problem? Erkennung anhand der sudo-Meldung. */
export function isPermissionError(err: unknown): boolean {
  const out = execOutput(err).toLowerCase();
  return [
    'a password is required',
    'is not allowed to execute',
    'is not in the sudoers file',
    'no tty present',
    'sorry, user',
    'sudo: command not found',
    'unable to initialize policy plugin',
    'permission denied',
    'operation not permitted',
  ].some((s) => out.includes(s));
}

/**
 * Verständliche Fehlermeldung für die Oberfläche: bei echten Rechteproblemen
 * der Hinweis auf --fix-perms, sonst die tatsächliche Ausgabe des Befehls
 * (gekürzt), damit die Ursache sichtbar bleibt.
 */
export function describeExecError(err: unknown, fallback = 'Befehl fehlgeschlagen'): string {
  if (isPermissionError(err)) {
    return 'Keine Root-Rechte – bitte einmal „sudo bash install.sh --fix-perms" ausführen (aktualisiert die sudoers-Rechte).';
  }
  const out = execOutput(err).trim();
  if (!out) return err instanceof Error ? err.message || fallback : fallback;
  // Nur den aussagekräftigen Schluss zeigen; die „Command failed"-Zeile bringt nichts.
  const lines = out.split('\n').filter((l) => l.trim() && !/^command failed:/i.test(l));
  return lines.slice(-12).join('\n').slice(-1500) || fallback;
}
