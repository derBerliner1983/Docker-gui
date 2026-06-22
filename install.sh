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

info "=== $APP_NAME Installation ==="

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

# Optionale Abhängigkeiten (für volle Funktionalität)
command -v docker  &>/dev/null || warn "Docker nicht gefunden – Container-Verwaltung deaktiviert"
command -v virsh   &>/dev/null || warn "libvirt/virsh nicht gefunden – VM-Verwaltung deaktiviert (apt install qemu-kvm libvirt-daemon-system virtinst)"
command -v smbd    &>/dev/null || warn "Samba nicht gefunden – SMB-Freigaben deaktiviert (apt install samba)"

# Benutzer anlegen
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
  info "Benutzer '$SERVICE_USER' angelegt"
fi
# Gruppen für Zugriff auf Docker / libvirt
getent group docker  >/dev/null && usermod -aG docker  "$SERVICE_USER" && info "→ docker-Gruppe"
getent group libvirt >/dev/null && usermod -aG libvirt "$SERVICE_USER" && info "→ libvirt-Gruppe"

# Dateien kopieren
info "Kopiere Dateien nach $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r . "$INSTALL_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

# Abhängigkeiten installieren & bauen
info "Installiere Backend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev
npm run build

info "Installiere Frontend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

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
Group=docker
WorkingDirectory=$INSTALL_DIR/backend
Environment=NODE_ENV=production
Environment=PORT=$PORT
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
  info "✅ $APP_NAME erfolgreich installiert!"
  info ""
  info "   Zugriff: http://${IP}:${PORT}"
  info "   Login:   admin / admin"
  info ""
  warn "   ⚠ Bitte Passwort nach erstem Login ändern!"
  info ""
  info "   Logs:    journalctl -u $SERVICE_NAME -f"
  info "   Stop:    systemctl stop $SERVICE_NAME"
  info "   Start:   systemctl start $SERVICE_NAME"
else
  error "Service konnte nicht gestartet werden. Logs: journalctl -u $SERVICE_NAME --no-pager"
fi
