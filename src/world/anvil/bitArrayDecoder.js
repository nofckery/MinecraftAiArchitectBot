/**
 * Bit Array & Section Accessor Decoder for Minecraft Anvil (.mca) NBT BlockStates.
 */

export const AIR_BLOCKS = new Set([
  'air',
  'cave_air',
  'void_air',
  'structure_void',
  'barrier',
  'light'
]);

export const FOLIAGE_PATTERNS = [
  '_leaves',
  '_log',
  '_wood',
  '_stem',
  'short_grass',
  'tall_grass',
  'grass',
  'fern',
  'large_fern',
  'vine',
  'cave_vines',
  'weeping_vines',
  'twisting_vines',
  'dandelion',
  'poppy',
  'orchid',
  'allium',
  'bluet',
  'tulip',
  'daisy',
  'cornflower',
  'lily',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
  'azalea',
  'dead_bush',
  'sweet_berry_bush',
  'firefly_bush',
  'bush',
  'pale_hanging_moss',
  'moss_carpet',
  'pale_moss_carpet',
  'pink_petals',
  'Wildflowers',
  'leaf_litter'
];

/**
 * Checks whether a block name represents foliage, logs, leaves, flowers or vegetation.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isFoliageOrTreeBlock(name) {
  if (!name) return false;
  const clean = name.replace('minecraft:', '').toLowerCase();
  if (clean === 'grass_block' || clean === 'moss_block' || clean === 'pale_moss_block' || clean === 'podzol' || clean === 'mycelium') {
    return false;
  }
  for (const pat of FOLIAGE_PATTERNS) {
    if (clean === pat || clean.endsWith(pat) || clean.includes(pat)) {
      return true;
    }
  }
  return false;
}

/**
 * Unpacks a 64-bit Long array entry from prismarine-nbt into an unsigned 64-bit BigInt.
 *
 * @param {bigint|Array<number>|number} entry
 * @returns {bigint}
 */
export function toUint64BigInt(entry) {
  if (typeof entry === 'bigint') {
    return BigInt.asUintN(64, entry);
  }
  if (Array.isArray(entry) && entry.length === 2) {
    const high = BigInt(entry[0]) & 0xFFFFFFFFn;
    const low = BigInt(entry[1]) & 0xFFFFFFFFn;
    return (high << 32n) | low;
  }
  return BigInt.asUintN(64, BigInt(entry || 0));
}

/**
 * Decodes a 16x16x16 chunk section from modern (1.18+) or legacy (1.16-1.17) NBT data.
 * Returns a function `getBlock(localX, localY, localZ)` -> blockName (without minecraft: prefix).
 *
 * @param {Object} section
 * @returns {((lx: number, ly: number, lz: number) => string)|null}
 */
export function createSectionAccessor(section) {
  const blockStatesContainer = section.block_states || section;
  const rawPalette = blockStatesContainer.palette || section.Palette;
  if (!Array.isArray(rawPalette) || rawPalette.length === 0) {
    return null;
  }

  const palette = rawPalette.map(entry => {
    const rawName = String(entry?.Name || entry?.name || 'air').replace(/^minecraft:/, '').toLowerCase();
    return rawName;
  });

  // Single-block palette optimization (e.g. all air or all stone)
  if (palette.length === 1) {
    const single = palette[0];
    if (AIR_BLOCKS.has(single)) return null;
    return () => single;
  }

  const rawData = blockStatesContainer.data || section.BlockStates;
  const dataArray = Array.isArray(rawData)
    ? rawData
    : (ArrayBuffer.isView(rawData) ? Array.from(rawData) : (rawData?.value || []));

  if (!dataArray || dataArray.length === 0) {
    return () => palette[0] || 'air';
  }

  const uLongs = dataArray.map(toUint64BigInt);
  const bitsPerBlock = Math.max(4, Math.ceil(Math.log2(palette.length)));
  const blocksPerLong = Math.floor(64 / bitsPerBlock);
  const mask = (1n << BigInt(bitsPerBlock)) - 1n;

  // Modern 1.16+ padded packing (entries do not cross 64-bit Long boundaries)
  const expectedPaddedLongs = Math.ceil(4096 / blocksPerLong);
  const isPadded = uLongs.length >= expectedPaddedLongs;

  return (lx, ly, lz) => {
    const index = (ly << 8) | (lz << 4) | lx; // YZX ordering (4096 blocks)
    if (isPadded) {
      const longIdx = Math.floor(index / blocksPerLong);
      const subIdx = index % blocksPerLong;
      const word = uLongs[longIdx] || 0n;
      const paletteIdx = Number((word >> BigInt(subIdx * bitsPerBlock)) & mask);
      return palette[paletteIdx] || 'air';
    } else {
      const bitOffset = index * bitsPerBlock;
      const startLong = Math.floor(bitOffset / 64);
      const startBit = BigInt(bitOffset % 64);
      const w1 = uLongs[startLong] || 0n;
      const paletteIdx = Number((w1 >> startBit) & mask);
      return palette[paletteIdx] || 'air';
    }
  };
}
