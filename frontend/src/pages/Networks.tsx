import { useState, useEffect, useCallback } from 'react';
import { Network, Plus, Trash2, Shield, Link2, Unlink, Lock, Cable } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Modal } from '../components/ui/Modal';
import { Switch } from '../components/ui/Switch';
import { api } from '../lib/api';
import type { DockerNetwork, HostInterface, FirewallRule, Container } from '../lib/types';

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

function FirewallPanel() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [available, setAvailable] = useState(true);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState<{ action: 'allow' | 'deny' | 'reject'; port: string; proto: string; from: string }>({ action: 'allow', port: '', proto: '', from: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await api.firewall.list();
    setRules(res.rules); setAvailable(res.available); setActive(res.active); setMessage(res.message ?? '');
  }, []);
  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!form.port && !form.from) { alert('Port oder Quell-IP angeben'); return; }
    setBusy(true);
    try { await api.firewall.add({ action: form.action, port: form.port || undefined, proto: form.proto || undefined, from: form.from || undefined }); setForm({ ...form, port: '', from: '' }); await load(); }
    catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
    finally { setBusy(false); }
  };

  const del = async (num: number) => {
    if (!confirm('Regel löschen?')) return;
    try { await api.firewall.remove(num); await load(); } catch (err) { alert(err instanceof Error ? err.message : 'Fehler'); }
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8, marginBottom: 12 }}>
            <select className="input input--rect" value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'allow' })} style={{ width: 100, cursor: 'pointer' }}>
              <option value="allow">allow</option><option value="deny">deny</option><option value="reject">reject</option>
            </select>
            <input className="input input--rect" placeholder="Port (z.B. 443)" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} style={{ width: 130 }} />
            <select className="input input--rect" value={form.proto} onChange={(e) => setForm({ ...form, proto: e.target.value })} style={{ width: 90, cursor: 'pointer' }}>
              <option value="">tcp+udp</option><option value="tcp">tcp</option><option value="udp">udp</option>
            </select>
            <input className="input input--rect" placeholder="von IP (optional)" value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} style={{ width: 150, fontFamily: 'var(--font-mono)' }} />
            <button className="btn btn--primary btn--sm" onClick={add} disabled={busy}><Plus size={13} /> Regel</button>
          </div>
          {rules.length === 0 ? (
            <div className="text-muted text-sm" style={{ padding: '10px 0' }}>Keine Regeln.</div>
          ) : (
            <table className="dtable">
              <thead><tr><th>#</th><th>Ziel</th><th>Aktion</th><th>Von</th><th style={{ width: 44 }}></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.num}>
                    <td className="dtable__mono">{r.num}</td>
                    <td style={{ fontWeight: 600 }}>{r.to}</td>
                    <td><span className={`badge badge--${r.action === 'ALLOW' ? 'running' : 'dead'}`}>{r.action}</span></td>
                    <td className="dtable__mono text-muted">{r.from}</td>
                    <td><button className="btn btn--danger btn--icon btn--sm" onClick={() => del(r.num)}><Trash2 size={12} /></button></td>
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

export function Networks() {
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
        subtitle={`${networks.length} Netzwerke`}
        onRefresh={load}
        refreshing={refreshing}
        actions={<button className="btn btn--primary btn--sm" onClick={() => setCreateOpen(true)}><Plus size={13} /> Netzwerk</button>}
      />
      <main className="page">
        {networks.map((n) => (
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

        <FirewallPanel />
      </main>

      <CreateNetModal open={createOpen} onClose={() => setCreateOpen(false)} onDone={load} interfaces={interfaces} />
      <ConnectModal net={connectNet} open={!!connectNet} onClose={() => setConnectNet(null)} onDone={load} containers={containers} />
    </>
  );
}
