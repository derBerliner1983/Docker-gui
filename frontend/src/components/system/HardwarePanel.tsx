import { useCallback, useEffect, useState } from 'react';
import { Cpu, RefreshCw, MemoryStick, MonitorCog, Terminal } from 'lucide-react';
import { Panel } from '../ui/Panel';
import { donutColor } from '../ui/Donut';
import { api } from '../../lib/api';
import { tt } from '../../lib/i18n';
import type { HardwareInfo } from '../../lib/types';

const gb = (b: number) => (b > 0 ? `${(b / 1024 ** 3).toFixed(1)} GB` : '—');
const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);

/** Ein Balkensegment der Speicheraufteilung. */
function Bar({ segments }: { segments: Array<{ label: string; bytes: number; color: string }> }) {
  const total = segments.reduce((s, x) => s + x.bytes, 0);
  if (total <= 0) return null;
  return (
    <>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--color-surface-sunken)' }}>
        {segments.filter((s) => s.bytes > 0).map((s) => (
          <div
            key={s.label}
            title={`${s.label}: ${gb(s.bytes)}`}
            // minWidth, damit ein sehr kleiner Anteil (z. B. 0,5 GB UMA neben
            // 96 GB GTT) nicht unsichtbar wird.
            style={{ width: `${pct(s.bytes, total)}%`, minWidth: 4, background: s.color }}
          />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
        {segments.filter((s) => s.bytes > 0).map((s) => (
          <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span className="text-muted">{s.label}</span>
            <span style={{ fontWeight: 600 }}>{gb(s.bytes)}</span>
          </span>
        ))}
      </div>
    </>
  );
}

/**
 * Auslastung eines einzelnen Speichertopfs: wie viel von wie viel belegt ist.
 *
 * Für den Grafikspeicher aussagekräftiger als ein Aufteilungsbalken: fest
 * zugeteilter (UMA) und dynamisch geliehener Speicher (GTT) unterscheiden sich
 * auf APUs um Größenordnungen (0,5 GB neben 96 GB). Ein gemeinsamer Balken –
 * und erst recht ein Kreis – zeigte davon nichts Brauchbares; interessant ist,
 * wie voll jeder Topf für sich ist. Die Farbschwelle ist dieselbe wie bei den
 * Ringdiagrammen des Dashboards (ab 75 % gelb, ab 90 % rot).
 */
function UsageBar({ label, used, total }: { label: string; used: number; total: number }) {
  if (total <= 0) return null;
  const p = pct(used, total);
  const color = donutColor(p);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5 }}>{label}</span>
        <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
          <span style={{ color: 'var(--color-fg)', fontWeight: 600 }}>{gb(used)}</span> {tt('von')} {gb(total)}
        </span>
        <span style={{ fontWeight: 700, fontSize: 12.5, color, minWidth: 40, textAlign: 'right' }}>{p}&nbsp;%</span>
      </div>
      <div
        title={`${label}: ${gb(used)} / ${gb(total)} (${p} %)`}
        style={{ height: 10, borderRadius: 5, overflow: 'hidden', background: 'var(--color-surface-sunken)' }}
      >
        {/* minWidth: belegter Speicher soll auch bei winzigem Anteil sichtbar bleiben */}
        <div style={{ width: `${p}%`, minWidth: used > 0 ? 3 : 0, height: '100%', background: color, transition: 'width .3s' }} />
      </div>
    </div>
  );
}

/**
 * Hardware & Speicheraufteilung.
 *
 * Zeigt getrennt nach Quelle, wie der Speicher aufgeteilt ist: was das BIOS als
 * verbaut meldet, was der Kernel als Arbeitsspeicher sieht, was fest der GPU
 * zugeteilt ist (UMA) und was sie sich dynamisch leiht (GTT). Auf APUs mit
 * gemeinsamem Speicher – etwa AMD Ryzen AI Max – ist genau das die Frage.
 */
export function HardwarePanel() {
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setHw(await api.system.hardware()); }
    catch (e) { setErr(e instanceof Error ? e.message : tt('Hardware konnte nicht gelesen werden')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const m = hw?.memory;

  return (
    <Panel
      title={tt('Hardware & Speicheraufteilung')}
      icon={<Cpu size={15} />}
      subtitle={hw?.cpu.model || undefined}
      storageKey="sys-hardware"
      defaultCollapsed
      actions={
        <button className="btn btn--outline btn--sm" disabled={loading} onClick={() => void load()}>
          {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />} {tt('Neu lesen')}
        </button>
      }
    >
      {err && <div style={{ fontSize: 12.5, color: 'var(--color-warning)', marginTop: 8 }}>{err}</div>}
      {hw && (
        <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 18 }}>

          {/* Prozessor & Gerät */}
          <div className="table-scroll">
            <table className="dtable">
              <tbody>
                <tr><td className="text-muted" style={{ width: 210 }}>{tt('Prozessor')}</td><td style={{ fontWeight: 600 }}>{hw.cpu.model || '—'}</td></tr>
                <tr><td className="text-muted">{tt('Kerne / Threads')}</td><td>{hw.cpu.cores} / {hw.cpu.threads}</td></tr>
                {hw.firmware.available && (
                  <>
                    <tr><td className="text-muted">{tt('Gerät')}</td><td>{[hw.firmware.productName, hw.firmware.boardName].filter(Boolean).join(' · ') || '—'}</td></tr>
                    <tr><td className="text-muted">{tt('BIOS/UEFI')}</td><td className="dtable__mono">{[hw.firmware.biosVendor, hw.firmware.biosVersion, hw.firmware.biosDate].filter(Boolean).join(' · ') || '—'}</td></tr>
                  </>
                )}
                <tr><td className="text-muted">{tt('Kernel')}</td><td className="dtable__mono">{hw.kernel.version || '—'}</td></tr>
              </tbody>
            </table>
          </div>

          {/* Arbeitsspeicher: verbaut vs. was der Kernel sieht */}
          {m && (
            <div>
              <div className="section-heading" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                <MemoryStick size={13} /> {tt('Arbeitsspeicher')}
              </div>
              {m.installedBytes > 0 ? (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                    {tt('Laut BIOS sind {inst} verbaut, davon meldet der Kernel {kern} als Arbeitsspeicher.', {
                      inst: gb(m.installedBytes), kern: gb(m.kernelTotalBytes),
                    })}
                  </div>
                  <Bar segments={[
                    { label: tt('Für das System (Kernel)'), bytes: m.kernelTotalBytes, color: 'var(--color-accent)' },
                    { label: tt('Im BIOS reserviert (u. a. Grafik)'), bytes: m.reservedBytes, color: 'var(--color-warning)' },
                  ]} />
                </>
              ) : (
                <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginBottom: 10 }}>
                  {tt('Kernel-Sicht: {kern} gesamt, {avail} verfügbar.', {
                    kern: gb(m.kernelTotalBytes), avail: gb(m.kernelAvailableBytes),
                  })}
                </div>
              )}

              {m.modules.length > 0 && (
                <div className="table-scroll" style={{ marginTop: 12 }}>
                  <table className="dtable">
                    <thead><tr><th>{tt('Steckplatz')}</th><th>{tt('Größe')}</th><th>{tt('Typ')}</th><th>{tt('Takt')}</th></tr></thead>
                    <tbody>
                      {m.modules.map((mod, i) => (
                        <tr key={`${mod.locator}-${i}`}>
                          <td className="dtable__mono">{mod.locator || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{mod.size}</td>
                          <td className="text-muted">{mod.type || '—'}</td>
                          <td className="text-muted">{mod.speed || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Grafikspeicher: fest (BIOS/UMA) und dynamisch (GTT) */}
          {hw.gpus.length > 0 && (
            <div>
              <div className="section-heading" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
                <MonitorCog size={13} /> {tt('Grafikspeicher')}
              </div>
              {hw.gpus.map((g) => (
                <div key={g.card} className="card" style={{ marginBottom: 10 }}>
                  <div className="card-body" style={{ padding: '11px 13px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{g.name}</span>
                      <span className="dtable__mono">{g.card}{g.driver ? ` · ${g.driver}` : ''}</span>
                      {g.unified && (
                        <span className="badge badge--paused" style={{ height: 20, padding: '0 8px' }}>
                          {tt('geteilter Speicher')}
                        </span>
                      )}
                    </div>
                    {/* Ein Auslastungsbalken je Topf statt eines Aufteilungs-
                        balkens: die Größen liegen um Faktor 100+ auseinander,
                        die Aufteilung sagt daher nichts – die Füllung schon. */}
                    <UsageBar label={tt('Fest zugeteilt (BIOS/UMA)')} used={g.vramUsedBytes} total={g.vramTotalBytes} />
                    <UsageBar label={tt('Dynamisch leihbar (GTT)')} used={g.gttUsedBytes} total={g.gttTotalBytes} />
                    {g.visibleVramBytes > 0 && (
                      <div className="table-scroll" style={{ marginTop: 12 }}>
                        <table className="dtable">
                          <tbody>
                            <tr>
                              <td className="text-muted" style={{ width: 260 }}>{tt('Für die CPU sichtbar (Resizable BAR)')}</td>
                              <td>{gb(g.visibleVramBytes)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Kernel-Parameter, die die Aufteilung beeinflussen */}
          <div>
            <div className="section-heading" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Terminal size={13} /> {tt('Kernel-Parameter zur Speicheraufteilung')}
            </div>
            {hw.kernel.memoryParams.length > 0 ? (
              <div className="table-scroll">
                <table className="dtable">
                  <thead><tr><th>{tt('Parameter')}</th><th>{tt('Wert')}</th><th>{tt('Bedeutung')}</th></tr></thead>
                  <tbody>
                    {hw.kernel.memoryParams.map((p) => (
                      <tr key={p.key}>
                        <td className="dtable__mono" style={{ fontWeight: 600 }}>{p.key}</td>
                        <td className="dtable__mono">{p.value}</td>
                        <td className="text-muted">{p.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ fontSize: 12.5, color: 'var(--color-faint)' }}>
                {tt('Keine speicherrelevanten Boot-Parameter gesetzt.')}
              </div>
            )}
            {hw.kernel.cmdline && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--color-muted)' }}>{tt('Vollständige Kernel-Kommandozeile')}</summary>
                <div className="dtable__mono" style={{ marginTop: 6, fontSize: 11.5, wordBreak: 'break-all', lineHeight: 1.6 }}>
                  {hw.kernel.cmdline}
                </div>
              </details>
            )}
          </div>

          {hw.hints.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {hw.hints.map((h) => (
                <div key={h} style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>• {h}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
