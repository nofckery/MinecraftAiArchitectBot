import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { VersionResolver } from '../src/config/versionResolver.js';
import { WorldExecutor } from '../src/builder/worldExecutor.js';
import * as fileUtils from '../src/utils/fileUtils.js';
import * as credentialVaultModule from '../src/security/credentialVault.js';
import * as voxelCanvasModule from '../src/builder/voxelCanvas.js';
import * as blockAliasesModule from '../src/builder/blockAliases.js';
import * as greedyMesherModule from '../src/builder/greedyMesher.js';
import * as stringUtilsModule from '../src/utils/stringUtils.js';

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

async function main() {
  console.log('=== STARTING CHALLENGER M3 R3 EMPIRICAL STRESS TEST SUITE ===\n');

  // =========================================================================
  // SECTION 1: VersionResolver Adversarial Stress & Zero node_modules Writes
  // =========================================================================
  console.log('--- Section 1: VersionResolver Adversarial Stress & Zero node_modules Writes ---');

  test('1.1 normalizeVersion handles diverse and extreme inputs safely', () => {
    // Expected auto/false mapping to boolean false
    assert.strictEqual(VersionResolver.normalizeVersion('auto'), false);
    assert.strictEqual(VersionResolver.normalizeVersion('false'), false);
    assert.strictEqual(VersionResolver.normalizeVersion(false), false);
    assert.strictEqual(VersionResolver.normalizeVersion('none'), false);
    assert.strictEqual(VersionResolver.normalizeVersion('  AUTO  '), false);
    assert.strictEqual(VersionResolver.normalizeVersion('  FALSE '), false);
    assert.strictEqual(VersionResolver.normalizeVersion('  none  '), false);

    // Explicit valid versions
    assert.strictEqual(VersionResolver.normalizeVersion('26.3'), '26.3');
    assert.strictEqual(VersionResolver.normalizeVersion('1.20.4'), '1.20.4');
    assert.strictEqual(VersionResolver.normalizeVersion('1.21.4'), '1.21.4');
    assert.strictEqual(VersionResolver.normalizeVersion('1.20.1'), '1.20.1');

    // Invalid or unknown versions
    assert.strictEqual(VersionResolver.normalizeVersion('invalid.version'), 'invalid.version');
    assert.strictEqual(VersionResolver.normalizeVersion('99.99.99'), '99.99.99');

    // Nil and empty inputs fallback to defaultVersion
    assert.strictEqual(VersionResolver.normalizeVersion('', '1.20.4'), '1.20.4');
    assert.strictEqual(VersionResolver.normalizeVersion(null, '1.20.4'), '1.20.4');
    assert.strictEqual(VersionResolver.normalizeVersion(undefined, '1.20.4'), '1.20.4');
    assert.strictEqual(VersionResolver.normalizeVersion(undefined, 'auto'), false);
    assert.strictEqual(VersionResolver.normalizeVersion(null, false), false);
  });

  test('1.2 isValidVersion discriminates valid vs invalid versions accurately', () => {
    assert.strictEqual(VersionResolver.isValidVersion('auto'), true);
    assert.strictEqual(VersionResolver.isValidVersion('false'), true);
    assert.strictEqual(VersionResolver.isValidVersion(false), true);
    assert.strictEqual(VersionResolver.isValidVersion('none'), true);
    assert.strictEqual(VersionResolver.isValidVersion('26.3'), true);
    assert.strictEqual(VersionResolver.isValidVersion('1.20.4'), true);
    assert.strictEqual(VersionResolver.isValidVersion('1.21.4'), true);
    assert.strictEqual(VersionResolver.isValidVersion('1.20.1'), true);

    // Adversarial / Invalid versions
    assert.strictEqual(VersionResolver.isValidVersion('invalid.version'), false);
    assert.strictEqual(VersionResolver.isValidVersion('99.99.99'), false);
    assert.strictEqual(VersionResolver.isValidVersion('minecraft:1.20.4'), false);
    assert.strictEqual(VersionResolver.isValidVersion('1.20.4; DROP TABLE'), false);
    assert.strictEqual(VersionResolver.isValidVersion(true), false);
    assert.strictEqual(VersionResolver.isValidVersion(12345), false);
    assert.strictEqual(VersionResolver.isValidVersion({}), false);
    assert.strictEqual(VersionResolver.isValidVersion([]), false);
  });

  test('1.3 resolveViewerVersion correctly maps game versions to WebGL asset bundles', () => {
    assert.strictEqual(VersionResolver.resolveViewerVersion('auto'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('false'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion(false), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('none'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('26.3'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('1.20.4'), '1.20.1'); // Unbundled minor maps to 1.20.1
    assert.strictEqual(VersionResolver.resolveViewerVersion('1.21.4'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('1.21.1'), '1.21.1');
    assert.strictEqual(VersionResolver.resolveViewerVersion('1.19.2'), '1.19');
    assert.strictEqual(VersionResolver.resolveViewerVersion('invalid.version'), '1.21.4'); // Safe default
  });

  await testAsync('1.4 zero physical writes to node_modules or disk files during version operations', async () => {
    const nodeModulesDir = path.resolve('node_modules');
    let attemptedWrites = [];

    // Intercept fs synchronous and asynchronous write operations
    const originalWriteFileSync = fs.writeFileSync;
    const originalWriteFile = fs.writeFile;
    const originalPromisesWriteFile = fs.promises.writeFile;
    const originalAppendFileSync = fs.appendFileSync;

    fs.writeFileSync = function (file, ...args) {
      const filePath = typeof file === 'string' ? path.resolve(file) : '';
      if (filePath.includes('node_modules')) {
        attemptedWrites.push({ op: 'writeFileSync', path: filePath });
      }
      return originalWriteFileSync.apply(this, [file, ...args]);
    };

    fs.writeFile = function (file, ...args) {
      const filePath = typeof file === 'string' ? path.resolve(file) : '';
      if (filePath.includes('node_modules')) {
        attemptedWrites.push({ op: 'writeFile', path: filePath });
      }
      return originalWriteFile.apply(this, [file, ...args]);
    };

    fs.promises.writeFile = function (file, ...args) {
      const filePath = typeof file === 'string' ? path.resolve(file) : '';
      if (filePath.includes('node_modules')) {
        attemptedWrites.push({ op: 'promises.writeFile', path: filePath });
      }
      return originalPromisesWriteFile.apply(this, [file, ...args]);
    };

    fs.appendFileSync = function (file, ...args) {
      const filePath = typeof file === 'string' ? path.resolve(file) : '';
      if (filePath.includes('node_modules')) {
        attemptedWrites.push({ op: 'appendFileSync', path: filePath });
      }
      return originalAppendFileSync.apply(this, [file, ...args]);
    };

    try {
      // Execute all version resolver functions multiple times with diverse inputs
      const shimResult = VersionResolver.applyCompatibilityShims();
      assert.strictEqual(shimResult, true, 'applyCompatibilityShims must return true');

      for (const v of ['auto', 'false', false, 'none', '26.3', '1.20.4', '1.21.4', 'invalid.version']) {
        VersionResolver.normalizeVersion(v);
        VersionResolver.isValidVersion(v);
        VersionResolver.resolveViewerVersion(v);
      }

      await VersionResolver.resolveConnectionOptions('127.0.0.1', 25565, '26.3');
      await VersionResolver.resolveConnectionOptions('127.0.0.1', 25565, 'auto');

      // Assert zero writes took place in node_modules
      assert.strictEqual(
        attemptedWrites.length,
        0,
        `Expected ZERO writes to node_modules, but recorded: ${JSON.stringify(attemptedWrites)}`
      );
    } finally {
      fs.writeFileSync = originalWriteFileSync;
      fs.writeFile = originalWriteFile;
      fs.promises.writeFile = originalPromisesWriteFile;
      fs.appendFileSync = originalAppendFileSync;
    }
  });

  test('1.5 patchBotClient coordinates teleport_confirm packet parameters cleanly', () => {
    // 1. Safe on null or non-bot instances
    assert.doesNotThrow(() => VersionResolver.patchBotClient(null));
    assert.doesNotThrow(() => VersionResolver.patchBotClient({}));

    // 2. Mock bot with _client
    const listeners = {};
    const writtenPackets = [];
    const mockBot = {
      entity: { position: { x: 10.5, y: 70.0, z: -5.5 }, yaw: 1.5, pitch: -0.5 },
      _client: {
        on: (event, handler) => { listeners[event] = handler; },
        write: (name, params) => {
          writtenPackets.push({ name, params: { ...params } });
        }
      }
    };

    VersionResolver.patchBotClient(mockBot);

    // Write teleport_confirm without prior position packet -> uses bot.entity
    mockBot._client.write('teleport_confirm', { teleportId: 100 });
    assert.strictEqual(writtenPackets.length, 1);
    assert.strictEqual(writtenPackets[0].name, 'teleport_confirm');
    assert.strictEqual(writtenPackets[0].params.x, 10.5);
    assert.strictEqual(writtenPackets[0].params.y, 70.0);
    assert.strictEqual(writtenPackets[0].params.z, -5.5);

    // Simulate incoming server position packet
    listeners['packet']({ x: 100, y: 64, z: 200, yaw: 3.14, pitch: 0 }, { name: 'position' });

    // Write another teleport_confirm -> uses lastServerPosition
    mockBot._client.write('teleport_confirm', { teleportId: 101 });
    assert.strictEqual(writtenPackets.length, 2);
    assert.strictEqual(writtenPackets[1].params.x, 100);
    assert.strictEqual(writtenPackets[1].params.y, 64);
    assert.strictEqual(writtenPackets[1].params.z, 200);

    // Non-teleport packet passes through unmodified
    mockBot._client.write('chat', { message: 'hello' });
    assert.strictEqual(writtenPackets.length, 3);
    assert.strictEqual(writtenPackets[2].name, 'chat');
    assert.strictEqual(writtenPackets[2].params.message, 'hello');
  });

  await testAsync('1.6 minecraftData resolves 26.3 custom schema cleanly after applyCompatibilityShims', async () => {
    VersionResolver.applyCompatibilityShims();
    const mcDataModule = (await import('minecraft-data')).default;
    const data26 = mcDataModule('26.3');
    assert.ok(data26 !== null && data26 !== undefined, '26.3 dataset must resolve');
    assert.strictEqual(data26.version.minecraftVersion, '26.3');
    assert.strictEqual(data26.version.version, 777);
    assert.ok(data26.blocksByName['stone'] !== undefined, 'stone must exist');
    assert.ok(data26.blocksByName['spruce_log'] !== undefined, 'spruce_log must exist');
  });

  // =========================================================================
  // SECTION 2: WorldExecutor Disconnect Handling & Checkpointing
  // =========================================================================
  console.log('\n--- Section 2: WorldExecutor Disconnect Handling & Checkpointing ---');

  test('2.1 isDisconnectError accurately flags network error codes and socket state', () => {
    const executor = new WorldExecutor();

    // 1. Pause requested
    executor.pauseRequested = true;
    assert.strictEqual(executor.isDisconnectError(null, null), true, 'pauseRequested triggers true');
    executor.pauseRequested = false;

    // 2. Missing or dead bot entity
    assert.strictEqual(executor.isDisconnectError(null, null), true, 'Null bot is disconnect');
    assert.strictEqual(executor.isDisconnectError({}, null), true, 'Bot without entity is disconnect');
    assert.strictEqual(executor.isDisconnectError({ entity: null }, null), true, 'Bot with null entity is disconnect');

    // 3. Socket closed or ended
    const endedBot = { entity: { id: 1 }, _client: { ended: true, state: 'open' }, connected: true };
    assert.strictEqual(executor.isDisconnectError(endedBot, null), true, 'Bot with _client.ended is disconnect');

    const closedBot = { entity: { id: 1 }, _client: { ended: false, state: 'closed' }, connected: true };
    assert.strictEqual(executor.isDisconnectError(closedBot, null), true, 'Bot with _client.state=closed is disconnect');

    const disconnectedBot = { entity: { id: 1 }, _client: { ended: false, state: 'open' }, connected: false };
    assert.strictEqual(executor.isDisconnectError(disconnectedBot, null), true, 'Bot with connected=false is disconnect');

    // 4. Active bot with various error codes
    const activeBot = { entity: { id: 1 }, _client: { ended: false, state: 'open' }, connected: true };

    const econnresetErr = new Error('read ECONNRESET');
    econnresetErr.code = 'ECONNRESET';
    assert.strictEqual(executor.isDisconnectError(activeBot, econnresetErr), true, 'ECONNRESET is disconnect');

    const streamErr = new Error('Stream destroyed prematurely');
    streamErr.code = 'ERR_STREAM_DESTROYED';
    assert.strictEqual(executor.isDisconnectError(activeBot, streamErr), true, 'ERR_STREAM_DESTROYED is disconnect');

    const discCodeErr = new Error('Client disconnected');
    discCodeErr.code = 'ERR_DISCONNECTED';
    assert.strictEqual(executor.isDisconnectError(activeBot, discCodeErr), true, 'ERR_DISCONNECTED is disconnect');

    const discMsgErr = new Error('Server disconnect packet received');
    assert.strictEqual(executor.isDisconnectError(activeBot, discMsgErr), true, 'Message with disconnect is disconnect');

    // 5. Non-disconnect errors MUST return false
    const outOfReachErr = new Error('Block placement out of reach');
    assert.strictEqual(executor.isDisconnectError(activeBot, outOfReachErr), false, 'Out of reach is NOT disconnect');

    const invFullErr = new Error('Inventory is full');
    assert.strictEqual(executor.isDisconnectError(activeBot, invFullErr), false, 'Inventory full is NOT disconnect');

    assert.strictEqual(executor.isDisconnectError(activeBot, null), false, 'Normal state without error is false');
  });

  await testAsync('2.2 executeBatch gracefully pauses and checkpoints state on simulated ECONNRESET', async () => {
    const executor = new WorldExecutor();

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      _client: { ended: false, state: 'open' },
      connected: true,
      world: { getBlock: () => ({ name: 'air' }) },
      chat: () => {},
      setQuickBarSlot: () => {},
      inventory: { items: () => [] }
    };

    // Prepare 6 block operations
    const blocks = [
      { x: 10, y: 64, z: 10, fullBlockString: 'stone' },
      { x: 11, y: 64, z: 10, fullBlockString: 'stone' },
      { x: 12, y: 64, z: 10, fullBlockString: 'stone' }, // Injection point
      { x: 13, y: 64, z: 10, fullBlockString: 'stone' },
      { x: 14, y: 64, z: 10, fullBlockString: 'stone' },
      { x: 15, y: 64, z: 10, fullBlockString: 'oak_door[half=lower]' } // Phase 2 fragile block
    ];

    let executedOps = 0;
    executor.executeBlockChange = async (bot, x, y, z, fullBlockString, mode) => {
      executedOps++;
      if (executedOps === 3) {
        // Simulate unexpected TCP disconnect on 3rd operation
        mockBot._client.ended = true;
        const err = new Error('Connection reset by peer');
        err.code = 'ECONNRESET';
        throw err;
      }
    };

    const result = await executor.executeBatch(mockBot, blocks, {
      title: 'Test Batch ECONNRESET',
      delayBetweenOpsMs: 1
    });

    assert.strictEqual(result, false, 'Result must be false on disconnect');
    assert.strictEqual(executor.isBuilding, false, 'isBuilding must be false after pausing');
    assert.strictEqual(executor.buildProgress.phase, 'Pausiert', 'Phase must be "Pausiert"');

    // Verify Checkpoint integrity
    assert.ok(executor.pausedState !== null, 'pausedState checkpoint must exist');
    assert.strictEqual(executor.pausedState.phase, 1, 'Checkpoint must be phase 1');
    assert.strictEqual(executor.pausedState.completedOps, 2, '2 operations completed prior to disconnect');
    assert.strictEqual(executor.pausedState.phase1Index, 2, 'phase1Index points to the 3rd operation (index 2)');
    assert.strictEqual(executor.pausedState.title, 'Test Batch ECONNRESET');
  });

  await testAsync('2.3 resumeBuild picks up from checkpoint and survives ERR_STREAM_DESTROYED in Phase 2', async () => {
    const executor = new WorldExecutor();

    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      _client: { ended: false, state: 'open' },
      connected: true,
      world: { getBlock: () => ({ name: 'air' }) },
      chat: () => {},
      setQuickBarSlot: () => {},
      inventory: { items: () => [] }
    };

    const blocks = [
      { x: 1, y: 64, z: 1, name: 'cobblestone', fullBlockString: 'cobblestone' },
      { x: 2, y: 64, z: 1, name: 'cobblestone', fullBlockString: 'cobblestone' },
      { x: 3, y: 64, z: 1, name: 'oak_door', fullBlockString: 'oak_door[half=lower]' }, // Fragile 1
      { x: 4, y: 64, z: 1, name: 'oak_door', fullBlockString: 'oak_door[half=upper]' }  // Fragile 2
    ];

    // Seed checkpoint as if Phase 1 completed (2 cobblestones placed)
    executor.pausedState = {
      bot: mockBot,
      blocks,
      options: { title: 'Resume Test', delayBetweenOpsMs: 1 },
      phase: 2,
      phase1Index: 2,
      phase2Index: 0,
      completedOps: 2,
      totalOps: 4,
      title: 'Resume Test'
    };

    // Inject stream destroyed on 2nd fragile block (Phase 2 index 1)
    let phase2Count = 0;
    executor.executeBlockChange = async (bot, x, y, z, fullBlockString, mode) => {
      phase2Count++;
      if (phase2Count === 2) {
        mockBot._client.ended = true;
        const err = new Error('HTTP/2 Stream destroyed');
        err.code = 'ERR_STREAM_DESTROYED';
        throw err;
      }
    };

    const newBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      _client: { ended: false, state: 'open' },
      connected: true,
      world: { getBlock: () => ({ name: 'air' }) },
      chat: () => {},
      setQuickBarSlot: () => {},
      inventory: { items: () => [] }
    };

    const resumeResult = await executor.resumeBuild(newBot);
    assert.strictEqual(resumeResult, false, 'resumeResult must be false when paused again');
    assert.ok(executor.pausedState !== null);
    assert.strictEqual(executor.pausedState.phase, 2);
    assert.strictEqual(executor.pausedState.completedOps, 3); // 2 previous + 1 in phase 2
    assert.strictEqual(executor.pausedState.phase2Index, 1);
  });

  await testAsync('2.4 non-disconnect errors are cleanly re-thrown and do NOT create paused checkpoints', async () => {
    const executor = new WorldExecutor();
    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      _client: { ended: false, state: 'open' },
      connected: true
    };

    const blocks = [{ x: 1, y: 64, z: 1, fullBlockString: 'stone' }];

    executor.executeBlockChange = async () => {
      throw new Error('Specific Block Placement Forbidden');
    };

    let caughtErr = null;
    try {
      await executor.executeBatch(mockBot, blocks, { title: 'Error Test', delayBetweenOpsMs: 1 });
    } catch (err) {
      caughtErr = err;
    }

    assert.ok(caughtErr !== null, 'Non-disconnect error must be re-thrown');
    assert.strictEqual(caughtErr.message, 'Specific Block Placement Forbidden');
    assert.strictEqual(executor.pausedState, null, 'pausedState must remain null for non-disconnect errors');
  });

  await testAsync('2.5 multi-cycle network flapping: survives 3 successive disconnects and completes build', async () => {
    const executor = new WorldExecutor();
    const mockBot = {
      entity: { position: { x: 0, y: 64, z: 0 } },
      _client: { ended: false, state: 'open' },
      connected: true,
      world: { getBlock: () => ({ name: 'air' }) },
      chat: () => {},
      setQuickBarSlot: () => {},
      inventory: { items: () => [] }
    };

    const blocks = [
      { x: 0, y: 64, z: 0, name: 'stone', fullBlockString: 'stone' },
      { x: 1, y: 64, z: 0, name: 'stone', fullBlockString: 'stone' },
      { x: 2, y: 64, z: 0, name: 'stone', fullBlockString: 'stone' },
      { x: 3, y: 64, z: 0, name: 'stone', fullBlockString: 'stone' },
      { x: 4, y: 64, z: 0, name: 'stone', fullBlockString: 'stone' },
      { x: 5, y: 64, z: 0, name: 'oak_door', fullBlockString: 'oak_door[half=lower]' },
      { x: 6, y: 64, z: 0, name: 'oak_door', fullBlockString: 'oak_door[half=upper]' }
    ];

    let executionAttempts = 0;
    executor.executeBlockChange = async (bot, x, y, z, fullBlockString, mode) => {
      executionAttempts++;
      // Fail on attempt 2 (Phase 1 ECONNRESET)
      if (executionAttempts === 2) {
        const err = new Error('read ECONNRESET');
        err.code = 'ECONNRESET';
        throw err;
      }
      // Fail on attempt 4 (Phase 1 ERR_STREAM_DESTROYED)
      if (executionAttempts === 4) {
        const err = new Error('Stream destroyed');
        err.code = 'ERR_STREAM_DESTROYED';
        throw err;
      }
      // Fail on attempt 6 (Phase 2 ERR_DISCONNECTED)
      if (executionAttempts === 6) {
        const err = new Error('Client disconnected');
        err.code = 'ERR_DISCONNECTED';
        throw err;
      }
    };

    // Cycle 1: Start batch
    const res1 = await executor.executeBatch(mockBot, blocks, { title: 'Flap Test', delayBetweenOpsMs: 1 });
    assert.strictEqual(res1, false, 'Cycle 1 pauses on disconnect');
    assert.strictEqual(executor.pausedState.completedOps, 1);
    assert.strictEqual(executor.pausedState.phase, 1);

    // Cycle 2: First Resume
    const res2 = await executor.resumeBuild(mockBot);
    assert.strictEqual(res2, false, 'Cycle 2 pauses on 2nd disconnect');
    assert.strictEqual(executor.pausedState.completedOps, 2);
    assert.strictEqual(executor.pausedState.phase, 1);

    // Cycle 3: Second Resume (Op 2 succeeds, Op 3 fails on 3rd disconnect)
    const res3 = await executor.resumeBuild(mockBot);
    assert.strictEqual(res3, false, 'Cycle 3 pauses on 3rd disconnect');
    assert.strictEqual(executor.pausedState.completedOps, 3);
    assert.strictEqual(executor.pausedState.phase, 1);

    // Cycle 4: Third Resume (completes Ops 3, 4, 5, 6 to finish)
    const res4 = await executor.resumeBuild(mockBot);
    assert.strictEqual(res4, true, 'Cycle 4 completes successfully');
    assert.strictEqual(executor.pausedState, null, 'pausedState cleared on finish');
    assert.strictEqual(executor.buildProgress.phase, 'Abgeschlossen');
  });

  test('2.6 abort clears pausedState and transitions executor cleanly to Abgebrochen', () => {
    const executor = new WorldExecutor();
    executor.isBuilding = true;
    executor.pausedState = { phase: 1, completedOps: 5, totalOps: 10 };
    executor.buildProgress.active = true;
    executor.buildProgress.phase = 'Pausiert';

    executor.abort();

    assert.strictEqual(executor.isBuilding, false);
    assert.strictEqual(executor.abortRequested, true);
    assert.strictEqual(executor.pausedState, null, 'pausedState must be cleared on abort');
    assert.strictEqual(executor.buildProgress.active, false);
    assert.strictEqual(executor.buildProgress.phase, 'Abgebrochen');
  });

  // =========================================================================
  // SECTION 3: Core Utilities File-Lock Contention & Canonical Imports
  // =========================================================================
  console.log('\n--- Section 3: Core Utilities File-Lock Contention & Canonical Imports ---');

  const testDir = path.resolve('test', 'fixtures', 'challenger_m3_r3_stress');
  await fs.promises.mkdir(testDir, { recursive: true });

  try {
    await testAsync('3.1 atomicRenameWithRetry survives transient Windows file-lock contention (EPERM/EBUSY)', async () => {
      const src = path.join(testDir, 'retry_src.txt');
      const dst = path.join(testDir, 'retry_dst.txt');
      await fs.promises.writeFile(src, 'content-to-rename');

      let callCount = 0;
      const originalRename = fs.promises.rename;

      // Mock transient Windows file locking for 3 attempts
      fs.promises.rename = async function (oldP, newP) {
        if (oldP === src) {
          callCount++;
          if (callCount <= 3) {
            const err = new Error('resource busy or locked');
            err.code = callCount % 2 === 0 ? 'EBUSY' : 'EPERM';
            throw err;
          }
        }
        return originalRename.apply(this, [oldP, newP]);
      };

      try {
        await fileUtils.atomicRenameWithRetry(src, dst, {
          maxRetries: 5,
          baseDelayMs: 5,
          maxDelayMs: 20
        });

        assert.strictEqual(callCount, 4, 'Must retry 3 times and succeed on 4th attempt');
        assert.strictEqual(fs.existsSync(src), false, 'Source must be gone');
        assert.strictEqual(fs.existsSync(dst), true, 'Destination must exist');
        assert.strictEqual(await fs.promises.readFile(dst, 'utf8'), 'content-to-rename');
      } finally {
        fs.promises.rename = originalRename;
      }
    });

    await testAsync('3.2 atomicRenameWithRetry properly fails and unlinks temp file when retries are exhausted', async () => {
      const src = path.join(testDir, 'exhaust_src.txt');
      const dst = path.join(testDir, 'exhaust_dst.txt');
      await fs.promises.writeFile(src, 'content-to-exhaust');

      const originalRename = fs.promises.rename;
      fs.promises.rename = async function (oldP) {
        if (oldP === src) {
          const err = new Error('permanent lock');
          err.code = 'EBUSY';
          throw err;
        }
        return originalRename.apply(this, arguments);
      };

      try {
        let threw = false;
        try {
          await fileUtils.atomicRenameWithRetry(src, dst, {
            maxRetries: 3,
            baseDelayMs: 2,
            maxDelayMs: 10
          });
        } catch (err) {
          threw = true;
          assert.strictEqual(err.code, 'EBUSY');
        }

        assert.strictEqual(threw, true, 'Must throw after exhausting maxRetries');
        assert.strictEqual(fs.existsSync(src), false, 'Temporary src file must be cleaned up on failure');
      } finally {
        fs.promises.rename = originalRename;
      }
    });

    await testAsync('3.3 high-concurrency atomicWriteFileWithRetry stress: 50 concurrent operations', async () => {
      const tasks = [];
      const numTasks = 50;

      for (let i = 0; i < numTasks; i++) {
        const filePath = path.join(testDir, `concurrent_${i}.json`);
        const payload = JSON.stringify({ index: i, timestamp: Date.now(), rand: Math.random() });
        tasks.push(
          (async () => {
            await fileUtils.atomicWriteFileWithRetry(filePath, payload);
            const readBack = await fs.promises.readFile(filePath, 'utf8');
            assert.strictEqual(readBack, payload);
          })()
        );
      }

      await Promise.all(tasks);

      // Verify no stray .tmp files left in testDir
      const files = await fs.promises.readdir(testDir);
      const tmpFiles = files.filter(f => f.includes('.tmp.'));
      assert.strictEqual(tmpFiles.length, 0, 'Zero temporary files should remain in directory');
    });

    test('3.4 canonical exports verification: no artificial re-exports', () => {
      // 1. credentialVault.js MUST NOT export atomicRenameWithRetry
      assert.strictEqual(
        credentialVaultModule.atomicRenameWithRetry,
        undefined,
        'credentialVault.js must NOT export atomicRenameWithRetry'
      );
      assert.strictEqual(typeof credentialVaultModule.CredentialVault, 'function');
      assert.strictEqual(typeof credentialVaultModule.getSystemMasterKey, 'function');

      // 2. voxelCanvas.js MUST NOT export geometric or normalization helpers
      const forbiddenVoxelExports = [
        'BLOCK_ALIASES',
        'normalizeBlockName',
        'levenshteinDistance',
        'computeGreedyBoxes',
        'toBlockString',
        'swapMaterial',
        'computeDiff'
      ];
      for (const exp of forbiddenVoxelExports) {
        assert.strictEqual(
          voxelCanvasModule[exp],
          undefined,
          `voxelCanvas.js must NOT export '${exp}' (should only export VoxelCanvas)`
        );
      }
      assert.strictEqual(typeof voxelCanvasModule.VoxelCanvas, 'function');

      // 3. Verify canonical sources export their respective utilities cleanly
      assert.strictEqual(typeof fileUtils.atomicRenameWithRetry, 'function');
      assert.strictEqual(typeof fileUtils.atomicWriteFileWithRetry, 'function');
      assert.strictEqual(typeof fileUtils.atomicRenameWithRetrySync, 'function');
      assert.strictEqual(typeof fileUtils.atomicWriteFileSyncWithRetry, 'function');

      assert.strictEqual(typeof blockAliasesModule.BLOCK_ALIASES, 'object');
      assert.strictEqual(typeof blockAliasesModule.normalizeBlockName, 'function');

      assert.strictEqual(typeof greedyMesherModule.computeGreedyBoxes, 'function');
      assert.strictEqual(typeof greedyMesherModule.toBlockString, 'function');

      assert.strictEqual(typeof stringUtilsModule.levenshteinDistance, 'function');
    });

    test('3.5 atomicWriteFileSyncWithRetry and atomicRenameWithRetrySync handle nested paths and sync retries', () => {
      const nestedDir = path.join(testDir, 'nested', 'level2');
      const syncFile = path.join(nestedDir, 'sync_write.json');
      const payload = JSON.stringify({ sync: true, time: Date.now() });

      fileUtils.atomicWriteFileSyncWithRetry(syncFile, payload);
      assert.strictEqual(fs.existsSync(syncFile), true);
      assert.strictEqual(fs.readFileSync(syncFile, 'utf8'), payload);

      const syncRenamed = path.join(nestedDir, 'sync_renamed.json');
      fileUtils.atomicRenameWithRetrySync(syncFile, syncRenamed);
      assert.strictEqual(fs.existsSync(syncFile), false);
      assert.strictEqual(fs.existsSync(syncRenamed), true);
      assert.strictEqual(fs.readFileSync(syncRenamed, 'utf8'), payload);
    });

  } finally {
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  }

  console.log(`\n=== CHALLENGER M3 R3 EMPIRICAL STRESS TEST SUITE: ${passed}/${total} PASS ===`);
  if (passed !== total) {
    throw new Error(`Empirical stress test failed: ${passed}/${total} passed`);
  }
}

main().catch(err => {
  console.error('Fatal challenger error:', err);
  process.exit(1);
});
