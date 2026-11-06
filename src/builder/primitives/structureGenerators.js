/**
 * Prozedurale Struktur-Generatoren (StructureGenerators)
 */

import { DIRECTION_VECTORS } from '../stateTransform.js';

export function cylindricalTower(canvas, cx, y1, cz, radius, height, opts = {}) {
  const wallPalette = opts.wallPalette || 'stone_bricks';
  const centerPillar = opts.centerPillar || 'spruce_log[axis=y]';
  const stairBlock = opts.stairBlock || 'stone_brick_stairs';
  const slabBlock = opts.slabBlock || 'stone_brick_slab';
  const battlementFence = opts.battlementFence || 'spruce_fence';

  const minY = Math.min(y1, y1 + height - 1);
  const maxY = Math.max(y1, y1 + height - 1);

  // 1. Hohler Zylinder für die Turmmauer
  canvas.cylinder(cx, minY, cz, radius, height, wallPalette, true);

  // 2. Zentrale Wendeltreppen-Säule
  for (let y = minY; y <= maxY; y++) {
    canvas.set(cx, y, cz, centerPillar);
  }

  // 3. Spiralförmige Wendeltreppe
  const spiralRadius = Math.max(1, radius - 1);
  for (let y = minY; y <= maxY; y++) {
    const angle = (y - minY) * (Math.PI / 2.5);
    const stepX = Math.round(cx + Math.cos(angle) * spiralRadius);
    const stepZ = Math.round(cz + Math.sin(angle) * spiralRadius);
    canvas.set(stepX, y, stepZ, slabBlock);
  }

  // 4. Stützstreben (Buttresses) an den 4 Himmelsrichtungen
  const buttressDist = radius + 1;
  const cardinals = [
    { x: cx, z: cz - buttressDist, stairFacing: 'south' },
    { x: cx, z: cz + buttressDist, stairFacing: 'north' },
    { x: cx - buttressDist, z: cz, stairFacing: 'east' },
    { x: cx + buttressDist, z: cz, stairFacing: 'west' }
  ];

  const buttressHeight = Math.floor(height * 0.6);
  for (const b of cardinals) {
    for (let y = minY; y < minY + buttressHeight; y++) {
      canvas.set(b.x, y, b.z, wallPalette);
    }
    // Abschrägung oben
    canvas.set(b.x, minY + buttressHeight, b.z, `${stairBlock}[facing=${b.stairFacing},half=bottom]`);
  }

  // 5. Zinnenkranz (Battlements mit crenellations: true)
  const topY = maxY + 1;
  const rSq = (radius + 0.5) * (radius + 0.5);
  const innerRSq = (radius - 0.5) * (radius - 0.5);

  let battlementCounter = 0;
  for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
    for (let dz = -Math.ceil(radius); dz <= Math.ceil(radius); dz++) {
      const distSq = dx * dx + dz * dz;
      if (distSq >= innerRSq && distSq <= rSq) {
        battlementCounter++;
        if (battlementCounter % 2 === 0) {
          canvas.set(cx + dx, topY, cz + dz, wallPalette);
        } else {
          canvas.set(cx + dx, topY, cz + dz, battlementFence);
        }
      }
    }
  }
}

export function windowWithDetail(canvas, x, y, z, w = 1, h = 2, facing = 'north', opts = {}) {
  const glassBlock = opts.glassBlock || 'glass_pane';
  const trapdoorBlock = opts.trapdoorBlock || 'spruce_trapdoor';
  const stairBlock = opts.stairBlock || 'spruce_stairs';
  const flower = opts.flower || 'poppy';

  const fVec = DIRECTION_VECTORS[facing] || { x: 0, z: -1 };
  const isNorthSouth = facing === 'north' || facing === 'south';

  for (let dy = 0; dy < h; dy++) {
    for (let dw = 0; dw < w; dw++) {
      const wx = isNorthSouth ? x + dw : x;
      const wy = y + dy;
      const wz = isNorthSouth ? z : z + dw;

      // Glas einsetzen
      canvas.set(wx, wy, wz, glassBlock);
    }
  }

  // Äußerer Fenstersturz (Invertierte Treppe über dem Fenster)
  const lintelY = y + h;
  for (let dw = 0; dw < w; dw++) {
    const lx = isNorthSouth ? x + dw : x;
    const lz = isNorthSouth ? z : z + dw;
    canvas.set(lx, lintelY, lz, `${stairBlock}[facing=${facing},half=top]`);
  }

  // Blumenbrett unter dem Fenster (außen)
  const sillY = y - 1;
  for (let dw = 0; dw < w; dw++) {
    const sx = isNorthSouth ? x + dw : x + fVec.x;
    const sz = isNorthSouth ? z + fVec.z : z + dw;

    canvas.set(sx, sillY, sz, 'grass_block');
    canvas.set(sx, sillY + 1, sz, flower);
    // Umrahmende Falltür
    canvas.set(sx + fVec.x, sillY, sz + fVec.z, `${trapdoorBlock}[facing=${facing},open=true]`);
  }

  // Fensterläden links und rechts
  if (isNorthSouth) {
    for (let dy = 0; dy < h; dy++) {
      canvas.set(x - 1, y + dy, z, `${trapdoorBlock}[facing=west,open=true]`);
      canvas.set(x + w, y + dy, z, `${trapdoorBlock}[facing=east,open=true]`);
    }
  } else {
    for (let dy = 0; dy < h; dy++) {
      canvas.set(x, y + dy, z - 1, `${trapdoorBlock}[facing=north,open=true]`);
      canvas.set(x, y + dy, z + w, `${trapdoorBlock}[facing=south,open=true]`);
    }
  }
}

export function doorway(canvas, x, y, z, facing = 'north', opts = {}) {
  const doorBlock = opts.doorBlock || 'oak_door';
  const stairBlock = opts.stairBlock || 'stone_brick_stairs';
  const pillarBlock = opts.pillarBlock || 'stone_bricks';
  const stepBlock = opts.stepBlock || 'stone_brick_slab';
  const doubleDoor = opts.doubleDoor || false;

  const fVec = DIRECTION_VECTORS[facing] || { x: 0, z: -1 };
  const isNorthSouth = facing === 'north' || facing === 'south';

  // 1. Tür-Öffnung freischneiden und Tür setzen
  canvas.set(x, y, z, `${doorBlock}[facing=${facing},half=lower,hinge=left,open=false]`);
  canvas.set(x, y + 1, z, `${doorBlock}[facing=${facing},half=upper,hinge=left,open=false]`);

  // Durchgang dahinter freihalten (in Gegenrichtung des facing)
  canvas.set(x - fVec.x, y, z - fVec.z, 'air');
  canvas.set(x - fVec.x, y + 1, z - fVec.z, 'air');

  // Durchgang davor auf Kopfhöhe freihalten
  canvas.set(x + fVec.x, y + 1, z + fVec.z, 'air');

  if (doubleDoor) {
    const dx = isNorthSouth ? 1 : 0;
    const dz = isNorthSouth ? 0 : 1;
    canvas.set(x + dx, y, z + dz, `${doorBlock}[facing=${facing},half=lower,hinge=right,open=false]`);
    canvas.set(x + dx, y + 1, z + dz, `${doorBlock}[facing=${facing},half=upper,hinge=right,open=false]`);
    canvas.set(x + dx - fVec.x, y, z + dz - fVec.z, 'air');
    canvas.set(x + dx - fVec.x, y + 1, z + dz - fVec.z, 'air');
    canvas.set(x + dx + fVec.x, y + 1, z + dz + fVec.z, 'air');
  }

  // 2. Eingangs-Stufe davor
  const stepX = x + fVec.x;
  const stepZ = z + fVec.z;
  canvas.set(stepX, y, stepZ, stepBlock);
  if (doubleDoor) {
    const dx = isNorthSouth ? 1 : 0;
    const dz = isNorthSouth ? 0 : 1;
    canvas.set(stepX + dx, y, stepZ + dz, stepBlock);
  }

  // 3. Portalsäulen links und rechts
  const leftX = isNorthSouth ? x - 1 : x;
  const leftZ = isNorthSouth ? z : z - 1;
  const rightX = isNorthSouth ? (doubleDoor ? x + 2 : x + 1) : x;
  const rightZ = isNorthSouth ? z : (doubleDoor ? z + 2 : z + 1);

  for (let py = y; py <= y + 1; py++) {
    canvas.set(leftX, py, leftZ, pillarBlock);
    canvas.set(rightX, py, rightZ, pillarBlock);
  }

  // 4. Überbogen mit Treppen
  canvas.set(leftX, y + 2, leftZ, `${stairBlock}[facing=${facing},half=top]`);
  canvas.set(rightX, y + 2, rightZ, `${stairBlock}[facing=${facing},half=top]`);
  canvas.set(x, y + 2, z, pillarBlock);
  if (doubleDoor) {
    const dx = isNorthSouth ? 1 : 0;
    const dz = isNorthSouth ? 0 : 1;
    canvas.set(x + dx, y + 2, z + dz, pillarBlock);
  }

  // 5. Hängende Laterne über dem Sturz
  const lanternX = x + fVec.x;
  const lanternZ = z + fVec.z;
  canvas.set(lanternX, y + 2, lanternZ, 'lantern[hanging=true]');
}

export function chimney(canvas, x, yStart, z, yEnd, brickPalette = 'bricks') {
  const brick = typeof brickPalette === 'string' ? brickPalette : 'bricks';
  const stair = brick.includes('stone') ? 'stone_brick_stairs' : 'brick_stairs';
  const slab = brick.includes('stone') ? 'stone_brick_slab' : 'brick_slab';

  // 1. Unterer Kamin (Feuerstelle) bei yStart
  canvas.set(x, yStart, z, 'campfire[lit=true]');
  canvas.set(x, yStart, z - 1, brick);
  canvas.set(x - 1, yStart, z, brick);
  canvas.set(x + 1, yStart, z, brick);
  canvas.set(x, yStart, z + 1, 'iron_bars'); // Funkenfang vorne

  // Feuerraum-Überdachung
  canvas.set(x - 1, yStart + 1, z, `${stair}[facing=east,half=bottom]`);
  canvas.set(x + 1, yStart + 1, z, `${stair}[facing=west,half=bottom]`);
  canvas.set(x, yStart + 1, z - 1, brick);
  canvas.set(x, yStart + 1, z, 'air'); // Abzugsschacht

  // 2. Steigender Schornsteinschaft bis yEnd
  for (let y = yStart + 2; y <= yEnd; y++) {
    canvas.set(x + 1, y, z, brick);
    canvas.set(x - 1, y, z, brick);
    canvas.set(x, y, z + 1, brick);
    canvas.set(x, y, z - 1, brick);
    canvas.set(x, y, z, 'air');
  }

  // 3. Schornsteinkrone mit zweitem Campfire für sichtbaren Rauch
  canvas.set(x, yEnd, z, 'campfire[lit=true]');
  canvas.set(x, yEnd + 1, z, 'spruce_trapdoor[half=bottom]');
  canvas.set(x + 1, yEnd + 1, z, slab);
  canvas.set(x - 1, yEnd + 1, z, slab);
  canvas.set(x, yEnd + 1, z + 1, slab);
  canvas.set(x, yEnd + 1, z - 1, slab);
}
