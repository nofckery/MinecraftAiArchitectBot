/**
 * Vanilla Structure Block & Create Mod Schematics (.nbt) Parser & Exporter
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';
import { VoxelCanvas } from '../voxelCanvas.js';
import { logger } from '../../utils/logger.js';

export async function parseNbtStructure(fileBuffer) {
  const { parsed } = await nbt.parse(fileBuffer);
  const data = nbt.simplify(parsed);

  const sx = Array.isArray(data.size) ? Number(data.size[0]) : Number(data.size?.x || 1);
  const sy = Array.isArray(data.size) ? Number(data.size[1]) : Number(data.size?.y || 1);
  const sz = Array.isArray(data.size) ? Number(data.size[2]) : Number(data.size?.z || 1);
  const canvas = new VoxelCanvas(sx, sy, sz, { x: 0, y: 0, z: 0 });

  const rawPalette = data.palette || (Array.isArray(data.palettes) && data.palettes[0]) || [];
  const formattedPalette = rawPalette.map(entry => {
    const rawName = String(entry.Name || entry.name || 'air').replace('minecraft:', '').trim().toLowerCase();
    const props = entry.Properties || entry.properties;
    if (!props || Object.keys(props).length === 0) {
      return rawName;
    }
    const propPairs = Object.entries(props)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return `${rawName}[${propPairs}]`;
  });

  const blocksList = data.blocks || [];
  for (const blk of blocksList) {
    const bx = Array.isArray(blk.pos) ? Number(blk.pos[0]) : Number(blk.pos.x);
    const by = Array.isArray(blk.pos) ? Number(blk.pos[1]) : Number(blk.pos.y);
    const bz = Array.isArray(blk.pos) ? Number(blk.pos[2]) : Number(blk.pos.z);
    const stateIdx = Number(blk.state);
    const fullBlockString = formattedPalette[stateIdx] || 'air';
    const cleanName = fullBlockString.replace(/\[.*\]$/, '');

    if (cleanName === 'air' || cleanName === 'cave_air' || cleanName === 'void_air' || cleanName === 'structure_void') {
      continue;
    }
    canvas.set(bx, by, bz, fullBlockString);
  }
  return canvas;
}

export async function exportNbtStructure(canvas, filename = 'exported_structure', schematicsDir = 'data/schematics') {
  const bounds = canvas.getBounds();
  const width = Math.max(1, bounds.width || 1);
  const height = Math.max(1, bounds.height || 1);
  const depth = Math.max(1, bounds.depth || 1);

  const palette = [];
  const paletteIndexMap = new Map();

  const getPaletteIndex = (block) => {
    const name = block.name.startsWith('minecraft:') ? block.name : `minecraft:${block.name}`;
    const props = block.properties || block.blockState?.properties || {};
    const key = `${name}|${JSON.stringify(props)}`;
    if (paletteIndexMap.has(key)) return paletteIndexMap.get(key);

    const idx = palette.length;
    paletteIndexMap.set(key, idx);

    const palEntry = { Name: { type: 'string', value: name } };
    if (Object.keys(props).length > 0) {
      const propObj = {};
      for (const [k, v] of Object.entries(props)) {
        propObj[k] = { type: 'string', value: String(v) };
      }
      palEntry.Properties = { type: 'compound', value: propObj };
    }
    palette.push(palEntry);
    return idx;
  };

  const blocksList = [];
  for (const key of canvas.getAllBlockKeys()) {
    const block = canvas.getByKey(key);
    const { x, y, z } = canvas.parseKey(key);
    const relX = x - bounds.minX;
    const relY = y - bounds.minY;
    const relZ = z - bounds.minZ;

    if (relX < 0 || relX >= width || relY < 0 || relY >= height || relZ < 0 || relZ >= depth) {
      continue;
    }
    if (block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
      continue;
    }

    const stateIdx = getPaletteIndex(block);
    blocksList.push({
      pos: { type: 'list', value: { type: 'int', value: [relX, relY, relZ] } },
      state: { type: 'int', value: stateIdx }
    });
  }

  const structureNbt = {
    type: 'compound',
    name: '',
    value: {
      size: { type: 'list', value: { type: 'int', value: [width, height, depth] } },
      entities: { type: 'list', value: { type: 'compound', value: [] } },
      blocks: { type: 'list', value: { type: 'compound', value: blocksList } },
      palette: { type: 'list', value: { type: 'compound', value: palette } },
      DataVersion: { type: 'int', value: 3700 }
    }
  };

  const uncompressed = nbt.writeUncompressed(structureNbt);
  const buffer = zlib.gzipSync(uncompressed);

  const safeName = path.basename(filename).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(schematicsDir, `${safeName}.nbt`);
  fs.writeFileSync(filePath, buffer);
  logger.info(`Structure-NBT erfolgreich exportiert: ${filePath} (${buffer.length} Bytes)`);
  return buffer;
}
