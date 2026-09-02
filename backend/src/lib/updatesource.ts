import { execSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { appSettingsQueries } from '../db/index';
import { encryptSecret, decryptSecret } from './secrets';
import { privExec, isRoot } from './privilege';

/**
 * Konfigurierbare Update-Quelle (Git-Repository).
 *
 * Core-Hub aktualisiert sich per `git` aus einem Quell-Checkout. Welches
 * Repository dabei verwendet wird, ist hier einstellbar und wird in
 * `app_settings` abgelegt – so kann die Quelle nachträglich geändert werden
 * (z. B. wenn das Repository umgezogen ist oder ein eigener Fork verwendet
 * werden soll).
 *
 * Für private Repositories können Benutzername + Token/Passwort hinterlegt
 * werden. Das Geheimnis wird mit AES-256-GCM verschlüsselt gespeichert
 * (siehe lib/secrets.ts) und niemals an das Frontend zurückgegeben.
 * Bei Git-Aufrufen wandert es außerdem NICHT in die Kommandozeile (dort wäre
 * es über `ps` sichtbar), sondern in ein kurzlebiges GIT_ASKPASS-Skript mit
 * 0600-Rechten, das direkt nach dem Aufruf wieder gelöscht wird.
 */

const KEYS = {
  url: 'update_repo_url',
  branch: 'update_repo_branch',
  visibility: 'update_repo_visibility',
  authType: 'update_repo_auth_type',
  username: 'update_repo_username',
  secret: 'update_repo_secret',
} as const;

export type RepoVisibility = 'public' | 'private';
export type RepoAuthType = 'token' | 'password';

export interface UpdateSourceConfig {
  /** Klon-URL (https). Leer = Quelle aus dem vorhandenen Checkout (origin). */
  url: string;
  /** Branch, dem gefolgt wird. Leer = Tracking-Branch des Checkouts. */
  branch: string;
  visibility: RepoVisibility;
  authType: RepoAuthType;
  username: string;
}

export interface UpdateSourcePublic extends UpdateSourceConfig {
  /** true, wenn ein Token/Passwort hinterlegt ist (der Wert selbst wird nie ausgeliefert). */
  hasSecret: boolean;
  /** true, sobald die Quelle bewusst konfiguriert wurde (sonst Standard/origin). */
  configured: boolean;
}

const get = (k: string): string => appSettingsQueries.get.get(k)?.value ?? '';

/** Gespeicherte Konfiguration lesen (ohne Geheimnis). */
export function getUpdateSource(): UpdateSourcePublic {
  const visibility = get(KEYS.visibility) === 'private' ? 'private' : 'public';
  const authType = get(KEYS.authType) === 'password' ? 'password' : 'token';
  const url = get(KEYS.url);
  return {
    url,
    branch: get(KEYS.branch),
    visibility,
    authType,
    username: get(KEYS.username),
    hasSecret: get(KEYS.secret).length > 0,
    configured: url.length > 0,
  };
}

/** Entschlüsseltes Token/Passwort – nur serverintern verwenden. */
function getSecret(): string {
  const blob = get(KEYS.secret);
  if (!blob) return '';
  try { return decryptSecret(blob); } catch { return ''; }
}

/**
 * Erlaubte Klon-URLs: nur http(s). Bewusst streng, weil die URL an `git`
 * weitergereicht wird – Shell-Metazeichen und Leerzeichen sind ausgeschlossen.
 */
const URL_RE = /^https?:\/\/[A-Za-z0-9._~%-]+(?::\d{1,5})?(?:\/[A-Za-z0-9._~%+-]+)+\/?$/;
/** Branch-/Ref-Namen: keine Shell-Metazeichen, keine „..“-Pfadtricks. */
const REF_RE = /^[A-Za-z0-9][A-Za-z0-9._/+-]{0,119}$/;

export function isValidRepoUrl(url: string): boolean {
  return URL_RE.test(url) && !url.includes('..') && !url.includes('@');
}

export function isValidRef(ref: string): boolean {
  return REF_RE.test(ref) && !ref.includes('..');
}

export interface SaveInput {
  url?: string;
  branch?: string;
  visibility?: string;
  authType?: string;
  username?: string;
  /** Neues Geheimnis. undefined = unverändert lassen, '' = löschen. */
  secret?: string;
}

/** Konfiguration speichern. Wirft bei ungültigen Eingaben. */
export function saveUpdateSource(input: SaveInput): UpdateSourcePublic {
  const url = (input.url ?? '').trim().replace(/\/+$/, '');
  if (url && !isValidRepoUrl(url)) {
    throw new Error('Ungültige Repository-URL – erlaubt ist nur https://host/pfad (ohne Benutzer im URL).');
  }
  const branch = (input.branch ?? '').trim();
  if (branch && !isValidRef(branch)) throw new Error('Ungültiger Branch-Name.');

  const visibility: RepoVisibility = input.visibility === 'private' ? 'private' : 'public';
  const authType: RepoAuthType = input.authType === 'password' ? 'password' : 'token';
  const username = (input.username ?? '').trim();
  if (username.length > 200 || /[\r\n]/.test(username)) throw new Error('Ungültiger Benutzername.');

  appSettingsQueries.set.run(KEYS.url, url);
  appSettingsQueries.set.run(KEYS.branch, branch);
  appSettingsQueries.set.run(KEYS.visibility, visibility);
  appSettingsQueries.set.run(KEYS.authType, authType);
  appSettingsQueries.set.run(KEYS.username, visibility === 'private' ? username : '');

  if (visibility === 'public') {
    // Öffentliche Quelle braucht keine Zugangsdaten – hinterlegte werden entfernt.
    appSettingsQueries.set.run(KEYS.secret, '');
  } else if (input.secret !== undefined) {
    const s = input.secret;
    if (s === '') {
      appSettingsQueries.set.run(KEYS.secret, '');
    } else {
      if (/[\r\n]/.test(s)) throw new Error('Token/Passwort darf keine Zeilenumbrüche enthalten.');
      if (s.length > 4096) throw new Error('Token/Passwort ist zu lang.');
      appSettingsQueries.set.run(KEYS.secret, encryptSecret(s));
    }
  }
  return getUpdateSource();
}

/** Alle Werte aus der Ausgabe entfernen, die ein Geheimnis verraten könnten. */
export function scrubSecrets(text: string): string {
  let out = text;
  const secret = getSecret();
  if (secret) out = out.split(secret).join('***');
  const user = get(KEYS.username);
  if (user && user.length > 2) out = out.split(user).join('***');
  // Zur Sicherheit auch klassische „https://user:pass@host“-Formen maskieren.
  return out.replace(/(https?:\/\/)[^\s/@]+(?::[^\s/@]*)?@/g, '$1***@');
}

// ── Git-Aufrufe mit Zugangsdaten ────────────────────────────────────────────

/** Einfach-Anführungszeichen für die Shell sicher maskieren. */
function shq(s: string): string {
  return `'${s.split("'").join(`'\\''`)}'`;
}

/**
 * Kurzlebiges GIT_ASKPASS-Skript anlegen (0600). Gibt null zurück, wenn keine
 * Zugangsdaten nötig sind (öffentliches Repository).
 */
function makeAskpass(): string | null {
  const cfg = getUpdateSource();
  if (cfg.visibility !== 'private') return null;
  const secret = getSecret();
  if (!secret && !cfg.username) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'corehub-git-'));
  const file = path.join(dir, 'askpass.sh');
  const script = [
    '#!/bin/sh',
    '# Von Core-Hub erzeugt – wird nach dem Git-Aufruf sofort gelöscht.',
    'case "$1" in',
    `  *sername*) printf '%s' ${shq(cfg.username)} ;;`,
    `  *) printf '%s' ${shq(secret)} ;;`,
    'esac',
    '',
  ].join('\n');
  fs.writeFileSync(file, script, { mode: 0o700 });
  try { fs.chmodSync(file, 0o700); } catch { /* ohne chmod */ }
  return file;
}

function removeAskpass(file: string | null) {
  if (!file) return;
  try { fs.rmSync(path.dirname(file), { recursive: true, force: true }); } catch { /* egal */ }
}

/**
 * Git im Repository ausführen – erst direkt, bei Rechtefehlern via sudo
 * (das Quell-Verzeichnis kann root gehören). Zugangsdaten werden über ein
 * GIT_ASKPASS-Skript übergeben, nie über die Kommandozeile.
 *
 * @param repoRoot Arbeitsverzeichnis (null = kein `-C`, z. B. für `ls-remote`)
 */
export function gitRun(repoRoot: string | null, args: string, timeout = 20000): string {
  const askpass = makeAskpass();
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    ...(askpass ? { GIT_ASKPASS: askpass, SSH_ASKPASS: askpass } : {}),
  };
  const base = `git ${repoRoot ? `-C ${shq(repoRoot)} ` : ''}${args}`;
  try {
    try {
      return execSync(base, { timeout, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    } catch (direct) {
      // Fallback über sudo: Umgebungsvariablen gehen dabei verloren, deshalb
      // werden sie innerhalb von `bash -c` gesetzt (bash steht in der sudoers-Allowlist).
      if (isRoot) throw direct;
      const prefix = askpass
        ? `GIT_TERMINAL_PROMPT=0 GIT_ASKPASS=${shq(askpass)} SSH_ASKPASS=${shq(askpass)} `
        : 'GIT_TERMINAL_PROMPT=0 ';
      return privExec(`/bin/bash -c ${shq(prefix + base)}`, { timeout });
    }
  } catch (err) {
    throw new Error(scrubSecrets(err instanceof Error ? err.message : String(err)));
  } finally {
    removeAskpass(askpass);
  }
}

/** Wie gitRun, liefert aber '' statt zu werfen. */
export function gitSafe(repoRoot: string | null, args: string, timeout = 20000): string {
  try { return gitRun(repoRoot, args, timeout); } catch { return ''; }
}

/**
 * Sorgt dafür, dass `origin` auf die konfigurierte URL zeigt (Repository-Umzug)
 * und liefert den Branch, dem gefolgt werden soll.
 */
export function syncRemote(repoRoot: string): { branch: string; upstream: string } {
  const cfg = getUpdateSource();
  if (cfg.url) {
    const current = gitSafe(repoRoot, 'remote get-url origin', 8000).trim();
    if (current !== cfg.url) {
      if (current) gitSafe(repoRoot, `remote set-url origin ${shq(cfg.url)}`, 8000);
      else gitSafe(repoRoot, `remote add origin ${shq(cfg.url)}`, 8000);
    }
  }
  let branch = cfg.branch;
  if (!branch) {
    const upstream = gitSafe(repoRoot, 'rev-parse --abbrev-ref --symbolic-full-name @{u}', 6000).trim();
    branch = upstream.startsWith('origin/') ? upstream.slice('origin/'.length) : '';
  }
  if (!branch) {
    branch = gitSafe(repoRoot, 'rev-parse --abbrev-ref HEAD', 6000).trim() || 'main';
  }
  return { branch, upstream: `origin/${branch}` };
}

/** `git fetch` gegen die konfigurierte Quelle (inkl. Tags). */
export function fetchRemote(repoRoot: string, timeout = 60000): void {
  gitRun(repoRoot, 'fetch --tags --prune --force origin', timeout);
}

export interface RemoteVersion {
  /** Git-Ref bzw. Commit-SHA, auf den gewechselt wird. */
  ref: string;
  type: 'branch' | 'tag' | 'commit';
  /** Inhalt der VERSION-Datei an diesem Stand (falls lesbar). */
  version: string;
  shortSha: string;
  date: string;
  subject: string;
  /** true für den aktuell installierten Stand. */
  current: boolean;
  /** true für den neuesten verfügbaren Stand (Branch-Spitze). */
  latest: boolean;
}

/** VERSION-Datei für mehrere Commits in einem einzigen Aufruf auslesen. */
function versionsFor(repoRoot: string, shas: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (shas.length === 0) return map;
  const list = shas.map((s) => shq(s)).join(' ');
  const script =
    `for s in ${list}; do printf '%s %s\\n' "$s" ` +
    `"$(git -C ${shq(repoRoot)} show "$s:VERSION" 2>/dev/null | tr -d '[:space:]')"; done`;
  let out = '';
  try {
    out = execSync(`/bin/bash -c ${shq(script)}`, { timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    try { out = privExec(`/bin/bash -c ${shq(script)}`, { timeout: 30000 }); } catch { out = ''; }
  }
  for (const line of out.split('\n')) {
    const [sha, ver] = line.trim().split(/\s+/);
    if (sha) map.set(sha, (ver ?? '').replace(/[^0-9.]/g, ''));
  }
  return map;
}

/**
 * Verfügbare Stände auflisten: Branch-Spitze (= „neueste Version“), alle Tags
 * und die letzten Commits – damit lässt sich auch gezielt auf einen älteren
 * Stand zurückrollen.
 */
export function listVersions(repoRoot: string, limit = 25): RemoteVersion[] {
  const { upstream } = syncRemote(repoRoot);
  const headSha = gitSafe(repoRoot, 'rev-parse HEAD', 6000).trim();
  const tipSha = gitSafe(repoRoot, `rev-parse ${upstream}`, 6000).trim();

  const rows: RemoteVersion[] = [];
  const seen = new Set<string>();

  const pushRow = (r: RemoteVersion) => {
    if (!r.ref || seen.has(r.ref)) return;
    seen.add(r.ref);
    rows.push(r);
  };

  // 1) Tags (üblicherweise Releases), neueste zuerst
  const tagOut = gitSafe(
    repoRoot,
    `for-each-ref --sort=-creatordate --count=${limit} --format='%(refname:short)|%(objectname)|%(creatordate:iso-strict)|%(contents:subject)' refs/tags`,
    15000,
  );
  const tagShas: string[] = [];
  const tags = tagOut.split('\n').filter(Boolean).map((l) => {
    const [name, sha, date, ...rest] = l.replace(/^'|'$/g, '').split('|');
    if (sha) tagShas.push(sha);
    return { name, sha: sha ?? '', date: date ?? '', subject: rest.join('|') };
  });

  // 2) Commits des Ziel-Branches
  const logOut = gitSafe(
    repoRoot,
    `log --max-count=${limit} --format='%H|%h|%cI|%s' ${upstream}`,
    20000,
  );
  const commits = logOut.split('\n').filter(Boolean).map((l) => {
    const [sha, short, date, ...rest] = l.replace(/^'|'$/g, '').split('|');
    return { sha, short, date, subject: rest.join('|') };
  });

  const verMap = versionsFor(repoRoot, [...new Set([...commits.map((c) => c.sha), ...tagShas, headSha].filter(Boolean))]);

  // Spitze des Branches = immer angebotene „neueste Version“
  if (tipSha) {
    const tip = commits.find((c) => c.sha === tipSha);
    pushRow({
      ref: upstream,
      type: 'branch',
      version: verMap.get(tipSha) ?? '',
      shortSha: tipSha.slice(0, 7),
      date: tip?.date ?? '',
      subject: tip?.subject ?? '',
      current: tipSha === headSha,
      latest: true,
    });
  }

  for (const t of tags) {
    pushRow({
      ref: t.name,
      type: 'tag',
      version: verMap.get(t.sha) || t.name.replace(/^v/, ''),
      shortSha: t.sha.slice(0, 7),
      date: t.date,
      subject: t.subject,
      current: t.sha === headSha,
      latest: false,
    });
  }

  for (const c of commits) {
    if (c.sha === tipSha) continue;   // schon als „neueste Version“ enthalten
    pushRow({
      ref: c.sha,
      type: 'commit',
      version: verMap.get(c.sha) ?? '',
      shortSha: c.short,
      date: c.date,
      subject: c.subject,
      current: c.sha === headSha,
      latest: false,
    });
  }

  return rows;
}
