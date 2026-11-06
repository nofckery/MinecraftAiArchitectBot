# Autonomous Low-Resource AI Minecraft Architect Bot (v2.1 SOTA & Survival)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20.0.0-68a063?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js Version" />
  <img src="https://img.shields.io/badge/Minecraft-1.20.4%20--%2026.3-3d85c6?style=for-the-badge&logo=minecraft&logoColor=white" alt="Minecraft Version" />
  <img src="https://img.shields.io/badge/Tests-239%2F239%20PASS-brightgreen?style=for-the-badge&logo=checkmarx&logoColor=white" alt="Tests 239/239 PASS" />
  <img src="https://img.shields.io/badge/Survival-Ready%20v2.1-success?style=for-the-badge&logo=shield&logoColor=white" alt="Survival Ready" />
  <img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License: MIT" />
</p>

Ein autonomer, hochperformanter **Minecraft-Architekt-Bot** in modernem Node.js (ES Modules, Node >= 20), der natürliche Sprachbefehle, Bounding-Box-Markierungen und interaktive Web-CAD-Eingaben in statisch geprüfte, ästhetisch anspruchsvolle 3D-Minecraft-Bauwerke übersetzt — **vollständig survival-fähig auf echten Minecraft-Servern (1.20.4 bis 26.3)**.

Ausgestattet mit autonomer **Kisten- und Materialbeschaffung**, taktischer **Monster-Gefahrenabwehr** mit Schild und Waffen, automatischem **Schlaf- & Reconnect-Management** bei Nacht, **Zero-Dependency Version-Polyfill für 26.3** und der **Referenzarchitektur für kostenlose KI-Modellendpunkte (Stand: Ende 2026)**.

Ausführliche Architektur- und Konfigurationsdetails zum Survival-Subsystem findest du in der [SURVIVAL_DOKUMENTATION.md](file:///d:/Minecraft%20Bot/SURVIVAL_DOKUMENTATION.md).

Inklusive **Three.js 3D CAD Mission Control Web-UI** (`http://localhost:3080`), 2D-Reliefkarte, Bounding-Box-Selektor, Paletten-Swapper, 1-Account Session Handoff (Single-Account-Betrieb mit automatischer Reconnect-Schleife) und Universal-Schematic-Unterstützung (`.schem`, `.litematic`, `.nbt`, `.schematic`).

---

## Inhaltsverzeichnis
1. [Systemarchitektur & Datenfluss](#1-systemarchitektur--datenfluss)
2. [Multi-Provider LLM-Kaskade (Ende 2026)](#2-multi-provider-llm-kaskade-ende-2026)
3. [Mission Control Web-UI & 3D CAD Studio](#3-mission-control-web-ui--3d-cad-studio)
4. [Prozedurale Bau-Engine & VoxelCanvas SDK](#4-prozedurale-bau-engine--voxelcanvas-sdk)
5. [1-Account Session Handoff](#5-1-account-session-handoff)
6. [Systemvoraussetzungen & Native Abhängigkeiten](#6-systemvoraussetzungen--native-abhängigkeiten)
7. [Installation & Schnellstart](#7-installation--schnellstart)
8. [Vollständige Konfigurationsreferenz (.env)](#8-vollständige-konfigurationsreferenz-env)
9. [Minecraft Server & RCON Setup](#9-minecraft-server--rcon-setup)
10. [In-Game Chat-Befehle](#10-in-game-chat-befehle)
11. [Testsuite & Verifikation (187/187 Tests)](#11-testsuite--verifikation-187187-tests)
12. [Troubleshooting & FAQ](#12-troubleshooting--faq)
13. [Roadmap & Architektur-Audits](#13-roadmap--architektur-audits)
14. [Beitragen & Lizenz](#14-beitragen--lizenz)

---

## 1. Systemarchitektur & Datenfluss

```text
       [Spieler Chat / Wolle-Marker]          [Web-UI: Three.js 3D CAD / 2D Map]
                     │                                         │
                     └────────────────────┬────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. PERCEPTION LAYER (worldScanner.js + blueprintMemory.js)                  │
│  - Erkennt Wolle-Bounding-Boxen & Terrain-Höhenkarten (Relief-Scanning)     │
│  - Extrahiert existierende Material-Paletten & Biom-Gegebenheiten           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Kompakter JSON Site-Context
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. COGNITIVE LAYER (llmRouter.js v2.0 + architectAgent.js)                  │
│  - 4-Stufen Multi-Provider Kaskade (12+ Provider, automatische Fallbacks)   │
│  - Multi-Key Token-Bucket, 429 Retry-After & intelligentes Auto-Routing     │
│  - Zero-Key Emergency Gateways (Kilo AI / LLM7)                             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Prozeduraler Bau-Code (JavaScript String)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. VIRTUAL SANDBOX & LINTER (architectAgent.js + structuralLinter.js)       │
│  - Isolierte VM (node:vm mit 1.500 ms CPU-Limit, max 250k Ops)              │
│  - VoxelCanvas SDK mit 12 ArchPrimitives & deterministischem 3D-Noise       │
│  - 3D Structural Linter: BFS Flood-Fill gegen schwebende Blöcke             │
│    (Schwerkraft), Tür-Clearance-Check, Anti-Cube Ästhetik-Metrik (>15%)     │
│  - Bei Linter-Warnung -> Automatischer Self-Healing Feedback-Loop           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Validiertes & rotiertes 3D-Voxel-Diff
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. EXECUTION & JOURNAL LAYER (worldExecutor.js + undoManager.js)            │
│  - Atomarer Disk-Snapshot vor Baubeginn (data/undo_journal.json)            │
│  - Greedy-Meshing: Komprimiert Quader zu /fill-Befehlen (-81% Netzwerk-Last)│
│  - 2-Phasen-Topologie: 1. Tragwerk Y↑ (Boden, Wände), 2. Fragile Deko       │
│  - 1-Account Session Handoff (Server-Ping Reconnect bei Duplicate-Login)    │
│  - Unterstützt hybrid_visual, rcon_visual (Zero-Spam) und pure_physical    │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Multi-Provider LLM-Kaskade (Ende 2026)

Der Bot nutzt ein ausfallsicheres 4-Stufen-Routing, das vollständig auf dauerhaft kostenlosen Kontingenten ohne Kreditkartenpflicht basiert:

| Routing-Ebene | Primäre Funktion | Empfohlene Provider & Modelle | Ratenbegrenzung & Kontingent |
| :--- | :--- | :--- | :--- |
| **Stufe 1: High-Speed & Loops** | Echtzeit-Chat, Intent-Parsing, Stil-Pitching | **Cerebras Inference** (`llama-3.3-70b`, `gpt-oss-120b`)<br>**GroqCloud** (`llama-3.3-70b-versatile`, `openai/gpt-oss-120b`) | Bis zu 2.600 tok/s, 1 Mio. Tokens/Tag (Cerebras); 30–60 RPM & 200K TPD (Groq). |
| **Stufe 2: Deep Context & Code** | Prozedurale JavaScript-Synthese, Linter-Self-Healing | **Mistral AI / Codestral** (`codestral-2501`)<br>**Google AI Studio** (`gemini-2.5-flash`, `gemini-2.0-flash`) | ~1 Mrd. Tokens/Monat, 500K TPM (Mistral); 15 RPM, 1.500 RPD, 1M Kontext (Gemini Flash). |
| **Stufe 3: Heavy Reasoning** | Höchste architektonische Komplexität, große Diff-Planung | **SambaNova Cloud** (`DeepSeek-V3.1`)<br>**NVIDIA NIM** (`nemotron-3-super-120b-a12b`)<br>**Cloudflare Workers AI** (`deepseek-r1-distill-qwen-32b`) | 200K TPD (SambaNova, mit 20 RPD Schutz-Limiter); 40 RPM Prototyping (NIM); 10.000 tägliche Neurons (Cloudflare). |
| **Stufe 4: Unbegrenzter Fallback & Zero-Key** | Ausfallsicheres Auffangbecken bei Erschöpfung von 1–3 | **OpenRouter** (`:free` Katalog: Nemotron, GPT-OSS)<br>**Zhipu AI** (`glm-4-flash`)<br>**SiliconFlow** (`Qwen/Qwen3-8B`)<br>**Kilo AI / LLM7** (Schlüsselloser Notfall-Gateway) | ~30 rotierende Modelle (OpenRouter); permanente Flash-Linie (Zhipu & SiliconFlow); Sofortige Funktion ohne API-Keys (Kilo). |

### Wichtige Hinweise zu 2026-Deprecations & Best Practices:
* **GitHub Models ist abgeschaltet:** Die Endpunkte `models.github.ai` und `models.inference.ai.azure.com` wurden im Juli 2026 endgültig eingestellt. Unser Router nutzt stattdessen standardisierte OpenAI-kompatible `/v1`-Schnittstellen.
* **Groq Compound:** Die Modelle `groq/compound` wurden im September 2026 eingestellt. Verwende `llama-3.3-70b-versatile` oder `openai/gpt-oss-120b`.
* **Gemini 2.5 Pro vs. Flash:** Im Free Tier ist `gemini-2.5-pro` auf 25 RPD limitiert (oder 0 RPD ohne hinterlegte Abrechnung). Unser System verwendet daher standardmäßig das extrem zuverlässige und schnelle `gemini-2.5-flash` mit 1.500 RPD und 1 Million Tokens Kontextfenster.
* **Thinking-Model Token-Padding:** Bei Reasoning-Modellen (`DeepSeek-R1`, `gpt-oss-120b`) wird das interne Chain-of-Thought automatisch mit bis zu 6.500 Tokens gepuffert, um unvollständige Bauskripte zu verhindern.

---

## 3. Mission Control Web-UI & 3D CAD Studio

Navigiere bei laufendem Bot zu **`http://localhost:3080`** für das browserbasierte Architekten-Kontrollzentrum:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ ARCHITECT MISSION CONTROL v2.0                       [● ONLINE_ACTIVE]     │
├───────────────────────────────┬─────────────────────────────────────────────┤
│ 3D CAD VIEWPORT (Three.js)    │ LIVE 2D TOPOLOGICAL AREA MAP (Canvas 64x64) │
│ - Orbit, Pan, Zoom            │ - Höhenkonturlinien & Relief-Schattierung   │
│ - BoundingBox Selection       │ - Klick: Bot hinlaufen (Shift+Klick)        │
│ - Voxel Brush, Eraser, Picker │ - Klick: BoundingBox setzen                 │
├───────────────────────────────┼─────────────────────────────────────────────┤
│ TRANSFORMIEREN & PALETTEN     │ SCHEMATIC & TELEMETRIE                      │
│ - Spiegeln (Mirror-X / Z)     │ - Drag & Drop Upload (.schem, .litematic)   │
│ - Drehen (90° im Uhrzeigersinn)│ - 1-Click Schematic-Export                 │
│ - Instant Theme Swapper:      │ - Live-Fortschritt (%) & Restzeit (ETA)     │
│   Medieval, Gothic, Cherry    │ - 1-Account Session Handoff Umschalter      │
└───────────────────────────────┴─────────────────────────────────────────────┘
```

### Web-UI Features im Überblick:
* **Interaktiver 3D CAD Viewport:** Vollständige Dreidimensionalität via Three.js mit Orbit-Steuerung, Wireframe-Bounding-Box und Voxel-Cursor.
* **Präzisions-Werkzeuge:**
  * **Voxel Brush & Eraser:** Manuelles Platzieren oder Löschen einzelner Blöcke im Browser mit sofortiger Synchronisation zum Server.
  * **Eyedropper (Pipette):** Klicke auf einen beliebigen Voxel in der Szene, um Material und Block-Properties sofort zu übernehmen.
  * **Y-Slice Slicer:** Schieberegler zur horizontalen Schicht-für-Schicht-Inspektion (`Schnitt-Höhe Y: 1 bis Max`).
  * **Stückliste (Bill of Materials):** Automatische Auflistung aller benötigten Blocktypen mit exakter Mengenangabe.
* **Topologische 2D-Reliefkarte:**
  * 64x64 Block-Ausschnitt um den Bot mit echten Höhenkonturen und Beleuchtungs-Schattierung.
  * **Interaktive Steuerung:** Klicke auf die Karte, um den Baubereich festzulegen, oder halte `Shift`, um den Bot via Pathfinder direkt an diese Position zu navigieren.
  * Dynamischer Tooltip mit Blockname, Höhenmeter und Distanz.
* **Palette & Theme Swapper:**
  * Tausche ganze Materialgruppen mit einem Klick (z. B. Eichenholz zu Fichtenholz oder Schwarzeichenholz), wobei **Blockausrichtungen** (`facing`, `half`, `shape`, `axis`) zu 100% erhalten bleiben.
  * Vordefinierte Farbwelten: Mittelalter (Medieval), Gotisch (Gothic), Wüste (Desert), Kirschblüte (Cherry).
* **Universal Schematic Hub:**
  * Drag & Drop Import von `.schem`, `.litematic`, `.nbt` und `.schematic`.
  * Reverse-Cloning: Lese bestehende Bauwerke aus der Welt aus und exportiere sie mit einem Klick als standardisierte `.schem`-Datei.
* **Dual-Control WebSocket:**
  * Bidirektionale WebSocket-Verbindung mit 500ms Telemetrie-Zyklus (Koordinaten, Blickrichtung, Leben, Bau-Status).

---

## 4. Prozedurale Bau-Engine & VoxelCanvas SDK

Der Bot baut Bauwerke nicht Block für Block starr nach, sondern nutzt ein prozedurales Architektur-Framework:

* **12 ArchPrimitives:**
  1. `framedRoom`: Strukturierter Raum mit tragenden Holzbalken und Wandeinzug.
  2. `jettyFloor`: Vorkragendes Obergeschoss (Kragträger-Fachwerk) mit Konsolen.
  3. `gableRoof`: Klassisches Satteldach mit Firstbalken, Dachüberstand und Giebeldreieck.
  4. `hipRoof`: Vierseitiges Walmdach mit präzisem Treppen- und Stufen-Stitching.
  5. `cylindricalTower`: Runder Wehrturm mit Wendeltreppe und Zinnen.
  6. `conicalTowerRoof`: Spitzes Kegeldach für Rundtürme.
  7. `chimney`: Gemauerter Kamin mit Rauchpartikel-Quelle (Campfire).
  8. `windowWithDetail`: Tiefengestaffelte Fenster mit Fensterläden und Blumenkasten.
  9. `doorway`: Überdachtes Eingangsportal mit Laterne.
  10. `furnishInterior`: Automatische Innenraumausstattung (Tische, Stühle, Bücherregale).
  11. `foundationPlinth`: Solider Natursteinsockel mit Bodenausgleich.
  12. `decorativeBalcony`: Vorgebauter Balkon mit Stützstreben und Geländer.

* **Deterministischer 3D-Noise:**
  Kein chaotischer `Math.random()`, sondern trilinearer `valueNoise3D` und 32-Bit Integer-Bitmixer `hash3D`. Erzeugt realistische Verwitterungsmuster, Moos-Überwucherung und Farbgradienten.

* **3D Structural Linter:**
  Vor der Freigabe eines Bauplans prüft ein 3D-BFS-Flood-Fill-Algorithmus das Bauwerk:
  * **Schwerkraft-Audit:** 0 schwebende Blöcke erlaubt; alle Strukturen müssen statisch mit dem Fundament verbunden sein.
  * **Durchgangs-Prüfung:** Türen müssen min. 2 Blöcke lichte Höhe aufweisen und begehbar sein.
  * **Ästhetik-Metrik:** Mindestens 15% Detailblöcke (Treppen, Stufen, Zäune, Laternen, Falltüren), um monotone "Schuhkartons" zu verhindern.
  * **Automatisches Self-Healing:** Scheitert der Linter, wird die Fehlerbeschreibung an das LLM zurückgespielt, das den Code in < 2 Sekunden selbst korrigiert.

* **Greedy-Meshing (/fill-Kompression):**
  Identische benachbarte Blöcke werden zu 3D-Quadern zusammengefasst. Statt 1.562 Einzelblöcke zu setzen, werden nur 298 `/fill`-Befehle ausgeführt (**81% Kompression**).

* **Atomares Undo-Journal:**
  Jeder Baubefehl speichert die überschriebenen Originalblöcke in `data/undo_journal.json`. Mit `!undo` kann jederzeit der Originalzustand vor dem Bau wiederhergestellt werden.

---

## 5. 1-Account Session Handoff

Du möchtest den Bot auf deinem Server testen, hast aber nur **einen einzigen Minecraft-Account**?

Der Bot besitzt eine integrierte Session-Handoff-Zustandsmaschine:
1. Der Bot ist als Spieler auf dem Server aktiv und baut.
2. Der menschliche Spieler loggt sich mit demselben Account ein.
3. Der Server trennt den Bot mit der Meldung `multiplayer.disconnect.duplicate_login`.
4. Der Bot erkennt den Handoff, pausiert den WorldExecutor an der exakten Baustelle und geht in den Standby-Status `PAUSED_OWNER_INGAME`.
5. Alle 10 Sekunden prüft ein passiver Server-Ping (`SERVER_PING_INTERVAL_MS`), ob der Spieler noch online ist.
6. Sobald der Spieler den Server verlässt, wartet der Bot 4 Sekunden Cooldown und joint automatisch wieder auf den Server.
7. Der WorldExecutor setzt den Bauauftrag an exakt dem Block fort, an dem unterbrochen wurde!

---

## 6. Systemvoraussetzungen & Native Abhängigkeiten

* **Node.js**: `>= 20.0.0`
* **Minecraft Server**: Java Edition 1.20.4 (Paper, Fabric, Purpur, Spigot oder Vanilla).

### Native Build-Tools für `node-canvas`
Das Paket `canvas` benötigt native Grafikbibliotheken für die 2D-Reliefkarten-Generierung:

* **Debian / Ubuntu / Raspberry Pi OS:**
  ```bash
  sudo apt-get update
  sudo apt-get install -y build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ```
* **Fedora / RHEL:**
  ```bash
  sudo dnf install -y cairo-devel libjpeg-turbo-devel pango-devel giflib-devel
  ```
* **macOS (Homebrew):**
  ```bash
  brew install pkg-config cairo pango libpng jpeg giflib librsvg pixman
  ```
* **Windows:**
  In der Regel werden vorkompilierte Binaries (`prebuild-install`) von `node-canvas` automatisch heruntergeladen. Falls nötig, installiere die [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/).

---

## 7. Installation & Schnellstart

### Schritt 1: Repository klonen
```bash
git clone https://github.com/nofckery/MinecraftAiArchitectBot.git
cd mc-architect-bot
```

### Schritt 2: Abhängigkeiten installieren
```bash
npm install
```

### Schritt 3: Konfiguration vorbereiten
Kopiere die Konfigurationsvorlage:
```bash
# Unter Windows (PowerShell):
Copy-Item .env.example .env

# Unter Linux / macOS:
cp .env.example .env
```

### Schritt 4: Testsuite ausführen
Überprüfe die korrekte Funktion aller Module (vollständig offline, keine Server-Verbindung erforderlich):
```bash
npm test
```
*Ausgabe: 187/187 Tests erfolgreich bestanden (89 DryRun + 80 MissionControl + 18 Improvements).*

### Schritt 5: Bot starten
```bash
npm start
```
*Nach dem Start:*
* In-Game: Der Bot joint dem konfigurierten Minecraft-Server.
* Web-UI: Öffne deinen Browser auf **`http://localhost:3080`**.

---

## 8. Vollständige Konfigurationsreferenz (.env)

| Variable | Standardwert | Beschreibung |
| :--- | :--- | :--- |
| **`MC_HOST`** | `127.0.0.1` | IP-Adresse oder Hostname des Minecraft-Servers |
| **`MC_PORT`** | `25565` | Port des Minecraft-Servers |
| **`MC_USERNAME`** | `BaumeisterKI` | Spielername des Bots |
| **`MC_AUTH`** | `offline` | Authentifizierungsmodus: `offline` (Cracked/LAN) oder `microsoft` |
| **`MC_VERSION`** | `1.20.4` | Minecraft Java Version (oder `false` für Auto-Detect) |
| **`BOT_OWNER`** | `DeinSpielerName` | Spielername des Eigentümers für Chat-Befehle |
| **`BUILD_EXECUTION_MODE`** | `hybrid_visual` | `hybrid_visual` (Bot läuft hin & nutzt /setblock /fill), `rcon_visual` (wie hybrid via RCON ohne Chat-Spam), `pure_physical` (survival-nah aus Inventar) |
| **`ENABLE_GREEDY_FILL_OPTIMIZATION`**| `true` | Fasst Blöcke zu 3D-Boxen für `/fill` zusammen (-81% Befehle) |
| **`BUILD_OPERATIONS_PER_SECOND`** | `12` | Ausführungsgeschwindigkeit (Paket-Drosselung gegen Server-Kicks) |
| **`MAX_BUILD_VOLUME_DIMENSION`** | `64` | Maximale Kantenlänge X/Y/Z pro Auftrag |
| **`RCON_HOST`** | `127.0.0.1` | RCON-Server Host (nur bei `rcon_visual`) |
| **`RCON_PORT`** | `25575` | RCON-Port (aus `server.properties`) |
| **`RCON_PASSWORD`** | *(leer)* | RCON-Passwort (aus `server.properties`) |
| **`CEREBRAS_API_KEYS`** | *(optional)* | Komma-getrennte API-Keys für Cerebras Inference (Llama 3.3 70B) |
| **`GROQ_API_KEYS`** | *(optional)* | Komma-getrennte API-Keys für Groq Cloud (LPU Llama 3.3 70B) |
| **`MISTRAL_API_KEYS`** | *(optional)* | API-Key für Mistral AI |
| **`CODESTRAL_API_KEYS`** | *(optional)* | API-Key für Mistral Codestral (Code-Synthese) |
| **`GEMINI_API_KEYS`** | *(optional)* | API-Keys für Google AI Studio (Gemini 2.5 Flash) |
| **`SAMBANOVA_API_KEYS`** | *(optional)* | API-Key für SambaNova Cloud (DeepSeek-V3.1) |
| **`OPENROUTER_API_KEYS`** | *(optional)* | API-Key für OpenRouter (:free Modellkatalog) |
| **`ENABLE_ZERO_KEY_FALLBACK`** | `true` | Schlüsselloser Notfall-Betrieb via Kilo AI Gateway / LLM7 |
| **`WEB_DASHBOARD_PORT`** | `3080` | Port für die Mission Control Web-UI |
| **`PRISMARINE_VIEWER_PORT`** | `3081` | Port für den Prismarine Viewer |
| **`SINGLE_ACCOUNT_HANDOFF_MODE`**| `true` | Aktiviert automatische Pause & Reconnect bei Duplicate-Login |
| **`SERVER_PING_INTERVAL_MS`** | `10000` | Abfrageintervall (ms) für Server-Status im Standby |

---

## 9. Minecraft Server & RCON Setup

Für optimale Performance und volle Funktionalität empfiehlt sich ein lokaler Minecraft-Server (z. B. PaperMC 1.20.4).

### `server.properties` anpassen:
```properties
# Authentifizierung (offline für lokales Testen ohne Microsoft-Login)
online-mode=false

# RCON aktivieren (für rcon_visual Modus ohne Chat-Befehle)
enable-rcon=true
rcon.port=25575
rcon.password=DeinSicheresRconPasswort
broadcast-rcon-to-ops=false

# Simulations- und Sichtweite
view-distance=10
simulation-distance=10
```

### Bot-Berechtigungen (OP):
Wenn du den empfohlenen Modus `BUILD_EXECUTION_MODE=hybrid_visual` nutzt, gib dem Bot Operator-Rechte auf dem Server:
```text
/op BaumeisterKI
```
*Hinweis:* Im Modus `pure_physical` benötigt der Bot keine OP-Rechte und setzt Blöcke wie ein normaler Überlebens-Spieler aus der Hand.

---

## 10. In-Game Chat-Befehle

Befehle können direkt im Minecraft-Chat eingegeben werden (nur für autorisierte `BOT_OWNER`):

| Befehl | Auswirkung |
| :--- | :--- |
| `!stop` | Bricht den laufenden Bauauftrag sofort ab (< 100 ms Reaktionszeit). |
| `!undo` | Liest das atomare Undo-Journal und stellt die Original-Blöcke zu 100% wieder her. |
| `!preview` | Zeigt Maße und Stückliste im Chat und rendert einen ASCII-Schnitt ins Server-Terminal. |
| `!instant` | Schaltet zwischen interaktivem Konzept-Pitch und sofortiger Ausführung um. |
| `!style` | Zeigt aktuell gelernte Architekturstile aus `data/style_memory.json`. |
| `!scan` | Scannt das Terrain oder gesetzte Wolle-Eckpunkte vor dem Bot. |
| `!come` | Lässt den Bot via A*-Pathfinder direkt zum Spieler laufen. |
| *Freitext-Prompt* | Z. B. *"Baue eine zweistöckige Taverne aus Fichtenholz mit Schindeldach und Weinkeller"* |

---

## 11. Testsuite & Verifikation (239/239 Tests)

Das Projekt verfügt über eine umfassende, modulare Testsuite mit **239 automatisierten Tests (314 Assertions)**, die vollständig offline ohne aktive Internet- oder Server-Verbindung ausgeführt werden können:

```bash
# Gesamte Testsuite (239 Tests, 100% PASS):
npm test

# Nur Geometrie-, Linter- und LLM-Router-Tests (89 Tests):
npm run test:dry

# Nur WebSocket-, Web-UI-CAD- und Session-Handoff-Tests (80 Tests):
npm run test:mission

# Survival Meilenstein 1 (Kisten, Entnahme, Version 26.3, Farming - 34 Tests):
npm run test:milestone1

# Survival Meilenstein 2 (Threat-FSM, Taktischer Rückzug, Schlaf, Reconnect - 44 Tests):
npm run test:milestone2

# Authenticated Credential Vault (30 Tests):
npm run test:vault

# Safe Probe Worker & Hot-Reload Endpoints (22 Tests):
npm run test:model
```

### Abgedeckte Testbereiche:
1. **Deterministischer Noise (5 Tests):** Hash-Gleichheit, Verteilung [0,1), deterministische Trilinear-Interpolation.
2. **Prozedurale Generierung (2 Tests):** Tavernen-Synthese mit >1.500 Blöcken, fehlerfreie Block-States.
3. **Structural Linter (4 Tests):** BFS Flood-Fill Schwerkraft-Statik, schwebende Blöcke = 0, Detail-Quote > 15%.
4. **4-Kardinal-Rotation (12 Tests):** North, East, South, West mit fehlerfreier Richtungsanpassung aller Treppen, Türen und Baumstämme.
5. **Greedy-Meshing (3 Tests):** Volumenerhaltung und min. 50% Reduktion (tatsächlich: **81% Kompression**).
6. **Inkrementelles Diff-Building (3 Tests):** Voxel-Differenzerkennung, gezieltes Setzen und Entfernen.
7. **ASCII Blueprint Generator (4 Tests):** Grundriss, vertikaler Querschnitt, Stückliste.
8. **LLM Router v2.0 (5 Tests):** Token-Bucket, 429 Retry-Cooldown, 401 Key-Deaktivierung, Zero-Key Gateway.
9. **Palette Swapper & Smart-Group (11 Tests):** Holzfamilien-Tausch unter 100% Erhalt von `facing`, `shape`, `half`, `axis`.
10. **CAD Transformationen (9 Tests):** Spiegelung an X- und Z-Achse, 90° Drehung, Tür-Hinge-Invertierung.
11. **SubRegionProxy (2 Tests):** Atomarer Bounding-Box-Schreibschutz.
12. **Universal Schematic Hub (8 Tests):** Sponge v2/v3, Litematic 64-Bit Bit-Unpacker/Packer, NBT-Payload.
13. **Session Handoff & Duplicate-Login (19 Tests):** Kick-Erkennung, WorldExecutor Pause/Resume, Server-Ping Loop.
14. **Dashboard REST & WebSockets (21 Tests):** HTTP-Endpoints, Schematics API, Live-Telemetrie-Stream.
15. **Dual-Control CAD Engine (15 Tests):** Voxel-Delta Broadcast, Theme-Swap, Terrain-X-Ray, Höhenverschiebung.
16. **Frontend Spezifikations-Konformität (14 Tests):** UI-Elemente, responsive Canvas-Skalierung, Höhenkonturen.
17. **31-Punkte Mängel- & Architektur-Härtung (18 Tests):** Statische Greedy-Engine, Materialvorabprüfung, erweiterte Raumtypen (Küche, Waffenkammer, Default), Structure-NBT-Roundtrip, Cheat-Schutz im Survival.

---

## 12. Troubleshooting & FAQ

### `ECONNREFUSED 127.0.0.1:25565`
* **Ursache:** Der Minecraft-Server läuft nicht oder der Port in `.env` stimmt nicht überein.
* **Lösung:** Starte den Minecraft-Server und überprüfe `MC_HOST` und `MC_PORT` in deiner `.env`.

### Rate-Limit Warnungen (HTTP 429) im Log
* **Ursache:** Das Kontingent eines kostenlosen KI-Providers wurde kurzzeitig überschritten.
* **Verhalten:** Dies ist normal! Der Bot loggt eine Warnung, setzt einen Cooldown-Zeitstempel und schaltet innerhalb von Millisekunden automatisch auf den nächsten verfügbaren Provider um.

### Kein API-Key vorhanden (Zero-Key Betrieb)
* **Verhalten:** Der Bot startet auch ohne eingetragene API-Keys. Durch den schlüssellosen Fallback über das **Kilo AI Gateway** und **LLM7** ist das System sofort nach der Installation einsatzbereit.

### Fehler beim Kompilieren von `node-canvas`
* **Lösung:** Stelle sicher, dass die in [Kapitel 6](#6-systemvoraussetzungen--native-abhängigkeiten) aufgeführten nativen Bibliotheken (`libcairo2-dev`, `libpango1.0-dev` etc.) auf deinem System installiert sind.

---

## 13. Roadmap & Architektur-Audits

Für tiefergehende architektonische Analysen und zukünftige Erweiterungspläne existieren im Repository zwei detaillierte Fachberichte:

* **`SOLL_IST_ANALYSE.md`**: Umfassendes Soll-Ist-Audit aller 42 Software-Module, Vergleich mit der ursprünglichen Projektvision und detaillierte Bestandsaufnahme aller Mocks, Stubs und Platzhalter.
* **`VERBESSERUNGSPOTENZIALE.md`**: Strategischer Entwicklungsplan mit konkreten Empfehlungen:
  * **Phase 1: Schwarm-Architektur:** Koordinierte Mehrfach-Bots für großflächige Megaprojekte.
  * **Phase 2: Autonomer Survival-Kreislauf:** Automatisches Farmen von Rohstoffen, Sortieranlagen und Auto-Crafting.
  * **Phase 3: Vektor-Datenbank (ChromaDB):** Langzeitgedächtnis für Server-Baupläne und stilistische Kohärenz.
  * **Phase 4: Minecraft 1.21+ Features:** Automatische Crafter, Kupfer-Türen, schwere Kerne und Prüfungs-Kammern.

---

## 14. Beitragen & Lizenz

Beiträge aus der Community sind herzlich willkommen! Lies dir bitte unsere [CONTRIBUTING.md](CONTRIBUTING.md) durch, um mehr über unsere Entwicklungsrichtlinien, Code-Stile und den Pull-Request-Prozess zu erfahren.

Dieses Projekt steht unter der **[MIT Lizenz](LICENSE)** — siehe die Lizenzdatei für Details.
