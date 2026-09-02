<div align="center">

# ⬡ Core-Hub

**Die Zentrale deines Linux-Servers.** · `v0.7.6`

Web-basiertes Server-Management für headless Linux – Docker, VMs, Netzwerke, Firewall, Sicherheit, KI & mehr.
Alles im Browser. Ohne SSH, ohne Desktop.

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
- Nur für Admins, Authentifizierung über das Login-Cookie

### 🐳 Container
- Anlegen (Wizard: Image, Ports, Env, Volumes, Gruppe, eigenes Icon)
- Start / Stop / Restart / Delete · Neustart-Richtlinien
- **Gruppen / Kategorien**: Container in auf-/zuklappbare Gruppen sortieren (z. B. „Datenbanken") – Zustand bleibt gespeichert; **dynamische Kategorie-Tabs** oben in der Übersicht zum Filtern
- **Eigenes Icon** pro Container (Bild-URL) oder automatisches Symbol
- **Detailseite** pro Container: **Live-Logs als SSE-Stream** (Echtzeit, kein Polling), CPU-Verlaufsgraph, RAM-Anzeige, Ports, Volumes, Env-Variablen; Container bearbeiten/neu anlegen inkl. **virtuelle IPs / mehrere Netzwerke**
- **„Update verfügbar"-Erkennung** (Registry-Digest-Vergleich) + 1-Klick-Update
- **Virtuelle IPs**: Container können zusätzlich in macvlan/ipvlan-Netzwerke eingehängt werden (feste IP oder DHCP) – direkt beim Erstellen oder Bearbeiten

### 🧩 App-Vorlagen / 1-Klick-Installation
- **Unraid Community Store** (tausende Apps aus dem Unraid-Feed) + **Docker Hub Suche**
- Pro Vorlage: Image, Ports, Volumes & Env vorausgefüllt – nur Name/Passwort setzen
- **Port-Konflikt-Erkennung vorab**: belegte Host-Ports werden vor dem Image-Download gemeldet (mit Hinweis auf Macvlan als Alternative für Port 53 usw.)
- Bei Installationsfehler: halb angelegte Container werden automatisch entfernt (keine Leichen)
- Netzwerkmodus wählbar: Standard (bridge), host, oder eigenes macvlan-Netz mit **statischer IP**
- **Macvlan direkt im Dialog anlegen**: Parent-Interface, Subnetz, Gateway, VLAN & IP setzen – ohne Umweg über die Netzwerke-Seite (auch beim Container-Bearbeiten/-Erstellen)
- Host-Port-Konflikte erkennen jetzt auch Nicht-Docker-Dienste (z. B. systemd-resolved auf Port 53)
- Kategorien und Icons werden beim Installieren automatisch übernommen

### 🖥️ Virtuelle Maschinen (libvirt/KVM)
- VMs erstellen (RAM, CPU, Disk, ISO), starten / herunterfahren / neustarten
- Snapshots, Autostart, Löschen

### 🌐 Netzwerke & VLANs
- **Docker-Netzwerke**: bridge / macvlan / ipvlan, VLAN-Tag, isolierte Netze, feste IP + Aliasse
- **VM-Netzwerke**: libvirt-Netzwerke (NAT / isoliert / Bridge + VLAN), VM anhängen
- **Virtuelle IPs (Tab)**: Übersicht aller Container-IPs und VM-DHCP-Leases nach Netzwerk/Treiber
- **Firewall (ufw)** – vollständige Regelwerwaltung:
  - Regeln allow/deny/reject nach Port / Protokoll / Quell-IP / Richtung (ein-/ausgehend)
  - Regeln mit **Kommentar/Namen** anlegen, **bearbeiten**, **filtern** und löschen
  - **Mehrere Quell-Adressen** auf einmal (→ je eine Regel)
  - Regeln **deaktivieren/reaktivieren** (Parkbucht – gemerkt zum Wiederherstellen)
  - **Keine automatischen Schutz-Regeln**: Updates fügen keine Regeln hinzu, der Admin entscheidet selbst über Freigaben
  - Beim **Aktivieren** der Firewall bekommen SSH (22) und Web-UI (443) – nur falls noch keine Regel existiert – eine Freigabe **ausschließlich fürs echte LAN-Subnetz des PCs** (aus `ip addr`, RFC-1918); **niemals** Anywhere/Internet
  - Port-Freigaben **pro Port als LAN/Internet-Schalter** unter „Sicherheit"
- **Verbindungsprotokoll** (persistente DB): zeigt blockierte/erlaubte Verbindungen, filterbar, CSV-Export

### 🔒 HTTPS & Reverse-Proxy (Caddy) — optional einblendbar
- **Standardmäßig ausgeblendet**: erst über Einstellungen → Reverse-Proxy aktivieren, dann erscheint der Eintrag in der Navigation
- Backend-Auswahl vorbereitet (Caddy aktiv; nginx/Traefik als „geplant")
- Pro Container HTTPS per Schalter aktivieren oder alle auf einmal
- Automatische Zertifikate über interne CA (kein Let's Encrypt/Domain nötig)
- Root-CA-Download → einmal auf Geräten installieren, überall grünes Schloss
- Für öffentliche Domains: automatisches Let's Encrypt

### 🛡️ Sicherheit (Audit & Härtung)
- Sicherheits-Scan mit **Score (0–100)** + Note
- Prüft: SSH, Firewall, Sicherheitsupdates, fail2ban, AppArmor/SELinux, Konten ohne Passwort, offene Ports, privilegierte Container, docker.sock, Standard-Passwort
- **1-Klick-Härtung** pro Fund
- **Alarm-Regeln** (vordefiniert + eigene Schwellwerte), **Hintergrund-Monitor** alle 60 s mit Anti-Spam

### 🦠 Virenschutz (ClamAV)
- ClamAV installieren, Signaturen aktualisieren, Verzeichnisse scannen (Live-Fortschritt)

### 🔄 System-Updates
- apt / dnf / pacman: Updates suchen, einzeln oder alle installieren
- **„Nach Updates suchen"** und **„Alle installieren"** stehen direkt am Panel „Verfügbare Updates" – also bei der Liste, auf die sie sich beziehen
- Die Installation läuft als **Live-Stream** mit sichtbarer Paketmanager-Ausgabe – ein Upgrade mit über hundert Paketen dauert Minuten und brach als einzelner Request mit „Failed to fetch" ab
- Fehlermeldungen nennen die **tatsächliche Ursache** (fehlendes Paket, gesperrte Datenbank, Netzfehler); der Hinweis auf fehlende Root-Rechte erscheint nur noch, wenn sudo das wirklich meldet
- Eine liegengebliebene pacman-Sperre (`db.lck`) wird erkannt und gelöst, sofern nachweislich kein Paketvorgang läuft – sonst kommt ein verständlicher Hinweis statt „Kann Datenbank nicht sperren"
- Auf Arch/CachyOS wird `pacman -Syu` verwendet (kein Teilupgrade mit veraltetem Index), das Zeitlimit reicht für ein volles Systemupgrade

### 💾 Backups
- Docker-Volumes, Verzeichnisse (tar.gz), VM-qcow2 – Download / Löschen
- **Automatische Zeitpläne** (Cron) mit Aufbewahrung; alte Backups automatisch aufgeräumt

### 🔔 Benachrichtigungen
- **Webhook** (Discord, Slack, Mattermost) und **E-Mail per SMTP**
- Ereignisse einzeln schaltbar; eigene Empfänger-Adressen pro Alarm-Regel

### 📁 SMB-Freigaben & 👥 Benutzer
- Ordner freigeben, SMB-Benutzer verwalten; **Samba Auto-Lifecycle** (Firewall automatisch)
- Core-Hub-Logins (Rollen) + Linux-Benutzer + **2FA/TOTP**

### 📂 Datei-Manager
- Verzeichnisbaum, Textdateien bearbeiten, hochladen, umbenennen, löschen, herunterladen
- Rechte (chmod) und Eigentümer auch in `/etc`, `/opt` via sudoers

### 🤖 KI / Ollama
- Status, Modelle, VRAM-Anzeige, Hardware-Analyse, empfohlene Modellgröße
- **Zugriffsmodus**: lokal / LAN per Schalter; **1-Klick HTTPS** via Caddy
- **Modell-Suche** (Empfehlungen + HuggingFace GGUF-Suche + Quantisierungsselektor)
- Mehrere Modelle parallel laden

### 🌍 Mehrsprachigkeit
- **5 Sprachen** umschaltbar: Deutsch, Englisch, Français, Español, Italiano (Einstellungen → Sprache)
- Browsersprache wird automatisch erkannt; Wahl im Browser gespeichert
- **Tiefe Abdeckung**: Navigation, Seitentitel, Panels, Dialoge, Buttons & Tooltips übersetzt
- **Deutsch = Schlüssel**: jeder deutsche Quelltext ist selbst der Übersetzungs-Schlüssel – fehlt eine Übersetzung, erscheint automatisch der deutsche Originaltext
- **Sprache leicht anpassbar**: neue Sprache = eine Locale-Datei mit `deutsch → übersetzt`-Zuordnungen, fertig (`frontend/src/lib/locales/`)

### 🧠 Hardware & Speicheraufteilung
- Zeigt getrennt nach Quelle, wie der Speicher aufgeteilt ist: **verbaut** (BIOS/SMBIOS), **für das System nutzbar** (Kernel), **fest der GPU zugeteilt** (UMA-Framebuffer aus dem BIOS) und **dynamisch leihbar** (GTT)
- Zu finden auf dem **Dashboard**
- Gedacht für APUs mit gemeinsamem Speicher wie **AMD Ryzen AI Max** – dort ist genau diese Unterscheidung die Frage
- Dazu Speicherriegel, BIOS-Version und die **Kernel-Boot-Parameter**, die die Aufteilung beeinflussen (`amdgpu.gttsize`, `amdgpu.vramlimit`, `mem`, `memmap` …) mit Erklärung

### ⚙️ Einstellungen
- Passwort & 2FA, System-Info, Version & Update-Prüfung (git + GitHub-Releases)
- **1-Klick-Update** in der Oberfläche (git pull + install.sh, Live-Log) – nach der Installation erscheint sofort der **„Seite neu laden"**-Button (kein manuelles F5 nötig)
- **Update-Quelle frei wählbar**: eigenes Git-Repository + Branch eintragen und jederzeit ändern (z. B. nach einem Umzug oder für einen Fork)
  - **Öffentlich**: keine Zugangsdaten nötig
  - **Privat**: Benutzername + **Zugriffstoken** (empfohlen) oder Passwort – **AES-256-GCM-verschlüsselt** gespeichert, nie wieder ausgeliefert und niemals im Log sichtbar
  - **Verbindungstest** direkt in der Oberfläche
- **Reverse-Proxy entfernen**: Caddy stoppen und aus dem Autostart nehmen, auf Wunsch auch das Paket deinstallieren. Die von Core-Hub erzeugte Caddyfile wird gesichert, eine eigene Konfiguration bleibt unangetastet
- **Versionsauswahl mit Rollback**: vorgeschlagen wird immer die neueste Version; per Dropdown lässt sich auch ein **früherer Stand** (Tag oder Commit inkl. Datum & Versionsnummer) einspielen
- **„Was ist neu?"** – vor dem Update sehen, was der Stand bringt: Titel und Beschreibung direkt als Vorschau (voller Text per **Hover**) und im **Popup** alle enthaltenen Änderungen mit Beschreibungstext, Autor und Datum sowie die geänderten Dateien mit Zeilenbilanz. Bei einem Rollback wird angezeigt, welche Änderungen dabei **wegfallen**
- **IPv4/IPv6-Umschalter**: standardmäßig **nur IPv4**; IPv6 bei Bedarf aktivierbar (persistent via `sysctl`)
- **Konfigurations-Migration**: Export/Import als `.tar.gz` (DB + Caddy-Zertifikate + SMB)

### ↕️ Anpassbare Oberfläche (pro Benutzer)
- **Layout bearbeiten**: der **Bleistift oben in der Titelleiste** schaltet den Modus ein (nur auf Seiten mit Panels) – darin lassen sich Panels sortieren, **ausblenden** und über Chips wieder **einblenden**; „Zurücksetzen" stellt den Auslieferungszustand her
- **Sidebar-Einträge** und **Panels** per **Drag & Drop** sortieren (Greifpunkt zum Ziehen)
- **Menüpunkte ausblenden**: **Rechtsklick** direkt auf den Eintrag in der Seitenleiste → „Menüpunkt ausblenden"
- **Wieder einblenden** unter *Einstellungen → Menüpunkte* (Schalter je Eintrag, „Alle einblenden") – „Einstellungen" selbst bleibt immer sichtbar
- Das Kontextmenü hängt am `<body>` und richtet seine Breite am längsten Eintrag aus; es wird weder von der Seitenleiste beschnitten noch ragt es aus dem Fenster
- Reihenfolge und Sichtbarkeit werden **serverseitig pro Benutzer** gespeichert – jeder hat sein eigenes Layout

---

## Installation

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`
⚠️ **Passwort nach dem ersten Login ändern!**

### Unterstützte Distributionen

`install.sh` erkennt den Paketmanager selbst und übersetzt alle Paketnamen passend:

| Familie | Paketmanager | Status |
|---|---|---|
| Debian, Ubuntu | `apt` | vollständig getestet |
| **Arch, CachyOS**, EndeavourOS, Manjaro | `pacman` | unterstützt |
| Fedora, RHEL, Rocky | `dnf` | unterstützt (best effort) |
| openSUSE | `zypper` | unterstützt (best effort) |

Was sich je nach Distribution automatisch unterscheidet:

- **Node.js** kommt auf Debian/Ubuntu über NodeSource, überall sonst aus den
  eigenen Paketquellen (Arch & Co. liefern bereits ein aktuelles Node)
- **Caddy** über das offizielle Repo (Debian/Ubuntu) bzw. direkt aus den Paketquellen
- **Paketnamen** werden übersetzt (z. B. `docker.io` → `docker`,
  `qemu-system-x86 libvirt-daemon-system virtinst` → `qemu-base libvirt virt-install …`)
- **Dienste** werden dort aktiviert, wo sie nicht von selbst starten (Docker, libvirt)
- **Samba-Units** heißen je nach Familie `smbd`/`nmbd` oder `smb`/`nmb` – Core-Hub erkennt das
- **Fehlende Standardkonfigurationen** werden angelegt: Arch liefert weder eine
  `smb.conf` noch fertige ClamAV-Configs mit (nur `*.sample`)
- **Automatische Sicherheitsupdates** gibt es nur, wo die Distribution sie kennt
  (`unattended-upgrades` / `dnf-automatic`) – auf Arch entfällt der Punkt
- Die **sudoers-Allowlist** wird mit allen Pfadvarianten geschrieben
  (`/usr/bin`, `/usr/sbin`, `/bin`, `/sbin`), weil Arch alles unter `/usr/bin` führt

Optionale Module (Docker, KVM, Samba, Caddy, ClamAV, UFW, fail2ban) brechen die
Installation nicht mehr ab, wenn ein Paket fehlt – es gibt eine Warnung und das
jeweilige Modul bleibt inaktiv.

**Node.js 24+** (z. B. Node 26 auf CachyOS) verlangt von nativen Modulen C++20.
`better-sqlite3` ist deshalb auf **12.x** angehoben (9.x baute noch mit C++17 und
scheiterte an Node 26 mit einem Fehler in `v8-function-callback.h`). Version 12
unterstützt laut `engines` Node 20 bis 26 – Debian/Ubuntu mit Node 20 laufen also
weiter. Bestehende Datenbanken werden unverändert weiterverwendet.

**npm ab Version 12** (z. B. auf Arch/CachyOS) führt Install-Skripte von
Abhängigkeiten standardmäßig nicht mehr aus. Ohne sie wird `better-sqlite3` nicht
kompiliert und der Dienst startet nicht (*„Could not locate the bindings file"*).
Die nötigen Freigaben stehen deshalb im Feld `allowScripts` der jeweiligen
`package.json` (npm 12 zieht dieses Feld einer `.npmrc` vor und ignoriert die
`.npmrc` dann komplett). Zusätzlich prüft `install.sh` nach dem Build, ob die
native Bindung wirklich lädt, und baut sie sonst gezielt nach – schlägt auch das
fehl, wird das Build-Log direkt ausgegeben statt verschluckt.

### Update auf eine neue Version

**In der Oberfläche:** *System-Updates* oder *Einstellungen* → „Version & Updates" → **„Jetzt aktualisieren"**

Dort lässt sich außerdem die **Update-Quelle** (Git-Repository, Branch, ggf. Zugangsdaten für ein
privates Repository) festlegen und über das Dropdown „Version auswählen" gezielt auf einen
**früheren Stand zurückrollen**.

**Manuell:**
```bash
cd docker-gui
git pull
sudo bash install.sh
```

### Optionale Abhängigkeiten

```bash
sudo apt install docker.io                                   # Container
sudo apt install qemu-kvm libvirt-daemon-system virtinst     # VMs
sudo apt install samba                                       # SMB-Freigaben
sudo apt install caddy                                       # HTTPS
sudo apt install ufw                                         # Firewall
sudo apt install fail2ban unattended-upgrades                # Härtung
sudo apt install clamav clamav-daemon                        # Virenschutz
curl -fsSL https://ollama.com/install.sh | sh               # KI / Ollama
```

Fehlt ein Tool, zeigt das Modul einen Hinweis statt eines Fehlers.

---

## Architektur & Sicherheit

```
Browser (überall)
    │ HTTPS + REST + WebSocket + SSE
    ▼
Core-Hub (systemd-Dienst auf dem Host)
├── Fastify (Node.js / TypeScript)
├── JWT-Auth + bcrypt, 2FA/TOTP, Rollen, Audit-Log
├── SQLite (core-hub.db)
└── Steuert via Docker-API, virsh, systemd, ufw, samba, caddy …
```

> Core-Hub hat weitreichenden Zugriff auf den Server:
> - Default-Passwort sofort ändern
> - Nur im LAN oder hinter VPN/Reverse-Proxy betreiben
> - Privilegierte Befehle laufen über eine **sudoers-Allowlist** (kein Root-Prozess)
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
| i18n | Eigenes leichtgewichtiges i18n-System (kein Framework) |
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
| **9** | Container-Updates, Virenschutz, 2FA, Backup-Zeitpläne, Benachrichtigungen, App-Vorlagen | ✅ |
| **10** | Container-Detailseite, Rate-Limiting, Session-Timeout, Mobile-Optimierung, `.deb`-Builder | ✅ |
| **11** | SMTP-E-Mail, Alarm-Regeln, Optimierungs-Panel, Web-Terminal | ✅ |
| **12** | Datei-Manager, 1-Klick-Update in der Oberfläche, Container-Migration (Doku) | ✅ |
| **13** | GPU-Dashboard, KI/Ollama (HTTPS, GGUF, parallele Downloads), Samba Auto-Lifecycle, SSE-Logs | ✅ |
| **14** | **Virtuelle IPs** (macvlan/ipvlan, mehrere Netzwerke pro Container, IP-Übersicht-Tab), **App-Store** (Unraid Community + Docker Hub, Port-Konflikt-Erkennung, Aufräumen bei Fehler), **Dynamische Kategorie-Tabs** (Container-Übersicht), **Mehrsprachigkeit** (DE/EN, erweiterbar) | ✅ `v0.7.3` |
| **15** | **IPv4/IPv6-Umschalter** (Standard nur IPv4), **Drag-&-Drop-Sortierung** von Sidebar & Panels (pro Benutzer, serverseitig), **Inline-Macvlan** im Container-/App-Dialog, **Firewall ohne Auto-Schutzregeln** (nur LAN-only-Freigabe für SSH/443 beim Aktivieren), Host-Port-Konflikterkennung inkl. Nicht-Docker-Dienste, Update mit sofortigem Reload-Button | ✅ `v0.7.4` |
| **16** | **5 Sprachen** (DE/EN/FR/ES/IT), Navigation & Seitentitel auf i18n-Schlüssel, **Reverse-Proxy ein-/ausblendbar** über Einstellungen (Standard aus, Backend-Auswahl vorbereitet) | ✅ `v0.7.5` |
| **17** | **Tiefe i18n-Abdeckung** (Panels, Dialoge, Buttons, Tooltips, Bestätigungen) nach dem Prinzip „Deutsch = Schlüssel"; ~470 Texte in EN/FR/ES/IT übersetzt, modulweite `tt()`-Funktion für Übersetzung auch in Unterkomponenten | ✅ `v0.7.6` |
| **18** | **Freie Update-Quelle** (eigenes Git-Repository/Branch, öffentlich oder privat mit verschlüsselt gespeichertem Token/Passwort, Verbindungstest), **Versionsauswahl inkl. Rollback** auf einen früheren Stand, **„Was ist neu?"-Popup** mit Beschreibungstext, Änderungen und Dateiliste (Volltext auch per Hover), **Menüpunkte per Rechtsklick ausblenden** und in den Einstellungen wieder einblenden | ✅ `v0.24.0` |
| **19** | **Distributionsunabhängiger Installer**: Arch/CachyOS (`pacman`), Fedora (`dnf`) und openSUSE (`zypper`) zusätzlich zu Debian/Ubuntu – inkl. übersetzter Paketnamen, Dienst-Aktivierung, Samba-/ClamAV-Grundkonfiguration und pfadunabhängiger sudoers-Allowlist · **npm-12-Freigaben** für native Module (`better-sqlite3`) inkl. Selbstreparatur im Installer · **better-sqlite3 12.x** für Node 24+/C++20 | ✅ `v0.26.0` |
| **20** | **Hardware- & Speicheraufteilung** (BIOS vs. Kernel vs. GPU-UMA/GTT, Kernel-Parameter) für APUs mit gemeinsamem Speicher, **Reverse-Proxy entfernbar**, echte Fehlerursachen statt pauschalem „keine Root-Rechte" | ✅ `v0.27.0` |
| **21** | **Editor-Modus** für Panels (sortieren, ausblenden, einblenden, zurücksetzen), **Update-Installation als Live-Stream**, Git `safe.directory` systemweit, verwaiste pacman-Sperre wird gelöst | ✅ `v0.28.0` |

### Geplant / Ideen
- ⏳ Restliche Detailtexte/Backend-Meldungen übersetzen
- ⏳ Reverse-Proxy: nginx/Traefik tatsächlich anbinden

Die vollständige technische Planung steht in [KONZEPT.md](./KONZEPT.md).
