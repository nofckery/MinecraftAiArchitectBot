import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';
import { settings } from '../config/settings.js';
import { inventoryManager } from './inventoryManager.js';
import { manualController } from './manualController.js';
import { HOSTILE_MOBS } from './threat/threatRadar.js';
import { executeCombatStep } from './threat/threatCombat.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { harvestManager } from '../survival/harvestManager.js';

export const GUARD_STATES = {
  IDLE: 'IDLE',
  PATROLLING: 'PATROLLING',
  ENGAGING: 'ENGAGING',
  RETURNING: 'RETURNING',
  HEALING: 'HEALING',
  LOOTING: 'LOOTING'
};

export class GuardManager {
  constructor(bot = null) {
    this.bot = bot;
    this.isGuarding = false;
    this.guardCenter = null;
    this.guardRadius = 20;
    this.state = GUARD_STATES.IDLE;
    this.currentTarget = null;
    this.lastAttackTime = 0;
    this.backpedalUntil = 0;
    this.guardInterval = null;
    this.isTicking = false;
    this.defeatedCount = 0;
    this.collectedLoot = 0;
    this.chatAlerts = true;
  }

  setBot(bot) {
    this.bot = bot;
  }

  /**
   * Startet die autonome Gebietsverteidigung.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Vec3|{x:number, y:number, z:number}} center Mittelpunkt des Schutzbereichs
   * @param {number} radius Verteidigungsradius (z. B. 20-30 Blöcke)
   * @param {Object} options Optionen (chatAlerts, onReport)
   */
  async startGuarding(bot, center = null, radius = 20, options = {}) {
    this.bot = bot || this.bot;
    if (!this.bot) return false;

    this.stopGuarding();

    const botPos = this.bot.entity?.position;
    if (center && typeof center.x === 'number') {
      this.guardCenter = new Vec3(center.x, center.y, center.z);
    } else if (botPos) {
      this.guardCenter = botPos.clone();
    } else {
      this.guardCenter = new Vec3(0, 64, 0);
    }

    this.guardRadius = Math.max(8, Math.min(64, radius || 20));
    this.isGuarding = true;
    this.state = GUARD_STATES.PATROLLING;
    this.currentTarget = null;
    this.defeatedCount = 0;
    this.collectedLoot = 0;
    this.chatAlerts = options.chatAlerts !== false;

    // Kampfausrüstung anlegen
    await inventoryManager.equipBestArmor(this.bot);
    await inventoryManager.equipBestWeapon(this.bot);
    await inventoryManager.equipShield(this.bot);

    const gx = Math.round(this.guardCenter.x);
    const gy = Math.round(this.guardCenter.y);
    const gz = Math.round(this.guardCenter.z);
    const msg = `[Wachdienst] Starte Gebietsverteidigung bei (${gx}, ${gy}, ${gz}) im Radius von ${this.guardRadius}m. Alle Monster & Feinde werden bekämpft!`;
    logger.info(msg);
    if (this.chatAlerts && typeof this.bot.chat === 'function') {
      this.bot.chat(msg);
    }

    this.guardInterval = setInterval(() => {
      this.tick().catch(err => {
        logger.debug(`[GuardManager] Fehler in tick(): ${err.message}`);
      });
    }, 400);

    return true;
  }

  /**
   * Beendet den Wachdienst und setzt den Bot in den Ruhezustand.
   */
  stopGuarding() {
    if (this.guardInterval) {
      clearInterval(this.guardInterval);
      this.guardInterval = null;
    }

    const wasActive = this.isGuarding;
    this.isGuarding = false;
    this.state = GUARD_STATES.IDLE;
    this.currentTarget = null;

    if (wasActive) {
      const msg = `[Wachdienst] Verteidigung beendet. Neutralisierte Feinde: ${this.defeatedCount}.`;
      logger.info(msg);
      if (this.chatAlerts && this.bot && typeof this.bot.chat === 'function') {
        this.bot.chat(msg);
      }
    }
  }

  /**
   * Sucht nach feindlichen Mobs oder aggressiven Zielen innerhalb des Schutzbereichs.
   */
  findHostileInZone() {
    if (!this.bot?.entities || !this.guardCenter) return null;

    let closest = null;
    let minDistance = this.guardRadius;
    const botPos = this.bot.entity?.position;

    for (const id in this.bot.entities) {
      const entity = this.bot.entities[id];
      if (!entity || entity === this.bot.entity) continue;
      if (entity.isValid === false) continue;
      if (typeof entity.health === 'number' && entity.health <= 0) continue;
      if (!entity.position) continue;

      // 1. Hostile Mobs nach Set
      const isHostileMob = entity.name && HOSTILE_MOBS.has(entity.name.toLowerCase());

      // 2. Aggressive NPCs oder angreifende Spieler
      const isAggressive = isHostileMob;

      if (!isAggressive) continue;

      // Prüfe, ob sich das Ziel im definierten Schutzbereich (ab Guard-Center) befindet
      const distToCenter = this.guardCenter.distanceTo(entity.position);
      if (distToCenter > this.guardRadius) continue;

      // Priorisiere nach Distanz zum Bot selbst für schnellste Reaktion
      const distToBot = botPos ? botPos.distanceTo(entity.position) : distToCenter;
      if (distToBot < minDistance) {
        minDistance = distToBot;
        closest = entity;
      }
    }

    return closest;
  }

  /**
   * Periodischer Tick des Wachdienstes.
   */
  async tick() {
    if (!this.isGuarding || !this.bot || this.isTicking) return;
    if (manualController.isActive()) return;
    this.isTicking = true;

    try {
      const criticalHealth = settings.SURVIVAL_CRITICAL_HEALTH || 8;
      const currentHealth = typeof this.bot.health === 'number' ? this.bot.health : 20;

      // 1. Notfall-Heilung bei kritischer Gesundheit
      if (currentHealth <= criticalHealth) {
        if (this.state !== GUARD_STATES.HEALING) {
          logger.warn(`[GuardManager] Gesundheit kritisch (${currentHealth}/20)! Weiche kurz zurück zum Heilen...`);
          this.state = GUARD_STATES.HEALING;
        }

        const food = this.bot.food ?? 20;
        if (food < 20 || currentHealth < 14) {
          await inventoryManager.eatBestFood(this.bot);
          return;
        } else {
          this.state = GUARD_STATES.PATROLLING;
        }
      }

      // 2. Zustandsverarbeitung
      switch (this.state) {
        case GUARD_STATES.PATROLLING: {
          const intruder = this.findHostileInZone();
          if (intruder) {
            this.state = GUARD_STATES.ENGAGING;
            this.currentTarget = intruder;
            const dist = this.bot.entity?.position ? this.bot.entity.position.distanceTo(intruder.position).toFixed(1) : '?';
            const alertMsg = `[Wachdienst] Eindringling erfasst: ${intruder.name} (${dist}m)! Greife an...`;
            logger.info(alertMsg);
            if (this.chatAlerts && typeof this.bot.chat === 'function') {
              this.bot.chat(alertMsg);
            }
            await inventoryManager.equipBestWeapon(this.bot);
            await inventoryManager.equipShield(this.bot);
          } else {
            // Wenn kein Feind im Bereich: Prüfe ob Bot zu weit vom Wachposten entfernt ist
            if (this.bot.entity?.position && this.guardCenter) {
              const distToPost = this.bot.entity.position.distanceTo(this.guardCenter);
              if (distToPost > 6.0 && this.bot.pathfinder) {
                const goals = await getPathfinderGoals();
                if (goals?.GoalNear) {
                  try {
                    this.bot.pathfinder.setGoal(new goals.GoalNear(this.guardCenter.x, this.guardCenter.y, this.guardCenter.z, 2));
                  } catch {}
                }
              }
            }
          }
          break;
        }

        case GUARD_STATES.ENGAGING: {
          if (!this.currentTarget || this.currentTarget.isValid === false || (typeof this.currentTarget.health === 'number' && this.currentTarget.health <= 0)) {
            this.defeatedCount++;
            const neutralMsg = `[Wachdienst] Ziel neutralisiert! (Gesamt eliminiert: ${this.defeatedCount})`;
            logger.info(neutralMsg);
            if (this.chatAlerts && typeof this.bot.chat === 'function') {
              this.bot.chat(neutralMsg);
            }

            this.currentTarget = null;
            this.state = GUARD_STATES.LOOTING;
            return;
          }

          // Prüfe, ob Ziel noch im Schutzbereich ist
          const distToCenter = this.guardCenter.distanceTo(this.currentTarget.position);
          if (distToCenter > this.guardRadius + 6) {
            logger.info(`[GuardManager] Ziel ${this.currentTarget.name} hat den Schutzbereich verlassen (${distToCenter.toFixed(1)}m). Breche Verfolgung ab.`);
            this.currentTarget = null;
            this.state = GUARD_STATES.RETURNING;
            return;
          }

          const result = await executeCombatStep({
            bot: this.bot,
            target: this.currentTarget,
            lastAttackTime: this.lastAttackTime,
            backpedalUntil: this.backpedalUntil,
            settings,
            findNearbyThreat: () => this.findHostileInZone()
          });

          this.lastAttackTime = result.lastAttackTime;
          this.backpedalUntil = result.backpedalUntil;
          this.currentTarget = result.target;

          if (result.neutralized) {
            this.defeatedCount++;
            this.currentTarget = null;
            this.state = GUARD_STATES.LOOTING;
          }
          break;
        }

        case GUARD_STATES.LOOTING: {
          // Gedroppte Beute einsammeln
          const collected = await harvestManager.collectNearbyDrops(this.bot, 6.0);
          if (collected > 0) {
            this.collectedLoot += collected;
            logger.debug(`[GuardManager] Beute eingesammelt (${collected} Items).`);
          }

          // Prüfe, ob noch weitere Feinde im Schutzbereich sind
          const nextIntruder = this.findHostileInZone();
          if (nextIntruder) {
            this.state = GUARD_STATES.ENGAGING;
            this.currentTarget = nextIntruder;
          } else {
            this.state = GUARD_STATES.RETURNING;
          }
          break;
        }

        case GUARD_STATES.RETURNING: {
          if (!this.bot.entity?.position || !this.guardCenter) {
            this.state = GUARD_STATES.PATROLLING;
            return;
          }

          const distToPost = this.bot.entity.position.distanceTo(this.guardCenter);
          if (distToPost <= 3.0) {
            this.state = GUARD_STATES.PATROLLING;
          } else if (this.bot.pathfinder) {
            const goals = await getPathfinderGoals();
            if (goals?.GoalNear) {
              try {
                this.bot.pathfinder.setGoal(new goals.GoalNear(this.guardCenter.x, this.guardCenter.y, this.guardCenter.z, 2));
              } catch {
                this.state = GUARD_STATES.PATROLLING;
              }
            }
          }
          break;
        }
      }
    } finally {
      this.isTicking = false;
    }
  }

  getStatus() {
    return {
      isGuarding: this.isGuarding,
      guardCenter: this.guardCenter ? { x: Math.round(this.guardCenter.x), y: Math.round(this.guardCenter.y), z: Math.round(this.guardCenter.z) } : null,
      guardRadius: this.guardRadius,
      state: this.state,
      defeatedCount: this.defeatedCount,
      collectedLoot: this.collectedLoot
    };
  }
}

export const guardManager = new GuardManager();
