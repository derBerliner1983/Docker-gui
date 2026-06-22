<div align="center">

# ⬡ Core-Hub

**Die Zentrale deines Linux-Servers.**  
Web-basiertes Server-Management – Docker, VMs, Prozesse, Dienste, Cron & mehr. Ohne SSH, ohne Desktop.

</div>

---

## Was ist Core-Hub?

Ein selbst-gehostetes Verwaltungs-Dashboard für headless Linux-Server – funktional wie Unraid, aber in einem modernen, eigenen Design (Emerald-Akzent, Hell/Dunkel, Glass-Effekte). Du steuerst alles bequem im Browser.

## Features

### 📊 Dashboard (Unraid-Stil, aufklappbare Panels)
- **Prozessor**: Gesamtlast + Auslastung pro CPU-Kern + Live-Verlaufsgraph
- **System**: RAM-Donut mit Aufteilung System / VM / Docker / Frei, Festplatten-Donuts pro Mount
- **Netzwerk**: alle Schnittstellen mit Live-Durchsatz

### ⚡ Taskmanager
- Laufende **Prozesse** auflisten, beenden (TERM) oder hart killen (KILL)
- **systemd-Dienste** starten / stoppen / neustarten

### 🐳 Container
- Anlegen (Wizard: Image, Ports, Env, Volumes, Kategorie), Start/Stop/Restart/Delete
- Logs ansehen, Image-Updates ziehen

### 🖥️ Virtuelle Maschinen (libvirt/KVM)
- VMs erstellen (RAM, CPU, Disk, ISO), starten / herunterfahren / neustarten
- Snapshots, Autostart, Löschen

### ⏰ Automatisierung
- **Cronjobs** anlegen/löschen mit Zeitplan-Presets
- **Autostart**: Dienste beim Systemstart aktivieren/deaktivieren

### 🔄 System-Updates ("Linux updaten")
- apt / dnf / pacman: verfügbare Updates auflisten, einzeln oder alle per Klick installieren

### 💾 Backups
- Docker-Volumes (ohne Host-Root), Verzeichnisse, VM-qcow2 → Download / Löschen

### 📁 SMB-Freigaben & 👥 Benutzer
- Ordner freigeben, Samba steuern, SMB-User · Core-Hub-Logins + Linux-Benutzer (sudo)

### 🔒 Automatisches HTTPS (Reverse-Proxy)
- Pro Container HTTPS per Schalter (oder alle auf einmal) – Caddy mit interner CA
- Root-CA-Download → einmal auf Geräten installieren, überall grünes Schloss

### 🔐 Sicherheit
- Eigenes Login (JWT + bcrypt), Rollen (Admin/Viewer), Audit-Log
- sudoers-Allowlist statt Root-Prozess (via install.sh)

---

## Installation (Produktion)

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`  
⚠️ **Passwort nach dem ersten Login ändern!**

### Optionale Abhängigkeiten (für volle Funktionalität)

```bash
sudo apt install docker.io                                   # Container
sudo apt install qemu-kvm libvirt-daemon-system virtinst     # VMs
sudo apt install samba                                       # SMB-Freigaben
sudo apt install caddy                                       # automatisches HTTPS
```

---

## Entwicklung

```bash
npm run install:all        # alle Abhängigkeiten
npm run dev                # Backend (4200) + Frontend (5173) parallel
```

→ `http://localhost:5173` · Login: `admin` / `admin`

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | React 18, TypeScript, Vite, lucide-react |
| Backend | Fastify, TypeScript, dockerode, systeminformation |
| Auth | JWT, bcrypt | 
| Datenbank | SQLite (better-sqlite3) |
| Design | Eigenes Design-System (Design-Tokens) |
| Deployment | systemd-Service, install.sh |

Siehe [KONZEPT.md](./KONZEPT.md) für die vollständige Roadmap.

---

## ⚠️ Sicherheitshinweis

Core-Hub hat vollen Zugriff auf Docker, VMs und Systemdienste (≈ root). Betreibe es nur im lokalen Netz oder hinter VPN/Reverse-Proxy mit HTTPS. Default-Passwort sofort ändern.
