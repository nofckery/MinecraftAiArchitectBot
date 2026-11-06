/**
 * Instant Palette Swapper & Smart-Group-Erkennung
 * Erlaubt globalen Material-Austausch für Holzfamilien und Steinarten
 * unter vollständiger Beibehaltung von Blockzuständen (facing, half, shape, etc.).
 */

import { normalizeBlockName } from './blockAliases.js';

export const WOOD_TYPES = [
  'dark_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'
];

export const STONE_FAMILIES = [
  { base: 'stone', stair: 'stone_stairs', slab: 'stone_slab', wall: 'stone_brick_wall' },
  { base: 'smooth_stone', stair: 'stone_stairs', slab: 'smooth_stone_slab', wall: 'stone_brick_wall' },
  { base: 'stone_bricks', stair: 'stone_brick_stairs', slab: 'stone_brick_slab', wall: 'stone_brick_wall' },
  { base: 'cobblestone', stair: 'cobblestone_stairs', slab: 'cobblestone_slab', wall: 'cobblestone_wall' },
  { base: 'mossy_stone_bricks', stair: 'mossy_stone_brick_stairs', slab: 'mossy_stone_brick_slab', wall: 'mossy_stone_brick_wall' },
  { base: 'mossy_cobblestone', stair: 'mossy_cobblestone_stairs', slab: 'mossy_cobblestone_slab', wall: 'mossy_cobblestone_wall' },
  { base: 'deepslate_bricks', stair: 'deepslate_brick_stairs', slab: 'deepslate_brick_slab', wall: 'deepslate_brick_wall' },
  { base: 'deepslate_tiles', stair: 'deepslate_tile_stairs', slab: 'deepslate_tile_slab', wall: 'deepslate_tile_wall' },
  { base: 'polished_deepslate', stair: 'polished_deepslate_stairs', slab: 'polished_deepslate_slab', wall: 'polished_deepslate_wall' },
  { base: 'cobbled_deepslate', stair: 'cobbled_deepslate_stairs', slab: 'cobbled_deepslate_slab', wall: 'cobbled_deepslate_wall' },
  { base: 'sandstone', stair: 'sandstone_stairs', slab: 'sandstone_slab', wall: 'sandstone_wall' },
  { base: 'smooth_sandstone', stair: 'smooth_sandstone_stairs', slab: 'smooth_sandstone_slab', wall: 'sandstone_wall' },
  { base: 'red_sandstone', stair: 'red_sandstone_stairs', slab: 'red_sandstone_slab', wall: 'red_sandstone_wall' },
  { base: 'smooth_red_sandstone', stair: 'smooth_red_sandstone_stairs', slab: 'smooth_red_sandstone_slab', wall: 'red_sandstone_wall' },
  { base: 'blackstone', stair: 'blackstone_stairs', slab: 'blackstone_slab', wall: 'blackstone_wall' },
  { base: 'polished_blackstone_bricks', stair: 'polished_blackstone_brick_stairs', slab: 'polished_blackstone_brick_slab', wall: 'polished_blackstone_brick_wall' },
  { base: 'polished_blackstone', stair: 'polished_blackstone_stairs', slab: 'polished_blackstone_slab', wall: 'polished_blackstone_wall' },
  { base: 'granite', stair: 'granite_stairs', slab: 'granite_slab', wall: 'granite_wall' },
  { base: 'polished_granite', stair: 'polished_granite_stairs', slab: 'polished_granite_slab', wall: 'granite_wall' },
  { base: 'diorite', stair: 'diorite_stairs', slab: 'diorite_slab', wall: 'diorite_wall' },
  { base: 'polished_diorite', stair: 'polished_diorite_stairs', slab: 'polished_diorite_slab', wall: 'diorite_wall' },
  { base: 'andesite', stair: 'andesite_stairs', slab: 'andesite_slab', wall: 'andesite_wall' },
  { base: 'polished_andesite', stair: 'polished_andesite_stairs', slab: 'polished_andesite_slab', wall: 'andesite_wall' },
  { base: 'mud_bricks', stair: 'mud_brick_stairs', slab: 'mud_brick_slab', wall: 'mud_brick_wall' },
  { base: 'prismarine', stair: 'prismarine_stairs', slab: 'prismarine_slab', wall: 'prismarine_wall' },
  { base: 'prismarine_bricks', stair: 'prismarine_brick_stairs', slab: 'prismarine_brick_slab', wall: 'prismarine_wall' },
  { base: 'dark_prismarine', stair: 'dark_prismarine_stairs', slab: 'dark_prismarine_slab', wall: 'prismarine_wall' },
  { base: 'nether_bricks', stair: 'nether_brick_stairs', slab: 'nether_brick_slab', wall: 'nether_brick_wall' },
  { base: 'red_nether_bricks', stair: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', wall: 'red_nether_brick_wall' },
  { base: 'end_stone_bricks', stair: 'end_stone_brick_stairs', slab: 'end_stone_brick_slab', wall: 'end_stone_brick_wall' },
  { base: 'quartz_block', stair: 'quartz_stairs', slab: 'quartz_slab', wall: 'stone_brick_wall' },
  { base: 'smooth_quartz', stair: 'smooth_quartz_stairs', slab: 'smooth_quartz_slab', wall: 'stone_brick_wall' },
  { base: 'bricks', stair: 'brick_stairs', slab: 'brick_slab', wall: 'brick_wall' }
];

export function swapMaterial(canvas, fromBlock, toBlock, smartGroupSwap = false) {
  let cleanFrom = normalizeBlockName(typeof fromBlock === 'string' ? fromBlock : fromBlock?.name || '');
  let cleanTo = normalizeBlockName(typeof toBlock === 'string' ? toBlock : toBlock?.name || '');

  if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return 0;

  // Extrahiere ggf. explizit übergebene Ziel-Properties aus toBlock
  const toPropMatch = typeof toBlock === 'string' ? toBlock.match(/\[(.*)\]$/) : null;
  const overrideProps = {};
  if (toPropMatch) {
    for (const pair of toPropMatch[1].split(',')) {
      const [k, v] = pair.split('=');
      if (k && v !== undefined) overrideProps[k.trim()] = v.trim();
    }
  }

  let swapCount = 0;

  if (smartGroupSwap) {
    const fromWood = WOOD_TYPES.find(w => w === 'oak' ? (cleanFrom.includes('oak') && !cleanFrom.includes('dark_oak')) : cleanFrom.includes(w));
    const toWood = WOOD_TYPES.find(w => w === 'oak' ? (cleanTo.includes('oak') && !cleanTo.includes('dark_oak')) : cleanTo.includes(w));

    const fromStoneFam = STONE_FAMILIES.find(f => Object.values(f).includes(cleanFrom));
    const toStoneFam = STONE_FAMILIES.find(f => Object.values(f).includes(cleanTo));

    for (const [key, block] of canvas.blocks.entries()) {
      let changed = false;
      let newName = block.name;

      // 1. Wood group swap
      if (fromWood && toWood) {
        const isFromWood = fromWood === 'oak'
          ? (block.name.includes('oak') && !block.name.includes('dark_oak'))
          : block.name.includes(fromWood);

        if (isFromWood) {
          if (fromWood === 'oak') {
            newName = block.name.replace(/(^|_)oak(_|$)/, `$1${toWood}$2`);
          } else {
            newName = block.name.replace(fromWood, toWood);
          }
          changed = true;
        }
      }

      // 2. Stone group swap
      if (!changed && fromStoneFam && toStoneFam) {
        const matchRole = Object.keys(fromStoneFam).find(role => fromStoneFam[role] === block.name);
        if (matchRole && toStoneFam[matchRole]) {
          newName = toStoneFam[matchRole];
          changed = true;
        }
      }

      // 3. Fallback direct exact match
      if (!changed && block.name === cleanFrom) {
        newName = cleanTo;
        changed = true;
      }

      if (changed && newName !== block.name) {
        block.name = newName;
        if (Object.keys(overrideProps).length > 0) {
          block.properties = { ...(block.properties || {}), ...overrideProps };
        }
        swapCount++;
      }
    }
  } else {
    for (const [key, block] of canvas.blocks.entries()) {
      if (block.name === cleanFrom) {
        block.name = cleanTo;
        if (Object.keys(overrideProps).length > 0) {
          block.properties = { ...(block.properties || {}), ...overrideProps };
        }
        swapCount++;
      }
    }
  }

  return swapCount;
}
