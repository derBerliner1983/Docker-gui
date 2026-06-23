import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Search, Download, CheckCircle2, Star, ChevronLeft, ChevronRight, Plus, Trash2, Eye, EyeOff, RefreshCw, Loader } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import type { StoreItem, StoreSearchResult } from '../lib/types';

// ── App icon with graceful fallback ─────────────────────────────────────────

function AppIcon({ src, name, size = 48 }: { src: string; name: string; size?: number }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 10, flexShrink: 0,
        background: 'var(--color-accent-soft)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: size * 0.4, color: 'var(--color-accent)',
      }}>
        {name.charAt(0).toUpperCase()}
      </div>
    );
  }
  return (
    <img
      src={src} alt={name} onError={() => setErr(true)}
      style={{ width: size, height: size, borderRadius: 10, objectFit: 'contain', background: '#fff', padding: 4, flexShrink: 0 }}
    />
  );
}

// ── Row-editors used inside the install modal ────────────────────────────────

interface PortRow { id: number; container: number; host: number; proto: 'tcp' | 'udp' }
interface VolRow  { id: number; name: string; path: string }
interface EnvRow  { id: number; key: string; label: string; value: string; secret: boolean; required: boolean }

let _uid = 1;
const uid = () => _uid++;

function PortsEditor({ rows, onChange }: { rows: PortRow[]; onChange: (r: PortRow[]) => void }) {
  const add = () => onChange([...rows, { id: uid(), container: 80, host: 8080, proto: 'tcp' }]);
  const upd = (id: number, patch: Partial<PortRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>Ports</label>
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> Port</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>Keine Ports konfiguriert.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
          <input className="input input--rect" type="number" value={r.host} min={1} max={65535} style={{ width: 80 }}
            onChange={(e) => upd(r.id, { host: parseInt(e.target.value) || r.host })} title="Host-Port" />
          <span className="text-muted" style={{ fontSize: 12, flexShrink: 0 }}>→</span>
          <input className="input input--rect" type="number" value={r.container} min={1} max={65535} style={{ width: 80 }}
            onChange={(e) => upd(r.id, { container: parseInt(e.target.value) || r.container })} title="Container-Port" />
          <select className="input input--rect" value={r.proto} style={{ width: 70 }}
            onChange={(e) => upd(r.id, { proto: e.target.value as 'tcp' | 'udp' })}>
            <option value="tcp">TCP</option>
            <option value="udp">UDP</option>
          </select>
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function VolsEditor({ rows, onChange }: { rows: VolRow[]; onChange: (r: VolRow[]) => void }) {
  const add = () => onChange([...rows, { id: uid(), name: 'data', path: '/data' }]);
  const upd = (id: number, patch: Partial<VolRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>Volumes</label>
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> Volume</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>Keine Volumes konfiguriert.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
          <input className="input input--rect" value={r.name} placeholder="vol-name" style={{ flex: 1 }}
            onChange={(e) => upd(r.id, { name: e.target.value })} title="Volume-Name (wird als Container-Name_vol-name angelegt)" />
          <span className="text-muted" style={{ fontSize: 12, flexShrink: 0 }}>:</span>
          <input className="input input--rect" value={r.path} placeholder="/data" style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            onChange={(e) => upd(r.id, { path: e.target.value })} title="Pfad im Container" />
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
        </div>
      ))}
    </div>
  );
}

function EnvEditor({ rows, onChange }: { rows: EnvRow[]; onChange: (r: EnvRow[]) => void }) {
  const [showSecrets, setShowSecrets] = useState(false);
  const add = () => onChange([...rows, { id: uid(), key: '', label: '', value: '', secret: false, required: false }]);
  const upd = (id: number, patch: Partial<EnvRow>) => onChange(rows.map((r) => r.id === id ? { ...r, ...patch } : r));
  const del = (id: number) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6, gap: 8 }}>
        <label className="form-label" style={{ marginBottom: 0, flex: 1 }}>Umgebungsvariablen</label>
        {rows.some((r) => r.secret) && (
          <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => setShowSecrets(!showSecrets)} title={showSecrets ? 'Werte verbergen' : 'Werte anzeigen'}>
            {showSecrets ? <EyeOff size={11} /> : <Eye size={11} />}
          </button>
        )}
        <button type="button" className="btn btn--outline btn--sm" onClick={add} style={{ padding: '2px 8px' }}><Plus size={11} /> Variable</button>
      </div>
      {rows.length === 0 && <div style={{ fontSize: 12, color: 'var(--color-faint)' }}>Keine Variablen konfiguriert.</div>}
      {rows.map((r) => (
        <div key={r.id} style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input className="input input--rect" value={r.key} placeholder="VARIABLE_NAME"
              style={{ flex: 1, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              onChange={(e) => upd(r.id, { key: e.target.value.replace(/[^A-Z0-9_]/gi, '_').toUpperCase() })} />
            <input className="input input--rect" value={r.value} placeholder={r.label || 'Wert…'}
              type={r.secret && !showSecrets ? 'password' : 'text'} style={{ flex: 2 }}
              onChange={(e) => upd(r.id, { value: e.target.value })} />
            <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={() => del(r.id)}><Trash2 size={11} /></button>
          </div>
          {(r.label && r.label !== r.key) && (
            <div style={{ fontSize: 11, color: 'var(--color-faint)', marginLeft: 2, marginTop: 1 }}>
              {r.label}{r.required && <span style={{ color: 'var(--color-error)' }}> *</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Install Modal ─────────────────────────────────────────────────────────────

function InstallModal({ item, onClose, onDone }: { item: StoreItem | null; onClose: () => void; onDone: () => void }) {
  const [cname, setCname] = useState('');
  const [restart, setRestart] = useState('unless-stopped');
  const [ports, setPorts] = useState<PortRow[]>([]);
  const [vols, setVols] = useState<VolRow[]>([]);
  const [envs, setEnvs] = useState<EnvRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!item) return;
    setCname(item.id.slice(0, 40));
    setRestart(item.restart || 'unless-stopped');
    setPorts(item.ports.map((p) => ({ id: uid(), ...p })));
    setVols(item.volumes.map((v) => ({ id: uid(), ...v })));
    setEnvs(item.env.map((e) => ({ id: uid(), key: e.key, label: e.label, value: e.default, secret: e.secret, required: e.required })));
    setError(''); setDone('');
  }, [item]);

  if (!item) return null;

  const install = async () => {
    // Validate required env
    const missing = envs.filter((e) => e.required && !e.value.trim());
    if (missing.length) { setError(`Pflichtfeld fehlt: ${missing.map((e) => e.label || e.key).join(', ')}`); return; }
    setBusy(true); setError('');
    try {
      const envMap: Record<string, string> = {};
      for (const e of envs) if (e.key) envMap[e.key] = e.value;
      const res = await api.store.install({
        name: cname || item.id,
        image: item.image,
        ports: ports.map((p) => ({ container: p.container, host: p.host, proto: p.proto })),
        volumes: vols.map((v) => ({ name: v.name, path: v.path })),
        env: envMap,
        restart,
        templateId: item.source === 'unraid' ? item.id : undefined,
        category: item.category,
      });
      setDone(`„${res.name}" wurde installiert und gestartet.`);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation fehlgeschlagen');
    } finally { setBusy(false); }
  };

  return (
    <Modal
      open={!!item}
      title={`${item.name} installieren`}
      onClose={onClose}
      width={680}
      footer={done ? (
        <button className="btn btn--primary btn--sm" onClick={onClose}>Schließen</button>
      ) : (
        <>
          <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
          <button className="btn btn--primary btn--sm" onClick={install} disabled={busy}>
            {busy ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Download size={13} />} Installieren
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
        <div style={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 4 }}>
          {error && <div className="login-error" style={{ marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 14 }}>
            <AppIcon src={item.icon} name={item.name} size={44} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>{item.name}</div>
              <div className="dtable__mono text-muted" style={{ fontSize: 11 }}>{item.image}</div>
              {item.description && (
                <div className="text-muted" style={{ fontSize: 12, marginTop: 3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  {item.description}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 2 }}>
              <label className="form-label">Container-Name</label>
              <input className="input input--rect" value={cname} onChange={(e) => setCname(e.target.value.replace(/[^a-zA-Z0-9._-]/g, '_'))}
                style={{ fontFamily: 'var(--font-mono)', width: '100%' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="form-label">Restart-Policy</label>
              <select className="input input--rect" value={restart} onChange={(e) => setRestart(e.target.value)} style={{ width: '100%' }}>
                <option value="unless-stopped">unless-stopped</option>
                <option value="always">always</option>
                <option value="on-failure">on-failure</option>
                <option value="no">no</option>
              </select>
            </div>
          </div>

          <PortsEditor rows={ports} onChange={setPorts} />
          <VolsEditor rows={vols} onChange={setVols} />
          <EnvEditor rows={envs} onChange={setEnvs} />
        </div>
      )}
    </Modal>
  );
}

// ── App card ──────────────────────────────────────────────────────────────────

function AppCard({ item, onInstall }: { item: StoreItem; onInstall: (item: StoreItem) => void }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-body" style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
          <AppIcon src={item.icon} name={item.name} size={44} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 3 }}>
              <span className="badge badge--paused" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>{item.category}</span>
              {item.installed && (
                <span className="badge badge--running" style={{ height: 18, padding: '0 7px', fontSize: 10 }}>
                  <CheckCircle2 size={9} /> installiert
                </span>
              )}
              {item.stars != null && item.stars > 0 && (
                <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--color-muted)' }}>
                  <Star size={10} /> {item.stars.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-muted)', minHeight: 32, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
          {item.description || <span className="text-faint">Keine Beschreibung</span>}
        </div>
        <div className="dtable__mono text-faint" style={{ fontSize: 10.5, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.image}</div>
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--color-border)' }}>
        <button className="btn btn--primary btn--sm" style={{ width: '100%', justifyContent: 'center' }} onClick={() => onInstall(item)}>
          <Download size={13} /> {item.installed ? 'Erneut installieren' : 'Installieren'}
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AppTemplates() {
  const [source, setSource] = useState<'unraid' | 'dockerhub'>('unraid');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<StoreSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<StoreItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Debounce query input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { setDebouncedQuery(query); setPage(1); }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  const search = useCallback(async (q: string, src: 'unraid' | 'dockerhub', pg: number, cat: string) => {
    setLoading(true);
    try {
      const res = await api.store.search(q, src, pg, cat);
      setResult(res);
    } catch { /* keep last result */ }
    finally { setLoading(false); }
  }, []);

  // Run search whenever source/query/page/category changes
  useEffect(() => {
    void search(debouncedQuery, source, page, category);
  }, [search, debouncedQuery, source, page, category]);

  // Poll while Unraid feed is warming (result comes back with cached: false)
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (source === 'unraid' && result && !result.cached && result.warming !== false) {
      pollRef.current = setInterval(() => { void search(debouncedQuery, 'unraid', page, category); }, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [search, source, result, debouncedQuery, page, category]);

  // Reset page when source/category changes
  const switchSource = (s: 'unraid' | 'dockerhub') => { setSource(s); setPage(1); setCategory(''); };
  const switchCategory = (c: string) => { setCategory(c); setPage(1); };

  const total   = result?.total ?? 0;
  const limit   = result?.limit ?? 24;
  const pages   = Math.max(1, Math.ceil(total / limit));
  const warming = source === 'unraid' && result?.cached === false;

  const categories = useMemo(() => result?.categories ?? [], [result?.categories]);

  const subtitle = warming
    ? 'Unraid Store wird geladen…'
    : result
      ? `${total.toLocaleString()} Apps${source === 'unraid' ? ' · Unraid Community' : ' · Docker Hub'}`
      : undefined;

  return (
    <>
      <Topbar
        title="App-Vorlagen"
        subtitle={subtitle}
        onRefresh={() => { void search(debouncedQuery, source, page, category); }}
        refreshing={loading}
        actions={
          source === 'unraid' && (
            <button className="btn btn--outline btn--sm" onClick={async () => { await api.store.warm(); setTimeout(() => void search(debouncedQuery, 'unraid', page, category), 500); }} title="Feed neu laden">
              <RefreshCw size={13} /> Feed aktualisieren
            </button>
          )
        }
      />
      <main className="page">
        {/* Source toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          <div className="filter-tabs" style={{ margin: 0 }}>
            {(['unraid', 'dockerhub'] as const).map((s) => (
              <button key={s} className={`filter-tab${source === s ? ' filter-tab--active' : ''}`} onClick={() => switchSource(s)}>
                {s === 'unraid' ? 'Unraid Community Store' : 'Docker Hub'}
              </button>
            ))}
          </div>

          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220, maxWidth: 420 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
            <input
              className="input input--rect"
              placeholder={source === 'dockerhub' ? 'Image suchen (mind. 2 Zeichen)…' : 'App-Store durchsuchen…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ width: '100%', paddingLeft: 30 }}
            />
          </div>
        </div>

        {/* Category filter chips (Unraid only) */}
        {source === 'unraid' && categories.length > 0 && (
          <div className="filter-tabs" style={{ flexWrap: 'wrap', marginBottom: 14, gap: 4 }}>
            <button className={`filter-tab${!category ? ' filter-tab--active' : ''}`} onClick={() => switchCategory('')}>Alle</button>
            {categories.map((c) => (
              <button key={c} className={`filter-tab${category === c ? ' filter-tab--active' : ''}`} onClick={() => switchCategory(c)}>{c}</button>
            ))}
          </div>
        )}

        {/* Warming state */}
        {warming && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '60px 20px', color: 'var(--color-muted)' }}>
            <Loader size={36} style={{ animation: 'spin 1.2s linear infinite', color: 'var(--color-accent)' }} />
            <div style={{ fontSize: 14, fontWeight: 600 }}>Unraid Community Store wird geladen…</div>
            <div style={{ fontSize: 12.5 }}>Das dauert beim ersten Mal 10–30 Sekunden.</div>
          </div>
        )}

        {/* Docker Hub: prompt if query too short */}
        {!warming && source === 'dockerhub' && query.trim().length < 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '60px 20px', color: 'var(--color-muted)' }}>
            <Search size={40} strokeWidth={1} />
            <div style={{ fontSize: 13 }}>Suchbegriff eingeben, um Docker Hub zu durchsuchen.</div>
          </div>
        )}

        {/* Results grid */}
        {!warming && (source === 'dockerhub' ? query.trim().length >= 2 : true) && (
          <>
            {loading && !result?.results?.length ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
                <span className="spinner" style={{ width: 28, height: 28 }} />
              </div>
            ) : (result?.results?.length ?? 0) === 0 && !loading ? (
              <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--color-muted)' }}>
                {query ? `Keine Ergebnisse für „${query}".` : 'Keine Apps gefunden.'}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
                  {(result?.results ?? []).map((item) => (
                    <AppCard key={`${item.source}-${item.id}`} item={item} onInstall={setSelected} />
                  ))}
                </div>

                {/* Pagination */}
                {pages > 1 && (
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 12, marginTop: 20 }}>
                    <button className="btn btn--outline btn--sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft size={13} /> Zurück
                    </button>
                    <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>Seite {page} / {pages} ({total.toLocaleString()} Apps)</span>
                    <button className="btn btn--outline btn--sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                      Weiter <ChevronRight size={13} />
                    </button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <InstallModal item={selected} onClose={() => setSelected(null)} onDone={() => void search(debouncedQuery, source, page, category)} />
    </>
  );
}
