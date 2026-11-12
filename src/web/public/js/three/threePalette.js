/**
 * Color palette and lookup definitions for Minecraft blocks in Three.js CAD Viewport.
 */

import { getBlockFallbackColor } from '../textureManager.js';

export const BLOCK_COLORS = {
  stone: 0x828282,
  stone_bricks: 0x767676,
  cracked_stone_bricks: 0x6e6e6e,
  mossy_stone_bricks: 0x5e7256,
  cobblestone: 0x696969,
  mossy_cobblestone: 0x546b50,
  oak_planks: 0xb58e58,
  spruce_planks: 0x6c4c2d,
  birch_planks: 0xd7cb8d,
  dark_oak_planks: 0x3d2715,
  cherry_planks: 0xdf8f8f,
  // 26.3 Pale Garden & Resin
  pale_oak_planks: 0xdcdbd6,
  pale_oak_log: 0x4d5154,
  stripped_pale_oak_log: 0xdcdbd6,
  pale_oak_wood: 0xdcdbd6,
  stripped_pale_oak_wood: 0xdcdbd6,
  pale_oak_leaves: 0x6a7b74,
  pale_moss_block: 0x7a8c82,
  pale_moss_carpet: 0x7a8c82,
  pale_hanging_moss: 0x6a7b74,
  resin_block: 0xe05e26,
  resin_bricks: 0x943a18,
  chiseled_resin_bricks: 0x803214,
  resin_brick_stairs: 0x943a18,
  resin_brick_slab: 0x943a18,
  resin_brick_wall: 0x943a18,
  resin_clump: 0xe05e26,
  creaking_heart: 0x32353a,
  // Authentische Minecraft Laub-, Busch- & Pflanzenfarben (26.3 & Vanilla)
  oak_leaves: 0x59ae30,
  spruce_leaves: 0x619961,
  birch_leaves: 0x80a755,
  jungle_leaves: 0x59ae30,
  acacia_leaves: 0x6da337,
  dark_oak_leaves: 0x48b518,
  mangrove_leaves: 0x8db127,
  cherry_leaves: 0xdf8f8f,
  azalea_leaves: 0x5b7c1e,
  flowering_azalea_leaves: 0x6a8c2e,
  red_poplar_leaves: 0xba3224,
  orange_poplar_leaves: 0xe06a1a,
  yellow_poplar_leaves: 0xe8b828,
  bush: 0x59ae30,
  firefly_bush: 0x62a832,
  dead_bush: 0x946b3e,
  sweet_berry_bush: 0x3a6a28,
  rose_bush: 0x9e2b27,
  vine: 0x48b518,
  cave_vines: 0x5b7c1e,
  cave_vines_plant: 0x5b7c1e,
  weeping_vines: 0x7c3447,
  twisting_vines: 0x2b6863,
  short_grass: 0x79c05a,
  tall_grass: 0x79c05a,
  fern: 0x59ae30,
  large_fern: 0x59ae30,
  lily_pad: 0x208030,
  sugar_cane: 0x6ba927,
  hay_block: 0xd9ba36,
  // Weitere Baumaterialien
  tuff_bricks: 0x4a4c48,
  mud_bricks: 0x89674f,
  oak_log: 0x6d5334,
  spruce_log: 0x3b2a1a,
  dark_oak_log: 0x2e1e12,
  white_terracotta: 0xd1b1a1,
  bricks: 0x994837,
  glass: 0xa8d5e5,
  glass_pane: 0xa8d5e5,
  water: 0x3f76e4,
  iron_bars: 0x888888,
  dirt: 0x866043,
  grass_block: 0x4f8737,
  sandstone: 0xd9c999,
  deepslate_bricks: 0x3b3b44,
  blackstone: 0x26232d
};

export function getBlockColor(name) {
  const clean = (name || '').replace(/\[.*\]$/, '').replace('minecraft:', '').toLowerCase();
  if (BLOCK_COLORS[clean]) return BLOCK_COLORS[clean];
  if (clean.includes('plank')) return 0x967347;
  if (clean.includes('stair')) return 0x84705a;
  if (clean.includes('slab')) return 0x7c6954;
  if (clean.includes('brick')) return 0x777777;
  if (clean.includes('log') || clean.includes('wood')) return 0x543d2b;
  if (clean.includes('glass')) return 0xbee1ee;
  if (clean.includes('leaf') || clean.includes('leaves')) return getBlockFallbackColor(clean);
  if (clean.includes('bush')) return getBlockFallbackColor(clean);
  if (clean.includes('vine')) return getBlockFallbackColor(clean);
  if (clean.includes('door') || clean.includes('trapdoor')) return 0x705232;
  return getBlockFallbackColor(clean) || 0x8a9ba8;
}
