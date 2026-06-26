import { useState, useEffect, useCallback } from 'react';
import { Network, Plus, Trash2, Shield, Link2, Unlink, Lock, Cable, MonitorPlay, Play, Square, Star, Link, Pencil, RefreshCw, X, Activity, Download, AlertTriangle, ShieldPlus, Wand2, ShieldCheck, XCircle, Info, CheckCircle2, EyeOff } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { portInfo } from '../lib/utils';
import type { DockerNetwork, HostInterface, FirewallRule, FirewallDisabledRule, FirewallLogEntry, FirewallFinding, Container, VmNetwork, VM, ContainerNetworkEntry, VmIpEntry } from '../lib/types';

function CreateNetModal({ open, onClose, onDone, interfaces }: { open: boolean; onClose: () => void; onDone: () => void; interfaces: HostInterface[] }) {
  const [name, setName] = useState('');
  const [driver, setDriver] = useState('bridge');
  const [subnet, setSubnet] = useState('');
  const [gateway, setGateway] = useState('');
  const [parent, setParent] = useState('');
  const [vlan, setVlan] = useState('');
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.networks.create({ name, driver, subnet: subnet || undefined, gateway: gateway || undefined, parent: parent || undefined, vlan: vlan || undefined, internal });
      setName(''); setSubnet(''); setGateway(''); setParent(''); setVlan(''); setInternal(false); setDriver('bridge');
      onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  const isVlan = driver === 'macvlan' || driver === 'ipvlan';

  return (
    <Modal open={open} title="Neues Netzwerk" onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Name</label>
          <input className="input input--rect" placeholder="dmz-netz" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Treiber</label>
          <select className="input input--rect" value={driver} onChange={(e) => setDriver(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="bridge">bridge (Standard)</option>
            <option value="macvlan">macvlan (eigene IP im LAN)</option>
            <option value="ipvlan">ipvlan</option>
          </select></div>
      </div>
      <div className="form-row">
        <div className="form-group"><label className="form-label">Subnetz (optional)</label>
          <input className="input input--rect" placeholder="192.168.50.0/24" value={subnet} onChange={(e) => setSubnet(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
        <div className="form-group"><label className="form-label">Gateway (optional)</label>
          <input className="input input--rect" placeholder="192.168.50.1" value={gateway} onChange={(e) => setGateway(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
      </div>
      {isVlan && (
        <div className="form-row">
          <div className="form-group"><label className="form-label">Eltern-Schnittstelle</label>
            <select className="input input--rect" value={parent} onChange={(e) => setParent(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="">— wählen —</option>
              {interfaces.map((i) => <option key={i.iface} value={i.iface}>{i.iface} ({i.ip4 || 'keine IP'})</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder="z.B. 100" value={vlan} onChange={(e) => setVlan(e.target.value)} />
            <div className="form-hint">Erzeugt Tag {parent || 'ethX'}.{vlan || 'ID'}</div></div>
        </div>
      )}
      <label className="legend__item" style={{ cursor: 'pointer', marginTop: 4 }}>
        <Switch checked={internal} onChange={setInternal} />
        <span><Lock size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <b>Isoliert (internal)</b> — <span className="text-muted">kein Zugriff nach außen, sichert unsichere Container ab</span></span>
      </label>
    </Modal>
  );
}

function ConnectModal({ net, open, onClose, onDone, containers }: { net: DockerNetwork | null; open: boolean; onClose: () => void; onDone: () => void; containers: Container[] }) {
  const [container, setContainer] = useState('');
  const [ip, setIp] = useState('');
  const [aliases, setAliases] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (containers[0]) setContainer(containers[0].id); }, [containers, open]);

  const save = async () => {
    if (!net || !container) { setError('Container wählen'); return; }
    setLoading(true); setError('');
    try {
      await api.networks.connect(net.id, container, ip || undefined, aliases ? aliases.split(',').map((a) => a.trim()).filter(Boolean) : undefined);
      setIp(''); setAliases(''); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={`Container verbinden → ${net?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Verbinden
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">Container</label>
        <select className="input input--rect" value={container} onChange={(e) => setContainer(e.target.value)} style={{ cursor: 'pointer' }}>
          {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label">Feste IP (optional)</label>
        <input className="input input--rect" placeholder={net?.subnet ? net.subnet.replace(/0\/\d+$/, '50') : '192.168.50.50'} value={ip} onChange={(e) => setIp(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">Muss im Subnetz {net?.subnet || '—'} liegen.</div></div>
      <div className="form-group"><label className="form-label">Alias-Namen / weitere IPs (Komma-getrennt)</label>
        <input className="input input--rect" placeholder="web, api, db" value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
    </Modal>
  );
}

type FwForm = { action: 'allow' | 'deny' | 'reject'; port: string; proto: string; from: string; direction: string; comment: string };
const EMPTY_FW_FORM: FwForm = { action: 'allow', port: '', proto: '', from: '', direction: '', comment: '' };

/** Bestehende Regel bestmöglich in Formularfelder zerlegen (zum Bearbeiten). */
function ruleToForm(r: FirewallRule): FwForm {
  const m = r.to.match(/^(\d+(?::\d+)?)\/?(tcp|udp)?$/i);
  return {
    action: (r.action.toLowerCase() as 'allow' | 'deny' | 'reject') ?? 'allow',
    port: m ? m[1] : '',
    proto: m && m[2] ? m[2].toLowerCase() : '',
    from: /anywhere/i.test(r.from) ? '' : r.from.replace(/\s*\(v6\)/i, '').trim(),
    direction: (r.direction ?? '').toLowerCase(),
    comment: r.comment ?? '',
  };
}

const DIR_LABEL: Record<string, string> = { IN: 'Eingehend', OUT: 'Ausgehend', '': '–' };

const SEV_META: Record<FirewallFinding['severity'], { color: string; bg: string; label: string; Icon: React.ElementType; order: number }> = {
  critical: { color: 'var(--color-error)',   bg: 'rgba(239,68,68,.1)',  label: 'Kritisch', Icon: XCircle,       order: 0 },
  warn:     { color: 'var(--color-warning)', bg: 'rgba(234,179,8,.1)',  label: 'Warnung',  Icon: AlertTriangle, order: 1 },
  info:     { color: 'var(--color-info)',    bg: 'rgba(59,130,246,.1)', label: 'Hinweis',  Icon: Info,          order: 2 },
  ok:       { color: 'var(--color-success)', bg: 'rgba(34,197,94,.1)',  label: 'OK',       Icon: CheckCircle2,  order: 3 },
};

/** Plausibilitäts-Assistent: prüft alle ufw-Regeln und bietet Ein-Klick-Korrekturen. */
function FirewallAssistant({ open, onClose, rules, onChanged }: {
  open: boolean; onClose: () => void; rules: FirewallRule[]; onChanged: () => Promise<void>;
}) {
  const [findings, setFindings] = useState<FirewallFinding[]>([]);
  const [counts, setCounts] = useState({ critical: 0, warn: 0, info: 0 });
  const [meta, setMeta] = useState<{ ruleCount: number; defaultIncoming?: string; listeningCount?: number }>({ ruleCount: 0 });
  const [loading, setLoading] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.firewall.analyze();
      setFindings(res.findings);
      setCounts(res.counts);
      setMeta({ ruleCount: res.ruleCount, defaultIncoming: res.defaultIncoming, listeningCount: res.listeningCount });
    } catch (err) { alert(err instanceof Error ? err.message : 'Analyse fehlgeschlagen'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (open) void analyze(); }, [open, analyze]);

  const applyFix = async (f: FirewallFinding) => {
    if (f.ruleNum == null || !f.fix) return;
    const rule = rules.find((r) => r.num === f.ruleNum);
    setFixing(f.id);
    try {
      if (f.fix === 'restrict-lan') {
        await api.firewall.restrictLan(f.ruleNum);
      } else if (f.fix === 'delete') {
        await api.firewall.remove(f.ruleNum);
      } else if (f.fix === 'disable' && rule) {
        const isPort = /^\d+(?::\d+)?(?:\/(tcp|udp))?$/i.test(rule.to);
        const proto = rule.to.includes('/udp') ? 'udp' : rule.to.includes('/tcp') ? 'tcp' : undefined;
        const port = isPort ? rule.to.replace(/\/(tcp|udp)$/i, '') : undefined;
        await api.firewall.disable(f.ruleNum, {
          action: rule.action.toLowerCase(), port, proto,
          from: /anywhere/i.test(rule.from) ? undefined : rule.from,
          direction: rule.direction ? rule.direction.toLowerCase() : undefined,
          comment: rule.comment || undefined,
          profile: isPort ? undefined : rule.to,
        });
      }
      await onChanged();   // Regeln neu laden (Nummern verschieben sich)
      await analyze();     // Analyse aktualisieren
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setFixing(null); }
  };

  // Mehrfach-Aktionen (z.B. Port freigeben: LAN vs. überall)
  const LAN_RANGES = '192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12';
  const applyAction = async (a: NonNullable<FirewallFinding['actions']>[number]) => {
    setFixing(a.id);
    try {
      if (a.kind === 'allow-any') {
        await api.firewall.add({ action: 'allow', port: a.port, proto: a.proto || undefined });
      } else if (a.kind === 'allow-lan') {
        await api.firewall.add({ action: 'allow', port: a.port, proto: a.proto || undefined, from: LAN_RANGES });
      } else if (a.kind === 'delete' && a.ruleNum != null) {
        await api.firewall.remove(a.ruleNum);
      } else if (a.kind === 'restrict-lan' && a.ruleNum != null) {
        await api.firewall.restrictLan(a.ruleNum);
      } else if (a.kind === 'ignore' && a.port) {
        await api.firewall.ignorePort(a.port);
      }
      await onChanged();
      await analyze();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setFixing(null); }
  };

  const sorted = [...findings].sort((a, b) => SEV_META[a.severity].order - SEV_META[b.severity].order);
  const allClear = !loading && findings.length === 0;

  return (
    <Modal open={open} title="Firewall-Assistent — Port-Scan & Empfehlungen" onClose={onClose} width={720}>
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12, lineHeight: 1.5 }}>
        Der Assistent scannt alle lauschenden Dienste und Regeln. Für jeden erreichbaren Dienst kannst du entscheiden:
        nur im LAN freigeben, überall (Internet) freigeben – oder nichts tun (bleibt durch Standard-deny blockiert).
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14, fontSize: 12.5, color: 'var(--color-muted)' }}>
        <span><b style={{ color: 'var(--color-fg)' }}>{meta.ruleCount}</b> Regeln</span>
        {meta.listeningCount != null && <span><b style={{ color: 'var(--color-fg)' }}>{meta.listeningCount}</b> lauschende Ports</span>}
        {meta.defaultIncoming && <span>Standard eingehend: <b style={{ color: meta.defaultIncoming === 'deny' ? 'var(--color-success)' : 'var(--color-warning)' }}>{meta.defaultIncoming}</b></span>}
        <button className="btn btn--ghost btn--sm" onClick={analyze} disabled={loading} style={{ marginLeft: 'auto' }}>
          {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />} Neu prüfen
        </button>
      </div>

      {/* Zähler */}
      {!allClear && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
          {(['critical', 'warn', 'info'] as const).map((s) => {
            const m = SEV_META[s];
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 6, background: m.bg }}>
                <m.Icon size={13} color={m.color} />
                <b style={{ fontSize: 13 }}>{counts[s]}</b>
                <span style={{ fontSize: 11, color: 'var(--color-muted)' }}>{m.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : allClear ? (
        <div className="empty-state" style={{ padding: '36px 20px' }}>
          <div className="empty-state__icon"><ShieldCheck size={40} strokeWidth={1.2} color="var(--color-success)" /></div>
          <div className="empty-state__title">Alles in Ordnung</div>
          <div className="empty-state__desc">Keine problematischen oder überflüssigen Regeln gefunden. Deine Firewall ist sauber konfiguriert.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sorted.map((f) => {
            const m = SEV_META[f.severity];
            return (
              <div key={f.id} style={{ display: 'flex', gap: 12, padding: 12, borderRadius: 8, background: 'var(--color-surface-sunken)', border: `1px solid ${m.color}33` }}>
                <m.Icon size={18} color={m.color} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{f.title}</div>
                  {f.detail && <div className="dtable__mono" style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 3 }}>{f.detail}</div>}
                  <div style={{ fontSize: 12.5, color: 'var(--color-muted)', marginTop: 5, lineHeight: 1.5 }}>{f.recommendation}</div>
                </div>
                {(f.fix && f.ruleNum != null) || f.actions?.length ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, alignSelf: 'center' }}>
                    {f.fix && f.ruleNum != null && (
                      <button
                        className={`btn btn--sm ${f.severity === 'critical' ? 'btn--danger' : 'btn--outline'}`}
                        style={{ whiteSpace: 'nowrap' }}
                        disabled={fixing === f.id}
                        onClick={() => applyFix(f)}
                      >
                        {fixing === f.id ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Wand2 size={12} />} {f.fixLabel ?? 'Beheben'}
                      </button>
                    )}
                    {f.actions?.map((a) => (
                      <button
                        key={a.id}
                        className={`btn btn--sm ${a.kind === 'allow-any' ? 'btn--ghost' : a.kind === 'delete' ? 'btn--outline' : a.kind === 'ignore' ? 'btn--ghost' : 'btn--primary'}`}
                        style={{ whiteSpace: 'nowrap', opacity: a.kind === 'ignore' ? 0.7 : 1 }}
                        disabled={fixing === a.id}
                        onClick={() => applyAction(a)}
                        title={a.kind === 'ignore' ? 'Port als absichtlich blockiert markieren – wird nicht mehr angezeigt' : undefined}
                      >
                        {fixing === a.id ? <span className="spinner" style={{ width: 12, height: 12 }} />
                          : a.kind === 'allow-lan' ? <Lock size={12} />
                          : a.kind === 'allow-any' ? <Network size={12} />
                          : a.kind === 'ignore' ? <EyeOff size={12} />
                          : <Trash2 size={12} />} {a.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 14, fontSize: 11, color: 'var(--color-faint)', lineHeight: 1.6 }}>
        Geparkte Regeln werden gemerkt und lassen sich jederzeit wieder aktivieren — ideal für Ports, die aktuell niemand braucht,
        die ein Docker-Container aber später wieder öffnen soll.
      </div>
    </Modal>
  );
}

function FirewallPanel() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [disabled, setDisabled] = useState<FirewallDisabledRule[]>([]);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<FwForm>(EMPTY_FW_FORM);
  const [editNum, setEditNum] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.firewall.list();
    setRules(res.rules); setDisabled(res.disabled ?? []);
    setAvailable(res.available); setActive(res.active); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (r: FirewallRule) => { setEditNum(r.num); setForm(ruleToForm(r)); };
  const cancelEdit = () => { setEditNum(null); setForm(EMPTY_FW_FORM); };

  const submit = async () => {
    if (!form.port && !form.from) { alert('Port oder Quell-IP angeben'); return; }
    setBusy(true);
    const payload = { action: form.action, port: form.port || undefined, proto: form.proto || undefined, from: form.from || undefined, direction: form.direction || undefined, comment: form.comment || undefined };
    try {
      if (editNum !== null) await api.firewall.update(editNum, payload);
      else await api.firewall.add(payload);
      setForm(EMPTY_FW_FORM); setEditNum(null);
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const del = async (num: number) => {
    if (!confirm('Regel löschen?')) return;
    try { await api.firewall.remove(num); if (editNum === num) cancelEdit(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  // Regel deaktivieren (merkt sich die Regel zum späteren Reaktivieren)
  const disableRule = async (r: FirewallRule) => {
    const f = ruleToForm(r);
    const isPort = /^\d+(?::\d+)?(?:\/(tcp|udp))?$/i.test(r.to);
    try {
      await api.firewall.disable(r.num, {
        action: f.action, port: f.port || undefined, proto: f.proto || undefined,
        from: f.from || undefined, direction: f.direction || undefined,
        comment: r.comment || undefined, profile: isPort ? undefined : r.to,
      });
      if (editNum === r.num) cancelEdit();
      await load();
    } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const enableRule = async (id: number) => {
    try { await api.firewall.enableDisabled(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };
  const discardDisabled = async (id: number) => {
    if (!confirm('Deaktivierte Regel endgültig verwerfen?')) return;
    try { await api.firewall.removeDisabled(id); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const q = filter.trim().toLowerCase();
  const shownRules = q
    ? rules.filter((r) => `${r.comment ?? ''} ${r.to} ${r.from} ${r.action} ${r.direction ?? ''}`.toLowerCase().includes(q))
    : rules;
  const shownDisabled = q
    ? disabled.filter((d) => `${d.comment} ${d.to} ${d.from} ${d.action}`.toLowerCase().includes(q))
    : disabled;

  return (
    <Panel
      title="Firewall (ufw)"
      icon={<Shield size={15} />}
      subtitle={available ? (active ? 'aktiv' : 'inaktiv') : 'nicht installiert'}
      storageKey="firewall"
      defaultCollapsed
      actions={available && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn btn--outline btn--sm" onClick={() => setAssistantOpen(true)} title="Regeln prüfen und optimieren">
            <Wand2 size={13} /> Assistent
          </button>
          <Switch checked={active} onChange={async (v) => {
            if (v) {
              const ok = confirm(
                'Firewall aktivieren?\n\n' +
                'Ports 22, 80 und 443 werden nur dann automatisch freigegeben, wenn noch keine Regel dafür existiert. ' +
                'Bestehende LAN-Regeln oder andere Einschränkungen bleiben unberührt.'
              );
              if (!ok) return;
            }
            await api.firewall.toggle(v).catch((e: Error) => alert(e.message));
            load();
          }} />
        </div>
      )}
    >
      {!available ? (
        <div className="empty-state" style={{ padding: '30px 20px' }}>
          <div className="empty-state__desc">{message}<br /><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '3px 7px', borderRadius: 5 }}>sudo apt install ufw</code></div>
        </div>
      ) : (
        <>
          {editNum !== null && (
            <div style={{ fontSize: 12, color: 'var(--color-accent)', marginTop: 6, marginBottom: 2, fontWeight: 600 }}>
              Regel #{editNum} bearbeiten
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8, marginBottom: 6 }}>
            <input className="input input--rect" placeholder="Name (optional)" value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} style={{ width: 150 }} title="Name / Bezeichnung der Regel" />
            <select className="input input--rect" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'allow' })} style={{ width: 92, cursor: 'pointer' }} title="Aktion">
              <option value="allow">allow</option><option value="deny">deny</option><option value="reject">reject</option>
            </select>
            <select className="input input--rect" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 152, cursor: 'pointer' }} title="Richtung – Beide legt je eine Regel für ein- und ausgehend an">
              <option value="">Richtung: –</option><option value="in">Eingehend (in)</option><option value="out">Ausgehend (out)</option><option value="both">Beide (ein + aus)</option>
            </select>
            <input className="input input--rect" placeholder="Port (z.B. 443)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 110 }} />
            <select className="input input--rect" value={form.proto} onChange={(e) => setForm({ ...form, proto: e.target.value })} style={{ width: 86, cursor: 'pointer' }}>
              <option value="">tcp+udp</option><option value="tcp">tcp</option><option value="udp">udp</option>
            </select>
            <input className="input input--rect" placeholder="von IP(s), mit Komma trennen" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 200, fontFamily: 'var(--font-mono)' }} title="Mehrere Quell-Adressen mit Komma/Leerzeichen trennen → je eine Regel" />
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy}>
              {editNum !== null ? <><Pencil size={13} /> Speichern</> : <><Plus size={13} /> Regel</>}
            </button>
            {editNum !== null && <button className="btn btn--ghost btn--sm" onClick={cancelEdit}><X size={13} /> Abbrechen</button>}
          </div>

          {(rules.length > 0 || disabled.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 10px' }}>
              <input className="input input--rect" placeholder="Regeln filtern (Name, Port, IP …)" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
              {filter && <button className="btn btn--ghost btn--sm" onClick={() => setFilter('')}><X size={12} /></button>}
              <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{shownRules.length} aktiv{disabled.length ? ` · ${shownDisabled.length} deaktiviert` : ''}</span>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Keine Regeln.</div>
          ) : (
            <table className="dtable">
              <thead><tr><th style={{ width: 30 }}>#</th><th>Name</th><th>Ziel</th><th>Aktion</th><th>Richtung</th><th>Von</th><th style={{ width: 56 }}>Aktiv</th><th style={{ width: 70 }}></th></tr></thead>
              <tbody>
                {shownRules.map((r) => (
                  <tr key={r.num} style={editNum === r.num ? { background: 'var(--color-accent-subtle, rgba(99,102,241,.08))' } : undefined}>
                    <td className="dtable__mono text-muted">{r.num}</td>
                    <td style={{ fontWeight: 600 }}>{r.comment || <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>–</span>}</td>
                    <td className="dtable__mono">{r.to}</td>
                    <td><span className={`badge badge--${r.action === 'ALLOW' ? 'running' : 'dead'}`}>{r.action}</span></td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[r.direction ?? ''] ?? r.direction}</td>
                    <td className="dtable__mono text-muted">{r.from}</td>
                    <td><div onClick={(e) => e.stopPropagation()}><Switch checked onChange={() => void disableRule(r)} /></div></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button className="btn btn--ghost btn--icon btn--sm" title="Bearbeiten" onClick={() => startEdit(r)}><Pencil size={12} /></button>
                        <button className="btn btn--danger btn--icon btn--sm" title="Löschen" onClick={() => del(r.num)}><Trash2 size={12} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Deaktivierte Regeln (Parkbucht) */}
          {shownDisabled.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', marginBottom: 6 }}>
                Deaktivierte Regeln <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>(nicht aktiv – jederzeit reaktivierbar)</span>
              </div>
              <table className="dtable">
                <tbody>
                  {shownDisabled.map((d) => (
                    <tr key={d.id} style={{ opacity: 0.7 }}>
                      <td style={{ fontWeight: 600 }}>{d.comment || <span style={{ color: 'var(--color-faint)', fontWeight: 400 }}>–</span>}</td>
                      <td className="dtable__mono">{d.to}</td>
                      <td><span className="badge badge--stopped">{(d.action || '').toUpperCase()}</span></td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[d.direction] ?? d.direction}</td>
                      <td className="dtable__mono text-muted">{/anywhere/i.test(d.from) || !d.from ? 'Anywhere' : d.from}</td>
                      <td style={{ width: 56 }}><div onClick={(e) => e.stopPropagation()}><Switch checked={false} onChange={() => void enableRule(d.id)} /></div></td>
                      <td style={{ width: 40 }}><button className="btn btn--danger btn--icon btn--sm" title="Verwerfen" onClick={() => discardDisabled(d.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <FirewallAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} rules={rules} onChanged={load} />
    </Panel>
  );
}

const LOG_ACTION_BADGE: Record<string, string> = { BLOCK: 'dead', ALLOW: 'running', LIMIT: 'restarting', AUDIT: 'stopped' };

function csvCell(v: string): string {
  const s = v ?? '';
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(rows: FirewallLogEntry[], filename: string) {
  const header = ['Zeit', 'Aktion', 'Richtung', 'Quell-IP', 'Quell-Port', 'Ziel-IP', 'Ziel-Port', 'Protokoll', 'Schnittstelle', 'Dienst (Ziel-Port)'];
  const lines = [header.join(';')];
  for (const e of rows) {
    lines.push([
      e.ts, e.action, e.direction, e.src, e.spt, e.dst, e.dpt, e.proto, e.iface, portInfo(e.dpt).name,
    ].map(csvCell).join(';'));
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function QuickRuleModal({ entry, open, onClose, onDone }: {
  entry: FirewallLogEntry | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [action, setAction] = useState<'allow' | 'deny' | 'reject'>('allow');
  const [from, setFrom] = useState('');
  const [port, setPort] = useState('');
  const [proto, setProto] = useState('');
  const [direction, setDirection] = useState('in');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (entry) {
      setFrom(entry.src || '');
      setPort(entry.dpt || '');
      setProto((entry.proto || '').toLowerCase());
      setDirection((entry.direction || 'IN').toLowerCase());
      setAction('allow');
      setComment('');
      setError('');
    }
  }, [entry, open]);

  const submit = async () => {
    if (!port && !from) { setError('Port oder Quell-IP angeben'); return; }
    setBusy(true); setError('');
    try {
      await api.firewall.add({
        action,
        port: port || undefined,
        proto: proto || undefined,
        from: from || undefined,
        direction: direction || undefined,
        comment: comment || undefined,
      });
      onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={open} title="Firewall-Regel aus Verbindung erstellen" onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className={`btn btn--${action === 'allow' ? 'primary' : 'danger'} btn--sm`} onClick={submit} disabled={busy}>
          {busy && <span className="spinner" style={{ width: 12, height: 12 }} />} Regel anlegen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div style={{ fontSize: 12, color: 'var(--color-muted)', marginBottom: 12 }}>
        Erstelle eine Firewall-Regel basierend auf dieser Verbindung. Alle Felder sind anpassbar.
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Aktion</label>
          <select className="input input--rect" value={action} onChange={(e) => setAction(e.target.value as 'allow' | 'deny' | 'reject')} style={{ cursor: 'pointer' }}>
            <option value="allow">Erlauben (allow)</option>
            <option value="deny">Blockieren (deny)</option>
            <option value="reject">Ablehnen (reject)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Richtung</label>
          <select className="input input--rect" value={direction} onChange={(e) => setDirection(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="in">Eingehend (in)</option>
            <option value="out">Ausgehend (out)</option>
            <option value="both">Beide (ein + aus)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Von IP (Quelle)</label>
        <input className="input input--rect" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder="leer = alle Quellen" />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">Ziel-Port</label>
          <input className="input input--rect" value={port} onChange={(e) => setPort(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder="z.B. 443" />
        </div>
        <div className="form-group">
          <label className="form-label">Protokoll</label>
          <select className="input input--rect" value={proto} onChange={(e) => setProto(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="">tcp+udp</option>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Name / Bezeichnung (optional)</label>
        <input className="input input--rect" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="z.B. Heimnetz erlauben" />
      </div>
    </Modal>
  );
}

function ConnectionsPanel() {
  const [entries, setEntries] = useState<FirewallLogEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [logging, setLogging] = useState(false);
  const [level, setLevel] = useState('low');
  const [total, setTotal] = useState(0);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<'all' | 'BLOCK' | 'ALLOW'>('all');
  const [dirFilter, setDirFilter] = useState<'all' | 'IN' | 'OUT'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [quickRule, setQuickRule] = useState<FirewallLogEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.firewall.log(2000);
      setEntries(res.entries); setAvailable(res.available); setLogging(res.logging);
      setLevel(res.level ?? 'low');
      setTotal(res.total ?? res.entries.length); setMessage(res.message ?? '');
      setSelected(new Set());
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleLogging = async (v: boolean) => {
    // Beim Einschalten gleich auf "medium" gehen, damit auch erlaubte Verbindungen erscheinen
    const lvl = v ? (level === 'off' || level === 'low' ? 'medium' : level) : 'off';
    try { const r = await api.firewall.setLogging(v, lvl); setLogging(v); setLevel(r.level ?? lvl); setTimeout(() => void load(), 600); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const changeLevel = async (lvl: string) => {
    try { const r = await api.firewall.setLogging(lvl !== 'off', lvl); setLevel(r.level ?? lvl); setLogging(lvl !== 'off'); setTimeout(() => void load(), 600); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const clearLog = async () => {
    if (!confirm('Das gesamte Verbindungsprotokoll löschen?')) return;
    try { await api.firewall.clearLog(); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  const filtered = entries.filter((e) => {
    if (actionFilter !== 'all' && e.action !== actionFilter) return false;
    if (dirFilter !== 'all' && e.direction !== dirFilter) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      if (!`${e.src} ${e.dst} ${e.dpt} ${e.spt} ${e.proto} ${e.iface}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const blocked = entries.filter((e) => e.action === 'BLOCK').length;
  const allSelected = filtered.length > 0 && filtered.every((_, i) => selected.has(i));
  const selRows = filtered.filter((_, i) => selected.has(i));

  const toggleRow = (i: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((_, i) => i)));

  const exportSelected = () => downloadCsv(selRows.length ? selRows : filtered, `verbindungen-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`);
  const exportAll = () => downloadCsv(filtered, `verbindungen-alle-${new Date().toISOString().slice(0, 10)}.csv`);

  return (
    <Panel
      title="Verbindungsversuche"
      icon={<Activity size={15} />}
      subtitle={available ? `${total} im Protokoll · ${blocked} blockiert (geladen)` : 'nicht verfügbar'}
      storageKey="fw-connections"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>Protokollierung</span>
          <Switch checked={logging} onChange={toggleLogging} />
          {logging && (
            <select className="input input--rect" value={level} onChange={(e) => void changeLevel(e.target.value)} style={{ width: 188, cursor: 'pointer', fontSize: 12 }} title="Logging-Stufe – ab Mittel werden auch erlaubte Verbindungen protokolliert">
              <option value="low">Stufe: Niedrig (nur blockiert)</option>
              <option value="medium">Stufe: Mittel (auch erlaubt)</option>
              <option value="high">Stufe: Hoch (alles)</option>
              <option value="full">Stufe: Voll (alles, ungedrosselt)</option>
            </select>
          )}
          <button className="btn btn--ghost btn--icon btn--sm" title="Aktualisieren" onClick={() => void load()}>
            {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={13} />}
          </button>
        </div>
      }
    >
      {!available ? (
        <div className="empty-state" style={{ padding: '30px 20px' }}>
          <div className="empty-state__desc">{message || 'ufw nicht installiert.'}</div>
        </div>
      ) : (
        <>
          {!logging && (
            <div style={{ background: 'rgba(234,179,8,.1)', border: '1px solid var(--color-warning)', borderRadius: 8, padding: '10px 14px', margin: '8px 0 12px', fontSize: 12.5, color: 'var(--color-warning)' }}>
              ⚠ Die Firewall-Protokollierung ist <b>aus</b>. Ohne sie werden keine Verbindungsversuche aufgezeichnet.
              Schalte sie oben rechts ein, um zu sehen, wer von wo zugreift.
            </div>
          )}
          {logging && level === 'low' && (
            <div style={{ background: 'rgba(59,130,246,.1)', border: '1px solid var(--color-accent)', borderRadius: 8, padding: '10px 14px', margin: '8px 0 12px', fontSize: 12.5, color: 'var(--color-accent)' }}>
              ℹ Auf Stufe <b>Niedrig</b> protokolliert ufw nur <b>blockierte</b> Pakete – deshalb siehst du hier nur <b>BLOCK</b>.
              Stelle die Stufe oben rechts auf <b>Mittel</b> (oder höher), damit auch <b>erlaubte</b> Verbindungen (ALLOW) erscheinen.
              <span style={{ color: 'var(--color-muted)' }}> Hinweis: Höhere Stufen erzeugen deutlich mehr Logeinträge.</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 10px' }}>
            <select className="input input--rect" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as 'all')} style={{ width: 150, cursor: 'pointer' }}>
              <option value="all">Alle Aktionen</option><option value="BLOCK">Nur blockiert</option><option value="ALLOW">Nur erlaubt</option>
            </select>
            <select className="input input--rect" value={dirFilter} onChange={(e) => setDirFilter(e.target.value as 'all')} style={{ width: 140, cursor: 'pointer' }}>
              <option value="all">Beide Richtungen</option><option value="IN">Eingehend</option><option value="OUT">Ausgehend</option>
            </select>
            <input className="input input--rect" placeholder="Filter: IP, Port, Protokoll…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200, fontFamily: 'var(--font-mono)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{filtered.length} angezeigt{selRows.length ? ` · ${selRows.length} ausgewählt` : ''}</span>
          </div>

          {/* Export- & Verwaltungsleiste */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <button className="btn btn--outline btn--sm" onClick={exportSelected} disabled={filtered.length === 0}>
              <Download size={13} /> {selRows.length ? `Auswahl als CSV (${selRows.length})` : 'Angezeigte als CSV'}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exportAll} disabled={filtered.length === 0}>
              <Download size={13} /> Alle als CSV
            </button>
            <button className="btn btn--danger btn--sm" style={{ marginLeft: 'auto' }} onClick={clearLog}>
              <Trash2 size={13} /> Protokoll leeren
            </button>
          </div>

          {filtered.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>
              {entries.length === 0 ? 'Noch keine protokollierten Verbindungen.' : 'Keine Treffer für den Filter.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="dtable">
                <thead><tr>
                  <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title="Alle (angezeigten) auswählen" /></th>
                  <th>Zeit</th><th>Aktion</th><th>Richtung</th><th>Quell-IP</th><th>Ziel-Port</th><th>Dienst</th><th>Protokoll</th><th>Schnittstelle</th><th style={{ width: 44 }}></th>
                </tr></thead>
                <tbody>
                  {filtered.map((e, i) => {
                    const pi = portInfo(e.dpt);
                    return (
                      <tr key={i} style={selected.has(i) ? { background: 'var(--color-accent-subtle, rgba(99,102,241,.08))' } : undefined}>
                        <td><input type="checkbox" checked={selected.has(i)} onChange={() => toggleRow(i)} /></td>
                        <td className="text-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{e.ts || '–'}</td>
                        <td><span className={`badge badge--${LOG_ACTION_BADGE[e.action] ?? 'stopped'}`}>{e.action}</span></td>
                        <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[e.direction] ?? e.direction}</td>
                        <td className="dtable__mono" style={{ fontWeight: 600 }}>{e.src || '–'}</td>
                        <td className="dtable__mono" title={pi.hint}>{e.dpt || '–'}</td>
                        <td title={pi.hint} style={{ fontSize: 12, cursor: 'help', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {pi.risky && <AlertTriangle size={12} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />}
                          <span style={{ color: pi.name === 'Kein Standarddienst' || pi.name === 'Dynamischer Port' || pi.name === 'System-Port' ? 'var(--color-faint)' : 'var(--color-fg)' }}>{pi.name}</span>
                        </td>
                        <td className="text-muted">{e.proto || '–'}</td>
                        <td className="dtable__mono text-muted">{e.iface || '–'}</td>
                        <td>
                          <button
                            className="btn btn--ghost btn--icon btn--sm"
                            title="Firewall-Regel aus dieser Verbindung erstellen"
                            onClick={() => setQuickRule(e)}
                          >
                            <ShieldPlus size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <QuickRuleModal entry={quickRule} open={!!quickRule} onClose={() => setQuickRule(null)} onDone={load} />
        </>
      )}
    </Panel>
  );
}

function CreateVmNetModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('nat');
  const [subnet, setSubnet] = useState('192.168.123.0');
  const [bridge, setBridge] = useState('br0');
  const [vlan, setVlan] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const save = async () => {
    if (!name.trim()) { setError('Name erforderlich'); return; }
    setLoading(true); setError('');
    try {
      await api.vmNetworks.create({ name, mode, subnet: subnet || undefined, bridge: bridge || undefined, vlan: vlan || undefined });
      setName(''); setVlan(''); onDone(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title="Neues VM-Netzwerk" onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">Name</label>
          <input className="input input--rect" placeholder="vm-dmz" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">Modus</label>
          <select className="input input--rect" value={mode} onChange={(e) => setMode(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="nat">NAT (Internet über Host)</option>
            <option value="isolated">Isoliert (kein Außenzugriff)</option>
            <option value="bridge">Bridge (direkt im LAN)</option>
          </select></div>
      </div>
      {mode !== 'bridge' ? (
        <div className="form-group"><label className="form-label">Subnetz</label>
          <input className="input input--rect" placeholder="192.168.123.0" value={subnet} onChange={(e) => setSubnet(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">DHCP wird automatisch eingerichtet (.2–.254).</div></div>
      ) : (
        <div className="form-row">
          <div className="form-group"><label className="form-label">Host-Bridge</label>
            <input className="input input--rect" placeholder="br0" value={bridge} onChange={(e) => setBridge(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder="z.B. 100" value={vlan} onChange={(e) => setVlan(e.target.value)} /></div>
        </div>
      )}
    </Modal>
  );
}

function AttachVmModal({ net, open, onClose, onDone }: { net: VmNetwork | null; open: boolean; onClose: () => void; onDone: () => void }) {
  const [vms, setVms] = useState<VM[]>([]);
  const [vm, setVm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    api.vms.list().then((r) => { setVms(r.vms); if (r.vms[0]) setVm(r.vms[0].name); }).catch(() => {});
  }, [open]);

  const save = async () => {
    if (!net || !vm) { setError('VM wählen'); return; }
    setLoading(true); setError('');
    try { await api.vmNetworks.attach(net.name, vm); onDone(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  };

  return (
    <Modal open={open} title={`VM anhängen → ${net?.name ?? ''}`} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>Abbrechen</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Anhängen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">Virtuelle Maschine</label>
        <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
          {vms.length === 0 && <option value="">Keine VMs</option>}
          {vms.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
        </select>
        <div className="form-hint">Hängt eine virtio-Netzwerkkarte an (config + live).</div></div>
    </Modal>
  );
}

function VmNetworksView() {
  const [networks, setNetworks] = useState<VmNetwork[]>([]);
  const [available, setAvailable] = useState(true);
  const [message, setMessage] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [attachNet, setAttachNet] = useState<VmNetwork | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    const res = await api.vmNetworks.list();
    setNetworks(res.networks); setAvailable(res.available); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const act = async (name: string, fn: () => Promise<unknown>, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy((b) => ({ ...b, [name]: true }));
    try { await fn(); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy((b) => { const n = { ...b }; delete n[name]; return n; }); }
  };

  if (!available) {
    return (
      <div className="empty-state">
        <div className="empty-state__icon"><MonitorPlay size={44} strokeWidth={1} /></div>
        <div className="empty-state__title">libvirt nicht installiert</div>
        <div className="empty-state__desc">{message}<br /><br /><code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, background: 'var(--color-surface-sunken)', padding: '4px 8px', borderRadius: 6 }}>sudo apt install qemu-kvm libvirt-daemon-system</code></div>
      </div>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> VM-Netzwerk</button>
      </div>
      {networks.length === 0 ? (
        <div className="empty-state"><div className="empty-state__desc">Keine VM-Netzwerke. Erstelle eins mit dem Button oben.</div></div>
      ) : (
        <Panel title="libvirt-Netzwerke" icon={<Network size={15} />} subtitle={`${networks.length}`} storageKey="vmnets">
          <table className="dtable" style={{ marginTop: 6 }}>
            <thead><tr><th>Name</th><th>Modus</th><th>Bridge</th><th>Status</th><th>Autostart</th><th style={{ width: 150 }}></th></tr></thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.name}>
                  <td style={{ fontWeight: 600 }}>{n.name}</td>
                  <td><span className="badge badge--paused">{n.forward}</span></td>
                  <td className="dtable__mono text-muted">{n.bridge || '—'}</td>
                  <td><span className={`badge badge--${n.active ? 'running' : 'stopped'}`}><span className="badge__dot" />{n.active ? 'aktiv' : 'gestoppt'}</span></td>
                  <td>{n.autostart ? <Star size={13} fill="var(--color-warning)" color="var(--color-warning)" /> : '—'}</td>
                  <td>
                    <div className="dtable__actions">
                      <button className="btn btn--ghost btn--icon btn--sm" title="VM anhängen" onClick={() => setAttachNet(n)}><Link size={12} /></button>
                      {n.active
                        ? <button className="btn btn--ghost btn--icon btn--sm" title="Stoppen" disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.stop(n.name))}><Square size={12} /></button>
                        : <button className="btn btn--ghost btn--icon btn--sm" title="Starten" disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.start(n.name))}><Play size={12} /></button>}
                      <button className="btn btn--ghost btn--icon btn--sm" title="Autostart umschalten" disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.autostart(n.name))} style={n.autostart ? { color: 'var(--color-warning)' } : undefined}><Star size={12} /></button>
                      <button className="btn btn--danger btn--icon btn--sm" title="Löschen" disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.remove(n.name), `VM-Netzwerk "${n.name}" löschen?`)}><Trash2 size={12} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      <CreateVmNetModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} />
      <AttachVmModal net={attachNet} open={!!attachNet} onClose={() => setAttachNet(null)} onDone={load} />
    </>
  );
}

const DRIVER_BADGE: Record<string, string> = { macvlan: 'running', ipvlan: 'restarting', bridge: 'paused', host: 'paused', overlay: 'stopped' };

function VirtualIpsPanel() {
  const [entries, setEntries] = useState<ContainerNetworkEntry[]>([]);
  const [vmEntries, setVmEntries] = useState<VmIpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'macvlan' | 'ipvlan' | 'bridge'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.containers.virtualIps();
      setEntries(r.entries);
      setVmEntries(r.vmEntries);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = entries.filter((e) => filter === 'all' || e.driver === filter);
  const drivers = [...new Set(entries.map((e) => e.driver))].filter((d) => ['macvlan', 'ipvlan', 'bridge'].includes(d));

  return (
    <Panel title="Virtuelle IPs — Übersicht" icon={<Network size={15} />} storageKey="vips-panel">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="filter-tabs" style={{ margin: 0 }}>
          <button className={`filter-tab${filter === 'all' ? ' filter-tab--active' : ''}`} onClick={() => setFilter('all')}>Alle</button>
          {drivers.map((d) => (
            <button key={d} className={`filter-tab${filter === d ? ' filter-tab--active' : ''}`} onClick={() => setFilter(d as typeof filter)}>{d}</button>
          ))}
        </div>
        <button className="btn btn--ghost btn--sm" style={{ marginLeft: 'auto' }} onClick={load} disabled={loading}>
          {loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <RefreshCw size={12} />} Aktualisieren
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 32 }}><span className="spinner" style={{ width: 24, height: 24 }} /></div>
      ) : filtered.length === 0 && vmEntries.length === 0 ? (
        <div className="empty-state" style={{ padding: '32px 20px' }}>
          <div className="empty-state__icon"><Network size={36} strokeWidth={1.2} /></div>
          <div className="empty-state__title">Keine Einträge</div>
          <div className="empty-state__desc">
            Noch kein Container mit einem benutzerdefinierten Netzwerk verbunden.<br />
            Für eine echte LAN-IP: erst ein <b>macvlan</b>- oder <b>ipvlan</b>-Netzwerk anlegen (Docker-Tab), dann im Container-Bearbeiten-Dialog das Netzwerk hinzufügen.
          </div>
        </div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th>Container</th>
                  <th>Netzwerk</th>
                  <th>Treiber</th>
                  <th>IP-Adresse</th>
                  <th>MAC</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{e.containerName}</td>
                    <td>{e.networkName}</td>
                    <td><span className={`badge badge--${DRIVER_BADGE[e.driver] ?? 'paused'}`}>{e.driver}</span></td>
                    <td className="dtable__mono" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{e.ipv4 ? e.ipv4.replace(/\/\d+$/, '') : '—'}</td>
                    <td className="dtable__mono text-muted" style={{ fontSize: 11 }}>{e.mac || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vmEntries.length > 0 && (
            <>
              <div style={{ margin: '16px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Virtuelle Maschinen (DHCP-Leases)</div>
              <div className="table-scroll">
                <table className="dtable">
                  <thead><tr><th>VM / Hostname</th><th>IP-Adresse</th><th>MAC</th><th>Netzwerk</th></tr></thead>
                  <tbody>
                    {vmEntries.map((v, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: 600 }}>{v.vmName}</td>
                        <td className="dtable__mono" style={{ color: 'var(--color-accent)', fontWeight: 600 }}>{v.ipv4}</td>
                        <td className="dtable__mono text-muted" style={{ fontSize: 11 }}>{v.mac}</td>
                        <td className="text-muted">{v.networkName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

type NetTab = 'docker' | 'vm' | 'firewall' | 'connections' | 'vips';

export function Networks() {
  const [view, setView] = useState<NetTab>('docker');
  const [networks, setNetworks] = useState<DockerNetwork[]>([]);
  const [interfaces, setInterfaces] = useState<HostInterface[]>([]);
  const [containers, setContainers] = useState<Container[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectNet, setConnectNet] = useState<DockerNetwork | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [n, i, c] = await Promise.allSettled([api.networks.list(), api.networks.interfaces(), api.containers.list()]);
      if (n.status === 'fulfilled') setNetworks(n.value.networks);
      if (i.status === 'fulfilled') setInterfaces(i.value.interfaces);
      if (c.status === 'fulfilled') setContainers(c.value.containers);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const removeNet = async (n: DockerNetwork) => {
    if (!confirm(`Netzwerk "${n.name}" löschen?`)) return;
    try { await api.networks.remove(n.id); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };
  const disconnect = async (n: DockerNetwork, container: string) => {
    try { await api.networks.disconnect(n.id, container); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
  };

  return (
    <>
      <Topbar
        title="Netzwerke & VLANs"
        subtitle={`${networks.length} Docker-Netzwerke`}
        onRefresh={load}
        refreshing={refreshing}
        actions={view === 'docker' && <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> Netzwerk</button>}
      />
      <main className="page">
        <div className="filter-tabs">
          <button className={`filter-tab${view === 'docker' ? ' filter-tab--active' : ''}`} onClick={() => setView('docker')}>Docker</button>
          <button className={`filter-tab${view === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setView('vm')}>VMs</button>
          <button className={`filter-tab${view === 'firewall' ? ' filter-tab--active' : ''}`} onClick={() => setView('firewall')}>Firewall</button>
          <button className={`filter-tab${view === 'connections' ? ' filter-tab--active' : ''}`} onClick={() => setView('connections')}>Verbindungen</button>
          <button className={`filter-tab${view === 'vips' ? ' filter-tab--active' : ''}`} onClick={() => setView('vips')}>Virtuelle IPs</button>
        </div>

        {view === 'vm' && <VmNetworksView />}
        {view === 'firewall' && <FirewallPanel />}
        {view === 'connections' && <ConnectionsPanel />}
        {view === 'vips' && <VirtualIpsPanel />}
        {view === 'docker' && networks.map((n) => (
          <Panel
            key={n.id}
            title={n.name}
            icon={n.internal ? <Lock size={15} /> : <Network size={15} />}
            subtitle={
              <>
                <span className="badge badge--paused" style={{ marginRight: 6 }}>{n.driver}</span>
                {n.vlan && <span className="badge badge--restarting" style={{ marginRight: 6 }}><Cable size={10} /> VLAN {n.vlan}</span>}
                {n.internal && <span className="badge badge--dead" style={{ marginRight: 6 }}>isoliert</span>}
                {n.subnet && <span className="dtable__mono" style={{ fontSize: 11 }}>{n.subnet}</span>}
              </>
            }
            storageKey={`net-${n.name}`}
            defaultCollapsed={n.builtin}
            actions={
              !n.builtin && (
                <div style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button className="btn btn--ghost btn--sm" onClick={() => setConnectNet(n)}><Link2 size={12} /> Verbinden</button>
                  <button className="btn btn--danger btn--icon btn--sm" onClick={() => removeNet(n)}><Trash2 size={12} /></button>
                </div>
              )
            }
          >
            {n.containers.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '8px 0' }}>Keine Container verbunden.{n.gateway && ` Gateway: ${n.gateway}`}</div>
            ) : (
              <table className="dtable" style={{ marginTop: 6 }}>
                <thead><tr><th>Container</th><th>IP-Adresse</th><th>MAC</th><th style={{ width: 44 }}></th></tr></thead>
                <tbody>
                  {n.containers.map((c) => (
                    <tr key={c.container}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{c.ipv4 || '—'}</td>
                      <td className="dtable__mono text-muted">{c.mac || '—'}</td>
                      <td>{!n.builtin && <button className="btn btn--ghost btn--icon btn--sm" title="Trennen" onClick={() => disconnect(n, c.container)}><Unlink size={12} /></button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        ))}
      </main>

      <CreateNetModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} interfaces={interfaces} />
      <ConnectModal net={connectNet} open={!!connectNet} onClose={() => setConnectNet(null)} onDone={load} containers={containers} />
    </>
  );
}
