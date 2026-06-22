# Core-Hub – Konzept & Roadmap

> **Core-Hub** – die Zentrale deines Linux-Servers.

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
| Container-Liste (Start/Stop/Restart/Delete/Logs) | ✅ |
| Container erstellen (Image, Ports, Env, Volumes, Kategorie) | ✅ |
| Update-Pull (neues Image holen) | ✅ |
| Audit-Log (wer hat was getan) | ✅ |
| Hell/Dunkel-Theme, collapsible Sidebar | ✅ |
| 1-Klick Installation (install.sh + systemd) | ✅ |

### ✅ Phase 2 – Monitoring & Taskmanager (implementiert)

| Modul | Status |
|---|---|
| **Dashboard im Unraid-Stil** (collapsible Panels) | ✅ |
| Prozessor-Panel: Gesamtlast + pro CPU-Kern + Verlaufsgraph | ✅ |
| System-Panel: RAM-Donut mit Aufteilung System/VM/Docker/Frei | ✅ |
| Disk-Donuts pro Mount, Netzwerk-Schnittstellen | ✅ |
| **Taskmanager**: Prozesse auflisten + beenden (TERM/KILL) | ✅ |
| **Taskmanager**: systemd-Dienste start/stop/restart | ✅ |
| **Automatisierung**: Crontab anlegen/löschen (mit Presets) | ✅ |
| **Automatisierung**: Autostart (Dienste enable/disable) | ✅ |

### ✅ Phase 3 – Virtualisierung (implementiert)

| Modul | Status |
|---|---|
| **VM-Liste** mit Status, vCPU, RAM (libvirt/virsh) | ✅ |
| VM starten / herunterfahren / hart aus / neustarten | ✅ |
| VM erstellen (virt-install Wizard: RAM, CPU, Disk, ISO) | ✅ |
| VM-Snapshot erstellen | ✅ |
| VM-Autostart umschalten, VM löschen | ✅ |

---

### 🔜 Phase 4 – Backup, SMB & Benutzer (als nächstes)

| Feature | Details |
|---|---|
| **Docker Backup** | Container stoppen → Volumes tar.gz → Lokal/Remote speichern |
| **Image-Export** | `docker save` → .tar, Download |
| **VM-Backup** | qcow2 sichern, geplante Backups via Cron |
| **Maschinen-Backup** | Konfig/Datenverzeichnisse sichern |
| **SMB-Freigaben** | Ordner per Klick freigeben, `smb.conf` generieren |
| **Benutzerverwaltung** | Linux-User anlegen/löschen, Gruppen, sudo |
| **Backup-Restore** | Backups per Klick wiederherstellen |

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
