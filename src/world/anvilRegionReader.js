/**
 * Native Minecraft Anvil (.mca) Region Reader & Surface/Relief Extractor
 * Reads 1.16–26.3 Anvil region files directly using Node.js zlib and prismarine-nbt
 * without requiring a running Minecraft server or external native C++ bindings.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  AIR_BLOCKS,
  FOLIAGE_PATTERNS,
  isFoliageOrTreeBlock,
  toUint64BigInt,
  createSectionAccessor
} from './anvil/bitArrayDecoder.js';
import {
  readChunkFromMcaBuffer,
  createSyntheticMcaBuffer
} from './anvil/mcaChunkReader.js';

export {
  AIR_BLOCKS,
  FOLIAGE_PATTERNS,
  isFoliageOrTreeBlock,
  toUint64BigInt,
  createSectionAccessor,
  readChunkFromMcaBuffer,
  createSyntheticMcaBuffer
};

/**
 * Scans an Anvil world directory (or region directory) around a center coordinate
 * and extracts the 3D surface & cliff relief blocks.
 *
 * @param {string} worldOrRegionDir - Path to the world save folder or region folder
 * @param {Object} [options]
 * @param {number} [options.centerX] - Center X coordinate (auto-detected if omitted)
 * @param {number} [options.centerZ] - Center Z coordinate (auto-detected if omitted)
 * @param {number} [options.radius=32] - Scan radius in blocks (16..96)
 * @param {boolean} [options.includeFoliage=true] - Whether to include trees, leaves, and plants
 */
export function scanAnvilWorldSurface(worldOrRegionDir, options = {}) {
  const regionDir = fs.existsSync(path.join(worldOrRegionDir, 'region'))
    ? path.join(worldOrRegionDir, 'region')
    : worldOrRegionDir;

  if (!fs.existsSync(regionDir)) {
    throw new Error(`Anvil Region-Verzeichnis nicht gefunden: ${regionDir}`);
  }

  const radius = Math.max(8, Math.min(96, parseInt(options.radius, 10) || 32));
  const includeFoliage = options.includeFoliage !== false;

  // Determine center coordinates if not explicitly provided
  let centerX = Number.isFinite(Number(options.centerX)) ? Math.floor(Number(options.centerX)) : null;
  let centerZ = Number.isFinite(Number(options.centerZ)) ? Math.floor(Number(options.centerZ)) : null;

  const regionFiles = fs.readdirSync(regionDir).filter(f => /^r\.-?\d+\.-?\d+\.mca$/i.test(f));
  if (regionFiles.length === 0) {
    throw new Error(`Keine .mca Region-Dateien in ${regionDir} gefunden.`);
  }

  if (centerX === null || centerZ === null) {
    // Pick region closest to (0,0) and find its first populated chunk
    let bestFile = regionFiles[0];
    let bestRx = 0;
    let bestRz = 0;
    let bestDist = Infinity;

    for (const rf of regionFiles) {
      const m = rf.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/i);
      if (m) {
        const rx = parseInt(m[1], 10);
        const rz = parseInt(m[2], 10);
        const dist = Math.abs(rx) + Math.abs(rz);
        if (dist < bestDist) {
          bestDist = dist;
          bestRx = rx;
          bestRz = rz;
          bestFile = rf;
        }
      }
    }

    centerX = bestRx * 512 + 8;
    centerZ = bestRz * 512 + 8;

    try {
      const buf = fs.readFileSync(path.join(regionDir, bestFile));
      if (buf.length >= 4096) {
        for (let cz = 0; cz < 32; cz++) {
          let found = false;
          for (let cx = 0; cx < 32; cx++) {
            const idx = (cx + cz * 32) * 4;
            const secOffset = (buf[idx] << 16) | (buf[idx + 1] << 8) | buf[idx + 2];
            if (secOffset > 0) {
              centerX = (bestRx * 32 + cx) * 16 + 8;
              centerZ = (bestRz * 32 + cz) * 16 + 8;
              found = true;
              break;
            }
          }
          if (found) break;
        }
      }
    } catch {}
  }

  const minX = centerX - radius;
  const maxX = centerX + radius - 1;
  const minZ = centerZ - radius;
  const maxZ = centerZ + radius - 1;

  const minChunkX = Math.floor(minX / 16);
  const maxChunkX = Math.floor(maxX / 16);
  const minChunkZ = Math.floor(minZ / 16);
  const maxChunkZ = Math.floor(maxZ / 16);

  const mcaBufferCache = new Map();
  const getMcaBuffer = (rx, rz) => {
    const key = `${rx},${rz}`;
    if (mcaBufferCache.has(key)) return mcaBufferCache.get(key);
    const filePath = path.join(regionDir, `r.${rx}.${rz}.mca`);
    if (!fs.existsSync(filePath)) {
      mcaBufferCache.set(key, null);
      return null;
    }
    try {
      const buf = fs.readFileSync(filePath);
      mcaBufferCache.set(key, buf);
      return buf;
    } catch {
      mcaBufferCache.set(key, null);
      return null;
    }
  };

  // Map of "x,z" -> { surfaceY, surfaceBlock, columnBlocks: Map<y, blockName> }
  const columnMap = new Map();
  let minYFound = Infinity;
  let maxYFound = -Infinity;

  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ++) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX++) {
      const rx = Math.floor(chunkX / 32);
      const rz = Math.floor(chunkZ / 32);
      const mcaBuf = getMcaBuffer(rx, rz);
      if (!mcaBuf) continue;

      const chunkNbt = readChunkFromMcaBuffer(mcaBuf, chunkX, chunkZ);
      if (!chunkNbt) continue;

      const rawSections = chunkNbt.sections || chunkNbt.Level?.Sections || [];
      const activeSections = [];

      for (const sec of rawSections) {
        const secY = Number(sec.Y);
        if (!Number.isFinite(secY)) continue;
        const accessor = createSectionAccessor(sec);
        if (accessor) {
          activeSections.push({ secY, accessor });
        }
      }

      if (activeSections.length === 0) continue;
      // Sort sections top-down for rapid surface detection
      activeSections.sort((a, b) => b.secY - a.secY);

      const chunkBaseX = chunkX * 16;
      const chunkBaseZ = chunkZ * 16;

      for (let lz = 0; lz < 16; lz++) {
        const wz = chunkBaseZ + lz;
        if (wz < minZ || wz > maxZ) continue;

        for (let lx = 0; lx < 16; lx++) {
          const wx = chunkBaseX + lx;
          if (wx < minX || wx > maxX) continue;

          let surfaceY = null;
          let surfaceBlock = 'grass_block';
          const colBlocks = new Map();

          for (const { secY, accessor } of activeSections) {
            const baseSectionY = secY * 16;
            for (let ly = 15; ly >= 0; ly--) {
              const wy = baseSectionY + ly;
              const bName = accessor(lx, ly, lz);
              if (!bName || AIR_BLOCKS.has(bName)) continue;

              const isFoliage = isFoliageOrTreeBlock(bName);
              if (isFoliage && !includeFoliage) continue;

              if (isFoliage && includeFoliage && surfaceY === null) {
                colBlocks.set(wy, bName);
                continue;
              }

              if (surfaceY === null) {
                surfaceY = wy;
                surfaceBlock = bName;
                colBlocks.set(wy, bName);
                if (wy < minYFound) minYFound = wy;
                if (wy > maxYFound) maxYFound = wy;
              } else if (wy >= surfaceY - 8) {
                // Keep up to 8 blocks below surface for cliff/slope relief checking
                colBlocks.set(wy, bName);
              } else {
                break;
              }
            }
            if (surfaceY !== null && (secY * 16) < surfaceY - 8) {
              break;
            }
          }

          if (surfaceY !== null) {
            columnMap.set(`${wx},${wz}`, {
              x: wx,
              z: wz,
              surfaceY,
              surfaceBlock,
              colBlocks
            });
          }
        }
      }
    }
  }

  // Extract visible surface + exposed cliff wall blocks
  const terrainBlocks = [];
  const heightMap = {};
  const blockCounts = {};

  for (const [key, col] of columnMap.entries()) {
    const { x, z, surfaceY, surfaceBlock, colBlocks } = col;
    heightMap[key] = surfaceY;
    blockCounts[surfaceBlock] = (blockCounts[surfaceBlock] || 0) + 1;

    // Determine lowest neighbor surfaceY to expose cliff faces
    const n1 = columnMap.get(`${x + 1},${z}`)?.surfaceY ?? surfaceY;
    const n2 = columnMap.get(`${x - 1},${z}`)?.surfaceY ?? surfaceY;
    const n3 = columnMap.get(`${x},${z + 1}`)?.surfaceY ?? surfaceY;
    const n4 = columnMap.get(`${x},${z - 1}`)?.surfaceY ?? surfaceY;
    const minNeighborY = Math.min(n1, n2, n3, n4);
    const cliffFloorY = Math.max(surfaceY - 8, minNeighborY);

    for (const [wy, bName] of colBlocks.entries()) {
      if (wy >= surfaceY || wy >= cliffFloorY) {
        terrainBlocks.push({
          x,
          y: wy,
          z,
          name: bName,
          isSurface: wy === surfaceY,
          isFoliage: wy > surfaceY
        });
      }
    }
  }

  if (minYFound === Infinity) {
    minYFound = 64;
    maxYFound = 64;
  }

  const dominantBlocks = Object.entries(blockCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, count }));

  const heightGrid = Object.entries(heightMap).map(([key, y]) => {
    const [kx, kz] = key.split(',').map(Number);
    return { x: kx, z: kz, y };
  });

  return {
    source: 'anvil',
    isSimulated: false,
    worldDir: path.resolve(worldOrRegionDir),
    center: { x: centerX, y: Math.round((minYFound + maxYFound) / 2), z: centerZ },
    radius,
    includeFoliage,
    bounds: {
      minX,
      maxX,
      minY: minYFound,
      maxY: maxYFound,
      minZ,
      maxZ,
      width: maxX - minX + 1,
      depth: maxZ - minZ + 1,
      height: Math.max(1, maxYFound - minYFound + 1)
    },
    blocks: terrainBlocks,
    terrainBlocks,
    heightMap,
    heightGrid,
    dominantBlocks
  };
}
