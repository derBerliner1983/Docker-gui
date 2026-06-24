import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { hasBinary, privExec, safeExec } from '../lib/privilege';

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

  // ── Ollama model details (/api/show) ──
  fastify.post<{ Body: { name: string } }>('/api/ki/show', { preHandler: requireAuth }, async (req, reply) => {
    const name = (req.body?.name ?? '').trim();
    if (!name) return reply.status(400).send({ error: 'Kein Modellname' });
    try {
      const r = await ollamaReq('/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, verbose: false }),
      });
      if (!r.ok) return reply.status(404).send({ error: 'Modell nicht gefunden' });
      reply.send(await r.json());
    } catch (err) {
      reply.status(500).send({ error: err instanceof Error ? err.message : 'Fehler' });
    }
  });

  // ── HuggingFace GGUF search proxy ──
  fastify.get<{ Querystring: { q: string } }>('/api/ki/hf-search', { preHandler: requireAuth }, async (req, reply) => {
    const q = (req.query.q ?? '').trim();
    if (q.length < 2) return reply.send({ models: [] });
    try {
      const url = `https://huggingface.co/api/models?search=${encodeURIComponent(q)}&filter=gguf&sort=downloads&direction=-1&limit=24`;
      const r = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'Core-Hub/1.0', 'Accept': 'application/json' },
      });
      if (!r.ok) return reply.send({ models: [] });
      const data = await r.json() as Array<{
        id: string; author: string; downloads: number; likes: number;
        lastModified: string; pipeline_tag?: string; tags?: string[];
      }>;
      reply.send({
        models: data.map((m) => ({
          id: m.id, author: m.author, downloads: m.downloads, likes: m.likes,
          lastModified: m.lastModified, pipeline_tag: m.pipeline_tag, tags: m.tags ?? [],
        })),
      });
    } catch {
      reply.send({ models: [] });
    }
  });

  // ── Hardware info + AI recommendations ──
  fastify.get('/api/ki/hardware', { preHandler: requireAuth }, async (_req, reply) => {
    const memInfo = safeExec('cat /proc/meminfo 2>/dev/null');
    const totalKb = parseInt(memInfo.match(/MemTotal:\s+(\d+)/)?.[1] ?? '0');
    const totalGb = Math.round(totalKb / 1024 / 1024 * 10) / 10;

    const gpus: Array<{ name: string; vramMb: number }> = [];
    const nv = safeExec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits 2>/dev/null');
    if (nv.trim()) {
      for (const line of nv.trim().split('\n')) {
        const parts = line.split(',').map((s) => s.trim());
        if (parts[0]) gpus.push({ name: parts[0], vramMb: parseInt(parts[1] ?? '0') || 0 });
      }
    }

    const vramGb = (gpus[0]?.vramMb ?? 0) / 1024;
    let recommendation = '';
    let maxModelGb = 0;

    if (vramGb >= 24) { recommendation = `GPU mit ${vramGb.toFixed(0)} GB VRAM – 70B Modelle möglich`; maxModelGb = 40; }
    else if (vramGb >= 16) { recommendation = `GPU mit ${vramGb.toFixed(0)} GB VRAM – bis 30B Modelle`; maxModelGb = 20; }
    else if (vramGb >= 8)  { recommendation = `GPU mit ${vramGb.toFixed(0)} GB VRAM – 7B Modelle ideal`; maxModelGb = 6; }
    else if (vramGb >= 4)  { recommendation = `GPU mit ${vramGb.toFixed(0)} GB VRAM – bis 3B Modelle`; maxModelGb = 3; }
    else if (totalGb >= 64) { recommendation = `${totalGb} GB RAM – bis 30B Modelle (CPU)`; maxModelGb = 24; }
    else if (totalGb >= 32) { recommendation = `${totalGb} GB RAM – bis 13B Modelle (CPU)`; maxModelGb = 10; }
    else if (totalGb >= 16) { recommendation = `${totalGb} GB RAM – 7B Modelle empfohlen (CPU)`; maxModelGb = 6; }
    else if (totalGb >= 8)  { recommendation = `${totalGb} GB RAM – bis 3B, max. 7B (langsam, CPU)`; maxModelGb = 4; }
    else                     { recommendation = `${totalGb} GB RAM – nur 1–3B Modelle`; maxModelGb = 2; }

    reply.send({ totalRamGb: totalGb, gpus, recommendation, maxModelGb });
  });
}
