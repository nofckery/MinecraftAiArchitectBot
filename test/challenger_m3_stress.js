/**
 * EMPIRICAL CHALLENGER STRESS HARNESS — Milestone M3
 *
 * Exhaustively stress-tests:
 * 1. Canonical Exports & Decoupling (voxelCanvas & credentialVault)
 * 2. GreedyMesher: Volume conservation oracle, non-overlapping oracle, property-isolation oracle, negative coordinates
 * 3. PaletteSwapper: Oak vs Dark Oak collision stress, stone family preservation, property retention, SubRegionProxy isolation
 * 4. CanvasDiff: Mathematical reversibility oracle (CanvasA + diff(A, B) === CanvasB)
 * 5. BlockAliases: Robust normalization fuzzing
 * 6. CredentialVault: Concurrency stress (200 ops), tamper oracle, absence of deprecated re-exports
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// 1. Imports from canonical modules
import { computeGreedyBoxes, toBlockString } from '../src/builder/greedyMesher.js';
import { BLOCK_ALIASES, normalizeBlockName } from '../src/builder/blockAliases.js';
import { swapMaterial, WOOD_TYPES, STONE_FAMILIES } from '../src/builder/paletteSwapper.js';
import { computeDiff } from '../src/builder/canvasDiff.js';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { CredentialVault, getSystemMasterKey } from '../src/security/credentialVault.js';

let passed = 0;
let total = 0;

function pass(testName) {
  total++;
  passed++;
  console.log(`  [PASS] ${testName}`);
}

function fail(testName, err) {
  total++;
  console.error(`  [FAIL] ${testName}:`, err.message);
  throw err;
}

function runSync(name, fn) {
  try {
    fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (err) {
    fail(name, err);
  }
}

async function main() {
  console.log('=== EMPIRICAL CHALLENGER STRESS HARNESS (M3) ===\n');

  // =========================================================================
  // Section 1: Canonical Module Exports & Absence of Deprecated Re-exports
  // =========================================================================
  console.log('--- Section 1: Canonical Module Boundaries & Deprecation Audit ---');

  runSync('1.1 voxelCanvas.js must NOT re-export internal builder utilities', async () => {
    const vcModule = await import('../src/builder/voxelCanvas.js');
    const forbidden = [
      'BLOCK_ALIASES',
      'normalizeBlockName',
      'levenshteinDistance',
      'swapMaterial',
      'computeDiff'
    ];
    for (const exp of forbidden) {
      assert.strictEqual(vcModule[exp], undefined, `voxelCanvas.js should NOT export ${exp}`);
    }
  });

  runSync('1.2 credentialVault.js must NOT re-export atomicRenameWithRetry', async () => {
    const cvModule = await import('../src/security/credentialVault.js');
    assert.strictEqual(cvModule.atomicRenameWithRetry, undefined,
      'credentialVault.js must NOT re-export atomicRenameWithRetry'
    );
  });

  runSync('1.3 Canonical modules export required functions with correct arities', () => {
    assert.strictEqual(typeof computeGreedyBoxes, 'function');
    assert.strictEqual(typeof toBlockString, 'function');
    assert.strictEqual(typeof BLOCK_ALIASES, 'object');
    assert.strictEqual(typeof normalizeBlockName, 'function');
    assert.strictEqual(typeof swapMaterial, 'function');
    assert.strictEqual(typeof computeDiff, 'function');
    assert.strictEqual(typeof CredentialVault, 'function');
  });

  // =========================================================================
  // Section 2: GreedyMesher Stress & Mathematical Invariants
  // =========================================================================
  console.log('\n--- Section 2: GreedyMesher Stress & Invariant Oracles ---');

  runSync('2.1 Volume Conservation Oracle: 50x10x10 complex geometry', () => {
    const canvas = new VoxelCanvas(60, 20, 20);
    let expectedVolume = 0;

    // Build solid base
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 5; y++) {
        for (let z = 0; z < 10; z++) {
          canvas.set(x, y, z, 'stone');
          expectedVolume++;
        }
      }
    }

    // Build stepped pyramid on top
    for (let layer = 0; layer < 4; layer++) {
      for (let x = layer; x < 15 - layer; x++) {
        for (let z = layer; z < 8 - layer; z++) {
          canvas.set(x, 5 + layer, z, 'oak_planks');
          expectedVolume++;
        }
      }
    }

    // Disconnected scattered voxels
    for (let i = 0; i < 30; i++) {
      canvas.set(30 + i, 10, i % 5, 'gold_block');
      expectedVolume++;
    }

    const boxes = canvas.computeGreedyBoxes();
    const actualVolume = boxes.reduce((acc, box) => acc + box.volume, 0);

    assert.strictEqual(actualVolume, expectedVolume,
      `Greedy meshing violated volume conservation: expected ${expectedVolume}, got ${actualVolume}`
    );
    assert.ok(boxes.length < expectedVolume * 0.4,
      `Greedy meshing compression was too low: ${boxes.length} boxes for ${expectedVolume} blocks`
    );
  });

  runSync('2.2 Non-Overlapping Voxel Oracle: Every voxel in exactly one box', () => {
    const canvas = new VoxelCanvas(30, 30, 30);
    // Hollow cube with pillars
    canvas.box(2, 2, 2, 12, 12, 12, 'stone_bricks', true);
    // Pillar in center
    for (let y = 2; y <= 12; y++) {
      canvas.set(7, y, 7, 'stone_bricks');
    }

    const boxes = canvas.computeGreedyBoxes();
    const hitMap = new Map();

    for (const box of boxes) {
      for (let x = box.minX; x <= box.maxX; x++) {
        for (let y = box.minY; y <= box.maxY; y++) {
          for (let z = box.minZ; z <= box.maxZ; z++) {
            const k = `${x},${y},${z}`;
            const count = (hitMap.get(k) || 0) + 1;
            hitMap.set(k, count);
            assert.strictEqual(count, 1, `Voxel at ${k} covered more than once! Overlapping box found!`);
          }
        }
      }
    }

    // Every block in canvas must be in hitMap
    for (const key of canvas.getAllBlockKeys()) {
      assert.strictEqual(hitMap.get(key), 1, `Canvas block ${key} was missed by greedy mesher!`);
    }
  });

  runSync('2.3 Property-Isolation Oracle: Identical block names with distinct properties must NOT merge', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    // 4 stairs side-by-side with different facings
    canvas.set(0, 0, 0, 'oak_stairs[facing=north,half=bottom]');
    canvas.set(1, 0, 0, 'oak_stairs[facing=south,half=bottom]');
    canvas.set(2, 0, 0, 'oak_stairs[facing=north,half=top]');
    canvas.set(3, 0, 0, 'oak_stairs[facing=north,half=bottom]');

    const boxes = canvas.computeGreedyBoxes();
    // Voxel (0,0,0) and (3,0,0) have identical properties, but are separated by (1,0,0) and (2,0,0)
    // Thus all 4 MUST be separate 1x1x1 boxes!
    assert.strictEqual(boxes.length, 4,
      `Expected 4 distinct boxes for differing properties, got ${boxes.length}`
    );
    for (const box of boxes) {
      assert.strictEqual(box.volume, 1);
    }
  });

  runSync('2.4 Negative Coordinates & Disjoint Regions', () => {
    const rawBlocks = [
      { x: -50, y: -20, z: -10, blockState: { name: 'cobblestone', properties: {} }, fullBlockString: 'cobblestone' },
      { x: -49, y: -20, z: -10, blockState: { name: 'cobblestone', properties: {} }, fullBlockString: 'cobblestone' },
      { x: -50, y: -20, z: -9, blockState: { name: 'cobblestone', properties: {} }, fullBlockString: 'cobblestone' },
      { x: -49, y: -20, z: -9, blockState: { name: 'cobblestone', properties: {} }, fullBlockString: 'cobblestone' },
      { x: 100, y: 50, z: 200, blockState: { name: 'cobblestone', properties: {} }, fullBlockString: 'cobblestone' }
    ];

    const boxes = computeGreedyBoxes(rawBlocks);
    assert.strictEqual(boxes.length, 2, 'Should create 2 boxes: 2x1x2 at negative coords, and 1x1x1 at positive');
    const negBox = boxes.find(b => b.minX === -50);
    assert.ok(negBox, 'Negative coordinate box must exist');
    assert.strictEqual(negBox.volume, 4);
    assert.strictEqual(negBox.maxX, -49);
    assert.strictEqual(negBox.maxZ, -9);
  });

  runSync('2.5 Empty and Null Input Handling', () => {
    assert.deepStrictEqual(computeGreedyBoxes([]), []);
    assert.deepStrictEqual(computeGreedyBoxes(null), []);
    const emptyCanvas = new VoxelCanvas(10, 10, 10);
    assert.deepStrictEqual(emptyCanvas.computeGreedyBoxes(), []);
  });

  // =========================================================================
  // Section 3: PaletteSwapper & Material Intelligence
  // =========================================================================
  console.log('\n--- Section 3: PaletteSwapper Stress & Substring Collision Oracles ---');

  runSync('3.1 Substring Collision Isolation: Oak vs Dark Oak Collision Stress', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'oak_planks');
    canvas.set(1, 0, 0, 'dark_oak_planks');
    canvas.set(2, 0, 0, 'stripped_oak_log[axis=y]');
    canvas.set(3, 0, 0, 'stripped_dark_oak_log[axis=y]');
    canvas.set(4, 0, 0, 'oak_stairs[facing=east,half=bottom]');
    canvas.set(5, 0, 0, 'dark_oak_stairs[facing=east,half=bottom]');

    // Swap oak -> spruce (smartGroup = true)
    const count = swapMaterial(canvas, 'oak', 'spruce', true);
    assert.strictEqual(count, 3, 'Must swap exactly the 3 oak items, NOT dark_oak items');

    assert.strictEqual(canvas.get(0, 0, 0).name, 'spruce_planks');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'dark_oak_planks', 'dark_oak_planks MUST NOT be modified!');
    assert.strictEqual(canvas.get(2, 0, 0).name, 'stripped_spruce_log');
    assert.strictEqual(canvas.get(2, 0, 0).properties.axis, 'y');
    assert.strictEqual(canvas.get(3, 0, 0).name, 'stripped_dark_oak_log', 'stripped_dark_oak_log MUST NOT be modified!');
    assert.strictEqual(canvas.get(4, 0, 0).name, 'spruce_stairs');
    assert.strictEqual(canvas.get(4, 0, 0).properties.facing, 'east');
    assert.strictEqual(canvas.get(5, 0, 0).name, 'dark_oak_stairs', 'dark_oak_stairs MUST NOT be modified!');

    // Now swap dark_oak -> acacia
    const count2 = swapMaterial(canvas, 'dark_oak', 'acacia', true);
    assert.strictEqual(count2, 3, 'Must swap exactly the 3 dark_oak items');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'acacia_planks');
    assert.strictEqual(canvas.get(3, 0, 0).name, 'stripped_acacia_log');
    assert.strictEqual(canvas.get(5, 0, 0).name, 'acacia_stairs');
    assert.strictEqual(canvas.get(0, 0, 0).name, 'spruce_planks', 'spruce_planks must remain spruce');
  });

  runSync('3.2 Stone Family Cross-Category Preservation', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(0, 0, 0, 'stone_bricks');
    canvas.set(1, 0, 0, 'stone_brick_stairs[facing=north,shape=straight]');
    canvas.set(2, 0, 0, 'stone_brick_slab[type=bottom]');
    canvas.set(3, 0, 0, 'stone_brick_wall');

    // Swap stone_bricks -> deepslate_bricks
    const count = swapMaterial(canvas, 'stone_bricks', 'deepslate_bricks', true);
    assert.strictEqual(count, 4, 'All 4 stone family roles must be swapped');

    assert.strictEqual(canvas.get(0, 0, 0).name, 'deepslate_bricks');
    assert.strictEqual(canvas.get(1, 0, 0).name, 'deepslate_brick_stairs');
    assert.strictEqual(canvas.get(1, 0, 0).properties.facing, 'north');
    assert.strictEqual(canvas.get(1, 0, 0).properties.shape, 'straight');
    assert.strictEqual(canvas.get(2, 0, 0).name, 'deepslate_brick_slab');
    assert.strictEqual(canvas.get(2, 0, 0).properties.type, 'bottom');
    assert.strictEqual(canvas.get(3, 0, 0).name, 'deepslate_brick_wall');
  });

  runSync('3.3 SubRegionProxy Scoped Swap Oracle', () => {
    const canvas = new VoxelCanvas(20, 20, 20);
    // Fill two separate boxes with oak_planks
    for (let x = 0; x < 5; x++) {
      canvas.set(x, 0, 0, 'oak_planks');
    }
    for (let x = 10; x < 15; x++) {
      canvas.set(x, 0, 0, 'oak_planks');
    }

    // Create SubRegionProxy for x: 0..4
    const proxy = canvas.createSubRegionProxy({ minX: 0, maxX: 4, minY: 0, maxY: 1, minZ: 0, maxZ: 1 });
    const count = proxy.swapMaterial('oak_planks', 'birch_planks', false);
    assert.strictEqual(count, 5, 'Only 5 inside selection should be swapped');

    for (let x = 0; x < 5; x++) {
      assert.strictEqual(canvas.get(x, 0, 0).name, 'birch_planks');
    }
    for (let x = 10; x < 15; x++) {
      assert.strictEqual(canvas.get(x, 0, 0).name, 'oak_planks', 'Outside region must remain oak_planks');
    }
  });

  runSync('3.4 Edge Cases: Identical From/To, Null Inputs, Empty Canvas', () => {
    const canvas = new VoxelCanvas(5, 5, 5);
    canvas.set(0, 0, 0, 'stone');
    assert.strictEqual(swapMaterial(canvas, 'stone', 'stone'), 0);
    assert.strictEqual(swapMaterial(canvas, '', 'dirt'), 0);
    assert.strictEqual(swapMaterial(canvas, null, 'dirt'), 0);
    assert.strictEqual(swapMaterial(canvas, 'stone', null), 0);
  });

  // =========================================================================
  // Section 4: CanvasDiff Mathematical Reversibility Oracle
  // =========================================================================
  console.log('\n--- Section 4: CanvasDiff Mathematical Reversibility Oracle ---');

  runSync('4.1 Differential Oracle: Applying diff(A, B) to A produces exact copy of B', () => {
    const canvasA = new VoxelCanvas(20, 20, 20);
    const canvasB = new VoxelCanvas(20, 20, 20);

    // Initial state A
    for (let i = 0; i < 20; i++) {
      canvasA.set(i, 0, 0, 'stone');
      canvasA.set(0, i, 0, 'cobblestone');
      canvasA.set(0, 0, i, 'oak_planks');
    }

    // State B has: some shared, some modified, some deleted, some brand new
    // Shared:
    for (let i = 0; i < 10; i++) {
      canvasB.set(i, 0, 0, 'stone');
    }
    // Modified:
    for (let i = 10; i < 20; i++) {
      canvasB.set(i, 0, 0, 'smooth_stone[double=true]');
    }
    // Deleted: (0, i, 0) cobblestone is NOT in B
    // Changed property:
    canvasB.set(0, 0, 0, 'oak_stairs[facing=south]');
    // Brand new:
    for (let i = 0; i < 15; i++) {
      canvasB.set(5, 5, i, 'glass');
    }

    const diff = computeDiff(canvasA, canvasB);
    assert.ok(diff.length > 0, 'Diff must not be empty');

    // Clone A to verify applying diff
    const canvasAClone = new VoxelCanvas(20, 20, 20);
    for (const key of canvasA.getAllBlockKeys()) {
      const { x, y, z } = canvasA.parseKey(key);
      canvasAClone.set(x, y, z, canvasA.getByKey(key));
    }

    // Apply diff onto clone
    for (const op of diff) {
      if (op.action === 'remove') {
        canvasAClone.set(op.x, op.y, op.z, 'air');
      } else if (op.action === 'set') {
        canvasAClone.set(op.x, op.y, op.z, op.blockState);
      }
    }

    // Verify canvasAClone === canvasB in every voxel
    const keysB = new Set(canvasB.getAllBlockKeys());
    const keysClone = new Set(canvasAClone.getAllBlockKeys());

    assert.deepStrictEqual(keysClone, keysB, 'Reconstructed canvas keys do not match target keys');

    for (const key of keysB) {
      const bBlock = canvasB.getByKey(key);
      const cBlock = canvasAClone.getByKey(key);
      assert.strictEqual(toBlockString(cBlock), toBlockString(bBlock),
        `Mismatch at ${key}: got ${toBlockString(cBlock)}, expected ${toBlockString(bBlock)}`
      );
    }
  });

  runSync('4.2 Null and Empty previousCanvas Handling', () => {
    const canvas = new VoxelCanvas(10, 10, 10);
    canvas.set(1, 1, 1, 'diamond_block');
    canvas.set(2, 2, 2, 'gold_block');

    const diffFromNull = computeDiff(null, canvas);
    assert.strictEqual(diffFromNull.length, 2);
    assert(diffFromNull.every(d => d.action === 'set'));

    const diffToEmpty = computeDiff(canvas, new VoxelCanvas(10, 10, 10));
    assert.strictEqual(diffToEmpty.length, 2);
    assert(diffToEmpty.every(d => d.action === 'remove'));

    const diffIdentical = computeDiff(canvas, canvas);
    assert.strictEqual(diffIdentical.length, 0);
  });

  // =========================================================================
  // Section 5: BlockAliases Fuzzing & Stress
  // =========================================================================
  console.log('\n--- Section 5: BlockAliases Fuzzing & Stress ---');

  runSync('5.1 normalizeBlockName exhaustive aliases fuzzing', () => {
    for (const [alias, canonical] of Object.entries(BLOCK_ALIASES)) {
      const withPrefix = `minecraft:${alias}`;
      const withState = `minecraft:${alias}[facing=north,half=top]`;
      const withSpaces = `   ${alias}   `;

      assert.strictEqual(normalizeBlockName(alias), canonical);
      assert.strictEqual(normalizeBlockName(withPrefix), canonical);
      assert.strictEqual(normalizeBlockName(withState), canonical);
      assert.strictEqual(normalizeBlockName(withSpaces), canonical);
    }
  });

  runSync('5.2 normalizeBlockName adversarial corner cases', () => {
    assert.strictEqual(normalizeBlockName(null), '');
    assert.strictEqual(normalizeBlockName(undefined), '');
    assert.strictEqual(normalizeBlockName(''), '');
    assert.strictEqual(normalizeBlockName(12345), '');
    assert.strictEqual(normalizeBlockName({}), '');
    assert.strictEqual(normalizeBlockName('minecraft:'), '');
    assert.strictEqual(normalizeBlockName('[]'), '');
  });

  // =========================================================================
  // Section 6: CredentialVault Security, Concurrency & Atomic Recovery Stress
  // =========================================================================
  console.log('\n--- Section 6: CredentialVault Concurrency & Tamper Stress ---');

  const STRESS_VAULT_PATH = path.resolve('test', 'fixtures', 'challenger_m3_vault_stress.vault');

  try {
    if (fs.existsSync(STRESS_VAULT_PATH)) fs.unlinkSync(STRESS_VAULT_PATH);
  } catch (_) {}

  const stressVault = new CredentialVault({
    vaultPath: STRESS_VAULT_PATH,
    masterKey: 'challenger-empirical-vault-master-key-2026'
  });

  await runAsync('6.1 200 Concurrent Operations (Store, Overwrite, Delete, Get)', async () => {
    await stressVault.init();

    const tasks = [];
    // 100 stores
    for (let i = 0; i < 100; i++) {
      tasks.push(stressVault.storeSecret(`key_${i}`, `secret_val_${i}`));
    }
    // 50 overwrites
    for (let i = 0; i < 50; i++) {
      tasks.push(stressVault.storeSecret(`key_${i}`, {
        type: 'api_key',
        provider: `Provider_${i}`,
        token: `updated_token_${i}`,
        expiresAt: '2030-01-01T00:00:00.000Z'
      }));
    }
    // 25 deletes
    for (let i = 75; i < 100; i++) {
      tasks.push(stressVault.deleteSecret(`key_${i}`));
    }

    await Promise.all(tasks);

    // Verify resulting state
    const diskVault = new CredentialVault({
      vaultPath: STRESS_VAULT_PATH,
      masterKey: 'challenger-empirical-vault-master-key-2026'
    });
    await diskVault.init();

    // 0..49 must have updated tokens
    for (let i = 0; i < 50; i++) {
      const secret = await diskVault.getSecret(`key_${i}`);
      assert.strictEqual(secret, `updated_token_${i}`);
      const meta = await diskVault.getSecretMetadata(`key_${i}`);
      assert.strictEqual(meta.provider, `Provider_${i}`);
    }

    // 50..74 must have initial tokens
    for (let i = 50; i < 75; i++) {
      const secret = await diskVault.getSecret(`key_${i}`);
      assert.strictEqual(secret, `secret_val_${i}`);
    }

    // 75..99 must be deleted
    for (let i = 75; i < 100; i++) {
      const exists = await diskVault.hasSecret(`key_${i}`);
      assert.strictEqual(exists, false, `key_${i} was expected to be deleted`);
    }

    const allIds = await diskVault.listSecretIds();
    assert.strictEqual(allIds.length, 75, `Expected exactly 75 secrets remaining, got ${allIds.length}`);
  });

  await runAsync('6.2 Cryptographic Auth-Tag Tamper Detection Matrix', async () => {
    const raw = await fs.promises.readFile(STRESS_VAULT_PATH, 'utf8');
    const envelope = JSON.parse(raw);

    // Tamper 1: Salt modification
    const badSalt = { ...envelope, salt: 'a'.repeat(64) };
    assert.throws(() => stressVault.decrypt(badSalt), /Vault integrity check failed/i);

    // Tamper 2: IV modification
    const badIv = { ...envelope, iv: 'b'.repeat(24) };
    assert.throws(() => stressVault.decrypt(badIv), /Vault integrity check failed/i);

    // Tamper 3: Tag modification
    const badTag = { ...envelope, tag: 'c'.repeat(32) };
    assert.throws(() => stressVault.decrypt(badTag), /Vault integrity check failed/i);

    // Tamper 4: Ciphertext truncation
    const badCipher = { ...envelope, ciphertext: envelope.ciphertext.slice(0, 10) };
    assert.throws(() => stressVault.decrypt(badCipher), /Vault integrity check failed/i);
  });

  // Cleanup test vault
  try {
    if (fs.existsSync(STRESS_VAULT_PATH)) fs.unlinkSync(STRESS_VAULT_PATH);
  } catch (_) {}

  console.log(`\n=== ALL ${passed}/${total} EMPIRICAL CHALLENGER TESTS PASSED! ===\n`);
}

main().catch(err => {
  console.error('\n[FATAL] Challenger stress harness failed:', err);
  process.exit(1);
});
