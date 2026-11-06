import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  atomicRenameWithRetry,
  atomicWriteFileWithRetry,
  atomicRenameWithRetrySync,
  atomicWriteFileSyncWithRetry
} from '../src/utils/fileUtils.js';
import {
  getPathfinderGoals,
  createMovements,
  loadPathfinder
} from '../src/utils/pathfinderHelper.js';
import { levenshteinDistance } from '../src/utils/stringUtils.js';
import { BLOCK_ALIASES, normalizeBlockName } from '../src/builder/blockAliases.js';
import { computeGreedyBoxes, toBlockString } from '../src/builder/greedyMesher.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runTests() {
  console.log('=== STARTING SHARED CORE UTILITIES TEST SUITE ===\n');

  const testDir = path.resolve('test', 'fixtures', 'file_utils_test');
  await fs.promises.mkdir(testDir, { recursive: true });

  try {
    // 1. fileUtils tests
    console.log('--- Testgruppe 1: fileUtils (async & sync) ---');

    await testAsync('1.1 atomicWriteFileWithRetry erzeugt Datei asynchron mit Inhalt', async () => {
      const target = path.join(testDir, 'async_write.txt');
      await atomicWriteFileWithRetry(target, 'Hello async world', 'utf8');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'Hello async world');
    });

    await testAsync('1.2 atomicRenameWithRetry benennt Datei erfolgreich um', async () => {
      const src = path.join(testDir, 'rename_src.txt');
      const dst = path.join(testDir, 'rename_dst.txt');
      fs.writeFileSync(src, 'data-to-rename');
      await atomicRenameWithRetry(src, dst);
      assert.strictEqual(fs.existsSync(src), false);
      assert.strictEqual(fs.readFileSync(dst, 'utf8'), 'data-to-rename');
    });

    test('1.3 atomicWriteFileSyncWithRetry erzeugt Datei synchron mit Inhalt', () => {
      const target = path.join(testDir, 'sync_write.txt');
      atomicWriteFileSyncWithRetry(target, 'Hello sync world', 'utf8');
      assert.strictEqual(fs.readFileSync(target, 'utf8'), 'Hello sync world');
    });

    test('1.4 atomicRenameWithRetrySync benennt Datei synchron um', () => {
      const src = path.join(testDir, 'sync_rename_src.txt');
      const dst = path.join(testDir, 'sync_rename_dst.txt');
      fs.writeFileSync(src, 'sync-rename-data');
      atomicRenameWithRetrySync(src, dst);
      assert.strictEqual(fs.existsSync(src), false);
      assert.strictEqual(fs.readFileSync(dst, 'utf8'), 'sync-rename-data');
    });

    test('1.5 fileUtils atomicRenameWithRetry is canonical function', () => {
      assert.strictEqual(typeof atomicRenameWithRetry, 'function');
    });

    // 2. pathfinderHelper tests
    console.log('\n--- Testgruppe 2: pathfinderHelper ---');

    await testAsync('2.1 getPathfinderGoals liefert gültiges goals Objekt', async () => {
      const goals = await getPathfinderGoals();
      assert.ok(goals !== null, 'goals darf nicht null sein');
      assert.ok(typeof goals.GoalNear === 'function', 'GoalNear muss Funktion sein');
    });

    await testAsync('2.2 loadPathfinder liefert mineflayer-pathfinder Modul', async () => {
      const pf = await loadPathfinder();
      assert.ok(pf !== null, 'pathfinder Modul darf nicht null sein');
    });

    await testAsync('2.3 createMovements liefert Movements-Instanz für Bot mit Registry', async () => {
      const mcData = (await import('minecraft-data')).default('1.20.4');
      const mockBot = { registry: mcData };
      const movements = await createMovements(mockBot);
      assert.ok(movements !== null, 'Movements darf nicht null sein');
      const bareMovements = await createMovements({});
      assert.strictEqual(bareMovements, null, 'Unvollständiger Bot liefert sicher null');
    });

    // 3. stringUtils tests
    console.log('\n--- Testgruppe 3: stringUtils (levenshteinDistance) ---');

    test('3.1 levenshteinDistance liefert 0 für identische Strings', () => {
      assert.strictEqual(levenshteinDistance('stone', 'stone'), 0);
    });

    test('3.2 levenshteinDistance berechnet korrekte Distanzen für Substitution, Einfügung, Löschung', () => {
      assert.strictEqual(levenshteinDistance('kitten', 'sitting'), 3);
      assert.strictEqual(levenshteinDistance('', 'abc'), 3);
      assert.strictEqual(levenshteinDistance('abc', ''), 3);
      assert.strictEqual(levenshteinDistance('oak_planks', 'dark_oak_planks'), 5);
    });

    // 4. blockAliases tests
    console.log('\n--- Testgruppe 4: blockAliases & Normalisierung ---');

    test('4.1 BLOCK_ALIASES enthält alle definierten Material-Aliase', () => {
      assert.ok(Object.keys(BLOCK_ALIASES).length >= 40, 'Muss mindestens 40 Aliase enthalten');
      assert.strictEqual(BLOCK_ALIASES['wood_planks'], 'oak_planks');
      assert.strictEqual(BLOCK_ALIASES['cobble'], 'cobblestone');
      assert.strictEqual(BLOCK_ALIASES['window'], 'glass_pane');
    });

    test('4.2 normalizeBlockName entfernt minecraft: Prefix und Blockzustands-Klammern', () => {
      assert.strictEqual(normalizeBlockName('minecraft:stone'), 'stone');
      assert.strictEqual(normalizeBlockName('minecraft:spruce_stairs[facing=north,half=bottom]'), 'spruce_stairs');
      assert.strictEqual(normalizeBlockName('  minecraft:chest[facing=south]  '), 'chest');
    });

    test('4.3 normalizeBlockName wendet Aliase an wenn applyAlias=true', () => {
      assert.strictEqual(normalizeBlockName('wood_planks'), 'oak_planks');
      assert.strictEqual(normalizeBlockName('minecraft:cobble[waterlogged=false]'), 'cobblestone');
      assert.strictEqual(normalizeBlockName('wood_planks', false), 'wood_planks');
    });

    test('4.4 normalizeBlockName behandelt leere und ungültige Eingaben sicher', () => {
      assert.strictEqual(normalizeBlockName(''), '');
      assert.strictEqual(normalizeBlockName(null), '');
      assert.strictEqual(normalizeBlockName(undefined), '');
    });

    test('4.5 canonical BLOCK_ALIASES and normalizeBlockName are defined', () => {
      assert.strictEqual(typeof BLOCK_ALIASES, 'object');
      assert.strictEqual(typeof normalizeBlockName, 'function');
    });

    test('4.6 canonical greedyMesher utilities are imported and functioning', () => {
      assert.strictEqual(typeof computeGreedyBoxes, 'function');
      assert.strictEqual(typeof toBlockString, 'function');
      assert.strictEqual(toBlockString({ name: 'stone' }), 'stone');
    });

  } finally {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`\n=== SHARED CORE UTILITIES TEST SUITE: ${passed}/${total} PASS ===`);
  if (passed !== total) {
    throw new Error(`Test suite failed: ${passed}/${total} passed`);
  }
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
