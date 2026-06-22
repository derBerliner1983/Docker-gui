import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldCheck, Bug, Download, RefreshCw, Play, Search, CheckCircle2, AlertOctagon } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import type { AntivirusStatus } from '../lib/types';

export function Antivirus() {
  const [av, setAv] = useState<AntivirusStatus | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState('');
  const [scanPath, setScanPath] = useState('/home');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setAv(await api.antivirus.status()); } catch { /* */ }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => {
    void load();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  // Poll while a scan is running
  useEffect(() => {
    if (av?.scan.running && !pollRef.current) {
      pollRef.current = setInterval(load, 2500);
    } else if (!av?.scan.running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [av?.scan.running, load]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try { await fn(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(''); }
  };

  const startScan = async () => {
    if (!scanPath.startsWith('/')) { alert('Absoluter Pfad erforderlich'); return; }
    await act('scan', () => api.antivirus.scan(scanPath));
  };

  const s = av?.scan;
  const lastClean = s && !s.running && s.finishedAt && s.infectedCount === 0;

  return (
    <>
      <Topbar
        title="Virenschutz"
        subtitle={av?.installed ? av.version || 'ClamAV' : undefined}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        {!av ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>
        ) : !av.installed ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Bug size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">Kein Virenschutz installiert</div>
            <div className="empty-state__desc">
              ClamAV ist ein quelloffener Virenscanner für Linux. Mit einem Klick installieren:
            </div>
            <button className="btn btn--primary btn--sm" style={{ marginTop: 16 }} disabled={busy === 'install'} onClick={() => act('install', api.antivirus.install)}>
              {busy === 'install' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} ClamAV installieren
            </button>
            <div className="empty-state__desc" style={{ marginTop: 16 }}>
              oder manuell: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '3px 7px', borderRadius: 5 }}>sudo apt install clamav clamav-daemon</code>
            </div>
          </div>
        ) : (
          <>
            {/* Status */}
            <Panel title="Status" icon={<ShieldCheck size={15} />} subtitle={av.version} storageKey="av-status"
              actions={
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn--outline btn--sm" disabled={busy === 'update'} onClick={() => act('update', api.antivirus.update)}>
                    {busy === 'update' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} Signaturen aktualisieren
                  </button>
                </div>
              }
            >
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
                <span className={`badge badge--${av.daemonActive ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
                  <span className="badge__dot" /> Daemon {av.daemonActive ? 'aktiv' : 'inaktiv'}
                </span>
                <span className={`badge badge--${av.freshclamActive ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
                  <span className="badge__dot" /> Auto-Updates {av.freshclamActive ? 'aktiv' : 'inaktiv'}
                </span>
                <span className={`badge badge--${av.defsAgeDays !== null && av.defsAgeDays <= 7 ? 'running' : 'restarting'}`} style={{ height: 24, padding: '0 10px' }}>
                  Signaturen: {av.defsAgeDays === null ? 'unbekannt' : av.defsAgeDays === 0 ? 'heute' : `${av.defsAgeDays} Tage alt`}
                </span>
              </div>
            </Panel>

            {/* Scan */}
            <Panel title="Scan" icon={<Search size={15} />} subtitle={s?.running ? 'läuft…' : undefined} storageKey="av-scan">
              <div style={{ display: 'flex', gap: 8, marginTop: 10, marginBottom: 14, flexWrap: 'wrap' }}>
                <input className="input input--rect" value={scanPath} onChange={(e) => setScanPath(e.target.value)} placeholder="/home" style={{ flex: 1, minWidth: 220, fontFamily: 'var(--font-mono)' }} disabled={s?.running} />
                <button className="btn btn--primary btn--sm" disabled={s?.running || busy === 'scan'} onClick={startScan}>
                  {s?.running || busy === 'scan' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Play size={13} />} Scan starten
                </button>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 14 }}>
                {['/home', '/opt', '/var/www', '/tmp', '/'].map((p) => (
                  <button key={p} className="btn btn--outline btn--xs" disabled={s?.running} onClick={() => setScanPath(p)}>{p}</button>
                ))}
              </div>

              {s?.running && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-accent)', fontSize: 13 }}>
                  <span className="spinner" style={{ width: 14, height: 14 }} />
                  Scanne {s.path} … {s.scanned > 0 && `${s.scanned} Dateien geprüft`}{s.infectedCount > 0 && ` · ${s.infectedCount} Funde`}
                </div>
              )}

              {lastClean && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-success)', fontSize: 14, fontWeight: 600 }}>
                  <CheckCircle2 size={18} /> Keine Bedrohungen gefunden in {s.path} ({s.scanned} Dateien)
                </div>
              )}

              {s && !s.running && s.infectedCount > 0 && (
                <div className="card" style={{ borderColor: 'var(--color-error)' }}>
                  <div className="card-body">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-error)', fontWeight: 700, marginBottom: 8 }}>
                      <AlertOctagon size={18} /> {s.infectedCount} Bedrohung(en) gefunden!
                    </div>
                    <table className="dtable">
                      <thead><tr><th>Datei</th><th>Bedrohung</th></tr></thead>
                      <tbody>
                        {s.infected.map((i, idx) => (
                          <tr key={idx}>
                            <td className="dtable__mono" style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.file}</td>
                            <td style={{ color: 'var(--color-error)', fontWeight: 600 }}>{i.virus}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {s?.error && <div className="login-error" style={{ marginTop: 10 }}>{s.error}</div>}
            </Panel>
          </>
        )}
      </main>
    </>
  );
}
