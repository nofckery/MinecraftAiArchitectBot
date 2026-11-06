import { chestManager } from './chestManager.js';
import { inventoryManager } from '../bot/inventoryManager.js';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';

/**
 * MaterialProcurement orchestrates gathering required Bill of Materials (BOM)
 * from nearby containers before and during construction.
 */
export class MaterialProcurement {
  /**
   * Procures all required materials from nearby chests
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Object} requiredBOM Key-value map of { [itemName]: count }
   * @param {Object} options Configuration options (radius, chatAlerts)
   * @returns {Promise<{ success: boolean, procured: Object, missing: Object }>}
   */
  async procureMaterials(bot, requiredBOM, options = {}) {
    const radius = options.radius || settings.SURVIVAL_STORAGE_SCAN_RADIUS || 32;
    const chatAlerts = options.chatAlerts !== false;

    // 1. Initial check against bot inventory
    const initialCheck = inventoryManager.checkMaterials(bot, requiredBOM);
    if (initialCheck.hasAll) {
      logger.info('[Procurement] Alle benötigten Materialien bereits im Inventar vorhanden.');
      return { success: true, procured: {}, missing: {} };
    }

    const remainingMissing = { ...initialCheck.missing };
    const procuredSummary = {};

    logger.info(`[Procurement] Starte Materialbeschaffung für: ${JSON.stringify(remainingMissing)} (Suchradius: ${radius}m)...`);
    if (chatAlerts && bot && typeof bot.chat === 'function') {
      const summaryStr = Object.entries(remainingMissing)
        .map(([m, c]) => `${c}x ${m}`)
        .join(', ');
      bot.chat(`[Material-Suche] Suche Baumaterialien in Kisten: ${summaryStr.slice(0, 90)}`);
    }

    // 2. Discover available and unobstructed containers
    const containers = chestManager.findContainers(bot, radius);
    if (!containers || containers.length === 0) {
      logger.warn('[Procurement] Keine erreichbaren Kisten in der Umgebung gefunden.');
      if (chatAlerts && bot && typeof bot.chat === 'function') {
        const missingList = Object.entries(remainingMissing)
          .map(([m, c]) => `${c}x ${m}`)
          .join(', ');
        bot.chat(`[Material-Suche] Keine Kisten gefunden! Benötigt: ${missingList.slice(0, 80)}`);
      }
      return { success: false, procured: {}, missing: remainingMissing };
    }

    // 3. Multi-chest procurement loop
    for (const containerInfo of containers) {
      if (Object.keys(remainingMissing).length === 0) break;

      let window = null;
      try {
        window = await chestManager.openContainerSafely(bot, containerInfo.block);
        if (!window) continue;

        for (const [matName, needed] of Object.entries(remainingMissing)) {
          if (needed <= 0) continue;

          const withdrawn = await chestManager.withdrawSafe(bot, window, matName, needed);
          if (withdrawn > 0) {
            procuredSummary[matName] = (procuredSummary[matName] || 0) + withdrawn;
            remainingMissing[matName] -= withdrawn;
            if (remainingMissing[matName] <= 0) {
              delete remainingMissing[matName];
            }
          }
        }
      } catch (containerErr) {
        logger.debug(`[Procurement] Fehler bei Kiste an Position ${containerInfo.position}: ${containerErr.message}`);
      } finally {
        if (window) {
          try {
            window.close();
          } catch {
            // Safe ignore on window close
          }
        }
      }
    }

    // 4. Shortage manifest evaluation & chat feedback
    const success = Object.keys(remainingMissing).length === 0;
    if (success) {
      logger.info(`[Procurement] Erfolgreich alle Materialien beschafft! ${JSON.stringify(procuredSummary)}`);
      if (chatAlerts && bot && typeof bot.chat === 'function') {
        bot.chat('[Material-Suche] Alle Baumaterialien vollständig aus Kisten beschafft!');
      }
    } else {
      const missingList = Object.entries(remainingMissing)
        .map(([m, c]) => `${c}x ${m}`)
        .join(', ');
      logger.warn(`[Procurement] Fehlende Materialien nach Kistensuche: ${missingList}`);
      if (chatAlerts && bot && typeof bot.chat === 'function') {
        bot.chat(`[Material-Suche] Mir fehlen noch: ${missingList.slice(0, 80)}. Bitte in Kiste bereitstellen!`);
      }
    }

    return {
      success,
      procured: procuredSummary,
      missing: remainingMissing
    };
  }
}

export const materialProcurement = new MaterialProcurement();
