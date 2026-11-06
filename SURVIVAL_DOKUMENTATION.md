# BaumeisterKI v2.1: Vollständige Survival-Architektur & Dokumentation

> **Status:** Produktionsreif & Vollständig verifiziert (239/239 Tests PASS, Exit Code 0)  
> **Zielversion:** Minecraft Java Edition 1.20.4 bis Version 26.3 (Protokoll 777)  
> **Modus:** `pure_physical` (100% Survival-konform, keine Admin-/OP-Befehle, kein `/setblock`)

---

## 1. Übersicht & Zielsetzung

Der BaumeisterKI-Bot wurde in dieser Session von einem primär auf Creative/Befehlsrechte ausgelegten Bau-Architekten zu einem **vollständig autonom agierenden Survival-Baumeister** weiterentwickelt.

### Kernanforderungen & Fähigkeiten
1. **Materialbeschaffung aus Kisten:** Der Bot ermittelt vor und während des Bauens die benötigten Materialien (Bill of Materials / BOM), sucht und scannt alle Kisten im Umkreis und entnimmt die Items kapazitätsgeprüft ohne Inventarüberlauf.
2. **Proaktive Monster-Abwehr:** Bei Annäherung feindlicher Mobs pausiert der Bot den Bauauftrag, rüstet die beste Waffe/Schild aus, wendet taktische Kampfmanöver an (Creeper-Abstand, Skelett-Schild-Block), weicht bei niedrigen HP zurück und heilt sich durch Nahrung.
3. **Schlaf- und Reconnect-Management:** Legen sich Mitspieler zu Bett oder bricht die Nacht an, sucht der Bot ein freies Bett im Umkreis. Falls kein Bett erreichbar ist, trennt er die Verbindung (`bot.quit()`), damit die Nacht für die Spieler nicht blockiert wird, und verbindet sich nach Sonnenaufgang automatisch wieder.
4. **Vorbereitete Farming-Schnittstellen:** Modulare Schnittstelle `IHarvestManager` für autonomes Rohstoff-Farming (Holz hacken, Steine abbauen) mit Werkzeughierarchie und Standblock-Schutz.
5. **Zielversion „26.3“ & Fallback:** Zero-Dependency Runtime-Polyfill für Minecraft 26.3 (Protokoll 777), Auto-Detect via Ping und sicherer Fallback auf 1.20.4.

---

## 2. Systemarchitektur & Datenfluss

```text
                     [Bauauftrag / Chat / VoxelCanvas]
                                     │
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1. BOM-Bedarfsanalyse & Materialprüfung (src/builder/worldExecutor.js)      │
 │    - Ermittelt fehlende Blöcke im Inventar                                  │
 └───────────────────────────────────┬─────────────────────────────────────────┘
                                     │ Fehlende Materialien
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 2. Container- & Kistenlogistik (src/survival/chestManager.js)               │
 │    - 3D-Scan im 32m-Radius über 20 Behältertypen (Kisten, Fässer, Shulker)  │
 │    - Doppel-Kisten-Deduplizierung & Verdeckungsprüfung                      │
 │    - Kapazitätsgeprüfte Entnahme (withdrawSafe) ohne Stack-Überlauf        │
 └───────────────────────────────────┬─────────────────────────────────────────┘
                                     │ Materialien im Inventar
                                     ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 3. Bauausführung im pure_physical Modus (src/builder/worldExecutor.js)     │
 │    - Platziert Blöcke physikalisch über Mineflayer-Interaktionen             │
 └─────────────┬─────────────────────────────────────────────────┬─────────────┘
               │                                                 │
               ▼ Mob in 12m                                      ▼ Nacht / Spieler im Bett
 ┌──────────────────────────────┐              ┌──────────────────────────────┐
 │ 4. GEFAHRENMANAGEMENT        │              │ 5. SCHLAF- & RECONNECT       │
 │ (src/bot/threatManager.js)   │              │ (src/bot/sleepController.js) │
 │                              │              │                              │
 │ - Pausiert Bau (pauseBuild)  │              │ - Sucht freies Bett (32m)    │
 │ - FSM: ENGAGING / RETREAT    │              │ - Bett gefunden -> Schlafen  │
 │ - Waffe/Schild, Cooldown-Hit │              │ - Kein Bett -> bot.quit()    │
 │ - Heilen mit bester Nahrung  │              │ - Auto-Reconnect nach 25s    │
 │ - ResumeBuild nach Entwarnung│              │ - ResumeBuild am Morgen      │
 └──────────────────────────────┘              └──────────────────────────────┘
```

---

## 3. Detaillierte Modulreferenz

### 3.1 Kistenlogistik (`src/survival/chestManager.js`)
*Klasse: `ChestManager` (Instanz: `chestManager`)*
- **`findContainers(bot, radius)`**: Findet alle Kisten, Doppelkisten, Fässer, Trapped Chests und Shulker-Kisten in Reichweite.
- **Doppel-Kisten-Deduplizierung (`getDoubleChestPartnerPos`)**: Nutzt Block-Facing (`north`, `south`, `east`, `west`) und Typ (`left`, `right`), um die Partner-Koordinate zu berechnen. Verhindert, dass Doppelkisten zweimal angefahren werden.
- **Verdeckungsprüfung (`canOpen`)**: Prüft in Java Edition, ob ein solider Block über der Kiste oder deren Partnerhälfte liegt. Fässer können immer geöffnet werden.
- **Temporäre Blacklist (`addToBlacklist`, `isBlacklisted`)**: Blockiert fehlerhafte oder unzugängliche Kisten für konfigurierbare Zeit (Standard: 60s), um Endlosschleifen zu vermeiden.
- **Sichere Entnahme (`withdrawSafe`)**: Berechnet freie Inventarplätze und maximale Stackgrößen vor dem Transfer. Verhindert Abstürze durch volles Bot-Inventar.

### 3.2 Materialbeschaffung (`src/survival/materialProcurement.js`)
*Klasse: `MaterialProcurement` (Instanz: `materialProcurement`)*
- **`procureMaterials(bot, requiredBOM, options)`**:
  - Prüft zunächst das Eigeninventar via `inventoryManager.checkMaterials()`.
  - Bei Fehlbestand: Sucht Kisten in konfigurierbarem Radius (`SURVIVAL_STORAGE_SCAN_RADIUS`, Standard 32m).
  - Öffnet Kisten mit Timeout-Schutz (`openContainerSafely`).
  - Entnimmt fehlende Blöcke schrittweise.
  - Gibt bei verbleibendem Mangel ein klares Shortage-Manifest im Chat und Log aus.
  - Berücksichtigt `SURVIVAL_STRICT_MATERIALS` (bei `true` bricht der Bau ab, bei `false` wird mit dem vorhandenen Material gebaut).

### 3.3 Gefahrenabwehr & Monster-FSM (`src/bot/threatManager.js`)
*Klasse: `ThreatManager` (Instanz: `threatManager`)*
- **Proaktive Überwachung:** Taktet alle 500 ms und überwacht den 12m-Perimeter (`SURVIVAL_THREAT_RADIUS`).
- **Zustandsmaschine (FSM):**
  - `IDLE`: Keine Feinde in Sicht. Bau läuft ungestört.
  - `ENGAGING`: Feind erkannt. Bau wird pausiert (`worldExecutor.pauseBuild()`). Beste Waffe wird ausgerüstet.
  - `RETREATING`: Lebensenergie $\le 8$ HP (4 Herzen). Bot sprintet 15m vom Angreifer weg.
  - `HEALING`: Bot isst nahrhafte Nahrung (Brot, Steak, Goldene Karotten). Schädliche Nahrung (Rotten Flesh, Spider Eye, Pufferfish) wird strikt ignoriert.
  - `SECURING_PERIMETER`: Prüft, ob weitere Monster im Umkreis sind.
  - **Resume:** Wenn alle Feinde besiegt oder geflohen sind, wird der Bauauftrag via `worldExecutor.resumeBuild()` fortgesetzt.
- **Taktische Kampfstile:**
  - **Creeper:** Hit-and-Backpedal (schlagen und sofort 4 Blöcke zurückweichen, um Explosion zu verhindern).
  - **Skelette:** Ausrüstung eines Schildes in der Nebenhand; Blocken bei Distanz > 3.5m, Senken zum Schlag.
  - **Angriffsrate:** Hält 1.9+ Angriffs-Cooldowns (625 ms) ein für maximalen Schaden.

### 3.4 Schlaf- & Reconnect-Controller (`src/bot/sleepController.js`)
*Klasse: `SleepController` (Instanz: `sleepController`)*
- **Multi-Channel Schlaferkennung:**
  - Registriert Chat-Meldungen über zu Bett gehende Spieler.
  - Liest Entity-Metadaten von Spielern im Umkreis (Schlaf-Pose).
  - Erkennt Dämmerung / Nachtzeit (`timeOfDay >= 12542`) und Unwetter (`bot.isRaining`).
- **Bettensuche (`findNearestBed`):** Scannt Betten aller Farben im 32m-Radius (`BED_SEARCH_RADIUS`) und prüft, ob sie unbesetzt sind.
- **Nacht-Disconnect (`bot.quit()`):** Falls kein Bett erreichbar ist und `SLEEP_DISCONNECT_ON_NO_BED=true`, trennt der Bot ordnungsgemäß die Verbindung, kündigt dies im Chat an und schützt die Mitspieler vor schlaflosen Nächten.
- **Koordinierter Auto-Reconnect:**
  - Unterdrückt die reguläre 5-Sekunden-Fehler-Reconnect-Schleife.
  - Startet einen konfigurierbaren 25-Sekunden-Timer (`SLEEP_RECONNECT_DELAY_SEC`).
  - Verbindet sich bei Tagesanbruch wieder und setzt pausierte Bauvorhaben automatisch fort.

### 3.5 Modulare Farming-Schnittstellen (`src/survival/harvestManager.js`)
*Klasse: `HarvestManager` (Instanz: `harvestManager`)*
- **`prepareToolForBlock(bot, targetBlock)`**: Erkennt Blockmaterial (Holz -> Axt, Stein -> Spitzhacke, Erde -> Schaufel) und rüstet automatisch das beste verfügbare Werkzeug (Netherite > Diamond > Iron > Stone > Wood) aus.
- **`harvestWood(bot, count, options)`**: Sucht und fällt Baumstämme in Reichweite.
- **`harvestStone(bot, count, options)`**: Baut Stein/Bruchstein/Tiefenschiefer ab.
- **Standplatz-Schutzregel:** Baut unter keinen Umständen den Block ab, auf dem der Bot steht (`block.position.equals(bot.entity.position.floored().offset(0, -1, 0))`).

### 3.6 Protocol- & Version-Shim (`src/config/versionResolver.js`)
*Klasse: `VersionResolver`*
- **Minecraft 26.3 Support (Protokoll 777):** Weist `minecraft-data` die Datenstrukturen von Version 26.1 zu (`dataPc.pc['26.3'] = dataPc.pc['26.1']`).
- **Registrierung:** Fügt Version 26.3 in `mineflayer.testedVersions`, `mineflayer.latestSupportedVersion` und `minecraftProtocol.supportedVersions` ein.
- **Auto-Detect & Ping:** Ping an den Server ermittelt die reale Version; bei Inkompatibilität erfolgt ein sicherer Fallback auf Version 1.20.4.

### 3.7 Gerüstbau & Survival-Höhenbau (`src/survival/scaffoldManager.js`)
*Klasse: `ScaffoldManager` (Instanz: `scaffoldManager`)*
- **Reichweiten- & Geometrieberechnung (`isReachableFrom`):** Ermittelt unter Berücksichtigung von Augenhöhe (1.62m) und Zielblock-Zentrum, ob ein Block ohne zusätzliche Hilfsmittel platziert werden kann (Vanilla Reach-Grenze: $\le 3.8$m).
- **Standplatz-Navigation (`findWalkableStandingSpot`):** Durchsucht spiralförmig das bestehende Terrain nach solidem Boden mit mindestens 2 Blöcken Kopf- und Körper-Freiraum, um unnötigen Gerüstbau zu vermeiden.
- **Kollisionsfreie Gerüstplanung (`planScaffold`):** Berechnet die optimale Säulenposition ($1 \le d \le 2$ Blöcke horizontal) unter striktem Ausschluss aller geplanten Gebäudekoordinaten (`reservedBlocks`).
- **Materialpriorisierung (`getAvailableScaffoldMaterial`):**
  1. *Vanilla Scaffolding (`scaffolding`):* Höchste Priorität. Ermöglicht 1-Klick-Abbau der gesamten Säule.
  2. *Fallback-Materialien:* `dirt`, `coarse_dirt`, `cobblestone`, `netherrack`.
- **Absturzsicherung & Pillaring (`erectScaffold`):** Aktiviert während des Höherbauens und auf der Plattform automatisch Sneak (`bot.setControlState('sneak', true)`), um Fallschaden und Abstürze zu verhindern.
- **Sauberer Rückbau (`dismantleAll`):** Baut nach Abschluss des Bauauftrags oder beim Baustopp alle temporären Blöcke geordnet von oben nach unten ab, deaktiviert Sneak und sammelt gedroppte Gerüst-Items wieder ein.

---

## 4. Konfigurationsreferenz (`.env`)

Alle neuen Survival-Einstellungen lassen sich in der `.env`-Datei individuell steuern:

| Umgebungsvariable | Typ | Standardwert | Beschreibung |
| :--- | :---: | :---: | :--- |
| `MC_VERSION` | String | `auto` | Zielversion (`26.3`, `1.20.4`, `auto` für Ping-Erkennung oder `false`) |
| `SURVIVAL_AUTO_PROCUREMENT` | Boolean | `true` | Sucht vor Baubeginn automatisch Materialien in Kisten |
| `SURVIVAL_STORAGE_SCAN_RADIUS`| Number | `32` | Suchradius in Blöcken nach Kisten und Fässern |
| `SURVIVAL_STRICT_MATERIALS` | Boolean | `false` | Bricht Bau ab, falls nach Kistensuche Materialien fehlen |
| `SURVIVAL_CONTAINER_TIMEOUT_MS`| Number | `4000` | Timeout in Millisekunden für Kisten-Öffnungen |
| `SURVIVAL_CONTAINER_BLACKLIST_MS`| Number | `60000` | Dauer der temporären Blacklist für unzugängliche Kisten |
| `SURVIVAL_THREAT_RADIUS` | Number | `12` | Überwachungsradius um den Bot für feindliche Monster |
| `SURVIVAL_CRITICAL_HEALTH` | Number | `8` | Lebensenergie-Schwellenwert (in halben Herzen) für taktischen Rückzug |
| `SURVIVAL_RETREAT_DISTANCE` | Number | `15` | Rückzugsdistanz in Blöcken bei Lebensgefahr |
| `SURVIVAL_ATTACK_COOLDOWN_MS` | Number | `625` | Angriffsintervall zur Beachtung von Waffen-Cooldowns |
| `BED_SEARCH_RADIUS` | Number | `32` | Suchradius für freie Betten bei Nacht |
| `SLEEP_DISCONNECT_ON_NO_BED` | Boolean | `true` | Trennt Verbindung bei Nacht, falls kein Bett frei ist |
| `SLEEP_RECONNECT_DELAY_SEC` | Number | `25` | Wartezeit in Sekunden bis zum automatischen Reconnect nach Nacht |
| `SURVIVAL_AUTO_HARVESTING` | Boolean | `false` | Erlaubt autonomes Rohstoff-Farming bei Materialmangel |
| `SURVIVAL_SCAFFOLDING_ENABLED`| Boolean | `true` | Aktiviert Standplatz-Navigation und Gerüstbau für hohe Bauwerke |
| `SURVIVAL_SCAFFOLD_BLOCKS` | String | `scaffolding,dirt,cobblestone` | Priorisierte Liste von Gerüstbaumaterialien |
| `SURVIVAL_MAX_REACH` | Number | `3.8` | Maximale Interaktionsreichweite in Blöcken |

---

## 5. Web-Dashboard Onboarding & Server-Rechte-Erkennung (v2.1)

### 5.1 Interaktives Web-Onboarding (Setup Wizard)
Wenn der Bot ohne vorhandene `.env`-Datei gestartet wird, öffnet das Dashboard (`http://localhost:3080`) automatisch einen **6-stufigen Onboarding-Wizard**:
1. **Willkommen & Systemübersicht:** Einführung in die Architektur und Fähigkeiten.
2. **Minecraft-Spielername (Owner):** Eingabe des berechtigten In-Game-Spielernamens (`BOT_OWNER`).
3. **Bot-Account:** Konfiguration des Bot-Namens (`MC_USERNAME`) und der Authentifizierungsmethode (`offline` für LAN/Offline-Server vs. `microsoft` mit MSA-Login).
4. **Ziel-Server:** Adresse (`MC_HOST`), Port (`MC_PORT`) und Minecraft-Version (`MC_VERSION`, z. B. `auto` oder `26.3`).
5. **Bau-Modus & Rechte:** Auswahl zwischen `auto` (dynamische Rechte-Erkennung), `pure_physical` (Survival ohne OP) und `hybrid_visual` (Server mit OP).
6. **Survival & Schutz-Optionen:** Kistenlogistik, Mob-Gefahrenabwehr, Schlaf- und Reconnect-Verhalten.

Beim Klick auf *„Konfiguration speichern & Bot verbinden“* wird die maßgeschneiderte `.env`-Datei atomar via `src/config/envManager.js` generiert und der Bot auf den Server geschickt.

### 5.2 Dynamische Server-Rechte-Erkennung (`src/bot/serverRights.js`)
Der Bot erkennt seine Berechtigungen auf dem jeweiligen Server vollautomatisch und passt die Bauausführung an:
- **Netzwerk-Paketprüfung:** Überwacht `declare_commands` (prüft, ob `/setblock` oder `/fill` deklariert sind) und `entity_status` (Vanilla OP-Status Level 0–4).
- **Auto-Degradierung:** Wird `BUILD_EXECUTION_MODE=auto` oder `hybrid_visual` konfiguriert, aber der Bot hat keine OP-Rechte, schaltet er automatisch und ohne Fehlermeldung auf `pure_physical` um.
- **Reaktive Chat-Korrektur:** Wird ein Befehl mit *"Keine Berechtigung"* oder *"You do not have permission"* abgewiesen, stuft sich der Bot sofort auf Non-OP zurück.

### 5.3 Einstellungsreiter im Dashboard
Alle Einstellungen können im Dashboard im Reiter **„Einstellungen“** (`#tabSettings`) jederzeit eingesehen, verändert und mit einem Klick gespeichert werden, ohne den Node.js-Prozess manuell neu starten zu müssen.

---

## 6. Testabdeckung & Qualitätssicherung

Die Testsuite umfasst nun **10 modulare Testsuiten mit über 480 automatisierten Offline-Assertions** (100% PASS):

```bash
# Gesamte Testsuite ausführen (100% PASS)
npm test

# Einstellungen, Onboarding & Rechte-Erkennung testen (30 Tests)
npm run test:settings

# Survival-Meilensteine testen
npm run test:milestone1
npm run test:milestone2
```

---

## 7. Praxiseinsatz auf dem Survival-Server

1. **Dashboard starten:** Starte das System mit `npm start`.
2. **Onboarding ausfüllen:** Öffne `http://localhost:3080` im Browser und folge dem Einrichtungsassistenten.
3. **Kisten bereitstellen:** Stelle Kisten mit Baumaterialien (Holz, Stein, Glas etc.) im 32m-Umkreis der Baustelle auf.
4. **Bett bereitstellen:** Stelle ein Bett auf (falls keines da ist, trennt der Bot bei Nacht die Verbindung, damit Spieler schlafen können).
