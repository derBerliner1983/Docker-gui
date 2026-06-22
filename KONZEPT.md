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

### 🟡 Phase 9 – begonnen

| Feature | Status |
|---|---|
| Container „Update verfügbar"-Erkennung (Registry-Digest) + 1-Klick-Update | ✅ |
| VM-Netzwerke (libvirt: NAT/isoliert/Bridge + VLAN, VM anhängen) | ✅ |
| SSH ein-/ausschaltbar + 1-Klick-Härtung (Firewall/fail2ban/Auto-Updates/SSH) | ✅ |
| Erweiterte Sicherheits-Checks (Standard-Passwort, AppArmor/SELinux, Zeit) | ✅ |
| 2FA (TOTP) für Logins | ⏳ |
| Automatische Backup-Zeitpläne (Backups × Cron, Aufbewahrung) | ⏳ |
| Benachrichtigungen (E-Mail/Webhook bei Events) | ⏳ |
| App-Vorlagen / 1-Klick-Install beliebter Dienste | ⏳ |
| Mobile-Optimierung, Mehrsprachigkeit, `.deb`-Paket | ⏳ |

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
