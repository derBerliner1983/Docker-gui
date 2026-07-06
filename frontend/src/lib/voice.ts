import { useCallback, useEffect, useRef, useState } from 'react';

// ── Audio-Hilfen ─────────────────────────────────────────────────────────────────
function floatTo16kInt16(input: Float32Array, inRate: number): Int16Array {
  const ratio = inRate / 16000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const frac = idx - i0;
    const s = input[i0] * (1 - frac) + (input[i0 + 1] || 0) * frac;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(s * 32768)));
  }
  return out;
}

export interface VoiceLine { role: 'you' | 'ai' | 'sys'; text: string }
export interface VoiceState {
  supported: boolean;
  active: boolean;       // Zuhören an/aus
  awake: boolean;        // Weckwort erkannt, wartet auf Befehl
  speaking: boolean;     // gibt gerade Audio aus / verarbeitet
  status: string;
  lines: VoiceLine[];
  error: string | null;
}

/**
 * Sprachsteuerung im Browser: Mikrofon aufnehmen, Sprachsegmente (einfache
 * Energie-VAD) an den Server streamen und die gesprochene Antwort abspielen.
 * Weckwort-Erkennung, Whisper (STT) und Piper (TTS) laufen auf dem Server.
 */
export function useVoice(onBusyChange?: (busy: boolean) => void) {
  const [state, setState] = useState<VoiceState>({
    supported: typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!window.AudioContext,
    active: false, awake: false, speaking: false, status: '', lines: [], error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const acRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);

  // VAD-Zustand
  const collecting = useRef(false);
  const silence = useRef(0);
  const buffers = useRef<Float32Array[]>([]);
  const speakingRef = useRef(false); // solange true: kein Audio senden (Echo vermeiden)

  // Playback-Warteschlange
  const playCtx = useRef<AudioContext | null>(null);
  const queue = useRef<ArrayBuffer[]>([]);
  const playing = useRef(false);

  const patch = (p: Partial<VoiceState>) => setState((s) => ({ ...s, ...p }));

  const setSpeaking = useCallback((v: boolean) => {
    speakingRef.current = v;
    patch({ speaking: v });
    onBusyChange?.(v);
  }, [onBusyChange]);

  const playNext = useCallback(async () => {
    if (playing.current) return;
    const buf = queue.current.shift();
    if (!buf) { if (queue.current.length === 0) setSpeaking(false); return; }
    playing.current = true;
    setSpeaking(true);
    try {
      if (!playCtx.current) playCtx.current = new AudioContext();
      const audio = await playCtx.current.decodeAudioData(buf.slice(0));
      const src = playCtx.current.createBufferSource();
      src.buffer = audio;
      src.connect(playCtx.current.destination);
      src.onended = () => { playing.current = false; void playNext(); };
      src.start();
    } catch {
      playing.current = false;
      void playNext();
    }
  }, [setSpeaking]);

  const enqueueAudio = useCallback((b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    queue.current.push(bytes.buffer);
    void playNext();
  }, [playNext]);

  const addLine = (line: VoiceLine) => setState((s) => ({ ...s, lines: [...s.lines.slice(-20), line] }));
  const appendAi = (t: string) => setState((s) => {
    const lines = [...s.lines];
    const last = lines[lines.length - 1];
    if (last && last.role === 'ai') {
      lines[lines.length - 1] = { role: 'ai', text: last.text + t };
    } else {
      lines.push({ role: 'ai', text: t });
    }
    return { ...s, lines: lines.slice(-20) };
  });

  const stop = useCallback(() => {
    try { nodeRef.current?.disconnect(); } catch { /* */ }
    try { srcRef.current?.disconnect(); } catch { /* */ }
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* */ }
    try { acRef.current?.close(); } catch { /* */ }
    try { wsRef.current?.close(); } catch { /* */ }
    nodeRef.current = null; srcRef.current = null; streamRef.current = null; acRef.current = null; wsRef.current = null;
    collecting.current = false; silence.current = 0; buffers.current = [];
    patch({ active: false, awake: false, status: '' });
    setSpeaking(false);
  }, [setSpeaking]);

  const start = useCallback(async () => {
    patch({ error: null });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const ac = new AudioContext();
      acRef.current = ac;
      const src = ac.createMediaStreamSource(stream);
      srcRef.current = src;
      const node = ac.createScriptProcessor(4096, 1, 1);
      nodeRef.current = node;
      const inRate = ac.sampleRate;

      // WebSocket
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/api/voice/ws`);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => patch({ active: true, status: 'Bereit – sag dein Weckwort' });
      ws.onclose = () => patch({ active: false });
      ws.onerror = () => patch({ error: 'Verbindung zum Sprachdienst fehlgeschlagen' });
      ws.onmessage = (ev) => {
        let m: { type: string; [k: string]: unknown };
        try { m = JSON.parse(ev.data as string); } catch { return; }
        switch (m.type) {
          case 'ready': patch({ status: `Bereit – Weckwort: „${m.wakeword as string}"` }); break;
          case 'wake': patch({ awake: true, status: 'Ja? Ich höre …' }); break;
          case 'sleep': patch({ awake: false, status: 'Bereit – sag dein Weckwort' }); break;
          case 'ack': patch({ awake: false, status: 'Verstanden – denke nach …' }); addLine({ role: 'you', text: m.text as string }); break;
          case 'token': appendAi(m.text as string); break;
          case 'answer': patch({ status: 'Antwort fertig' }); break;
          case 'audio': enqueueAudio(m.b64 as string); break;
          case 'idle': patch({ status: 'Bereit – sag dein Weckwort' }); break;
          case 'error': addLine({ role: 'sys', text: m.message as string }); patch({ status: m.message as string }); break;
        }
      };

      node.onaudioprocess = (e) => {
        if (speakingRef.current || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        // RMS-Energie für einfache VAD
        let sum = 0;
        for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
        const rms = Math.sqrt(sum / input.length);
        const speech = rms > 0.012;

        if (speech) {
          collecting.current = true;
          silence.current = 0;
          buffers.current.push(new Float32Array(input));
        } else if (collecting.current) {
          silence.current += input.length / inRate;
          buffers.current.push(new Float32Array(input));
          if (silence.current > 0.7) {
            // Segment abschließen
            const total = buffers.current.reduce((n, b) => n + b.length, 0);
            const merged = new Float32Array(total);
            let off = 0;
            for (const b of buffers.current) { merged.set(b, off); off += b.length; }
            buffers.current = [];
            collecting.current = false;
            silence.current = 0;
            if (total / inRate > 0.35) {   // zu kurze Geräusche verwerfen
              const pcm = floatTo16kInt16(merged, inRate);
              try { ws.send(pcm.buffer); } catch { /* */ }
            }
          }
        }
      };

      src.connect(node);
      node.connect(ac.destination); // nötig, damit onaudioprocess feuert
    } catch (err) {
      patch({ error: err instanceof Error ? err.message : 'Mikrofon-Zugriff verweigert', active: false });
      stop();
    }
  }, [appendAi, enqueueAudio, stop]);

  useEffect(() => () => stop(), [stop]);

  return { state, start, stop };
}
