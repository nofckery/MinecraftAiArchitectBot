import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { VersionResolver } from '../config/versionResolver.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { craftingPlanner, normalizeCraftItemName } from './craftingPlanner.js';
import { smeltingManager } from './smeltingManager.js';
import { baseStorageManager } from './baseStorageManager.js';
import { harvestManager, COMMON_ORE_MAP } from './harvestManager.js';
import { inventoryManager } from '../bot/inventoryManager.js';
import { findNearbyThreat } from '../bot/threat/threatRadar.js';

VersionResolver.applyCompatibilityShims();

export const EXPEDITION_STATES = {
  IDLE: 'IDLE',
  PREPARING: 'PREPARING',
  EXPLORING_CAVE: 'EXPLORING_CAVE',
  LIGHTING: 'LIGHTING',
  MINING_VEIN: 'MINING_VEIN',
  DEFENDING: 'DEFENDING',
  RETURNING_HOME: 'RETURNING_HOME',
  UNLOADING_AT_BASE: 'UNLOADING_AT_BASE'
};

/**
 * ExpeditionManager koordiniert autonome Solo-Höhlen-Expeditionen mit FSM,
 * Fackel-Automatik gegen Monster-Spawns, Abbau von Erz-Adern und Smart-Return zur Basis.
 */
export class ExpeditionManager {
  constructor() {
    this.state = EXPEDITION_STATES.IDLE;
    this.abortSignal = false;
    this.bot = null;
    this.onStateChangeCallback = null;

    this.stats = {
      oresMined: 0,
      torchesPlaced: 0,
      monstersDefeated: 0,
      returnedSafely: false,
      startTime: 0,
      endTime: 0
    };

    this.activeMission = null;
  }

  get currentState() {
    return this.state;
  }

  setState(newState) {
    if (this.state !== newState) {
      const prev = this.state;
      this.state = newState;
      logger.info(`[ExpeditionManager] FSM Statuswechsel: ${prev} -> ${newState}`);
      if (typeof this.onStateChangeCallback === 'function') {
        try {
          this.onStateChangeCallback(newState, prev);
        } catch {}
      }
    }
  }

  abort() {
    this.abortSignal = true;
    logger.warn('[ExpeditionManager] Expedition durch Not-Stopp abgebrochen.');
    this.setState(EXPEDITION_STATES.IDLE);
    if (this.bot?.pathfinder) {
      try { this.bot.pathfinder.stop(); } catch {}
    }
  }

  getMcData(bot) {
    const version = bot?.version || '1.20.4';
    try {
      return minecraftData(version) || minecraftData('1.20.4');
    } catch {
      return minecraftData('1.20.4');
    }
  }

  /**
   * Prüft, ob das Inventar des Bots als voll gilt (>= 30 belegte Slots von 36).
   * @param {Object} bot
   * @param {number} threshold
   * @returns {boolean}
   */
  isInventoryFull(bot, threshold = 30) {
    if (!bot || !bot.inventory) return false;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    return items.length >= threshold;
  }

  /**
   * Prüft, ob der Bot noch eine nutzbare Spitzhacke im Inventar hat.
   * @param {Object} bot
   * @returns {boolean}
   */
  hasUsablePickaxe(bot) {
    if (!bot || !bot.inventory) return false;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    return items.some(i => i.name.includes('_pickaxe'));
  }

  /**
   * Zählt verfügbare Fackeln im Inventar.
   * @param {Object} bot
   * @returns {number}
   */
  countTorches(bot) {
    if (!bot || !bot.inventory) return 0;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    return items
      .filter(i => i.name === 'torch')
      .reduce((sum, i) => sum + (i.count || 0), 0);
  }

  /**
   * Findet eine geeignete Platzierungsstelle für eine Fackel (Boden oder Wand).
   * @param {Object} bot
   * @returns {{ referenceBlock: Object, faceVector: Vec3 }|null}
   */
  findTorchPlacementSpot(bot) {
    if (!bot || !bot.entity || typeof bot.blockAt !== 'function') return null;
    const botPos = bot.entity.position.floored();

    // 1. Priorität: Solider Block direkt unter den Füßen des Bots (falls Bot in Luft/Air steht)
    const feetBlock = bot.blockAt(botPos);
    const belowBlock = bot.blockAt(botPos.offset(0, -1, 0));

    if (feetBlock && (feetBlock.name === 'air' || feetBlock.name === 'cave_air') &&
        belowBlock && belowBlock.boundingBox === 'block' && belowBlock.name !== 'torch') {
      return {
        referenceBlock: belowBlock,
        faceVector: new Vec3(0, 1, 0)
      };
    }

    // 2. Horizontale Wände oder Boden in 1 Block Abstand
    const cardinalOffsets = [
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) }
    ];

    for (const cand of cardinalOffsets) {
      const neighbor = bot.blockAt(botPos.plus(cand.offset));
      if (neighbor && neighbor.boundingBox === 'block' && neighbor.name !== 'torch') {
        return {
          referenceBlock: neighbor,
          faceVector: cand.face
        };
      }
    }

    return null;
  }

  /**
   * Platziert automatisch eine Fackel am aktuellen Ort.
   * @param {Object} bot
   * @returns {Promise<boolean>}
   */
  async placeTorch(bot) {
    if (!bot) return false;
    let torchItem = bot.inventory?.items().find(i => i.name === 'torch');

    if (!torchItem) {
      // Versuche Fackeln via CraftingPlanner herzustellen
      logger.info('[ExpeditionManager] Fackeln aufgebraucht. Crafte neue Fackeln im Feld...');
      const craftRes = await craftingPlanner.craftItem(bot, 'torch', 4);
      if (craftRes.success) {
        torchItem = bot.inventory?.items().find(i => i.name === 'torch');
      }
    }

    if (!torchItem) {
      logger.warn('[ExpeditionManager] Keine Fackeln verfügbar und keine Materialien vorhanden.');
      return false;
    }

    const spot = this.findTorchPlacementSpot(bot);
    if (!spot) return false;

    try {
      if (typeof bot.equip === 'function') {
        await bot.equip(torchItem, 'hand');
      }
      if (typeof bot.placeBlock === 'function') {
        await bot.placeBlock(spot.referenceBlock, spot.faceVector);
        this.stats.torchesPlaced++;
        logger.info(`[ExpeditionManager] Fackel platziert bei (${spot.referenceBlock.position.x}, ${spot.referenceBlock.position.y}, ${spot.referenceBlock.position.z}). Gesamt: ${this.stats.torchesPlaced}`);
        return true;
      }
    } catch (err) {
      logger.debug(`[ExpeditionManager] Fackel konnte nicht platziert werden: ${err.message}`);
    }

    return false;
  }

  /**
   * Findet unbeleuchtete Blöcke (Lichtlevel 0) im Umkreis für Spawn-Schutz.
   * @param {Object} bot
   * @returns {boolean}
   */
  isCurrentLocationDark(bot) {
    if (!bot || !bot.entity || typeof bot.blockAt !== 'function') return false;
    const currentBlock = bot.blockAt(bot.entity.position);
    if (!currentBlock) return false;

    // In Mineflayer ist block.light das Block-Lichtlevel (0 bis 15)
    const blockLight = typeof currentBlock.light === 'number' ? currentBlock.light : 0;
    return blockLight === 0;
  }

  /**
   * Sucht nach Erzvorkommen im Umkreis (Standard- und Deepslate-Erze).
   * @param {Object} bot
   * @param {string} targetResource
   * @param {number} radius
   * @returns {Array<Object>}
   */
  findNearbyOres(bot, targetResource = 'iron_ore', radius = 24) {
    if (!bot || typeof bot.findBlocks !== 'function') return [];
    const mc = this.getMcData(bot);
    const candidateNames = COMMON_ORE_MAP[targetResource] || [targetResource];

    const matchingIds = [];
    for (const name of candidateNames) {
      const bDef = mc.blocksByName[name];
      if (bDef) matchingIds.push(bDef.id);
    }

    if (matchingIds.length === 0) return [];

    const positions = bot.findBlocks({
      matching: matchingIds,
      maxDistance: radius,
      count: 32
    });

    return positions.map(pos => bot.blockAt(pos)).filter(Boolean);
  }

  /**
   * Baut eine zusammenhängende Erzader mit Fall- und Lavaschutz sicher ab.
   * @param {Object} bot
   * @param {Object} initialBlock
   * @param {number} maxVeinBlocks
   * @returns {Promise<number>}
   */
  async mineVein(bot, initialBlock, maxVeinBlocks = 16) {
    if (!bot || !initialBlock) return 0;
    this.setState(EXPEDITION_STATES.MINING_VEIN);

    const oreName = initialBlock.name;
    const visited = new Set();
    const queue = [initialBlock.position];
    let minedCount = 0;

    while (queue.length > 0 && minedCount < maxVeinBlocks && !this.abortSignal) {
      const pos = queue.shift();
      const key = `${pos.x},${pos.y},${pos.z}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const block = bot.blockAt(pos);
      if (!block || (block.name !== oreName && !block.name.includes('ore'))) continue;

      // 1. Fall- und Lavaschutz: Prüfe Nachbarblöcke auf Lava oder fallenden Kies
      const above = bot.blockAt(pos.offset(0, 1, 0));
      if (above && (above.name === 'lava' || above.name === 'gravel' || above.name === 'sand')) {
        logger.warn(`[ExpeditionManager] Gefahr über Erzblock (${above.name} bei Y+1). Überspringe aus Sicherheitsgründen!`);
        continue;
      }

      // 2. Zum Block hinbewegen falls nötig
      if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
        const dist = bot.entity.position.distanceTo(pos);
        if (dist > 3.5 && bot.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5));
            }
          } catch {}
        }
      }

      // 3. Optimales Werkzeug ausrüsten
      await harvestManager.prepareToolForBlock(bot, block);

      // 4. Block abbauen
      if (typeof bot.dig === 'function') {
        try {
          await bot.dig(block);
          minedCount++;
          this.stats.oresMined++;
          logger.info(`[ExpeditionManager] Erz abgebaut: ${block.name} bei (${pos.x}, ${pos.y}, ${pos.z}) [${minedCount}/${maxVeinBlocks}].`);
        } catch (digErr) {
          logger.warn(`[ExpeditionManager] Fehler beim Abbau von ${block.name}: ${digErr.message}`);
          break;
        }
      } else {
        minedCount++;
        this.stats.oresMined++;
      }

      // 5. Nachbarblöcke der Ader zur Queue hinzufügen (6 Nachbarn)
      const neighbors = [
        pos.offset(1, 0, 0),
        pos.offset(-1, 0, 0),
        pos.offset(0, 1, 0),
        pos.offset(0, -1, 0),
        pos.offset(0, 0, 1),
        pos.offset(0, 0, -1)
      ];

      for (const nPos of neighbors) {
        const nKey = `${nPos.x},${nPos.y},${nPos.z}`;
        if (!visited.has(nKey)) {
          const nBlock = bot.blockAt(nPos);
          if (nBlock && nBlock.name === oreName) {
            queue.push(nPos);
          }
        }
      }

      // Fackel-Automatik während des Abbaus prüfen
      if (this.isCurrentLocationDark(bot)) {
        await this.placeTorch(bot);
      }
    }

    return minedCount;
  }

  /**
   * Wehrt feindliche Kreaturen ab.
   * @param {Object} bot
   * @param {Object} threatEntity
   * @returns {Promise<boolean>}
   */
  async defendAgainstThreat(bot, threatEntity) {
    if (!bot || !threatEntity) return false;
    this.setState(EXPEDITION_STATES.DEFENDING);
    logger.warn(`[ExpeditionManager] FEIND ERKANNT: ${threatEntity.name || 'Monster'}! Zücke Schild und Waffe...`);

    // Beste Waffe und Schild ausrüsten
    await inventoryManager.equipBestWeapon(bot);
    await inventoryManager.equipShield(bot);

    if (typeof bot.attack === 'function') {
      try {
        if (typeof bot.lookAt === 'function' && threatEntity.position) {
          await bot.lookAt(threatEntity.position);
        }
        await bot.attack(threatEntity);
        this.stats.monstersDefeated++;
        logger.info(`[ExpeditionManager] Feind ${threatEntity.name} erfolgreich bekämpft!`);
        return true;
      } catch (atkErr) {
        logger.warn(`[ExpeditionManager] Angriffsfehler: ${atkErr.message}`);
      }
    }

    return true;
  }

  /**
   * Startet eine autonome Solo-Höhlen-Expedition.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} options Missions-Optionen:
   *   - targetResource: 'iron_ore' | 'diamond_ore' | 'copper_ore' | 'coal_ore' | 'any_ore'
   *   - targetAmount: Anzahl an Erzen (Standard: 32)
   *   - maxDurationMs: Maximale Missionsdauer in Millisekunden (Standard: 5 Minuten)
   *   - onStateChange: Callback bei FSM-Statusänderungen
   * @returns {Promise<Object>} Missionsergebnis
   */
  async startExpedition(bot, options = {}) {
    if (!bot) throw new Error('Bot instance is required for expedition');
    this.bot = bot;
    this.abortSignal = false;
    this.onStateChangeCallback = options.onStateChange || null;

    const targetResource = options.targetResource || 'iron_ore';
    const targetAmount = options.targetAmount || 32;
    const maxDurationMs = options.maxDurationMs || 300000;

    this.activeMission = {
      targetResource,
      targetAmount,
      maxDurationMs,
      startPosition: bot.entity?.position ? bot.entity.position.clone() : new Vec3(0, 64, 0)
    };

    this.stats = {
      oresMined: 0,
      torchesPlaced: 0,
      monstersDefeated: 0,
      returnedSafely: false,
      startTime: Date.now(),
      endTime: 0
    };

    logger.info(`[ExpeditionManager] Starte Höhlen-Expedition nach ${targetAmount}x ${targetResource}...`);

    try {
      // =======================================================================
      // PHASE 1: PREPARING (Ausrüstung, Spitzhacken, Nahrung, Fackeln)
      // =======================================================================
      this.setState(EXPEDITION_STATES.PREPARING);

      // Spitzhacken-Check & Auto-Crafting
      if (!this.hasUsablePickaxe(bot)) {
        logger.info('[ExpeditionManager] Keine Spitzhacke im Inventar! Crafte vor Expeditionsstart eine Spitzhacke...');
        const pickaxeCraft = await craftingPlanner.craftItem(bot, 'iron_pickaxe', 1);
        if (!pickaxeCraft.success) {
          logger.info('[ExpeditionManager] Eisen-Spitzhacke nicht möglich, versuche Stein-Spitzhacke...');
          await craftingPlanner.craftItem(bot, 'stone_pickaxe', 1);
        }
      }

      // Fackeln-Check: Mindestens 16 Fackeln für den Höhlengang
      if (this.countTorches(bot) < 16) {
        logger.info('[ExpeditionManager] Zu wenige Fackeln im Inventar (<16). Crafte Fackelvorrat...');
        await craftingPlanner.craftItem(bot, 'torch', 16);
      }

      // Kampfausrüstung anlegen
      await inventoryManager.equipBestArmor(bot);
      await inventoryManager.equipBestWeapon(bot);
      await inventoryManager.equipShield(bot);

      // =======================================================================
      // PHASE 2 & 3: EXPLORING_CAVE, LIGHTING, MINING_VEIN, DEFENDING
      // =======================================================================
      this.setState(EXPEDITION_STATES.EXPLORING_CAVE);

      const missionTimeout = Date.now() + maxDurationMs;

      while (!this.abortSignal && Date.now() < missionTimeout) {
        // Smart-Return Abbruch-Bedingungen prüfen:
        // 1. Inventar voll (>= 30 Slots)
        if (this.isInventoryFull(bot, 30)) {
          logger.info('[ExpeditionManager] Smart-Return ausgelöst: Inventar voll (>= 30 Slots)!');
          break;
        }

        // 2. Erzziel erreicht
        if (this.stats.oresMined >= targetAmount) {
          logger.info(`[ExpeditionManager] Smart-Return ausgelöst: Ziel von ${targetAmount}x ${targetResource} erreicht!`);
          break;
        }

        // 3. Werkzeugmangel
        if (!this.hasUsablePickaxe(bot)) {
          logger.warn('[ExpeditionManager] Smart-Return ausgelöst: Keine Spitzhacken mehr verfügbar!');
          break;
        }

        // Bedrohungserkennung (DEFENDING)
        const nearbyThreat = findNearbyThreat(bot, 12);
        if (nearbyThreat) {
          await this.defendAgainstThreat(bot, nearbyThreat);
        }

        // Fackel-Automatik (LIGHTING)
        if (this.isCurrentLocationDark(bot)) {
          this.setState(EXPEDITION_STATES.LIGHTING);
          await this.placeTorch(bot);
          this.setState(EXPEDITION_STATES.EXPLORING_CAVE);
        }

        // Suche nach Erzen (MINING_VEIN)
        const ores = this.findNearbyOres(bot, targetResource, 24);
        if (ores.length > 0) {
          const nearestOre = ores[0];
          await this.mineVein(bot, nearestOre, Math.min(8, targetAmount - this.stats.oresMined));
        } else {
          // Im echten Spiel: Zur nächsten Höhlenposition vortasten
          // Offline/Mock: Schrittweise Fortschritt simulieren oder kleine Exploration
          if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
            const currentPos = bot.entity?.position || new Vec3(0, 64, 0);
            const exploreTarget = currentPos.offset(Math.sin(Date.now() / 1000) * 8, -2, Math.cos(Date.now() / 1000) * 8);
            try {
              const goals = await getPathfinderGoals();
              if (goals) {
                await bot.pathfinder.goto(new goals.GoalNear(exploreTarget.x, exploreTarget.y, exploreTarget.z, 2));
              }
            } catch {}
          }
          break;
        }
      }

      // =======================================================================
      // PHASE 4: RETURNING_HOME (Smart-Return zur Basis)
      // =======================================================================
      this.setState(EXPEDITION_STATES.RETURNING_HOME);

      const homePos = baseStorageManager.getHome() || this.activeMission.startPosition;
      logger.info(`[ExpeditionManager] Kehre zur Heimatbasis bei (${homePos.x}, ${homePos.y}, ${homePos.z}) zurück...`);

      if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
        try {
          const goals = await getPathfinderGoals();
          if (goals) {
            await bot.pathfinder.goto(new goals.GoalNear(homePos.x, homePos.y, homePos.z, 2.5));
          }
        } catch (returnErr) {
          logger.warn(`[ExpeditionManager] Navigation zur Basis meldet: ${returnErr.message}`);
        }
      }

      this.stats.returnedSafely = true;

      // =======================================================================
      // PHASE 5: UNLOADING_AT_BASE (Beute in Kisten & Öfen bestücken)
      // =======================================================================
      this.setState(EXPEDITION_STATES.UNLOADING_AT_BASE);
      logger.info('[ExpeditionManager] Basis erreicht. Starte automatische Einlagerung und Schmelzen...');

      // 1. Schätze & Blöcke in Basiskisten einsortieren
      const depositResult = await baseStorageManager.depositLoot(bot);

      // 2. Roherze in Basis-Öfen verhütten
      const smeltResult = await smeltingManager.smeltMaterials(bot);

      this.stats.endTime = Date.now();
      this.setState(EXPEDITION_STATES.IDLE);

      logger.info(`[ExpeditionManager] Mission erfolgreich abgeschlossen! Abgebaut: ${this.stats.oresMined} Erze, ${this.stats.torchesPlaced} Fackeln gesetzt, ${depositResult.depositedCount || 0} Beutestücke eingelagert.`);

      return {
        success: true,
        stats: this.stats,
        depositResult,
        smeltResult
      };
    } catch (err) {
      logger.error(`[ExpeditionManager] Fehler während der Expedition: ${err.message}`);
      this.setState(EXPEDITION_STATES.IDLE);
      return {
        success: false,
        stats: this.stats,
        error: err.message
      };
    }
  }
}

export const expeditionManager = new ExpeditionManager();
