import type { FastifyInstance } from 'fastify';
import si from 'systeminformation';
import Dockerode from 'dockerode';
import { execSync } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

function safeExec(cmd: string, timeout = 5000): string {
  try {
    return execSync(cmd, { timeout, stdio: ['pipe', 'pipe', 'ignore'] }).toString();
  } catch {
    return '';
  }
}

/** Approximate RAM used by all running Docker containers (bytes). */
async function dockerMemoryUsage(): Promise<number> {
  try {
    const containers = await docker.listContainers({ all: false });
    let total = 0;
    await Promise.all(
      containers.slice(0, 30).map(async (c) => {
        try {
          const stats = (await docker.getContainer(c.Id).stats({ stream: false })) as Dockerode.ContainerStats;
          const cache = (stats.memory_stats.stats as Record<string, number>)?.cache ?? 0;
          total += (stats.memory_stats.usage ?? 0) - cache;
        } catch {
          /* ignore single container */
        }
      })
    );
    return total;
  } catch {
    return 0;
  }
}

/** Approximate RAM used by KVM/QEMU virtual machines (bytes). */
function vmMemoryUsage(): number {
  const out = safeExec("ps -eo rss,comm --no-headers | grep -iE 'qemu|kvm' || true");
  let kb = 0;
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)/);
    if (m) kb += parseInt(m[1]);
  }
  return kb * 1024;
}

export async function systemRoutes(fastify: FastifyInstance) {
  // ── Full system stats (CPU per core, RAM breakdown, disk, network) ──
  fastify.get('/api/system/stats', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const [cpuLoad, mem, fsSizes, netStats, osInfo, time, cpuInfo, dockerMem] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.osInfo(),
        si.time(),
        si.cpu(),
        dockerMemoryUsage(),
      ]);

      const vmMem = vmMemoryUsage();
      const dockerMemClamped = Math.min(dockerMem, mem.used);
      const vmMemClamped = Math.min(vmMem, Math.max(0, mem.used - dockerMemClamped));
      const systemMem = Math.max(0, mem.used - dockerMemClamped - vmMemClamped);

      reply.send({
        cpu: {
          usage: Math.round(cpuLoad.currentLoad),
          cores: cpuLoad.cpus.length,
          brand: `${cpuInfo.manufacturer} ${cpuInfo.brand}`.trim(),
          speed: cpuInfo.speed,
          perCore: cpuLoad.cpus.map((c) => Math.round(c.load)),
        },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          available: mem.available,
          percent: Math.round((mem.used / mem.total) * 100),
          breakdown: {
            system: systemMem,
            docker: dockerMemClamped,
            vm: vmMemClamped,
            free: mem.total - mem.used,
          },
        },
        disk: fsSizes
          .filter((f) => f.size > 0 && !f.mount.startsWith('/snap') && !f.mount.startsWith('/var/lib/docker'))
          .map((f) => ({
            fs: f.fs,
            type: f.type,
            size: f.size,
            used: f.used,
            available: f.available,
            percent: Math.round(f.use),
            mount: f.mount,
          })),
        network: netStats.slice(0, 4).map((n) => ({
          iface: n.iface,
          rx_bytes: n.rx_bytes,
          tx_bytes: n.tx_bytes,
          rx_sec: Math.max(0, n.rx_sec ?? 0),
          tx_sec: Math.max(0, n.tx_sec ?? 0),
          operstate: n.operstate,
        })),
        os: {
          hostname: osInfo.hostname,
          platform: osInfo.platform,
          distro: osInfo.distro,
          release: osInfo.release,
          kernel: osInfo.kernel,
          arch: osInfo.arch,
          uptime: time.uptime,
        },
      });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'System error' });
    }
  });

  fastify.get('/api/system/docker-version', { preHandler: requireAuth }, async (_req, reply) => {
    const version = safeExec('docker version --format "{{.Server.Version}}"', 3000).trim();
    reply.send({ version: version || 'unknown' });
  });

  // ── Processes (Task Manager) ──
  fastify.get('/api/system/processes', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const procs = await si.processes();
      const list = procs.list
        .filter((p) => p.cpu > 0.05 || p.memRss > 5000)
        .sort((a, b) => b.cpu - a.cpu)
        .slice(0, 60)
        .map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: Math.round(p.cpu * 10) / 10,
          mem: Math.round(p.mem * 10) / 10,
          memRss: p.memRss * 1024,
          user: p.user,
          state: p.state,
          command: p.command?.substring(0, 120) ?? '',
        }));
      reply.send({ processes: list, total: procs.all, running: procs.running });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Process error' });
    }
  });

  fastify.post<{ Params: { pid: string }; Body: { signal?: string } }>(
    '/api/system/processes/:pid/kill',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const pid = parseInt(req.params.pid);
      if (!pid || pid < 100) return reply.status(400).send({ error: 'Ungültige PID' });
      const signal = req.body?.signal === 'KILL' ? 'KILL' : 'TERM';
      try {
        process.kill(pid, `SIG${signal}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Kill fehlgeschlagen' });
      }
    }
  );

  // ── systemd services ──
  fastify.get('/api/system/services', { preHandler: requireAuth }, async (_req, reply) => {
    const output = safeExec(
      'systemctl list-units --type=service --all --no-pager --no-legend --plain 2>/dev/null | head -120'
    );
    const services = output
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().replace(/^●\s*/, '').split(/\s+/);
        return {
          name: parts[0] ?? '',
          load: parts[1] ?? '',
          active: parts[2] ?? '',
          sub: parts[3] ?? '',
          description: parts.slice(4).join(' '),
        };
      })
      .filter((s) => s.name.endsWith('.service'));
    reply.send({ services });
  });

  fastify.post<{ Body: { service: string; action: string } }>(
    '/api/system/services/control',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { service, action } = req.body ?? {};
      const allowed = ['start', 'stop', 'restart', 'enable', 'disable'];
      if (!allowed.includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
      const safeName = (service ?? '').replace(/[^a-zA-Z0-9@._-]/g, '');
      if (!safeName) return reply.status(400).send({ error: 'Ungültiger Dienst' });
      try {
        execSync(`systemctl ${action} ${safeName}`, { timeout: 10000 });
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'systemctl Fehler' });
      }
    }
  );

  // ── Autostart (enabled systemd units) ──
  fastify.get('/api/system/autostart', { preHandler: requireAuth }, async (_req, reply) => {
    const output = safeExec(
      'systemctl list-unit-files --type=service --state=enabled,disabled --no-pager --no-legend --plain 2>/dev/null | head -200'
    );
    const units = output
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { name: parts[0] ?? '', state: parts[1] ?? '' };
      })
      .filter((u) => u.name.endsWith('.service'));
    reply.send({ units });
  });
}
