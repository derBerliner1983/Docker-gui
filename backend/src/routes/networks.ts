import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import si from 'systeminformation';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries } from '../db/index';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

interface NetEndpoint {
  container: string;
  name: string;
  ipv4: string;
  mac: string;
}

export async function networkRoutes(fastify: FastifyInstance) {
  // List Docker networks with details
  fastify.get('/api/networks', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const nets = await docker.listNetworks();
      const detailed = await Promise.all(
        nets.map(async (n) => {
          const info = await docker.getNetwork(n.Id).inspect().catch(() => null);
          const ipam = info?.IPAM?.Config?.[0] ?? {};
          const containers: NetEndpoint[] = info?.Containers
            ? Object.entries(info.Containers).map(([cid, c]) => ({
                container: cid,
                name: (c as { Name: string }).Name,
                ipv4: (c as { IPv4Address: string }).IPv4Address,
                mac: (c as { MacAddress: string }).MacAddress,
              }))
            : [];
          return {
            id: n.Id,
            name: n.Name,
            driver: n.Driver,
            scope: n.Scope,
            internal: info?.Internal ?? false,
            subnet: (ipam as { Subnet?: string }).Subnet ?? '',
            gateway: (ipam as { Gateway?: string }).Gateway ?? '',
            parent: (info?.Options?.parent as string) ?? '',
            vlan: ((info?.Options?.parent as string) ?? '').includes('.')
              ? (info?.Options?.parent as string).split('.')[1]
              : '',
            containers,
            builtin: ['bridge', 'host', 'none'].includes(n.Name),
          };
        })
      );
      reply.send({ networks: detailed });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });

  // Host network interfaces (for macvlan parent selection)
  fastify.get('/api/networks/interfaces', { preHandler: requireAuth }, async (_req, reply) => {
    try {
      const ifaces = await si.networkInterfaces();
      const list = (Array.isArray(ifaces) ? ifaces : [ifaces])
        .filter((i) => !i.internal && i.iface !== 'lo')
        .map((i) => ({ iface: i.iface, ip4: i.ip4, mac: i.mac, type: i.type, operstate: i.operstate }));
      reply.send({ interfaces: list });
    } catch {
      reply.send({ interfaces: [] });
    }
  });

  // Create a network (bridge / macvlan / ipvlan, optional VLAN, internal isolation)
  fastify.post<{
    Body: { name: string; driver?: string; subnet?: string; gateway?: string; parent?: string; vlan?: string; internal?: boolean };
  }>('/api/networks', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const name = (b?.name ?? '').replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!name) return reply.status(400).send({ error: 'Name erforderlich' });
    const driver = ['bridge', 'macvlan', 'ipvlan'].includes(b?.driver ?? '') ? b!.driver! : 'bridge';

    try {
      const options: Record<string, string> = {};
      if ((driver === 'macvlan' || driver === 'ipvlan') && b?.parent) {
        const parent = b.parent.replace(/[^a-zA-Z0-9_.-]/g, '');
        options.parent = b.vlan ? `${parent}.${b.vlan.replace(/[^0-9]/g, '')}` : parent;
      }
      await docker.createNetwork({
        Name: name,
        Driver: driver,
        Internal: b?.internal ?? false,
        CheckDuplicate: true,
        IPAM: b?.subnet
          ? { Driver: 'default', Config: [{ Subnet: b.subnet, Gateway: b.gateway || undefined }] }
          : undefined,
        Options: Object.keys(options).length ? options : undefined,
      });
      auditQueries.log.run(req.user.id, 'network.create', `${name} (${driver}${options.parent ? ' ' + options.parent : ''})`);
      reply.status(201).send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Netzwerk-Erstellung fehlgeschlagen' });
    }
  });

  fastify.delete<{ Params: { id: string } }>('/api/networks/:id', { preHandler: requireAdmin }, async (req, reply) => {
    try {
      await docker.getNetwork(req.params.id).remove();
      auditQueries.log.run(req.user.id, 'network.delete', req.params.id);
      reply.send({ ok: true });
    } catch (err: unknown) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Docker-Fehler' });
    }
  });

  // Connect a container with optional fixed IP + aliases (multiple names)
  fastify.post<{ Params: { id: string }; Body: { container: string; ip?: string; aliases?: string[] } }>(
    '/api/networks/:id/connect',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { container, ip, aliases } = req.body ?? {};
      if (!container) return reply.status(400).send({ error: 'Container erforderlich' });
      try {
        await docker.getNetwork(req.params.id).connect({
          Container: container,
          EndpointConfig: {
            IPAMConfig: ip ? { IPv4Address: ip } : undefined,
            Aliases: aliases?.filter(Boolean),
          },
        });
        auditQueries.log.run(req.user.id, 'network.connect', `${container}${ip ? '@' + ip : ''}`);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Verbinden fehlgeschlagen' });
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: { container: string } }>(
    '/api/networks/:id/disconnect',
    { preHandler: requireAdmin },
    async (req, reply) => {
      try {
        await docker.getNetwork(req.params.id).disconnect({ Container: req.body?.container, Force: true });
        auditQueries.log.run(req.user.id, 'network.disconnect', req.body?.container);
        reply.send({ ok: true });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Trennen fehlgeschlagen' });
      }
    }
  );
}
