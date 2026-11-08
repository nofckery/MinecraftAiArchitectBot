import prismarineItem from 'prismarine-item';
import minecraftData from 'minecraft-data';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { normalizeBlockName } from '../builder/blockAliases.js';

export const WEAPON_TIERS = [
  'netherite_sword',
  'diamond_sword',
  'iron_sword',
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
  'stone_sword',
  'golden_sword',
  'wooden_sword',
  'stone_axe',
  'golden_axe',
  'wooden_axe'
];

export const ARMOR_TIERS = {
  netherite: 6,
  diamond: 5,
  iron: 4,
  golden: 3,
  chainmail: 2,
  leather: 1
};

export const ARMOR_SLOT_MAP = [
  { dest: 'head', pattern: '_helmet', name: 'Helm' },
  { dest: 'torso', pattern: '_chestplate', name: 'Brustpanzer' },
  { dest: 'legs', pattern: '_leggings', name: 'Hose' },
  { dest: 'feet', pattern: '_boots', name: 'Stiefel' }
];

export const EDIBLE_FOODS = [
  'golden_carrot',
  'cooked_beef',
  'cooked_porkchop',
  'golden_apple',
  'cooked_mutton',
  'cooked_salmon',
  'cooked_chicken',
  'baked_potato',
  'bread',
  'apple',
  'carrot'
];

export const HARMFUL_FOODS = new Set([
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chorus_fruit'
]);

export class InventoryManager {
  constructor() {
    this.itemClassCache = new Map();
  }

  getItemClass(version = '1.20.4') {
    if (!this.itemClassCache.has(version)) {
      this.itemClassCache.set(version, prismarineItem(version));
    }
    return this.itemClassCache.get(version);
  }

  async equipBlock(bot, blockName) {
    if (!bot || !bot.inventory) return;

    const version = bot.version || '1.20.4';
    const mcData = minecraftData(version);
    const Item = this.getItemClass(version);

    const cleanName = normalizeBlockName(blockName);
    const itemDef = mcData.itemsByName[cleanName] || mcData.blocksByName[cleanName];

    if (!itemDef) {
      logger.debug(`Item-Definition für '${cleanName}' nicht in mcData gefunden.`);
      return;
    }

    // Creative-Modus: Direkt in Hotbar Slot 36 (Haupthand) legen
    if (bot.creative) {
      try {
        const itemObj = new Item(itemDef.id, 64);
        await bot.creative.setInventorySlot(36, itemObj);
        await bot.equip(itemDef.id, 'hand');
      } catch (err) {
        logger.debug(`Fehler beim Creative-Equip von '${cleanName}': ${err.message}`);
      }
      return;
    }

    // Survival-Modus: Prüfe, ob Item im Inventar liegt
    const invItem = bot.inventory.items().find(i => i.name === cleanName);
    if (invItem) {
      try {
        await bot.equip(invItem, 'hand');
      } catch (err) {
        logger.debug(`Konnte '${cleanName}' nicht ausrüsten: ${err.message}`);
      }
    }
  }

  async scanNearbyChests(bot, radius = 4.0, walkIfFar = false) {
    if (!bot || typeof bot.findBlocks !== 'function') return {};

    const version = bot.version || '1.20.4';
    const mcData = minecraftData(version);
    const chestIds = [
      mcData.blocksByName.chest?.id,
      mcData.blocksByName.trapped_chest?.id,
      mcData.blocksByName.barrel?.id
    ].filter(Boolean);

    const chestBlocks = bot.findBlocks({
      matching: chestIds,
      maxDistance: radius,
      count: 20
    });

    const chestInventory = {};
    for (const pos of chestBlocks) {
      try {
        const block = bot.blockAt ? bot.blockAt(pos) : null;
        if (!block) continue;

        // Falls Truhe weiter als 4.2 Blöcke entfernt ist, optional hinlaufen
        if (bot.entity && bot.entity.position.distanceTo(pos) > 4.2) {
          if (walkIfFar && bot.pathfinder) {
            try {
              const goals = await getPathfinderGoals();
              if (goals) {
                await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5));
              }
            } catch (moveErr) {
              logger.debug(`Konnte Behälter bei ${pos} nicht anlaufen: ${moveErr.message}`);
              continue;
            }
          } else {
            // Ohne Hinlaufen überspringen, da Mineflayer openContainer auf Distanz fehlschlägt
            continue;
          }
        }

        const chest = await bot.openContainer(block);
        for (const item of chest.containerItems()) {
          chestInventory[item.name] = (chestInventory[item.name] || 0) + item.count;
        }
        chest.close();
      } catch (err) {
        // 4.2 Fehler beim Öffnen nicht mehr stumm schlucken, sondern debug-protokollieren
        logger.debug(`Konnte Behälter bei (${pos.x}, ${pos.y}, ${pos.z}) nicht öffnen: ${err.message}`);
      }
    }

    return chestInventory;
  }

  checkMaterials(bot, requiredMaterials) {
    const currentInventory = {};
    if (bot && bot.inventory) {
      for (const item of bot.inventory.items()) {
        currentInventory[item.name] = (currentInventory[item.name] || 0) + item.count;
      }
    }

    const missing = {};
    let hasAll = true;

    for (const [mat, needed] of Object.entries(requiredMaterials)) {
      const have = currentInventory[mat] || 0;
      if (have < needed) {
        hasAll = false;
        missing[mat] = needed - have;
      }
    }

    return { hasAll, missing };
  }

  /**
   * 5.2 Autonomes Survival-Ressourcenmanagement: Abbau eines Zielblocks mit passendem Werkzeug
   */
  async harvestBlock(bot, blockPos) {
    if (!bot || typeof bot.blockAt !== 'function' || typeof bot.dig !== 'function') return false;
    const block = bot.blockAt(blockPos);
    if (!block || block.name === 'air') return false;

    try {
      // Wenn das beste Werkzeug im Inventar liegt, rüste es aus
      if (bot.pathfinder && bot.entity.position.distanceTo(blockPos) > 4) {
        const goals = await getPathfinderGoals();
        if (goals) {
          await bot.pathfinder.goto(new goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 2.5));
        }
      }

      // Bestes Werkzeug ausrüsten
      if (typeof bot.tool?.equipForBlock === 'function') {
        await bot.tool.equipForBlock(block);
      }

      await bot.dig(block);
      logger.info(`Block ${block.name} bei (${blockPos.x}, ${blockPos.y}, ${blockPos.z}) erfolgreich abgebaut.`);
      return true;
    } catch (err) {
      logger.debug(`Abbau von Block bei ${blockPos} fehlgeschlagen: ${err.message}`);
      return false;
    }
  }

  /**
   * 5.3 Auto-Crafting-Subsystem: Herstellen von Rezepten für Baumaterialien
   */
  async craftRecipe(bot, itemName, count = 1) {
    if (!bot || !bot.recipesFor) return false;
    const version = bot.version || '1.20.4';
    const mcData = minecraftData(version);
    const itemDef = mcData.itemsByName[itemName] || mcData.blocksByName[itemName];
    if (!itemDef) return false;

    const recipes = bot.recipesFor(itemDef.id, null, 1, true);
    if (!recipes || recipes.length === 0) {
      logger.debug(`Keine herstellbaren Rezepte für '${itemName}' gefunden.`);
      return false;
    }

    const recipe = recipes[0];
    try {
      let craftingTable = null;
      if (recipe.requiresTable) {
        craftingTable = bot.findBlock({
          matching: mcData.blocksByName.crafting_table?.id,
          maxDistance: 4
        });
        if (!craftingTable) {
          logger.warn(`Werkbank benötigt für '${itemName}', aber keine in Reichweite.`);
          return false;
        }
      }

      await bot.craft(recipe, count, craftingTable);
      logger.info(`Erfolgreich ${count}x '${itemName}' gecraftet.`);
      return true;
    } catch (err) {
      logger.debug(`Crafting von '${itemName}' fehlgeschlagen: ${err.message}`);
      return false;
    }
  }

  /**
   * Rüste die beste Waffe aus dem Inventar in der Haupthand aus.
   */
  async equipBestWeapon(bot) {
    if (!bot || !bot.inventory) return false;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    for (const weaponName of WEAPON_TIERS) {
      const match = items.find(i => i && i.name === weaponName);
      if (match) {
        try {
          await bot.equip(match, 'hand');
          return true;
        } catch (err) {
          logger.debug(`Konnte Waffe '${weaponName}' nicht ausrüsten: ${err.message}`);
        }
      }
    }
    return false;
  }

  /**
   * Rüste ein Schild aus dem Inventar in der Nebenhand aus.
   */
  async equipShield(bot) {
    if (!bot || !bot.inventory) return false;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    const shield = items.find(i => i && i.name && i.name.includes('shield'));
    if (shield) {
      try {
        await bot.equip(shield, 'off-hand');
        return true;
      } catch (err) {
        logger.debug(`Konnte Schild nicht in Nebenhand ausrüsten: ${err.message}`);
      }
    }
    return false;
  }

  /**
   * Wähle die beste Nahrung (hohe Sättigung, niemals schädlich) und konsumiere sie.
   */
  async eatBestFood(bot) {
    if (!bot || !bot.inventory) return false;
    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    for (const foodName of EDIBLE_FOODS) {
      if (HARMFUL_FOODS.has(foodName)) continue;
      const match = items.find(i => i && i.name === foodName);
      if (match) {
        try {
          await bot.equip(match, 'hand');
          if (typeof bot.consume === 'function') {
            await bot.consume();
            return true;
          }
        } catch (err) {
          logger.debug(`Konnte Nahrung '${foodName}' nicht verzehren: ${err.message}`);
        }
      }
    }
    return false;
  }

  /**
   * Prüft, ob der Bot Hunger hat oder Heilung benötigt, und isst automatisch.
   * @param {Object} bot Mineflayer bot
   * @param {number} minFoodLevel Schwellenwert für Hunger (Default: 14)
   * @returns {Promise<boolean>}
   */
  async autoEatCheck(bot, minFoodLevel = 14) {
    if (!bot || !bot.inventory) return false;
    const food = bot.food ?? 20;
    const health = bot.health ?? 20;

    // Essen wenn Hunger unter Schwellenwert (<= 14) oder wenn Gesundheit nicht voll und Hunger < 20
    if (food <= minFoodLevel || (health < 20 && food < 20)) {
      return await this.eatBestFood(bot);
    }
    return false;
  }

  /**
   * Rüstet die beste verfügbare Rüstung (Helm, Brustpanzer, Hose, Stiefel) aus.
   * @param {Object} bot Mineflayer bot
   * @returns {Promise<{ equippedCount: number, slots: Object }>}
   */
  async equipBestArmor(bot) {
    if (!bot || !bot.inventory || typeof bot.equip !== 'function') {
      return { equippedCount: 0, slots: {} };
    }

    const items = typeof bot.inventory.items === 'function' ? bot.inventory.items() : [];
    let equippedCount = 0;
    const equippedSummary = {};

    const getArmorScore = (itemName) => {
      if (!itemName) return 0;
      for (const [tier, score] of Object.entries(ARMOR_TIERS)) {
        if (itemName.includes(tier)) return score;
      }
      return 1;
    };

    for (const slotDef of ARMOR_SLOT_MAP) {
      const candidates = items.filter(i => i && i.name && (i.name.includes(slotDef.pattern) || i.name.endsWith(slotDef.pattern)));
      if (candidates.length === 0) continue;

      candidates.sort((a, b) => getArmorScore(b.name) - getArmorScore(a.name));
      const bestCandidate = candidates[0];

      try {
        await bot.equip(bestCandidate, slotDef.dest);
        equippedCount++;
        equippedSummary[slotDef.dest] = bestCandidate.name;
        logger.info(`[InventoryManager] ${slotDef.name} '${bestCandidate.name}' ausgerüstet.`);
      } catch (err) {
        logger.debug(`[InventoryManager] Konnte '${bestCandidate.name}' nicht als ${slotDef.dest} ausrüsten: ${err.message}`);
      }
    }

    return { equippedCount, slots: equippedSummary };
  }
}

export const inventoryManager = new InventoryManager();
