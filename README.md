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
- Interaktive Root-Shell im Browser (über WebSocket, `xterm.js`)

### 🧩 Rahmen
- Anmeldung mit Benutzer und Passwort (JWT im Cookie), Abmelden in der Seitenleiste
- **Layout bearbeiten**: der Bleistift in der Titelleiste schaltet den Modus ein –
  Panels lassen sich sortieren, ausblenden und wieder einblenden; „Zurücksetzen"
  stellt den Auslieferungszustand her. Gespeichert wird pro Benutzerkonto.
- **Menüpunkte ausblenden**: Rechtsklick auf einen Eintrag der Seitenleiste
- Hell/Dunkel-Umschaltung, fünf Sprachen (DE/EN/FR/ES/IT)

---

## Installation

```bash
git clone https://github.com/derberliner1983/docker-gui.git
cd docker-gui
sudo bash install.sh
```

→ Erreichbar unter `http://SERVER-IP:4200` · Login: `admin` / `admin`
⚠️ **Passwort nach dem ersten Login ändern.**

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
- **Node.js** kommt auf Debian/Ubuntu über NodeSource, sonst aus den Distributionsquellen
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
