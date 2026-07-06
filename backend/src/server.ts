import crypto from 'node:crypto';
import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import path from 'path';
import fs from 'fs';
import './types';
import { auditQueries } from './db/index';
import { APP_VERSION } from './routes/settings';
import { authRoutes } from './routes/auth';
import { containerRoutes } from './routes/containers';
import { systemRoutes } from './routes/system';
import { cronRoutes } from './routes/cron';
import { vmRoutes } from './routes/vms';
import { updateRoutes } from './routes/updates';
import { packageRoutes } from './routes/packages';
import { backupRoutes } from './routes/backups';
import { shareRoutes } from './routes/shares';
import { linuxUserRoutes } from './routes/linuxusers';
import { proxyRoutes } from './routes/proxy';
import { settingsRoutes } from './routes/settings';
import { networkRoutes } from './routes/networks';
import { firewallRoutes, ensureLanWebAccess } from './routes/firewall';
import { securityRoutes } from './routes/security';
import { vmNetworkRoutes } from './routes/vmnetworks';
import { imageUpdateRoutes } from './routes/imageupdates';
import { antivirusRoutes } from './routes/antivirus';
import { notificationRoutes } from './routes/notifications';
import { appTemplateRoutes } from './routes/apptemplates';
import { alertRoutes } from './routes/alerts';
import { terminalRoutes } from './routes/terminal';
import { fileRoutes } from './routes/files';
import { kiRoutes } from './routes/ki';
import { voiceRoutes } from './routes/voice';
import { prefsRoutes } from './routes/prefs';
import { sshRoutes } from './routes/ssh';
import { netscanRoutes } from './routes/netscan';
import { runDueSchedules } from './routes/backups';
import { startDockerWatcher } from './lib/dockerwatch';
import { startAlertMonitor } from './lib/alertmonitor';
import { startFirewallLogIngest } from './lib/firewalllog';

// JWT_SECRET kommt im Produktivbetrieb aus der Env-Datei (install.sh erzeugt
// einen dauerhaften, starken Schlüssel). Fällt der weg, wird ein kryptografisch
// starker Zufallswert genutzt (statt des früheren schwachen Math.random).
const JWT_SECRET = process.env.JWT_SECRET ?? crypto.randomBytes(48).toString('hex');
const PORT = parseInt(process.env.PORT ?? '4200');
const HOST = process.env.HOST ?? '0.0.0.0';
const IS_DEV = process.env.NODE_ENV !== 'production';

const fastify = Fastify({
  logger: IS_DEV
    ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
    : true,
});

async function main() {
  await fastify.register(fastifyCookie);
  await fastify.register(fastifyMultipart, { limits: { fileSize: 2 * 1024 * 1024 * 1024 } });
  await fastify.register(fastifyWebsocket);

  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  await fastify.register(fastifyCors, {
    origin: IS_DEV ? ['http://localhost:5173'] : false,
    credentials: true,
  });

  // Health check endpoint (no auth required – for monitoring tools)
  fastify.get('/health', async (_req, reply) => {
    reply.send({ ok: true, version: APP_VERSION, uptime: Math.floor(process.uptime()), ts: new Date().toISOString() });
  });

  await fastify.register(authRoutes);
  await fastify.register(containerRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(cronRoutes);
  await fastify.register(vmRoutes);
  await fastify.register(updateRoutes);
  await fastify.register(packageRoutes);
  await fastify.register(backupRoutes);
  await fastify.register(shareRoutes);
  await fastify.register(linuxUserRoutes);
  await fastify.register(proxyRoutes);
  await fastify.register(settingsRoutes);
  await fastify.register(networkRoutes);
  await fastify.register(firewallRoutes);
  await fastify.register(securityRoutes);
  await fastify.register(vmNetworkRoutes);
  await fastify.register(imageUpdateRoutes);
  await fastify.register(antivirusRoutes);
  await fastify.register(notificationRoutes);
  await fastify.register(appTemplateRoutes);
  await fastify.register(alertRoutes);
  await fastify.register(terminalRoutes);
  await fastify.register(fileRoutes);
  await fastify.register(kiRoutes);
  await fastify.register(voiceRoutes);
  await fastify.register(prefsRoutes);
  await fastify.register(sshRoutes);
  await fastify.register(netscanRoutes);

  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    // SPA-Fallback NUR für echte Navigationsanfragen (HTML). Fehlende Assets
    // (/assets/*, *.js, *.css, /api/*) dürfen NICHT index.html zurückgeben –
    // sonst bekommt der Browser HTML als JS-Modul ("MIME type text/html") und
    // die Seite bleibt weiß. Stattdessen ein ehrlicher 404.
    fastify.setNotFoundHandler((req, reply) => {
      const url = req.url.split('?')[0];
      const accepts = (req.headers['accept'] || '').includes('text/html');
      const looksLikeFile = /\.[a-zA-Z0-9]+$/.test(url);
      if (req.method !== 'GET' || url.startsWith('/api/') || url.startsWith('/assets/') || looksLikeFile || !accepts) {
        reply.status(404).send({ error: 'Not found', path: url });
        return;
      }
      reply.type('text/html').sendFile('index.html');
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`\n⬡ Core-Hub running at http://localhost:${PORT} (proxied via Caddy → https)\n`);

  // Backup scheduler – check every 30s for due cron-based schedules
  setInterval(() => { void runDueSchedules(); }, 30_000);

  // Audit-log rotation – delete entries older than 90 days, runs daily
  const pruneAuditLog = () => {
    try {
      auditQueries.pruneOld.run();
    } catch { /* non-critical */ }
  };
  pruneAuditLog();
  setInterval(pruneAuditLog, 24 * 60 * 60 * 1000);

  // Watch Docker for unexpected container deaths and notify
  startDockerWatcher();

  // Security/System-Alarme periodisch auswerten (E-Mail bei Auffälligkeiten)
  startAlertMonitor();

  // Firewall-Verbindungsprotokoll periodisch in die DB einlesen
  startFirewallLogIngest();

  // Sicherstellen, dass die Web-Oberfläche/SSH immer aus dem LAN erreichbar bleibt
  try { ensureLanWebAccess(); } catch { /* */ }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
