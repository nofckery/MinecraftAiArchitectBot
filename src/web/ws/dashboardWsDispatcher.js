import { logger } from '../../utils/logger.js';
import { handleGamemodeWsMessage, isGamemodeWsMessage } from './handlers/gamemodeWsHandler.js';
import { handleControlWsMessage, isControlWsMessage } from './handlers/controlWsHandler.js';
import { handleArchitectWsMessage, isArchitectWsMessage } from './handlers/architectWsHandler.js';
import { handleCadWsMessage, isCadWsMessage } from './handlers/cadWsHandler.js';
import { handleSchematicWsMessage, isSchematicWsMessage } from './handlers/schematicWsHandler.js';
import { handleStudioWsMessage, isStudioWsMessage } from './handlers/studioWsHandler.js';

export {
  handleGamemodeWsMessage,
  isGamemodeWsMessage,
  handleControlWsMessage,
  isControlWsMessage,
  handleArchitectWsMessage,
  isArchitectWsMessage,
  handleCadWsMessage,
  isCadWsMessage,
  handleSchematicWsMessage,
  isSchematicWsMessage,
  handleStudioWsMessage,
  isStudioWsMessage
};

/**
 * Handles incoming WebSocket message events from the mission-control dashboard.
 * Dispatches cleanly to corresponding domain handlers (planning, CAD edits, schematic operations, controls, studio).
 *
 * @param {Object} data - Parsed JSON WebSocket message
 * @param {import('ws').WebSocket} ws - WebSocket connection to the client
 * @param {Object} context - Server coordinator context
 */
export async function handleClientWsMessage(data, ws, context) {
  if (!data || typeof data !== 'object') return;
  const type = data.type;

  // 1. Manual Gamemode Controls
  if (isGamemodeWsMessage(type)) {
    await handleGamemodeWsMessage(data, ws, context);
    return;
  }

  // 2. Bot / Sleep / Chat Controls & Area Map
  if (isControlWsMessage(type)) {
    await handleControlWsMessage(data, ws, context);
    return;
  }

  // 3. AI Architect Planning & Prompting
  if (isArchitectWsMessage(type)) {
    await handleArchitectWsMessage(data, ws, context);
    return;
  }

  // 4. CAD & Voxel Canvas Modifications
  if (isCadWsMessage(type)) {
    await handleCadWsMessage(data, ws, context);
    return;
  }

  // 5. Schematic Cloning & Local File Loading
  if (isSchematicWsMessage(type)) {
    await handleSchematicWsMessage(data, ws, context);
    return;
  }

  // 6. CAD World Studio & Spatial AI CoPilot
  if (isStudioWsMessage(type)) {
    await handleStudioWsMessage(data, ws, context);
    return;
  }

  logger.warn(`[WsDispatcher] Unbekannter WebSocket-Nachrichtentyp empfangen: ${type}`);
}
