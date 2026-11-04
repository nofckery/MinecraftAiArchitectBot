import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { Vec3 } from 'vec3';
import nbt from 'prismarine-nbt';
import prismarineSchematic from 'prismarine-schematic';
import prismarineBlock from 'prismarine-block';
import { VoxelCanvas } from './voxelCanvas.js';
import { logger } from '../utils/logger.js';

const { Schematic } = prismarineSchematic;
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

    // Fall B: .nbt (Vanilla Structure Block & Create Mod Schematics)
    if (ext === '.nbt') {
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

    // Fall C: .litematic (Litematica 64-Bit Packed LongArray Format)
    if (ext === '.litematic') {
      const { parsed } = await nbt.parse(fileBuffer);
      const data = nbt.simplify(parsed);

      const regions = Object.values(data.Regions || {});
      if (regions.length === 0) {
        return new VoxelCanvas(1, 1, 1);
      }

      let globalMinX = Infinity, globalMaxX = -Infinity;
      let globalMinY = Infinity, globalMaxY = -Infinity;
      let globalMinZ = Infinity, globalMaxZ = -Infinity;

      for (const region of regions) {
        const absX = Math.abs(Number(region.Size?.x || 0));
        const absY = Math.abs(Number(region.Size?.y || 0));
        const absZ = Math.abs(Number(region.Size?.z || 0));
        if (absX === 0 || absY === 0 || absZ === 0) continue;

        const posX = Number(region.Position?.x || 0);
        const posY = Number(region.Position?.y || 0);
        const posZ = Number(region.Position?.z || 0);
        const sizeX = Number(region.Size?.x || 0);
        const sizeY = Number(region.Size?.y || 0);
        const sizeZ = Number(region.Size?.z || 0);

        const rMinX = sizeX < 0 ? posX + sizeX + 1 : posX;
        const rMaxX = sizeX < 0 ? posX : posX + sizeX - 1;
        const rMinY = sizeY < 0 ? posY + sizeY + 1 : posY;
        const rMaxY = sizeY < 0 ? posY : posY + sizeY - 1;
        const rMinZ = sizeZ < 0 ? posZ + sizeZ + 1 : posZ;
        const rMaxZ = sizeZ < 0 ? posZ : posZ + sizeZ - 1;

        if (rMinX < globalMinX) globalMinX = rMinX;
        if (rMaxX > globalMaxX) globalMaxX = rMaxX;
        if (rMinY < globalMinY) globalMinY = rMinY;
        if (rMaxY > globalMaxY) globalMaxY = rMaxY;
        if (rMinZ < globalMinZ) globalMinZ = rMinZ;
        if (rMaxZ > globalMaxZ) globalMaxZ = rMaxZ;
      }

      if (globalMinX === Infinity) {
        return new VoxelCanvas(1, 1, 1);
      }

      const totalW = Math.max(1, globalMaxX - globalMinX + 1);
      const totalH = Math.max(1, globalMaxY - globalMinY + 1);
      const totalD = Math.max(1, globalMaxZ - globalMinZ + 1);
      const canvas = new VoxelCanvas(totalW, totalH, totalD);

      for (const region of regions) {
        const absX = Math.abs(Number(region.Size?.x || 0));
        const absY = Math.abs(Number(region.Size?.y || 0));
        const absZ = Math.abs(Number(region.Size?.z || 0));
        const volume = absX * absY * absZ;
        if (volume === 0) continue;

        const palette = region.BlockStatePalette || [];
        const formattedPalette = palette.map(entry => {
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

        const blockStates = Array.isArray(region.BlockStates)
          ? region.BlockStates
          : (ArrayBuffer.isView(region.BlockStates) ? Array.from(region.BlockStates) : (region.BlockStates?.value || []));
        const uLongs = blockStates.map(entry => {
          if (typeof entry === 'bigint') return BigInt.asUintN(64, entry);
          if (Array.isArray(entry)) {
            const high = BigInt(entry[0]) & 0xFFFFFFFFn;
            const low = BigInt(entry[1]) & 0xFFFFFFFFn;
            return (high << 32n) | low;
          }
          return BigInt.asUintN(64, BigInt(entry));
        });

        const bitsPerBlock = Math.max(2, Math.ceil(Math.log2(palette.length || 1)));
        const mask = (1n << BigInt(bitsPerBlock)) - 1n;

        const posX = Number(region.Position?.x || 0);
        const posY = Number(region.Position?.y || 0);
        const posZ = Number(region.Position?.z || 0);
        const sizeX = Number(region.Size?.x || 0);
        const sizeY = Number(region.Size?.y || 0);
        const sizeZ = Number(region.Size?.z || 0);

        const regionStartX = sizeX < 0 ? posX + sizeX + 1 : posX;
        const regionStartY = sizeY < 0 ? posY + sizeY + 1 : posY;
        const regionStartZ = sizeZ < 0 ? posZ + sizeZ + 1 : posZ;

        for (let i = 0; i < volume; i++) {
          let paletteIdx = 0;
          if (uLongs.length > 0) {
            const startOffset = i * bitsPerBlock;
            const startLongIdx = Math.floor(startOffset / 64);
            const endLongIdx = Math.floor(((i + 1) * bitsPerBlock - 1) / 64);
            const startBitOffset = BigInt(startOffset % 64);

            const l1 = uLongs[startLongIdx] || 0n;
            if (startLongIdx === endLongIdx) {
              paletteIdx = Number((l1 >> startBitOffset) & mask);
            } else {
              const l2 = uLongs[endLongIdx] || 0n;
              const endBitOffset = 64n - startBitOffset;
              paletteIdx = Number(((l1 >> startBitOffset) | (l2 << endBitOffset)) & mask);
            }
          }

          const blockStr = formattedPalette[paletteIdx] || 'air';
          const cleanName = blockStr.replace(/\[.*\]$/, '');
          if (cleanName === 'air' || cleanName === 'cave_air' || cleanName === 'void_air' || cleanName === 'structure_void') {
            continue;
          }

          const lx = i % absX;
          const lz = Math.floor(i / absX) % absZ;
          const ly = Math.floor(i / (absX * absZ));

          const wx = regionStartX + lx;
          const wy = regionStartY + ly;
          const wz = regionStartZ + lz;

          const cx = wx - globalMinX;
          const cy = wy - globalMinY;
          const cz = wz - globalMinZ;

          canvas.set(cx, cy, cz, blockStr);
        }
      }
      return canvas;
    }

    throw new Error(`Nicht unterstütztes Schematic-Dateiformat: ${ext}`);
  }

  async exportCanvasToSchem(canvas, filename = 'exported_schematic') {
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
    const filePath = path.join(this.schematicsDir, `${safeName}.schem`);
    fs.writeFileSync(filePath, buffer);
    logger.info(`Schematic erfolgreich exportiert: ${filePath} (${buffer.length} Bytes)`);
    return buffer;
  }

  /**
   * 3.5 Asymmetrie-Behebung: Exportiert VoxelCanvas als Minecraft Vanilla Structure Block (.nbt)
   */
  async exportCanvasToNbt(canvas, filename = 'exported_structure') {
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
    const filePath = path.join(this.schematicsDir, `${safeName}.nbt`);
    fs.writeFileSync(filePath, buffer);
    logger.info(`Structure-NBT erfolgreich exportiert: ${filePath} (${buffer.length} Bytes)`);
    return buffer;
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
