/**
 * Prozedurale Dach-Generatoren (RoofGenerators)
 */

export function gableRoof(canvas, x1, y, z1, x2, z2, opts = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);

  const stairBlock = opts.stairBlock || 'spruce_stairs';
  const trimStairBlock = opts.trimStairBlock || 'stone_brick_stairs';
  const ridgeSlabBlock = opts.ridgeSlabBlock || 'stone_brick_slab';
  const gablePalette = opts.gablePalette || 'white_terracotta';
  const gableLogBlock = opts.gableLogBlock || 'spruce_log[axis=y]';

  // Bestimme Dachachse: First verläuft entlang der längeren Seite (Standard: X)
  const axis = opts.axis || ((maxX - minX) >= (maxZ - minZ) ? 'x' : 'z');

  if (axis === 'x') {
    // First verläuft entlang X, Steigung von Nord (-Z) und Süd (+Z) zur Mitte
    const overhangX = 1; // Ortgang
    const overhangZ = 1; // Traufe
    const rMinX = minX - overhangX;
    const rMaxX = maxX + overhangX;
    const rMinZ = minZ - overhangZ;
    const rMaxZ = maxZ + overhangZ;

    const span = rMaxZ - rMinZ;
    const halfSpan = Math.floor(span / 2);

    let curY = y;
    for (let step = 0; step <= halfSpan; step++) {
      const curZNorth = rMinZ + step;
      const curZSouth = rMaxZ - step;

      for (let x = rMinX; x <= rMaxX; x++) {
        const isTrim = (x === rMinX || x === rMaxX);
        const activeStair = isTrim ? trimStairBlock : stairBlock;

        if (curZNorth < curZSouth) {
          canvas.set(x, curY, curZNorth, `${activeStair}[facing=south,half=bottom]`);
          canvas.set(x, curY, curZSouth, `${activeStair}[facing=north,half=bottom]`);

          // Invertierte Treppen unter dem Trauf-Überhang (bei step === 0)
          if (step === 0) {
            canvas.set(x, curY - 1, curZNorth, `${activeStair}[facing=north,half=top]`);
            canvas.set(x, curY - 1, curZSouth, `${activeStair}[facing=south,half=top]`);
          }
        } else if (curZNorth === curZSouth) {
          // First-Krone bei ungerader Breite
          canvas.set(x, curY, curZNorth, ridgeSlabBlock);
        }
      }

      // Giebeldreieck an Front (minX) und Rückseite (maxX) ausfüllen
      for (let z = curZNorth + 1; z < curZSouth; z++) {
        canvas.set(minX, curY, z, gablePalette);
        canvas.set(maxX, curY, z, gablePalette);
      }

      curY++;
    }

    // Bei gerader Breite First-Abschluss zwischen den beiden obersten Stufen
    if (span % 2 === 1) {
      const midZ1 = rMinZ + halfSpan;
      const midZ2 = midZ1 + 1;
      for (let x = rMinX; x <= rMaxX; x++) {
        canvas.set(x, curY - 1, midZ1, ridgeSlabBlock);
        canvas.set(x, curY - 1, midZ2, ridgeSlabBlock);
      }
    }

    // Vertikale Fachwerk-Giebelbalken in der Giebelmitte
    const centerZ = Math.floor((minZ + maxZ) / 2);
    for (let gy = y; gy < curY; gy++) {
      canvas.set(minX, gy, centerZ, gableLogBlock);
      canvas.set(maxX, gy, centerZ, gableLogBlock);
    }

  } else {
    // First verläuft entlang Z, Steigung von West (-X) und Ost (+X) zur Mitte
    const overhangX = 1;
    const overhangZ = 1;
    const rMinX = minX - overhangX;
    const rMaxX = maxX + overhangX;
    const rMinZ = minZ - overhangZ;
    const rMaxZ = maxZ + overhangZ;

    const span = rMaxX - rMinX;
    const halfSpan = Math.floor(span / 2);

    let curY = y;
    for (let step = 0; step <= halfSpan; step++) {
      const curXWest = rMinX + step;
      const curXEast = rMaxX - step;

      for (let z = rMinZ; z <= rMaxZ; z++) {
        const isTrim = (z === rMinZ || z === rMaxZ);
        const activeStair = isTrim ? trimStairBlock : stairBlock;

        if (curXWest < curXEast) {
          canvas.set(curXWest, curY, z, `${activeStair}[facing=east,half=bottom]`);
          canvas.set(curXEast, curY, z, `${activeStair}[facing=west,half=bottom]`);

          if (step === 0) {
            canvas.set(curXWest, curY - 1, z, `${activeStair}[facing=west,half=top]`);
            canvas.set(curXEast, curY - 1, z, `${activeStair}[facing=east,half=top]`);
          }
        } else if (curXWest === curXEast) {
          canvas.set(curXWest, curY, z, ridgeSlabBlock);
        }
      }

      // Giebeldreieck an Stirnseiten ausfüllen
      for (let x = curXWest + 1; x < curXEast; x++) {
        canvas.set(x, curY, minZ, gablePalette);
        canvas.set(x, curY, maxZ, gablePalette);
      }

      curY++;
    }

    if (span % 2 === 1) {
      const midX1 = rMinX + halfSpan;
      const midX2 = midX1 + 1;
      for (let z = rMinZ; z <= rMaxZ; z++) {
        canvas.set(midX1, curY - 1, z, ridgeSlabBlock);
        canvas.set(midX2, curY - 1, z, ridgeSlabBlock);
      }
    }

    const centerX = Math.floor((minX + maxX) / 2);
    for (let gy = y; gy < curY; gy++) {
      canvas.set(centerX, gy, minZ, gableLogBlock);
      canvas.set(centerX, gy, maxZ, gableLogBlock);
    }
  }
}

export function hipRoof(canvas, x1, y, z1, x2, z2, opts = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);

  const stairBlock = opts.stairBlock || 'spruce_stairs';
  const ridgeSlabBlock = opts.ridgeSlabBlock || 'spruce_slab';

  let rMinX = minX - 1;
  let rMaxX = maxX + 1;
  let rMinZ = minZ - 1;
  let rMaxZ = maxZ + 1;
  let curY = y;

  while (rMinX <= rMaxX && rMinZ <= rMaxZ) {
    if (rMinX === rMaxX || rMinZ === rMaxZ) {
      // First-Linie oder zentraler First-Block
      for (let x = rMinX; x <= rMaxX; x++) {
        for (let z = rMinZ; z <= rMaxZ; z++) {
          canvas.set(x, curY, z, ridgeSlabBlock);
        }
      }
      break;
    }

    // Kanten mit Treppen belegen
    for (let x = rMinX; x <= rMaxX; x++) {
      canvas.set(x, curY, rMinZ, `${stairBlock}[facing=south,half=bottom]`);
      canvas.set(x, curY, rMaxZ, `${stairBlock}[facing=north,half=bottom]`);
    }
    for (let z = rMinZ; z <= rMaxZ; z++) {
      canvas.set(rMinX, curY, z, `${stairBlock}[facing=east,half=bottom]`);
      canvas.set(rMaxX, curY, z, `${stairBlock}[facing=west,half=bottom]`);
    }

    // Traufüberhang-Stützen bei unterster Ebene
    if (curY === y) {
      for (let x = rMinX; x <= rMaxX; x++) {
        canvas.set(x, curY - 1, rMinZ, `${stairBlock}[facing=north,half=top]`);
        canvas.set(x, curY - 1, rMaxZ, `${stairBlock}[facing=south,half=top]`);
      }
      for (let z = rMinZ; z <= rMaxZ; z++) {
        canvas.set(rMinX, curY - 1, z, `${stairBlock}[facing=west,half=top]`);
        canvas.set(rMaxX, curY - 1, z, `${stairBlock}[facing=east,half=top]`);
      }
    }

    rMinX++;
    rMaxX--;
    rMinZ++;
    rMaxZ--;
    curY++;
  }
}

export function conicalTowerRoof(canvas, cx, y, cz, radius, height, opts = {}) {
  const stairBlock = opts.stairBlock || 'dark_oak_stairs';
  const slabBlock = opts.slabBlock || 'dark_oak_slab';
  const solidBlock = opts.solidBlock || 'dark_oak_planks';
  const wallBlock = opts.wallBlock || 'stone_brick_wall';
  const fenceBlock = opts.fenceBlock || 'spruce_fence';
  const tipBlock = opts.tipBlock || 'lightning_rod';

  let currentY = y;
  const rStart = radius + 0.5;

  for (let h = 0; h < height; h++) {
    const progress = h / height;
    const curR = Math.max(0.5, rStart * (1 - progress));
    const rSq = curR * curR;

    for (let dx = -Math.ceil(curR); dx <= Math.ceil(curR); dx++) {
      for (let dz = -Math.ceil(curR); dz <= Math.ceil(curR); dz++) {
        const dSq = dx * dx + dz * dz;
        if (dSq <= rSq) {
          const isEdge = dSq > (curR - 0.9) * (curR - 0.9);
          if (isEdge && curR > 1.2) {
            // Richtung bestimmen für Treppenausrichtung
            let facing = 'north';
            if (Math.abs(dx) > Math.abs(dz)) {
              facing = dx > 0 ? 'west' : 'east';
            } else {
              facing = dz > 0 ? 'north' : 'south';
            }
            canvas.set(cx + dx, currentY, cz + dz, `${stairBlock}[facing=${facing},half=bottom]`);
          } else if (curR <= 1.2) {
            canvas.set(cx + dx, currentY, cz + dz, slabBlock);
          } else {
            canvas.set(cx + dx, currentY, cz + dz, solidBlock);
          }
        }
      }
    }
    currentY++;
  }

  // Dachspitze (Mauer + Zaun + Blitzableiter)
  canvas.set(cx, currentY, cz, wallBlock);
  canvas.set(cx, currentY + 1, cz, fenceBlock);
  canvas.set(cx, currentY + 2, cz, tipBlock);
}
