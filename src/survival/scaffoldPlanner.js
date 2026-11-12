import { Vec3 } from 'vec3';
import { settings } from '../config/settings.js';

export const DEFAULT_SCAFFOLD_MATERIALS = [
  'scaffolding',
  'dirt',
  'coarse_dirt',
  'cobblestone',
  'cobbled_deepslate',
  'netherrack',
  'oak_planks',
  'spruce_planks'
];

/**
 * Prüft, ob ein Zielblock von einer bestimmten Position aus erreichbar ist.
 */
export function isReachableFrom(standPos, targetPos, maxReach = 3.8) {
  if (!standPos || !targetPos) return false;
  const eyePos = new Vec3(standPos.x + 0.5, standPos.y + 1.62, standPos.z + 0.5);
  const targetCenter = new Vec3(targetPos.x + 0.5, targetPos.y + 0.5, targetPos.z + 0.5);
  return eyePos.distanceTo(targetCenter) <= maxReach;
}

/**
 * Sucht im Inventar nach verfügbaren Gerüstblöcken gemäß Prioritätenliste.
 */
export function getAvailableScaffoldMaterial(bot) {
  if (!bot || !bot.inventory) return null;
  const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];

  const configuredMaterials = (settings.SURVIVAL_SCAFFOLD_BLOCKS || '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const materials = configuredMaterials.length > 0 ? configuredMaterials : DEFAULT_SCAFFOLD_MATERIALS;

  for (const mat of materials) {
    const found = items.find(i => i && (i.name === mat || i.name?.endsWith(`:${mat}`)));
    if (found && found.count > 0) {
      return {
        name: mat,
        count: found.count,
        isVanillaScaffolding: mat === 'scaffolding'
      };
    }
  }

  return null;
}

/**
 * Findet einen existierenden, soliden Standplatz in Reichweite des Zielblocks.
 */
export function findWalkableStandingSpot(bot, targetPos, options = {}, isScaffoldBlockFn = () => false) {
  if (!bot || !targetPos) return null;
  const maxReach = options.maxReach || settings.SURVIVAL_MAX_REACH || 3.8;
  const blockAt = (p) => {
    if (typeof bot.blockAt === 'function') {
      const b = bot.blockAt(p);
      if (b) return b;
    }
    if (isScaffoldBlockFn(p)) {
      return { name: 'scaffolding', position: p };
    }
    return null;
  };

  const isPassable = (b) => {
    if (!b) return true;
    const name = b.name || '';
    return name.includes('air') || name.includes('water') || name === 'scaffolding' || isScaffoldBlockFn(b.position);
  };

  const isSolidGround = (b) => {
    if (!b) return false;
    const name = b.name || '';
    if (name.includes('air') || name.includes('water') || name.includes('lava')) return false;
    if (name.endsWith('_door') || name.endsWith('_carpet') || name === 'ladder') return false;
    return true;
  };

  if (bot.entity && bot.entity.position) {
    const currentStand = bot.entity.position.floored();
    if (isReachableFrom(currentStand, targetPos, maxReach)) {
      if (!currentStand.equals(targetPos.floored())) {
        return currentStand;
      }
    }
  }

  let bestSpot = null;
  let minDistance = Infinity;

  for (let dy = -2; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        if (dx === 0 && dz === 0 && dy === 0) continue;

        const candidateStand = new Vec3(
          Math.floor(targetPos.x + dx),
          Math.floor(targetPos.y + dy),
          Math.floor(targetPos.z + dz)
        );

        if (candidateStand.equals(targetPos.floored())) continue;

        const floorBlock = blockAt(candidateStand.offset(0, -1, 0));
        if (!isSolidGround(floorBlock)) continue;

        const bodyBlock = blockAt(candidateStand);
        const headBlock = blockAt(candidateStand.offset(0, 1, 0));
        if (!isPassable(bodyBlock) || !isPassable(headBlock)) continue;

        if (isReachableFrom(candidateStand, targetPos, maxReach)) {
          const dist = bot.entity ? bot.entity.position.distanceTo(candidateStand) : 0;
          if (dist < minDistance) {
            minDistance = dist;
            bestSpot = candidateStand;
          }
        }
      }
    }
  }

  return bestSpot;
}

/**
 * Berechnet einen optimalen Säulen-Ort für temporären Gerüstbau.
 */
export function planScaffoldColumn(bot, targetPos, options = {}, coordKeyFn = (x, y, z) => `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`) {
  if (!bot || !targetPos) return null;
  const reservedBlocks = options.reservedBlocks || new Set();

  const blockAt = (p) => {
    if (typeof bot.blockAt === 'function') return bot.blockAt(p);
    return null;
  };

  const candidates = [
    { dx: 1, dz: 0 },
    { dx: -1, dz: 0 },
    { dx: 0, dz: 1 },
    { dx: 0, dz: -1 },
    { dx: 1, dz: 1 },
    { dx: -1, dz: 1 },
    { dx: 1, dz: -1 },
    { dx: -1, dz: -1 },
    { dx: 2, dz: 0 },
    { dx: -2, dz: 0 },
    { dx: 0, dz: 2 },
    { dx: 0, dz: -2 }
  ];

  let bestCol = null;

  for (const offset of candidates) {
    const colX = Math.floor(targetPos.x + offset.dx);
    const colZ = Math.floor(targetPos.z + offset.dz);

    let collidesWithBuild = false;
    for (let y = Math.floor(targetPos.y - 4); y <= Math.floor(targetPos.y + 4); y++) {
      if (reservedBlocks.has(coordKeyFn(colX, y, colZ))) {
        collidesWithBuild = true;
        break;
      }
    }
    if (collidesWithBuild) continue;

    let groundY = Math.floor(targetPos.y);
    let foundGround = false;
    for (let y = Math.floor(targetPos.y); y >= Math.floor(targetPos.y - 16); y--) {
      const b = blockAt(new Vec3(colX, y, colZ));
      if (b && !b.name?.includes('air') && !b.name?.includes('water')) {
        groundY = y;
        foundGround = true;
        break;
      }
    }

    if (!foundGround) {
      groundY = bot.entity?.position ? Math.floor(bot.entity.position.y - 1) : Math.floor(targetPos.y - 1);
    }

    const targetStandY = Math.max(groundY + 1, Math.floor(targetPos.y - 1));
    const requiredBlocks = targetStandY - groundY;

    bestCol = {
      columnX: colX,
      columnZ: colZ,
      groundY,
      targetStandY,
      requiredBlocks,
      standingPos: new Vec3(colX, targetStandY, colZ)
    };
    break;
  }

  return bestCol;
}
