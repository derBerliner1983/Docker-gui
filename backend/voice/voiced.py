#!/usr/bin/env python3
"""
Core-Hub Voice-Daemon – lokal & kostenlos.

Ein einzelner, schlanker HTTP-Dienst (nur Python-Standardbibliothek als Server)
für Spracherkennung (STT) und Sprachausgabe (TTS):

  * STT: faster-whisper (Whisper lokal, multilingual inkl. Deutsch/Englisch/Thai)
  * TTS: Piper (lokal, schnelle neuronale Stimmen; Stimme je Sprache wählbar)

Das Node-Backend (routes/voice.ts) übergibt Whisper-Modell und Stimme je Anfrage
(Quelle der Wahrheit sind die App-Einstellungen). Es werden KEINE Daten in die
Cloud geschickt.

Endpunkte:
  GET  /health                         -> {ok, stt, tts, model, catalog, ...}
  GET  /voices                         -> Stimmen-Katalog je Sprache (+ installiert)
  POST /transcribe?lang=de&model=base  -> Body: int16le 16 kHz mono -> {text, lang}
  POST /tts?lang=de&voice=<id>         -> Body: UTF-8 Text          -> audio/wav

Umgebungsvariablen:
  VOICE_PORT (11435), WHISPER_MODEL (base), WHISPER_DEVICE (auto),
  WHISPER_COMPUTE (int8), VOICE_CACHE (~/.cache/core-hub-voice)
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

# ── Piper-Stimmen-Katalog (rhasspy/piper-voices auf HuggingFace) ─────────────────
# Thai: Piper bietet (Stand jetzt) keine offizielle Stimme. STT (Verstehen) läuft
# trotzdem; eine eigene .onnx/.json-Stimme kann hier ergänzt werden.
PIPER_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"
CATALOG = {
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
        {"id": "en_US-ryan-high",     "label": "Ryan (US)",   "rel": "en/en_US/ryan/high/en_US-ryan-high"},
        {"id": "en_GB-alan-medium",   "label": "Alan (GB)",   "rel": "en/en_GB/alan/medium/en_GB-alan-medium"},
    ],
    "th": [],
}
REL_BY_ID = {v["id"]: v["rel"] for langs in CATALOG.values() for v in langs}

_whisper = {}   # size -> WhisperModel
_piper = {}     # voice_id -> PiperVoice


def log(*a):
    print("[voiced]", *a, flush=True)


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


# ── TTS: Piper (Stimme je Sprache; bei Bedarf herunterladen) ─────────────────────
def _voice_paths(voice_id: str):
    name = voice_id
    return os.path.join(CACHE, name + ".onnx"), os.path.join(CACHE, name + ".onnx.json")


def _download(url: str, dest: str):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    log(f"lade Stimme herunter: {os.path.basename(dest)}")
    tmp = dest + ".part"
    urllib.request.urlretrieve(url, tmp)
    os.replace(tmp, dest)


def default_voice(lang: str):
    opts = CATALOG.get(lang) or []
    return opts[0]["id"] if opts else None


def get_piper(voice_id: str):
    if voice_id in _piper:
        return _piper[voice_id]
    rel = REL_BY_ID.get(voice_id)
    if not rel:
        _piper[voice_id] = None
        return None
    from piper import PiperVoice  # type: ignore
    onnx, conf = _voice_paths(voice_id)
    _download(f"{PIPER_BASE}/{rel}.onnx", onnx)
    _download(f"{PIPER_BASE}/{rel}.onnx.json", conf)
    voice = PiperVoice.load(onnx, config_path=conf)
    _piper[voice_id] = voice
    log(f"Piper-Stimme geladen: {voice_id}")
    return voice


def synthesize(text: str, lang: str, voice_id: str) -> bytes:
    vid = voice_id or default_voice(lang)
    voice = get_piper(vid) if vid else None
    if voice is None:
        raise RuntimeError(f"keine TTS-Stimme für '{lang}'")
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


def catalog_with_state():
    out = {}
    for lang, opts in CATALOG.items():
        out[lang] = []
        for v in opts:
            onnx, _ = _voice_paths(v["id"])
            out[lang].append({"id": v["id"], "label": v["label"], "installed": os.path.exists(onnx)})
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
            self._json(200, {
                "ok": True, "stt": True,
                "tts": any(CATALOG.values()),
                "model": DEFAULT_MODEL,
                "loaded": list(_whisper.keys()),
                "catalog": catalog_with_state(),
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
    log(f"starte auf 127.0.0.1:{PORT}")
    try:
        get_whisper(DEFAULT_MODEL)
    except Exception as e:  # noqa: BLE001
        log("Whisper konnte nicht vorgeladen werden:", repr(e))
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
