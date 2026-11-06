/**
 * 3D-Geometrie- & Architektur-Linter
 * Analysiert Bauwerke mathematisch auf schwebende Blöcke, blockierte Eingänge,
 * Gravitationsstabilität und ästhetische Detaildichte vor der Welt-Ausführung.
 */

const GRAVITY_BLOCKS = new Set([
  'sand',
  'red_sand',
  'gravel',
  'anvil',
  'chipped_anvil',
  'damaged_anvil',
  'concrete_powder',
  'white_concrete_powder',
  'orange_concrete_powder',
  'magenta_concrete_powder',
  'light_blue_concrete_powder',
  'yellow_concrete_powder',
  'lime_concrete_powder',
  'pink_concrete_powder',
  'gray_concrete_powder',
  'light_gray_concrete_powder',
  'cyan_concrete_powder',
  'purple_concrete_powder',
  'blue_concrete_powder',
  'brown_concrete_powder',
  'green_concrete_powder',
  'red_concrete_powder',
  'black_concrete_powder'
]);

const NON_BLOCKING_CLEARANCE = new Set([
  'air',
  'cave_air',
  'void_air',
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony'
]);

const DETAIL_PATTERNS = [
  '_stairs',
  '_slab',
  '_log',
  'stripped_',
  '_fence',
  '_fence_gate',
  '_trapdoor',
  '_pane',
  'glass',
  '_leaves',
  'lantern',
  'torch',
  '_wall',
  '_door',
  'chain',
  'flower_pot',
  '_carpet',
  'campfire',
  'iron_bars',
  'barrel',
  'lectern',
  'bookshelf'
];

export class StructuralLinter {
  static isDetailBlock(name) {
    if (!name || name === 'air') return false;
    for (const pat of DETAIL_PATTERNS) {
      if (name.includes(pat) || name.endsWith(pat)) return true;
    }
    return false;
  }

  static analyze(canvas) {
    const criticalErrors = [];
    const warnings = [];
    const keys = canvas.getAllBlockKeys();

    if (keys.length === 0) {
      criticalErrors.push('CanvasEmptyError: Das Bauwerk enthält 0 Blöcke.');
      return {
        passed: false,
        criticalErrors,
        warnings,
        floatingBlocksCount: 0,
        doorClearanceOk: false,
        detailRatio: 0,
        asciiBlueprint: 'LEERES BAUWERK'
      };
    }

    // 1. Schwebende Blöcke & Gravitations-Check (3D Connected Components via BFS)
    const blockMap = new Map();
    let minY = Infinity;

    for (const key of keys) {
      const block = canvas.getByKey(key);
      if (!block || block.name === 'air') continue;
      const { x, y, z } = canvas.parseKey(key);
      blockMap.set(key, { x, y, z, block });
      if (y < minY) minY = y;
    }

    // BFS-Startmenge: Alle Blöcke auf Fundamentebene (y <= 0 bzw. minimales Y)
    const queue = [];
    const visited = new Set();

    // Als Fundament gelten Blöcke bei y <= 0, oder falls das Gebäude höher beginnt, y <= minY + 1
    const groundThreshold = Math.min(0, minY);

    for (const [key, b] of blockMap.entries()) {
      if (b.y <= groundThreshold || b.y <= 0) {
        queue.push(key);
        visited.add(key);
      }
    }

    // Falls das Gebäude komplett oberhalb von y=0 beginnt (z. B. auf Sockel bei y=1):
    if (queue.length === 0 && blockMap.size > 0) {
      for (const [key, b] of blockMap.entries()) {
        if (b.y === minY) {
          queue.push(key);
          visited.add(key);
        }
      }
    }

    let head = 0;
    while (head < queue.length) {
      const currentKey = queue[head++];
      const current = blockMap.get(currentKey);
      if (!current) continue;

      const { x, y, z } = current;

      // 6 direkte Nachbarn
      const neighbors = [
        `${x + 1},${y},${z}`,
        `${x - 1},${y},${z}`,
        `${x},${y + 1},${z}`,
        `${x},${y - 1},${z}`,
        `${x},${y},${z + 1}`,
        `${x},${y},${z - 1}`,
        // Diagonale Dach- & Treppen-Verbindungen (Dachüberhänge und Steigungen)
        `${x + 1},${y + 1},${z}`,
        `${x - 1},${y + 1},${z}`,
        `${x},${y + 1},${z + 1}`,
        `${x},${y + 1},${z - 1}`,
        `${x + 1},${y - 1},${z}`,
        `${x - 1},${y - 1},${z}`,
        `${x},${y - 1},${z + 1}`,
        `${x},${y - 1},${z - 1}`,
        // Horizontale Diagonalecken
        `${x + 1},${y},${z + 1}`,
        `${x - 1},${y},${z + 1}`,
        `${x + 1},${y},${z - 1}`,
        `${x - 1},${y},${z - 1}`
      ];

      for (const nKey of neighbors) {
        if (blockMap.has(nKey) && !visited.has(nKey)) {
          visited.add(nKey);
          queue.push(nKey);
        }
      }
    }

    const floatingKeys = [];
    for (const key of blockMap.keys()) {
      if (!visited.has(key)) {
        floatingKeys.push(key);
      }
    }

    if (floatingKeys.length > 0) {
      const sample = floatingKeys.slice(0, 5).map(k => {
        const b = blockMap.get(k);
        return `${b.block.name}@(${k})`;
      }).join(', ');
      criticalErrors.push(
        `FloatingBlockError: ${floatingKeys.length} schwebende Blöcke ohne statische Bodenverbindung gefunden! Muster: [${sample}]`
      );
    }

    // Gravitations-Check für Sand/Kies/Amboss
    for (const [, b] of blockMap.entries()) {
      if (GRAVITY_BLOCKS.has(b.block.name)) {
        const belowKey = `${b.x},${b.y - 1},${b.z}`;
        const belowBlock = blockMap.get(belowKey);
        if (!belowBlock || belowBlock.block.name === 'air') {
          criticalErrors.push(
            `GravityBlockError: ${b.block.name} bei (${b.x},${b.y},${b.z}) schwebt über Luft und stürzt ab!`
          );
        }
      }
    }

    // 2. Eingangs- & Durchgangs-Prüfung (Door Clearance Check)
    let doorCount = 0;
    for (const [, b] of blockMap.entries()) {
      if (b.block.name.endsWith('_door')) {
        const props = b.block.properties || {};
        if (props.half === 'upper') continue; // Nur Unterteil prüfen

        doorCount++;
        const facing = props.facing || 'north';
        let fdx = 0;
        let fdz = -1;
        if (facing === 'south') { fdx = 0; fdz = 1; }
        else if (facing === 'east') { fdx = 1; fdz = 0; }
        else if (facing === 'west') { fdx = -1; fdz = 0; }

        // Vor der Tür (entlang facing)
        const frontLowerKey = `${b.x + fdx},${b.y},${b.z + fdz}`;
        const frontUpperKey = `${b.x + fdx},${b.y + 1},${b.z + fdz}`;
        // Hinter der Tür (entgegengesetzt facing)
        const backLowerKey = `${b.x - fdx},${b.y},${b.z - fdz}`;
        const backUpperKey = `${b.x - fdx},${b.y + 1},${b.z - fdz}`;

        const checkObstacle = (key, posName) => {
          const occ = blockMap.get(key);
          if (occ && !NON_BLOCKING_CLEARANCE.has(occ.block.name) &&
              !occ.block.name.endsWith('_carpet') &&
              !occ.block.name.includes('pressure_plate') &&
              !(occ.block.name.endsWith('_slab') && posName.includes('Fußhöhe'))) {
            criticalErrors.push(
              `DoorBlockedError: Tür bei (${b.x},${b.y},${b.z}) ist ${posName} durch '${occ.block.name}' bei (${key}) zugemauert.`
            );
          }
        };

        checkObstacle(frontLowerKey, 'davor (Fußhöhe)');
        checkObstacle(frontUpperKey, 'davor (Kopfhöhe)');
        checkObstacle(backLowerKey, 'dahinter (Fußhöhe)');
        checkObstacle(backUpperKey, 'dahinter (Kopfhöhe)');
      }
    }

    // 3. Ästhetik-Metriken (Anti-Cube-Check)
    let detailCount = 0;
    let totalCount = blockMap.size;

    for (const [, b] of blockMap.entries()) {
      if (StructuralLinter.isDetailBlock(b.block.name)) {
        detailCount++;
      }
    }

    const detailRatio = totalCount > 0 ? (detailCount / totalCount) : 0;
    if (totalCount > 40 && detailRatio < 0.15) {
      warnings.push(
        `AestheticWarning: Bauwerk besteht zu ${Math.round((1 - detailRatio) * 100)}% aus flachen Standardblöcken (Detail-Anteil nur ${Math.round(detailRatio * 100)}%). Füge Tiefenstaffelung, Dachüberhang, Fensterdetails und Textur-Mix hinzu!`
      );
    }

    // Zusätzliche Validierungsfehler aus dem Canvas übernehmen
    if (canvas.validationErrors && canvas.validationErrors.length > 0) {
      for (const err of canvas.validationErrors) {
        criticalErrors.push(`BlockValidationError: ${err}`);
      }
    }

    const asciiBlueprint = StructuralLinter.generateAsciiBlueprint(canvas);

    return {
      passed: criticalErrors.length === 0,
      criticalErrors,
      warnings,
      floatingBlocksCount: floatingKeys.length,
      doorCount,
      detailRatio,
      asciiBlueprint
    };
  }

  static generateAsciiBlueprint(canvas) {
    const bounds = canvas.getBounds();
    if (bounds.count === 0) return 'LEERES BAUWERK';

    const lines = [];
    lines.push(`=== BLUEPRINT: ${bounds.width}x${bounds.depth} Blöcke (Höhe: ${bounds.height}) ===`);

    // 1. Grundriss-Schnitt auf y = 1 (oder nächsthöhere Ebene mit Türen/Wänden)
    let cutY = 1;
    if (bounds.minY > cutY || bounds.maxY < cutY) {
      cutY = bounds.minY;
    }

    lines.push(`\n[GRUNDRISS AUF Y=${cutY}] (Norden oben = -Z, Osten rechts = +X)`);
    for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
      let row = '';
      for (let x = bounds.minX; x <= bounds.maxX; x++) {
        const b = canvas.get(x, cutY, z);
        if (!b || b.name === 'air') {
          // Prüfe, ob Boden darunter liegt
          const floor = canvas.get(x, cutY - 1, z);
          row += floor && floor.name !== 'air' ? '.' : ' ';
        } else if (b.name.endsWith('_door')) {
          row += '+';
        } else if (b.name.includes('pane') || b.name === 'glass') {
          row += '~';
        } else if (b.name.endsWith('_log') || b.name.includes('pillar')) {
          row += 'O';
        } else if (b.name.endsWith('_stairs')) {
          row += 'S';
        } else if (b.name.includes('torch') || b.name.includes('lantern')) {
          row += 'T';
        } else {
          row += '#';
        }
      }
      lines.push(row);
    }

    // 2. Vertikaler Querschnitt durch die Gebäudemitte (x = Math.floor((minX + maxX)/2))
    const midX = Math.floor((bounds.minX + bounds.maxX) / 2);
    lines.push(`\n[VERTIKALER QUERSCHNITT BEI X=${midX}] (Y von oben nach unten)`);
    for (let y = bounds.maxY; y >= bounds.minY; y--) {
      let row = String(y).padStart(3, ' ') + ' | ';
      for (let z = bounds.minZ; z <= bounds.maxZ; z++) {
        const b = canvas.get(midX, y, z);
        if (!b || b.name === 'air') {
          row += ' ';
        } else if (b.name.endsWith('_stairs') || b.name.endsWith('_slab')) {
          row += '^';
        } else if (b.name.endsWith('_door')) {
          row += '+';
        } else if (b.name.includes('pane') || b.name === 'glass') {
          row += '~';
        } else if (b.name.includes('planks') || b.name.includes('log')) {
          row += '=';
        } else {
          row += '#';
        }
      }
      lines.push(row);
    }

    // 3. Stückliste (Bill of Materials)
    const counts = {};
    for (const key of canvas.getAllBlockKeys()) {
      const b = canvas.getByKey(key);
      if (b && b.name !== 'air') {
        counts[b.name] = (counts[b.name] || 0) + 1;
      }
    }

    const sortedMaterials = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    lines.push('\n[STÜCKLISTE (BILL OF MATERIALS)]');
    for (const [mat, count] of sortedMaterials.slice(0, 12)) {
      lines.push(`  - ${mat.padEnd(28, ' ')} : ${count}x`);
    }
    if (sortedMaterials.length > 12) {
      lines.push(`  - ... und ${sortedMaterials.length - 12} weitere Material-Typen.`);
    }

    return lines.join('\n');
  }

  /**
   * Semantische Strukturanalyse für das LLM (Raum-, Material- & Zonen-Erkennung)
   * Ermöglicht es der KI, importierte Schematics architektonisch zu "verstehen".
   */
  static analyzeSemantics(canvas) {
    const bounds = canvas.getBounds();
    if (bounds.count === 0) {
      return {
        bounds,
        formattedSummary: 'Kein Bauwerk im Speicher geladen (leere Canvas).'
      };
    }

    const counts = {};
    const yDistribution = {};
    const doors = [];
    let windowsCount = 0;
    let lightsCount = 0;

    for (const key of canvas.getAllBlockKeys()) {
      const b = canvas.getByKey(key);
      if (!b || !b.name || b.name === 'air') continue;
      const { x, y, z } = canvas.parseKey(key);

      counts[b.name] = (counts[b.name] || 0) + 1;
      yDistribution[y] = (yDistribution[y] || 0) + 1;

      if (b.name.endsWith('_door')) {
        const props = b.properties || {};
        if (props.half !== 'upper') {
          doors.push({ x, y, z, name: b.name, facing: props.facing || 'unbekannt' });
        }
      } else if (b.name.includes('glass') || b.name.includes('pane')) {
        windowsCount++;
      } else if (b.name.includes('torch') || b.name.includes('lantern') || b.name === 'glowstone' || b.name.includes('lamp')) {
        lightsCount++;
      }
    }

    const totalBlocks = bounds.count;
    const sortedMaterials = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        name,
        count,
        percent: Math.round((count / totalBlocks) * 100)
      }));

    // Erkennung von Dach-Zone (oberste Y-Ebenen mit Treppen/Stufen/Spitz zulaufend)
    let roofStartY = Math.floor(bounds.minY + bounds.height * 0.6);
    const roofMaterials = new Set();
    for (let y = roofStartY; y <= bounds.maxY; y++) {
      for (const key of canvas.getAllBlockKeys()) {
        const { y: by } = canvas.parseKey(key);
        if (by === y) {
          const blk = canvas.getByKey(key);
          if (blk && blk.name) roofMaterials.add(blk.name);
        }
      }
    }

    const topMatStr = sortedMaterials
      .slice(0, 6)
      .map(m => `${m.name} (${m.percent}%, ${m.count}x)`)
      .join(', ');

    const doorsStr = doors.length > 0
      ? doors.map(d => `${d.name} bei (${d.x}, ${d.y}, ${d.z}, Blick: ${d.facing})`).join('; ')
      : 'Keine Außentüren auf Bodenebene erkannt';

    const formattedSummary = `
Architektonische Baukörper-Analyse:
- Gesamtabmessungen: Breite (X): ${bounds.width}, Höhe (Y): ${bounds.height}, Tiefe (Z): ${bounds.depth}
- Bounding-Box: X[${bounds.minX}..${bounds.maxX}], Y[${bounds.minY}..${bounds.maxY}], Z[${bounds.minZ}..${bounds.maxZ}]
- Gesamtblöcke: ${totalBlocks} Voxel
- Hauptmaterialien: ${topMatStr}
- Dachzone (ab Y=${roofStartY} bis Y=${bounds.maxY}): ${Array.from(roofMaterials).slice(0, 5).join(', ') || 'Flachdach/Solide'}
- Eingänge & Türen: ${doorsStr}
- Fenster & Glasflächen: ${windowsCount} Blöcke
- Beleuchtung: ${lightsCount} Lichtquellen (Fackeln/Laternen)
`.trim();

    return {
      bounds,
      totalBlocks,
      sortedMaterials,
      doors,
      windowsCount,
      lightsCount,
      roofStartY,
      formattedSummary
    };
  }
}
