# Docker GUI – Konzept & Roadmap

## Vision

Web-basiertes Verwaltungs-Dashboard für Linux-Server (headless).  
Kein Desktop nötig – alles per Browser vom PC, Handy oder Tablet.  
Designsprache: **mana-hub** (Emerald-Akzent, Inter-Font, Hell/Dunkel, Glass-Effekte).

---

## Architektur

```
Browser (überall)
    │ HTTPS + WebSocket
    ▼
Docker GUI Backend   ← läuft als systemd-Dienst auf dem Server
├── Fastify (Node.js/TypeScript)
├── JWT-Auth + bcrypt
├── SQLite (Users, Audit-Log, Config)
├── Docker Engine API (dockerode)
└── System-Befehle (systemd, Samba, Backup, qemu/libvirt)
    │
    ├── /var/run/docker.sock
    ├── systemctl
    ├── smbd
    └── virsh / qemu-img
```

**Installation:** Ein einziges `bash install.sh` → systemd-Service aktiv.

---

## Design (mana-hub Tokens)

| Token | Hell | Dunkel |
|---|---|---|
| Hintergrund | `#F7F7F8` | `#1C1C1F` |
| Karten/Surface | `#FFFFFF` | `#26262B` |
| Text | `#0B0B0F` | `#F4F4F5` |
| **Akzent (Emerald)** | `#10B981` | `#34D399` |
| Warnung | `#D97706` | `#FBBF24` |
| Fehler | `#DC2626` | `#F87171` |

Sidebar: Glass-Effekt (`blur(24px) saturate(160%)`), 232px, collapsible.  
Buttons: Pill-Form (`border-radius: 999px`).  
Font: Inter.

---

## Feature-Module

### ✅ Phase 1 – MVP (implementiert)

| Modul | Status |
|---|---|
| Login (JWT, bcrypt, HttpOnly-Cookie) | ✅ |
| Dashboard (CPU, RAM, Disk, Uptime, Container-Übersicht) | ✅ |
| Container-Liste (Start/Stop/Restart/Delete/Logs) | ✅ |
| Container erstellen (Image, Ports, Env, Volumes, Kategorie) | ✅ |
| Update-Pull (neues Image holen) | ✅ |
| Systemdienste API (auflisten, start/stop) | ✅ |
| Audit-Log (wer hat was getan) | ✅ |
| Hell/Dunkel-Theme | ✅ |
| Sidebar collapsible | ✅ |
| 1-Klick Installation (install.sh + systemd) | ✅ |

---

### 🔜 Phase 2 – Docker-Komfort

- **Update-Prüfung**: Digest-Vergleich, Badge "Update verfügbar" pro Container
- **Container-Kategorien/Dienste**: Gruppierung (z.B. "Medien", "Monitoring")
- **App-Templates**: Vorgefertigte 1-Klick-Install-Vorlagen (Plex, Nextcloud, etc.)
- **Container-Detail-Seite**: Vollständige Inspect-Daten, Netzwerke, Mounts
- **Live-Logs**: WebSocket-Stream statt Snapshot
- **Resource-Graphen**: CPU/RAM-Verlauf über Zeit

---

### 🔜 Phase 3 – System & Storage

| Feature | Details |
|---|---|
| **SMB-Freigaben** | Ordner per Klick freigeben, `smb.conf` generieren, smbd starten/stoppen |
| **Systemdienste** | systemd-Units anzeigen, starten, stoppen, aktivieren/deaktivieren |
| **Benutzerverwaltung** | Linux-User anlegen/löschen, Gruppen, sudo-Rechte |
| **Disk-Management** | Partitionen anzeigen, Mounts verwalten |

---

### 🔜 Phase 4 – Backup & VM

| Feature | Details |
|---|---|
| **Docker Backup** | Container stoppen → Volumes tar.gz → Upload/Lokal speichern |
| **Image-Export** | `docker save` → .tar, Download |
| **VM anlegen** | `qemu-img create`, `virsh define` via Klick-Wizard |
| **VM starten/stoppen** | `virsh start/stop/shutdown` per Button |
| **VM-Backup** | qcow2-Snapshot erstellen, Backup-Plan mit Zeitplan |
| **VM-Liste** | Alle VMs mit Status (running/off), CPU/RAM-Zuweisung |
| **ISO-Verwaltung** | ISO-Images hochladen, zum Boot zuweisen |

**Backend-Endpunkte (geplant für Phase 4):**
```
GET  /api/vms                     → virsh list --all
POST /api/vms/create              → qemu-img + virsh define + virsh start
POST /api/vms/:id/start           → virsh start
POST /api/vms/:id/stop            → virsh shutdown
POST /api/vms/:id/snapshot        → virsh snapshot-create-as
GET  /api/vms/:id/snapshots       → virsh snapshot-list
POST /api/vms/:id/backup          → qemu-img convert → tar.gz
GET  /api/backups                 → Liste aller Backups
POST /api/backups/restore         → Backup wiederherstellen
```

---

### 🔜 Phase 5 – Polishing

- HTTPS (selbstsigniert / Let's Encrypt via ACME)
- 2-Faktor-Authentifizierung (TOTP)
- Benachrichtigungen (E-Mail, Webhook)
- Dark/Light automatisch (System-Präferenz)
- Mobile-Optimierung
- `.deb`-Paket für einfache Installation

---

## Sicherheitshinweise

> Diese App hat vollen Zugriff auf Docker (= praktisch root) und Systemdienste.

- Niemals ohne Passwort betreiben
- Default-Passwort `admin` nach erstem Login sofort ändern
- Hinter einem Reverse-Proxy (nginx/Traefik) mit HTTPS betreiben
- Nur im lokalen Netzwerk oder per VPN zugänglich machen
- Audit-Log ist aktiv: jede Aktion wird protokolliert

---

## Start (Entwicklung)

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend (anderes Terminal)
cd frontend && npm install && npm run dev

# Öffnen
http://localhost:5173
Login: admin / admin
```

## Produktion

```bash
sudo bash install.sh
# → http://SERVER-IP:4200
```
