import { Vec3 } from 'vec3';
import { logger } from '../../utils/logger.js';

/**
 * Resolves a face number (0..5) or Vec3 into a unit direction vector.
 * @param {number|Vec3} face
 * @returns {Vec3}
 */
export function resolveFaceVector(face) {
  if (face instanceof Vec3) return face;
  switch (face) {
    case 0: return new Vec3(0, -1, 0); // Bottom
    case 1: return new Vec3(0, 1, 0);  // Top
    case 2: return new Vec3(0, 0, -1); // North
    case 3: return new Vec3(0, 0, 1);  // South
    case 4: return new Vec3(-1, 0, 0); // West
    case 5: return new Vec3(1, 0, 0);  // East
    default: return new Vec3(0, 1, 0);
  }
}

/**
 * Performs raycast to find targeted block.
 * @param {any} bot
 * @param {number} maxDistance
 * @returns {any}
 */
export function raycastTargetBlock(bot, maxDistance = 4.5) {
  if (!bot || !bot.entity) return null;

  // 1. Direct prismarine world raycast (bypasses mineflayer's !pitch / !yaw truthiness bug)
  if (bot.world && typeof bot.world.raycast === 'function') {
    const pos = bot.entity.position;
    if (pos && typeof pos.offset === 'function') {
      const pitch = typeof bot.entity.pitch === 'number' ? bot.entity.pitch : 0;
      const yaw = typeof bot.entity.yaw === 'number' ? bot.entity.yaw : 0;
      const eyeHeight = typeof bot.entity.eyeHeight === 'number' ? bot.entity.eyeHeight : 1.62;
      const eyePos = pos.offset(0, eyeHeight, 0);

      const csPitch = Math.cos(pitch);
      const snPitch = Math.sin(pitch);
      const csYaw = Math.cos(yaw);
      const snYaw = Math.sin(yaw);
      const viewDir = new Vec3(-snYaw * csPitch, snPitch, -csYaw * csPitch);

      try {
        const hit = bot.world.raycast(eyePos, viewDir, maxDistance);
        if (hit) {
          if (hit.face !== undefined && !hit.faceVector) {
            hit.faceVector = resolveFaceVector(hit.face);
          }
          return hit;
        }
      } catch (rayErr) {
        logger.debug(`[ManualController] world.raycast Fehler: ${rayErr.message}`);
      }
    }
  }

  // 2. Fallback to bot.blockAtCursor or cursorBlock mock
  if (typeof bot.blockAtCursor === 'function') {
    try {
      const hit = bot.blockAtCursor(maxDistance);
      if (hit) {
        if (hit.face !== undefined && !hit.faceVector) {
          hit.faceVector = resolveFaceVector(hit.face);
        }
        return hit;
      }
    } catch {}
  }

  return null;
}

/**
 * Inspects what entity or block the bot is currently pointing at.
 * @param {any} bot
 * @param {number} maxDistance
 * @returns {any}
 */
export function inspectTarget(bot, maxDistance = 4.5) {
  if (!bot || !bot.entity) return null;

  if (typeof bot.entityAtCursor === 'function') {
    try {
      const ent = bot.entityAtCursor(3.5);
      if (ent) {
        const dist = bot.entity.position && ent.position && typeof bot.entity.position.distanceTo === 'function'
          ? Number(bot.entity.position.distanceTo(ent.position).toFixed(2))
          : null;
        return {
          kind: 'entity',
          type: 'entity',
          name: ent.name || ent.username || 'Unbekannt',
          displayName: ent.displayName || ent.username || ent.name || 'Entity',
          id: ent.id,
          distance: dist,
          health: ent.health ?? null
        };
      }
    } catch {}
  }

  const block = raycastTargetBlock(bot, maxDistance);
  if (block) {
    const eyePos = bot.entity.position && typeof bot.entity.position.offset === 'function'
      ? bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
      : bot.entity.position;
    const hitPos = block.intersect || (block.position && typeof block.position.offset === 'function' ? block.position.offset(0.5, 0.5, 0.5) : block.position);
    const dist = eyePos && hitPos && typeof eyePos.distanceTo === 'function'
      ? Number(eyePos.distanceTo(hitPos).toFixed(2))
      : null;
    const digTime = (typeof bot.digTime === 'function') ? bot.digTime(block) : 500;
    const face = block.face ?? 1;
    const faceVector = block.faceVector || resolveFaceVector(face);

    return {
      kind: 'block',
      type: 'block',
      name: block.name,
      displayName: block.displayName || block.name,
      position: block.position ? { x: block.position.x, y: block.position.y, z: block.position.z } : null,
      face,
      faceVector: { x: faceVector.x, y: faceVector.y, z: faceVector.z },
      distance: dist,
      hardness: block.hardness ?? 1,
      digTime
    };
  }

  return null;
}
