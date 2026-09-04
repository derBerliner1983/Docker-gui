import type { FastifyInstance } from 'fastify';
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import os from 'os';
import { auditQueries } from '../db/index';
import { isRoot, safeExec, execOutput } from '../lib/privilege';

// node-pty ist eine optionale (native) Abhängigkeit. Wenn sie nicht gebaut
// werden konnte, fallen wir auf `script` zurück (ohne Live-Resize).
interface PtyLike {
  onData: (cb: (d: string) => void) => void;
  /** Beendet – mit Exit-Code und Signal, soweit bekannt. */
  onExit: (cb: (info: { exitCode: number | null; signal: number | null }) => void) => void;
  write: (d: string) => void;
  resize: (cols: number, rows: number) => void;
  kill: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodePty: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  nodePty = require('node-pty');
} catch {
  nodePty = null;
}

// ── Ausführungsarten ─────────────────────────────────────────────────────────
// Nicht jede Installation hat root, und nicht jeder Benutzer der Oberfläche hat
// eine eigene Linux-Kennung. Darum legt der Benutzer beim Öffnen fest, wie die
// Shell gestartet wird.
export type TerminalMode = 'root' | 'user' | 'login' | 'service';

/** Absoluten Pfad eines Systemprogramms suchen (Distributionen legen es unterschiedlich ab). */
function findBin(name: string): string | null {
  for (const dir of ['/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
    const p = `${dir}/${name}`;
    try { if (fs.existsSync(p)) return p; } catch { /* */ }
  }
  const found = safeExec(`command -v ${name.replace(/[^a-zA-Z0-9_-]/g, '')} 2>/dev/null`).trim();
  return found || null;
}

const SU_BIN = findBin('su');
const LOGIN_BIN = findBin('login');
const BASH_BIN = findBin('bash') ?? '/bin/bash';

const SUDOERS_FILE = '/etc/sudoers.d/core-hub';

// Das Ergebnis kurz merken: die Prüfung startet einen sudo-Prozess und wird
// bei jeder Eingabe im Terminal gebraucht.
let rootCheck: { at: number; ok: boolean; detail: string } | null = null;

/**
 * Kann der Dienst (ohne Passwort) zu root wechseln?
 *
 * Schlägt das fehl, ist die Ursache fast immer die sudoers-Allowlist – und die
 * kennt nur sudo selbst. Deshalb wird die Fehlerausgabe aufgehoben und der
 * Oberfläche mitgegeben: „kein passwortloses sudo" allein hilft niemandem
 * weiter, „is not allowed to execute" oder „a password is required" schon.
 */
function checkRoot(): { ok: boolean; detail: string } {
  if (isRoot) return { ok: true, detail: '' };
  if (rootCheck && Date.now() - rootCheck.at < 60_000) return rootCheck;
  let ok = false;
  let detail = '';
  try {
    // -n: niemals nach einem Passwort fragen. Erfolg heißt: sudoers erlaubt bash.
    execFileSync('sudo', ['-n', BASH_BIN, '-c', 'exit 0'], { timeout: 5000, stdio: 'pipe' });
    ok = true;
  } catch (err) {
    ok = false;
    // Erste nicht-leere Zeile der sudo-Ausgabe, gekürzt – das ist die Aussage.
    detail = execOutput(err).split('\n').map((l) => l.trim()).filter(Boolean)[0]?.slice(0, 160) ?? '';
  }
  rootCheck = { at: Date.now(), ok, detail };
  return rootCheck;
}

function canBecomeRoot(): boolean {
  return checkRoot().ok;
}

/** Verständlicher Grund, warum die root-Wege gerade nicht angeboten werden. */
function rootReason(): string {
  const { detail } = checkRoot();
  const sudoersMissing = !fs.existsSync(SUDOERS_FILE);
  const parts = [
    `Der Dienst (${serviceUserName()}) darf nicht ohne Passwort zu root wechseln.`,
    detail ? `sudo meldet: „${detail}"` : '',
    sudoersMissing
      ? `Die Datei ${SUDOERS_FILE} fehlt.`
      : `Die Datei ${SUDOERS_FILE} ist vorhanden, erlaubt aber ${BASH_BIN} offenbar nicht.`,
    'Beheben mit: sudo bash install.sh --fix-perms (danach diese Seite neu laden).',
  ];
  return parts.filter(Boolean).join(' ');
}

/**
 * Läuft „login" auf diesem System überhaupt durch?
 *
 * login hängt beim Start sein Terminal auf (vhangup). Steckt zwischen uns und
 * login noch ein zweites Pseudo-Terminal – und genau das legt sudo an, seit
 * 1.9.14 standardmäßig und bei sudo-rs (Arch/CachyOS) immer – reißt dieser
 * Hangup die ganze Kette mit: der Prozess endet nach wenigen Millisekunden mit
 * SIGHUP, der Browser sieht nur „Verbindung getrennt".
 *
 * Ob es klappt, hängt damit an der sudo-Variante und lässt sich nicht aus
 * Versionsnummern ableiten. Deshalb wird es einmal wirklich ausprobiert: login
 * startet in einem Wegwerf-Terminal, und wenn es nach einer halben Sekunde noch
 * lebt, wird es sofort wieder beendet. Läuft der Dienst als root, entfällt der
 * Umweg über sudo – dann funktioniert login ohnehin.
 */
let loginProbe: { at: number; ok: boolean; detail: string } | null = null;

async function probeLogin(): Promise<{ ok: boolean; detail: string }> {
  if (isRoot) return { ok: true, detail: '' };
  if (loginProbe && Date.now() - loginProbe.at < 300_000) return loginProbe;
  let result: { ok: boolean; detail: string };
  if (!nodePty) {
    // Ohne node-pty läuft alles über „script"; dort ist dasselbe Problem zu
    // erwarten, aber nicht zuverlässig prüfbar – dann lieber anbieten.
    result = { ok: true, detail: '' };
  } else {
    try {
      const spec = shellSpec('login');
      result = await new Promise((resolve) => {
        let done = false;
        let exit: { exitCode: number; signal?: number } | null = null;
        let term: { onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => void; kill: () => void };
        try {
          term = nodePty.spawn(spec.cmd, spec.args, {
            name: 'xterm-256color', cols: 80, rows: 24, cwd: spec.cwd,
            env: { ...process.env, TERM: 'xterm-256color' },
          });
        } catch (e) {
          resolve({ ok: false, detail: e instanceof Error ? e.message : 'Start fehlgeschlagen' });
          return;
        }
        term.onExit((e) => { exit = e; });
        setTimeout(() => {
          if (done) return;
          done = true;
          if (exit) {
            const how = exit.signal ? `Signal ${exit.signal}` : `Exit-Code ${exit.exitCode}`;
            resolve({ ok: false, detail: how });
          } else {
            try { term.kill(); } catch { /* */ }
            resolve({ ok: true, detail: '' });
          }
        }, 500);
      });
    } catch (e) {
      result = { ok: false, detail: e instanceof Error ? e.message : 'nicht möglich' };
    }
  }
  loginProbe = { at: Date.now(), ...result };
  return loginProbe;
}

export interface LinuxUser { name: string; uid: number; shell: string; home: string }

/**
 * Anmeldefähige Linux-Benutzer des Rechners: normale Konten (UID ≥ 1000) und
 * root. Systemkonten und Konten ohne Shell bleiben außen vor – ein Terminal
 * mit /usr/sbin/nologin wäre nur verwirrend.
 */
export function listLinuxUsers(): LinuxUser[] {
  let content = '';
  try { content = fs.readFileSync('/etc/passwd', 'utf8'); } catch { return []; }
  const users: LinuxUser[] = [];
  for (const line of content.split('\n')) {
    const parts = line.split(':');
    if (parts.length < 7) continue;
    const [name, , uidStr, , , home, shell] = parts;
    const uid = parseInt(uidStr, 10);
    if (!name || Number.isNaN(uid)) continue;
    if (uid !== 0 && uid < 1000) continue;
    if (uid >= 65534) continue;                       // nobody
    if (/(nologin|\/false)$/.test(shell)) continue;
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) continue;    // nur unbedenkliche Namen
    users.push({ name, uid, shell, home });
  }
  return users.sort((a, b) => (a.uid === 0 ? -1 : b.uid === 0 ? 1 : a.name.localeCompare(b.name)));
}

/** Name des Kontos, unter dem der Dienst selbst läuft. */
function serviceUserName(): string {
  try { return os.userInfo().username; } catch { return process.env.USER || 'core-hub'; }
}

/** Shell-Quoting für einen einzelnen Parameter. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

interface ShellSpec { cmd: string; args: string[]; cwd: string }

/**
 * Baut den Startbefehl für die gewünschte Ausführungsart.
 * Wirft mit einer verständlichen Meldung, wenn die Art hier nicht möglich ist.
 */
function shellSpec(mode: TerminalMode, targetUser?: string): ShellSpec {
  const home = process.env.HOME && process.env.HOME !== '/root' ? process.env.HOME : '/';
  // cwd muss für den Dienstbenutzer lesbar sein – gewechselt wird erst danach.
  const cwd = fs.existsSync(home) ? home : '/';
  const root = canBecomeRoot();

  if (mode === 'service') {
    return { cmd: BASH_BIN, args: ['-l'], cwd };
  }

  if (mode === 'root') {
    if (isRoot) return { cmd: BASH_BIN, args: ['-l'], cwd };
    if (!root) throw new Error('Keine Root-Rechte verfügbar – bitte eine andere Ausführungsart wählen.');
    return { cmd: 'sudo', args: ['-n', BASH_BIN, '-l'], cwd };
  }

  if (mode === 'user') {
    const name = (targetUser ?? '').trim();
    if (!listLinuxUsers().some((u) => u.name === name)) {
      throw new Error('Unbekannter Linux-Benutzer.');
    }
    if (!SU_BIN) throw new Error('„su" ist auf diesem System nicht vorhanden.');
    if (isRoot) return { cmd: SU_BIN, args: ['-', name], cwd };
    if (!root) throw new Error('Ohne Root-Rechte ist kein Benutzerwechsel möglich – bitte „Am Terminal anmelden" wählen.');
    // sudoers erlaubt bash als root; su erbt diese Rechte und fragt daher nicht nach einem Passwort.
    return { cmd: 'sudo', args: ['-n', BASH_BIN, '-c', `exec ${shq(SU_BIN)} - ${shq(name)}`], cwd };
  }

  // mode === 'login': Benutzername und Passwort werden im Terminal abgefragt.
  if (!LOGIN_BIN) throw new Error('„login" ist auf diesem System nicht vorhanden.');
  if (isRoot) return { cmd: LOGIN_BIN, args: [], cwd: '/' };
  if (!root) throw new Error('Für die Anmeldung am Terminal werden Root-Rechte benötigt.');
  return { cmd: 'sudo', args: ['-n', BASH_BIN, '-c', `exec ${shq(LOGIN_BIN)}`], cwd: '/' };
}

/** Startet eine interaktive Shell in der gewünschten Ausführungsart. */
function startShell(mode: TerminalMode, targetUser: string | undefined, cols: number, rows: number): PtyLike {
  const spec = shellSpec(mode, targetUser);
  const env = { ...process.env, TERM: 'xterm-256color', LANG: process.env.LANG || 'C.UTF-8' };

  if (nodePty) {
    const term = nodePty.spawn(spec.cmd, spec.args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: spec.cwd,
      env,
    });
    return {
      onData: (cb) => term.onData(cb),
      onExit: (cb) => term.onExit((e: { exitCode: number; signal?: number }) =>
        cb({ exitCode: e?.exitCode ?? null, signal: e?.signal ?? null })),
      write: (d) => term.write(d),
      resize: (c, r) => { try { term.resize(c || 80, r || 24); } catch { /* */ } },
      kill: () => { try { term.kill(); } catch { /* */ } },
    };
  }

  // Fallback: util-linux `script` erzeugt ebenfalls ein PTY (kein Live-Resize)
  const innerCmd = [spec.cmd, ...spec.args].map(shq).join(' ');
  const child: ChildProcessWithoutNullStreams = spawn('script', ['-qfc', innerCmd, '/dev/null'], {
    cwd: spec.cwd,
    env: { ...env, COLUMNS: String(cols || 80), LINES: String(rows || 24) },
  }) as ChildProcessWithoutNullStreams;
  return {
    onData: (cb) => { child.stdout.on('data', (d) => cb(d.toString())); child.stderr.on('data', (d) => cb(d.toString())); },
    onExit: (cb) => child.on('close', (code: number | null, signal: NodeJS.Signals | null) =>
      cb({ exitCode: code, signal: signal ? 1 : null })),
    write: (d) => { try { child.stdin.write(d); } catch { /* */ } },
    resize: () => { /* script unterstützt kein Live-Resize */ },
    kill: () => { try { child.kill(); } catch { /* */ } },
  };
}

interface ClientMsg {
  type: 'data' | 'resize' | 'start';
  data?: string;
  cols?: number;
  rows?: number;
  mode?: TerminalMode;
  user?: string;
}

const MODES: TerminalMode[] = ['root', 'user', 'login', 'service'];

export async function terminalRoutes(fastify: FastifyInstance) {
  // Infos für das Frontend: welche Ausführungsarten stehen zur Verfügung?
  fastify.get('/api/terminal/info', async (req, reply) => {
    try { await req.jwtVerify(); } catch { return reply.status(401).send({ error: 'Unauthorized' }); }
    if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Admin erforderlich' });
    const root = canBecomeRoot();
    const users = listLinuxUsers();
    const loginOk = root && !!LOGIN_BIN ? await probeLogin() : { ok: false, detail: '' };
    reply.send({
      available: true,
      resize: !!nodePty,
      runningAsRoot: isRoot,
      serviceUser: serviceUserName(),
      users,
      modes: {
        root: { available: root, reason: root ? null : rootReason() },
        user: {
          available: root && !!SU_BIN && users.length > 0,
          reason: !SU_BIN ? '„su" ist auf diesem System nicht vorhanden.' : !root ? rootReason() : null,
        },
        login: {
          available: root && !!LOGIN_BIN && loginOk.ok,
          reason: !LOGIN_BIN
            ? '„login" fehlt (Paket util-linux).'
            : !root
              ? rootReason()
              : loginOk.ok
                ? null
                : `„login" beendet sich hier sofort wieder (${loginOk.detail}). Es hängt beim Start das Terminal auf,`
                  + ' was durch das zusätzliche Pseudo-Terminal von sudo die ganze Sitzung mitnimmt – bekannt bei'
                  + ' sudo-rs (Arch/CachyOS). „Als Linux-Benutzer" macht dasselbe ohne Passwortabfrage.',
        },
        service: { available: true, reason: null },
      },
      defaultMode: (root ? 'root' : 'service') as TerminalMode,
    });
  });

  fastify.get('/api/terminal', { websocket: true }, (ws, req) => {
    // @fastify/websocket v11 (Fastify 5): der Handler bekommt den WebSocket direkt.

    // Authentifizierung über JWT-Cookie (vom Browser automatisch gesendet)
    void (async () => {
      try {
        await req.jwtVerify();
      } catch {
        ws.close(1008, 'Unauthorized');
        return;
      }
      if (req.user.role !== 'admin') {
        ws.close(1008, 'Admin erforderlich');
        return;
      }

      let term: PtyLike | null = null;
      let started = false;

      const start = (mode: TerminalMode, targetUser: string | undefined, cols: number, rows: number) => {
        if (started) return;
        started = true;
        try {
          term = startShell(mode, targetUser, cols, rows);
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Shell konnte nicht gestartet werden';
          try { ws.send(`\r\n\x1b[31m${msg}\x1b[0m\r\n`); } catch { /* */ }
          try { ws.close(1011, 'shell-start-failed'); } catch { /* */ }
          return;
        }
        auditQueries.log.run(req.user.id, 'terminal.open', mode === 'user' ? `user:${targetUser}` : mode);
        term.onData((d) => { try { ws.send(d); } catch { /* */ } });
        // Beendet sich die Shell sofort (z. B. weil „login" auf diesem System
        // nicht durchkommt), sah man bisher nur „Verbindung getrennt". Jetzt
        // steht der Exit-Code da – und der Browser bekommt noch die letzten
        // Ausgabezeilen, bevor der Kanal zugeht.
        const startedAt = Date.now();
        term.onExit(({ exitCode, signal }) => {
          const ms = Date.now() - startedAt;
          if (ms < 3000 || (exitCode !== 0 && exitCode !== null)) {
            const how = signal ? `Signal ${signal}` : `Exit-Code ${exitCode ?? '?'}`;
            const hint = mode === 'login' && ms < 3000
              ? '\r\n\x1b[33m   „login" ließ sich hier nicht starten. Andere Ausführungsart wählen '
                + '(„Als Linux-Benutzer" fragt nicht nach einem Passwort, „Als Administrator" gibt root).\x1b[0m'
              : '';
            try { ws.send(`\r\n\x1b[33m── Shell beendet nach ${ms} ms (${how}) ──\x1b[0m${hint}\r\n`); } catch { /* */ }
          }
          // kurz warten, damit die letzten Bytes den Browser noch erreichen
          setTimeout(() => { try { ws.close(); } catch { /* */ } }, 200);
        });
      };

      // Ohne ausdrückliche Wahl (z.B. alte Oberfläche) bleibt es beim bisherigen
      // Verhalten: root, sonst das Dienstkonto.
      const startDefault = (cols: number, rows: number) => {
        if (started) return;
        start(canBecomeRoot() ? 'root' : 'service', undefined, cols, rows);
      };

      ws.on('message', (raw: Buffer) => {
        let msg: ClientMsg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'start') {
          const mode = MODES.includes(msg.mode as TerminalMode) ? (msg.mode as TerminalMode) : 'service';
          start(mode, msg.user, msg.cols ?? 80, msg.rows ?? 24);
        } else if (msg.type === 'resize') {
          startDefault(msg.cols ?? 80, msg.rows ?? 24);
          term?.resize(msg.cols ?? 80, msg.rows ?? 24);
        } else if (msg.type === 'data' && typeof msg.data === 'string') {
          startDefault(80, 24);
          term?.write(msg.data);
        }
      });

      ws.on('close', () => { term?.kill(); });
      ws.on('error', () => { term?.kill(); });
    })();
  });
}
