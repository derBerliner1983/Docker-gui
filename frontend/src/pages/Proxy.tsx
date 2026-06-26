import { useState, useEffect, useCallback } from 'react';
import { Lock, Unlock, ShieldCheck, Plus, Trash2, ExternalLink, Download, RefreshCw, Globe } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import type { ProxyHost, ProxyCandidate } from '../lib/types';

function AddHostModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [candidates, setCandidates] = useState<ProxyCandidate[]>([]);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [hostname, setHostname] = useState('');
  const [port, setPort] = useState('');
  const [https, setHttps] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    api.proxy.candidates().then((r) => setCandidates(r.candidates.filter((c) => !c.alreadyProxied))).catch(() => {});
  }, [open]);

  const pickContainer = (id: string) => {
    setSelected(id);
    const c = candidates.find((x) => x.id === id);
    if (c) {
      setName(c.name);
      setHostname(`${c.name}.lan`);
      setPort(String(c.port));
    }
  };

  const save = async () => {
    if (!hostname || !port) { setError('Hostname und Port erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.proxy.create({
        containerId: selected || undefined,
        name: name || hostname,
        hostname,
        targetPort: parseInt(port),
        https,
      });
      setSelected(''); setName(''); setHostname(''); setPort(''); setHttps(true);
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
      title={tt('Neuer Proxy-Host')}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
          <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
            {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Hinzufügen
          </button>
        </>
      }
    >
      {error && <div className="login-error">{error}</div>}
      {candidates.length > 0 && (
        <div className="form-group">
          <label className="form-label">Container auswählen (optional)</label>
          <select className="input input--rect" value={selected} onChange={(e) => pickContainer(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="">— manuell eingeben —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} (Port {c.port})</option>)}
          </select>
        </div>
      )}
      <div className="form-group">
        <label className="form-label">{tt('Hostname')}</label>
        <input className="input input--rect" placeholder={tt('nextcloud.lan')} value={hostname} onChange={(e) => setHostname(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">{tt('Trage diesen Namen in deinem Router/DNS oder der hosts-Datei auf die Server-IP ein.')}</div>
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Ziel-Port')}</label>
          <input className="input input--rect" placeholder="8080" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Anzeigename')}</label>
          <input className="input input--rect" placeholder={tt('Nextcloud')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
      </div>
      <label className="legend__item" style={{ cursor: 'pointer', marginTop: 4 }}>
        <Switch checked={https} onChange={setHttps} />
        <span><b>HTTPS aktivieren</b> — <span className="text-muted">automatisches Zertifikat (interne CA)</span></span>
      </label>
    </Modal>
  );
}

export function Proxy() {
  const t = useT();
  const [hosts, setHosts] = useState<ProxyHost[]>([]);
  const [available, setAvailable] = useState(true);
  const [running, setRunning] = useState(false);
  const [caReady, setCaReady] = useState(false);
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await api.proxy.list();
      setHosts(res.hosts);
      setAvailable(res.available);
      setRunning(res.running);
      setCaReady(res.caReady);
      setMessage(res.message ?? '');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const toggleHttps = async (h: ProxyHost) => {
    setBusy((b) => ({ ...b, [h.id]: true }));
    try { await api.proxy.setHttps(h.id, !h.https); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[h.id]; return n; }); }
  };

  const bulkHttps = async (https: boolean) => {
    if (!confirm(`HTTPS für ALLE ${hosts.length} Hosts ${https ? 'aktivieren' : 'deaktivieren'}?`)) return;
    setBulkBusy(true);
    try { await api.proxy.setHttpsAll(https); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBulkBusy(false); }
  };

  const remove = async (h: ProxyHost) => {
    if (!confirm(`Proxy-Host "${h.hostname}" entfernen?`)) return;
    setBusy((b) => ({ ...b, [h.id]: true }));
    try { await api.proxy.remove(h.id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[h.id]; return n; }); }
  };

  const httpsCount = hosts.filter((h) => h.https).length;

  return (
    <>
      <Topbar
        title={t('page.proxy.title')}
        subtitle={available ? t('page.proxy.subtitle', { state: running ? t('page.proxy.running') : t('page.proxy.stopped'), https: httpsCount, total: hosts.length }) : undefined}
        onRefresh={load}
        refreshing={refreshing}
        actions={available && (
          <>
            {caReady && (
              <a className="btn btn--outline btn--sm" href={api.proxy.caUrl()} download title={tt('Root-CA für deine Geräte')}>
                <Download size={13} /> Root-CA
              </a>
            )}
            <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}><Plus size={13} /> {tt('Host')}</button>
          </>
        )}
      />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><ShieldCheck size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Caddy nicht installiert')}</div>
            <div className="empty-state__desc">
              {message}<br /><br />
              Caddy ist der Reverse-Proxy, der automatisch HTTPS-Zertifikate erzeugt:<br /><br />
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>sudo apt install caddy</code>
            </div>
          </div>
        ) : (
          <>
            {/* Info-Card zur internen CA */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-body" style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <ShieldCheck size={20} color="var(--color-accent)" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>
                  <b style={{ color: 'var(--color-fg)' }}>So funktioniert automatisches HTTPS:</b> Caddy erstellt eine eigene Zertifizierungsstelle (CA)
                  und stellt für jeden Host automatisch ein Zertifikat aus. Lade einmalig das <b>{tt('Root-CA-Zertifikat')}</b> herunter
                  und installiere es auf deinen Geräten – danach sind alle Dienste vertrauenswürdig (grünes Schloss).
                  {!caReady && <span style={{ color: 'var(--color-warning)' }}> {tt('Die CA wird beim ersten HTTPS-Host automatisch erzeugt.')}</span>}
                </div>
              </div>
            </div>

            <Panel
              title={tt('Proxy-Hosts')}
              icon={<Globe size={15} />}
              subtitle={`${httpsCount}/${hosts.length} mit HTTPS`}
              storageKey="proxy"
              actions={hosts.length > 0 && (
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn--outline btn--sm" disabled={bulkBusy} onClick={() => bulkHttps(true)}>
                    {bulkBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Lock size={12} />} Alle HTTPS
                  </button>
                  <button className="btn btn--ghost btn--sm" disabled={bulkBusy} onClick={() => bulkHttps(false)}>
                    <Unlock size={12} /> Alle HTTP
                  </button>
                </div>
              )}
            >
              {hosts.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state__desc">{tt('Noch keine Hosts. Füge einen Container/Dienst mit „Host" hinzu.')}</div>
                </div>
              ) : (
                <div style={{ margin: '4px -16px 0' }}>
                  {hosts.map((h) => (
                    <div className="proxy-card" key={h.id}>
                      <div className={`proxy-card__lock proxy-card__lock--${h.https ? 'on' : 'off'}`}>
                        {h.https ? <Lock size={16} /> : <Unlock size={16} />}
                      </div>
                      <div className="proxy-card__info">
                        <div className="proxy-card__host">{h.name}</div>
                        <div className="proxy-card__target">{h.url} → {h.targetHost}:{h.targetPort}</div>
                      </div>
                      <a className="btn btn--ghost btn--icon btn--sm" href={h.url} target="_blank" rel="noreferrer" title={tt('Öffnen')}>
                        <ExternalLink size={13} />
                      </a>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }} title={tt('HTTPS umschalten')}>
                        <span style={{ fontSize: 11, color: 'var(--color-faint)', fontWeight: 600 }}>HTTPS</span>
                        <Switch checked={h.https} disabled={busy[h.id]} onChange={() => toggleHttps(h)} />
                      </div>
                      <button className="btn btn--danger btn--icon btn--sm" title={tt('Entfernen')} disabled={busy[h.id]} onClick={() => remove(h)}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn btn--ghost btn--sm" onClick={() => api.proxy.apply().then(() => alert(tt('Caddy neu geladen.'))).catch((e) => alert(e.message))}>
                <RefreshCw size={13} /> Konfiguration neu laden
              </button>
            </div>
          </>
        )}
      </main>

      <AddHostModal open={modalOpen} onClose={() => setModalOpen(false)} onDone={load} />
    </>
  );
}
