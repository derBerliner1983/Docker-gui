import { useState, useEffect, useCallback } from 'react';
import { BrainCircuit, Download, Trash2, RefreshCw, HardDrive, Cpu, Tag } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import type { OllamaStatus, OllamaModel } from '../lib/types';

const POPULAR_MODELS = [
  { name: 'llama3.2:1b',         label: 'Llama 3.2 1B',      size: '~1 GB',    desc: 'Sehr klein, sehr schnell',         tag: 'Meta' },
  { name: 'llama3.2:3b',         label: 'Llama 3.2 3B',      size: '~2 GB',    desc: 'Kompakt, gut für einfache Aufgaben', tag: 'Meta' },
  { name: 'mistral:7b',          label: 'Mistral 7B',         size: '~4.1 GB',  desc: 'Ausgeglichen, sehr gut für Text',  tag: 'Mistral AI' },
  { name: 'gemma2:2b',           label: 'Gemma 2 2B',         size: '~1.6 GB',  desc: 'Google – kompakt & effizient',     tag: 'Google' },
  { name: 'gemma2:9b',           label: 'Gemma 2 9B',         size: '~5.4 GB',  desc: 'Google – höhere Qualität',         tag: 'Google' },
  { name: 'qwen2.5:7b',          label: 'Qwen 2.5 7B',        size: '~4.7 GB',  desc: 'Multilingual (Alibaba)',            tag: 'Alibaba' },
  { name: 'phi3:mini',           label: 'Phi-3 Mini',         size: '~2.3 GB',  desc: 'Microsoft – sehr effizient',       tag: 'Microsoft' },
  { name: 'deepseek-r1:7b',      label: 'DeepSeek R1 7B',     size: '~4.7 GB',  desc: 'Starkes Reasoning-Modell',          tag: 'DeepSeek' },
  { name: 'codellama:7b',        label: 'Code Llama 7B',      size: '~3.8 GB',  desc: 'Optimiert für Quellcode',          tag: 'Meta' },
  { name: 'nomic-embed-text',    label: 'Nomic Embed Text',   size: '~274 MB',  desc: 'Text-Embeddings für RAG/Suche',    tag: 'Embedding' },
];

function fmtBytes(b: number): string {
  if (b >= 1e9) return (b / 1e9).toFixed(1) + ' GB';
  if (b >= 1e6) return (b / 1e6).toFixed(0) + ' MB';
  return (b / 1e3).toFixed(0) + ' KB';
}

export function Ai() {
  const [status, setStatus] = useState<OllamaStatus | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pulling, setPulling] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState('');

  const loadModels = useCallback(async () => {
    try { const m = await api.ki.models(); setModels(m.models ?? []); } catch { /* */ }
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, m] = await Promise.all([api.ki.status(), api.ki.models()]);
      setStatus(s);
      setModels(m.models ?? []);
    } catch { /* */ }
  }, []);

  const refresh = async () => { setLoading(true); try { await load(); } finally { setLoading(false); } };

  useEffect(() => { void refresh(); }, []);

  // Poll models while any download is running
  useEffect(() => {
    if (pulling.size === 0) return;
    const t = setInterval(loadModels, 5000);
    return () => clearInterval(t);
  }, [pulling, loadModels]);

  const control = async (on: boolean) => {
    setBusy(true);
    try { await api.ki.control(on ? 'start' : 'stop'); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const pull = async (name: string) => {
    const n = name.trim();
    if (!n) return;
    setPulling((s) => new Set([...s, n]));
    setCustomModel('');
    try { await api.ki.pull(n); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler beim Starten des Downloads'); setPulling((s) => { const ns = new Set(s); ns.delete(n); return ns; }); }
  };

  const remove = async (name: string) => {
    if (!confirm(`Modell "${name}" wirklich löschen?`)) return;
    setDeleting(name);
    try { await api.ki.remove(name); await loadModels(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setDeleting(null); }
  };

  // When a pulling model appears in the list, remove from pulling set
  useEffect(() => {
    if (pulling.size === 0) return;
    const names = new Set(models.map((m) => m.name));
    pulling.forEach((n) => { if (names.has(n)) setPulling((s) => { const ns = new Set(s); ns.delete(n); return ns; }); });
  }, [models, pulling]);

  const installedNames = new Set(models.map((m) => m.name));
  const totalSize = models.reduce((s, m) => s + (m.size ?? 0), 0);

  if (!status) {
    return (
      <>
        <Topbar title="KI-Modelle" />
        <main className="page">
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
            <span className="spinner" style={{ width: 28, height: 28 }} />
          </div>
        </main>
      </>
    );
  }

  if (!status.installed) {
    return (
      <>
        <Topbar title="KI-Modelle" />
        <main className="page">
          <div className="card">
            <div className="card-body" style={{ textAlign: 'center', padding: '48px 24px' }}>
              <BrainCircuit size={48} strokeWidth={1.2} color="var(--color-faint)" style={{ marginBottom: 16 }} />
              <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Ollama nicht installiert</div>
              <div style={{ fontSize: 13.5, color: 'var(--color-muted)', marginBottom: 24 }}>
                Ollama ermöglicht lokale KI-Modelle ohne Cloud-Abhängigkeit.<br />
                Installiere es mit einem einzigen Befehl:
              </div>
              <code style={{ display: 'inline-block', background: 'var(--color-surface)', border: '1px solid var(--color-border)', padding: '10px 20px', borderRadius: 6, fontSize: 12.5 }}>
                sudo bash install.sh --ki
              </code>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Topbar
        title="KI-Modelle"
        subtitle={`${models.length} Modell${models.length !== 1 ? 'e' : ''} · ${fmtBytes(totalSize)} belegt`}
        onRefresh={refresh}
        refreshing={loading}
      />
      <main className="page">

        {/* Status */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap', padding: '14px 20px' }}>
            <BrainCircuit size={26} color={status.running ? 'var(--color-success)' : 'var(--color-faint)'} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>Ollama{status.version ? ` v${status.version}` : ''}</div>
              <div style={{ fontSize: 11, color: 'var(--color-muted)' }}>Port {status.port}</div>
            </div>
            <span className={`badge badge--${status.running ? 'running' : 'stopped'}`}>
              <span className="badge__dot" />{status.running ? 'läuft' : 'gestoppt'}
            </span>
            <Switch checked={status.running} disabled={busy} onChange={control} />
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              <HardDrive size={13} color="var(--color-muted)" />
              <span style={{ fontSize: 12.5, color: 'var(--color-muted)' }}>{fmtBytes(totalSize)} gesamt belegt</span>
            </div>
          </div>
        </div>

        {/* Installed models */}
        <Panel title="Installierte Modelle" icon={<Cpu size={15} />} subtitle={`${models.length} Modelle`} storageKey="ki-models">
          {models.length === 0 ? (
            <div className="empty-state" style={{ padding: '32px 20px' }}>
              <div className="empty-state__icon"><BrainCircuit size={36} strokeWidth={1.2} /></div>
              <div className="empty-state__title">Noch keine Modelle geladen</div>
              <div className="empty-state__desc">Wähle unten ein Modell aus oder gib einen eigenen Namen ein.</div>
            </div>
          ) : (
            <div className="dtable">
              <div className="dtable__row dtable__row--header">
                <div className="dtable__cell" style={{ flex: 2 }}>Modell</div>
                <div className="dtable__cell">Größe</div>
                <div className="dtable__cell">Parameter</div>
                <div className="dtable__cell">Quantisierung</div>
                <div className="dtable__cell">Familie</div>
                <div className="dtable__cell" style={{ flex: 'none', width: 52 }}></div>
              </div>
              {models.map((m) => (
                <div key={m.name} className="dtable__row">
                  <div className="dtable__cell dtable__mono" style={{ flex: 2, fontWeight: 600, fontSize: 12.5 }}>{m.name}</div>
                  <div className="dtable__cell" style={{ fontSize: 12 }}>{fmtBytes(m.size)}</div>
                  <div className="dtable__cell" style={{ fontSize: 12 }}>{m.details?.parameter_size ?? '—'}</div>
                  <div className="dtable__cell" style={{ fontSize: 12 }}>{m.details?.quantization_level ?? '—'}</div>
                  <div className="dtable__cell" style={{ fontSize: 12 }}>{m.details?.family ?? '—'}</div>
                  <div className="dtable__cell" style={{ flex: 'none', width: 52, justifyContent: 'flex-end' }}>
                    <button
                      className="btn btn--outline btn--sm"
                      style={{ color: 'var(--color-error)', borderColor: 'var(--color-error)', padding: '2px 8px' }}
                      disabled={deleting === m.name}
                      onClick={() => remove(m.name)}
                      title={`Modell ${m.name} löschen`}
                    >
                      {deleting === m.name ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Trash2 size={11} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Download models */}
        <Panel title="Modell laden" icon={<Download size={15} />} subtitle="Beliebte Modelle · eigenen Namen eingeben" storageKey="ki-pull">
          {pulling.size > 0 && (
            <div style={{ background: 'rgba(99,102,241,.1)', border: '1px solid var(--color-accent)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="spinner" style={{ width: 13, height: 13, flexShrink: 0 }} />
              <span>Lade {[...pulling].join(', ')} … (läuft im Hintergrund, Liste aktualisiert sich automatisch)</span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginBottom: 18 }}>
            {POPULAR_MODELS.map((pm) => {
              const installed = installedNames.has(pm.name);
              const isLoading = pulling.has(pm.name);
              return (
                <div key={pm.name} style={{ background: 'var(--color-surface)', border: `1px solid ${installed ? 'var(--color-success)' : 'var(--color-border)'}`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 700 }}>{pm.label}</span>
                    <span style={{ fontSize: 9.5, color: 'var(--color-faint)', background: 'var(--color-border)', padding: '1px 5px', borderRadius: 3, flexShrink: 0 }}>
                      <Tag size={8} style={{ verticalAlign: 'middle' }} /> {pm.tag}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-muted)', flex: 1 }}>{pm.desc}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-faint)' }}>{pm.size}</div>
                  <button
                    className={`btn btn--sm ${installed ? 'btn--outline' : 'btn--primary'}`}
                    style={{ marginTop: 6, fontSize: 11 }}
                    disabled={isLoading}
                    onClick={() => pull(pm.name)}
                  >
                    {isLoading
                      ? <><span className="spinner" style={{ width: 10, height: 10 }} /> Lädt…</>
                      : installed
                        ? <><RefreshCw size={10} /> Neu laden</>
                        : <><Download size={10} /> Laden</>}
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 8 }}>Beliebiger Modellname (von ollama.com/library)</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                style={{ flex: 1, fontSize: 12.5 }}
                placeholder="z.B. llama3.1:70b oder wizardlm2:8x22b"
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void pull(customModel)}
              />
              <button className="btn btn--primary" disabled={!customModel.trim()} onClick={() => void pull(customModel)}>
                <Download size={13} /> Laden
              </button>
            </div>
          </div>
        </Panel>
      </main>
    </>
  );
}
