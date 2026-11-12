import { Vec3 } from 'vec3';
import { logger } from '../../utils/logger.js';
import { getPathfinderGoals } from '../../utils/pathfinderHelper.js';

/**
 * Führt die Rückzugsbewegung weg von der aktuellen Bedrohung aus.
 */
export async function executeInitiateRetreat({ bot, currentTarget, settings }) {
  if (typeof bot?.deactivateItem === 'function') {
    bot.deactivateItem();
  }

  if (bot?.pathfinder) {
    if (typeof bot.pathfinder.stop === 'function') {
      try {
        bot.pathfinder.stop();
      } catch {}
    }

    if (typeof bot.setControlState === 'function') {
      bot.setControlState('sprint', true);
    }

    const retreatDist = settings?.SURVIVAL_RETREAT_DISTANCE || 15.0;
    let retreatVector;

    if (currentTarget?.position && bot?.entity?.position) {
      const diff = bot.entity.position.minus(currentTarget.position);
      const dist = typeof diff.norm === 'function' ? diff.norm() : Math.sqrt(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
      if (dist > 0.001) {
        retreatVector = diff.normalize().scaled(retreatDist);
      } else {
        retreatVector = new Vec3(retreatDist, 0, retreatDist);
      }
    } else {
      retreatVector = new Vec3(retreatDist, 0, retreatDist);
    }

    const safePos = bot.entity.position.plus(retreatVector);
    try {
      const goals = await getPathfinderGoals();
      if (goals?.GoalNear) {
        bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2.0));
      } else if (typeof bot.pathfinder.setGoal === 'function') {
        bot.pathfinder.setGoal({ x: safePos.x, y: safePos.y, z: safePos.z });
      }
    } catch {
      if (typeof bot?.pathfinder?.setGoal === 'function') {
        bot.pathfinder.setGoal({ x: safePos.x, y: safePos.y, z: safePos.z });
      }
    }
  }
}

/**
 * Überprüft den Bauplatz und steuert die Rückkehr zur vorherigen Position nach der Abwehr.
 */
export async function returnToBuildSite(bot, targetPos) {
  if (targetPos && bot?.entity?.position && bot.pathfinder) {
    const distToBuild = bot.entity.position.distanceTo(targetPos);
    if (distToBuild > 3.5 && typeof bot.pathfinder.goto === 'function') {
      try {
        const goals = await getPathfinderGoals();
        if (goals?.GoalNear) {
          await bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2.5));
        } else {
          await bot.pathfinder.goto({ x: targetPos.x, y: targetPos.y, z: targetPos.z });
        }
      } catch (navErr) {
        logger.debug(`[ThreatManager] Navigation zurück zum Bauplatz: ${navErr.message}`);
      }
    }
  }
}
