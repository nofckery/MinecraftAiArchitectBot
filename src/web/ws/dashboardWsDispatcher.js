import path from 'node:path';
import fs from 'node:fs';
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;

import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { worldExecutor } from '../../builder/worldExecutor.js';
import { undoManager } from '../../world/undoManager.js';
import { sessionHandoff } from '../../bot/sessionHandoff.js';
import { StructuralLinter } from '../../builder/structuralLinter.js';
import { schematicManager } from '../../builder/schematicManager.js';
import { VoxelCanvas } from '../../builder/voxelCanvas.js';
import { worldScanner } from '../../world/worldScanner.js';
import { generateTerrainXray, generateAreaMapData } from '../services/terrainMapService.js';
import { manualController } from '../../bot/manualController.js';

/**
 * Handles incoming WebSocket message events from the mission-control dashboard.
 * Dispatches to corresponding domain handlers (planning, CAD edits, schematic operations, controls).
 *
 * @param {Object} data - Parsed JSON WebSocket message
 * @param {import('ws').WebSocket} ws - WebSocket connection to the client
 * @param {Object} context - Server coordinator context (currentBot, architectAgent, activeCanvas, recordChat, broadcastVoxelPreview, broadcast, executeVoxelCanvasBuild)
 */
export async function handleClientWsMessage(data, ws, context) {
  const type = data.type;

  // --- Manual Gamemode Controls (Milestone 2) ---

  // Gamemode Master Toggle
  if (type === 'toggle_manual_control') {
    const shouldEnable = data.enabled !== undefined ? Boolean(data.enabled) : !manualController.isActive();
    if (shouldEnable) {
      manualController.activate(context.currentBot);
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
      selectedSlot: context.currentBot?.quickBarSlot ?? 0
    };

    if (typeof context.broadcast === 'function') {
      context.broadcast(statePayload);
    } else if (ws && typeof ws.send === 'function') {
      ws.send(JSON.stringify(statePayload));
    }
    return;
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
    return;
  }

  // Real-time camera look orientation
  if (type === 'manual_look') {
    const isDelta = Boolean(data.isDelta || data.options?.isDelta);
    const isDegrees = Boolean(data.isDegrees || data.options?.isDegrees);
    const yaw = data.yaw !== undefined ? data.yaw : data.delta?.dx;
    const pitch = data.pitch !== undefined ? data.pitch : data.delta?.dy;
    manualController.look(yaw, pitch, { isDelta: isDelta || !!data.delta, isDegrees });
    return;
  }

  // Discrete user actions (attack, dig_start, dig_stop, place, select_slot, drop_item, swap_hands)
  if (type === 'manual_action') {
    const action = data.action;
    if (action === 'attack') {
      manualController.attack(data.targetEntityId ?? data.targetId ?? null);
    } else if (action === 'dig_start') {
      let targetBlock = data.targetBlock || null;
      if (!targetBlock && data.targetBlockPos && context.currentBot?.blockAt) {
        targetBlock = context.currentBot.blockAt(data.targetBlockPos);
      }
      manualController.startDigging(targetBlock);
    } else if (action === 'dig_stop') {
      manualController.stopDigging();
    } else if (action === 'place' || action === 'interact' || action === 'use_item') {
      let refBlock = data.referenceBlock || null;
      if (!refBlock && data.targetBlockPos && context.currentBot?.blockAt) {
        refBlock = context.currentBot.blockAt(data.targetBlockPos);
      }
      const faceVector = data.targetFace || data.faceVector || null;
      await manualController.interactOrPlace(refBlock, faceVector);
    } else if (action === 'select_slot') {
      manualController.setQuickBarSlot(data.slot);
    } else if (action === 'drop_item') {
      await manualController.toss(Boolean(data.dropAll || data.dropStack));
    } else if (action === 'swap_hands') {
      if (typeof manualController.swapHands === 'function') {
        await manualController.swapHands();
      } else if (context.currentBot) {
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
    return;
  }

  // Emergency / window blur / pointer lock exit control clearing
  if (type === 'clear_movement') {
    manualController.clearControls();
    return;
  }

  // 1. Mark build area on 2D map
  if (type === 'set_build_box') {
    const { minX, minZ, maxX, maxZ, baseY, facing } = data;
    if (context.architectAgent) {
      context.architectAgent.setCustomBounds({ minX, minZ, maxX, maxZ, baseY, facing });
      const w = Math.abs(maxX - minX) + 1;
      const d = Math.abs(maxZ - minZ) + 1;
      context.recordChat('SYSTEM', `Bauplatz auf 2D-Karte markiert: ${w}x${d} Blöcke (Front: ${facing}). Ersetzt Wolle-Marker.`);
    }
    return;
  }

  // 2. Request 2D topological map data
  if (type === 'request_area_map') {
    const mapData = context.generateAreaMapData ? context.generateAreaMapData() : generateAreaMapData(context.currentBot);
    ws.send(JSON.stringify({
      type: 'area_map_data',
      grid: mapData.grid,
      center: mapData.center
    }));
    return;
  }

  // 3. Prompt architect agent
  if (type === 'prompt_architect') {
    const text = (data.text || '').trim();
    const autoExecute = !!data.autoExecute;
    if (!text) return;

    context.recordChat(settings.BOT_OWNER || 'Besitzer', text);

    if (!context.architectAgent) {
      context.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
      return;
    }

    context.recordChat('BaumeisterKI', `Plane Architektur für: "${text}"...`);

    try {
      const siteInfo = context.architectAgent.getEffectiveSiteInfo();
      let result;
      const isImported = !!(context.architectAgent.lastBuildState?.code?.includes('Imported schematic'));

      if (isImported) {
        result = await context.architectAgent.remixImportedSchematic(text);
        context.activeCanvas = result.canvas;
      } else {
        const isMod = !!(context.architectAgent.lastBuildState && /änder|ergänz|mach das|balkon|dach|stockwerk/i.test(text));
        result = await context.architectAgent.synthesizeBuild(text, siteInfo, isMod);
      }

      context.recordChat(
        'BaumeisterKI',
        `Entwurf fertiggestellt! (${result.canvas.blocks.size} Blöcke, Detailgrad: ${Math.round(result.lintReport.detailRatio * 100)}%). Siehe 3D-Vorschau.`
      );

      if (autoExecute) {
        await context.executeVoxelCanvasBuild(result.canvas, siteInfo, text);
      }
    } catch (err) {
      context.recordChat('BaumeisterKI', `Planungsfehler: ${err.message}`);
      logger.error(`Architektenfehler bei Web-Prompt: ${err.message}`);
    }
    return;
  }

  // 4. Confirm build execution
  if (type === 'confirm_build') {
    if (!context.architectAgent?.lastBuildState?.canvas) {
      context.recordChat('SYSTEM', 'Kein Entwurf vorhanden. Bitte zuerst einen Bauplan über den Chat anfordern.');
      return;
    }

    const canvas = context.architectAgent.lastBuildState.canvas;
    const siteInfo = context.architectAgent.getEffectiveSiteInfo();
    await context.executeVoxelCanvasBuild(canvas, siteInfo, 'Dashboard-Freigabe');
    return;
  }

  // 5. Bot control actions
  if (type === 'control_action') {
    const action = data.action;

    if (action === 'stop') {
      worldExecutor.abort();
      context.recordChat('SYSTEM', 'Not-Stopp ausgeführt! Bauauftrag abgebrochen.');
      return;
    }

    if (action === 'undo') {
      if (worldExecutor.isBuilding) {
        context.recordChat('SYSTEM', 'Bitte stoppe zuerst den laufenden Bau, bevor du ein Rollback machst.');
        return;
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
      return;
    }

    if (action === 'start_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.start === 'function') {
        activeBotClient.start();
        context.recordChat('SYSTEM', 'Bot-Client manuell gestartet. Verbinde mit Server...');
      }
      return;
    }

    if (action === 'stop_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.stop === 'function') {
        activeBotClient.stop();
        context.recordChat('SYSTEM', 'Bot-Client manuell getrennt & gestoppt.');
      }
      return;
    }

    if (action === 'reconnect_bot') {
      const activeBotClient = context.botClient;
      if (activeBotClient && typeof activeBotClient.reconnect === 'function') {
        activeBotClient.reconnect();
        context.recordChat('SYSTEM', 'Bot-Client Reconnect angefordert...');
      }
      return;
    }

    if (action === 'pause_for_player') {
      sessionHandoff.releaseAccount();
      context.recordChat('SYSTEM', 'Account für menschlichen Spieler freigegeben. Bot pausiert.');
      return;
    }

    if (action === 'resume_bot') {
      sessionHandoff.resumeBot();
      context.recordChat('SYSTEM', 'Bot-Wiederaufnahme angefordert. Cooldown läuft...');
      return;
    }

    if (action === 'move_to') {
      const target = data.targetPos;
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist nicht online.');
        return;
      }
      if (manualController.isActive()) {
        context.recordChat('SYSTEM', 'Pathfinder-Bewegung verweigert: Manuelle Gamemode-Steuerung ist aktiv.');
        return;
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
      return;
    }
  }

  // 6. Swap material (Palette Swap)
  if (type === 'swap_material') {
    const { fromBlock, toBlock, smartGroupSwap } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return;

    const count = canvas.swapMaterial(fromBlock, toBlock, !!smartGroupSwap);
    context.activeCanvas = canvas;
    context.recordChat('SYSTEM', `Material getauscht: ${count} Blöcke von '${fromBlock}' nach '${toBlock}'.`);

    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Palette Swap: ${fromBlock} -> ${toBlock}`
    });
    return;
  }

  // 7. Apply theme preset
  if (type === 'apply_theme') {
    const { theme } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return;

    const THEME_MAP = {
      medieval_spruce: { wood: 'spruce_planks', stone: 'stone_bricks', label: 'Mittelalter-Fichte' },
      deepslate_gothic: { wood: 'dark_oak_planks', stone: 'deepslate_bricks', label: 'Deepslate-Gotik' },
      desert_sandstone: { wood: 'birch_planks', stone: 'sandstone', label: 'Wüsten-Sandstein' },
      cherry_asian: { wood: 'cherry_planks', stone: 'blackstone', label: 'Kirschblüten-Asiatisch' }
    };

    const preset = THEME_MAP[theme];
    if (!preset) return;

    const woodCounts = {};
    const stoneCounts = {};
    const WOOD_KEYS = ['dark_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
    const KNOWN_STONES = ['stone_bricks', 'cobblestone', 'deepslate_bricks', 'deepslate_tiles', 'sandstone', 'blackstone', 'granite', 'diorite', 'andesite', 'stone'];

    for (const key of canvas.getAllBlockKeys()) {
      const blk = canvas.getByKey(key);
      if (!blk || !blk.name) continue;
      const name = blk.name;

      for (const w of WOOD_KEYS) {
        if (w === 'oak' ? (name.includes('oak') && !name.includes('dark_oak')) : name.includes(w)) {
          woodCounts[w] = (woodCounts[w] || 0) + 1;
          break;
        }
      }

      for (const s of KNOWN_STONES) {
        if (name.includes(s) || name === s) {
          stoneCounts[s] = (stoneCounts[s] || 0) + 1;
          break;
        }
      }
    }

    const dominantWood = Object.entries(woodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'oak';
    const dominantStone = Object.entries(stoneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'stone_bricks';

    const woodSwapped = canvas.swapMaterial(`${dominantWood}_planks`, preset.wood, true);
    const stoneSwapped = canvas.swapMaterial(dominantStone, preset.stone, true);
    context.activeCanvas = canvas;

    context.recordChat('SYSTEM', `Theme '${preset.label}' angewendet: ${woodSwapped + stoneSwapped} Blöcke aktualisiert.`);

    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Theme: ${preset.label}`
    });
    return;
  }

  // 8. Transform canvas (CAD symmetry, rotation, inversion)
  if (type === 'transform_canvas') {
    const { transformMode } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return;

    canvas.applySymmetryOrTransform(transformMode);
    context.activeCanvas = canvas;
    context.recordChat('SYSTEM', `Transformation '${transformMode}' angewendet.`);

    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    if (context.architectAgent?.lastBuildState) {
      context.architectAgent.lastBuildState.width = canvas.width;
      context.architectAgent.lastBuildState.depth = canvas.depth;
      context.architectAgent.lastBuildState.height = canvas.height;
      context.architectAgent.lastBuildState.facing = canvas.facing || siteInfo.facing;
    }

    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Transform: ${transformMode}`
    });
    return;
  }

  // 9. Manual single voxel edit
  if (type === 'manual_voxel_edit') {
    const { x, y, z, blockString } = data;
    let canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) {
      canvas = new VoxelCanvas(32, 32, 32);
      context.activeCanvas = canvas;
    }

    canvas.set(x, y, z, blockString || 'air');
    context.activeCanvas = canvas;
    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    if (context.architectAgent) {
      if (!context.architectAgent.lastBuildState) {
        const bounds = canvas.getBounds();
        context.architectAgent.lastBuildState = {
          code: '// Manual edit',
          origin: { ...siteInfo.origin },
          width: bounds.width || canvas.width,
          height: bounds.height || canvas.height,
          depth: bounds.depth || canvas.depth,
          facing: siteInfo.facing || 'north',
          canvas
        };
      } else {
        context.architectAgent.lastBuildState.canvas = canvas;
      }
    }

    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Voxel Edit (${x},${y},${z})`
    });

    context.broadcast({
      type: 'voxel_delta',
      x, y, z,
      blockString: blockString || 'air'
    });
    return;
  }

  // 10. AI-assisted regional editing
  if (type === 'region_ai_edit') {
    const { instruction, selectionBox } = data;
    if (!context.architectAgent) {
      context.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
      return;
    }

    if (context.activeCanvas && (!context.architectAgent.lastBuildState || context.architectAgent.lastBuildState.canvas !== context.activeCanvas)) {
      const bounds = context.activeCanvas.getBounds();
      const siteInfo = context.architectAgent.getEffectiveSiteInfo();
      context.architectAgent.lastBuildState = {
        code: '// Active canvas',
        origin: { ...siteInfo.origin },
        width: bounds.width || context.activeCanvas.width,
        height: bounds.height || context.activeCanvas.height,
        depth: bounds.depth || context.activeCanvas.depth,
        facing: siteInfo.facing || 'north',
        canvas: context.activeCanvas
      };
    }

    context.recordChat(settings.BOT_OWNER || 'Besitzer', `[Bereichs-Edit] ${instruction}`);
    context.recordChat('BaumeisterKI', `Überarbeite markierten Bereich (${selectionBox.minX}..${selectionBox.maxX}, ${selectionBox.minY}..${selectionBox.maxY}, ${selectionBox.minZ}..${selectionBox.maxZ})...`);

    try {
      const result = await context.architectAgent.refineRegionWithAI(instruction, selectionBox);
      context.activeCanvas = result.canvas;
      context.broadcastVoxelPreview({
        canvas: result.canvas,
        lintReport: result.lintReport,
        siteInfo: context.architectAgent.lastBuildState || context.architectAgent.getEffectiveSiteInfo(),
        userRequest: `[Bereichs-Edit] ${instruction}`
      });
      context.recordChat('BaumeisterKI', 'Bereich erfolgreich überarbeitet! Siehe 3D-Vorschau.');
    } catch (err) {
      context.recordChat('BaumeisterKI', `Fehler beim Bereichs-Edit: ${err.message}`);
      logger.error(`Fehler bei region_ai_edit: ${err.message}`);
    }
    return;
  }

  // 11. Clone Minecraft server world region
  if (type === 'clone_server_region') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = data;
    if (!context.currentBot) {
      context.recordChat('SYSTEM', 'Bot ist nicht online. Server-Bereich kann nicht geklont werden.');
      return;
    }
    const normMinX = Math.min(Number(minX || 0), Number(maxX || 0));
    const normMaxX = Math.max(Number(minX || 0), Number(maxX || 0));
    const normMinY = Math.min(Number(minY || 0), Number(maxY || 0));
    const normMaxY = Math.max(Number(minY || 0), Number(maxY || 0));
    const normMinZ = Math.min(Number(minZ || 0), Number(maxZ || 0));
    const normMaxZ = Math.max(Number(minZ || 0), Number(maxZ || 0));

    try {
      const canvas = await schematicManager.cloneWorldRegionToCanvas(
        context.currentBot,
        { x: normMinX, y: normMinY, z: normMinZ },
        { x: normMaxX, y: normMaxY, z: normMaxZ }
      );
      context.activeCanvas = canvas;
      const siteInfo = {
        origin: { x: normMinX, y: normMinY, z: normMinZ },
        width: canvas.width,
        depth: canvas.depth,
        height: canvas.height,
        facing: 'north'
      };
      if (context.architectAgent) {
        context.architectAgent.lastBuildState = {
          code: '// Cloned region from server',
          origin: { ...siteInfo.origin },
          width: canvas.width,
          height: canvas.height,
          depth: canvas.depth,
          facing: 'north',
          canvas
        };
      }
      const lintReport = StructuralLinter.analyze(canvas);
      context.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Server-Klon (${normMinX},${normMinY},${normMinZ})`
      });
      context.recordChat('SYSTEM', `Server-Bereich erfolgreich geklont (${canvas.blocks.size} Blöcke).`);
    } catch (err) {
      context.recordChat('SYSTEM', `Fehler beim Klonen der Welt: ${err.message}`);
    }
    return;
  }

  // 12. Load schematic from local disk
  if (type === 'load_saved_schematic') {
    const { filename } = data;
    try {
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.resolve('data/schematics', safeName);
      if (!fs.existsSync(filePath)) {
        context.recordChat('SYSTEM', `Datei '${safeName}' existiert nicht in data/schematics/.`);
        return;
      }
      const buffer = fs.readFileSync(filePath);
      const canvas = await schematicManager.loadIntoCanvas(buffer, safeName);
      context.activeCanvas = canvas;

      const bounds = canvas.getBounds();
      const siteInfo = context.architectAgent ? context.architectAgent.getEffectiveSiteInfo() : {
        origin: { x: 0, y: 64, z: 0 }, width: bounds.width, depth: bounds.depth, height: bounds.height, facing: 'north'
      };

      if (context.architectAgent) {
        context.architectAgent.lastBuildState = {
          code: `// Loaded schematic: ${safeName}`,
          origin: { ...siteInfo.origin },
          width: bounds.width,
          height: bounds.height,
          depth: bounds.depth,
          facing: siteInfo.facing || 'north',
          canvas
        };
      }

      const lintReport = StructuralLinter.analyze(canvas);
      context.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Schematic: ${safeName}`
      });
      context.recordChat('SYSTEM', `Schematic '${safeName}' geladen (${canvas.blocks.size} Blöcke).`);
    } catch (err) {
      context.recordChat('SYSTEM', `Fehler beim Laden: ${err.message}`);
    }
    return;
  }

  // 13. Terrain X-Ray scanner
  if (type === 'request_terrain_xray') {
    const siteInfo = context.architectAgent?.customSiteInfo || (context.currentBot ? worldScanner.scanBuildSite(context.currentBot) : null);
    const bounds = (context.activeCanvas || context.architectAgent?.lastBuildState?.canvas)?.getBounds() || { width: 16, height: 16, depth: 16 };
    const xrayResult = generateTerrainXray(context.currentBot, siteInfo, bounds);

    ws.send(JSON.stringify({
      type: 'terrain_xray_data',
      blocks: xrayResult.blocks,
      isSimulated: xrayResult.isSimulated
    }));
    return;
  }
}
