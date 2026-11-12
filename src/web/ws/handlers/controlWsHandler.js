import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;

import { settings } from '../../../config/settings.js';
import { logger } from '../../../utils/logger.js';
import { worldExecutor } from '../../../builder/worldExecutor.js';
import { undoManager } from '../../../world/undoManager.js';
import { sessionHandoff } from '../../../bot/sessionHandoff.js';
import { sleepController, SLEEP_STATES } from '../../../bot/sleepController.js';
import { envManager } from '../../../config/envManager.js';
import { worldScanner } from '../../../world/worldScanner.js';
import { generateTerrainXray, generateAreaMapData } from '../../services/terrainMapService.js';
import { manualController } from '../../../bot/manualController.js';
import { guardManager } from '../../../bot/guardManager.js';
import { harvestManager } from '../../../survival/harvestManager.js';

const CONTROL_WS_TYPES = new Set([
  'toggle_sleep_disconnect',
  'toggle_minecraft_chat',
  'toggle_chat',
  'set_build_box',
  'request_area_map',
  'request_terrain_xray',
  'control_action'
]);

/**
 * Checks if message type belongs to bot/control/environment domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isControlWsMessage(type) {
  return CONTROL_WS_TYPES.has(type);
}

/**
 * Handles bot control, sleep disconnect, chat toggle, area map, and bot pathing WS messages.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>}
 */
export async function handleControlWsMessage(data, ws, context) {
  const type = data.type;
  if (!isControlWsMessage(type)) return false;

  // 1. Toggle night disconnect mechanic (Serververlassen für die Nacht)
  if (type === 'toggle_sleep_disconnect') {
    const enabled = data.enabled !== undefined ? Boolean(data.enabled) : !settings.SLEEP_DISCONNECT_ON_NO_BED;
    sleepController.setNightDisconnectEnabled(enabled);
    envManager.saveConfig({ SLEEP_DISCONNECT_ON_NO_BED: enabled });

    context.broadcast({
      type: 'night_disconnect_toggled',
      enabled,
      settings: envManager.getCurrentSettings()
    });

    const msg = enabled
      ? '🌙 Automatisches Serververlassen bei Nacht AKTIVIERT (Nacht-Skip aktiv).'
      : '☀️ Automatisches Serververlassen bei Nacht DEAKTIVIERT (Bot bleibt nachts auf dem Server).';
    context.recordChat('SYSTEM', msg);
    return true;
  }

  // 2. Toggle Minecraft in-game chat (Stiller Modus / Silent Mode)
  if (type === 'toggle_minecraft_chat' || type === 'toggle_chat') {
    const enabled = data.enabled !== undefined ? Boolean(data.enabled) : !settings.ENABLE_MINECRAFT_CHAT;
    settings.ENABLE_MINECRAFT_CHAT = enabled;
    envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: enabled });

    context.broadcast({
      type: 'settings_updated',
      settings: envManager.getCurrentSettings()
    });

    const msg = enabled
      ? '💬 Minecraft In-Game Chat AKTIVIERT (Bot antwortet im Server-Chat).'
      : '🤫 Minecraft In-Game Chat DEAKTIVIERT (Stiller Modus aktiv: Status & Antworten nur noch im Web-Dashboard).';
    context.recordChat('SYSTEM', msg);
    return true;
  }

  // 3. Mark build area on 2D map
  if (type === 'set_build_box') {
    const { minX, minZ, maxX, maxZ, baseY, facing } = data;
    if (context.architectAgent) {
      context.architectAgent.setCustomBounds({ minX, minZ, maxX, maxZ, baseY, facing });
      const w = Math.abs(maxX - minX) + 1;
      const d = Math.abs(maxZ - minZ) + 1;
      context.recordChat('SYSTEM', `Bauplatz auf 2D-Karte markiert: ${w}x${d} Blöcke (Front: ${facing}). Ersetzt Wolle-Marker.`);
    }
    return true;
  }

  // 4. Request 2D topological map data
  if (type === 'request_area_map') {
    const mapData = context.generateAreaMapData ? context.generateAreaMapData() : generateAreaMapData(context.currentBot);
    ws.send(JSON.stringify({
      type: 'area_map_data',
      grid: mapData.grid,
      center: mapData.center
    }));
    return true;
  }

  // 5. Terrain X-Ray scanner
  if (type === 'request_terrain_xray') {
    const siteInfo = context.architectAgent?.customSiteInfo || (context.currentBot ? worldScanner.scanBuildSite(context.currentBot) : null);
    const bounds = (context.activeCanvas || context.architectAgent?.lastBuildState?.canvas)?.getBounds() || { width: 16, height: 16, depth: 16 };
    const xrayResult = generateTerrainXray(context.currentBot, siteInfo, bounds);

    ws.send(JSON.stringify({
      type: 'terrain_xray_data',
      blocks: xrayResult.blocks,
      isSimulated: xrayResult.isSimulated
    }));
    return true;
  }

  // 6. Bot control actions
  if (type === 'control_action') {
    const action = data.action;

    if (action === 'stop') {
      worldExecutor.abort();
      guardManager.stopGuarding();
      harvestManager.abort();
      if (context.currentBot?.pathfinder) {
        try { context.currentBot.pathfinder.stop(); } catch {}
      }
      context.recordChat('SYSTEM', 'Not-Stopp ausgeführt! Alle Bau-, Mining- und Wach-Aufträge abgebrochen.');
      return true;
    }

    if (action === 'undo') {
      if (worldExecutor.isBuilding) {
        context.recordChat('SYSTEM', 'Bitte stoppe zuerst den laufenden Bau, bevor du ein Rollback machst.');
        return true;
      }
      context.recordChat('SYSTEM', 'Starte Rollback des letzten Bauwerks aus dem Snapshot-Journal...');
      try {
        const undone = await undoManager.executeUndo(context.currentBot, worldExecutor);
        if (undone) {
          context.recordChat('SYSTEM', `Rollback für '${undone.buildTitle}' abgeschlossen (${undone.blockCount} Blöcke).`);
        } else {
          context.recordChat('SYSTEM', 'Kein Snapshot im Undo-Journal vorhanden.');
        }
      } catch (err) {
        context.recordChat('SYSTEM', `Fehler beim Rollback: ${err.message}`);
      }
      return true;
    }

    if (action === 'start_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.start === 'function') {
        activeBotClient.start();
        context.recordChat('SYSTEM', 'Bot-Client manuell gestartet. Verbinde mit Server...');
      }
      return true;
    }

    if (action === 'stop_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.stop === 'function') {
        activeBotClient.stop();
        context.recordChat('SYSTEM', 'Bot-Client manuell getrennt & gestoppt.');
      }
      return true;
    }

    if (action === 'reconnect_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.reconnect === 'function') {
        activeBotClient.reconnect();
        context.recordChat('SYSTEM', 'Bot-Client Reconnect angefordert...');
      }
      return true;
    }

    if (action === 'pause_for_player') {
      sessionHandoff.releaseAccount();
      context.recordChat('SYSTEM', 'Account für menschlichen Spieler freigegeben. Bot pausiert.');
      return true;
    }

    if (action === 'resume_bot') {
      if (sleepController.reconnectTimer) {
        clearTimeout(sleepController.reconnectTimer);
        sleepController.reconnectTimer = null;
      }
      sleepController.wasDisconnectedForNight = false;
      sleepController.state = SLEEP_STATES.AWAKE;
      sessionHandoff.resumeBot();
      context.recordChat('SYSTEM', 'Bot-Wiederaufnahme angefordert. Cooldown läuft...');
      return true;
    }

    if (action === 'toggle_sleep_disconnect') {
      const enabled = data.enabled !== undefined ? Boolean(data.enabled) : !settings.SLEEP_DISCONNECT_ON_NO_BED;
      sleepController.setNightDisconnectEnabled(enabled);
      envManager.saveConfig({ SLEEP_DISCONNECT_ON_NO_BED: enabled });

      context.broadcast({
        type: 'night_disconnect_toggled',
        enabled,
        settings: envManager.getCurrentSettings()
      });

      const msg = enabled
        ? '🌙 Automatisches Serververlassen bei Nacht AKTIVIERT (Nacht-Skip aktiv).'
        : '☀️ Automatisches Serververlassen bei Nacht DEAKTIVIERT (Bot bleibt nachts auf dem Server).';
      context.recordChat('SYSTEM', msg);
      return true;
    }

    if (action === 'move_to') {
      const target = data.targetPos;
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist nicht online.');
        return true;
      }
      if (manualController.isActive()) {
        context.recordChat('SYSTEM', 'Pathfinder-Bewegung verweigert: Manuelle Gamemode-Steuerung ist aktiv.');
        return true;
      }
      if (context.currentBot.pathfinder && target) {
        const tx = Number(target.x);
        const ty = typeof target.y === 'number' && !Number.isNaN(target.y) ? target.y : (context.currentBot.entity?.position?.y || 64);
        const tz = Number(target.z);

        if (!Number.isNaN(tx) && !Number.isNaN(tz)) {
          context.recordChat('SYSTEM', `Schicke Bot zu Koordinate (${Math.round(tx)}, ${Math.round(ty)}, ${Math.round(tz)})...`);
          try {
            context.currentBot.pathfinder.setGoal(new goals.GoalNear(tx, ty, tz, 2));
          } catch (err) {
            context.recordChat('SYSTEM', `Pathfinder-Fehler: ${err.message}`);
          }
        } else {
          context.recordChat('SYSTEM', 'Ungültige Koordinaten für move_to empfangen.');
        }
      } else {
        context.recordChat('SYSTEM', 'Pathfinder nicht verfügbar oder ungültige Koordinate.');
      }
      return true;
    }
  }

  return false;
}
