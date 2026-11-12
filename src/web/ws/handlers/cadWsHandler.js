import { StructuralLinter } from '../../../builder/structuralLinter.js';
import { VoxelCanvas } from '../../../builder/voxelCanvas.js';

const CAD_WS_TYPES = new Set([
  'swap_material',
  'apply_theme',
  'transform_canvas',
  'manual_voxel_edit',
  'fill_selection',
  'clear_selection'
]);

/**
 * Checks if message type belongs to CAD and voxel manipulation domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isCadWsMessage(type) {
  return CAD_WS_TYPES.has(type);
}

/**
 * Handles palette swapping, theme presets, symmetry/rotation, single-voxel edits, and selection filling/clearing.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>}
 */
export async function handleCadWsMessage(data, ws, context) {
  const type = data.type;
  if (!isCadWsMessage(type)) return false;

  // 1. Swap material (Palette Swap)
  if (type === 'swap_material') {
    const { fromBlock, toBlock, smartGroupSwap } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return true;

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
    return true;
  }

  // 2. Apply theme preset
  if (type === 'apply_theme') {
    const { theme } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return true;

    const THEME_MAP = {
      medieval_spruce: { wood: 'spruce_planks', stone: 'stone_bricks', label: 'Mittelalter-Fichte' },
      deepslate_gothic: { wood: 'dark_oak_planks', stone: 'deepslate_bricks', label: 'Deepslate-Gotik' },
      desert_sandstone: { wood: 'birch_planks', stone: 'sandstone', label: 'Wüsten-Sandstein' },
      cherry_asian: { wood: 'cherry_planks', stone: 'blackstone', label: 'Kirschblüten-Asiatisch' }
    };

    const preset = THEME_MAP[theme];
    if (!preset) return true;

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
    return true;
  }

  // 3. Transform canvas (CAD symmetry, rotation, inversion)
  if (type === 'transform_canvas') {
    const { transformMode } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas) return true;

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
    return true;
  }

  // 4. Manual single voxel edit
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

    context.broadcast({
      type: 'voxel_delta',
      x, y, z,
      blockString: blockString || 'air'
    });
    if (context.architectAgent && typeof context.architectAgent.recordUserStudioDelta === 'function') {
      context.architectAgent.recordUserStudioDelta(`Manueller Voxel-Edit bei (${x},${y},${z}) -> '${blockString || 'air'}'`);
    }

    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Voxel Edit (${x},${y},${z})`
    });
    return true;
  }

  // 5. Fill selection box
  if (type === 'fill_selection') {
    const { selectionBox, blockString, hollow } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas || !selectionBox) return true;

    const minX = Math.min(selectionBox.minX, selectionBox.maxX);
    const maxX = Math.max(selectionBox.minX, selectionBox.maxX);
    const minY = Math.min(selectionBox.minY, selectionBox.maxY);
    const maxY = Math.max(selectionBox.minY, selectionBox.maxY);
    const minZ = Math.min(selectionBox.minZ, selectionBox.maxZ);
    const maxZ = Math.max(selectionBox.minZ, selectionBox.maxZ);

    canvas.box(minX, minY, minZ, maxX, maxY, maxZ, blockString || 'stone_bricks', !!hollow);
    context.activeCanvas = canvas;
    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    context.recordChat('SYSTEM', `Bereich (${minX}..${maxX}, ${minY}..${maxY}, ${minZ}..${maxZ}) gefüllt mit '${blockString || 'stone_bricks'}'.`);
    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Fill Selection (${minX}..${maxX})`
    });
    return true;
  }

  // 6. Clear selection box
  if (type === 'clear_selection') {
    const { selectionBox } = data;
    const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
    if (!canvas || !selectionBox) return true;

    const minX = Math.min(selectionBox.minX, selectionBox.maxX);
    const maxX = Math.max(selectionBox.minX, selectionBox.maxX);
    const minY = Math.min(selectionBox.minY, selectionBox.maxY);
    const maxY = Math.max(selectionBox.minY, selectionBox.maxY);
    const minZ = Math.min(selectionBox.minZ, selectionBox.maxZ);
    const maxZ = Math.max(selectionBox.minZ, selectionBox.maxZ);

    canvas.box(minX, minY, minZ, maxX, maxY, maxZ, 'air', false);
    context.activeCanvas = canvas;
    const lintReport = StructuralLinter.analyze(canvas);
    const siteInfo = context.architectAgent?.lastBuildState?.siteInfo || context.architectAgent?.getEffectiveSiteInfo() || {
      origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
    };

    context.recordChat('SYSTEM', `Bereich (${minX}..${maxX}, ${minY}..${maxY}, ${minZ}..${maxZ}) geleert.`);
    context.broadcastVoxelPreview({
      canvas,
      lintReport,
      siteInfo,
      userRequest: `Clear Selection (${minX}..${maxX})`
    });
    return true;
  }

  return false;
}
