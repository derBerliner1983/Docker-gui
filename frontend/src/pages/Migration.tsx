import { useState, useEffect, useRef, useCallback } from 'react';
import { ArrowRightLeft, CheckCircle, XCircle, Clock, Loader, Play, Trash2, Plus, RefreshCw, Key, ChevronDown, ChevronUp, AlertTriangle, Server } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { formatBytes } from '../lib/utils';

// ── Types ──────────────────────────────────────────────────────────────────────

interface MigSession {
  session_id: string; host: string; user: string; port: number;
  appdata_src: string; appdata_dst: string; created_at: string; hasPassword?: boolean;
}
interface MigPhase {
  session_id: string; phase: string;
  status: 'pending' | 'running' | 'done' | 'error' | 'paused';
  result_json: string | null; error: string | null;
  started_at: string | null; finished_at: string | null;
}
interface MigContainer {
  session_id: string; cname: string; image: string;
  config_json: string; volumes_json: string; total_bytes: number;
  selected: number; sync_status: string; local_id: string | null; error: string | null;
}
interface VolumeInfo { type: string; source: string; target: string; bytes: number }

// ── Helpers ────────────────────────────────────────────────────────────────────

async function mreq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...(init?.headers as Record<string, string> ?? {}) } });
  if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error((b as { error?: string }).error ?? `HTTP ${res.status}`); }
  return res.json() as Promise<T>;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'badge badge--stopped', label: 'Ausstehend' },
    running: { cls: 'badge badge--running', label: 'Läuft…' },
    done:    { cls: 'badge badge--running', label: 'Fertig' },
    error:   { cls: 'badge badge--error', label: 'Fehler' },
    paused:  { cls: 'badge badge--stopped', label: 'Pausiert' },
    skipped: { cls: 'badge badge--stopped', label: 'Übersprungen' },
  };
  const { cls, label } = map[status] ?? { cls: 'badge badge--stopped', label: status };
  return <span className={cls} style={{ fontSize: 11 }}><span className="badge__dot" />{label}</span>;
}

function PhaseIcon({ status }: { status: string }) {
  if (status === 'done')    return <CheckCircle size={18} style={{ color: 'var(--color-success)' }} />;
  if (status === 'error')   return <XCircle size={18} style={{ color: 'var(--color-error)' }} />;
  if (status === 'running') return <Loader size={18} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />;
  if (status === 'paused')  return <AlertTriangle size={18} style={{ color: 'var(--color-warning)' }} />;
  return <Clock size={18} style={{ color: 'var(--color-faint)' }} />;
}

const PHASES = [
  { key: 'connect',  num: 1, label: 'Verbindung testen',       desc: 'SSH-Verbindung zum Unraid-Server herstellen und Docker-Version prüfen.' },
  { key: 'discover', num: 2, label: 'Container entdecken',     desc: 'Alle Docker-Container auf Unraid auflisten und Datenmengen ermitteln.' },
  { key: 'preflight',num: 3, label: 'Vorabprüfung',            desc: 'Freien Speicherplatz und Port-Konflikte lokal prüfen.' },
  { key: 'create',   num: 4, label: 'Konfigurationen anlegen', desc: 'Leere Container lokal anlegen (ohne Daten zu kopieren).' },
  { key: 'sync',     num: 5, label: 'Dateien synchronisieren', desc: 'App-Daten per rsync kopieren. Unterbrechung möglich – setzt dort fort, wo abgebrochen.' },
  { key: 'finalize', num: 6, label: 'Container aktivieren',    desc: 'Fertige Container starten (optional: Unraid-Container vorher stoppen).' },
];

// ── Main Component ─────────────────────────────────────────────────────────────

export function Migration() {
  const [sessions, setSessions] = useState<MigSession[]>([]);
  const [sid, setSid] = useState<string | null>(null);
  const [session, setSession] = useState<MigSession | null>(null);
  const [phases, setPhases] = useState<MigPhase[]>([]);
  const [containers, setContainers] = useState<MigContainer[]>([]);
  const [pubkey, setPubkey] = useState('');
  const [showPubkey, setShowPubkey] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [form, setForm] = useState({ host: '', user: 'root', port: '22', appdataSrc: '/mnt/user/appdata', appdataDst: '/opt/appdata', password: '' });
  const [busyPhase, setBusyPhase] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string[]>([]);
  const [expandedContainers, setExpandedContainers] = useState<string | null>(null);
  const [stopOnUnraid, setStopOnUnraid] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const syncLogRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);

  // ── Data loading ──────────────────────────────────────────────────────────────

  const loadSessions = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await mreq<{ sessions: MigSession[] }>('/api/migration/sessions');
      setSessions(data.sessions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setRefreshing(false);
    }
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const data = await mreq<{ session: MigSession; phases: MigPhase[]; containers: MigContainer[] }>(`/api/migration/sessions/${id}`);
      setSession(data.session);
      setPhases(data.phases);
      setContainers(data.containers);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler beim Laden');
    }
  }, []);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useEffect(() => { if (sid) void loadSession(sid); }, [sid, loadSession]);

  useEffect(() => {
    if (syncLogRef.current) syncLogRef.current.scrollTop = syncLogRef.current.scrollHeight;
  }, [syncLog]);

  // ── SSH Pubkey ────────────────────────────────────────────────────────────────

  const fetchPubkey = async () => {
    try {
      const data = await mreq<{ pubkey: string }>('/api/migration/keypair');
      setPubkey(data.pubkey);
      setShowPubkey(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  // ── Session Management ────────────────────────────────────────────────────────

  const createSession = async () => {
    setError('');
    try {
      const data = await mreq<{ sessionId: string }>('/api/migration/sessions', {
        method: 'POST',
        body: JSON.stringify({ host: form.host, user: form.user, port: parseInt(form.port), appdataSrc: form.appdataSrc, appdataDst: form.appdataDst, password: form.password || undefined }),
      });
      await loadSessions();
      setSid(data.sessionId);
      setShowNewForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Migration-Session löschen?')) return;
    await mreq(`/api/migration/sessions/${id}`, { method: 'DELETE' });
    if (sid === id) { setSid(null); setSession(null); setPhases([]); setContainers([]); }
    await loadSessions();
  };

  // ── Phase Execution ───────────────────────────────────────────────────────────

  const phaseStatus = (key: string) => phases.find(p => p.phase === key)?.status ?? 'pending';

  const runPhase = async (key: string, label: string, extraBody?: object) => {
    if (!sid) return;
    if (!confirm(`Phase „${label}" starten?`)) return;
    setBusyPhase(key);
    setError('');
    try {
      const endpoints: Record<string, string> = {
        connect: `/api/migration/${sid}/connect`,
        discover: `/api/migration/${sid}/discover`,
        preflight: `/api/migration/${sid}/preflight`,
        create: `/api/migration/${sid}/create`,
        finalize: `/api/migration/${sid}/finalize`,
      };
      await mreq(endpoints[key], { method: 'POST', body: JSON.stringify(extraBody ?? {}) });
      await loadSession(sid);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
      if (sid) await loadSession(sid);
    } finally {
      setBusyPhase(null);
    }
  };

  // ── Phase 5: SSE Sync ─────────────────────────────────────────────────────────

  const startSync = () => {
    if (!sid) return;
    if (!confirm('Datei-Synchronisation starten? Dies kann lange dauern.')) return;
    esRef.current?.close();
    setSyncing(true);
    setSyncLog(['▶ Sync gestartet…']);

    const es = new EventSource(`/api/migration/${sid}/sync/stream`);
    esRef.current = es;

    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data) as {
          type: string; container?: string; image?: string; totalBytes?: number;
          volume?: string; bytes?: number; source?: string; dest?: string;
          pct?: number; speed?: string; eta?: string; error?: string;
          message?: string; errors?: number; skipped?: boolean;
        };
        if (d.type === 'container-start') setSyncLog(l => [...l, `\n📦 ${d.container} (${d.image}) — ${formatBytes(d.totalBytes ?? 0)}`]);
        else if (d.type === 'volume-start') setSyncLog(l => [...l, `  ↳ ${d.source} → ${d.dest} (${formatBytes(d.bytes ?? 0)})`]);
        else if (d.type === 'progress') setSyncLog(l => { const n = [...l]; n[n.length - 1] = `  … ${d.pct}% ${d.speed} ETA ${d.eta}`; return n; });
        else if (d.type === 'volume-done') setSyncLog(l => [...l, `  ✓ Volume fertig`]);
        else if (d.type === 'volume-error') setSyncLog(l => [...l, `  ✗ Fehler: ${d.error}`]);
        else if (d.type === 'container-done' && !d.skipped) setSyncLog(l => [...l, `✓ ${d.container} synchronisiert`]);
        else if (d.type === 'container-done' && d.skipped) setSyncLog(l => [...l, `⏭ ${d.container} keine Bind-Mounts – übersprungen`]);
        else if (d.type === 'complete') setSyncLog(l => [...l, `\n✅ Sync abgeschlossen. Fehler: ${d.errors ?? 0}`]);
        else if (d.type === 'aborted') setSyncLog(l => [...l, `\n⏸ ${d.message}`]);
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      setSyncLog(l => [...l, '\n⚠ Verbindung unterbrochen. Sync pausiert – beim nächsten Start wird fortgesetzt.']);
      setSyncing(false);
      es.close();
      if (sid) void loadSession(sid);
    };
    es.addEventListener('complete', () => { setSyncing(false); es.close(); if (sid) void loadSession(sid); });
    es.addEventListener('aborted', () => { setSyncing(false); es.close(); if (sid) void loadSession(sid); });
  };

  const abortSync = () => { esRef.current?.close(); setSyncing(false); setSyncLog(l => [...l, '\n⏸ Verbindung getrennt.']); if (sid) void loadSession(sid); };

  // ── Container Selection ───────────────────────────────────────────────────────

  const toggleContainer = async (cname: string, selected: boolean) => {
    if (!sid) return;
    await mreq(`/api/migration/${sid}/selection`, { method: 'PUT', body: JSON.stringify({ containers: { [cname]: selected } }) });
    await loadSession(sid);
  };

  const toggleAll = async (selected: boolean) => {
    if (!sid) return;
    await mreq(`/api/migration/${sid}/selection`, { method: 'PUT', body: JSON.stringify({ all: selected }) });
    await loadSession(sid);
  };

  // ── Computed ──────────────────────────────────────────────────────────────────

  const selectedCount = containers.filter(c => c.selected).length;
  const totalSelected = containers.filter(c => c.selected).reduce((s, c) => s + c.total_bytes, 0);

  const phaseReady = (key: string) => {
    const order = PHASES.map(p => p.key);
    const idx = order.indexOf(key);
    if (idx === 0) return true;
    const prev = order[idx - 1];
    // sync requires preflight done, not create
    if (key === 'sync') return phaseStatus('preflight') === 'done';
    if (key === 'create') return phaseStatus('preflight') === 'done';
    if (key === 'finalize') return phaseStatus('sync') === 'done' || phaseStatus('sync') === 'paused';
    return phaseStatus(prev) === 'done';
  };

  const phaseRunnable = (key: string) => {
    const s = phaseStatus(key);
    return phaseReady(key) && s !== 'running' && !busyPhase && !syncing && s !== 'done';
  };

  // Phase can be re-run if it errored or paused (except connect/discover which always re-run)
  const phaseReRunnable = (key: string) => {
    const s = phaseStatus(key);
    return phaseReady(key) && !busyPhase && !syncing && (s === 'error' || s === 'paused' || (s === 'done' && (key === 'connect' || key === 'discover')));
  };

  // ── Phase Result Renderers ────────────────────────────────────────────────────

  const renderPhaseResult = (key: string) => {
    const phase = phases.find(p => p.phase === key);
    if (!phase?.result_json && !phase?.error) return null;
    if (phase.error && phase.status === 'error') {
      return <div className="text-error" style={{ fontSize: 12, marginTop: 6, padding: '6px 10px', background: 'var(--color-error-bg, rgba(239,68,68,.1))', borderRadius: 6 }}>✗ {phase.error}</div>;
    }
    try {
      const r = JSON.parse(phase.result_json ?? '{}');

      if (key === 'connect') return (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span><b>Host:</b> {r.hostname}</span>
          <span><b>OS:</b> {r.os || '–'}</span>
          <span><b>Docker:</b> {r.dockerVersion}</span>
        </div>
      );

      if (key === 'discover') return (
        <div style={{ fontSize: 12, marginTop: 6 }}>
          {r.count} Container gefunden.
        </div>
      );

      if (key === 'preflight') return (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span><b>Ausgewählt:</b> {r.selectedCount} Container</span>
            <span><b>Datenmenge:</b> {formatBytes(r.totalBytes)}</span>
            <span><b>Freier Platz:</b> {r.freeBytes > 0 ? formatBytes(r.freeBytes) : 'unbekannt'}</span>
            <span style={{ color: r.spaceOk ? 'var(--color-success)' : 'var(--color-error)' }}>
              {r.spaceOk ? '✓ Genug Platz' : '✗ Zu wenig Platz!'}
            </span>
          </div>
          {r.portConflicts?.length > 0 && (
            <div style={{ color: 'var(--color-warning)' }}>
              ⚠ Port-Konflikte: {r.portConflicts.map((c: { container: string; port: number }) => `${c.container}:${c.port}`).join(', ')}
            </div>
          )}
        </div>
      );

      if (key === 'create') return (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(r.results ?? []).map((res: { name: string; status: string; error?: string }) => (
            <div key={res.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ minWidth: 160 }}>{res.name}</span>
              <StatusBadge status={res.status === 'created' || res.status === 'pulled+created' ? 'done' : res.status === 'exists' || res.status === 'skipped' ? 'paused' : 'error'} />
              <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>
                {res.status === 'pulled+created' ? 'Image geladen + erstellt' : res.status === 'exists' ? 'bereits vorhanden' : res.status === 'skipped' ? 'übersprungen' : ''}
              </span>
              {res.error && <span style={{ color: 'var(--color-error)', fontSize: 11 }}>{res.error}</span>}
            </div>
          ))}
        </div>
      );

      if (key === 'finalize') return (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(r.results ?? []).map((res: { name: string; action: string; error?: string }) => (
            <div key={res.name} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ minWidth: 160 }}>{res.name}</span>
              <span style={{ color: res.action === 'error' ? 'var(--color-error)' : 'var(--color-success)' }}>{res.action}</span>
              {res.error && <span style={{ color: 'var(--color-error)', fontSize: 11 }}>{res.error}</span>}
            </div>
          ))}
        </div>
      );
    } catch { return null; }
    return null;
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <Topbar
        title="Migrations-Assistent"
        subtitle={session ? `${session.host} · ${session.appdata_src} → ${session.appdata_dst}` : 'Unraid → Core-Hub Container-Migration'}
        onRefresh={sid ? () => void loadSession(sid) : loadSessions}
        refreshing={refreshing}
      />
      <main className="page">

        {error && (
          <div style={{ background: 'rgba(239,68,68,.12)', border: '1px solid var(--color-error)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 13, color: 'var(--color-error)' }}>
            ✗ {error}
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 12 }} onClick={() => setError('')}>×</button>
          </div>
        )}

        {/* ── Session Selector / Creator ── */}
        <Panel title="Migration-Session" icon={<Server size={15} />} storageKey="mig-session"
          actions={
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn--ghost btn--sm" onClick={fetchPubkey} title="SSH-Schlüssel anzeigen"><Key size={12} /> SSH-Schlüssel</button>
              <button className="btn btn--primary btn--sm" onClick={() => setShowNewForm(f => !f)}>
                <Plus size={12} /> Neue Session
              </button>
            </div>
          }
        >
          {/* SSH Pubkey display */}
          {showPubkey && pubkey && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 6 }}>
                Füge diesen Schlüssel auf dem Unraid-Server hinzu: <code style={{ fontSize: 11 }}>echo '…' &gt;&gt; ~/.ssh/authorized_keys</code>
              </div>
              <textarea
                readOnly value={pubkey}
                onClick={(e) => (e.target as HTMLTextAreaElement).select()}
                style={{ width: '100%', height: 60, fontFamily: 'monospace', fontSize: 11, padding: '6px 10px', background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, resize: 'none', color: 'var(--color-text)' }}
              />
              <button className="btn btn--ghost btn--sm" style={{ marginTop: 4 }} onClick={() => void navigator.clipboard.writeText(pubkey)}>Kopieren</button>
            </div>
          )}

          {/* New session form */}
          {showNewForm && (
            <div style={{ background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ background: 'rgba(99,102,241,.08)', border: '1px solid rgba(99,102,241,.25)', borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: 'var(--color-muted)' }}>
                <b>Authentifizierung:</b> Entweder SSH-Schlüssel auf Unraid eintragen (empfohlen) <em>oder</em> unten ein Passwort eingeben. Bei Passwort muss <code>sshpass</code> installiert sein (<code>apt install sshpass</code> / <code>yum install sshpass</code>).
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                {[
                  { label: 'Unraid Host/IP', key: 'host', placeholder: '192.168.1.100', type: 'text' },
                  { label: 'SSH-Benutzer', key: 'user', placeholder: 'root', type: 'text' },
                  { label: 'SSH-Port', key: 'port', placeholder: '22', type: 'text' },
                  { label: 'SSH-Passwort (optional)', key: 'password', placeholder: 'Leer = Schlüssel-Auth', type: 'password' },
                  { label: 'Appdata-Pfad (Unraid)', key: 'appdataSrc', placeholder: '/mnt/user/appdata', type: 'text' },
                  { label: 'Appdata-Ziel (lokal)', key: 'appdataDst', placeholder: '/opt/appdata', type: 'text' },
                ].map(f => (
                  <div key={f.key}>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)', marginBottom: 3 }}>{f.label}</div>
                    <input
                      className="input input--rect"
                      type={f.type}
                      placeholder={f.placeholder}
                      value={form[f.key as keyof typeof form]}
                      onChange={(e) => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      style={{ width: '100%', height: 32, fontSize: 13 }}
                    />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button className="btn btn--primary btn--sm" onClick={() => void createSession()} disabled={!form.host}>Session erstellen</button>
                <button className="btn btn--ghost btn--sm" onClick={() => setShowNewForm(false)}>Abbrechen</button>
              </div>
            </div>
          )}

          {/* Session list */}
          {sessions.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--color-faint)', padding: '8px 0' }}>Noch keine Migration-Sessions. Erstelle eine neue Session oben.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {sessions.map(s => (
                <div key={s.session_id} onClick={() => setSid(s.session_id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, cursor: 'pointer', background: sid === s.session_id ? 'var(--color-accent-subtle, rgba(99,102,241,.1))' : 'var(--color-input)', border: `1px solid ${sid === s.session_id ? 'var(--color-accent)' : 'var(--color-border)'}` }}>
                  <ArrowRightLeft size={16} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{s.host}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>{s.appdata_src} → {s.appdata_dst} · {s.user}@{s.host}:{s.port} · {s.hasPassword ? '🔑 Passwort' : '🗝 SSH-Key'}</div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>{new Date(s.created_at).toLocaleString('de-DE')}</div>
                  <button className="btn btn--ghost btn--icon btn--sm" title="Session löschen"
                    onClick={(e) => { e.stopPropagation(); void deleteSession(s.session_id); }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ── Phase cards (only shown when session is selected) ── */}
        {sid && session && (
          <>
            {PHASES.map(({ key, num, label, desc }) => {
              const status = phaseStatus(key);
              const isBusy = busyPhase === key;
              const runnable = phaseRunnable(key);
              const reRunnable = phaseReRunnable(key);

              return (
                <Panel key={key} storageKey={`mig-phase-${key}`}
                  title={`Phase ${num}: ${label}`}
                  icon={<PhaseIcon status={status} />}
                  subtitle={<StatusBadge status={status} />}
                  defaultCollapsed={status === 'done'}
                  actions={
                    key !== 'sync' ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {(runnable || reRunnable) && (
                          <button
                            className={`btn btn--sm ${status === 'done' ? 'btn--ghost' : 'btn--primary'}`}
                            disabled={isBusy || (!runnable && !reRunnable)}
                            onClick={() => {
                              if (key === 'finalize') void runPhase(key, label, { stopOnUnraid });
                              else void runPhase(key, label);
                            }}
                          >
                            {isBusy ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Läuft…</> : <><Play size={12} /> {status === 'done' ? 'Erneut' : 'Starten'}</>}
                          </button>
                        )}
                        {status === 'done' && !reRunnable && (
                          <button className="btn btn--ghost btn--sm" disabled><CheckCircle size={12} style={{ color: 'var(--color-success)' }} /> Erledigt</button>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6 }}>
                        {!syncing ? (
                          <button className={`btn btn--sm ${status === 'done' ? 'btn--ghost' : 'btn--primary'}`}
                            disabled={!phaseReady('sync')} onClick={startSync}>
                            <Play size={12} /> {status === 'paused' ? 'Fortsetzen' : status === 'done' ? 'Erneut' : 'Starten'}
                          </button>
                        ) : (
                          <button className="btn btn--danger btn--sm" onClick={abortSync}>
                            <span className="spinner" style={{ width: 11, height: 11 }} /> Unterbrechen
                          </button>
                        )}
                      </div>
                    )
                  }
                >
                  <p style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>{desc}</p>

                  {/* Phase-specific content */}

                  {/* Phase 2 result: container selection table */}
                  {key === 'discover' && containers.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {selectedCount} von {containers.length} ausgewählt · {formatBytes(totalSelected)}
                        </span>
                        <button className="btn btn--ghost btn--sm" onClick={() => void toggleAll(true)}>Alle</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => void toggleAll(false)}>Keine</button>
                        <button className="btn btn--ghost btn--sm" onClick={() => void loadSession(sid)}>
                          <RefreshCw size={11} />
                        </button>
                      </div>
                      <div className="table-scroll">
                        <table className="dtable">
                          <thead>
                            <tr>
                              <th style={{ width: 36 }}>
                                <input type="checkbox" checked={selectedCount === containers.length && containers.length > 0}
                                  onChange={(e) => void toggleAll(e.target.checked)} />
                              </th>
                              <th>Container</th>
                              <th>Image</th>
                              <th className="dtable__num">Datenmenge</th>
                              <th>Sync-Status</th>
                              <th style={{ width: 32 }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {containers.map(c => {
                              const vols = JSON.parse(c.volumes_json) as VolumeInfo[];
                              const bindVols = vols.filter(v => v.type === 'bind');
                              const expanded = expandedContainers === c.cname;
                              return [
                                <tr key={c.cname}>
                                  <td><input type="checkbox" checked={!!c.selected} onChange={(e) => void toggleContainer(c.cname, e.target.checked)} /></td>
                                  <td style={{ fontWeight: 600 }}>{c.cname}</td>
                                  <td className="dtable__mono" style={{ fontSize: 11 }}>{c.image}</td>
                                  <td className="dtable__num">{formatBytes(c.total_bytes)}</td>
                                  <td>
                                    <span style={{
                                      fontSize: 11, padding: '1px 6px', borderRadius: 4,
                                      background: c.sync_status === 'done' ? 'rgba(34,197,94,.15)' : c.sync_status === 'error' ? 'rgba(239,68,68,.15)' : c.sync_status === 'syncing' ? 'rgba(99,102,241,.15)' : 'var(--color-input)',
                                      color: c.sync_status === 'done' ? 'var(--color-success)' : c.sync_status === 'error' ? 'var(--color-error)' : 'var(--color-muted)',
                                    }}>
                                      {c.sync_status}
                                    </span>
                                    {c.error && <span style={{ fontSize: 10.5, color: 'var(--color-error)', marginLeft: 6 }}>{c.error}</span>}
                                  </td>
                                  <td>
                                    {bindVols.length > 0 && (
                                      <button className="btn btn--ghost btn--icon btn--sm" onClick={() => setExpandedContainers(expanded ? null : c.cname)}>
                                        {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                      </button>
                                    )}
                                  </td>
                                </tr>,
                                expanded && bindVols.length > 0 && (
                                  <tr key={`${c.cname}-vols`} style={{ background: 'var(--color-input)' }}>
                                    <td colSpan={6} style={{ padding: '6px 14px' }}>
                                      <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
                                        {bindVols.map((v, i) => (
                                          <div key={i} style={{ display: 'flex', gap: 12, color: 'var(--color-muted)' }}>
                                            <span className="dtable__mono">{v.source}</span>
                                            <span>→</span>
                                            <span className="dtable__mono">{v.target}</span>
                                            <span style={{ marginLeft: 'auto' }}>{formatBytes(v.bytes)}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                ),
                              ];
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Phase 5 sync log */}
                  {key === 'sync' && syncLog.length > 0 && (
                    <div ref={syncLogRef}
                      style={{ fontFamily: 'monospace', fontSize: 11.5, background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 12px', maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap', marginTop: 8 }}>
                      {syncLog.join('\n')}
                    </div>
                  )}

                  {/* Phase 6 finalize: stop on Unraid toggle */}
                  {key === 'finalize' && (
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 4 }}>
                      <input type="checkbox" checked={stopOnUnraid} onChange={(e) => setStopOnUnraid(e.target.checked)} />
                      Unraid-Container vor dem Start lokal stoppen
                    </label>
                  )}

                  {renderPhaseResult(key)}
                </Panel>
              );
            })}
          </>
        )}

        {!sid && sessions.length === 0 && !showNewForm && (
          <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-faint)' }}>
            <ArrowRightLeft size={40} style={{ opacity: 0.2, marginBottom: 12 }} />
            <p style={{ fontSize: 14 }}>Erstelle eine neue Migration-Session um mit dem Umzug von Unraid zu beginnen.</p>
            <button className="btn btn--primary" style={{ marginTop: 16 }} onClick={() => { setShowNewForm(true); }}>
              <Plus size={14} /> Neue Session
            </button>
          </div>
        )}
      </main>
    </>
  );
}
