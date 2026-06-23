import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { userQueries, auditQueries } from '../db/index';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { generateSecret, verifyToken, otpauthUrl } from '../lib/totp';

export async function authRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: { username: string; password: string; token?: string } }>('/api/auth/login', async (req, reply) => {
    const { username, password, token: otp } = req.body ?? {};
    if (!username || !password) {
      return reply.status(400).send({ error: 'Username and password required' });
    }

    const user = userQueries.getByUsername.get(username);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Second factor (TOTP) if enabled for this account
    if (user.totp_enabled && user.totp_secret) {
      if (!otp) {
        return reply.send({ totpRequired: true });
      }
      if (!verifyToken(user.totp_secret, otp)) {
        return reply.status(401).send({ error: 'Ungültiger 2FA-Code', totpRequired: true });
      }
    }

    const token = fastify.jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      { expiresIn: '7d' }
    );

    auditQueries.log.run(user.id, 'login', null);

    reply
      .setCookie('token', token, {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60,
        path: '/',
      })
      .send({ user: { id: user.id, username: user.username, role: user.role }, token });
  });

  fastify.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie('token', { path: '/' }).send({ ok: true });
  });

  fastify.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    reply.send({ user: { ...req.user, totpEnabled: !!user?.totp_enabled } });
  });

  fastify.get('/api/users', { preHandler: requireAdmin }, async (_req, reply) => {
    reply.send({ users: userQueries.getAll.all() });
  });

  fastify.post<{ Body: { username: string; password: string; role: string } }>(
    '/api/users',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { username, password, role } = req.body ?? {};
      if (!username || !password) return reply.status(400).send({ error: 'Username and password required' });
      try {
        const hash = bcrypt.hashSync(password, 10);
        userQueries.create.run(username, hash, role || 'viewer');
        reply.status(201).send({ ok: true });
      } catch (err: unknown) {
        reply.status(400).send({ error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/users/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const id = parseInt(req.params.id);
      if (id === req.user.id) return reply.status(400).send({ error: 'Cannot delete yourself' });
      userQueries.delete.run(id);
      reply.send({ ok: true });
    }
  );

  fastify.post<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/change-password',
    { preHandler: requireAuth },
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body ?? {};
      const user = userQueries.getByUsername.get(req.user.username);
      if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
        return reply.status(401).send({ error: 'Current password incorrect' });
      }
      const hash = bcrypt.hashSync(newPassword, 10);
      userQueries.changePassword.run(hash, user.id);
      reply.send({ ok: true });
    }
  );

  // ── Two-factor authentication (TOTP) ──
  fastify.get('/api/auth/2fa/status', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    reply.send({ enabled: !!user?.totp_enabled });
  });

  // Generate a fresh secret (not yet active until verified)
  fastify.post('/api/auth/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const secret = generateSecret();
    userQueries.setTotpSecret.run(secret, req.user.id);
    userQueries.setTotpEnabled.run(0, req.user.id);
    reply.send({ secret, otpauth: otpauthUrl(secret, req.user.username) });
  });

  // Activate 2FA by confirming a valid code
  fastify.post<{ Body: { token: string } }>('/api/auth/2fa/enable', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    if (!user?.totp_secret) return reply.status(400).send({ error: 'Bitte zuerst 2FA einrichten' });
    if (!verifyToken(user.totp_secret, req.body?.token ?? '')) {
      return reply.status(400).send({ error: 'Ungültiger Code – bitte erneut versuchen' });
    }
    userQueries.setTotpEnabled.run(1, req.user.id);
    auditQueries.log.run(req.user.id, '2fa.enable', null);
    reply.send({ ok: true });
  });

  // Disable 2FA (requires current password)
  fastify.post<{ Body: { password: string } }>('/api/auth/2fa/disable', { preHandler: requireAuth }, async (req, reply) => {
    const user = userQueries.getById.get(req.user.id);
    if (!user || !bcrypt.compareSync(req.body?.password ?? '', user.password_hash)) {
      return reply.status(401).send({ error: 'Passwort falsch' });
    }
    userQueries.setTotpEnabled.run(0, req.user.id);
    userQueries.setTotpSecret.run(null, req.user.id);
    auditQueries.log.run(req.user.id, '2fa.disable', null);
    reply.send({ ok: true });
  });
}
