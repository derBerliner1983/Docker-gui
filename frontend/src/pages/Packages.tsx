import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Package, Trash2, Download, Search, X, CheckCircle2, Boxes, AlertTriangle } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { InstalledPackage, PackageSearchResult } from '../lib/types';

export function Packages() {
  const [packages, setPackages] = useState<InstalledPackage[]>([]);
  const [manager, setManager] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');
  const [onlyManual, setOnlyManual] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [outputOpen, setOutputOpen] = useState(false);

  // Installations-Suche
  const [installOpen, setInstallOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PackageSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await api.packages.list();
      setPackages(res.packages);
      setManager(res.manager);
      setAvailable(res.available);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Live-Aktualisierung alle 10 s (außer während einer Aktion)
  useEffect(() => {
    const id = setInterval(() => { if (!busy) void load(false); }, 10000);
    return () => clearInterval(id);
  }, [load, busy]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return packages.filter((p) => {
      if (onlyManual && p.auto) return false;
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.summary.toLowerCase().includes(q);
    });
  }, [packages, filter, onlyManual]);

  const totalSize = useMemo(() => packages.reduce((s, p) => s + p.size, 0), [packages]);

  const toggleSel = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  const allVisibleSelected = filtered.length > 0 && filtered.every((p) => selected.has(p.name));
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) filtered.forEach((p) => next.delete(p.name));
      else filtered.forEach((p) => next.add(p.name));
      return next;
    });
  };

  const remove = async (names: string[], purge: boolean) => {
    if (!names.length) return;
    const verb = purge ? 'inkl. Konfiguration vollständig entfernen (purge)' : 'entfernen';
    if (!confirm(`${names.length} Paket(e) ${verb}?\n\n${names.slice(0, 20).join(', ')}${names.length > 20 ? ' …' : ''}`)) return;
    setBusy(true);
    try {
      const res = await api.packages.remove(names, purge);
      setOutput(res.output || 'Fertig.');
      setOutputOpen(true);
      setSelected(new Set());
      setTimeout(() => { void load(false); }, 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const runSearch = (q: string) => {
    setQuery(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try { setResults((await api.packages.search(q.trim())).results); }
      catch { setResults([]); }
      finally { setSearching(false); }
    }, 400);
  };

  const install = async (name: string) => {
    if (!confirm(`Paket „${name}" installieren?`)) return;
    setBusy(true);
    try {
      const res = await api.packages.install([name]);
      setOutput(res.output || 'Fertig.');
      setOutputOpen(true);
      setInstallOpen(false); setQuery(''); setResults([]);
      setTimeout(() => { void load(false); }, 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy(false);
    }
  };

  const selCount = selected.size;

  return (
    <>
      <Topbar
        title="Paketverwaltung"
        subtitle={manager ? `${manager} · ${packages.length} installiert · ${formatBytes(totalSize)}` : undefined}
        onRefresh={() => load()}
        refreshing={loading}
        actions={
          available && (
            <button className="btn btn--primary btn--sm" onClick={() => setInstallOpen(true)} disabled={busy}>
              <Download size={13} /> Paket installieren
            </button>
          )
        }
      />
      <main className="page">
        {!available ? (
          <div className="empty-state">
            <div className="empty-state__icon"><Package size={44} strokeWidth={1} /></div>
            <div className="empty-state__title">Kein Paketmanager erkannt</div>
            <div className="empty-state__desc">Dieses System stellt keinen unterstützten Paketmanager bereit.</div>
          </div>
        ) : (
          <Panel
            title="Installierte Pakete"
            icon={<Boxes size={15} />}
            subtitle={`${filtered.length} von ${packages.length}`}
            storageKey="packages"
          >
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '4px 0 12px' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
                <input
                  className="input input--rect"
                  placeholder="Pakete filtern…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  style={{ width: '100%', paddingLeft: 30 }}
                />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--color-muted)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={onlyManual} onChange={(e) => setOnlyManual(e.target.checked)} />
                Nur manuell installierte
              </label>
            </div>

            {selCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', marginBottom: 10, background: 'var(--color-accent-soft)', borderRadius: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{selCount} ausgewählt</span>
                <div style={{ flex: 1 }} />
                <button className="btn btn--danger btn--sm" disabled={busy} onClick={() => remove([...selected], false)}>
                  <Trash2 size={12} /> Entfernen
                </button>
                <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => remove([...selected], true)} title="Inkl. Konfigurationsdateien">
                  Vollständig (purge)
                </button>
                <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}><X size={12} /> Auswahl aufheben</button>
              </div>
            )}

            <div className="table-scroll" style={{ maxHeight: '62vh', overflow: 'auto' }}>
              <table className="dtable">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>
                      <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} title="Alle sichtbaren auswählen" />
                    </th>
                    <th>Paket</th>
                    <th style={{ width: 130 }}>Version</th>
                    <th style={{ width: 90 }}>Größe</th>
                    <th style={{ width: 90 }}>Typ</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 30, color: 'var(--color-muted)' }}>Keine Pakete gefunden.</td></tr>
                  ) : filtered.slice(0, 600).map((p) => (
                    <tr key={p.name} style={selected.has(p.name) ? { background: 'var(--color-accent-soft)' } : undefined}>
                      <td>
                        <input type="checkbox" checked={selected.has(p.name)} onChange={() => toggleSel(p.name)} />
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.name}</div>
                        {p.summary && <div className="text-muted" style={{ fontSize: 11.5, maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.summary}</div>}
                      </td>
                      <td className="dtable__mono text-muted" style={{ fontSize: 12 }}>{p.version}</td>
                      <td className="text-muted">{p.size ? formatBytes(p.size) : '—'}</td>
                      <td>
                        <span className={`badge badge--${p.auto ? 'stopped' : 'running'}`} style={{ height: 20, padding: '0 7px', fontSize: 10.5 }}>
                          {p.auto ? 'Abhäng.' : 'manuell'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn--outline btn--sm" disabled={busy} onClick={() => remove([p.name], false)} title="Paket entfernen">
                          <Trash2 size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length > 600 && (
                <div style={{ textAlign: 'center', padding: 10, fontSize: 12, color: 'var(--color-muted)' }}>
                  … {filtered.length - 600} weitere – bitte Filter eingrenzen.
                </div>
              )}
            </div>
          </Panel>
        )}
      </main>

      {/* Installations-Dialog */}
      <Modal open={installOpen} title="Paket installieren" onClose={() => { setInstallOpen(false); setQuery(''); setResults([]); }} width={620}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-faint)' }} />
          <input
            className="input input--rect"
            autoFocus
            placeholder="Paket suchen (mind. 2 Zeichen)…"
            value={query}
            onChange={(e) => runSearch(e.target.value)}
            style={{ width: '100%', paddingLeft: 32 }}
          />
        </div>
        <div style={{ maxHeight: 360, overflow: 'auto' }}>
          {searching ? (
            <div style={{ textAlign: 'center', padding: 24 }}><span className="spinner" style={{ width: 20, height: 20 }} /></div>
          ) : results.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: 'var(--color-muted)', fontSize: 12.5 }}>
              {query.trim().length < 2 ? 'Suchbegriff eingeben, um verfügbare Pakete zu finden.' : 'Keine Treffer.'}
            </div>
          ) : (
            results.map((r) => (
              <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{r.name}</div>
                  {r.summary && <div className="text-muted" style={{ fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.summary}</div>}
                </div>
                {r.installed ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--color-success)' }}>
                    <CheckCircle2 size={13} /> installiert
                  </span>
                ) : (
                  <button className="btn btn--primary btn--sm" disabled={busy} onClick={() => install(r.name)}>
                    <Download size={12} /> Installieren
                  </button>
                )}
              </div>
            ))
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 12, fontSize: 11.5, color: 'var(--color-muted)' }}>
          <AlertTriangle size={13} /> Nur Pakete aus den konfigurierten System-Repositories werden installiert.
        </div>
      </Modal>

      <Modal open={outputOpen} title="Ausgabe" onClose={() => setOutputOpen(false)} width={680}>
        <div className="log-viewer" style={{ maxHeight: 460 }}>{output}</div>
      </Modal>
    </>
  );
}
