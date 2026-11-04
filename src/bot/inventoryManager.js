import prismarineItem from 'prismarine-item';
import minecraftData from 'minecraft-data';
import { logger } from '../utils/logger.js';

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

    const cleanName = blockName.split('[')[0].replace('minecraft:', '');
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
              const { goals } = await import('mineflayer-pathfinder');
              await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.5));
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
        const { goals } = await import('mineflayer-pathfinder');
        await bot.pathfinder.goto(new goals.GoalNear(blockPos.x, blockPos.y, blockPos.z, 2.5));
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
}

export const inventoryManager = new InventoryManager();
