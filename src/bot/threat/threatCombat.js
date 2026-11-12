import { Vec3 } from 'vec3';
import { logger } from '../../utils/logger.js';
import { getPathfinderGoals } from '../../utils/pathfinderHelper.js';

/**
 * Führt einen einzelnen Kampfschritt gegen das aktuelle Ziel durch.
 */
export async function executeCombatStep({
  bot,
  target,
  lastAttackTime,
  backpedalUntil,
  settings,
  findNearbyThreat
}) {
  if (!target || target.isValid === false || (typeof target.health === 'number' && target.health <= 0)) {
    logger.info(`[ThreatManager] Ziel neutralisiert.`);
    return { neutralized: true, target: null, lastAttackTime, backpedalUntil: 0 };
  }

  if (!bot?.entity?.position || !target.position) {
    return { neutralized: false, target, lastAttackTime, backpedalUntil };
  }

  const dist = bot.entity.position.distanceTo(target.position);

  // Falls Ziel zu weit weggelaufen ist (>16m), prüfe ob nähere Bedrohung vorliegt
  if (dist > 16.0 && typeof findNearbyThreat === 'function') {
    const closer = findNearbyThreat(settings?.SURVIVAL_THREAT_RADIUS || 12.0);
    if (closer && closer !== target) {
      return { neutralized: false, target: closer, lastAttackTime, backpedalUntil: 0 };
    }
  }

  const now = Date.now();
  const cooldownMs = settings?.SURVIVAL_ATTACK_COOLDOWN_MS || 625;
  let currentBackpedal = backpedalUntil;
  const isBackpedaling = Boolean(currentBackpedal && now < currentBackpedal);

  if (currentBackpedal && now >= currentBackpedal) {
    currentBackpedal = 0;
  }

  // 1. Taktische Mob-Vorbereitung (Skelett / Stray: Schild heben/senken)
  if (target.name === 'skeleton' || target.name === 'stray') {
    if (dist > 3.5) {
      if (typeof bot.activateItem === 'function') {
        bot.activateItem(true);
      }
    } else {
      if (typeof bot.deactivateItem === 'function') {
        bot.deactivateItem();
      }
    }
  }

  // 2. Annäherung via Pathfinder
  const shouldApproach = dist > 3.0 && !isBackpedaling && !(target.name === 'creeper' && dist <= 3.5);
  if (shouldApproach && bot?.pathfinder) {
    try {
      const goals = await getPathfinderGoals();
      if (goals?.GoalFollow) {
        bot.pathfinder.setGoal(new goals.GoalFollow(target, 2.5), true);
      } else if (goals?.GoalNear) {
        bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2.5));
      } else if (typeof bot.pathfinder.setGoal === 'function') {
        bot.pathfinder.setGoal({ x: target.position.x, y: target.position.y, z: target.position.z });
      }
    } catch {
      if (typeof bot?.pathfinder?.setGoal === 'function') {
        bot.pathfinder.setGoal({ x: target.position.x, y: target.position.y, z: target.position.z });
      }
    }
  }

  let updatedLastAttackTime = lastAttackTime;

  // 3. Schlag-Ausführung & Cooldown-Pacing
  if (dist <= 3.5 && (now - lastAttackTime) >= cooldownMs) {
    if (typeof bot.deactivateItem === 'function') {
      bot.deactivateItem(); // Schild vor Schlag absenken
    }
    if (typeof bot.lookAt === 'function') {
      const targetEye = target.position.offset(0, (target.height || 1.6) * 0.85, 0);
      await bot.lookAt(targetEye);
    }
    if (typeof bot.attack === 'function') {
      bot.attack(target);
      updatedLastAttackTime = Date.now();
    }

    // Prüfen ob Mob durch den Schlag neutralisiert wurde
    if (target.isValid === false || (typeof target.health === 'number' && target.health <= 0)) {
      logger.info(`[ThreatManager] Ziel neutralisiert.`);
      return { neutralized: true, target: null, lastAttackTime: updatedLastAttackTime, backpedalUntil: 0 };
    }

    // Spezifische Creeper-Taktik: Nach Schlag sofortiges 4m Zurückweichen einleiten
    if (target.name === 'creeper') {
      const diff = bot.entity.position.minus(target.position);
      const d = typeof diff.norm === 'function' ? diff.norm() : Math.sqrt(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
      let stepAway;
      if (d > 0.001) {
        stepAway = diff.normalize().scaled(4.0);
      } else {
        stepAway = new Vec3(4.0, 0, 0);
      }
      const safeGoal = bot.entity.position.plus(stepAway);

      currentBackpedal = Date.now() + 1500;

      if (bot?.pathfinder) {
        try {
          const goals = await getPathfinderGoals();
          if (goals?.GoalNear) {
            bot.pathfinder.setGoal(new goals.GoalNear(safeGoal.x, safeGoal.y, safeGoal.z, 1.0));
          } else if (typeof bot.pathfinder.setGoal === 'function') {
            bot.pathfinder.setGoal({ x: safeGoal.x, y: safeGoal.y, z: safeGoal.z });
          }
        } catch {
          if (typeof bot?.pathfinder?.setGoal === 'function') {
            bot.pathfinder.setGoal({ x: safeGoal.x, y: safeGoal.y, z: safeGoal.z });
          }
        }
      }
    }
  }

  return { neutralized: false, target, lastAttackTime: updatedLastAttackTime, backpedalUntil: currentBackpedal };
}
