import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Plus, Trash2, Play, Square, RotateCcw, UserPlus } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import type { Share } from '../lib/types';

function ShareModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState<Share>({ name: '', path: '', readOnly: false, guestOk: false, browseable: true });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!form.name.trim() || !form.path.startsWith('/')) { setError('Name und absoluter Pfad erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.shares.create(form);
      setForm({ name: '', path: '', readOnly: false, guestOk: false, browseable: true });
      onDone(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  const check = (key: keyof Share, label: string, hint: string) => (
    <label className="legend__item" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={form[key] as boolean} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} />
      <span><b>{label}</b> — <span className="text-muted">{hint}</span></span>
    </label>
  );

  return (
    <Modal
      open={open}
      title="Neue SMB-Freigabe"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Freigabe erstellen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-group">
        <label className="form-label">Freigabename</label>
        <input className="input input--rect" placeholder="Medien" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="form-group">
        <label className="form-label">Pfad</label>
        <input className="input input--rect" placeholder="/mnt/daten/medien" value={form.path} onChange={(e) => setForm({ ...form, path: e.target.value })} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">Wird automatisch angelegt, falls nicht vorhanden.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
        {check('readOnly', 'Nur Lesen', 'Schreibzugriff verbieten')}
        {check('guestOk', 'Gastzugriff', 'ohne Passwort zugänglich')}
        {check('browseable', 'Sichtbar', 'in der Netzwerkumgebung anzeigen')}
      </div>
    </Modal>
  );
}

function SmbUserModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username || !password) { setError('Benutzer und Passwort erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.shares.addUser(username, password);
      setUsername(''); setPassword(''); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      title="SMB-Benutzer hinzufügen"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Hinzufügen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      <div className="form-hint" style={{ marginBottom: 4 }}>Der Benutzer muss bereits als Linux-Benutzer existieren.</div>
      <div className="form-group">
        <label className="form-label">Benutzername</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} />
      </div>
      <div className="form-group">
        <label className="form-label">SMB-Passwort</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
    </Modal>
  );
}

export function Shares() {
  const [shares, setShares] = useState<Share[]>([]);
  const [available, setAvailable] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.shares.list();
      setShares(res.shares);
      setAvailable(res.available);
      setRunning(res.running);
      setMessage(res.message ?? '');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const svc = async (action: 'start' | 'stop' | 'restart') => {
    setBusy(true);
    try { await api.shares.service(action); setTimeout(load, 800); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Freigabe "${name}" entfernen?`)) return;
    try { await api.shares.remove(name); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <>
      <Topbar
        title="SMB-Freigaben"
        subtitle={available ? `Samba ${running ? 'läuft' : 'gestoppt'}` : undefined}
        onRefresh={load}
        refreshing={refreshing}
        actions={available && (
          <>
            <button className="btn btn--ghost btn--sm" onClick={() => setUserModalOpen(true)}><UserPlus size={13} /> SMB-Benutzer</button>
            <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}><Plus size={13} /> Freigabe</button>
          </>
        )}
      />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><FolderOpen size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">Samba nicht installiert</div>
            <div className="empty-state__desc">
              {message}<br /><br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>sudo apt install samba</code>
            </div>
          </div>
        ) : (
          <Panel
            title="Freigaben"
            icon={<FolderOpen size={15} />}
            subtitle={`${shares.length} aktiv`}
            storageKey="shares"
            actions={
              <div style={{ display: 'flex', gap: 4 }}>
                {running ? (
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('stop')}><Square size={12} /> Stop</button>
                ) : (
                  <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('start')}><Play size={12} /> Start</button>
                )}
                <button className="btn btn--ghost btn--sm" disabled={busy} onClick={() => svc('restart')}><RotateCcw size={12} /> Neustart</button>
              </div>
            }
          >
            {shares.length === 0 ? (
              <div className="empty-state" style={{ padding: '40px 20px' }}>
                <div className="empty-state__desc">Noch keine Freigaben. Erstelle eine mit „Freigabe".</div>
              </div>
            ) : (
              <table className="dtable" style={{ marginTop: 6 }}>
                <thead>
                  <tr><th>Name</th><th>Pfad</th><th>Zugriff</th><th>Optionen</th><th style={{ width: 44 }}></th></tr>
                </thead>
                <tbody>
                  {shares.map((s) => (
                    <tr key={s.name}>
                      <td style={{ fontWeight: 600 }}>{s.name}</td>
                      <td className="dtable__mono text-muted">{s.path}</td>
                      <td>
                        <span className={`badge badge--${s.readOnly ? 'stopped' : 'running'}`}>
                          <span className="badge__dot" />{s.readOnly ? 'Nur Lesen' : 'Lesen/Schreiben'}
                        </span>
                      </td>
                      <td className="text-muted text-sm">
                        {s.guestOk ? 'Gast · ' : ''}{s.browseable ? 'sichtbar' : 'versteckt'}
                      </td>
                      <td>
                        <button className="btn btn--danger btn--icon btn--sm" title="Entfernen" onClick={() => remove(s.name)}><Trash2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        )}
      </main>

      <ShareModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
      <SmbUserModal open={userModalOpen} onClose={() => setUserModalOpen(false)} />
    </>
  );
}
