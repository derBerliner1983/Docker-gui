import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries, categoryQueries } from '../db/index';
import { notify } from '../lib/notify';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// ─── Shared types ────────────────────────────────────────────────────────────

interface StorePort { container: number; host: number; proto: 'tcp' | 'udp' }
interface StoreVol  { name: string; path: string }
interface StoreEnv  { key: string; label: string; default: string; required: boolean; secret: boolean }

export interface StoreItem {
  id: string;
  name: string;
  image: string;
  icon: string;
  description: string;
  category: string;
  ports: StorePort[];
  volumes: StoreVol[];
  env: StoreEnv[];
  restart: string;
  source: 'unraid' | 'dockerhub';
  stars?: number;
  installed?: boolean;
}

// ─── Unraid CA feed cache ─────────────────────────────────────────────────────

let unraidApps: StoreItem[] = [];
let unraidFetchedAt = 0;
let unraidWarming = false;
const UNRAID_FEED = 'https://assets.ca.unraid.net/feed/applicationFeed.json';
const CACHE_TTL  = 30 * 60 * 1000; // 30 min

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/\r?\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function primaryCategory(catString: string, catMap: Record<string, string>): string {
  // Category field looks like "GameServers: MediaApp:Other" – space-separated tokens
  // where each "Word:" is a category key and "Word:Sub" a sub-category.
  if (!catString) return 'Sonstige';
  const first = catString.trim().split(/\s+/)[0];
  const key = first.replace(/:.*$/, ''); // strip ":Sub" or trailing ":"
  return catMap[key] || key || 'Sonstige';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseConfig(raw: any): { ports: StorePort[]; volumes: StoreVol[]; env: StoreEnv[] } {
  const items: unknown[] = Array.isArray(raw) ? raw : (raw ? [raw] : []);
  const ports: StorePort[] = [];
  const volumes: StoreVol[] = [];
  const env: StoreEnv[] = [];

  for (const c of items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = c as any;
    const attr: Record<string, string> = item['@attributes'] ?? {};
    const type = attr.Type ?? '';
    const target = attr.Target ?? '';
    const def = (attr.Default ?? String(item.value ?? '')).trim();
    const label = attr.Name ?? target ?? 'config';
    const required = attr.Required === 'true';
    const mask = attr.Mask === 'true';

    if (type === 'Port') {
      const cn = parseInt(target, 10);
      if (cn > 0) {
        const hn = parseInt(def, 10) || cn;
        const proto: 'tcp' | 'udp' = attr.Mode?.toLowerCase() === 'udp' ? 'udp' : 'tcp';
        ports.push({ container: cn, host: hn, proto });
      }
    } else if (type === 'Path') {
      if (target) volumes.push({ name: label, path: target });
    } else if (type === 'Variable') {
      if (target) env.push({ key: target, label, default: def, required, secret: mask });
    }
  }
  return { ports, volumes, env };
}

async function warmUnraidCache(): Promise<void> {
  if (unraidWarming) return;
  unraidWarming = true;
  try {
    const res = await fetch(UNRAID_FEED, {
      headers: { 'User-Agent': 'core-hub/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (await res.json()) as any;

    // Build human-readable category map from d.categories
    const catMap: Record<string, string> = {};
    for (const c of data.categories ?? []) {
      const key = String(c.Cat ?? '').replace(/:$/, '');
      if (key) catMap[key] = c.Des;
      for (const sub of c.Sub ?? []) {
        const sk = String(sub.Cat ?? '').replace(/:$/, '');
        if (sk) catMap[sk] = sub.Des;
      }
    }

    const seen = new Set<string>();
    const apps: StoreItem[] = [];
    for (const app of data.applist ?? []) {
      if (!app.Name || !app.Repository) continue;
      let id = slugify(String(app.Name));
      if (seen.has(id)) id = `${id}-${seen.size}`;
      seen.add(id);
      const { ports, volumes, env } = parseConfig(app.Config);
      apps.push({
        id,
        name: String(app.Name),
        image: String(app.Repository),
        icon: String(app.Icon ?? '').replace(/^http:\/\//i, 'https://'),
        description: stripHtml(String(app.Overview ?? '')).slice(0, 500),
        category: primaryCategory(String(app.Category ?? ''), catMap),
        ports,
        volumes,
        env,
        restart: 'unless-stopped',
        source: 'unraid',
      });
    }
    unraidApps = apps;
    unraidFetchedAt = Date.now();
  } finally {
    unraidWarming = false;
  }
}

// ─── Docker Hub proxy ─────────────────────────────────────────────────────────

async function searchDockerHub(q: string, page: number): Promise<{ results: StoreItem[]; total: number }> {
  const url = `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(q)}&page_size=24&page=${page}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'core-hub/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = (await res.json()) as any;
  const results: StoreItem[] = (data.results ?? []).map((r: any) => ({
    id: slugify(r.repo_name),
    name: r.repo_name,
    image: `${r.repo_name}:latest`,
    icon: '',
    description: r.short_description ?? '',
    category: r.is_official ? 'Official' : 'Community',
    ports: [],
    volumes: [],
    env: [],
    restart: 'unless-stopped',
    source: 'dockerhub' as const,
    stars: r.star_count ?? 0,
  }));
  return { results, total: data.count ?? results.length };
}

// ─── Container install (shared) ───────────────────────────────────────────────

async function pullImage(image: string): Promise<void> {
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}

interface InstallBody {
  name?: string;
  image: string;
  ports?: { container: number; host: number; proto?: string }[];
  volumes?: { name: string; path: string }[];
  env?: Record<string, string>;
  restart?: string;
  templateId?: string;
  category?: string;
  icon?: string;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function appTemplateRoutes(fastify: FastifyInstance) {
  // Legacy endpoint (curated list replaced by store – kept for compat)
  fastify.get('/api/app-templates', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({ templates: [] });
  });

  // ── Store: cache status ──
  fastify.get('/api/app-templates/store/status', { preHandler: requireAuth }, async (_req, reply) => {
    reply.send({
      cached: unraidFetchedAt > 0,
      warming: unraidWarming,
      appCount: unraidApps.length,
      fetchedAt: unraidFetchedAt > 0 ? new Date(unraidFetchedAt).toISOString() : null,
    });
  });

  // ── Store: trigger cache warm (admin) ──
  fastify.post('/api/app-templates/store/warm', { preHandler: requireAdmin }, async (_req, reply) => {
    if (!unraidWarming) void warmUnraidCache();
    reply.send({ ok: true, warming: true });
  });

  // ── Store: search ──
  fastify.get<{ Querystring: { q?: string; source?: string; page?: string; category?: string } }>(
    '/api/app-templates/store/search',
    { preHandler: requireAuth },
    async (req, reply) => {
      const q      = (req.query.q ?? '').trim().toLowerCase();
      const source = req.query.source === 'dockerhub' ? 'dockerhub' : 'unraid';
      const page   = Math.max(1, parseInt(req.query.page ?? '1', 10));
      const cat    = (req.query.category ?? '').trim();
      const limit  = 24;

      // ── Docker Hub ──
      if (source === 'dockerhub') {
        if (q.length < 2) return reply.send({ results: [], total: 0, source, cached: true });
        try {
          const { results, total } = await searchDockerHub(q, page);
          return reply.send({ results, total, source, cached: true, page, limit });
        } catch (err) {
          return reply.status(502).send({ error: `Docker Hub nicht erreichbar: ${err instanceof Error ? err.message : ''}` });
        }
      }

      // ── Unraid ──
      const stale = Date.now() - unraidFetchedAt > CACHE_TTL;
      if ((stale || unraidApps.length === 0) && !unraidWarming) void warmUnraidCache();
      if (unraidApps.length === 0) {
        return reply.send({ results: [], total: 0, source, cached: false, warming: unraidWarming });
      }

      // Determine installed images
      let installedImages = new Set<string>();
      try {
        const cs = await docker.listContainers({ all: true });
        installedImages = new Set(cs.map((c) => c.Image));
      } catch { /* docker unavailable */ }

      let filtered = unraidApps;
      if (cat) filtered = filtered.filter((a) => a.category.toLowerCase() === cat.toLowerCase());
      if (q.length >= 2) {
        filtered = filtered.filter((a) =>
          a.name.toLowerCase().includes(q) ||
          a.description.toLowerCase().includes(q) ||
          a.image.toLowerCase().includes(q),
        );
      }

      const total = filtered.length;
      const results = filtered.slice((page - 1) * limit, page * limit)
        .map((a) => ({ ...a, installed: installedImages.has(a.image) }));

      // Distinct categories from current (unfiltered) list for sidebar
      const categories = [...new Set(unraidApps.map((a) => a.category))].sort();

      return reply.send({ results, total, source, cached: true, page, limit, categories });
    },
  );

  // ── Store: install ──
  fastify.post<{ Body: InstallBody }>(
    '/api/app-templates/store/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const body = req.body ?? {} as InstallBody;
      if (!body.image) return reply.status(400).send({ error: 'Image erforderlich' });

      const name = (body.name || body.image.split('/').pop()?.replace(/:.*$/, '') || 'container')
        .replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);

      try {
        await pullImage(body.image);

        const exposedPorts: Record<string, object> = {};
        const portBindings: Record<string, { HostPort: string }[]> = {};
        for (const p of body.ports ?? []) {
          const proto = (p.proto === 'udp' ? 'udp' : 'tcp') as string;
          const key = `${p.container}/${proto}`;
          exposedPorts[key] = {};
          portBindings[key] = [{ HostPort: String(p.host) }];
        }

        const env = Object.entries(body.env ?? {}).map(([k, v]) => `${k}=${v}`);
        const binds = (body.volumes ?? []).map((v) => {
          const safe = v.name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'vol';
          return `${name}_${safe}:${v.path}`;
        });

        const container = await docker.createContainer({
          Image: body.image,
          name,
          Env: env,
          ExposedPorts: exposedPorts,
          HostConfig: {
            PortBindings: portBindings,
            Binds: binds,
            RestartPolicy: { Name: body.restart ?? 'unless-stopped' },
          },
          Labels: {
            'core-hub.template': body.templateId ?? name,
            'core-hub.source': body.templateId ? 'unraid' : 'dockerhub',
          },
        });
        await container.start();
        if (body.category) {
          try { categoryQueries.set.run(container.id, body.category); } catch { /* */ }
        }
        if (body.icon) {
          try { categoryQueries.setIcon.run(container.id, body.icon); } catch { /* */ }
        }
        auditQueries.log.run(req.user.id, 'store.install', body.image);
        void notify('success', `App „${name}" installiert`, `Container „${name}" wurde aus dem Store gestartet.`, 'container');
        reply.status(201).send({ ok: true, id: container.id, name });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Installation fehlgeschlagen' });
      }
    },
  );

  // Legacy per-id install (no-op – curated list removed)
  fastify.post<{ Params: { id: string } }>(
    '/api/app-templates/:id/install',
    { preHandler: requireAdmin },
    async (_req, reply) => {
      reply.status(404).send({ error: 'Kuratierte Vorlagen wurden durch den App-Store ersetzt. Bitte nutze /api/app-templates/store/install.' });
    },
  );
}
