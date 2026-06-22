import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Database, HardDrive, Clock, Container } from 'lucide-react';
import { Topbar } from '../components/layout/Topbar';
import { ContainerBadge } from '../components/ui/Badge';
import { api } from '../lib/api';
import { formatBytes, formatUptime, avatarColor, containerInitial } from '../lib/utils';
import type { SystemStats, Container as DockerContainer } from '../lib/types';

function StatCard({
  label, value, sub, percent, icon: Icon,
}: {
  label: string; value: string; sub: string; percent?: number; icon: React.ElementType;
}) {
  const fill = percent ?? 0;
  const fillClass = fill >= 90 ? 'stat-card__bar-fill--danger' : fill >= 70 ? 'stat-card__bar-fill--warn' : '';
  return (
    <div className="stat-card">
      <div className="stat-card__label" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Icon size={11} />
        {label}
      </div>
      <div className="stat-card__value">{value}</div>
      {percent !== undefined && (
        <div className="stat-card__bar">
          <div className={`stat-card__bar-fill ${fillClass}`} style={{ width: `${Math.min(fill, 100)}%` }} />
        </div>
      )}
      <div className="stat-card__sub">{sub}</div>
    </div>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [dockerVersion, setDockerVersion] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [s, c, dv] = await Promise.allSettled([
        api.system.stats(),
        api.containers.list(),
        api.system.dockerVersion(),
      ]);
      if (s.status === 'fulfilled') setStats(s.value);
      if (c.status === 'fulfilled') setContainers(c.value.containers);
      if (dv.status === 'fulfilled') setDockerVersion(dv.value.version);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [load]);

  const running = containers.filter((c) => c.state === 'running');
  const stopped = containers.filter((c) => c.state !== 'running');

  return (
    <>
      <Topbar
        title="Dashboard"
        subtitle={stats?.os.hostname ? `${stats.os.hostname} · ${stats.os.distro} ${stats.os.release}` : undefined}
        onRefresh={load}
        refreshing={refreshing}
      />
      <main className="page">
        {/* Stats */}
        {stats && (
          <div className="stats-grid">
            <StatCard
              label="CPU"
              value={`${stats.cpu.usage}%`}
              sub={`${stats.cpu.cores} Kerne`}
              percent={stats.cpu.usage}
              icon={Cpu}
            />
            <StatCard
              label="Arbeitsspeicher"
              value={`${stats.memory.percent}%`}
              sub={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
              percent={stats.memory.percent}
              icon={Database}
            />
            {stats.disk[0] && (
              <StatCard
                label="Festplatte"
                value={`${stats.disk[0].percent}%`}
                sub={`${formatBytes(stats.disk[0].used)} / ${formatBytes(stats.disk[0].size)} · ${stats.disk[0].mount}`}
                percent={stats.disk[0].percent}
                icon={HardDrive}
              />
            )}
            <StatCard
              label="Laufzeit"
              value={formatUptime(stats.os.uptime)}
              sub={`Kernel ${stats.os.kernel}`}
              icon={Clock}
            />
          </div>
        )}

        {/* Container overview */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div className="section-heading">Container</div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--color-subtle)' }}>
            <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>● {running.length} läuft</span>
            <span>○ {stopped.length} gestoppt</span>
            <span>∑ {containers.length} gesamt</span>
            {dockerVersion && <span style={{ color: 'var(--color-faint)' }}>Docker {dockerVersion}</span>}
          </div>
        </div>

        {containers.length === 0 ? (
          <div className="card">
            <div className="empty-state">
              <div className="empty-state__icon"><Container size={44} strokeWidth={1} /></div>
              <div className="empty-state__title">Keine Container gefunden</div>
              <div className="empty-state__desc">
                Starte Docker-Container auf dem Server oder{' '}
                <Link to="/containers" style={{ color: 'var(--color-accent)' }}>erstelle neue Container</Link>.
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            {containers.map((c) => (
              <div
                key={c.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 16px', borderBottom: '1px solid var(--color-border)',
                }}
              >
                <div
                  className="container-avatar"
                  style={{ background: avatarColor(c.name), width: 28, height: 28, fontSize: 12, borderRadius: 6 }}
                >
                  {containerInitial(c.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.image}
                  </div>
                </div>
                {c.ports.length > 0 && (
                  <span className="port-chip">{c.ports[0]}</span>
                )}
                <ContainerBadge state={c.state} />
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
