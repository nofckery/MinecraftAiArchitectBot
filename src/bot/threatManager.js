import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { inventoryManager } from './inventoryManager.js';
import { manualController } from './manualController.js';
import { HOSTILE_MOBS, findNearbyThreat } from './threat/threatRadar.js';
import { executeCombatStep } from './threat/threatCombat.js';
import { executeInitiateRetreat, returnToBuildSite } from './threat/threatRetreat.js';

export const THREAT_STATES = {
  IDLE: 'IDLE',
  ENGAGING: 'ENGAGING',
  RETREATING: 'RETREATING',
  HEALING: 'HEALING',
  SECURING_PERIMETER: 'SECURING_PERIMETER'
};

export { HOSTILE_MOBS };

export class ThreatManager {
  constructor(bot = null) {
    this.bot = bot;
    this.state = THREAT_STATES.IDLE;
    this.currentTarget = null;
    this.lastAttackTime = 0;
    this.scanInterval = null;
    this.wasBuildingBeforeThreat = false;
    this.returnPosition = null;
    this.isTicking = false;
    this.hurtListener = null;
    this.backpedalUntil = 0;
  }

  get target() {
    return this.currentTarget;
  }

  set target(val) {
    this.currentTarget = val;
  }

  isPathfinderRunning() {
    if (!this.bot?.pathfinder) return false;
    if (typeof this.bot.pathfinder.isMoving === 'function') {
      try {
        return Boolean(this.bot.pathfinder.isMoving());
      } catch {
        return false;
      }
    }
    return Boolean(this.bot.currentGoal || this.bot.pathfinder.goal);
  }

  setBot(bot) {
    if (this.bot && this.hurtListener) {
      try {
        this.bot.removeListener('entityHurt', this.hurtListener);
      } catch {}
    }
    this.bot = bot;
    if (this.bot) {
      this.bindEvents();
    }
  }

  bindEvents() {
    if (!this.bot || typeof this.bot.on !== 'function') return;

    this.hurtListener = (entity) => {
      if (entity === this.bot.entity) {
        this.handleBotHurt();
      }
    };
    this.bot.on('entityHurt', this.hurtListener);
  }

  startMonitoring(intervalMs = 500) {
    this.stopMonitoring();
    if (this.bot) {
      this.bindEvents();
    }
    this.scanInterval = setInterval(() => {
      this.tick().catch(err => {
        logger.debug(`[ThreatManager] Fehler in tick(): ${err.message}`);
      });
    }, intervalMs);
  }

  stopMonitoring() {
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    if (this.bot && this.hurtListener) {
      try {
        this.bot.removeListener('entityHurt', this.hurtListener);
      } catch {}
      this.hurtListener = null;
    }
  }

  findNearbyThreat(radius = settings.SURVIVAL_THREAT_RADIUS || 12.0) {
    return findNearbyThreat(this.bot, radius);
  }

  async handleBotHurt() {
    if (manualController.isActive()) return;
    logger.warn(`[ThreatManager] Bot wurde getroffen! HP: ${this.bot?.health}/20.`);

    await inventoryManager.equipBestArmor(this.bot);
    await inventoryManager.equipShield(this.bot);

    const criticalHealth = settings.SURVIVAL_CRITICAL_HEALTH || 8;
    if (this.bot && this.bot.health <= criticalHealth) {
      return this.initiateRetreat();
    }

    if (this.state === THREAT_STATES.IDLE) {
      const threat = this.findNearbyThreat(settings.SURVIVAL_THREAT_RADIUS || 12.0);
      if (threat) {
        await this.engageThreat(threat);
      }
    }
  }

  async tick() {
    if (!this.bot || this.isTicking) return;
    if (manualController.isActive()) return;
    this.isTicking = true;

    try {
      const criticalHealth = settings.SURVIVAL_CRITICAL_HEALTH || 8;

      if (typeof this.bot.health === 'number' && this.bot.health <= criticalHealth) {
        if (this.state !== THREAT_STATES.RETREATING && this.state !== THREAT_STATES.HEALING) {
          await this.initiateRetreat();
          return;
        }
      }

      switch (this.state) {
        case THREAT_STATES.IDLE: {
          const threat = this.findNearbyThreat(settings.SURVIVAL_THREAT_RADIUS || 12.0);
          if (threat) {
            await this.engageThreat(threat);
          }
          break;
        }

        case THREAT_STATES.ENGAGING: {
          await this.combatStep();
          break;
        }

        case THREAT_STATES.RETREATING: {
          await this.retreatStep();
          break;
        }

        case THREAT_STATES.HEALING: {
          await this.healingStep();
          break;
        }

        case THREAT_STATES.SECURING_PERIMETER: {
          await this.securingStep();
          break;
        }
      }
    } finally {
      this.isTicking = false;
    }
  }

  async engageThreat(threat) {
    if (!threat || !threat.position) return;
    const dist = this.bot?.entity?.position ? this.bot.entity.position.distanceTo(threat.position).toFixed(1) : '?';
    logger.warn(`[ThreatManager] Feindliche Bedrohung erkannt: ${threat.name} in ${dist}m Entfernung!`);

    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeThreat = true;
      if (this.bot?.entity?.position) {
        this.returnPosition = this.bot.entity.position.clone();
      }
      worldExecutor.pauseBuild();
    }

    if (this.bot?.pathfinder && typeof this.bot.pathfinder.stop === 'function') {
      try {
        this.bot.pathfinder.stop();
      } catch {}
    }

    this.state = THREAT_STATES.ENGAGING;
    this.currentTarget = threat;
    this.backpedalUntil = 0;

    await inventoryManager.equipBestArmor(this.bot);
    await inventoryManager.equipBestWeapon(this.bot);
    await inventoryManager.equipShield(this.bot);
  }

  async combatStep() {
    const result = await executeCombatStep({
      bot: this.bot,
      target: this.currentTarget,
      lastAttackTime: this.lastAttackTime,
      backpedalUntil: this.backpedalUntil,
      settings,
      findNearbyThreat: (r) => this.findNearbyThreat(r)
    });

    this.lastAttackTime = result.lastAttackTime;
    this.backpedalUntil = result.backpedalUntil;
    this.currentTarget = result.target;

    if (result.neutralized) {
      this.state = THREAT_STATES.SECURING_PERIMETER;
    }
  }

  async initiateRetreat() {
    logger.warn(`[ThreatManager] Kritische Gesundheit (${this.bot?.health}/20)! Starte taktischen Rückzug...`);
    this.state = THREAT_STATES.RETREATING;

    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeThreat = true;
      if (this.bot?.entity?.position) {
        this.returnPosition = this.bot.entity.position.clone();
      }
      worldExecutor.pauseBuild();
    }

    await executeInitiateRetreat({
      bot: this.bot,
      currentTarget: this.currentTarget,
      settings
    });
  }

  async retreatStep() {
    const nearby = this.findNearbyThreat(8.0);
    if (!nearby) {
      logger.info('[ThreatManager] Sicherheitsabstand erreicht. Wechsle in Heilungsmodus...');
      if (typeof this.bot?.setControlState === 'function') {
        this.bot.setControlState('sprint', false);
      }
      this.state = THREAT_STATES.HEALING;
    }
  }

  async healingStep() {
    const threat = this.findNearbyThreat(settings.SURVIVAL_THREAT_RADIUS || 12.0);
    if (threat) {
      const criticalHealth = settings.SURVIVAL_CRITICAL_HEALTH || 8;
      if (this.bot && typeof this.bot.health === 'number' && this.bot.health <= criticalHealth) {
        logger.warn(`[ThreatManager] Bedrohung während Heilung erkannt (${threat.name}), Gesundheit kritisch! Setze Rückzug fort.`);
        this.currentTarget = threat;
        return this.initiateRetreat();
      } else {
        logger.warn(`[ThreatManager] Bedrohung während Heilung entdeckt (${threat.name}). Wechsle in Kampfmodus!`);
        return this.engageThreat(threat);
      }
    }

    const food = this.bot?.food ?? 20;
    const health = this.bot?.health ?? 20;

    if (food < 18 || (health < 16 && food < 20)) {
      const ate = await inventoryManager.eatBestFood(this.bot);
      if (!ate) {
        logger.warn('[ThreatManager] Keine essbare Nahrung im Inventar verfügbar.');
        this.state = THREAT_STATES.SECURING_PERIMETER;
        return;
      }
      return;
    }

    if (health >= 14 || food >= 20) {
      logger.info(`[ThreatManager] Heilungsphase abgeschlossen (Health: ${health}/20, Food: ${food}/20). Wechsle zu Perimetersicherung...`);
      this.state = THREAT_STATES.SECURING_PERIMETER;
    }
  }

  async securingStep() {
    const remainingThreat = this.findNearbyThreat(settings.SURVIVAL_THREAT_RADIUS || 12.0);
    if (remainingThreat) {
      logger.warn(`[ThreatManager] Weitere Bedrohung im Perimeter entdeckt (${remainingThreat.name}).`);
      return this.engageThreat(remainingThreat);
    }

    logger.info('[ThreatManager] Perimeter gesichert! Keine Bedrohungen mehr in Reichweite.');
    this.state = THREAT_STATES.IDLE;
    this.currentTarget = null;

    if (this.wasBuildingBeforeThreat && worldExecutor.pausedState) {
      this.wasBuildingBeforeThreat = false;
      logger.info('[ThreatManager] Setze pausierten Bauauftrag nach Bedrohungsabwehr fort...');

      await returnToBuildSite(this.bot, this.returnPosition);
      await worldExecutor.resumeBuild(this.bot);
    }
  }
}

export const threatManager = new ThreatManager();
