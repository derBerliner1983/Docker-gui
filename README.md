# Core-Hub

Weboberfläche zur Verwaltung eines Linux-Servers.

> **Diese Fassung ist bewusst auf zwei Bereiche reduziert: Dashboard und Terminal.**
> Alles andere (Container, VMs, Netzwerke, Backups, Freigaben, Sicherheit,
> Virenschutz, Updates, Paketverwaltung, Benutzer, Dateimanager, KI, Reverse-Proxy)
> wurde entfernt und wird später neu aufgebaut. Der Verlauf der alten Fassung
> bleibt in der Git-Historie erhalten.

---

## Was enthalten ist

### 📊 Dashboard
- **Prozessor**: Gesamtlast, Verlauf der letzten Minuten, Last je Kern
- **System**: Arbeitsspeicher aufgeschlüsselt (System / Docker / VM / frei) und Belegung der Dateisysteme
- **Hardware & Speicheraufteilung**: trennt nach Quelle – verbaut laut BIOS (SMBIOS/`dmidecode`),
  für das System nutzbar (Kernel), fest der GPU zugeteilt (UMA-Framebuffer) und dynamisch
  leihbar (GTT), dazu Speicherriegel, BIOS-Version und die relevanten Kernel-Boot-Parameter.
  Gedacht für APUs mit gemeinsamem Speicher wie **AMD Ryzen AI Max**.
- **Schnittstelle**: Datendurchsatz der Netzwerkkarten
- **Optimierung**: Hinweise zum Systemzustand

### 🖥️ Terminal
- Interaktive Shell im Browser (über WebSocket, `xterm.js`)
- **Ausführungsart wird vor dem Öffnen abgefragt** – wichtig, wenn nicht jeder
  Benutzer root ist oder gar keine eigene Linux-Kennung hat:
  - **Am Terminal anmelden**: die Konsole fragt selbst nach Benutzername und
    Passwort (`login`), wie an einer echten Konsole
  - **Als Linux-Benutzer**: startet direkt mit einem auf dem Rechner vorhandenen
    Konto (Auswahlliste aus `/etc/passwd`, ohne Passwortabfrage)
  - **Als Administrator (root)**: wie bisher
  - **Als Dienstkonto**: ohne erhöhte Rechte, mit der Kennung des Dienstes
  Nicht mögliche Arten werden mit Begründung ausgegraut (z. B. fehlendes
  passwortloses sudo). Auf Wunsch merkt sich die Oberfläche die Auswahl.

### 👤 Mein Konto
Erreichbar über das Benutzer-Panel unten in der Seitenleiste:
- Anzeigename ändern (der Anmeldename bleibt unverändert)
- Passwort ändern
- Zwei-Faktor-Anmeldung (TOTP) einrichten, per QR-Code oder Schlüssel, und wieder abschalten
- Farbschema: **Hell / Dunkel / System** – gespeichert am Benutzerkonto
- **Sprache** (DE/EN/FR/ES/IT) – ebenfalls am Konto gespeichert, gilt auf allen Geräten
- **Abmeldezeit**: nach wie viel Inaktivität automatisch abgemeldet wird
  (15 Minuten bis 8 Stunden oder „nie"; Voreinstellung 2 Stunden)

### ⚙️ Einstellungen
- **Name der Anwendung** (global für alle Benutzer): erscheint in der Seitenleiste,
  auf der Anmeldeseite und im Browser-Titel
- **Update-Quelle (Git-Repository)**: Repository und Branch sind änderbar (Umzug,
  eigener Fork); öffentlich ohne Zugangsdaten oder privat mit Benutzername und
  Token/Passwort – verschlüsselt gespeichert und nie wieder ausgeliefert.
  „Verbindung testen" prüft Erreichbarkeit und Zugangsdaten.
- **Version & Updates**: vorgeschlagen wird immer der neueste Stand, über die Liste
  lässt sich auch ein früherer einspielen (Rollback). „Was ist neu?" zeigt vorab
  Titel, Beschreibung, Commits und geänderte Dateien; das Update läuft mit
  Live-Protokoll direkt in der Oberfläche.
- System-Informationen: Version, Hostname, Plattform, Node.js, Datenverzeichnis, Laufzeit

### 🧩 Rahmen
- Anmeldung mit Benutzer und Passwort (JWT im Cookie), Abmelden in der Seitenleiste
- **Layout bearbeiten**: der Bleistift in der Titelleiste schaltet den Modus ein –
  Panels lassen sich sortieren, ausblenden und wieder einblenden; „Zurücksetzen"
  stellt den Auslieferungszustand her. Gespeichert wird pro Benutzerkonto.
- **Menüpunkte ausblenden**: Rechtsklick auf einen Eintrag der Seitenleiste
- Farbschema und Sprache pro Benutzerkonto (fünf Sprachen: DE/EN/FR/ES/IT)

---

## Installation

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`
⚠️ **Passwort nach dem ersten Login ändern.**

### Port

| | |
|---|---|
| **Standard-Port** | **4200** (HTTP) |
| Adresse | `http://SERVER-IP:4200` |
| Gesetzt in | `install.sh` (`PORT="${PORT:-4200}"`) → systemd-Unit `core-hub.service` als `Environment=PORT=…` |

Anderer Port bei der Installation:

```bash
sudo PORT=8080 bash install.sh
```

Nachträglich ändern: in `/etc/systemd/system/core-hub.service` die Zeile
`Environment=PORT=` anpassen, dann
`sudo systemctl daemon-reload && sudo systemctl restart core-hub`.
Den Port in der Firewall freigeben, falls eine aktiv ist
(z. B. `sudo ufw allow 4200/tcp`).

Es wird **kein** Reverse-Proxy mehr installiert. Wer HTTPS möchte, setzt einen
Proxy eigener Wahl davor (z. B. Caddy, nginx, Traefik, Pangolin) und leitet auf
`http://SERVER-IP:4200` weiter.

### Unterstützte Distributionen

`install.sh` erkennt den Paketmanager selbst und übersetzt die Paketnamen:

| Familie | Paketmanager |
|---|---|
| Debian, Ubuntu | `apt` |
| Arch, CachyOS, EndeavourOS, Manjaro | `pacman` |
| Fedora, RHEL, Rocky | `dnf` |
| openSUSE | `zypper` |

Installiert werden nur: Node.js, Build-Werkzeuge (für `better-sqlite3`),
`dmidecode` (BIOS-Speicherdaten), Docker (für die Speicher-Aufschlüsselung im
Dashboard) und – wo vorhanden – automatische Sicherheitsupdates.

Gut zu wissen:
- **Node.js 20.19+ oder 22.12+** wird vorausgesetzt (der Frontend-Build mit Vite 7 verlangt das);
  auf Debian/Ubuntu kommt Node 22 LTS über NodeSource, sonst aus den Distributionsquellen
- Eine liegengebliebene **pacman-Sperre** (`db.lck`) wird gelöst, sofern kein Paketvorgang läuft
- Die **sudoers-Allowlist** wird mit allen Pfadvarianten geschrieben (`/usr/bin`, `/usr/sbin`, `/bin`, `/sbin`),
  weil Arch alles unter `/usr/bin` führt
- Git `safe.directory` wird systemweit gesetzt, damit `sudo git pull` und das
  In-App-Update in einem Verzeichnis funktionieren, das einem anderen Benutzer gehört

### Update

```bash
cd docker-gui
git pull
sudo bash install.sh
```

### Betrieb hinter einem Reverse-Proxy
- Auf dem **Wurzelpfad** läuft es ohne Zusatzkonfiguration
- Für einen **Unterpfad** den Basispfad beim Bauen setzen:
  `VITE_BASE=/corehub/ npm run build` – ohne das fordert der Browser die
  Asset-Dateien unter `/assets/…` an und die Seite bleibt weiß
- `X-Forwarded-*` wird ausgewertet, damit Client-Adresse und Protokoll stimmen

---

## Technik

| Bereich | Verwendet |
|---|---|
| Backend | Node.js, Fastify, better-sqlite3, dockerode, systeminformation |
| Frontend | React, TypeScript, Vite, React Router, xterm.js, lucide-react |
| Dienst | systemd (`core-hub.service`), Daten unter `/var/lib/core-hub` |

```
backend/src/routes/    auth · system · settings · terminal · prefs
backend/src/lib/       privilege · pkgmgr · hardware · updatesource · secrets · totp
frontend/src/pages/    Login · Dashboard · Terminal
```

### Selbst-Update aus der Oberfläche

Die Endpunkte für Versionsprüfung und In-App-Update sind weiterhin vorhanden
(`/api/settings/version`, `/api/settings/update/stream`), inklusive frei
wählbarer Git-Quelle und Rollback auf einen früheren Stand. Die zugehörige
Oberfläche kommt mit der Einstellungsseite zurück; bis dahin läuft das Update
über `sudo bash install.sh`.

---

## Lizenz

MIT
