#!/usr/bin/env python3
"""
Core-Hub Voice-Daemon – lokal & kostenlos.

Ein schlanker HTTP-Dienst (nur Python-Standardbibliothek als Server) für
Spracherkennung (STT) und Sprachausgabe (TTS):

  * STT:  faster-whisper (Whisper lokal, multilingual inkl. Deutsch/Englisch/Thai)
  * TTS:  Piper   (Deutsch, Englisch, … – schnell & leicht)
          Kokoro  (Englisch u.a. – sehr hohe Qualität; KEIN Deutsch/Thai)

Die Stimme wird als "<engine>:<voice>" adressiert, z.B. "piper:de_DE-thorsten-medium"
oder "kokoro:am_michael". Ohne Präfix = Piper. Es werden KEINE Daten in die Cloud
geschickt.

Endpunkte:
  GET  /health                         -> {ok, stt, tts, model, catalog, ...}
  GET  /voices                         -> Stimmen-Katalog je Sprache (+ installiert)
  POST /transcribe?lang=de&model=base  -> Body: int16le 16 kHz mono -> {text, lang}
  POST /tts?lang=de&voice=<engine:id>  -> Body: UTF-8 Text          -> audio/wav
"""
import io
import os
import json
import wave
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

PORT = int(os.environ.get("VOICE_PORT", "11435"))
DEFAULT_MODEL = os.environ.get("WHISPER_MODEL", "base")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "auto")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8")
CACHE = os.environ.get("VOICE_CACHE", os.path.expanduser("~/.cache/core-hub-voice"))
os.makedirs(CACHE, exist_ok=True)

# ── Piper-Stimmen (rhasspy/piper-voices) ─────────────────────────────────────────
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
PIPER_VOICES = {
    "de": [
        {"id": "de_DE-thorsten-medium", "label": "Thorsten (mittel)", "rel": "de/de_DE/thorsten/medium/de_DE-thorsten-medium"},
        {"id": "de_DE-thorsten-high",   "label": "Thorsten (hoch)",   "rel": "de/de_DE/thorsten/high/de_DE-thorsten-high"},
        {"id": "de_DE-eva_k-x_low",     "label": "Eva",               "rel": "de/de_DE/eva_k/x_low/de_DE-eva_k-x_low"},
        {"id": "de_DE-kerstin-low",     "label": "Kerstin",           "rel": "de/de_DE/kerstin/low/de_DE-kerstin-low"},
        {"id": "de_DE-karlsson-low",    "label": "Karlsson",          "rel": "de/de_DE/karlsson/low/de_DE-karlsson-low"},
    ],
    "en": [
        {"id": "en_US-amy-medium",    "label": "Amy (US)",    "rel": "en/en_US/amy/medium/en_US-amy-medium"},
        {"id": "en_US-lessac-medium", "label": "Lessac (US)", "rel": "en/en_US/lessac/medium/en_US-lessac-medium"},
        {"id": "en_GB-alan-medium",   "label": "Alan (GB)",   "rel": "en/en_GB/alan/medium/en_GB-alan-medium"},
    ],
    "th": [],
}
PIPER_REL = {v["id"]: v["rel"] for langs in PIPER_VOICES.values() for v in langs}

# ── Kokoro-Stimmen (nur Sprachen, die Kokoro kann – KEIN Deutsch/Thai) ───────────
KOKORO_ONNX_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
KOKORO_VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"
KOKORO_VOICES = {
    "en": [
        {"id": "af_heart",   "label": "Heart (US)"},
        {"id": "af_bella",   "label": "Bella (US)"},
        {"id": "am_michael", "label": "Michael (US)"},
        {"id": "am_adam",    "label": "Adam (US)"},
        {"id": "bf_emma",    "label": "Emma (GB)"},
        {"id": "bm_george",  "label": "George (GB)"},
    ],
}

_whisper = {}   # size -> WhisperModel
_piper = {}     # voice_id -> PiperVoice
_kokoro = None  # Kokoro-Instanz


def log(*a):
    print("[voiced]", *a, flush=True)


def _download(url: str, dest: str):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    log(f"lade herunter: {os.path.basename(dest)}")
    tmp = dest + ".part"
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


# ── STT: faster-whisper (je Modellgröße gecacht) ─────────────────────────────────
def get_whisper(size: str):
    size = size or DEFAULT_MODEL
    if size not in _whisper:
        from faster_whisper import WhisperModel  # type: ignore
        log(f"lade Whisper-Modell '{size}' (device={WHISPER_DEVICE}, compute={WHISPER_COMPUTE})")
        _whisper[size] = WhisperModel(size, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)
        log(f"Whisper '{size}' bereit")
    return _whisper[size]


def transcribe(pcm: bytes, lang: str, size: str) -> str:
    import numpy as np  # type: ignore
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    if audio.size == 0:
        return ""
    model = get_whisper(size)
    segments, _info = model.transcribe(
        audio, language=lang, beam_size=1, vad_filter=True,
        condition_on_previous_text=False,
    )
    return "".join(s.text for s in segments).strip()


# ── TTS: Piper ───────────────────────────────────────────────────────────────────
def _piper_paths(voice_id: str):
    return os.path.join(CACHE, voice_id + ".onnx"), os.path.join(CACHE, voice_id + ".onnx.json")


def get_piper(voice_id: str):
    if voice_id in _piper:
        return _piper[voice_id]
    rel = PIPER_REL.get(voice_id)
    if not rel:
        _piper[voice_id] = None
        return None
    from piper import PiperVoice  # type: ignore
    onnx, conf = _piper_paths(voice_id)
    _download(f"{PIPER_BASE}/{rel}.onnx", onnx)
    _download(f"{PIPER_BASE}/{rel}.onnx.json", conf)
    voice = PiperVoice.load(onnx, config_path=conf)
    _piper[voice_id] = voice
    log(f"Piper-Stimme geladen: {voice_id}")
    return voice


def piper_tts(text: str, voice_id: str) -> bytes:
    voice = get_piper(voice_id)
    if voice is None:
        raise RuntimeError(f"unbekannte Piper-Stimme '{voice_id}'")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        try:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(getattr(voice.config, "sample_rate", 22050))
        except Exception:
            pass
        voice.synthesize(text, wf)
    return buf.getvalue()


# ── TTS: Kokoro (nur wenn kokoro-onnx installiert) ───────────────────────────────
def _kokoro_files_ready() -> bool:
    return os.path.exists(os.path.join(CACHE, "kokoro-v1.0.onnx"))


def get_kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro  # type: ignore
        onnx = os.path.join(CACHE, "kokoro-v1.0.onnx")
        voices = os.path.join(CACHE, "voices-v1.0.bin")
        _download(KOKORO_ONNX_URL, onnx)
        _download(KOKORO_VOICES_URL, voices)
        _kokoro = Kokoro(onnx, voices)
        log("Kokoro geladen")
    return _kokoro


def kokoro_available() -> bool:
    try:
        import kokoro_onnx  # type: ignore  # noqa: F401
        return True
    except Exception:
        return False


def kokoro_tts(text: str, voice_id: str) -> bytes:
    import numpy as np  # type: ignore
    k = get_kokoro()
    lang = "en-gb" if voice_id[:1] == "b" else "en-us"
    samples, sr = k.create(text, voice=voice_id, speed=1.0, lang=lang)
    pcm16 = (np.clip(np.asarray(samples), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sr))
        wf.writeframes(pcm16)
    return buf.getvalue()


def default_voice(lang: str):
    opts = PIPER_VOICES.get(lang) or []
    return "piper:" + opts[0]["id"] if opts else None


def synthesize(text: str, lang: str, voice_id: str) -> bytes:
    vid = voice_id or default_voice(lang)
    if not vid:
        raise RuntimeError(f"keine TTS-Stimme für '{lang}'")
    engine, sep, name = vid.partition(":")
    if not sep:  # ohne Präfix = Piper
        engine, name = "piper", vid
    if engine == "kokoro":
        return kokoro_tts(text, name)
    return piper_tts(text, name)


def catalog_with_state():
    kok = kokoro_available()
    out = {}
    for lang in ["de", "en", "th"]:
        items = []
        for v in PIPER_VOICES.get(lang, []):
            onnx, _ = _piper_paths(v["id"])
            items.append({"id": "piper:" + v["id"], "label": v["label"] + " · Piper", "installed": os.path.exists(onnx)})
        if kok:
            for v in KOKORO_VOICES.get(lang, []):
                items.append({"id": "kokoro:" + v["id"], "label": v["label"] + " · Kokoro", "installed": _kokoro_files_ready()})
        out[lang] = items
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
        pass

    def do_GET(self):
        p = urlparse(self.path).path
        if p == "/health":
            cat = catalog_with_state()
            self._json(200, {
                "ok": True, "stt": True,
                "tts": any(cat.values()),
                "model": DEFAULT_MODEL,
                "loaded": list(_whisper.keys()),
                "kokoro": kokoro_available(),
                "catalog": cat,
            })
        elif p == "/voices":
            self._json(200, {"catalog": catalog_with_state()})
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
                size = qs.get("model", [DEFAULT_MODEL])[0] or DEFAULT_MODEL
                self._json(200, {"text": transcribe(body, lang, size), "lang": lang})
            elif u.path == "/tts":
                voice_id = qs.get("voice", [""])[0]
                wav = synthesize(body.decode("utf-8", "ignore"), lang, voice_id)
                self._send(200, wav, ctype="audio/wav")
            else:
                self._json(404, {"error": "not found"})
        except Exception as e:  # noqa: BLE001
            log("Fehler:", repr(e))
            self._json(500, {"error": str(e)})


def main():
    log(f"starte auf 127.0.0.1:{PORT} (Kokoro verfügbar: {kokoro_available()})")
    try:
        get_whisper(DEFAULT_MODEL)
    except Exception as e:  # noqa: BLE001
        log("Whisper konnte nicht vorgeladen werden:", repr(e))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
