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

/**
 * HarvestManager provides modular interfaces and implementations for autonomous
 * gathering of raw building materials (wood felling, stone quarrying, tool selection).
 */
export class HarvestManager {
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
}

export const harvestManager = new HarvestManager();
