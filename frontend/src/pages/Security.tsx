import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, Info, CheckCircle2, XCircle, Lightbulb } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Donut } from '../components/ui/Donut';
import { api } from '../lib/api';
import type { SecurityScan, SecurityFinding, SecurityStatus } from '../lib/types';

const STATUS_META: Record<SecurityStatus, { color: string; label: string; icon: React.ElementType; order: number }> = {
  critical: { color: 'var(--color-error)', label: 'Kritisch', icon: XCircle, order: 0 },
  warn: { color: 'var(--color-warning)', label: 'Warnung', icon: AlertTriangle, order: 1 },
  info: { color: 'var(--color-info)', label: 'Info', icon: Info, order: 2 },
  ok: { color: 'var(--color-success)', label: 'OK', icon: CheckCircle2, order: 3 },
};

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--color-success)';
  if (score >= 65) return 'var(--color-accent)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function FindingRow({ f }: { f: SecurityFinding }) {
  const meta = STATUS_META[f.status];
  const Icon = meta.icon;
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
      <Icon size={18} color={meta.color} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.title}</span>
          <span className="badge badge--paused" style={{ fontSize: 10 }}>{f.category}</span>
        </div>
        {f.detail && <div className="dtable__mono" style={{ fontSize: 11.5, color: 'var(--color-subtle)', marginTop: 3 }}>{f.detail}</div>}
        {f.recommendation && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12.5, color: 'var(--color-muted)' }}>
            <Lightbulb size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-warning)' }} />
            <span>{f.recommendation}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function Security() {
  const [scan, setScan] = useState<SecurityScan | null>(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try { setScan(await api.security.scan()); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const sorted = scan ? [...scan.findings].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order) : [];
  const actionable = sorted.filter((f) => f.status === 'critical' || f.status === 'warn');
  const passed = sorted.filter((f) => f.status === 'ok' || f.status === 'info');

  return (
    <>
      <Topbar
        title="Sicherheit"
        subtitle={scan ? `Geprüft: ${new Date(scan.scannedAt).toLocaleTimeString('de-DE')}` : undefined}
        onRefresh={run}
        refreshing={loading}
        actions={<button className="btn btn--primary btn--sm" onClick={run} disabled={loading}>{loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} Erneut prüfen</button>}
      />
      <main className="page">
        {!scan ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><span className="spinner" style={{ width: 28, height: 28 }} /></div>
        ) : (
          <>
            {/* Score card */}
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card-body" style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
                <Donut
                  size={150} thickness={16}
                  segments={[{ value: scan.score, color: scoreColor(scan.score) }, { value: 100 - scan.score, color: 'var(--color-border-strong)' }]}
                  centerLabel={String(scan.score)}
                  centerSub="von 100"
                  centerColor={scoreColor(scan.score)}
                />
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: scoreColor(scan.score) }}>{scan.grade}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-muted)', marginTop: 4, marginBottom: 14 }}>
                    Sicherheitsbewertung deines Linux-Servers
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                    {(['critical', 'warn', 'ok', 'info'] as SecurityStatus[]).map((s) => {
                      const m = STATUS_META[s];
                      const Icon = m.icon;
                      return (
                        <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Icon size={15} color={m.color} />
                          <span style={{ fontSize: 15, fontWeight: 700 }}>{scan.counts[s]}</span>
                          <span style={{ fontSize: 12, color: 'var(--color-subtle)' }}>{m.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Actionable findings */}
            <Panel
              title="Handlungsbedarf"
              icon={<ShieldAlert size={15} />}
              subtitle={`${actionable.length} Punkte`}
              storageKey="sec-action"
            >
              {actionable.length === 0 ? (
                <div className="empty-state" style={{ padding: '36px 20px' }}>
                  <div className="empty-state__icon"><ShieldCheck size={40} strokeWidth={1.2} color="var(--color-success)" /></div>
                  <div className="empty-state__title">Keine Probleme gefunden</div>
                  <div className="empty-state__desc">Alle geprüften Punkte sind in Ordnung. Gut gemacht!</div>
                </div>
              ) : (
                <div style={{ marginTop: 2 }}>
                  {actionable.map((f) => <FindingRow key={f.id} f={f} />)}
                </div>
              )}
            </Panel>

            {/* Passed checks */}
            <Panel
              title="Bestandene Prüfungen"
              icon={<ShieldCheck size={15} />}
              subtitle={`${passed.length} OK`}
              storageKey="sec-passed"
              defaultCollapsed
            >
              <div style={{ marginTop: 2 }}>
                {passed.map((f) => <FindingRow key={f.id} f={f} />)}
              </div>
            </Panel>
          </>
        )}
      </main>
    </>
  );
}
