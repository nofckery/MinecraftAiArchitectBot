import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { VersionResolver } from '../config/versionResolver.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';

export const TOOL_TIERS = {
  netherite: 6,
  diamond: 5,
  iron: 4,
  stone: 3,
  golden: 2,
  wooden: 1
};

export const COMMON_LOG_TYPES = [
  'oak_log',
  'spruce_log',
  'birch_log',
  'jungle_log',
  'acacia_log',
  'dark_oak_log',
  'mangrove_log',
  'cherry_log'
];

export const COMMON_STONE_TYPES = [
  'stone',
  'cobblestone',
  'deepslate',
  'cobbled_deepslate',
  'andesite',
  'diorite',
  'granite'
];

export const COMMON_ORE_MAP = {
  iron_ore: ['iron_ore', 'deepslate_iron_ore'],
  coal_ore: ['coal_ore', 'deepslate_coal_ore'],
  copper_ore: ['copper_ore', 'deepslate_copper_ore'],
  gold_ore: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  diamond_ore: ['diamond_ore', 'deepslate_diamond_ore'],
  redstone_ore: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis_ore: ['lapis_ore', 'deepslate_lapis_ore'],
  emerald_ore: ['emerald_ore', 'deepslate_emerald_ore'],
  nether_quartz_ore: ['nether_quartz_ore'],
  ancient_debris: ['ancient_debris'],
  any_ore: [
    'iron_ore', 'deepslate_iron_ore',
    'coal_ore', 'deepslate_coal_ore',
    'copper_ore', 'deepslate_copper_ore',
    'gold_ore', 'deepslate_gold_ore',
    'diamond_ore', 'deepslate_diamond_ore',
    'redstone_ore', 'deepslate_redstone_ore',
    'lapis_ore', 'deepslate_lapis_ore',
    'emerald_ore', 'deepslate_emerald_ore'
  ]
};

/**
 * HarvestManager provides modular interfaces and implementations for autonomous
 * gathering of raw building materials (wood felling, stone quarrying, tool selection).
 */
export class HarvestManager {
  constructor() {
    this.isHarvesting = false;
    this.abortSignal = false;
  }

  abort() {
    this.abortSignal = true;
    this.isHarvesting = false;
    logger.info('[HarvestManager] Abbauvorgang durch Not-Stopp abgebrochen.');
  }
  /**
   * Determines the optimal tool category for a block and equips the highest-tier tool available.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} targetBlock Target block to be dug
   * @returns {Promise<{ equipped: boolean, toolName: string|null, category: string }>}
   */
  async prepareToolForBlock(bot, targetBlock) {
    if (!bot || !bot.inventory || !targetBlock) {
      return { equipped: false, toolName: null, category: 'none' };
    }

    const blockName = (targetBlock.name || '').toLowerCase();
    let category = 'pickaxe';

    if (blockName.includes('log') || blockName.includes('plank') || blockName.includes('wood') || blockName.includes('fence')) {
      category = 'axe';
    } else if (blockName.includes('dirt') || blockName.includes('sand') || blockName.includes('gravel') || blockName.includes('clay')) {
      category = 'shovel';
    } else if (blockName.includes('leaves') || blockName.includes('crop') || blockName.includes('hay')) {
      category = 'hoe';
    }

    // Find all inventory items matching category
    const candidateTools = bot.inventory.items().filter(item => item.name.includes(`_${category}`));
    if (candidateTools.length === 0) {
      return { equipped: false, toolName: null, category };
    }

    // Rank by tier score
    candidateTools.sort((a, b) => {
      const getScore = (name) => {
        for (const [tier, score] of Object.entries(TOOL_TIERS)) {
          if (name.includes(tier)) return score;
        }
        return 0;
      };
      return getScore(b.name) - getScore(a.name);
    });

    const bestTool = candidateTools[0];
    try {
      if (typeof bot.equip === 'function') {
        await bot.equip(bestTool, 'hand');
        return { equipped: true, toolName: bestTool.name, category };
      }
    } catch (equipErr) {
      logger.debug(`[HarvestManager] Konnte '${bestTool.name}' nicht ausrüsten: ${equipErr.message}`);
    }

    return { equipped: false, toolName: bestTool.name, category };
  }

  /**
   * Discovers and harvests wood logs in the surrounding area.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {string} logType Block type to harvest (e.g. 'oak_log')
   * @param {number} targetCount Number of logs to collect
   * @param {number} radius Search radius
   * @returns {Promise<{ success: boolean, harvested: number, targetCount: number, logType: string }>}
   */
  async harvestWood(bot, logType = 'oak_log', targetCount = 16, radius = 32) {
    if (!bot || typeof bot.findBlocks !== 'function') {
      return { success: false, harvested: 0, targetCount, logType };
    }

    VersionResolver.applyCompatibilityShims();
    const ver = bot.version === '26.3' ? '26.1' : (bot.version || '1.20.4');
    const mcData = minecraftData(ver);
    if (!mcData) return { success: false, harvested: 0, targetCount, logType };

    // Search for specified log type, or all common log types
    const matchingLogNames = logType === 'any' ? COMMON_LOG_TYPES : [logType];
    const logIds = matchingLogNames
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined && id !== null);

    const logPositions = bot.findBlocks({
      matching: logIds,
      maxDistance: radius,
      count: targetCount * 2
    });

    if (!logPositions || logPositions.length === 0) {
      logger.warn(`[HarvestManager] Keine Baumstämme (${matchingLogNames.join(', ')}) im Umkreis von ${radius}m gefunden.`);
      return { success: false, harvested: 0, targetCount, logType };
    }

    let harvested = 0;
    for (const pos of logPositions) {
      if (harvested >= targetCount) break;

      const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null;
      if (!block || block.name === 'air') continue;

      // Navigate to tree if distance > 3.5
      if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
        if (bot.entity.position.distanceTo(pos) > 3.5 && bot.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5));
            }
          } catch (moveErr) {
            logger.debug(`[HarvestManager] Konnte Position ${pos} nicht anlaufen: ${moveErr.message}`);
            continue;
          }
        }
      }

      // Equip axe and dig
      await this.prepareToolForBlock(bot, block);
      try {
        if (typeof bot.dig === 'function') {
          await bot.dig(block);
          harvested++;
          logger.debug(`[HarvestManager] Holzstamm bei ${pos} abgebaut (${harvested}/${targetCount}).`);
        }
      } catch (digErr) {
        logger.debug(`[HarvestManager] Abbaufehler bei ${pos}: ${digErr.message}`);
      }
    }

    return {
      success: harvested >= targetCount,
      harvested,
      targetCount,
      logType
    };
  }

  /**
   * Quarries stone/cobblestone from safe positions in the surrounding area.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {number} targetCount Number of blocks to quarry
   * @param {number} radius Search radius
   * @returns {Promise<{ success: boolean, harvested: number, targetCount: number }>}
   */
  async harvestStone(bot, targetCount = 64, radius = 32) {
    if (!bot || typeof bot.findBlocks !== 'function') {
      return { success: false, harvested: 0, targetCount };
    }

    VersionResolver.applyCompatibilityShims();
    const ver = bot.version === '26.3' ? '26.1' : (bot.version || '1.20.4');
    const mcData = minecraftData(ver);
    if (!mcData) return { success: false, harvested: 0, targetCount };

    const stoneIds = COMMON_STONE_TYPES
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined && id !== null);

    const stonePositions = bot.findBlocks({
      matching: stoneIds,
      maxDistance: radius,
      count: targetCount * 2
    });

    if (!stonePositions || stonePositions.length === 0) {
      logger.warn(`[HarvestManager] Kein Stein/Bruchstein im Umkreis von ${radius}m gefunden.`);
      return { success: false, harvested: 0, targetCount };
    }

    let harvested = 0;
    const botPos = bot.entity?.position ? bot.entity.position.floored() : null;

    for (const pos of stonePositions) {
      if (harvested >= targetCount) break;

      // Safety: Never dig the block directly beneath the bot's feet!
      if (botPos && pos.x === botPos.x && pos.z === botPos.z && pos.y <= botPos.y) {
        continue;
      }

      const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null;
      if (!block || block.name === 'air') continue;

      // Navigate if necessary
      if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
        if (bot.entity.position.distanceTo(pos) > 3.5 && bot.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5));
            }
          } catch (moveErr) {
            logger.debug(`[HarvestManager] Konnte Stein bei ${pos} nicht anlaufen: ${moveErr.message}`);
            continue;
          }
        }
      }

      // Equip pickaxe and dig
      await this.prepareToolForBlock(bot, block);
      try {
        if (typeof bot.dig === 'function') {
          await bot.dig(block);
          harvested++;
          logger.debug(`[HarvestManager] Stein bei ${pos} abgebaut (${harvested}/${targetCount}).`);
        }
      } catch (digErr) {
        logger.debug(`[HarvestManager] Steinabbaufehler bei ${pos}: ${digErr.message}`);
      }
    }

    return {
      success: harvested >= targetCount,
      harvested,
      targetCount
    };
  }

  /**
   * Sammelt gedroppte Items (z. B. Roheisen, Kohle, Holz) in der näheren Umgebung ein.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {number} radius Suchradius für Drops
   * @returns {Promise<number>} Anzahl aufgesammelter Drop-Entitäten
   */
  async collectNearbyDrops(bot, radius = 5.0) {
    if (!bot?.entities || !bot?.entity?.position || !bot.pathfinder) return 0;
    let collectedCount = 0;
    const botPos = bot.entity.position;
    const goals = await getPathfinderGoals();

    for (const id in bot.entities) {
      if (this.abortSignal) break;
      const ent = bot.entities[id];
      if (!ent || !ent.position) continue;
      const isItem = ent.name === 'item' || ent.displayName === 'Item' || ent.objectType === 'Item';
      if (!isItem) continue;

      const dist = botPos.distanceTo(ent.position);
      if (dist <= radius) {
        try {
          if (goals?.GoalNear) {
            await bot.pathfinder.goto(new goals.GoalNear(ent.position.x, ent.position.y, ent.position.z, 0.6));
            collectedCount++;
          }
        } catch {
          // Safe ignore falls Item bereits aufgesaugt oder unerreichbar
        }
      }
    }
    return collectedCount;
  }

  /**
   * Sucht und baut gezielt Erze (z. B. Eisenerz, Kohle, Diamant) im Umkreis ab.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {string} oreType Erztyp (z. B. 'iron_ore', 'coal_ore', 'any_ore')
   * @param {number} targetCount Maximale Anzahl abzubauender Blöcke
   * @param {number} radius Suchradius um den Bot
   * @param {Object} options Optionen (chatAlerts, onProgress)
   * @returns {Promise<{ success: boolean, harvested: number, targetCount: number, oreType: string }>}
   */
  async harvestOres(bot, oreType = 'iron_ore', targetCount = 32, radius = 32, options = {}) {
    if (!bot || typeof bot.findBlocks !== 'function') {
      return { success: false, harvested: 0, targetCount, oreType };
    }

    this.isHarvesting = true;
    this.abortSignal = false;
    const chatAlerts = options.chatAlerts !== false;

    VersionResolver.applyCompatibilityShims();
    const ver = bot.version === '26.3' ? '26.1' : (bot.version || '1.20.4');
    const mcData = minecraftData(ver);
    if (!mcData) {
      this.isHarvesting = false;
      return { success: false, harvested: 0, targetCount, oreType };
    }

    // Erznamensauflösung
    const matchingOreNames = COMMON_ORE_MAP[oreType] || (oreType === 'any' ? COMMON_ORE_MAP.any_ore : [oreType]);
    const oreIds = matchingOreNames
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined && id !== null);

    if (oreIds.length === 0) {
      logger.warn(`[HarvestManager] Unbekannter oder nicht auflösbarer Erztyp: '${oreType}'`);
      this.isHarvesting = false;
      return { success: false, harvested: 0, targetCount, oreType };
    }

    const orePositions = bot.findBlocks({
      matching: oreIds,
      maxDistance: radius,
      count: targetCount * 2
    });

    if (!orePositions || orePositions.length === 0) {
      const msg = `Keine Erzvorkommen (${matchingOreNames.join(', ')}) im Umkreis von ${radius}m gefunden.`;
      logger.info(`[HarvestManager] ${msg}`);
      if (chatAlerts && typeof bot.chat === 'function') {
        bot.chat(`[Mining] ${msg}`);
      }
      this.isHarvesting = false;
      return { success: false, harvested: 0, targetCount, oreType };
    }

    // Sortiere nach Distanz zum Bot
    const botPos = bot.entity?.position ? bot.entity.position.floored() : null;
    if (botPos) {
      orePositions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));
    }

    const startMsg = `Starte Abbau von bis zu ${targetCount}x ${oreType} (${orePositions.length} Vorkommen im Radius ${radius}m lokalisiert)...`;
    logger.info(`[HarvestManager] ${startMsg}`);
    if (chatAlerts && typeof bot.chat === 'function') {
      bot.chat(`[Mining] ${startMsg}`);
    }

    let harvested = 0;

    for (const pos of orePositions) {
      if (this.abortSignal || harvested >= targetCount) break;

      // Sicherheitsregel: Niemals den Block direkt unter den eigenen Füßen abbauen (Fall-Schutz)!
      if (botPos && pos.x === botPos.x && pos.z === botPos.z && pos.y <= botPos.y) {
        continue;
      }

      const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null;
      if (!block || block.name === 'air') continue;

      // Prüfung auf Lava in direkter Nachbarschaft
      if (typeof bot.blockAt === 'function') {
        const neighbors = [
          bot.blockAt(pos.offset(0, 1, 0)),
          bot.blockAt(pos.offset(1, 0, 0)),
          bot.blockAt(pos.offset(-1, 0, 0)),
          bot.blockAt(pos.offset(0, 0, 1)),
          bot.blockAt(pos.offset(0, 0, -1))
        ];
        const hasLavaDanger = neighbors.some(n => n && (n.name === 'lava' || n.name === 'flowing_lava'));
        if (hasLavaDanger) {
          logger.warn(`[HarvestManager] Überspringe Erz bei ${pos}: Lava in direkter Nachbarschaft!`);
          continue;
        }
      }

      // Heranlaufen wenn nötig
      if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
        const currentDist = bot.entity.position.distanceTo(pos);
        if (currentDist > 3.5 && bot.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.2));
            }
          } catch (moveErr) {
            logger.debug(`[HarvestManager] Konnte Erz bei ${pos} nicht anlaufen: ${moveErr.message}`);
            continue;
          }
        }
      }

      if (this.abortSignal) break;

      // Spitzhacke ausrüsten und graben
      await this.prepareToolForBlock(bot, block);
      try {
        if (typeof bot.dig === 'function') {
          await bot.dig(block);
          harvested++;
          logger.info(`[HarvestManager] Erz abgebaut: ${block.name} bei (${pos.x}, ${pos.y}, ${pos.z}) [${harvested}/${targetCount}].`);

          // Dropped Items in Reichweite einsammeln
          await this.collectNearbyDrops(bot, 5.0);

          if (typeof options.onProgress === 'function') {
            options.onProgress({ harvested, targetCount, currentBlock: block.name });
          }
        }
      } catch (digErr) {
        logger.debug(`[HarvestManager] Abbaufehler bei ${pos}: ${digErr.message}`);
      }
    }

    const endMsg = this.abortSignal
      ? `Mining-Auftrag abgebrochen. Insgesamt ${harvested} Blöcke abgebaut.`
      : `Mining-Auftrag abgeschlossen: ${harvested}x ${oreType} abgebaut!`;

    logger.info(`[HarvestManager] ${endMsg}`);
    if (chatAlerts && typeof bot.chat === 'function') {
      bot.chat(`[Mining] ${endMsg}`);
    }

    this.isHarvesting = false;
    return {
      success: harvested > 0,
      harvested,
      targetCount,
      oreType
    };
  }

  /**
   * Räumt störende Hindernisse (Bäume, Laub, Erdaufschüttungen) im Baufeld ab.
   * Sortiert von oben nach unten (Y absteigend), um Einstürze zu verhindern.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Array<Object>} plannedBlocks Zielblöcke des Bauwerks
   * @param {Object} options Optionen (maxBlocks, chatAlerts)
   * @returns {Promise<{ clearedCount: number, remainingObstacles: number }>}
   */
  async clearObstacles(bot, plannedBlocks, options = {}) {
    if (!bot || typeof bot.blockAt !== 'function' || !Array.isArray(plannedBlocks)) {
      return { clearedCount: 0, remainingObstacles: 0 };
    }

    const maxBlocksToClear = options.maxBlocks || 300;
    const chatAlerts = options.chatAlerts !== false;
    const obstacles = [];

    // Finde alle vorhandenen Welt-Blöcke, die nicht Luft und nicht bereits der Zielblock sind
    for (const pb of plannedBlocks) {
      const pos = new Vec3(Math.floor(pb.x), Math.floor(pb.y), Math.floor(pb.z));
      const wb = bot.blockAt(pos);
      if (!wb || !wb.name) continue;
      const wName = wb.name.toLowerCase();

      if (wName === 'air' || wName === 'cave_air' || wName === 'void_air') continue;

      const targetName = (pb.name || pb.blockState?.name || '').toLowerCase();
      // Falls der Block bereits genau die gewünschte Art hat, nicht abreißen
      if (wName === targetName) continue;

      // Unzerstörbare Blöcke niemals versuchen abzubauen (Bedrock, Portal, etc.)
      if (wName === 'bedrock' || wName.includes('portal') || wName === 'barrier') continue;

      obstacles.push(wb);
    }

    if (obstacles.length === 0) {
      return { clearedCount: 0, remainingObstacles: 0 };
    }

    // Y absteigend sortieren (von oben nach unten abbauen, damit nichts auf den Bot fällt)
    obstacles.sort((a, b) => b.position.y - a.position.y || a.position.distanceTo(bot.entity?.position || new Vec3(0, 0, 0)) - b.position.distanceTo(bot.entity?.position || new Vec3(0, 0, 0)));

    const toProcess = obstacles.slice(0, maxBlocksToClear);
    logger.info(`[HarvestManager] Baufeld-Rodung aktiv: ${obstacles.length} Hindernisse erkannt (räume bis zu ${toProcess.length})...`);
    if (chatAlerts && typeof bot.chat === 'function') {
      bot.chat(`[Bauplatz-Rodung] Entferne ${toProcess.length} störende Blöcke/Bäume vor dem Bau...`);
    }

    let clearedCount = 0;
    for (const blk of toProcess) {
      // Prüfe, ob Block währenddessen schon verschwunden ist
      const currentBlk = bot.blockAt(blk.position);
      if (!currentBlk || currentBlk.name === 'air') continue;

      // Wenn zu weit weg, hinlaufen
      if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
        const dist = bot.entity.position.distanceTo(blk.position);
        if (dist > 3.8 && bot.pathfinder) {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              await bot.pathfinder.goto(new goals.GoalNear(blk.position.x, blk.position.y, blk.position.z, 2.5));
            }
          } catch (navErr) {
            logger.debug(`[HarvestManager] Konnte Hindernis bei ${blk.position} nicht anlaufen: ${navErr.message}`);
            continue;
          }
        }
      }

      await this.prepareToolForBlock(bot, currentBlk);
      try {
        if (typeof bot.dig === 'function') {
          await bot.dig(currentBlk);
          clearedCount++;
        }
      } catch (digErr) {
        logger.debug(`[HarvestManager] Fehler beim Roden von ${blk.name} bei ${blk.position}: ${digErr.message}`);
      }
    }

    logger.info(`[HarvestManager] Baufeld-Rodung abgeschlossen: ${clearedCount} Hindernisse entfernt.`);
    return {
      clearedCount,
      remainingObstacles: Math.max(0, obstacles.length - clearedCount)
    };
  }
}

export const harvestManager = new HarvestManager();
