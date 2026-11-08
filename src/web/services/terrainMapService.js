import { Vec3 } from 'vec3';

/**
 * Generates a 64x64 topological grid around the bot's current position,
 * or a deterministic fallback landscape when offline.
 *
 * @param {Object} [bot] - Mineflayer bot instance
 * @returns {{ grid: Array<{ x: number, y: number, z: number, blockName: string }>, center: { x: number, y: number, z: number }, isSimulated: boolean }}
 */
export function generateAreaMapData(bot) {
  const grid = [];
  const centerPos = bot?.entity?.position || new Vec3(0, 64, 0);
  const cx = Math.floor(centerPos.x);
  const cz = Math.floor(centerPos.z);
  const cy = Math.floor(centerPos.y);

  for (let dx = -32; dx < 32; dx++) {
    for (let dz = -32; dz < 32; dz++) {
      const x = cx + dx;
      const z = cz + dz;
      let foundY = cy;
      let blockName = 'grass_block';

      if (bot && typeof bot.blockAt === 'function') {
        for (let y = cy + 15; y >= Math.max(bot.game?.minY ?? -64, cy - 25); y--) {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
            foundY = y;
            blockName = b.name;
            break;
          }
        }
      } else {
        // Deterministisches Fallback-Muster für Offline-/Dev-Modus
        const isStone = Math.abs(x + z) % 9 === 0;
        const isWater = Math.abs(x - z) % 17 === 0;
        blockName = isWater ? 'water' : isStone ? 'stone' : 'grass_block';
      }

      grid.push({ x, z, y: foundY, blockName });
    }
  }

  const players = [];
  if (bot && bot.players) {
    for (const [name, p] of Object.entries(bot.players)) {
      if (p?.entity?.position && name !== bot.username) {
        players.push({
          username: name,
          x: Math.floor(p.entity.position.x),
          y: Math.floor(p.entity.position.y),
          z: Math.floor(p.entity.position.z),
          distance: Math.round(bot.entity?.position?.distanceTo(p.entity.position) || 0)
        });
      }
    }
  }

  const isSimulated = !bot || typeof bot.blockAt !== 'function';
  return { grid, center: { x: cx, y: cy, z: cz }, isSimulated, players };
}

/**
 * Computes 3D bounding box terrain collisions and foundation support for a build site,
 * or returns deterministic simulated terrain blocks if offline.
 *
 * @param {Object} [bot] - Mineflayer bot instance
 * @param {Object} [siteInfo] - Site information with origin, width, depth, groundY
 * @param {Object} [bounds] - Canvas bounds with width, height, depth
 * @returns {{ blocks: Array<{ x: number, y: number, z: number, name: string, isCollision: boolean, isFoundationSupport: boolean }>, isSimulated: boolean }}
 */
export function generateTerrainXray(bot, siteInfo, bounds) {
  const safeBounds = bounds || { width: 16, height: 16, depth: 16 };
  const origin = siteInfo?.origin || { x: 0, y: 64, z: 0 };
  const groundY = siteInfo?.groundY ?? origin.y;
  const width = siteInfo?.width || safeBounds.width || 16;
  const depth = siteInfo?.depth || safeBounds.depth || 16;
  const height = safeBounds.height || 16;

  const blocks = [];

  if (bot && typeof bot.blockAt === 'function') {
    for (let x = origin.x; x < origin.x + width; x++) {
      for (let z = origin.z; z < origin.z + depth; z++) {
        for (let y = groundY - 4; y <= groundY + height; y++) {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air' && b.name !== 'structure_void') {
            const isCollision = y >= groundY;
            const isFoundationSupport = y < groundY;
            blocks.push({
              x: x - origin.x,
              y: y - groundY,
              z: z - origin.z,
              name: b.name,
              isCollision,
              isFoundationSupport
            });
          }
        }
      }
    }
  } else {
    // Deterministische X-Ray Simulation im Offline-Modus
    for (let x = 0; x < width; x++) {
      for (let z = 0; z < depth; z++) {
        blocks.push({
          x, y: -1, z, name: 'dirt', isCollision: false, isFoundationSupport: true
        });
        if ((x + z) % 7 === 0) {
          blocks.push({
            x, y: 0, z, name: 'oak_log', isCollision: true, isFoundationSupport: false
          });
        }
      }
    }
  }

  const isSimulated = !bot || typeof bot.blockAt !== 'function';
  return {
    blocks,
    isSimulated
  };
}
