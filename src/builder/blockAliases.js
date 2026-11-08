export const BLOCK_ALIASES = {
  'wood_planks': 'oak_planks',
  'plank': 'oak_planks',
  'planks': 'oak_planks',
  'stone_brick': 'stone_bricks',
  'cobble': 'cobblestone',
  'mossy_cobble': 'mossy_cobblestone',
  'stripped_oak': 'stripped_oak_log',
  'stripped_spruce': 'stripped_spruce_log',
  'stripped_birch': 'stripped_birch_log',
  'stripped_dark_oak': 'stripped_dark_oak_log',
  'window': 'glass_pane',
  'glass_window': 'glass_pane',
  'torch_wall': 'wall_torch',
  'wall_torch_block': 'wall_torch',
  'wooden_door': 'oak_door',
  'wood_door': 'oak_door',
  'iron_bars_pane': 'iron_bars',
  'bookshelves': 'bookshelf',
  'spruce_shelves': 'spruce_shelf',
  'oak_shelves': 'oak_shelf',
  'birch_shelves': 'birch_shelf',
  'acacia_shelves': 'acacia_shelf',
  'jungle_shelves': 'jungle_shelf',
  'dark_oak_shelves': 'dark_oak_shelf',
  'mangrove_shelves': 'mangrove_shelf',
  'cherry_shelves': 'cherry_shelf',
  'bamboo_shelves': 'bamboo_shelf',
  'crimson_shelves': 'crimson_shelf',
  'warped_shelves': 'warped_shelf',
  'pale_oak_shelves': 'pale_oak_shelf',
  'poplar_shelves': 'poplar_shelf',
  'smooth_stone_slabs': 'smooth_stone_slab',
  'stone_slabs': 'stone_slab',
  'deepslate_brick': 'deepslate_bricks',
  'deepslate_tile': 'deepslate_tiles',
  'polished_deepslate_brick': 'polished_deepslate',
  'mossy_stone_brick': 'mossy_stone_bricks',
  'cracked_stone_brick': 'cracked_stone_bricks',
  'oak_log_wood': 'oak_log',
  'spruce_log_wood': 'spruce_log',
  'dark_oak_log_wood': 'dark_oak_log',
  'birch_log_wood': 'birch_log',
  'grass': 'short_grass',
  'tall_grass': 'tall_grass',
  'flower': 'dandelion',
  'red_flower': 'poppy',
  'yellow_flower': 'dandelion',
  'dirt_path': 'dirt_path',
  'grass_path': 'dirt_path',
  'brick': 'bricks',
  'log': 'oak_log',
  'wood': 'oak_wood',
  'glass_block': 'glass'
};

/**
 * Normalizes a block name by stripping minecraft: prefix, stripping bracketed block states,
 * trimming, lowercasing, and optionally applying block aliases.
 *
 * @param {string} name - Block name to normalize
 * @param {boolean} [applyAlias=true] - Whether to map alias to canonical name
 * @returns {string} Normalized canonical block name
 */
export function normalizeBlockName(name, applyAlias = true) {
  if (!name || typeof name !== 'string') return '';
  let clean = name.trim().toLowerCase();
  const bracketIdx = clean.indexOf('[');
  if (bracketIdx !== -1) {
    clean = clean.slice(0, bracketIdx).trim();
  }
  clean = clean.replace('minecraft:', '');
  if (applyAlias && BLOCK_ALIASES[clean]) {
    clean = BLOCK_ALIASES[clean];
  }
  return clean;
}
