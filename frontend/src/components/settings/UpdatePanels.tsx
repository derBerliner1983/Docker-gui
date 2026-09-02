import { useState, useEffect, useCallback, useRef } from 'react';
import {
  RefreshCw, ArrowUpCircle, CheckCircle2, RotateCw, ShieldCheck, Trash2,
  GitBranch, Globe, Lock, Link2, History,
} from 'lucide-react';
import { Panel } from '../ui/Panel';
import { api } from '../../lib/api';
import { timeAgo } from '../../lib/utils';
import { tt } from '../../lib/i18n';
import type { VersionInfo, UpdateSource, UpdateVersion } from '../../lib/types';

// Core-Hub-Update: Quelle (Git-Repository) und Versionsauswahl.
// Ausgelagert, damit die Panels sowohl in den Einstellungen als auch auf der
// Update-Seite („System-Updates") verwendet werden können.

/**
 * Update-Quelle: welches Git-Repository für Updates verwendet wird.
 * Änderbar (z. B. nach einem Repository-Umzug) und für private Repositories
 * mit Benutzername + Token/Passwort. Die Zugangsdaten werden serverseitig
 * verschlüsselt gespeichert und nie wieder ausgeliefert.
 */
export function UpdateSourcePanel({ onChanged }: { onChanged?: () => void }) {
  const [src, setSrc] = useState<UpdateSource | null>(null);
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [authType, setAuthType] = useState<'token' | 'password'>('token');
  const [username, setUsername] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.settings.updateSource();
      setSrc(s);
      setUrl(s.url || s.detectedUrl || '');
      setBranch(s.branch || '');
      setVisibility(s.visibility);
      setAuthType(s.authType);
      setUsername(s.username);
      setSecret('');
    } catch { /* nicht angemeldet o. ä. */ }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async (opts: { clearSecret?: boolean } = {}) => {
    setSaving(true); setMsg(null);
    try {
      const res = await api.settings.saveUpdateSource({
        url: url.trim(),
        branch: branch.trim(),
        visibility,
        authType,
        username: username.trim(),
        // Leeres Feld = Geheimnis unverändert lassen; „entfernen" schickt bewusst ''
        ...(opts.clearSecret ? { secret: '' } : (secret ? { secret } : {})),
      });
      setSrc(res.source);
      setSecret('');
      setMsg({ kind: 'ok', text: tt('Update-Quelle gespeichert.') });
      onChanged?.();
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : tt('Speichern fehlgeschlagen') });
    } finally { setSaving(false); }
  };

  const test = async () => {
    setTesting(true); setMsg(null);
    try {
      const res = await api.settings.testUpdateSource();
      setMsg({ kind: 'ok', text: tt('Verbindung erfolgreich – {n} Branch(es) gefunden: {list}', { n: res.count, list: res.branches.slice(0, 6).join(', ') }) });
    } catch (err) {
      setMsg({ kind: 'err', text: err instanceof Error ? err.message : tt('Verbindung fehlgeschlagen') });
    } finally { setTesting(false); }
  };

  const inputStyle: React.CSSProperties = { width: '100%' };

  return (
    <Panel
      title={tt('Update-Quelle (Git-Repository)')}
      icon={<GitBranch size={15} />}
      subtitle={src?.configured ? src.url : tt('Standard: Repository des Checkouts')}
      storageKey="set-update-source"
      defaultCollapsed
    >
      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 640 }}>
        <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
          {tt('Legt fest, aus welchem Git-Repository Core-Hub seine Updates holt. Kann jederzeit geändert werden – z. B. wenn das Repository umgezogen ist oder ein eigener Fork verwendet werden soll.')}
        </div>

        <div>
          <label className="form-label">{tt('Repository-URL')}</label>
          <input
            className="input" style={inputStyle} value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder={src?.detectedUrl || 'https://github.com/benutzer/repo.git'} spellCheck={false} autoComplete="off"
          />
          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 4 }}>
            {tt('Nur https-URLs. Leer lassen = das Repository verwenden, aus dem installiert wurde.')}
          </div>
        </div>

        <div>
          <label className="form-label">{tt('Branch')}</label>
          <input
            className="input" style={inputStyle} value={branch} onChange={(e) => setBranch(e.target.value)}
            placeholder={src?.detectedBranch || 'main'} spellCheck={false} autoComplete="off"
          />
        </div>

        <div>
          <div className="form-label">{tt('Sichtbarkeit')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className={`btn btn--sm ${visibility === 'public' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setVisibility('public')}
            >
              <Globe size={13} /> {tt('Öffentlich')}
            </button>
            <button
              className={`btn btn--sm ${visibility === 'private' ? 'btn--primary' : 'btn--outline'}`}
              onClick={() => setVisibility('private')}
            >
              <Lock size={13} /> {tt('Privat (Zugangsdaten nötig)')}
            </button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 6 }}>
            {visibility === 'public'
              ? tt('Öffentliches Repository – es sind keine Zugangsdaten nötig.')
              : tt('Privates Repository – Benutzername und Token (empfohlen) oder Passwort werden verschlüsselt auf dem Server gespeichert.')}
          </div>
        </div>

        {visibility === 'private' && (
          <>
            <div>
              <div className="form-label">{tt('Anmeldeart')}</div>
              <select className="input" style={inputStyle} value={authType} onChange={(e) => setAuthType(e.target.value as 'token' | 'password')}>
                <option value="token">{tt('Zugriffstoken (empfohlen)')}</option>
                <option value="password">{tt('Passwort')}</option>
              </select>
              <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 4 }}>
                {tt('Ein Token ist sicherer: es lässt sich einzeln widerrufen und nur auf ein Repository beschränken.')}
              </div>
            </div>

            <div>
              <label className="form-label">{tt('Benutzername')}</label>
              <input className="input" style={inputStyle} value={username} onChange={(e) => setUsername(e.target.value)} spellCheck={false} autoComplete="off" />
            </div>

            <div>
              <label className="form-label">{authType === 'token' ? tt('Zugriffstoken') : tt('Passwort')}</label>
              <input
                className="input" style={inputStyle} type="password" value={secret}
                onChange={(e) => setSecret(e.target.value)} autoComplete="new-password"
                placeholder={src?.hasSecret ? tt('gespeichert – leer lassen, um es beizubehalten') : ''}
              />
              {src?.hasSecret && (
                <div style={{ fontSize: 11.5, color: 'var(--color-success)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={12} /> {tt('Verschlüsselt gespeichert (wird nie angezeigt).')}
                </div>
              )}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn--primary btn--sm" disabled={saving} onClick={() => void save()}>
            {saving ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} {tt('Speichern')}
          </button>
          <button className="btn btn--outline btn--sm" disabled={testing} onClick={() => void test()}>
            {testing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Link2 size={13} />} {tt('Verbindung testen')}
          </button>
          {src?.hasSecret && (
            <button className="btn btn--outline btn--sm" disabled={saving} onClick={() => { if (confirm(tt('Gespeicherte Zugangsdaten entfernen?'))) void save({ clearSecret: true }); }}>
              <Trash2 size={13} /> {tt('Zugangsdaten entfernen')}
            </button>
          )}
        </div>

        {msg && (
          <div style={{ fontSize: 12.5, color: msg.kind === 'ok' ? 'var(--color-success)' : 'var(--color-warning)' }}>
            {msg.text}
          </div>
        )}
      </div>
    </Panel>
  );
}
export function VersionPanel({ installCmd }: { installCmd: string }) {
  const [ver, setVer] = useState<VersionInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateLog, setUpdateLog] = useState<string[]>([]);
  const [updateDone, setUpdateDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  // Auswählbare Stände: Standard ist die neueste Version, per Dropdown lässt sich
  // aber auch gezielt auf einen älteren Stand zurückgerollt werden.
  const [versions, setVersions] = useState<UpdateVersion[]>([]);
  const [targetRef, setTargetRef] = useState('');
  const [versionsErr, setVersionsErr] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);

  const check = useCallback(async (refresh = false) => {
    setChecking(true);
    try { setVer(await api.settings.version(refresh)); } catch { /* */ }
    finally { setChecking(false); }
  }, []);

  const loadVersions = useCallback(async (refresh = false) => {
    setLoadingVersions(true);
    try {
      const res = await api.settings.updateVersions(refresh);
      setVersions(res.versions ?? []);
      setVersionsErr(res.error ?? '');
    } catch (err) {
      setVersions([]);
      setVersionsErr(err instanceof Error ? err.message : tt('Versionsliste konnte nicht geladen werden'));
    } finally { setLoadingVersions(false); }
  }, []);

  // Beim Laden schnell (ohne git fetch), Button „Prüfen" holt den Remote-Stand frisch
  useEffect(() => { void check(false); void loadVersions(false); }, [check, loadVersions]);

  const selected = versions.find((v) => v.ref === targetRef);
  const latestEntry = versions.find((v) => v.latest);
  /** Label für einen Eintrag im Dropdown. */
  const versionLabel = (v: UpdateVersion) => {
    const date = v.date ? new Date(v.date).toLocaleDateString() : '';
    const parts = [
      v.latest ? tt('Neueste Version') : v.type === 'tag' ? `Tag ${v.ref}` : v.shortSha,
      v.version ? `v${v.version}` : '',
      date,
      v.current ? tt('(installiert)') : '',
    ].filter(Boolean);
    return `${parts.join(' · ')}${v.subject ? ` – ${v.subject.slice(0, 60)}` : ''}`;
  };
  const isRollback = !!selected && !selected.latest;

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

  const startUpdate = (ref = '') => {
    const question = ref && !versions.find((v) => v.ref === ref)?.latest
      ? tt('Wirklich auf den gewählten Stand wechseln? Der Dienst wird kurz neu gestartet.')
      : tt('Core-Hub jetzt aktualisieren? Der Dienst wird kurz neu gestartet.');
    if (!confirm(question)) return;
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
      void loadVersions(false);
      void pollForNewVersion(priorBuild);
    };

    const es = new EventSource(`/api/settings/update/stream${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
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
                <button className="btn btn--primary btn--sm" onClick={() => startUpdate()}>
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

        {/* Versionsauswahl: standardmäßig die neueste Version, per Dropdown auch
            ein älterer Stand (Rollback auf ein vorheriges Update). */}
        {!updating && !updateDone && (
          <div className="card" style={{ marginTop: 14 }}>
            <div className="card-body">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <History size={14} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{tt('Version auswählen')}</span>
                <button
                  className="btn btn--outline btn--sm" style={{ marginLeft: 'auto' }}
                  disabled={loadingVersions} onClick={() => void loadVersions(true)}
                  title={tt('Stände frisch vom Repository holen')}
                >
                  {loadingVersions ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />} {tt('Neu laden')}
                </button>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                {tt('Vorgeschlagen wird immer die neueste Version. Über die Liste lässt sich auch ein früherer Stand einspielen – etwa um ein Update zurückzurollen.')}
              </div>

              {versionsErr && (
                <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginBottom: 10 }}>{versionsErr}</div>
              )}

              {versions.length > 0 ? (
                <>
                  <select
                    className="input" style={{ width: '100%' }}
                    value={targetRef} onChange={(e) => setTargetRef(e.target.value)}
                  >
                    <option value="">
                      {latestEntry ? `${tt('Neueste Version')}${latestEntry.version ? ` (v${latestEntry.version})` : ''}` : tt('Neueste Version')}
                    </option>
                    {versions.filter((v) => !v.latest).map((v) => (
                      <option key={v.ref} value={v.ref}>{versionLabel(v)}</option>
                    ))}
                  </select>
                  {isRollback && (
                    <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 8 }}>
                      {tt('Achtung: Ein älterer Stand kann Funktionen entfernen. Deine Daten bleiben erhalten, die Datenbank wird aber nicht zurückgesetzt.')}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                    <button
                      className={`btn btn--sm ${isRollback ? 'btn--outline' : 'btn--primary'}`}
                      disabled={!!selected?.current}
                      onClick={() => startUpdate(targetRef)}
                    >
                      {isRollback ? <History size={13} /> : <ArrowUpCircle size={13} />}
                      {isRollback ? tt('Auf diesen Stand wechseln') : tt('Auf neueste Version aktualisieren')}
                    </button>
                    {selected?.current && (
                      <span style={{ fontSize: 12, color: 'var(--color-muted)', alignSelf: 'center' }}>
                        {tt('Dieser Stand ist bereits installiert.')}
                      </span>
                    )}
                  </div>
                </>
              ) : !loadingVersions && !versionsErr ? (
                <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>{tt('Keine Stände gefunden – „Neu laden" holt sie vom Repository.')}</div>
              ) : null}
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
