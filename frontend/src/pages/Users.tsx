import { useState, useEffect, useCallback } from 'react';
import { Users as UsersIcon, Terminal, Plus, Trash2, KeyRound, Shield } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { avatarColor } from '../lib/utils';
import { useAuth } from '../lib/auth';
import type { UserPublic, LinuxUser } from '../lib/types';

function AppUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('viewer');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username || !password) { setError('Benutzer und Passwort erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.users.create({ username, password, role });
      setUsername(''); setPassword(''); setRole('viewer'); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title="Neuer Core-Hub Login" onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">Benutzername</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Passwort</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Rolle</label>
        <select className="input input--rect" value={role} onChange={(e) => setRole(e.target.value)} style={{ cursor: 'pointer' }}>
          <option value="viewer">Viewer (nur ansehen)</option>
          <option value="admin">Admin (volle Rechte)</option>
        </select></div>
    </Modal>
  );
}

function LinuxUserModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [sudo, setSudo] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!username) { setError('Benutzername erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.linuxUsers.create({ username, password: password || undefined, sudo });
      setUsername(''); setPassword(''); setSudo(false); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title="Neuer Linux-Benutzer" onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Anlegen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">Benutzername</label>
        <input className="input input--rect" value={username} onChange={(e) => setUsername(e.target.value)} /></div>
      <div className="form-group"><label className="form-label">Passwort (optional)</label>
        <input className="input input--rect" type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
      <label className="legend__item" style={{ cursor: 'pointer' }}>
        <input type="checkbox" checked={sudo} onChange={(e) => setSudo(e.target.checked)} />
        <span><Shield size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <b>sudo-Rechte</b> — Administrator</span>
      </label>
    </Modal>
  );
}

export function Users() {
  const { user } = useAuth();
  const [appUsers, setAppUsers] = useState<UserPublic[]>([]);
  const [linuxUsers, setLinuxUsers] = useState<LinuxUser[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [appModal, setAppModal] = useState(false);
  const [linuxModal, setLinuxModal] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [a, l] = await Promise.allSettled([api.users.list(), api.linuxUsers.list()]);
      if (a.status === 'fulfilled') setAppUsers(a.value.users);
      if (l.status === 'fulfilled') setLinuxUsers(l.value.users);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const delApp = async (id: number, name: string) => {
    if (!confirm(`Login "${name}" löschen?`)) return;
    try { await api.users.delete(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const delLinux = async (name: string) => {
    const removeHome = confirm(`Linux-Benutzer "${name}" löschen.\n\nOK = inkl. Home-Verzeichnis, Abbrechen = behalten.\n\n(Schließe den Dialog mit Esc zum kompletten Abbruch)`);
    try { await api.linuxUsers.remove(name, removeHome); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const setLinuxPw = async (name: string) => {
    const pw = prompt(`Neues Passwort für "${name}":`);
    if (!pw) return;
    try { await api.linuxUsers.setPassword(name, pw); alert('Passwort geändert.'); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <>
      <Topbar title="Benutzer" subtitle={`${appUsers.length} Logins · ${linuxUsers.length} Linux-Benutzer`} onRefresh={load} refreshing={refreshing} />
      <main className="page">
        {/* Core-Hub Logins */}
        <Panel
          title="Core-Hub Logins"
          icon={<UsersIcon size={15} />}
          subtitle="Zugänge zur Weboberfläche"
          storageKey="appusers"
          actions={<button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setAppModal(true); }}><Plus size={13} /> Login</button>}
        >
          <table className="dtable" style={{ marginTop: 6 }}>
            <thead><tr><th>Benutzer</th><th>Rolle</th><th>Erstellt</th><th style={{ width: 44 }}></th></tr></thead>
            <tbody>
              {appUsers.map((u) => (
                <tr key={u.id}>
                  <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div className="sidebar__avatar" style={{ background: avatarColor(u.username) }}>{u.username.charAt(0).toUpperCase()}</div>
                    <span style={{ fontWeight: 600 }}>{u.username}</span>
                  </div></td>
                  <td><span className={`badge badge--${u.role === 'admin' ? 'running' : 'paused'}`}>{u.role}</span></td>
                  <td className="text-muted">{u.created_at?.slice(0, 10)}</td>
                  <td>
                    {u.id !== user?.id && (
                      <button className="btn btn--danger btn--icon btn--sm" title="Löschen" onClick={() => delApp(u.id, u.username)}><Trash2 size={12} /></button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        {/* Linux Users */}
        <Panel
          title="Linux-Benutzer"
          icon={<Terminal size={15} />}
          subtitle="Systembenutzer des Servers"
          storageKey="linuxusers"
          defaultCollapsed
          actions={<button className="btn btn--primary btn--sm" onClick={(e) => { e.stopPropagation(); setLinuxModal(true); }}><Plus size={13} /> Benutzer</button>}
        >
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="dtable">
              <thead><tr><th>Benutzer</th><th>UID</th><th>Gruppen</th><th>Shell</th><th style={{ width: 80 }}></th></tr></thead>
              <tbody>
                {linuxUsers.map((u) => (
                  <tr key={u.username}>
                    <td style={{ fontWeight: 600 }}>
                      {u.username}
                      {u.groups.includes('sudo') && <Shield size={11} style={{ marginLeft: 6, color: 'var(--color-warning)', display: 'inline', verticalAlign: 'middle' }} />}
                    </td>
                    <td className="dtable__mono">{u.uid}</td>
                    <td className="text-muted text-sm" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.groups.join(', ')}</td>
                    <td className="dtable__mono text-muted">{u.shell}</td>
                    <td>
                      <div className="dtable__actions">
                        <button className="btn btn--ghost btn--icon btn--sm" title="Passwort ändern" onClick={() => setLinuxPw(u.username)}><KeyRound size={12} /></button>
                        <button className="btn btn--danger btn--icon btn--sm" title="Löschen" onClick={() => delLinux(u.username)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>

      <AppUserModal open={appModal} onClose={() => setAppModal(false)} onDone={load} />
      <LinuxUserModal open={linuxModal} onClose={() => setLinuxModal(false)} onDone={load} />
    </>
  );
}
