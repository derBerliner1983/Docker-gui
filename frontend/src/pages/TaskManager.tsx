import { useState, useEffect, useCallback } from 'react';
import { Activity, Cog, Square, Skull, Play, RotateCcw, Search } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { api } from '../lib/api';
import { formatBytes } from '../lib/utils';
import type { ProcessInfo, SystemService } from '../lib/types';

function loadColor(pct: number): string {
  if (pct >= 50) return 'var(--color-error)';
  if (pct >= 20) return 'var(--color-warning)';
  return 'var(--color-muted)';
}

export function TaskManager() {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [services, setServices] = useState<SystemService[]>([]);
  const [procMeta, setProcMeta] = useState({ total: 0, running: 0 });
  const [filter, setFilter] = useState('');
  const [svcFilter, setSvcFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [p, s] = await Promise.allSettled([api.system.processes(), api.system.services()]);
      if (p.status === 'fulfilled') {
        setProcesses(p.value.processes);
        setProcMeta({ total: p.value.total, running: p.value.running });
      }
      if (s.status === 'fulfilled') setServices(s.value.services);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const killProc = async (pid: number, name: string, force: boolean) => {
    if (!confirm(`Prozess "${name}" (PID ${pid}) ${force ? 'hart beenden (KILL)' : 'beenden (TERM)'}?`)) return;
    setBusy((b) => ({ ...b, [`p${pid}`]: 'kill' }));
    try {
      await api.system.killProcess(pid, force ? 'KILL' : 'TERM');
      setTimeout(() => void load(), 600);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`p${pid}`]; return n; });
    }
  };

  const controlSvc = async (name: string, action: string) => {
    setBusy((b) => ({ ...b, [`s${name}`]: action }));
    try {
      await api.system.controlService(name, action);
      setTimeout(() => void load(), 700);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fehler');
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[`s${name}`]; return n; });
    }
  };

  const filteredProcs = processes.filter(
    (p) => !filter || p.name.toLowerCase().includes(filter.toLowerCase()) || p.command.toLowerCase().includes(filter.toLowerCase())
  );
  const filteredSvcs = services.filter((s) => !svcFilter || s.name.toLowerCase().includes(svcFilter.toLowerCase()));

  return (
    <>
      <Topbar
        title="Taskmanager"
        subtitle={`${procMeta.running} aktiv · ${procMeta.total} Prozesse gesamt`}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        {/* PROZESSE */}
        <Panel
          title="Prozesse"
          icon={<Activity size={15} />}
          subtitle={`${filteredProcs.length} angezeigt`}
          storageKey="tm-procs"
          actions={
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--color-faint)' }} />
              <input
                className="input input--rect btn--sm"
                placeholder="Suchen…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                style={{ height: 28, width: 160, paddingLeft: 28, fontSize: 12 }}
              />
            </div>
          }
        >
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Prozess</th>
                  <th>PID</th>
                  <th>Benutzer</th>
                  <th className="dtable__num">CPU %</th>
                  <th className="dtable__num">RAM</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredProcs.map((p) => (
                  <tr key={p.pid}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.command && <div className="dtable__mono" style={{ fontSize: 10.5, opacity: 0.7, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.command}</div>}
                    </td>
                    <td className="dtable__mono">{p.pid}</td>
                    <td className="text-muted">{p.user}</td>
                    <td className="dtable__num" style={{ color: loadColor(p.cpu), fontWeight: 600 }}>{p.cpu.toFixed(1)}</td>
                    <td className="dtable__num">{formatBytes(p.memRss)}</td>
                    <td>
                      <div className="dtable__actions">
                        <button
                          className="btn btn--ghost btn--icon btn--sm"
                          title="Beenden (TERM)"
                          disabled={!!busy[`p${p.pid}`]}
                          onClick={() => killProc(p.pid, p.name, false)}
                        >
                          {busy[`p${p.pid}`] ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Square size={12} />}
                        </button>
                        <button
                          className="btn btn--danger btn--icon btn--sm"
                          title="Hart beenden (KILL)"
                          disabled={!!busy[`p${p.pid}`]}
                          onClick={() => killProc(p.pid, p.name, true)}
                        >
                          <Skull size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* DIENSTE */}
        <Panel
          title="Dienste"
          icon={<Cog size={15} />}
          subtitle={`${filteredSvcs.length} systemd-Dienste`}
          storageKey="tm-svcs"
          defaultCollapsed
          actions={
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--color-faint)' }} />
              <input
                className="input input--rect"
                placeholder="Dienst suchen…"
                value={svcFilter}
                onChange={(e) => setSvcFilter(e.target.value)}
                style={{ height: 28, width: 160, paddingLeft: 28, fontSize: 12 }}
              />
            </div>
          }
        >
          <div className="table-scroll" style={{ marginTop: 6 }}>
            <table className="dtable">
              <thead>
                <tr>
                  <th>Dienst</th>
                  <th>Status</th>
                  <th>Beschreibung</th>
                  <th style={{ width: 110 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredSvcs.map((s) => {
                  const active = s.active === 'active';
                  return (
                    <tr key={s.name}>
                      <td style={{ fontWeight: 600 }}>{s.name.replace('.service', '')}</td>
                      <td>
                        <span className={`badge badge--${active ? 'running' : 'stopped'}`}>
                          <span className="badge__dot" />
                          {s.sub || s.active}
                        </span>
                      </td>
                      <td className="text-muted" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</td>
                      <td>
                        <div className="dtable__actions">
                          {active ? (
                            <button className="btn btn--ghost btn--icon btn--sm" title="Stoppen" disabled={!!busy[`s${s.name}`]} onClick={() => controlSvc(s.name, 'stop')}>
                              {busy[`s${s.name}`] === 'stop' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Square size={12} />}
                            </button>
                          ) : (
                            <button className="btn btn--ghost btn--icon btn--sm" title="Starten" disabled={!!busy[`s${s.name}`]} onClick={() => controlSvc(s.name, 'start')}>
                              {busy[`s${s.name}`] === 'start' ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Play size={12} />}
                            </button>
                          )}
                          <button className="btn btn--ghost btn--icon btn--sm" title="Neustart" disabled={!!busy[`s${s.name}`]} onClick={() => controlSvc(s.name, 'restart')}>
                            <RotateCcw size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      </main>
    </>
  );
}
