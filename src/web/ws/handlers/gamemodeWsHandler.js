import { Vec3 } from 'vec3';
import { logger } from '../../../utils/logger.js';
import { manualController } from '../../../bot/manualController.js';

const GAMEMODE_WS_TYPES = new Set([
  'toggle_manual_control',
  'manual_movement',
  'manual_look',
  'manual_action',
  'send_chat',
  'chat_message',
  'inventory_click',
  'close_window',
  'respawn',
  'clear_movement'
]);

/**
 * Checks if message type belongs to manual gamemode domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isGamemodeWsMessage(type) {
  return GAMEMODE_WS_TYPES.has(type);
}

/**
 * Handles all real-time manual gamemode WebSocket interactions.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>} Whether the message was handled
 */
export async function handleGamemodeWsMessage(data, ws, context) {
  const type = data.type;
  if (!isGamemodeWsMessage(type)) return false;

  // Gamemode Master Toggle
  if (type === 'toggle_manual_control') {
    const shouldEnable = data.enabled !== undefined ? Boolean(data.enabled) : !manualController.isActive();
    if (shouldEnable) {
      manualController.activate(context?.currentBot);
      if (context) {
        context.operatorSocket = ws;
      }
    } else {
      manualController.deactivate();
      if (context && context.operatorSocket === ws) {
        context.operatorSocket = null;
      }
    }

    const statePayload = {
      type: 'manual_control_state',
      active: manualController.isActive(),
      selectedSlot: context?.currentBot?.quickBarSlot ?? 0
    };

    if (context && typeof context.broadcast === 'function') {
      context.broadcast(statePayload);
    } else if (ws && typeof ws.send === 'function') {
      ws.send(JSON.stringify(statePayload));
    }
    return true;
  }

  // Real-time movement inputs (WASD, Space, Shift, Ctrl)
  if (type === 'manual_movement') {
    if (data.control && typeof data.control === 'string') {
      manualController.setControlState(data.control, data.state);
    } else if (data.state && typeof data.state === 'object') {
      manualController.setControls(data.state);
    } else if (data.controls && typeof data.controls === 'object') {
      manualController.setControls(data.controls);
    }
    return true;
  }

  // Real-time camera look orientation
  if (type === 'manual_look') {
    const isDelta = Boolean(data.isDelta || data.options?.isDelta || (data.yaw === undefined && data.delta));
    const isDegrees = Boolean(data.isDegrees || data.options?.isDegrees);
    const yaw = data.yaw !== undefined ? data.yaw : data.delta?.dx;
    const pitch = data.pitch !== undefined ? data.pitch : data.delta?.dy;
    manualController.look(yaw, pitch, { isDelta, isDegrees });
    return true;
  }

  // Discrete user actions (attack, dig_start, dig_stop, place, select_slot, drop_item, swap_hands, use_item)
  if (type === 'manual_action') {
    const action = data.action;
    if (action === 'attack') {
      manualController.attack(data.targetEntityId ?? data.targetId ?? null);
    } else if (action === 'dig_start') {
      let targetBlock = data.targetBlock || null;
      if (!targetBlock && data.targetBlockPos && context?.currentBot?.blockAt) {
        const bp = data.targetBlockPos;
        const vPos = (typeof bp.x === 'number') ? new Vec3(bp.x, bp.y, bp.z) : bp;
        targetBlock = context.currentBot.blockAt(vPos);
      }
      const targetFace = data.targetFace || data.faceVector || null;
      manualController.startDigging(targetBlock, targetFace);
    } else if (action === 'dig_stop') {
      manualController.stopDigging();
    } else if (action === 'place' || action === 'interact' || action === 'use_item') {
      let refBlock = data.referenceBlock || null;
      if (!refBlock && data.targetBlockPos && context?.currentBot?.blockAt) {
        const bp = data.targetBlockPos;
        const vPos = (typeof bp.x === 'number') ? new Vec3(bp.x, bp.y, bp.z) : bp;
        refBlock = context.currentBot.blockAt(vPos);
      }
      const faceVector = data.targetFace || data.faceVector || null;
      await manualController.interactOrPlace(refBlock, faceVector);
    } else if (action === 'use_item_start') {
      manualController.startUsingItem();
    } else if (action === 'use_item_stop') {
      manualController.stopUsingItem();
    } else if (action === 'select_slot') {
      manualController.setQuickBarSlot(data.slot);
    } else if (action === 'drop_item') {
      await manualController.toss(Boolean(data.dropAll || data.dropStack));
    } else if (action === 'swap_hands') {
      if (typeof manualController.swapHands === 'function') {
        await manualController.swapHands();
      } else if (context?.currentBot) {
        try {
          const heldItem = context.currentBot.heldItem;
          if (heldItem && typeof context.currentBot.equip === 'function') {
            await context.currentBot.equip(heldItem, 'off-hand');
          }
        } catch (err) {
          logger.debug(`[ManualAction] swap_hands Fehler: ${err.message}`);
        }
      }
    }
    return true;
  }

  // Public Minecraft Chat to server & players
  if (type === 'send_chat' || type === 'chat_message') {
    const text = (data.message || data.text || '').trim();
    if (!text) return true;
    if (context?.currentBot && typeof context.currentBot.chat === 'function') {
      try {
        context.currentBot.chat(text);
        logger.info(`[Chat] Spieler im Gamemode hat gesendet: "${text}"`);
      } catch (err) {
        logger.warn(`[Chat] Fehler beim Senden: ${err.message}`);
      }
    } else if (context && typeof context.recordChat === 'function') {
      context.recordChat('SYSTEM', 'Kann Chat-Nachricht nicht senden: Bot ist offline.');
    }
    return true;
  }

  // Interactive full player & container inventory slot clicking
  if (type === 'inventory_click') {
    const slot = Number(data.slot);
    const button = Number(data.button ?? 0); // 0=left, 1=right
    const mode = Number(data.mode ?? 0); // 0=click, 1=shift-click, 4=drop
    if (!Number.isNaN(slot) && context?.currentBot) {
      const win = context.currentBot.currentWindow || context.currentBot.inventory;
      if (win && typeof context.currentBot.clickWindow === 'function') {
        try {
          await context.currentBot.clickWindow(slot, button, mode);
          if (typeof context.sendTelemetry === 'function') {
            context.sendTelemetry();
          }
        } catch (err) {
          logger.debug(`[Inventory] clickWindow Fehler: ${err.message}`);
        }
      }
    }
    return true;
  }

  // Close active container window
  if (type === 'close_window') {
    if (context?.currentBot?.currentWindow) {
      try {
        context.currentBot.closeWindow(context.currentBot.currentWindow);
        if (typeof context.sendTelemetry === 'function') {
          context.sendTelemetry();
        }
      } catch (err) {
        logger.debug(`[Inventory] closeWindow Fehler: ${err.message}`);
      }
    }
    return true;
  }

  // Respawn bot after death
  if (type === 'respawn') {
    if (context?.currentBot && typeof context.currentBot.respawn === 'function') {
      try {
        context.currentBot.respawn();
        logger.info('[Gamemode] Bot-Respawn erfolgreich ausgeführt.');
        if (typeof context.sendTelemetry === 'function') {
          context.sendTelemetry();
        }
      } catch (err) {
        logger.warn(`[Gamemode] Respawn-Fehler: ${err.message}`);
      }
    }
    return true;
  }

  // Emergency / window blur / pointer lock exit control clearing
  if (type === 'clear_movement') {
    manualController.clearControls();
    return true;
  }

  return false;
}
