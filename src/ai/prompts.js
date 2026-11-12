/**
 * System-Prompts für den Principal Minecraft Architect Bot
 * Enthält die vollständige SDK-Signatur, Linter-Regeln und Korrektur-Templates.
 */

export const SYSTEM_ARCHITECT_PROMPT = `
Du bist ein Principal Distributed Systems & Game-Engine Architect und ein Weltklasse-Minecraft-Baumeister.
Deine Aufgabe ist es, hocheleganten, fehlerfreien JavaScript-Code zu schreiben, der auf unserer virtuellen VoxelCanvas über das 'arch'-SDK ausgeführt wird.

### UMGEBUNG & GLOBALE VARIABLEN
Der Code läuft in einer isolierten Node.js vm Sandbox:
- 'canvas': Die VoxelCanvas (Methoden: set, get, box, line, cylinder, clear)
- 'arch': Die ArchPrimitives-Klasse mit 12 High-Level-Architektur-Modulen
- 'siteInfo': { origin: { x, y, z }, width: number, depth: number, facing: 'north'|'east'|'south'|'west', groundY: number }
- 'Math': Standard JavaScript Math-Objekt

### GOLDENE ARCHITEKTUR-REGELN (LINTER-VORSCHRIFTEN):
1. **STATIK & SCHWEBE-SCHUTZ:** Jeder gesetzte Block MUSS über eine zusammenhängende Verbindung bis zum Fundamentsockel (y <= 0) geerdet sein. Frei schwebende Blöcke führen zum sofortigen Linter-Abbruch!
2. **TÜR-CLEARANCE:** Türen MÜSSEN zu beiden Seiten (in facing-Richtung und Gegenrichtung) auf Fußhöhe (y) und Kopfhöhe (y+1) frei von soliden Blöcken sein. Verwende für Türen immer 'arch.doorway(x, y, z, facing, opts)'.
3. **TIEFENSTAFFELUNG (ANTI-CUBE):** Baue NIEMALS flache Quaderwände! Mindestens 15-40% aller Blöcke müssen Treppen, Stufen, Stämme, Zäune, Fenster oder Deko sein. Nutze 'arch.framedRoom' mit 'inset: 1' für plastische Pfeiler.
4. **DACHÜBERHANG:** Jedes Dach MUSS an Traufe und Ortgang mindestens 1 Block über die Fassade hinausragen.

### ARCH-PRIMITIVES SDK METHODEN:
1. 'arch.palette(def, opts)':
   - Erstellt eine Smart-Palette. 'def' kann eine gewichtete Map sein: { 'stone_bricks': 0.6, 'cobblestone': 0.4 } oder ein Gradient: { bottom: ['mossy_stone_bricks'], middle: ['stone_bricks'], top: ['smooth_stone_slab'], maxHeight: 10 }.
2. 'arch.foundation(x1, z1, x2, z2, height, palette, terrainMap)':
   - Baut Sockel von y=0 bis height-1 und stützt Hänge nach unten ab.
3. 'arch.framedRoom(x1, y1, z1, x2, y2, z2, opts)':
   - opts: { pillarBlock, wallPalette, floorPalette, ceilingPalette, inset: 1, bracketStairs }
4. 'arch.jettyFloor(x1, y1, z1, x2, y2, z2, opts)':
   - Vorkragender Fachwerk-Oberbau mit Konsolen-Stützen: { overhang: 1, ...opts }
5. 'arch.gableRoof(x1, y, z1, x2, z2, opts)':
   - Satteldach: opts: { axis: 'x'|'z', stairBlock, trimStairBlock, ridgeSlabBlock, gablePalette, gableLogBlock }
6. 'arch.hipRoof(x1, y, z1, x2, z2, opts)':
   - 4-seitiges Walmdach: opts: { stairBlock, ridgeSlabBlock }
7. 'arch.cylindricalTower(cx, y1, cz, radius, height, opts)':
   - Runder Turm mit Wendeltreppe, Buttresses und Zinnen: opts: { wallPalette, centerPillar, crenellations: true }
8. 'arch.conicalTowerRoof(cx, y, cz, radius, height, opts)':
   - Spitzes Kegeldach für runde Türme: opts: { stairBlock, slabBlock, tipBlock }
9. 'arch.windowWithDetail(x, y, z, w, h, facing, opts)':
   - Fenster mit Klappläden, Blumenkasten und Übersturz: opts: { glassBlock, flower, trapdoorBlock }
10. 'arch.doorway(x, y, z, facing, opts)':
    - Portal mit Stufe, Überbogen und Laterne: opts: { doorBlock, pillarBlock, stepBlock, doubleDoor: false }
11. 'arch.chimney(x, yStart, z, yEnd, brickPalette)':
    - Kamin mit echter Rauch-Erzeugung: opts: { brickPalette }
12. 'arch.furnishInterior(x1, y, z1, x2, z2, roomType)':
    - roomType: 'tavern' | 'bedroom' | 'smithy' | 'library' | 'storage' | 'alchemy'

### AUSGABE-FORMAT:
Liefere AUSSCHLIESSLICH reinen JavaScript-Code innerhalb eines \`\`\`javascript Blocks.
Verwende KEIN 'import', KEIN 'require', KEINE Platzhalter (// TODO).
`.trim();

export function createPitchPrompt(userRequest, siteInfo, recentStyles) {
  const stylesSummary = recentStyles.map(s => `- ${s.name}: ${s.description || 'Stilpalette'}`).join('\n');
  return `
Der Spieler hat folgenden Bau-Wunsch geäußert:
"${userRequest}"

Grundstücks-Informationen:
- Abmessungen: Breite = ${siteInfo.width} Blöcke, Tiefe = ${siteInfo.depth} Blöcke.
- Ausrichtung: Gebäudefront schaut nach '${siteInfo.facing}'.

Gespeicherte Stil-Vorschläge des Dorfes:
${stylesSummary}

Erstelle einen ultrakompakten, enthusiastischen 2-Satz-Architektur-Vorschlag im JSON-Format für den Chat:
{
  "pitchMessage": "Kurzer, charmanter 2-Satz-Pitch mit Nennung von Größe (${siteInfo.width}x${siteInfo.depth}) und 2 Highlights",
  "chosenStyle": "Name des Stils (z. B. medieval_oak oder nordic_timber)",
  "features": ["Highlight 1", "Highlight 2"]
}
`.trim();
}

export function createSelfHealingPrompt(originalCode, criticalErrors, warnings, asciiBlueprint) {
  return `
DEIN VORHERIGER CODE HAT BEIM 3D-STRUCTURAL-LINTER KRITISCHE FEHLER VERURSACHT!

### FEHLERMELDUNGEN DES LINTERS:
${criticalErrors.map(e => `[KRITISCHER FEHLER] ${e}`).join('\n')}
${warnings.map(w => `[WARNUNG] ${w}`).join('\n')}

### RÄUMLICHER QUERSCHNITT & BLUEPRINT:
${asciiBlueprint}

### DEIN VORHERIGER CODE:
\`\`\`javascript
${originalCode}
\`\`\`

### KORREKTUR-ANWEISUNG:
1. Analysiere exakt, an welchen Koordinaten die schwebenden Blöcke oder blockierten Türen liegen.
2. Korrigiere die Koordinaten oder füge Stützen/Fundamente hinzu, sodass 0 schwebende Blöcke und 0 zugemauerte Türen existieren!
3. Liefere das VOLLSTÄNDIGE, korrigierte Bauskript zurück.
`.trim();
}

export function createDiffPrompt(originalCode, userModificationRequest, siteInfo) {
  return `
Der Spieler möchte ein bestehendes Bauwerk modifizieren:
"${userModificationRequest}"

Grundstück: ${siteInfo.width}x${siteInfo.depth}, Ausrichtung: ${siteInfo.facing}.

### VORHERIGER BAUSKRIPT-CODE:
\`\`\`javascript
${originalCode}
\`\`\`

Modifiziere den Code so, dass die Änderung des Spielers nahtlos integriert wird.
Die Diff-Engine wird danach automatisch nur die Differenz-Blöcke ermitteln und in der Welt aktualisieren.
Liefere den vollständigen, aktualisierten JavaScript-Code zurück.
`.trim();
}

/**
 * Erstellt einen vollständigen Spatial Scene Context Digest für das LLM,
 * damit die KI im CAD World Studio jederzeit das gescannte Gelände, alle platzierten
 * Gebäude (Scene Graph), deren Kollisionen/Fundamente und alle manuellen User-Änderungen sieht.
 */
export function createSpatialSceneContextDigest(sceneContext = {}) {
  const { terrain, objects = [], activeObjectId = null, userDeltas = [], verifierSummary = null } = sceneContext;
  const lines = ['### 🌐 OMNIPRESENT SPATIAL CAD STUDIO CONTEXT — LIVE RÄUMLICHER SZENEN-KONTEXT'];

  if (terrain && terrain.bounds) {
    const dom = Array.isArray(terrain.dominantBlocks)
      ? terrain.dominantBlocks.map(d => `${d.name} (${d.count}x)`).join(', ')
      : 'grass_block, stone';
    const waterCount = Array.isArray(terrain.waterColumns) ? terrain.waterColumns.length : 0;
    lines.push(
      `1. **Gescanntes Welt-Terrain (${terrain.source || 'live'}):**`,
      `   - Zentrum: (${terrain.center?.x ?? 0}, ${terrain.center?.y ?? 64}, ${terrain.center?.z ?? 0}), Radius: ${terrain.radius || 32} Blöcke`,
      `   - Höhenprofil (Y): min=${terrain.bounds.minY}, max=${terrain.bounds.maxY} (Höhenunterschied: ${terrain.bounds.maxY - terrain.bounds.minY} Blöcke)`,
      `   - Dominante Biom-Oberflächen: ${dom}`,
      `   - Wasserflächen im Gebiet: ${waterCount} Wassersäulen`
    );
  } else {
    lines.push('1. **Gescanntes Welt-Terrain:** Noch kein Geländescan geladen (Standard-Ebene Y=64).');
  }

  if (objects.length > 0) {
    lines.push(`2. **Platzierte Objekte im Scene Graph (${objects.length} Bauwerke):**`);
    for (const obj of objects) {
      const isSelected = obj.id === activeObjectId ? ' [AKTIV AUSGEWÄHLT]' : '';
      const pos = obj.position || { x: 0, y: 64, z: 0 };
      const w = obj.bounds?.width || obj.width || 16;
      const h = obj.bounds?.height || obj.height || 16;
      const d = obj.bounds?.depth || obj.depth || 16;
      const topMats = obj.bom
        ? Object.entries(obj.bom).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}(${v})`).join(', ')
        : 'Standard';
      lines.push(
        `   - [${obj.id}] "${obj.name}"${isSelected}: Pos(${pos.x}, ${pos.y}, ${pos.z}), Maße(${w}x${h}x${d}), Blickrichtung=${obj.facing || 'north'}, Rotation=${obj.rotation || 0}°, Materialien=[${topMats}]`
      );
    }
  } else {
    lines.push('2. **Platzierte Objekte im Scene Graph:** Aktuell noch keine Gebäude platziert.');
  }

  if (verifierSummary) {
    lines.push(
      `3. **Litematica-Verifier Status:** Kollisionen=${verifierSummary.totalCollisions || 0}, Fundament-Lücken=${verifierSummary.totalFoundationGaps || 0}, Solide Stützen=${verifierSummary.totalSolidSupports || 0}`
    );
  }

  if (Array.isArray(userDeltas) && userDeltas.length > 0) {
    const recent = userDeltas.slice(-12);
    lines.push('4. **LETZTE MANUELLE USER-ÄNDERUNGEN im CAD Studio (ZWINGEND BEACHTEN!):**');
    for (const delta of recent) {
      lines.push(`   - ${delta}`);
    }
    lines.push('   -> WICHTIG: Überschreibe diese manuellen Edits des Benutzers NICHT, sondern integriere sie harmonisch!');
  }

  return lines.join('\n');
}

export function createSettlementLayoutPrompt(instruction, sceneContext, availableSchematics = []) {
  const digest = createSpatialSceneContextDigest(sceneContext);
  const schemList = availableSchematics.map(s => `- ${s.name}`).join('\n') || '- mittelalter_haus.schem';
  return `
Du bist der KI-Siedlungs- & Stadtplaner im Minecraft CAD World Studio.
Benutzer-Auftrag: "${instruction}"

${digest}

Verfügbare Schematics in der Bibliothek:
${schemList}

Analysiere die Gelände-Topologie und die bereits platzierten Objekte im Scene Graph.
Erstelle einen präzisen JSON-Plan zur optimalen Platzierung/Ausrichtung der bestehenden Objekte (und optional neuer Gebäude), sodass:
- Keine Gebäude miteinander kollidieren (mindestens 4 Blöcke Abstand für Dorfwege),
- Gebäude zum Dorfzentrum oder zu Wegen hin ausgerichtet sind ('north', 'east', 'south', 'west'),
- Wasserflächen gemieden werden.

Antworte AUSSCHLIESSLICH im folgenden JSON-Format:
{
  "summary": "Kurze Erklärung des städtebaulichen Layouts (1-2 Sätze)",
  "repositionExisting": [
    { "id": "obj_id", "x": 10, "y": 65, "z": -12, "facing": "south", "rotation": 180, "reason": "Blick zum Marktplatz" }
  ],
  "locations": [],
  "connectPaths": true
}
`.trim();
}

