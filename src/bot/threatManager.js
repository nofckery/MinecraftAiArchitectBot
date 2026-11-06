import { Vec3 } from 'vec3';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { inventoryManager } from './inventoryManager.js';
import { manualController } from './manualController.js';

export const THREAT_STATES = {
  IDLE: 'IDLE',
  ENGAGING: 'ENGAGING',
  RETREATING: 'RETREATING',
  HEALING: 'HEALING',
  SECURING_PERIMETER: 'SECURING_PERIMETER'
};
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';

export const HOSTILE_MOBS = new Set([
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'witch',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'pillager',
  'vindicator',
  'ravager',
  'evoker',
  'vex',
  'slime',
  'magma_cube',
  'silverfish',
  'endermite',
  'wither_skeleton',
  'blaze',
  'ghast',
  'hoglin',
  'piglin_brute',
  'warden',
  'wither',
  'ender_dragon'
]);

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
    if (!this.bot?.entities || !this.bot?.entity?.position) return null;

    let closestMob = null;
    let minDistance = radius;
    const botPos = this.bot.entity.position;

    for (const id in this.bot.entities) {
      const entity = this.bot.entities[id];
      if (!entity || entity === this.bot.entity) continue;
      if (entity.isValid === false) continue;
      if (typeof entity.health === 'number' && entity.health <= 0) continue;
      if (!entity.name || !HOSTILE_MOBS.has(entity.name.toLowerCase())) continue;
      if (!entity.position) continue;

      const dist = botPos.distanceTo(entity.position);
      if (dist <= minDistance) {
        minDistance = dist;
        closestMob = entity;
      }
    }

    return closestMob;
  }

  async handleBotHurt() {
    if (manualController.isActive()) return;
    logger.warn(`[ThreatManager] Bot wurde getroffen! HP: ${this.bot?.health}/20.`);

    // Bei kritischer Gesundheit sofort Rückzug
    const criticalHealth = settings.SURVIVAL_CRITICAL_HEALTH || 8;
    if (this.bot && this.bot.health <= criticalHealth) {
      return this.initiateRetreat();
    }

    // Wenn aktuell IDLE, sofort Bedrohung orten und bekämpfen
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

      // 1. Kritischer Gesundheitscheck: Erzwinge Rückzug wenn HP zu niedrig
      if (typeof this.bot.health === 'number' && this.bot.health <= criticalHealth) {
        if (this.state !== THREAT_STATES.RETREATING && this.state !== THREAT_STATES.HEALING) {
          await this.initiateRetreat();
          return;
        }
      }

      // 2. State-Machine
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

    // Bauauftrag pausieren, falls aktiv
    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeThreat = true;
      if (this.bot?.entity?.position) {
        this.returnPosition = this.bot.entity.position.clone();
      }
      worldExecutor.pauseBuild();
    }

    // Laufenden Bewegungsvorgang stoppen
    if (this.bot?.pathfinder && typeof this.bot.pathfinder.stop === 'function') {
      try {
        this.bot.pathfinder.stop();
      } catch {}
    }

    this.state = THREAT_STATES.ENGAGING;
    this.currentTarget = threat;
    this.backpedalUntil = 0;

    // Waffen & Schild ausrüsten
    await inventoryManager.equipBestWeapon(this.bot);
    await inventoryManager.equipShield(this.bot);
  }

  async combatStep() {
    const target = this.currentTarget;

    // Ziel ungültig, tot oder verschwunden?
    if (!target || target.isValid === false || (typeof target.health === 'number' && target.health <= 0)) {
      logger.info(`[ThreatManager] Ziel neutralisiert.`);
      this.currentTarget = null;
      this.backpedalUntil = 0;
      this.state = THREAT_STATES.SECURING_PERIMETER;
      return;
    }

    if (!this.bot?.entity?.position || !target.position) return;
    const dist = this.bot.entity.position.distanceTo(target.position);

    // Falls Ziel zu weit weggelaufen ist (>16m), prüfe ob nähere Bedrohung vorliegt
    if (dist > 16.0) {
      const closer = this.findNearbyThreat(settings.SURVIVAL_THREAT_RADIUS || 12.0);
      if (closer && closer !== target) {
        this.currentTarget = closer;
        this.backpedalUntil = 0;
        return;
      }
    }

    const now = Date.now();
    const cooldownMs = settings.SURVIVAL_ATTACK_COOLDOWN_MS || 625;
    const isBackpedaling = Boolean(this.backpedalUntil && now < this.backpedalUntil);

    if (this.backpedalUntil && now >= this.backpedalUntil) {
      this.backpedalUntil = 0;
    }

    // 1. Taktische Mob-Vorbereitung (Skelett / Stray: Schild heben/senken)
    if (target.name === 'skeleton' || target.name === 'stray') {
      if (dist > 3.5) {
        if (typeof this.bot.activateItem === 'function') {
          this.bot.activateItem(true);
        }
      } else {
        if (typeof this.bot.deactivateItem === 'function') {
          this.bot.deactivateItem();
        }
      }
    }

    // 2. Annäherung via Pathfinder
    // Schütze Rückzugsbewegung (Backpedal) vor dem Überschreiben durch GoalFollow.
    // Wenn Bot aktiv zurückweicht oder Creeper bereits in Schlagreichweite (<= 3.5m) ist,
    // kein GoalFollow aufschalten!
    const shouldApproach = dist > 3.0 && !isBackpedaling && !(target.name === 'creeper' && dist <= 3.5);
    if (shouldApproach && this.bot?.pathfinder) {
      try {
        const goals = await getPathfinderGoals();
        if (goals?.GoalFollow) {
          this.bot.pathfinder.setGoal(new goals.GoalFollow(target, 2.5), true);
        } else if (goals?.GoalNear) {
          this.bot.pathfinder.setGoal(new goals.GoalNear(target.position.x, target.position.y, target.position.z, 2.5));
        } else if (typeof this.bot.pathfinder.setGoal === 'function') {
          this.bot.pathfinder.setGoal({ x: target.position.x, y: target.position.y, z: target.position.z });
        }
      } catch {
        if (typeof this.bot?.pathfinder?.setGoal === 'function') {
          this.bot.pathfinder.setGoal({ x: target.position.x, y: target.position.y, z: target.position.z });
        }
      }
    }

    // 3. Schlag-Ausführung & Cooldown-Pacing
    if (dist <= 3.5 && (now - this.lastAttackTime) >= cooldownMs) {
      if (typeof this.bot.deactivateItem === 'function') {
        this.bot.deactivateItem(); // Schild vor Schlag absenken
      }
      if (typeof this.bot.lookAt === 'function') {
        const targetEye = target.position.offset(0, (target.height || 1.6) * 0.85, 0);
        await this.bot.lookAt(targetEye);
      }
      if (typeof this.bot.attack === 'function') {
        this.bot.attack(target);
        this.lastAttackTime = Date.now();
      }

      // Prüfen ob Mob durch den Schlag neutralisiert wurde
      if (target.isValid === false || (typeof target.health === 'number' && target.health <= 0)) {
        logger.info(`[ThreatManager] Ziel neutralisiert.`);
        this.currentTarget = null;
        this.backpedalUntil = 0;
        this.state = THREAT_STATES.SECURING_PERIMETER;
        return;
      }

      // Spezifische Creeper-Taktik: Nach Schlag sofortiges 4m Zurückweichen einleiten
      if (target.name === 'creeper') {
        const diff = this.bot.entity.position.minus(target.position);
        const d = typeof diff.norm === 'function' ? diff.norm() : Math.sqrt(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
        let stepAway;
        if (d > 0.001) {
          stepAway = diff.normalize().scaled(4.0);
        } else {
          stepAway = new Vec3(4.0, 0, 0);
        }
        const safeGoal = this.bot.entity.position.plus(stepAway);

        this.backpedalUntil = Date.now() + 1500;

        if (this.bot?.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals?.GoalNear) {
              this.bot.pathfinder.setGoal(new goals.GoalNear(safeGoal.x, safeGoal.y, safeGoal.z, 1.0));
            } else if (typeof this.bot.pathfinder.setGoal === 'function') {
              this.bot.pathfinder.setGoal({ x: safeGoal.x, y: safeGoal.y, z: safeGoal.z });
            }
          } catch {
            if (typeof this.bot?.pathfinder?.setGoal === 'function') {
              this.bot.pathfinder.setGoal({ x: safeGoal.x, y: safeGoal.y, z: safeGoal.z });
            }
          }
        }
      }
    }
  }

  async initiateRetreat() {
    logger.warn(`[ThreatManager] Kritische Gesundheit (${this.bot?.health}/20)! Starte taktischen Rückzug...`);
    this.state = THREAT_STATES.RETREATING;

    if (typeof this.bot?.deactivateItem === 'function') {
      this.bot.deactivateItem();
    }

    // Bauvorgang sichern falls noch nicht erfolgt
    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeThreat = true;
      if (this.bot?.entity?.position) {
        this.returnPosition = this.bot.entity.position.clone();
      }
      worldExecutor.pauseBuild();
    }

    if (this.bot?.pathfinder) {
      if (typeof this.bot.pathfinder.stop === 'function') {
        try {
          this.bot.pathfinder.stop();
        } catch {}
      }

      if (typeof this.bot.setControlState === 'function') {
        this.bot.setControlState('sprint', true);
      }

      const retreatDist = settings.SURVIVAL_RETREAT_DISTANCE || 15.0;
      let retreatVector;

      if (this.currentTarget?.position && this.bot?.entity?.position) {
        const diff = this.bot.entity.position.minus(this.currentTarget.position);
        const dist = typeof diff.norm === 'function' ? diff.norm() : Math.sqrt(diff.x * diff.x + diff.y * diff.y + diff.z * diff.z);
        if (dist > 0.001) {
          retreatVector = diff.normalize().scaled(retreatDist);
        } else {
          retreatVector = new Vec3(retreatDist, 0, retreatDist);
        }
      } else {
        retreatVector = new Vec3(retreatDist, 0, retreatDist);
      }

      const safePos = this.bot.entity.position.plus(retreatVector);
      try {
        const goals = await getPathfinderGoals();
        if (goals?.GoalNear) {
          this.bot.pathfinder.setGoal(new goals.GoalNear(safePos.x, safePos.y, safePos.z, 2.0));
        } else if (typeof this.bot.pathfinder.setGoal === 'function') {
          this.bot.pathfinder.setGoal({ x: safePos.x, y: safePos.y, z: safePos.z });
        }
      } catch {
        if (typeof this.bot?.pathfinder?.setGoal === 'function') {
          this.bot.pathfinder.setGoal({ x: safePos.x, y: safePos.y, z: safePos.z });
        }
      }
    }
  }

  async retreatStep() {
    // Sicherheitsabstand prüfen (keine Bedrohungen innerhalb 8m)
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
    // 1. Bedrohung im Perimeter prüfen: Falls feindlicher Mob auftaucht, nicht blind weiterheilen!
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

    // Wenn Hunger besteht oder Gesundheit nicht voll und Nahrung aufnehmbar
    if (food < 18 || (health < 16 && food < 20)) {
      const ate = await inventoryManager.eatBestFood(this.bot);
      if (!ate) {
        logger.warn('[ThreatManager] Keine essbare Nahrung im Inventar verfügbar.');
        this.state = THREAT_STATES.SECURING_PERIMETER;
        return;
      }
      return;
    }

    // Wenn Gesundheit ausreichend regeneriert (>= 14) oder Hunger bereits voll (food >= 20)
    // Bei vollem Hunger kann keine weitere Nahrung konsumiert werden -> Softlock verhindern!
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

    // Pausierten Bauauftrag fortsetzen
    if (this.wasBuildingBeforeThreat && worldExecutor.pausedState) {
      this.wasBuildingBeforeThreat = false;
      logger.info('[ThreatManager] Setze pausierten Bauauftrag nach Bedrohungsabwehr fort...');

      // Falls Bot sich weit vom Bauplatz entfernt hat, zurücklaufen
      const targetPos = this.returnPosition;
      if (targetPos && this.bot?.entity?.position && this.bot.pathfinder) {
        const distToBuild = this.bot.entity.position.distanceTo(targetPos);
        if (distToBuild > 3.5 && typeof this.bot.pathfinder.goto === 'function') {
          try {
            const goals = await getPathfinderGoals();
            if (goals?.GoalNear) {
              await this.bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2.5));
            } else {
              await this.bot.pathfinder.goto({ x: targetPos.x, y: targetPos.y, z: targetPos.z });
            }
          } catch (navErr) {
            logger.debug(`[ThreatManager] Navigation zurück zum Bauplatz: ${navErr.message}`);
          }
        }
      }

      await worldExecutor.resumeBuild(this.bot);
    }
  }
}

export const threatManager = new ThreatManager();
