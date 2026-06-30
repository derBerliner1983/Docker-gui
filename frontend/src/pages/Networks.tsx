import { useState, useEffect, useCallback, useRef } from 'react';
import { Network, Plus, Trash2, Shield, Link2, Unlink, Lock, Cable, MonitorPlay, Play, Square, Star, Link, Pencil, RefreshCw, X, Activity, Download, AlertTriangle, ShieldPlus, Server, Globe, Box, LayoutGrid, Table } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { useT, tt } from '../lib/i18n';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import { usePrefs } from '../lib/prefs';
import { portInfo } from '../lib/utils';
import type { DockerNetwork, HostInterface, FirewallRule, FirewallDisabledRule, FirewallLogEntry, Container, VmNetwork, VM, ContainerNetworkEntry, VmIpEntry } from '../lib/types';

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
    <Modal open={open} title={tt('Neues Netzwerk')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">{tt('Name')}</label>
          <input className="input input--rect" placeholder={tt('dmz-netz')} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Treiber')}</label>
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
          <div className="form-group"><label className="form-label">{tt('Eltern-Schnittstelle')}</label>
            <select className="input input--rect" value={parent} onChange={(e) => setParent(e.target.value)} style={{ cursor: 'pointer' }}>
              <option value="">{tt('— wählen —')}</option>
              {interfaces.map((i) => <option key={i.iface} value={i.iface}>{i.iface} ({i.ip4 || 'keine IP'})</option>)}
            </select></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder={tt('z.B. 100')} value={vlan} onChange={(e) => setVlan(e.target.value)} />
            <div className="form-hint">Erzeugt Tag {parent || 'ethX'}.{vlan || 'ID'}</div></div>
        </div>
      )}
      <label className="legend__item" style={{ cursor: 'pointer', marginTop: 4 }}>
        <Switch checked={internal} onChange={setInternal} />
        <span><Lock size={12} style={{ display: 'inline', verticalAlign: 'middle' }} /> <b>Isoliert (internal)</b> — <span className="text-muted">{tt('kein Zugriff nach außen, sichert unsichere Container ab')}</span></span>
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
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Verbinden
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Container')}</label>
        <select className="input input--rect" value={container} onChange={(e) => setContainer(e.target.value)} style={{ cursor: 'pointer' }}>
          {containers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></div>
      <div className="form-group"><label className="form-label">Feste IP (optional)</label>
        <input className="input input--rect" placeholder={net?.subnet ? net.subnet.replace(/0\/\d+$/, '50') : '192.168.50.50'} value={ip} onChange={(e) => setIp(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
        <div className="form-hint">Muss im Subnetz {net?.subnet || '—'} liegen.</div></div>
      <div className="form-group"><label className="form-label">Alias-Namen / weitere IPs (Komma-getrennt)</label>
        <input className="input input--rect" placeholder={tt('web, api, db')} value={aliases} onChange={(e) => setAliases(e.target.value)} /></div>
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

function FirewallPanel() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
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
    if (!form.port && !form.from) { alert(tt('Port oder Quell-IP angeben')); return; }
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
    if (!confirm(tt('Regel löschen?'))) return;
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
    if (!confirm(tt('Deaktivierte Regel endgültig verwerfen?'))) return;
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
      title={tt('Firewall (ufw)')}
      icon={<Shield size={15} />}
      subtitle={available ? (active ? 'aktiv' : 'inaktiv') : 'nicht installiert'}
      storageKey="firewall"
      defaultCollapsed
      actions={available && (
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Switch checked={active} onChange={async (v) => {
            if (v) {
              const ok = confirm(
                'Firewall aktivieren?\n\n' +
                'SSH (Port 22) und Web-UI (Port 443) werden – falls noch keine Regel existiert – ' +
                'automatisch NUR für dein lokales Netz (LAN) freigegeben, niemals fürs Internet. ' +
                'Alle anderen Ports musst du selbst freischalten.'
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
            <input className="input input--rect" placeholder={tt('Name (optional)')} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} style={{ width: 150 }} title={tt('Name / Bezeichnung der Regel')} />
            <select className="input input--rect" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'allow' })} style={{ width: 92, cursor: 'pointer' }} title={tt('Aktion')}>
              <option value="allow">allow</option><option value="deny">deny</option><option value="reject">reject</option>
            </select>
            <select className="input input--rect" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 152, cursor: 'pointer' }} title={tt('Richtung – Beide legt je eine Regel für ein- und ausgehend an')}>
              <option value="">{tt('Richtung: –')}</option><option value="in">Eingehend (in)</option><option value="out">Ausgehend (out)</option><option value="both">Beide (ein + aus)</option>
            </select>
            <input className="input input--rect" placeholder={tt('Port (z.B. 443)')} value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 110 }} />
            <select className="input input--rect" value={form.proto} onChange={(e) => setForm({ ...form, proto: e.target.value })} style={{ width: 86, cursor: 'pointer' }}>
              <option value="">tcp+udp</option><option value="tcp">tcp</option><option value="udp">udp</option>
            </select>
            <input className="input input--rect" placeholder={tt('von IP(s), mit Komma trennen')} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 200, fontFamily: 'var(--font-mono)' }} title={tt('Mehrere Quell-Adressen mit Komma/Leerzeichen trennen → je eine Regel')} />
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy}>
              {editNum !== null ? <><Pencil size={13} /> {tt('Speichern')}</> : <><Plus size={13} /> {tt('Regel')}</>}
            </button>
            {editNum !== null && <button className="btn btn--ghost btn--sm" onClick={cancelEdit}><X size={13} /> {tt('Abbrechen')}</button>}
          </div>

          {(rules.length > 0 || disabled.length > 0) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 10px' }}>
              <input className="input input--rect" placeholder={tt('Regeln filtern (Name, Port, IP …)')} value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 260 }} />
              {filter && <button className="btn btn--ghost btn--sm" onClick={() => setFilter('')}><X size={12} /></button>}
              <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{shownRules.length} aktiv{disabled.length ? ` · ${shownDisabled.length} deaktiviert` : ''}</span>
            </div>
          )}

          {rules.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>{tt('Keine Regeln.')}</div>
          ) : (
            <table className="dtable">
              <thead><tr><th style={{ width: 30 }}>#</th><th>{tt('Name')}</th><th>{tt('Ziel')}</th><th>{tt('Aktion')}</th><th>{tt('Richtung')}</th><th>{tt('Von')}</th><th style={{ width: 56 }}>{tt('Aktiv')}</th><th style={{ width: 70 }}></th></tr></thead>
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
                        <button className="btn btn--ghost btn--icon btn--sm" title={tt('Bearbeiten')} onClick={() => startEdit(r)}><Pencil size={12} /></button>
                        <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} onClick={() => del(r.num)}><Trash2 size={12} /></button>
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
                      <td style={{ width: 40 }}><button className="btn btn--danger btn--icon btn--sm" title={tt('Verwerfen')} onClick={() => discardDisabled(d.id)}><Trash2 size={12} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
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
    <Modal open={open} title={tt('Firewall-Regel aus Verbindung erstellen')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
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
          <label className="form-label">{tt('Aktion')}</label>
          <select className="input input--rect" value={action} onChange={(e) => setAction(e.target.value as 'allow' | 'deny' | 'reject')} style={{ cursor: 'pointer' }}>
            <option value="allow">Erlauben (allow)</option>
            <option value="deny">Blockieren (deny)</option>
            <option value="reject">Ablehnen (reject)</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Richtung')}</label>
          <select className="input input--rect" value={direction} onChange={(e) => setDirection(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="in">Eingehend (in)</option>
            <option value="out">Ausgehend (out)</option>
            <option value="both">Beide (ein + aus)</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Von IP (Quelle)</label>
        <input className="input input--rect" value={from} onChange={(e) => setFrom(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder={tt('leer = alle Quellen')} />
      </div>
      <div className="form-row">
        <div className="form-group">
          <label className="form-label">{tt('Ziel-Port')}</label>
          <input className="input input--rect" value={port} onChange={(e) => setPort(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} placeholder={tt('z.B. 443')} />
        </div>
        <div className="form-group">
          <label className="form-label">{tt('Protokoll')}</label>
          <select className="input input--rect" value={proto} onChange={(e) => setProto(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="">tcp+udp</option>
            <option value="tcp">tcp</option>
            <option value="udp">udp</option>
          </select>
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">Name / Bezeichnung (optional)</label>
        <input className="input input--rect" value={comment} onChange={(e) => setComment(e.target.value)} placeholder={tt('z.B. Heimnetz erlauben')} />
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
    if (!confirm(tt('Das gesamte Verbindungsprotokoll löschen?'))) return;
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
      title={tt('Verbindungsversuche')}
      icon={<Activity size={15} />}
      subtitle={available ? `${total} im Protokoll · ${blocked} blockiert (geladen)` : 'nicht verfügbar'}
      storageKey="fw-connections"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>{tt('Protokollierung')}</span>
          <Switch checked={logging} onChange={toggleLogging} />
          {logging && (
            <select className="input input--rect" value={level} onChange={(e) => void changeLevel(e.target.value)} style={{ width: 188, cursor: 'pointer', fontSize: 12 }} title={tt('Logging-Stufe – ab Mittel werden auch erlaubte Verbindungen protokolliert')}>
              <option value="low">Stufe: Niedrig (nur blockiert)</option>
              <option value="medium">Stufe: Mittel (auch erlaubt)</option>
              <option value="high">Stufe: Hoch (alles)</option>
              <option value="full">Stufe: Voll (alles, ungedrosselt)</option>
            </select>
          )}
          <button className="btn btn--ghost btn--icon btn--sm" title={tt('Aktualisieren')} onClick={() => void load()}>
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
              ℹ Auf Stufe <b>{tt('Niedrig')}</b> protokolliert ufw nur <b>blockierte</b> {tt('Pakete – deshalb siehst du hier nur')} <b>BLOCK</b>.
              Stelle die Stufe oben rechts auf <b>{tt('Mittel')}</b> (oder höher), damit auch <b>erlaubte</b> Verbindungen (ALLOW) erscheinen.
              <span style={{ color: 'var(--color-muted)' }}> {tt('Hinweis: Höhere Stufen erzeugen deutlich mehr Logeinträge.')}</span>
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 10px' }}>
            <select className="input input--rect" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as 'all')} style={{ width: 150, cursor: 'pointer' }}>
              <option value="all">{tt('Alle Aktionen')}</option><option value="BLOCK">{tt('Nur blockiert')}</option><option value="ALLOW">{tt('Nur erlaubt')}</option>
            </select>
            <select className="input input--rect" value={dirFilter} onChange={(e) => setDirFilter(e.target.value as 'all')} style={{ width: 140, cursor: 'pointer' }}>
              <option value="all">{tt('Beide Richtungen')}</option><option value="IN">{tt('Eingehend')}</option><option value="OUT">{tt('Ausgehend')}</option>
            </select>
            <input className="input input--rect" placeholder={tt('Filter: IP, Port, Protokoll…')} value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 200, fontFamily: 'var(--font-mono)' }} />
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
                  <th style={{ width: 30 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} title={tt('Alle (angezeigten) auswählen')} /></th>
                  <th>{tt('Zeit')}</th><th>{tt('Aktion')}</th><th>{tt('Richtung')}</th><th>{tt('Quell-IP')}</th><th>{tt('Ziel-Port')}</th><th>{tt('Dienst')}</th><th>{tt('Protokoll')}</th><th>{tt('Schnittstelle')}</th><th style={{ width: 44 }}></th>
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
                            title={tt('Firewall-Regel aus dieser Verbindung erstellen')}
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
    <Modal open={open} title={tt('Neues VM-Netzwerk')} onClose={onClose}
      footer={<>
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Erstellen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-row">
        <div className="form-group"><label className="form-label">{tt('Name')}</label>
          <input className="input input--rect" placeholder={tt('vm-dmz')} value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="form-group"><label className="form-label">{tt('Modus')}</label>
          <select className="input input--rect" value={mode} onChange={(e) => setMode(e.target.value)} style={{ cursor: 'pointer' }}>
            <option value="nat">NAT (Internet über Host)</option>
            <option value="isolated">Isoliert (kein Außenzugriff)</option>
            <option value="bridge">Bridge (direkt im LAN)</option>
          </select></div>
      </div>
      {mode !== 'bridge' ? (
        <div className="form-group"><label className="form-label">{tt('Subnetz')}</label>
          <input className="input input--rect" placeholder="192.168.123.0" value={subnet} onChange={(e) => setSubnet(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          <div className="form-hint">DHCP wird automatisch eingerichtet (.2–.254).</div></div>
      ) : (
        <div className="form-row">
          <div className="form-group"><label className="form-label">{tt('Host-Bridge')}</label>
            <input className="input input--rect" placeholder={tt('br0')} value={bridge} onChange={(e) => setBridge(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} /></div>
          <div className="form-group"><label className="form-label">VLAN-ID (optional)</label>
            <input className="input input--rect" placeholder={tt('z.B. 100')} value={vlan} onChange={(e) => setVlan(e.target.value)} /></div>
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
        <button className="btn btn--ghost btn--sm" onClick={onClose}>{tt('Abbrechen')}</button>
        <button className="btn btn--primary btn--sm" onClick={save} disabled={loading}>
          {loading && <span className="spinner" style={{ width: 12, height: 12 }} />} Anhängen
        </button>
      </>}>
      {error && <div className="login-error">{error}</div>}
      <div className="form-group"><label className="form-label">{tt('Virtuelle Maschine')}</label>
        <select className="input input--rect" value={vm} onChange={(e) => setVm(e.target.value)} style={{ cursor: 'pointer' }}>
          {vms.length === 0 && <option value="">{tt('Keine VMs')}</option>}
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
        <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> {tt('VM-Netzwerk')}</button>
      </div>
      {networks.length === 0 ? (
        <div className="empty-state"><div className="empty-state__desc">{tt('Keine VM-Netzwerke. Erstelle eins mit dem Button oben.')}</div></div>
      ) : (
        <Panel title={tt('libvirt-Netzwerke')} icon={<Network size={15} />} subtitle={`${networks.length}`} storageKey="vmnets">
          <table className="dtable" style={{ marginTop: 6 }}>
            <thead><tr><th>{tt('Name')}</th><th>{tt('Modus')}</th><th>{tt('Bridge')}</th><th>{tt('Status')}</th><th>{tt('Autostart')}</th><th style={{ width: 150 }}></th></tr></thead>
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
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('VM anhängen')} onClick={() => setAttachNet(n)}><Link size={12} /></button>
                      {n.active
                        ? <button className="btn btn--ghost btn--icon btn--sm" title={tt('Stoppen')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.stop(n.name))}><Square size={12} /></button>
                        : <button className="btn btn--ghost btn--icon btn--sm" title={tt('Starten')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.start(n.name))}><Play size={12} /></button>}
                      <button className="btn btn--ghost btn--icon btn--sm" title={tt('Autostart umschalten')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.autostart(n.name))} style={n.autostart ? { color: 'var(--color-warning)' } : undefined}><Star size={12} /></button>
                      <button className="btn btn--danger btn--icon btn--sm" title={tt('Löschen')} disabled={busy[n.name]} onClick={() => act(n.name, () => api.vmNetworks.remove(n.name), `VM-Netzwerk "${n.name}" löschen?`)}><Trash2 size={12} /></button>
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
    <Panel title={tt('Virtuelle IPs — Übersicht')} icon={<Network size={15} />} storageKey="vips-panel">
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div className="filter-tabs" style={{ margin: 0 }}>
          <button className={`filter-tab${filter === 'all' ? ' filter-tab--active' : ''}`} onClick={() => setFilter('all')}>{tt('Alle')}</button>
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
          <div className="empty-state__title">{tt('Keine Einträge')}</div>
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
                  <th>{tt('Container')}</th>
                  <th>{tt('Netzwerk')}</th>
                  <th>{tt('Treiber')}</th>
                  <th>{tt('IP-Adresse')}</th>
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
                  <thead><tr><th>{tt('VM / Hostname')}</th><th>{tt('IP-Adresse')}</th><th>MAC</th><th>{tt('Netzwerk')}</th></tr></thead>
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

// ── Konnektivität: Wer kann wen erreichen (aus Docker-Netzwerk-Zugehörigkeit) ──
function ConnectivityPanel({ networks, containers }: { networks: DockerNetwork[]; containers: Container[] }) {
  type Mem = { net: string; driver: string; internal: boolean; ip: string };
  const memberships = new Map<string, Mem[]>();
  const allNames = new Set<string>();
  for (const n of networks) {
    if (n.name === 'none') continue;
    for (const c of n.containers) {
      if (!memberships.has(c.name)) memberships.set(c.name, []);
      memberships.get(c.name)!.push({ net: n.name, driver: n.driver, internal: n.internal, ip: (c.ipv4 || '').replace(/\/\d+$/, '') });
      allNames.add(c.name);
    }
  }
  const names = [...allNames].sort();

  // Veröffentlichte Host-Ports je Container (aus "0.0.0.0:8080->80/tcp")
  const pub = new Map<string, string[]>();
  for (const c of containers) {
    const ps = (c.ports || []).filter((p) => p.includes('->')).map((p) => p.split('->')[0].split(':').pop() || '').filter(Boolean);
    if (ps.length) pub.set(c.name, [...new Set(ps)]);
  }

  const sharesNet = (a: string, b: string) => {
    const ma = memberships.get(a) || [], mb = memberships.get(b) || [];
    return ma.some((x) => mb.some((y) => y.net === x.net));
  };
  const hostReaches = (a: string) =>
    (memberships.get(a) || []).some((m) => m.driver === 'host' || (m.driver === 'bridge' && !m.internal)) || (pub.get(a)?.length ?? 0) > 0;
  const lanReaches = (a: string) =>
    (memberships.get(a) || []).some((m) => m.driver === 'macvlan' || m.driver === 'ipvlan') || (pub.get(a)?.length ?? 0) > 0;

  const cell = (ok: boolean, self = false) => self
    ? <span style={{ color: 'var(--color-faint)' }}>—</span>
    : ok ? <span style={{ color: 'var(--color-success)', fontWeight: 700 }}>✓</span>
         : <span style={{ color: 'var(--color-faint)' }}>✕</span>;

  const named = networks.filter((n) => n.name !== 'none');

  return (
    <Panel title={tt('Konnektivität – wer erreicht wen')} icon={<Network size={15} />} storageKey="net-connectivity">
      <div style={{ fontSize: 12, color: 'var(--color-muted)', margin: '6px 0 14px', lineHeight: 1.6 }}>
        {tt('Zeigt, wer wen technisch erreichen kann (basierend auf Docker-Netzwerk-Zugehörigkeit). Container im selben Netzwerk erreichen sich gegenseitig.')}
      </div>

      {names.length === 0 ? (
        <div className="empty-state" style={{ padding: '28px 20px' }}><div className="empty-state__desc">{tt('Keine laufenden Container.')}</div></div>
      ) : (
        <>
          {/* Matrix */}
          <div className="table-scroll">
            <table className="dtable">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>{tt('Von ↓ / Ziel →')}</th>
                  {names.map((n) => <th key={n} style={{ fontSize: 11 }}>{n}</th>)}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontWeight: 600 }}>🖥 {tt('Host')}</td>
                  {names.map((n) => <td key={n} style={{ textAlign: 'center' }}>{cell(hostReaches(n))}</td>)}
                </tr>
                <tr>
                  <td style={{ fontWeight: 600 }}>🌐 LAN / Router</td>
                  {names.map((n) => <td key={n} style={{ textAlign: 'center' }}>{cell(lanReaches(n))}</td>)}
                </tr>
                {names.map((from) => (
                  <tr key={from}>
                    <td style={{ fontWeight: 600 }}>📦 {from}</td>
                    {names.map((to) => <td key={to} style={{ textAlign: 'center' }}>{cell(from === to ? false : sharesNet(from, to), from === to)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Netzwerk-Gruppen */}
          <div style={{ margin: '18px 0 8px', fontSize: 12, fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{tt('Netzwerke & Mitglieder')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {named.map((n) => (
              <div key={n.id} style={{ flex: '1 1 240px', minWidth: 220, border: '1px solid var(--color-border)', borderRadius: 8, padding: 10, background: 'var(--color-surface-sunken)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{n.name}</span>
                  <span className={`badge badge--${DRIVER_BADGE[n.driver] ?? 'paused'}`}>{n.driver}</span>
                  {n.internal && <span className="badge badge--dead">isoliert</span>}
                </div>
                {n.subnet && <div className="dtable__mono" style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 6 }}>{n.subnet}</div>}
                {n.containers.length === 0 ? (
                  <div className="text-muted" style={{ fontSize: 11.5 }}>{tt('Keine Mitglieder')}</div>
                ) : n.containers.map((c) => (
                  <div key={c.container} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '2px 0' }}>
                    <span>📦 {c.name}</span>
                    <span className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{(c.ipv4 || '').replace(/\/\d+$/, '') || '—'}</span>
                  </div>
                ))}
                {(n.driver === 'bridge' && !n.internal) && <div style={{ fontSize: 11, color: 'var(--color-success)', marginTop: 6 }}>🖥 {tt('vom Host erreichbar')}</div>}
                {(n.driver === 'macvlan' || n.driver === 'ipvlan') && <div style={{ fontSize: 11, color: 'var(--color-warning)', marginTop: 6 }}>🌐 {tt('LAN-erreichbar, vom Host NICHT')}</div>}
              </div>
            ))}
          </div>

          {/* Legende */}
          <div style={{ marginTop: 16, fontSize: 11.5, color: 'var(--color-faint)', lineHeight: 1.7 }}>
            <b>{tt('Legende')}:</b> ✓ = {tt('kann erreichen')} · ✕ = {tt('kein Weg')} · {tt('Container im selben Netzwerk erreichen sich auf ihren internen Ports')}.<br />
            🖥 {tt('Host')}: {tt('erreicht Bridge-Container & veröffentlichte Ports, aber KEINE Macvlan-IPs')} · 🌐 LAN: {tt('erreicht Macvlan-IPs & veröffentlichte Host-Ports')}.
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Firewall-/Netzwerk-Studio: frei anordbare Karte (Phase A) ────────────────
interface StudioNode { id: string; kind: 'host' | 'zone' | 'docker' | 'vm'; label: string; sub?: string; ip?: string; ports?: string[]; nets?: { net: string; driver: string }[]; }
const NODE_W = 190, NODE_H = 58;

function FirewallStudio({ networks, containers, onChanged }: { networks: DockerNetwork[]; containers: Container[]; onChanged?: () => void }) {
  const { prefs, setPref } = usePrefs();
  const layout = (prefs.fwStudio as { nodes?: Record<string, { x: number; y: number }>; sub?: string }) || {};
  const saved = layout.nodes || {};
  const [sub, setSub] = useState<'map' | 'matrix'>(layout.sub === 'matrix' ? 'matrix' : 'map');
  const [vms, setVms] = useState<VM[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, { x: number; y: number }>>({});
  const canvasRef = useRef<HTMLDivElement>(null);
  // gx/gy = Greif-Offset innerhalb des Knotens; cl/ct = Canvas-Ursprung beim Greifen
  const drag = useRef<{ id: string; gx: number; gy: number; cl: number; ct: number; moved: boolean } | null>(null);
  // Regel-Formular (Phase B – sichere ufw-Ebene)
  const [rPort, setRPort] = useState('');
  const [rSrc, setRSrc] = useState<'lan' | 'internet' | 'ip'>('lan');
  const [rIp, setRIp] = useState('');
  const [rAct, setRAct] = useState<'allow' | 'deny'>('allow');
  const [rBusy, setRBusy] = useState(false);
  const [rMsg, setRMsg] = useState('');
  // Verbinden zweier Container (Docker-Netz-Trennung)
  const [linkTo, setLinkTo] = useState('');
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkMsg, setLinkMsg] = useState('');

  useEffect(() => { api.vms.list().then((r) => setVms(r.vms || [])).catch(() => {}); }, []);
  // Beim Wechsel des ausgewählten Knotens das Formular zurücksetzen
  useEffect(() => { setRPort(''); setRSrc('lan'); setRIp(''); setRAct('allow'); setRMsg(''); setLinkTo(''); setLinkMsg(''); }, [sel]);

  const doLink = async (a: string, b: string, connect: boolean) => {
    if (!b) { setLinkMsg(tt('Bitte einen Ziel-Container wählen.')); return; }
    setLinkBusy(true); setLinkMsg('');
    try {
      if (connect) { await api.networks.link(a, b); setLinkMsg(tt('Verbunden – beide teilen jetzt ein eigenes Netz.')); }
      else { await api.networks.unlink(a, b); setLinkMsg(tt('Verbindung getrennt.')); }
      onChanged?.();
    } catch (e) { setLinkMsg(e instanceof Error ? e.message : 'Fehler'); }
    finally { setLinkBusy(false); }
  };

  const LAN_RANGES = '192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12';
  const addRule = async (defaultPort: string) => {
    const port = (rPort || defaultPort).replace(/[^0-9]/g, '');
    if (!port) { setRMsg(tt('Bitte einen Port angeben.')); return; }
    if (rSrc === 'ip' && !/^\d{1,3}(\.\d{1,3}){3}(\/\d+)?$/.test(rIp.trim())) { setRMsg(tt('Bitte eine gültige IP/CIDR angeben.')); return; }
    const from = rSrc === 'lan' ? LAN_RANGES : rSrc === 'ip' ? rIp.trim() : undefined;
    setRBusy(true); setRMsg('');
    try {
      await api.firewall.add({ action: rAct, port, proto: 'tcp', from });
      setRMsg(tt('Regel angelegt.') + (from ? '' : ' ' + tt('(von überall – auch Internet!)')));
    } catch (e) {
      setRMsg(e instanceof Error ? e.message : 'Fehler');
    } finally { setRBusy(false); }
  };

  // ── Modell aufbauen ──
  const membership = new Map<string, { net: string; driver: string; internal: boolean; ip: string }[]>();
  for (const n of networks) {
    if (n.name === 'none') continue;
    for (const c of n.containers) {
      if (!membership.has(c.name)) membership.set(c.name, []);
      membership.get(c.name)!.push({ net: n.name, driver: n.driver, internal: n.internal, ip: (c.ipv4 || '').replace(/\/\d+$/, '') });
    }
  }
  const pubByName = new Map<string, string[]>();
  for (const c of containers) {
    const ps = (c.ports || []).filter((p) => p.includes('->')).map((p) => p.split('->')[0].split(':').pop() || '').filter(Boolean);
    if (ps.length) pubByName.set(c.name, [...new Set(ps)]);
  }
  const dockerNames = [...new Set(networks.flatMap((n) => n.name === 'none' ? [] : n.containers.map((c) => c.name)))];
  const tunnel = containers.find((c) => /newt|pangolin|wireguard|tailscale|wg-easy|zerotier/i.test(`${c.name} ${c.image}`));

  const nodes: StudioNode[] = [
    { id: 'zone:wan', kind: 'zone', label: 'Internet', sub: 'WAN' },
    { id: 'zone:lan', kind: 'zone', label: 'LAN', sub: tt('Lokales Netz') },
    ...(tunnel ? [{ id: 'zone:tunnel', kind: 'zone' as const, label: 'Tunnel', sub: tunnel.name }] : []),
    { id: 'host', kind: 'host', label: 'Host', sub: tt('Server') },
    ...dockerNames.map((name) => {
      const m = membership.get(name) || [];
      const ip = m.find((x) => x.driver === 'macvlan' || x.driver === 'ipvlan')?.ip || m[0]?.ip;
      return { id: `docker:${name}`, kind: 'docker' as const, label: name, ip, ports: pubByName.get(name), nets: m.map((x) => ({ net: x.net, driver: x.driver })) };
    }),
    ...vms.map((v) => ({ id: `vm:${v.id}`, kind: 'vm' as const, label: v.name, sub: v.state })),
  ];

  // Standard-Layout, falls keine gespeicherte Position
  const defPos = (id: string, i: number): { x: number; y: number } => {
    if (id === 'zone:wan') return { x: 20, y: 20 };
    if (id === 'zone:lan') return { x: 20, y: 110 };
    if (id === 'zone:tunnel') return { x: 20, y: 200 };
    if (id === 'host') return { x: 280, y: 110 };
    const k = i; // dockers/vms rechts im Raster
    return { x: 540 + (k % 2) * 210, y: 20 + Math.floor(k / 2) * 90 };
  };
  let gi = 0;
  const sane = (p?: { x: number; y: number }) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 4000 && p.y >= 0 && p.y <= 4000 ? p : undefined;
  const posOf = (id: string): { x: number; y: number } => {
    const l = sane(live[id]); if (l) return l;
    const s = sane(saved[id]); if (s) return s;
    const isGrid = id.startsWith('docker:') || id.startsWith('vm:');
    return defPos(id, isGrid ? gi++ : 0);
  };
  // gi muss deterministisch sein → Positionen vorab berechnen
  const positions: Record<string, { x: number; y: number }> = {};
  gi = 0;
  for (const n of nodes) positions[n.id] = posOf(n.id);

  // ── Erreichbarkeits-Kanten ──
  const edges: [string, string][] = [];
  const sharesNet = (a: string, b: string) => {
    const ma = membership.get(a) || [], mb = membership.get(b) || [];
    return ma.some((x) => mb.some((y) => y.net === x.net));
  };
  edges.push(['zone:wan', 'host']);
  edges.push(['zone:lan', 'host']);
  if (tunnel) edges.push(['zone:tunnel', `docker:${tunnel.name}`]);
  for (const name of dockerNames) {
    const m = membership.get(name) || [];
    const hostReach = m.some((x) => x.driver === 'host' || (x.driver === 'bridge' && !x.internal)) || (pubByName.get(name)?.length ?? 0) > 0;
    const lanReach = m.some((x) => x.driver === 'macvlan' || x.driver === 'ipvlan') || (pubByName.get(name)?.length ?? 0) > 0;
    if (hostReach) edges.push(['host', `docker:${name}`]);
    if (lanReach) edges.push(['zone:lan', `docker:${name}`]);
  }
  for (let i = 0; i < dockerNames.length; i++)
    for (let j = i + 1; j < dockerNames.length; j++)
      if (sharesNet(dockerNames[i], dockerNames[j])) edges.push([`docker:${dockerNames[i]}`, `docker:${dockerNames[j]}`]);

  // ── Drag ──
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!drag.current) return;
      drag.current.moved = true;
      const d = drag.current;
      // Position relativ zum Canvas, abzüglich Greif-Offset
      setLive((l) => ({ ...l, [d.id]: { x: Math.max(0, (e.clientX - d.cl) - d.gx), y: Math.max(0, (e.clientY - d.ct) - d.gy) } }));
    };
    const up = () => {
      if (drag.current && drag.current.moved) {
        const id = drag.current.id;
        setLive((l) => {
          const p = l[id];
          if (p) setPref('fwStudio', { ...layout, nodes: { ...saved, [id]: p } });
          return l;
        });
      }
      drag.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [layout, saved, setPref]);

  const onDown = (e: React.MouseEvent, id: string) => {
    const p = positions[id];
    const c = canvasRef.current?.getBoundingClientRect();
    if (!c) return;
    // Greif-Offset = wo im Knoten gepackt wurde (Canvas-Koordinaten minus Knoten-Position)
    drag.current = { id, cl: c.left, ct: c.top, gx: (e.clientX - c.left) - p.x, gy: (e.clientY - c.top) - p.y, moved: false };
  };
  const onClickNode = (id: string) => { if (!drag.current?.moved) setSel((s) => (s === id ? null : id)); };

  const NODE_COLOR: Record<StudioNode['kind'], string> = {
    host: 'var(--color-accent)', zone: 'var(--color-warning)', docker: 'var(--color-info, #3b82f6)', vm: '#a855f7',
  };
  const NODE_ICON: Record<StudioNode['kind'], React.ElementType> = { host: Server, zone: Globe, docker: Box, vm: MonitorPlay };

  const maxY = Math.max(320, ...nodes.map((n) => positions[n.id].y + NODE_H + 120));

  return (
    <Panel title={tt('Firewall-Studio')} icon={<Network size={15} />} storageKey="fw-studio"
      actions={
        <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 4 }}>
          <button className={`btn btn--sm ${sub === 'map' ? 'btn--primary' : 'btn--outline'}`} onClick={() => { setSub('map'); setPref('fwStudio', { ...layout, sub: 'map' }); }}><LayoutGrid size={12} /> {tt('Karte')}</button>
          <button className={`btn btn--sm ${sub === 'matrix' ? 'btn--primary' : 'btn--outline'}`} onClick={() => { setSub('matrix'); setPref('fwStudio', { ...layout, sub: 'matrix' }); }}><Table size={12} /> {tt('Matrix')}</button>
        </div>
      }
    >
      {sub === 'matrix' ? (
        <div style={{ marginTop: 8 }}><ConnectivityPanel networks={networks} containers={containers} /></div>
      ) : (
        <>
          <div style={{ fontSize: 12, color: 'var(--color-muted)', margin: '6px 0 10px' }}>
            {tt('Objekte frei verschieben (gespeichert pro Benutzer). Klick öffnet/schließt die Details. Linien = wer kann wen erreichen.')}
          </div>
          <div ref={canvasRef} style={{ position: 'relative', minHeight: maxY, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-surface-sunken)', overflow: 'hidden' }}>
            {/* Kanten */}
            <svg style={{ position: 'absolute', inset: 0, width: '100%', height: maxY, pointerEvents: 'none' }}>
              {edges.map(([a, b], i) => {
                const pa = positions[a], pb = positions[b];
                if (!pa || !pb) return null;
                return <line key={i} x1={pa.x + NODE_W / 2} y1={pa.y + NODE_H / 2} x2={pb.x + NODE_W / 2} y2={pb.y + NODE_H / 2}
                  stroke="var(--color-accent)" strokeWidth={1.5} strokeOpacity={sel && sel !== a && sel !== b ? 0.12 : 0.4} />;
              })}
            </svg>
            {/* Knoten */}
            {nodes.map((n) => {
              const p = positions[n.id];
              const Icon = NODE_ICON[n.kind];
              const isSel = sel === n.id;
              return (
                <div key={n.id} style={{ position: 'absolute', left: p.x, top: p.y, width: NODE_W }}>
                  <div onMouseDown={(e) => onDown(e, n.id)} onClick={() => onClickNode(n.id)}
                    style={{ cursor: 'grab', userSelect: 'none', display: 'flex', alignItems: 'center', gap: 8, height: NODE_H, padding: '0 10px',
                      background: 'var(--color-surface)', border: `1px solid ${isSel ? NODE_COLOR[n.kind] : 'var(--color-border)'}`,
                      borderLeft: `3px solid ${NODE_COLOR[n.kind]}`, borderRadius: 8, boxShadow: isSel ? '0 0 0 2px var(--color-accent-soft)' : 'none' }}>
                    <Icon size={16} style={{ color: NODE_COLOR[n.kind], flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</div>
                      <div style={{ fontSize: 10.5, color: 'var(--color-faint)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.ip || n.sub || ''}</div>
                    </div>
                  </div>
                  {isSel && (
                    <div style={{ marginTop: 4, padding: 8, fontSize: 11.5, background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 8, lineHeight: 1.6 }}>
                      <div><span style={{ color: 'var(--color-faint)' }}>{tt('Typ')}: </span>{n.kind}</div>
                      {n.ip && <div><span style={{ color: 'var(--color-faint)' }}>IP: </span><span style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-accent)' }}>{n.ip}</span></div>}
                      {n.nets && n.nets.length > 0 && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Netzwerk')}: </span>{n.nets.map((x) => `${x.net} (${x.driver})`).join(', ')}</div>}
                      {n.ports && n.ports.length > 0 && <div><span style={{ color: 'var(--color-faint)' }}>{tt('Ports')}: </span>{n.ports.join(', ')}</div>}

                      {/* Regel anlegen – nur sinnvoll für Host & Container mit veröffentlichtem Port (ufw) */}
                      {(n.kind === 'host' || (n.ports && n.ports.length > 0)) ? (
                        <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                          style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ fontWeight: 600, color: 'var(--color-fg)' }}>{tt('Zugriff regeln')}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {(n.ports || []).map((p) => (
                              <button key={p} className={`btn btn--sm ${rPort === p ? 'btn--primary' : 'btn--outline'}`} style={{ padding: '1px 7px', fontSize: 11 }} onClick={() => setRPort(p)}>{p}</button>
                            ))}
                            <input className="input input--rect" style={{ width: 70, height: 26, fontSize: 11 }} placeholder={tt('Port')} value={rPort} onChange={(e) => setRPort(e.target.value)} />
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                            <select className="input input--rect" style={{ height: 26, fontSize: 11, flex: 1, minWidth: 90 }} value={rSrc} onChange={(e) => setRSrc(e.target.value as typeof rSrc)}>
                              <option value="lan">{tt('von LAN')}</option>
                              <option value="internet">{tt('von Internet')}</option>
                              <option value="ip">{tt('von IP')}</option>
                            </select>
                            <select className="input input--rect" style={{ height: 26, fontSize: 11, width: 84 }} value={rAct} onChange={(e) => setRAct(e.target.value as typeof rAct)}>
                              <option value="allow">{tt('erlauben')}</option>
                              <option value="deny">{tt('sperren')}</option>
                            </select>
                          </div>
                          {rSrc === 'ip' && <input className="input input--rect" style={{ height: 26, fontSize: 11, fontFamily: 'var(--font-mono)' }} placeholder="192.168.1.50" value={rIp} onChange={(e) => setRIp(e.target.value)} />}
                          <button className="btn btn--primary btn--sm" disabled={rBusy} onClick={() => addRule((n.ports || [])[0] || '')}>
                            {rBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Shield size={12} />} {tt('Regel anlegen')}
                          </button>
                          {rMsg && <div style={{ fontSize: 11, color: rMsg.includes('angelegt') ? 'var(--color-success)' : 'var(--color-warning)' }}>{rMsg}</div>}
                        </div>
                      ) : null}

                      {/* Container verbinden (Docker-Netz-Trennung) */}
                      {n.kind === 'docker' && (
                        <div onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                          style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div style={{ fontWeight: 600, color: 'var(--color-fg)' }}>{tt('Mit Container verbinden')}</div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <select className="input input--rect" style={{ height: 26, fontSize: 11, flex: 1, minWidth: 110 }} value={linkTo} onChange={(e) => setLinkTo(e.target.value)}>
                              <option value="">{tt('— Ziel-Container —')}</option>
                              {dockerNames.filter((d) => d !== n.label).map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <button className="btn btn--primary btn--sm" disabled={linkBusy || !linkTo} onClick={() => doLink(n.label, linkTo, true)}>
                              {linkBusy ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Link2 size={12} />} {tt('verbinden')}
                            </button>
                            <button className="btn btn--outline btn--sm" disabled={linkBusy || !linkTo} onClick={() => doLink(n.label, linkTo, false)}>
                              <Unlink size={12} /> {tt('trennen')}
                            </button>
                          </div>
                          <div style={{ fontSize: 10.5, color: 'var(--color-faint)' }}>{tt('Legt ein eigenes Netz nur für dieses Paar an – nichts anderes wird verändert.')}</div>
                          {linkMsg && <div style={{ fontSize: 11, color: linkMsg.includes('Verbun') || linkMsg.includes('getrennt') ? 'var(--color-success)' : 'var(--color-warning)' }}>{linkMsg}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-faint)', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--color-accent)' }}>● Host</span>
            <span style={{ color: 'var(--color-warning)' }}>● {tt('Zone (LAN/Internet/Tunnel)')}</span>
            <span style={{ color: 'var(--color-info, #3b82f6)' }}>● Docker</span>
            <span style={{ color: '#a855f7' }}>● VM</span>
          </div>
        </>
      )}
    </Panel>
  );
}

// Umschalter: Studio (Standard) ⟷ klassische ufw-Tabelle (pro Benutzer gespeichert)
function FirewallView({ networks, containers, onChanged }: { networks: DockerNetwork[]; containers: Container[]; onChanged?: () => void }) {
  const { prefs, setPref } = usePrefs();
  const mode = (prefs.fwView as 'studio' | 'table') || 'studio';
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        <button className={`btn btn--sm ${mode === 'studio' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setPref('fwView', 'studio')}>
          <LayoutGrid size={13} /> {tt('Studio')}
        </button>
        <button className={`btn btn--sm ${mode === 'table' ? 'btn--primary' : 'btn--outline'}`} onClick={() => setPref('fwView', 'table')}>
          <Table size={13} /> {tt('ufw-Tabelle')}
        </button>
      </div>
      {mode === 'studio' ? <FirewallStudio networks={networks} containers={containers} onChanged={onChanged} /> : <FirewallPanel />}
    </>
  );
}

type NetTab = 'docker' | 'vm' | 'firewall' | 'connections' | 'vips';

export function Networks() {
  const t = useT();
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
        title={t('nav.networks')}
        subtitle={t('page.networks.subtitle', { n: networks.length })}
        onRefresh={load}
        refreshing={refreshing}
        actions={view === 'docker' && <button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> {tt('Netzwerk')}</button>}
      />
      <main className="page">
        <div className="filter-tabs">
          <button className={`filter-tab${view === 'docker' ? ' filter-tab--active' : ''}`} onClick={() => setView('docker')}>{tt('Docker')}</button>
          <button className={`filter-tab${view === 'vm' ? ' filter-tab--active' : ''}`} onClick={() => setView('vm')}>VMs</button>
          <button className={`filter-tab${view === 'firewall' ? ' filter-tab--active' : ''}`} onClick={() => setView('firewall')}>{tt('Firewall')}</button>
          <button className={`filter-tab${view === 'connections' ? ' filter-tab--active' : ''}`} onClick={() => setView('connections')}>{tt('Verbindungen')}</button>
          <button className={`filter-tab${view === 'vips' ? ' filter-tab--active' : ''}`} onClick={() => setView('vips')}>{tt('Virtuelle IPs')}</button>
        </div>

        {view === 'vm' && <VmNetworksView />}
        {view === 'firewall' && <FirewallView networks={networks} containers={containers} onChanged={load} />}
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
                  <button className="btn btn--ghost btn--sm" onClick={() => setConnectNet(n)}><Link2 size={12} /> {tt('Verbinden')}</button>
                  <button className="btn btn--danger btn--icon btn--sm" onClick={() => removeNet(n)}><Trash2 size={12} /></button>
                </div>
              )
            }
          >
            {n.containers.length === 0 ? (
              <div className="text-muted text-sm" style={{ padding: '8px 0' }}>Keine Container verbunden.{n.gateway && ` Gateway: ${n.gateway}`}</div>
            ) : (
              <table className="dtable" style={{ marginTop: 6 }}>
                <thead><tr><th>{tt('Container')}</th><th>{tt('IP-Adresse')}</th><th>MAC</th><th style={{ width: 44 }}></th></tr></thead>
                <tbody>
                  {n.containers.map((c) => (
                    <tr key={c.container}>
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td className="dtable__mono" style={{ color: 'var(--color-accent)' }}>{c.ipv4 || '—'}</td>
                      <td className="dtable__mono text-muted">{c.mac || '—'}</td>
                      <td>{!n.builtin && <button className="btn btn--ghost btn--icon btn--sm" title={tt('Trennen')} onClick={() => disconnect(n, c.container)}><Unlink size={12} /></button>}</td>
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
