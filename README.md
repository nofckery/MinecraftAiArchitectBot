# Autonomous Low-Resource AI Minecraft Architect Bot (v2.1 SOTA & Survival)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-68a063?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Version" />
  <img src="https://img.shields.io/badge/Minecraft-1.20.4%20--%2026.3-3d85c6?style=for-the-badge&logo=minecraft&logoColor=white" alt="Minecraft Version" />
  <img src="https://img.shields.io/badge/Protocol-777%20Ready-blueviolet?style=for-the-badge&logo=curseforge&logoColor=white" alt="Protocol 777 Ready" />
  <img src="https://img.shields.io/badge/Test_Suites-33%2F33%20PASS%20%2B%2093%20Tier%20Tests-brightgreen?style=for-the-badge&logo=checkmarx&logoColor=white" alt="33 Suites & Tier Tests PASS" />
  <img src="https://img.shields.io/badge/Survival-Autonomous%20v2.1-success?style=for-the-badge&logo=shield&logoColor=white" alt="Survival Ready" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License: MIT" />
</p>

Ein autonomer, extrem ressourceneffizienter **Minecraft-Architekt- & Bau-Bot** in modernem Node.js (ES Modules, Node >= 20). Das System übersetzt natürliche Sprachbefehle, In-Game-Wollmarkierungen und Eingaben aus einem browserbasierten 3D-CAD-Studio in statisch geprüfte, ästhetisch anspruchsvolle Minecraft-Bauwerke — **vollständig survival-fähig auf echten Minecraft-Servern (Version 1.20.4 bis 26.3 / Protokoll 777)**.

Mit integriertem **First-Person Gamemode Cockpit (WASD & Maus-Steuerung)**, **Universellem Schematic Hub (.schem, .litematic, .nbt)**, **automatischer Kisten-Logistik**, **Mob-Verteidigung**, **dynamischem Gerüstbau** und **Multi-Provider KI-Router** mit Zero-Key Notfall-Gateway.

---

## ⚡ Schnellanleitung für Entwickler & Freunde (Quickstart in 4 Minuten)

Du möchtest am Projekt mitarbeiten oder den Bot sofort ausprobieren? Folge diesen fünf Schritten:

```bash
# 1. Repository klonen
git clone https://github.com/nofckery/MinecraftAiArchitectBot.git
cd MinecraftAiArchitectBot

# 2. Abhängigkeiten installieren
npm install

# 3. Lokale Konfiguration erstellen (Zero-Key Start!)
# Windows (PowerShell):
Copy-Item .env.example .env
# Linux / macOS:
cp .env.example .env

# 4. Gesamte Testsuite verifizieren (100% offline, kein Server nötig!)
npm test

# 5. Bot & Web-Dashboard starten
npm start
```

> [!TIP]
> **Sofort startklar ohne API-Keys (Zero-Key Notfall-Gateway):**
> Du brauchst beim ersten Start **keine** kostenpflichtigen Tokens oder Kreditkarten! Der Bot besitzt eingebaute Fallback-Gateways und schaltet bei Bedarf automatisch auf kostenlose Modelle um. Optional kannst du dich im Web-Dashboard via GitHub 1-Click Device Flow anmelden.

---

## 🌟 Die 6 Kernsäulen des Projekts

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │  1. 🧠 KOGNITIVE KI-ARCHITEKTUR & MULTI-PROVIDER KASKADE                    │
 │     • Zero-Key Notfall-Gateway (Kilo AI / LLM7)                             │
 │     • Multi-Provider Failover: Cerebras, Groq, Mistral, Gemini, GitHub      │
 │     • Lokale Modelle: Ollama, LM Studio, LocalAI via Auto-Discovery         │
 │     • 100% sichere node:vm Sandbox für deterministische Code-Synthese       │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │  2. 🎮 FIRST-PERSON COCKPIT / MANUELLER GAMEMODE                            │
 │     • Volle First-Person Kontrolle direkt im Browser (WASD, Maus-Look)      │
 │     • Echtes Minecraft HUD: Herzen, Hunger, Rüstung, Sauerstoffblasen        │
 │     • 36-Slot Interaktives Inventar, Quickbar-Auswahl, Item-Drop & Verzehr  │
 │     • Live-Ingame-Chat & Server-Slash-Befehle direkt aus dem Web-Overlay    │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │  3. 📐 3D-CAD-STUDIO & SCHEMATIC HUB                                        │
 │     • Browserbasiertes Three.js 3D Voxel-Studio mit Schicht-Inspektion (Y)  │
 │     • Universal-Unterstützung: .schem (WorldEdit), .litematic & .nbt        │
 │     • Automatische Baufeld-Dimensionierung & Zentrierung vor dem Spieler    │
 │     • Instant Holz-Palette-Swapper (erhält facing/half/shape zu 100%)       │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │  4. 🛡️ VOLLSTÄNDIGE SURVIVAL-AUTONOMIE                                      │
 │     • Phase 0 Rodung: Entfernt autonom störendes Terrain & Vegetation       │
 │     • Kisten-Beschaffung: Sucht Materialien selbstständig in Behältern (32m)│
 │     • ThreatManager: Wehrt Monster mit Schwert & Schild ab, heilt & flieht  │
 │     • ScaffoldManager: Baut temporäre Gerüste für hohe Wände & baut sie ab  │
 │     • SleepController: Geht nachts schlafen oder weicht temporär aus        │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │  5. 🔄 1-ACCOUNT SESSION HANDOFF                                            │
 │     • Nur 1 Minecraft-Account vorhanden? Bot pausiert automatisch bei Join  │
 │     • Sichert aktuellen Bauzustand exakt ab und geht in Ruhezustand         │
 │     • Sobald du den Server verlässt, reconnected der Bot & baut weiter      │
 ├─────────────────────────────────────────────────────────────────────────────┤
 │  6. 🔒 ENTERPRISE SICHERHEIT & 100% OFFLINE QS                              │
 │     • AES-256-GCM Credential Vault (keine Klartext-Tokens auf Festplatte)   │
 │     • 24 automatisierte Testsuiten (841 Tests), 100% offline & deterministisch│
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 📖 Inhaltsverzeichnis

1. [Systemarchitektur & Schichten](#1-systemarchitektur--schichten)
2. [Codebase-Struktur & Verzeichnisbaum](#2-codebase-struktur--verzeichnisbaum)
3. [Installation & Voraussetzungen](#3-installation--voraussetzungen)
4. [Konfiguration (.env Referenz)](#4-konfiguration-env-referenz)
5. [Ausführen des Bots](#5-ausführen-des-bots)
6. [Bedienung des Bots & Dashboards](#6-bedienung-des-bots--dashboards)
   - [6.1 Mission Control Web-Dashboard (http://localhost:3080)](#61-mission-control-web-dashboard-httplocalhost3080)
   - [6.2 First-Person Gamemode Cockpit (WASD & Maus)](#62-first-person-gamemode-cockpit-wasd--maus)
   - [6.3 3D-CAD-Studio & Voxel-Bearbeitung](#63-3d-cad-studio--voxel-bearbeitung)
   - [6.4 In-Game Chat-Befehle (Inklusive Schematics)](#64-in-game-chat-befehle-inklusive-schematics)
   - [6.5 Universal Schematic Hub (.schem, .litematic, .nbt)](#65-universal-schematic-hub-schem-litematic-nbt)
   - [6.6 Survival-Autonomie & Logistik](#66-survival-autonomie--logistik)
   - [6.7 1-Account Session Handoff](#67-1-account-session-handoff)
   - [6.8 Modell-Cockpit & Credential Vault](#68-modell-cockpit--credential-vault)
7. [Minecraft Server Setup (1.20.4 bis 26.3)](#7-minecraft-server-setup-1204-bis-263)
8. [Testsuite & Qualitätssicherung (24 Suiten, 841 Tests)](#8-testsuite--qualitätssicherung-24-suiten-841-tests)
9. [Gemeinsam auf GitHub arbeiten (Für Freunde & Contributors)](#9-gemeinsam-auf-github-arbeiten-für-freunde--contributors)
10. [Troubleshooting & FAQ](#10-troubleshooting--faq)
11. [Lizenz](#11-lizenz)

---

## 1. Systemarchitektur & Schichten

Das Projekt ist in modular entkoppelte Schichten unterteilt:

```text
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1. PERCEPTION LAYER (src/world/)                                            │
 │  - worldScanner.js: Bounding-Box Erkennung (Wolle), Terrain-Relief-Scan    │
 │  - undoManager.js: Atomares Disk-Journal (data/undo_journal.json)           │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Site-Context & Terrain-Snapshot
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 2. COGNITIVE LAYER (src/ai/)                                                │
 │  - llmRouter.js: 4-stufige Multi-Provider Kaskade (Cerebras, Groq, Gemini)  │
 │  - architectAgent.js: Isolierte node:vm Sandbox für Bauskript-Synthese      │
 │  - safeProbeWorker.js & localModelScanner.js: Endpunkt- & Modellprüfung     │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Prozedurales JavaScript Bauskript
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 3. GEOMETRY & LINTER LAYER (src/builder/)                                   │
 │  - voxelCanvas.js: 3D-Array mit State-Transform (Rotation/Spiegelung)       │
 │  - structuralLinter.js: 3D BFS-Floodfill (Statik, Semantik & Ästhetik-Audit)│
 │  - greedyMesher.js: /fill Quader-Kompression (-81% Paketaufwand)            │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Bereinigte, sortierte Block-Operationen
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 4. EXECUTION & SURVIVAL LAYER (src/bot/ & src/survival/)                    │
 │  - botClient.js: Mineflayer Lifecycle & Reconnect-Management                │
 │  - worldExecutor.js: Baufeld-Rodung, Blockstate-Parsing, Scaffolding        │
 │  - threatManager.js: Autonome Monster-Abwehr, Schild-Block & Taktik         │
 │  - chestManager.js & materialProcurement.js: Kistenscan & Entnahme          │
 │  - harvestManager.js: Werkzeugauswahl & Baufeld-Rodung                      │
 │  - scaffoldManager.js: Höhenbau & Gerüst-Setzen / -Rückbau                  │
 │  - sleepController.js: Nacht-Management & Ausweich-Disconnect               │
 └──────────────────────────────────────┬──────────────────────────────────────┘
                                        │ Telemetrie & Steuerbefehle (WebSocket)
                                        ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 5. MISSION CONTROL & GAMEMODE COCKPIT (src/web/)                            │
 │  - dashboardServer.js: Express + WebSocket Server (Port 3080)               │
 │  - Three.js 3D Viewport, 2D Topo-Reliefkarte, First-Person Gamemode         │
 │  - AES-256-GCM Credential Vault für gesicherte API-Tokens                   │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Codebase-Struktur & Verzeichnisbaum

```text
MinecraftAiArchitectBot/
├── index.js                      # Haupt-Einstiegspunkt (startet Bot & Dashboard)
├── package.json                  # Abhängigkeiten, Metadaten und Testskripte
├── .env.example                  # Vollständig dokumentierte Konfigurationsvorlage
├── .gitignore                    # Schützt Secrets (.env, .vault, logs) vor Git
├── CONTRIBUTING.md               # Richtlinien für Mitwirkende & Freunde
├── docs/                         # Vertiefende Spezifikationen & Architekturpläne
│   ├── architecture/             # Master-Spec, Survival- & Expeditions-Design
│   ├── testing/                  # 4-Tier Test-Architektur & Checklisten
│   └── specs/                    # CAD-Studio & Dashboard Meilensteine
├── data/
│   ├── schematics/               # Ordner für .schem, .litematic & .nbt Dateien
│   └── style_memory.json         # Gelernte Baustile und Designmuster
├── src/                          # Vollständiger modulare Quellcode
├── test/                         # 33 Standardisierte Backend- & System-Testsuiten
└── tests/                        # Moderne 4-Tier Test-Suite (93 Tests / 706 Checks)
```
│   │   └── ws/                   # WebSocket-Dispatcher & Gamemode-Handler
│   └── world/                    # Wahrnehmung & Undo
│       ├── worldScanner.js       # Terrain- & Wollmarkierungs-Scanner
│       └── undoManager.js        # 100% verlässliches Block-Rückgängigmachen
└── test/                         # 24 deterministische Offline-Testsuiten (841 Tests)
```

---

## 3. Installation & Voraussetzungen

### Systemanforderungen:
* **Node.js**: Version **>= 20.0.0** (empfohlen: Node 20 LTS oder 22 LTS).
* **NPM**: Version **>= 10.0.0**.
* **Minecraft Server**: Java Edition 1.20.4 bis 26.3 (Paper, Purpur, Fabric oder Vanilla).

### Native Build-Tools (für `node-canvas`):
Das Paket `canvas` erfordert je nach Betriebssystem native Bibliotheken für das 2D-Relief-Rendering:
* **Windows:** In der Regel werden vorkompilierte Binaries automatisch geladen. Falls ein Build-Fehler auftritt: [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) installieren.
* **Debian / Ubuntu:**
  ```bash
  sudo apt-get update
  sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ```
* **macOS (Homebrew):**
  ```bash
  brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
  ```

---

## 4. Konfiguration (.env Referenz)

Kopiere `.env.example` nach `.env`. Die wichtigsten Schalter:

| Variable | Standardwert | Zweck |
| :--- | :--- | :--- |
| `MC_HOST` | `127.0.0.1` | Host/IP des Minecraft-Servers |
| `MC_PORT` | `25565` | Port des Minecraft-Servers |
| `MC_USERNAME` | `BaumeisterKI` | Spielername des Bots |
| `MC_AUTH` | `offline` | `offline` (Cracked/LAN) oder `microsoft` |
| `MC_VERSION` | `auto` | `auto` (erkennt 1.20.4 bis 26.3 automatisch) oder feste Version |
| `BOT_OWNER` | `DeinName` | Dein In-Game Spielername (darf Befehle ausführen) |
| `BUILD_EXECUTION_MODE` | `auto` | `auto` (OP -> `hybrid_visual`, kein OP -> `pure_physical`), `rcon_visual` |
| `WEB_DASHBOARD_PORT` | `3080` | Port für das Web-Dashboard |
| `PRISMARINE_VIEWER_PORT`| `3081` | Port für den 3D-Prismarine Live-Stream |
| `SURVIVAL_AUTO_PROCUREMENT` | `true` | Sucht vor Baubeginn automatisch Materialien in Kisten |
| `SURVIVAL_THREAT_RADIUS` | `12` | Radius für die Mob-Erkennung und Selbstverteidigung |
| `SINGLE_ACCOUNT_HANDOFF_MODE` | `true` | Pausiert den Bot, wenn du mit demselben Account joinst |

> [!NOTE]
> Alle weiteren LLM-API-Keys (Cerebras, Groq, Mistral, Gemini etc.) können entweder in `.env` eingetragen oder **direkt im Web-Dashboard** ohne Neustart im verschlüsselten Vault hinterlegt werden!

---

## 5. Ausführen des Bots

```bash
# Bot und Web-Dashboard starten
npm start
```

Beim Start geschieht Folgendes:
1. Der Bot initialisiert das **Mission Control Dashboard** auf `http://localhost:3080`.
2. Er verbindet sich parallel zum konfigurierten Minecraft-Server.
3. Der In-Game Chat meldet: `[BaumeisterKI] Bereit für Bauaufträge! Nutze !help für Befehle.`
4. Im Browser unter `http://localhost:3080` siehst du Live-Telemetrie, Koordinaten, 2D-Reliefkarte und 3D-CAD-Studio.

---

## 6. Bedienung des Bots & Dashboards

### 6.1 Mission Control Web-Dashboard (`http://localhost:3080`)
Das Web-Dashboard ist das zentrale Steuerungszentrum:
* **Status-Bar:** Zeigt Verbindungsstatus (`ONLINE_ACTIVE`, `PAUSED_OWNER_INGAME`), Bot-Lebenspunkte, Hunger, Server-Rechte und Handoff-Modus.
* **2D-Topologische Reliefkarte:**
  * Zeigt ein 64x64 Block-Areal um den Bot mit echten Höhenlinien.
  * **Klick:** Setzt den Baubereich fest.
  * **Shift + Klick:** Lässt den Bot per A*-Pathfinder direkt zu diesen Koordinaten laufen!
* **Quick-Actions:** Bau abbrechen, Rückgängig machen (`Undo`), Blickwinkel ausrichten, Tageszeit abfragen.

### 6.2 First-Person Gamemode Cockpit (WASD & Maus)
Du kannst den Bot jederzeit direkt im Browser selbst steuern — wie in einem echten Minecraft-Client:
1. Klicke im Dashboard auf den Button **"🎮 Gamemode aktivieren"** (oder öffne `http://localhost:3080/gamemode.html` auf einem zweiten Bildschirm).
2. **Klick ins Spielfeld** aktiviert Pointer-Lock (Mauszeiger wird gefangen).
3. **Steuerung:**
   * `W, A, S, D` = Laufen / Bewegen
   * `Leertaste` = Springen
   * `Shift` = Schleichen / Sneaken
   * `Mausbewegung` = Freies Umschauen (mit Anti-Gimbal-Flip & absolutem Pitch-Clamp -89.9° bis +89.9°)
   * `1 bis 9` = Quickbar-Slots wählen
   * `Linksklick` = Schlagen / Block abbauen
   * `Rechtsklick` = Block platzieren / Item benutzen / Nahrung essen
   * `E` = 36-Slot Inventar & Crafting-Screen öffnen / schließen
   * `T` oder `Enter` = Chat-Leiste öffnen für Server-Nachrichten & Slash-Befehle (`/time set day` etc.)
   * `Q` = Gehaltenes Item droppen (`Strg+Q` = ganzen Stack droppen)
   * `F` = Gegenstand in die Zweithand (Off-Hand) tauschen
   * `ESC` = Gamemode verlassen (strikte LIFO-Priorität: schließt zuerst offene Overlays wie Inventar oder Chat).

### 6.3 3D-CAD-Studio & Voxel-Bearbeitung
* **Voxel Brush & Eraser:** Platziere oder lösche Voxel direkt mit der Maus in der 3D-Vorschau.
* **Pipette (Eyedropper):** Klicke auf Blöcke, um Material und Ausrichtung zu übernehmen.
* **Y-Slice Regler:** Schicht-für-Schicht-Inspektion von Fundament bis Dach.
* **Palette Swapper:** Tausche mit 1 Klick Holzarten (z. B. Eiche zu Schwarzeiche) — alle Treppen-, Stufen- und Tür-Ausrichtungen (`facing`, `half`, `shape`) bleiben exakt erhalten!
* **Stückliste:** Exakte Bedarfsanzeige aller Blöcke für den Survival-Modus.

### 6.4 In-Game Chat-Befehle (Inklusive Schematics)
Als autorisierter `BOT_OWNER` kannst du dem Bot direkt im Minecraft-Chat Anweisungen geben:

| Chat-Befehl | Wirkung |
| :--- | :--- |
| `!come` | Bot läuft direkt zu deiner aktuellen Spielerposition. |
| `!stop` | Bricht den laufenden Bauauftrag sofort ab (< 100 ms Reaktionszeit). |
| `!undo` | Liest das Undo-Journal und stellt die Original-Blöcke zu 100% wieder her. |
| `!schem list` | Listet alle im Ordner `data/schematics/` hinterlegten Baupläne auf. |
| `!schem load <datei>` | Lädt eine Schematic (`.schem`, `.litematic`, `.nbt`) und passt das Baufeld automatisch an. |
| `!schem build` | Startet den Bauplan sofort (inklusive automatischer Baufeld-Rodung). |
| `!schem clear` | Entlädt den aktuellen Bauplan aus dem Speicher. |
| `!preview` | Zeigt Maße und Stückliste im Chat; gibt ASCII-Schnitt im Terminal aus. |
| `!instant` | Schaltet zwischen interaktivem Konzept-Pitch und Sofort-Bau um. |
| `!style` | Zeigt gelernte Baustile aus `data/style_memory.json`. |
| `!scan` | Scannt das Terrain oder gesetzte Wolle-Eckpunkte vor dem Bot. |
| *Freitext-Prompt* | z. B. *"Baue einen gemütlichen Wachturm aus Fichtenholz mit Spitzdach"* |

> [!TIP]
> **Wolle-Markierungen für exakte Bauflächen:**
> Setze zwei beliebige Wollblöcke (z. B. weiße Wolle) diagonal in die Welt und tippe `!scan`. Der Bot nutzt diesen exakten Quader als Baugrundstück!

### 6.5 Universal Schematic Hub (.schem, .litematic, .nbt)
Der Bot verarbeitet alle gängigen Minecraft-Bauplan-Formate:
* **Sponge Schematic (`.schem`):** Standard-Austauschformat für WorldEdit.
* **Litematica (`.litematic`):** Nativer 64-Bit Bit-Array Unpacker/Packer.
* **Vanilla Structure Block (`.nbt`):** Standard Structure-Blocks des Minecraft-Clients.
* **Automatische Baufeld-Anpassung:** Beim Laden (`!schem load` oder Web-Upload) zentriert der Bot das Baufeld automatisch passgenau vor dem Spieler in dessen Blickrichtung.
* **Phase 0 Baufeld-Rodung:** Vor dem Bau entfernt der Bot störendes Gras, Blumen, Laub und Schutt von oben nach unten.

### 6.6 Survival-Autonomie & Logistik
Im Modus `pure_physical` (oder `auto` ohne OP-Rechte):
* **Kisten-Logistik:** Der Bot scannt alle Behälter (Kisten, Doppelkisten, Fässer, Shulker) im 32m-Radius und entnimmt selbstständig benötigte Materialien.
* **Monster-Abwehr (Threat Manager):** Feinde im 12m-Radius werden erkannt. Der Bot pausiert den Bau, zückt Waffe und Schild, hält Creeper auf Abstand, weicht bei < 4 Herzen zurück und isst Nahrung.
* **Nacht & Bett (Sleep Controller):** Bei Nachteinbruch sucht der Bot ein freies Bett im Umkreis. Findet er keines, loggt er sich kurz aus, damit die Mitspieler durchschlafen können, und joint bei Tag automatisch wieder.
* **Gerüstbau (Scaffolding):** Bei hohen Bauwerken platziert der Bot automatisch Hilfsblöcke/Gerüste, baut in Reichweite und baut die Gerüste beim Abstieg wieder restlos ab!

### 6.7 1-Account Session Handoff
Du hast nur einen einzigen Minecraft-Account? Kein Problem!
Wenn du mit demselben Account den Server betrittst:
1. Kickt der Server den Bot wegen Doppel-Login (`duplicate_login`).
2. Der Bot erkennt das Ereignis, sichert die Baustelle und geht in den Standby-Status `PAUSED_OWNER_INGAME`.
3. Ein passiver Ping prüft regelmäßig, ob du noch auf dem Server spielst.
4. Sobald du den Server verlässt, verbindet sich der Bot nach 4 Sekunden automatisch wieder und setzt den Bauauftrag an exakt demselben Block fort!

### 6.8 Modell-Cockpit & Credential Vault
Über das Zahnrad-Symbol oder die Modell-Pille oben rechts öffnet sich das Modell-Cockpit:
* **GitHub Models 1-Click Login:** Authentifiziere dich via RFC 8628 Device Flow (Code wird angezeigt, 1 Klick auf github.com/login/device genügt — **keine manuellen API-Keys nötig**).
* **Lokaler Modell-Scanner:** Findet automatisch laufende Ollama-, LM Studio- oder LocalAI-Instanzen auf deinem Rechner.
* **AES-256-GCM Credential Vault:** Speichert Tokens verschlüsselt auf deiner Festplatte (`data/credentials.vault`).

---

## 7. Minecraft Server Setup (1.20.4 bis 26.3)

Der Bot funktioniert auf jedem Java-Server ab Version 1.20.4 bis 26.3 (Protokoll 777).

### Empfohlene `server.properties`:
```properties
# Authentifizierung (offline für lokales Testen ohne Microsoft-Login)
online-mode=false

# RCON aktivieren (nur erforderlich für BUILD_EXECUTION_MODE=rcon_visual)
enable-rcon=true
rcon.port=25575
rcon.password=DeinSicheresRconPasswort
broadcast-rcon-to-ops=false

# Sicht- und Simulationsweite
view-distance=10
simulation-distance=10
```

* **Mit OP-Rechten:** Nutze `BUILD_EXECUTION_MODE=hybrid_visual` (schnellstes Platzieren mit visuellen Arm-Animationen).
* **Ohne OP-Rechte (Survival):** Nutze `BUILD_EXECUTION_MODE=pure_physical`.

---

## 8. Testsuite & Qualitätssicherung (33 Standard-Suiten + 4-Tier Testsuite)

Alle Tests laufen **100% offline**, ohne laufenden Minecraft-Server und ohne bezahlte Cloud-API-Keys:

```bash
# Gesamte Test-Pipeline ausführen (33 Standard-Suiten + 4-Tier E2E Tests):
npm run test:all

# Oder gezielt:
npm test                          # Führt alle 33 Kern- & Backend-Suiten aus
npm run test:tiers                # Führt die 4-Tier Suite aus (93 Tests, 706 Checks, < 3s)
npm run check:syntax              # Führt statische Syntaxprüfungen aller Frontend-Module durch

# Gezielte Testsuiten ausführen:
npm run test:dry                 # 23 Geometrie-, Linter- & Router-Tests
npm run test:mission             # 80 Mission Control & Web-CAD Tests
npm run test:improvements        # 32 Statik- & Ästhetik-Optimierungstests
npm run test:milestone1          # 34 Kisten-Logistik & Version 26.3 Tests
npm run test:milestone2          # 18 Threat-FSM & Schlaf-Management Tests
npm run test:vault               # 30 AES-256-GCM Credential Vault Tests
npm run test:model               # 22 Hot-Reload & Safe Probe Worker Tests
npm run test:device              # 27 Device-Flow & BFF Tests
npm run test:settings            # 46 Onboarding & Settings Tests
npm run test:cockpit             # 38 Cockpit-Backend Tests
npm run test:msa                 # 24 MSA-Auth Integration Tests
npm run test:builder             # 26 Builder-Modularisierungs-Tests
npm run test:scaffold            # 21 Gerüstbau & Scaffolding Tests
npm run test:translator          # 138 Viewer-State Translator & Shelf-Mapping Tests
npm run test:gamemode            # 300+ Gamemode E2E, WS, Backend, Frontend, Digging & Perfection
npm run test:block-interaction   # 44 First-Person Blockabbau & Container-Interaktions-Tests
npm run test:survival-hardening  # 14 Safe Scaffolding, Mob-Lighting & Rate-Limiter Tests
npm run test:popout              # 19 Multi-Monitor Popout Tests
npm run test:version             # 20 Live-Versionskompatibilität (1.20 - 26.3)
npm run test:schem               # 11 Litematica & Schematic SOTA Tests
npm run test:gamemode-perfection # 20 Gamemode HUD, Inventory & Pitch-Clamp Tests
npm run test:expedition          # 24 Autonome Höhlen- & Vein-Mining Tests
npm run test:gameplay            # In-Game Chat, Guard-Manager & Defense Tests
npm run test:ux-optimum          # Bot Control Deck & UI/UX Optimierungs-Tests
```

---

## 9. Gemeinsam auf GitHub arbeiten (Für Freunde & Contributors)

Wir freuen uns über Mitstreiter! Um am Projekt mitzuarbeiten:

### 1. Repository klonen & Branch anlegen
```bash
git clone https://github.com/nofckery/MinecraftAiArchitectBot.git
cd MinecraftAiArchitectBot
git checkout -b feature/mein-neues-feature
```

### 2. Entwicklung & Richtlinien
* **ECMAScript Modules (ESM):** Wir verwenden reines Node.js ESM (`import` / `export`), kein `require()`.
* **Zero-Regressions:** Führe vor jedem Commit `npm test` aus. Alle 22 Suiten müssen grün bleiben.
* **Git-Hygiene:** Private Keys, Passwörter und Session-Logs gehören niemals in Git. Unsere `.gitignore` schützt `.env`, `*.vault`, `logs/` und temporäre Dateien automatisch.

### 3. Änderungen committen & Pull Request stellen
```bash
git add .
git commit -m "feat: füge neues Kathedralen-Dach Primitive hinzu"
git push origin feature/mein-neues-feature
```
Öffne anschließend einen Pull Request auf GitHub. Detaillierte Infos findest du in [CONTRIBUTING.md](CONTRIBUTING.md).

---

## 10. Troubleshooting & FAQ

### `ECONNREFUSED 127.0.0.1:25565`
* **Ursache:** Der Minecraft-Server läuft nicht oder der Port in `.env` weicht ab.
* **Lösung:** Starte den Minecraft-Server und kontrolliere `MC_HOST` und `MC_PORT` in deiner `.env`.

### `Duplicate login` beim Betreten des Servers
* **Verhalten:** Wenn du mit demselben Account joinst wie der Bot, ist das völlig normal. Der Bot schaltet automatisch in den Standby (`PAUSED_OWNER_INGAME`) und joint wieder, sobald du den Server verlässt.

### Rate-Limits (HTTP 429) bei KI-Providern
* **Verhalten:** Normal im Free-Tier. Der interne Router setzt sofort einen temporären Cooldown und routet unterbrechungsfrei zum nächsten kostenlosen Provider weiter.

---

## 11. Lizenz

Dieses Projekt steht unter der **[MIT Lizenz](LICENSE)**.  
Frei verwendbar, modifizierbar und erweiterbar.
