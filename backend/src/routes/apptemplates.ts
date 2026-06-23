import type { FastifyInstance } from 'fastify';
import Dockerode from 'dockerode';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { auditQueries, categoryQueries } from '../db/index';
import { notify } from '../lib/notify';

const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

interface TemplateEnv { key: string; label: string; default?: string; required?: boolean; secret?: boolean }
interface TemplatePort { container: number; host: number; proto?: 'tcp' | 'udp' }
interface TemplateVol { name: string; path: string }
interface AppTemplate {
  id: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  image: string;
  ports: TemplatePort[];
  volumes?: TemplateVol[];
  env?: TemplateEnv[];
  restart?: string;
  note?: string;
}

// Curated catalog of popular self-hosted services (1-click install).
const TEMPLATES: AppTemplate[] = [
  {
    id: 'nextcloud', name: 'Nextcloud', category: 'Cloud', icon: '☁️',
    description: 'Eigene Cloud für Dateien, Kalender & Kontakte.',
    image: 'nextcloud:latest', ports: [{ container: 80, host: 8080 }],
    volumes: [{ name: 'data', path: '/var/www/html' }], restart: 'unless-stopped',
  },
  {
    id: 'jellyfin', name: 'Jellyfin', category: 'Medien', icon: '🎬',
    description: 'Freier Media-Server für Filme, Serien & Musik.',
    image: 'jellyfin/jellyfin:latest', ports: [{ container: 8096, host: 8096 }],
    volumes: [{ name: 'config', path: '/config' }, { name: 'media', path: '/media' }], restart: 'unless-stopped',
  },
  {
    id: 'plex', name: 'Plex', category: 'Medien', icon: '🍿',
    description: 'Beliebter Media-Server mit Apps für alle Geräte.',
    image: 'plexinc/pms-docker:latest', ports: [{ container: 32400, host: 32400 }],
    volumes: [{ name: 'config', path: '/config' }, { name: 'media', path: '/data' }],
    env: [{ key: 'PLEX_CLAIM', label: 'Claim-Token (plex.tv/claim)', required: false }], restart: 'unless-stopped',
  },
  {
    id: 'portainer', name: 'Portainer', category: 'Verwaltung', icon: '🐳',
    description: 'Docker-Management-Oberfläche.',
    image: 'portainer/portainer-ce:latest', ports: [{ container: 9000, host: 9000 }],
    volumes: [{ name: 'data', path: '/data' }], restart: 'unless-stopped',
    note: 'Benötigt Zugriff auf den Docker-Socket – nach Installation ggf. /var/run/docker.sock einbinden.',
  },
  {
    id: 'pihole', name: 'Pi-hole', category: 'Netzwerk', icon: '🛡️',
    description: 'Netzwerkweiter Werbe- & Tracker-Blocker (DNS).',
    image: 'pihole/pihole:latest', ports: [{ container: 53, host: 53, proto: 'tcp' }, { container: 53, host: 53, proto: 'udp' }, { container: 80, host: 8081 }],
    volumes: [{ name: 'etc', path: '/etc/pihole' }, { name: 'dnsmasq', path: '/etc/dnsmasq.d' }],
    env: [{ key: 'WEBPASSWORD', label: 'Web-Passwort', required: true, secret: true }, { key: 'TZ', label: 'Zeitzone', default: 'Europe/Berlin' }], restart: 'unless-stopped',
  },
  {
    id: 'adguard', name: 'AdGuard Home', category: 'Netzwerk', icon: '🚫',
    description: 'DNS-basierter Werbeblocker mit moderner Oberfläche.',
    image: 'adguard/adguardhome:latest', ports: [{ container: 53, host: 53, proto: 'udp' }, { container: 3000, host: 3001 }],
    volumes: [{ name: 'work', path: '/opt/adguardhome/work' }, { name: 'conf', path: '/opt/adguardhome/conf' }], restart: 'unless-stopped',
  },
  {
    id: 'vaultwarden', name: 'Vaultwarden', category: 'Sicherheit', icon: '🔐',
    description: 'Leichtgewichtiger Bitwarden-kompatibler Passwort-Manager.',
    image: 'vaultwarden/server:latest', ports: [{ container: 80, host: 8082 }],
    volumes: [{ name: 'data', path: '/data' }], restart: 'unless-stopped',
  },
  {
    id: 'uptimekuma', name: 'Uptime Kuma', category: 'Monitoring', icon: '📈',
    description: 'Self-hosted Monitoring & Status-Seite.',
    image: 'louislam/uptime-kuma:latest', ports: [{ container: 3001, host: 3002 }],
    volumes: [{ name: 'data', path: '/app/data' }], restart: 'unless-stopped',
  },
  {
    id: 'grafana', name: 'Grafana', category: 'Monitoring', icon: '📊',
    description: 'Dashboards & Visualisierung für Metriken.',
    image: 'grafana/grafana:latest', ports: [{ container: 3000, host: 3003 }],
    volumes: [{ name: 'data', path: '/var/lib/grafana' }], restart: 'unless-stopped',
  },
  {
    id: 'gitea', name: 'Gitea', category: 'Entwicklung', icon: '🍵',
    description: 'Leichtgewichtiger, self-hosted Git-Server.',
    image: 'gitea/gitea:latest', ports: [{ container: 3000, host: 3004 }, { container: 22, host: 2222 }],
    volumes: [{ name: 'data', path: '/data' }], restart: 'unless-stopped',
  },
  {
    id: 'homeassistant', name: 'Home Assistant', category: 'Smart Home', icon: '🏠',
    description: 'Zentrale für Smart-Home-Automatisierung.',
    image: 'ghcr.io/home-assistant/home-assistant:stable', ports: [{ container: 8123, host: 8123 }],
    volumes: [{ name: 'config', path: '/config' }], restart: 'unless-stopped',
  },
  {
    id: 'qbittorrent', name: 'qBittorrent', category: 'Downloads', icon: '⬇️',
    description: 'BitTorrent-Client mit Web-Oberfläche.',
    image: 'lscr.io/linuxserver/qbittorrent:latest', ports: [{ container: 8080, host: 8083 }],
    volumes: [{ name: 'config', path: '/config' }, { name: 'downloads', path: '/downloads' }],
    env: [{ key: 'TZ', label: 'Zeitzone', default: 'Europe/Berlin' }, { key: 'WEBUI_PORT', label: 'WebUI-Port', default: '8080' }], restart: 'unless-stopped',
  },
];

async function pullImage(image: string): Promise<void> {
  const stream = await docker.pull(image);
  await new Promise<void>((resolve, reject) => {
    docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
  });
}

export async function appTemplateRoutes(fastify: FastifyInstance) {
  fastify.get('/api/app-templates', { preHandler: requireAuth }, async (_req, reply) => {
    let installedImages = new Set<string>();
    let installedNames = new Set<string>();
    try {
      const containers = await docker.listContainers({ all: true });
      installedImages = new Set(containers.map((c) => c.Image));
      installedNames = new Set(containers.flatMap((c) => c.Names.map((n) => n.replace(/^\//, ''))));
    } catch { /* docker unavailable */ }
    const templates = TEMPLATES.map((t) => ({
      ...t,
      installed: installedImages.has(t.image) || installedNames.has(t.id),
    }));
    reply.send({ templates });
  });

  fastify.post<{ Params: { id: string }; Body: { name?: string; env?: Record<string, string>; ports?: Record<string, number> } }>(
    '/api/app-templates/:id/install',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const tpl = TEMPLATES.find((t) => t.id === req.params.id);
      if (!tpl) return reply.status(404).send({ error: 'Vorlage nicht gefunden' });
      const body = req.body ?? {};
      const name = (body.name || tpl.id).replace(/[^a-zA-Z0-9._-]/g, '_');

      // Validate required env
      for (const e of tpl.env ?? []) {
        if (e.required && !(body.env?.[e.key] || e.default)) {
          return reply.status(400).send({ error: `Feld „${e.label}" ist erforderlich` });
        }
      }

      try {
        await pullImage(tpl.image);

        const exposedPorts: Record<string, object> = {};
        const portBindings: Record<string, { HostPort: string }[]> = {};
        for (const p of tpl.ports) {
          const proto = p.proto ?? 'tcp';
          const hostPort = body.ports?.[`${p.container}/${proto}`] ?? p.host;
          const key = `${p.container}/${proto}`;
          exposedPorts[key] = {};
          portBindings[key] = [{ HostPort: String(hostPort) }];
        }

        const env = (tpl.env ?? []).map((e) => `${e.key}=${body.env?.[e.key] ?? e.default ?? ''}`);
        const binds = (tpl.volumes ?? []).map((v) => `${tpl.id}_${v.name}:${v.path}`);

        const container = await docker.createContainer({
          Image: tpl.image,
          name,
          Env: env,
          ExposedPorts: exposedPorts,
          HostConfig: {
            PortBindings: portBindings,
            Binds: binds,
            RestartPolicy: { Name: tpl.restart ?? 'unless-stopped' },
          },
          Labels: { 'core-hub.template': tpl.id },
        });
        await container.start();
        try { categoryQueries.set.run(container.id, tpl.category); } catch { /* */ }

        auditQueries.log.run(req.user.id, 'apptemplate.install', tpl.id);
        void notify('success', `App „${tpl.name}" installiert`, `Container „${name}" wurde aus der Vorlage gestartet.`, 'container');
        reply.status(201).send({ ok: true, id: container.id, name });
      } catch (err: unknown) {
        reply.status(500).send({ error: err instanceof Error ? err.message : 'Installation fehlgeschlagen' });
      }
    }
  );
}
