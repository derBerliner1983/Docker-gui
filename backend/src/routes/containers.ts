import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth } from '../middleware/auth';
import { categoryQueries, auditQueries } from '../db/index';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

function parsePorts(ports: Dockerode.Port[]): string[] {
  if (!ports) return [];
  return ports
    .filter((p) => p.PublicPort)
    .map((p) => `${p.PublicPort}:${p.PrivatePort}`);
}

export async function containerRoutes(fastify: FastifyInstance) {
  fastify.get('/api/containers', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const [containers, categoryRows] = await Promise.all([
        docker.listContainers({ all: true }),
        Promise.resolve(categoryQueries.getAll.all()),
      ]);

      const categoryMap = Object.fromEntries(categoryRows.map((r) => [r.container_id, r.category]));

      const result = containers.map((c) => ({
        id: c.Id,
        shortId: c.Id.substring(0, 12),
        name: (c.Names[0] ?? c.Id.substring(0, 12)).replace(/^\//, ''),
        image: c.Image,
        imageId: c.ImageID,
        status: c.Status,
        state: c.State,
        ports: parsePorts(c.Ports),
        created: c.Created,
        labels: c.Labels ?? {},
        category: categoryMap[c.Id] ?? c.Labels?.['docker-gui.category'] ?? null,
      }));

      reply.send({ containers: result });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.get<{ Params: { id: string } }>('/api/containers/:id', { preHandler: requireAuth }, async (req, reply) => {
    try {
      const info = await docker.getContainer(req.params.id).inspect();
      reply.send({ container: info });
    } catch {
      reply.status(404).send({ error: 'Container not found' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/start', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).start();
      auditQueries.log.run(req.user.id, 'container.start', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/stop', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).stop();
      auditQueries.log.run(req.user.id, 'container.stop', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.post<{ Params: { id: string } }>('/api/containers/:id/restart', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).restart();
      auditQueries.log.run(req.user.id, 'container.restart', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/containers/:id', { preHandler: requireAuth }, async (req, reply) => {
    try {
      await docker.getContainer(req.params.id).remove({ force: true });
      categoryQueries.delete.run(req.params.id);
      auditQueries.log.run(req.user.id, 'container.remove', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.get<{ Params: { id: string }; Querystring: { tail?: string; since?: string } }>(
    '/api/containers/:id/logs',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const tail = parseInt(req.query.tail ?? '200');
        const since = req.query.since ? parseInt(req.query.since) : undefined;
        const container = docker.getContainer(req.params.id);
        const logOpts: Dockerode.ContainerLogsOptions & { follow: false } = { stdout: true, stderr: true, tail, timestamps: true, follow: false };
        if (since) logOpts.since = since;
        const raw = (await container.logs(logOpts)).toString('utf8');
        const lines = raw
          .split('\n')
          .map((line) => (line.length > 8 ? line.slice(8) : line))
          .filter((l) => l.trim());
        reply.send({ logs: lines });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/api/containers/:id/stats',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const stats = (await docker.getContainer(req.params.id).stats({ stream: false })) as Dockerode.ContainerStats;
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const sysDelta = stats.cpu_stats.system_cpu_usage - (stats.precpu_stats.system_cpu_usage ?? 0);
        const numCpus = stats.cpu_stats.online_cpus ?? stats.cpu_stats.cpu_usage.percpu_usage?.length ?? 1;
        const cpuPercent = sysDelta > 0 ? (cpuDelta / sysDelta) * numCpus * 100 : 0;

        const memUsed = stats.memory_stats.usage - ((stats.memory_stats.stats as Record<string, number>)?.cache ?? 0);
        const memLimit = stats.memory_stats.limit;

        reply.send({
          cpu: Math.round(cpuPercent * 10) / 10,
          memory: {
            used: memUsed,
            limit: memLimit,
            percent: memLimit > 0 ? Math.round((memUsed / memLimit) * 1000) / 10 : 0,
          },
        });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  fastify.get('/api/images', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const images = await docker.listImages({ all: false });
      reply.send({
        images: images.map((i) => ({
          id: i.Id,
          tags: i.RepoTags ?? [],
          size: i.Size,
          created: i.Created,
        })),
      });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
    }
  });

  fastify.post<{ Body: { image: string; name?: string; ports?: Record<string, string>; env?: string[]; volumes?: string[]; category?: string; restart?: string } }>(
    '/api/containers/create',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const { image, name, ports, env, volumes, category, restart } = req.body ?? {};

        const portBindings: Record<string, Array<{ HostPort: string }>> = {};
        const exposedPorts: Record<string, Record<string, never>> = {};

        if (ports) {
          for (const [containerPort, hostPort] of Object.entries(ports)) {
            const key = `${containerPort}/tcp`;
            exposedPorts[key] = {};
            portBindings[key] = [{ HostPort: hostPort }];
          }
        }

        const labels: Record<string, string> = {};
        if (category) labels['docker-gui.category'] = category;

        const container = await docker.createContainer({
          Image: image,
          name,
          Env: env,
          ExposedPorts: exposedPorts,
          Labels: labels,
          HostConfig: {
            PortBindings: portBindings,
            Binds: volumes,
            RestartPolicy: restart ? { Name: restart } : undefined,
          },
        });

        await container.start();
        if (category) categoryQueries.set.run(container.id, category);
        auditQueries.log.run(req.user.id, 'container.create', name ?? image);

        reply.status(201).send({ id: container.id });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: { category: string } }>(
    '/api/containers/:id/category',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { category } = req.body ?? {};
      categoryQueries.set.run(req.params.id, category);
      reply.send({ ok: true });
    }
  );

  fastify.post<{ Params: { id: string } }>(
    '/api/containers/:id/pull',
    { preHandler: requireAuth },
    async (req, reply) => {
      try {
        const info = await docker.getContainer(req.params.id).inspect();
        const imageName = info.Config.Image;

        await new Promise<void>((resolve, reject) => {
          docker.pull(imageName, (err: Error | null, stream: NodeJS.ReadableStream) => {
            if (err) return reject(err);
            docker.modem.followProgress(stream, (err: Error | null) => (err ? reject(err) : resolve()));
          });
        });

        auditQueries.log.run(req.user.id, 'container.pull', imageName);
        reply.send({ ok: true, image: imageName });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker error' });
      }
    }
  );
}
