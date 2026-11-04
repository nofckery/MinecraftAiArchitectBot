import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';

export class WorldScanner {
  static getCardinalFacingFromYaw(yaw) {
    // Mineflayer Yaw: 0 = South, PI/2 = West, PI = North, -PI/2 = East
    let angle = (yaw % (2 * Math.PI) + (2 * Math.PI)) % (2 * Math.PI);
    const deg = (angle * 180) / Math.PI;

    if (deg >= 315 || deg < 45) return 'south';
    if (deg >= 45 && deg < 135) return 'west';
    if (deg >= 135 && deg < 225) return 'north';
    return 'east';
  }

  static findWoolMarkers(bot, centerPos, radius = 32) {
    const markers = [];
    const minX = Math.floor(centerPos.x - radius);
    const maxX = Math.floor(centerPos.x + radius);
    const minY = Math.floor(centerPos.y - 10);
    const maxY = Math.floor(centerPos.y + 10);
    const minZ = Math.floor(centerPos.z - radius);
    const maxZ = Math.floor(centerPos.z + radius);

    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let y = minY; y <= maxY; y++) {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (b && b.name.endsWith('_wool')) {
            markers.push({ x, y, z, name: b.name });
          }
        }
      }
    }
    return markers;
  }

  static scanBuildSite(bot, ownerPlayer = null) {
    // 1. Spielerposition oder Bot-Position ermitteln
    let targetEntity = null;
    if (ownerPlayer && bot.players[ownerPlayer]?.entity) {
      targetEntity = bot.players[ownerPlayer].entity;
    } else {
      targetEntity = bot.entity;
    }

    const pos = targetEntity.position;
    const facing = WorldScanner.getCardinalFacingFromYaw(targetEntity.yaw);

    // 2. Suche nach Wolle-Markern
    const markers = WorldScanner.findWoolMarkers(bot, pos, 24);
    let origin = null;
    let width = 14;
    let depth = 14;
    let groundY = Math.floor(pos.y);

    if (markers.length >= 2) {
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let mMinY = Infinity;

      for (const m of markers) {
        if (m.x < minX) minX = m.x;
        if (m.x > maxX) maxX = m.x;
        if (m.z < minZ) minZ = m.z;
        if (m.z > maxZ) maxZ = m.z;
        if (m.y < mMinY) mMinY = m.y;
      }

      width = maxX - minX + 1;
      depth = maxZ - minZ + 1;
      groundY = mMinY;
      origin = { x: minX, y: groundY, z: minZ };
      logger.info(`Wolle-Marker erkannt! Baufläche: ${width}x${depth} Blöcke bei (${origin.x}, ${origin.y}, ${origin.z}).`);
    } else {
      // Standard: 14x14 Grundstück 3 Blöcke vor dem Spieler
      let ox = Math.floor(pos.x);
      let oz = Math.floor(pos.z);

      if (facing === 'north') {
        oz = oz - depth - 2;
        ox = ox - Math.floor(width / 2);
      } else if (facing === 'south') {
        oz = oz + 3;
        ox = ox - Math.floor(width / 2);
      } else if (facing === 'west') {
        ox = ox - width - 2;
        oz = oz - Math.floor(depth / 2);
      } else {
        ox = ox + 3;
        oz = oz - Math.floor(depth / 2);
      }

      origin = { x: ox, y: groundY, z: oz };
      logger.info(`Keine Marker gefunden. Nutze Standard-Grundstück ${width}x${depth} vor dem Spieler (${facing}).`);
    }

    // 3. Terrain-Höhenkarte scannen
    const terrainMap = {};
    for (let x = origin.x; x < origin.x + width; x++) {
      for (let z = origin.z; z < origin.z + depth; z++) {
        let foundY = groundY;
        for (let y = groundY + 5; y >= groundY - 12; y--) {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (b && !b.name.includes('air') && !b.name.includes('leaves') && !b.name.includes('log')) {
            foundY = y;
            break;
          }
        }
        terrainMap[`${x},${z}`] = foundY - groundY;
      }
    }

    // 4. Nachbarschafts-Paletten scannen
    const neighborhoodCounts = {};
    const sampleRadius = 16;
    for (let dx = -sampleRadius; dx <= sampleRadius; dx += 2) {
      for (let dz = -sampleRadius; dz <= sampleRadius; dz += 2) {
        for (let dy = -4; dy <= 8; dy += 2) {
          const b = bot.blockAt(new Vec3(origin.x + dx, origin.y + dy, origin.z + dz));
          if (b && !b.name.includes('air') && !b.name.includes('grass_block') && !b.name.includes('dirt')) {
            neighborhoodCounts[b.name] = (neighborhoodCounts[b.name] || 0) + 1;
          }
        }
      }
    }

    const topMaterials = Object.entries(neighborhoodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    return {
      origin,
      width,
      depth,
      height: 36,
      facing,
      groundY,
      terrainMap,
      neighborhoodPalette: topMaterials
    };
  }
}

export const worldScanner = WorldScanner;

