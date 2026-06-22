import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import './types';
import { authRoutes } from './routes/auth';
import { containerRoutes } from './routes/containers';
import { systemRoutes } from './routes/system';
import { cronRoutes } from './routes/cron';
import { vmRoutes } from './routes/vms';

const JWT_SECRET = process.env.JWT_SECRET ?? ('docker-gui-dev-secret-' + Math.random().toString(36));
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

  await fastify.register(fastifyJwt, {
    secret: JWT_SECRET,
    cookie: { cookieName: 'token', signed: false },
  });

  await fastify.register(fastifyCors, {
    origin: IS_DEV ? ['http://localhost:5173'] : false,
    credentials: true,
  });

  await fastify.register(authRoutes);
  await fastify.register(containerRoutes);
  await fastify.register(systemRoutes);
  await fastify.register(cronRoutes);
  await fastify.register(vmRoutes);

  const frontendDist = path.join(__dirname, '../../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    await fastify.register(fastifyStatic, {
      root: frontendDist,
      prefix: '/',
      wildcard: false,
    });
    fastify.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  await fastify.listen({ port: PORT, host: HOST });
  console.log(`\n⬡ Core-Hub running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
