import { useState, useEffect, useCallback } from 'react';
import { Download, CheckCircle2, Package } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import type { AppTemplate } from '../lib/types';

function InstallModal({ tpl, onClose, onDone }: { tpl: AppTemplate | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [env, setEnv] = useState<Record<string, string>>({});
  const [ports, setPorts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!tpl) return;
    setName(tpl.id);
    const e: Record<string, string> = {};
    for (const v of tpl.env ?? []) e[v.key] = v.default ?? '';
    setEnv(e);
    const p: Record<string, number> = {};
    for (const port of tpl.ports) p[`${port.container}/${port.proto ?? 'tcp'}`] = port.host;
    setPorts(p);
    setError(''); setDone('');
  }, [tpl]);

  if (!tpl) return null;

  const install = async () => {
    setLoading(true); setError('');
    try {
      const res = await api.appTemplates.install(tpl.id, { name, env, ports });
      setDone(`„${res.name}" wurde installiert und gestartet.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation fehlgeschlagen');
    } finally { setLoading(false); }
  };

  return (
    <Modal open={!!tpl} title={`${tpl.icon} ${tpl.name} installieren`} onClose={onClose}
      footer={done ? (
        <button className="btn btn--primary btn--sm" onClick={onClose}>Schließen</button>
      ) : (
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={install} disabled={loading}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} Installieren
          </button>
        </>
      )}
    >
      {done ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '20px 0' }}>
          <CheckCircle2 size={40} style={{ color: 'var(--color-success)' }} />
          <div style={{ fontWeight: 600 }}>{done}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-muted)', textAlign: 'center' }}>Du findest den Container unter „Container".</div>
        </div>
      ) : (
        <>
          {error && <div className="login-error">{error}</div>}
          <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 12 }}>{tpl.description}</div>

          <div className="form-group">
            <label className="form-label">Container-Name</label>
            <input className="input input--rect" value={name} onChange={(e) => setName(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          </div>

          {tpl.ports.length > 0 && (
            <div className="form-group">
              <label className="form-label">Ports (Host)</label>
              {tpl.ports.map((p) => {
                const key = `${p.container}/${p.proto ?? 'tcp'}`;
                return (
                  <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <input className="input input--rect" type="number" value={ports[key] ?? p.host}
                      onChange={(e) => setPorts((prev) => ({ ...prev, [key]: parseInt(e.target.value) || p.host }))}
                      style={{ maxWidth: 120 }} />
                    <span className="text-muted" style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)' }}>→ {p.container}/{p.proto ?? 'tcp'} (Container)</span>
                  </div>
                );
              })}
            </div>
          )}

          {(tpl.env ?? []).map((v) => (
            <div className="form-group" key={v.key}>
              <label className="form-label">{v.label}{v.required && <span style={{ color: 'var(--color-error)' }}> *</span>}</label>
              <input className="input input--rect" type={v.secret ? 'password' : 'text'} value={env[v.key] ?? ''}
                onChange={(e) => setEnv((prev) => ({ ...prev, [v.key]: e.target.value }))}
                placeholder={v.default} />
            </div>
          ))}

          {tpl.note && <div style={{ fontSize: 12, color: 'var(--color-warning)', marginTop: 6 }}>ℹ {tpl.note}</div>}
          {tpl.volumes && tpl.volumes.length > 0 && (
            <div style={{ fontSize: 11.5, color: 'var(--color-faint)', marginTop: 8 }}>
              Persistente Volumes: {tpl.volumes.map((vv) => `${tpl.id}_${vv.name}`).join(', ')}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export function AppTemplates() {
  const [templates, setTemplates] = useState<AppTemplate[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<AppTemplate | null>(null);
  const [filter, setFilter] = useState('Alle');

  const load = useCallback(async () => {
    setRefreshing(true);
    try { setTemplates((await api.appTemplates.list()).templates); } catch { /* */ }
    finally { setRefreshing(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const categories = ['Alle', ...Array.from(new Set(templates.map((t) => t.category)))];
  const shown = filter === 'Alle' ? templates : templates.filter((t) => t.category === filter);

  return (
    <>
      <Topbar title="App-Vorlagen" subtitle={`${templates.length} Dienste · 1-Klick-Installation`} onRefresh={load} refreshing={refreshing} />
      <main className="page">
        <div className="filter-tabs" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
          {categories.map((c) => (
            <button key={c} className={`filter-tab${filter === c ? ' filter-tab--active' : ''}`} onClick={() => setFilter(c)}>{c}</button>
          ))}
        </div>

        {templates.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Package size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">Keine Vorlagen verfügbar</div>
            <div className="empty-state__desc">Docker wird für die Installation von Apps benötigt.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
            {shown.map((t) => (
              <div key={t.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="card-body" style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 28, lineHeight: 1 }}>{t.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{t.name}</div>
                      <span className="badge badge--paused" style={{ height: 20, padding: '0 8px', fontSize: 11 }}>{t.category}</span>
                    </div>
                    {t.installed && (
                      <span className="badge badge--running" style={{ height: 22, padding: '0 8px' }} title="Bereits installiert">
                        <CheckCircle2 size={11} /> installiert
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)', minHeight: 34 }}>{t.description}</div>
                  <div className="dtable__mono text-faint" style={{ fontSize: 11, marginTop: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.image}</div>
                </div>
                <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
                  <button className="btn btn--primary btn--sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => setSelected(t)}>
                    <Download size={13} /> {t.installed ? 'Erneut installieren' : 'Installieren'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <InstallModal tpl={selected} onClose={() => setSelected(null)} onDone={load} />
    </>
  );
}
