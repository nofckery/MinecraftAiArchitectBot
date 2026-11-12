import assert from 'node:assert';
import {
  getBlockFallbackColor,
  getFoliageTintColor,
  resolveBlockTextureInfo,
  getBlockInstanceTransforms
} from '../src/web/public/js/textureManager.js';
import {
  BLOCK_COLORS,
  getBlockColor
} from '../src/web/public/js/threeViewport.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

console.log('\n================================================================');
console.log('  TEST SUITE: FOLIAGE, LEAVES, BUSH & CAD TEXTURE ENGINE VERIFICATION');
console.log('================================================================\n');

// --- Gruppe 1: Foliage Tint Resolution ---
console.log('--- Testgruppe 1: Vanilla & 26.3 Foliage Tint Auflösung ---');

test('1.1 getFoliageTintColor liefert Vanilla Constant Tints', () => {
  assert.strictEqual(getFoliageTintColor('birch_leaves'), 0x80a755, 'Birch Constant Tint (#80a755)');
  assert.strictEqual(getFoliageTintColor('spruce_leaves'), 0x619961, 'Spruce Constant Tint (#619961)');
  assert.strictEqual(getFoliageTintColor('lily_pad'), 0x208030, 'Lily Pad Constant Tint (#208030)');
});

test('1.2 getFoliageTintColor liefert Biome Foliage Tints für Standard-Laub & Reben', () => {
  assert.strictEqual(getFoliageTintColor('oak_leaves'), 0x59ae30, 'Oak Foliage Tint');
  assert.strictEqual(getFoliageTintColor('dark_oak_leaves'), 0x48b518, 'Dark Oak Forest Tint');
  assert.strictEqual(getFoliageTintColor('jungle_leaves'), 0x59ae30, 'Jungle Foliage Tint');
  assert.strictEqual(getFoliageTintColor('acacia_leaves'), 0x6da337, 'Acacia Savanna Tint');
  assert.strictEqual(getFoliageTintColor('mangrove_leaves'), 0x8db127, 'Mangrove Swamp Tint');
  assert.strictEqual(getFoliageTintColor('vine'), 0x48b518, 'Vine Tint');
  assert.strictEqual(getFoliageTintColor('bush'), 0x59ae30, 'Bush Foliage Tint');
});

test('1.3 getFoliageTintColor behält ungefilterte Farben für pre-colored Texturen', () => {
  assert.strictEqual(getFoliageTintColor('cherry_leaves'), 0xffffff, 'Cherry Leaves PNG ist bereits rosa');
  assert.strictEqual(getFoliageTintColor('azalea_leaves'), 0xffffff, 'Azalea Leaves PNG ist bereits grün');
  assert.strictEqual(getFoliageTintColor('pale_oak_leaves'), 0xffffff, 'Pale Oak Leaves PNG ist bereits pale-sage');
});

test('1.4 getFoliageTintColor liefert authentische 26.3 Poplar Leaves Farben', () => {
  assert.strictEqual(getFoliageTintColor('red_poplar_leaves'), 0xba3224, 'Red Poplar Autumn Tint');
  assert.strictEqual(getFoliageTintColor('orange_poplar_leaves'), 0xe06a1a, 'Orange Poplar Autumn Tint');
  assert.strictEqual(getFoliageTintColor('yellow_poplar_leaves'), 0xe8b828, 'Yellow Poplar Autumn Tint');
});

// --- Gruppe 2: getBlockFallbackColor Priorisierung ---
console.log('\n--- Testgruppe 2: getBlockFallbackColor Priorisierung (Laub vor Holz) ---');

test('2.1 Laubblöcke mit Holznamen im String werden NIEMALS als braunes Holz erkannt', () => {
  // Früherer Bug: clean.includes('spruce') griff VOR clean.includes('leaves') -> braunes Holz!
  assert.notStrictEqual(getBlockFallbackColor('spruce_leaves'), 0x6c4c2d, 'Spruce Leaves darf nicht Fichtenholz-Braun sein');
  assert.strictEqual(getBlockFallbackColor('spruce_leaves'), 0x619961, 'Spruce Leaves muss Nadelbaum-Grün sein');

  assert.notStrictEqual(getBlockFallbackColor('birch_leaves'), 0xd7cb8d, 'Birch Leaves darf nicht Birkenholz-Gelb sein');
  assert.strictEqual(getBlockFallbackColor('birch_leaves'), 0x80a755, 'Birch Leaves muss Birkengrün sein');

  assert.notStrictEqual(getBlockFallbackColor('dark_oak_leaves'), 0x3d2715, 'Dark Oak Leaves darf nicht Dunkelholz-Braun sein');
  assert.strictEqual(getBlockFallbackColor('dark_oak_leaves'), 0x48b518, 'Dark Oak Leaves muss Waldgrün sein');

  assert.notStrictEqual(getBlockFallbackColor('oak_leaves'), 0xb58e58, 'Oak Leaves darf nicht Eichenplanken-Braun sein');
  assert.strictEqual(getBlockFallbackColor('oak_leaves'), 0x59ae30, 'Oak Leaves muss Laubgrün sein');
});

test('2.2 Busch-, Reben- und Sonderblöcke haben korrekte Naturfarben', () => {
  assert.strictEqual(getBlockFallbackColor('bush'), 0x59ae30, 'Bush ist saftiges Blattgrün');
  assert.strictEqual(getBlockFallbackColor('dead_bush'), 0x946b3e, 'Dead Bush ist vertrocknetes Holzbraun');
  assert.strictEqual(getBlockFallbackColor('sweet_berry_bush'), 0x3a6a28, 'Sweet Berry Bush ist Beerengrün');
  assert.strictEqual(getBlockFallbackColor('vine'), 0x48b518, 'Vine ist Reben-Grün');
  assert.strictEqual(getBlockFallbackColor('water'), 0x3f76e4, 'Water ist Minecraft-Ozeanblau');
});

// --- Gruppe 3: resolveBlockTextureInfo Spezifikation ---
console.log('\n--- Testgruppe 3: resolveBlockTextureInfo Spezifikation & Tint-Flags ---');

test('3.1 Alle Laubblöcke besitzen transparent: true, alphaTest: 0.5 und passende Tints', () => {
  const oakInfo = resolveBlockTextureInfo('oak_leaves');
  assert.strictEqual(oakInfo.type, 'leaves');
  assert.strictEqual(oakInfo.transparent, true);
  assert.strictEqual(oakInfo.alphaTest, 0.5);
  assert.strictEqual(oakInfo.tint, 0x59ae30);

  const birchInfo = resolveBlockTextureInfo('birch_leaves');
  assert.strictEqual(birchInfo.tint, 0x80a755);

  const spruceInfo = resolveBlockTextureInfo('spruce_leaves');
  assert.strictEqual(spruceInfo.tint, 0x619961);
});

test('3.2 Bush und Firefly Bush sind vollwertige Laub-Pflanzenblöcke mit Tint', () => {
  const bushInfo = resolveBlockTextureInfo('bush');
  assert.strictEqual(bushInfo.type, 'leaves');
  assert.strictEqual(bushInfo.transparent, true);
  assert.strictEqual(bushInfo.tint, 0x59ae30);

  const fireflyInfo = resolveBlockTextureInfo('firefly_bush');
  assert.strictEqual(fireflyInfo.type, 'leaves');
  assert.strictEqual(fireflyInfo.transparent, true);
  assert.strictEqual(fireflyInfo.tint, 0x59ae30);
});

test('3.3 Reben (Vines) haben Typ "vine", Transparenz und Laub-Tint', () => {
  const vineInfo = resolveBlockTextureInfo('vine');
  assert.strictEqual(vineInfo.type, 'vine');
  assert.strictEqual(vineInfo.transparent, true);
  assert.strictEqual(vineInfo.alphaTest, 0.5);
  assert.strictEqual(vineInfo.tint, 0x48b518);
});

test('3.4 Wasser besitzt blaue Tönung und Transparenz', () => {
  const waterInfo = resolveBlockTextureInfo('water');
  assert.strictEqual(waterInfo.type, 'water');
  assert.strictEqual(waterInfo.transparent, true);
  assert.strictEqual(waterInfo.tint, 0x3f76e4);
});

// --- Gruppe 4: 3D Geometrie & Transforms (Wand-Reben & Pflanzen) ---
console.log('\n--- Testgruppe 4: Authentische 3D Block-Geometrien (Vines & Foliage) ---');

test('4.1 Reben an Wänden schmiegen sich flach an die entsprechende Wandfläche (Dicke 0.05)', () => {
  const vineBlockWest = {
    x: 6, y: 2, z: 2,
    name: 'vine',
    properties: { west: 'true', east: 'false', north: 'false', south: 'false', up: 'false' }
  };
  const vineInfo = resolveBlockTextureInfo('vine');
  const tList = getBlockInstanceTransforms(vineBlockWest, vineInfo);
  assert.strictEqual(tList.length, 1);
  assert.strictEqual(tList[0].sx, 0.05, 'Dünne Wandebene entlang X');
  assert.strictEqual(tList[0].sy, 1.0);
  assert.strictEqual(tList[0].sz, 1.0);
  assert.strictEqual(tList[0].px, 6 + 0.025, 'Westkante anliegend');
});

test('4.2 Reben mit mehreren befestigten Wänden generieren mehrere Wandebenen', () => {
  const multiVine = {
    x: 0, y: 0, z: 0,
    name: 'vine',
    properties: { north: 'true', south: 'true', east: 'false', west: 'false', up: 'false' }
  };
  const vineInfo = resolveBlockTextureInfo('vine');
  const tList = getBlockInstanceTransforms(multiVine, vineInfo);
  assert.strictEqual(tList.length, 2, '2 Wandebenen für north und south');
});

test('4.3 Laubblöcke behalten vollen 1x1x1 Kubus für authentische Kronen & Hecken', () => {
  const leafBlock = { x: 5, y: 1, z: 2, name: 'oak_leaves', properties: {} };
  const leafInfo = resolveBlockTextureInfo('oak_leaves');
  const tList = getBlockInstanceTransforms(leafBlock, leafInfo);
  assert.strictEqual(tList.length, 1);
  assert.strictEqual(tList[0].sx, 1.0);
  assert.strictEqual(tList[0].sy, 1.0);
  assert.strictEqual(tList[0].sz, 1.0);
});

// --- Gruppe 5: Three.js Viewport BLOCK_COLORS & getBlockColor ---
console.log('\n--- Testgruppe 5: CAD Viewport BLOCK_COLORS & Hologramm-Farben ---');

test('5.1 BLOCK_COLORS enthält alle Laub- & Buschvarianten in Minecraft 26.3', () => {
  assert.strictEqual(BLOCK_COLORS.oak_leaves, 0x59ae30);
  assert.strictEqual(BLOCK_COLORS.spruce_leaves, 0x619961);
  assert.strictEqual(BLOCK_COLORS.birch_leaves, 0x80a755);
  assert.strictEqual(BLOCK_COLORS.bush, 0x59ae30);
  assert.strictEqual(BLOCK_COLORS.firefly_bush, 0x62a832);
  assert.strictEqual(BLOCK_COLORS.red_poplar_leaves, 0xba3224);
  assert.strictEqual(BLOCK_COLORS.vine, 0x48b518);
});

test('5.2 getBlockColor löst alle Blätter und Büsche farbecht auf', () => {
  assert.strictEqual(getBlockColor('oak_leaves'), 0x59ae30);
  assert.strictEqual(getBlockColor('minecraft:spruce_leaves[distance=1]'), 0x619961);
  assert.strictEqual(getBlockColor('bush'), 0x59ae30);
  assert.strictEqual(getBlockColor('dead_bush'), 0x946b3e);
  assert.strictEqual(getBlockColor('vine[west=true]'), 0x48b518);
});

console.log('\n================================================================');
console.log(`  ERGEBNIS: ${passed} / ${total} TESTS ERFOLGREICH BESTANDEN!`);
console.log('  Foliage, Leaves, Bush & CAD Rendering 100% verifiziert!');
console.log('================================================================\n');
