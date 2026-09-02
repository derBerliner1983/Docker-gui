import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, Download, CheckCircle2, AlertTriangle, Package } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { UpdateSourcePanel, VersionPanel } from '../components/settings/UpdatePanels';
import { api } from '../lib/api';
import type { PackageUpdate } from '../lib/types';

export function Updates() {
  const t = useT();
  const [updates, setUpdates] = useState<PackageUpdate[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [reboot, setReboot] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [output, setOutput] = useState('');
  const [outputOpen, setOutputOpen] = useState(false);
  const [done, setDone] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.system.updates();
      setUpdates(res.updates);
      setManager(res.manager);
      setAvailable(res.available);
      setMessage(res.message ?? '');
      setReboot(res.rebootRequired);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Log mitlaufen lassen, damit die neueste Zeile sichtbar bleibt.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [output]);

  const check = async () => {
    setChecking(true);
    try { await api.system.checkUpdates(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setChecking(false); }
  };

  // Installation als Live-Stream: ein Systemupgrade mit über hundert Paketen
  // dauert Minuten. Als einzelner Request brach das mit „Failed to fetch" ab,
  // weil Browser bzw. Reverse-Proxy die Verbindung kappen. Jetzt läuft es über
  // EventSource und die Ausgabe ist während des Laufs zu sehen.
  const apply = (packages?: string[]) => {
    const label = packages ? `${packages.length} Paket(e)` : `ALLE Updates (${updates.length})`;
    if (!confirm(tt('{label} jetzt installieren?', { label }))) return;
    setApplying(true);
    setDone(false);
    setOutput(`▶ ${tt('Installation gestartet…')}`);
    setOutputOpen(true);

    const q = packages?.length ? `?packages=${encodeURIComponent(packages.join(','))}` : '';
    const es = new EventSource(`/api/system/updates/apply/stream${q}`);
    let finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      es.close();
      setApplying(false);
      setDone(true);
      if (ok) {
        // Erledigte Pakete sofort ausblenden, danach den echten Stand nachladen.
        if (packages) setUpdates((prev) => prev.filter((u) => !packages.includes(u.name)));
        else setUpdates([]);
        setTimeout(() => { void load(); }, 2000);
      }
    };
    es.onmessage = (evt) => {
      try {
        const d = JSON.parse(evt.data) as { line: string };
        setOutput((o) => `${o}\n${d.line}`);
      } catch { /* */ }
    };
    es.addEventListener('done', (evt) => {
      let ok = true;
      try { ok = (JSON.parse((evt as MessageEvent).data) as { ok: boolean }).ok; } catch { /* */ }
      finish(ok);
    });
    es.onerror = () => finish(false);
  };

  return (
    <>
      {/* Die Paket-Knöpfe stehen bewusst NICHT hier oben, sondern am Panel
          „Verfügbare Updates" – also direkt bei der Liste, auf die sie sich
          beziehen. Oben in der Topbar wirkten sie so, als gehörten sie zum
          Core-Hub-Update darunter. */}
      <Topbar
        title={t('nav.updates')}
        subtitle={manager ? t('page.updates.subtitle', { manager }) : undefined}
        onRefresh={load}
        refreshing={loading}
      />
      <main className="page">
        {/* Core-Hub selbst aktualisieren: Update-Quelle (Git-Repository) und
            Versionsauswahl inkl. Rückrollen auf einen früheren Stand.
            Dieselben Panels stehen auch in den Einstellungen. */}
        <VersionPanel installCmd={'cd docker-gui\ngit pull\nsudo bash install.sh'} />
        <UpdateSourcePanel />

        <div className="section-heading" style={{ margin: '18px 0 10px' }}>{tt('System-Pakete')}</div>

        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Package size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">{tt('Kein Paketmanager erkannt')}</div>
            <div className="empty-state__desc">{message}</div>
          </div>
        ) : (
          <>
            {reboot && (
              <div className="card" style={{ marginBottom: 14, borderColor: 'var(--color-warning)' }}>
                <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--color-warning)' }}>
                  <AlertTriangle size={18} />
                  <span style={{ fontWeight: 600 }}>{tt('Neustart erforderlich')}</span>
                  <span className="text-muted">{tt('Ein Systemneustart ist nötig, um alle Updates zu aktivieren.')}</span>
                </div>
              </div>
            )}

            <Panel
              title={tt('Verfügbare Updates')}
              icon={<Package size={15} />}
              subtitle={`${updates.length} Paket(e)`}
              storageKey="updates"
              // Die Knöpfe stehen zusätzlich hier am Panel: bei vielen Paketen
              // ist die Topbar längst weggescrollt und "Alle installieren" wäre
              // sonst nicht mehr erreichbar.
              actions={
                <>
                  <button className="btn btn--outline btn--sm" onClick={check} disabled={checking || applying}>
                    {checking ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />}
                    {tt('Nach Updates suchen')}
                  </button>
                  {updates.length > 0 && (
                    <button className="btn btn--primary btn--sm" onClick={() => apply()} disabled={applying}>
                      {applying ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />}
                      {tt('Alle installieren')} ({updates.length})
                    </button>
                  )}
                </>
              }
            >
              {updates.length === 0 ? (
                <div className="empty-state" style={{ padding: '40px 20px' }}>
                  <div className="empty-state__icon"><CheckCircle2 size={40} strokeWidth={1.2} color="var(--color-success)" /></div>
                  <div className="empty-state__title">{tt('System ist aktuell')}</div>
                  <div className="empty-state__desc">{tt('Keine Updates verfügbar. Klicke „Nach Updates suchen", um den Index zu aktualisieren.')}</div>
                </div>
              ) : (
                <div className="table-scroll" style={{ marginTop: 6 }}>
                  <table className="dtable">
                    <thead>
                      <tr><th>{tt('Paket')}</th><th>{tt('Aktuell')}</th><th>{tt('Neu')}</th><th>{tt('Quelle')}</th><th style={{ width: 100 }}></th></tr>
                    </thead>
                    <tbody>
                      {updates.map((u) => (
                        <tr key={u.name}>
                          <td style={{ fontWeight: 600 }}>{u.name}</td>
                          <td className="dtable__mono text-muted">{u.currentVersion || '—'}</td>
                          <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{u.newVersion}</td>
                          <td className="text-muted">{u.repo}</td>
                          <td>
                            <button className="btn btn--outline btn--sm" disabled={applying} onClick={() => apply([u.name])}>
                              <Download size={11} /> Update
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </main>

      <Modal
        open={outputOpen}
        title={tt('Update-Ausgabe')}
        // Während der Installation nicht schließbar – sonst bricht der Stream ab.
        onClose={() => { if (!applying) setOutputOpen(false); }}
        width={760}
        footer={
          done ? (
            <button className="btn btn--primary btn--sm" onClick={() => setOutputOpen(false)}>
              {tt('Schließen')}
            </button>
          ) : undefined
        }
      >
        <div ref={logRef} className="log-viewer" style={{ maxHeight: 460, whiteSpace: 'pre-wrap' }}>{output}</div>
        <div style={{ marginTop: 10, fontSize: 12, textAlign: 'right', color: applying ? 'var(--color-muted)' : 'var(--color-success)' }}>
          {applying
            ? tt('Läuft… das Fenster bitte offen lassen.')
            : done ? tt('✓ Fertig.') : ''}
        </div>
      </Modal>
    </>
  );
}
