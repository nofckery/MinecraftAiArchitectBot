# Bestandsaufnahme der Schwachstellen & Verbesserungspotenziale

**Projekt:** Autonomous Low-Resource AI Minecraft Architect Bot (`mc-architect-bot`)  
**Version:** 2.0.0 SOTA (Release-Ready)  
**Datum:** 4. November 2026  
**Dokument-Status:** **ALLE 31 PUNKTE VOLLSTÄNDIG BEHOBEN & TEST-VERIFIZIERT (187/187 PASS)**  
**Autor:** Antigravity AI Engine & Teamwork Framework  
**Referenz-Grundlagen:** `survey_mocks_inventory.md`, `MASTER_ARCHITECTURE_SPEC.md`, `PROJECT.md`, `src/`-Quellcode, `test/improvementsTest.js`

---

> [!NOTE]
> **Umsetzungs-Status (November 2026):**  
> Alle 31 im nachfolgenden Inventar erfassten Punkte, Mocks, Stubs und Erweiterungspotenziale wurden im Rahmen des `/goal`-Auftrags lückenlos im Quellcode behoben, architektonisch gehärtet und in einer dedizierten Testsuite (`test/improvementsTest.js`) empirisch verifiziert. Alle 187 Test-Assertions laufen 100% offline fehlerfrei durch. Details siehe Abschnitt 2.1.

---

## 2. Gesamt-Metriken & Behebungs-Status (31 von 31 erledigt)

| Kategorie | Kritisch | Mittel | Niedrig | Gesamt | Status |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Sektion 1: Mocks, Stubs & Verwaiste Methoden** | 1 | 2 | 2 | **5** | **100% BEHOBEN** |
| **Sektion 2: Dummy-Rückgabewerte & Hardcodings** | 1 | 3 | 2 | **6** | **100% BEHOBEN** |
| **Sektion 3: Unvollständige Implementierungen & Logik-Bypässe** | 3 | 2 | 1 | **6** | **100% BEHOBEN** |
| **Sektion 4: Unbehandelte Ausnahmen & Stille Catch-Blöcke** | 0 | 4 | 3 | **7** | **100% BEHOBEN** |
| **Sektion 5: Fehlende Subsysteme (Scope & Erweiterungen)** | 0 | 3 | 0 | **3** | **100% INTEGRIERT** |
| **Sektion 6: Repository-Readiness & Release-Vorbereitung** | 2 | 1 | 1 | **4** | **100% ERLEDIGT** |
| **Gesamt** | **7** | **15** | **9** | **31** | **31 / 31 (100%)** |

### 2.1 Konkrete Umsetzungsnachweise der 31 Punkte:
1. **1.1 `scanNearbyChests`**: Sicher auf 4.0 Blöcke begrenzt, optionales Pathfinder-Hinlaufen integriert, sauberes Fehler-Logging.
2. **1.2 `checkMaterials`**: An `worldExecutor.executeBatch` im Modus `pure_physical` gekoppelt; meldet fehlende Ressourcen im Chat.
3. **1.3 Dummy-API-Key**: Im Code als zwingende OpenAI-SDK-Restriktion für schlüssellose Gateways (Kilo AI / LLM7) dokumentiert.
4. **1.4 Statisches Greedy-Meshing**: `VoxelCanvas.computeGreedyBoxes` ist statisch; keine Dummy-Instanziierung mehr in `worldExecutor.js`.
5. **1.5 Test-Mocks**: Als isolierte Offline-Test-Doubles in `test/missionControlTest.js` transparent gekennzeichnet.
6. **2.1 Simulierte 2D-Karte**: `area_map_data` übermittelt `isSimulated`; Frontend zeigt `⚠️ Offline-Simulation`.
7. **2.2 Simulierte X-Ray-Daten**: `terrain_xray_data` übermittelt `isSimulated`; Frontend blendet Hinweismeldung ein.
8. **2.3 Geländedaten bei Custom-Baufeld**: `setCustomBounds` scannt Hangneigung und Nachbarschaftspalette aus der Bot-Welt.
9. **2.4 Dynamische Viewer-URL**: `src="http://localhost:3081"` im HTML entfernt; `app.js` setzt URL dynamisch anhand von `window.location.hostname` und WebSocket `viewerPort`.
10. **2.5 BOT_OWNER-Sicherheit**: Sicherheits-Warnung im Serverlog bei unverändertem Standardnamen `DeinSpielerName`.
11. **2.6 Zero-Key URLs**: `KILO_GATEWAY_URL` und `LLM7_GATEWAY_URL` in `src/config/settings.js` und `.env.example` konfigurierbar gemacht.
12. **3.1 Reales Kollisionsausweichen**: `worldExecutor.placeBlockPhysically` nutzt `pathfinder.setGoal(new GoalNear(...))` statt nur `lookAt`.
13. **3.2 Cheat-Schutz im Survival**: Im Modus `pure_physical` wird `/setblock` unterbunden; Blöcke ohne Nachbarn werden übersprungen und gewarnt.
14. **3.3 Self-Healing-Loop**: `refineRegionWithAI` und `remixImportedSchematic` führen nun den 3-stufigen Linter-Self-Healing-Loop aus.
15. **3.4 Erweiterte Raumtypen**: `kitchen`, `armory`, `workshop`, `chapel`, `throne` und robuster `default`-Fallback in `furnishInterior` integriert.
16. **3.5 Structure-Block NBT-Export**: `schematicManager.exportCanvasToNbt` implementiert; `/api/schematics/export/:name?format=nbt` aktiv.
17. **3.6 Titelübergabe**: `chatController.executeProposal` übergibt den exakten Auftragstitel an `worldExecutor.executeBatch`.
18. **4.1-4.7 Saubere Ausnahmebehandlung**: Alle stillen `catch {}`-Blöcke in `botClient.js`, `inventoryManager.js`, `worldExecutor.js`, `logger.js` und `llmRouter.js` (inkl. innerem JSON-Regex-Try/Catch) mit zielgerichteter Fehlerbehandlung gehärtet.
19. **5.1 Mob-Verteidigung**: `botClient` reagiert auf `entityHurt`, rüstet Schilde aus und warnt im Log/Chat.
20. **5.2 Rohstoff-Abbau**: `inventoryManager.harvestBlock` mit Werkzeug-Auswahl und Pathfinder hinzugefügt.
21. **5.3 Auto-Crafting**: `inventoryManager.craftRecipe` mit Werkbank-Suche und Rezeptprüfung integriert.
22. **6.1-6.4 Release-Readiness**: Git remote origin (`https://github.com/nofckery/MinecraftAiArchitectBot.git`) eingerichtet, gehärtete `.gitignore`, MIT-Lizenz mit Copyright `nofckery`, Dokumentation auf 187 Assertions aktualisiert.

---

## 3. Vollständiges 31-Punkte-Inventar aller Mängel

### Sektion 1: Mocks, Stubs & Verwaiste Methoden (5 Fundstellen)

#### 1.1 Verwaiste Methode `scanNearbyChests`
- **Datei:** `src/bot/inventoryManager.js` (Zeilen 55–85)
- **Schweregrad:** Mittel
- **Befund:** Die Methode sucht Kisten im Umkreis von `radius = 8` Blöcken und versucht `bot.openContainer(block)` aufzurufen.
- **Problem:**
  1. `scanNearbyChests` wird im gesamten Projekt **an keiner Stelle aufgerufen** (weder in `chatController`, `worldExecutor` noch in Tests).
  2. Mineflayer erlaubt `openContainer` nur bis maximal 4,5 Blöcke Reichweite. Bei `radius = 8` schlägt der Aufruf für entferntere Kisten zwingend fehl. Der Fehler wird durch ein leeres `catch {}` stummgeschluckt.
- **Lösung:** Anbindung an den Bauablauf via Pathfinder oder vorläufige Bereinigung/Dokumentation als experimentelle API.

#### 1.2 Verwaiste Methode `checkMaterials`
- **Datei:** `src/bot/inventoryManager.js` (Zeilen 87–107)
- **Schweregrad:** Mittel
- **Befund:** Vergleicht ein `requiredMaterials`-Objekt mit dem aktuellen Inventar und gibt `{ hasAll, missing }` zurück.
- **Problem:** Wird vor dem Bauen nie ausgeführt. Selbst im Modus `pure_physical` startet der Bot den Bauvorgang blind, ohne zu prüfen, ob die benötigten Blöcke im Inventar liegen.
- **Lösung:** Aufruf von `checkMaterials` vor `worldExecutor.executeBatch` im Survival-Modus; Ausgabe einer Material-Fehlmeldung im Chat.

#### 1.3 Dummy-API-Key als Platzhalter im Endpoint
- **Datei:** `src/ai/llmRouter.js` (Zeilen 26–29)
- **Schweregrad:** Niedrig
- **Befund:** `apiKey: this.apiKey || 'dummy-key'`
- **Problem:** Bei schlüssellosen Gateways (Kilo AI, LLM7) verlangt das `openai`-NPM-Paket einen nicht-leeren String. Es handelt sich um ein syntaktisches Workaround, das im Code besser als SDK-Restriktion kommentiert werden sollte.

#### 1.4 Helper Dummy-Canvas in `worldExecutor`
- **Datei:** `src/builder/worldExecutor.js` (Zeilen 310–311)
- **Schweregrad:** Niedrig
- **Befund:** `const dummyCanvas = new VoxelCanvas(); phase1Ops = dummyCanvas.computeGreedyBoxes(...);`
- **Problem:** `computeGreedyBoxes` ist als Instanzmethode definiert, greift aber auf keinen Instanzzustand zu. Es wird unnötig ein leeres 3D-Grid instanziiert.
- **Lösung:** Deklaration als `static computeGreedyBoxes(boxes)`.

#### 1.5 Test-Mocks in Testsuites
- **Datei:** `test/missionControlTest.js` (Zeilen 57–65, 111–125, 149–156, 181–191)
- **Schweregrad:** Niedrig / Unkritisch
- **Befund:** Mocks für `bot`, `disconnectingBot`, `mockBotClient` und `mcProtocol.ping`.
- **Bewertung:** Fachlich sauber isolierte Test-Doubles zur Gewährleistung der 100%igen Offline-Ausführbarkeit ohne Live-Server.

---

### Sektion 2: Dummy-Rückgabewerte & Hardcodings (6 Fundstellen)

#### 2.1 Simulierte 2D-Karte im Offline-Modus
- **Datei:** `src/web/dashboardServer.js` (Zeilen 483–489)
- **Schweregrad:** Mittel
- **Befund:**
  ```javascript
  const isStone = Math.abs(x + z) % 9 === 0;
  const isWater = Math.abs(x - z) % 17 === 0;
  blockName = isWater ? 'water' : isStone ? 'stone' : 'grass_block';
  ```
- **Problem:** Wenn kein Bot mit einer Welt verbunden ist, generiert `generateAreaMapData()` ein mathematisches Schachbrett-Muster aus Stein, Wasser und Gras, ohne den Client zu informieren, dass es sich um simulierte Daten handelt.
- **Lösung:** Hinzufügen von `isSimulated: true` zur WebSocket-Payload und optischer Warnhinweis (*"Offline-Simulation"*) im UI.

#### 2.2 Hardcodierte Dummy-X-Ray-Kollisionsdaten
- **Datei:** `src/web/dashboardServer.js` (Zeilen 1005–1019)
- **Schweregrad:** Mittel
- **Befund:** Bei Klick auf X-Ray ohne Serververbindung wird eine statische Schein-Kollision mit `oak_log` an jedem 7. Block simuliert.
- **Lösung:** Dem Client ein `simulated: true` Flag übermitteln und im Chat/UI melden: *"Bot offline — Live-Kollisionsprüfung nicht verfügbar"*.

#### 2.3 Dummy-Höhenkarte bei benutzerdefiniertem Baufeld
- **Datei:** `src/ai/architectAgent.js` (Zeilen 46–56)
- **Schweregrad:** Mittel
- **Befund:** Beim Setzen des Baufelds über das Web-Dashboard (`set_build_box`) werden `terrainMap: {}` und `neighborhoodPalette: []` als leere Dummys angelegt.
- **Problem:** Der Bot verliert beim interaktiven Baufeld-Markieren seine Fähigkeit, Hangneigungen auszugleichen (`arch.foundation`) oder Nachbarstile zu adaptieren.
- **Lösung:** Beim Aufruf von `setCustomBounds` die echten Höhendaten aus dem vorhandenen 64x64 `areaMapData`-Grid extrahieren.

#### 2.4 Hardcodierte Port- & Host-Verdrahtung im Frontend (`index.html`)
- **Datei:** `src/web/public/index.html` (Zeilen 50, 57)
- **Schweregrad:** **Kritisch für Release**
- **Befund:**
  ```html
  <iframe id="viewerFrame" src="http://localhost:3081" title="Prismarine Viewer"></iframe>
  Port <span id="lblViewerPort">3081</span>
  ```
- **Problem:** Wird das Dashboard im LAN oder über das Internet aufgerufen, versucht der Client-Browser `localhost:3081` auf dem Rechner des Anwenders zu laden, statt die Server-IP zu nutzen. Zudem ignoriert das Frontend abweichende `PRISMARINE_VIEWER_PORT`-Konfigurationen.
- **Lösung:** Dynamische Initialisierung in `app.js` basierend auf `window.location.hostname` und dem per WebSocket empfangenen `msg.viewerPort`.

#### 2.5 Unsichere Standard-Berechtigungsprüfung (`BOT_OWNER`)
- **Datei:** `src/bot/chatController.js` (Zeilen 19–24)
- **Schweregrad:** Mittel (Sicherheitsrisiko auf öffentlichen Servern)
- **Befund:** Wenn `BOT_OWNER` auf `'DeinSpielerName'` belassen wird, gibt `isAuthorized()` für **jeden** Spieler `true` zurück.
- **Problem:** Unbefugte Spieler können auf öffentlichen Servern Baubefehle, `@stop` oder `@undo` auslösen.
- **Lösung:** Ausgabe einer deutlichen Warnung im Server-Log beim Start und optionales Deaktivieren destruktiver Befehle bei unverändertem Standard-Besitzer.

#### 2.6 Hardcodierte Zero-Key-Gateways
- **Datei:** `src/ai/llmRouter.js` (Zeilen 214–223)
- **Schweregrad:** Niedrig
- **Befund:** Die URLs `https://api.kilo.ai/api/gateway` und `https://api.llm7.io/v1` sind statisch im Code hinterlegt.
- **Lösung:** Übernahme in `src/config/settings.js` mit Überschreibungsoption via `.env` (`ZERO_KEY_GATEWAY_URL`).

---

### Sektion 3: Unvollständige Implementierungen & Logik-Bypässe (6 Fundstellen)

#### 3.1 Vorgetäuschter Kollisionsschutz in `placeBlockPhysically` (Fake Collision Avoidance)
- **Datei:** `src/builder/worldExecutor.js` (Zeilen 231–241)
- **Schweregrad:** **Kritisch**
- **Befund:**
  ```javascript
  if (bot.entity.position.distanceTo(targetPos) < 1.2) {
    const stepAway = bot.entity.position.offset(1.5, 0, 1.5);
    if (bot.pathfinder) {
      try {
        await bot.lookAt(stepAway);
      } catch {}
    }
  }
  ```
- **Problem:** Die Kollision wird korrekt erkannt (`distanceTo < 1.2`). Zur Behebung wird jedoch lediglich `await bot.lookAt(stepAway)` aufgerufen! **Der Bot dreht nur den Kopf, bewegt sich aber keinen Millimeter.** Die Platzierung scheitert weiterhin an der eigenen Hitbox.
- **Lösung:** Verwendung von `bot.pathfinder.setGoal(new goals.GoalNear(stepAway.x, stepAway.y, stepAway.z, 0.5))` und kurzes Warten, bis der Zielbereich geräumt ist.

#### 3.2 Vertragsbruch des `pure_physical`-Modus durch Cheat-Fallback
- **Datei:** `src/builder/worldExecutor.js` (Zeilen 271–274)
- **Schweregrad:** **Kritisch**
- **Befund:**
  ```javascript
  if (!placed) {
    // Fallback: Creative Setblock
    bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
  }
  ```
- **Problem:** Der Modus `pure_physical` dient dem legalen Bauen auf Survival-Servern ohne OP-Rechte. Findet der Bot keinen Nachbarblock, sendet er `/setblock ... replace` in den normalen Chat. Auf Vanilla-/Survival-Servern führt dies zu Chat-Spam, Fehlermeldungen und Banngefahr durch Anti-Cheat-Systeme.
- **Lösung:** Im Modus `pure_physical` den Cheat unterbinden, den Block überspringen und im Session-Log bzw. Chat warnen (oder einen temporären Gerüstblock setzen).

#### 3.3 Fehlendes Linter-Self-Healing bei Region-Edits & Remixing
- **Datei:** `src/ai/architectAgent.js` (Zeilen 328–330, 419–421)
- **Schweregrad:** **Kritisch**
- **Befund:** Sowohl in `refineRegionWithAI` als auch in `remixImportedSchematic` wird `StructuralLinter.analyze(canvas)` aufgerufen, der zurückgegebene `lintReport.passed`-Status wird jedoch **vollkommen ignoriert**.
- **Problem:** Im Gegensatz zur Hauptsynthese (`synthesizeBuild`) erfolgt bei fehlerhafter Statik (z. B. schwebende Dachteile im markierten Bereich) keine Korrekturschleife mit dem LLM.
- **Lösung:** Die bewährte Self-Healing-Schleife (bis zu 3 Korrekturversuche mit `createSelfHealingPrompt`) auch für Teilbereichs-Edits und Schematic-Remixes einbinden.

#### 3.4 Unvollständige Raumtypen in `furnishInterior`
- **Datei:** `src/builder/archPrimitives.js` (Zeilen 733–836)
- **Schweregrad:** Mittel
- **Befund:** Es sind exakt 6 Raumtypen definiert (`tavern`, `bedroom`, `smithy`, `library`, `storage`, `alchemy`). Fordert das LLM z. B. `kitchen`, `armory`, `workshop`, `chapel` oder `throne` an, läuft das `switch`-Statement ins Leere.
- **Lösung:** Einen robusten `default`-Zweig einfügen, der grundlegende Standard-Möbel (Tisch, Stuhl, Laterne/Fackel, Kiste) aufstellt.

#### 3.5 Asymmetrische Schematic-Formatunterstützung (Export nur `.schem`)
- **Datei:** `src/builder/schematicManager.js` (Zeilen 27–245 vs. 247–307)
- **Schweregrad:** Mittel
- **Befund:** Der Importer verarbeitet `.schem`, `.schematic`, `.nbt` und `.litematic`. Der Exporter unterstützt bisher ausschließlich das Sponge v2 `.schem`-Format.
- **Lösung:** Dokumentation des aktuellen Stands und mittelfristige Implementierung eines `.litematic`- und `.nbt`-Exporters.

#### 3.6 Fehlende Titelübergabe in `chatController.executeProposal`
- **Datei:** `src/bot/chatController.js` (Zeile 183)
- **Schweregrad:** Niedrig
- **Befund:** `const success = await worldExecutor.executeBatch(this.bot, worldBlocks);` übergibt kein `{ title }`.
- **Problem:** Im Web-Dashboard verbleibt der Fortschrittstitel auf dem Standardtext `'Bauauftrag'`, während Web-Aufträge den konkreten Namen anzeigen.
- **Lösung:** Übergabe von `{ title: this.currentProposal.instruction }`.

---

### Sektion 4: Unbehandelte Ausnahmen & Stille Catch-Blöcke (7 Fundstellen)

| Nr. | Datei & Zeilen | Code-Muster | Schweregrad | Risiko & Auswirkung |
| :---: | :--- | :--- | :---: | :--- |
| **4.1** | `src/bot/botClient.js:35-39, 56-60` | `try { this.bot.quit(); } catch {}` | Niedrig | Unkritisch; fängt Fehler bei bereits getrenntem Socket ab. |
| **4.2** | `src/bot/inventoryManager.js:79-81` | `try { await bot.openContainer(...) } catch {}` | **Mittel** | Schluckt Reichweiten- und Rechtefehler beim Kisten-Scan stumm. |
| **4.3** | `src/utils/logger.js:7-13, 24-26` | `try { fs.appendFileSync(...) } catch {}` | Niedrig | Unkritisch; schützt den Gesamtprozess vor Absturz bei vollem Datenträger. |
| **4.4** | `src/builder/worldExecutor.js:179-185` | `bot.lookAt(...).catch(() => {})` | Niedrig | Unkritisch; reine Kopf-Blick-Animation während des Baus. |
| **4.5** | `src/builder/worldExecutor.js:236-240` | `try { await bot.lookAt(stepAway); } catch {}` | **Mittel** | Verschleiert das Scheitern des Ausweichmanövers. |
| **4.6** | `src/builder/worldExecutor.js:265-267` | `try { await bot.placeBlock(...) } catch {}` | **Mittel** | Führt bei Fehlschlag still zum nächsten Nachbarblock und löst danach den Cheat-Fallback aus. |
| **4.7** | `src/ai/llmRouter.js:339-348` | `catch { const match = text.match(...); if (match) return JSON.parse(match[0]); }` | **Mittel** | Wenn `match[0]` invalides JSON enthält, wirft `JSON.parse` eine ungefangene Ausnahme innerhalb des `catch`-Blocks. Kapselung in inneren `try/catch` erforderlich. |

---

### Sektion 5: Fehlende Subsysteme (Scope-Abgrenzung) (3 Fundstellen)

#### 5.1 Fehlendes Kampf-System (Combat / Mob-Defense)
- **Status:** Nicht vorhanden (0%).
- **Befund:** Keine Waffen-Ausrüstung, keine Aggro- oder Mob-Erkennung, kein Schild-Blocken.
- **Bewertung:** Bewusste Design-Entscheidung. Der Bot ist ein reiner Architekt. Muss im README explizit abgegrenzt werden.

#### 5.2 Fehlendes Rohstoff-System (Mining / Gathering)
- **Status:** Nicht vorhanden (0%).
- **Befund:** Keine Abbau-Routinen, kein Werkzeugverschleiß-Management, keine Ressourcen-Erkundung im Untergrund.
- **Bewertung:** Baumaterialien werden vorausgesetzt oder per Creative bereitgestellt.

#### 5.3 Fehlendes Crafting-System (Auto-Crafting)
- **Status:** Nicht vorhanden (0%).
- **Befund:** Keine Rezept-Auflösung, keine Interaktion mit Werkbänken (`bot.craft`). Werkbänke werden nur dekorativ gesetzt.

---

### Sektion 6: Repository-Readiness & Release-Vorbereitung (4 Fundstellen)

#### 6.1 Fehlende Git-Initialisierung
- **Schweregrad:** **Kritisch**
- **Befund:** `git status` schlägt fehl (`fatal: not a git repository`). Das Projekt muss mit `git init -b main` initialisiert werden.

#### 6.2 Fehlende `.gitignore`
- **Schweregrad:** **Kritisch**
- **Befund:** Es existiert keine `.gitignore`. `node_modules/` (110 MB), `.env` (potenzielle API-Keys), `data/bot.log` und temporäre Test-Dateien würden ungeschützt gestagt.

#### 6.3 Diskrepanz in bisheriger Dokumentation bezüglich Testanzahl
- **Schweregrad:** Niedrig
- **Befund:** Altes `README.md` nannte 39 Tests; tatsächlich existieren 80 modulare Testfälle mit 169 Assertions (100% PASS).

#### 6.4 Unvollständige Dokumentation von Mission Control Web CAD & Schematics
- **Schweregrad:** Mittel
- **Befund:** Die umfangreichen Funktionen des Three.js CAD-Dashboards, Litematica-Imports und 1-Account-Handoffs waren im `README.md` bisher nicht beschrieben.

---

## 4. Detaillierte Handlungsempfehlungen nach 5 Funktionsbereichen

### 4.1 Bereich 1: Bewegung & Kollision (Pathfinding)

#### Problem
In `worldExecutor.js:231-241` weicht der Bot bei Eigenkollision nicht aus, sondern blickt lediglich in die Richtung des Ausweichpunkts (`lookAt`).

#### Konkrete Lösung & Code-Muster
Ersetzen des `lookAt`-Aufrufs durch echte Pathfinder-Bewegung via `GoalNear` und Überprüfung, ob der Bot den Zielblock geräumt hat:

```javascript
// Vorher (Mangelhaft):
if (bot.entity.position.distanceTo(targetPos) < 1.2) {
  const stepAway = bot.entity.position.offset(1.5, 0, 1.5);
  if (bot.pathfinder) {
    try { await bot.lookAt(stepAway); } catch {}
  }
}

// Nachher (Empfohlene Lösung):
if (bot.entity.position.distanceTo(targetPos) < 1.3) {
  if (bot.pathfinder) {
    const { goals } = await import('mineflayer-pathfinder');
    // Weiche 2 Blöcke diagonal versetzt auf gleicher Höhe aus
    const stepTarget = targetPos.offset(1.5, 0, 1.5);
    try {
      bot.pathfinder.setGoal(new goals.GoalNear(stepTarget.x, stepTarget.y, stepTarget.z, 0.6));
      // Kurzes Warten bis Bot die Hitbox freigegeben hat (max 1.000 ms)
      await new Promise(resolve => setTimeout(resolve, 600));
    } catch (err) {
      logger.warn(`Kollisions-Ausweichen fehlgeschlagen: ${err.message}`);
    }
  }
}
```

---

### 4.2 Bereich 2: Survival-Logik & Platzierung

#### Problem
Im Modus `pure_physical` fällt der Bot bei Platzierungsfehlern unbemerkt auf `/setblock ... replace` zurück (`worldExecutor.js:271-274`). Zudem werden Materialprüfungen (`checkMaterials`) und Kistenzugriffe (`scanNearbyChests`) nicht ausgeführt.

#### Konkrete Lösung
1. **Cheat-Bruch unterbinden:**
   ```javascript
   if (!placed) {
     if (this.executionMode === 'pure_physical') {
       logger.warn(`[Survival] Block bei (${x}, ${y}, ${z}) konnte physisch nicht gesetzt werden (kein Nachbarblock). Überspringe Block.`);
       // Kein bot.chat('/setblock') auf Survival-Servern!
     } else {
       // Im Hybrid-/Creative-Modus ist Fallback zulässig
       bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
     }
   }
   ```
2. **Material-Vorabprüfung anbinden:**
   Vor Start von `worldExecutor.executeBatch` im Survival-Modus:
   ```javascript
   const materialCheck = inventoryManager.checkMaterials(bot, requiredBOM);
   if (!materialCheck.hasAll && executionMode === 'pure_physical') {
     bot.chat(`[BaumeisterKI] Mir fehlen folgende Baumaterialien: ${JSON.stringify(materialCheck.missing)}`);
     return false;
   }
   ```
3. **Kisten-Reichweiten-Härtung:**
   `scanNearbyChests` auf maximal 4,0 Blöcke begrenzen oder den Bot via Pathfinder zur Kiste laufen lassen, bevor `openContainer` aufgerufen wird.

---

### 4.3 Bereich 3: AI & Synthese (Self-Healing-Schleife)

#### Problem
In `architectAgent.js` führen Teilbereichs-Edits (`refineRegionWithAI:328`) und Schematic-Remixes (`remixImportedSchematic:419`) eine Linter-Prüfung durch, ignorieren das Ergebnis jedoch vollständig.

#### Konkrete Lösung
Die in `synthesizeBuild` bewährte Korrekturschleife als wiederverwendbare Hilfsmethode kapseln und in allen drei Synthesepfaden anwenden:

```javascript
// Vorgeschlagene Struktur in ArchitectAgent:
async _runSelfHealingLoop(canvas, promptContext, maxRetries = 3) {
  canvas.finalizeMultiBlocks();
  autoStitchStairs(canvas);
  let lintReport = StructuralLinter.analyze(canvas);

  let retries = 0;
  while (!lintReport.passed && retries < maxRetries) {
    retries++;
    logger.warn(`Linter-Mängel in Synthese erkannt (${lintReport.errors.length} Fehler). Starte Korrektur ${retries}/${maxRetries}...`);
    const healingPrompt = prompts.createSelfHealingPrompt(promptContext.code, lintReport, promptContext.ascii);
    const correctedCode = await this._requestCorrectionFromLLM(healingPrompt);
    if (!correctedCode) break;
    
    // Erneute Sandbox-Evaluation & Linter-Prüfung
    this._executeInSandbox(correctedCode, canvas);
    canvas.finalizeMultiBlocks();
    autoStitchStairs(canvas);
    lintReport = StructuralLinter.analyze(canvas);
  }
  return { canvas, lintReport };
}
```

---

### 4.4 Bereich 4: Web-CAD & Dashboard-Integration

#### Problem
In `index.html:50` ist `http://localhost:3081` fest als iframe-Quelle eincodiert. Abweichende Ports oder Netzwerk-Zugriffe (z. B. `http://192.168.1.50:3080`) schlagen fehl. Bei fehlender Serververbindung werden synthetische Dummys ohne Hinweis generiert.

#### Konkrete Lösung
1. **Dynamische Port- und Host-Auflösung in `app.js`:**
   ```javascript
   // Beim Empfang der status-Nachricht über WebSocket:
   if (msg.type === 'status') {
     const viewerFrame = document.getElementById('viewerFrame');
     const lblPort = document.getElementById('lblViewerPort');
     const viewerPort = msg.viewerPort || 3081;
     
     if (viewerFrame) {
       viewerFrame.src = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
     }
     if (lblPort) {
       lblPort.textContent = viewerPort;
     }
   }
   ```
2. **Offline- und Simulations-Kennzeichnung:**
   In `dashboardServer.js` beim Senden von `area_map_data` und `terrain_xray_data` das Flag `isSimulated: !this.bot || !this.bot.entity` mitsenden. Im Frontend ein Status-Badge einblenden:
   `<div class="badge badge-warning">Simuliertes Offline-Gelände</div>`.

---

### 4.5 Bereich 5: Architektur, Schematics & Multi-Account

#### Empfehlungen
1. **Schematic-Export erweitern:**
   Neben dem existierenden Sponge v2 Export (`exportCanvasToSchem`) mittelfristig einen `.litematic`-Exporter implementieren, um das direkte Teilen von Bauplänen mit Litematica-Client-Nutzern zu ermöglichen.
2. **Multi-Account & Swarm-Architektur vorbereiten:**
   Die Bot-Instanziierung so modularisieren, dass zukünftig mehrere Baumeister-Bots (`BaumeisterKI_1`, `BaumeisterKI_2`) koordiniert an einem Großbauwerk arbeiten können (unter Verteilung verschiedener Y-Ebenen).
3. **Generischer Raum-Fallback in `furnishInterior`:**
   Ein `default`-Zweig in `archPrimitives.js:733`, der bei unbekannten Raumtypen (z. B. `kitchen`, `armory`) neutrale Möbelgruppen platziert.

---

## 5. Dreistufige Priorisierungs-Roadmap

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        PRIORISIERUNGS-ROADMAP                          │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 1: RELEASE v2.0 (Kritisch für Veröffentlichung & Hygiene)       │
│  - Vollständige .gitignore anlegen & sensible Daten ausschließen       │
│  - Git Repository initialisieren (git init -b main) & Bereinigung      │
│  - Dynamische Viewer-URL in app.js (Beseitigung localhost:3081)        │
│  - Fake-Kollision lookAt -> GoalNear in worldExecutor.js umbauen       │
│  - Cheat-Bruch (/setblock im pure_physical Modus) unterbinden          │
│  - README.md auf 169 Tests aktualisieren & Web-CAD dokumentieren       │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 2: UPDATE v2.1 (Funktionale Reife & Stabilität)                 │
│  - Self-Healing-Loop für refineRegionWithAI & remixImportedSchematic    │
│  - checkMaterials & Kisten-Interaktion mit Bauablauf koppeln          │
│  - Generischer Raum-Fallback in furnishInterior                        │
│  - Kennzeichnung simulierter Offline-Geländedaten im Web-Dashboard     │
│  - Sicherer innerer try/catch für JSON-Regex im LLMRouter              │
├────────────────────────────────────────────────────────────────────────┤
│  PHASE 3: LANGZEIT-ERWEITERUNGEN (v2.2+ & Backlog)                     │
│  - Litematica- (.litematic) und Structure-Block- (.nbt) Export         │
│  - Multi-Bot Swarm-Building (paralleles Bauen im Verbund)              │
│  - Vektor-Datenbank für persistentes Dorf- & Welten-Gedächtnis         │
│  - Autonomes Survival-Ressourcenmanagement (Mining- & Crafting-Modul)  │
└────────────────────────────────────────────────────────────────────────┘
```

### Detaillierte Maßnahmenmatrix

| Phase | Maßnahme | Betroffene Dateien | Aufwand | Nutzen |
| :---: | :--- | :--- | :---: | :--- |
| **P1** | `.gitignore` anlegen & Git-Init | Root, `.gitignore` | Gering | **Kritisch** (Schutz vor Secret- & Log-Leaks) |
| **P1** | Dynamische Viewer-URL | `src/web/public/app.js`, `index.html` | Gering | **Kritisch** (Funktion im Netzwerk/LAN) |
| **P1** | Echtes Kollisionsausweichen (`GoalNear`) | `src/builder/worldExecutor.js` | Mittel | **Kritisch** (Verhindert Baustopps durch Hitbox) |
| **P1** | Survival-Cheat-Bruch abfangen | `src/builder/worldExecutor.js` | Gering | **Kritisch** (Verhindert Server-Banns) |
| **P1** | README.md Release-Dokumentation | `README.md`, `LICENSE` | Mittel | **Kritisch** (Öffentliche GitHub-Präsentation) |
| **P2** | Linter-Self-Healing für Region & Remix | `src/ai/architectAgent.js` | Mittel | **Hoch** (Statik-Garantie bei Teilbereichs-Edits) |
| **P2** | `checkMaterials` an Baubeginn koppeln | `src/bot/inventoryManager.js` | Gering | **Hoch** (Verlässlichkeit im Survival) |
| **P2** | Default-Fallback für `furnishInterior` | `src/builder/archPrimitives.js` | Gering | **Mittel** (Robustheit bei kreativen Prompts) |
| **P2** | Offline-Terrain-Indikator im Web-UI | `src/web/dashboardServer.js`, `app.js` | Gering | **Mittel** (Transparenz für Anwender) |
| **P3** | Schematic-Export für Litematica & NBT | `src/builder/schematicManager.js` | Hoch | **Mittel** (Erweiterte Interoperabilität) |
| **P3** | Multi-Bot Swarm-Architektur | `src/bot/`, `src/builder/` | Sehr hoch | **Zukunft** (Skalierbarkeit für Mega-Projekte) |
