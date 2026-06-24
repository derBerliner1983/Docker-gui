import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { hasBinary, privExec } from '../lib/privilege';

const OLLAMA = 'http://127.0.0.1:11434';

async function ollamaReq(path: string, init?: RequestInit) {
  return fetch(`${OLLAMA}${path}`, { signal: AbortSignal.timeout(10000), ...init });
}

export async function kiRoutes(fastify: FastifyInstance) {

  fastify.get('/api/ki/status', { preHandler: requireAuth }, async (_req, reply) => {
    const installed = hasBinary('ollama');
    if (!installed) return reply.send({ installed: false, running: false, version: null, port: 11434 });

    let running = false;
    try { const r = await ollamaReq('/'); running = r.status < 500; } catch { /* not running */ }

    const version = (await import('../lib/privilege')).safeExec('ollama --version 2>/dev/null')
      .trim().replace(/^ollama\s+version\s*/i, '') || null;

    reply.send({ installed, running, version, port: 11434 });
  });

  fastify.get('/api/ki/models', { preHandler: requireAuth }, async (_req, reply) => {
    if (!hasBinary('ollama')) return reply.send({ models: [] });
    try {
      const r = await ollamaReq('/api/tags');
      if (!r.ok) return reply.send({ models: [] });
      reply.send(await r.json());
    } catch { reply.send({ models: [] }); }
  });

  fastify.post<{ Body: { model: string } }>('/api/ki/pull', { preHandler: requireAdmin }, async (req, reply) => {
    const model = (req.body?.model ?? '').trim();
    if (!model || !/^[a-zA-Z0-9._:/@-]+$/.test(model)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    const proc = spawn('ollama', ['pull', model], { detached: true, stdio: 'ignore' });
    proc.unref();
    reply.send({ ok: true, queued: true });
  });

  fastify.delete<{ Params: { name: string } }>('/api/ki/models/:name', { preHandler: requireAdmin }, async (req, reply) => {
    const name = decodeURIComponent(req.params.name);
    if (!name || !/^[a-zA-Z0-9._:/@-]+$/.test(name)) return reply.status(400).send({ error: 'Ungültiger Modellname' });
    try {
      const r = await ollamaReq('/api/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({})) as { error?: string };
        return reply.status(500).send({ error: b.error ?? 'Löschen fehlgeschlagen' });
      }
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Löschen fehlgeschlagen' });
    }
  });

  fastify.post<{ Body: { action: 'start' | 'stop' } }>('/api/ki/control', { preHandler: requireAdmin }, async (req, reply) => {
    const action = req.body?.action;
    if (!['start', 'stop'].includes(action)) return reply.status(400).send({ error: 'Ungültige Aktion' });
    try {
      privExec(`systemctl ${action} ollama`, { timeout: 15000 });
      reply.send({ ok: true });
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Steuerung fehlgeschlagen' });
    }
  });
}
