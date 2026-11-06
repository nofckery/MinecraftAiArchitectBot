/**
 * Prozedurale Raum- und Fundament-Generatoren (RoomGenerators)
 */

export function foundation(canvas, x1, z1, x2, z2, height = 1, palette = 'stone_bricks', terrainMap = null) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);

  // Hauptsockel von y = 0 bis height - 1
  for (let y = 0; y < height; y++) {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        canvas.set(x, y, z, palette);
      }
    }
  }

  // Hangabstützung nach unten (y < 0) bis auf das Terrain
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const isEdge = (x === minX || x === maxX || z === minZ || z === maxZ);
      let targetGroundY = 0;

      if (typeof terrainMap === 'function') {
        targetGroundY = terrainMap(x, z);
      } else if (terrainMap && typeof terrainMap === 'object') {
        targetGroundY = terrainMap[`${x},${z}`] ?? 0;
      }

      // Stütze bis zum Terrain herunterziehen
      if (targetGroundY < 0 && isEdge) {
        for (let y = -1; y >= targetGroundY; y--) {
          canvas.set(x, y, z, palette);
        }
      }
    }
  }
}

export function framedRoom(canvas, x1, y1, z1, x2, y2, z2, opts = {}) {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  const minZ = Math.min(z1, z2);
  const maxZ = Math.max(z1, z2);

  const pillarBlock = opts.pillarBlock || 'spruce_log[axis=y]';
  const wallPalette = opts.wallPalette || 'white_terracotta';
  const floorPalette = opts.floorPalette || 'oak_planks';
  const ceilingPalette = opts.ceilingPalette || opts.floorPalette || 'spruce_planks';
  const beamBlockX = opts.beamBlockX || 'spruce_log[axis=x]';
  const beamBlockZ = opts.beamBlockZ || 'spruce_log[axis=z]';
  const bracketStair = opts.bracketStairs || 'spruce_stairs';
  const inset = opts.inset ?? 1;

  // 1. Boden & Decke
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      canvas.set(x, minY, z, floorPalette);
      canvas.set(x, maxY, z, ceilingPalette);
    }
  }

  // 2. Horizontale Rahmenbalken oben und unten
  for (let x = minX; x <= maxX; x++) {
    canvas.set(x, minY, minZ, beamBlockX);
    canvas.set(x, minY, maxZ, beamBlockX);
    canvas.set(x, maxY, minZ, beamBlockX);
    canvas.set(x, maxY, maxZ, beamBlockX);
  }
  for (let z = minZ; z <= maxZ; z++) {
    canvas.set(minX, minY, z, beamBlockZ);
    canvas.set(maxX, minY, z, beamBlockZ);
    canvas.set(minX, maxY, z, beamBlockZ);
    canvas.set(maxX, maxY, z, beamBlockZ);
  }

  // 3. Eckpfeiler und Zwischenpfeiler (alle 3-4 Blöcke)
  const pillarX = [minX, maxX];
  const dx = maxX - minX;
  if (dx >= 7) {
    const mid = Math.round((minX + maxX) / 2);
    pillarX.push(mid);
  }
  const pillarZ = [minZ, maxZ];
  const dz = maxZ - minZ;
  if (dz >= 7) {
    const mid = Math.round((minZ + maxZ) / 2);
    pillarZ.push(mid);
  }

  for (const px of pillarX) {
    for (const pz of [minZ, maxZ]) {
      for (let y = minY; y <= maxY; y++) {
        canvas.set(px, y, pz, pillarBlock);
      }
    }
  }
  for (const pz of pillarZ) {
    for (const px of [minX, maxX]) {
      for (let y = minY; y <= maxY; y++) {
        canvas.set(px, y, pz, pillarBlock);
      }
    }
  }

  // 4. Wandflächen (bei inset=1 um 1 Block nach innen versetzt für Plastizität)
  const wallMinX = inset === 1 ? minX + 1 : minX;
  const wallMaxX = inset === 1 ? maxX - 1 : maxX;
  const wallMinZ = inset === 1 ? minZ + 1 : minZ;
  const wallMaxZ = inset === 1 ? maxZ - 1 : maxZ;

  for (let y = minY + 1; y < maxY; y++) {
    // Nord- und Südwand
    for (let x = wallMinX; x <= wallMaxX; x++) {
      if (!canvas.has(x, y, wallMinZ)) {
        canvas.set(x, y, wallMinZ, wallPalette);
      }
      if (!canvas.has(x, y, wallMaxZ)) {
        canvas.set(x, y, wallMaxZ, wallPalette);
      }
    }
    // West- und Ostwand
    for (let z = wallMinZ; z <= wallMaxZ; z++) {
      if (!canvas.has(wallMinX, y, z)) {
        canvas.set(wallMinX, y, z, wallPalette);
      }
      if (!canvas.has(wallMaxX, y, z)) {
        canvas.set(wallMaxX, y, z, wallPalette);
      }
    }
  }

  // 5. Äußere Stützstreben an Pfeilerköpfen und -füßen
  if (bracketStair && inset === 1) {
    // An Pfeilerköpfen invertierte Treppen nach außen
    for (const px of pillarX) {
      if (px > minX && px < maxX) {
        canvas.set(px, maxY - 1, minZ, `${bracketStair}[facing=north,half=top]`);
        canvas.set(px, maxY - 1, maxZ, `${bracketStair}[facing=south,half=top]`);
      }
    }
  }
}

export function jettyFloor(canvas, x1, y1, z1, x2, y2, z2, opts = {}) {
  const overhang = opts.overhang ?? 1;
  const bracketStair = opts.bracketStairs || 'spruce_stairs';
  const fenceBlock = opts.fenceBlock || 'dark_oak_fence';

  const jx1 = Math.min(x1, x2) - overhang;
  const jx2 = Math.max(x1, x2) + overhang;
  const jz1 = Math.min(z1, z2) - overhang;
  const jz2 = Math.max(z1, z2) + overhang;
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);

  // 1. Unterseitige Kragträger & Stützkonsolen bei y = minY - 1
  const supportY = minY - 1;
  if (supportY >= 0) {
    // Nord-Kante
    for (let x = jx1; x <= jx2; x++) {
      canvas.set(x, supportY, jz1, `${bracketStair}[facing=north,half=top]`);
    }
    // Süd-Kante
    for (let x = jx1; x <= jx2; x++) {
      canvas.set(x, supportY, jz2, `${bracketStair}[facing=south,half=top]`);
    }
    // West-Kante
    for (let z = jz1; z <= jz2; z++) {
      canvas.set(jx1, supportY, z, `${bracketStair}[facing=west,half=top]`);
    }
    // Ost-Kante
    for (let z = jz1; z <= jz2; z++) {
      canvas.set(jx2, supportY, z, `${bracketStair}[facing=east,half=top]`);
    }

    // Eckstützen aus Zäunen
    if (supportY - 1 >= 0) {
      canvas.set(jx1, supportY - 1, jz1, fenceBlock);
      canvas.set(jx2, supportY - 1, jz1, fenceBlock);
      canvas.set(jx1, supportY - 1, jz2, fenceBlock);
      canvas.set(jx2, supportY - 1, jz2, fenceBlock);
    }
  }

  // 2. Erweiterten Raum auf dem vorkragenden Fußabdruck bauen
  framedRoom(canvas, jx1, minY, jz1, jx2, maxY, jz2, opts);
}
