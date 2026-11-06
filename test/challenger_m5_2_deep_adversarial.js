import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';

import { ThreatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { SafeProbeWorker, classifyError } from '../src/ai/safeProbeWorker.js';
import { WorldExecutor } from '../src/builder/worldExecutor.js';

let passed = 0;
let total = 0;

function check(desc, fn) {
  total++;
  try {
    fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

async function checkAsync(desc, fn) {
  total++;
  try {
    await fn();
    console.log(`  [PASS] ${desc}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

class MockAdversarialBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.entity = {
      id: 1,
      name: 'bot',
      position: options.position ? options.position.clone() : new Vec3(0, 64, 0),
      yaw: 0,
      pitch: 0,
      height: 1.62
    };
    this.health = options.health ?? 20;
    this.entities = {};
    this.equipped = {};
    this.attackLog = [];
    this.lookAtLog = [];
    this.activeItem = false;
    this.connected = true;
    this._client = { ended: false, state: 'play' };
    this.goals = [];
    this.pathfinder = options.pathfinder !== undefined ? options.pathfinder : {
      setGoal: (goal) => { this.goals.push(goal); },
      stop: () => {},
      isMoving: () => false
    };
  }

  async lookAt(pos) {
    this.lookAtLog.push(pos);
  }

  attack(entity) {
    this.attackLog.push({ target: entity, time: Date.now() });
    if (typeof entity.health === 'number') {
      entity.health -= 7;
      if (entity.health <= 0) {
        entity.isValid = false;
      }
    }
  }

  activateItem(offhand = false) {
    this.activeItem = true;
  }

  deactivateItem() {
    this.activeItem = false;
  }

  async equip(item, dest) {
    this.equipped[dest] = item;
  }
}

async function runAdversarialHarness() {
  console.log('======================================================================');
  console.log('CHALLENGER 2 DEEP ADVERSARIAL VERIFICATION HARNESS');
  console.log('======================================================================');

  // -------------------------------------------------------------------------
  // SECTION 1: Creeper Combat Lifecycle Adversarial Verification
  // -------------------------------------------------------------------------
  console.log('\n--- [SECTION 1] Creeper Combat Lifecycle & Corner Cases ---');

  await checkAsync('1.1 Coincident coordinates (distance = 0.0) yields safe stepAway without NaN', async () => {
    const bot = new MockAdversarialBot({ position: new Vec3(10, 64, 10) });
    const tm = new ThreatManager(bot);
    const creeper = {
      id: 2,
      name: 'creeper',
      position: new Vec3(10, 64, 10), // Exactly same coordinates!
      health: 20,
      isValid: true
    };

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.lastAttackTime = 0; // ready to attack

    await tm.combatStep();

    assert.strictEqual(bot.attackLog.length, 1, 'Attack executed despite distance=0');
    assert.strictEqual(creeper.health, 13, 'Creeper damaged');
    assert(tm.backpedalUntil > Date.now(), 'Backpedal activated');
    assert(bot.goals.length > 0, 'Pathfinder goal dispatched');
    const goal = bot.goals[0];
    assert(!isNaN(goal.x) && !isNaN(goal.y) && !isNaN(goal.z), 'Goal coordinates must be valid numbers (no NaN)');
    assert.strictEqual(goal.x, 14, 'Stepped away along fallback axis');
  });

  await checkAsync('1.2 Instant fatal strike resets target, clears backpedal and sets state to SECURING_PERIMETER', async () => {
    const bot = new MockAdversarialBot({ position: new Vec3(10, 64, 10) });
    const tm = new ThreatManager(bot);
    const weakCreeper = {
      id: 3,
      name: 'creeper',
      position: new Vec3(12, 64, 10), // dist = 2m
      health: 5, // <= 7 damage => instantly dead
      isValid: true
    };

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = weakCreeper;
    tm.lastAttackTime = 0;

    await tm.combatStep();

    assert.strictEqual(weakCreeper.health <= 0, true, 'Creeper was neutralized');
    assert.strictEqual(tm.currentTarget, null, 'currentTarget was cleared');
    assert.strictEqual(tm.backpedalUntil, 0, 'backpedalUntil was reset to 0');
    assert.strictEqual(tm.state, THREAT_STATES.SECURING_PERIMETER, 'State transitioned to SECURING_PERIMETER');
  });

  await checkAsync('1.3 Backpedal active does NOT block strike when cooldown expires and creeper is within range', async () => {
    const bot = new MockAdversarialBot({ position: new Vec3(10, 64, 10) });
    const tm = new ThreatManager(bot);
    const creeper = {
      id: 4,
      name: 'creeper',
      position: new Vec3(12, 64, 10), // dist = 2m
      health: 20,
      isValid: true
    };

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.lastAttackTime = Date.now() - 1000; // cooldown expired (1000ms > 625ms)
    tm.backpedalUntil = Date.now() + 5000; // currently in backpedal window

    await tm.combatStep();

    assert.strictEqual(bot.attackLog.length, 1, 'Strike executed despite active backpedal');
    assert.strictEqual(creeper.health, 13, 'Creeper received damage');
  });

  await checkAsync('1.4 Missing pathfinder (bot.pathfinder = null) executes attack without error', async () => {
    const bot = new MockAdversarialBot({ position: new Vec3(10, 64, 10), pathfinder: null });
    const tm = new ThreatManager(bot);
    const creeper = {
      id: 5,
      name: 'creeper',
      position: new Vec3(12, 64, 10),
      health: 20,
      isValid: true
    };

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;
    tm.lastAttackTime = 0;

    await tm.combatStep();
    assert.strictEqual(bot.attackLog.length, 1, 'Strike executed even when bot.pathfinder is null');
    assert.strictEqual(creeper.health, 13, 'Creeper damaged');
  });

  await checkAsync('1.5 Non-creeper mob (zombie) does NOT trigger 4m backpedal after attack', async () => {
    const bot = new MockAdversarialBot({ position: new Vec3(10, 64, 10) });
    const tm = new ThreatManager(bot);
    const zombie = {
      id: 6,
      name: 'zombie',
      position: new Vec3(12, 64, 10),
      health: 20,
      isValid: true
    };

    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = zombie;
    tm.lastAttackTime = 0;

    await tm.combatStep();

    assert.strictEqual(bot.attackLog.length, 1, 'Strike executed against zombie');
    assert.strictEqual(tm.backpedalUntil, 0, 'No backpedal scheduled for zombie');
  });

  // -------------------------------------------------------------------------
  // SECTION 2: SafeProbeWorker Error Code Discrimination & Parsing
  // -------------------------------------------------------------------------
  console.log('\n--- [SECTION 2] SafeProbeWorker Error Discrimination ---');

  await checkAsync('2.1 Plaintext "OK" on /models returns status 200 and empty models array', async () => {
    const worker = new SafeProbeWorker();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      const result = await worker.probePhase1Metadata(`http://127.0.0.1:${port}`);
      assert.strictEqual(result.status, 200);
      assert.deepStrictEqual(result.models, []);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await checkAsync('2.2 Plaintext Non-OK on /models throws typed INVALID_RESPONSE', async () => {
    const worker = new SafeProbeWorker();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Not Allowed or Some HTML/Plain');
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      let threw = false;
      try {
        await worker.probePhase1Metadata(`http://127.0.0.1:${port}`);
      } catch (err) {
        threw = true;
        assert.strictEqual(err.code, 'INVALID_RESPONSE');
      }
      assert.strictEqual(threw, true, 'Must throw INVALID_RESPONSE on non-OK plaintext');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  await checkAsync('2.3 Socket reset during stream read throws with preserved network error code', async () => {
    const worker = new SafeProbeWorker();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"data": [');
      // Abruptly destroy socket halfway
      req.socket.destroy();
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    try {
      let threw = false;
      try {
        await worker.probePhase1Metadata(`http://127.0.0.1:${port}`);
      } catch (err) {
        threw = true;
        const classified = classifyError(err);
        assert(classified.code === 'NETWORK_ERROR' || classified.code === 'CONNECTION_REFUSED');
      }
      assert.strictEqual(threw, true, 'Must throw on abrupt socket destruction');
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  check('2.4 classifyError taxonomy exhaustive discrimination', () => {
    // 401
    assert.strictEqual(classifyError({ status: 401 }).code, 'INVALID_KEY');
    // 400 with API_KEY_INVALID
    assert.strictEqual(classifyError({ status: 400, responseBody: 'API_KEY_INVALID' }).code, 'INVALID_KEY');
    // 403
    assert.strictEqual(classifyError({ status: 403 }).code, 'FORBIDDEN');
    // 404
    assert.strictEqual(classifyError({ status: 404 }).code, 'MODEL_NOT_FOUND');
    // 429 rate limit vs quota
    assert.strictEqual(classifyError({ status: 429 }).code, 'RATE_LIMIT');
    assert.strictEqual(classifyError({ status: 429, responseBody: 'insufficient_quota' }).code, 'INSUFFICIENT_QUOTA');
    assert.strictEqual(classifyError({ status: 429, responseBody: { error: { message: 'Out of credits' } } }).code, 'INSUFFICIENT_QUOTA');
    // 500, 502, 503
    assert.strictEqual(classifyError({ status: 500 }).code, 'SERVER_ERROR');
    assert.strictEqual(classifyError({ status: 502 }).code, 'SERVER_ERROR');
    assert.strictEqual(classifyError({ status: 503 }).code, 'SERVER_ERROR');
    // ECONNREFUSED
    assert.strictEqual(classifyError({ code: 'ECONNREFUSED' }).code, 'CONNECTION_REFUSED');
    // TIMEOUT / AbortError
    assert.strictEqual(classifyError({ name: 'AbortError' }).code, 'TIMEOUT');
    assert.strictEqual(classifyError({ code: 'ETIMEDOUT' }).code, 'TIMEOUT');
    // INVALID_RESPONSE
    assert.strictEqual(classifyError({ code: 'INVALID_RESPONSE' }).code, 'INVALID_RESPONSE');
  });

  // -------------------------------------------------------------------------
  // SECTION 3: WorldExecutor Disconnect Handling & Recovery
  // -------------------------------------------------------------------------
  console.log('\n--- [SECTION 3] WorldExecutor Disconnect Handling ---');

  check('3.1 isDisconnectError structured identification', () => {
    const we = new WorldExecutor();
    const mockBot = { entity: { position: new Vec3(0, 64, 0) }, _client: { ended: false, state: 'play' }, connected: true };

    // Clean connected state
    assert.strictEqual(we.isDisconnectError(mockBot, null), false);

    // Bot client ended
    const endedBot = { entity: { position: new Vec3(0, 64, 0) }, _client: { ended: true, state: 'closed' }, connected: false };
    assert.strictEqual(we.isDisconnectError(endedBot, null), true);

    // Bot entity missing
    assert.strictEqual(we.isDisconnectError({ entity: null }, null), true);

    // Error codes
    assert.strictEqual(we.isDisconnectError(mockBot, { code: 'ERR_DISCONNECTED' }), true);
    assert.strictEqual(we.isDisconnectError(mockBot, { code: 'ECONNRESET' }), true);
    assert.strictEqual(we.isDisconnectError(mockBot, { code: 'ERR_STREAM_DESTROYED' }), true);
    assert.strictEqual(we.isDisconnectError(mockBot, { message: 'connection disconnected by remote server' }), true);

    // Unrelated operational errors should NOT be treated as disconnects
    assert.strictEqual(we.isDisconnectError(mockBot, new TypeError('Invalid block state')), false);
    assert.strictEqual(we.isDisconnectError(mockBot, new RangeError('Out of bounds')), false);
  });

  await checkAsync('3.2 executeBatch handles disconnect gracefully and returns false with pausedState captured', async () => {
    const we = new WorldExecutor();
    const disconnectBot = {
      entity: { position: new Vec3(0, 64, 0) },
      _client: { ended: false, state: 'play' },
      connected: true,
      chat: (msg) => {
        if (msg.startsWith('/setblock') || msg.startsWith('/fill')) {
          disconnectBot._client.ended = true;
          const err = new Error('Remote host disconnected socket');
          err.code = 'ERR_DISCONNECTED';
          throw err;
        }
      }
    };

    const blocks = [
      { x: 5, y: 64, z: 5, name: 'stone' },
      { x: 6, y: 64, z: 5, name: 'stone' }
    ];

    const res = await we.executeBatch(disconnectBot, blocks, { mode: 'hybrid_visual', delayBetweenOpsMs: 1 });
    assert.strictEqual(res, false, 'executeBatch must return false on disconnect');
    assert(we.pausedState !== null, 'pausedState must be preserved');
    assert.strictEqual(we.isBuilding, false, 'isBuilding must be reset to false');
    assert.strictEqual(we.buildProgress.phase, 'Pausiert', 'Phase must be set to Pausiert');
  });

  // -------------------------------------------------------------------------
  // SECTION 4: App.js Orchestrator Decoupling & Absence of Facade Re-exports
  // -------------------------------------------------------------------------
  console.log('\n--- [SECTION 4] App.js Orchestrator Decoupling & Submodules ---');

  await checkAsync('4.1 app.js only exports orchestrator functions and NO submodule pass-through facades', async () => {
    const appModule = await import('../src/web/public/app.js');
    const exports = Object.keys(appModule);

    // List of forbidden facade re-exports that belong solely to submodules
    const forbiddenSubmoduleExports = [
      'connectWebSocket', 'sendWS', 'getWebSocketState', // wsClient
      'renderVoxelPreview', 'renderTerrainXray', 'setXrayActive', 'handleVoxelDelta', 'openSwapModal', // threeViewport
      'drawAreaMap', 'screenToGridCoords', 'findCellAt', // areaMap
      'initModelCockpit', 'closeModelSettingsModal', 'closeEndpointDrawer', 'cancelDeviceFlow', // modelCockpit
      'loadSchematicsList', 'initSchematics', // schematicUI
      'initManualCockpit', 'handleGamemodeState', 'isGamemode', 'exitGamemode', // manualCockpit
      'isPoppedOut', 'initViewerController', 'openPopout', 'reembed' // viewerController
    ];

    for (const forbidden of forbiddenSubmoduleExports) {
      assert(!exports.includes(forbidden), `app.js must NOT re-export internal submodule function '${forbidden}'`);
    }

    // Required authentic orchestrator exports
    assert(typeof appModule.handleServerMessage === 'function', 'app.js exports handleServerMessage');
    assert(typeof appModule.applyCameraDetachedState === 'function', 'app.js exports applyCameraDetachedState');
    assert(typeof appModule.refreshViewer === 'function', 'app.js exports refreshViewer');
    assert(typeof appModule.updateStatus === 'function', 'app.js exports updateStatus');
    assert(typeof appModule.updateHandoffUI === 'function', 'app.js exports updateHandoffUI');
    assert(typeof appModule.updateBotPowerUI === 'function', 'app.js exports updateBotPowerUI');
    assert(typeof appModule.toggleBotPower === 'function', 'app.js exports toggleBotPower');
    assert(typeof appModule.updateTelemetry === 'function', 'app.js exports updateTelemetry');
    assert(typeof appModule.appendChatMessage === 'function', 'app.js exports appendChatMessage');
    assert(typeof appModule.renderAreaMap === 'function', 'app.js exports renderAreaMap');
    assert(typeof appModule.initEventListeners === 'function', 'app.js exports initEventListeners');
  });

  check('4.2 All 9 submodules exist in src/web/public/js/ with distinct responsibilities', () => {
    const submodules = [
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
    for (const sub of submodules) {
      const fullPath = path.resolve('src/web/public/js', sub);
      assert(fs.existsSync(fullPath), `Submodule ${sub} exists`);
      const stat = fs.statSync(fullPath);
      assert(stat.size > 200, `Submodule ${sub} has substantive size (${stat.size} bytes)`);
    }
  });

  // -------------------------------------------------------------------------
  // SECTION 5: Elimination of Brittle fs.readFileSync Scraping Across Tests
  // -------------------------------------------------------------------------
  console.log('\n--- [SECTION 5] Elimination of Brittle fs.readFileSync Scraping ---');

  check('5.1 Standard test suites under npm test contain ZERO fs.readFileSync on app.js', () => {
    const standardSuites = [
      'test/dryRunTest.js',
      'test/missionControlTest.js',
      'test/improvementsTest.js',
      'test/milestone1SurvivalTest.js',
      'test/milestone2SurvivalTest.js',
      'test/credentialVaultTest.js',
      'test/modelConnectionTest.js',
      'test/deviceFlowAndBffTest.js',
      'test/settingsAndOnboardingTest.js',
      'test/dashboardCockpitTest.js',
      'test/msaAuthIntegrationTest.js',
      'test/builderModularizationTest.js',
      'test/scaffoldManagerTest.js',
      'test/viewerStateTranslatorTest.js',
      'test/manualGamemodeBackendTest.js',
      'test/manualGamemodeWsTest.js',
      'test/manualGamemodeFrontendTest.js',
      'test/manualGamemodeIntegrationTest.js',
      'test/viewerFullscreenAndPopoutTest.js'
    ];

    const appJsScrapes = [];
    for (const suite of standardSuites) {
      const content = fs.readFileSync(path.resolve(suite), 'utf8');
      if (/fs\.readFileSync\([^)]*app\.js/i.test(content)) {
        appJsScrapes.push(suite);
      }
    }

    assert.strictEqual(
      appJsScrapes.length,
      0,
      `Standard suites scraping app.js via fs.readFileSync: ${JSON.stringify(appJsScrapes)}`
    );
  });

  check('5.2 Target refactor suites (missionControlTest, dashboardCockpitTest, manualGamemodeFrontendTest, challenger_refactor_2_adversarial) contain zero app.js source scraping', () => {
    const targetSuites = [
      'test/missionControlTest.js',
      'test/dashboardCockpitTest.js',
      'test/manualGamemodeFrontendTest.js',
      'test/challenger_refactor_2_adversarial.js'
    ];

    for (const file of targetSuites) {
      const content = fs.readFileSync(path.resolve(file), 'utf8');
      assert(!/fs\.readFileSync\([^)]*app\.js/i.test(content), `${file} must not scrape app.js`);
      // Assert no arbitrary line-count assertions
      assert(!/assert.*length\s*<\s*1000/i.test(content), `${file} must not contain arbitrary < 1000 line-count assertion`);
    }
  });

  console.log('\n======================================================================');
  console.log(`ALL ${passed}/${total} DEEP ADVERSARIAL CHALLENGER TESTS PASSED!`);
  console.log('Verdict: APPROVE');
  console.log('======================================================================\n');
}

runAdversarialHarness().catch(err => {
  console.error('\n[FATAL] Adversarial test failure:', err);
  process.exit(1);
});
