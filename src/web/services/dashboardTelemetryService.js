import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { sessionHandoff } from '../../bot/sessionHandoff.js';
import { serverRights } from '../../bot/serverRights.js';
import { worldExecutor } from '../../builder/worldExecutor.js';
import { llmRouter } from '../../ai/llmRouter.js';
import { manualController } from '../../bot/manualController.js';
import { guardManager } from '../../bot/guardManager.js';
import { harvestManager } from '../../survival/harvestManager.js';
import { expeditionManager, EXPEDITION_STATES } from '../../survival/expeditionManager.js';

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

  const players = buildPlayersList(bot);
  const tablist = buildTablistData(bot);
  const activity = getActiveBotActivity({
    bot,
    controller,
    executor,
    guardMgr: guardManager,
    harvestMgr: harvestManager,
    expeditionMgr: expeditionManager
  });

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
    raycast,
    players,
    tablist,
    activity
  };
}

/**
 * Computes human-friendly bot activity state with categorization and details.
 * @param {object} context
 * @returns {{code: string, label: string, details: string, badgeClass: string}}
 */
export function getActiveBotActivity({
  bot,
  controller = manualController,
  executor = worldExecutor,
  guardMgr = guardManager,
  harvestMgr = harvestManager,
  expeditionMgr = expeditionManager
} = {}) {
  if (controller?.isActive?.()) {
    return {
      code: 'MANUAL',
      label: 'Manueller Gamemode',
      details: 'First-Person Steuerung aktiv',
      badgeClass: 'manual'
    };
  }

  const guardStatus = (typeof guardMgr?.getStatus === 'function') ? guardMgr.getStatus() : null;
  if (guardStatus?.active) {
    const k = guardStatus.kills || 0;
    const r = guardStatus.radius || 20;
    return {
      code: 'GUARDING',
      label: 'Wachdienst aktiv',
      details: `Schutzbereich ${r}m (${k} Feinde neutralisiert)`,
      badgeClass: 'guard'
    };
  }

  if (harvestMgr?.isHarvesting) {
    return {
      code: 'HARVESTING',
      label: 'Ressourcen-Abbau',
      details: 'Baut Erze / Holz in der Umgebung ab',
      badgeClass: 'harvest'
    };
  }

  if (expeditionMgr?.state && expeditionMgr.state !== EXPEDITION_STATES?.IDLE && expeditionMgr.state !== 'IDLE') {
    return {
      code: 'EXPEDITION',
      label: 'Höhlen-Expedition',
      details: `Phase: ${expeditionMgr.state}`,
      badgeClass: 'expedition'
    };
  }

  if (executor?.isBuilding) {
    const prog = executor.getProgress();
    return {
      code: 'BUILDING',
      label: prog?.phase || 'Bauphase aktiv',
      details: prog?.title || 'Platziert Bauwerk in der Welt',
      badgeClass: 'building'
    };
  }

  if (bot?.pathfinder?.isMoving?.()) {
    return {
      code: 'PATHFINDING',
      label: 'Unterwegs (Navigation)',
      details: 'Bewegt sich zum Zielort',
      badgeClass: 'moving'
    };
  }

  return {
    code: 'IDLE',
    label: 'Bereit / Standby',
    details: 'Wartet auf Architekten- oder Steuerbefehl',
    badgeClass: 'idle'
  };
}

/**
 * Compiles real-time player list from active bot instance.
 * @param {any} bot
 * @returns {Array<{username: string, displayName: string, uuid: string, ping: number, gamemode: number, isBot: boolean}>}
 */
export function buildPlayersList(bot) {
  if (!bot) return [];
  const players = [];
  const botUsername = bot.username || settings.MC_USERNAME || 'BaumeisterKI';

  if (bot.players && typeof bot.players === 'object') {
    for (const [key, p] of Object.entries(bot.players)) {
      if (!p) continue;
      const username = p.username || key;
      let displayName = username;
      if (typeof p.displayName === 'string' && p.displayName.trim().length > 0) {
        displayName = p.displayName.trim();
      } else if (p.displayName && typeof p.displayName.toString === 'function') {
        const str = p.displayName.toString();
        if (str && str.trim().length > 0) displayName = str.trim();
      } else if (p.displayName && typeof p.displayName.text === 'string' && p.displayName.text.trim().length > 0) {
        displayName = p.displayName.text.trim();
      }

      const isBot = Boolean(username.toLowerCase() === botUsername.toLowerCase());

      players.push({
        username,
        displayName,
        uuid: p.uuid || (isBot ? (bot._client?.uuid || '') : ''),
        ping: typeof p.ping === 'number' ? Math.max(0, Math.round(p.ping)) : 0,
        gamemode: typeof p.gamemode === 'number' ? p.gamemode : 0,
        isBot
      });
    }
  }

  // Ensure bot player is included in tablist if bot is connected
  if (botUsername && !players.some(p => p.username.toLowerCase() === botUsername.toLowerCase())) {
    players.push({
      username: botUsername,
      displayName: botUsername,
      uuid: bot._client?.uuid || '',
      ping: 0,
      gamemode: 0,
      isBot: true
    });
  }

  // Sort alphabetically by username
  players.sort((a, b) => a.username.localeCompare(b.username));
  return players;
}

/**
 * Extracts tablist header and footer from bot.
 * @param {any} bot
 * @returns {{header: string|null, footer: string|null}}
 */
export function buildTablistData(bot) {
  if (!bot || !bot.tablist) return { header: null, footer: null };
  const parseChatComponent = (comp) => {
    if (!comp) return null;
    if (typeof comp === 'string') {
      const trimmed = comp.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (typeof comp.toString === 'function') {
      const str = comp.toString().trim();
      return str.length > 0 ? str : null;
    }
    if (typeof comp.text === 'string') {
      const str = comp.text.trim();
      return str.length > 0 ? str : null;
    }
    return null;
  };

  return {
    header: parseChatComponent(bot.tablist.header),
    footer: parseChatComponent(bot.tablist.footer)
  };
}
