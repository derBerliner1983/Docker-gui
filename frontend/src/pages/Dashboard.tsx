import { useState, useEffect, useCallback, useRef } from 'react';
import { Cpu, MemoryStick, Network, ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { Panel } from '../components/ui/Panel';
import { Donut, donutColor } from '../components/ui/Donut';
import { Sparkline } from '../components/ui/Sparkline';
import { api } from '../lib/api';
import { formatBytes, formatUptime } from '../lib/utils';
import type { SystemStats } from '../lib/types';

const MEM_COLORS = {
  system: '#71717A',
  vm: '#F59E0B',
  docker: '#10B981',
  free: 'var(--color-border-strong)',
};

function loadClass(pct: number): string {
  if (pct >= 90) return 'loadbar-fill--danger';
  if (pct >= 70) return 'loadbar-fill--warn';
  return 'loadbar-fill--accent';
}

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

export function Dashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [dockerVersion, setDockerVersion] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const [coresOpen, setCoresOpen] = useState(() => localStorage.getItem('cpu-cores-open') === '1');
  const histRef = useRef<number[]>([]);

  const toggleCores = () => {
    setCoresOpen((v) => {
      localStorage.setItem('cpu-cores-open', v ? '0' : '1');
      return !v;
    });
  };

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, dv] = await Promise.allSettled([api.system.stats(), api.system.dockerVersion()]);
      if (s.status === 'fulfilled') {
        setStats(s.value);
        histRef.current = [...histRef.current, s.value.cpu.usage].slice(-40);
        setHistory([...histRef.current]);
      }
      if (dv.status === 'fulfilled') setDockerVersion(dv.value.version);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => clearInterval(id);
  }, [load]);

  const mem = stats?.memory;

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={stats ? `${stats.os.hostname} · ${stats.os.distro} ${stats.os.release} · Uptime ${formatUptime(stats.os.uptime)}` : undefined}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        {/* ── PROZESSOR ── */}
        <Panel
          title="Prozessor"
          icon={<Cpu size={15} />}
          subtitle={stats?.cpu.brand}
          storageKey="cpu"
          actions={stats && (
            <span style={{ fontSize: 13, fontWeight: 700, color: stats.cpu.usage >= 90 ? 'var(--color-error)' : stats.cpu.usage >= 70 ? 'var(--color-warning)' : 'var(--color-accent)' }}>
              {stats.cpu.usage}%
            </span>
          )}
        >
          {stats && (
            <>
              {/* Gesamtlast als Tortendiagramm + Verlauf */}
              <div className="donut-group" style={{ marginTop: 12, alignItems: 'center' }}>
                <div className="donut-item">
                  <Donut
                    size={140}
                    thickness={15}
                    segments={[
                      { value: stats.cpu.usage, color: donutColor(stats.cpu.usage) },
                      { value: 100 - stats.cpu.usage, color: 'var(--color-border-strong)' },
                    ]}
                    centerLabel={`${stats.cpu.usage}%`}
                    centerSub="Last"
                    centerColor={donutColor(stats.cpu.usage)}
                  />
                  <div className="donut-item__caption">Gesamtlast</div>
                </div>
                <div style={{ flex: 1, minWidth: 220 }}>
                  <div style={{ fontSize: 11, color: 'var(--color-faint)', marginBottom: 6 }}>Verlauf (letzte ~3 Min)</div>
                  <Sparkline data={history} max={100} height={90} />
                  <div style={{ fontSize: 11, color: 'var(--color-subtle)', marginTop: 8 }}>
                    {stats.cpu.cores} Kerne · {stats.cpu.speed} GHz
                  </div>
                </div>
              </div>

              {/* Einzelkerne – einklappbar */}
              <div style={{ borderTop: '1px solid var(--color-border)', marginTop: 14, paddingTop: 6 }}>
                <button
                  className="cpu-cores-toggle"
                  onClick={toggleCores}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                    background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
                    color: 'var(--color-subtle)', fontSize: 12, fontWeight: 600,
                  }}
                >
                  {coresOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  Einzelne Kerne ({stats.cpu.perCore.length})
                </button>
                {coresOpen && stats.cpu.perCore.map((load, i) => (
                  <div className="loadbar-row" key={i}>
                    <span className="loadbar-label">CPU {i}</span>
                    <span className="loadbar-pct">{load}%</span>
                    <div className="loadbar-track">
                      <div className={`loadbar-fill ${loadClass(load)}`} style={{ width: `${load}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>

        {/* ── SYSTEM (RAM + Disk donuts) ── */}
        <Panel
          title="System"
          icon={<MemoryStick size={15} />}
          subtitle={mem ? `Arbeitsspeicher: ${formatBytes(mem.total)}` : undefined}
          storageKey="system"
        >
          {stats && mem && (
            <div className="donut-group" style={{ marginTop: 12 }}>
              {/* RAM with breakdown */}
              <div className="donut-item">
                <Donut
                  size={140}
                  thickness={15}
                  segments={[
                    { value: mem.breakdown.system, color: MEM_COLORS.system },
                    { value: mem.breakdown.vm, color: MEM_COLORS.vm },
                    { value: mem.breakdown.docker, color: MEM_COLORS.docker },
                    { value: mem.breakdown.free, color: MEM_COLORS.free },
                  ]}
                  centerLabel={`${mem.percent}%`}
                  centerSub="RAM"
                  centerColor={donutColor(mem.percent)}
                />
                <div className="donut-item__caption">RAM-Nutzung</div>
              </div>

              {/* Legend */}
              <div className="legend" style={{ alignSelf: 'center', minWidth: 170 }}>
                <div className="legend__item">
                  <span className="legend__dot" style={{ background: MEM_COLORS.system }} />
                  <span className="legend__label">System</span>
                  <span className="legend__value">{formatBytes(mem.breakdown.system)}</span>
                </div>
                <div className="legend__item">
                  <span className="legend__dot" style={{ background: MEM_COLORS.vm }} />
                  <span className="legend__label">VM</span>
                  <span className="legend__value">{formatBytes(mem.breakdown.vm)}</span>
                </div>
                <div className="legend__item">
                  <span className="legend__dot" style={{ background: MEM_COLORS.docker }} />
                  <span className="legend__label">Docker</span>
                  <span className="legend__value">{formatBytes(mem.breakdown.docker)}</span>
                </div>
                <div className="legend__item">
                  <span className="legend__dot" style={{ background: '#A1A1AA' }} />
                  <span className="legend__label">Frei</span>
                  <span className="legend__value">{formatBytes(mem.breakdown.free)}</span>
                </div>
              </div>

              {/* Disks */}
              {stats.disk.slice(0, 4).map((d) => (
                <div className="donut-item" key={d.mount}>
                  <Donut
                    size={130}
                    thickness={14}
                    segments={[
                      { value: d.used, color: donutColor(d.percent) },
                      { value: d.available, color: 'var(--color-border-strong)' },
                    ]}
                    centerLabel={`${d.percent}%`}
                    centerColor={donutColor(d.percent)}
                  />
                  <div className="donut-item__caption">
                    <div style={{ fontWeight: 600 }}>{d.mount}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-subtle)' }}>
                      {formatBytes(d.used)} / {formatBytes(d.size)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ── NETZWERK ── */}
        <Panel
          title="Schnittstelle"
          icon={<Network size={15} />}
          subtitle={dockerVersion ? `Docker ${dockerVersion}` : undefined}
          storageKey="network"
        >
          {stats && (
            <table className="dtable" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Schnittstelle</th>
                  <th>Status</th>
                  <th className="dtable__num"><ArrowDown size={11} style={{ display: 'inline' }} /> Eingehend</th>
                  <th className="dtable__num"><ArrowUp size={11} style={{ display: 'inline' }} /> Ausgehend</th>
                  <th className="dtable__num">Gesamt ↓</th>
                  <th className="dtable__num">Gesamt ↑</th>
                </tr>
              </thead>
              <tbody>
                {stats.network.map((n) => (
                  <tr key={n.iface}>
                    <td style={{ fontWeight: 600 }}>{n.iface}</td>
                    <td>
                      <span className={`badge badge--${n.operstate === 'up' ? 'running' : 'stopped'}`}>
                        <span className="badge__dot" />
                        {n.operstate === 'up' ? 'aktiv' : 'inaktiv'}
                      </span>
                    </td>
                    <td className="dtable__num">{fmtRate(n.rx_sec)}</td>
                    <td className="dtable__num">{fmtRate(n.tx_sec)}</td>
                    <td className="dtable__num dtable__mono">{formatBytes(n.rx_bytes)}</td>
                    <td className="dtable__num dtable__mono">{formatBytes(n.tx_bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </main>
    </>
  );
}
