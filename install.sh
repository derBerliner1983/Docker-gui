#!/usr/bin/env bash
# Core-Hub – Installations-Script für Linux
# Getestet auf: Ubuntu 22.04/24.04, Debian 12
set -e

APP_NAME="Core-Hub"
INSTALL_DIR="/opt/core-hub"
DATA_DIR="/var/lib/core-hub"
SERVICE_USER="core-hub"
SERVICE_NAME="core-hub"
PORT="${PORT:-4200}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] && error "Bitte als root ausführen: sudo bash install.sh"

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

# Node.js prüfen / installieren
if ! command -v node &>/dev/null; then
  info "Installiere Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
[ "$NODE_VER" -lt 20 ] && error "Node.js >= 20 erforderlich (aktuell: $(node -v))"
info "Node.js $(node -v) OK"

# Build-Tools für native Module (better-sqlite3)
info "Installiere Build-Tools..."
apt-get install -y --no-install-recommends build-essential python3 2>/dev/null || true

# Abhängigkeiten installieren (alle Module)
info "Installiere System-Abhängigkeiten..."

if ! command -v docker &>/dev/null; then
  info "Installiere Docker..."
  apt-get install -y docker.io
fi

if ! command -v virsh &>/dev/null; then
  info "Installiere libvirt/KVM..."
  apt-get install -y qemu-system-x86 libvirt-daemon-system virtinst
fi

if ! command -v smbd &>/dev/null; then
  info "Installiere Samba..."
  apt-get install -y samba
fi

if ! command -v caddy &>/dev/null; then
  info "Installiere Caddy..."
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https 2>/dev/null || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y caddy
fi

if ! command -v clamscan &>/dev/null; then
  info "Installiere ClamAV..."
  apt-get install -y clamav clamav-daemon
fi

if ! command -v ufw &>/dev/null; then
  info "Installiere UFW (Firewall)..."
  apt-get install -y ufw
fi

if ! command -v fail2ban-client &>/dev/null; then
  info "Installiere fail2ban..."
  apt-get install -y fail2ban
fi

if ! dpkg -l unattended-upgrades &>/dev/null 2>&1; then
  info "Installiere unattended-upgrades..."
  apt-get install -y unattended-upgrades
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
info "Richte sudoers-Allowlist ein (/etc/sudoers.d/core-hub)..."
cat > /etc/sudoers.d/core-hub <<EOF
# Core-Hub – passwortloses sudo nur für gezielte Verwaltungsbefehle
$SERVICE_USER ALL=(root) NOPASSWD: /usr/bin/apt-get, /usr/bin/apt, /usr/bin/dnf, /usr/bin/pacman, \\
  /usr/bin/systemctl, /usr/sbin/useradd, /usr/sbin/userdel, /usr/sbin/usermod, /usr/sbin/groupadd, \\
  /usr/bin/chpasswd, /usr/bin/smbpasswd, /usr/bin/cp, /usr/bin/tar, /usr/bin/mkdir, /usr/bin/rm, \\
  /usr/bin/virsh, /usr/bin/virt-install, /usr/bin/qemu-img, /usr/bin/tee, /bin/bash, \\
  /usr/sbin/smbcontrol, /usr/bin/caddy, /usr/sbin/nginx, /usr/bin/ufw, /usr/sbin/ufw, \\
  /usr/bin/sed, /usr/bin/chown, /usr/sbin/dpkg-reconfigure, /usr/bin/debconf-set-selections, \\
  /usr/bin/dpkg-reconfigure, /sbin/ufw, /usr/bin/freshclam, /usr/bin/clamscan, /usr/bin/clamdscan
EOF
chmod 0440 /etc/sudoers.d/core-hub
visudo -c -f /etc/sudoers.d/core-hub >/dev/null 2>&1 || { rm -f /etc/sudoers.d/core-hub; warn "sudoers ungültig – übersprungen"; }

# Dateien kopieren
info "Kopiere Dateien nach $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r . "$INSTALL_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

# Abhängigkeiten installieren & bauen
info "Installiere Backend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/backend"
npm install
npm run build
npm prune --omit=dev

info "Installiere Frontend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# Caddy: HTTP→HTTPS-Weiterleitung + HTTPS-Proxy für Core-Hub
info "Konfiguriere Caddy (HTTPS + HTTP-Redirect)..."
CADDYFILE="/etc/caddy/Caddyfile"
# Server-IP und Hostname ermitteln
SERVER_IP=$(hostname -I | awk '{print $1}')
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
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
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
  IP=$(hostname -I | awk '{print $1}')
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
  error "Service konnte nicht gestartet werden. Logs: journalctl -u $SERVICE_NAME --no-pager"
fi
