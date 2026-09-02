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

// ── Git-Ausgaben mit mehrzeiligen Feldern lesen ─────────────────────────────
// Commit-Nachrichten enthalten Zeilenumbrüche, deshalb trennen wir Felder mit
// 0x1f (unit separator) und Datensätze mit 0x1e (record separator) statt mit
// "|" und "\n" – so bleibt der Fließtext unbeschädigt.
const FS = '\x1f';
const RS = '\x1e';
/** Format für `git log`: SHA, Kurz-SHA, Datum, Autor, Betreff, Text. */
const FMT_LOG = "'%H%x1f%h%x1f%cI%x1f%an%x1f%s%x1f%b%x1e'";
/** Format für `git for-each-ref`: Name, Objekt, Datum, Autor, Betreff, Text. */
const FMT_TAG = "'%(refname:short)%1f%(objectname)%1f%(creatordate:iso-strict)%1f%(taggername)%1f%(contents:subject)%1f%(contents:body)%1e'";

function splitRecords(out: string): string[][] {
  return out.split(RS)
    .map((r) => r.replace(/^[\r\n]+/, ''))
    .filter((r) => r.trim().length > 0)
    .map((r) => r.split(FS));
}

export interface CommitInfo {
  sha: string;
  short: string;
  date: string;
  author: string;
  subject: string;
  /** Ausführlicher Text der Commit-Nachricht (kann leer sein). */
  body: string;
}

/** Commits eines Bereichs/Refs einlesen (inkl. mehrzeiligem Text). */
function readCommits(repoRoot: string, range: string, limit: number): CommitInfo[] {
  const out = gitSafe(repoRoot, `log --max-count=${limit} --format=${FMT_LOG} ${JSON.stringify(range)}`, 20000);
  return splitRecords(out).map(([sha, short, date, author, subject, body]) => ({
    sha: (sha ?? '').trim(),
    short: (short ?? '').trim(),
    date: (date ?? '').trim(),
    author: (author ?? '').trim(),
    subject: subject ?? '',
    body: (body ?? '').trim(),
  })).filter((c) => c.sha);
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
  /** Autor des Commits/Tags. */
  author: string;
  /** Ausführlicher Text (Commit-Body bzw. Tag-Beschreibung) – kann leer sein. */
  body: string;
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
    `for-each-ref --sort=-creatordate --count=${limit} --format=${FMT_TAG} refs/tags`,
    15000,
  );
  const tagShas: string[] = [];
  const tags = splitRecords(tagOut).map((rec) => {
    const [name, sha, date, author, subject, body] = rec;
    if (sha) tagShas.push(sha);
    return { name: name ?? '', sha: sha ?? '', date: date ?? '', author: author ?? '', subject: subject ?? '', body: (body ?? '').trim() };
  });

  // 2) Commits des Ziel-Branches
  const commits = readCommits(repoRoot, upstream, limit);

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
      author: tip?.author ?? '',
      body: tip?.body ?? '',
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
      author: t.author,
      // Ein annotiertes Tag hat einen eigenen Text; sonst den des Commits nehmen.
      body: t.body || commits.find((c) => c.sha === t.sha)?.body || '',
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
      author: c.author,
      body: c.body,
      current: c.sha === headSha,
      latest: false,
    });
  }

  return rows;
}

// ── Was bringt ein Stand? (Änderungsnotizen) ────────────────────────────────

export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
}

export interface UpdateNotes {
  /** Angefragter Ref (Branch, Tag oder Commit). */
  ref: string;
  sha: string;
  shortSha: string;
  version: string;
  date: string;
  author: string;
  /** Überschrift des Ziel-Commits/Tags. */
  subject: string;
  /** Ausführlicher Text des Ziel-Commits/Tags. */
  body: string;
  /** Aktuell installierter Stand, gegen den verglichen wird. */
  currentSha: string;
  currentVersion: string;
  /**
   * forward  = Ziel liegt vor dem installierten Stand (normales Update)
   * backward = Ziel liegt davor (Rollback – die Commits werden entfernt)
   * same     = bereits installiert
   * diverged = kein gemeinsamer, gerader Verlauf
   */
  direction: 'forward' | 'backward' | 'same' | 'diverged';
  /** Die Commits, die dazukommen (forward) bzw. wegfallen (backward). */
  commits: CommitInfo[];
  /** true, wenn die Liste wegen der Obergrenze gekürzt wurde. */
  truncated: boolean;
  files: ChangedFile[];
  filesTruncated: boolean;
  insertions: number;
  deletions: number;
}

/** Prüft, ob `a` ein Vorfahre von `b` ist. */
function isAncestor(repoRoot: string, a: string, b: string): boolean {
  try {
    gitRun(repoRoot, `merge-base --is-ancestor ${JSON.stringify(a)} ${JSON.stringify(b)}`, 10000);
    return true;
  } catch { return false; }
}

/**
 * Beschreibt, was ein Wechsel auf `ref` bedeutet: Titel und Text des Ziel-Standes
 * sowie alle Commits und geänderten Dateien zwischen dem installierten Stand und
 * dem Ziel. Damit lässt sich vor dem Update entscheiden, ob man ihn haben will.
 */
export function getUpdateNotes(repoRoot: string, ref: string, maxCommits = 100, maxFiles = 200): UpdateNotes {
  const { upstream } = syncRemote(repoRoot);
  const target = ref || upstream;
  const sha = gitSafe(repoRoot, `rev-parse ${JSON.stringify(`${target}^{commit}`)}`, 10000).trim();
  if (!sha) throw new Error(`Zielstand „${target}" nicht gefunden.`);
  const currentSha = gitSafe(repoRoot, 'rev-parse HEAD', 6000).trim();

  const head = readCommits(repoRoot, sha, 1)[0];
  const verMap = versionsFor(repoRoot, [sha, currentSha].filter(Boolean));

  // Bei einem annotierten Tag den Tag-Text bevorzugen (dort stehen die Release-Notes).
  let subject = head?.subject ?? '';
  let body = head?.body ?? '';
  if (ref && !ref.startsWith('origin/') && !/^[0-9a-f]{7,40}$/.test(ref)) {
    const tagOut = gitSafe(repoRoot, `for-each-ref --format=${FMT_TAG} ${JSON.stringify(`refs/tags/${ref}`)}`, 10000);
    const rec = splitRecords(tagOut)[0];
    if (rec) {
      if ((rec[4] ?? '').trim()) subject = rec[4];
      if ((rec[5] ?? '').trim()) body = rec[5].trim();
    }
  }

  let direction: UpdateNotes['direction'] = 'diverged';
  let range = '';
  if (sha === currentSha) {
    direction = 'same';
  } else if (isAncestor(repoRoot, currentSha, sha)) {
    direction = 'forward';
    range = `${currentSha}..${sha}`;
  } else if (isAncestor(repoRoot, sha, currentSha)) {
    direction = 'backward';
    range = `${sha}..${currentSha}`;
  } else {
    range = `${currentSha}...${sha}`;   // symmetrische Differenz als Näherung
  }

  // Eine Zeile mehr holen, um „gekürzt" sicher zu erkennen.
  const commitsRaw = range ? readCommits(repoRoot, range, maxCommits + 1) : [];
  const truncated = commitsRaw.length > maxCommits;
  const commits = commitsRaw.slice(0, maxCommits);

  const files: ChangedFile[] = [];
  let fileCount = 0;
  let insertions = 0;
  let deletions = 0;
  if (direction !== 'same') {
    // Immer vom installierten Stand zum Ziel – bei einem Rollback ist das die
    // Rückwärts-Differenz, also genau das, was auf der Platte passieren wird.
    const stat = gitSafe(repoRoot, `diff --numstat ${JSON.stringify(`${currentSha}..${sha}`)}`, 25000);
    for (const line of stat.split('\n')) {
      const m = line.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
      if (!m) continue;
      const added = m[1] === '-' ? 0 : parseInt(m[1], 10);
      const deleted = m[2] === '-' ? 0 : parseInt(m[2], 10);
      insertions += added;
      deletions += deleted;
      fileCount++;
      if (files.length < maxFiles) files.push({ path: m[3], added, deleted });
    }
  }

  return {
    ref: target,
    sha,
    shortSha: sha.slice(0, 7),
    version: verMap.get(sha) ?? '',
    date: head?.date ?? '',
    author: head?.author ?? '',
    subject,
    body,
    currentSha,
    currentVersion: verMap.get(currentSha) ?? '',
    direction,
    commits,
    truncated,
    files,
    filesTruncated: fileCount > files.length,
    insertions,
    deletions,
  };
}
