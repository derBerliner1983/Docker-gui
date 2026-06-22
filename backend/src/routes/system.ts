import type { FastifyInstance } from 'fastify';
import si from 'systeminformation';
import { execSync } from 'child_process';
import { requireAuth } from '../middleware/auth';

export async function systemRoutes(fastify: FastifyInstance) {
  fastify.get('/api/system/stats', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const [cpuLoad, mem, fsSizes, netStats, osInfo, time] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.fsSize(),
        si.networkStats(),
        si.osInfo(),
        si.time(),
      ]);

      reply.send({
        cpu: {
          usage: Math.round(cpuLoad.currentLoad),
          cores: cpuLoad.cpus.length,
        },
        memory: {
          total: mem.total,
          used: mem.used,
          free: mem.free,
          percent: Math.round((mem.used / mem.total) * 100),
        },
        disk: fsSizes
          .filter((f) => f.size > 0)
          .map((f) => ({
            fs: f.fs,
            type: f.type,
            size: f.size,
            used: f.used,
            available: f.available,
            percent: Math.round(f.use),
            mount: f.mount,
          })),
        network: netStats.slice(0, 2).map((n) => ({
          iface: n.iface,
          rx_bytes: n.rx_bytes,
          tx_bytes: n.tx_bytes,
          rx_sec: n.rx_sec,
          tx_sec: n.tx_sec,
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
    try {
      const version = execSync('docker version --format "{{.Server.Version}}"', { timeout: 3000 })
        .toString()
        .trim();
      reply.send({ version });
    } catch {
      reply.send({ version: 'unknown' });
    }
  });

  fastify.get('/api/system/services', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const output = execSync(
        'systemctl list-units --type=service --state=loaded --no-pager --no-legend --plain 2>/dev/null | head -50',
        { timeout: 5000 }
      ).toString();

      const services = output
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            name: parts[0] ?? '',
            load: parts[1] ?? '',
            active: parts[2] ?? '',
            sub: parts[3] ?? '',
            description: parts.slice(4).join(' '),
          };
        })
        .filter((s) => s.name);

      reply.send({ services });
    } catch {
      reply.send({ services: [] });
    }
  });

  fastify.post<{ Body: { service: string; action: 'start' | 'stop' | 'restart' | 'enable' | 'disable' } }>(
    '/api/system/services/control',
    { preHandler: requireAuth },
    async (req, reply) => {
      if (req.user.role !== 'admin') return reply.status(403).send({ error: 'Admin required' });
      const { service, action } = req.body ?? {};
      const allowed = ['start', 'stop', 'restart', 'enable', 'disable'];
      if (!allowed.includes(action)) return reply.status(400).send({ error: 'Invalid action' });
      const safeName = service.replace(/[^a-zA-Z0-9@._-]/g, '');
      try {
        execSync(`systemctl ${action} ${safeName}`, { timeout: 10000 });
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'systemctl error' });
      }
    }
  );
}
