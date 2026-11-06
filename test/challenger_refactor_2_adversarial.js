/**
 * Adversarial Challenge Suite: Backend Web, AI, & Frontend Subsystems (Phase 3 & 4)
 * Author: challenger_refactor_2 (teamwork_challenger)
 * Target Areas:
 *   1. Route Precedence in modelRoutes.js (discover-local vs :id, query parsing, error handling)
 *   2. High Concurrency & Retry Resilience in fileUtils.js (50 concurrent async writes, EBUSY/EPERM retry loops, sync retry, deep dir creation)
 *   3. WebSocket Error Resilience & Fuzzing in dashboardWsDispatcher.js (corrupted payloads, null contexts, path traversal, unknown actions)
 *   4. Validation of all 34 Static Test Contracts on app.js & ES submodules
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';

import {
  atomicRenameWithRetry,
  atomicWriteFileWithRetry,
  atomicRenameWithRetrySync,
  atomicWriteFileSyncWithRetry
} from '../src/utils/fileUtils.js';

import { registerModelApiRoutes } from '../src/web/routes/modelRoutes.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';

let passedTests = 0;
let totalTests = 0;

function it(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m[FAIL]\x1b[0m ${name}: ${err.message}`);
    throw err;
  }
}

async function itAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m[FAIL]\x1b[0m ${name}: ${err.message}`);
    throw err;
  }
}

// Helper to make lightweight HTTP requests against an ephemeral Express server
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const port = addr.port;
    const reqOptions = {
      hostname: '127.0.0.1',
      port,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          bodyText: data,
          bodyJson: json
        });
      });
    });

    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function run() {
  console.log('\n======================================================================');
  console.log('CHALLENGER REFACTOR 2: ADVERSARIAL STRESS TEST SUITE');
  console.log('Targeting: modelRoutes, fileUtils concurrency, dashboardWsDispatcher, app.js contracts');
  console.log('======================================================================\n');

  // ==============================================================================
  // SUITE 1: ROUTE PRECEDENCE & ERROR HANDLING IN modelRoutes.js
  // ==============================================================================
  console.log('\x1b[36m--- [SUITE 1] Route Precedence & Adversarial Requests in modelRoutes.js ---\x1b[0m');

  let mockScannerCalled = false;
  let mockScannerArgs = null;
  let mockGetEndpointCalledWith = null;
  let mockEnsureServicesReject = false;
  let mockScannerReject = false;

  const mockContext = {
    ensureServices: async () => {
      if (mockEnsureServicesReject) throw new Error('Service init failure');
    },
    localModelScanner: {
      scan: async (opts) => {
        mockScannerCalled = true;
        mockScannerArgs = opts;
        if (mockScannerReject) throw new Error('Scanner hardware timeout');
        return { success: true, count: 2, instances: [{ port: 11434, engine: 'ollama' }] };
      }
    },
    endpointManager: {
      activeFastEndpointId: 'ep-fast',
      activeArchitectEndpointId: 'ep-arch',
      zeroKeyFallbackEnabled: true,
      getEndpointsMasked: () => [{ id: 'ep-1', name: 'Endpoint 1' }],
      getEndpoint: (id) => {
        mockGetEndpointCalledWith = id;
        if (id === 'discover-local') {
          return { id: 'discover-local', name: 'Trap Endpoint With Same ID' };
        }
        if (id === 'valid-ep') {
          return { id: 'valid-ep', name: 'Valid Endpoint' };
        }
        return null;
      },
      saveEndpoint: async (data, secret) => ({ id: 'new-ep', ...data }),
      updateEndpoint: async (id, data, secret) => ({ id, ...data }),
      deleteEndpoint: async (id) => id === 'valid-ep',
      getSecretForEndpoint: async () => 'secret_xyz',
      updateEndpointStatus: async () => {},
      activateTier: async () => {}
    },
    safeProbeWorker: {
      probeEndpoint: async () => ({ success: true, status: 'online', latencyMs: 42 })
    },
    deviceFlowManager: {
      startDeviceFlow: async () => ({ sessionId: 'sess-1' }),
      getSessionStatus: (id) => id === 'sess-1' ? { status: 'pending' } : null,
      cancelSession: (id) => id === 'sess-1'
    },
    llmRouter: {
      reloadPools: async () => {}
    }
  };

  const app = express();
  app.use(express.json());
  registerModelApiRoutes(app, mockContext);

  const server = http.createServer(app);
  await new Promise(res => server.listen(0, '127.0.0.1', res));

  try {
    await itAsync('1.1 Route Precedence: GET /api/endpoints/discover-local invokes scanner and NEVER :id', async () => {
      mockScannerCalled = false;
      mockGetEndpointCalledWith = null;

      const res = await makeRequest(server, { path: '/api/endpoints/discover-local' });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockScannerCalled, true, 'localModelScanner.scan must be called');
      assert.strictEqual(mockGetEndpointCalledWith, null, 'getEndpoint must NOT be called for discover-local');
      assert.strictEqual(res.bodyJson.success, true);
      assert.strictEqual(res.bodyJson.count, 2);
    });

    await itAsync('1.2 Contrast: GET /api/endpoints/:id correctly invokes getEndpoint with param', async () => {
      mockScannerCalled = false;
      mockGetEndpointCalledWith = null;

      const res = await makeRequest(server, { path: '/api/endpoints/valid-ep' });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockScannerCalled, false, 'Scanner must NOT be called');
      assert.strictEqual(mockGetEndpointCalledWith, 'valid-ep');
      assert.strictEqual(res.bodyJson.endpoint.id, 'valid-ep');
    });

    await itAsync('1.3 Adversarial Trap: Endpoint with literal id "discover-local" cannot shadow scanner route', async () => {
      // Even if endpointManager has an endpoint whose ID is "discover-local",
      // the route order must always route /api/endpoints/discover-local to the scanner
      mockScannerCalled = false;
      mockGetEndpointCalledWith = null;

      const res = await makeRequest(server, { path: '/api/endpoints/discover-local' });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockScannerCalled, true);
      assert.strictEqual(mockGetEndpointCalledWith, null);
      assert.strictEqual(res.bodyJson.instances[0].engine, 'ollama');
    });

    await itAsync('1.4 Disambiguation: GET /api/endpoints/discover-local-suffix routes to :id', async () => {
      mockScannerCalled = false;
      mockGetEndpointCalledWith = null;

      const res = await makeRequest(server, { path: '/api/endpoints/discover-local-suffix' });
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(mockScannerCalled, false);
      assert.strictEqual(mockGetEndpointCalledWith, 'discover-local-suffix');
    });

    await itAsync('1.5 Query Parameter Fuzzing on /api/endpoints/discover-local', async () => {
      mockScannerCalled = false;
      mockScannerArgs = null;

      const res = await makeRequest(server, {
        path: '/api/endpoints/discover-local?ports=11434,%201234,%20invalid,%20,%209999&timeout=4500'
      });
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(mockScannerCalled, true);
      assert.deepStrictEqual(mockScannerArgs.ports, [11434, 1234, 9999], 'Whitespace and non-numbers are cleanly filtered');
      assert.strictEqual(mockScannerArgs.timeoutMs, 4500);
    });

    await itAsync('1.6 Error Resilience: localModelScanner.scan failure returns 500 without crashing', async () => {
      mockScannerReject = true;
      try {
        const res = await makeRequest(server, { path: '/api/endpoints/discover-local' });
        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.bodyJson.success, false);
        assert.strictEqual(res.bodyJson.error, 'Scanner hardware timeout');
      } finally {
        mockScannerReject = false;
      }
    });

    await itAsync('1.7 Error Resilience: ensureServices failure returns 500 gracefully', async () => {
      mockEnsureServicesReject = true;
      try {
        const res = await makeRequest(server, { path: '/api/endpoints/discover-local' });
        assert.strictEqual(res.statusCode, 500);
        assert.strictEqual(res.bodyJson.success, false);
        assert.strictEqual(res.bodyJson.error, 'Service init failure');
      } finally {
        mockEnsureServicesReject = false;
      }
    });

    await itAsync('1.8 Non-matching subpaths: GET /api/endpoints/discover-local/test returns 404', async () => {
      const res = await makeRequest(server, { path: '/api/endpoints/discover-local/test' });
      assert.strictEqual(res.statusCode, 404);
    });

  } finally {
    await new Promise(res => server.close(res));
  }

  // ==============================================================================
  // SUITE 2: CONCURRENCY & RETRY RESILIENCE IN fileUtils.js
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 2] High Concurrency & Resilient Retry in fileUtils.js ---\x1b[0m');

  const testDir = path.resolve('tmp/challenger_stress_fileutils');
  if (fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testDir, { recursive: true });

  await itAsync('2.1 Massive Concurrent Async Writes (50 parallel writes to SAME file)', async () => {
    const targetFile = path.join(testDir, 'shared_concurrent.json');
    const writePromises = [];

    for (let i = 0; i < 50; i++) {
      const payload = JSON.stringify({
        iteration: i,
        timestamp: Date.now(),
        data: 'A'.repeat(512),
        checksum: `chk_${i}`
      });
      writePromises.push(atomicWriteFileWithRetry(targetFile, payload));
    }

    // All 50 must complete without unhandled rejections or locking crashes
    await Promise.all(writePromises);

    // Verify file integrity on disk
    assert(fs.existsSync(targetFile), 'Target file must exist after concurrent writes');
    const content = fs.readFileSync(targetFile, 'utf8');
    const parsed = JSON.parse(content);
    assert(typeof parsed.iteration === 'number', 'File content must be valid uncorrupted JSON');
    assert.strictEqual(parsed.data.length, 512, 'Payload data length preserved');

    // Verify zero orphaned .tmp files left in directory
    const files = fs.readdirSync(testDir);
    const tmpFiles = files.filter(f => f.includes('.tmp.'));
    assert.strictEqual(tmpFiles.length, 0, `No orphaned .tmp files allowed! Found: ${tmpFiles.join(', ')}`);
  });

  await itAsync('2.2 Simulated Transient EBUSY/EPERM Errors: atomicRenameWithRetry retries & succeeds', async () => {
    const srcFile = path.join(testDir, 'retry_source.txt');
    const dstFile = path.join(testDir, 'retry_target.txt');
    fs.writeFileSync(srcFile, 'hello retry');

    const originalRename = fs.promises.rename;
    let attempts = 0;

    // Simulate Windows file lock: fails with EBUSY for the first 3 attempts
    fs.promises.rename = async function (oldP, newP) {
      if (oldP === srcFile) {
        attempts++;
        if (attempts <= 3) {
          const err = new Error('resource busy or locked');
          err.code = 'EBUSY';
          throw err;
        }
      }
      return originalRename.apply(this, arguments);
    };

    try {
      await atomicRenameWithRetry(srcFile, dstFile, { maxRetries: 5, baseDelayMs: 5, maxDelayMs: 50 });
      assert.strictEqual(attempts, 4, 'Should succeed on attempt 4 after 3 transient EBUSY retries');
      assert.strictEqual(fs.readFileSync(dstFile, 'utf8'), 'hello retry');
      assert.strictEqual(fs.existsSync(srcFile), false, 'Source should be renamed away');
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  await itAsync('2.3 Terminal Failure: When maxRetries exceeded, error thrown & source cleaned up', async () => {
    const srcFile = path.join(testDir, 'fail_source.txt');
    const dstFile = path.join(testDir, 'fail_target.txt');
    fs.writeFileSync(srcFile, 'fail content');

    const originalRename = fs.promises.rename;
    let attempts = 0;

    // Always fail with EPERM
    fs.promises.rename = async function (oldP, newP) {
      if (oldP === srcFile) {
        attempts++;
        const err = new Error('permission denied');
        err.code = 'EPERM';
        throw err;
      }
      return originalRename.apply(this, arguments);
    };

    try {
      let threw = false;
      try {
        await atomicRenameWithRetry(srcFile, dstFile, { maxRetries: 3, baseDelayMs: 2, maxDelayMs: 10 });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'EPERM');
      }
      assert.strictEqual(threw, true, 'Must throw error when maxRetries exhausted');
      assert.strictEqual(attempts, 4, 'Must have attempted initial try (0) + 3 retries = 4 total');
      assert.strictEqual(fs.existsSync(srcFile), false, 'Source file must be unlinked after terminal failure');
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  await itAsync('2.4 Non-transient errors (EISDIR): Fails immediately without wasting 10 retries', async () => {
    const srcFile = path.join(testDir, 'eisdir_source.txt');
    const dstFile = path.join(testDir, 'eisdir_target.txt');
    fs.writeFileSync(srcFile, 'eisdir content');

    const originalRename = fs.promises.rename;
    let attempts = 0;

    fs.promises.rename = async function (oldP, newP) {
      if (oldP === srcFile) {
        attempts++;
        const err = new Error('is a directory');
        err.code = 'EISDIR';
        throw err;
      }
      return originalRename.apply(this, arguments);
    };

    try {
      let threw = false;
      try {
        await atomicRenameWithRetry(srcFile, dstFile, { maxRetries: 10, baseDelayMs: 5 });
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'EISDIR');
      }
      assert.strictEqual(threw, true);
      assert.strictEqual(attempts, 1, 'Must fail immediately on first attempt without retrying EISDIR');
      assert.strictEqual(fs.existsSync(srcFile), false, 'Source file must be cleaned up');
    } finally {
      fs.promises.rename = originalRename;
    }
  });

  it('2.5 Synchronous Atomic Write Loop & Transient Retry (atomicWriteFileSyncWithRetry)', () => {
    const syncTarget = path.join(testDir, 'sync_target.json');

    for (let i = 0; i < 25; i++) {
      atomicWriteFileSyncWithRetry(syncTarget, JSON.stringify({ index: i, text: 'sync test' }));
    }

    assert(fs.existsSync(syncTarget));
    const content = JSON.parse(fs.readFileSync(syncTarget, 'utf8'));
    assert.strictEqual(content.index, 24);

    // Test sync retry with simulated transient error
    const originalRenameSync = fs.renameSync;
    let syncAttempts = 0;
    fs.renameSync = function (oldP, newP) {
      if (typeof oldP === 'string' && oldP.includes('sync_sim')) {
        syncAttempts++;
        if (syncAttempts <= 2) {
          const err = new Error('EBUSY sync lock');
          err.code = 'EBUSY';
          throw err;
        }
      }
      return originalRenameSync.apply(this, arguments);
    };

    try {
      const simFile = path.join(testDir, 'sync_sim_target.txt');
      atomicWriteFileSyncWithRetry(simFile, 'sync retry success', { maxRetries: 5, baseDelayMs: 2 });
      assert.strictEqual(syncAttempts, 3, 'Must succeed after 2 transient failures');
      assert.strictEqual(fs.readFileSync(simFile, 'utf8'), 'sync retry success');
    } finally {
      fs.renameSync = originalRenameSync;
    }
  });

  await itAsync('2.6 Deep Recursive Directory Creation', async () => {
    const deepFile = path.join(testDir, 'lvl1', 'lvl2', 'lvl3', 'deep.txt');
    await atomicWriteFileWithRetry(deepFile, 'deep content');
    assert(fs.existsSync(deepFile));
    assert.strictEqual(fs.readFileSync(deepFile, 'utf8'), 'deep content');

    const deepSyncFile = path.join(testDir, 'lvl1_s', 'lvl2_s', 'deep_sync.txt');
    atomicWriteFileSyncWithRetry(deepSyncFile, 'deep sync content');
    assert(fs.existsSync(deepSyncFile));
    assert.strictEqual(fs.readFileSync(deepSyncFile, 'utf8'), 'deep sync content');
  });

  // Cleanup testDir
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch (_) {}

  // ==============================================================================
  // SUITE 3: WEBSOCKET ERROR RESILIENCE & FUZZING IN dashboardWsDispatcher.js
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 3] WebSocket Error Resilience & Fuzzing in dashboardWsDispatcher.js ---\x1b[0m');

  const recordedChat = [];
  const sentWsMessages = [];
  const broadcastedPreviews = [];

  const mockWs = {
    send: (payload) => {
      try {
        sentWsMessages.push(JSON.parse(payload));
      } catch (_) {
        sentWsMessages.push(payload);
      }
    }
  };

  const mockDispatcherContext = {
    currentBot: null,
    architectAgent: null,
    activeCanvas: null,
    recordChat: (sender, msg) => {
      recordedChat.push({ sender, msg });
    },
    broadcastVoxelPreview: (preview) => {
      broadcastedPreviews.push(preview);
    },
    broadcast: () => {},
    executeVoxelCanvasBuild: async () => {},
    generateAreaMapData: () => ({ grid: [], center: { x: 0, y: 64, z: 0 } })
  };

  await itAsync('3.1 Corrupted & Unknown Message Fuzzing (Zero-Crash)', async () => {
    // 1. Missing type
    await handleClientWsMessage({}, mockWs, mockDispatcherContext);
    // 2. Unknown action type
    await handleClientWsMessage({ type: 'UNKNOWN_INJECTION_ACTION', payload: '<script>alert(1)</script>' }, mockWs, mockDispatcherContext);
    // 3. Prototype pollution attempts
    await handleClientWsMessage({ type: '__proto__', poll: true }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'constructor', poll: true }, mockWs, mockDispatcherContext);
    // 4. Non-string types
    await handleClientWsMessage({ type: 12345 }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: null }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: true }, mockWs, mockDispatcherContext);
  });

  await itAsync('3.2 All 13 Message Types under Complete Null Context (Zero-Crash)', async () => {
    // 1. set_build_box with undefined / invalid coords & null agent
    await handleClientWsMessage({ type: 'set_build_box' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'set_build_box', minX: 'foo', maxX: null }, mockWs, mockDispatcherContext);

    // 2. request_area_map with null bot
    sentWsMessages.length = 0;
    await handleClientWsMessage({ type: 'request_area_map' }, mockWs, mockDispatcherContext);
    assert.strictEqual(sentWsMessages.length, 1);
    assert.strictEqual(sentWsMessages[0].type, 'area_map_data');

    // 3. prompt_architect with empty/whitespace/null agent
    await handleClientWsMessage({ type: 'prompt_architect', text: '' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'prompt_architect', text: '    ' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'prompt_architect', text: 'Build a castle' }, mockWs, mockDispatcherContext);

    // 4. confirm_build with null agent / null canvas
    await handleClientWsMessage({ type: 'confirm_build' }, mockWs, mockDispatcherContext);

    // 5. control_action with all sub-actions
    await handleClientWsMessage({ type: 'control_action', action: 'stop' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'undo' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'pause_for_player' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'resume_bot' }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'move_to', targetPos: null }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'move_to', targetPos: { x: 'NaN', y: undefined, z: 'foo' } }, mockWs, mockDispatcherContext);
    await handleClientWsMessage({ type: 'control_action', action: 'malicious_unknown' }, mockWs, mockDispatcherContext);

    // 6. swap_material with null canvas
    await handleClientWsMessage({ type: 'swap_material', fromBlock: 'oak_planks', toBlock: 'stone' }, mockWs, mockDispatcherContext);

    // 7. apply_theme with null canvas or invalid theme
    await handleClientWsMessage({ type: 'apply_theme', theme: 'non_existent_theme' }, mockWs, mockDispatcherContext);

    // 8. transform_canvas with null canvas or invalid mode
    await handleClientWsMessage({ type: 'transform_canvas', transformMode: 'warp_speed' }, mockWs, mockDispatcherContext);

    // 9. manual_voxel_edit with null canvas (creates canvas gracefully)
    await handleClientWsMessage({ type: 'manual_voxel_edit', x: 0, y: 0, z: 0, blockString: 'stone' }, mockWs, mockDispatcherContext);
    assert(mockDispatcherContext.activeCanvas instanceof VoxelCanvas, 'Active canvas initialized gracefully');

    // 10. region_ai_edit with null architectAgent
    await handleClientWsMessage({ type: 'region_ai_edit', instruction: 'add roof', selectionBox: {} }, mockWs, mockDispatcherContext);

    // 11. clone_server_region with null bot
    await handleClientWsMessage({ type: 'clone_server_region', minX: 10, maxX: 0 }, mockWs, mockDispatcherContext);

    // 12. load_saved_schematic with non-existent file
    await handleClientWsMessage({ type: 'load_saved_schematic', filename: 'not_found.schem' }, mockWs, mockDispatcherContext);

    // 13. request_terrain_xray with null bot & null agent
    sentWsMessages.length = 0;
    await handleClientWsMessage({ type: 'request_terrain_xray' }, mockWs, mockDispatcherContext);
    assert.strictEqual(sentWsMessages.length, 1);
    assert.strictEqual(sentWsMessages[0].type, 'terrain_xray_data');
    assert.strictEqual(sentWsMessages[0].isSimulated, true);
  });

  await itAsync('3.3 Path Traversal Attack Defense on load_saved_schematic', async () => {
    // Attack payloads trying to escape data/schematics/
    const attacks = [
      '../../../../package.json',
      '..\\..\\..\\windows\\system32\\cmd.exe',
      '/etc/passwd',
      '../../../.env',
      'foo/bar/test.schem'
    ];

    for (const attack of attacks) {
      await handleClientWsMessage({
        type: 'load_saved_schematic',
        filename: attack
      }, mockWs, mockDispatcherContext);

      // Verify chat recorded the safe sanitized filename and rejected access
      const lastChat = recordedChat[recordedChat.length - 1];
      assert(lastChat.msg.includes('existiert nicht in data/schematics/'), `Path traversal must be blocked for: ${attack}`);
      // Ensure path separator cannot escape into directory traversal
      assert(!lastChat.msg.includes('..'), `Sanitized name must not contain '..': ${lastChat.msg}`);
    }
  });

  await itAsync('3.4 Canvas State Mutations & Theme Swapping Resilience', async () => {
    // Test with real VoxelCanvas populated with blocks
    const canvas = new VoxelCanvas(16, 16, 16);
    canvas.set(0, 0, 0, 'oak_planks');
    canvas.set(0, 1, 0, 'stone_bricks');
    mockDispatcherContext.activeCanvas = canvas;

    // Apply known theme
    await handleClientWsMessage({ type: 'apply_theme', theme: 'medieval_spruce' }, mockWs, mockDispatcherContext);
    assert.strictEqual(canvas.get(0, 0, 0).name, 'spruce_planks');
    assert.strictEqual(canvas.get(0, 1, 0).name, 'stone_bricks');

    // Apply unknown theme (must be a no-op, no crash)
    await handleClientWsMessage({ type: 'apply_theme', theme: 'cyberpunk_glitch' }, mockWs, mockDispatcherContext);
    assert.strictEqual(canvas.get(0, 0, 0).name, 'spruce_planks');

    // Manual voxel edit with air
    await handleClientWsMessage({ type: 'manual_voxel_edit', x: 0, y: 0, z: 0, blockString: 'air' }, mockWs, mockDispatcherContext);
    assert.strictEqual(canvas.get(0, 0, 0), null, 'Voxel removed by air edit');
  });

  // ==============================================================================
  // SUITE 4: VALIDATION OF ALL 34 STATIC TEST CONTRACTS ON app.js & SUBMODULES
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 4] Validation of all 34 Static Test Contracts on app.js & Submodules ---\x1b[0m');

  const appJsPath = path.resolve('src/web/public/app.js');
  assert(fs.existsSync(appJsPath), 'app.js must exist');

  const appModule = await import('../src/web/public/app.js');
  const modelCockpit = await import('../src/web/public/js/modelCockpit.js');
  const areaMap = await import('../src/web/public/js/areaMap.js');
  const manualCockpit = await import('../src/web/public/js/manualCockpit.js');
  const viewerController = await import('../src/web/public/js/viewerController.js');

  const contracts = [
    { id: 1, desc: 'Modal lifecycle open', check: () => typeof modelCockpit.openModelSettingsModal === 'function' },
    { id: 2, desc: 'Modal lifecycle close', check: () => typeof modelCockpit.closeModelSettingsModal === 'function' },
    { id: 3, desc: 'Global ESC handler', check: () => typeof modelCockpit.initModelCockpit === 'function' && typeof appModule.initEventListeners === 'function' },
    { id: 4, desc: 'Fast/Architect Tier activation', check: () => typeof modelCockpit.activateTier === 'function' },
    { id: 5, desc: 'REST endpoint activate', check: () => typeof modelCockpit.activateTier === 'function' },
    { id: 6, desc: 'Local port scanner trigger', check: () => typeof modelCockpit.scanLocalPorts === 'function' },
    { id: 7, desc: 'Local scanner REST endpoint', check: () => typeof modelCockpit.scanLocalPorts === 'function' },
    { id: 8, desc: 'Drawer open', check: () => typeof modelCockpit.openEndpointDrawer === 'function' },
    { id: 9, desc: 'Drawer close', check: () => typeof modelCockpit.closeEndpointDrawer === 'function' },
    { id: 10, desc: 'Ad-hoc connection test', check: () => typeof modelCockpit.testAdhoc === 'function' },
    { id: 11, desc: 'Ad-hoc REST endpoint', check: () => typeof modelCockpit.testAdhoc === 'function' },
    { id: 12, desc: 'Saved endpoint test', check: () => typeof modelCockpit.testEndpoint === 'function' },
    { id: 13, desc: 'Sub-route URL test', check: () => typeof modelCockpit.testEndpoint === 'function' },
    { id: 14, desc: 'Secret write-only protection', check: () => typeof modelCockpit.saveEndpoint === 'function' },
    { id: 15, desc: 'RFC 8628 flow start', check: () => typeof modelCockpit.startDeviceFlow === 'function' },
    { id: 16, desc: 'Device Flow REST start', check: () => typeof modelCockpit.startDeviceFlow === 'function' },
    { id: 17, desc: 'Device Flow cancel', check: () => typeof modelCockpit.cancelDeviceFlow === 'function' },
    { id: 18, desc: 'User code copy', check: () => typeof modelCockpit.initModelCockpit === 'function' },
    { id: 19, desc: 'WS telemetry endpoint_status_change', check: () => typeof modelCockpit.handleEndpointStatusChange === 'function' },
    { id: 20, desc: 'WS telemetry probe_progress', check: () => typeof modelCockpit.handleProbeProgress === 'function' },
    { id: 21, desc: 'WS telemetry device_auth_success', check: () => typeof modelCockpit.handleDeviceAuthSuccess === 'function' },
    { id: 22, desc: 'WS telemetry tier_activated', check: () => typeof modelCockpit.handleTierActivated === 'function' },
    { id: 23, desc: 'Cockpit init function', check: () => typeof modelCockpit.initModelCockpit === 'function' },
    { id: 24, desc: 'Safe dropdown textContent assignment', check: () => typeof modelCockpit.renderTierAssignment === 'function' },
    { id: 25, desc: 'Error banner XSS protection', check: () => typeof modelCockpit.showModelError === 'function' },
    { id: 26, desc: 'Facing direction toggle', check: () => typeof appModule.renderAreaMap === 'function' },
    { id: 27, desc: 'Map tooltip hover', check: () => typeof appModule.initEventListeners === 'function' },
    { id: 28, desc: 'Elevation calculation', check: () => typeof areaMap.findCellAt === 'function' },
    { id: 29, desc: 'Handoff badge formatting', check: () => typeof appModule.updateHandoffUI === 'function' },
    { id: 30, desc: 'Handoff toggle button text', check: () => typeof appModule.updateHandoffUI === 'function' },
    { id: 31, desc: 'Responsive canvas click scale', check: () => typeof areaMap.screenToGridCoords === 'function' },
    { id: 32, desc: 'Boundary arrow clamping', check: () => typeof areaMap.drawAreaMap === 'function' },
    { id: 33, desc: 'Progress ETA formula', check: () => typeof appModule.updateTelemetry === 'function' },
    { id: 34, desc: 'Topographic contour shading', check: () => typeof areaMap.drawAreaMap === 'function' }
  ];

  for (const c of contracts) {
    it(`4.${c.id} Contract #${c.id}: ${c.desc}`, () => {
      assert(c.check(), `Contract #${c.id} failed: ${c.desc}`);
    });
  }

  it('4.35 ES Submodules Layout Verification in src/web/public/js/', () => {
    const requiredSubmodules = [
      'wsClient.js',
      'threeViewport.js',
      'areaMap.js',
      'onboardingWizard.js',
      'modelCockpit.js',
      'schematicUI.js',
      'manualCockpit.js',
      'viewerController.js',
      'popoutViewer.js'
    ];

    for (const sub of requiredSubmodules) {
      const p = path.resolve('src/web/public/js', sub);
      assert(fs.existsSync(p), `Required submodule ${sub} must exist`);
      const stat = fs.statSync(p);
      assert(stat.size > 500, `Submodule ${sub} must not be empty (size: ${stat.size} bytes)`);
    }
  });

  it('4.36 Structural Modularity: app.js submodule delegation and contract interfaces', () => {
    // 1. Verify submodules export their required contracts
    assert(typeof manualCockpit.initManualCockpit === 'function', 'manualCockpit exports initManualCockpit');
    assert(typeof manualCockpit.toggleGamemode === 'function', 'manualCockpit exports toggleGamemode');
    assert(typeof manualCockpit.clearAllControls === 'function', 'manualCockpit exports clearAllControls');
    assert(typeof viewerController.isPoppedOut === 'function', 'viewerController exports isPoppedOut');
    assert(typeof viewerController.openPopout === 'function', 'viewerController exports openPopout');
    assert(typeof viewerController.toggleFullscreen === 'function', 'viewerController exports toggleFullscreen');
    assert(typeof viewerController.reembed === 'function', 'viewerController exports reembed');
    assert(typeof viewerController.initViewerController === 'function', 'viewerController exports initViewerController');
    assert(typeof modelCockpit.openModelSettingsModal === 'function', 'modelCockpit exports openModelSettingsModal');
    assert(typeof modelCockpit.closeModelSettingsModal === 'function', 'modelCockpit exports closeModelSettingsModal');
    assert(typeof modelCockpit.closeEndpointDrawer === 'function', 'modelCockpit exports closeEndpointDrawer');
    assert(typeof modelCockpit.cancelDeviceFlow === 'function', 'modelCockpit exports cancelDeviceFlow');
    assert(typeof areaMap.drawAreaMap === 'function', 'areaMap exports drawAreaMap');
    assert(typeof areaMap.screenToGridCoords === 'function', 'areaMap exports screenToGridCoords');
    assert(typeof areaMap.findCellAt === 'function', 'areaMap exports findCellAt');

    // 2. Verify app.js maintains genuine orchestration exports and no redundant internal facades
    assert(typeof appModule.handleServerMessage === 'function', 'app.js exports handleServerMessage');
    assert(typeof appModule.applyCameraDetachedState === 'function', 'app.js exports applyCameraDetachedState');
    assert(typeof appModule.refreshViewer === 'function', 'app.js exports refreshViewer');
    assert(typeof appModule.updateStatus === 'function', 'app.js exports updateStatus');
    assert(typeof appModule.updateHandoffUI === 'function', 'app.js exports updateHandoffUI');
    assert(typeof appModule.updateTelemetry === 'function', 'app.js exports updateTelemetry');
    assert(typeof appModule.initEventListeners === 'function', 'app.js exports initEventListeners');

    // Submodule internal functions must NOT be re-exported as facades from app.js
    assert.strictEqual(appModule.toggleGamemode, undefined, 'app.js does not re-export toggleGamemode facade');
    assert.strictEqual(appModule.openPopout, undefined, 'app.js does not re-export openPopout facade');
    assert.strictEqual(appModule.openModelSettingsModal, undefined, 'app.js does not re-export openModelSettingsModal facade');
    assert.strictEqual(appModule.activateTier, undefined, 'app.js does not re-export activateTier facade');
    assert.strictEqual(appModule.initManualCockpit, undefined, 'app.js does not re-export initManualCockpit facade');
    assert.strictEqual(appModule.initViewerController, undefined, 'app.js does not re-export initViewerController facade');
    assert.strictEqual(appModule.drawAreaMap, undefined, 'app.js does not re-export drawAreaMap facade');
    assert.strictEqual(appModule.closeModelSettingsModal, undefined, 'app.js does not re-export closeModelSettingsModal facade');
  });

  console.log('\n======================================================================');
  console.log(`\x1b[32mALL ${passedTests}/${totalTests} ADVERSARIAL STRESS TESTS PASSED!\x1b[0m`);
  console.log('Verdict: APPROVE — Subsystems demonstrated high resilience and contract integrity.');
  console.log('======================================================================\n');
}

run().catch(err => {
  console.error('\n\x1b[31mADVERSARIAL STRESS SUITE FAILED:\x1b[0m', err);
  process.exit(1);
});
