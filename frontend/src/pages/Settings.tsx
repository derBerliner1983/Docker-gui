import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { KeyRound, Download, Upload, RotateCw, Server, CheckCircle2, XCircle, FileArchive, ShieldCheck, Bell, Smartphone, Copy, RefreshCw, ArrowUpCircle, Send, Trash2 } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { formatUptime, timeAgo } from '../lib/utils';
import type { NotificationItem, NotificationConfig, VersionInfo } from '../lib/types';

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

/** Render an otpauth:// URI as a scannable QR code (SVG, white background). */
function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      // typeNumber 0 = automatische Größe, Fehlerkorrektur 'M' (gut für Scannen)
      const qr = qrcode(0, 'M');
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch {
      return '';
    }
  }, [value]);

  if (!svg) return null;
  return (
    <div
      style={{
        width: size, height: size, padding: 10, background: '#fff',
        borderRadius: 10, boxShadow: '0 0 0 1px var(--color-border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function TwoFactorPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try { setEnabled((await api.auth.twoFactor.status()).enabled); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const begin = async () => {
    setBusy(true); setMsg(null);
    try { setSetup(await api.auth.twoFactor.setup()); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.auth.twoFactor.enable(code);
      setSetup(null); setCode(''); setMsg({ type: 'ok', text: '2FA aktiviert. Beim nächsten Login wird ein Code abgefragt.' });
      await load();
    } catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!pw) { setMsg({ type: 'err', text: 'Passwort erforderlich' }); return; }
    setBusy(true); setMsg(null);
    try { await api.auth.twoFactor.disable(pw); setPw(''); setMsg({ type: 'ok', text: '2FA deaktiviert.' }); await load(); }
    catch (err) { setMsg({ type: 'err', text: err instanceof Error ? err.message : 'Fehler' }); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Zwei-Faktor-Authentifizierung (2FA)" icon={<ShieldCheck size={15} />}
      subtitle={enabled === null ? undefined : enabled ? 'aktiv' : 'inaktiv'} storageKey="set-2fa"
      actions={enabled !== null && (
        <span className={`badge badge--${enabled ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
          <span className="badge__dot" /> {enabled ? 'aktiv' : 'inaktiv'}
        </span>
      )}
    >
      <div style={{ maxWidth: 460, marginTop: 8 }}>
        {msg && <div className="login-error" style={msg.type === 'ok' ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', marginBottom: 10 } : { marginBottom: 10 }}>{msg.text}</div>}

        {enabled ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
              Dein Konto ist mit einer Authenticator-App (TOTP) abgesichert. Zum Deaktivieren bitte Passwort eingeben.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" type="password" placeholder="Aktuelles Passwort" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn--danger btn--sm" onClick={disable} disabled={busy}>2FA deaktivieren</button>
            </div>
          </>
        ) : setup ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              <Smartphone size={13} style={{ verticalAlign: -2 }} /> Scanne den QR-Code mit deiner Authenticator-App
              (Google Authenticator, Aegis, 1Password …) – oder gib den geheimen Schlüssel manuell ein.
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <QrCode value={setup.otpauth} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label className="form-label">Geheimer Schlüssel</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--color-surface-sunken)', padding: '8px 10px', borderRadius: 6, letterSpacing: '0.08em', wordBreak: 'break-all' }}>{setup.secret}</code>
                <button className="btn btn--outline btn--icon btn--sm" title="Kopieren" onClick={() => navigator.clipboard?.writeText(setup.secret)}><Copy size={13} /></button>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">otpauth-Link (Fallback / manuelles Hinzufügen)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--color-surface-sunken)', padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all', maxHeight: 56, overflow: 'auto' }}>{setup.otpauth}</code>
                <button className="btn btn--outline btn--icon btn--sm" title="Kopieren" onClick={() => navigator.clipboard?.writeText(setup.otpauth)}><Copy size={13} /></button>
              </div>
            </div>
            <label className="form-label">Code aus der App zum Bestätigen</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" inputMode="numeric" placeholder="000000" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ flex: 1, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
              <button className="btn btn--primary btn--sm" onClick={activate} disabled={busy || code.length !== 6}>Aktivieren</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              Schütze deinen Login mit einem zusätzlichen Einmalcode aus einer Authenticator-App.
            </div>
            <button className="btn btn--primary btn--sm" onClick={begin} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} 2FA einrichten
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

const LEVEL_COLOR: Record<string, string> = {
  info: 'var(--color-subtle)', success: 'var(--color-success)', warning: 'var(--color-warning)', error: 'var(--color-error)',
};

function NotificationsPanel() {
  const [cfg, setCfg] = useState<NotificationConfig | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { const r = await api.notifications.list(); setCfg(r.config); setItems(r.notifications); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key); setMsg('');
    try { await fn(); if (ok) setMsg(ok); await load(); }
    catch (err) { setMsg(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(''); }
  };

  if (!cfg) return null;
  const set = (patch: Partial<NotificationConfig>) => setCfg({ ...cfg, ...patch });

  return (
    <Panel title="Benachrichtigungen" icon={<Bell size={15} />} subtitle="E-Mail & Webhook bei Ereignissen" storageKey="set-notify" defaultCollapsed>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 14 }}>
          Werde bei Backups, Container-Abstürzen, Sicherheits- und Viren-Funden benachrichtigt.
          Webhook funktioniert mit Discord, Slack, Mattermost oder eigenen Endpunkten. E-Mail nutzt das lokale Mail-System.
        </div>
        <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <div className="form-group">
            <label className="form-label">Webhook-URL</label>
            <input className="input input--rect" placeholder="https://discord.com/api/webhooks/…" value={cfg.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label className="form-label">E-Mail-Empfänger</label>
            <input className="input input--rect" placeholder="admin@example.com" value={cfg.emailTo} onChange={(e) => set({ emailTo: e.target.value })} />
          </div>
        </div>

        <div className="section-heading" style={{ marginTop: 16, marginBottom: 8 }}>Ereignisse</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
          {([['onBackup', 'Backups (geplant)'], ['onContainer', 'Container-Abstürze'], ['onSecurity', 'Sicherheits-Funde'], ['onAntivirus', 'Viren-Funde']] as const).map(([k, label]) => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 13 }}>
              <span>{label}</span>
              <Switch checked={cfg[k]} onChange={(v) => set({ [k]: v } as Partial<NotificationConfig>)} />
            </label>
          ))}
        </div>

        {msg && <div className="login-error" style={{ marginTop: 12 }}>{msg}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button className="btn btn--primary btn--sm" disabled={busy === 'save'} onClick={() => act('save', () => api.notifications.saveConfig(cfg), 'Gespeichert.')}>
            {busy === 'save' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <CheckCircle2 size={13} />} Speichern
          </button>
          <button className="btn btn--outline btn--sm" disabled={busy === 'test'} onClick={() => act('test', () => api.notifications.test(), 'Test gesendet.')}>
            {busy === 'test' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Send size={13} />} Test senden
          </button>
        </div>

        <div className="section-heading" style={{ marginTop: 20, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Verlauf</span>
          {items.length > 0 && (
            <button className="btn btn--ghost btn--xs" onClick={() => act('clear', () => api.notifications.clear())}><Trash2 size={11} /> Leeren</button>
          )}
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>Noch keine Benachrichtigungen.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {items.slice(0, 20).map((n) => (
              <div key={n.id} style={{ display: 'flex', gap: 10, fontSize: 12.5, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: LEVEL_COLOR[n.level] ?? 'var(--color-subtle)', marginTop: 5, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{n.title}</div>
                  {n.message && <div style={{ color: 'var(--color-muted)' }}>{n.message}</div>}
                </div>
                <span className="text-faint" style={{ whiteSpace: 'nowrap' }}>{timeAgo(new Date(n.created_at + 'Z').getTime() / 1000)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function VersionPanel({ installCmd }: { installCmd: string }) {
  const [ver, setVer] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try { setVer(await api.settings.version()); } catch { /* */ }
    finally { setChecking(false); }
  }, []);
  useEffect(() => { void check(); }, [check]);

  return (
    <Panel title="Version & Updates" icon={<ArrowUpCircle size={15} />} subtitle={ver ? `v${ver.current}` : undefined} storageKey="set-version"
      actions={
        <button className="btn btn--outline btn--sm" disabled={checking} onClick={check}>
          {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} Prüfen
        </button>
      }
    >
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 22, fontWeight: 700 }}>Core-Hub v{ver?.current ?? '…'}</span>
          {ver && ver.updateAvailable && (
            <span className="badge badge--restarting" style={{ height: 26, padding: '0 12px' }}>
              <ArrowUpCircle size={13} /> Update verfügbar: {ver.latest}
            </span>
          )}
          {ver && !ver.updateAvailable && !ver.error && ver.latest && (
            <span className="badge badge--running" style={{ height: 26, padding: '0 12px' }}>
              <CheckCircle2 size={13} /> Aktuell
            </span>
          )}
        </div>

        {ver?.error && <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 10 }}>Versionsprüfung: {ver.error}</div>}

        {ver?.updateAvailable && (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--color-warning)' }}>
            <div className="card-body">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Neue Version {ver.latest} verfügbar</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                So aktualisierst du Core-Hub – aktuelle Version holen und Installer erneut ausführen.
                Deine Daten (Datenbank, Zertifikate) bleiben erhalten:
              </div>
              <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '10px 12px', borderRadius: 6, overflowX: 'auto', margin: 0 }}>{installCmd}</pre>
              {ver.releaseUrl && (
                <a className="btn btn--outline btn--sm" style={{ marginTop: 10 }} href={ver.releaseUrl} target="_blank" rel="noreferrer">
                  Release-Notes auf GitHub ansehen
                </a>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 12 }}>
          Repository: {ver?.repo ?? '—'}{ver ? ` · zuletzt geprüft ${timeAgo(new Date(ver.checkedAt).getTime() / 1000)}` : ''}
        </div>
      </div>
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
        <VersionPanel installCmd={'cd docker-gui\ngit pull\nsudo bash install.sh'} />
        <PasswordPanel />
        <TwoFactorPanel />
        <NotificationsPanel />
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
