import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Play, Square, RotateCcw, Trash2, RefreshCw, ChevronDown, ChevronRight, SquareTerminal, Pencil, ExternalLink } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { ContainerBadge } from '../components/ui/Badge';
import { Sparkline } from '../components/ui/Sparkline';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { Modal } from '../components/ui/Modal';
import { ContainerTerminal } from '../components/ContainerTerminal';
import { api } from '../lib/api';
import { formatBytes, germanStatus, germanRestart } from '../lib/utils';
import type { Container } from '../lib/types';

const HISTORY_LEN = 40;
const STATS_INTERVAL_MS = 3000;

function stateBadge(state: string) {
  return <ContainerBadge state={state} />;
}

interface ContainerInspect {
  Id: string;
  Name: string;
  Config: { Image: string; Env: string[] | null; Labels: Record<string, string> };
  State: { Status: string; StartedAt: string; FinishedAt: string; Pid: number };
  HostConfig: {
    RestartPolicy: { Name: string };
    Binds: string[] | null;
    PortBindings?: Record<string, Array<{ HostIp: string; HostPort: string }> | null> | null;
  };
  NetworkSettings: { Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null> };
  Created: string;
}

interface PortLine { host: number; container: number; proto: string }

/** Liest die Port-Mappings (bevorzugt aus HostConfig.PortBindings, sonst NetworkSettings). */
function readPortLines(inspect: ContainerInspect | null): PortLine[] {
  const src = inspect?.HostConfig.PortBindings && Object.keys(inspect.HostConfig.PortBindings).length
    ? inspect.HostConfig.PortBindings
    : inspect?.NetworkSettings.Ports;
  const out: PortLine[] = [];
  for (const [key, bindings] of Object.entries(src ?? {})) {
    if (!bindings) continue;
    const [cport, proto] = key.split('/');
    for (const b of bindings) {
      if (b.HostPort) out.push({ host: parseInt(b.HostPort, 10), container: parseInt(cport, 10), proto: proto || 'tcp' });
    }
  }
  return out;
}

// ── Reconfigure / Edit modal ─────────────────────────────────────────────────

function EditModal({ container, inspect, onClose, onDone }: {
  container: Container;
  inspect: ContainerInspect | null;
  onClose: () => void;
  onDone: (newId: string) => void;
}) {
  const [image, setImage] = useState('');
  const [name, setName] = useState('');
  const [restart, setRestart] = useState('unless-stopped');
  const [portStr, setPortStr] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [volStr, setVolStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setImage(inspect?.Config.Image ?? container.image);
    setName(container.name);
    setRestart(inspect?.HostConfig.RestartPolicy?.Name || 'unless-stopped');
    setPortStr(readPortLines(inspect).map((p) => `${p.host}:${p.container}${p.proto === 'udp' ? '/udp' : ''}`).join('\n'));
    const env = (inspect?.Config.Env ?? []).filter((e) => !e.startsWith('PATH=') && !e.startsWith('HOME='));
    setEnvStr(env.join('\n'));
    setVolStr((inspect?.HostConfig.Binds ?? []).join('\n'));
    setError('');
  }, [container, inspect]);

  const save = async () => {
    if (!image.trim()) { setError('Image ist erforderlich'); return; }
    setBusy(true); setError('');
    try {
      const ports = portStr.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
        const [host, rest] = line.split(':');
        const [cport, proto] = (rest ?? '').split('/');
        return { host: parseInt(host, 10), container: parseInt(cport, 10), proto: proto === 'udp' ? 'udp' : 'tcp' };
      }).filter((p) => p.host && p.container);
      const env = envStr.split('\n').map((l) => l.trim()).filter(Boolean);
      const volumes = volStr.split('\n').map((l) => l.trim()).filter(Boolean);
      const res = await api.containers.recreate(container.id, {
        name: name.trim() || container.name,
        image: image.trim(),
        ports, env, volumes, restart,
        category: container.category ?? undefined,
      });
      onDone(res.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Neu-Erstellen fehlgeschlagen');
    } finally { setBusy(false); }
  };

  const ta = { height: 'auto', resize: 'vertical' as const, padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 };

  return (
    <Modal
      open
      title="Container neu konfigurieren"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={13} />} Übernehmen & neu starten
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div style={{ fontSize: 12, color: 'var(--color-warning)', marginBottom: 12, lineHeight: 1.5 }}>
        ⚠️ Der Container wird mit der neuen Konfiguration neu erstellt. Named-Volumes (und damit deine Daten) bleiben erhalten.
      </div>
      <div className="form-group">
        <label className="form-label">Image</label>
        <input className="input input--rect" value={image} onChange={(e) => setImage(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Container-Name</label>
          <input className="input input--rect" value={name} onChange={(e) => setName(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '_'))} style={{ fontFamily: 'var(--font-mono)' }} />
        </div>
        <div className="form-group">
          <label className="form-label">Neustart-Richtlinie</label>
          <select className="input input--rect" value={restart} onChange={(e) => setRestart(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="unless-stopped">Außer wenn manuell gestoppt</option>
            <option value="always">Immer neu starten</option>
            <option value="on-failure">Nur bei Fehler</option>
            <option value="no">Nie (kein Autostart)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Ports (eine pro Zeile: host:container, optional /udp)</label>
        <textarea className="input input--rect" value={portStr} onChange={(e) => setPortStr(e.target.value)} rows={3} style={ta} placeholder={'8080:80\n53:53/udp'} />
      </div>
      <div className="form-group">
        <label className="form-label">Umgebungsvariablen (eine pro Zeile: KEY=VALUE)</label>
        <textarea className="input input--rect" value={envStr} onChange={(e) => setEnvStr(e.target.value)} rows={4} style={ta} placeholder={'PUID=1000\nTZ=Europe/Berlin'} />
      </div>
      <div className="form-group">
        <label className="form-label">Volumes (eine pro Zeile: host_oder_name:/container)</label>
        <textarea className="input input--rect" value={volStr} onChange={(e) => setVolStr(e.target.value)} rows={3} style={ta} placeholder={'/opt/appdata/app:/config\nmein_vol:/data'} />
      </div>
    </Modal>
  );
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
  const logEndRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logsOpen, setLogsOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(true);

  // Actions
  const [actionLoading, setActionLoading] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [execOpen, setExecOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

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

  // Logs: SSE stream (200 tail + live follow)
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const connect = async () => {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/containers/${id}/logs/stream`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok || !response.body) { if (!cancelled) setLogLoading(false); return; }
        if (!cancelled) setLogLoading(false);

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split('\n\n');
          buf = parts.pop() ?? '';
          for (const part of parts) {
            if (part.startsWith('data: ')) {
              const line = part.slice(6).trim();
              if (line) setLogs((prev) => [...prev.slice(-500), line]);
            }
          }
        }
      } catch { if (!cancelled) setLogLoading(false); }
    };

    void connect();
    return () => { cancelled = true; reader?.cancel().catch(() => {}); };
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
  const portLinks = Object.entries(inspect?.NetworkSettings.Ports ?? {}).flatMap(([key, bindings]) =>
    (bindings ?? []).filter((b) => b.HostPort).map((b) => {
      const ip = (!b.HostIp || b.HostIp === '0.0.0.0') ? window.location.hostname : b.HostIp;
      return {
        display: `${b.HostPort}:${key.split('/')[0]}`,
        proto: key.split('/')[1] ?? 'tcp',
        url: `http://${ip}:${b.HostPort}`,
      };
    })
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
                <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => setExecOpen(true)} title="Konsole im Container öffnen">
                  <SquareTerminal size={12} /> Konsole
                </button>
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
            <button className="btn btn--outline btn--sm" disabled={!!actionLoading} onClick={() => setEditOpen(true)} title="Konfiguration ändern">
              <Pencil size={12} /> Bearbeiten
            </button>
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
          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{germanStatus(container.status)}</span>
          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>ID: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{container.shortId}</code></span>
          {inspect?.State.Pid ? <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>PID: {inspect.State.Pid}</span> : null}
          {restartPolicy !== 'no' && <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>Neustart: {germanRestart(restartPolicy)}</span>}
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
              {portLinks.length > 0 && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <div className="form-label" style={{ marginBottom: 6 }}>Ports</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {portLinks.map((p) => (
                      <a key={p.display} href={p.url} target="_blank" rel="noreferrer"
                        className="port-chip"
                        style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        title={`Öffnen: ${p.url}`}>
                        {p.display} <ExternalLink size={9} style={{ opacity: 0.7, flexShrink: 0 }} />
                      </a>
                    ))}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {portLinks.map((p) => (
                      <div key={p.display} style={{ fontSize: 11.5, color: 'var(--color-subtle)' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-faint)' }}>
                          {p.proto.toUpperCase()}{' '}
                        </span>
                        <a href={p.url} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--color-accent)', textDecoration: 'none', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                          {p.url}
                        </a>
                      </div>
                    ))}
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
              <button
                className="btn btn--ghost btn--sm"
                style={{ fontSize: 11, padding: '2px 8px' }}
                title="Anzeige leeren (Docker-Logs bleiben erhalten)"
                onClick={(e) => { e.stopPropagation(); setLogs([]); }}
              >
                Leeren
              </button>
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

      {execOpen && (
        <ContainerTerminal id={container.id} name={container.name} onClose={() => setExecOpen(false)} />
      )}

      {editOpen && (
        <EditModal
          container={container}
          inspect={inspect}
          onClose={() => setEditOpen(false)}
          onDone={(newId) => {
            setEditOpen(false);
            // Neue Container-ID → auf die neue Detailseite wechseln
            if (newId && newId !== container.id) navigate(`/containers/${newId}`, { replace: true });
            else void loadInfo();
          }}
        />
      )}
    </>
  );
}
