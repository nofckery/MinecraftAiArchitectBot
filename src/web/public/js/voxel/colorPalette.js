/**
 * Minecraft Color Palette & Foliage Tint System
 * Provides authentic vanilla and version-specific tint calculations and fallback colors.
 */

/**
 * Returns authentic Vanilla Minecraft foliage tint colors (Plains, Forests, Savannas, Constant Tints)
 * @param {string} cleanName
 * @returns {number} Hex color integer
 */
export function getFoliageTintColor(cleanName) {
  const clean = (cleanName || '').toLowerCase();

  // 1. Spezifische Baumarten (Vanilla Minecraft Tints & Biome Defaults)
  if (clean.includes('birch')) return 0x80a755;       // Vanilla Birch Constant (#80a755)
  if (clean.includes('spruce') || clean.includes('pine')) return 0x619961; // Vanilla Spruce Constant (#619961)
  if (clean.includes('dark_oak')) return 0x48b518;   // Dark Forest Foliage
  if (clean.includes('jungle')) return 0x59ae30;     // Lush Jungle Foliage
  if (clean.includes('acacia')) return 0x6da337;     // Savanna Foliage
  if (clean.includes('mangrove')) return 0x8db127;   // Mangrove Swamp Foliage
  if (clean.includes('cherry')) return 0xffffff;     // Cherry Leaves texture is already pink PNG
  if (clean.includes('azalea')) return 0xffffff;     // Azalea Leaves texture is already green PNG
  if (clean.includes('pale_oak')) return 0xffffff;   // Pale Garden Leaves PNG is already pale sage

  // 2. 26.3 Poplar Leaves
  if (clean.includes('red_poplar')) return 0xba3224;    // Autumn Crimson Red
  if (clean.includes('orange_poplar')) return 0xe06a1a; // Autumn Amber Orange
  if (clean.includes('yellow_poplar')) return 0xe8b828; // Autumn Golden Yellow

  // 3. Reben & Kletterpflanzen
  if (clean.includes('vine')) return 0x48b518;       // Vanilla Vine tint

  // 4. Gräser, Farne & Büsche
  if (clean.includes('lily_pad')) return 0x208030;   // Lily Pad constant (#208030)
  if (clean.includes('sugar_cane')) return 0x6ba927; // Sugar cane green
  if (clean.includes('fern')) return 0x59ae30;
  if (clean.includes('grass')) return 0x79c05a;
  if (clean.includes('bush')) return 0x59ae30;

  // Standard Foliage Tint (Plains Biome: #59ae30)
  return 0x59ae30;
}

/**
 * Returns authentic Minecraft material hex colors for every block family
 * @param {string} name
 * @returns {number} Hex color integer
 */
export function getBlockFallbackColor(name) {
  const clean = (name || '').replace(/\[.*\]$/, '').replace('minecraft:', '').toLowerCase();

  // 0. Vorrangige Natur-, Blatt-, Busch- & Reben-Auflösung (MUSS vor Holzerkennung stehen!)
  if (clean.includes('leaf') || clean.includes('leaves')) {
    if (clean.includes('cherry')) return 0xdf8f8f;
    if (clean.includes('pale_oak')) return 0x7a8c82;
    if (clean.includes('red_poplar')) return 0xba3224;
    if (clean.includes('orange_poplar')) return 0xe06a1a;
    if (clean.includes('yellow_poplar')) return 0xe8b828;
    return getFoliageTintColor(clean);
  }

  if (clean.includes('bush')) {
    if (clean.includes('dead')) return 0x946b3e;
    if (clean.includes('berry')) return 0x3a6a28;
    if (clean.includes('rose')) return 0x9e2b27;
    if (clean.includes('firefly')) return 0x62a832;
    return 0x59ae30;
  }

  if (clean.includes('vine')) {
    if (clean.includes('weeping')) return 0x7c3447;
    if (clean.includes('twisting')) return 0x2b6863;
    if (clean.includes('cave')) return 0x5b7c1e;
    return 0x48b518;
  }

  if (clean.includes('lily_pad')) return 0x208030;
  if (clean.includes('sugar_cane')) return 0x6ba927;
  if (clean.includes('fern')) return 0x59ae30;
  if (clean.includes('grass')) return 0x4f8737;
  if (clean.includes('dirt') || clean.includes('podzol')) return 0x866043;
  if (clean.includes('sand')) return 0xd9c999;
  if (clean.includes('water')) return 0x3f76e4;
  if (clean.includes('hay')) return 0xd9ba36;

  // 1. Spezifische Hölzer
  if (clean.includes('spruce')) return 0x6c4c2d;
  if (clean.includes('dark_oak')) return 0x3d2715;
  if (clean.includes('birch')) return 0xd7cb8d;
  if (clean.includes('jungle')) return 0xa07353;
  if (clean.includes('acacia')) return 0xba6336;
  if (clean.includes('mangrove')) return 0x753531;
  if (clean.includes('cherry')) return 0xdf8f8f;
  if (clean.includes('bamboo')) return 0xc5b658;
  if (clean.includes('crimson')) return 0x7c3447;
  if (clean.includes('warped')) return 0x2b6863;
  if (clean.includes('pale_oak')) return 0xdcdbd6;
  if (clean.includes('oak') || clean.includes('wood') || clean.includes('plank')) return 0xb58e58;

  // 2. Steine & Mineralien
  if (clean.includes('deepslate')) return 0x3b3b44;
  if (clean.includes('blackstone')) return 0x26232d;
  if (clean.includes('tuff')) return 0x4a4c48;
  if (clean.includes('andesite')) return 0x858586;
  if (clean.includes('diorite')) return 0xbebebe;
  if (clean.includes('granite')) return 0x9a6a59;
  if (clean.includes('sandstone')) return 0xd9c999;
  if (clean.includes('red_sandstone')) return 0xb85c28;
  if (clean.includes('prismarine')) return 0x639a96;
  if (clean.includes('nether_brick')) return 0x2e171b;
  if (clean.includes('resin')) return 0x943a18;
  if (clean.includes('brick')) return 0x994837;
  if (clean.includes('stone') || clean.includes('cobble')) return 0x767676;

  // 3. Böden & Natur
  if (clean.includes('grass')) return 0x4f8737;
  if (clean.includes('dirt') || clean.includes('podzol')) return 0x866043;
  if (clean.includes('leaf') || clean.includes('leaves')) return 0x3a6a28;
  if (clean.includes('sand')) return 0xd9c999;

  // 4. Metalle & Erze
  if (clean.includes('iron') || clean.includes('chain') || clean.includes('anvil')) return 0x888888;
  if (clean.includes('gold') || clean.includes('bell')) return 0xf4b333;
  if (clean.includes('diamond')) return 0x5decf5;
  if (clean.includes('emerald')) return 0x17dd62;
  if (clean.includes('copper')) return 0xc0694e;
  if (clean.includes('lapis')) return 0x1844a4;
  if (clean.includes('redstone') || clean.includes('torchflower')) return 0xbb1919;
  if (clean.includes('torch') || clean.includes('lantern')) return 0xf7a93b;

  // 5. Wolle & Teppiche
  if (clean.includes('white')) return 0xe9ecec;
  if (clean.includes('red')) return 0x9e2b27;
  if (clean.includes('blue')) return 0x3444ac;
  if (clean.includes('yellow')) return 0xf8c627;
  if (clean.includes('green')) return 0x5b7c1e;
  if (clean.includes('black')) return 0x141519;
  if (clean.includes('gray')) return 0x3e4447;
  if (clean.includes('light_blue')) return 0x3ab3da;
  if (clean.includes('lime')) return 0x70b919;
  if (clean.includes('pink')) return 0xed8dac;
  if (clean.includes('cyan')) return 0x158991;
  if (clean.includes('purple')) return 0x7b26b3;
  if (clean.includes('orange')) return 0xf07613;
  if (clean.includes('brown')) return 0x714626;

  // 6. Behälter & Deko
  if (clean.includes('chest')) return 0xa16e34;
  if (clean.includes('pot')) return 0x934a34;
  if (clean.includes('glass')) return 0xa8d5e5;
  if (clean.includes('water')) return 0x2266aa;

  return 0x828282;
}
