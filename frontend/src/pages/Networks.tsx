import { useState, useEffect, useCallback } from 'react';
import { Network, Plus, Trash2, Shield, Link2, Unlink, Lock, Cable, MonitorPlay, Play, Square, Star, Link, Pencil, RefreshCw, X, Activity } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import type { DockerNetwork, HostInterface, FirewallRule, FirewallLogEntry, Container, VmNetwork, VM } from '../lib/types';

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

type FwForm = { action: 'allow' | 'deny' | 'reject'; port: string; proto: string; from: string; direction: string };
const EMPTY_FW_FORM: FwForm = { action: 'allow', port: '', proto: '', from: '', direction: '' };

/** Bestehende Regel bestmöglich in Formularfelder zerlegen (zum Bearbeiten). */
function ruleToForm(r: FirewallRule): FwForm {
  const m = r.to.match(/^(\d+(?::\d+)?)\/?(tcp|udp)?$/i);
  return {
    action: (r.action.toLowerCase() as 'allow' | 'deny' | 'reject') ?? 'allow',
    port: m ? m[1] : '',
    proto: m && m[2] ? m[2].toLowerCase() : '',
    from: /anywhere/i.test(r.from) ? '' : r.from.replace(/\s*\(v6\)/i, '').trim(),
    direction: (r.direction ?? '').toLowerCase(),
  };
}

const DIR_LABEL: Record<string, string> = { IN: 'Eingehend', OUT: 'Ausgehend', '': '–' };

function FirewallPanel() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<FwForm>(EMPTY_FW_FORM);
  const [editNum, setEditNum] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.firewall.list();
    setRules(res.rules); setAvailable(res.available); setActive(res.active); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const startEdit = (r: FirewallRule) => { setEditNum(r.num); setForm(ruleToForm(r)); };
  const cancelEdit = () => { setEditNum(null); setForm(EMPTY_FW_FORM); };

  const submit = async () => {
    if (!form.port && !form.from) { alert('Port oder Quell-IP angeben'); return; }
    setBusy(true);
    const payload = { action: form.action, port: form.port || undefined, proto: form.proto || undefined, from: form.from || undefined, direction: form.direction || undefined };
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

  return (
    <Panel
      title="Firewall (ufw)"
      icon={<Shield size={15} />}
      subtitle={available ? (active ? 'aktiv' : 'inaktiv') : 'nicht installiert'}
      storageKey="firewall"
      defaultCollapsed
      actions={available && (
        <div onClick={(e) => e.stopPropagation()}>
          <Switch checked={active} onChange={async (v) => { await api.firewall.toggle(v).catch((e) => alert(e.message)); load(); }} />
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8, marginBottom: 12 }}>
            <select className="input input--rect" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'allow' })} style={{ width: 100, cursor: 'pointer' }} title="Aktion">
              <option value="allow">allow</option><option value="deny">deny</option><option value="reject">reject</option>
            </select>
            <select className="input input--rect" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} style={{ width: 120, cursor: 'pointer' }} title="Richtung">
              <option value="">Richtung: –</option><option value="in">Eingehend (in)</option><option value="out">Ausgehend (out)</option>
            </select>
            <input className="input input--rect" placeholder="Port (z.B. 443)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 120 }} />
            <select className="input input--rect" value={form.proto} onChange={(e) => setForm({ ...form, proto: e.target.value })} style={{ width: 90, cursor: 'pointer' }}>
              <option value="">tcp+udp</option><option value="tcp">tcp</option><option value="udp">udp</option>
            </select>
            <input className="input input--rect" placeholder="von IP (optional)" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 150, fontFamily: 'var(--font-mono)' }} />
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={busy}>
              {editNum !== null ? <><Pencil size={13} /> Speichern</> : <><Plus size={13} /> Regel</>}
            </button>
            {editNum !== null && <button className="btn btn--ghost btn--sm" onClick={cancelEdit}><X size={13} /> Abbrechen</button>}
          </div>
          {rules.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Keine Regeln.</div>
          ) : (
            <table className="dtable">
              <thead><tr><th>#</th><th>Ziel</th><th>Aktion</th><th>Richtung</th><th>Von</th><th style={{ width: 80 }}></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.num} style={editNum === r.num ? { background: 'var(--color-accent-subtle, rgba(99,102,241,.08))' } : undefined}>
                    <td className="dtable__mono">{r.num}</td>
                    <td style={{ fontWeight: 600 }}>{r.to}</td>
                    <td><span className={`badge badge--${r.action === 'ALLOW' ? 'running' : 'dead'}`}>{r.action}</span></td>
                    <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[r.direction ?? ''] ?? r.direction}</td>
                    <td className="dtable__mono text-muted">{r.from}</td>
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
        </>
      )}
    </Panel>
  );
}

const LOG_ACTION_BADGE: Record<string, string> = { BLOCK: 'dead', ALLOW: 'running', LIMIT: 'restarting', AUDIT: 'stopped' };

function ConnectionsPanel() {
  const [entries, setEntries] = useState<FirewallLogEntry[]>([]);
  const [available, setAvailable] = useState(true);
  const [logging, setLogging] = useState(false);
  const [source, setSource] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionFilter, setActionFilter] = useState<'all' | 'BLOCK' | 'ALLOW'>('all');
  const [dirFilter, setDirFilter] = useState<'all' | 'IN' | 'OUT'>('all');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.firewall.log(500);
      setEntries(res.entries); setAvailable(res.available); setLogging(res.logging);
      setSource(res.source ?? ''); setMessage(res.message ?? '');
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Fehler'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleLogging = async (v: boolean) => {
    try { await api.firewall.setLogging(v); setLogging(v); setTimeout(() => void load(), 600); }
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

  return (
    <Panel
      title="Verbindungsversuche"
      icon={<Activity size={15} />}
      subtitle={available ? `${entries.length} Einträge · ${blocked} blockiert` : 'nicht verfügbar'}
      storageKey="fw-connections"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
          <span style={{ fontSize: 11.5, color: 'var(--color-muted)' }}>Protokollierung</span>
          <Switch checked={logging} onChange={toggleLogging} />
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

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0 12px' }}>
            <select className="input input--rect" value={actionFilter} onChange={(e) => setActionFilter(e.target.value as 'all')} style={{ width: 150, cursor: 'pointer' }}>
              <option value="all">Alle Aktionen</option><option value="BLOCK">Nur blockiert</option><option value="ALLOW">Nur erlaubt</option>
            </select>
            <select className="input input--rect" value={dirFilter} onChange={(e) => setDirFilter(e.target.value as 'all')} style={{ width: 140, cursor: 'pointer' }}>
              <option value="all">Beide Richtungen</option><option value="IN">Eingehend</option><option value="OUT">Ausgehend</option>
            </select>
            <input className="input input--rect" placeholder="Filter: IP, Port, Protokoll…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220, fontFamily: 'var(--font-mono)' }} />
            <span style={{ fontSize: 11.5, color: 'var(--color-faint)', marginLeft: 'auto' }}>{filtered.length} von {entries.length}{source ? ` · ${source}` : ''}</span>
          </div>

          {filtered.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>
              {entries.length === 0 ? 'Noch keine protokollierten Verbindungen.' : 'Keine Treffer für den Filter.'}
            </div>
          ) : (
            <div className="table-scroll">
              <table className="dtable">
                <thead><tr><th>Zeit</th><th>Aktion</th><th>Richtung</th><th>Quell-IP</th><th>Ziel-Port</th><th>Protokoll</th><th>Schnittstelle</th></tr></thead>
                <tbody>
                  {filtered.map((e, i) => (
                    <tr key={i}>
                      <td className="text-muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{e.ts || '–'}</td>
                      <td><span className={`badge badge--${LOG_ACTION_BADGE[e.action] ?? 'stopped'}`}>{e.action}</span></td>
                      <td className="text-muted" style={{ fontSize: 12 }}>{DIR_LABEL[e.direction] ?? e.direction}</td>
                      <td className="dtable__mono" style={{ fontWeight: 600 }}>{e.src || '–'}</td>
                      <td className="dtable__mono">{e.dpt || '–'}</td>
                      <td className="text-muted">{e.proto || '–'}</td>
                      <td className="dtable__mono text-muted">{e.iface || '–'}</td>
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

type NetTab = 'docker' | 'vm' | 'firewall' | 'connections';

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
        </div>

        {view === 'vm' && <VmNetworksView />}
        {view === 'firewall' && <FirewallPanel />}
        {view === 'connections' && <ConnectionsPanel />}
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
