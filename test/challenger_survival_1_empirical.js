import assert from 'assert';
import { Vec3 } from 'vec3';
import { VersionResolver } from '../src/config/versionResolver.js';
import { ChestManager } from '../src/survival/chestManager.js';
import { MaterialProcurement } from '../src/survival/materialProcurement.js';
import minecraftData from 'minecraft-data';
import mineflayerVersion from 'mineflayer/lib/version.js';
import minecraftProtocol from 'minecraft-protocol';

async function runEmpiricalChallengerTests() {
  console.log('=== STARTING CHALLENGER 1 EMPIRICAL ADVERSARIAL STRESS TEST SUITE ===\n');

  let passedAssertions = 0;
  let failedAssertions = 0;
  const vulnerabilities = [];

  function pass(msg) {
    passedAssertions++;
    console.log(`[PASS] ${msg}`);
  }

  function reportVulnerability(id, description, input, expected, actual) {
    failedAssertions++;
    const vuln = { id, description, input, expected, actual };
    vulnerabilities.push(vuln);
    console.error(`[VULNERABILITY DETECTED] [${id}] ${description}`);
    console.error(`  Input: ${JSON.stringify(input)}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual: ${JSON.stringify(actual)}`);
  }

  // =========================================================================
  // SECTION 1: VersionResolver Adversarial Input & Polyfill Stress Testing
  // =========================================================================
  console.log('--- Section 1: VersionResolver Adversarial Stress Tests ---');

  // 1.1 Canonical inputs
  assert.strictEqual(VersionResolver.normalizeVersion(false), false);
  pass('normalizeVersion(false) === false');

  assert.strictEqual(VersionResolver.normalizeVersion('false'), false);
  pass('normalizeVersion("false") === false');

  assert.strictEqual(VersionResolver.normalizeVersion('auto'), false);
  pass('normalizeVersion("auto") === false');

  assert.strictEqual(VersionResolver.normalizeVersion('none'), false);
  pass('normalizeVersion("none") === false');

  assert.strictEqual(VersionResolver.normalizeVersion('26.3'), '26.3');
  pass('normalizeVersion("26.3") === "26.3"');

  assert.strictEqual(VersionResolver.normalizeVersion(26.3), '26.3');
  pass('normalizeVersion(26.3 number) === "26.3"');

  assert.strictEqual(VersionResolver.normalizeVersion(' 26.3 '), '26.3');
  pass('normalizeVersion(" 26.3 " with whitespace) === "26.3"');

  // 1.2 Empty / Undefined / Null fallback handling
  assert.strictEqual(VersionResolver.normalizeVersion(undefined), '1.20.4');
  pass('normalizeVersion(undefined) === "1.20.4"');

  assert.strictEqual(VersionResolver.normalizeVersion(null), '1.20.4');
  pass('normalizeVersion(null) === "1.20.4"');

  assert.strictEqual(VersionResolver.normalizeVersion(''), '1.20.4');
  pass('normalizeVersion("") === "1.20.4"');

  assert.strictEqual(VersionResolver.normalizeVersion(undefined, 'auto'), false);
  pass('normalizeVersion(undefined, "auto") === false');

  assert.strictEqual(VersionResolver.normalizeVersion(undefined, false), false);
  pass('normalizeVersion(undefined, false) === false');

  assert.strictEqual(VersionResolver.normalizeVersion(undefined, '1.21.1'), '1.21.1');
  pass('normalizeVersion(undefined, "1.21.1") === "1.21.1"');

  // 1.3 Case Sensitivity & Whitespace Edge Cases (Adversarial Fuzzing)
  const caseWhitespaceFuzzInputs = [
    { input: '  auto  ', expected: false, id: 'VR-CASE-01' },
    { input: 'Auto', expected: false, id: 'VR-CASE-02' },
    { input: 'AUTO', expected: false, id: 'VR-CASE-03' },
    { input: '  Auto  ', expected: false, id: 'VR-CASE-04' },
    { input: 'False', expected: false, id: 'VR-CASE-05' },
    { input: 'FALSE', expected: false, id: 'VR-CASE-06' },
    { input: 'false ', expected: false, id: 'VR-CASE-07' },
    { input: ' None ', expected: false, id: 'VR-CASE-08' },
    { input: 'NONE', expected: false, id: 'VR-CASE-09' }
  ];

  for (const tc of caseWhitespaceFuzzInputs) {
    const res = VersionResolver.normalizeVersion(tc.input);
    if (res !== tc.expected) {
      reportVulnerability(
        tc.id,
        `normalizeVersion failed to sanitize case/whitespace, returning string that crashes Mineflayer with "unsupported protocol version"`,
        tc.input,
        tc.expected,
        res
      );
    } else {
      pass(`normalizeVersion(${JSON.stringify(tc.input)}) safely normalized to boolean false`);
    }
  }

  // 1.4 Protocol 777 Runtime Polyfill & Schema Verification
  const shimApplied = VersionResolver.applyCompatibilityShims();
  assert.strictEqual(shimApplied, true);
  pass('applyCompatibilityShims() returned true');

  const mcData26_3 = minecraftData('26.3');
  assert(mcData26_3 !== null, 'minecraft-data("26.3") is not null');
  assert(mcData26_3.blocksByName['chest'] !== undefined, 'chest block definition present in 26.3');
  assert(mcData26_3.blocksByName['barrel'] !== undefined, 'barrel block definition present in 26.3');
  assert(mcData26_3.itemsByName['diamond_sword'] !== undefined, 'diamond_sword item present in 26.3');
  pass('minecraftData("26.3") successfully aliases 26.1 registry with all block/item definitions');

  // Verify clean version handling without mutating external packages (mineflayer, minecraft-protocol)
  assert(!mineflayerVersion.testedVersions?.includes('26.3'), 'mineflayer testedVersions is not globally mutated');
  assert(!minecraftProtocol.supportedVersions?.includes('26.3'), 'minecraftProtocol supportedVersions is not globally mutated');
  pass('Clean version handling verified: external packages are not globally monkey-patched');

  // 1.5 resolveConnectionOptions ping fallback
  const resolvedExplicit = await VersionResolver.resolveConnectionOptions('127.0.0.1', 25565, '26.3');
  assert.strictEqual(resolvedExplicit.version, '26.3');
  assert.strictEqual(resolvedExplicit.autoDetect, false);
  pass('resolveConnectionOptions("26.3") returns version "26.3" without ping attempt');

  const resolvedOffline = await VersionResolver.resolveConnectionOptions('127.0.0.1', 59999, 'auto');
  assert.strictEqual(resolvedOffline.version, '1.20.4');
  assert.strictEqual(resolvedOffline.autoDetect, false);
  assert.strictEqual(resolvedOffline.fallbackUsed, true);
  pass('resolveConnectionOptions offline fallback gracefully degrades to 1.20.4 without throwing');

  // =========================================================================
  // SECTION 2: ChestManager Obstruction & Deduplication Adversarial Tests
  // =========================================================================
  console.log('\n--- Section 2: ChestManager Obstruction & Deduplication Stress Tests ---');
  const cm = new ChestManager();

  // 2.1 Obstruction: Barrels vs Single Chests vs Trapped Chests
  const mockWorld = {
    blocks: new Map()
  };
  function setBlock(pos, blockData) {
    const key = `${pos.x},${pos.y},${pos.z}`;
    mockWorld.blocks.set(key, { ...blockData, position: pos });
  }
  function clearWorld() {
    mockWorld.blocks.clear();
  }
  const testBot = {
    version: '1.20.4',
    blockAt: (p) => {
      const key = `${p.x},${p.y},${p.z}`;
      return mockWorld.blocks.get(key) || { name: 'air', boundingBox: 'empty', transparent: true };
    }
  };

  // 2.1.1 Barrel under solid block
  clearWorld();
  setBlock(new Vec3(10, 64, 10), { name: 'barrel', boundingBox: 'block', transparent: false, _properties: {} });
  setBlock(new Vec3(10, 65, 10), { name: 'stone', boundingBox: 'block', transparent: false });
  const barrelBlock = testBot.blockAt(new Vec3(10, 64, 10));
  assert.strictEqual(cm.canOpen(testBot, barrelBlock), true, 'Barrel under solid block MUST be openable');
  pass('canOpen: Barrel under solid block is allowed (Java Edition behavior)');

  // 2.1.2 Single chest under solid block
  clearWorld();
  setBlock(new Vec3(10, 64, 10), { name: 'chest', boundingBox: 'block', transparent: false, _properties: { type: 'single' } });
  setBlock(new Vec3(10, 65, 10), { name: 'cobblestone', boundingBox: 'block', transparent: false });
  const singleChestSolid = testBot.blockAt(new Vec3(10, 64, 10));
  assert.strictEqual(cm.canOpen(testBot, singleChestSolid), false, 'Chest under solid block MUST NOT be openable');
  pass('canOpen: Single chest under solid block is correctly blocked');

  // 2.1.3 Single chest under transparent block (glass)
  clearWorld();
  setBlock(new Vec3(10, 64, 10), { name: 'chest', boundingBox: 'block', transparent: false, _properties: { type: 'single' } });
  setBlock(new Vec3(10, 65, 10), { name: 'glass', boundingBox: 'block', transparent: true });
  const singleChestGlass = testBot.blockAt(new Vec3(10, 64, 10));
  assert.strictEqual(cm.canOpen(testBot, singleChestGlass), true, 'Chest under glass MUST be openable');
  pass('canOpen: Single chest under transparent glass is allowed');

  // 2.1.4 Trapped chest under solid block
  clearWorld();
  setBlock(new Vec3(10, 64, 10), { name: 'trapped_chest', boundingBox: 'block', transparent: false, _properties: { type: 'single' } });
  setBlock(new Vec3(10, 65, 10), { name: 'deepslate', boundingBox: 'block', transparent: false });
  const trappedChestSolid = testBot.blockAt(new Vec3(10, 64, 10));
  assert.strictEqual(cm.canOpen(testBot, trappedChestSolid), false, 'Trapped chest under solid block MUST NOT be openable');
  pass('canOpen: Trapped chest under solid block is correctly blocked');

  // 2.2 Double Chest Obstruction: Asymmetric Obstruction
  // In Java Edition, if EITHER half of a double chest has a solid block above it, neither half can open.
  clearWorld();
  const dPosL = new Vec3(20, 64, 20);
  const dPosR = new Vec3(21, 64, 20);
  setBlock(dPosL, { name: 'chest', boundingBox: 'block', transparent: false, _properties: { type: 'left', facing: 'north' } });
  setBlock(dPosR, { name: 'chest', boundingBox: 'block', transparent: false, _properties: { type: 'right', facing: 'north' } });

  // Test 2.2.1: Left half covered by stone, right half has air
  setBlock(dPosL.offset(0, 1, 0), { name: 'stone', boundingBox: 'block', transparent: false });
  setBlock(dPosR.offset(0, 1, 0), { name: 'air', boundingBox: 'empty', transparent: true });
  const blockL1 = testBot.blockAt(dPosL);
  const blockR1 = testBot.blockAt(dPosR);
  assert.strictEqual(cm.canOpen(testBot, blockL1), false, 'Left half cannot open because directly obstructed');
  assert.strictEqual(cm.canOpen(testBot, blockR1), false, 'Right half cannot open because partner is obstructed');
  pass('canOpen: Asymmetric double chest obstruction (left covered) blocks BOTH halves');

  // Test 2.2.2: Right half covered by stone, left half has air
  setBlock(dPosL.offset(0, 1, 0), { name: 'air', boundingBox: 'empty', transparent: true });
  setBlock(dPosR.offset(0, 1, 0), { name: 'stone', boundingBox: 'block', transparent: false });
  const blockL2 = testBot.blockAt(dPosL);
  const blockR2 = testBot.blockAt(dPosR);
  assert.strictEqual(cm.canOpen(testBot, blockR2), false, 'Right half cannot open because directly obstructed');
  assert.strictEqual(cm.canOpen(testBot, blockL2), false, 'Left half cannot open because partner is obstructed');
  pass('canOpen: Asymmetric double chest obstruction (right covered) blocks BOTH halves');

  // 2.3 Double Chest Deduplication across ALL 4 FACING ORIENTATIONS
  console.log('\n--- Section 2.3: Double Chest Deduplication across all 4 Orientations ---');
  clearWorld();

  // We set up 4 double chests (north, south, east, west) + 1 barrel + 1 single chest
  // Total of 10 container blocks in the world.
  const chestConfigs = [
    {
      facing: 'north',
      leftPos: new Vec3(0, 64, 0),
      rightPos: new Vec3(1, 64, 0) // East (+X)
    },
    {
      facing: 'south',
      leftPos: new Vec3(10, 64, 0),
      rightPos: new Vec3(9, 64, 0) // West (-X)
    },
    {
      facing: 'west',
      leftPos: new Vec3(20, 64, 0),
      rightPos: new Vec3(20, 64, -1) // North (-Z)
    },
    {
      facing: 'east',
      leftPos: new Vec3(30, 64, 0),
      rightPos: new Vec3(30, 64, 1) // South (+Z)
    }
  ];

  const allContainerPositions = [];

  for (const cfg of chestConfigs) {
    // Left half
    setBlock(cfg.leftPos, {
      name: 'chest',
      boundingBox: 'block',
      transparent: false,
      _properties: { type: 'left', facing: cfg.facing }
    });
    // Right half
    setBlock(cfg.rightPos, {
      name: 'chest',
      boundingBox: 'block',
      transparent: false,
      _properties: { type: 'right', facing: cfg.facing }
    });
    allContainerPositions.push(cfg.leftPos, cfg.rightPos);

    // Verify coordinate calculation directly
    const computedPartnerFromLeft = cm.getDoubleChestPartnerPos(testBot, testBot.blockAt(cfg.leftPos));
    assert.deepStrictEqual(
      computedPartnerFromLeft,
      cfg.rightPos,
      `getDoubleChestPartnerPos for facing=${cfg.facing} from left half must equal rightPos`
    );

    const computedPartnerFromRight = cm.getDoubleChestPartnerPos(testBot, testBot.blockAt(cfg.rightPos));
    assert.deepStrictEqual(
      computedPartnerFromRight,
      cfg.leftPos,
      `getDoubleChestPartnerPos for facing=${cfg.facing} from right half must equal leftPos`
    );

    pass(`getDoubleChestPartnerPos verified bidirectional exact match for facing=${cfg.facing}`);
  }

  // Add 1 standalone barrel and 1 standalone chest
  const standaloneBarrelPos = new Vec3(40, 64, 0);
  setBlock(standaloneBarrelPos, { name: 'barrel', boundingBox: 'block', transparent: false, _properties: {} });
  allContainerPositions.push(standaloneBarrelPos);

  const standaloneChestPos = new Vec3(50, 64, 0);
  setBlock(standaloneChestPos, { name: 'chest', boundingBox: 'block', transparent: false, _properties: { type: 'single' } });
  allContainerPositions.push(standaloneChestPos);

  assert.strictEqual(allContainerPositions.length, 10, 'Total of 10 container blocks created in test world');

  const deduplicationBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: testBot.blockAt,
    findBlocks: () => allContainerPositions
  };

  const discoveredContainers = cm.findContainers(deduplicationBot, 100);

  // Exactly 6 containers must be found: 4 double chests + 1 barrel + 1 single chest
  assert.strictEqual(
    discoveredContainers.length,
    6,
    `findContainers MUST deduplicate 4 double chests: expected 6 containers, got ${discoveredContainers.length}`
  );
  pass(`findContainers successfully deduplicated 10 blocks into exactly 6 containers across all 4 orientations`);

  const doubleChestCount = discoveredContainers.filter(c => c.isDouble).length;
  assert.strictEqual(doubleChestCount, 4, 'Exactly 4 double containers marked with isDouble: true');
  pass('All 4 double chests correctly flagged with isDouble: true');

  // Verify reverse discovery order resilience (right half discovered before left half)
  const reversedPositions = [...allContainerPositions].reverse();
  const reverseDeduplicationBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    blockAt: testBot.blockAt,
    findBlocks: () => reversedPositions
  };
  const discoveredReversed = cm.findContainers(reverseDeduplicationBot, 100);
  assert.strictEqual(
    discoveredReversed.length,
    6,
    `findContainers MUST deduplicate regardless of block scan order (reversed order)`
  );
  pass('findContainers deduplication is fully invariant to block scan ordering');

  // =========================================================================
  // SECTION 3: ChestManager Withdrawal Capacity Calculations without Throwing
  // =========================================================================
  console.log('\n--- Section 3: ChestManager Withdrawal Capacity & Exception Safety ---');

  // 3.1 Test withdrawSafe when inventory has 0 empty slots
  // Mineflayer core lib/plugins/inventory.js:373 throws:
  // "Unable to withdraw, Bot inventory is full." when emptySlotCount() === 0.
  // ChestManager must safely calculate capacity and return 0 without throwing an unhandled error.

  const fullSlotsNoPartial = new Array(45).fill({ name: 'dirt', count: 64 });
  const mockFullBot = {
    version: '1.20.4',
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 0,
      slots: fullSlotsNoPartial,
      items: () => fullSlotsNoPartial.slice(9, 45)
    }
  };

  const mockChestWindow = {
    containerItems: () => [{ name: 'oak_planks', type: 101, count: 64 }],
    containerCount: (type) => (type === 101 ? 64 : 0),
    withdraw: async () => {
      // If Mineflayer withdraw were invoked with emptySlotCount === 0:
      throw new Error('Unable to withdraw, Bot inventory is full.');
    },
    close: () => {}
  };

  let withdrawnFullNoPartial = null;
  let exceptionThrown1 = false;
  try {
    withdrawnFullNoPartial = await cm.withdrawSafe(mockFullBot, mockChestWindow, 'oak_planks', 32);
  } catch (err) {
    exceptionThrown1 = true;
    console.error('Unexpected exception thrown in withdrawSafe:', err);
  }

  assert.strictEqual(exceptionThrown1, false, 'withdrawSafe must NEVER throw when inventory is full');
  assert.strictEqual(withdrawnFullNoPartial, 0, 'withdrawSafe returns 0 when no empty slots exist');
  pass('withdrawSafe safely returns 0 when emptySlotCount === 0 and no partial stack exists (no throw)');

  // 3.2 Test withdrawSafe when inventory has 0 empty slots but contains a partial stack
  const fullSlotsWithPartial = new Array(45).fill({ name: 'dirt', count: 64 });
  fullSlotsWithPartial[15] = { name: 'oak_planks', count: 32 }; // partial stack of 32/64
  const mockFullBotWithPartial = {
    version: '1.20.4',
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 0,
      slots: fullSlotsWithPartial,
      items: () => fullSlotsWithPartial.slice(9, 45)
    }
  };

  let withdrawnFullWithPartial = null;
  let exceptionThrown2 = false;
  try {
    withdrawnFullWithPartial = await cm.withdrawSafe(mockFullBotWithPartial, mockChestWindow, 'oak_planks', 32);
  } catch (err) {
    exceptionThrown2 = true;
    console.error('Unexpected exception thrown in withdrawSafe:', err);
  }

  assert.strictEqual(exceptionThrown2, false, 'withdrawSafe must NEVER throw with partial stack at 0 empty slots');
  assert.strictEqual(
    withdrawnFullWithPartial,
    0,
    'withdrawSafe returns 0 because Mineflayer window.withdraw strictly requires emptySlotCount > 0'
  );
  pass('withdrawSafe handles partial stack at emptySlotCount === 0 safely without throwing unhandled exceptions');

  // 3.3 Test withdrawSafe with 1 empty slot and oversized withdrawal request
  // Inventory has 1 empty slot (max 64 capacity), chest has 200 items, countNeeded = 100
  let actualWithdrawCountRequested = 0;
  const mockCappedWindow = {
    containerItems: () => [{ name: 'cobblestone', type: 102, count: 200 }],
    containerCount: (type) => (type === 102 ? 200 : 0),
    withdraw: async (type, meta, amount) => {
      actualWithdrawCountRequested = amount;
      if (amount > 64) {
        throw new Error('destination full');
      }
    },
    close: () => {}
  };

  const singleSlotBot = {
    version: '1.20.4',
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 1,
      slots: new Array(45).fill(null), // empty slots
      items: () => []
    }
  };
  // Fill all except 1 slot
  for (let i = 9; i <= 43; i++) {
    singleSlotBot.inventory.slots[i] = { name: 'dirt', count: 64 };
  }
  singleSlotBot.inventory.slots[44] = null; // Exactly 1 free slot

  const amountWithdrawnCapped = await cm.withdrawSafe(singleSlotBot, mockCappedWindow, 'cobblestone', 100);
  assert.strictEqual(amountWithdrawnCapped, 64, 'withdrawSafe caps withdrawal amount to available slot space (64)');
  assert.strictEqual(actualWithdrawCountRequested, 64, 'window.withdraw invoked with exactly 64 to prevent destination full');
  pass('withdrawSafe successfully bounds withdrawal to free slot capacity (64) preventing destination full');

  // 3.4 Test destination full exception recovery
  const throwingWindow = {
    containerItems: () => [{ name: 'cobblestone', type: 102, count: 64 }],
    containerCount: () => 64,
    withdraw: async () => {
      throw new Error('destination full');
    },
    close: () => {}
  };
  const recoveryResult = await cm.withdrawSafe(singleSlotBot, throwingWindow, 'cobblestone', 32);
  assert.strictEqual(recoveryResult, 32, 'Catches "destination full" gracefully without crashing and returns transfer amount');
  pass('withdrawSafe catches "destination full" without crashing the caller');

  // =========================================================================
  // SECTION 4: MaterialProcurement Missing Chest Items Handling
  // =========================================================================
  console.log('\n--- Section 4: MaterialProcurement Missing Items & Shortage Manifests ---');
  const mp = new MaterialProcurement();

  // 4.1 Case A: No chests exist in radius
  const noChestsBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => []
    },
    findBlocks: () => [], // No chests found
    blockAt: () => null,
    chat: () => {}
  };

  const neededBOM = { diamond_block: 5, obsidian: 10 };
  const resNoChests = await mp.procureMaterials(noChestsBot, neededBOM, { chatAlerts: false });
  assert.strictEqual(resNoChests.success, false, 'No chests -> success must be false');
  assert.deepStrictEqual(resNoChests.procured, {}, 'No items procured');
  assert.deepStrictEqual(resNoChests.missing, neededBOM, 'All BOM items reported in missing manifest');
  pass('MaterialProcurement: Graceful shortage manifest when no chests exist in radius');

  // 4.2 Case B: Chests exist, but lack the requested items
  const chestWithDirtOnly = {
    containerItems: () => [{ name: 'dirt', type: 3, count: 64 }],
    containerCount: (type) => (type === 3 ? 64 : 0),
    withdraw: async () => {},
    close: () => {}
  };

  const wrongChestsBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 5,
      slots: new Array(45).fill(null),
      items: () => []
    },
    findBlocks: () => [new Vec3(5, 64, 0)],
    blockAt: (p) => ({ name: 'chest', position: p, _properties: { type: 'single' } }),
    openContainer: async () => chestWithDirtOnly,
    chat: () => {}
  };

  const resWrongChests = await mp.procureMaterials(wrongChestsBot, { iron_ingot: 12 }, { chatAlerts: false });
  assert.strictEqual(resWrongChests.success, false, 'Chests missing items -> success must be false');
  assert.deepStrictEqual(resWrongChests.procured, {}, 'Procured map is empty');
  assert.strictEqual(resWrongChests.missing.iron_ingot, 12, 'Missing count is exactly 12');
  pass('MaterialProcurement: Graceful shortage manifest when chests lack the required items');

  // 4.3 Case C: Fragmented multi-chest procurement with partial deficit
  // Need: stone_bricks: 50, glass: 20
  // Chest 1: stone_bricks: 25
  // Chest 2: stone_bricks: 15, glass: 10
  // Total procured: stone_bricks: 40, glass: 10
  // Missing remaining: stone_bricks: 10, glass: 10
  const multiChest1Items = [{ name: 'stone_bricks', type: 201, count: 25 }];
  const multiChest2Items = [
    { name: 'stone_bricks', type: 201, count: 15 },
    { name: 'glass', type: 202, count: 10 }
  ];

  let chest1Closed = false;
  let chest2Closed = false;

  const multiChest1 = {
    containerItems: () => multiChest1Items,
    containerCount: (type) => (type === 201 ? multiChest1Items[0].count : 0),
    withdraw: async (type, meta, amount) => {
      multiChest1Items[0].count -= amount;
    },
    close: () => { chest1Closed = true; }
  };

  const multiChest2 = {
    containerItems: () => multiChest2Items,
    containerCount: (type) => {
      const it = multiChest2Items.find(i => i.type === type);
      return it ? it.count : 0;
    },
    withdraw: async (type, meta, amount) => {
      const it = multiChest2Items.find(i => i.type === type);
      if (it) it.count -= amount;
    },
    close: () => { chest2Closed = true; }
  };

  const fragmentedBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 10,
      slots: new Array(45).fill(null),
      items: () => []
    },
    findBlocks: () => [new Vec3(5, 64, 0), new Vec3(8, 64, 0)],
    blockAt: (p) => {
      if (p.x === 5) return { name: 'chest', position: p, _properties: { type: 'single' } };
      if (p.x === 8) return { name: 'barrel', position: p, _properties: {} };
      return null;
    },
    openContainer: async (block) => {
      if (block.position.x === 5) return multiChest1;
      return multiChest2;
    },
    chat: () => {}
  };

  const resFragmented = await mp.procureMaterials(
    fragmentedBot,
    { stone_bricks: 50, glass: 20 },
    { chatAlerts: false }
  );

  assert.strictEqual(resFragmented.success, false, 'Partial materials -> success is false');
  assert.strictEqual(resFragmented.procured.stone_bricks, 40, '40 stone_bricks procured across chests 1 and 2');
  assert.strictEqual(resFragmented.procured.glass, 10, '10 glass procured from chest 2');
  assert.strictEqual(resFragmented.missing.stone_bricks, 10, '10 stone_bricks remaining missing');
  assert.strictEqual(resFragmented.missing.glass, 10, '10 glass remaining missing');
  assert.strictEqual(chest1Closed, true, 'Chest 1 window safely closed');
  assert.strictEqual(chest2Closed, true, 'Chest 2 window safely closed');
  pass('MaterialProcurement: Multi-chest fragmented withdrawal updates shortage manifest and closes all windows');

  // 4.4 Case D: Robustness against container errors (timeout/throw on 1st container)
  const faultyChestsBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 5,
      slots: new Array(45).fill(null),
      items: () => []
    },
    findBlocks: () => [new Vec3(2, 64, 0), new Vec3(4, 64, 0)],
    blockAt: (p) => ({ name: 'chest', position: p, _properties: { type: 'single' } }),
    openContainer: async (block) => {
      if (block.position.x === 2) {
        throw new Error('Container open timeout (4000ms)');
      }
      return {
        containerItems: () => [{ name: 'oak_planks', type: 101, count: 64 }],
        containerCount: () => 64,
        withdraw: async () => {},
        close: () => {}
      };
    },
    chat: () => {}
  };

  const resFaulty = await mp.procureMaterials(faultyChestsBot, { oak_planks: 10 }, { chatAlerts: false });
  assert.strictEqual(resFaulty.success, true, 'Successfully skips faulty chest and procures from secondary chest');
  assert.strictEqual(resFaulty.procured.oak_planks, 10);
  pass('MaterialProcurement: Fault tolerance on individual container timeout/failure');

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n=========================================================================');
  console.log(`EMIRICAL CHALLENGER 1 TESTS COMPLETE:`);
  console.log(`Assertions Passed: ${passedAssertions}`);
  console.log(`Vulnerabilities Detected: ${vulnerabilities.length}`);
  console.log('=========================================================================\n');

  if (vulnerabilities.length > 0) {
    console.log('LIST OF DETECTED VULNERABILITIES:');
    for (const v of vulnerabilities) {
      console.log(`- [${v.id}] ${v.description} (Input: ${JSON.stringify(v.input)} -> ${JSON.stringify(v.actual)})`);
    }
  }

  return {
    passed: passedAssertions,
    failed: failedAssertions,
    vulnerabilities
  };
}

runEmpiricalChallengerTests().then(result => {
  if (result.vulnerabilities.length > 0) {
    console.log('\nEmpirical challenge identified issues requiring changes or assessment.');
  } else {
    console.log('\nAll empirical challenge tests passed flawlessly.');
  }
}).catch(err => {
  console.error('Test execution fatal error:', err);
  process.exit(1);
});
