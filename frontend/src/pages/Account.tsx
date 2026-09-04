import { useCallback, useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import {
  UserRound, KeyRound, ShieldCheck, Smartphone, Copy, Palette, Sun, Moon, MonitorSmartphone,
  Languages, Clock,
} from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useTheme, type ThemeMode } from '../lib/theme';
import { usePrefs } from '../lib/prefs';
import { IDLE_CHOICES, IDLE_PREF, LANG_PREF, idleMinutes } from '../lib/prefsSync';
import { tt, useI18n, LANGUAGES, type LangCode } from '../lib/i18n';

type Msg = { type: 'ok' | 'err'; text: string } | null;

function Note({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return (
    <div
      className="login-error"
      style={msg.type === 'ok'
        ? { background: 'var(--color-accent-soft)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', marginBottom: 10 }
        : { marginBottom: 10 }}
    >
      {msg.text}
    </div>
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : tt('Fehler');
}

/** ── Anzeigename ─────────────────────────────────────────────────────────── */
function ProfilePanel() {
  const { user, refreshUser } = useAuth();
  const [name, setName] = useState(user?.displayName ?? user?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  useEffect(() => { setName(user?.displayName ?? user?.username ?? ''); }, [user]);

  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.auth.updateProfile(name.trim());
      await refreshUser();
      setMsg({ type: 'ok', text: tt('Anzeigename gespeichert.') });
    } catch (err) { setMsg({ type: 'err', text: errText(err) }); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={tt('Profil')} icon={<UserRound size={15} />} subtitle={user?.username} storageKey="acc-profile">
      <div style={{ maxWidth: 460, marginTop: 8 }}>
        <Note msg={msg} />
        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">{tt('Anmeldename')}</label>
          <input className="input input--rect" value={user?.username ?? ''} disabled />
          <div className="form-hint">{tt('Der Anmeldename lässt sich nicht ändern – er hängt an Sitzungen und Protokoll.')}</div>
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Anzeigename')}</label>
          <input
            className="input input--rect"
            value={name}
            maxLength={64}
            placeholder={user?.username ?? ''}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}
          />
          <div className="form-hint">{tt('Wird in der Seitenleiste angezeigt. Leer lassen = Anmeldename.')}</div>
        </div>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={busy} style={{ marginTop: 10 }}>
          {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null} {tt('Speichern')}
        </button>
      </div>
    </Panel>
  );
}

/** ── Passwort ────────────────────────────────────────────────────────────── */
function PasswordPanel() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const save = async () => {
    if (next.length < 8) { setMsg({ type: 'err', text: tt('Das neue Passwort muss mindestens 8 Zeichen haben.') }); return; }
    if (next !== confirm) { setMsg({ type: 'err', text: tt('Die neuen Passwörter stimmen nicht überein.') }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.auth.changePassword(cur, next);
      setCur(''); setNext(''); setConfirm('');
      setMsg({ type: 'ok', text: tt('Passwort geändert.') });
    } catch (err) { setMsg({ type: 'err', text: errText(err) }); }
    finally { setBusy(false); }
  };

  return (
    <Panel title={tt('Passwort ändern')} icon={<KeyRound size={15} />} storageKey="acc-password">
      <div style={{ maxWidth: 460, marginTop: 8, display: 'grid', gap: 10 }}>
        <Note msg={msg} />
        <div className="form-group">
          <label className="form-label">{tt('Aktuelles Passwort')}</label>
          <input className="input input--rect" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Neues Passwort')}</label>
          <input className="input input--rect" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Neues Passwort wiederholen')}</label>
          <input className="input input--rect" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </div>
        <div>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={busy || !cur || !next}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : null} {tt('Passwort ändern')}
          </button>
        </div>
      </div>
    </Panel>
  );
}

/** otpauth-Link als scannbaren QR-Code darstellen (SVG, weißer Grund). */
function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');   // 0 = automatische Größe, 'M' = mittlere Fehlerkorrektur
      qr.addData(value);
      qr.make();
      return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
    } catch { return ''; }
  }, [value]);
  if (!svg) return null;
  return (
    <div
      style={{
        width: size, height: size, padding: 10, background: '#fff', borderRadius: 10,
        boxShadow: '0 0 0 1px var(--color-border)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** ── Zwei-Faktor-Authentifizierung ───────────────────────────────────────── */
function TwoFactorPanel() {
  const { refreshUser } = useAuth();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const load = useCallback(async () => {
    try { setEnabled((await api.auth.twoFactor.status()).enabled); } catch { /* */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const begin = async () => {
    setBusy(true); setMsg(null);
    try { setSetup(await api.auth.twoFactor.setup()); }
    catch (err) { setMsg({ type: 'err', text: errText(err) }); }
    finally { setBusy(false); }
  };

  const activate = async () => {
    setBusy(true); setMsg(null);
    try {
      await api.auth.twoFactor.enable(code);
      setSetup(null); setCode('');
      setMsg({ type: 'ok', text: tt('2FA aktiviert. Beim nächsten Anmelden wird ein Code abgefragt.') });
      await load(); await refreshUser();
    } catch (err) { setMsg({ type: 'err', text: errText(err) }); }
    finally { setBusy(false); }
  };

  const disable = async () => {
    if (!pw) { setMsg({ type: 'err', text: tt('Passwort erforderlich') }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.auth.twoFactor.disable(pw);
      setPw(''); setMsg({ type: 'ok', text: tt('2FA deaktiviert.') });
      await load(); await refreshUser();
    } catch (err) { setMsg({ type: 'err', text: errText(err) }); }
    finally { setBusy(false); }
  };

  return (
    <Panel
      title={tt('Zwei-Faktor-Authentifizierung (2FA)')}
      icon={<ShieldCheck size={15} />}
      storageKey="acc-2fa"
      actions={enabled !== null && (
        <span className={`badge badge--${enabled ? 'running' : 'stopped'}`} style={{ height: 24, padding: '0 10px' }}>
          <span className="badge__dot" /> {enabled ? tt('aktiv') : tt('inaktiv')}
        </span>
      )}
    >
      <div style={{ maxWidth: 460, marginTop: 8 }}>
        <Note msg={msg} />

        {enabled ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
              {tt('Dein Konto ist mit einer Authenticator-App (TOTP) abgesichert. Zum Deaktivieren bitte das Passwort eingeben.')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="input input--rect" type="password" placeholder={tt('Aktuelles Passwort')} value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn--danger btn--sm" onClick={disable} disabled={busy}>{tt('2FA deaktivieren')}</button>
            </div>
          </>
        ) : setup ? (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              <Smartphone size={13} style={{ verticalAlign: -2 }} /> {tt('Scanne den QR-Code mit deiner Authenticator-App (Google Authenticator, Aegis, 1Password …) – oder gib den geheimen Schlüssel manuell ein.')}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
              <QrCode value={setup.otpauth} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <label className="form-label">{tt('Geheimer Schlüssel')}</label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <code style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 13, background: 'var(--color-surface-sunken)', padding: '8px 10px', borderRadius: 6, letterSpacing: '0.08em', wordBreak: 'break-all' }}>{setup.secret}</code>
                <button className="btn btn--outline btn--icon btn--sm" title={tt('Kopieren')} onClick={() => navigator.clipboard?.writeText(setup.secret)}><Copy size={13} /></button>
              </div>
            </div>
            <label className="form-label">{tt('Code aus der App zum Bestätigen')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input input--rect" inputMode="numeric" placeholder="000000" value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                style={{ flex: 1, letterSpacing: '0.3em', textAlign: 'center', fontFamily: 'var(--font-mono)' }}
              />
              <button className="btn btn--primary btn--sm" onClick={activate} disabled={busy || code.length !== 6}>{tt('Aktivieren')}</button>
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
              {tt('Schütze deine Anmeldung mit einem zusätzlichen Einmalcode aus einer Authenticator-App.')}
            </div>
            <button className="btn btn--primary btn--sm" onClick={begin} disabled={busy}>
              {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} {tt('2FA einrichten')}
            </button>
          </>
        )}
      </div>
    </Panel>
  );
}

/** ── Darstellung ─────────────────────────────────────────────────────────── */
const THEME_CHOICES: { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: 'light', label: 'Hell', icon: Sun },
  { mode: 'dark', label: 'Dunkel', icon: Moon },
  { mode: 'system', label: 'System', icon: MonitorSmartphone },
];

function AppearancePanel() {
  const { mode, theme, setMode } = useTheme();
  const { lang, setLang } = useI18n();
  const { setPref } = usePrefs();

  // Sprache gehört zum Konto: lokal sofort umschalten und serverseitig merken.
  const chooseLang = (code: LangCode) => { setLang(code); setPref(LANG_PREF, code); };

  return (
    <Panel title={tt('Darstellung & Sprache')} icon={<Palette size={15} />} storageKey="acc-theme">
      <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
          {tt('Farbschema der Oberfläche. „System" folgt der Einstellung deines Geräts.')}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {THEME_CHOICES.map(({ mode: m, label, icon: Icon }) => {
            const active = mode === m;
            return (
              <button
                key={m}
                className={`btn btn--sm ${active ? 'btn--primary' : 'btn--outline'}`}
                onClick={() => setMode(m)}
                aria-pressed={active}
              >
                <Icon size={13} /> {tt(label)}
              </button>
            );
          })}
        </div>
        {mode === 'system' && (
          <div className="form-hint" style={{ marginTop: 10 }}>
            {tt('Aktuell aktiv:')} {theme === 'dark' ? tt('Dunkel') : tt('Hell')}
          </div>
        )}

        <div className="form-group" style={{ marginTop: 18, maxWidth: 260 }}>
          <label className="form-label"><Languages size={13} style={{ verticalAlign: -2 }} /> {tt('Sprache')}</label>
          <select className="input input--rect" value={lang} onChange={(e) => chooseLang(e.target.value as LangCode)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.flag} {l.label}</option>
            ))}
          </select>
          <div className="form-hint">{tt('Wird am Benutzerkonto gespeichert und gilt auf allen Geräten.')}</div>
        </div>
      </div>
    </Panel>
  );
}

/** ── Sitzung: automatische Abmeldung ─────────────────────────────────────── */
function SessionPanel() {
  const { prefs, setPref } = usePrefs();
  const minutes = idleMinutes(prefs);

  const label = (m: number) => {
    if (m === 0) return tt('Nie automatisch abmelden');
    if (m < 60) return `${m} ${tt('Minuten')}`;
    const h = m / 60;
    return `${h} ${h === 1 ? tt('Stunde') : tt('Stunden')}`;
  };

  return (
    <Panel title={tt('Abmeldezeit')} icon={<Clock size={15} />} storageKey="acc-session">
      <div style={{ marginTop: 8, maxWidth: 460 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>
          {tt('Nach dieser Zeit ohne Maus- oder Tastatureingabe wirst du automatisch abgemeldet.')}
        </div>
        <div className="form-group" style={{ maxWidth: 260 }}>
          <label className="form-label">{tt('Abmelden nach')}</label>
          <select
            className="input input--rect"
            value={minutes}
            onChange={(e) => setPref(IDLE_PREF, Number(e.target.value))}
          >
            {IDLE_CHOICES.map((m) => <option key={m} value={m}>{label(m)}</option>)}
          </select>
        </div>
        {minutes === 0 && (
          <div className="form-hint" style={{ color: 'var(--color-warning)' }}>
            {tt('Ohne automatische Abmeldung bleibt eine offene Sitzung bis zum Ablauf des Zugangs (24 Stunden) gültig.')}
          </div>
        )}
      </div>
    </Panel>
  );
}

export function Account() {
  const { user } = useAuth();
  return (
    <>
      <Topbar title={tt('Mein Konto')} subtitle={user?.displayName || user?.username} />
      <main className="page">
        <div style={{ display: 'grid', gap: 14 }}>
          <ProfilePanel />
          <PasswordPanel />
          <TwoFactorPanel />
          <AppearancePanel />
          <SessionPanel />
        </div>
      </main>
    </>
  );
}
