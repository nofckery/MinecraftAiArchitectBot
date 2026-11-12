import { Vec3 } from 'vec3';
import { logger } from '../../utils/logger.js';
import { worldScanner } from '../../world/worldScanner.js';

/**
 * Scannt benutzerdefinierte Baufelddaten inkl. realer Terrainhöhen und Nachbarschaftspalette.
 */
export function scanCustomBounds(bounds, bot) {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const maxX = Math.max(bounds.minX, bounds.maxX);
  const minZ = Math.min(bounds.minZ, bounds.maxZ);
  const maxZ = Math.max(bounds.minZ, bounds.maxZ);
  const width = maxX - minX + 1;
  const depth = maxZ - minZ + 1;
  const groundY = bounds.baseY ?? (bot?.entity?.position?.y ? Math.floor(bot.entity.position.y) : 64);
  const facing = bounds.facing || 'north';

  const terrainMap = {};
  const neighborhoodCounts = {};

  if (bot && typeof bot.blockAt === 'function') {
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
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

    // Umgebungs-Blöcke erfassen
    for (let dx = -4; dx <= width + 4; dx += 2) {
      for (let dz = -4; dz <= depth + 4; dz += 2) {
        for (let dy = -2; dy <= 6; dy += 2) {
          const b = bot.blockAt(new Vec3(minX + dx, groundY + dy, minZ + dz));
          if (b && !b.name.includes('air') && !b.name.includes('grass_block') && !b.name.includes('dirt')) {
            neighborhoodCounts[b.name] = (neighborhoodCounts[b.name] || 0) + 1;
          }
        }
      }
    }
  }

  const neighborhoodPalette = Object.entries(neighborhoodCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);

  const siteInfo = {
    origin: { x: minX, y: groundY, z: minZ },
    width,
    depth,
    height: 36,
    facing,
    groundY,
    terrainMap,
    neighborhoodPalette,
    bounds: { minX, minZ, maxX, maxZ, baseY: groundY, facing }
  };

  logger.info(`Benutzerdefinierte Baufläche festgelegt: ${width}x${depth} Blöcke bei (${minX}, ${groundY}, ${minZ}), Ausrichtung: ${facing}`);
  return siteInfo;
}

/**
 * Ermittelt das effektive Baufeld (benutzerdefiniert oder gescannt).
 */
export function getEffectiveSiteInfo(customSiteInfo, bot, username = null, customDimensions = null) {
  if (customSiteInfo && !customDimensions) {
    return customSiteInfo;
  }
  return worldScanner.scanBuildSite(bot, username, customDimensions);
}
