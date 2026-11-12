/**
 * MCA Region Buffer Chunk Reader & Synthetic MCA Generator.
 */

import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';

/**
 * Reads and parses a single chunk (chunkX, chunkZ) from an Anvil .mca file buffer.
 *
 * @param {Buffer} mcaBuffer
 * @param {number} chunkX
 * @param {number} chunkZ
 * @returns {Object|null} Simplified NBT object or null
 */
export function readChunkFromMcaBuffer(mcaBuffer, chunkX, chunkZ) {
  if (!mcaBuffer || mcaBuffer.length < 8192) return null;

  const localChunkX = ((chunkX % 32) + 32) % 32;
  const localChunkZ = ((chunkZ % 32) + 32) % 32;
  const headerOffset = (localChunkX + localChunkZ * 32) * 4;

  const sectorOffset = (mcaBuffer[headerOffset] << 16) | (mcaBuffer[headerOffset + 1] << 8) | mcaBuffer[headerOffset + 2];
  const sectorCount = mcaBuffer[headerOffset + 3];

  if (sectorOffset === 0 || sectorCount === 0) return null;

  const byteOffset = sectorOffset * 4096;
  if (byteOffset + 5 > mcaBuffer.length) return null;

  const byteLength = mcaBuffer.readUInt32BE(byteOffset);
  const compressionType = mcaBuffer[byteOffset + 4];
  if (byteLength <= 1 || byteOffset + 4 + byteLength > mcaBuffer.length) return null;

  const compressedSlice = mcaBuffer.subarray(byteOffset + 5, byteOffset + 4 + byteLength);
  let uncompressed;
  try {
    if (compressionType === 2) {
      uncompressed = zlib.inflateSync(compressedSlice);
    } else if (compressionType === 1) {
      uncompressed = zlib.gunzipSync(compressedSlice);
    } else if (compressionType === 3) {
      uncompressed = compressedSlice;
    } else {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const parsed = nbt.parseUncompressed(uncompressed);
    return nbt.simplify(parsed);
  } catch {
    return null;
  }
}

/**
 * Helper to create a valid binary Anvil .mca buffer from a simplified chunk specification.
 * Useful for unit/integration tests and offline world snapshots.
 *
 * @param {Array<Object>|Object} chunksOrSingle
 * @returns {Buffer}
 */
export function createSyntheticMcaBuffer(chunksOrSingle = []) {
  const chunks = Array.isArray(chunksOrSingle) ? chunksOrSingle : [chunksOrSingle];
  const sectors = [];
  const header = Buffer.alloc(8192, 0); // 4096 location + 4096 timestamps
  let currentSector = 2; // Sectors 0 and 1 are the 8KB header

  for (const ch of chunks) {
    const cx = ((ch.chunkX % 32) + 32) % 32;
    const cz = ((ch.chunkZ % 32) + 32) % 32;
    const targetSurfaceY = Number.isFinite(Number(ch.surfaceY)) ? Number(ch.surfaceY) : 64;
    const sectionY = ch.sectionY ?? Math.floor(targetSurfaceY / 16);
    const localSurfaceY = ((targetSurfaceY % 16) + 16) % 16;
    const surfaceBlockName = ch.surfaceBlock || 'grass_block';

    const paletteEntries = (ch.palette || ['air', surfaceBlockName, 'stone']).map(name => ({
      type: 'compound',
      value: {
        Name: { type: 'string', value: name.startsWith('minecraft:') ? name : `minecraft:${name}` }
      }
    }));

    const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(paletteEntries.length)));
    const blocksPerLong = Math.floor(64 / bitsPerBlock);
    const numLongs = Math.ceil(4096 / blocksPerLong);
    const longPairs = [];

    for (let li = 0; li < numLongs; li++) {
      let word = 0n;
      for (let si = 0; si < blocksPerLong; si++) {
        const blockIdx = li * blocksPerLong + si;
        if (blockIdx >= 4096) break;
        const ly = (blockIdx >> 8) & 15;
        const lz = (blockIdx >> 4) & 15;
        const lx = blockIdx & 15;
        const palIdx = typeof ch.getBlockPaletteIndex === 'function'
          ? ch.getBlockPaletteIndex(lx, ly, lz)
          : (ly === localSurfaceY ? 1 : (ly < localSurfaceY ? 2 : 0));
        word |= (BigInt(palIdx) << BigInt(si * bitsPerBlock));
      }
      const high = Number(BigInt.asIntN(32, word >> 32n));
      const low = Number(BigInt.asIntN(32, word & 0xFFFFFFFFn));
      longPairs.push([high, low]);
    }

    const nbtRoot = {
      type: 'compound',
      name: '',
      value: {
        DataVersion: { type: 'int', value: 3953 },
        xPos: { type: 'int', value: ch.chunkX || 0 },
        zPos: { type: 'int', value: ch.chunkZ || 0 },
        yPos: { type: 'int', value: -4 },
        sections: {
          type: 'list',
          value: {
            type: 'compound',
            value: [
              {
                Y: { type: 'byte', value: sectionY },
                block_states: {
                  type: 'compound',
                  value: {
                    palette: {
                      type: 'list',
                      value: {
                        type: 'compound',
                        value: paletteEntries.map(p => p.value)
                      }
                    },
                    data: {
                      type: 'longArray',
                      value: longPairs
                    }
                  }
                }
              }
            ]
          }
        }
      }
    };

    const rawNbt = nbt.writeUncompressed(nbtRoot);
    const compressed = zlib.deflateSync(rawNbt);
    const payloadLen = compressed.length + 1;
    const totalChunkBytes = payloadLen + 4;
    const sectorCount = Math.ceil(totalChunkBytes / 4096);
    const paddedSectorBuf = Buffer.alloc(sectorCount * 4096, 0);

    paddedSectorBuf.writeUInt32BE(payloadLen, 0);
    paddedSectorBuf[4] = 2; // Zlib compression
    compressed.copy(paddedSectorBuf, 5);

    const headerIdx = (cx + cz * 32) * 4;
    header[headerIdx] = (currentSector >> 16) & 0xFF;
    header[headerIdx + 1] = (currentSector >> 8) & 0xFF;
    header[headerIdx + 2] = currentSector & 0xFF;
    header[headerIdx + 3] = sectorCount & 0xFF;

    sectors.push(paddedSectorBuf);
    currentSector += sectorCount;
  }

  return Buffer.concat([header, ...sectors]);
}
