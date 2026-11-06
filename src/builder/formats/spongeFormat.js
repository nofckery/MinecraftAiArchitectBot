/**
 * Sponge (.schem v2/v3) & MCEdit Legacy (.schematic) Parser & Exporter
 */

import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import prismarineSchematic from 'prismarine-schematic';
import prismarineBlock from 'prismarine-block';
import { VoxelCanvas } from '../voxelCanvas.js';
import { logger } from '../../utils/logger.js';

const { Schematic } = prismarineSchematic;

export async function parseSpongeSchematic(fileBuffer, mcVersion = '1.20.4') {
  const schem = await Schematic.read(fileBuffer, mcVersion);
  const start = typeof schem.start === 'function' ? schem.start() : (schem.start || schem.offset || new Vec3(0, 0, 0));
  const size = typeof schem.size === 'function' ? schem.size() : schem.size;
  const canvas = new VoxelCanvas(size.x, size.y, size.z, { x: 0, y: 0, z: 0 });

  for (let y = 0; y < size.y; y++) {
    for (let z = 0; z < size.z; z++) {
      for (let x = 0; x < size.x; x++) {
        const worldPos = new Vec3(start.x + x, start.y + y, start.z + z);
        const block = schem.getBlock(worldPos);
        if (!block || !block.name) continue;

        const name = block.name;
        if (name === 'air' || name === 'cave_air' || name === 'void_air' || name === 'structure_void') {
          continue;
        }

        const props = block.getProperties ? block.getProperties() : {};
        const propEntries = Object.entries(props).sort(([a], [b]) => a.localeCompare(b));
        const fullBlockString = propEntries.length > 0
          ? `${name}[${propEntries.map(([k, v]) => `${k}=${v}`).join(',')}]`
          : name;

        canvas.set(x, y, z, fullBlockString);
      }
    }
  }
  return canvas;
}

export async function exportSpongeSchematic(canvas, filename = 'exported_schematic', schematicsDir = 'data/schematics') {
  const bounds = canvas.getBounds();
  const Block = prismarineBlock('1.20.4');

  const width = Math.max(1, bounds.width || 1);
  const height = Math.max(1, bounds.height || 1);
  const depth = Math.max(1, bounds.depth || 1);
  const size = new Vec3(width, height, depth);
  const offset = new Vec3(0, 0, 0);

  const palette = [0]; // 0 = air
  const blocks = new Array(width * height * depth).fill(0);

  if (bounds.count > 0) {
    for (const key of canvas.getAllBlockKeys()) {
      const block = canvas.getByKey(key);
      const { x, y, z } = canvas.parseKey(key);
      const relX = x - bounds.minX;
      const relY = y - bounds.minY;
      const relZ = z - bounds.minZ;

      if (relX < 0 || relX >= width || relY < 0 || relY >= height || relZ < 0 || relZ >= depth) {
        continue;
      }

      const blockStr = VoxelCanvas.toBlockString(block);
      if (!blockStr || blockStr === 'air') continue;

      let stateId = 0;
      try {
        const bObj = Block.fromString(blockStr);
        stateId = bObj ? bObj.stateId : 0;
      } catch {
        try {
          const bFallback = Block.fromString(block.name);
          stateId = bFallback ? bFallback.stateId : 0;
        } catch {
          stateId = 0;
        }
      }

      let palIdx = palette.indexOf(stateId);
      if (palIdx === -1) {
        palIdx = palette.length;
        palette.push(stateId);
      }

      const idx = (relY * depth + relZ) * width + relX;
      blocks[idx] = palIdx;
    }
  }

  const schem = new Schematic('1.20.4', size, offset, palette, blocks);
  const buffer = await schem.write();

  const safeName = path.basename(filename).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(schematicsDir, `${safeName}.schem`);
  fs.writeFileSync(filePath, buffer);
  logger.info(`Schematic erfolgreich exportiert: ${filePath} (${buffer.length} Bytes)`);
  return buffer;
}
