import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';
import { chestManager } from './chestManager.js';
import { EDIBLE_FOODS } from '../bot/inventoryManager.js';

export const ORES_AND_INGOTS = [
  'raw_iron',
  'raw_copper',
  'raw_gold',
  'iron_ingot',
  'copper_ingot',
  'gold_ingot',
  'diamond',
  'coal',
  'charcoal',
  'redstone',
  'lapis_lazuli',
  'emerald',
  'nether_quartz',
  'ancient_debris',
  'netherite_scrap',
  'netherite_ingot',
  'iron_nugget',
  'gold_nugget',
  'amethyst_shard'
];

export const MOB_DROPS = [
  'rotten_flesh',
  'bone',
  'arrow',
  'string',
  'gunpowder',
  'spider_eye',
  'ender_pearl',
  'slime_ball',
  'blaze_rod',
  'feather',
  'leather',
  'phantom_membrane',
  'ink_sac',
  'glow_ink_sac'
];

export const BUILDING_BLOCKS = [
  'cobblestone',
  'stone',
  'deepslate',
  'cobbled_deepslate',
  'dirt',
  'gravel',
  'granite',
  'diorite',
  'andesite',
  'sand',
  'sandstone',
  'tuff',
  'netherrack',
  'basalt',
  'blackstone',
  'calcite',
  'dripstone_block'
];

export const ESSENTIAL_ITEMS = [
  'crafting_table',
  'furnace',
  'bucket',
  'water_bucket',
  'shield'
];

/**
 * BaseStorageManager verwaltet persistente Wegpunkte (Home & Minen in data/waypoints.json)
 * und die intelligente Einlagerung sowie Sortierung gefarmter Schätze in Basiskisten.
 */
export class BaseStorageManager {
  constructor(filePath = null) {
    this.filePath = filePath || path.resolve(process.cwd(), 'data', 'waypoints.json');
    this.waypoints = new Map();
    this.home = null;
    this.loadWaypoints();
  }

  /**
   * Lädt Wegpunkte aus der JSON-Datei.
   */
  loadWaypoints() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed.home) {
          this.home = {
            x: Math.round(parsed.home.x),
            y: Math.round(parsed.home.y),
            z: Math.round(parsed.home.z),
            updatedAt: parsed.home.updatedAt || new Date().toISOString()
          };
        }
        if (Array.isArray(parsed.waypoints)) {
          this.waypoints.clear();
          for (const wp of parsed.waypoints) {
            if (wp.name && typeof wp.x === 'number') {
              this.waypoints.set(wp.name.toLowerCase(), {
                name: wp.name,
                x: Math.round(wp.x),
                y: Math.round(wp.y),
                z: Math.round(wp.z),
                createdAt: wp.createdAt || new Date().toISOString()
              });
            }
          }
        }
        logger.debug(`[BaseStorageManager] ${this.waypoints.size} Wegpunkte geladen (Home: ${this.home ? `(${this.home.x}, ${this.home.y}, ${this.home.z})` : 'nicht gesetzt'}).`);
      } else {
        this.saveWaypoints();
      }
    } catch (err) {
      logger.warn(`[BaseStorageManager] Fehler beim Laden von ${this.filePath}: ${err.message}. Initialisiere leere Daten.`);
      this.home = null;
      this.waypoints.clear();
    }
  }

  /**
   * Speichert Wegpunkte threadsicher und atomar in data/waypoints.json.
   */
  saveWaypoints() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const payload = {
        home: this.home,
        waypoints: Array.from(this.waypoints.values()),
        updatedAt: new Date().toISOString()
      };

      const tmpPath = `${this.filePath}.tmp.${Date.now()}`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
      logger.debug(`[BaseStorageManager] Wegpunkte erfolgreich gespeichert in ${this.filePath}.`);
      return true;
    } catch (err) {
      logger.error(`[BaseStorageManager] Fehler beim Speichern von ${this.filePath}: ${err.message}`);
      return false;
    }
  }

  /**
   * Setzt die Basis / Home-Position.
   * @param {Vec3|Object} pos
   * @returns {Object}
   */
  setHome(pos) {
    if (!pos || typeof pos.x !== 'number') throw new Error('Gültige Position für setHome erforderlich');
    this.home = {
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      z: Math.round(pos.z),
      updatedAt: new Date().toISOString()
    };
    this.saveWaypoints();
    logger.info(`[BaseStorageManager] Heimatbasis (Home) gesetzt auf: (${this.home.x}, ${this.home.y}, ${this.home.z})`);
    return this.home;
  }

  /**
   * Liest die aktuelle Home-Position aus.
   * @returns {Object|null}
   */
  getHome() {
    return this.home;
  }

  /**
   * Speichert einen benannten Wegpunkt (z.B. Minen-Eingang).
   * @param {string} name
   * @param {Vec3|Object} pos
   * @returns {Object}
   */
  setWaypoint(name, pos) {
    if (!name || typeof name !== 'string') throw new Error('Name für Wegpunkt erforderlich');
    if (!pos || typeof pos.x !== 'number') throw new Error('Gültige Position erforderlich');

    const cleanName = name.trim().toLowerCase();
    const wp = {
      name: cleanName,
      x: Math.round(pos.x),
      y: Math.round(pos.y),
      z: Math.round(pos.z),
      createdAt: new Date().toISOString()
    };
    this.waypoints.set(cleanName, wp);
    this.saveWaypoints();
    logger.info(`[BaseStorageManager] Wegpunkt '${cleanName}' gespeichert bei (${wp.x}, ${wp.y}, ${wp.z})`);
    return wp;
  }

  /**
   * Liest einen benannten Wegpunkt aus.
   * @param {string} name
   * @returns {Object|null}
   */
  getWaypoint(name) {
    if (!name) return null;
    return this.waypoints.get(name.trim().toLowerCase()) || null;
  }

  /**
   * Gibt alle gespeicherten Wegpunkte zurück.
   * @returns {Array<Object>}
   */
  listWaypoints() {
    return Array.from(this.waypoints.values());
  }

  /**
   * Löscht einen Wegpunkt.
   * @param {string} name
   * @returns {boolean}
   */
  deleteWaypoint(name) {
    if (!name) return false;
    const cleanName = name.trim().toLowerCase();
    const existed = this.waypoints.delete(cleanName);
    if (existed) {
      this.saveWaypoints();
      logger.info(`[BaseStorageManager] Wegpunkt '${cleanName}' gelöscht.`);
    }
    return existed;
  }

  /**
   * Prüft, ob ein Item ein unverzichtbares Werkzeug oder Überlebensgut ist,
   * das im Bot-Inventar verbleiben soll.
   * @param {Object} item
   * @param {number} keptTorches
   * @returns {boolean}
   */
  isEssentialItem(item, keptTorches = 0) {
    if (!item) return false;
    const name = item.name.toLowerCase();

    // Werkzeuge & Waffen
    if (name.includes('pickaxe') || name.includes('sword') || name.includes('axe') ||
        name.includes('shovel') || name.includes('hoe') || name.includes('bow') ||
        name.includes('crossbow')) {
      return true;
    }

    // Rüstungen & Schild
    if (name.includes('helmet') || name.includes('chestplate') || name.includes('leggings') ||
        name.includes('boots') || name === 'shield') {
      return true;
    }

    // Nahrung
    if (EDIBLE_FOODS.includes(name)) {
      return true;
    }

    // Werkzeuge & Utilities
    if (ESSENTIAL_ITEMS.includes(name)) {
      return true;
    }

    // Behalte bis zu 64 Fackeln für weitere Höhlenabenteuer
    if (name === 'torch' && keptTorches < 64) {
      return true;
    }

    return false;
  }

  /**
   * Entlädt gesammelte Beute, Erze und Baustoffe in Kisten der Basis.
   * Behält Werkzeuge, Rüstung, Nahrung und Fackeln im Inventar.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} options Optionen (z.B. { radius: 16 })
   * @returns {Promise<{ success: boolean, depositedCount: number, items: Array<{ name: string, count: number }>, error?: string }>}
   */
  async depositLoot(bot, options = {}) {
    if (!bot) throw new Error('Bot instance is required');
    const radius = options.radius || 16;

    const containers = chestManager.findContainers(bot, radius);
    if (containers.length === 0) {
      return {
        success: false,
        depositedCount: 0,
        items: [],
        error: `Keine unblockierten Kisten oder Fässer im Umkreis von ${radius}m gefunden.`
      };
    }

    logger.info(`[BaseStorageManager] Starte Beute-Einlagerung in ${containers.length} Basiskisten...`);

    const depositedItems = [];
    let totalDepositedCount = 0;

    // Filter Items, die eingelagert werden sollen
    const rawItems = typeof bot.inventory?.items === 'function' ? bot.inventory.items() : [];
    let keptTorches = 0;

    const itemsToDeposit = [];
    for (const item of rawItems) {
      if (item.name === 'torch') {
        const canKeep = Math.max(0, 64 - keptTorches);
        const keepCount = Math.min(item.count, canKeep);
        keptTorches += keepCount;
        const depositCount = item.count - keepCount;
        if (depositCount > 0) {
          itemsToDeposit.push({ item, depositCount });
        }
      } else if (!this.isEssentialItem(item, keptTorches)) {
        itemsToDeposit.push({ item, depositCount: item.count });
      }
    }

    if (itemsToDeposit.length === 0) {
      return {
        success: true,
        depositedCount: 0,
        items: [],
        message: 'Inventar enthält keine einlagerbare Beute (nur Werkzeuge & Nahrung).'
      };
    }

    // Durchlaufe Kisten und lagere ein
    for (const container of containers) {
      if (itemsToDeposit.length === 0) break;

      try {
        let window = null;
        if (typeof chestManager.openContainerSafely === 'function') {
          window = await chestManager.openContainerSafely(bot, container.block);
        } else if (typeof bot.openContainer === 'function') {
          window = await bot.openContainer(container.block);
        }

        if (!window) continue;

        // Versuche verbleibende Items einzulagern
        const remainingToDeposit = [];
        for (const entry of itemsToDeposit) {
          try {
            if (typeof window.deposit === 'function') {
              await window.deposit(entry.item.type, null, entry.depositCount);
            }
            depositedItems.push({ name: entry.item.name, count: entry.depositCount });
            totalDepositedCount += entry.depositCount;
            logger.debug(`[BaseStorageManager] Eingelagert: ${entry.depositCount}x ${entry.item.name} in Kiste bei (${container.position.x}, ${container.position.y}, ${container.position.z})`);
          } catch (depErr) {
            // Kiste möglicherweise voll
            remainingToDeposit.push(entry);
          }
        }

        if (typeof window.close === 'function') {
          window.close();
        }

        itemsToDeposit.length = 0;
        itemsToDeposit.push(...remainingToDeposit);
      } catch (boxErr) {
        logger.warn(`[BaseStorageManager] Konnte Kiste bei (${container.position.x}, ${container.position.y}, ${container.position.z}) nicht öffnen: ${boxErr.message}`);
      }
    }

    return {
      success: true,
      depositedCount: totalDepositedCount,
      items: depositedItems
    };
  }
}

export const baseStorageManager = new BaseStorageManager();
