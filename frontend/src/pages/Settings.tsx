import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ReactNode } from 'react';
import qrcode from 'qrcode-generator';
import { KeyRound, Download, Upload, RotateCw, Server, CheckCircle2, XCircle, FileArchive, ShieldCheck, Bell, Smartphone, Copy, RefreshCw, ArrowUpCircle, Send, Trash2, Languages, Network, Mic, Volume2, BrainCircuit } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { SortablePanels } from '../components/ui/SortablePanels';
import { Switch } from '../components/ui/Switch';
import { SmtpPanel } from '../components/security/AlertsPanel';
import { api } from '../lib/api';
import { recordPcm } from '../lib/voice';
import { formatUptime, timeAgo } from '../lib/utils';
import { useI18n, LANGUAGES, tt } from '../lib/i18n';
import type { NotificationItem, NotificationConfig, VersionInfo, VoiceConfig } from '../lib/types';

function LanguagePanel() {
  const { lang, setLang, t } = useI18n();
  return (
    <Panel title={t('settings.language')} icon={<Languages size={15} />} subtitle={t('settings.language.desc')} storageKey="set-lang">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            className={`btn btn--sm ${lang === l.code ? 'btn--primary' : 'btn--outline'}`}
            onClick={() => setLang(l.code)}
          >
            <span style={{ fontSize: 15 }}>{l.flag}</span> {l.label}
          </button>
        ))}
      </div>
    </Panel>
  );
}

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
    <Panel title={tt('Passwort ändern')} icon={<KeyRound size={15} />} subtitle={tt('Dein Core-Hub Login')} storageKey="set-pw">
      <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
        {msg && <div className={msg.type === 'ok' ? 'login-error' : 'login-error'} style={msg.type === 'ok' ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)' } : undefined}>{msg.text}</div>}
        <div className="form-group"><label className="form-label">{tt('Aktuelles Passwort')}</label>
          <input className="input input--rect" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Neues Passwort')}</label>
          <input className="input input--rect" type="password" value={next} onChange={(e) => setNext(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Neues Passwort bestätigen')}</label>
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
    if (!confirm(tt('Konfiguration importieren? Bestehende Daten werden überschrieben.'))) return;
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
    if (!confirm(tt('Core-Hub jetzt neustarten?'))) return;
    try { await api.settings.restart(); alert(tt('Neustart ausgelöst. Die Seite lädt in ein paar Sekunden neu.')); setTimeout(() => location.reload(), 6000); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <Panel title={tt('Migration: Export / Import')} icon={<FileArchive size={15} />} subtitle={tt('Umzug auf einen anderen Server')} storageKey="set-migration">
      <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 14 }}>
        Sichert die komplette Core-Hub-Konfiguration in einer Datei: Datenbank (Benutzer, Proxy-Hosts, Kategorien),
        <b> {tt('Caddy-Zertifikate inkl. Root-CA')}</b> und SMB-Freigaben. Auf dem neuen Server einfach wieder importieren.
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
        <div style={{ fontSize: 11.5, marginTop: 2 }}>{tt('oder klicken zum Auswählen · .tar.gz')}</div>
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
    <Panel title={tt('Zwei-Faktor-Authentifizierung (2FA)')} icon={<ShieldCheck size={15} />}
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
              <input className="input input--rect" type="password" placeholder={tt('Aktuelles Passwort')} value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
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
              <label className="form-label">{tt('Geheimer Schlüssel')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--color-surface-sunken)', padding: '8px 10px', borderRadius: 6, letterSpacing: '0.08em', wordBreak: 'break-all' }}>{setup.secret}</code>
                <button className="btn btn--outline btn--icon btn--sm" title={tt('Kopieren')} onClick={() => navigator.clipboard?.writeText(setup.secret)}><Copy size={13} /></button>
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">otpauth-Link (Fallback / manuelles Hinzufügen)</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--color-surface-sunken)', padding: '8px 10px', borderRadius: 6, wordBreak: 'break-all', maxHeight: 56, overflow: 'auto' }}>{setup.otpauth}</code>
                <button className="btn btn--outline btn--icon btn--sm" title={tt('Kopieren')} onClick={() => navigator.clipboard?.writeText(setup.otpauth)}><Copy size={13} /></button>
              </div>
            </div>
            <label className="form-label">{tt('Code aus der App zum Bestätigen')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" inputMode="numeric" placeholder="000000" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ flex: 1, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
              <button className="btn btn--primary btn--sm" onClick={activate} disabled={busy || code.length !== 6}>{tt('Aktivieren')}</button>
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
    <Panel title={tt('Benachrichtigungen')} icon={<Bell size={15} />} subtitle={tt('E-Mail & Webhook bei Ereignissen')} storageKey="set-notify" defaultCollapsed>
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 14 }}>
          Werde bei Backups, Container-Abstürzen, Sicherheits- und Viren-Funden benachrichtigt.
          Webhook funktioniert mit Discord, Slack, Mattermost oder eigenen Endpunkten. E-Mail nutzt das lokale Mail-System.
        </div>
        <div style={{ display: 'grid', gap: 10, maxWidth: 520 }}>
          <div className="form-group">
            <label className="form-label">{tt('Webhook-URL')}</label>
            <input className="input input--rect" placeholder={tt('https://discord.com/api/webhooks/…')} value={cfg.webhookUrl} onChange={(e) => set({ webhookUrl: e.target.value })} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
          </div>
          <div className="form-group">
            <label className="form-label">{tt('E-Mail-Empfänger')}</label>
            <input className="input input--rect" placeholder={tt('admin@example.com')} value={cfg.emailTo} onChange={(e) => set({ emailTo: e.target.value })} />
          </div>
        </div>

        <div className="section-heading" style={{ marginTop: 16, marginBottom: 8 }}>{tt('Ereignisse')}</div>
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
          <span>{tt('Verlauf')}</span>
          {items.length > 0 && (
            <button className="btn btn--ghost btn--xs" onClick={() => act('clear', () => api.notifications.clear())}><Trash2 size={11} /> {tt('Leeren')}</button>
          )}
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>{tt('Noch keine Benachrichtigungen.')}</div>
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
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try { setVer(await api.settings.version(refresh)); } catch { /* */ }
    finally { setChecking(false); }
  }, []);
  // Beim Laden schnell (ohne git fetch), Button „Prüfen" holt den Remote-Stand frisch
  useEffect(() => { void check(false); }, [check]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [updateLog]);

  // Nach dem Update den Dienst pollen, bis er wieder online ist (neuer Build läuft),
  // dann „fertig" melden und die laufende Version anzeigen.
  const pollForNewVersion = async (priorBuild?: string) => {
    const started = Date.now();
    while (Date.now() - started < 120_000) {
      await new Promise(r => setTimeout(r, 3000));
      try {
        const res = await fetch('/health', { cache: 'no-store' });
        if (res.ok) {
          const h = await res.json().catch(() => null) as { version?: string } | null;
          const now = h?.version;
          if (now && priorBuild && now !== priorBuild) {
            setUpdateLog(l => [...l, `✓ Neue Version v${now} aktiv – lade Seite neu…`]);
            setTimeout(() => location.reload(), 1000);
            return;
          }
        }
      } catch { /* Dienst noch nicht erreichbar */ }
    }
  };

  const startUpdate = () => {
    if (!confirm(tt('Core-Hub jetzt aktualisieren? Der Dienst wird kurz neu gestartet.'))) return;
    setUpdating(true);
    setUpdateDone(false);
    setUpdateLog(['▶ Update gestartet…']);
    const priorBuild = ver?.current;
    let finished = false;

    const onDone = () => {
      if (finished) return;
      finished = true;
      setUpdateLog(l => [...l, '', '✓ Installation abgeschlossen. Core-Hub wird neu gestartet…']);
      setUpdating(false);
      setUpdateDone(true);
      void check(false);
      void pollForNewVersion(priorBuild);
    };

    const es = new EventSource('/api/settings/update/stream');
    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data) as { line: string };
        setUpdateLog(l => [...l, d.line]);
      } catch { /* */ }
    };
    es.addEventListener('done', () => { es.close(); onDone(); });
    es.onerror = () => { es.close(); onDone(); };
  };

  return (
    <Panel title={tt('Version & Updates')} icon={<ArrowUpCircle size={15} />} subtitle={ver ? `v${ver.current}` : undefined} storageKey="set-version"
      actions={
        <button className="btn btn--outline btn--sm" disabled={checking} onClick={() => check(true)}>
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
              <CheckCircle2 size={13} /> {tt('Aktuell')}
            </span>
          )}
        </div>

        {ver?.error && <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 10 }}>Versionsprüfung: {ver.error}</div>}

        {ver?.updateAvailable && !updating && !updateDone && (
          <div className="card" style={{ marginTop: 14, borderColor: 'var(--color-warning)' }}>
            <div className="card-body">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Neue Version {ver.latest} verfügbar</div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                Core-Hub automatisch aktualisieren: neuen Code holen, Abhängigkeiten installieren und Dienst neu starten.
                Deine Daten (Datenbank, Zertifikate) bleiben erhalten.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn--primary btn--sm" onClick={startUpdate}>
                  <ArrowUpCircle size={13} /> Jetzt aktualisieren
                </button>
                {ver.releaseUrl && (
                  <a className="btn btn--outline btn--sm" href={ver.releaseUrl} target="_blank" rel="noreferrer">
                    Release-Notes ansehen
                  </a>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 8 }}>
                Manuell: <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--color-surface-sunken)', padding: '1px 6px', borderRadius: 4 }}>{installCmd}</code>
              </div>
            </div>
          </div>
        )}

        {(updating || updateDone) && updateLog.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div ref={logRef} style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--color-input)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '10px 14px', maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {updateLog.join('\n')}
              {updating && <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginLeft: 6 }}>⟳</span>}
            </div>
            {updateDone && (
              <button className="btn btn--primary btn--sm" style={{ marginTop: 10 }} onClick={() => location.reload()}>
                <RotateCw size={13} /> Seite neu laden
              </button>
            )}
            {updating && (
              <button className="btn btn--outline btn--sm" style={{ marginTop: 10, marginLeft: 8 }} onClick={() => { setUpdating(false); setUpdateDone(true); }}>
                {tt('Abbrechen')}
              </button>
            )}
          </div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 12 }}>
          Repository: {ver?.repo ?? '—'}
          {ver?.method && ver.method !== 'none' ? ` · Prüfung via ${ver.method === 'github' ? 'GitHub-Releases' : 'Git'}` : ''}
          {ver ? ` · zuletzt geprüft ${timeAgo(new Date(ver.checkedAt).getTime() / 1000)}` : ''}
        </div>
      </div>
    </Panel>
  );
}

function NetworkPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.settings.getIpv6(); setEnabled(r.enabled); }
    catch { setEnabled(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (v: boolean) => {
    if (!v) {
      if (!confirm(tt('IPv6 deaktivieren? Das System nutzt dann nur noch IPv4. Die Einstellung bleibt auch nach einem Neustart erhalten.'))) return;
    }
    setBusy(true);
    try { await api.settings.setIpv6(v); setEnabled(v); }
    catch (e) { alert(e instanceof Error ? e.message : 'Fehler beim Umstellen'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={tt('Netzwerk-Protokoll')} icon={<Network size={15} />} subtitle={enabled == null ? undefined : (enabled ? 'IPv4 + IPv6' : 'nur IPv4')} storageKey="set-network" defaultCollapsed>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>IPv6 aktivieren</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 3, lineHeight: 1.5, maxWidth: 460 }}>
              Standardmäßig läuft das System <strong>{tt('nur über IPv4')}</strong>. Aktiviere IPv6 nur, wenn dein Netzwerk
              es benötigt. Die Einstellung wird über <code style={{ fontFamily: 'var(--font-mono)' }}>sysctl</code> gesetzt
              und bleibt nach einem Neustart erhalten.
            </div>
          </div>
          {enabled == null ? (
            <span className="spinner" style={{ width: 16, height: 16 }} />
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{ opacity: busy ? 0.5 : 1 }}>
              <Switch checked={enabled} onChange={(v) => void toggle(v)} />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function ProxyVisibilityPanel() {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [backend, setBackend] = useState('caddy');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.settings.getProxyVisibility(); setEnabled(r.enabled); setBackend(r.backend || 'caddy'); }
    catch { setEnabled(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (nextEnabled: boolean, nextBackend: string) => {
    setBusy(true);
    try { await api.settings.setProxyVisibility(nextEnabled, nextBackend); setEnabled(nextEnabled); setBackend(nextBackend); }
    catch (e) { alert(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={t('settings.proxy')} icon={<ShieldCheck size={15} />} subtitle={enabled == null ? undefined : (enabled ? backend : t('common.no'))} storageKey="set-proxy" defaultCollapsed>
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '10px 0' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{t('settings.proxy.enable')}</div>
            <div style={{ fontSize: 12, color: 'var(--color-muted)', marginTop: 3, lineHeight: 1.5, maxWidth: 460 }}>{t('settings.proxy.desc')}</div>
          </div>
          {enabled == null ? (
            <span className="spinner" style={{ width: 16, height: 16 }} />
          ) : (
            <div onClick={(e) => e.stopPropagation()} style={{ opacity: busy ? 0.5 : 1 }}>
              <Switch checked={enabled} onChange={(v) => void save(v, backend)} />
            </div>
          )}
        </div>
        {enabled && (
          <div style={{ paddingTop: 6 }}>
            <label className="form-label">{t('settings.proxy.backend')}</label>
            <select className="input input--rect" style={{ width: '100%', maxWidth: 320 }} value={backend} disabled={busy}
              onChange={(e) => void save(true, e.target.value)}>
              <option value="caddy">{t('settings.proxy.backend.caddy')}</option>
              <option value="nginx" disabled>{t('settings.proxy.backend.nginx')}</option>
              <option value="traefik" disabled>{t('settings.proxy.backend.traefik')}</option>
            </select>
            <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6, lineHeight: 1.5, maxWidth: 460 }}>{t('settings.proxy.backend.hint')}</div>
          </div>
        )}
      </div>
    </Panel>
  );
}

// ── Sprachsteuerung (lokal: Whisper STT + Piper TTS) ─────────────────────────────
const VOICE_LANGS: { code: VoiceConfig['lang']; label: string }[] = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
];

export function VoicePanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [cfg, setCfg] = useState<VoiceConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [qwenLoading, setQwenLoading] = useState(false);
  const [qwenLog, setQwenLog] = useState<string[]>([]);
  const qwenPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollQwen = () => {
    if (qwenPollRef.current) clearInterval(qwenPollRef.current);
    qwenPollRef.current = setInterval(async () => {
      try {
        const [c, l] = await Promise.all([api.voice.config(), api.voice.logs().catch(() => ({ lines: [] }))]);
        setCfg(c);
        setQwenLog(l.lines.slice(-8));
        if (c.available.qwenReady) {
          if (qwenPollRef.current) { clearInterval(qwenPollRef.current); qwenPollRef.current = null; }
          setQwenLoading(false);
          setMsg(tt('Qwen-Modell geladen – bereit.'));
        }
      } catch { /* */ }
    }, 3000);
  };

  const startQwenLoad = async () => {
    setQwenLoading(true); setMsg('');
    try { await api.voice.qwenLoad(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); setQwenLoading(false); return; }
    pollQwen();
  };

  const playPreview = async (voice: string) => {
    if (!cfg) return;
    setPreviewing(true); setMsg(tt('Erzeuge Hörprobe … (Stimme wird evtl. erst geladen)'));
    try {
      previewAudio.current?.pause();
      // Als Blob laden (mit Cookie), damit Fehler sichtbar werden und die
      // Wiedergabe zuverlässig startet (statt stiller <audio src>-Fehler).
      const res = await fetch(api.voice.previewUrl(voice, cfg.lang), { credentials: 'include' });
      if (!res.ok) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error || `HTTP ${res.status}`); }
      const url = URL.createObjectURL(await res.blob());
      const a = new Audio(url);
      previewAudio.current = a;
      a.onended = () => { setPreviewing(false); URL.revokeObjectURL(url); };
      a.onerror = () => { setPreviewing(false); setMsg(tt('Hörprobe konnte nicht abgespielt werden.')); };
      setMsg('');
      await a.play();
    } catch (e) { setPreviewing(false); setMsg(e instanceof Error ? e.message : tt('Hörprobe fehlgeschlagen (Stimme wird evtl. erst geladen).')); }
  };

  // Stimme klonen (Qwen)
  const [clName, setClName] = useState('');
  const [clText, setClText] = useState('');
  const [clPcm, setClPcm] = useState<ArrayBuffer | null>(null);
  const [clRec, setClRec] = useState(false);
  const [clBusy, setClBusy] = useState(false);

  const recordClone = async () => {
    if (!cfg) return;
    setClRec(true); setMsg(tt('Sprich ~6 Sekunden natürlich …'));
    try {
      const pcm = await recordPcm(6000);
      setClPcm(pcm);
      try { const { text } = await api.voice.sttOnce(pcm, cfg.lang); if (text) setClText(text); } catch { /* Transkript optional */ }
      setMsg(tt('Aufnahme fertig – Text prüfen und „Klonen".'));
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Aufnahme fehlgeschlagen'); }
    finally { setClRec(false); }
  };

  const doClone = async () => {
    if (!clPcm || !clName.trim()) return;
    setClBusy(true); setMsg('');
    try {
      await api.voice.clone(clName.trim(), clText.trim(), clPcm);
      setMsg(tt('Stimme geklont – unter „Stimme" auswählbar.'));
      setClName(''); setClText(''); setClPcm(null);
      await load();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Klonen fehlgeschlagen'); }
    finally { setClBusy(false); }
  };

  const delClone = async (id: string) => {
    try { await api.voice.deleteClone(id); await load(); } catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
  };

  const [cacheItems, setCacheItems] = useState<{ id: string; label: string; kind: string; bytes: number }[]>([]);
  const [cacheBusy, setCacheBusy] = useState('');

  const loadCache = useCallback(async () => {
    try { const r = await api.voice.cache(); setCacheItems(r.items); } catch { /* */ }
  }, []);
  const load = useCallback(async () => {
    try { const c = await api.voice.config(); setCfg(c); if (c.install?.running) setInstalling(true); if (c.available.daemon) void loadCache(); } catch { /* */ }
  }, [loadCache]);
  useEffect(() => { void load(); }, [load]);

  const fmtMB = (b: number) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : (b / 1e6).toFixed(0) + ' MB');
  const delCache = async (id: string, label: string) => {
    if (!confirm(tt('Wirklich löschen? ') + label + tt(' (wird bei Bedarf neu geladen)'))) return;
    setCacheBusy(id);
    try { await api.voice.deleteCache(id); await loadCache(); await load(); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setCacheBusy(''); }
  };
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); if (qwenPollRef.current) clearInterval(qwenPollRef.current); }, []);

  // Läuft im Daemon bereits ein Qwen-Ladevorgang (z.B. durch Hörprobe angestoßen),
  // dann Fortschritt automatisch mitverfolgen.
  useEffect(() => {
    if (cfg?.available.qwenLoading && !qwenPollRef.current) { setQwenLoading(true); pollQwen(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.available.qwenLoading]);

  const startInstall = async (kind: 'voice' | 'qwen' = 'voice') => {
    setInstalling(true); setInstallLog(''); setMsg('');
    try { await (kind === 'qwen' ? api.voice.installQwen() : api.voice.install()); } catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); setInstalling(false); return; }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const st = await api.voice.installStatus();
        setInstallLog(st.log.slice(-1500));
        if (!st.running) {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setInstalling(false);
          if (st.error) setMsg(st.error); else setMsg(tt('Sprachdienst installiert.'));
          void load();
        }
      } catch { /* */ }
    }, 4000);
  };

  const save = async (patch: Partial<Pick<VoiceConfig, 'enabled' | 'wakeword' | 'lang' | 'tts' | 'whisperModel' | 'voices'>>) => {
    setBusy(true); setMsg('');
    try { const c = await api.voice.setConfig(patch); setCfg((prev) => (prev ? { ...prev, ...c } : c)); setMsg(tt('Gespeichert')); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  if (!cfg) {
    const spin = <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}><span className="spinner" style={{ width: 18, height: 18 }} /></div>;
    return embedded ? spin : (
      <Panel title={tt('Sprachsteuerung')} icon={<Mic size={15} />} subtitle={tt('Lokal · Whisper + Piper')} storageKey="set-voice" defaultCollapsed>
        {spin}
      </Panel>
    );
  }

  const av = cfg.available;
  const body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 6 }}>

        {/* Verfügbarkeit */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span className={`badge badge--${av.daemon ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
            {av.daemon ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {tt('Sprachdienst')}
          </span>
          <span className={`badge badge--${av.tts ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
            {av.tts ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {tt('Sprachausgabe')}
          </span>
          <span className={`badge badge--${cfg.model ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
            {cfg.model ? <CheckCircle2 size={12} /> : <XCircle size={12} />} {cfg.model ? cfg.model.split('/').pop() : tt('kein Modell geladen')}
          </span>
        </div>
        {!av.daemon && (
          <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6, background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '12px 14px' }}>
            <div style={{ color: 'var(--color-warning)', fontWeight: 600, marginBottom: 8 }}>{tt('Der lokale Sprachdienst ist noch nicht installiert.')}</div>
            <button className="btn btn--primary btn--sm" disabled={installing} onClick={() => void startInstall()}>
              {installing
                ? <><span className="spinner" style={{ width: 11, height: 11 }} /> {tt('Installiere … (kann einige Minuten dauern)')}</>
                : <><Download size={12} /> {tt('Jetzt installieren')}</>}
            </button>
            <div style={{ marginTop: 8 }}>
              {tt('Das Verwaltungstool richtet Whisper + Piper selbst ein (per install.sh). Danach wird der Dienst bei jedem Update automatisch mit aktualisiert.')}
            </div>
            {installLog && (
              <pre style={{ marginTop: 8, maxHeight: 140, overflow: 'auto', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, padding: '8px 10px', fontSize: 10.5, color: 'var(--color-faint)', whiteSpace: 'pre-wrap' }}>{installLog}</pre>
            )}
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-faint)' }}>
              {tt('Alternativ manuell:')} <code style={{ background: 'var(--color-surface)', padding: '1px 6px', borderRadius: 4 }}>sudo bash install.sh --voice</code>
            </div>
          </div>
        )}

        {/* Aktiv */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('Sprachsteuerung aktivieren')}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Zeigt den Sprach-Assistenten in der KI-Zentrale.')}</span>
          </span>
          <Switch checked={cfg.enabled} disabled={busy} onChange={(v) => save({ enabled: v })} />
        </label>

        {/* Bedienung: Push-to-Talk (kein Weckwort mehr) */}
        <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6, background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px' }}>
          {tt('Bedienung: In der KI-Zentrale die Leertaste gedrückt halten und sprechen – loslassen sendet an die KI (Push-to-Talk, kein Weckwort nötig).')}
        </div>

        {/* Sprache */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tt('Sprache')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {VOICE_LANGS.map((l) => (
              <button key={l.code} className={`btn btn--sm ${cfg.lang === l.code ? 'btn--primary' : 'btn--outline'}`} disabled={busy} onClick={() => save({ lang: l.code })}>{l.label}</button>
            ))}
          </div>
        </div>

        {/* TTS-Stimme (für die gewählte Sprache) */}
        {(() => {
          const opts = av.catalog?.[cfg.lang] ?? [];
          const cur = cfg.voices?.[cfg.lang] ?? '';
          return (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tt('Stimme')} <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>({cfg.lang.toUpperCase()})</span></div>
              {opts.length === 0 ? (
                <div style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{tt('Für diese Sprache ist derzeit keine Stimme verfügbar.')}</div>
              ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select className="input" style={{ fontSize: 13, maxWidth: 320, flex: 1 }} value={cur} disabled={busy}
                    onChange={(e) => save({ voices: { [cfg.lang]: e.target.value } })}>
                    <option value="">{tt('Standard')}{opts[0] ? ` (${opts[0].label})` : ''}</option>
                    {opts.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}{o.installed ? '' : ' – ' + tt('lädt beim ersten Mal')}</option>
                    ))}
                  </select>
                  <button className="btn btn--outline btn--sm" disabled={previewing} title={tt('Stimme anhören')} onClick={() => void playPreview(cur || opts[0]?.id || '')}>
                    {previewing ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Volume2 size={13} />} {tt('Hörprobe')}
                  </button>
                </div>
              )}
              {/* Qwen3-TTS: sehr gute Stimme inkl. Deutsch (schwer, optional) */}
              {av.daemon && !av.qwen && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-muted)', lineHeight: 1.6 }}>
                  <button className="btn btn--outline btn--sm" disabled={installing} onClick={() => void startInstall('qwen')}>
                    {installing ? <><span className="spinner" style={{ width: 11, height: 11 }} /> {tt('Installiere …')}</> : <><Download size={12} /> {tt('Qwen-Stimme (auch Deutsch) installieren')}</>}
                  </button>
                  <div style={{ marginTop: 5 }}>{tt('Studioqualität inkl. Deutsch. Schwer: PyTorch + Modell (~3–4 GB), GPU empfohlen. Danach erscheinen „… · Qwen"-Stimmen.')}</div>
                </div>
              )}
              {av.qwen && av.qwenReady && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-success)' }}>{tt('Qwen-Stimmen verfügbar (inkl. Deutsch) – Modell geladen.')}</div>}
              {av.qwen && !av.qwenReady && (() => {
                const bytes = av.qwenBytes ?? 0;
                const total = av.qwenTotal || 3_800_000_000;
                const pct = Math.min(99, Math.round((bytes / total) * 100));
                const loading = qwenLoading || !!av.qwenLoading;
                return (
                  <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--color-muted)', lineHeight: 1.6 }}>
                    {!loading && bytes < total * 0.05 && (
                      <button className="btn btn--outline btn--sm" onClick={() => void startQwenLoad()}>
                        <Download size={12} /> {tt('Qwen-Modell laden (~3–4 GB)')}
                      </button>
                    )}
                    {(loading || bytes >= total * 0.05) && (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span className="spinner" style={{ width: 11, height: 11 }} />
                          <span>
                            {bytes > 0
                              ? <>{tt('Qwen-Modell wird geladen …')} {fmtMB(bytes)} / {fmtMB(total)} ({pct}%)</>
                              : tt('Qwen wird vorbereitet … (PyTorch startet, Download beginnt gleich)')}
                          </span>
                        </div>
                        <div style={{ height: 6, borderRadius: 3, background: 'var(--color-surface)', overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: (bytes > 0 ? pct : 3) + '%', background: 'var(--color-accent)', transition: 'width .4s' }} />
                        </div>
                        {qwenLog.length > 0 && (
                          <pre style={{
                            marginTop: 8, maxHeight: 120, overflowY: 'auto', fontSize: 10.5, lineHeight: 1.5,
                            background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)',
                            borderRadius: 6, padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                          }}>{qwenLog.join('\n')}</pre>
                        )}
                      </div>
                    )}
                    <div style={{ marginTop: 5 }}>{tt('Wird einmalig heruntergeladen/vorgeladen (mehrere GB, kann bei langsamer Leitung dauern). Der Verlauf oben zeigt live, was passiert.')}</div>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        {/* Stimme klonen (Qwen) */}
        {av.qwen && (() => {
          const clones = (av.catalog?.[cfg.lang] ?? []).filter((o) => o.id.startsWith('clone:'));
          return (
            <div style={{ padding: '12px 14px', background: 'var(--color-surface-sunken)', border: '1px solid var(--color-border)', borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{tt('Eigene Stimme klonen')}</div>
              <div style={{ fontSize: 11.5, color: 'var(--color-muted)', marginBottom: 10, lineHeight: 1.6 }}>{tt('Nimm ~6 Sekunden deiner Stimme auf. Sprich einen ruhigen, vollständigen Satz. Danach als Stimme wählbar (Deutsch/Englisch).')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" style={{ fontSize: 13, width: 180 }} placeholder={tt('Name der Stimme')} value={clName} disabled={clBusy || clRec} onChange={(e) => setClName(e.target.value)} />
                <button className="btn btn--outline btn--sm" disabled={clBusy || clRec} onClick={() => void recordClone()}>
                  {clRec ? <><span className="spinner" style={{ width: 11, height: 11 }} /> {tt('Nimmt auf …')}</> : <><Mic size={13} /> {clPcm ? tt('Neu aufnehmen') : tt('Aufnehmen (6 s)')}</>}
                </button>
                <button className="btn btn--primary btn--sm" disabled={clBusy || clRec || !clPcm || !clName.trim()} onClick={() => void doClone()}>
                  {clBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : null} {tt('Klonen')}
                </button>
              </div>
              {clPcm && (
                <textarea className="input" style={{ fontSize: 12.5, width: '100%', marginTop: 8, minHeight: 44 }} placeholder={tt('Gesprochener Text (Transkript) – verbessert das Klonen')} value={clText} disabled={clBusy} onChange={(e) => setClText(e.target.value)} />
              )}
              {clones.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {clones.map((c) => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
                      <span>{c.label}</span>
                      <button className="btn btn--ghost btn--icon btn--sm" style={{ color: 'var(--color-error)' }} title={tt('Löschen')} onClick={() => void delClone(c.id.replace('clone:', ''))}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}

        {/* Whisper-Modell (Genauigkeit vs. Tempo) */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{tt('Erkennungsmodell (Whisper)')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(cfg.whisperModels ?? ['tiny', 'base', 'small', 'medium', 'large-v3']).map((m) => (
              <button key={m} className={`btn btn--sm ${cfg.whisperModel === m ? 'btn--primary' : 'btn--outline'}`} disabled={busy}
                onClick={() => save({ whisperModel: m })} title={av.loaded?.includes(m) ? tt('geladen') : undefined}>
                {m}{av.loaded?.includes(m) ? ' ●' : ''}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 5 }}>{tt('Kleiner = schneller, größer = genauer. Für gutes Deutsch „small" oder „medium"; bei starker Hardware (viel RAM/CPU) „large-v3" für beste Genauigkeit. Ein neues Modell wird beim ersten Mal geladen.')}</div>
        </div>

        {/* Sprachausgabe */}
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('Antwort vorlesen (Sprachausgabe)')}</span>
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Liest die Antwort satzweise vor, sobald sie entsteht.')}</span>
          </span>
          <Switch checked={cfg.tts} disabled={busy} onChange={(v) => save({ tts: v })} />
        </label>

        {/* Speicher / Cache */}
        {av.daemon && (
          <div style={{ paddingTop: 12, borderTop: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                {tt('Speicher (Cache)')}
                {cacheItems.length > 0 && <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}> · {fmtMB(cacheItems.reduce((s, i) => s + i.bytes, 0))}</span>}
              </span>
              <button className="btn btn--outline btn--sm" onClick={() => void loadCache()}><RefreshCw size={12} /> {tt('Aktualisieren')}</button>
            </div>
            {cacheItems.length === 0 ? (
              <div style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{tt('Nichts im Cache.')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cacheItems.map((it) => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '6px 10px', background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                      <span style={{ color: 'var(--color-muted)', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>{fmtMB(it.bytes)}</span>
                      <button className="btn btn--ghost btn--icon btn--sm" style={{ color: 'var(--color-error)' }} disabled={cacheBusy === it.id} title={tt('Löschen')} onClick={() => void delCache(it.id, it.label)}>
                        {cacheBusy === it.id ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={13} />}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ fontSize: 11, color: 'var(--color-faint)', marginTop: 6 }}>{tt('Gelöschte Modelle/Stimmen werden bei Bedarf automatisch neu geladen.')}</div>
          </div>
        )}

        {msg && <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{msg}</div>}
      </div>
  );
  return embedded ? body : (
    <Panel title={tt('Sprachsteuerung')} icon={<Mic size={15} />} subtitle={tt('Lokal · Whisper (STT) + Piper (TTS) · DE/EN/TH')} storageKey="set-voice" defaultCollapsed>
      {body}
    </Panel>
  );
}

// ── Obsidian als „Gehirn" (lokale Wissensbasis / RAG) ────────────────────────────
export function ObsidianPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [st, setSt] = useState<import('../lib/types').ObsidianStatus | null>(null);
  const [vault, setVault] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { const s = await api.obsidian.status(); setSt(s); setVault(s.vault); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const sub = st?.connected
    ? `${tt('verbunden')} · ${st.chunks} ${tt('Infos')}`
    : (st?.enabled ? tt('aktiv, aber leer') : tt('aus'));

  const toggle = async (enabled: boolean) => {
    setBusy(true); setMsg('');
    try { const s = await api.obsidian.setConfig({ enabled, vault: vault.trim() || undefined }); setSt(s); setVault(s.vault); setMsg(enabled ? tt('Wissensbasis eingelesen.') : ''); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };
  const saveVault = async () => {
    setBusy(true); setMsg('');
    try { const s = await api.obsidian.setConfig({ vault: vault.trim() }); setSt(s); setMsg(tt('Gespeichert & neu eingelesen.')); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };
  const reindex = async () => {
    setBusy(true); setMsg('');
    try { const s = await api.obsidian.reindex(); setSt(s); setMsg(`${s.files} ${tt('Dateien')}, ${s.chunks} ${tt('Infos')} eingelesen.`); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>
          {tt('Verbinde deinen Obsidian-Vault (Ordner mit .md-Notizen) als „Gehirn". Die KI zieht bei Fragen automatisch passende Notizen als Kontext heran. Alles bleibt lokal.')}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={!!st?.enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
          {tt('Als Wissensbasis nutzen')}
        </label>

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{tt('Vault-Ordner')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 220, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              value={vault} onChange={(e) => setVault(e.target.value)} placeholder="/pfad/zum/Obsidian-Vault"
              onKeyDown={(e) => { if (e.key === 'Enter') void saveVault(); }} />
            <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => void saveVault()}>{tt('Speichern')}</button>
            <button className="btn btn--outline btn--sm" disabled={busy || !st?.enabled} onClick={() => void reindex()}>
              <RefreshCw size={13} /> {tt('Neu einlesen')}
            </button>
          </div>
          {st && !st.exists && <div style={{ fontSize: 11.5, color: 'var(--color-warning)', marginTop: 5 }}>{tt('Ordner existiert noch nicht – wird beim Aktivieren angelegt.')}</div>}
        </div>

        {st?.connected && (
          <div style={{ display: 'flex', gap: 18, fontSize: 12, color: 'var(--color-muted)', flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-success)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle2 size={13} /> {tt('verbunden')}
            </span>
            <span>{st.files} {tt('Dateien')}</span>
            <span>{st.chunks} {tt('Infos')}</span>
            {st.lastIndexed && <span>{tt('Stand')}: {new Date(st.lastIndexed).toLocaleString()}</span>}
          </div>
        )}

        {msg && <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{msg}</div>}
      </div>
  );
  return embedded ? body : (
    <Panel title={tt('Wissensbasis (Obsidian)')} icon={<BrainCircuit size={15} />} subtitle={sub} storageKey="set-obsidian" defaultCollapsed>
      {body}
    </Panel>
  );
}

// ── Internetzugriff für die KI (Live-Websuche) ───────────────────────────────────
export function WebAccessPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const [cfg, setCfg] = useState<{ enabled: boolean; maxResults: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [testQ, setTestQ] = useState('');
  const [hits, setHits] = useState<{ title: string; url: string }[] | null>(null);

  useEffect(() => { api.websearch.status().then(setCfg).catch(() => {}); }, []);

  const set = async (patch: { enabled?: boolean; maxResults?: number }) => {
    setBusy(true); setMsg('');
    try { setCfg(await api.websearch.setConfig(patch)); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!testQ.trim()) return;
    setBusy(true); setMsg(''); setHits(null);
    try { const r = await api.websearch.test(testQ.trim()); setHits(r.results.map((x) => ({ title: x.title, url: x.url }))); if (!r.results.length) setMsg(tt('Keine Treffer.')); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const body = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>
          {tt('Erlaubt der KI, bei Fragen live im Web zu suchen (DuckDuckGo, kein Konto/Schlüssel nötig) und die Treffer als Kontext zu nutzen. So kennt auch ein lokales Modell aktuelle Infos.')}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={!!cfg?.enabled} disabled={busy} onChange={(e) => void set({ enabled: e.target.checked })} />
          {tt('Internetzugriff aktivieren')}
        </label>
        {cfg && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
            {tt('Trefferanzahl pro Frage')}
            <select className="input" style={{ width: 70 }} value={cfg.maxResults} disabled={busy} onChange={(e) => void set({ maxResults: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{tt('Testsuche')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} value={testQ} onChange={(e) => setTestQ(e.target.value)}
              placeholder={tt('z. B. Wetter Berlin heute')} onKeyDown={(e) => { if (e.key === 'Enter') void test(); }} />
            <button className="btn btn--outline btn--sm" disabled={busy || !testQ.trim()} onClick={() => void test()}>{tt('Suchen')}</button>
          </div>
          {hits && hits.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--color-muted)' }}>
              {hits.map((h, i) => <li key={i} style={{ marginBottom: 3 }}><a href={h.url} target="_blank" rel="noreferrer" style={{ color: 'var(--color-accent)' }}>{h.title || h.url}</a></li>)}
            </ul>
          )}
        </div>
        {msg && <div style={{ fontSize: 12, color: 'var(--color-muted)' }}>{msg}</div>}
      </div>
  );
  return embedded ? body : (
    <Panel title={tt('Internetzugriff (KI)')} icon={<Network size={15} />} subtitle={cfg ? (cfg.enabled ? tt('an') : tt('aus')) : undefined} storageKey="set-websearch" defaultCollapsed>
      {body}
    </Panel>
  );
}

// ── Sammel-Panel: alle KI-Erweiterungen kompakt in einem einklappbaren Panel ──────
function ExtSection({ icon, title, hint, storageKey, children }: { icon: ReactNode; title: string; hint?: string; storageKey: string; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) === '1'; } catch { return false; }
  });
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem(storageKey, n ? '1' : '0'); } catch { /* */ } return n; });
  return (
    <div style={{ border: '1px solid var(--color-border)', borderRadius: 10, overflow: 'hidden' }}>
      <button onClick={toggle} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '11px 13px',
        background: 'var(--color-surface)', border: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--color-fg)',
      }}>
        <span style={{ display: 'inline-flex', color: 'var(--color-accent)' }}>{icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{title}</span>
        {hint && <span style={{ fontSize: 11.5, color: 'var(--color-faint)' }}>{hint}</span>}
        <RotateCw size={13} style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s', color: 'var(--color-faint)' }} />
      </button>
      {open && <div style={{ padding: '4px 13px 14px', borderTop: '1px solid var(--color-border)' }}>{children}</div>}
    </div>
  );
}

export function AiExtensionsPanel() {
  const [brain, setBrain] = useState<import('../lib/types').ObsidianStatus | null>(null);
  const [web, setWeb] = useState<{ enabled: boolean } | null>(null);
  useEffect(() => { api.obsidian.status().then(setBrain).catch(() => {}); api.websearch.status().then(setWeb).catch(() => {}); }, []);

  const parts = [
    brain?.connected ? `Obsidian: ${brain.chunks}` : null,
    web?.enabled ? tt('Internet an') : null,
  ].filter(Boolean);

  return (
    <Panel title={tt('KI-Erweiterungen')} icon={<BrainCircuit size={15} />} subtitle={parts.length ? parts.join(' · ') : tt('optional')} storageKey="set-aiext" defaultCollapsed>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--color-faint)', lineHeight: 1.55 }}>
          {tt('Alles optional – zum Starten nicht nötig. Bei Bedarf einzeln aufklappen und einschalten.')}
        </div>
        <ExtSection icon={<Mic size={15} />} title={tt('Sprachsteuerung')} storageKey="aiext-voice">
          <VoicePanel embedded />
        </ExtSection>
        <ExtSection icon={<BrainCircuit size={15} />} title={tt('Wissensbasis (Obsidian)')} hint={brain?.connected ? `${brain.chunks} ${tt('Infos')}` : undefined} storageKey="aiext-obsidian">
          <ObsidianPanel embedded />
        </ExtSection>
        <ExtSection icon={<Network size={15} />} title={tt('Internetzugriff (KI)')} hint={web?.enabled ? tt('an') : tt('aus')} storageKey="aiext-web">
          <WebAccessPanel embedded />
        </ExtSection>
      </div>
    </Panel>
  );
}

export function Settings() {
  const { t } = useI18n();
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.settings.info>> | null>(null);

  const load = useCallback(async () => {
    try { setInfo(await api.settings.info()); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <Topbar title={t('nav.settings')} subtitle={info ? t('page.settings.subtitle', { version: info.version }) : undefined} />
      <main className="page">
        <SortablePanels storageKey="settings" items={[
          { id: 'language', node: <LanguagePanel /> },
          { id: 'network', node: <NetworkPanel /> },
          { id: 'proxy', node: <ProxyVisibilityPanel /> },
          { id: 'version', node: <VersionPanel installCmd={'cd docker-gui\ngit pull\nsudo bash install.sh'} /> },
          { id: 'password', node: <PasswordPanel /> },
          { id: '2fa', node: <TwoFactorPanel /> },
          { id: 'smtp', node: <SmtpPanel /> },
          { id: 'notifications', node: <NotificationsPanel /> },
          { id: 'migration', node: <MigrationPanel /> },
          { id: 'sysinfo', node: (
        <Panel title={tt('System-Info')} icon={<Server size={15} />} subtitle={info?.hostname} storageKey="set-info" defaultCollapsed>
          {info && (
            <div style={{ marginTop: 8 }}>
              <table className="dtable">
                <tbody>
                  <tr><td className="text-muted" style={{ width: 180 }}>{tt('Version')}</td><td style={{ fontWeight: 600 }}>Core-Hub {info.version}</td></tr>
                  <tr><td className="text-muted">{tt('Host')}</td><td>{info.hostname}</td></tr>
                  <tr><td className="text-muted">{tt('Plattform')}</td><td>{info.platform}</td></tr>
                  <tr><td className="text-muted">{tt('Node.js')}</td><td className="dtable__mono">{info.node}</td></tr>
                  <tr><td className="text-muted">{tt('Datenverzeichnis')}</td><td className="dtable__mono">{info.dataDir}</td></tr>
                  <tr><td className="text-muted">{tt('Laufzeit')}</td><td>{formatUptime(info.uptime)}</td></tr>
                </tbody>
              </table>
              <div className="section-heading" style={{ marginTop: 18, marginBottom: 8 }}>{tt('Erkannte Module')}</div>
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
          ) },
        ]} />
      </main>
    </>
  );
}
