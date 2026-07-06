#!/usr/bin/env python3
"""
Core-Hub Voice-Daemon – lokal & kostenlos.

Ein einzelner, schlanker HTTP-Dienst (nur Python-Standardbibliothek als Server)
für Spracherkennung (STT) und Sprachausgabe (TTS):

  * STT: faster-whisper (Whisper lokal, multilingual inkl. Deutsch/Englisch/Thai)
  * TTS: Piper (lokal, schnelle neuronale Stimmen)

Der Node-Backend (routes/voice.ts) spricht diesen Dienst über 127.0.0.1 an.
Es werden KEINE Daten in die Cloud geschickt.

Endpunkte:
  GET  /health                 -> {ok, stt, tts, voices:[...], model}
  POST /transcribe?lang=de     -> Body: raw int16le, 16 kHz, mono  -> {text, lang}
  POST /tts?lang=de            -> Body: UTF-8 Text                 -> audio/wav (16-bit PCM)

Konfiguration über Umgebungsvariablen:
  VOICE_PORT        (Default 11435)
  WHISPER_MODEL     (Default "base"; z.B. tiny/base/small/medium)
  WHISPER_DEVICE    (Default "auto"; cpu/cuda)
  WHISPER_COMPUTE   (Default "int8")
  VOICE_CACHE       (Default ~/.cache/core-hub-voice)  – Ablage der Piper-Stimmen
"""
import io
import os
import json
import wave
import struct
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("VOICE_PORT", "11435"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
CACHE = os.environ.get("VOICE_CACHE", os.path.expanduser("~/.cache/core-hub-voice"))
os.makedirs(CACHE, exist_ok=True)

# ── Piper-Stimmen je Sprache (rhasspy/piper-voices auf HuggingFace) ──────────────
# Thai: Piper bietet (Stand jetzt) keine offizielle Stimme. STT (Verstehen) läuft
# trotzdem; für TTS kann hier eine eigene .onnx/.json-Stimme hinterlegt werden.
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
VOICES = {
    "de": "de/de_DE/thorsten/medium/de_DE-thorsten-medium",
    "en": "en/en_US/amy/medium/en_US-amy-medium",
    # "th": "<pfad-zur-thai-stimme>",  # optional selbst hinterlegen
}

_whisper = None
_piper = {}   # lang -> PiperVoice


def log(*a):
    print("[voiced]", *a, flush=True)


# ── STT: faster-whisper (lazy laden) ─────────────────────────────────────────────
def get_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel  # type: ignore
        log(f"lade Whisper-Modell '{WHISPER_MODEL}' (device={WHISPER_DEVICE}, compute={WHISPER_COMPUTE})")
        _whisper = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        log("Whisper bereit")
    return _whisper


def transcribe(pcm: bytes, lang: str) -> str:
    import numpy as np  # type: ignore
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size == 0:
        return ""
    model = get_whisper()
    segments, _info = model.transcribe(
        audio, language=lang, beam_size=1, vad_filter=True,
        condition_on_previous_text=False,
    )
    return "".join(s.text for s in segments).strip()


# ── TTS: Piper (lazy laden + Stimme bei Bedarf herunterladen) ─────────────────────
def _download(url: str, dest: str):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    log(f"lade Stimme herunter: {os.path.basename(dest)}")
    tmp = dest + ".part"
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


def get_piper(lang: str):
    if lang in _piper:
        return _piper[lang]
    rel = VOICES.get(lang)
    if not rel:
        _piper[lang] = None
        return None
    from piper import PiperVoice  # type: ignore
    name = os.path.basename(rel)
    onnx = os.path.join(CACHE, name + ".onnx")
    conf = os.path.join(CACHE, name + ".onnx.json")
    _download(f"{PIPER_BASE}/{rel}.onnx", onnx)
    _download(f"{PIPER_BASE}/{rel}.onnx.json", conf)
    voice = PiperVoice.load(onnx, config_path=conf)
    _piper[lang] = voice
    log(f"Piper-Stimme geladen: {name}")
    return voice


def synthesize(text: str, lang: str) -> bytes:
    voice = get_piper(lang)
    if voice is None:
        raise RuntimeError(f"keine TTS-Stimme für '{lang}'")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        # Neuere piper-tts-Versionen setzen die WAV-Parameter selbst; ältere nicht.
        try:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(getattr(voice.config, "sample_rate", 22050))
        except Exception:
            pass
        voice.synthesize(text, wf)
    return buf.getvalue()


def voices_available():
    out = []
    for lang, rel in VOICES.items():
        if rel:
            out.append(lang)
    return out


# ── HTTP-Server ──────────────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def _send(self, code, body=b"", ctype="application/json"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj).encode("utf-8"))

    def log_message(self, *a):
        pass  # eigenes Logging via log()

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/health":
            self._json(200, {
                "ok": True,
                "stt": True,
                "tts": len(voices_available()) > 0,
                "voices": voices_available(),
                "model": WHISPER_MODEL,
            })
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        qs = parse_qs(u.query)
        lang = (qs.get("lang", ["de"])[0] or "de")[:2]
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        try:
            if u.path == "/transcribe":
                text = transcribe(body, lang)
                self._json(200, {"text": text, "lang": lang})
            elif u.path == "/tts":
                wav = synthesize(body.decode("utf-8", "ignore"), lang)
                self._send(200, wav, ctype="audio/wav")
            else:
                self._json(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            log("Fehler:", repr(e))
            self._json(500, {"error": str(e)})


def main():
    log(f"starte auf 127.0.0.1:{PORT}")
    # Whisper vorab laden, damit die erste Erkennung nicht wartet
    try:
        get_whisper()
    except Exception as e:  # noqa: BLE001
        log("Whisper konnte nicht vorgeladen werden:", repr(e))
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    srv.serve_forever()


if __name__ == "__main__":
    main()
