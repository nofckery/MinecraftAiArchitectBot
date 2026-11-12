import fs from 'node:fs';
import { settings } from '../../../config/settings.js';
import { VoxelCanvas } from '../../../builder/voxelCanvas.js';
import {
  scan3DTerrainRelief,
  analyzeSceneVerifier
} from '../../services/terrainMapService.js';

const STUDIO_WS_TYPES = new Set([
  'studio_scan_terrain',
  'studio_sync_scene',
  'studio_ai_copilot',
  'studio_execute_build_queue'
]);

/**
 * Checks if message type belongs to CAD World Studio domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isStudioWsMessage(type) {
  return STUDIO_WS_TYPES.has(type);
}

/**
 * Handles CAD World Studio terrain relief scans, scene graph syncing, spatial AI copilot, and build queues.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>}
 */
export async function handleStudioWsMessage(data, ws, context) {
  const type = data.type;
  if (!isStudioWsMessage(type)) return false;

  // 1. CAD World Studio: Hybrid 3D Terrain & Relief Scan
  if (type === 'studio_scan_terrain') {
    try {
      let resolvedWorldDir = data.worldDir || null;
      if (!resolvedWorldDir && data.worldId) {
        try {
          const decoded = Buffer.from(String(data.worldId), 'base64url').toString('utf8');
          if (fs.existsSync(decoded)) resolvedWorldDir = decoded;
        } catch {}
      }

      const terrain = scan3DTerrainRelief(context.currentBot, {
        worldDir: resolvedWorldDir,
        centerX: data.centerX,
        centerY: data.centerY,
        centerZ: data.centerZ,
        radius: data.radius || 32,
        includeFoliage: data.includeFoliage !== false
      });

      context.lastScannedTerrain = terrain;
      if (context.architectAgent && typeof context.architectAgent.setStudioTerrainContext === 'function') {
        context.architectAgent.setStudioTerrainContext(terrain);
      }

      ws.send(JSON.stringify({
        type: 'studio_terrain_data',
        terrain
      }));
    } catch (err) {
      ws.send(JSON.stringify({
        type: 'studio_error',
        error: `Terrain-Scan fehlgeschlagen: ${err.message}`
      }));
    }
    return true;
  }

  // 2. CAD World Studio: Real-Time Scene Graph & User Delta Synchronization
  if (type === 'studio_sync_scene') {
    if (context.architectAgent && typeof context.architectAgent.updateStudioSceneContext === 'function') {
      if (data.deltaMessage) {
        context.architectAgent.recordUserStudioDelta(data.deltaMessage);
      }
      context.architectAgent.updateStudioSceneContext({
        terrain: data.terrain || context.lastScannedTerrain,
        objects: data.objects,
        activeObjectId: data.activeObjectId,
        userDeltas: data.userDeltas
      });
    }

    if (data.requestVerify) {
      const activeTerrain = data.terrain || context.lastScannedTerrain || scan3DTerrainRelief(context.currentBot, { radius: 32 });
      const report = analyzeSceneVerifier(activeTerrain, Array.isArray(data.objects) ? data.objects : []);
      if (context.architectAgent && context.architectAgent.studioSceneContext) {
        context.architectAgent.studioSceneContext.verifierSummary = report.summary;
      }
      ws.send(JSON.stringify({
        type: 'studio_verifier_report',
        report
      }));
    }
    return true;
  }

  // 3. CAD World Studio: Omnipresent Spatial AI Co-Pilot
  if (type === 'studio_ai_copilot') {
    if (!context.architectAgent || typeof context.architectAgent.executeStudioAiCoPilot !== 'function') {
      context.recordChat('SYSTEM', 'ArchitectAgent Co-Pilot nicht verfügbar.');
      return true;
    }

    const mode = data.mode || 'focus_object';
    const instruction = (data.instruction || '').trim();
    context.recordChat(settings.BOT_OWNER || 'Besitzer', `[CAD Studio KI: ${mode}] ${instruction || 'Auto-Ausführung'}`);

    try {
      const result = await context.architectAgent.executeStudioAiCoPilot({
        mode,
        instruction,
        sceneSnapshot: data.sceneSnapshot || null,
        targetObjectId: data.targetObjectId || null,
        targetPosition: data.targetPosition || null
      });

      if (result.message) {
        context.recordChat('BaumeisterKI', result.message);
      }

      context.broadcast({
        type: 'studio_ai_result',
        mode,
        ...result
      });
    } catch (err) {
      context.recordChat('BaumeisterKI', `CAD Studio KI-Fehler: ${err.message}`);
      ws.send(JSON.stringify({
        type: 'studio_error',
        error: err.message
      }));
    }
    return true;
  }

  // 4. CAD World Studio: Sequential Multi-Object Build Queue (with Auto-Terraforming & Auto-Foundation)
  if (type === 'studio_execute_build_queue') {
    const objects = Array.isArray(data.objects) ? data.objects.filter(o => o && o.visible !== false && Array.isArray(o.blocks) && o.blocks.length > 0) : [];
    const autoTerraform = data.autoTerraform !== false;
    const autoFoundation = data.autoFoundation !== false;

    if (objects.length === 0) {
      context.recordChat('SYSTEM', 'Keine sichtbaren Objekte in der CAD-Szene zum Bauen ausgewählt.');
      return true;
    }

    context.recordChat('BaumeisterKI', `Starte sequenzielle Bau-Warteschlange für ${objects.length} Bauwerk(e) (Auto-Terraforming: ${autoTerraform ? 'An' : 'Aus'}, Auto-Fundament: ${autoFoundation ? 'An' : 'Aus'})...`);

    const activeTerrain = context.lastScannedTerrain || null;
    const verifier = activeTerrain ? analyzeSceneVerifier(activeTerrain, objects) : null;

    for (let idx = 0; idx < objects.length; idx++) {
      const obj = objects[idx];
      const pos = obj.position || { x: 0, y: 64, z: 0 };
      const facing = obj.facing || 'north';
      const w = Math.max(1, obj.bounds?.width || obj.width || 16);
      const h = Math.max(1, obj.bounds?.height || obj.height || 16);
      const d = Math.max(1, obj.bounds?.depth || obj.depth || 16);

      context.broadcast({
        type: 'studio_build_queue_progress',
        currentIndex: idx + 1,
        totalObjects: objects.length,
        objectId: obj.id,
        objectName: obj.name,
        status: 'building'
      });

      const canvas = new VoxelCanvas(w, h + 12, d, pos, facing);
      canvas.maxOps = Math.max(250000, obj.blocks.length + 50000);

      for (const b of obj.blocks) {
        if (b && b.name && b.name !== 'air') {
          canvas.set(b.x, b.y, b.z, { name: b.name, properties: b.properties || {} });
        }
      }

      // Optional Auto-Foundation & Auto-Terraforming
      const objVerifier = verifier?.objectReports?.[obj.id];
      if (objVerifier && autoFoundation && Array.isArray(objVerifier.foundationPillars)) {
        for (const p of objVerifier.foundationPillars) {
          canvas.set(p.x - pos.x, p.y - pos.y, p.z - pos.z, p.name || 'cobblestone');
        }
      }

      const siteInfo = {
        origin: { ...pos },
        width: w,
        depth: d,
        height: h,
        facing,
        groundY: pos.y
      };

      await context.executeVoxelCanvasBuild(canvas, siteInfo, `[${idx + 1}/${objects.length}] ${obj.name}`);
    }

    context.broadcast({
      type: 'studio_build_queue_progress',
      currentIndex: objects.length,
      totalObjects: objects.length,
      status: 'completed'
    });
    context.recordChat('BaumeisterKI', `Bau-Warteschlange abgeschlossen (${objects.length} Bauwerke verarbeitet).`);
    return true;
  }

  return false;
}
