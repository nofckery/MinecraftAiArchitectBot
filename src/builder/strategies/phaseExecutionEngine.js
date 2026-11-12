import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { inventoryManager } from '../../bot/inventoryManager.js';
import { materialProcurement } from '../../survival/materialProcurement.js';
import { harvestManager } from '../../survival/harvestManager.js';
import { normalizeBlockName } from '../blockAliases.js';

/**
 * Checks inventory for required materials and optionally procures them from chests.
 *
 * @param {Object} executor
 * @param {Object} bot
 * @param {Array<Object>} blocks
 * @param {string} mode
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
export async function procureBuildMaterials(executor, bot, blocks, mode, options = {}) {
  if ((mode !== 'pure_physical' && !options.procureMaterials) || options.isUndo) {
    return true;
  }
  const requiredBOM = {};
  for (const b of blocks) {
    const name = normalizeBlockName(b.name || b.blockState?.name || 'stone');
    if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') {
      requiredBOM[name] = (requiredBOM[name] || 0) + 1;
    }
  }
  const materialCheck = inventoryManager.checkMaterials(bot, requiredBOM);
  if (!materialCheck.hasAll) {
    const isStrict = options.strictMaterials !== undefined ? options.strictMaterials : settings.SURVIVAL_STRICT_MATERIALS;
    if (settings.SURVIVAL_AUTO_PROCUREMENT || options.procureMaterials) {
      logger.info('[WorldExecutor] Fehlende Materialien erkannt. Starte automatische Kisten-Beschaffung...');
      const procurement = await materialProcurement.procureMaterials(bot, requiredBOM, {
        radius: options.searchRadius || settings.SURVIVAL_STORAGE_SCAN_RADIUS || 32,
        chatAlerts: true
      });
      if (!procurement.success && isStrict) {
        logger.error('Bau abgebrochen: Unvollständige Materialien nach Kistensuche im strictMaterials-Modus.');
        return false;
      }
    } else {
      const missingList = Object.entries(materialCheck.missing).map(([m, c]) => `${c}x ${m}`).join(', ');
      logger.warn(`[Survival] Fehlende Baumaterialien im Inventar: ${missingList}`);
      if (bot && typeof bot.chat === 'function') {
        bot.chat(`[Material-Prüfung] Achtung, mir fehlen Materialien: ${missingList.slice(0, 80)}`);
      }
      if (isStrict) {
        logger.error('Bau abgebrochen: Unvollständige Materialien im strictMaterials-Modus.');
        return false;
      }
    }
  }
  return true;
}

/**
 * Clears natural obstacles (vegetation, trees, dirt) on the build site in Phase 0.
 *
 * @param {Object} executor
 * @param {Object} bot
 * @param {Array<Object>} blocks
 * @param {string} mode
 * @param {Object} [options]
 * @returns {Promise<boolean>}
 */
export async function clearBuildSiteObstacles(executor, bot, blocks, mode, options = {}) {
  const shouldClear = options.clearSite !== undefined
    ? Boolean(options.clearSite)
    : (Boolean(settings.SURVIVAL_AUTO_CLEAR_SITE) || mode === 'pure_physical');

  if (!shouldClear || !bot || options.isUndo || options.resumeState) {
    return true;
  }

  executor.buildProgress.phase = 'Phase 0: Bauplatz-Rodung';
  logger.info('[WorldExecutor] Starte Phase 0: Bauplatz-Vorbereitung (Hindernis-Rodung)...');

  try {
    if (typeof harvestManager?.clearObstacles === 'function') {
      const result = await harvestManager.clearObstacles(bot, blocks, {
        chatAlerts: true,
        maxBlocks: options.maxClearBlocks || 300
      });
      logger.info(`[WorldExecutor] Phase 0 abgeschlossen: ${result.clearedCount} Hindernisse beseitigt.`);
    }
  } catch (clearErr) {
    logger.warn(`[WorldExecutor] Warnung bei Bauplatz-Rodung: ${clearErr.message}`);
  }
  return true;
}

/**
 * Executes Phase 1 solid support structure placement.
 *
 * @param {Object} executor
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function executeBuildPhase1(executor, context) {
  const { bot, blocks, options, mode, phase1Ops, startIdx1, totalOps, title, delayBetweenOpsMs } = context;
  executor.buildProgress.phase = 'Phase 1: Tragwerk';
  logger.info(`Phase 1: Setze Tragwerk & solide Strukturen (${phase1Ops.length - startIdx1} verbleibend)...`);

  for (let i = startIdx1; i < phase1Ops.length; i++) {
    if (executor.abortRequested) {
      logger.warn('Bauausführung in Phase 1 abgebrochen.');
      executor.isBuilding = false;
      executor.buildProgress.active = false;
      executor.buildProgress.phase = 'Abgebrochen';
      executor.pausedState = null;
      return { success: false, status: 'aborted' };
    }

    if (executor.pauseRequested) {
      logger.warn(`Bauausführung in Phase 1 bei Operation ${context.completedOps}/${totalOps} pausiert.`);
      executor.pausedState = {
        bot,
        blocks,
        options: { ...options, resumeState: null },
        phase: 1,
        phase1Index: i,
        phase2Index: 0,
        completedOps: context.completedOps,
        totalOps,
        title
      };
      executor.isBuilding = false;
      executor.buildProgress.active = false;
      executor.buildProgress.phase = 'Pausiert';
      return { success: false, status: 'paused' };
    }

    const op = phase1Ops[i];
    try {
      if (op.isBox) {
        if (op.volume > 1) {
          await executor.executeFillBox(bot, op, mode);
        } else {
          await executor.executeBlockChange(bot, op.minX, op.minY, op.minZ, op.fullBlockString, mode);
        }
      } else {
        await executor.executeBlockChange(bot, op.x, op.y, op.z, op.fullBlockString, mode);
      }
      context.completedOps++;
      executor.buildProgress.currentBlock = context.completedOps;
      if (mode === 'pure_physical' && i % 20 === 0 && bot) {
        inventoryManager.autoEatCheck(bot).catch(() => {});
      }
    } catch (opErr) {
      logger.warn(`Ausnahme bei Blockoperation ${context.completedOps + 1} (${opErr.message}).`);
      if (executor.isDisconnectError(bot, opErr) || bot?._client?.ended || opErr?.code === 'ERR_DISCONNECTED' || opErr?.code === 'ECONNRESET' || opErr?.code === 'ERR_STREAM_DESTROYED' || opErr?.message?.includes('disconnect')) {
        executor.pausedState = {
          bot,
          blocks,
          options: { ...options, resumeState: null },
          phase: 1,
          phase1Index: i,
          phase2Index: 0,
          completedOps: context.completedOps,
          totalOps,
          title
        };
        executor.isBuilding = false;
        executor.buildProgress.active = false;
        executor.buildProgress.phase = 'Pausiert';
        return { success: false, status: 'paused' };
      }
      throw opErr;
    }
    await new Promise(r => setTimeout(r, delayBetweenOpsMs));
  }

  return { success: true, status: 'completed' };
}

/**
 * Executes Phase 2 fragile detail placement.
 *
 * @param {Object} executor
 * @param {Object} context
 * @returns {Promise<Object>}
 */
export async function executeBuildPhase2(executor, context) {
  const { bot, blocks, options, mode, phase1Ops, phase2Ops, startIdx2, startPhase, totalOps, title, delayBetweenOpsMs } = context;
  executor.buildProgress.phase = 'Phase 2: Details';
  const effectiveStartIdx = (startPhase === 2 ? startIdx2 : 0);
  logger.info(`Phase 2: Setze fragile Blöcke & Details (${phase2Ops.length - effectiveStartIdx} verbleibend)...`);

  for (let j = effectiveStartIdx; j < phase2Ops.length; j++) {
    if (executor.abortRequested) {
      logger.warn('Bauausführung in Phase 2 abgebrochen.');
      executor.isBuilding = false;
      executor.buildProgress.active = false;
      executor.buildProgress.phase = 'Abgebrochen';
      executor.pausedState = null;
      return { success: false, status: 'aborted' };
    }

    if (executor.pauseRequested) {
      logger.warn(`Bauausführung in Phase 2 bei Operation ${context.completedOps}/${totalOps} pausiert.`);
      executor.pausedState = {
        bot,
        blocks,
        options: { ...options, resumeState: null },
        phase: 2,
        phase1Index: phase1Ops.length,
        phase2Index: j,
        completedOps: context.completedOps,
        totalOps,
        title
      };
      executor.isBuilding = false;
      executor.buildProgress.active = false;
      executor.buildProgress.phase = 'Pausiert';
      return { success: false, status: 'paused' };
    }

    const b = phase2Ops[j];
    try {
      await executor.executeBlockChange(bot, b.x, b.y, b.z, b.fullBlockString, mode);
      context.completedOps++;
      executor.buildProgress.currentBlock = context.completedOps;
      if (mode === 'pure_physical' && j % 20 === 0 && bot) {
        inventoryManager.autoEatCheck(bot).catch(() => {});
      }
    } catch (opErr) {
      logger.warn(`Ausnahme bei Phase-2 Blockoperation ${context.completedOps + 1} (${opErr.message}).`);
      if (executor.isDisconnectError(bot, opErr) || bot?._client?.ended || opErr?.code === 'ERR_DISCONNECTED' || opErr?.code === 'ECONNRESET' || opErr?.code === 'ERR_STREAM_DESTROYED' || opErr?.message?.includes('disconnect')) {
        executor.pausedState = {
          bot,
          blocks,
          options: { ...options, resumeState: null },
          phase: 2,
          phase1Index: phase1Ops.length,
          phase2Index: j,
          completedOps: context.completedOps,
          totalOps,
          title
        };
        executor.isBuilding = false;
        executor.buildProgress.active = false;
        executor.buildProgress.phase = 'Pausiert';
        return { success: false, status: 'paused' };
      }
      throw opErr;
    }
    await new Promise(r => setTimeout(r, delayBetweenOpsMs));
  }

  return { success: true, status: 'completed' };
}
