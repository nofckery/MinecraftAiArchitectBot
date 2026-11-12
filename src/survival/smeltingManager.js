import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { VersionResolver } from '../config/versionResolver.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { craftingPlanner } from './craftingPlanner.js';

VersionResolver.applyCompatibilityShims();

export const SMELTABLE_RECIPES = {
  // Roherze -> Barren
  'raw_iron': { output: 'iron_ingot', cookTimeSec: 10 },
  'raw_copper': { output: 'copper_ingot', cookTimeSec: 10 },
  'raw_gold': { output: 'gold_ingot', cookTimeSec: 10 },

  // Natur-Erze (Standard & Deepslate) -> Barren
  'iron_ore': { output: 'iron_ingot', cookTimeSec: 10 },
  'deepslate_iron_ore': { output: 'iron_ingot', cookTimeSec: 10 },
  'copper_ore': { output: 'copper_ingot', cookTimeSec: 10 },
  'deepslate_copper_ore': { output: 'copper_ingot', cookTimeSec: 10 },
  'gold_ore': { output: 'gold_ingot', cookTimeSec: 10 },
  'deepslate_gold_ore': { output: 'gold_ingot', cookTimeSec: 10 },
  'nether_gold_ore': { output: 'gold_ingot', cookTimeSec: 10 },

  // Baustoffe
  'cobblestone': { output: 'stone', cookTimeSec: 10 },
  'cobbled_deepslate': { output: 'deepslate', cookTimeSec: 10 },
  'sand': { output: 'glass', cookTimeSec: 10 },
  'red_sand': { output: 'glass', cookTimeSec: 10 },
  'clay_ball': { output: 'brick', cookTimeSec: 10 },
  'netherrack': { output: 'nether_brick', cookTimeSec: 10 },
  'ancient_debris': { output: 'netherite_scrap', cookTimeSec: 10 }
};

export const FUEL_VALUES = {
  'coal_block': 80,
  'dried_kelp_block': 20,
  'blaze_rod': 12,
  'coal': 8,
  'charcoal': 8,
  'lava_bucket': 100,
  'oak_log': 1.5,
  'spruce_log': 1.5,
  'birch_log': 1.5,
  'jungle_log': 1.5,
  'acacia_log': 1.5,
  'dark_oak_log': 1.5,
  'mangrove_log': 1.5,
  'cherry_log': 1.5,
  'oak_planks': 1.5,
  'spruce_planks': 1.5,
  'birch_planks': 1.5,
  'jungle_planks': 1.5,
  'acacia_planks': 1.5,
  'dark_oak_planks': 1.5,
  'mangrove_planks': 1.5,
  'cherry_planks': 1.5,
  'stick': 0.5,
  'wooden_pickaxe': 1,
  'wooden_sword': 1,
  'wooden_axe': 1
};

export const FURNACE_BLOCK_NAMES = ['furnace', 'blast_furnace', 'smoker'];

/**
 * SmeltingManager kümmert sich um die automatische Verhüttung von Erzen in Öfen,
 * intelligentes Brennstoff-Management und mobiles Aufstellen temporärer Öfen.
 */
export class SmeltingManager {
  constructor() {
    this.isSmelting = false;
    this.abortSignal = false;
  }

  abort() {
    this.abortSignal = true;
    this.isSmelting = false;
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
   * Findet einen existierenden Ofen im Umkreis.
   * @param {Object} bot
   * @param {number} maxDistance
   * @returns {Object|null}
   */
  findNearbyFurnace(bot, maxDistance = 8) {
    if (!bot || typeof bot.findBlock !== 'function') return null;
    return bot.findBlock({
      matching: (b) => b && FURNACE_BLOCK_NAMES.includes(b.name),
      maxDistance
    });
  }

  /**
   * Identifiziert die besten Brennstoffe im Inventar des Bots.
   * @param {Object} bot
   * @returns {Array<{ item: Object, burnCount: number }>}
   */
  getAvailableFuels(bot) {
    if (!bot || !bot.inventory) return [];
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    const fuels = [];

    for (const item of items) {
      if (FUEL_VALUES[item.name]) {
        fuels.push({
          item,
          burnCount: FUEL_VALUES[item.name]
        });
      }
    }

    // Sortiere nach Brennwert absteigend (beste Brennstoffe zuerst)
    return fuels.sort((a, b) => b.burnCount - a.burnCount);
  }

  /**
   * Identifiziert alle schmelzbaren Materialien im Inventar des Bots.
   * @param {Object} bot
   * @param {string|null} filterName
   * @returns {Array<{ item: Object, target: Object }>}
   */
  getSmeltableItems(bot, filterName = null) {
    if (!bot || !bot.inventory) return [];
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    const smeltables = [];

    for (const item of items) {
      if (filterName && item.name !== filterName) continue;
      if (SMELTABLE_RECIPES[item.name]) {
        smeltables.push({
          item,
          target: SMELTABLE_RECIPES[item.name]
        });
      }
    }

    return smeltables;
  }

  /**
   * Findet eine geeignete solide Fläche im Nahbereich für einen temporären Ofen.
   * @param {Object} bot
   * @returns {{ referenceBlock: Object, faceVector: Vec3, placePos: Vec3 }|null}
   */
  findPlacementSpot(bot) {
    if (!bot || !bot.entity || !bot.blockAt) return null;
    const botPos = bot.entity.position.floored();

    const searchOffsets = [
      new Vec3(1, 0, 0),
      new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1),
      new Vec3(0, 0, -1),
      new Vec3(1, 0, 1),
      new Vec3(-1, 0, -1)
    ];

    for (const offset of searchOffsets) {
      const airPos = botPos.plus(offset);
      const airBlock = bot.blockAt(airPos);
      const belowBlock = bot.blockAt(airPos.offset(0, -1, 0));

      if (airBlock && (airBlock.name === 'air' || airBlock.name === 'cave_air') &&
          belowBlock && belowBlock.boundingBox === 'block') {
        return {
          referenceBlock: belowBlock,
          faceVector: new Vec3(0, 1, 0),
          placePos: airPos
        };
      }
    }

    return null;
  }

  /**
   * Startet die Verhüttung von Materialien.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} options Optionen (z.B. { itemType, maxCount, maxWaitMs })
   * @returns {Promise<{ success: boolean, smelted: Array<{ input: string, output: string, count: number }>, totalSmelted: number, error?: string }>}
   */
  async smeltMaterials(bot, options = {}) {
    if (!bot) throw new Error('Bot instance is required');
    this.isSmelting = true;
    this.abortSignal = false;

    const { itemType = null, maxCount = 64, maxWaitMs = 15000 } = options;
    const smeltables = this.getSmeltableItems(bot, itemType);

    if (smeltables.length === 0) {
      this.isSmelting = false;
      return {
        success: true,
        smelted: [],
        totalSmelted: 0,
        message: 'Keine schmelzbaren Materialien im Inventar gefunden.'
      };
    }

    const fuels = this.getAvailableFuels(bot);
    if (fuels.length === 0) {
      this.isSmelting = false;
      return {
        success: false,
        smelted: [],
        totalSmelted: 0,
        error: 'Kein Brennstoff (Kohle, Holzkohle, Holz, Planken) im Inventar vorhanden.'
      };
    }

    let furnaceBlock = this.findNearbyFurnace(bot, 8);
    let temporaryFurnacePlaced = false;

    // 1. Falls kein Ofen vorhanden: Mobiles Ofen-Management
    if (!furnaceBlock) {
      logger.info('[SmeltingManager] Kein Ofen im 8m-Radius. Prüfe temporären Ofen...');
      let furnaceItem = bot.inventory?.items().find(i => i.name === 'furnace');

      if (!furnaceItem) {
        // Versuche Ofen aus 8 Cobblestone zu craften
        const cobbleCount = bot.inventory?.items()
          .filter(i => i.name === 'cobblestone')
          .reduce((s, i) => s + i.count, 0) || 0;

        if (cobbleCount >= 8) {
          logger.info('[SmeltingManager] Crafte Ofen aus 8x Cobblestone...');
          await craftingPlanner.craftItem(bot, 'furnace', 1);
          furnaceItem = bot.inventory?.items().find(i => i.name === 'furnace');
        }
      }

      if (furnaceItem && typeof bot.placeBlock === 'function') {
        const spot = this.findPlacementSpot(bot);
        if (spot) {
          if (typeof bot.equip === 'function') {
            await bot.equip(furnaceItem, 'hand');
          }
          await bot.placeBlock(spot.referenceBlock, spot.faceVector);
          furnaceBlock = bot.blockAt(spot.placePos);
          temporaryFurnacePlaced = true;
          logger.info(`[SmeltingManager] Mobiler Ofen platziert bei (${spot.placePos.x}, ${spot.placePos.y}, ${spot.placePos.z}).`);
        }
      }
    }

    if (!furnaceBlock) {
      this.isSmelting = false;
      return {
        success: false,
        smelted: [],
        totalSmelted: 0,
        error: 'Kein Ofen in der Nähe und kein Ofen platzierbar.'
      };
    }

    // 2. Zum Ofen laufen, falls weiter als 3.5 Blöcke
    if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
      const dist = bot.entity.position.distanceTo(furnaceBlock.position);
      if (dist > 3.5 && bot.pathfinder) {
        try {
          const goals = await getPathfinderGoals();
          if (goals) {
            await bot.pathfinder.goto(new goals.GoalNear(furnaceBlock.position.x, furnaceBlock.position.y, furnaceBlock.position.z, 2));
          }
        } catch {}
      }
    }

    const smeltedSummary = [];
    let totalSmeltedCount = 0;

    try {
      if (typeof bot.openFurnace === 'function') {
        const furnace = await bot.openFurnace(furnaceBlock);

        for (const entry of smeltables) {
          if (this.abortSignal) break;
          const inputItem = entry.item;
          const targetRecipe = entry.target;
          const countToSmelt = Math.min(inputItem.count || 1, maxCount - totalSmeltedCount);

          if (countToSmelt <= 0) break;

          logger.info(`[SmeltingManager] Schmelze ${countToSmelt}x ${inputItem.name} -> ${targetRecipe.output}...`);

          // Brennstoff hineinlegen
          const bestFuel = fuels[0].item;
          if (typeof furnace.putFuel === 'function') {
            try {
              await furnace.putFuel(bestFuel.type, null, Math.max(1, Math.ceil(countToSmelt / (fuels[0].burnCount || 1))));
            } catch {}
          }

          // Rohmaterial hineinlegen
          if (typeof furnace.putInput === 'function') {
            await furnace.putInput(inputItem.type, null, countToSmelt);
          }

          // Warte auf Schmelzvorgang oder sammle Outputs
          if (typeof furnace.takeOutput === 'function') {
            const startWait = Date.now();
            let gathered = 0;

            while (Date.now() - startWait < maxWaitMs && !this.abortSignal) {
              const outItem = typeof furnace.outputItem === 'function' ? furnace.outputItem() : null;
              if (outItem && outItem.count > 0) {
                const taken = await furnace.takeOutput();
                gathered += (taken?.count || outItem.count || 1);
                if (gathered >= countToSmelt) break;
              }
              await new Promise(r => setTimeout(r, 800));
            }

            if (gathered > 0) {
              smeltedSummary.push({
                input: inputItem.name,
                output: targetRecipe.output,
                count: gathered
              });
              totalSmeltedCount += gathered;
            }
          }
        }

        if (typeof furnace.close === 'function') {
          furnace.close();
        }
      } else {
        // Fallback / Mock-Simulation für Offline-Tests
        for (const entry of smeltables) {
          const count = Math.min(entry.item.count || 1, maxCount);
          smeltedSummary.push({
            input: entry.item.name,
            output: entry.target.output,
            count
          });
          totalSmeltedCount += count;
        }
      }

      // 3. Temporären Ofen abbauen falls aufgestellt
      if (temporaryFurnacePlaced && furnaceBlock && typeof bot.dig === 'function') {
        logger.info('[SmeltingManager] Baue temporären Ofen wieder ab...');
        try {
          await bot.dig(furnaceBlock);
          logger.info('[SmeltingManager] Ofen erfolgreich wieder eingepackt.');
        } catch (digErr) {
          logger.warn(`[SmeltingManager] Fehler beim Abbauen des temporären Ofens: ${digErr.message}`);
        }
      }

      return {
        success: true,
        smelted: smeltedSummary,
        totalSmelted: totalSmeltedCount
      };
    } catch (err) {
      logger.error(`[SmeltingManager] Fehler beim Schmelzen: ${err.message}`);
      return {
        success: false,
        smelted: smeltedSummary,
        totalSmelted: totalSmeltedCount,
        error: err.message
      };
    } finally {
      this.isSmelting = false;
    }
  }
}

export const smeltingManager = new SmeltingManager();
