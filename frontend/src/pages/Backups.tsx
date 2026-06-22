import { useState, useEffect, useCallback } from 'react';
import { HardDrive, Plus, Trash2, Download, Container, FolderArchive, MonitorPlay } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { formatBytes, timeAgo } from '../lib/utils';
import type { Backup, BackupSource, VM } from '../lib/types';

const TYPE_ICON: Record<string, React.ElementType> = {
  container: Container,
  directory: FolderArchive,
  vm: MonitorPlay,
};

function NewBackupModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [tab, setTab] = useState<'container' | 'directory' | 'vm'>('container');
  const [sources, setSources] = useState<BackupSource[]>([]);
  const [vms, setVms] = useState<VM[]>([]);
  const [containerId, setContainerId] = useState('');
  const [stopFirst, setStopFirst] = useState(true);
  const [dir, setDir] = useState('');
  const [vm, setVm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    api.backups.sources().then((r) => { setSources(r.containers); if (r.containers[0]) setContainerId(r.containers[0].id); }).catch(() => {});
    api.vms.list().then((r) => { setVms(r.vms); if (r.vms[0]) setVm(r.vms[0].name); }).catch(() => {});
  }, [open]);

  const run = async () => {
    setLoading(true); setError('');
    try {
      if (tab === 'container') {
        if (!containerId) throw new Error('Container wählen');
        await api.backups.backupContainer(containerId, stopFirst);
      } else if (tab === 'directory') {
        if (!dir.startsWith('/')) throw new Error('Absoluter Pfad erforderlich');
        await api.backups.backupDirectory(dir);
      } else {
        if (!vm) throw new Error('VM wählen');
        await api.backups.backupVm(vm);
      }
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="Neues Backup"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={run} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Backup starten
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="filter-tabs" style={{ marginBottom: 4 }}>
        <button className={`filter-tab${tab === 'container' ? ' filter-tab--active' : ''}`} onClick={() => setTab('container')}>Container</button>
        <button className={`filter-tab${tab === 'directory' ? ' filter-tab--active' : ''}`} onClick={() => setTab('directory')}>Verzeichnis</button>
        <button className={`filter-tab${tab === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setTab('vm')}>VM</button>
      </div>

      {tab === 'container' && (
        <>
          <div className="form-group">
            <label className="form-label">Container (mit Volumes)</label>
            <select className="input input--rect" value={containerId} onChange={(e) => setContainerId(e.target.value)} style={{ cursor: 'pointer' }}>
              {sources.length === 0 && <option value="">Keine Container mit Volumes</option>}
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.volumes} Volume{s.volumes !== 1 ? 's' : ''})</option>)}
            </select>
          </div>
          <label className="legend__item" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={stopFirst} onChange={(e) => setStopFirst(e.target.checked)} />
            <span>Container während des Backups stoppen (konsistenter)</span>
          </label>
        </>
      )}
      {tab === 'directory' && (
        <div className="form-group">
          <label className="form-label">Verzeichnis-Pfad</label>
          <input className="input input--rect" placeholder="/opt/appdata" value={dir} onChange={(e) => setDir(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">Wird als .tar.gz gesichert.</div>
        </div>
      )}
      {tab === 'vm' && (
        <div className="form-group">
          <label className="form-label">Virtuelle Maschine</label>
          <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
            {vms.length === 0 && <option value="">Keine VMs</option>}
            {vms.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
          <div className="form-hint">qcow2-Disk wird komprimiert gesichert (kann dauern).</div>
        </div>
      )}
    </Modal>
  );
}

export function Backups() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [dir, setDir] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.backups.list();
      setBackups(res.backups);
      setDir(res.dir);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const remove = async (id: number) => {
    if (!confirm('Backup wirklich löschen?')) return;
    setBusy((b) => ({ ...b, [id]: true }));
    try { await api.backups.remove(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[id]; return n; }); }
  };

  const totalSize = backups.reduce((s, b) => s + b.size, 0);

  return (
    <>
      <Topbar
        title="Backups"
        subtitle={`${backups.length} Backups · ${formatBytes(totalSize)} · ${dir}`}
        onRefresh={load}
        refreshing={refreshing}
        actions={
          <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}>
            <Plus size={13} /> Neues Backup
          </button>
        }
      />
      <main className="page">
        <Panel title="Backups" icon={<HardDrive size={15} />} subtitle={formatBytes(totalSize)} storageKey="backups">
          {backups.length === 0 ? (
            <div className="empty-state" style={{ padding: '40px 20px' }}>
              <div className="empty-state__desc">Noch keine Backups. Erstelle eins mit „Neues Backup".</div>
            </div>
          ) : (
            <div className="table-scroll" style={{ marginTop: 6 }}>
              <table className="dtable">
                <thead>
                  <tr><th>Typ</th><th>Name</th><th>Quelle</th><th className="dtable__num">Größe</th><th>Erstellt</th><th style={{ width: 80 }}></th></tr>
                </thead>
                <tbody>
                  {backups.map((b) => {
                    const Icon = TYPE_ICON[b.type] ?? HardDrive;
                    return (
                      <tr key={b.id}>
                        <td><span className="badge badge--paused"><Icon size={11} /> {b.type}</span></td>
                        <td style={{ fontWeight: 600 }}>{b.name}</td>
                        <td className="dtable__mono text-muted" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.source ?? '—'}</td>
                        <td className="dtable__num">{formatBytes(b.size)}</td>
                        <td className="text-muted">{timeAgo(new Date(b.created_at + 'Z').getTime() / 1000)}</td>
                        <td>
                          <div className="dtable__actions">
                            {b.exists && (
                              <a className="btn btn--ghost btn--icon btn--sm" title="Herunterladen" href={api.backups.downloadUrl(b.id)} download>
                                <Download size={12} />
                              </a>
                            )}
                            <button className="btn btn--danger btn--icon btn--sm" title="Löschen" disabled={busy[b.id]} onClick={() => remove(b.id)}>
                              {busy[b.id] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={12} />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </main>

      <NewBackupModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
    </>
  );
}
