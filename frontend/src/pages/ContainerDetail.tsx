import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Square, RotateCcw, Trash2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { ContainerBadge } from '../components/ui/Badge';
import { Sparkline } from '../components/ui/Sparkline';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { Container } from '../lib/types';

const HISTORY_LEN = 40;
const STATS_INTERVAL_MS = 3000;
const LOGS_INTERVAL_MS = 2500;
const INITIAL_LOG_TAIL = 300;

function stateBadge(state: string) {
  return <ContainerBadge state={state} />;
}

interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Image: string; Env: string[] | null; Labels: Record<string, string> };
  State: { Status: string; StartedAt: string; FinishedAt: string; Pid: number };
  HostConfig: { RestartPolicy: { Name: string }; Binds: string[] | null };
  NetworkSettings: { Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
  Created: string;
}

export function ContainerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [container, setContainer] = useState<Container | null>(null);
  const [inspect, setInspect] = useState<ContainerInspect | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Stats history
  const [cpuHistory, setCpuHistory] = useState<number[]>([]);
  const [ramPercent, setRamPercent] = useState(0);
  const [ramUsed, setRamUsed] = useState(0);
  const [ramLimit, setRamLimit] = useState(0);

  // Logs
  const [logs, setLogs] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const logSinceRef = useRef<number>(0);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(true);

  // Actions
  const [actionLoading, setActionLoading] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!id) return;
    try {
      const [listRes, inspectRes] = await Promise.all([
        api.containers.list(),
        api.containers.get(id) as Promise<{ container: ContainerInspect }>,
      ]);
      const found = listRes.containers.find((c) => c.id === id || c.shortId === id);
      setContainer(found ?? null);
      setInspect(inspectRes.container);
      setError('');
    } catch {
      setError('Container nicht gefunden');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Initial load
  useEffect(() => { void loadInfo(); }, [loadInfo]);

  // Stats polling
  useEffect(() => {
    if (!id) return;
    const poll = async () => {
      try {
        const s = await api.containers.stats(id);
        setCpuHistory((h) => [...h.slice(-(HISTORY_LEN - 1)), s.cpu]);
        setRamPercent(s.memory.percent);
        setRamUsed(s.memory.used);
        setRamLimit(s.memory.limit);
      } catch { /* container may be stopped */ }
    };
    void poll();
    const t = setInterval(poll, STATS_INTERVAL_MS);
    return () => clearInterval(t);
  }, [id]);

  // Logs: initial fetch then poll for new lines
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const fetchInitial = async () => {
      try {
        const res = await api.containers.logs(id, INITIAL_LOG_TAIL);
        if (!cancelled) {
          setLogs(res.logs);
          logSinceRef.current = Math.floor(Date.now() / 1000);
          setLogLoading(false);
        }
      } catch { if (!cancelled) setLogLoading(false); }
    };
    void fetchInitial();

    const t = setInterval(async () => {
      if (!logSinceRef.current) return;
      try {
        const res = await api.containers.logsSince(id, logSinceRef.current);
        if (!cancelled && res.logs.length > 0) {
          logSinceRef.current = Math.floor(Date.now() / 1000);
          setLogs((prev) => [...prev.slice(-500), ...res.logs]);
        }
      } catch { /* ignore */ }
    }, LOGS_INTERVAL_MS);

    return () => { cancelled = true; clearInterval(t); };
  }, [id]);

  // Auto-scroll logs
  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const action = async (act: string, fn: () => Promise<unknown>) => {
    setActionLoading(act);
    try { await fn(); await loadInfo(); } catch { /* */ }
    finally { setActionLoading(''); }
  };

  const handleDelete = async () => {
    if (!id) return;
    setDeleting(true);
    try { await api.containers.remove(id); navigate('/containers'); }
    catch { setDeleting(false); setDeleteOpen(false); }
  };

  if (loading) return (
    <>
      <Topbar title="Container" />
      <main className="page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span className="spinner" style={{ width: 28, height: 28 }} />
      </main>
    </>
  );

  if (error || !container) return (
    <>
      <Topbar title="Container" />
      <main className="page">
        <div className="empty-state"><div className="empty-state__title">{error || 'Container nicht gefunden'}</div>
          <Link to="/containers" className="btn btn--primary btn--md" style={{ marginTop: 16 }}>← Zurück</Link></div>
      </main>
    </>
  );

  const isRunning = container.state === 'running';
  const ports = Object.entries(inspect?.NetworkSettings.Ports ?? {}).flatMap(([key, bindings]) =>
    (bindings ?? []).map((b) => `${b.HostPort}:${key.replace('/tcp', '')}`)
  );
  const envVars = (inspect?.Config.Env ?? []).filter((e) => !e.startsWith('PATH=') && !e.startsWith('HOME='));
  const binds = inspect?.HostConfig.Binds ?? [];
  const restartPolicy = inspect?.HostConfig.RestartPolicy?.Name ?? 'no';

  return (
    <>
      <Topbar
        title={container.name}
        subtitle={container.image}
        actions={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Link to="/containers" className="btn btn--ghost btn--sm" style={{ gap: 4 }}>
              <ArrowLeft size={13} /> Zurück
            </Link>
            {isRunning ? (
              <>
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => action('restart', () => api.containers.restart(container.id))}>
                  {actionLoading === 'restart' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={12} />}
                  Neustart
                </button>
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => action('stop', () => api.containers.stop(container.id))}>
                  {actionLoading === 'stop' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Square size={12} />}
                  Stopp
                </button>
              </>
            ) : (
              <button className="btn btn--primary btn--sm" disabled={!!actionLoading} onClick={() => action('start', () => api.containers.start(container.id))}>
                {actionLoading === 'start' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
                Starten
              </button>
            )}
            <button className="btn btn--danger btn--sm" disabled={!!actionLoading} onClick={() => setDeleteOpen(true)}>
              <Trash2 size={12} /> Löschen
            </button>
            <button className="icon-btn" onClick={loadInfo} title="Aktualisieren">
              <RefreshCw size={14} />
            </button>
          </div>
        }
      />

      <main className="page">
        {/* Status row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
          {stateBadge(container.state)}
          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>ID: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{container.shortId}</code></span>
          {inspect?.State.Pid ? <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>PID: {inspect.State.Pid}</span> : null}
          {restartPolicy !== 'no' && <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>Restart: {restartPolicy}</span>}
        </div>

        {/* Stats cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
          {/* CPU */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">CPU</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                {cpuHistory.length ? `${cpuHistory[cpuHistory.length - 1].toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="card-body" style={{ padding: '10px 18px 14px' }}>
              <Sparkline data={cpuHistory} color="var(--color-accent)" height={64} />
            </div>
          </div>

          {/* RAM */}
          <div className="card">
            <div className="card-header">
              <span className="card-title">RAM</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: ramPercent > 85 ? 'var(--color-error)' : ramPercent > 65 ? 'var(--color-warning)' : 'var(--color-accent)', fontVariantNumeric: 'tabular-nums' }}>
                {ramLimit > 0 ? `${ramPercent.toFixed(1)}%` : '—'}
              </span>
            </div>
            <div className="card-body">
              <div style={{ fontSize: 12, color: 'var(--color-subtle)', marginBottom: 8 }}>
                {ramLimit > 0 ? `${formatBytes(ramUsed)} / ${formatBytes(ramLimit)}` : 'Kein Limit'}
              </div>
              <div className="stat-card__bar" style={{ height: 6 }}>
                <div className="stat-card__bar-fill" style={{ width: `${Math.min(ramPercent, 100)}%`, background: ramPercent > 85 ? 'var(--color-error)' : ramPercent > 65 ? 'var(--color-warning)' : 'var(--color-accent)' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Container info */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setInfoOpen((o) => !o)}>
            <span className="card-title">Details</span>
            {infoOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </div>
          {infoOpen && (
            <div className="card-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>Image</div>
                <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--color-muted)', wordBreak: 'break-all' }}>{inspect?.Config.Image}</code>
              </div>
              <div>
                <div className="form-label" style={{ marginBottom: 4 }}>Erstellt</div>
                <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>{inspect ? new Date(inspect.Created).toLocaleString('de-DE') : '—'}</span>
              </div>
              {ports.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Ports</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {ports.map((p) => <span key={p} className="port-chip">{p}</span>)}
                  </div>
                </div>
              )}
              {binds.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Volumes</div>
                  {binds.map((b) => (
                    <div key={b} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-muted)', padding: '3px 0', borderBottom: '1px solid var(--color-border)' }}>{b}</div>
                  ))}
                </div>
              )}
              {envVars.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Umgebungsvariablen ({envVars.length})</div>
                  <div style={{ maxHeight: 140, overflowY: 'auto', background: 'var(--color-surface-sunken)', borderRadius: 8, padding: '8px 10px' }}>
                    {envVars.map((e) => (
                      <div key={e} style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--color-muted)', padding: '2px 0' }}>{e}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live logs */}
        <div className="card">
          <div className="card-header" style={{ cursor: 'pointer' }} onClick={() => setLogsOpen((o) => !o)}>
            <span className="card-title">Live-Logs</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {logLoading && <span className="spinner" style={{ width: 12, height: 12 }} />}
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 12, color: 'var(--color-muted)' }}
                onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} style={{ width: 12, height: 12 }} />
                Auto-scroll
              </label>
              {logsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </div>
          </div>
          {logsOpen && (
            <div style={{ padding: '0 16px 16px' }}>
              <div
                className="log-viewer"
                style={{ height: 380 }}
                onScroll={(e) => {
                  const el = e.currentTarget;
                  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  setAutoScroll(atBottom);
                }}
              >
                {logs.length === 0 ? (
                  <span style={{ color: 'var(--color-faint)' }}>Keine Logs verfügbar</span>
                ) : (
                  logs.map((line, i) => <div key={i}>{line}</div>)
                )}
                <div ref={logEndRef} />
              </div>
            </div>
          )}
        </div>
      </main>

      <ConfirmModal
        open={deleteOpen}
        title={`Container löschen`}
        message={`Soll "${container.name}" wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.`}
        confirmLabel="Löschen"
        danger
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  );
}
