/**
 * 3D Greedy Meshing Engine (/fill Command Volume Compression)
 * Aggregiert benachbarte identische Voxel entlang X, dann Z, dann Y zu minimalen Quadern.
 */

export function toBlockString(blockStateObj) {
  if (!blockStateObj || !blockStateObj.name || blockStateObj.name === 'air') {
    return 'air';
  }
  const props = blockStateObj.properties || {};
  const keys = Object.keys(props).sort();
  if (keys.length === 0) {
    return blockStateObj.name;
  }
  const propStr = keys.map(k => `${k}=${props[k]}`).join(',');
  return `${blockStateObj.name}[${propStr}]`;
}

/**
 * Berechnet minimale Bounding Boxes für Greedy-Meshing.
 * Unterstützt statischen Aufruf mit Blockliste oder Instanz-Aufruf mit Canvas.
 */
export function computeGreedyBoxes(phaseBlocks = null, canvasInstance = null) {
  let blockList = phaseBlocks;
  if (!blockList && canvasInstance) {
    blockList = Array.from(canvasInstance.blocks.entries()).map(([key, blockState]) => {
      const { x, y, z } = canvasInstance.parseKey(key);
      return { x, y, z, blockState, fullBlockString: toBlockString(blockState) };
    });
  }

  if (!blockList || blockList.length === 0) return [];

  // Erstelle ein schnelles 3D-Lookup-Grid
  const grid = new Map();
  for (const b of blockList) {
    const k = `${b.x},${b.y},${b.z}`;
    grid.set(k, { ...b, visited: false });
  }

  const boxes = [];

  // Sortiere nach y, z, x ohne das Original-Array zu mutieren
  const sortedList = [...blockList].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

  for (const start of sortedList) {
    const startNode = grid.get(`${start.x},${start.y},${start.z}`);
    if (!startNode || startNode.visited) continue;

    const targetString = start.fullBlockString;
    const x1 = start.x;
    const y1 = start.y;
    const z1 = start.z;

    // 1. Expandiere maximal entlang +X
    let x2 = x1;
    while (true) {
      const nextNode = grid.get(`${x2 + 1},${y1},${z1}`);
      if (nextNode && !nextNode.visited && nextNode.fullBlockString === targetString) {
        x2++;
      } else {
        break;
      }
    }

    // 2. Expandiere entlang +Z für die gesamte Zeile [x1..x2]
    let z2 = z1;
    expandZ: while (true) {
      const testZ = z2 + 1;
      for (let tx = x1; tx <= x2; tx++) {
        const node = grid.get(`${tx},${y1},${testZ}`);
        if (!node || node.visited || node.fullBlockString !== targetString) {
          break expandZ;
        }
      }
      z2 = testZ;
    }

    // 3. Expandiere entlang +Y für die gesamte Ebene [x1..x2] x [z1..z2]
    let y2 = y1;
    expandY: while (true) {
      const testY = y2 + 1;
      for (let tx = x1; tx <= x2; tx++) {
        for (let tz = z1; tz <= z2; tz++) {
          const node = grid.get(`${tx},${testY},${tz}`);
          if (!node || node.visited || node.fullBlockString !== targetString) {
            break expandY;
          }
        }
      }
      y2 = testY;
    }

    // Markiere alle Blöcke im Quader als visited
    for (let tx = x1; tx <= x2; tx++) {
      for (let ty = y1; ty <= y2; ty++) {
        for (let tz = z1; tz <= z2; tz++) {
          const n = grid.get(`${tx},${ty},${tz}`);
          if (n) n.visited = true;
        }
      }
    }

    boxes.push({
      minX: x1,
      minY: y1,
      minZ: z1,
      maxX: x2,
      maxY: y2,
      maxZ: z2,
      blockState: start.blockState,
      fullBlockString: targetString,
      volume: (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1)
    });
  }

  return boxes;
}
