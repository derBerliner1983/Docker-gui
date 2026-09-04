import { useEffect, useRef, useState, useCallback } from 'react';
import { TerminalSquare, RotateCcw, Power, ShieldAlert, UserRound, LogIn, Server, SlidersHorizontal } from 'lucide-react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import type { TerminalInfo, TerminalMode } from '../lib/types';

type Conn = 'connecting' | 'open' | 'closed';

interface Choice { mode: TerminalMode; user?: string }

const MODE_PREF = 'terminalMode';
const USER_PREF = 'terminalUser';

const MODE_META: Record<TerminalMode, { label: string; hint: string; icon: typeof Server }> = {
  root: {
    label: 'Als Administrator (root)',
    hint: 'Volle Rechte auf dem Server. Nur nutzen, wenn du wirklich Systemänderungen vornimmst.',
    icon: ShieldAlert,
  },
  user: {
    label: 'Als Linux-Benutzer',
    hint: 'Öffnet die Shell direkt mit der Kennung eines auf dem Rechner vorhandenen Kontos – ohne Passwortabfrage.',
    icon: UserRound,
  },
  login: {
    label: 'Am Terminal anmelden',
    hint: 'Das Terminal fragt selbst nach Benutzername und Passwort – wie an einer echten Konsole.',
    icon: LogIn,
  },
  service: {
    label: 'Als Dienstkonto',
    hint: 'Ohne erhöhte Rechte, mit der Kennung des Core-Hub-Dienstes.',
    icon: Server,
  },
};

const MODE_ORDER: TerminalMode[] = ['login', 'user', 'root', 'service'];

/** Kurzbeschreibung der laufenden Sitzung für die Kopfzeile. */
function describe(choice: Choice, info: TerminalInfo | null): string {
  if (choice.mode === 'user') return `${tt('Linux-Konto')}: ${choice.user}`;
  if (choice.mode === 'service') return `${tt('Dienstkonto')}: ${info?.serviceUser ?? 'core-hub'}`;
  return tt(MODE_META[choice.mode].label);
}

/** Auswahl der Ausführungsart – wird vor dem Verbinden angezeigt. */
function ModePicker({
  info, initial, onStart,
}: { info: TerminalInfo; initial: Choice | null; onStart: (c: Choice, remember: boolean) => void }) {
  const firstAvailable = MODE_ORDER.find((m) => info.modes[m]?.available) ?? 'service';
  const [mode, setMode] = useState<TerminalMode>(
    initial && info.modes[initial.mode]?.available ? initial.mode : firstAvailable,
  );
  const [linuxUser, setLinuxUser] = useState(
    initial?.user && info.users.some((u) => u.name === initial.user)
      ? initial.user
      : info.users.find((u) => u.uid !== 0)?.name ?? info.users[0]?.name ?? '',
  );
  const [remember, setRemember] = useState(false);

  const canStart = info.modes[mode]?.available && (mode !== 'user' || !!linuxUser);

  return (
    <div className="card" style={{ padding: 18, maxWidth: 620, margin: '0 auto', width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <TerminalSquare size={16} />
        <strong style={{ fontSize: 14 }}>{tt('Wie soll das Terminal ausgeführt werden?')}</strong>
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 14 }}>
        {tt('Die Shell läuft auf dem Server. Wähle, mit welcher Kennung sie gestartet wird.')}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {MODE_ORDER.map((m) => {
          const meta = MODE_META[m];
          const state = info.modes[m] ?? { available: false, reason: null };
          const Icon = meta.icon;
          const active = mode === m;
          return (
            <label
              key={m}
              style={{
                display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
                background: active ? 'var(--color-accent-soft)' : 'transparent',
                borderRadius: 8, cursor: state.available ? 'pointer' : 'not-allowed',
                opacity: state.available ? 1 : 0.55,
              }}
            >
              <input
                type="radio" name="terminal-mode" checked={active} disabled={!state.available}
                onChange={() => setMode(m)} style={{ marginTop: 3 }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}>
                  <Icon size={14} /> {tt(meta.label)}
                  {m === 'service' && <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>({info.serviceUser})</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 3 }}>{tt(meta.hint)}</div>
                {!state.available && state.reason && (
                  <div style={{ fontSize: 11.5, color: 'var(--color-warning)', marginTop: 4 }}>{tt(state.reason)}</div>
                )}
                {m === 'user' && active && (
                  <select
                    className="input input--rect"
                    value={linuxUser}
                    onChange={(e) => setLinuxUser(e.target.value)}
                    style={{ marginTop: 8, maxWidth: 260 }}
                  >
                    {info.users.map((u) => (
                      <option key={u.name} value={u.name}>{u.name} (UID {u.uid})</option>
                    ))}
                  </select>
                )}
              </div>
            </label>
          );
        })}
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, fontSize: 12.5, color: 'var(--color-muted)' }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        {tt('Auswahl merken und künftig nicht mehr fragen')}
      </label>

      <button
        className="btn btn--primary btn--sm"
        style={{ marginTop: 14 }}
        disabled={!canStart}
        onClick={() => onStart({ mode, user: mode === 'user' ? linuxUser : undefined }, remember)}
      >
        <TerminalSquare size={13} /> {tt('Terminal öffnen')}
      </button>
    </div>
  );
}

export function Terminal() {
  const t = useT();
  const { prefs, setPref, loaded } = usePrefs();
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<Conn>('connecting');
  const [reconnectKey, setReconnectKey] = useState(0);
  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [infoError, setInfoError] = useState('');
  const [choice, setChoice] = useState<Choice | null>(null);
  // Eine gemerkte Auswahl wird genau einmal je Seitenaufruf angewendet – sonst
  // würde „Ausführungsart ändern" sofort wieder überschrieben.
  const autoApplied = useRef(false);

  // Verfügbare Ausführungsarten laden
  useEffect(() => {
    let cancelled = false;
    api.terminal.info()
      .then((i) => { if (!cancelled) setInfo(i); })
      .catch((err) => { if (!cancelled) setInfoError(err instanceof Error ? err.message : 'Fehler'); });
    return () => { cancelled = true; };
  }, []);

  // Gemerkte Auswahl anwenden, sobald Einstellungen und Server-Infos da sind
  useEffect(() => {
    if (autoApplied.current || !info || !loaded) return;
    autoApplied.current = true;
    const saved = prefs[MODE_PREF] as TerminalMode | undefined;
    const savedUser = prefs[USER_PREF] as string | undefined;
    if (saved && info.modes[saved]?.available && (saved !== 'user' || info.users.some((u) => u.name === savedUser))) {
      setChoice({ mode: saved, user: saved === 'user' ? savedUser : undefined });
    }
  }, [info, loaded, prefs]);

  const connect = useCallback((term: XTerm, fit: FitAddon, sel: Choice) => {
    setStatus('connecting');
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/api/terminal`);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('open');
      fit.fit();
      // Ausführungsart zuerst – der Server startet die Shell erst danach.
      ws.send(JSON.stringify({ type: 'start', mode: sel.mode, user: sel.user, cols: term.cols, rows: term.rows }));
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      term.focus();
    };
    ws.onmessage = (ev) => { term.write(typeof ev.data === 'string' ? ev.data : ''); };
    ws.onclose = () => {
      setStatus('closed');
      term.write(`\r\n\x1b[33m── ${tt('Verbindung getrennt')} ──\x1b[0m\r\n`);
    };
    ws.onerror = () => { setStatus('closed'); };

    const onData = term.onData((d) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'data', data: d }));
    });
    return () => { onData.dispose(); ws.close(); };
  }, []);

  useEffect(() => {
    if (!choice) return;
    if (!containerRef.current) return;
    const term = new XTerm({
      fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', Consolas, 'Courier New', monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#1C1C1F',
        foreground: '#F4F4F5',
        cursor: '#34D399',
        selectionBackground: '#3f3f46',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    const cleanupConn = connect(term, fit, choice);

    const doResize = () => {
      try {
        fit.fit();
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      } catch { /* */ }
    };

    // ResizeObserver reagiert auf Sidebar, Fenstergröße und Layout-Änderungen
    const ro = new ResizeObserver(doResize);
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      cleanupConn();
      term.dispose();
    };
  }, [connect, reconnectKey, choice]);

  const reconnect = () => setReconnectKey((k) => k + 1);

  const start = (sel: Choice, remember: boolean) => {
    if (remember) {
      setPref(MODE_PREF, sel.mode);
      setPref(USER_PREF, sel.user ?? '');
    }
    setChoice(sel);
  };

  /** Zurück zur Auswahl – bestehende Sitzung wird beendet. */
  const changeMode = () => {
    setPref(MODE_PREF, '');
    wsRef.current?.close();
    setChoice(null);
    setStatus('connecting');
  };

  const statusBadge = status === 'open'
    ? <span className="badge badge--running"><span className="badge__dot" />{tt('verbunden')}</span>
    : status === 'connecting'
      ? <span className="badge badge--restarting"><span className="badge__dot" />{tt('verbinde…')}</span>
      : <span className="badge badge--stopped"><span className="badge__dot" />{tt('getrennt')}</span>;

  return (
    <>
      <Topbar
        title={t('nav.terminal')}
        subtitle={choice ? describe(choice, info) : t('page.terminal.subtitle')}
        actions={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {choice && statusBadge}
            {choice && (
              <>
                <button className="btn btn--outline btn--sm" onClick={changeMode} title={tt('Ausführungsart ändern')}>
                  <SlidersHorizontal size={13} /> {tt('Ausführungsart')}
                </button>
                <button className="btn btn--outline btn--sm" onClick={reconnect} title={tt('Neu verbinden')}>
                  {status === 'closed' ? <Power size={13} /> : <RotateCcw size={13} />} {tt('Neu verbinden')}
                </button>
              </>
            )}
          </div>
        }
      />
      {/* .page wird bewusst überschrieben, damit das Terminal die Resthöhe füllt */}
      <main style={{ flex: 1, overflow: 'auto', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!choice ? (
          infoError ? (
            <div className="card" style={{ padding: 16, maxWidth: 620, margin: '0 auto', width: '100%' }}>
              <div className="login-error">{infoError}</div>
            </div>
          ) : info ? (
            <ModePicker
              info={info}
              initial={{
                mode: (prefs[MODE_PREF] as TerminalMode) || info.defaultMode,
                user: (prefs[USER_PREF] as string) || undefined,
              }}
              onStart={start}
            />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
              <span className="spinner" style={{ width: 22, height: 22 }} />
            </div>
          )
        ) : (
          <>
            <div className="card" style={{ padding: 0, overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--color-border)', color: 'var(--color-subtle)', fontSize: 12.5, flexShrink: 0 }}>
                <TerminalSquare size={15} />
                <span>{tt('Interaktive Shell – Befehle werden direkt auf dem Server ausgeführt.')}</span>
                <span style={{ marginLeft: 'auto', color: 'var(--color-faint)' }}>{describe(choice, info)}</span>
              </div>
              {/* position:relative wegen xterm-viewport (absolut). Kein padding: sonst schneidet FitAddon ab. */}
              <div ref={containerRef} style={{ flex: 1, background: '#1C1C1F', minHeight: 0, position: 'relative', overflow: 'hidden' }} />
            </div>
            <div className="form-hint" style={{ flexShrink: 0 }}>
              {choice.mode === 'root'
                ? tt('⚠️ Diese Konsole läuft mit Root-Rechten auf dem Server. Sei vorsichtig mit Befehlen, die das System verändern.')
                : tt('Die Konsole läuft auf dem Server mit den Rechten der gewählten Kennung.')}
            </div>
          </>
        )}
      </main>
    </>
  );
}
