import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { VoxelCanvas } from './voxelCanvas.js';
import { logger } from '../utils/logger.js';
import { parseSpongeSchematic, exportSpongeSchematic } from './formats/spongeFormat.js';
import { parseNbtStructure, exportNbtStructure } from './formats/nbtFormat.js';
import { parseLitematic } from './formats/litematicFormat.js';

const SCHEMATICS_DIR = path.resolve('data/schematics');

try {
  if (!fs.existsSync(SCHEMATICS_DIR)) {
    fs.mkdirSync(SCHEMATICS_DIR, { recursive: true });
  }
} catch (err) {
  logger.warn(`Konnte data/schematics/ nicht initialisieren: ${err.message}`);
}

export class SchematicManager {
  constructor(schematicsDir = SCHEMATICS_DIR) {
    this.schematicsDir = schematicsDir;
  }

  async loadIntoCanvas(fileBuffer, filename, mcVersion = '1.20.4') {
    const ext = path.extname(filename).toLowerCase();

    // Fall A: .schem (Sponge v2/v3) & .schematic (MCEdit Legacy)
    if (ext === '.schem' || ext === '.schematic') {
      return await parseSpongeSchematic(fileBuffer, mcVersion);
    }

    // Fall B: .nbt (Vanilla Structure Block & Create Mod Schematics)
    if (ext === '.nbt') {
      return await parseNbtStructure(fileBuffer);
    }

    // Fall C: .litematic (Litematica 64-Bit Packed LongArray Format)
    if (ext === '.litematic') {
      return await parseLitematic(fileBuffer);
    }

    throw new Error(`Nicht unterstütztes Schematic-Dateiformat: ${ext}`);
  }

  async exportCanvasToSchem(canvas, filename = 'exported_schematic') {
    return await exportSpongeSchematic(canvas, filename, this.schematicsDir);
  }

  async exportCanvasToNbt(canvas, filename = 'exported_structure') {
    return await exportNbtStructure(canvas, filename, this.schematicsDir);
  }

  async cloneWorldRegionToCanvas(bot, minVec, maxVec) {
    if (!bot || typeof bot.blockAt !== 'function') {
      throw new Error('Bot ist nicht verbunden oder blockAt steht nicht zur Verfügung.');
    }

    const minX = Math.min(minVec.x, maxVec.x);
    const maxX = Math.max(minVec.x, maxVec.x);
    const minY = Math.min(minVec.y, maxVec.y);
    const maxY = Math.max(minVec.y, maxVec.y);
    const minZ = Math.min(minVec.z, maxVec.z);
    const maxZ = Math.max(minVec.z, maxVec.z);

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const depth = maxZ - minZ + 1;

    const canvas = new VoxelCanvas(width, height, depth, { x: minX, y: minY, z: minZ });

    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const b = bot.blockAt(new Vec3(x, y, z));
          if (!b || !b.name) continue;
          const name = b.name;
          if (name === 'air' || name === 'cave_air' || name === 'void_air' || name === 'structure_void') continue;

          const props = b.getProperties ? b.getProperties() : (b.properties || {});
          canvas.set(x - minX, y - minY, z - minZ, { name, properties: props });
        }
      }
    }

    logger.info(`Server-Bereich erfolgreich geklont: ${width}x${height}x${depth} Blöcke (${canvas.blocks.size} Voxel).`);
    return canvas;
  }
}

export const schematicManager = new SchematicManager();
