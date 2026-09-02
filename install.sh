#!/usr/bin/env bash
# Core-Hub – Installations-Script für Linux
# Getestet auf: Ubuntu 22.04/24.04, Debian 12, Arch/CachyOS
set -e

APP_NAME="Core-Hub"
INSTALL_DIR="/opt/core-hub"
DATA_DIR="/var/lib/core-hub"
SERVICE_USER="core-hub"
SERVICE_NAME="core-hub"
PORT="${PORT:-4200}"

# Verzeichnis dieses Scripts = Quell-/Git-Checkout (von dem aus installiert wird).
# Wird gemerkt, damit das In-App-Update später genau hier `git pull` ausführen kann.
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] && error "Bitte als root ausführen: sudo bash install.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Distribution & Paketmanager erkennen
#
# Core-Hub läuft nicht nur auf Debian/Ubuntu, sondern auch auf Arch-basierten
# Systemen (Arch, CachyOS, EndeavourOS, Manjaro) und – so gut es geht – auf
# Fedora/RHEL und openSUSE. Alle Paketaktionen laufen deshalb über die
# Hilfsfunktionen weiter unten statt direkt über apt-get.
# ─────────────────────────────────────────────────────────────────────────────
OS_ID=""; OS_LIKE=""; OS_NAME=""
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"; OS_LIKE="${ID_LIKE:-}"; OS_NAME="${PRETTY_NAME:-${NAME:-}}"
fi

PM=""
if   command -v apt-get &>/dev/null; then PM="apt"
elif command -v pacman  &>/dev/null; then PM="pacman"
elif command -v dnf     &>/dev/null; then PM="dnf"
elif command -v zypper  &>/dev/null; then PM="zypper"
fi
[ -n "$PM" ] || error "Kein unterstützter Paketmanager gefunden (apt, pacman, dnf oder zypper)."

# Wird beim ersten Paketbefehl einmal aktualisiert, danach nicht mehr.
PKG_REFRESHED=0

# Paketindex aktualisieren (nur einmal pro Lauf).
pkg_refresh() {
  [ "$PKG_REFRESHED" = "1" ] && return 0
  PKG_REFRESHED=1
  case "$PM" in
    apt)    apt-get update -qq 2>/dev/null || true ;;
    pacman) pacman -Sy --noconfirm >/dev/null 2>&1 || true ;;
    dnf)    dnf -q makecache 2>/dev/null || true ;;
    zypper) zypper --non-interactive refresh >/dev/null 2>&1 || true ;;
  esac
}

# Ist ein Paket installiert? (Ersatz für „dpkg -l“)
pkg_have() {
  case "$PM" in
    apt)    dpkg -l "$1" 2>/dev/null | grep -q "^ii"; ;;
    pacman) pacman -Qi "$1" >/dev/null 2>&1 ;;
    dnf)    rpm -q "$1" >/dev/null 2>&1 ;;
    zypper) rpm -q "$1" >/dev/null 2>&1 ;;
    *)      return 1 ;;
  esac
}

# Pakete installieren. Schlägt nie fehl (optionale Module sollen den Lauf nicht
# abbrechen) – der Rückgabewert sagt aber, ob es geklappt hat.
pkg_install() {
  [ "$#" -eq 0 ] && return 0
  pkg_refresh
  case "$PM" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@" 2>/dev/null ;;
    pacman) pacman -S --noconfirm --needed "$@" ;;
    dnf)    dnf install -y "$@" ;;
    zypper) zypper --non-interactive install "$@" ;;
    *)      return 1 ;;
  esac
}

# Wie pkg_install, aber mit „empfohlenen“ Paketen (nur bei apt relevant) –
# für Dinge wie Samba oder libvirt, die ohne ihre Empfehlungen unvollständig sind.
pkg_install_full() {
  [ "$#" -eq 0 ] && return 0
  pkg_refresh
  case "$PM" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" 2>/dev/null ;;
    *)      pkg_install "$@" ;;
  esac
}

# Bereits installierte Pakete auf den neuesten Stand bringen.
pkg_upgrade() {
  [ "$#" -eq 0 ] && return 0
  pkg_refresh
  case "$PM" in
    apt)    DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade "$@" 2>/dev/null || true ;;
    pacman) pacman -S --noconfirm --needed "$@" 2>/dev/null || true ;;
    dnf)    dnf upgrade -y "$@" 2>/dev/null || true ;;
    zypper) zypper --non-interactive update "$@" 2>/dev/null || true ;;
  esac
}

# Paketnamen je Distribution. Ein logischer Name (z. B. „libvirt“) wird auf die
# tatsächlichen Pakete der laufenden Distribution abgebildet. Leere Ausgabe
# bedeutet: gibt es hier nicht (wird dann übersprungen).
pkg_names() {
  case "$1:$PM" in
    build:apt)        echo "build-essential python3" ;;
    build:pacman)     echo "base-devel python" ;;
    build:dnf)        echo "gcc gcc-c++ make python3" ;;
    build:zypper)     echo "gcc gcc-c++ make python3" ;;

    docker:apt)       echo "docker.io" ;;
    docker:pacman)    echo "docker" ;;
    docker:dnf)       echo "moby-engine" ;;
    docker:zypper)    echo "docker" ;;

    libvirt:apt)      echo "qemu-system-x86 libvirt-daemon-system virtinst" ;;
    libvirt:pacman)   echo "qemu-base libvirt virt-install dnsmasq edk2-ovmf" ;;
    libvirt:dnf)      echo "qemu-kvm libvirt virt-install" ;;
    libvirt:zypper)   echo "qemu-kvm libvirt virt-install" ;;

    samba:*)          echo "samba" ;;

    caddy:*)          echo "caddy" ;;

    clamav:apt)       echo "clamav clamav-daemon" ;;
    clamav:pacman)    echo "clamav" ;;
    clamav:dnf)       echo "clamav clamd" ;;
    clamav:zypper)    echo "clamav" ;;

    ufw:*)            echo "ufw" ;;
    fail2ban:*)       echo "fail2ban" ;;

    # Automatische Sicherheitsupdates: nur Debian/Ubuntu und Fedora kennen so etwas.
    autoupdate:apt)   echo "unattended-upgrades" ;;
    autoupdate:dnf)   echo "dnf-automatic" ;;
    autoupdate:*)     echo "" ;;

    python:apt)       echo "python3 python3-venv python3-pip" ;;
    python:pacman)    echo "python python-pip" ;;
    python:dnf)       echo "python3 python3-pip" ;;
    python:zypper)    echo "python3 python3-pip" ;;

    ffmpeg:*)         echo "ffmpeg" ;;
    espeak:*)         echo "espeak-ng" ;;

    sox:apt)          echo "sox libsox-fmt-all" ;;
    sox:*)            echo "sox" ;;

    *)                echo "" ;;
  esac
}

# Logisches Paket installieren (übersetzt den Namen und überspringt Unbekanntes).
pkg_install_logical() {
  local names; names="$(pkg_names "$1")"
  if [ -z "$names" ]; then
    warn "„$1\" ist auf dieser Distribution nicht verfügbar – übersprungen."
    return 0
  fi
  # shellcheck disable=SC2086
  pkg_install_full $names
}

# Dienst aktivieren und starten, falls die Unit existiert (Namen unterscheiden
# sich je Distribution, deshalb dürfen mehrere Kandidaten übergeben werden).
svc_enable() {
  local unit
  for unit in "$@"; do
    if systemctl list-unit-files 2>/dev/null | grep -q "^${unit}\(\.service\)\? "; then
      systemctl enable "$unit" >/dev/null 2>&1 || true
      systemctl start  "$unit" >/dev/null 2>&1 || true
      return 0
    fi
  done
  return 0
}

# Primäre IPv4-Adresse ermitteln. `hostname -I` gibt es nur bei Debians
# hostname-Paket – auf Arch (inetutils) fehlt die Option, deshalb der ip-Fallback.
primary_ip() {
  local ip
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  [ -n "$ip" ] && { echo "$ip"; return 0; }
  ip="$(ip -4 -o addr show scope global 2>/dev/null | awk '{print $4}' | cut -d/ -f1 | head -1)"
  [ -n "$ip" ] && { echo "$ip"; return 0; }
  echo "127.0.0.1"
}


# ── Sprachsteuerung einrichten/aktualisieren (Whisper STT + Piper TTS, lokal) ────
# Wird von `--voice` UND vom normalen Install/Update aufgerufen (letzteres nur,
# wenn die Sprachsteuerung bereits installiert ist oder `--with-voice` angegeben
# wurde). Idempotent: bereits vorhandene venv/Pakete werden nicht neu geladen.
setup_voice() {
  local VOICE_DIR="$INSTALL_DIR/voice"
  local SRC_PY="$INSTALL_DIR/backend/voice/voiced.py"
  [ -f "$SRC_PY" ] || SRC_PY="$SOURCE_DIR/backend/voice/voiced.py"
  if [ ! -f "$SRC_PY" ]; then warn "voiced.py nicht gefunden – Sprachsteuerung übersprungen."; return 0; fi
  mkdir -p "$VOICE_DIR" "$DATA_DIR/voice-cache"
  cp "$SRC_PY" "$VOICE_DIR/voiced.py"

  if [ ! -d "$VOICE_DIR/venv" ]; then
    info "Sprachsteuerung: installiere Python + faster-whisper + piper-tts + kokoro (einmalig, kann dauern)..."
    if ! { pkg_install_logical python && pkg_install_logical ffmpeg && pkg_install_logical espeak; }; then
      warn "python3/venv/ffmpeg/espeak-ng konnten nicht installiert werden – Sprachsteuerung übersprungen."; return 0
    fi
    # Python-Binary: expliziter Override > gemerkte Wahl > System-python3.
    local VPY="${VOICE_PYTHON:-}"
    [ -z "$VPY" ] && [ -f "$DATA_DIR/voice-python" ] && VPY="$(cat "$DATA_DIR/voice-python" 2>/dev/null)"
    command -v "${VPY:-python3}" >/dev/null 2>&1 || VPY="python3"
    "${VPY:-python3}" -m venv "$VOICE_DIR/venv" || { warn "venv-Erstellung fehlgeschlagen."; return 0; }
    "$VOICE_DIR/venv/bin/pip" install --upgrade pip >/dev/null 2>&1 || true
    if ! "$VOICE_DIR/venv/bin/pip" install faster-whisper piper-tts; then
      warn "pip-Installation (faster-whisper/piper-tts) fehlgeschlagen – Sprachsteuerung übersprungen."; return 0
    fi
    # Kokoro (bessere Englisch-Stimmen) – optional, bricht die Installation nicht ab
    "$VOICE_DIR/venv/bin/pip" install kokoro-onnx soundfile 2>/dev/null || warn "Kokoro-TTS konnte nicht installiert werden (Englisch bleibt bei Piper)."
  else
    if ! "$VOICE_DIR/venv/bin/python" -c "import faster_whisper" 2>/dev/null; then
      "$VOICE_DIR/venv/bin/pip" install faster-whisper piper-tts || true
    fi
    if ! "$VOICE_DIR/venv/bin/python" -c "import kokoro_onnx" 2>/dev/null; then
      pkg_install_logical espeak || true
      "$VOICE_DIR/venv/bin/pip" install kokoro-onnx soundfile 2>/dev/null || true
    fi
  fi

  id "$SERVICE_USER" &>/dev/null && chown -R "$SERVICE_USER:$SERVICE_USER" "$VOICE_DIR" "$DATA_DIR/voice-cache" 2>/dev/null || true
  local RUN_USER="$SERVICE_USER"; id "$RUN_USER" &>/dev/null || RUN_USER="root"

  cat > "/etc/systemd/system/core-hub-voice.service" <<EOF
[Unit]
Description=Core-Hub Voice Daemon (Whisper STT + Piper TTS)
After=network.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
Environment=VOICE_PORT=11435
Environment=WHISPER_MODEL=base
Environment=WHISPER_COMPUTE=int8
Environment=VOICE_CACHE=$DATA_DIR/voice-cache
Environment=QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice
ExecStart=$VOICE_DIR/venv/bin/python $VOICE_DIR/voiced.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable core-hub-voice 2>/dev/null || true
  systemctl restart core-hub-voice 2>/dev/null || true
  info "Sprachdienst aktiv auf 127.0.0.1:11435 (Whisper lädt beim ersten Start sein Modell)."
}

# Version des Python im Voice-venv als Zahl (z.B. 314 für 3.14), 0 wenn unbekannt.
voice_venv_pyver() {
  local py="$INSTALL_DIR/voice/venv/bin/python"
  [ -x "$py" ] || { echo 0; return; }
  "$py" -c 'import sys;print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0
}

# Version eines Python-Binaries als Zahl (z. B. 312 für 3.12); 0 bei Fehler.
py_ver_num() {
  command -v "$1" >/dev/null 2>&1 || return 1
  "$1" -c 'import sys;print(sys.version_info[0]*100+sys.version_info[1])' 2>/dev/null || echo 0
}

# Versucht, eine bestimmte Python-Nebenversion zu installieren (z. B. 3.12).
# Die Paketnamen unterscheiden sich stark je Distribution.
pkg_install_python_version() {
  local v="$1" short="${1/./}"     # 3.12 → 312
  case "$PM" in
    apt)
      pkg_install "python$v" "python$v-venv" "python$v-dev" && return 0
      # deadsnakes-PPA als letzte Option (nur Ubuntu)
      pkg_install software-properties-common 2>/dev/null || true
      add-apt-repository -y ppa:deadsnakes/ppa 2>/dev/null || return 1
      PKG_REFRESHED=0; pkg_refresh
      pkg_install "python$v" "python$v-venv" "python$v-dev"
      ;;
    dnf|zypper)
      pkg_install "python$v" "python$v-devel"
      ;;
    pacman)
      # Arch/CachyOS führen nur das aktuelle „python". Ältere Nebenversionen
      # liegen im AUR (python311/python312) – das bauen wir hier bewusst nicht
      # als root. Stattdessen: passt das System-Python, wird es genutzt.
      pkg_install "python$short" 2>/dev/null || return 1
      ;;
    *) return 1 ;;
  esac
}

# Ein installierbares/vorhandenes Python < 3.14 finden (für PyTorch/torchaudio).
# Gibt den Binary-Namen/-Pfad aus oder nichts.
find_compatible_python() {
  local c v n
  for c in python3.12 python3.13 python3.11; do
    command -v "$c" >/dev/null 2>&1 && { echo "$c"; return 0; }
    [ -x "/usr/bin/$c" ] && { echo "/usr/bin/$c"; return 0; }
  done
  # Passt das System-Python schon? (Auf Arch/CachyOS ist das der Normalfall,
  # dort gibt es keine parallel installierbaren älteren Nebenversionen.)
  for c in python3 python; do
    n="$(py_ver_num "$c" || echo 0)"
    if [ "${n:-0}" -ge 311 ] && [ "${n:-0}" -lt 314 ]; then echo "$c"; return 0; fi
  done
  pkg_refresh
  for v in 3.12 3.13 3.11; do
    if pkg_install_python_version "$v"; then
      command -v "python$v" >/dev/null 2>&1 && { echo "python$v"; return 0; }
    fi
  done
  return 1
}

# Voice-venv mit einem gegebenen Python-Binary neu aufsetzen und die Wahl merken.
rebuild_voice_venv() {
  local pybin="$1"
  info "Baue Voice-venv mit '$pybin' neu auf..."
  rm -rf "$INSTALL_DIR/voice/venv"
  mkdir -p "$DATA_DIR"
  echo "$pybin" > "$DATA_DIR/voice-python"   # für künftige Updates merken
  VOICE_PYTHON="$pybin" setup_voice
}

# Selbstheilung: Wenn das Voice-venv auf zu neuem Python (>=3.14) läuft, für das
# es kein PyTorch/torchaudio gibt, automatisch auf ein kompatibles Python
# umstellen. Wird vor der Qwen-Installation aufgerufen.
ensure_voice_python_for_torch() {
  local ver; ver="$(voice_venv_pyver)"
  if [ "$ver" -ge 314 ]; then
    warn "Voice-venv nutzt Python $((ver/100)).$((ver%100)) – dafür gibt es kein PyTorch/torchaudio."
    info "Stelle automatisch auf ein kompatibles Python um..."
    local pybin; pybin="$(find_compatible_python || true)"
    if [ -z "$pybin" ]; then
      case "$PM" in
        pacman) error "Kein kompatibles Python (3.11–3.13) verfügbar. Auf Arch/CachyOS liegt eine ältere Nebenversion im AUR – z. B. 'yay -S python312' (als normaler Benutzer) – danach 'sudo bash install.sh --voice-py 3.12'." ;;
        apt)    error "Kein kompatibles Python (3.11–3.13) verfügbar. Bitte manuell installieren, z.B. 'apt install python3.12 python3.12-venv'." ;;
        *)      error "Kein kompatibles Python (3.11–3.13) verfügbar. Bitte manuell installieren und danach 'sudo bash install.sh --voice-py 3.12' ausführen." ;;
      esac
    fi
    rebuild_voice_venv "$pybin"
  fi
}

# ── sudoers-Allowlist schreiben (passwortloses sudo nur für nötige Befehle) ─────
# Wichtig: jeder Befehl wird unter allen üblichen Pfaden eingetragen
# (/usr/bin, /usr/sbin, /bin, /sbin). sudo vergleicht den Pfad, zu dem die
# PATH-Auflösung führt – und der unterscheidet sich je Distribution stark:
# Debian legt Systemwerkzeuge nach /usr/sbin, auf Arch/CachyOS liegt dagegen
# alles in /usr/bin (/usr/sbin ist dort nur ein Symlink). Ein fehlender Pfad
# führt sonst zu „Keine Root-Rechte" bei Firewall, Benutzern oder Updates.
write_sudoers() {
  if ! id "$SERVICE_USER" &>/dev/null; then warn "Benutzer '$SERVICE_USER' fehlt – sudoers übersprungen."; return 0; fi
  info "Richte sudoers-Allowlist ein (/etc/sudoers.d/core-hub)..."

  # Erlaubte Befehle (ohne Pfad) – die Pfadvarianten erzeugt die Schleife unten.
  local CMDS="apt-get apt dnf pacman zypper systemctl \
    useradd userdel usermod groupadd chpasswd smbpasswd smbcontrol \
    cp tar mkdir rm mv sed chown chmod tee bash \
    virsh virt-install qemu-img caddy nginx ufw ss sysctl reboot \
    dpkg-reconfigure debconf-set-selections freshclam clamscan clamdscan git"

  # Bewusst ALLE Pfadvarianten eintragen – auch für noch nicht installierte
  # Befehle. Nicht vorhandene Pfade stören sudo nicht, aber ein später
  # nachinstalliertes ufw/caddy funktioniert dann sofort ohne erneutes
  # „install.sh --fix-perms".
  local LIST="" c d p
  for c in $CMDS; do
    for d in /usr/bin /usr/sbin /bin /sbin; do
      p="$d/$c"
      case " $LIST " in *" $p,"*) continue;; esac
      LIST="$LIST $p,"
    done
  done
  LIST="${LIST% ,}"; LIST="${LIST%,}"
  LIST="$(echo "$LIST" | sed 's/^ *//')"
  if [ -z "$LIST" ]; then warn "Keine erlaubten Befehle gefunden – sudoers übersprungen."; return 0; fi

  cat > /etc/sudoers.d/core-hub <<EOF
# Core-Hub – passwortloses sudo nur für gezielte Verwaltungsbefehle
# (automatisch erzeugt von install.sh – Pfade passend zur Distribution)
$SERVICE_USER ALL=(root) NOPASSWD: $LIST
EOF
  chmod 0440 /etc/sudoers.d/core-hub
  if visudo -c -f /etc/sudoers.d/core-hub >/dev/null 2>&1; then
    info "sudoers-Allowlist aktiv."
  else
    rm -f /etc/sudoers.d/core-hub; warn "sudoers ungültig – übersprungen."
  fi
}

# ── Nur Berechtigungen neu setzen (schnell, ohne komplette Neuinstallation) ──────
if [ "${1:-}" = "--fix-perms" ] || [ "${1:-}" = "--permissions" ] || [ "${1:-}" = "--sudoers" ]; then
  info "=== $APP_NAME – Berechtigungen (sudoers) neu setzen ==="
  write_sudoers
  info "Fertig. Firewall/Updates/Pakete funktionieren nun ohne Root-Rechte-Fehler."
  exit 0
fi

# ── KI-Erweiterung: Ollama installieren ──────────────────────────────────────
if [ "${1:-}" = "--ki" ]; then
  info "=== $APP_NAME – KI-Erweiterung (Ollama) ==="
  if command -v ollama &>/dev/null; then
    info "Ollama ist bereits installiert ($(ollama --version 2>/dev/null || echo 'unbekannte Version'))."
  else
    info "Lade und installiere Ollama..."
    curl -fsSL https://ollama.com/install.sh | sh
    info "Ollama installiert."
  fi
  systemctl enable ollama 2>/dev/null || true
  systemctl start  ollama 2>/dev/null || true
  info "Ollama-Dienst aktiviert und gestartet (Port 11434)."
  info "KI-Modelle jetzt unter dem Reiter 'KI-Modelle' in Core-Hub verwalten."
  exit 0
fi

# ── Sprachsteuerung: lokaler Voice-Daemon (Whisper STT + Piper TTS) ──────────────
if [ "${1:-}" = "--voice" ]; then
  info "=== $APP_NAME – Sprachsteuerung (Whisper + Piper, lokal) ==="
  setup_voice
  info "Sprache & Weckwort in Core-Hub unter 'Einstellungen → Sprachsteuerung' festlegen."
  info "Ab jetzt wird die Sprachsteuerung bei jedem Update automatisch mit aktualisiert."
  info "Erkennungsmodell wählst du in der GUI (Einstellungen → Sprachsteuerung → Whisper): small/medium = schnell+genau, large-v3 = beste Genauigkeit (lädt beim ersten Mal ~3 GB)."
  exit 0
fi

# ── Voice-venv mit bestimmter Python-Version neu aufsetzen ───────────────────────
# Nötig, wenn die System-Python-Version zu neu für PyTorch/torchaudio ist
# (z.B. 3.14). Beispiel: sudo bash install.sh --voice-py 3.12
if [ "${1:-}" = "--voice-py" ]; then
  PYV="${2:-3.12}"
  info "=== $APP_NAME – Voice-venv auf Python $PYV umstellen ==="
  VOICE_DIR="$INSTALL_DIR/voice"
  # Kandidaten-Binaries (z.B. python3.12). Manche Distros liefern es unter /usr/bin.
  find_py() { command -v "python$PYV" 2>/dev/null || command -v "python${PYV%%.*}.${PYV#*.}" 2>/dev/null || { [ -x "/usr/bin/python$PYV" ] && echo "/usr/bin/python$PYV"; }; }
  PYBIN_NEW="$(find_py || true)"
  if [ -z "$PYBIN_NEW" ]; then
    info "python$PYV nicht vorhanden – versuche Installation über $PM..."
    pkg_install_python_version "$PYV" || warn "python$PYV ließ sich nicht über $PM installieren."
    PYBIN_NEW="$(find_py || true)"
  fi
  if [ -z "$PYBIN_NEW" ]; then
    case "$PM" in
      pacman) error "python$PYV ließ sich nicht installieren. Arch/CachyOS führen nur das aktuelle „python\" – ältere Nebenversionen liegen im AUR: 'yay -S python${PYV/./}' (als normaler Benutzer), danach erneut versuchen. Ist das System-Python bereits < 3.14, genügt 'sudo bash install.sh --voice'." ;;
      apt)    error "python$PYV ließ sich nicht installieren. Bitte manuell installieren (z.B. 'apt install python$PYV python$PYV-venv') und erneut versuchen – oder eine andere Version wählen: sudo bash install.sh --voice-py 3.13" ;;
      *)      error "python$PYV ließ sich nicht installieren. Bitte manuell installieren und erneut versuchen – oder eine andere Version wählen: sudo bash install.sh --voice-py 3.13" ;;
    esac
  fi
  info "Nutze Python-Binary: $PYBIN_NEW"
  rebuild_voice_venv "$PYBIN_NEW" || error "Neuaufbau des Voice-venv fehlgeschlagen."
  info "Fertig. Voice-venv nutzt jetzt Python $PYV (wird für künftige Updates gemerkt)."
  info "Für Qwen-Stimmen jetzt: sudo bash install.sh --voice-qwen"
  exit 0
fi

# ── Qwen3-TTS für Deutsch (optional, schwer: PyTorch + mehrere GB Modell) ────────
if [ "${1:-}" = "--voice-qwen" ]; then
  info "=== $APP_NAME – Qwen3-TTS (sehr gute Stimme inkl. DEUTSCH) ==="
  VOICE_DIR="$INSTALL_DIR/voice"
  if [ ! -d "$VOICE_DIR/venv" ]; then
    info "Voice-Basis fehlt – richte zuerst Whisper/Piper ein..."
    setup_voice
  fi
  [ -d "$VOICE_DIR/venv" ] || error "Voice-venv fehlt. Zuerst: sudo bash install.sh --voice"
  # Selbstheilung: bei zu neuem Python (>=3.14) automatisch auf ein kompatibles
  # Python umstellen, damit PyTorch/torchaudio überhaupt installierbar sind.
  ensure_voice_python_for_torch
  PYBIN="$VOICE_DIR/venv/bin/python"
  PIP="$VOICE_DIR/venv/bin/pip"
  PYVER="$("$PYBIN" -c 'import sys;print("%d.%d"%sys.version_info[:2])' 2>/dev/null || echo '?')"
  info "Voice-venv nutzt Python $PYVER."
  # SoX + FFmpeg werden von qwen-tts/torchaudio für die Audio-Verarbeitung benötigt.
  { pkg_install_logical sox && pkg_install_logical ffmpeg; } || warn "sox/ffmpeg konnten nicht installiert werden – Qwen-Audio evtl. eingeschränkt."
  info "Installiere PyTorch + qwen-tts (mehrere GB, kann lange dauern)..."
  "$PIP" install --upgrade pip >/dev/null 2>&1 || true
  # qwen-tts zuerst (zieht seine Abhängigkeiten), danach torch+torchaudio als
  # ZUSAMMENPASSENDES PAAR aus dem CPU-Wheel-Index erzwingen. Das verhindert den
  # häufigen Fehler „Could not load _torchaudio.abi3.so" (torch/torchaudio-Mismatch).
  # Für NVIDIA/AMD-GPU ggf. cu124- bzw. rocm6.2-Index verwenden.
  "$PIP" install qwen-tts soundfile || error "qwen-tts-Installation fehlgeschlagen."
  "$PIP" install --force-reinstall torch torchaudio --index-url https://download.pytorch.org/whl/cpu 2>/dev/null \
    || "$PIP" install --force-reinstall torch torchaudio || error "PyTorch/torchaudio-Installation fehlgeschlagen."
  # Verifizieren, dass torchaudio wirklich lädt – sonst klare Meldung statt Laufzeitfehler.
  if ! "$PYBIN" -c 'import torch, torchaudio' 2>/dev/null; then
    warn "torchaudio lädt noch nicht. Meist Python-Version zu neu ($PYVER)."
    warn "Lösung: venv mit Python 3.12 neu aufsetzen (sudo bash install.sh --voice-py 3.12) und danach erneut --voice-qwen."
    error "Qwen-TTS nicht einsatzbereit (torchaudio inkompatibel)."
  fi
  id "$SERVICE_USER" &>/dev/null && chown -R "$SERVICE_USER:$SERVICE_USER" "$VOICE_DIR" 2>/dev/null || true
  systemctl restart core-hub-voice 2>/dev/null || true
  info "Qwen3-TTS installiert & torchaudio geprüft. Das Modell (~3–4 GB) wird beim ersten Nutzen automatisch geladen."
  info "In Einstellungen unter 'Stimme' die '… · Qwen'-Stimmen für Deutsch wählen."
  info "Kleiner/schneller: QWEN_TTS_MODEL=Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice in /etc/systemd/system/core-hub-voice.service."
  exit 0
fi

# ── Obsidian als Wissensbasis („Gehirn") ────────────────────────────────────────
# Legt einen Vault-Ordner an und installiert – falls noch nicht vorhanden und ein
# Desktop verfügbar ist – die Obsidian-App. Für die KI-Anbindung genügt der Ordner
# mit .md-Notizen; Core-Hub liest ihn ein (Einstellungen → KI → Wissensbasis).
if [ "${1:-}" = "--obsidian" ]; then
  info "=== $APP_NAME – Obsidian als Wissensbasis anbinden ==="
  VAULT_DIR="${OBSIDIAN_VAULT:-$INSTALL_DIR/data/brain}"
  mkdir -p "$VAULT_DIR"
  if [ ! -f "$VAULT_DIR/Willkommen.md" ]; then
    cat > "$VAULT_DIR/Willkommen.md" <<'EOF'
# Willkommen in deinem Core-Hub-Gehirn

Lege hier Markdown-Notizen (.md) ab – Core-Hub liest sie ein und die KI nutzt sie
als Wissensbasis. Verbinde denselben Ordner in der Obsidian-App als Vault.
EOF
  fi
  id "$SERVICE_USER" &>/dev/null && chown -R "$SERVICE_USER:$SERVICE_USER" "$VAULT_DIR" 2>/dev/null || true

  if command -v obsidian >/dev/null 2>&1 || [ -f /var/lib/flatpak/exports/bin/md.obsidian.Obsidian ]; then
    info "Obsidian ist bereits installiert."
  elif [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && [ ! -d /usr/share/xsessions ]; then
    info "Kein Desktop erkannt – überspringe die Obsidian-App (Server-Betrieb)."
    info "Die KI-Anbindung funktioniert trotzdem über den Vault-Ordner: $VAULT_DIR"
  elif command -v flatpak >/dev/null 2>&1; then
    info "Installiere Obsidian per Flatpak..."
    flatpak install -y flathub md.obsidian.Obsidian 2>/dev/null || warn "Flatpak-Installation fehlgeschlagen – Vault-Ordner genügt für die KI."
  elif command -v snap >/dev/null 2>&1; then
    info "Installiere Obsidian per Snap..."
    snap install obsidian --classic 2>/dev/null || warn "Snap-Installation fehlgeschlagen – Vault-Ordner genügt für die KI."
  else
    warn "Weder Flatpak noch Snap gefunden – Obsidian-App nicht installiert."
    info "Die KI-Anbindung funktioniert dennoch über den Vault-Ordner: $VAULT_DIR"
  fi

  info "Vault-Ordner: $VAULT_DIR"
  info "In Core-Hub unter 'KI-Modelle → Wissensbasis (Obsidian)' aktivieren und diesen Pfad eintragen."
  exit 0
fi

# ── Web-MCP-Server (Internetzugriff als MCP-Werkzeug für externe Agenten) ────────
if [ "${1:-}" = "--web-mcp" ]; then
  info "=== $APP_NAME – Web-MCP-Server (Websuche/Seitenabruf) ==="
  MCP_DIR="$INSTALL_DIR/mcp/core-hub-web"
  [ -d "$MCP_DIR" ] || error "MCP-Verzeichnis nicht gefunden: $MCP_DIR"
  ( cd "$MCP_DIR" && npm install --no-audit --no-fund ) || error "npm install im MCP-Server fehlgeschlagen."
  info "Fertig. In den MCP-Client eintragen (Beispiel):"
  info "  \"core-hub-web\": { \"command\": \"node\", \"args\": [\"$MCP_DIR/index.mjs\"] }"
  info "Details: $MCP_DIR/README.md"
  exit 0
fi

# ── Deinstallation ────────────────────────────────────────────────────────────
if [ "${1:-}" = "--deinstall" ]; then
  info "=== $APP_NAME Deinstallation ==="
  if [ "${2:-}" = "--purge" ]; then
    warn "PURGE-Modus: Programm UND alle Daten (Datenbank, Backups) werden gelöscht!"
  else
    info "Programmdateien werden entfernt. Daten unter $DATA_DIR bleiben erhalten."
    info "Alles löschen inkl. Daten: sudo bash install.sh --deinstall --purge"
  fi

  # Service stoppen & deaktivieren
  systemctl stop  "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  # Voice-Dienst (falls installiert) ebenfalls entfernen
  systemctl stop  core-hub-voice 2>/dev/null || true
  systemctl disable core-hub-voice 2>/dev/null || true
  rm -f "/etc/systemd/system/core-hub-voice.service"
  systemctl daemon-reload
  info "systemd-Service entfernt."

  # Caddy-Konfiguration zurücksetzen
  CADDYFILE="/etc/caddy/Caddyfile"
  if [ -f "$CADDYFILE" ] && grep -q "core-hub-base" "$CADDYFILE" 2>/dev/null; then
    rm -f "$CADDYFILE"
    systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
    info "Caddy-Konfiguration entfernt."
  fi

  # sudoers entfernen
  rm -f /etc/sudoers.d/core-hub
  info "sudoers-Allowlist entfernt."

  # Installations-Verzeichnis löschen
  rm -rf "$INSTALL_DIR"
  info "Installationsverzeichnis $INSTALL_DIR gelöscht."

  # System-Benutzer entfernen
  userdel "$SERVICE_USER" 2>/dev/null || true
  info "Benutzer '$SERVICE_USER' entfernt."

  # Daten löschen (nur bei --purge)
  if [ "${2:-}" = "--purge" ]; then
    rm -rf "$DATA_DIR"
    info "Daten unter $DATA_DIR gelöscht."
  else
    info ""
    info "Daten unter $DATA_DIR sind noch vorhanden."
    info "Manuell löschen mit:  sudo rm -rf $DATA_DIR"
  fi

  info ""
  info "✅ $APP_NAME wurde vollständig deinstalliert."
  exit 0
fi
# ─────────────────────────────────────────────────────────────────────────────

# Version dieses Pakets (Quelle der Wahrheit: ./VERSION)
NEW_VERSION="$(cat ./VERSION 2>/dev/null || echo '0.0.0')"

# --update: explizit erzwungener Update-Lauf (installiert auch neue Abhängigkeiten)
#
# Zusätzliche Schalter für den Update-Lauf:
#   --skip-git     Kein git fetch/reset – der Aufrufer hat den gewünschten Stand
#                  bereits ausgecheckt (nutzt das In-App-Update, weil dort die
#                  konfigurierte Quelle inkl. Zugangsdaten für private Repos liegt).
#   --ref=<REF>    Auf genau diesen Tag/Commit/Branch wechseln statt auf die
#                  Spitze des Remote-Branches (ermöglicht ein Rollback).
#                  Alternativ per Umgebungsvariable CORE_HUB_UPDATE_REF.
SKIP_GIT=0
case " $* " in *" --skip-git "*) SKIP_GIT=1;; esac
UPDATE_REF="${CORE_HUB_UPDATE_REF:-}"
for _arg in "$@"; do
  case "$_arg" in --ref=*) UPDATE_REF="${_arg#--ref=}";; esac
done

FORCE_UPDATE=0
if [ "${1:-}" = "--update" ]; then
  FORCE_UPDATE=1
  # Neueste Quelle von GitHub holen (sofern dieses Verzeichnis ein Git-Checkout ist).
  # git pull läuft im SOURCE_DIR (dem ursprünglichen Klon), nicht im INSTALL_DIR.
  if [ "$SKIP_GIT" = "1" ]; then
    info "Überspringe git (--skip-git) – es wird der aktuell ausgecheckte Stand gebaut."
    NEW_VERSION="$(cat "$SOURCE_DIR/VERSION" 2>/dev/null || cat ./VERSION 2>/dev/null || echo '0.0.0')"
  elif command -v git &>/dev/null && [ -d "$SOURCE_DIR/.git" ]; then
    info "Hole neueste Version von GitHub (in $SOURCE_DIR)..."
    git config --global --add safe.directory "$SOURCE_DIR" 2>/dev/null || true
    # Aktuellen Branch + zugehörigen Remote-Branch bestimmen
    GIT_BRANCH="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
    GIT_UPSTREAM="$(git -C "$SOURCE_DIR" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || echo '')"
    [ -z "$GIT_UPSTREAM" ] && [ -n "$GIT_BRANCH" ] && GIT_UPSTREAM="origin/$GIT_BRANCH"
    # Ein ausdrücklich gewünschter Stand (--ref) hat Vorrang vor der Branch-Spitze.
    GIT_TARGET="${UPDATE_REF:-$GIT_UPSTREAM}"
    if git -C "$SOURCE_DIR" fetch --tags origin 2>&1 && [ -n "$GIT_TARGET" ]; then
      # Deployment-Verzeichnis: verwaiste, nicht getrackte Quelldateien entfernen
      # (blockieren sonst den Merge). node_modules/dist sind ignoriert und bleiben.
      git -C "$SOURCE_DIR" clean -fd 2>/dev/null || true
      # Hart auf den Ziel-Stand setzen (robust gegen lokale Abweichungen)
      if git -C "$SOURCE_DIR" reset --hard "$GIT_TARGET" 2>&1; then
        info "Auf $GIT_TARGET gesetzt."
      else
        warn "git reset fehlgeschlagen – fahre mit vorhandenem Stand fort"
      fi
    else
      warn "git fetch fehlgeschlagen – fahre mit vorhandenem Stand fort"
    fi
    # Neueste VERSION nach dem Update erneut einlesen
    NEW_VERSION="$(cat "$SOURCE_DIR/VERSION" 2>/dev/null || cat ./VERSION 2>/dev/null || echo '0.0.0')"
  fi
fi

# --audit-force / CORE_HUB_AUDIT_FORCE=1: wendet zusätzlich breaking Sicherheits-
# Fixes an (npm audit fix --force) – abgesichert mit Build-Test + Rollback.
AUDIT_FORCE=0
case " $* " in *" --audit-force "*) AUDIT_FORCE=1;; esac
[ "${CORE_HUB_AUDIT_FORCE:-}" = "1" ] && AUDIT_FORCE=1

# npm install + Sicherheits-Fixes für das aktuelle Verzeichnis.
# Sicheres „npm audit fix" immer (nur nicht-breaking, greift nur bei fixbaren
# Lücken). „--force" nur mit Flag und mit automatischem Rollback, falls der
# anschließende Build dadurch kaputtgeht.
dep_install_and_fix() {
  npm install
  npm audit fix 2>&1 | tail -2 || true
  if [ "$AUDIT_FORCE" = "1" ]; then
    warn "AUDIT-FORCE aktiv: versuche breaking Sicherheits-Fixes (mit Rollback)..."
    cp -f package-lock.json /tmp/ch-lock-bak.json 2>/dev/null || true
    set +e
    npm audit fix --force >/tmp/ch-auditforce.log 2>&1
    npm run build >/tmp/ch-auditforce-build.log 2>&1
    local rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      warn "Build nach --force fehlgeschlagen – Abhängigkeiten werden zurückgesetzt."
      [ -f /tmp/ch-lock-bak.json ] && cp -f /tmp/ch-lock-bak.json package-lock.json
      npm install
    else
      info "Breaking Sicherheits-Fixes erfolgreich angewendet."
    fi
    rm -f /tmp/ch-lock-bak.json
  fi
}

# Bereits installiert? → Update-Modus (Daten bleiben erhalten)
MODE="install"
OLD_VERSION=""
if [ -d "$INSTALL_DIR" ] || systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}.service"; then
  MODE="update"
  OLD_VERSION="$(cat "$INSTALL_DIR/VERSION" 2>/dev/null || echo 'unbekannt')"
fi

if [ "$MODE" = "update" ]; then
  info "=== $APP_NAME Update ==="
  info "    Installierte Version: $OLD_VERSION  →  Neue Version: $NEW_VERSION"
  info "    Deine Daten unter $DATA_DIR (Datenbank, Backups) bleiben erhalten."
else
  info "=== $APP_NAME Installation (v$NEW_VERSION) ==="
fi

# Paketlisten aktualisieren, damit neue/zusätzliche Abhängigkeiten gefunden werden
info "System: ${OS_NAME:-unbekannt} · Paketmanager: $PM"
info "Aktualisiere Paketlisten..."
pkg_refresh

# Node.js prüfen / installieren
if ! command -v node &>/dev/null; then
  info "Installiere Node.js..."
  if [ "$PM" = "apt" ]; then
    # Debian/Ubuntu liefern oft ein zu altes Node – deshalb NodeSource.
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    pkg_install_full nodejs
  else
    # Arch/CachyOS, Fedora & openSUSE liefern ein aktuelles Node in den eigenen Quellen.
    pkg_install_full nodejs npm || pkg_install_full nodejs
  fi
fi
command -v node &>/dev/null || error "Node.js konnte nicht installiert werden – bitte manuell installieren (Node.js >= 20)."
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 20 ] && error "Node.js >= 20 erforderlich (aktuell: $(node -v))"
command -v npm &>/dev/null || pkg_install_full npm || true
command -v npm &>/dev/null || error "npm nicht gefunden – bitte npm installieren."
info "Node.js $(node -v) OK"

# Build-Tools für native Module (better-sqlite3)
info "Installiere Build-Tools..."
pkg_install_logical build || true

# Abhängigkeiten installieren (alle Module)
info "Installiere System-Abhängigkeiten..."

if ! command -v docker &>/dev/null; then
  info "Installiere Docker..."
  pkg_install_logical docker || warn "Docker konnte nicht installiert werden – Container-Verwaltung bleibt inaktiv."
fi
# Auf Arch/Fedora startet der Docker-Dienst nicht von selbst (bei Debian schon).
command -v docker &>/dev/null && svc_enable docker

if ! command -v virsh &>/dev/null; then
  info "Installiere libvirt/KVM..."
  pkg_install_logical libvirt || warn "libvirt/KVM konnte nicht installiert werden – VM-Verwaltung bleibt inaktiv."
fi
command -v virsh &>/dev/null && svc_enable libvirtd

if ! command -v smbd &>/dev/null; then
  info "Installiere Samba..."
  pkg_install_logical samba || warn "Samba konnte nicht installiert werden – SMB-Freigaben bleiben inaktiv."
fi

if ! command -v caddy &>/dev/null; then
  info "Installiere Caddy..."
  if [ "$PM" = "apt" ]; then
    # Debian/Ubuntu haben Caddy nicht in den Standardquellen → offizielles Repo.
    pkg_install debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
    PKG_REFRESHED=0   # neue Quelle → Index erneut einlesen
    pkg_refresh
  fi
  pkg_install_logical caddy || warn "Caddy konnte nicht installiert werden – HTTPS-Proxy bleibt inaktiv."
fi

if ! command -v clamscan &>/dev/null; then
  info "Installiere ClamAV..."
  pkg_install_logical clamav || warn "ClamAV konnte nicht installiert werden – Virenschutz bleibt inaktiv."
fi

if ! command -v ufw &>/dev/null; then
  info "Installiere UFW (Firewall)..."
  pkg_install_logical ufw || warn "UFW konnte nicht installiert werden – Firewall-Verwaltung bleibt inaktiv."
fi

if ! command -v fail2ban-client &>/dev/null; then
  info "Installiere fail2ban..."
  pkg_install_logical fail2ban || warn "fail2ban konnte nicht installiert werden."
fi

# Automatische Sicherheitsupdates – gibt es so nur auf Debian/Ubuntu und Fedora.
AUTOUPD_PKG="$(pkg_names autoupdate)"
if [ -n "$AUTOUPD_PKG" ] && ! pkg_have "${AUTOUPD_PKG%% *}"; then
  info "Installiere automatische Sicherheitsupdates ($AUTOUPD_PKG)..."
  # shellcheck disable=SC2086
  pkg_install_full $AUTOUPD_PKG || warn "$AUTOUPD_PKG konnte nicht installiert werden."
fi

# Bei --update: bereits installierte Abhängigkeiten auf neueste Version bringen
if [ "$FORCE_UPDATE" = "1" ]; then
  info "Aktualisiere installierte Abhängigkeiten (--update)..."
  UPD_PKGS=""
  for logical in docker libvirt samba caddy clamav ufw fail2ban autoupdate; do
    for pkg in $(pkg_names "$logical"); do
      pkg_have "$pkg" && UPD_PKGS="$UPD_PKGS $pkg"
    done
  done
  # shellcheck disable=SC2086
  [ -n "$UPD_PKGS" ] && pkg_upgrade $UPD_PKGS
fi

# ── Distributionsbedingte Nacharbeiten ──────────────────────────────────────
# Manche Distributionen liefern Pakete ohne brauchbare Standardkonfiguration
# aus (Arch/CachyOS legen z. B. keine smb.conf an, ClamAV nur *.sample). Ohne
# diese Dateien starten die Dienste gar nicht erst.

# Samba: Grundkonfiguration anlegen, falls keine vorhanden ist.
if command -v smbd &>/dev/null && [ ! -f /etc/samba/smb.conf ]; then
  info "Lege Samba-Grundkonfiguration an (/etc/samba/smb.conf)..."
  mkdir -p /etc/samba
  cat > /etc/samba/smb.conf <<'SMBEOF'
# Von Core-Hub angelegte Grundkonfiguration.
# Freigaben werden in Core-Hub unter „SMB-Freigaben" verwaltet.
[global]
   workgroup = WORKGROUP
   server string = Core-Hub
   security = user
   map to guest = Bad User
   server role = standalone server
   log file = /var/log/samba/%m.log
   max log size = 1000
   logging = file
SMBEOF
  chmod 644 /etc/samba/smb.conf
  mkdir -p /var/log/samba
fi

# ClamAV: mitgelieferte *.sample-Konfigurationen aktivieren (Arch/CachyOS).
if command -v clamscan &>/dev/null; then
  for cfg in freshclam clamd; do
    if [ ! -f "/etc/clamav/$cfg.conf" ] && [ -f "/etc/clamav/$cfg.conf.sample" ]; then
      info "Aktiviere ClamAV-Konfiguration /etc/clamav/$cfg.conf..."
      # Die „Example"-Zeile muss raus, sonst verweigert ClamAV den Start.
      sed 's/^Example/#Example/' "/etc/clamav/$cfg.conf.sample" > "/etc/clamav/$cfg.conf"
      chmod 644 "/etc/clamav/$cfg.conf"
    fi
  done
  mkdir -p /var/lib/clamav
  # Ohne Signaturen startet clamav-daemon nicht – Datenbank einmal holen.
  if command -v freshclam &>/dev/null && [ ! -f /var/lib/clamav/daily.cvd ] && [ ! -f /var/lib/clamav/daily.cld ]; then
    info "Lade ClamAV-Signaturen (einmalig, kann dauern)..."
    systemctl stop clamav-freshclam >/dev/null 2>&1 || true
    freshclam >/dev/null 2>&1 || warn "ClamAV-Signaturen konnten nicht geladen werden – später in Core-Hub nachholen."
  fi
fi

# Benutzer anlegen
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
  info "Benutzer '$SERVICE_USER' angelegt"
fi
# Gruppen für Zugriff auf Docker / libvirt
getent group docker  >/dev/null && usermod -aG docker  "$SERVICE_USER" && info "→ docker-Gruppe"
getent group libvirt >/dev/null && usermod -aG libvirt "$SERVICE_USER" && info "→ libvirt-Gruppe"

# sudoers-Allowlist: passwortloses sudo nur für benötigte Systembefehle
write_sudoers

# Eindeutige Build-Kennung aus Git ableiten (kurzer Hash) – so ist jeder
# ausgelieferte Stand exakt identifizierbar, auch ohne VERSION-Erhöhung.
GIT_HASH="$(git -C "$SOURCE_DIR" rev-parse --short=7 HEAD 2>/dev/null || true)"
if [ -n "$GIT_HASH" ]; then
  info "Build-Kennung: ${NEW_VERSION}+${GIT_HASH}"
fi

# Dateien kopieren
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
if [ "$SOURCE_DIR" != "$INSTALL_DIR" ]; then
  info "Kopiere Dateien von $SOURCE_DIR nach $INSTALL_DIR..."
  cp -r "$SOURCE_DIR/." "$INSTALL_DIR/"
else
  info "Quelle = Installationsverzeichnis – Kopieren übersprungen (Update an Ort und Stelle)."
fi
# Quell-Verzeichnis merken, damit das In-App-Update später `git pull` hier ausführt
echo "$SOURCE_DIR" > "$DATA_DIR/source_dir"
# Build-Datei schreiben (vom Backend für die angezeigte Version gelesen)
if [ -n "$GIT_HASH" ]; then
  echo "$GIT_HASH" > "$INSTALL_DIR/BUILD"
else
  rm -f "$INSTALL_DIR/BUILD"
fi
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

# Abhängigkeiten installieren & bauen
info "Installiere Backend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/backend"
dep_install_and_fix
npm run build

# ── Native Module prüfen (better-sqlite3) ───────────────────────────────────
# npm ab Version 12 (u. a. auf Arch/CachyOS) führt Install-Skripte von
# Abhängigkeiten standardmäßig nicht mehr aus. Dann wird better-sqlite3 nicht
# kompiliert, die native Bindung fehlt und der Dienst startet gar nicht
# ("Could not locate the bindings file"). Die Freigaben stehen im Feld
# "allowScripts" der package.json (npm 12 zieht es einer .npmrc vor); ein bereits
# vorhandenes, unfertiges node_modules heilt davon aber nicht von selbst –
# deshalb hier prüfen und gezielt nachbauen.
# Achtung: ein bloßes require() genügt nicht – better-sqlite3 lädt die native
# Bindung erst beim Öffnen einer Datenbank. Deshalb wirklich eine anlegen.
check_native() { node -e "const D=require('better-sqlite3'); new D(':memory:').close()" >/dev/null 2>&1; }
NATIVE_LOG="/tmp/core-hub-better-sqlite3-build.log"
if ! check_native; then
  warn "Native SQLite-Bindung fehlt – wird jetzt gebaut (kann ein bis zwei Minuten dauern)..."
  # Ausgabe aufheben statt verwerfen – sonst ist die eigentliche Fehlerursache weg.
  npm rebuild better-sqlite3 --foreground-scripts >"$NATIVE_LOG" 2>&1 || true
  if ! check_native; then
    # Zweiter Versuch: direkt über node-gyp im Paketverzeichnis, vorher aufräumen.
    (
      cd node_modules/better-sqlite3 2>/dev/null || exit 0
      rm -rf build 2>/dev/null || true
      npx --yes node-gyp rebuild --release
    ) >>"$NATIVE_LOG" 2>&1 || true
  fi
fi
if ! check_native; then
  warn "better-sqlite3 konnte nicht gebaut werden – ohne diese native Bindung startet Core-Hub nicht."
  if [ -s "$NATIVE_LOG" ]; then
    echo "──────────── letzte Zeilen des Build-Logs ────────────"
    tail -n 25 "$NATIVE_LOG"
    echo "──────────────────────────────────────────────────────"
  fi
  warn "Mögliche Ursachen:"
  warn "  • Compiler/Python fehlen  →  auf Arch/CachyOS: pacman -S base-devel python"
  if [ "$NODE_VER" -ge 24 ]; then
    warn "  • Node.js $(node -v) ist sehr neu – better-sqlite3 9.x kennt es evtl. noch nicht."
  fi
  error "Fehlgeschlagen. Vollständiges Log: $NATIVE_LOG
       Manuell erneut versuchen (als root – das Verzeichnis gehört nicht deinem Benutzer):
       sudo bash -c \"cd $INSTALL_DIR/backend && npm rebuild better-sqlite3 --foreground-scripts\""
fi
info "Native SQLite-Bindung OK"

# Erst jetzt aufräumen – vorher werden die Build-Werkzeuge evtl. noch gebraucht.
npm prune --omit=dev

info "Installiere Frontend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/frontend"
dep_install_and_fix
# Vorhandenes dist sichern, damit ein abgebrochener Build (z. B. Out-of-Memory)
# keinen weißen Bildschirm hinterlässt – Vite leert dist vor dem Schreiben.
DIST_BAK=""
if [ -d dist ] && [ -f dist/index.html ]; then
  DIST_BAK="$(mktemp -d)"
  cp -a dist/. "$DIST_BAK/" 2>/dev/null || true
fi
# Mehr Heap für den Build (kleine VPS neigen sonst zum OOM-Kill).
if NODE_OPTIONS="--max-old-space-size=1536" npm run build; then
  # Konsistenz prüfen: referenziert index.html ein Asset, das auch existiert?
  REF_JS="$(grep -oE 'assets/[^\"]+\.js' dist/index.html 2>/dev/null | head -1)"
  if [ -z "$REF_JS" ] || [ ! -f "dist/$REF_JS" ]; then
    warn "Frontend-Build wirkt unvollständig ($REF_JS fehlt)."
    if [ -n "$DIST_BAK" ]; then warn "Stelle vorheriges Frontend wieder her."; rm -rf dist && mkdir dist && cp -a "$DIST_BAK/." dist/; fi
  fi
else
  warn "Frontend-Build fehlgeschlagen (evtl. zu wenig Speicher – ggf. Swap einrichten)."
  if [ -n "$DIST_BAK" ]; then warn "Stelle vorheriges Frontend wieder her."; rm -rf dist && mkdir dist && cp -a "$DIST_BAK/." dist/; fi
fi
[ -n "$DIST_BAK" ] && rm -rf "$DIST_BAK"

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# Caddy: HTTP→HTTPS-Weiterleitung + HTTPS-Proxy für Core-Hub
info "Konfiguriere Caddy (HTTPS + HTTP-Redirect)..."
CADDYFILE="/etc/caddy/Caddyfile"
# Server-IP und Hostname ermitteln
SERVER_IP="$(primary_ip)"
SERVER_HOST=$(hostname -s 2>/dev/null || echo "")
# Caddy-Adressen: IP immer, Hostname zusätzlich wenn verschieden
CADDY_ADDR="https://${SERVER_IP}"
if [ -n "$SERVER_HOST" ] && [ "$SERVER_HOST" != "$SERVER_IP" ]; then
  CADDY_ADDR="${CADDY_ADDR}, https://${SERVER_HOST}"
fi
# Bestehenden managed block (Docker-Container-Proxies) sichern
MANAGED_BLOCK=""
if [ -f "$CADDYFILE" ]; then
  MANAGED_BLOCK=$(awk '/# >>> core-hub managed/,/# <<< core-hub managed <<</{ print }' "$CADDYFILE" 2>/dev/null || true)
fi
mkdir -p /etc/caddy
{
  echo "# core-hub-base – HTTP→HTTPS + Core-Hub-Proxy (vom Installer verwaltet)"
  echo "http://:80 {"
  echo "    redir https://{host}{uri} permanent"
  echo "}"
  echo ""
  echo "${CADDY_ADDR} {"
  echo "    tls internal"
  echo "    reverse_proxy localhost:${PORT}"
  echo "}"
  if [ -n "$MANAGED_BLOCK" ]; then
    echo ""
    echo "$MANAGED_BLOCK"
  fi
} > "$CADDYFILE"
chmod 644 "$CADDYFILE"
systemctl enable caddy 2>/dev/null || true
systemctl restart caddy 2>/dev/null || true
sleep 1

# Hinweis: Es werden bewusst KEINE Firewall-Regeln automatisch hinzugefügt.
# Der Admin entscheidet selbst über Freigaben (in Core-Hub unter „Sicherheit").
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  info "Firewall ist aktiv – es werden keine Regeln automatisch geändert. Freigaben bitte selbst unter „Sicherheit\" setzen."
fi

# Starken, dauerhaften JWT-Schlüssel erzeugen (nur einmal – bleibt über Updates
# erhalten, damit Sitzungen nicht bei jedem Neustart ungültig werden und Tokens
# nicht fälschbar sind). Liegt in einer 0600-Env-Datei, nicht in der (weltlesbaren)
# Unit-Datei.
ENV_FILE="$DATA_DIR/core-hub.env"
if ! grep -q '^JWT_SECRET=' "$ENV_FILE" 2>/dev/null; then
  info "Erzeuge dauerhaften JWT-Schlüssel..."
  JWT_VAL="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
  # bestehende Zeile ersetzen oder anhängen
  if grep -q '^JWT_SECRET=' "$ENV_FILE"; then sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT_VAL|" "$ENV_FILE"; else echo "JWT_SECRET=$JWT_VAL" >> "$ENV_FILE"; fi
fi
chown "$SERVICE_USER:$SERVICE_USER" "$ENV_FILE" 2>/dev/null || true
chmod 600 "$ENV_FILE"

# Systemd-Service
info "Installiere systemd-Service..."
cat > "/etc/systemd/system/${SERVICE_NAME}.service" <<EOF
[Unit]
Description=$APP_NAME – Linux Server Management
After=network.target caddy.service docker.service
Wants=docker.service

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR/backend
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=HOST=0.0.0.0
Environment=DATA_DIR=$DATA_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=5
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# ── Sprachsteuerung automatisch mitziehen ──
# Bei jedem Install/Update aktualisieren, wenn sie schon eingerichtet ist
# (systemd-Unit oder venv vorhanden) oder wenn `--with-voice` angegeben wurde.
WANT_VOICE=0
case " $* " in *" --with-voice "*) WANT_VOICE=1;; esac
if [ -f /etc/systemd/system/core-hub-voice.service ] || [ -d "$INSTALL_DIR/voice/venv" ]; then WANT_VOICE=1; fi
if [ "$WANT_VOICE" = "1" ]; then
  info "Aktualisiere Sprachsteuerung mit..."
  setup_voice || warn "Sprachsteuerung konnte nicht aktualisiert werden."
fi

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  IP="$(primary_ip)"
  info ""
  if [ "$MODE" = "update" ]; then
    info "✅ $APP_NAME auf v$NEW_VERSION aktualisiert!"
  else
    info "✅ $APP_NAME v$NEW_VERSION erfolgreich installiert!"
  fi
  info ""
  info "   Zugriff: https://${IP}  (HTTP :80 leitet automatisch um)"
  if [ "$MODE" != "update" ]; then
    info "   Login:   admin / admin"
    info ""
    warn "   ⚠ Bitte Passwort nach erstem Login ändern!"
  fi
  info ""
  info "   Version & Update-Prüfung: Einstellungen → „Version & Updates\""
  info "   Logs:    journalctl -u $SERVICE_NAME -f"
  info "   Stop:    systemctl stop $SERVICE_NAME"
  info "   Start:   systemctl start $SERVICE_NAME"
else
  warn "Service konnte nicht gestartet werden – die letzten Log-Zeilen:"
  echo "────────────────────────────────────────────────────────────────"
  journalctl -u "$SERVICE_NAME" --no-pager -n 30 2>/dev/null || true
  echo "────────────────────────────────────────────────────────────────"
  error "Start fehlgeschlagen. Vollständiges Log: journalctl -u $SERVICE_NAME --no-pager"
fi
