import { getFoliageTintColor } from './colorPalette.js';

/**
 * Resolves base block texture name for stairs, slabs, walls and fences
 * @param {string} raw
 * @param {string} suffix
 * @returns {string}
 */
export function extractBlockBaseName(raw, suffix) {
  let base = raw.replace(suffix, '');
  if (base === 'stone_brick') return 'stone_bricks';
  if (base === 'mossy_stone_brick') return 'mossy_stone_bricks';
  if (base === 'deepslate_brick') return 'deepslate_bricks';
  if (base === 'deepslate_tile') return 'deepslate_tiles';
  if (base === 'resin_brick') return 'resin_bricks';
  if (base === 'mud_brick') return 'mud_bricks';
  if (base === 'tuff_brick') return 'tuff_bricks';
  if (base === 'nether_brick') return 'nether_bricks';
  if (base === 'red_nether_brick') return 'red_nether_bricks';
  if (base === 'blackstone_brick') return 'blackstone_bricks';
  if (base === 'polished_blackstone_brick') return 'polished_blackstone_bricks';
  if (base === 'end_stone_brick') return 'end_stone_bricks';
  if (base === 'quartz_block' || base === 'quartz') return 'quartz_block_side';
  if (base === 'smooth_quartz') return 'quartz_block_bottom';
  if (base === 'sandstone') return 'sandstone';
  if (base === 'red_sandstone') return 'red_sandstone';
  if (base === 'smooth_sandstone') return 'sandstone_top';
  if (base === 'cut_sandstone') return 'cut_sandstone';
  if (base === 'purpur') return 'purpur_block';
  if (base === 'prismarine_brick') return 'prismarine_bricks';
  if (base === 'tuff') return 'tuff';
  if (base === 'cobbled_deepslate') return 'cobbled_deepslate';
  if (base === 'polished_deepslate') return 'polished_deepslate';
  if (base === 'polished_tuff') return 'polished_tuff';
  if (base === 'cobblestone') return 'cobblestone';
  if (base === 'mossy_cobblestone') return 'mossy_cobblestone';
  if (base === 'stone') return 'stone';
  if (base === 'granite') return 'granite';
  if (base === 'diorite') return 'diorite';
  if (base === 'andesite') return 'andesite';
  if (base === 'polished_granite') return 'polished_granite';
  if (base === 'polished_diorite') return 'polished_diorite';
  if (base === 'polished_andesite') return 'polished_andesite';
  if (base === 'blackstone') return 'blackstone';
  if (base === 'polished_blackstone') return 'polished_blackstone';
  if (base === 'smooth_stone') return 'smooth_stone';

  const woodTypes = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped', 'pale_oak'];
  for (const w of woodTypes) {
    if (base === w || base === `${w}_wood`) return `${w}_planks`;
  }
  return base;
}

/**
 * Maps any block name to its authentic texture specification and geometry type
 * @param {string} rawName
 * @returns {object} Texture & geometry metadata
 */
export function resolveBlockTextureInfo(rawName) {
  const clean = (rawName || '').replace(/\[.*\]$/, '').replace('minecraft:', '').toLowerCase();

  // 1. Spezifische Multi-Faced Blöcke
  if (clean === 'grass_block') {
    return { type: 'multiface', side: 'grass_block_side', top: 'grass_block_top', bottom: 'dirt', topTint: 0x79c05a };
  }
  if (clean === 'dirt_path') {
    return { type: 'multiface', side: 'dirt_path_side', top: 'dirt_path_top', bottom: 'dirt' };
  }
  if (clean === 'podzol') {
    return { type: 'multiface', side: 'podzol_side', top: 'podzol_top', bottom: 'dirt' };
  }
  if (clean === 'mycelium') {
    return { type: 'multiface', side: 'mycelium_side', top: 'mycelium_top', bottom: 'dirt' };
  }
  if (clean === 'crafting_table') {
    return { type: 'multiface', top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front', bottom: 'oak_planks' };
  }
  if (clean === 'furnace') {
    return { type: 'multiface', front: 'furnace_front', side: 'furnace_side', top: 'furnace_top', bottom: 'stone' };
  }
  if (clean === 'smoker') {
    return { type: 'multiface', front: 'smoker_front', side: 'smoker_side', top: 'smoker_top', bottom: 'smoker_bottom' };
  }
  if (clean === 'blast_furnace') {
    return { type: 'multiface', front: 'blast_furnace_front', side: 'blast_furnace_side', top: 'blast_furnace_top', bottom: 'blast_furnace_top' };
  }
  if (clean === 'bookshelf') {
    return { type: 'multiface', side: 'bookshelf', top: 'oak_planks', bottom: 'oak_planks' };
  }
  if (clean === 'barrel') {
    return { type: 'multiface', side: 'barrel_side', top: 'barrel_top', bottom: 'barrel_bottom' };
  }
  if (clean === 'hay_block') {
    return { type: 'multiface', side: 'hay_block_side', top: 'hay_block_top', bottom: 'hay_block_top' };
  }
  if (clean === 'loom') {
    return { type: 'multiface', front: 'loom_front', side: 'loom_side', top: 'loom_top', bottom: 'loom_bottom' };
  }
  if (clean === 'cartography_table') {
    return { type: 'multiface', front: 'cartography_table_side3', side: 'cartography_table_side1', top: 'cartography_table_top', bottom: 'dark_oak_planks' };
  }
  if (clean === 'lectern') {
    return { type: 'multiface', front: 'lectern_front', side: 'lectern_sides', top: 'lectern_top', bottom: 'lectern_base' };
  }
  if (clean === 'stonecutter') {
    return { type: 'multiface', side: 'stonecutter_side', top: 'stonecutter_top', bottom: 'stonecutter_bottom' };
  }
  if (clean === 'smithing_table') {
    return { type: 'multiface', front: 'smithing_table_front', side: 'smithing_table_side', top: 'smithing_table_top', bottom: 'smithing_table_bottom' };
  }
  if (clean === 'jukebox') {
    return { type: 'multiface', side: 'jukebox_side', top: 'jukebox_top', bottom: 'jukebox_side' };
  }
  if (clean === 'enchanting_table') {
    return { type: 'multiface', side: 'enchanting_table_side', top: 'enchanting_table_top', bottom: 'enchanting_table_bottom' };
  }
  if (clean === 'lodestone') {
    return { type: 'multiface', side: 'lodestone_side', top: 'lodestone_top', bottom: 'lodestone_top' };
  }

  // 2. Kisten (Chests)
  if (clean.includes('chest')) {
    const isEnder = clean.includes('ender');
    return {
      type: 'chest',
      front: isEnder ? 'ender_chest_front' : 'chest_front',
      side: isEnder ? 'ender_chest_front' : 'chest_side',
      top: isEnder ? 'ender_chest_front' : 'chest_top',
      bottom: isEnder ? 'ender_chest_front' : 'chest_top'
    };
  }

  // 3. Knöpfe (Buttons)
  if (clean.endsWith('_button')) {
    let base = clean.replace('_button', '');
    if (base === 'stone') base = 'stone';
    else if (base === 'polished_blackstone') base = 'polished_blackstone';
    else base = `${base}_planks`;
    return { type: 'button', texture: base };
  }

  // 4. Mauern (Walls)
  if (clean.endsWith('_wall') && !clean.includes('sign') && !clean.includes('torch') && !clean.includes('head') && !clean.includes('banner')) {
    return { type: 'wall', texture: extractBlockBaseName(clean, '_wall') };
  }

  // 5. Blumentöpfe (Pots)
  if (clean.startsWith('potted_') || clean === 'flower_pot') {
    return { type: 'pot', texture: 'flower_pot' };
  }

  // 6. Fackeln (Torches)
  if (clean.includes('torch')) {
    if (clean.includes('soul')) return { type: 'torch', texture: 'soul_torch', transparent: true, alphaTest: 0.5 };
    if (clean.includes('redstone')) return { type: 'torch', texture: 'redstone_torch', transparent: true, alphaTest: 0.5 };
    return { type: 'torch', texture: 'torch', transparent: true, alphaTest: 0.5 };
  }

  // 7. Betten (Beds)
  if (clean.endsWith('_bed')) {
    const color = clean.replace('_bed', '');
    return { type: 'bed', texture: `${color}_wool` };
  }

  // 8. Ketten & Leitern
  if (clean === 'chain') return { type: 'chain', texture: 'chain', transparent: true, alphaTest: 0.5 };
  if (clean === 'ladder') return { type: 'ladder', texture: 'ladder', transparent: true, alphaTest: 0.5 };

  // 9. Schilder & Tore
  if (clean.includes('sign')) {
    let wood = 'oak_planks';
    ['spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'pale_oak', 'crimson', 'warped'].forEach(w => {
      if (clean.includes(w)) wood = `${w}_planks`;
    });
    return { type: 'sign', texture: wood };
  }
  if (clean.endsWith('_fence_gate')) {
    let wood = 'oak_planks';
    ['spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'pale_oak', 'crimson', 'warped'].forEach(w => {
      if (clean.includes(w)) wood = `${w}_planks`;
    });
    return { type: 'fence_gate', texture: wood };
  }

  // 10. Köpfe & Banner
  if (clean.includes('head') || clean.includes('skull')) {
    return { type: 'head', texture: 'skeleton_skull' };
  }
  if (clean.includes('banner')) {
    let color = 'white';
    ['red', 'blue', 'green', 'yellow', 'black', 'white', 'gray', 'purple', 'cyan', 'pink'].forEach(c => {
      if (clean.includes(c)) color = c;
    });
    return { type: 'banner', texture: `${color}_wool` };
  }

  // 11. Lagerfeuer
  if (clean.includes('campfire')) {
    return { type: 'campfire', texture: 'campfire_log' };
  }

  // 12. Baumstämme (Logs & Wood)
  if (clean.endsWith('_log') || clean.endsWith('_wood')) {
    const base = clean.replace('_wood', '_log');
    return { type: 'log', side: base, top: `${base}_top` };
  }

  // 13. Treppen (Stairs)
  if (clean.endsWith('_stairs')) {
    return { type: 'stairs', texture: extractBlockBaseName(clean, '_stairs') };
  }

  // 14. Stufen (Slabs)
  if (clean.endsWith('_slab')) {
    return { type: 'slab', texture: extractBlockBaseName(clean, '_slab') };
  }

  // 15. Zäune (Fences)
  if (clean.endsWith('_fence')) {
    return { type: 'fence', texture: extractBlockBaseName(clean, '_fence') };
  }

  // 16. Transparente Blöcke, Laub, Reben & Vegetation (Authentisch Minecraft 26.3 & Classic)
  if (clean.includes('glass')) {
    return { type: 'glass', texture: clean.includes('stained') ? clean.replace('_pane', '') : 'glass', transparent: true, opacity: 0.65 };
  }
  if (clean === 'water') {
    return { type: 'water', texture: 'water_still', tint: 0x3f76e4, transparent: true, opacity: 0.7 };
  }
  if (clean.endsWith('_leaves')) {
    return { type: 'leaves', texture: clean, tint: getFoliageTintColor(clean), transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'bush') {
    return { type: 'leaves', texture: 'bush', tint: 0x59ae30, transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'firefly_bush') {
    return { type: 'leaves', texture: 'firefly_bush', tint: 0x59ae30, transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'dead_bush' || clean === 'potted_dead_bush') {
    return { type: 'plant', texture: 'dead_bush', transparent: true, alphaTest: 0.5 };
  }
  if (clean.includes('sweet_berry_bush')) {
    return { type: 'plant', texture: 'sweet_berry_bush_stage3', transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'rose_bush') {
    return { type: 'plant', texture: 'rose_bush_top', transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'vine') {
    return { type: 'vine', texture: 'vine', tint: 0x48b518, transparent: true, alphaTest: 0.5 };
  }
  if (clean.includes('cave_vines')) {
    return { type: 'vine', texture: clean.includes('lit') ? 'cave_vines_lit' : 'cave_vines', transparent: true, alphaTest: 0.5 };
  }
  if (clean.includes('weeping_vines')) {
    return { type: 'vine', texture: 'weeping_vines', transparent: true, alphaTest: 0.5 };
  }
  if (clean.includes('twisting_vines')) {
    return { type: 'vine', texture: 'twisting_vines', transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'pale_hanging_moss') {
    return { type: 'vine', texture: 'pale_hanging_moss', transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'short_grass' || clean === 'grass' || clean === 'tall_grass') {
    return { type: 'plant', texture: clean.includes('tall') ? 'tall_grass_bottom' : 'short_grass', tint: 0x79c05a, transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'fern' || clean === 'large_fern' || clean === 'potted_fern') {
    return { type: 'plant', texture: clean.includes('large') ? 'large_fern_bottom' : 'fern', tint: 0x59ae30, transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'lily_pad') {
    return { type: 'lily_pad', texture: 'lily_pad', tint: 0x208030, transparent: true, alphaTest: 0.5 };
  }
  if (clean === 'sugar_cane') {
    return { type: 'plant', texture: 'sugar_cane', tint: 0x6ba927, transparent: true, alphaTest: 0.5 };
  }

  // 17. Dekoration & Beleuchtung
  if (clean === 'lantern') {
    return { type: 'lantern', texture: 'lantern', transparent: true, alphaTest: 0.5 };
  }
  if (clean.endsWith('_carpet')) {
    return { type: 'carpet', texture: clean.replace('_carpet', '_wool') };
  }
  if (clean.endsWith('_trapdoor')) {
    return { type: 'trapdoor', texture: clean, transparent: true, alphaTest: 0.5 };
  }
  if (clean.endsWith('_door')) {
    return { type: 'door', texture: `${clean}_top`, transparent: true, alphaTest: 0.5 };
  }

  // Standard-Voller-Block
  return { type: 'single', texture: clean };
}
