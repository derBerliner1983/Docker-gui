# Core-Hub – Konzept & Roadmap

> **Core-Hub** – die Zentrale deines Linux-Servers.

## Vision

Web-basiertes Verwaltungs-Dashboard für Linux-Server (headless).  
Kein Desktop nötig – alles per Browser vom PC, Handy oder Tablet.  
Designsprache: eigenes Design-System (Emerald-Akzent, Inter-Font, Hell/Dunkel, Glass-Effekte).

---

## Architektur

```
Browser (überall)
    │ HTTPS + WebSocket + SSE
    ▼
Core-Hub Backend   ← läuft als systemd-Dienst auf dem Server
├── Fastify (Node.js/TypeScript)
├── JWT-Auth + bcrypt + 2FA (TOTP)
├── SQLite (Users, Audit-Log, Proxy-Hosts, Backup-Pläne, Alarm-Regeln …)
├── Docker Engine API (dockerode) – Container, Images, Netzwerke
├── systeminformation – CPU, RAM, Disk, Netzwerk, GPU (NVIDIA + AMD/APU)
└── System-Befehle über sudoers-Allowlist
    ├── systemctl  (Dienste, Samba, Ollama, SSH …)
    ├── smbd / smbpasswd  (Samba + UFW-Lifecycle)
    ├── ufw  (Firewall-Regeln, Samba-LAN-Freigabe)
    ├── caddy  (HTTPS-Proxy, interne CA)
    ├── virsh / qemu-img  (VMs + Snapshots)
    ├── ollama  (KI-Modelle, GGUF-Downloads)
    └── tar / rsync / clamav / apt / dnf
```

**Installation:** Ein einziges `bash install.sh` → systemd-Service aktiv.

---

## Design (Design-Tokens)

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

### ✅ Phase 4 – Updates, Backup, SMB & Benutzer (implementiert)

| Feature | Status |
|---|---|
| **System-Updates** (apt/dnf/pacman: suchen + einspielen) | ✅ |
| **Docker-Backup** (Volumes via busybox, ohne Host-Root) | ✅ |
| **Verzeichnis-Backup** (tar.gz) | ✅ |
| **VM-Backup** (qcow2 komprimiert) | ✅ |
| **Backup Download / Löschen** | ✅ |
| **SMB-Freigaben** (anlegen/löschen, smbd steuern, SMB-User) | ✅ |
| **Benutzerverwaltung** (Core-Hub Logins + Linux-User, sudo) | ✅ |
| **Rechte-Modell** (sudoers-Allowlist via install.sh) | ✅ |

### ✅ Phase 5 – Automatisches HTTPS (implementiert)

| Feature | Status |
|---|---|
| **Reverse-Proxy** auf Caddy-Basis | ✅ |
| **HTTPS pro Host** per Schalter aktivieren/deaktivieren | ✅ |
| **HTTPS für alle** Hosts auf einmal | ✅ |
| **Interne CA** (`tls internal`) – automatische Zertifikate | ✅ |
| **Root-CA Download** zum Installieren auf Geräten | ✅ |
| **Auto-Vorschläge** aus laufenden Containern mit HTTP-Port | ✅ |
| Caddyfile-Generierung + Reload per Klick | ✅ |

#### So funktioniert das HTTPS-Modul
1. Jeder Container mit HTTP-Port bekommt einen Hostnamen (z.B. `dienst.lan`).
2. Schalter „HTTPS" pro Host → Caddy terminiert TLS mit selbst erzeugtem Zertifikat.
3. Core-Hub schreibt einen verwalteten Block in `/etc/caddy/Caddyfile` und lädt Caddy neu.
4. Root-CA einmal herunterladen + auf Geräten installieren → überall grünes Schloss.
5. Für öffentliche Domains nutzt Caddy automatisch Let's Encrypt.

### ✅ Phase 6 – Einstellungen & Migration (implementiert)

| Feature | Status |
|---|---|
| Einstellungen-Seite, Passwort ändern | ✅ |
| System-Info + erkannte Module | ✅ |
| **Migration Export/Import** (DB + Zertifikate + SMB) als .tar.gz | ✅ |
| Import per **Drag & Drop**, Neustart-Übernahme | ✅ |

### ✅ Phase 7 – Netzwerke, VLANs & Firewall (implementiert)

| Feature | Status |
|---|---|
| Docker-Netzwerke auflisten/erstellen/löschen | ✅ |
| **VLANs** via macvlan/ipvlan + Eltern-Schnittstelle + VLAN-ID | ✅ |
| **Isolierte Netze** (internal) für unsichere Container | ✅ |
| Container verbinden mit **fester IP** + Aliassen | ✅ |
| **Firewall** (ufw): Regeln allow/deny/reject nach Port/IP | ✅ |

### ✅ Phase 8 – Sicherheits-Check & Härtung (implementiert)

| Feature | Status |
|---|---|
| **Sicherheits-Scan** mit Score (0–100) + Note | ✅ |
| SSH (Root-Login, Passwort-Auth), Firewall-Status | ✅ |
| Sicherheitsupdates, Auto-Updates, fail2ban, Reboot | ✅ |
| Konten ohne Passwort, mehrere UID-0, offene Ports | ✅ |
| Docker: privilegierte Container, docker.sock-Mounts | ✅ |
| Konkrete **Härtungs-Tipps** pro Fund | ✅ |

---

### ✅ Phase 9 – abgeschlossen

| Feature | Status |
|---|---|
| Container „Update verfügbar"-Erkennung (Registry-Digest) + 1-Klick-Update | ✅ |
| VM-Netzwerke (libvirt: NAT/isoliert/Bridge + VLAN, VM anhängen) | ✅ |
| SSH ein-/ausschaltbar + 1-Klick-Härtung (Firewall/fail2ban/Auto-Updates/SSH) | ✅ |
| **Virenschutz (ClamAV): installieren, Signaturen updaten, scannen** | ✅ |
| Erweiterte Sicherheits-Checks (Standard-Passwort, AppArmor/SELinux, Zeit, AV) | ✅ |
| **2FA (TOTP)** für Logins (einrichten/aktivieren/deaktivieren, Abfrage beim Login) | ✅ |
| **Automatische Backup-Zeitpläne** (Cron-basiert, Aufbewahrung, „jetzt ausführen") | ✅ |
| **Benachrichtigungen** (Webhook für Discord/Slack/eigene + E-Mail, je Ereignis) | ✅ |
| **App-Vorlagen / 1-Klick-Install** beliebter Dienste (Nextcloud, Jellyfin, …) | ✅ |
| **Versionsanzeige + Update-Prüfung** gegen GitHub-Releases | ✅ |
| **Installer-Update-Modus**: erkennt bestehende Installation, aktualisiert datenschonend | ✅ |

### ✅ Phase 10 – Qualität & Betrieb (implementiert)

| Feature | Status |
|---|---|
| **Container-Detailseite** (Live-Logs-Polling, CPU/RAM-Sparkline, Env/Volumes/Ports) | ✅ |
| **Bestätigungsdialoge** bei Löschen (Container, VMs, App-/Linux-Benutzer) | ✅ |
| **Rate-Limiting** auf Login (5 Versuche / 15 min per IP) | ✅ |
| **Session-Timeout** (2h Inaktivität → automatischer Logout) | ✅ |
| **JWT-Ablaufzeit** von 7d auf 24h verkürzt | ✅ |
| **Audit-Log-Rotation** (Einträge älter 90 Tage werden täglich gelöscht) | ✅ |
| **Health-Endpunkt** `GET /health` (Version, Uptime – für Monitoring-Tools) | ✅ |
| **System-Dark-Mode** als Standard falls keine Präferenz gespeichert | ✅ |
| **Mobile-Optimierung** (Sidebar als Drawer, Touch-Targets, responsive Layouts) | ✅ |
| **`.deb`-Paket** (`build-deb.sh` – baut ein installationsfertiges Debian-Paket) | ✅ |

### ✅ Phase 11 – Alarme, E-Mail & Optimierung (implementiert)

| Feature | Status |
|---|---|
| **SMTP-E-Mail-Versand** (Server/Port/User/Passwort/SSL im UI, Test-Mail) | ✅ |
| **Alarm-Regeln**: vordefinierte Auffälligkeiten (SSH-Root, fail2ban-Sperren, Risiko-Ports, Score-Schwelle, privilegierte Container) | ✅ |
| **Eigene Schwellwert-Regeln** (CPU/RAM/Disk über X % für Y Minuten) | ✅ |
| **Empfänger pro Regel** (mehrere E-Mail-Adressen, sonst globale Adresse) | ✅ |
| **Hintergrund-Monitor** (prüft alle 60 s, Anti-Spam-Cooldown 1 h) | ✅ |
| **Optimierungs-Panel** im Dashboard (RAM-/CPU-Fresser, gestoppte Container, Swap, volle Platten) | ✅ |
| **Web-Terminal** (interaktive Root-Shell per xterm.js + WebSocket, node-pty mit `script`-Fallback) | ✅ |
| **Echter RAM-Wert** wie htop (aus /proc/meminfo) + Live-Updates alle 2 s | ✅ |
| **CPU-Gesamtlast als Tortendiagramm**, Einzelkerne einklappbar | ✅ |
| **HTTPS überall** (Caddy: HTTP→HTTPS-Redirect, Core-Hub nur auf localhost) | ✅ |
| **Deinstallation** (`install.sh --deinstall [--purge]`) + `--update`-Modus | ✅ |

### ✅ Phase 12 – Datei-Manager & 1-Klick-Update (implementiert)

| Feature | Status |
|---|---|
| **Datei-Manager** (Verzeichnisbaum, Textdateien direkt bearbeiten) | ✅ |
| Hochladen, Ordner anlegen, umbenennen, löschen, herunterladen | ✅ |
| **Rechte (chmod) und Eigentümer/Gruppe** anzeigen und ändern – auch in `/etc`, `/opt` via sudoers | ✅ |
| **1-Klick-Update in der Oberfläche** (`git pull` + `install.sh --update`, Live-Log) | ✅ |
| Update-Prüfung gegen GitHub-Releases und `VERSION`-Datei (funktioniert auch bei privaten Repos) | ✅ |
| **Konfigurations-Migration** (DB + Caddy-Zertifikate + SMB als `.tar.gz` exportieren/importieren) | ✅ |
| **Container-Migration von Unraid** (Schritt-für-Schritt-Anleitung, `docs/MIGRATION.md`) | ✅ |

### ✅ Phase 13 – GPU, KI/Ollama, Samba-Lifecycle & SSE-Logs (v0.7.1)

| Feature | Status |
|---|---|
| **GPU-Dashboard-Panel** (NVIDIA via nvidia-smi, AMD via amdgpu sysfs; APU/UMA korrekt als Unified Memory) | ✅ |
| GPU-Auslastung (%) + VRAM/UMA-Verbrauch als Donuts neben CPU/RAM auf dem Dashboard | ✅ |
| **KI/Ollama-Seite** (Status, Modell-Liste, VRAM pro Modell, Start/Stop-Schalter) | ✅ |
| **Hardware-Analyse**: RAM, GPU, VRAM; erkennt APU/UMA (Ryzen AI MAX, Apple Silicon-ähnlich) | ✅ |
| **Empfohlene Modellgröße** (Formel: `(Basis − 4 GB) × 0,7`) mit aufklappbarer Erklärung | ✅ |
| **Ollama Zugriffsmodus**: lokal (`127.0.0.1`) oder LAN (`0.0.0.0`) per Schalter – schreibt systemd-Override | ✅ |
| Zugriffs-URLs (`http://IP:Port`, `http://Hostname:Port`) direkt in der UI; HTTPS-URL wenn Caddy-Proxy aktiv | ✅ |
| **Beliebte Modell-Empfehlungen** (zuerst angezeigt), **HuggingFace GGUF-Suche** (darunter) | ✅ |
| **GGUF-Quantisierungsselektor**: wähle Q4_K_M / Q5_K_M / Q8_0 … beim HF-Laden (via `hf.co/<repo>:<quant>`) | ✅ |
| **Gleichzeitige Downloads**: mehrere Modelle parallel laden, Status pro Modell (Set-basiert) | ✅ |
| **Samba Auto-Lifecycle**: startet automatisch + öffnet LAN-Firewall (Ports 137–139, 445) beim ersten Eintrag | ✅ |
| Samba stoppt automatisch + blockiert Firewall wenn alle Freigaben entfernt werden | ✅ |
| Internet-Zugang für Samba nur explizit über Sicherheitseinstellungen | ✅ |
| **Container-Logs als SSE-Stream** (`follow: true`, kein Polling mehr) – Logs in Echtzeit | ✅ |
| **Taskmanager Dienste-Tab**: systemd-Dienste starten / stoppen / neustarten / Autostart | ✅ |

### ⏳ Geplant / Ideen (kommende Phasen)

| Feature | Status |
|---|---|
| Mehrsprachigkeit (EN/DE) | ⏳ |
| Reverse-Proxy: weitere Backends (nginx/Traefik) | ⏳ |

---

### 📓 Historie – ursprüngliche Phase-Planung

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
