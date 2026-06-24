import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, AlertTriangle, Info, CheckCircle2, XCircle, Lightbulb, Wrench, Terminal, FileDown, Globe, Home, Pencil } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Donut } from '../components/ui/Donut';
import { Switch } from '../components/ui/Switch';
import { SecurityAlerts } from '../components/security/AlertsPanel';
import { api } from '../lib/api';
import type { SecurityScan, SecurityFinding, SecurityStatus, SshStatus } from '../lib/types';

const ZONE_META = {
  'lan-only':             { label: 'Nur LAN',      color: '#ef4444', bg: 'rgba(239,68,68,.1)',   Icon: Home  },
  'internet-ok':          { label: 'Internet OK',  color: '#22c55e', bg: 'rgba(34,197,94,.1)',   Icon: Globe },
  'internet-conditional': { label: 'Prüfen',       color: '#f59e0b', bg: 'rgba(234,179,8,.1)',   Icon: AlertTriangle },
};

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

function AccessToggle({ label, Icon, on, disabled, onChange }: { label: string; Icon: React.ElementType; on: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 64 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10.5, fontWeight: 600, color: on ? 'var(--color-fg)' : 'var(--color-faint)' }}>
        <Icon size={11} /> {label}
      </span>
      <Switch checked={on} disabled={disabled} onChange={onChange} />
      <span style={{ fontSize: 9.5, color: on ? 'var(--color-success)' : 'var(--color-faint)' }}>{on ? 'erlaubt' : 'gesperrt'}</span>
    </div>
  );
}

function FindingRow({ f, onFix, fixing, showZoneBadge = true }: { f: SecurityFinding; onFix: (action: string) => void; fixing: boolean; showZoneBadge?: boolean }) {
  const meta = STATUS_META[f.status];
  const Icon = meta.icon;
  const zone = f.accessZone ? ZONE_META[f.accessZone] : null;
  const isNetwork = !!f.accessZone && !!f.port;
  const sn = f.subnet ?? '';
  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--color-border)' }}>
      <Icon size={18} color={meta.color} style={{ flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.title}</span>
          <span className="badge badge--paused" style={{ fontSize: 10 }}>{f.category}</span>
          {zone && showZoneBadge && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: zone.bg, color: zone.color }} title="Empfehlung für diesen Dienst">
              <zone.Icon size={10} /> Empf.: {zone.label}
            </span>
          )}
        </div>
        {f.detail && <div className="dtable__mono" style={{ fontSize: 11.5, color: 'var(--color-subtle)', marginTop: 3 }}>{f.detail}</div>}
        {f.recommendation && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6, fontSize: 12.5, color: 'var(--color-muted)' }}>
            <Lightbulb size={13} style={{ flexShrink: 0, marginTop: 1, color: 'var(--color-warning)' }} />
            <span>{f.recommendation}</span>
          </div>
        )}
      </div>
      {isNetwork ? (
        <div style={{ display: 'flex', gap: 14, flexShrink: 0, alignSelf: 'center', alignItems: 'flex-start' }}>
          <span style={{ width: 14, flexShrink: 0, alignSelf: 'center', display: 'inline-flex', justifyContent: 'center' }}>
            {fixing && <span className="spinner" style={{ width: 14, height: 14 }} />}
          </span>
          <AccessToggle label="LAN" Icon={Home} on={!!f.lan} disabled={fixing}
            onChange={(v) => onFix(`port-access:${f.port}:${v ? 1 : 0}:${f.internet ? 1 : 0}:${sn}`)} />
          <AccessToggle label="Internet" Icon={Globe} on={!!f.internet} disabled={fixing}
            onChange={(v) => onFix(`port-access:${f.port}:${f.lan ? 1 : 0}:${v ? 1 : 0}:${sn}`)} />
        </div>
      ) : f.fix ? (
        <button className="btn btn--outline btn--sm" style={{ flexShrink: 0, alignSelf: 'center' }} disabled={fixing} onClick={() => onFix(f.fix!)}>
          {fixing ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Wrench size={12} />} Beheben
        </button>
      ) : null}
    </div>
  );
}

function StatePill({ label, Icon, on, danger }: { label: string; Icon: React.ElementType; on: boolean; danger?: boolean }) {
  const color = danger ? 'var(--color-error)' : on ? 'var(--color-success)' : 'var(--color-faint)';
  const bg = danger ? 'rgba(239,68,68,.12)' : on ? 'rgba(34,197,94,.12)' : 'var(--color-border)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, padding: '2px 8px', borderRadius: 4, background: bg, color, minWidth: 86, justifyContent: 'center' }}>
      <Icon size={10} /> {label} {on ? '✓' : '✗'}
    </span>
  );
}

/** Kompakte, schreibgeschützte Übersichtszeile für das Netzwerkzugang-Panel. */
function NetSummaryRow({ f, showZoneBadge }: { f: SecurityFinding; showZoneBadge: boolean }) {
  const meta = STATUS_META[f.status];
  const Icon = meta.icon;
  const zone = f.accessZone ? ZONE_META[f.accessZone] : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid var(--color-border)' }}>
      <Icon size={15} color={meta.color} style={{ flexShrink: 0 }} />
      <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.title}</span>
      {zone && showZoneBadge && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 4, background: zone.bg, color: zone.color, flexShrink: 0 }}>
          <zone.Icon size={9} /> {zone.label}
        </span>
      )}
      {f.port && <StatePill label="LAN" Icon={Home} on={!!f.lan} />}
      {f.port && <StatePill label="Internet" Icon={Globe} on={!!f.internet} danger={!!f.internet && f.accessZone === 'lan-only'} />}
    </div>
  );
}

function SshPanel() {
  const [ssh, setSsh] = useState<SshStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => { try { setSsh(await api.security.ssh()); } catch { /* */ } }, []);
  useEffect(() => { void load(); }, [load]);

  const control = async (action: 'start' | 'stop' | 'enable' | 'disable') => {
    if ((action === 'stop' || action === 'disable') && !confirm('Achtung: Ohne SSH verlierst du ggf. den Remote-Zugang. Fortfahren?')) return;
    setBusy(true);
    try { await api.security.sshControl(action); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="SSH-Zugang" icon={<Terminal size={15} />} subtitle={ssh ? `Port ${ssh.port} · ${ssh.unit}` : undefined} storageKey="sec-ssh">
      {!ssh ? <div className="text-muted text-sm" style={{ padding: 8 }}>Lade…</div> : !ssh.installed ? (
        <div className="text-muted text-sm" style={{ padding: 8 }}>SSH-Server nicht installiert.</div>
      ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Dienst läuft</span>
            <Switch checked={ssh.active} disabled={busy} onChange={(v) => control(v ? 'start' : 'stop')} />
            <span className={`badge badge--${ssh.active ? 'running' : 'stopped'}`}><span className="badge__dot" />{ssh.active ? 'aktiv' : 'gestoppt'}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Autostart</span>
            <Switch checked={ssh.enabled} disabled={busy} onChange={(v) => control(v ? 'enable' : 'disable')} />
            <span className="text-muted text-sm">{ssh.enabled ? 'beim Boot' : 'deaktiviert'}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function exportPdf(scan: SecurityScan) {
  const statusIcon: Record<SecurityStatus, string> = {
    critical: '🔴', warn: '🟡', ok: '✅', info: 'ℹ️',
  };
  const gradeColor: Record<string, string> = { 'Sehr gut': '#22c55e', 'Gut': '#84cc16', 'Ausreichend': '#f59e0b', 'Kritisch': '#ef4444' };
  const color = gradeColor[scan.grade] ?? '#6366f1';
  const sorted = [...scan.findings].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order);
  const dateStr = new Date(scan.scannedAt).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' });

  const rows = sorted.map((f) => `
    <tr>
      <td style="width:32px;text-align:center;padding:7px 8px;border-bottom:1px solid #e5e7eb">${statusIcon[f.status]}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-weight:600;font-size:13px">${f.title}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#6b7280">${f.category}</td>
      <td style="padding:7px 8px;border-bottom:1px solid #e5e7eb;font-size:11.5px;color:#374151">${f.detail ?? '—'}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<title>Core-Hub Sicherheitsbericht</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#fff;color:#111827;padding:48px;font-size:14px}
  @media print{body{padding:24px}}
  .header{display:flex;align-items:flex-start;gap:32px;margin-bottom:36px;padding-bottom:28px;border-bottom:2px solid #e5e7eb}
  .score-ring{width:110px;height:110px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;border:10px solid ${color};flex-shrink:0}
  .score-val{font-size:30px;font-weight:800;color:${color};line-height:1}
  .score-sub{font-size:10px;color:#9ca3af;margin-top:2px}
  h1{font-size:24px;font-weight:800;color:#111827;margin-bottom:4px}
  .grade{font-size:18px;font-weight:700;color:${color};margin-bottom:8px}
  .meta{font-size:12px;color:#6b7280;margin-bottom:14px}
  .counts{display:flex;gap:20px;flex-wrap:wrap}
  .count{display:flex;align-items:center;gap:6px;font-size:13px}
  .count strong{font-size:16px;font-weight:700}
  h2{font-size:14px;font-weight:700;margin:24px 0 10px;color:#374151;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
  table{width:100%;border-collapse:collapse}
  .footer{margin-top:48px;padding-top:20px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:11px;color:#9ca3af}
  .stamp{margin-top:24px;padding:14px 20px;background:#f0fdf4;border:2px solid #86efac;border-radius:8px;font-size:13px;color:#166534}
</style>
</head>
<body>
<div class="header">
  <div class="score-ring"><span class="score-val">${scan.score}</span><span class="score-sub">/ 100</span></div>
  <div>
    <h1>Core-Hub Sicherheitsbericht</h1>
    <div class="grade">${scan.grade}</div>
    <div class="meta">Erstellt am: <strong>${dateStr}</strong></div>
    <div class="counts">
      <div class="count"><strong style="color:#ef4444">${scan.counts.critical}</strong> Kritisch</div>
      <div class="count"><strong style="color:#f59e0b">${scan.counts.warn}</strong> Warnung</div>
      <div class="count"><strong style="color:#22c55e">${scan.counts.ok}</strong> OK</div>
      <div class="count"><strong style="color:#6366f1">${scan.counts.info}</strong> Info</div>
    </div>
  </div>
</div>

${scan.counts.critical === 0 && scan.counts.warn === 0 ? `
<div class="stamp">✅ Alle kritischen Prüfungen bestanden – keine Handlungspunkte offen</div>` : ''}

<h2>Prüfungsergebnisse</h2>
<table>
  <thead><tr>
    <th style="width:32px"></th>
    <th style="text-align:left;padding:6px 8px;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb">Prüfpunkt</th>
    <th style="text-align:left;padding:6px 8px;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb">Kategorie</th>
    <th style="text-align:left;padding:6px 8px;font-size:12px;color:#6b7280;border-bottom:2px solid #e5e7eb">Details</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>

<div class="footer">
  <span>Core-Hub · Automatischer Sicherheitsbericht</span>
  <span>${dateStr}</span>
</div>
<script>window.onload=()=>{window.print()}<\/script>
</body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  if (w) { w.document.write(html); w.document.close(); }
}

export function Security() {
  const [scan, setScan] = useState<SecurityScan | null>(null);
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const [netModalOpen, setNetModalOpen] = useState(false);
  const [showZoneBadge, setShowZoneBadge] = useState(() => localStorage.getItem('security-zone-badge') !== 'false');

  const toggleZoneBadge = () => {
    setShowZoneBadge((v) => { const next = !v; localStorage.setItem('security-zone-badge', String(next)); return next; });
  };

  const run = useCallback(async () => {
    setLoading(true);
    try { setScan(await api.security.scan()); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void run(); }, [run]);

  const fix = async (action: string) => {
    if (action.startsWith('port-access:')) {
      const [, port, lan, net] = action.split(':');
      // Aussperr-Schutz: Web-UI/SSH nicht versehentlich komplett dichtmachen
      if (['22', '80', '443', '4200'].includes(port) && lan === '0' && net === '0') {
        if (!confirm(`Achtung: Port ${port} für LAN UND Internet zu sperren kann den Zugriff auf Core-Hub/SSH kappen. Wirklich komplett sperren?`)) return;
      } else if (['22', '80', '443', '4200'].includes(port) && lan === '0') {
        if (!confirm(`Achtung: LAN-Zugriff auf Port ${port} sperren? Du könntest dich aus dem lokalen Netz aussperren.`)) return;
      }
    } else if (!confirm('Sicherheits-Maßnahme jetzt anwenden?')) return;
    setFixing(action);
    try { await api.security.fix(action); await run(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setFixing(null); }
  };

  const isFixing = (f: SecurityFinding) =>
    f.port ? (!!fixing && fixing.startsWith(`port-access:${f.port}:`)) : (fixing === f.fix);

  const sorted = scan ? [...scan.findings].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order) : [];
  const networkFindings = sorted.filter((f) => f.category === 'Netzwerkzugang');
  const otherFindings = sorted.filter((f) => f.category !== 'Netzwerkzugang');
  const actionable = otherFindings.filter((f) => f.status === 'critical' || f.status === 'warn');
  const passed = otherFindings.filter((f) => f.status === 'ok' || f.status === 'info');

  return (
    <>
      <Topbar
        title="Sicherheit"
        subtitle={scan ? `Geprüft: ${new Date(scan.scannedAt).toLocaleTimeString('de-DE')}` : undefined}
        onRefresh={run}
        refreshing={loading}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            {scan && <button className="btn btn--outline btn--sm" onClick={() => exportPdf(scan)} title="Sicherheitsbericht als PDF exportieren"><FileDown size={13} /> Bericht (PDF)</button>}
            <button className="btn btn--primary btn--sm" onClick={run} disabled={loading}>{loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <ShieldCheck size={13} />} Erneut prüfen</button>
          </div>
        }
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
                  {actionable.map((f) => <FindingRow key={f.id} f={f} onFix={fix} fixing={isFixing(f)} showZoneBadge={showZoneBadge} />)}
                </div>
              )}
            </Panel>

            <SshPanel />

            {/* Netzwerkzugang – kompakte Übersicht, Bearbeitung im Popup */}
            <Panel
              title="Netzwerkzugang"
              icon={<Globe size={15} />}
              subtitle={`${networkFindings.filter((f) => f.internet && f.accessZone === 'lan-only').length} kritisch im Internet`}
              storageKey="sec-network"
              actions={
                networkFindings.length > 0 && (
                  <button
                    className="btn btn--outline btn--sm"
                    onClick={() => setNetModalOpen(true)}
                    title="Port-Zugriff (LAN/Internet) bearbeiten"
                    style={{ fontSize: 11, padding: '2px 10px' }}
                  >
                    <Pencil size={12} /> Bearbeiten
                  </button>
                )
              }
            >
              {scan.firewallActive === false && (
                <div style={{ background: 'rgba(234,179,8,.12)', border: '1px solid var(--color-warning)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--color-warning)' }}>
                  ⚠ Die <b>Firewall (ufw) ist inaktiv</b> – aktuell ist alles erreichbar. Regeln greifen erst, wenn die Firewall aktiviert ist (oben „Handlungsbedarf" → Firewall aktivieren).
                </div>
              )}
              {networkFindings.length === 0 ? (
                <div className="text-muted text-sm">Keine Netzwerkbefunde.</div>
              ) : (
                <div style={{ marginTop: 2 }}>
                  {networkFindings.map((f) => <NetSummaryRow key={f.id} f={f} showZoneBadge={showZoneBadge} />)}
                </div>
              )}
            </Panel>

            {/* Bearbeiten-Popup: LAN/Internet pro Port schalten */}
            <Modal
              open={netModalOpen}
              title="Netzwerkzugang bearbeiten"
              onClose={() => setNetModalOpen(false)}
              width={680}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--color-muted)', lineHeight: 1.6 }}>
                  Pro Port getrennt schaltbar: <b>LAN</b> (nur lokales Netz, z. B. 192.168.x.x) und <b>Internet</b> (von überall erreichbar).
                  {' '}Die Schalter zeigen den <b>echten Firewall-Zustand</b> und ändern ihn sofort.
                  {' '}Mit <b>Pangolin/Newt</b> laufen externe Dienste über den Tunnel – direkte Internet-Ports kannst du gefahrlos abschalten.
                </div>
                <button
                  className="btn btn--outline btn--sm"
                  onClick={toggleZoneBadge}
                  title={showZoneBadge ? 'Empfehlungs-Labels ausblenden' : 'Empfehlungs-Labels einblenden'}
                  style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}
                >
                  {showZoneBadge ? 'Labels aus' : 'Labels ein'}
                </button>
              </div>
              {scan.firewallActive === false && (
                <div style={{ background: 'rgba(234,179,8,.12)', border: '1px solid var(--color-warning)', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12.5, color: 'var(--color-warning)' }}>
                  ⚠ Die <b>Firewall (ufw) ist inaktiv</b> – aktuell ist alles erreichbar. Die Schalter legen zwar Regeln an, diese greifen aber erst, wenn die Firewall aktiviert ist.
                </div>
              )}
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
                {Object.entries(ZONE_META).map(([key, z]) => (
                  <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: z.color }}>
                    <z.Icon size={12} /> <b>{z.label}</b>
                    <span style={{ color: 'var(--color-muted)' }}>– {key === 'lan-only' ? 'niemals direkt im Internet' : key === 'internet-ok' ? 'sicher für Internet-Zugriff' : 'prüfen und ggf. einschränken'}</span>
                  </span>
                ))}
              </div>
              <div style={{ marginTop: 2 }}>
                {networkFindings.map((f) => <FindingRow key={f.id} f={f} onFix={fix} fixing={isFixing(f)} showZoneBadge={showZoneBadge} />)}
              </div>
            </Modal>

            {/* E-Mail-Alarm-Regeln */}
            <SecurityAlerts />

            {/* Passed checks */}
            <Panel
              title="Bestandene Prüfungen"
              icon={<ShieldCheck size={15} />}
              subtitle={`${passed.length} OK`}
              storageKey="sec-passed"
              defaultCollapsed
            >
              <div style={{ marginTop: 2 }}>
                {passed.map((f) => <FindingRow key={f.id} f={f} onFix={fix} fixing={isFixing(f)} showZoneBadge={showZoneBadge} />)}
              </div>
            </Panel>
          </>
        )}
      </main>
    </>
  );
}
