import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { VersionResolver } from '../config/versionResolver.js';
import { logger } from '../utils/logger.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';

export const CONTAINER_NAMES = [
  'chest',
  'trapped_chest',
  'barrel',
  'shulker_box',
  'white_shulker_box',
  'orange_shulker_box',
  'magenta_shulker_box',
  'light_blue_shulker_box',
  'yellow_shulker_box',
  'lime_shulker_box',
  'pink_shulker_box',
  'gray_shulker_box',
  'light_gray_shulker_box',
  'cyan_shulker_box',
  'purple_shulker_box',
  'blue_shulker_box',
  'brown_shulker_box',
  'green_shulker_box',
  'red_shulker_box',
  'black_shulker_box'
];

/**
 * ChestManager provides robust container search, spatial double-chest deduplication,
 * Java Edition obstruction checks, timeout-guarded interactions, and safe withdrawals.
 */
export class ChestManager {
  constructor() {
    this.blacklist = new Map(); // "x,y,z" -> expireTimestamp
    this.DEFAULT_TIMEOUT_MS = 4000;
  }

  /**
   * Checks whether a position is currently on the temporary blacklist
   */
  isBlacklisted(pos) {
    if (!pos) return false;
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    const exp = this.blacklist.get(key);
    if (!exp) return false;
    if (Date.now() > exp) {
      this.blacklist.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Adds a container position to temporary blacklist (e.g. unreachable, timeout)
   */
  addToBlacklist(pos, durationMs = 60000) {
    if (!pos) return;
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    this.blacklist.set(key, Date.now() + durationMs);
  }

  /**
   * Clears all entries from the blacklist
   */
  clearBlacklist() {
    this.blacklist.clear();
  }

  /**
   * Determines if a container block is physically unobstructed and can be opened in Java Edition.
   * Barrels can open even when covered from above.
   * Standard and trapped chests cannot open if block directly at y+1 is solid/opaque.
   */
  canOpen(bot, block) {
    if (!block) return false;
    // Barrels are unobstructed in Minecraft Java Edition even with solid blocks above
    if (block.name === 'barrel') return true;

    // Standard chests and trapped chests require non-solid or transparent blocks directly above
    if (block.name === 'chest' || block.name === 'trapped_chest') {
      const pos = block.position;
      if (typeof bot?.blockAt === 'function') {
        const above = bot.blockAt(pos.offset(0, 1, 0));
        if (above && above.boundingBox === 'block' && !above.transparent) {
          return false;
        }

        // For double chests, the partner block above must also be unobstructed
        const partnerPos = this.getDoubleChestPartnerPos(bot, block);
        if (partnerPos) {
          const partnerAbove = bot.blockAt(partnerPos.offset(0, 1, 0));
          if (partnerAbove && partnerAbove.boundingBox === 'block' && !partnerAbove.transparent) {
            return false;
          }
        }
      }
    }

    return true;
  }

  /**
   * Identifies double chest companion block position using block facing and left/right type.
   * Cross-checks with adjacent blocks in world if available.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} block Chest block
   * @returns {Vec3|null} Coordinates of the partner chest block, or null if single
   */
  getDoubleChestPartnerPos(bot, block) {
    if (!block) return null;
    const props = block._properties || block.properties;
    if (!props || props.type === 'single' || !props.type) return null;

    const type = props.type; // 'left' | 'right'
    const facing = props.facing || 'north';

    // Minecraft Java relative coordinate offset based on viewer facing the chest front:
    // When chest faces North, viewing front means facing South:
    // Left half partner is at (+1, 0, 0), Right half partner is at (-1, 0, 0)
    let offset = new Vec3(0, 0, 0);
    if (facing === 'north') offset = type === 'left' ? new Vec3(1, 0, 0) : new Vec3(-1, 0, 0);
    else if (facing === 'south') offset = type === 'left' ? new Vec3(-1, 0, 0) : new Vec3(1, 0, 0);
    else if (facing === 'west') offset = type === 'left' ? new Vec3(0, 0, -1) : new Vec3(0, 0, 1);
    else if (facing === 'east') offset = type === 'left' ? new Vec3(0, 0, 1) : new Vec3(0, 0, -1);

    const partnerPos = block.position.plus(offset);

    // Verify partner block if bot.blockAt is available
    if (bot && typeof bot.blockAt === 'function') {
      const neighbor = bot.blockAt(partnerPos);
      if (neighbor && (neighbor.name === 'chest' || neighbor.name === 'trapped_chest')) {
        return partnerPos;
      }

      // Fallback: Check 4 cardinal neighbors for chest of same family
      const cardinalDeltas = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 0, 1),
        new Vec3(0, 0, -1)
      ];
      for (const d of cardinalDeltas) {
        const candidatePos = block.position.plus(d);
        const candidate = bot.blockAt(candidatePos);
        if (candidate && candidate.name === block.name) {
          const cProps = candidate._properties || candidate.properties;
          if (cProps && cProps.type && cProps.type !== 'single' && cProps.type !== type) {
            return candidatePos;
          }
        }
      }
    }

    return partnerPos;
  }

  /**
   * Scans for reachable containers in radius, filtering out obstructed blocks
   * and deduplicating double chest pairs.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {number} radius Search radius in blocks
   * @returns {Array<{ position: Vec3, block: Object, isDouble: boolean, distance: number, partnerPos: Vec3|null }>}
   */
  findContainers(bot, radius = 32) {
    if (!bot || typeof bot.findBlocks !== 'function') return [];

    VersionResolver.applyCompatibilityShims();
    const ver = bot.version === '26.3' ? '26.1' : (bot.version || '1.20.4');
    const mcData = minecraftData(ver);
    if (!mcData) return [];

    const ids = CONTAINER_NAMES
      .map(name => mcData.blocksByName[name]?.id)
      .filter(id => id !== undefined && id !== null);

    const rawPositions = bot.findBlocks({
      matching: ids,
      maxDistance: radius,
      count: 64
    });

    const processedKeys = new Set();
    const candidateContainers = [];
    const botPos = bot.entity?.position || new Vec3(0, 0, 0);

    for (const pos of rawPositions) {
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
      if (processedKeys.has(key) || this.isBlacklisted(pos)) continue;

      const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null;
      if (!block) continue;

      if (!this.canOpen(bot, block)) {
        logger.debug(`[ChestManager] Behälter bei (${pos.x}, ${pos.y}, ${pos.z}) übersprungen (oben blockiert).`);
        continue;
      }

      // Double-chest deduplication
      const partnerPos = this.getDoubleChestPartnerPos(bot, block);
      if (partnerPos) {
        const partnerKey = `${Math.floor(partnerPos.x)},${Math.floor(partnerPos.y)},${Math.floor(partnerPos.z)}`;
        processedKeys.add(partnerKey);
      }
      processedKeys.add(key);

      candidateContainers.push({
        position: pos,
        block,
        isDouble: !!partnerPos,
        partnerPos,
        distance: typeof botPos.distanceTo === 'function' ? botPos.distanceTo(pos) : 0
      });
    }

    return candidateContainers.sort((a, b) => a.distance - b.distance);
  }

  /**
   * Safely opens container with pathfinding if needed, lookAt, and timeout wrapper.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} block Container block to open
   * @param {number} timeoutMs Max wait time for container window
   * @returns {Promise<Object>} Opened container window
   */
  async openContainerSafely(bot, block, timeoutMs = this.DEFAULT_TIMEOUT_MS) {
    if (!bot || !block) throw new Error('Bot and block are required to open container');
    const pos = block.position;

    // 1. Pathfinding navigation if farther than interaction range (3.5 blocks)
    if (bot.entity?.position && typeof bot.entity.position.distanceTo === 'function') {
      const distance = bot.entity.position.distanceTo(pos);
      if (distance > 3.5) {
        if (!bot.pathfinder) {
          logger.warn('[ChestManager] Pathfinder nicht geladen, versuche direkte Interaktion.');
        } else {
          try {
            const goals = await getPathfinderGoals();
            if (goals) {
              const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2.5);
              await bot.pathfinder.goto(goal);
            }
          } catch (moveErr) {
            this.addToBlacklist(pos, 60000);
            throw new Error(`Weg zu Behälter bei (${pos.x}, ${pos.y}, ${pos.z}) nicht passierbar: ${moveErr.message}`);
          }
        }
      }
    }

    // 2. Direct gaze towards container center
    if (typeof bot.lookAt === 'function') {
      try {
        const center = pos.offset ? pos.offset(0.5, 0.5, 0.5) : pos;
        await bot.lookAt(center);
      } catch {
        // Non-critical if lookAt fails
      }
    }

    // 3. Open container with strict timeout protection
    let window = null;
    let timerId = null;
    const openPromise = bot.openContainer ? bot.openContainer(block) : Promise.reject(new Error('bot.openContainer is not a function'));
    const timeoutPromise = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error(`Container open timeout (${timeoutMs}ms)`)), timeoutMs);
    });

    try {
      window = await Promise.race([openPromise, timeoutPromise]);
      return window;
    } catch (err) {
      this.addToBlacklist(pos, 45000);
      throw err;
    } finally {
      if (timerId) clearTimeout(timerId);
    }
  }

  /**
   * Safely withdraws items from an open container window with exact free capacity calculation
   * to prevent "destination full" or "emptySlotCount === 0" exceptions.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} window Container window object
   * @param {string} itemName Name of item (without minecraft: prefix)
   * @param {number} countNeeded Desired item count
   * @returns {Promise<number>} Number of items actually withdrawn
   */
  async withdrawSafe(bot, window, itemName, countNeeded) {
    if (!bot || !window || !itemName || countNeeded <= 0) return 0;

    const containerItems = typeof window.containerItems === 'function' ? window.containerItems() : [];
    const item = containerItems.find(i => i.name === itemName);
    if (!item) return 0;

    VersionResolver.applyCompatibilityShims();
    const ver = bot.version === '26.3' ? '26.1' : (bot.version || '1.20.4');
    const mcData = minecraftData(ver);
    const itemDef = mcData?.itemsByName?.[itemName] || mcData?.blocksByName?.[itemName];
    const maxStack = itemDef?.stackSize || 64;

    // Calculate free capacity in bot inventory across empty slots and partial stacks
    let availableSpace = 0;
    const start = bot.inventory?.inventoryStart !== undefined ? bot.inventory.inventoryStart : 9;
    const end = bot.inventory?.inventoryEnd !== undefined ? bot.inventory.inventoryEnd : 44;
    const invSlots = (bot.inventory?.slots && Array.isArray(bot.inventory.slots))
      ? bot.inventory.slots.slice(start, end + 1)
      : [];

    if (invSlots.length > 0) {
      for (const slot of invSlots) {
        if (!slot) {
          availableSpace += maxStack;
        } else if (slot.name === itemName) {
          availableSpace += Math.max(0, maxStack - slot.count);
        }
      }
    } else if (typeof bot.inventory?.emptySlotCount === 'function') {
      availableSpace = bot.inventory.emptySlotCount() * maxStack;
    }

    // Mineflayer's window.withdraw strictly checks emptySlotCount() === 0 and throws if 0 empty slots exist
    if (typeof bot.inventory?.emptySlotCount === 'function' && bot.inventory.emptySlotCount() === 0) {
      logger.debug(`[ChestManager] Kein freier Inventarslot (emptySlotCount === 0) für '${itemName}'.`);
      return 0;
    }

    const availableInChest = typeof window.containerCount === 'function'
      ? window.containerCount(item.type, null)
      : containerItems.filter(i => i.name === itemName).reduce((sum, i) => sum + i.count, 0);

    const withdrawAmount = Math.min(countNeeded, availableInChest, availableSpace);
    if (withdrawAmount <= 0) {
      logger.debug(`[ChestManager] Keine Entnahme möglich für '${itemName}' (Verfügbar in Kiste: ${availableInChest}, Platz: ${availableSpace}).`);
      return 0;
    }

    try {
      if (typeof window.withdraw === 'function') {
        await window.withdraw(item.type, null, withdrawAmount);
        return withdrawAmount;
      }
      return 0;
    } catch (err) {
      if (err.message?.includes('destination full') || err.message?.includes('inventory is full')) {
        logger.debug(`[ChestManager] Inventar während Transfer gefüllt: ${err.message}`);
        return withdrawAmount;
      }
      throw err;
    }
  }

  /**
   * Safely deposits items from inventory into an open container window.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} window Container window object
   * @param {string} itemName Item to deposit
   * @param {number} count Amount to deposit
   * @returns {Promise<number>} Number of items deposited
   */
  async depositSafe(bot, window, itemName, count) {
    if (!bot?.inventory || !window || !itemName || count <= 0) return 0;
    const invItem = bot.inventory.items().find(i => i.name === itemName);
    if (!invItem) return 0;

    const depositAmount = Math.min(count, invItem.count);
    try {
      if (typeof window.deposit === 'function') {
        await window.deposit(invItem.type, null, depositAmount);
        return depositAmount;
      }
      return 0;
    } catch (err) {
      logger.debug(`[ChestManager] Fehler beim Deponieren von '${itemName}': ${err.message}`);
      return 0;
    }
  }
}

export const chestManager = new ChestManager();
