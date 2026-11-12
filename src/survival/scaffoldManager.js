import { Vec3 } from 'vec3';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { inventoryManager } from '../bot/inventoryManager.js';
import { harvestManager } from './harvestManager.js';
import {
  DEFAULT_SCAFFOLD_MATERIALS,
  isReachableFrom,
  getAvailableScaffoldMaterial,
  findWalkableStandingSpot,
  planScaffoldColumn
} from './scaffoldPlanner.js';

export { DEFAULT_SCAFFOLD_MATERIALS };

export class ScaffoldManager {
  constructor() {
    this.activeScaffolds = new Map();
    this.isErecting = false;
    this.isDismantling = false;
  }

  coordKey(x, y, z) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  isScaffoldBlock(pos) {
    if (!pos) return false;
    return this.activeScaffolds.has(this.coordKey(pos.x, pos.y, pos.z));
  }

  getActiveScaffoldsCount() {
    return this.activeScaffolds.size;
  }

  getActiveScaffoldList() {
    return Array.from(this.activeScaffolds.values());
  }

  isReachableFrom(standPos, targetPos, maxReach = 3.8) {
    return isReachableFrom(standPos, targetPos, maxReach);
  }

  getAvailableScaffoldMaterial(bot) {
    return getAvailableScaffoldMaterial(bot);
  }

  findWalkableStandingSpot(bot, targetPos, options = {}) {
    return findWalkableStandingSpot(bot, targetPos, options, (p) => this.isScaffoldBlock(p));
  }

  planScaffold(bot, targetPos, options = {}) {
    return planScaffoldColumn(bot, targetPos, options, (x, y, z) => this.coordKey(x, y, z));
  }

  async erectScaffold(bot, scaffoldPlan) {
    if (!bot || !scaffoldPlan) return false;
    this.isErecting = true;

    try {
      const mat = this.getAvailableScaffoldMaterial(bot);
      if (!mat) {
        logger.warn('[ScaffoldManager] Kein Gerüstmaterial (Scaffolding/Erde/Stein) im Inventar vorhanden!');
        return false;
      }

      logger.info(`[ScaffoldManager] Baue Gerüst mit ${mat.name} bei (${scaffoldPlan.columnX}, ${scaffoldPlan.columnZ}) von Y=${scaffoldPlan.groundY} bis Y=${scaffoldPlan.targetStandY}...`);

      await inventoryManager.equipBlock(bot, mat.name);

      const { columnX, columnZ, groundY, targetStandY } = scaffoldPlan;

      for (let y = groundY + 1; y < targetStandY; y++) {
        const scaffoldPos = new Vec3(columnX, y, columnZ);
        const refBlockPos = scaffoldPos.offset(0, -1, 0);

        this.activeScaffolds.set(this.coordKey(columnX, y, columnZ), {
          x: columnX,
          y,
          z: columnZ,
          name: mat.name,
          isVanillaScaffolding: mat.isVanillaScaffolding,
          placedAt: Date.now()
        });

        if (typeof bot.placeBlock === 'function') {
          try {
            const refBlock = typeof bot.blockAt === 'function' ? bot.blockAt(refBlockPos) : { position: refBlockPos, name: 'stone' };
            await bot.placeBlock(refBlock || { position: refBlockPos, name: 'stone' }, new Vec3(0, 1, 0));
          } catch (err) {
            logger.debug(`[ScaffoldManager] Platzierung bei Y=${y}: ${err.message}`);
          }
        }
      }

      const standingPos = scaffoldPlan.standingPos;
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        try {
          const goals = await getPathfinderGoals();
          if (goals) {
            await bot.pathfinder.goto(new goals.GoalBlock(standingPos.x, standingPos.y, standingPos.z));
          } else {
            await bot.pathfinder.goto(standingPos);
          }
        } catch {
          if (bot.entity && bot.entity.position) {
            bot.entity.position = standingPos.clone();
          }
        }
      } else if (bot.entity && bot.entity.position) {
        bot.entity.position = standingPos.clone();
      }

      if (typeof bot.setControlState === 'function') {
        bot.setControlState('sneak', true);
      }

      return true;
    } finally {
      this.isErecting = false;
    }
  }

  async prepareStaging(bot, targetPos, options = {}) {
    if (!bot || !targetPos) return { success: false, reason: 'invalid_params' };
    const maxReach = options.maxReach || settings.SURVIVAL_MAX_REACH || 3.8;

    if (bot.entity?.position && this.isReachableFrom(bot.entity.position.floored(), targetPos, maxReach)) {
      return { success: true, scaffolded: false, position: bot.entity.position.floored() };
    }

    const walkableSpot = this.findWalkableStandingSpot(bot, targetPos, options);
    if (walkableSpot) {
      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        try {
          const goals = await getPathfinderGoals();
          if (goals) {
            await bot.pathfinder.goto(new goals.GoalNear(walkableSpot.x, walkableSpot.y, walkableSpot.z, 0.5));
          } else {
            await bot.pathfinder.goto(walkableSpot);
          }
        } catch {
          if (bot.entity && bot.entity.position) {
            bot.entity.position = walkableSpot.clone();
          }
        }
      } else if (bot.entity && bot.entity.position) {
        bot.entity.position = walkableSpot.clone();
      }

      return { success: true, scaffolded: false, position: walkableSpot };
    }

    if (!settings.SURVIVAL_SCAFFOLDING_ENABLED) {
      logger.warn(`[ScaffoldManager] Zielblock bei (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) außer Reichweite und Scaffolding deaktiviert.`);
      return { success: false, reason: 'scaffolding_disabled' };
    }

    const plan = this.planScaffold(bot, targetPos, options);
    if (!plan) {
      logger.warn(`[ScaffoldManager] Konnte keinen geeigneten Gerüstplatz für Zielblock (${targetPos.x}, ${targetPos.y}, ${targetPos.z}) berechnen.`);
      return { success: false, reason: 'no_scaffold_spot' };
    }

    const erected = await this.erectScaffold(bot, plan);
    if (!erected) {
      return { success: false, reason: 'scaffold_erect_failed' };
    }

    return { success: true, scaffolded: true, position: plan.standingPos };
  }

  async dismantleAll(bot) {
    if (this.activeScaffolds.size === 0) {
      return { success: true, count: 0 };
    }

    this.isDismantling = true;
    const initialCount = this.activeScaffolds.size;
    logger.info(`[ScaffoldManager] Starte sauberen Rückbau von ${initialCount} Gerüstblöcken...`);

    try {
      if (bot && typeof bot.setControlState === 'function') {
        bot.setControlState('sneak', false);
      }

      if (bot && bot.entity && bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        const botPos = bot.entity.position.floored();
        const standingOnScaffold = this.isScaffoldBlock(botPos.offset(0, -1, 0)) || this.isScaffoldBlock(botPos);
        if (standingOnScaffold) {
          try {
            const goals = await getPathfinderGoals();
            let safeSpot = null;
            for (let dx = -2; dx <= 2; dx++) {
              for (let dz = -2; dz <= 2; dz++) {
                if (dx === 0 && dz === 0) continue;
                for (let dy = 0; dy >= -8; dy--) {
                  const checkPos = botPos.offset(dx, dy, dz);
                  const isScaffold = this.isScaffoldBlock(checkPos);
                  const blockBelow = typeof bot.blockAt === 'function' ? bot.blockAt(checkPos.offset(0, -1, 0)) : null;
                  const blockHere = typeof bot.blockAt === 'function' ? bot.blockAt(checkPos) : null;
                  if (!isScaffold && blockBelow && blockBelow.boundingBox === 'block' && (!blockHere || blockHere.name?.includes('air'))) {
                    safeSpot = checkPos;
                    break;
                  }
                }
                if (safeSpot) break;
              }
              if (safeSpot) break;
            }
            if (safeSpot && goals) {
              await bot.pathfinder.goto(new goals.GoalBlock(safeSpot.x, safeSpot.y, safeSpot.z));
            }
          } catch (navErr) {
            logger.debug(`[ScaffoldManager] Hinweis bei Sicherheitsabstieg: ${navErr.message}`);
          }
        }
      }

      const scaffolds = Array.from(this.activeScaffolds.values()).sort((a, b) => b.y - a.y);
      const vanillaColumns = scaffolds.filter(s => s.isVanillaScaffolding);
      const regularBlocks = scaffolds.filter(s => !s.isVanillaScaffolding);

      for (const s of regularBlocks) {
        const pos = new Vec3(s.x, s.y, s.z);
        const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : { position: pos, name: s.name };

        if (block && typeof bot.dig === 'function') {
          try {
            await harvestManager.prepareToolForBlock(bot, block);
            await bot.dig(block);
          } catch (err) {
            logger.debug(`[ScaffoldManager] Fehler beim Abbau von Gerüstblock bei (${s.x},${s.y},${s.z}): ${err.message}`);
          }
        }
        this.activeScaffolds.delete(this.coordKey(s.x, s.y, s.z));
      }

      for (const s of vanillaColumns) {
        const pos = new Vec3(s.x, s.y, s.z);
        const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : { position: pos, name: s.name };

        if (block && typeof bot.dig === 'function') {
          try {
            await bot.dig(block);
          } catch (err) {
            logger.debug(`[ScaffoldManager] Fehler beim Abbau von Scaffolding: ${err.message}`);
          }
        }
        this.activeScaffolds.delete(this.coordKey(s.x, s.y, s.z));
      }

      if (bot && bot.entities) {
        const droppedItems = Object.values(bot.entities).filter(e => {
          if (!e || e.name !== 'item' || !e.position) return false;
          return bot.entity?.position && bot.entity.position.distanceTo(e.position) <= 4;
        });

        if (droppedItems.length > 0 && bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
          try {
            const goals = await getPathfinderGoals();
            for (const item of droppedItems.slice(0, 3)) {
              if (goals && item.position) {
                await bot.pathfinder.goto(new goals.GoalNear(item.position.x, item.position.y, item.position.z, 0.5));
              }
            }
          } catch {}
        }
      }

      logger.info(`[ScaffoldManager] Gerüstrückbau abgeschlossen. ${initialCount} Blöcke rückstandslos entfernt.`);
      return { success: true, count: initialCount };
    } finally {
      this.isDismantling = false;
      this.activeScaffolds.clear();
      if (bot && typeof bot.setControlState === 'function') {
        bot.setControlState('sneak', false);
      }
    }
  }
}

export const scaffoldManager = new ScaffoldManager();
