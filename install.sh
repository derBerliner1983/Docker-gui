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

# Verwaiste pacman-Sperre entfernen.
# /var/lib/pacman/db.lck bleibt liegen, wenn ein früherer pacman-Lauf abgebrochen
# wurde (Strg-C, Absturz). Jeder weitere Aufruf scheitert dann mit „Kann Datenbank
# nicht sperren" – und weil die Paketbefehle Fehler bewusst schlucken, würden
# Abhängigkeiten stillschweigend übersprungen. Entfernt wird die Sperre nur, wenn
# nachweislich kein pacman läuft; genau das empfiehlt auch pacmans eigene Meldung.
pacman_unlock() {
  local lock="/var/lib/pacman/db.lck"
  [ -e "$lock" ] || return 0
  if pgrep -x pacman >/dev/null 2>&1 || pgrep -x pacman-key >/dev/null 2>&1; then
    warn "pacman läuft gerade – warte bis zu 60 Sekunden auf das Ende..."
    local i=0
    while { pgrep -x pacman >/dev/null 2>&1 || pgrep -x pacman-key >/dev/null 2>&1; } && [ "$i" -lt 60 ]; do
      sleep 1; i=$((i+1))
    done
  fi
  if pgrep -x pacman >/dev/null 2>&1; then
    warn "Es läuft weiterhin ein pacman-Prozess – die Sperre bleibt bestehen."
    return 1
  fi
  if [ -e "$lock" ]; then
    warn "Entferne verwaiste pacman-Sperre ($lock) – es läuft kein Paketmanager."
    rm -f "$lock" || return 1
  fi
  return 0
}

# Paketindex aktualisieren (nur einmal pro Lauf).
pkg_refresh() {
  [ "$PKG_REFRESHED" = "1" ] && return 0
  PKG_REFRESHED=1
  case "$PM" in
    apt)    apt-get update -qq 2>/dev/null || true ;;
    pacman) pacman -Sy --noconfirm >/dev/null 2>&1 || { pacman_unlock && pacman -Sy --noconfirm >/dev/null 2>&1; } || true ;;
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
    pacman) pacman -S --noconfirm --needed "$@" || { pacman_unlock && pacman -S --noconfirm --needed "$@"; } ;;
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
    virsh virt-install qemu-img caddy nginx ufw ss sysctl reboot dmidecode \
    dpkg-reconfigure debconf-set-selections freshclam clamscan clamdscan git"

  # Bewusst ALLE Pfadvarianten eintragen – auch für noch nicht installierte
  # Befehle. Nicht vorhandene Pfade stören sudo nicht, aber ein später
  # nachinstalliertes ufw/caddy funktioniert dann sofort ohne erneutes
  # „install.sh --fix-perms".
  local c d p SEEN=""
  local -a ITEMS=()
  for c in $CMDS; do
    for d in /usr/bin /usr/sbin /bin /sbin; do
      p="$d/$c"
      case " $SEEN " in *" $p "*) continue;; esac
      SEEN="$SEEN $p"
      ITEMS+=("$p")
    done
  done
  if [ "${#ITEMS[@]}" -eq 0 ]; then warn "Keine erlaubten Befehle gefunden – sudoers übersprungen."; return 0; fi

  # Erst in eine Datei außerhalb von /etc/sudoers.d schreiben: eine fehlerhafte
  # Datei dort würde sudo für ALLE Benutzer lahmlegen.
  local TMP_SUDO="/tmp/core-hub.sudoers.$$"
  # Die Befehle werden auf mehrere Zeilen verteilt statt in eine einzige lange
  # Liste geschrieben. sudo-rs (Standard auf Arch/CachyOS) bricht eine Liste ab
  # einer bestimmten Länge mit „too many items in list" ab – und dann gäbe es
  # gar keine Allowlist. Mehrere Regeln für denselben Benutzer sind zulässig und
  # ergänzen sich; das klassische sudo verarbeitet beides gleich.
  local CHUNK=32 i=0 j line
  {
    echo "# Core-Hub – passwortloses sudo nur für gezielte Verwaltungsbefehle"
    echo "# (automatisch erzeugt von install.sh – Pfade passend zur Distribution)"
    echo "# Auf mehrere Zeilen verteilt, weil sudo-rs sehr lange Listen ablehnt."
    while [ "$i" -lt "${#ITEMS[@]}" ]; do
      line=""
      j=0
      while [ "$j" -lt "$CHUNK" ] && [ "$i" -lt "${#ITEMS[@]}" ]; do
        line="${line:+$line, }${ITEMS[$i]}"
        i=$((i + 1)); j=$((j + 1))
      done
      echo "$SERVICE_USER ALL=(root) NOPASSWD: $line"
    done
  } > "$TMP_SUDO"
  chmod 0440 "$TMP_SUDO"

  # Syntaxprüfung – aber nur, wenn visudo sie hier überhaupt beherrscht.
  # Ersatz-Implementierungen (etwa sudo-rs auf Arch/CachyOS) kennen „-c -f"
  # teilweise nicht. Deren Fehlschlag als „Datei ungültig" zu werten hieße,
  # gar keine Allowlist zu installieren – und dann fehlen dem Dienst später
  # sämtliche Rechte, ohne dass jemand weiß warum. Deshalb wird visudo zuerst
  # an einer garantiert gültigen Datei getestet.
  local VISUDO_USABLE=0 VISUDO_OUT="" VALID=1
  if command -v visudo >/dev/null 2>&1; then
    printf 'root ALL=(ALL) ALL\n' > "$TMP_SUDO.ref"
    chmod 0440 "$TMP_SUDO.ref"
    visudo -c -f "$TMP_SUDO.ref" >/dev/null 2>&1 && VISUDO_USABLE=1
    rm -f "$TMP_SUDO.ref"
  fi
  if [ "$VISUDO_USABLE" = "1" ]; then
    VISUDO_OUT="$(visudo -c -f "$TMP_SUDO" 2>&1)" || VALID=0
  else
    warn "visudo kann hier nicht prüfen – die Syntaxprüfung wird übersprungen."
  fi

  if [ "$VALID" = "0" ]; then
    warn "Der sudoers-Entwurf ist ungültig und wurde NICHT installiert:"
    echo "$VISUDO_OUT" | sed 's/^/       /'
    rm -f "$TMP_SUDO"
    return 0
  fi

  install -m 0440 -o root -g root "$TMP_SUDO" /etc/sudoers.d/core-hub
  rm -f "$TMP_SUDO"

  # Funktionsprüfung: kann der Dienstbenutzer jetzt wirklich ohne Passwort?
  # Nur das zählt – eine syntaktisch gültige Datei nützt nichts, wenn sudo sie
  # anders auslegt als erwartet.
  local BASH_PATH TEST_OUT=""
  BASH_PATH="$(command -v bash || echo /bin/bash)"
  if TEST_OUT="$(sudo -u "$SERVICE_USER" sudo -n "$BASH_PATH" -c 'exit 0' 2>&1)"; then
    info "sudoers-Allowlist aktiv (Funktionstest bestanden)."
  else
    warn "sudoers-Datei geschrieben, aber der Funktionstest schlägt fehl:"
    warn "  ${TEST_OUT:-keine Ausgabe}"
    warn "  Nachstellen mit: sudo -u $SERVICE_USER sudo -n $BASH_PATH -c 'echo ok'"
    warn "  Ohne das bleiben Terminal (root), Updates und Paketaktionen gesperrt."
    # Sicherheitsnetz: falls sudo dadurch generell gestört ist, Datei zurücknehmen.
    if ! sudo -n true >/dev/null 2>&1; then
      rm -f /etc/sudoers.d/core-hub
      warn "  sudo war danach generell gestört – die Datei wurde wieder entfernt."
    fi
  fi
}

# ── Nur Berechtigungen neu setzen (schnell, ohne komplette Neuinstallation) ──────
if [ "${1:-}" = "--fix-perms" ] || [ "${1:-}" = "--permissions" ] || [ "${1:-}" = "--sudoers" ]; then
  info "=== $APP_NAME – Berechtigungen (sudoers) neu setzen ==="
  write_sudoers
  info "Fertig. Firewall/Updates/Pakete funktionieren nun ohne Root-Rechte-Fehler."
  exit 0
fi

# ── Benutzerverwaltung von der Kommandozeile ──────────────────────────────────
# Für den Fall, dass man sich nicht mehr anmelden kann: Konten anzeigen,
# Passwort zurücksetzen, 2FA abschalten. Läuft direkt gegen die SQLite-Datei
# des Dienstes – mit dem Node und den Modulen der Installation (better-sqlite3,
# bcryptjs), es wird also kein zusätzliches sqlite3-Paket gebraucht.
DB_FILE="$DATA_DIR/core-hub.db"

# JS von der Standardeingabe ausführen; DB-Pfad kommt über die Umgebung.
run_db_js() {
  [ -f "$DB_FILE" ] || error "Keine Datenbank unter $DB_FILE – ist $APP_NAME installiert?"
  [ -d "$INSTALL_DIR/backend/node_modules/better-sqlite3" ] \
    && [ -d "$INSTALL_DIR/backend/node_modules/bcryptjs" ] \
    || error "Module fehlen unter $INSTALL_DIR/backend – bitte zuerst: sudo bash install.sh"
  local js rc=0
  js="$(mktemp /tmp/core-hub-db-XXXXXX.cjs)"
  cat > "$js"
  # NODE_PATH nötig: die Datei liegt in /tmp, Node sucht Module sonst dort
  # statt in der Installation.
  ( cd "$INSTALL_DIR/backend" && DB="$DB_FILE" NODE_PATH="$INSTALL_DIR/backend/node_modules" node "$js" ) || rc=$?
  rm -f "$js"
  # Schreibzugriffe als root legen ggf. -wal/-shm neu an; die müssen dem
  # Dienstbenutzer gehören, sonst startet der Dienst später ohne Schreibrecht.
  if id "$SERVICE_USER" &>/dev/null; then
    chown "$SERVICE_USER:$SERVICE_USER" "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm" 2>/dev/null || true
  fi
  return $rc
}

if [ "${1:-}" = "--users" ] || [ "${1:-}" = "--benutzer" ]; then
  info "=== $APP_NAME – Benutzerkonten ==="
  run_db_js <<'JS'
const Database = require('better-sqlite3');
const db = new Database(process.env.DB, { readonly: true });
const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
const has = (c) => cols.has(c);
const rows = db.prepare(`SELECT id, username, ${has('display_name') ? 'display_name' : "'' AS display_name"},
  role, ${has('totp_enabled') ? 'totp_enabled' : '0 AS totp_enabled'}, created_at FROM users ORDER BY id`).all();
if (rows.length === 0) { console.log('  (keine Konten – beim nächsten Start wird admin/admin angelegt)'); }
const pad = (s, n) => String(s ?? '').padEnd(n);
console.log('  ' + pad('ID', 4) + pad('Anmeldename', 20) + pad('Anzeigename', 20) + pad('Rolle', 10) + pad('2FA', 6) + 'Angelegt');
console.log('  ' + '-'.repeat(78));
for (const r of rows) {
  console.log('  ' + pad(r.id, 4) + pad(r.username, 20) + pad(r.display_name || '–', 20)
    + pad(r.role, 10) + pad(r.totp_enabled ? 'ja' : 'nein', 6) + (r.created_at || ''));
}
JS
  echo
  info "Passwort zurücksetzen:  sudo bash install.sh --reset-password <Anmeldename>"
  info "2FA abschalten:         sudo bash install.sh --disable-2fa <Anmeldename>"
  exit 0
fi

if [ "${1:-}" = "--reset-password" ] || [ "${1:-}" = "--passwort" ]; then
  RESET_USER="${2:-admin}"
  NEW_PW="${3:-}"
  GENERATED=0
  if [ -z "$NEW_PW" ]; then
    if [ -t 0 ]; then
      read -rsp "Neues Passwort für '$RESET_USER': " NEW_PW; echo
      read -rsp "Zur Bestätigung wiederholen: " NEW_PW2; echo
      [ "$NEW_PW" = "$NEW_PW2" ] || error "Die Passwörter stimmen nicht überein."
    else
      # Ohne Terminal (Skript/Pipe) ein zufälliges Passwort erzeugen und zeigen
      NEW_PW="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
      GENERATED=1
    fi
  fi
  [ "${#NEW_PW}" -ge 8 ] || error "Das Passwort muss mindestens 8 Zeichen haben."
  # Passwort über die Umgebung übergeben, nicht als Argument – Argumente sind
  # in der Prozessliste (ps) für alle Benutzer sichtbar.
  RESET_USER="$RESET_USER" NEW_PW="$NEW_PW" run_db_js <<'JS'
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const db = new Database(process.env.DB);
const name = process.env.RESET_USER;
const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(name);
if (!user) {
  const all = db.prepare('SELECT username FROM users ORDER BY id').all().map((u) => u.username);
  console.error(`Benutzer "${name}" gibt es nicht. Vorhanden: ${all.join(', ') || '(keine)'}`);
  process.exit(1);
}
db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(process.env.NEW_PW, 10), user.id);
console.log(`Passwort für "${user.username}" gesetzt.`);
JS
  [ "$GENERATED" = "1" ] && info "Erzeugtes Passwort: $NEW_PW"
  # Der Dienst hält die Anmeldesperre („zu viele Fehlversuche") nur im
  # Arbeitsspeicher – der Neustart hebt sie gleich mit auf.
  if systemctl restart "$SERVICE_NAME" 2>/dev/null; then
    info "Dienst neu gestartet – die Anmeldesperre wegen zu vieler Fehlversuche ist damit auch weg."
  fi
  exit 0
fi

if [ "${1:-}" = "--disable-2fa" ]; then
  [ -n "${2:-}" ] || error "Bitte den Anmeldenamen angeben: sudo bash install.sh --disable-2fa <Anmeldename>"
  RESET_USER="$2" run_db_js <<'JS'
const Database = require('better-sqlite3');
const db = new Database(process.env.DB);
const name = process.env.RESET_USER;
const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(name);
if (!user) { console.error(`Benutzer "${name}" gibt es nicht.`); process.exit(1); }
db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0, totp_required = 0 WHERE id = ?').run(user.id);
console.log(`Zwei-Faktor-Anmeldung für "${user.username}" abgeschaltet.`);
JS
  if systemctl restart "$SERVICE_NAME" 2>/dev/null; then info "Dienst neu gestartet."; fi
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
    git config --system --add safe.directory "$SOURCE_DIR" 2>/dev/null || true
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
    # 22.x = aktuelles LTS; Node 20 ist seit April 2026 ohne Pflege.
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    pkg_install_full nodejs
  else
    # Arch/CachyOS, Fedora & openSUSE liefern ein aktuelles Node in den eigenen Quellen.
    pkg_install_full nodejs npm || pkg_install_full nodejs
  fi
fi
command -v node &>/dev/null || error "Node.js konnte nicht installiert werden – bitte manuell installieren (Node.js >= 20.19)."
# Genaue Prüfung statt nur der Hauptversion: Vite 7 (Frontend-Build) verlangt
# ^20.19 || >=22.12. Ein Node 20.10 oder 22.5 würde den Bau sonst erst später
# mit einer schwer deutbaren Meldung abbrechen.
NODE_VER=$(node -v | cut -d'v' -f2)
NODE_MAJ=${NODE_VER%%.*}; NODE_REST=${NODE_VER#*.}; NODE_MIN=${NODE_REST%%.*}
node_too_old() {
  [ "$NODE_MAJ" -lt 20 ] && return 0
  [ "$NODE_MAJ" -eq 20 ] && [ "$NODE_MIN" -lt 19 ] && return 0
  [ "$NODE_MAJ" -eq 21 ] && return 0                       # 21.x ist abgekündigt
  [ "$NODE_MAJ" -eq 22 ] && [ "$NODE_MIN" -lt 12 ] && return 0
  return 1
}
if node_too_old; then
  error "Node.js 20.19+ oder 22.12+ erforderlich (aktuell: $(node -v)) – der Frontend-Build (Vite 7) läuft sonst nicht."
fi
command -v npm &>/dev/null || pkg_install_full npm || true
command -v npm &>/dev/null || error "npm nicht gefunden – bitte npm installieren."
info "Node.js $(node -v) OK"

# Build-Tools für native Module (better-sqlite3)
info "Installiere Build-Tools..."
# Ohne Compiler und Python lässt sich better-sqlite3 nicht bauen – ein
# Fehlschlag darf hier nicht unbemerkt durchrutschen.
pkg_install_logical build || warn "Build-Tools konnten nicht installiert werden – falls der Backend-Build gleich scheitert, ist das die Ursache."

# dmidecode liefert die vom BIOS gemeldeten Hardware-Daten (verbauter Speicher,
# Speicherriegel, BIOS-Version). Ohne das Paket kann Core-Hub nur die
# Kernel-Sicht anzeigen und nicht sagen, wie viel Speicher fest reserviert ist.
if ! command -v dmidecode &>/dev/null; then
  pkg_install dmidecode 2>/dev/null || warn "dmidecode konnte nicht installiert werden – BIOS-Speicherdaten bleiben unbekannt."
fi

# Abhängigkeiten installieren (alle Module)
info "Installiere System-Abhängigkeiten..."

if ! command -v docker &>/dev/null; then
  info "Installiere Docker..."
  pkg_install_logical docker || warn "Docker konnte nicht installiert werden – Container-Verwaltung bleibt inaktiv."
fi
# Auf Arch/Fedora startet der Docker-Dienst nicht von selbst (bei Debian schon).
command -v docker &>/dev/null && svc_enable docker

# Diese Fassung liefert nur Dashboard und Terminal. libvirt/KVM, Samba, Caddy,
# ClamAV, UFW und fail2ban werden deshalb NICHT mehr installiert – sie gehören
# zu Bereichen, die hier nicht enthalten sind. Kommen die Bereiche zurück,
# gehören ihre Pakete wieder hierher.

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
  for logical in docker autoupdate; do
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
# Git erlauben, in diesem Verzeichnis zu arbeiten, obwohl es einem anderen
# Benutzer gehört. --system (nicht --global), damit es für root, den
# Dienstbenutzer und die angemeldete Person gleichermaßen gilt – sonst bricht
# sowohl `sudo git pull` als auch das In-App-Update mit „dubious ownership" ab.
if command -v git &>/dev/null && [ -d "$SOURCE_DIR/.git" ]; then
  git config --system --get-all safe.directory 2>/dev/null | grep -qxF "$SOURCE_DIR" \
    || git config --system --add safe.directory "$SOURCE_DIR" 2>/dev/null || true
fi
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

# Kein Caddy mehr: Core-Hub ist direkt über seinen Port erreichbar. Wer HTTPS
# möchte, setzt einen Reverse-Proxy eigener Wahl davor (z. B. Pangolin).

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
After=network.target docker.service
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
  info "   Zugriff: http://${IP}:${PORT}"
  info "   (Für HTTPS einen Reverse-Proxy eigener Wahl davorsetzen.)"
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
