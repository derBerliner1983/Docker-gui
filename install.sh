#!/usr/bin/env bash
# Docker GUI – Installations-Script für Linux
# Getestet auf: Ubuntu 22.04/24.04, Debian 12
set -e

INSTALL_DIR="/opt/docker-gui"
DATA_DIR="/var/lib/docker-gui"
SERVICE_USER="docker-gui"
PORT="${PORT:-4200}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERR]${NC} $*"; exit 1; }

[ "$EUID" -ne 0 ] && error "Bitte als root ausführen: sudo bash install.sh"

info "=== Docker GUI Installation ==="

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

# Docker prüfen
command -v docker &>/dev/null || warn "Docker nicht gefunden – bitte manuell installieren"

# Benutzer anlegen
if ! id "$SERVICE_USER" &>/dev/null; then
  useradd -r -s /bin/false -d "$INSTALL_DIR" "$SERVICE_USER"
  usermod -aG docker "$SERVICE_USER"
  info "Benutzer '$SERVICE_USER' angelegt und zur docker-Gruppe hinzugefügt"
fi

# Dateien kopieren
info "Kopiere Dateien nach $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR" "$DATA_DIR"
cp -r . "$INSTALL_DIR/"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$DATA_DIR"

# Abhängigkeiten installieren & bauen
info "Installiere Backend-Abhängigkeiten..."
cd "$INSTALL_DIR/backend"
npm install --omit=dev

info "Installiere Frontend-Abhängigkeiten & Build..."
cd "$INSTALL_DIR/frontend"
npm install
npm run build

# Systemd-Service
info "Installiere systemd-Service..."
cat > /etc/systemd/system/docker-gui.service <<EOF
[Unit]
Description=Docker GUI – Linux Server Management
After=network.target docker.service
Requires=docker.service

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
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

cd "$INSTALL_DIR/backend"
npm run build

systemctl daemon-reload
systemctl enable docker-gui
systemctl start docker-gui

sleep 2
if systemctl is-active --quiet docker-gui; then
  info ""
  info "✅ Docker GUI erfolgreich installiert!"
  info ""
  info "   Zugriff: http://$(hostname -I | awk '{print $1}'):$PORT"
  info "   Login:   admin / admin"
  info ""
  warn "   Bitte Passwort nach erstem Login ändern!"
  info ""
  info "   Logs:    journalctl -u docker-gui -f"
  info "   Stop:    systemctl stop docker-gui"
  info "   Start:   systemctl start docker-gui"
else
  error "Service konnte nicht gestartet werden. Logs: journalctl -u docker-gui --no-pager"
fi
