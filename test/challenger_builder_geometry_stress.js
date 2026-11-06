/**
 * Adversarial Challenger Stress-Test Suite for Builder & Geometry Subsystems
 * Targeting:
 *  - greedyMesher.js (computeGreedyBoxes, toBlockString)
 *  - paletteSwapper.js (swapMaterial, WOOD_TYPES, STONE_FAMILIES)
 *  - canvasDiff.js (computeDiff)
 *  - formats/ (spongeFormat.js, nbtFormat.js, litematicFormat.js)
 *  - schematicManager.js (SchematicManager dispatcher)
 */

import assert from 'node:assert';
import fs from 'node:fs';
import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { computeGreedyBoxes, toBlockString } from '../src/builder/greedyMesher.js';
import { swapMaterial, WOOD_TYPES, STONE_FAMILIES } from '../src/builder/paletteSwapper.js';
import { computeDiff } from '../src/builder/canvasDiff.js';
import { parseSpongeSchematic, exportSpongeSchematic } from '../src/builder/formats/spongeFormat.js';
import { parseNbtStructure, exportNbtStructure } from '../src/builder/formats/nbtFormat.js';
import { parseLitematic } from '../src/builder/formats/litematicFormat.js';
import { schematicManager, SchematicManager } from '../src/builder/schematicManager.js';

let passedTests = 0;
let totalTests = 0;
const findings = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    findings.push({ name, error: err.message, stack: err.stack });
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    findings.push({ name, error: err.message, stack: err.stack });
    console.error(`  [FAIL] ${name}: ${err.message}`);
  }
}

async function runAdversarialSuite() {
  console.log('\n================================================================');
  console.log('  CHALLENGER: BUILDER & GEOMETRY ADVERSARIAL STRESS TEST SUITE');
  console.log('================================================================\n');

  // ============================================================================
  // SUITE 1: GREEDY MESHER ADVERSARIAL STRESS & INVARIANTS
  // ============================================================================
  console.log('--- SUITE 1: Greedy Mesher (/fill Volume Compression) ---');

  // T1.1: Boundary & Null Inputs
  test('T1.1: GreedyMesher handles empty, null, and undefined inputs gracefully', () => {
    assert.deepStrictEqual(computeGreedyBoxes(null), []);
    assert.deepStrictEqual(computeGreedyBoxes([]), []);
    assert.deepStrictEqual(computeGreedyBoxes(undefined), []);
    const emptyCanvas = new VoxelCanvas(10, 10, 10);
    assert.deepStrictEqual(computeGreedyBoxes(null, emptyCanvas), []);
    assert.deepStrictEqual(emptyCanvas.computeGreedyBoxes(), []);
    assert.deepStrictEqual(VoxelCanvas.computeGreedyBoxes([], null), []);
  });

  // T1.2: toBlockString edge cases
  test('T1.2: toBlockString correctly parses complex states, nulls, and sorts keys', () => {
    assert.strictEqual(toBlockString(null), 'air');
    assert.strictEqual(toBlockString(undefined), 'air');
    assert.strictEqual(toBlockString({ name: 'air' }), 'air');
    assert.strictEqual(toBlockString({ name: 'stone' }), 'stone');
    assert.strictEqual(toBlockString({ name: 'stone', properties: {} }), 'stone');
    // Sorted keys invariant: z must come after a
    const str = toBlockString({
      name: 'oak_stairs',
      properties: { shape: 'straight', facing: 'north', half: 'bottom' }
    });
    assert.strictEqual(str, 'oak_stairs[facing=north,half=bottom,shape=straight]');
  });

  // T1.3: Solid 3D Cube Merging & Volume Conservation
  test('T1.3: Solid 10x10x10 cube collapses to exactly 1 box with volume 1000', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.box(0, 0, 0, 9, 9, 9, 'stone');
    const boxes = canvas.computeGreedyBoxes();
    assert.strictEqual(boxes.length, 1, `Expected 1 merged box, got ${boxes.length}`);
    assert.strictEqual(boxes[0].volume, 1000, `Expected volume 1000, got ${boxes[0].volume}`);
    assert.strictEqual(boxes[0].minX, 0);
    assert.strictEqual(boxes[0].maxX, 9);
    assert.strictEqual(boxes[0].minY, 0);
    assert.strictEqual(boxes[0].maxY, 9);
    assert.strictEqual(boxes[0].minZ, 0);
    assert.strictEqual(boxes[0].maxZ, 9);
    assert.strictEqual(boxes[0].fullBlockString, 'stone');
  });

  // T1.4: 3D Hollow Box (Volume Conservation Invariant)
  test('T1.4: Hollow 6x6x6 box preserves exact volume (216 - 64 = 152 voxels)', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.box(0, 0, 0, 5, 5, 5, 'stone_bricks', true); // hollow = true
    const expectedCount = canvas.blocks.size; // 6^3 - 4^3 = 216 - 64 = 152
    assert.strictEqual(expectedCount, 152, `Expected 152 blocks in hollow box, got ${expectedCount}`);

    const boxes = canvas.computeGreedyBoxes();
    const totalVolume = boxes.reduce((acc, b) => acc + b.volume, 0);
    assert.strictEqual(totalVolume, 152, `Volume conservation failed: total volume ${totalVolume} != 152`);

    // Verify no boxes intersect the hollow interior (1..4, 1..4, 1..4)
    for (const b of boxes) {
      for (let x = b.minX; x <= b.maxX; x++) {
        for (let y = b.minY; y <= b.maxY; y++) {
          for (let z = b.minZ; z <= b.maxZ; z++) {
            const isInterior = (x >= 1 && x <= 4 && y >= 1 && y <= 4 && z >= 1 && z <= 4);
            assert(!isInterior, `Box illegally covers interior empty voxel at (${x},${y},${z})`);
            assert(canvas.has(x, y, z), `Box covers non-existent block at (${x},${y},${z})`);
          }
        }
      }
    }
  });

  // T1.5: 3D Checkerboard Stress (Maximum Entropy - No Merging Allowed)
  test('T1.5: 3D 4x4x4 checkerboard with alternating blocks produces 64 single-voxel boxes', () => {
    const canvas = new VoxelCanvas(4, 4, 4);
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        for (let z = 0; z < 4; z++) {
          const material = (x + y + z) % 2 === 0 ? 'stone' : 'dirt';
          canvas.set(x, y, z, material);
        }
      }
    }
    const boxes = canvas.computeGreedyBoxes();
    assert.strictEqual(boxes.length, 64, `Checkerboard must not merge diagonal voxels; expected 64, got ${boxes.length}`);
    for (const b of boxes) {
      assert.strictEqual(b.volume, 1, `Every checkerboard box must have volume 1, found ${b.volume}`);
    }
  });

  // T1.6: Disjoint Islands & Extreme Negative Coordinates
  test('T1.6: Disjoint voxels with extreme negative coordinates are meshed without bleed', () => {
    const testBlocks = [
      { x: -500, y: -64, z: -500, fullBlockString: 'obsidian', blockState: { name: 'obsidian' } },
      { x: -500, y: -64, z: -499, fullBlockString: 'obsidian', blockState: { name: 'obsidian' } },
      { x: 1000, y: 256, z: 1000, fullBlockString: 'obsidian', blockState: { name: 'obsidian' } }
    ];
    const boxes = computeGreedyBoxes(testBlocks);
    assert.strictEqual(boxes.length, 2, `Expected 2 boxes for disjoint clusters, got ${boxes.length}`);
    const b1 = boxes.find(b => b.minX === -500);
    const b2 = boxes.find(b => b.minX === 1000);
    assert(b1 && b1.volume === 2, 'Negative coordinate pair merged properly');
    assert(b2 && b2.volume === 1, 'Isolated positive voxel isolated properly');
  });

  // T1.7: Block State Discrimination Invariant
  test('T1.7: Adjacent blocks with different state properties are NEVER merged', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'oak_stairs[facing=north]');
    canvas.set(1, 0, 0, 'oak_stairs[facing=south]'); // adjacent X
    canvas.set(0, 0, 1, 'oak_stairs[facing=north]'); // adjacent Z with same state
    const boxes = canvas.computeGreedyBoxes();
    assert.strictEqual(boxes.length, 2, `Expected 2 boxes due to state mismatch, got ${boxes.length}`);
    const northBox = boxes.find(b => b.fullBlockString.includes('facing=north'));
    const southBox = boxes.find(b => b.fullBlockString.includes('facing=south'));
    assert.strictEqual(northBox.volume, 2, 'Matching facing=north blocks merged along Z');
    assert.strictEqual(southBox.volume, 1, 'Different facing=south block kept distinct');
  });

  // T1.8: Concave Geometry (U-shape / L-shape)
  test('T1.8: Concave L-shape preserves exact volume without filling concave pocket', () => {
    const canvas = new VoxelCanvas(4, 4, 4);
    // 3x3 L-shape base
    canvas.set(0, 0, 0, 'stone');
    canvas.set(1, 0, 0, 'stone');
    canvas.set(2, 0, 0, 'stone');
    canvas.set(0, 0, 1, 'stone');
    canvas.set(0, 0, 2, 'stone');
    const boxes = canvas.computeGreedyBoxes();
    const totalVolume = boxes.reduce((acc, b) => acc + b.volume, 0);
    assert.strictEqual(totalVolume, 5, `Expected volume 5, got ${totalVolume}`);
    for (const b of boxes) {
      assert(!(b.minX <= 1 && b.maxX >= 1 && b.minZ <= 1 && b.maxZ >= 1 && b.minY <= 0 && b.maxY >= 0),
        'Box erroneously filled concave pocket (1, 0, 1)');
    }
  });

  // T1.9: Duplicate coordinates in raw block array
  test('T1.9: Raw input array with duplicate coordinates is handled without crashing or duplicate volume', () => {
    const rawBlocks = [
      { x: 0, y: 0, z: 0, fullBlockString: 'stone', blockState: { name: 'stone' } },
      { x: 0, y: 0, z: 0, fullBlockString: 'stone', blockState: { name: 'stone' } },
      { x: 1, y: 0, z: 0, fullBlockString: 'stone', blockState: { name: 'stone' } }
    ];
    const boxes = computeGreedyBoxes(rawBlocks);
    const totalVolume = boxes.reduce((acc, b) => acc + b.volume, 0);
    assert.strictEqual(totalVolume, 2, `Expected duplicate coordinate to collapse to volume 2, got ${totalVolume}`);
  });

  // ============================================================================
  // SUITE 2: INSTANT PALETTE SWAPPER ADVERSARIAL MATRIX
  // ============================================================================
  console.log('\n--- SUITE 2: Instant Palette Swapper Matrix & State Preservation ---');

  // T2.1: Full Block-State Property Preservation
  test('T2.1: swapMaterial preserves 100% of complex blockstate properties across material swaps', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'spruce_stairs[facing=south,half=top,shape=outer_right,waterlogged=true]');
    canvas.set(1, 0, 0, 'spruce_door[facing=east,half=lower,hinge=right,open=true,powered=true]');
    canvas.set(2, 0, 0, 'spruce_log[axis=z]');
    canvas.set(3, 0, 0, 'spruce_slab[type=top,waterlogged=false]');

    const count = swapMaterial(canvas, 'spruce', 'birch', true);
    assert.strictEqual(count, 4, `Expected 4 blocks swapped, got ${count}`);

    const stair = canvas.get(0, 0, 0);
    assert.strictEqual(stair.name, 'birch_stairs');
    assert.strictEqual(stair.properties.facing, 'south');
    assert.strictEqual(stair.properties.half, 'top');
    assert.strictEqual(stair.properties.shape, 'outer_right');
    assert.strictEqual(stair.properties.waterlogged, 'true');

    const door = canvas.get(1, 0, 0);
    assert.strictEqual(door.name, 'birch_door');
    assert.strictEqual(door.properties.facing, 'east');
    assert.strictEqual(door.properties.half, 'lower');
    assert.strictEqual(door.properties.hinge, 'right');
    assert.strictEqual(door.properties.open, 'true');
    assert.strictEqual(door.properties.powered, 'true');

    const log = canvas.get(2, 0, 0);
    assert.strictEqual(log.name, 'birch_log');
    assert.strictEqual(log.properties.axis, 'z');

    const slab = canvas.get(3, 0, 0);
    assert.strictEqual(slab.name, 'birch_slab');
    assert.strictEqual(slab.properties.type, 'top');
    assert.strictEqual(slab.properties.waterlogged, 'false');
  });

  // T2.2: Oak vs Dark Oak Substring Collision Adversarial Test
  test('T2.2: Swapping oak to spruce does NOT corrupt dark_oak blocks', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'oak_planks');
    canvas.set(1, 0, 0, 'dark_oak_planks');
    canvas.set(2, 0, 0, 'stripped_oak_log');
    canvas.set(3, 0, 0, 'stripped_dark_oak_log');

    // Swap oak -> acacia
    const count = swapMaterial(canvas, 'oak', 'acacia', true);
    assert.strictEqual(count, 2, `Expected only 2 oak blocks swapped, got ${count}`);

    assert.strictEqual(canvas.get(0, 0, 0).name, 'acacia_planks');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'dark_oak_planks', 'dark_oak_planks was falsely modified!');
    assert.strictEqual(canvas.get(2, 0, 0).name, 'stripped_acacia_log');
    assert.strictEqual(canvas.get(3, 0, 0).name, 'stripped_dark_oak_log', 'stripped_dark_oak_log was falsely modified!');
  });

  // T2.3: Dark Oak to Oak Swap
  test('T2.3: Swapping dark_oak to oak works cleanly without regex corruption', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'dark_oak_planks');
    canvas.set(1, 0, 0, 'dark_oak_stairs[facing=west]');
    canvas.set(2, 0, 0, 'stripped_dark_oak_log[axis=x]');

    const count = swapMaterial(canvas, 'dark_oak', 'oak', true);
    assert.strictEqual(count, 3, `Expected 3 dark_oak blocks swapped, got ${count}`);
    assert.strictEqual(canvas.get(0, 0, 0).name, 'oak_planks');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'oak_stairs');
    assert.strictEqual(canvas.get(1, 0, 0).properties.facing, 'west');
    assert.strictEqual(canvas.get(2, 0, 0).name, 'stripped_oak_log');
    assert.strictEqual(canvas.get(2, 0, 0).properties.axis, 'x');
  });

  // T2.4: Stone Family Cross-Role Swapping Matrix
  test('T2.4: Stone family swap accurately maps all 4 structural roles (base, stair, slab, wall)', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'cobblestone');
    canvas.set(1, 0, 0, 'cobblestone_stairs[facing=north]');
    canvas.set(2, 0, 0, 'cobblestone_slab[type=bottom]');
    canvas.set(3, 0, 0, 'cobblestone_wall[up=true]');

    const count = swapMaterial(canvas, 'cobblestone', 'deepslate_bricks', true);
    assert.strictEqual(count, 4, `Expected 4 stone family blocks swapped, got ${count}`);

    assert.strictEqual(canvas.get(0, 0, 0).name, 'deepslate_bricks');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'deepslate_brick_stairs');
    assert.strictEqual(canvas.get(1, 0, 0).properties.facing, 'north');
    assert.strictEqual(canvas.get(2, 0, 0).name, 'deepslate_brick_slab');
    assert.strictEqual(canvas.get(2, 0, 0).properties.type, 'bottom');
    assert.strictEqual(canvas.get(3, 0, 0).name, 'deepslate_brick_wall');
    assert.strictEqual(canvas.get(3, 0, 0).properties.up, 'true');
  });

  // T2.5: Explicit Target Property Overrides
  test('T2.5: Explicit bracketed properties in toBlock override target block properties', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'stone[axis=y]');
    const count = swapMaterial(canvas, 'stone', 'basalt[axis=z]', false);
    assert.strictEqual(count, 1);
    const b = canvas.get(0, 0, 0);
    assert.strictEqual(b.name, 'basalt');
    assert.strictEqual(b.properties.axis, 'z', 'Explicit property override failed');
  });

  // T2.6: Boundary & Zero Cases
  test('T2.6: Boundary cases (identical from/to, empty canvas, unknown blocks, nulls)', () => {
    const canvas = new VoxelCanvas(5, 5, 5);
    canvas.set(1, 1, 1, 'stone');
    assert.strictEqual(swapMaterial(canvas, 'stone', 'stone'), 0, 'Identical from/to should return 0');
    assert.strictEqual(swapMaterial(canvas, null, 'stone'), 0, 'Null fromBlock should return 0');
    assert.strictEqual(swapMaterial(canvas, 'stone', undefined), 0, 'Undefined toBlock should return 0');
    assert.strictEqual(swapMaterial(canvas, '', ''), 0, 'Empty string should return 0');
    assert.strictEqual(swapMaterial(canvas, 'non_existent_material', 'diamond_block'), 0, 'Missing material returns 0');

    // Unknown modded block direct swap
    canvas.set(2, 2, 2, 'tech_mod:quantum_casing');
    const swappedMod = swapMaterial(canvas, 'tech_mod:quantum_casing', 'tech_mod:plasma_casing', false);
    assert.strictEqual(swappedMod, 1);
    assert.strictEqual(canvas.get(2, 2, 2).name, 'tech_mod:plasma_casing');
  });

  // T2.7: SubRegionProxy Palette Swap Isolation
  test('T2.7: SubRegionProxy isolates swapMaterial strictly to selection bounds', () => {
    const baseCanvas = new VoxelCanvas(10, 10, 10);
    baseCanvas.set(1, 1, 1, 'oak_planks'); // Outside box
    baseCanvas.set(5, 5, 5, 'oak_planks'); // Inside box
    const proxy = baseCanvas.createSubRegionProxy({ minX: 4, minY: 4, minZ: 4, maxX: 6, maxY: 6, maxZ: 6 });

    const count = proxy.swapMaterial('oak_planks', 'spruce_planks', false);
    assert.strictEqual(count, 1, 'Only 1 block inside proxy selection box swapped');
    assert.strictEqual(baseCanvas.get(5, 5, 5).name, 'spruce_planks', 'Inside block swapped to spruce');
    assert.strictEqual(baseCanvas.get(1, 1, 1).name, 'oak_planks', 'Outside block remained oak');
  });

  // ============================================================================
  // SUITE 3: INCREMENTAL CANVAS DIFF CORRECTNESS
  // ============================================================================
  console.log('\n--- SUITE 3: Incremental Canvas Diff Correctness ---');

  // T3.1: Identical Canvases
  test('T3.1: Identical canvases yield strictly empty diff array', () => {
    const c1 = new VoxelCanvas(8, 8, 8);
    c1.set(1, 1, 1, 'stone_bricks');
    c1.set(2, 2, 2, 'oak_stairs[facing=east]');

    const c2 = new VoxelCanvas(8, 8, 8);
    c2.set(1, 1, 1, 'stone_bricks');
    c2.set(2, 2, 2, 'oak_stairs[facing=east]');

    const diff = computeDiff(c1, c2);
    assert.strictEqual(diff.length, 0, `Expected 0 diffs, got ${diff.length}`);
  });

  // T3.2: Null / Undefined Canvas Handling
  test('T3.2: Handles null/undefined canvases gracefully for initial build or total demolition', () => {
    const canvas = new VoxelCanvas(4, 4, 4);
    canvas.set(0, 0, 0, 'stone');
    canvas.set(1, 0, 0, 'dirt');

    // Initial build: previousCanvas is null
    const diffInitial = computeDiff(null, canvas);
    assert.strictEqual(diffInitial.length, 2);
    assert(diffInitial.every(d => d.action === 'set'), 'All actions must be set');

    // Demolition: newCanvas is null
    const diffDemolish = computeDiff(canvas, null);
    assert.strictEqual(diffDemolish.length, 2);
    assert(diffDemolish.every(d => d.action === 'remove' && d.fullBlockString === 'air'), 'All actions must be remove/air');

    // Both null
    const diffEmpty = computeDiff(null, null);
    assert.strictEqual(diffEmpty.length, 0);
  });

  // T3.3: Property-Only Modifications
  test('T3.3: Diff correctly detects property-only modifications (same name, changed facing)', () => {
    const c1 = new VoxelCanvas(4, 4, 4);
    c1.set(1, 1, 1, 'oak_stairs[facing=north]');

    const c2 = new VoxelCanvas(4, 4, 4);
    c2.set(1, 1, 1, 'oak_stairs[facing=south]');

    const diff = computeDiff(c1, c2);
    assert.strictEqual(diff.length, 1, `Expected 1 modification, got ${diff.length}`);
    assert.strictEqual(diff[0].action, 'set');
    assert.strictEqual(diff[0].fullBlockString, 'oak_stairs[facing=south]');
    assert.strictEqual(diff[0].x, 1);
    assert.strictEqual(diff[0].y, 1);
    assert.strictEqual(diff[0].z, 1);
  });

  // T3.4: Mixed High-Churn Stress (Additions, Removals, Replacements, Untouched)
  test('T3.4: Mixed high-churn diff correctly partitions added, removed, and modified voxels', () => {
    const c1 = new VoxelCanvas(20, 20, 20);
    const c2 = new VoxelCanvas(20, 20, 20);

    // 20 unchanged blocks
    for (let i = 0; i < 20; i++) {
      c1.set(i, 0, 0, 'stone');
      c2.set(i, 0, 0, 'stone');
    }

    // 15 removed blocks (in c1 only)
    for (let i = 0; i < 15; i++) {
      c1.set(i, 1, 0, 'dirt');
    }

    // 10 added blocks (in c2 only)
    for (let i = 0; i < 10; i++) {
      c2.set(i, 2, 0, 'glass');
    }

    // 5 modified blocks (material swap at same pos)
    for (let i = 0; i < 5; i++) {
      c1.set(i, 3, 0, 'cobblestone');
      c2.set(i, 3, 0, 'iron_block');
    }

    const diff = computeDiff(c1, c2);
    // Expected: 15 remove + 10 added (set) + 5 modified (set) = 30 diff actions
    assert.strictEqual(diff.length, 30, `Expected 30 diff actions, got ${diff.length}`);

    const removes = diff.filter(d => d.action === 'remove');
    const sets = diff.filter(d => d.action === 'set');
    assert.strictEqual(removes.length, 15, `Expected 15 removes, got ${removes.length}`);
    assert.strictEqual(sets.length, 15, `Expected 15 sets (10 new + 5 mod), got ${sets.length}`);

    // Verify unchanged blocks are NOT in diff
    for (let i = 0; i < 20; i++) {
      const found = diff.find(d => d.x === i && d.y === 0 && d.z === 0);
      assert(!found, `Unchanged block at (${i},0,0) falsely included in diff`);
    }
  });

  // T3.5: Immutability invariant
  test('T3.5: computeDiff does not mutate inputs', () => {
    const c1 = new VoxelCanvas(5, 5, 5);
    c1.set(1, 1, 1, 'stone');
    const c2 = new VoxelCanvas(5, 5, 5);
    c2.set(1, 1, 1, 'dirt');

    const c1KeysBefore = c1.getAllBlockKeys().sort();
    const c2KeysBefore = c2.getAllBlockKeys().sort();

    computeDiff(c1, c2);

    assert.deepStrictEqual(c1.getAllBlockKeys().sort(), c1KeysBefore);
    assert.deepStrictEqual(c2.getAllBlockKeys().sort(), c2KeysBefore);
    assert.strictEqual(c1.get(1, 1, 1).name, 'stone');
    assert.strictEqual(c2.get(1, 1, 1).name, 'dirt');
  });

  // ============================================================================
  // SUITE 4: SCHEMATIC FORMATS & SCHEMATIC MANAGER
  // ============================================================================
  console.log('\n--- SUITE 4: Schematic Formats & Dispatcher Integration ---');

  // Ensure test fixture output dir exists
  if (!fs.existsSync('test/fixtures')) {
    fs.mkdirSync('test/fixtures', { recursive: true });
  }

  // T4.1: Sponge Format Roundtrip
  await testAsync('T4.1: Sponge .schem format roundtrip export and parse with blockstates', async () => {
    const srcCanvas = new VoxelCanvas(6, 6, 6);
    srcCanvas.set(0, 0, 0, 'stone_bricks');
    srcCanvas.set(1, 1, 1, 'oak_stairs[facing=south,half=bottom,shape=straight]');
    srcCanvas.set(2, 2, 2, 'spruce_log[axis=y]');

    const buffer = await exportSpongeSchematic(srcCanvas, 'challenger_test_sponge', 'test/fixtures');
    assert(Buffer.isBuffer(buffer) && buffer.length > 0, 'Failed to produce Sponge buffer');

    const loadedCanvas = await parseSpongeSchematic(buffer, '1.20.4');
    assert(loadedCanvas.blocks.size >= 3, `Expected at least 3 blocks, got ${loadedCanvas.blocks.size}`);

    const b0 = loadedCanvas.get(0, 0, 0);
    assert.strictEqual(b0?.name, 'stone_bricks');

    const b1 = loadedCanvas.get(1, 1, 1);
    assert.strictEqual(b1?.name, 'oak_stairs');
    assert.strictEqual(b1?.properties.facing, 'south');

    const b2 = loadedCanvas.get(2, 2, 2);
    assert.strictEqual(b2?.name, 'spruce_log');
    assert.strictEqual(b2?.properties.axis, 'y');
  });

  // T4.2: NBT Structure Format Roundtrip
  await testAsync('T4.2: NBT Structure .nbt format roundtrip export and parse with properties', async () => {
    const srcCanvas = new VoxelCanvas(5, 5, 5);
    srcCanvas.set(1, 0, 1, 'deepslate_tiles');
    srcCanvas.set(2, 1, 2, 'dark_oak_stairs[facing=west,half=top]');

    const buffer = await exportNbtStructure(srcCanvas, 'challenger_test_nbt', 'test/fixtures');
    assert(Buffer.isBuffer(buffer) && buffer.length > 0, 'Failed to produce NBT buffer');

    const loadedCanvas = await parseNbtStructure(buffer);
    assert.strictEqual(loadedCanvas.blocks.size, 2, `Expected 2 blocks, got ${loadedCanvas.blocks.size}`);

    // Bounds minX=1, minY=0, minZ=1: relative pos
    const b1 = loadedCanvas.get(0, 0, 0);
    assert.strictEqual(b1?.name, 'deepslate_tiles');

    const b2 = loadedCanvas.get(1, 1, 1);
    assert.strictEqual(b2?.name, 'dark_oak_stairs');
    assert.strictEqual(b2?.properties.facing, 'west');
    assert.strictEqual(b2?.properties.half, 'top');
  });

  // T4.3: Litematica 64-Bit UInt Unpacking Stress with Multi-Boundary Spanning (3-bit & 5-bit)
  await testAsync('T4.3: Litematica 64-bit UInt unpacking stress with multi-boundary spanning (3-bit and 5-bit)', async () => {
    // 1. Test 3-bit packing across 64-bit boundaries (5 palette entries -> bitsPerBlock = 3)
    const absX = 4, absY = 4, absZ = 4;
    const volume = absX * absY * absZ; // 64 blocks
    const bitsPerBlock3 = 3;
    const indices3 = new Array(volume).fill(0);

    indices3[0] = 1;  // stone at index 0 (lx=0, ly=0, lz=0)
    indices3[12] = 2; // gold_block at index 12 (lx=0, lz=3, ly=0)
    indices3[21] = 3; // diamond_block at index 21 (offset 21*3 = 63, spans long 0 into long 1!) (lx=1, lz=1, ly=1)
    indices3[63] = 4; // emerald_block at index 63 (lx=3, lz=3, ly=3)

    const numLongs3 = Math.ceil((volume * bitsPerBlock3) / 64);
    const uLongs3 = new Array(numLongs3).fill(0n);
    for (let i = 0; i < volume; i++) {
      const val = BigInt(indices3[i]);
      const startBit = BigInt(i * bitsPerBlock3);
      const startLong = Number(startBit / 64n);
      const endLong = Number((startBit + BigInt(bitsPerBlock3) - 1n) / 64n);
      const bitOffset = startBit % 64n;

      if (startLong === endLong) {
        uLongs3[startLong] |= (val << bitOffset);
      } else {
        const bitsInFirst = 64n - bitOffset;
        const maskFirst = (1n << bitsInFirst) - 1n;
        uLongs3[startLong] |= ((val & maskFirst) << bitOffset);
        uLongs3[endLong] |= (val >> bitsInFirst);
      }
    }

    const litematicNbt3 = {
      type: 'compound',
      name: '',
      value: {
        Version: { type: 'int', value: 5 },
        Regions: {
          type: 'compound',
          value: {
            MainRegion: {
              type: 'compound',
              value: {
                Position: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
                Size: { type: 'compound', value: { x: { type: 'int', value: absX }, y: { type: 'int', value: absY }, z: { type: 'int', value: absZ } } },
                BlockStatePalette: {
                  type: 'list',
                  value: {
                    type: 'compound',
                    value: [
                      { Name: { type: 'string', value: 'minecraft:air' } },
                      { Name: { type: 'string', value: 'minecraft:stone' } },
                      { Name: { type: 'string', value: 'minecraft:gold_block' } },
                      { Name: { type: 'string', value: 'minecraft:diamond_block' } },
                      { Name: { type: 'string', value: 'minecraft:emerald_block' } }
                    ]
                  }
                },
                BlockStates: {
                  type: 'longArray',
                  value: uLongs3.map(ul => BigInt.asIntN(64, ul))
                }
              }
            }
          }
        }
      }
    };

    const gzipped3 = zlib.gzipSync(nbt.writeUncompressed(litematicNbt3));
    const canvas3 = await parseLitematic(gzipped3);

    assert.strictEqual(canvas3.blocks.size, 4, `Expected 4 blocks unpacked, got ${canvas3.blocks.size}`);
    assert.strictEqual(canvas3.get(0, 0, 0)?.name, 'stone', 'Index 0 (stone) unpacked properly');
    assert.strictEqual(canvas3.get(0, 0, 3)?.name, 'gold_block', 'Index 12 (gold_block) unpacked properly');
    assert.strictEqual(canvas3.get(1, 1, 1)?.name, 'diamond_block', 'Index 21 (diamond_block spanning 64-bit boundary) unpacked');
    assert.strictEqual(canvas3.get(3, 3, 3)?.name, 'emerald_block', 'Index 63 (emerald_block) unpacked');

    // 2. Test 5-bit packing across 64-bit boundaries (20 palette entries -> bitsPerBlock = 5)
    const palette5 = [{ Name: { type: 'string', value: 'minecraft:air' } }];
    for (let i = 1; i <= 20; i++) {
      palette5.push({ Name: { type: 'string', value: `minecraft:test_block_${i}` } });
    }

    const bitsPerBlock5 = 5;
    const indices5 = new Array(volume).fill(0);
    indices5[0] = 1;
    indices5[12] = 2;   // offset 60..64 in long 0
    indices5[13] = 17;  // offset 65..69 in long 1
    indices5[25] = 19;  // offset 125, spans long 1 (bits 61..63) and long 2 (bits 0..1)!

    const numLongs5 = Math.ceil((volume * bitsPerBlock5) / 64);
    const uLongs5 = new Array(numLongs5).fill(0n);
    for (let i = 0; i < volume; i++) {
      const val = BigInt(indices5[i]);
      const startBit = BigInt(i * bitsPerBlock5);
      const startLong = Number(startBit / 64n);
      const endLong = Number((startBit + BigInt(bitsPerBlock5) - 1n) / 64n);
      const bitOffset = startBit % 64n;

      if (startLong === endLong) {
        uLongs5[startLong] |= (val << bitOffset);
      } else {
        const bitsInFirst = 64n - bitOffset;
        const maskFirst = (1n << bitsInFirst) - 1n;
        uLongs5[startLong] |= ((val & maskFirst) << bitOffset);
        uLongs5[endLong] |= (val >> bitsInFirst);
      }
    }

    const litematicNbt5 = {
      type: 'compound',
      name: '',
      value: {
        Version: { type: 'int', value: 5 },
        Regions: {
          type: 'compound',
          value: {
            MainRegion: {
              type: 'compound',
              value: {
                Position: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
                Size: { type: 'compound', value: { x: { type: 'int', value: absX }, y: { type: 'int', value: absY }, z: { type: 'int', value: absZ } } },
                BlockStatePalette: { type: 'list', value: { type: 'compound', value: palette5 } },
                BlockStates: { type: 'longArray', value: uLongs5.map(ul => BigInt.asIntN(64, ul)) }
              }
            }
          }
        }
      }
    };

    const gzipped5 = zlib.gzipSync(nbt.writeUncompressed(litematicNbt5));
    const canvas5 = await parseLitematic(gzipped5);
    assert.strictEqual(canvas5.blocks.size, 4, `Expected 4 blocks in 5-bit unpacked, got ${canvas5.blocks.size}`);
    assert.strictEqual(canvas5.get(0, 0, 0)?.name, 'test_block_1');
    assert.strictEqual(canvas5.get(0, 0, 3)?.name, 'test_block_2');
    assert.strictEqual(canvas5.get(1, 0, 3)?.name, 'test_block_17');
    assert.strictEqual(canvas5.get(1, 1, 2)?.name, 'test_block_19');
  });

  // T4.4: Litematica Negative Sizes & Multiple Regions Handling
  await testAsync('T4.4: Litematica negative coordinate offsets and multi-region bounding box calculation', async () => {
    const litematicNbt = {
      type: 'compound',
      name: '',
      value: {
        Version: { type: 'int', value: 5 },
        Regions: {
          type: 'compound',
          value: {
            RegionA: {
              type: 'compound',
              value: {
                Position: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
                Size: { type: 'compound', value: { x: { type: 'int', value: 2 }, y: { type: 'int', value: 2 }, z: { type: 'int', value: 2 } } },
                BlockStatePalette: {
                  type: 'list',
                  value: {
                    type: 'compound',
                    value: [
                      { Name: { type: 'string', value: 'minecraft:obsidian' } }
                    ]
                  }
                },
                BlockStates: { type: 'longArray', value: [[0, 0]] }
              }
            },
            RegionNegative: {
              type: 'compound',
              value: {
                // Negative size: Size.x = -2, starts at pos 10, stretches back to 9
                Position: { type: 'compound', value: { x: { type: 'int', value: 10 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
                Size: { type: 'compound', value: { x: { type: 'int', value: -2 }, y: { type: 'int', value: 1 }, z: { type: 'int', value: 1 } } },
                BlockStatePalette: {
                  type: 'list',
                  value: {
                    type: 'compound',
                    value: [
                      { Name: { type: 'string', value: 'minecraft:glowstone' } }
                    ]
                  }
                },
                BlockStates: { type: 'longArray', value: [[0, 0]] }
              }
            }
          }
        }
      }
    };

    const gzipped = zlib.gzipSync(nbt.writeUncompressed(litematicNbt));
    const canvas = await parseLitematic(gzipped);
    assert(canvas.blocks.size > 0, 'Multi-region canvas populated');
    const bounds = canvas.getBounds();
    assert(bounds.width >= 11, `Expected merged multi-region width >= 11, got ${bounds.width}`);
  });

  // T4.5: Corrupt Buffer Resilience
  await testAsync('T4.5: Corrupt buffer inputs are rejected with handled exceptions', async () => {
    const corruptBuffer = Buffer.from('THIS IS INVALID CORRUPT BINARY DATA 123456');

    let spongeThrew = false;
    try {
      await parseSpongeSchematic(corruptBuffer);
    } catch {
      spongeThrew = true;
    }
    assert(spongeThrew, 'parseSpongeSchematic must reject corrupt buffers');

    let nbtThrew = false;
    try {
      await parseNbtStructure(corruptBuffer);
    } catch {
      nbtThrew = true;
    }
    assert(nbtThrew, 'parseNbtStructure must reject corrupt buffers');

    let litematicThrew = false;
    try {
      await parseLitematic(corruptBuffer);
    } catch {
      litematicThrew = true;
    }
    assert(litematicThrew, 'parseLitematic must reject corrupt buffers');
  });

  // T4.6: SchematicManager Dispatcher Routing
  await testAsync('T4.6: SchematicManager routes extensions correctly and rejects unsupported formats', async () => {
    const mgr = new SchematicManager();
    const dummyBuf = Buffer.from('dummy');

    // Unsupported extension
    let unsupportedThrew = false;
    try {
      await mgr.loadIntoCanvas(dummyBuf, 'model.obj');
    } catch (err) {
      unsupportedThrew = true;
      assert(err.message.includes('Nicht unterstütztes Schematic-Dateiformat'), `Unexpected error msg: ${err.message}`);
    }
    assert(unsupportedThrew, 'SchematicManager must reject .obj extension');

    // Supported extensions dispatch check
    let zipThrew = false;
    try {
      await mgr.loadIntoCanvas(dummyBuf, 'archive.zip');
    } catch {
      zipThrew = true;
    }
    assert(zipThrew, 'SchematicManager must reject .zip extension');
  });

  // T4.7: Empty Canvas Schematic Export & Readback
  await testAsync('T4.7: Empty canvas export produces valid 1x1x1 empty schematic structure without crashing', async () => {
    const emptyCanvas = new VoxelCanvas(10, 10, 10);
    const spongeBuf = await exportSpongeSchematic(emptyCanvas, 'challenger_test_empty_sponge', 'test/fixtures');
    assert(Buffer.isBuffer(spongeBuf) && spongeBuf.length > 0, 'Sponge exported empty canvas');
    const readbackSponge = await parseSpongeSchematic(spongeBuf, '1.20.4');
    assert.strictEqual(readbackSponge.blocks.size, 0, 'Readback sponge of empty canvas has 0 blocks');

    const nbtBuf = await exportNbtStructure(emptyCanvas, 'challenger_test_empty_nbt', 'test/fixtures');
    assert(Buffer.isBuffer(nbtBuf) && nbtBuf.length > 0, 'NBT exported empty canvas');
    const readbackNbt = await parseNbtStructure(nbtBuf);
    assert.strictEqual(readbackNbt.blocks.size, 0, 'Readback NBT of empty canvas has 0 blocks');
  });

  // ============================================================================
  // SUMMARY & VERDICT
  // ============================================================================
  console.log('\n================================================================');
  console.log(`  CHALLENGER RESULTS: ${passedTests} / ${totalTests} PASSED`);
  if (findings.length > 0) {
    console.log(`  FAILURES / FINDINGS: ${findings.length}`);
    for (const f of findings) {
      console.log(`   - [FAIL] ${f.name}: ${f.error}`);
    }
    console.log('  VERDICT: REQUEST_CHANGES');
  } else {
    console.log('  VERDICT: APPROVE');
  }
  console.log('================================================================\n');

  if (findings.length > 0) {
    process.exit(1);
  }
}

runAdversarialSuite();
