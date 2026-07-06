import type { FastifyInstance } from 'fastify';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { isRoot } from '../lib/privilege';
import { appSettingsQueries } from '../db/index';

// ── lokaler Voice-Daemon (Whisper STT + Piper TTS) ───────────────────────────────
const VOICE_PORT = process.env.VOICE_PORT || '11435';
const DAEMON = `http://127.0.0.1:${VOICE_PORT}`;
const OLLAMA = 'http://127.0.0.1:11434';

interface VoiceConfig {
  enabled: boolean;
  wakeword: string;
  lang: 'de' | 'en' | 'th';
  tts: boolean;
}

function readConfig(): VoiceConfig {
  const g = (k: string) => appSettingsQueries.get.get(k)?.value;
  const lang = (g('voice_lang') as VoiceConfig['lang']) || 'de';
  return {
    enabled: g('voice_enabled') === '1',
    wakeword: (g('voice_wakeword') || 'computer').trim(),
    lang: (['de', 'en', 'th'].includes(lang) ? lang : 'de') as VoiceConfig['lang'],
    tts: g('voice_tts') !== '0',
  };
}

async function daemonHealth(): Promise<{ ok: boolean; stt: boolean; tts: boolean; voices: string[]; model?: string }> {
  try {
    const r = await fetch(`${DAEMON}/health`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { ok: false, stt: false, tts: false, voices: [] };
    return await r.json() as { ok: boolean; stt: boolean; tts: boolean; voices: string[]; model?: string };
  } catch {
    return { ok: false, stt: false, tts: false, voices: [] };
  }
}

async function transcribe(pcm: Buffer, lang: string): Promise<string> {
  const r = await fetch(`${DAEMON}/transcribe?lang=${encodeURIComponent(lang)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: pcm,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`STT ${r.status}`);
  const j = await r.json() as { text?: string };
  return (j.text || '').trim();
}

async function tts(text: string, lang: string): Promise<Buffer | null> {
  try {
    const r = await fetch(`${DAEMON}/tts?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: Buffer.from(text, 'utf-8'),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return null; // z.B. keine Stimme für die Sprache → nur Text
    return Buffer.from(await r.arrayBuffer());
  } catch {
    return null;
  }
}

/** Aktuell in den Speicher geladenes Ollama-Modell (oder null). */
async function loadedModel(): Promise<string | null> {
  try {
    const r = await fetch(`${OLLAMA}/api/ps`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const j = await r.json() as { models?: { name: string }[] };
    return j.models?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

// Kurze Bestätigungsfloskel je Sprache (wird für sofortiges Feedback gecacht)
const ACK_PHRASE: Record<string, string> = {
  de: 'Einen Moment.',
  en: 'One moment.',
  th: 'สักครู่นะคะ',
};
const ackCache = new Map<string, Buffer | null>();
async function ackAudio(lang: string): Promise<Buffer | null> {
  if (ackCache.has(lang)) return ackCache.get(lang) ?? null;
  const buf = await tts(ACK_PHRASE[lang] || ACK_PHRASE.de, lang);
  ackCache.set(lang, buf);
  return buf;
}

/**
 * Ollama /api/chat streamen und satzweise zurückgeben. Nach jedem abgeschlossenen
 * Satz wird onSentence() aufgerufen – so kann sofort mit dem Vorlesen begonnen
 * werden, ohne auf die komplette Antwort zu warten.
 */
async function chatStream(
  model: string,
  userText: string,
  lang: string,
  onToken: (t: string) => void,
  onSentence: (s: string) => Promise<void>,
): Promise<string> {
  const sys = {
    de: 'Du bist ein hilfreicher Sprachassistent. Antworte sehr kurz, in ein bis zwei Sätzen, klar gesprochen und ohne Aufzählungen oder Sonderzeichen.',
    en: 'You are a helpful voice assistant. Answer very briefly, in one or two spoken sentences, no lists or special characters.',
    th: 'คุณเป็นผู้ช่วยด้วยเสียงที่เป็นประโยชน์ ตอบสั้นๆ หนึ่งถึงสองประโยค',
  }[lang] || '';

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: sys }, { role: 'user', content: userText }],
      stream: true,
      options: { num_predict: 220, temperature: 0.4 },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`Ollama ${res.status}`);

  const decoder = new TextDecoder();
  let buf = '';        // Zeilenpuffer (NDJSON)
  let sentence = '';   // aktueller Satzpuffer
  let full = '';

  const flush = async (force = false) => {
    const s = sentence.trim();
    if (s && (force || /[.!?…。！？\n]$/.test(sentence) ) && s.length >= 2) {
      sentence = '';
      await onSentence(s);
    }
  };

  for await (const chunk of res.body as AsyncIterable<Buffer>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj: { message?: { content?: string }; done?: boolean };
      try { obj = JSON.parse(line); } catch { continue; }
      const piece = obj.message?.content || '';
      if (piece) { full += piece; sentence += piece; onToken(piece); await flush(); }
      if (obj.done) { await flush(true); }
    }
  }
  await flush(true);
  return full.trim();
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[.,!?;:„"“”'’()\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Selbst-Installation des Sprachdienstes über install.sh (--voice) ──────────────
// Läuft im Hintergrund; /bin/bash ist in der sudoers-Allowlist, daher braucht das
// Verwaltungstool dafür keine Shell vom Benutzer.
const install = { running: false, log: '', error: '' as string | null, startedAt: 0 };

function installScriptPath(): string | null {
  for (const p of [
    path.resolve(process.cwd(), '..', 'install.sh'),
    '/opt/core-hub/install.sh',
    path.resolve(__dirname, '../../../install.sh'),
  ]) {
    try { if (fs.existsSync(p)) return p; } catch { /* */ }
  }
  return null;
}

function startVoiceInstall(): { started: boolean; error?: string } {
  if (install.running) return { started: true };
  const script = installScriptPath();
  if (!script) return { started: false, error: 'install.sh nicht gefunden' };
  install.running = true; install.log = ''; install.error = null; install.startedAt = Date.now();
  const bin = isRoot ? '/bin/bash' : 'sudo';
  const args = isRoot ? [script, '--voice'] : ['-n', '/bin/bash', script, '--voice'];
  let child;
  try {
    child = spawn(bin, args, { cwd: path.dirname(script) });
  } catch (e) {
    install.running = false; install.error = e instanceof Error ? e.message : 'Start fehlgeschlagen';
    return { started: false, error: install.error };
  }
  const append = (d: Buffer) => { install.log = (install.log + d.toString()).slice(-6000); };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('close', (code) => {
    install.running = false;
    install.error = code === 0 ? null : `Installation fehlgeschlagen (Code ${code}). Details siehe Log.`;
  });
  child.on('error', (e) => { install.running = false; install.error = e.message; });
  return { started: true };
}

export async function voiceRoutes(fastify: FastifyInstance) {

  // Roh-Audio (int16 PCM) für /api/voice/stt-once als Buffer entgegennehmen
  fastify.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  // ── Konfiguration + Verfügbarkeit ──
  fastify.get('/api/voice/config', { preHandler: requireAuth }, async (_req, reply) => {
    const cfg = readConfig();
    const health = await daemonHealth();
    const model = await loadedModel();
    reply.send({
      ...cfg,
      available: { daemon: health.ok, stt: health.stt, tts: health.tts, voices: health.voices, model: health.model },
      model,
      install: { running: install.running, error: install.error, log: install.log.slice(-1200) },
    });
  });

  // Sprachdienst über das Verwaltungstool installieren (Hintergrund)
  fastify.post('/api/voice/install', { preHandler: requireAdmin }, async (_req, reply) => {
    const r = startVoiceInstall();
    if (!r.started) return reply.status(500).send({ error: r.error || 'Start fehlgeschlagen' });
    reply.send({ ok: true, running: install.running });
  });

  // Einmalige Transkription (z.B. um das Weckwort einzusprechen)
  fastify.post('/api/voice/stt-once', { preHandler: requireAuth, bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const lang = (typeof (req.query as { lang?: string })?.lang === 'string' ? (req.query as { lang?: string }).lang : 'de') as string;
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length < 200) return reply.status(400).send({ error: 'Kein Audio empfangen' });
    try {
      const text = await transcribe(body, lang);
      reply.send({ text });
    } catch (e) {
      reply.status(500).send({ error: e instanceof Error ? e.message : 'STT fehlgeschlagen' });
    }
  });

  fastify.get('/api/voice/install/status', { preHandler: requireAuth }, async (_req, reply) => {
    const health = await daemonHealth();
    reply.send({ running: install.running, error: install.error, log: install.log.slice(-4000), daemon: health.ok });
  });

  fastify.post<{ Body: Partial<VoiceConfig> }>('/api/voice/config', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body || {};
    if (typeof b.enabled === 'boolean') appSettingsQueries.set.run('voice_enabled', b.enabled ? '1' : '0');
    if (typeof b.tts === 'boolean') appSettingsQueries.set.run('voice_tts', b.tts ? '1' : '0');
    if (typeof b.wakeword === 'string') {
      const w = b.wakeword.trim().slice(0, 40);
      if (w) appSettingsQueries.set.run('voice_wakeword', w);
    }
    if (b.lang && ['de', 'en', 'th'].includes(b.lang)) appSettingsQueries.set.run('voice_lang', b.lang);
    ackCache.clear(); // Sprache evtl. geändert → Bestätigungs-Audio neu erzeugen
    reply.send(readConfig());
  });

  // ── Live-Pipeline (WebSocket): Audio rein, Text/Audio raus ──
  fastify.get('/api/voice/ws', { websocket: true }, (ws, req) => {
    void (async () => {
      try { await req.jwtVerify(); } catch { ws.close(1008, 'Unauthorized'); return; }

      const send = (obj: unknown) => { try { ws.send(JSON.stringify(obj)); } catch { /* */ } };
      let awake = false;
      let awakeTimer: ReturnType<typeof setTimeout> | null = null;
      let processing = false;

      const cfg = readConfig();
      send({ type: 'ready', wakeword: cfg.wakeword, lang: cfg.lang, tts: cfg.tts });

      const setAwake = (on: boolean) => {
        awake = on;
        if (awakeTimer) { clearTimeout(awakeTimer); awakeTimer = null; }
        if (on) awakeTimer = setTimeout(() => { awake = false; send({ type: 'sleep' }); }, 8000);
      };

      const speak = async (seq: number, text: string, lang: string) => {
        if (!cfg.tts) return;
        const wav = seq === 0 ? await ackAudio(lang) : await tts(text, lang);
        if (wav) send({ type: 'audio', seq, b64: wav.toString('base64') });
      };

      const runCommand = async (text: string) => {
        if (processing) return;
        processing = true;
        setAwake(false);
        try {
          send({ type: 'ack', text });
          const model = await loadedModel();
          if (!model) { send({ type: 'error', message: 'Keine KI im Speicher geladen.' }); return; }
          // Sofortiges gesprochenes Feedback (gecacht → praktisch ohne Verzögerung)
          void speak(0, ACK_PHRASE[cfg.lang] || '', cfg.lang);
          let seq = 1;
          const answer = await chatStream(
            model, text, cfg.lang,
            (tok) => send({ type: 'token', text: tok }),
            async (s) => { const my = seq++; send({ type: 'sentence', seq: my, text: s }); await speak(my, s, cfg.lang); },
          );
          send({ type: 'answer', text: answer });
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : 'Fehler' });
        } finally {
          processing = false;
          send({ type: 'idle' });
        }
      };

      const handleTranscript = (raw: string) => {
        const text = raw.trim();
        if (!text) return;
        send({ type: 'heard', text });
        if (processing) return;

        if (awake) { void runCommand(text); return; }

        // Weckwort im Text suchen; alles danach ist bereits der Befehl
        const norm = normalize(text);
        const wake = normalize(cfg.wakeword);
        const idx = wake ? norm.indexOf(wake) : -1;
        if (idx < 0) return; // kein Weckwort → ignorieren
        send({ type: 'wake' });
        const after = norm.slice(idx + wake.length).trim();
        if (after) void runCommand(after);
        else setAwake(true); // auf den Befehl im nächsten Satz warten
      };

      ws.on('message', (data: Buffer, isBinary: boolean) => {
        if (isBinary) {
          if (processing) return; // während Verarbeitung/Ausgabe kein neues Audio
          transcribe(data, cfg.lang).then(handleTranscript).catch(() => { /* */ });
        }
        // Textframes derzeit nicht benötigt
      });
      ws.on('close', () => { if (awakeTimer) clearTimeout(awakeTimer); });
      ws.on('error', () => { if (awakeTimer) clearTimeout(awakeTimer); });
    })();
  });
}
