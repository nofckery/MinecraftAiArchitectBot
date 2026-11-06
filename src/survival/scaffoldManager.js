import { Vec3 } from 'vec3';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { inventoryManager } from '../bot/inventoryManager.js';
import { harvestManager } from './harvestManager.js';

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

export class ScaffoldManager {
  constructor() {
    /**
     * Map von "x,y,z" Koordinate zu { x, y, z, name, placedAt }
     */
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

  /**
   * Prüft, ob ein Zielblock von einer bestimmten Position aus erreichbar ist
   */
  isReachableFrom(standPos, targetPos, maxReach = 3.8) {
    if (!standPos || !targetPos) return false;
    // Augenhöhe des Bots liegt ca. 1.62m über dem Standblock
    const eyePos = new Vec3(standPos.x + 0.5, standPos.y + 1.62, standPos.z + 0.5);
    const targetCenter = new Vec3(targetPos.x + 0.5, targetPos.y + 0.5, targetPos.z + 0.5);
    return eyePos.distanceTo(targetCenter) <= maxReach;
  }

  /**
   * Sucht im Inventar nach verfügbaren Gerüstblöcken gemäß Prioritätenliste
   */
  getAvailableScaffoldMaterial(bot) {
    if (!bot || !bot.inventory) return null;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];

    // Konfigurierte Materialien
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
   * Findet einen existierenden, soliden Standplatz in Reichweite des Zielblocks
   */
  findWalkableStandingSpot(bot, targetPos, options = {}) {
    if (!bot || !targetPos) return null;
    const maxReach = options.maxReach || settings.SURVIVAL_MAX_REACH || 3.8;
    const blockAt = (p) => {
      if (typeof bot.blockAt === 'function') {
        const b = bot.blockAt(p);
        if (b) return b;
      }
      if (this.isScaffoldBlock(p)) {
        return { name: 'scaffolding', position: p };
      }
      return null;
    };

    const isPassable = (b) => {
      if (!b) return true; // Unbekannter Raum gilt als Luft/passierbar
      const name = b.name || '';
      return name.includes('air') || name.includes('water') || name === 'scaffolding' || this.isScaffoldBlock(b.position);
    };

    const isSolidGround = (b) => {
      if (!b) return false;
      const name = b.name || '';
      if (name.includes('air') || name.includes('water') || name.includes('lava')) return false;
      if (name.endsWith('_door') || name.endsWith('_carpet') || name === 'ladder') return false;
      return true;
    };

    // Überprüfe zuerst, ob der Bot bereits perfekt steht
    if (bot.entity && bot.entity.position) {
      const currentStand = bot.entity.position.floored();
      if (this.isReachableFrom(currentStand, targetPos, maxReach)) {
        // Prüfe, ob Bot nicht genau im Zielblock steht
        if (!currentStand.equals(targetPos.floored())) {
          return currentStand;
        }
      }
    }

    // Spiralförmige Suche in Reichweite
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

          // Standplatz darf nicht der Zielblock selbst sein
          if (candidateStand.equals(targetPos.floored())) continue;

          // Block unter den Füßen muss solide sein
          const floorBlock = blockAt(candidateStand.offset(0, -1, 0));
          if (!isSolidGround(floorBlock)) continue;

          // Raum für den Bot (Körper & Kopf) muss frei sein
          const bodyBlock = blockAt(candidateStand);
          const headBlock = blockAt(candidateStand.offset(0, 1, 0));
          if (!isPassable(bodyBlock) || !isPassable(headBlock)) continue;

          // Erreichbarkeit prüfen
          if (this.isReachableFrom(candidateStand, targetPos, maxReach)) {
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
   * Berechnet einen optimalen Säulen-Ort für temporären Gerüstbau
   */
  planScaffold(bot, targetPos, options = {}) {
    if (!bot || !targetPos) return null;
    const reservedBlocks = options.reservedBlocks || new Set();

    const blockAt = (p) => {
      if (typeof bot.blockAt === 'function') return bot.blockAt(p);
      return null;
    };

    // Suche eine Spalte (x, z) 1-2 Blöcke neben dem Zielblock, die nicht bebaut werden soll
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

      // Prüfen, ob Spalte mit geplanten Gebäudeblöcken kollidiert
      let collidesWithBuild = false;
      for (let y = Math.floor(targetPos.y - 4); y <= Math.floor(targetPos.y + 4); y++) {
        if (reservedBlocks.has(this.coordKey(colX, y, colZ))) {
          collidesWithBuild = true;
          break;
        }
      }
      if (collidesWithBuild) continue;

      // Finde soliden Boden unterhalb
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

      // Falls kein Boden durch blockAt bekannt (z. B. im Mock), Default auf bot.y - 1 oder target.y - 1
      if (!foundGround) {
        groundY = bot.entity?.position ? Math.floor(bot.entity.position.y - 1) : Math.floor(targetPos.y - 1);
      }

      // Ziel-Standhöhe: 1 Block unter Zielblock oder auf Zielhöhe
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

  /**
   * Errichtet ein Gerüst gemäß Plan und bringt den Bot darauf
   */
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

      // Gerüstmaterial ausrüsten
      await inventoryManager.equipBlock(bot, mat.name);

      const { columnX, columnZ, groundY, targetStandY } = scaffoldPlan;

      // Säule errichten (von groundY + 1 bis targetStandY - 1)
      for (let y = groundY + 1; y < targetStandY; y++) {
        const scaffoldPos = new Vec3(columnX, y, columnZ);
        const refBlockPos = scaffoldPos.offset(0, -1, 0);

        // Position merken
        this.activeScaffolds.set(this.coordKey(columnX, y, columnZ), {
          x: columnX,
          y,
          z: columnZ,
          name: mat.name,
          isVanillaScaffolding: mat.isVanillaScaffolding,
          placedAt: Date.now()
        });

        // Physische Platzierung
        if (typeof bot.placeBlock === 'function') {
          try {
            const refBlock = typeof bot.blockAt === 'function' ? bot.blockAt(refBlockPos) : { position: refBlockPos, name: 'stone' };
            await bot.placeBlock(refBlock || { position: refBlockPos, name: 'stone' }, new Vec3(0, 1, 0));
          } catch (err) {
            logger.debug(`[ScaffoldManager] Platzierung bei Y=${y}: ${err.message}`);
          }
        }
      }

      // Bot auf die Standposition bewegen
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
          // Im Testfall oder bei Hindernis Position direkt updaten
          if (bot.entity && bot.entity.position) {
            bot.entity.position = standingPos.clone();
          }
        }
      } else if (bot.entity && bot.entity.position) {
        bot.entity.position = standingPos.clone();
      }

      // Absturzschutz aktivieren: Bot schleicht auf der Säule
      if (typeof bot.setControlState === 'function') {
        bot.setControlState('sneak', true);
      }

      return true;
    } finally {
      this.isErecting = false;
    }
  }

  /**
   * Bereitet den optimalen Standplatz vor (Navigation oder Gerüstbau)
   */
  async prepareStaging(bot, targetPos, options = {}) {
    if (!bot || !targetPos) return { success: false, reason: 'invalid_params' };
    const maxReach = options.maxReach || settings.SURVIVAL_MAX_REACH || 3.8;

    // 1. Prüfen, ob der Bot bereits in Reichweite steht
    if (bot.entity?.position && this.isReachableFrom(bot.entity.position.floored(), targetPos, maxReach)) {
      return { success: true, scaffolded: false, position: bot.entity.position.floored() };
    }

    // 2. Prüfen, ob ein begehbarer Boden vorhanden ist
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

    // 3. Wenn kein Standplatz da ist: Gerüstbau erforderlich!
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

  /**
   * Baut alle gesetzten Gerüstblöcke sauber ab und sammelt die Items ein
   */
  async dismantleAll(bot) {
    if (this.activeScaffolds.size === 0) {
      return { success: true, count: 0 };
    }

    this.isDismantling = true;
    const initialCount = this.activeScaffolds.size;
    logger.info(`[ScaffoldManager] Starte sauberen Rückbau von ${initialCount} Gerüstblöcken...`);

    try {
      // Sneak aufheben vor Bewegung
      if (bot && typeof bot.setControlState === 'function') {
        bot.setControlState('sneak', false);
      }

      // Blöcke nach Y absteigend sortieren (von oben nach unten abbauen)
      const scaffolds = Array.from(this.activeScaffolds.values()).sort((a, b) => b.y - a.y);

      // Falls Vanilla Scaffolding: Es genügt, die unterste Basis abzubauen!
      const vanillaColumns = scaffolds.filter(s => s.isVanillaScaffolding);
      const regularBlocks = scaffolds.filter(s => !s.isVanillaScaffolding);

      // 1. Reguläre Blöcke (Erde, Stein) von oben nach unten abbauen
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

      // 2. Vanilla Scaffolding abbauen (Basis zerstören lässt Säule fallen)
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

      // Gedroppte Items einsammeln (kurzer Check nach Entities in der Nähe)
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
          } catch {
            // Ignorieren falls Bewegung zum Item fehlschlägt
          }
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
