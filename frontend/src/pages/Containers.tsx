import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Play, Square, RotateCcw, Trash2, Terminal, ChevronDown, ArrowUpCircle, Download, ExternalLink } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { ContainerBadge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import { api } from '../lib/api';
import { timeAgo, avatarColor, containerInitial } from '../lib/utils';
import type { Container, CreateContainerData } from '../lib/types';

type Filter = 'all' | 'running' | 'stopped';

function CreateModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState<CreateContainerData>({ image: '', name: '', restart: 'unless-stopped' });
  const [portStr, setPortStr] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [volStr, setVolStr] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setForm({ image: '', name: '', restart: 'unless-stopped' });
    setPortStr(''); setEnvStr(''); setVolStr(''); setError('');
  };

  const handleClose = () => { reset(); onClose(); };

  const handleCreate = async () => {
    if (!form.image.trim()) { setError('Image ist erforderlich'); return; }
    setLoading(true); setError('');
    try {
      const ports: Record<string, string> = {};
      portStr.split('\n').forEach((l) => {
        const [host, container] = l.trim().split(':');
        if (host && container) ports[container] = host;
      });
      await api.containers.create({
        ...form,
        ports: Object.keys(ports).length ? ports : undefined,
        env: envStr.split('\n').map((l) => l.trim()).filter(Boolean) || undefined,
        volumes: volStr.split('\n').map((l) => l.trim()).filter(Boolean) || undefined,
      });
      reset(); onCreated(); onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
    } finally {
      setLoading(false);
    }
  };

  const field = (key: keyof CreateContainerData, label: string, placeholder: string, required = false) => (
    <div className="form-group">
      <label className="form-label">{label}{required ? ' *' : ''}</label>
      <input
        className="input input--rect"
        placeholder={placeholder}
        value={(form[key] as string) ?? ''}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        required={required}
      />
    </div>
  );

  return (
    <Modal
      open={open}
      title="Neuer Container"
      onClose={handleClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={handleClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={handleCreate} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> : null}
            Container erstellen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      {field('image', 'Image', 'z.B. nginx:latest', true)}
      {field('name', 'Container-Name', 'z.B. mein-nginx')}
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Neustart-Richtlinie</label>
          <select
            className="input input--rect"
            value={form.restart ?? 'unless-stopped'}
            onChange={(e) => setForm((f) => ({ ...f, restart: e.target.value }))}
            style={{ cursor: 'pointer' }}
          >
            <option value="unless-stopped">unless-stopped</option>
            <option value="always">always</option>
            <option value="on-failure">on-failure</option>
            <option value="no">no</option>
          </select>
        </div>
        {field('category', 'Kategorie', 'z.B. Medien')}
      </div>
      <div className="form-group">
        <label className="form-label">Ports (eine pro Zeile: host:container)</label>
        <textarea
          className="input input--rect"
          placeholder={'8080:80\n8443:443'}
          value={portStr}
          onChange={(e) => setPortStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Umgebungsvariablen (eine pro Zeile: KEY=VALUE)</label>
        <textarea
          className="input input--rect"
          placeholder={'PUID=1000\nPGID=1000\nTZ=Europe/Berlin'}
          value={envStr}
          onChange={(e) => setEnvStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
      <div className="form-group">
        <label className="form-label">Volumes (eine pro Zeile: /host:/container)</label>
        <textarea
          className="input input--rect"
          placeholder={'/opt/appdata/nginx:/config\n/mnt/data:/data'}
          value={volStr}
          onChange={(e) => setVolStr(e.target.value)}
          rows={3}
          style={{ height: 'auto', resize: 'vertical', padding: '8px 12px', fontFamily: 'var(--font-mono)', fontSize: 12 }}
        />
      </div>
    </Modal>
  );
}

function LogsModal({ container, open, onClose }: { container: Container | null; open: boolean; onClose: () => void }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !container) return;
    setLoading(true);
    api.containers.logs(container.id, 300)
      .then(({ logs }) => setLogs(logs))
      .catch(() => setLogs(['Fehler beim Laden der Logs']))
      .finally(() => setLoading(false));
  }, [open, container]);

  return (
    <Modal open={open} title={`Logs: ${container?.name ?? ''}`} onClose={onClose} width={680}>
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 30 }}>
          <span className="spinner" />
        </div>
      ) : (
        <div className="log-viewer" style={{ maxHeight: 460 }}>
          {logs.length ? logs.join('\n') : 'Keine Logs verfügbar'}
        </div>
      )}
    </Modal>
  );
}

export function Containers() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);
  const [logContainer, setLogContainer] = useState<Container | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [updates, setUpdates] = useState<Record<string, { hasUpdate: boolean | null; image: string }>>({});
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<Container | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    try {
      const { containers } = await api.containers.list();
      setContainers(containers);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const checkUpdates = useCallback(async () => {
    setCheckingUpdates(true);
    try { const { updates } = await api.containers.updates(); setUpdates(updates); }
    catch { /* ignore */ }
    finally { setCheckingUpdates(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const action = async (id: string, act: string, fn: () => Promise<unknown>) => {
    setActionLoading((a) => ({ ...a, [id]: act }));
    try {
      await fn();
      await load(true);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setActionLoading((a) => { const n = { ...a }; delete n[id]; return n; });
    }
  };

  const filtered = containers.filter((c) => {
    if (filter === 'running') return c.state === 'running';
    if (filter === 'stopped') return c.state !== 'running';
    return true;
  });

  const running = containers.filter((c) => c.state === 'running').length;

  return (
    <>
      <Topbar
        title="Container"
        subtitle={`${running} läuft · ${containers.length} gesamt`}
        onRefresh={() => load()}
        refreshing={refreshing}
        actions={
          <>
            <button className="btn btn--outline btn--sm" onClick={checkUpdates} disabled={checkingUpdates}>
              {checkingUpdates ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ArrowUpCircle size={13} />}
              Updates prüfen
            </button>
            <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}>
              <Plus size={13} />
              Neuer Container
            </button>
          </>
        }
      />

      <main className="page">
        <div className="filter-tabs">
          {(['all', 'running', 'stopped'] as Filter[]).map((f) => (
            <button
              key={f}
              className={`filter-tab${filter === f ? ' filter-tab--active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? `Alle (${containers.length})` : f === 'running' ? `Läuft (${running})` : `Gestoppt (${containers.length - running})`}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <span className="spinner" style={{ width: 24, height: 24 }} />
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon" style={{ fontSize: 44 }}>📦</div>
            <div className="empty-state__title">Keine Container gefunden</div>
            <div className="empty-state__desc">Erstelle deinen ersten Container mit dem Button oben rechts.</div>
          </div>
        ) : (
          <div className="container-grid">
            {filtered.map((c) => {
              const busy = actionLoading[c.id];
              const isExpanded = expandedId === c.id;
              return (
                <div className="container-card" key={c.id}>
                  <div className="container-card__header">
                    <div className="container-avatar" style={{ background: avatarColor(c.name) }}>
                      {containerInitial(c.name)}
                    </div>
                    <div className="container-card__info">
                      <Link to={`/containers/${c.id}`} className="container-card__name" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 4 }}>
                        {c.name} <ExternalLink size={10} style={{ opacity: 0.4, flexShrink: 0 }} />
                      </Link>
                      <div className="container-card__image">{c.image}</div>
                    </div>
                    {updates[c.id]?.hasUpdate && (
                      <span className="badge badge--restarting" title="Neues Image verfügbar">
                        <ArrowUpCircle size={11} /> Update
                      </span>
                    )}
                    <ContainerBadge state={c.state} />
                    <button
                      className="icon-btn"
                      onClick={() => setExpandedId(isExpanded ? null : c.id)}
                      style={{ marginLeft: 4 }}
                    >
                      <ChevronDown size={14} style={{ transform: isExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.2s' }} />
                    </button>
                  </div>

                  {c.ports.length > 0 && (
                    <div className="container-card__ports">
                      {c.ports.map((p) => <span className="port-chip" key={p}>{p}</span>)}
                    </div>
                  )}

                  {isExpanded && (
                    <div style={{ padding: '0 16px 10px', fontSize: 11.5, color: 'var(--color-subtle)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <div><span style={{ color: 'var(--color-faint)' }}>ID: </span><span style={{ fontFamily: 'var(--font-mono)' }}>{c.shortId}</span></div>
                      <div><span style={{ color: 'var(--color-faint)' }}>Erstellt: </span>{timeAgo(c.created)}</div>
                      {c.category && <div><span style={{ color: 'var(--color-faint)' }}>Kategorie: </span>{c.category}</div>}
                      <div><span style={{ color: 'var(--color-faint)' }}>Status: </span>{c.status}</div>
                    </div>
                  )}

                  <div className="container-card__footer">
                    <span className="container-card__status-text">{c.status}</span>

                    {c.state !== 'running' && (
                      <button
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Starten"
                        disabled={!!busy}
                        onClick={() => action(c.id, 'start', () => api.containers.start(c.id))}
                      >
                        {busy === 'start' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={12} />}
                      </button>
                    )}
                    {c.state === 'running' && (
                      <button
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Stoppen"
                        disabled={!!busy}
                        onClick={() => action(c.id, 'stop', () => api.containers.stop(c.id))}
                      >
                        {busy === 'stop' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Square size={12} />}
                      </button>
                    )}
                    <button
                      className="btn btn--ghost btn--icon btn--sm"
                      title="Neustart"
                      disabled={!!busy}
                      onClick={() => action(c.id, 'restart', () => api.containers.restart(c.id))}
                    >
                      {busy === 'restart' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RotateCcw size={12} />}
                    </button>
                    <button
                      className="btn btn--ghost btn--icon btn--sm"
                      title="Logs"
                      onClick={() => { setLogContainer(c); }}
                    >
                      <Terminal size={12} />
                    </button>
                    {updates[c.id]?.hasUpdate && (
                      <button
                        className="btn btn--ghost btn--icon btn--sm"
                        title="Neues Image laden (Update)"
                        style={{ color: 'var(--color-warning)' }}
                        disabled={!!busy}
                        onClick={() => action(c.id, 'pull', async () => { await api.containers.pull(c.id); await checkUpdates(); })}
                      >
                        {busy === 'pull' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={12} />}
                      </button>
                    )}
                    <button
                      className="btn btn--danger btn--icon btn--sm"
                      title="Löschen"
                      disabled={!!busy}
                      onClick={() => setDeleteConfirm(c)}
                    >
                      {busy === 'remove' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Trash2 size={12} />}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <CreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void load()}
      />
      <LogsModal
        container={logContainer}
        open={!!logContainer}
        onClose={() => setLogContainer(null)}
      />
      <ConfirmModal
        open={!!deleteConfirm}
        title="Container löschen"
        message={`Soll "${deleteConfirm?.name}" wirklich gelöscht werden? Dieser Vorgang kann nicht rückgängig gemacht werden.`}
        confirmLabel="Löschen"
        danger
        onConfirm={() => {
          if (deleteConfirm) {
            void action(deleteConfirm.id, 'remove', () => api.containers.remove(deleteConfirm.id));
          }
          setDeleteConfirm(null);
        }}
        onCancel={() => setDeleteConfirm(null)}
      />
    </>
  );
}
