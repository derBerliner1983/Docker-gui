import type { FastifyInstance } from 'fastify';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { notificationQueries, notifyConfigQueries, auditQueries } from '../db/index';
import { notify } from '../lib/notify';

export async function notificationRoutes(fastify: FastifyInstance) {
  fastify.get('/api/notifications', { preHandler: requireAuth }, async (_req, reply) => {
    const cfg = notifyConfigQueries.get.get();
    reply.send({
      notifications: notificationQueries.recent.all(),
      unread: notificationQueries.unreadCount.get()?.n ?? 0,
      config: {
        webhookUrl: cfg?.webhook_url ?? '',
        emailTo: cfg?.email_to ?? '',
        onBackup: (cfg?.on_backup ?? 1) === 1,
        onSecurity: (cfg?.on_security ?? 1) === 1,
        onContainer: (cfg?.on_container ?? 1) === 1,
        onAntivirus: (cfg?.on_antivirus ?? 1) === 1,
      },
    });
  });

  fastify.post('/api/notifications/read', { preHandler: requireAuth }, async (_req, reply) => {
    notificationQueries.markAllRead.run();
    reply.send({ ok: true });
  });

  fastify.delete('/api/notifications', { preHandler: requireAuth }, async (_req, reply) => {
    notificationQueries.clear.run();
    reply.send({ ok: true });
  });

  fastify.post<{ Body: { webhookUrl?: string; emailTo?: string; onBackup?: boolean; onSecurity?: boolean; onContainer?: boolean; onAntivirus?: boolean } }>(
    '/api/notifications/config',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const b = req.body ?? {};
      notifyConfigQueries.update.run(
        b.webhookUrl?.trim() || null,
        b.emailTo?.trim() || null,
        b.onBackup === false ? 0 : 1,
        b.onSecurity === false ? 0 : 1,
        b.onContainer === false ? 0 : 1,
        b.onAntivirus === false ? 0 : 1,
      );
      auditQueries.log.run(req.user.id, 'notifications.config', null);
      reply.send({ ok: true });
    }
  );

  fastify.post('/api/notifications/test', { preHandler: requireAdmin }, async (req, reply) => {
    await notify('info', 'Test-Benachrichtigung', 'Wenn du das siehst, funktionieren die Benachrichtigungen von Core-Hub.', 'test');
    auditQueries.log.run(req.user.id, 'notifications.test', null);
    reply.send({ ok: true });
  });
}
