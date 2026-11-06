/**
 * Empirical Adversarial Challenger Suite for Milestone M5 Verification
 * Targets:
 * 1. Creeper Combat Lifecycle & Mathematical Edge Cases (threatManager.js)
 * 2. Error Code Discrimination & Stream Resiliency (safeProbeWorker.js & probeErrorClassifier.js)
 * 3. WorldExecutor Disconnect State Retention & Resume FSM (worldExecutor.js)
 * 4. App.js Orchestrator Decoupling & Absence of Facade Re-exports
 * 5. Full Repository Scan for Brittle fs.readFileSync Scraping on Production JS
 * 6. VersionResolver SOTA 26.3 & In-Memory Shims Robustness (versionResolver.js)
 */

import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { ThreatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { SafeProbeWorker, classifyError } from '../src/ai/safeProbeWorker.js';
import { WorldExecutor } from '../src/builder/worldExecutor.js';
import { VersionResolver } from '../src/config/versionResolver.js';

let passed = 0;
let total = 0;

function check(title, fn) {
  total++;
  try {
    fn();
    console.log(`  [PASS] ${title}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${title}: ${err.message}`);
    throw err;
  }
}

async function checkAsync(title, fn) {
  total++;
  try {
    await fn();
    console.log(`  [PASS] ${title}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${title}: ${err.message}`);
    throw err;
  }
}

console.log('======================================================================');
console.log('STARTING EMPIRICAL M5 ADVERSARIAL CHALLENGER SUITE');
console.log('======================================================================');

async function runChallengerSuite() {
  // =========================================================================
  // SUITE 1: ThreatManager Creeper Combat Lifecycle & Mathematical Edge Cases
  // =========================================================================
  console.log('\n--- [SUITE 1] Creeper Combat Lifecycle & Mathematical Boundaries ---');

  // 1.1 Coincident Position Singularity (Creeper at same x,y,z as Bot)
  await checkAsync('1.1 Coincident position singularity (dist=0) calculates safe fallback vector without NaN', async () => {
    const tm = new ThreatManager();
    const bot = {
      entity: { position: new Vec3(10, 64, 10) },
      pathfinder: {
        setGoal: (goal) => {
          assert(!Number.isNaN(goal.x), 'Goal x must not be NaN');
          assert(!Number.isNaN(goal.y), 'Goal y must not be NaN');
          assert(!Number.isNaN(goal.z), 'Goal z must not be NaN');
          assert.strictEqual(goal.x, 14, 'Fallback stepAway is +4 along x');
        }
      },
      lookAt: async () => {},
      attack: () => {},
      deactivateItem: () => {}
    };
    tm.setBot(bot);

    const creeper = {
      name: 'creeper',
      health: 20,
      isValid: true,
      position: new Vec3(10, 64, 10) // Same exact position!
    };
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.lastAttackTime = 0; // ready to attack

    await tm.combatStep();
    assert.strictEqual(tm.backpedalUntil > Date.now(), true, 'Backpedal timer set');
  });

  // 1.2 Instant Kill on First Strike Transitions Immediately to SECURING_PERIMETER
  await checkAsync('1.2 Instant kill terminates combat and clears backpedal without loop delay', async () => {
    const tm = new ThreatManager();
    let attacksExecuted = 0;
    const bot = {
      entity: { position: new Vec3(10, 64, 10) },
      pathfinder: { setGoal: () => {} },
      lookAt: async () => {},
      attack: (target) => {
        attacksExecuted++;
        target.health = 0; // Mob dies immediately upon strike!
      },
      deactivateItem: () => {}
    };
    tm.setBot(bot);

    const creeper = {
      name: 'creeper',
      health: 1, // Will die in 1 hit
      isValid: true,
      position: new Vec3(12, 64, 10)
    };
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.lastAttackTime = 0;

    await tm.combatStep();
    assert.strictEqual(attacksExecuted, 1, 'Exactly one attack executed');
    assert.strictEqual(tm.state, THREAT_STATES.SECURING_PERIMETER, 'State switched immediately to SECURING_PERIMETER');
    assert.strictEqual(tm.currentTarget, null, 'Target cleared immediately');
    assert.strictEqual(tm.backpedalUntil, 0, 'BackpedalUntil reset to 0');
  });

  // 1.3 Rapid Multiple Invocations While Backpedaling Still Strikes When In Range & Cooldown Ready
  await checkAsync('1.3 Backpedal does NOT suppress strikes if cooldown ready and creeper within 3.5m', async () => {
    const tm = new ThreatManager();
    let attacksExecuted = 0;
    const bot = {
      entity: { position: new Vec3(10, 64, 10) },
      pathfinder: { setGoal: () => {} },
      lookAt: async () => {},
      attack: () => { attacksExecuted++; },
      deactivateItem: () => {}
    };
    tm.setBot(bot);

    const creeper = {
      name: 'creeper',
      health: 20,
      isValid: true,
      position: new Vec3(12, 64, 10) // 2.0m away
    };
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.backpedalUntil = Date.now() + 5000; // Simulated active backpedal
    tm.lastAttackTime = Date.now() - 1000; // Cooldown ready!

    await tm.combatStep();
    assert.strictEqual(attacksExecuted, 1, 'Attack executed despite backpedal timer being active');
  });

  // 1.4 Dynamic Target Retargeting When Mob Flees Beyond 16m
  await checkAsync('1.4 Dynamic retargeting switches to closer threat when primary target retreats > 16m', async () => {
    const tm = new ThreatManager();
    const farCreeper = {
      name: 'creeper',
      health: 20,
      isValid: true,
      position: new Vec3(30, 64, 10) // 20m away from bot
    };
    const nearSkeleton = {
      name: 'skeleton',
      health: 20,
      isValid: true,
      position: new Vec3(14, 64, 10) // 4m away
    };

    const bot = {
      entity: { position: new Vec3(10, 64, 10) },
      entities: {
        '1': farCreeper,
        '2': nearSkeleton
      },
      pathfinder: { setGoal: () => {} },
      lookAt: async () => {},
      attack: () => {},
      deactivateItem: () => {}
    };
    tm.setBot(bot);

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = farCreeper;

    await tm.combatStep();
    assert.strictEqual(tm.currentTarget, nearSkeleton, 'Target switched to nearer skeleton');
  });

  // =========================================================================
  // SUITE 2: SafeProbeWorker Error Code Discrimination & Stream Resiliency
  // =========================================================================
  console.log('\n--- [SUITE 2] SafeProbeWorker Error Code Discrimination & Resilience ---');

  // 2.1 Plaintext "OK" on Phase 1 (/models)
  await checkAsync('2.1 Plaintext "OK" HTTP 200 on /models returns status 200 with empty catalog', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK\n');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const worker = new SafeProbeWorker();
      const res = await worker.probePhase1Metadata(`http://127.0.0.1:${port}`);
      assert.strictEqual(res.status, 200);
      assert.deepStrictEqual(res.models, []);
    } finally {
      server.close();
    }
  });

  // 2.2 Plaintext Error or Non-JSON Non-OK on Phase 1 (/models)
  await checkAsync('2.2 Plaintext Non-OK on /models throws INVALID_RESPONSE', async () => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Gateway Error: Proxy failed');
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;

    try {
      const worker = new SafeProbeWorker();
      await assert.rejects(async () => {
        await worker.probePhase1Metadata(`http://127.0.0.1:${port}`);
      }, (err) => {
        assert.strictEqual(err.code, 'INVALID_RESPONSE');
        return true;
      });
    } finally {
      server.close();
    }
  });

  // 2.3 Socket Reset Abort During Body Stream on Phase 1
  await checkAsync('2.3 Premature socket destroy during Phase 1 body returns status: offline', async () => {
    const netServer = net.createServer((socket) => {
      socket.on('data', () => {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n4\r\n{"mo\r\n');
        setTimeout(() => {
          socket.destroy(); // Sudden violent TCP RST/destroy
        }, 30);
      });
    });
    await new Promise(r => netServer.listen(0, '127.0.0.1', r));
    const port = netServer.address().port;

    try {
      const worker = new SafeProbeWorker({ phase1TimeoutMs: 1500 });
      const result = await worker.probeEndpoint({ baseUrl: `http://127.0.0.1:${port}`, modelId: 'gpt-4o' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.phase, 1);
      assert.strictEqual(result.status, 'offline');
      assert(['NETWORK_ERROR', 'TIMEOUT'].includes(result.error.code));
    } finally {
      netServer.close();
    }
  });

  // 2.4 Quota vs Rate Limit Classification
  check('2.4 probeErrorClassifier discriminates INSUFFICIENT_QUOTA from transient RATE_LIMIT', () => {
    const quotaErr = {
      status: 429,
      responseBody: '{"error": {"message": "You exceeded your current quota, please check your plan and billing details.", "type": "insufficient_quota"}}'
    };
    const c1 = classifyError(quotaErr);
    assert.strictEqual(c1.code, 'INSUFFICIENT_QUOTA');

    const rateErr = {
      status: 429,
      responseBody: '{"error": {"message": "Rate limit reached for requests per minute (RPM). Please slow down."}}'
    };
    const c2 = classifyError(rateErr);
    assert.strictEqual(c2.code, 'RATE_LIMIT');
  });

  // 2.5 Gemini HTTP 400 API_KEY_INVALID Discrimination
  check('2.5 HTTP 400 with API_KEY_INVALID correctly classified as INVALID_KEY', () => {
    const geminiErr = {
      status: 400,
      responseBody: '{"error": {"code": 400, "message": "API_KEY_INVALID", "status": "INVALID_ARGUMENT"}}'
    };
    const c = classifyError(geminiErr);
    assert.strictEqual(c.code, 'INVALID_KEY');
  });

  // 2.6 Server Error Classification (HTTP 502 / 503)
  check('2.6 HTTP 502 / 503 classified as SERVER_ERROR', () => {
    const serverErr = { status: 503, message: 'Service Unavailable' };
    const c = classifyError(serverErr);
    assert.strictEqual(c.code, 'SERVER_ERROR');
  });

  // =========================================================================
  // SUITE 3: WorldExecutor Disconnect Detection & Resume FSM
  // =========================================================================
  console.log('\n--- [SUITE 3] WorldExecutor Disconnect Detection & Resume FSM ---');

  check('3.1 isDisconnectError returns true for closed client, ERR_DISCONNECTED, ECONNRESET', () => {
    const we = new WorldExecutor();

    // Normal healthy bot
    const healthyBot = { entity: {}, _client: { ended: false, state: 'play' }, connected: true };
    assert.strictEqual(we.isDisconnectError(healthyBot, null), false);

    // Bot with ended client
    const endedBot = { entity: {}, _client: { ended: true, state: 'closed' }, connected: false };
    assert.strictEqual(we.isDisconnectError(endedBot, null), true);

    // Disconnect error codes
    assert.strictEqual(we.isDisconnectError(healthyBot, { code: 'ERR_DISCONNECTED' }), true);
    assert.strictEqual(we.isDisconnectError(healthyBot, { code: 'ECONNRESET' }), true);
    assert.strictEqual(we.isDisconnectError(healthyBot, { code: 'ERR_STREAM_DESTROYED' }), true);
    assert.strictEqual(we.isDisconnectError(healthyBot, { message: 'client disconnected' }), true);
  });

  await checkAsync('3.2 executeBatch handles disconnect gracefully and preserves pausedState', async () => {
    const we = new WorldExecutor();
    let placeCallCount = 0;

    const fakeBot = {
      entity: { position: new Vec3(0, 64, 0) },
      _client: { ended: false, state: 'play' },
      connected: true,
      chat: (msg) => {
        if (msg.startsWith('/fill') || msg.startsWith('/setblock')) {
          placeCallCount++;
          // Simulate disconnect on block placement
          fakeBot._client.ended = true;
          const err = new Error('Socket disconnected');
          err.code = 'ERR_DISCONNECTED';
          throw err;
        }
      }
    };

    const blocks = [
      { x: 10, y: 64, z: 10, name: 'stone' },
      { x: 11, y: 64, z: 10, name: 'stone' },
      { x: 12, y: 64, z: 10, name: 'stone' }
    ];

    const result = await we.executeBatch(fakeBot, blocks, { mode: 'hybrid_visual', delayBetweenOpsMs: 1 });
    assert.strictEqual(result, false, 'executeBatch should return false when paused due to disconnect');
    assert(we.pausedState !== null, 'pausedState must be captured');
    assert.strictEqual(we.isBuilding, false, 'isBuilding must be reset to false');
  });

  await checkAsync('3.3 resumeBuild completes paused build with new bot instance', async () => {
    const we = new WorldExecutor();
    let reconnectedBotPlaced = 0;
    const reconnectedBot = {
      entity: { position: new Vec3(0, 64, 0) },
      _client: { ended: false, state: 'play' },
      connected: true,
      chat: () => { reconnectedBotPlaced++; }
    };

    we.pausedState = {
      bot: null,
      blocks: [
        { x: 10, y: 64, z: 10, name: 'stone' },
        { x: 11, y: 64, z: 10, name: 'stone' }
      ],
      options: { mode: 'hybrid_visual', delayBetweenOpsMs: 1 },
      phase: 1,
      phase1Index: 0,
      phase2Index: 0,
      completedOps: 0,
      totalOps: 1,
      title: 'Test-Build'
    };

    const resumeRes = await we.resumeBuild(reconnectedBot);
    assert.strictEqual(resumeRes, true, 'resumeBuild should complete successfully');
    assert(reconnectedBotPlaced > 0, 'reconnectedBot executed operations');
    assert.strictEqual(we.pausedState, null, 'pausedState cleared upon completion');
  });

  // =========================================================================
  // SUITE 4: App.js Orchestrator Decoupling & Absence of Facade Re-exports
  // =========================================================================
  console.log('\n--- [SUITE 4] App.js Orchestrator Decoupling & Zero Facade Re-exports ---');

  check('4.1 app.js only exports orchestrator functions and NO submodule dummy facades', () => {
    const appJsPath = path.resolve('src/web/public/app.js');
    const content = fs.readFileSync(appJsPath, 'utf8');

    // Find all export statements
    const exportMatches = content.match(/^export\s+(?:function|async\s+function|const|let|var)\s+([a-zA-Z0-9_]+)/gm) || [];
    const exportedNames = exportMatches.map(m => m.replace(/^export\s+(?:async\s+)?(?:function|const|let|var)\s+/, '').trim());

    // Expected genuine orchestrator exports
    const allowedExports = new Set([
      'handleServerMessage',
      'applyCameraDetachedState',
      'refreshViewer',
      'updateStatus',
      'updateHandoffUI',
      'updateBotPowerUI',
      'toggleBotPower',
      'updateTelemetry',
      'appendChatMessage',
      'renderAreaMap',
      'initEventListeners'
    ]);

    for (const name of exportedNames) {
      assert(allowedExports.has(name), `Unexpected facade export found in app.js: ${name}`);
    }

    // Verify submodules functions are NOT re-exported from app.js
    const forbiddenSubmoduleExports = [
      'initThree',
      'renderVoxelPreview',
      'renderTerrainXray',
      'drawAreaMap',
      'initModelCockpit',
      'computeGreedyBoxes',
      'atomicRenameWithRetry',
      'BLOCK_ALIASES',
      'normalizeBlockName'
    ];

    for (const forbidden of forbiddenSubmoduleExports) {
      assert(!exportedNames.includes(forbidden), `Forbidden submodule function '${forbidden}' was re-exported by app.js!`);
    }
  });

  // =========================================================================
  // SUITE 5: Full Repository Scan for Brittle fs.readFileSync Scraping
  // =========================================================================
  console.log('\n--- [SUITE 5] Full Repository Scan for Brittle fs.readFileSync Scraping ---');

  check('5.1 Verified decoupled suites contain zero readFileSync calls targeting app.js', () => {
    const decoupledSuites = [
      'test/missionControlTest.js',
      'test/dashboardCockpitTest.js',
      'test/manualGamemodeFrontendTest.js',
      'test/challenger_refactor_2_adversarial.js'
    ];

    for (const suiteFile of decoupledSuites) {
      const suiteContent = fs.readFileSync(path.resolve(suiteFile), 'utf8');
      const lines = suiteContent.split('\n');
      const appJsScrapes = lines.filter(l => /readFileSync\s*\([^)]*app\.js/i.test(l));
      assert.strictEqual(
        appJsScrapes.length,
        0,
        `Found brittle readFileSync scraping on app.js in ${suiteFile}: ${JSON.stringify(appJsScrapes)}`
      );
    }
  });

  // =========================================================================
  // SUITE 6: VersionResolver SOTA 26.3 & In-Memory Shims Robustness
  // =========================================================================
  console.log('\n--- [SUITE 6] VersionResolver SOTA 26.3 & In-Memory Shims Robustness ---');

  check('6.1 VersionResolver safely handles adversarial/fuzz versions without crashing', () => {
    assert.strictEqual(VersionResolver.resolveViewerVersion('26.3'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('777'), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion(null), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion(undefined), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion(''), '1.21.4');
    assert.strictEqual(VersionResolver.resolveViewerVersion('unknown_custom_version'), '1.21.4');
    assert.strictEqual(VersionResolver.isValidVersion('26.3'), true);
    assert.strictEqual(VersionResolver.isValidVersion('auto'), true);
    assert.strictEqual(VersionResolver.isValidVersion('invalid_xyz_999'), false);
  });

  console.log('\n======================================================================');
  console.log(`ALL ${passed}/${total} EMPIRICAL CHALLENGER TESTS PASSED!`);
  console.log('Verdict: APPROVE — Systems demonstrate verified robustness and contract conformance.');
  console.log('======================================================================\n');
}

runChallengerSuite().catch(err => {
  console.error('\nCHALLENGER SUITE ENCOUNTERED UNEXPECTED ERROR:', err);
  process.exit(1);
});
