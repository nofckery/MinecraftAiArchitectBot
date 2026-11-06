/**
 * Litematica (.litematic) Parser
 * Bitpacked 64-Bit UInt LongArray Format für Multi-Region Schematics.
 */

import nbt from 'prismarine-nbt';
import { VoxelCanvas } from '../voxelCanvas.js';

export async function parseLitematic(fileBuffer) {
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
