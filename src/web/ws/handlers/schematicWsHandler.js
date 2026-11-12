import path from 'node:path';
import fs from 'node:fs';
import { schematicManager } from '../../../builder/schematicManager.js';
import { StructuralLinter } from '../../../builder/structuralLinter.js';

const SCHEMATIC_WS_TYPES = new Set([
  'clone_server_region',
  'load_saved_schematic'
]);

/**
 * Checks if message type belongs to schematic operations domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isSchematicWsMessage(type) {
  return SCHEMATIC_WS_TYPES.has(type);
}

/**
 * Handles world region cloning to canvas and loading schematics from local disk.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>}
 */
export async function handleSchematicWsMessage(data, ws, context) {
  const type = data.type;
  if (!isSchematicWsMessage(type)) return false;

  // 1. Clone Minecraft server world region
  if (type === 'clone_server_region') {
    const { minX, minY, minZ, maxX, maxY, maxZ } = data;
    if (!context.currentBot) {
      context.recordChat('SYSTEM', 'Bot ist nicht online. Server-Bereich kann nicht geklont werden.');
      return true;
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
    return true;
  }

  // 2. Load schematic from local disk
  if (type === 'load_saved_schematic') {
    const { filename } = data;
    try {
      const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filePath = path.resolve('data/schematics', safeName);
      if (!fs.existsSync(filePath)) {
        context.recordChat('SYSTEM', `Datei '${safeName}' existiert nicht in data/schematics/.`);
        return true;
      }
      const buffer = fs.readFileSync(filePath);
      const canvas = await schematicManager.loadIntoCanvas(buffer, safeName);
      context.activeCanvas = canvas;

      const bounds = canvas.getBounds();
      let siteInfo;
      if (context.architectAgent) {
        const probed = context.architectAgent.getEffectiveSiteInfo(null, {
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height
        });
        context.architectAgent.setCustomBounds({
          minX: probed.origin.x,
          minZ: probed.origin.z,
          maxX: probed.origin.x + bounds.width - 1,
          maxZ: probed.origin.z + bounds.depth - 1,
          baseY: probed.origin.y,
          facing: probed.facing || 'north'
        });
        siteInfo = context.architectAgent.getEffectiveSiteInfo();
      } else {
        siteInfo = {
          origin: { x: 0, y: 64, z: 0 }, width: bounds.width, depth: bounds.depth, height: bounds.height, facing: 'north'
        };
      }

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
    return true;
  }

  return false;
}
