import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { sessionHandoff } from '../../bot/sessionHandoff.js';
import { serverRights } from '../../bot/serverRights.js';
import { worldExecutor } from '../../builder/worldExecutor.js';
import { llmRouter } from '../../ai/llmRouter.js';
import { manualController } from '../../bot/manualController.js';

/**
 * Builds hotbar slot data (0..8) from bot inventory and manualController.
 * @param {any} bot
 * @param {any} controller
 * @returns {Array<{slot: number, name: string|null, displayName: string, count: number, selected: boolean, durabilityUsed: number}>}
 */
export function buildHotbarData(bot, controller = manualController) {
  const selectedSlot = bot?.quickBarSlot ?? 0;
  const hotbar = [];
  const slots = bot?.inventory?.slots;
  const rawHotbar = (typeof controller?.getHotbarInfo === 'function') ? controller.getHotbarInfo() : [];

  for (let i = 0; i < 9; i++) {
    const slotItem = slots ? slots[36 + i] : null;
    const hotbarEntry = rawHotbar.find(h => h.slot === i);
    const item = slotItem || hotbarEntry?.item || (hotbarEntry?.name ? hotbarEntry : null);
    hotbar.push({
      slot: i,
      name: item ? (item.name ?? null) : null,
      displayName: item ? (item.displayName || item.name || 'Empty') : 'Empty',
      count: item ? (item.count ?? 0) : 0,
      selected: i === selectedSlot,
      durabilityUsed: item?.durabilityUsed ?? 0
    });
  }
  return hotbar;
}

/**
 * Builds raycast target inspection data for current look vector.
 * @param {any} bot
 * @param {any} controller
 * @returns {any}
 */
export function buildRaycastData(bot, controller = manualController) {
  let raycast = {
    type: 'none',
    name: null,
    displayName: null,
    distance: null,
    position: null
  };

  try {
    const target = (typeof controller?.inspectTarget === 'function')
      ? controller.inspectTarget(4.5)
      : null;

    if (target) {
      const targetType = (target.kind === 'entity' || target.type === 'entity') ? 'entity' : 'block';
      raycast = {
        type: targetType,
        name: target.name || null,
        displayName: target.displayName || target.name || (targetType === 'entity' ? 'Entity' : 'Block'),
        distance: typeof target.distance === 'number' ? target.distance : null,
        position: target.position || (target.id && bot?.entities?.[target.id]?.position ? {
          x: Math.round(bot.entities[target.id].position.x * 10) / 10,
          y: Math.round(bot.entities[target.id].position.y * 10) / 10,
          z: Math.round(bot.entities[target.id].position.z * 10) / 10
        } : null),
        face: target.face ?? null,
        faceVector: target.faceVector ?? null,
        digTime: target.digTime ?? null
      };
    }
  } catch (err) {
    logger.debug(`[Telemetry] Raycast-Inspektionsfehler: ${err.message}`);
  }

  return raycast;
}

/**
 * Compiles full bot telemetry payload.
 * @param {object} context
 * @returns {object}
 */
export function buildBotTelemetry({
  bot,
  controller = manualController,
  router = llmRouter,
  executor = worldExecutor
} = {}) {
  if (bot && controller.bot !== bot) {
    controller.setBot(bot);
  }

  const pos = bot?.entity?.position ? {
    x: Math.round(bot.entity.position.x * 10) / 10,
    y: Math.round(bot.entity.position.y * 10) / 10,
    z: Math.round(bot.entity.position.z * 10) / 10
  } : { x: 0, y: 0, z: 0 };

  const yaw = bot?.entity?.yaw || 0;
  const pitch = bot?.entity?.pitch || 0;
  const health = bot?.health ?? 20;
  const food = bot?.food ?? 20;
  const mode = settings.BUILD_EXECUTION_MODE;
  const effectiveMode = executor.resolveMode(settings.BUILD_EXECUTION_MODE, bot);
  const rights = serverRights.getStatus(bot);
  const buildProgress = executor.getProgress();
  const llmProvider = (router || llmRouter).getActiveProviderName();

  const selectedSlot = bot?.quickBarSlot ?? 0;
  const hotbar = buildHotbarData(bot, controller);
  const raycast = buildRaycastData(bot, controller);

  const manualControl = {
    active: controller.isActive(),
    selectedSlot,
    controls: controller.getActiveControls(),
    isDigging: Boolean(controller.isDigging),
    digProgress: (typeof controller.getDigProgress === 'function') ? controller.getDigProgress() : 0,
    currentDigBlock: controller.currentDigBlock?.position ? {
      x: controller.currentDigBlock.position.x,
      y: controller.currentDigBlock.position.y,
      z: controller.currentDigBlock.position.z
    } : null
  };

  const fullInventory = (typeof controller.getFullInventory === 'function')
    ? controller.getFullInventory()
    : null;

  return {
    type: 'bot_telemetry',
    pos,
    yaw,
    pitch,
    health,
    food,
    mode,
    effectiveMode,
    serverRights: rights,
    buildProgress,
    llmProvider,
    status: sessionHandoff.state,
    username: bot?.username || settings.MC_USERNAME || 'BaumeisterKI',
    manualControl,
    hotbar,
    fullInventory,
    raycast
  };
}
