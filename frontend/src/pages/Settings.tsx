import { useState, useEffect, useCallback, useRef } from 'react';
import { KeyRound, Download, Upload, RotateCw, Server, CheckCircle2, XCircle, FileArchive } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { formatUptime } from '../lib/utils';

function PasswordPanel() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (next !== confirm) { setMsg({ type: 'err', text: 'Passwörter stimmen nicht überein' }); return; }
    if (next.length < 4) { setMsg({ type: 'err', text: 'Passwort zu kurz' }); return; }
    setLoading(true); setMsg(null);
    try {
      await api.auth.changePassword(current, next);
      setMsg({ type: 'ok', text: 'Passwort geändert.' });
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Panel title="Passwort ändern" icon={<KeyRound size={15} />} subtitle="Dein Core-Hub Login" storageKey="set-pw">
      <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {msg && <div className={msg.type === 'ok' ? 'login-error' : 'login-error'} style={msg.type === 'ok' ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined}>{msg.text}</div>}
        <div className="form-group"><label className="form-label">Aktuelles Passwort</label>
          <input className="input input--rect" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Neues Passwort</label>
          <input className="input input--rect" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Neues Passwort bestätigen</label>
          <input className="input input--rect" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <button className="btn btn--primary btn--sm" style={{ alignSelf: 'flex-start' }} onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Passwort speichern
        </button>
      </div>
    </Panel>
  );
}

function MigrationPanel() {
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ restored: string[]; note: string } | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const doImport = async (file: File) => {
    if (!file.name.endsWith('.tar.gz') && !file.name.endsWith('.tgz')) {
      setError('Bitte eine .tar.gz Datei wählen'); return;
    }
    if (!confirm('Konfiguration importieren? Bestehende Daten werden überschrieben.')) return;
    setImporting(true); setError(''); setResult(null);
    try {
      const res = await api.settings.import(file);
      setResult({ restored: res.restored, note: res.note });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import fehlgeschlagen');
    } finally {
      setImporting(false);
    }
  };

  const restart = async () => {
    if (!confirm('Core-Hub jetzt neustarten?')) return;
    try { await api.settings.restart(); alert('Neustart ausgelöst. Die Seite lädt in ein paar Sekunden neu.'); setTimeout(() => location.reload(), 6000); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <Panel title="Migration: Export / Import" icon={<FileArchive size={15} />} subtitle="Umzug auf einen anderen Server" storageKey="set-migration">
      <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 14 }}>
        Sichert die komplette Core-Hub-Konfiguration in einer Datei: Datenbank (Benutzer, Proxy-Hosts, Kategorien),
        <b> Caddy-Zertifikate inkl. Root-CA</b> und SMB-Freigaben. Auf dem neuen Server einfach wieder importieren.
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <a className="btn btn--primary btn--sm" href={api.settings.exportUrl()} download>
          <Download size={13} /> Konfiguration exportieren
        </a>
        <button className="btn btn--outline btn--sm" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Upload size={13} />} Datei wählen…
        </button>
        <input ref={fileRef} type="file" accept=".tar.gz,.tgz" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = ''; }} />
      </div>

      {/* Drag & Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void doImport(f); }}
        style={{
          marginTop: 14, padding: '28px 20px', borderRadius: 'var(--radius-md)',
          border: `2px dashed ${dragOver ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
          background: dragOver ? 'var(--color-accent-soft)' : 'var(--color-surface-sunken)',
          textAlign: 'center', color: 'var(--color-subtle)', transition: 'all 0.15s', cursor: 'pointer',
        }}
        onClick={() => fileRef.current?.click()}
      >
        <Upload size={26} style={{ opacity: 0.5, marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 500 }}>Backup-Datei hierher ziehen (Drag & Drop)</div>
        <div style={{ fontSize: 11.5, marginTop: 2 }}>oder klicken zum Auswählen · .tar.gz</div>
      </div>

      {error && <div className="login-error" style={{ marginTop: 12 }}>{error}</div>}
      {result && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--color-accent)' }}>
          <div className="card-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-accent)', fontWeight: 600, marginBottom: 6 }}>
              <CheckCircle2 size={16} /> Import erfolgreich
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>Wiederhergestellt: {result.restored.join(', ') || '—'}</div>
            <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 8 }}>{result.note}</div>
            <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={restart}>
              <RotateCw size={13} /> Jetzt neustarten
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}

export function Settings() {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.settings.info>> | null>(null);

  const load = useCallback(async () => {
    try { setInfo(await api.settings.info()); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <Topbar title="Einstellungen" subtitle={info ? `Core-Hub v${info.version}` : undefined} />
      <main className="page">
        <PasswordPanel />
        <MigrationPanel />

        <Panel title="System-Info" icon={<Server size={15} />} subtitle={info?.hostname} storageKey="set-info" defaultCollapsed>
          {info && (
            <div style={{ marginTop: 8 }}>
              <table className="dtable">
                <tbody>
                  <tr><td className="text-muted" style={{ width: 180 }}>Version</td><td style={{ fontWeight: 600 }}>Core-Hub {info.version}</td></tr>
                  <tr><td className="text-muted">Host</td><td>{info.hostname}</td></tr>
                  <tr><td className="text-muted">Plattform</td><td>{info.platform}</td></tr>
                  <tr><td className="text-muted">Node.js</td><td className="dtable__mono">{info.node}</td></tr>
                  <tr><td className="text-muted">Datenverzeichnis</td><td className="dtable__mono">{info.dataDir}</td></tr>
                  <tr><td className="text-muted">Laufzeit</td><td>{formatUptime(info.uptime)}</td></tr>
                </tbody>
              </table>
              <div className="section-heading" style={{ marginTop: 18, marginBottom: 8 }}>Erkannte Module</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {Object.entries(info.features).map(([k, v]) => (
                  <span key={k} className={`badge badge--${v ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
                    {v ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {k}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
