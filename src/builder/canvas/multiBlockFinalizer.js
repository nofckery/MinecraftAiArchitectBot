/**
 * Automatische Vervollständigung von Multi-Blocks (Türen Obere Hälfte, Wandfackeln).
 */
export function finalizeMultiBlocks(canvas) {
  const keys = canvas.getAllBlockKeys();

  for (const key of keys) {
    const block = canvas.blocks.get(key);
    if (!block) continue;
    const { x, y, z } = canvas.parseKey(key);

    // 1. Automatische Türenvervollständigung (Door upper half)
    if (block.name.endsWith('_door')) {
      const props = block.properties || {};
      const half = props.half || 'lower';
      if (half === 'lower') {
        const upperKey = canvas.makeKey(x, y + 1, z);
        const upperBlock = canvas.blocks.get(upperKey);
        if (!upperBlock || !upperBlock.name.endsWith('_door')) {
          canvas.blocks.set(upperKey, {
            name: block.name,
            properties: {
              facing: props.facing || 'north',
              half: 'upper',
              hinge: props.hinge || 'left',
              open: props.open || 'false',
              powered: props.powered || 'false'
            }
          });
        }
      }
    }

    // 2. Wandfackeln (Wandprüfung, wenn kein solider Block darunter ist)
    if (block.name === 'torch' || block.name === 'soul_torch') {
      const isSoul = block.name.startsWith('soul_');
      const belowBlock = canvas.get(x, y - 1, z);
      const hasSolidFloor = belowBlock && !belowBlock.name.includes('air') &&
                            !belowBlock.name.includes('pane') &&
                            !belowBlock.name.includes('fence') &&
                            !belowBlock.name.includes('wall');

      if (!hasSolidFloor) {
        const neighbors = [
          { dir: 'north', checkX: x, checkZ: z - 1, faceAway: 'south' },
          { dir: 'south', checkX: x, checkZ: z + 1, faceAway: 'north' },
          { dir: 'west',  checkX: x - 1, checkZ: z, faceAway: 'east' },
          { dir: 'east',  checkX: x + 1, checkZ: z, faceAway: 'west' }
        ];

        let attached = false;
        for (const n of neighbors) {
          const wallBlock = canvas.get(n.checkX, y, n.checkZ);
          if (wallBlock && !wallBlock.name.includes('air') &&
              !wallBlock.name.includes('pane') &&
              !wallBlock.name.includes('slab')) {
            block.name = isSoul ? 'soul_wall_torch' : 'wall_torch';
            block.properties = { facing: n.faceAway };
            attached = true;
            break;
          }
        }

        if (!attached && !hasSolidFloor) {
          canvas.validationErrors.push(`Schwebende Fackel bei (${x},${y},${z}) ohne Stützwand oder Boden.`);
        }
      }
    }
  }
}
