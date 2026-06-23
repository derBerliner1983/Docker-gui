<div align="center">

# ⬡ Core-Hub

**Die Zentrale deines Linux-Servers.**

Web-basiertes Server-Management für headless Linux – Docker, VMs, Netzwerke, Sicherheit & mehr.
Alles im Browser. Ohne SSH, ohne Desktop. Funktional wie Unraid, in einem modernen eigenen Design.

</div>

---

## Inhaltsverzeichnis
- [Was ist Core-Hub?](#was-ist-core-hub)
- [Features](#features)
- [Installation](#installation)
- [Architektur & Sicherheit](#architektur--sicherheit)
- [Entwicklung](#entwicklung)
- [Tech-Stack](#tech-stack)
- [Roadmap & Timeline](#roadmap--timeline)

---

## Was ist Core-Hub?

Ein selbst-gehostetes Verwaltungs-Dashboard für Linux-Server. Du steuerst Docker-Container,
virtuelle Maschinen, Netzwerke/VLANs, Backups, Benutzer, SMB-Freigaben, System-Updates und die
Server-Sicherheit – komplett bequem über die Weboberfläche. Helles und dunkles Design,
aufklappbare Panels, läuft auf jedem Gerät (PC, Handy, Tablet).

Core-Hub läuft **direkt auf Linux** (als systemd-Dienst), nicht in einem Container – nur so kann
es den Host selbst verwalten (Updates, Dienste, Benutzer, Firewall …).

---

## Features

### 📊 Dashboard (Live-Monitoring alle 2 s, aufklappbare Panels)
- **Prozessor**: Gesamtlast als Tortendiagramm + Live-Verlaufsgraph, Einzelkerne einklappbar
- **System**: RAM-Donut (echter Wert wie htop) mit Aufteilung System / VM / Docker / Frei, Festplatten-Donuts pro Mount
- **Netzwerk**: alle Schnittstellen mit Live-Durchsatz
- **Optimierung**: erkennt RAM-/CPU-Fresser, gestoppte Container, hohe Swap-Nutzung, volle Platten – mit Direktlink zur Aktion

### ⚡ Taskmanager
- Prozesse auflisten, beenden (TERM) oder hart killen (KILL)
- systemd-Dienste starten / stoppen / neustarten

### 🐳 Container
- Anlegen (Wizard: Image, Ports, Env, Volumes, Kategorie)
- Start / Stop / Restart / Delete
- **Detailseite** pro Container: Live-Logs (aktualisiert alle 2,5 s), CPU-Verlaufsgraph, RAM-Anzeige, Ports, Volumes, Env-Variablen
- **„Update verfügbar"-Erkennung** (Registry-Digest-Vergleich) + 1-Klick-Update

### 🧩 App-Vorlagen (1-Klick-Installation)
- Galerie beliebter Dienste – Nextcloud, Jellyfin, Plex, Pi-hole, AdGuard, Vaultwarden,
  Portainer, Uptime Kuma, Grafana, Gitea, Home Assistant, qBittorrent …
- Pro Vorlage: Image, Ports, Volumes & nötige Variablen vorausgefüllt – nur Name/Passwort setzen
- Image wird automatisch geladen, Container erstellt, gestartet und kategorisiert

### 🖥️ Virtuelle Maschinen (libvirt/KVM)
- VMs erstellen (RAM, CPU, Disk, ISO), starten / herunterfahren / neustarten
- Snapshots, Autostart, Löschen

### 🌐 Netzwerke & VLANs
- **Docker**: Netzwerke (bridge / macvlan / ipvlan), VLAN-Tag, isolierte Netze, feste IP + Aliasse
- **VMs**: libvirt-Netzwerke (NAT / isoliert / Bridge + VLAN), VM anhängen
- **Firewall (ufw)**: Regeln allow/deny/reject nach Port / Protokoll / Quell-IP

### 🔒 HTTPS & Reverse-Proxy (Caddy)
- Pro Container HTTPS per Schalter aktivieren – oder alle auf einmal
- Automatische Zertifikate über interne CA (kein Let's Encrypt/Domain nötig)
- Root-CA-Download → einmal auf Geräten installieren, überall grünes Schloss
- Für öffentliche Domains: automatisches Let's Encrypt

### 🛡️ Sicherheit (Audit & Härtung)
- Sicherheits-Scan mit **Score (0–100)** + Note
- Prüft: SSH (Root-Login/Passwort-Auth), Firewall, Sicherheitsupdates, fail2ban, AppArmor/SELinux,
  Konten ohne Passwort, mehrere Root-Konten, offene Ports, privilegierte Container, docker.sock,
  Standard-Passwort
- **1-Klick-Härtung** pro Fund (Firewall einrichten, fail2ban/unattended-upgrades installieren, SSH absichern)
- **SSH ein-/ausschalten** + Autostart

### 🦠 Virenschutz (ClamAV)
- ClamAV per Klick installieren, Viren-Signaturen aktualisieren (freshclam)
- Verzeichnisse scannen (Hintergrund-Scan mit Live-Fortschritt), Funde anzeigen
- Status (Daemon, Signatur-Alter) fließt in den Sicherheits-Check ein

### 🔄 System-Updates
- apt / dnf / pacman: Updates suchen, einzeln oder alle installieren, Reboot-Hinweis

### 💾 Backups
- Docker-Volumes (ohne Host-Root), Verzeichnisse (tar.gz), VM-qcow2
- Download / Löschen, Metadaten in der Datenbank
- **Automatische Zeitpläne** (Cron-basiert) mit **Aufbewahrung** – alte Backups werden
  automatisch aufgeräumt; „Jetzt ausführen", Aktivieren/Deaktivieren pro Plan

### 🔔 Benachrichtigungen & Alarme
- **Webhook** (Discord, Slack, Mattermost oder eigener Endpunkt) und **E-Mail per SMTP**
  (Server/Port/Benutzer/Passwort/SSL im UI, z.B. Gmail/Web.de – auch an externe Adressen)
- Ereignisse einzeln schaltbar: geplante Backups, Container-Abstürze, Sicherheits- & Viren-Funde
- **Alarm-Regeln** (unter Sicherheit): vordefinierte Auffälligkeiten (SSH-Root-Login, fail2ban-Sperren,
  riskante offene Ports, Security-Score-Schwelle, privilegierte Container) **und eigene Schwellwerte**
  (CPU/RAM/Disk über X % für Y Minuten) – pro Regel eigene **Empfänger-Adressen** (mehrere möglich)
- Hintergrund-Monitor prüft alle 60 s und mailt bei Auffälligkeiten (mit Anti-Spam-Cooldown)
- Verlauf in der Oberfläche, Testnachricht per Klick

### ⏰ Automatisierung
- Cronjobs anlegen/löschen mit Zeitplan-Presets
- Autostart: Dienste beim Systemstart aktivieren/deaktivieren

### 📁 SMB-Freigaben & 👥 Benutzer
- Ordner freigeben, Samba steuern, SMB-Benutzer
- Core-Hub-Logins (App, Rollen) + Linux-Benutzer (anlegen/löschen/Passwort/sudo)
- **Zwei-Faktor-Authentifizierung (2FA / TOTP)**: pro Konto einrichten, beim Login wird ein
  Einmalcode aus der Authenticator-App abgefragt (Google Authenticator, Aegis, 1Password …)

### ⚙️ Einstellungen, Version & Migration
- Passwort & 2FA verwalten, System-Info, erkannte Module
- **Version & Updates**: aktuelle Version sichtbar, Update-Prüfung gegen GitHub-Releases,
  Hinweis samt Befehl, wenn eine neuere Version verfügbar ist
- **Migration**: gesamte Konfiguration (DB + Caddy-Zertifikate inkl. Root-CA + SMB) als ein `.tar.gz`
  exportieren und per **Drag & Drop** importieren → Serverumzug mit einem Klick

---

## Installation

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`
⚠️ **Passwort nach dem ersten Login ändern!** (Der Sicherheits-Scan erinnert dich daran.)

Der Installer legt Benutzer/Verzeichnisse unter `core-hub` an (`/opt/core-hub`, `/var/lib/core-hub`),
installiert einen systemd-Dienst und eine sudoers-Allowlist für die benötigten Befehle.

### Update auf eine neue Version

Einfach die neue Version holen und denselben Installer erneut ausführen – er erkennt die
bestehende Installation automatisch und läuft im **Update-Modus**. Deine Daten unter
`/var/lib/core-hub` (Datenbank, Backups) bleiben dabei erhalten:

```bash
cd docker-gui
git pull
sudo bash install.sh        # erkennt vorhandene Installation → Update
```

Der Installer zeigt die alte und neue Version an. In der Oberfläche siehst du die laufende
Version unter **Einstellungen → „Version & Updates"** und ob auf GitHub eine neuere Version steht.

### Optionale Abhängigkeiten (schalten weitere Module frei)

```bash
sudo apt install docker.io                                   # Container
sudo apt install qemu-kvm libvirt-daemon-system virtinst     # VMs & VM-Netzwerke
sudo apt install samba                                       # SMB-Freigaben
sudo apt install caddy                                       # automatisches HTTPS
sudo apt install ufw                                         # Firewall
sudo apt install fail2ban unattended-upgrades                # Härtung
sudo apt install clamav clamav-daemon                        # Virenschutz
```

Fehlt ein Tool, zeigt das jeweilige Modul einen Hinweis statt eines Fehlers.

---

## Architektur & Sicherheit

```
Browser (überall)
    │ HTTPS + REST
    ▼
Core-Hub (systemd-Dienst auf dem Host)
├── Fastify (Node.js / TypeScript)
├── JWT-Auth + bcrypt, Rollen, Audit-Log
├── SQLite (core-hub.db)
└── Steuert via Docker-API, virsh, systemd, ufw, samba, caddy …
```

> Core-Hub hat weitreichenden Zugriff auf den Server. Wichtig:
> - Default-Passwort sofort ändern
> - Nur im LAN oder hinter VPN/Reverse-Proxy mit HTTPS betreiben
> - Privilegierte Befehle laufen über eine **sudoers-Allowlist** (nicht als Root-Prozess)
> - Jede Aktion wird im Audit-Log protokolliert

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
| Auth | JWT, bcrypt, Rollen (Admin/Viewer), 2FA/TOTP (RFC 6238) |
| Datenbank | SQLite (better-sqlite3) |
| HTTPS | Caddy (interne CA / Let's Encrypt) |
| Design | Eigenes Design-System (Design-Tokens) |
| Deployment | systemd-Service, install.sh, sudoers-Allowlist |

---

## Roadmap & Timeline

| Phase | Inhalt | Status |
|---|---|---|
| **1** | Grundgerüst, Login, Container-Verwaltung, Installer | ✅ |
| **2** | Dashboard-Monitoring (CPU/RAM/Disk/Netz), Taskmanager | ✅ |
| **3** | Virtuelle Maschinen (libvirt/KVM) | ✅ |
| **4** | System-Updates, Backups, SMB, Benutzerverwaltung | ✅ |
| **5** | Automatisches HTTPS / Reverse-Proxy (Caddy) | ✅ |
| **6** | Einstellungen, Passwort, Migration (Export/Import) | ✅ |
| **7** | Netzwerke & VLANs (Docker + VMs), Firewall | ✅ |
| **8** | Sicherheits-Scan, Härtung, SSH-Steuerung | ✅ |
| **9** | Update-Erkennung, Virenschutz, **2FA**, **Backup-Zeitpläne**, **Benachrichtigungen**, **App-Vorlagen**, Update-Prüfung | ✅ |
| **10** | **Container-Detailseite** (Live-Logs, CPU/RAM), Bestätigungsdialoge, Rate-Limiting, Session-Timeout, Health-Endpunkt, Audit-Rotation, Dark-Mode auto, Mobile-Optimierung, **`.deb`-Builder** | ✅ |
| **11** | **SMTP-E-Mail**, **Alarm-Regeln** (vordefiniert + eigene Schwellwerte, Empfänger pro Regel), **Optimierungs-Panel**, HTTPS-überall, htop-genauer RAM, Deinstallation | ✅ |

### Geplant / Ideen (kommende Phasen)
- ⏳ Mehrsprachigkeit (EN/DE)
- ⏳ Reverse-Proxy: weitere Backends (nginx/Traefik)
- ⏳ Container-Logs als echter SSE-Stream

Die vollständige technische Planung steht in [KONZEPT.md](./KONZEPT.md).
