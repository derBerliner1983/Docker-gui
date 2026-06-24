<div align="center">

# ⬡ Core-Hub

**Die Zentrale deines Linux-Servers.** · `v0.7.1`

Web-basiertes Server-Management für headless Linux – Docker, VMs, Netzwerke, Sicherheit, KI & mehr.
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
virtuelle Maschinen, Netzwerke/VLANs, Backups, Benutzer, SMB-Freigaben, System-Updates,
lokale KI-Modelle (Ollama) und die Server-Sicherheit – komplett bequem über die Weboberfläche.
Helles und dunkles Design, aufklappbare Panels, läuft auf jedem Gerät (PC, Handy, Tablet).

Core-Hub läuft **direkt auf Linux** (als systemd-Dienst), nicht in einem Container – nur so kann
es den Host selbst verwalten (Updates, Dienste, Benutzer, Firewall …).

---

## Features

### 📊 Dashboard (Live-Monitoring alle 2 s, aufklappbare Panels)
- **Prozessor**: Gesamtlast als Tortendiagramm + Live-Verlaufsgraph, Einzelkerne einklappbar
- **System**: RAM-Donut (echter Wert wie htop) mit Aufteilung System / VM / Docker / Frei, Festplatten-Donuts pro Mount
- **GPU**: GPU-Auslastung (%) + VRAM-/Unified-Memory-Verbrauch als Donuts – NVIDIA (nvidia-smi) und AMD (amdgpu sysfs) erkannt; APU/UMA-Systeme (z. B. Ryzen AI MAX) werden korrekt als Unified Memory dargestellt
- **Netzwerk**: alle Schnittstellen mit Live-Durchsatz
- **Optimierung**: erkennt RAM-/CPU-Fresser, gestoppte Container, hohe Swap-Nutzung, volle Platten – mit Direktlink zur Aktion

### ⚡ Taskmanager
- Prozesse auflisten, beenden (TERM) oder hart killen (KILL)
- **Dienste-Tab**: systemd-Dienste starten / stoppen / neustarten / Autostart ein-/ausschalten

### 🖥️ Terminal (Web-Konsole)
- Interaktive **Root-Shell direkt im Browser** (xterm.js + WebSocket) – falls du mal nicht per SSH rankommst
- Nur für Admins, Authentifizierung über das Login-Cookie, läuft über die bestehende sudoers-Allowlist

### 🐳 Container
- Anlegen (Wizard: Image, Ports, Env, Volumes, Gruppe, eigenes Icon)
- Start / Stop / Restart / Delete · Neustart-Richtlinien auf Deutsch
- **Gruppen / Kategorien**: Container in auf-/zuklappbare Gruppen sortieren
  (z. B. „Datenbanken", „Automatisierung") – der Zustand bleibt gespeichert
- **Eigenes Icon** pro Container (Bild-URL) oder automatisches Symbol
- **Detailseite** pro Container: **Live-Logs als SSE-Stream** (Echtzeit, kein Polling), CPU-Verlaufsgraph, RAM-Anzeige, Ports, Volumes, Env-Variablen
- **„Update verfügbar"-Erkennung** (Registry-Digest-Vergleich) + 1-Klick-Update
- Action-Buttons (Start/Logs/Löschen …) auch auf dem Handy klar sichtbar & tippbar

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
- **Firewall (ufw)**: Regeln allow/deny/reject nach Port / Protokoll / Quell-IP / **Richtung
  (eingehend/ausgehend)** – Regeln mit **Namen** anlegen, **bearbeiten**, **filtern** und löschen;
  **mehrere Quell-Adressen** auf einmal (Komma-getrennt → je eine Regel); Regeln einzeln
  **temporär deaktivieren/reaktivieren** (Parkbucht); beim Aktivieren werden SSH und die
  Web-Ports (80/443) automatisch freigegeben (kein Aussperren der Oberfläche)
- **Verbindungsversuche** (eigener Tab, persistente **Protokoll-DB**): zeigt protokollierte
  Zugriffe (wer von wo, blockiert/erlaubt), filterbar nach Aktion, Richtung, IP/Port;
  **Hover-Tipps** zum Ziel-Port (welcher Dienst, ob riskant), **CSV-Export** (Auswahl/alle),
  Protokollierung per Schalter ein-/ausschaltbar, Protokoll leerbar

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
  riskante offene Ports, Security-Score-Schwelle, privilegierte Container, **blockierte Firewall-
  Verbindungen**) **und eigene Schwellwerte** (CPU/RAM/Disk über X % für Y Minuten) – pro Regel
  eigene **Empfänger-Adressen** (mehrere möglich); Alarme nur für **aktivierte** Regeln
- Hintergrund-Monitor prüft alle 60 s und mailt bei Auffälligkeiten (mit Anti-Spam-Cooldown)
- Verlauf in der Oberfläche, Testnachricht per Klick

### ⏰ Automatisierung
- Cronjobs anlegen/löschen mit Zeitplan-Presets
- Autostart: Dienste beim Systemstart aktivieren/deaktivieren

### 📁 SMB-Freigaben & 👥 Benutzer
- Ordner freigeben, SMB-Benutzer verwalten; **Samba Auto-Lifecycle**: Samba startet automatisch beim Erstellen der ersten Freigabe + öffnet die Firewall nur für LAN (Ports 137–139, 445); stoppt und blockiert automatisch, wenn alle Freigaben entfernt werden – Internet-Zugang nur explizit über Sicherheitseinstellungen
- Core-Hub-Logins (App, Rollen) + Linux-Benutzer (anlegen/löschen/Passwort/sudo)
- **Zwei-Faktor-Authentifizierung (2FA / TOTP)**: pro Konto einrichten, beim Login wird ein
  Einmalcode aus der Authenticator-App abgefragt (Google Authenticator, Aegis, 1Password …)

### 📂 Datei-Manager
- Verzeichnisbaum durchsuchen, Textdateien direkt im Browser bearbeiten
- Hochladen, Ordner anlegen, umbenennen, löschen, herunterladen
- Rechte (chmod) und Eigentümer/Gruppe sehen und ändern – auch in System-Verzeichnissen
  (`/etc`, `/opt`, …) über die sudoers-Allowlist

### 🤖 KI / Ollama
- Ollama-Status, installierte Modelle, VRAM-Anzeige pro Modell, Start/Stop-Schalter
- **Hardware-Erkennung**: CPU, RAM, GPU + VRAM; erkennt APU/UMA (Ryzen AI MAX) korrekt; berechnet die **empfohlene maximale Modellgröße** (GB) mit aufklappbarer Erklärung der Formel
- **Zugriffsmodus**: Ollama auf lokal (`127.0.0.1`) oder LAN (`0.0.0.0`) schalten – schreibt automatisch den systemd-Override und startet den Dienst neu
- **Zugriffs-URLs**: direkt im UI anklickbare Chips – lokal: `http://127.0.0.1:port` + `http://localhost:port`; LAN: `http://IP:port` + `http://Hostname:port`
- **1-Klick HTTPS via Caddy**: Button „HTTPS ein" erscheint, sobald Caddy installiert ist – ein Klick erstellt automatisch einen Caddy-Proxy-Eintrag für Hostname **und alle LAN-IPs** (`tls internal`), schaltet Ollama auf `127.0.0.1` (HTTP von LAN gesperrt) und startet den Dienst neu; alle `http://`-Chips verschwinden, stattdessen erscheint ein grüner `https://`-Chip pro Hostname/IP
- **HTTPS deaktivieren**: erneuter Klick entfernt den Caddy-Eintrag und schaltet Ollama zurück auf LAN-Modus (`0.0.0.0`), `http://`-Chips erscheinen wieder
- **Modell-Suche**: Beliebte Empfehlungen zuerst, HuggingFace GGUF-Suche darunter
- **GGUF-Quantisierungsselektor**: beim Laden eines HF-Modells Quantisierung wählen (Q4_K_M, Q5_K_M, Q8_0 …); lädt via `hf.co/<repo>:<quant>` direkt in Ollama
- **Gleichzeitige Downloads**: mehrere Modelle parallel laden, Status pro Modell
- Modelle laden / löschen / Details anzeigen (Parameter, Quantisierung, Kontextfenster, Fähigkeiten)

### ⚙️ Einstellungen, Version & Migration
- Passwort & 2FA verwalten, System-Info, erkannte Module
- **Version & Updates**: aktuelle Version sichtbar; Update-Prüfung **direkt gegen das
  Git-Repository** (vergleicht die `VERSION`-Datei und neue Commits – funktioniert auch bei
  **privaten** Repos ohne Releases), Fallback auf GitHub-Releases; dazu **1-Klick-Update in
  der Oberfläche** (`git pull` + `install.sh --update`, mit Live-Log)
- **Konfigurations-Migration**: gesamte Core-Hub-Konfiguration (DB + Caddy-Zertifikate inkl.
  Root-CA + SMB) als ein `.tar.gz` exportieren und per **Drag & Drop** importieren →
  Serverumzug mit einem Klick
- **Container-Migration von Unraid:** Docker-Container samt App-Daten umziehen –
  Schritt-für-Schritt-Anleitung in [docs/MIGRATION.md](./docs/MIGRATION.md)

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

**Bequem in der Oberfläche:** Unter **Einstellungen → „Version & Updates"** siehst du die
laufende Version und ob auf GitHub eine neuere steht. Ist ein Update verfügbar, genügt ein
Klick auf **„Jetzt aktualisieren"** – Core-Hub holt den neuen Code (`git pull` im
ursprünglichen Klon-Verzeichnis) und führt `install.sh --update` aus, mit Live-Log.
Anschließend startet der Dienst neu.

> Voraussetzung: Core-Hub wurde per `git clone` installiert (damit `git pull` funktioniert).
> Bei einem **privaten** Repository muss `git` auf dem Server angemeldet sein
> (gespeicherter Token oder SSH-Deploy-Key), sonst schlägt der Pull fehl und es wird der
> vorhandene Stand neu gebaut.

**Manuell** geht es genauso – denselben Installer erneut ausführen, er erkennt die
bestehende Installation und läuft im **Update-Modus**. Deine Daten unter
`/var/lib/core-hub` (Datenbank, Backups) bleiben erhalten:

```bash
cd docker-gui
git pull
sudo bash install.sh        # erkennt vorhandene Installation → Update
```

### Optionale Abhängigkeiten (schalten weitere Module frei)

```bash
sudo apt install docker.io                                   # Container
sudo apt install qemu-kvm libvirt-daemon-system virtinst     # VMs & VM-Netzwerke
sudo apt install samba                                       # SMB-Freigaben
sudo apt install caddy                                       # automatisches HTTPS
sudo apt install ufw                                         # Firewall
sudo apt install fail2ban unattended-upgrades                # Härtung
sudo apt install clamav clamav-daemon                        # Virenschutz
curl -fsSL https://ollama.com/install.sh | sh               # KI / Ollama
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
| GPU-Monitoring | NVIDIA (nvidia-smi), AMD (amdgpu sysfs), APU/UMA-Erkennung |
| KI | Ollama REST API, HuggingFace API (GGUF-Suche), systemd-Override |
| Design | Eigenes Design-System (Design-Tokens, SSE-Logs, xterm.js) |
| Deployment | systemd-Service, install.sh, sudoers-Allowlist, `.deb`-Builder |

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
| **11** | **SMTP-E-Mail**, **Alarm-Regeln** (vordefiniert + eigene Schwellwerte, Empfänger pro Regel), **Optimierungs-Panel**, **Web-Terminal**, HTTPS-überall, htop-genauer RAM, Deinstallation | ✅ |
| **12** | **Datei-Manager** (Browsen/Bearbeiten/Rechte, sudo-Fallback für System-Verzeichnisse), **1-Klick-Update in der Oberfläche** (git pull + install.sh --update mit Live-Log), Container-Migration als Doku | ✅ |
| **13** | **GPU-Dashboard** (NVIDIA + AMD / APU UMA), **KI/Ollama** (Hardware-Analyse, Zugriffsmodus, GGUF-Quantisierung, parallele Downloads, **1-Klick HTTPS** via Caddy – Hostname + alle LAN-IPs, HTTP-Sperre, Auto-Umschalten), **Samba Auto-Lifecycle** (Start/Stop/Firewall automatisch), **Container-Logs als SSE-Stream** (Echtzeit, kein Polling) | ✅ |

### Geplant / Ideen (kommende Phasen)
- ⏳ Mehrsprachigkeit (EN/DE)
- ⏳ Reverse-Proxy: weitere Backends (nginx/Traefik)

Die vollständige technische Planung steht in [KONZEPT.md](./KONZEPT.md).
