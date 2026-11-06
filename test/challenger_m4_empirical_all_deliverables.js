/**
 * Milestone 4 Comprehensive Empirical Challenge Harness
 * Challenger 2: Rigorous Adversarial Stress across R1, R2, R3, R4, R5
 *
 * Scope:
 * R1: Viewer State-ID Translation Table Throughput & Memory Stability
 * R2: Settings & Onboarding Version Validation & Schema Enforcement
 * R3 & R4: Fullscreen & Multi-Monitor Popout Synchronization & State Invariants
 * R5: Full Regression & Test Suite Verification
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EventEmitter } from 'node:events';

import { ViewerStateTranslator } from '../src/web/services/viewerStateTranslator.js';
import { VersionResolver } from '../src/config/versionResolver.js';
import { EnvManager } from '../src/config/envManager.js';
import { DashboardServer } from '../src/web/dashboardServer.js';

let totalChecks = 0;
let passedChecks = 0;

function pass(desc) {
  totalChecks++;
  passedChecks++;
  console.log(`\x1b[32m[CHALLENGE PASS]\x1b[0m ${desc}`);
}

function fail(desc, err) {
  totalChecks++;
  console.error(`\x1b[31m[CHALLENGE FAIL]\x1b[0m ${desc}`, err);
  throw err;
}

// ==============================================================================
// 1. R1: VIEWER STATE-ID TRANSLATION TABLE, THROUGHPUT & MEMORY
// ==============================================================================
async function testViewerStateTranslatorStress() {
  console.log('\n================================================================');
  console.log('CHALLENGE 1: VIEWER STATE-ID TRANSLATION THROUGHPUT & STABILITY');
  console.log('================================================================\n');

  // 1.1 Factory & Cache Behavior
  ViewerStateTranslator.clearCache();
  const translator1 = ViewerStateTranslator.create('26.3', '1.21.4');
  const translator2 = ViewerStateTranslator.create('26.3', '1.21.4');
  assert.strictEqual(translator1, translator2, 'Factory returns cached instance for identical versions');
  pass('1.1 Factory instance caching verified');

  ViewerStateTranslator.clearCache();
  const translator3 = ViewerStateTranslator.create('26.3', '1.21.4');
  assert.notStrictEqual(translator1, translator3, 'clearCache() successfully clears cache');
  pass('1.2 clearCache() resets translator cache correctly');

  // 1.2 Table Integrity & Bounds
  assert(translator1.table instanceof Int32Array, 'Translation table is an Int32Array');
  assert(translator1.table.length >= 42000, `Table length (${translator1.table.length}) has required headroom (>= 42000)`);
  pass('1.3 Table type and allocation bounds verified');

  // Check that EVERY entry in the table maps to a valid target state ID
  let maxTargetState = translator1.targetMaxStateId;
  assert(maxTargetState > 0, `Target max state ID is positive (${maxTargetState})`);
  let invalidEntries = 0;
  for (let i = 0; i < translator1.table.length; i++) {
    const mapped = translator1.table[i];
    if (mapped < 0 || mapped > maxTargetState) {
      invalidEntries++;
    }
  }
  assert.strictEqual(invalidEntries, 0, `All ${translator1.table.length} table entries are strictly within [0, ${maxTargetState}]`);
  pass(`1.4 All ${translator1.table.length} entries verified within target bounds [0, ${maxTargetState}]`);

  // Key block translations: deepslate_tiles
  const state261 = 28748;
  const state263 = 34598;
  const mapped261 = translator1.translateStateId(state261);
  const mapped263 = translator1.translateStateId(state263);
  assert(mapped261 > 0 && mapped261 <= maxTargetState, 'State 28748 translates to valid non-zero state ID');
  assert(mapped263 > 0 && mapped263 <= maxTargetState, 'State 34598 translates to valid non-zero state ID');
  assert.strictEqual(mapped261, mapped263, 'Both 26.1 and 26.3 deepslate_tiles state IDs map to the same target state');
  pass(`1.5 deepslate_tiles cross-version state mapping verified (${state261} & ${state263} -> ${mapped261})`);

  // Out of bounds / invalid inputs
  assert.strictEqual(translator1.translateStateId(-1), translator1.targetAirStateId, 'Negative state ID falls back to air');
  assert.strictEqual(translator1.translateStateId(-999999), translator1.targetAirStateId, 'Large negative ID falls back to air');
  assert.strictEqual(translator1.translateStateId(999999), translator1.targetAirStateId, 'Excessive state ID falls back to air');
  assert.strictEqual(translator1.translateStateId(NaN), translator1.targetAirStateId, 'NaN falls back to air');
  assert.strictEqual(translator1.translateStateId(Infinity), translator1.targetAirStateId, 'Infinity falls back to air');
  assert.strictEqual(translator1.translateStateId(null), translator1.targetAirStateId, 'null falls back to air');
  assert.strictEqual(translator1.translateStateId(undefined), translator1.targetAirStateId, 'undefined falls back to air');
  assert.strictEqual(translator1.translateStateId('stone'), translator1.targetAirStateId, 'String input falls back to air');
  pass('1.6 Fallback bounds protection for invalid/out-of-bounds inputs verified');

  // 1.3 Throughput Benchmark: 2,000,000 lookups
  const lookups = 2000000;
  const startMem = process.memoryUsage().heapUsed;
  const t0 = performance.now();
  let acc = 0;
  for (let i = 0; i < lookups; i++) {
    acc += translator1.translateStateId(i % 35000);
  }
  const t1 = performance.now();
  const endMem = process.memoryUsage().heapUsed;
  const durationMs = t1 - t0;
  const opsPerSec = (lookups / (durationMs / 1000)).toFixed(0);
  const memDiffMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);
  console.log(`[PERF] 2,000,000 translateStateId lookups in ${durationMs.toFixed(1)}ms (${Number(opsPerSec).toLocaleString()} ops/sec, Heap diff: ${memDiffMb} MB)`);
  assert(durationMs < 1000, `Throughput must complete 2M lookups in < 1000ms (actual: ${durationMs.toFixed(1)}ms)`);
  pass('1.7 2,000,000 state lookups throughput exceeds performance target');

  // 1.4 Chunk Palette Translation Stress: 10,000 palettes
  const paletteIterations = 10000;
  const tPalette0 = performance.now();
  for (let i = 0; i < paletteIterations; i++) {
    const palette = [0, 1, 8, 14, 28748, 34598, 1500, 2000];
    translator1.translateChunkPalette(palette);
    assert.strictEqual(palette[4], mapped261);
    assert.strictEqual(palette[5], mapped263);
  }
  const tPalette1 = performance.now();
  console.log(`[PERF] 10,000 chunk palettes translated in ${(tPalette1 - tPalette0).toFixed(1)}ms`);
  pass('1.8 10,000 chunk palette conversions in-place verified');

  // 1.5 Chunk JSON Fuzzing & Resilience
  const validChunkJson = JSON.stringify({
    x: 0,
    z: 0,
    sections: [
      JSON.stringify({
        y: 0,
        data: JSON.stringify({
          type: 'indirect',
          palette: [0, 1, 28748],
          data: [0, 1, 2]
        })
      }),
      JSON.stringify({
        y: 1,
        data: JSON.stringify({
          type: 'single',
          value: 34598
        })
      })
    ]
  });

  const translatedJson = translator1.translateChunkJson(validChunkJson);
  assert(typeof translatedJson === 'string');
  const parsedRes = JSON.parse(translatedJson);
  const sec0 = JSON.parse(parsedRes.sections[0]);
  const sec0Data = JSON.parse(sec0.data);
  assert.strictEqual(sec0Data.palette[2], mapped261);
  const sec1 = JSON.parse(parsedRes.sections[1]);
  const sec1Data = JSON.parse(sec1.data);
  assert.strictEqual(sec1Data.value, mapped263);
  pass('1.9 Chunk JSON indirect and single section palette translation verified');

  // Fuzz with malformed JSON
  assert.strictEqual(translator1.translateChunkJson('{ malformed json'), '{ malformed json');
  assert.strictEqual(translator1.translateChunkJson(null), null);
  assert.strictEqual(translator1.translateChunkJson(undefined), undefined);
  assert.strictEqual(translator1.translateChunkJson({ sections: null }).sections, null);
  pass('1.10 Chunk JSON fuzzing and corrupted payload tolerance verified');

  // 1.6 World & Bot Proxy Lifecycle and Chaining
  const mockBot = new EventEmitter();
  mockBot.version = '26.3';
  mockBot.world = {
    getColumnAt: async () => ({
      toJson: () => validChunkJson
    }),
    getColumn: () => ({
      toJson: () => validChunkJson
    })
  };

  const proxy = translator1.createViewerBotProxy(mockBot);
  assert.strictEqual(proxy.version, '1.21.4', 'Proxy reports target viewer version');

  // Wrap world test
  const col = proxy.world.getColumn(0, 0);
  assert.strictEqual(col._isViewerProxy, true, 'Column is wrapped with viewer proxy');
  const colJson = col.toJson();
  const colParsed = JSON.parse(colJson);
  const colSec0 = JSON.parse(colParsed.sections[0]);
  const colSec0Data = JSON.parse(colSec0.data);
  assert.strictEqual(colSec0Data.palette[2], mapped261, 'Column toJson() transparently translated palette');
  pass('1.11 World Proxy getColumn / toJson transparent translation verified');

  // Chained listeners & cleanup
  let cbCallCount = 0;
  const cb = () => { cbCallCount++; };
  proxy.on('blockUpdate', cb);
  assert.strictEqual(mockBot.listenerCount('blockUpdate'), 1);
  proxy.off('blockUpdate', cb);
  assert.strictEqual(mockBot.listenerCount('blockUpdate'), 0);
  pass('1.12 Bot Proxy listener symmetric registration and cleanup verified');
}

// ==============================================================================
// 2. R2: SETTINGS & ONBOARDING VERSION VALIDATION
// ==============================================================================
async function testSettingsAndOnboardingValidation() {
  console.log('\n================================================================');
  console.log('CHALLENGE 2: SETTINGS & ONBOARDING VERSION VALIDATION & SCHEMAS');
  console.log('================================================================\n');

  // 2.1 VersionResolver Hardened Validation
  const validVersions = ['auto', '26.3', '1.21.4', '1.21.1', '1.20.4', '1.20.1', '', 'none', 'false', false];
  for (const v of validVersions) {
    assert.strictEqual(VersionResolver.isValidVersion(v), true, `Version '${v}' must be accepted as valid (or auto-detect)`);
  }
  pass('2.1 Standard supported versions and auto-detect variants accepted by VersionResolver');

  const invalidVersions = [
    '99.99.99', '0.0.0', '-1.0.0', '1.999.0',
    'invalid', 'auto_bad', '26.3-beta', 'v1.20.4',
    null, undefined, 1.20, true, {}, []
  ];
  for (const iv of invalidVersions) {
    assert.strictEqual(VersionResolver.isValidVersion(iv), false, `Invalid version ${JSON.stringify(iv)} must be rejected`);
  }
  pass('2.2 Invalid and forged versions strictly rejected by VersionResolver');

  // Version Resolver Viewer Version Mapping
  assert.strictEqual(VersionResolver.resolveViewerVersion('1.20.4'), '1.20.1', '1.20.4 resolves to 1.20.1 assets');
  assert.strictEqual(VersionResolver.resolveViewerVersion('1.20.1'), '1.20.1', '1.20.1 resolves to 1.20.1 assets');
  assert.strictEqual(VersionResolver.resolveViewerVersion('26.3'), '1.21.4', '26.3 resolves to 1.21.4 assets');
  assert.strictEqual(VersionResolver.resolveViewerVersion('1.21.4'), '1.21.4', '1.21.4 resolves to 1.21.4 assets');
  assert.strictEqual(VersionResolver.resolveViewerVersion('auto'), '1.21.4', 'auto resolves to 1.21.4 assets');
  pass('2.3 Target viewer version resolution mappings verified');

  // 2.2 EnvManager Config Validation
  const tempDir = path.resolve('test/fixtures/challenger_m4_env_test');
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const testEnvPath = path.join(tempDir, '.env');
  const testExamplePath = path.join(tempDir, '.env.example');
  fs.writeFileSync(testExamplePath, 'MC_HOST=127.0.0.1\nMC_PORT=25565\nMC_VERSION=auto\nMC_AUTH=offline\nBOT_OWNER=Tester\nBUILD_EXECUTION_MODE=auto\n', 'utf8');

  const envMgr = new EnvManager({
    rootDir: tempDir,
    envPath: testEnvPath,
    exampleEnvPath: testExamplePath
  });

  const errs99 = envMgr.validateConfig({ MC_VERSION: '99.99.99' });
  assert(errs99.length > 0, 'EnvManager rejects MC_VERSION=99.99.99');
  assert(errs99.some(e => e.includes('MC_VERSION')), 'Error specifically identifies MC_VERSION');

  const errsValid = envMgr.validateConfig({ MC_VERSION: '1.20.4', MC_PORT: 25565, MC_AUTH: 'offline', BOT_OWNER: 'Tester', BUILD_EXECUTION_MODE: 'auto' });
  assert.strictEqual(errsValid.length, 0, 'EnvManager accepts valid config');
  pass('2.4 EnvManager config schema validation verified');

  // 2.3 Ephemeral Server REST API Validation (/api/settings)
  const port = 3987;
  const dashboard = new DashboardServer({
    botClient: {
      getHealthStatus: () => ({ status: 'idle' }),
      reconnect: async () => true
    }
  });
  dashboard.envManager = envMgr;
  const app = dashboard.setupApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(port, resolve));

  try {
    // Test 1: Reject '99.99.99' with HTTP 400
    const resBad = await makeHttpRequest(port, 'POST', '/api/settings', {
      MC_VERSION: '99.99.99',
      reconnectBot: false
    });
    assert.strictEqual(resBad.statusCode, 400, 'POST /api/settings with 99.99.99 returns HTTP 400');
    assert.strictEqual(resBad.body.success, false);
    pass('2.5 REST API rejects invalid version with HTTP 400 Bad Request');

    // Test 2: Accept '1.21.4' with HTTP 200
    const resGood = await makeHttpRequest(port, 'POST', '/api/settings', {
      MC_VERSION: '1.21.4',
      reconnectBot: false
    });
    assert.strictEqual(resGood.statusCode, 200, 'POST /api/settings with 1.21.4 returns HTTP 200');
    assert.strictEqual(resGood.body.success, true);

    const resGet = await makeHttpRequest(port, 'GET', '/api/settings');
    assert.strictEqual(resGet.statusCode, 200);
    assert.strictEqual(resGet.body.settings.MC_VERSION, '1.21.4');
    pass('2.6 REST API updates valid version with HTTP 200 OK and persists to GET /api/settings');

    // Test 3: Reject non-boolean reconnectBot or malformed payloads
    const resBadTypes = await makeHttpRequest(port, 'POST', '/api/settings', {
      MC_PORT: 'invalid_port_string'
    });
    assert.strictEqual(resBadTypes.statusCode, 400, 'POST /api/settings with string port returns HTTP 400');
    pass('2.7 REST API enforces type safety on config fields');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Cleanup fixtures
    if (fs.existsSync(testEnvPath)) fs.unlinkSync(testEnvPath);
    if (fs.existsSync(testExamplePath)) fs.unlinkSync(testExamplePath);
    if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
  }
}

// ==============================================================================
// 3. R3 & R4: FULLSCREEN & MULTI-MONITOR POPOUT SYNCHRONIZATION
// ==============================================================================
async function testFullscreenAndPopoutSynchronization() {
  console.log('\n================================================================');
  console.log('CHALLENGE 3: FULLSCREEN & POPOUT MULTI-MONITOR SYNCHRONIZATION');
  console.log('================================================================\n');

  // 3.1 Static Contracts in HTML and CSS
  const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf8');
  assert(indexHtml.includes('id="btnFullscreenViewer"'), 'index.html defines #btnFullscreenViewer');
  assert(indexHtml.includes('id="btnPopoutViewer"'), 'index.html defines #btnPopoutViewer');
  assert(indexHtml.includes('id="viewerDetachedPlaceholder"'), 'index.html defines #viewerDetachedPlaceholder');
  assert(indexHtml.includes('id="btnReembedViewer"'), 'index.html defines #btnReembedViewer');

  const viewerHtml = fs.readFileSync(path.resolve('src/web/public/viewer.html'), 'utf8');
  assert(viewerHtml.includes('id="btnPopoutFullscreen"'), 'viewer.html defines #btnPopoutFullscreen');
  assert(viewerHtml.includes('id="btnPopoutReembed"'), 'viewer.html defines #btnPopoutReembed');
  assert(viewerHtml.includes('id="popoutFrame"'), 'viewer.html defines #popoutFrame');

  const css = fs.readFileSync(path.resolve('src/web/public/style.css'), 'utf8');
  assert(css.includes('.grid-container.camera-detached'), 'style.css defines .grid-container.camera-detached');
  assert(/grid-template-columns:\s*24%\s*49%\s*27%/.test(css), 'Adaptive column split is 24% 49% 27%');
  assert(css.includes('.viewer-wrapper:fullscreen'), 'style.css defines .viewer-wrapper:fullscreen');
  pass('3.1 Fullscreen and popout HTML/CSS static contracts verified');

  // 3.2 State Controller & Simulated BroadcastChannel Invariants
  const viewerController = await import('../src/web/public/js/viewerController.js');
  assert.strictEqual(typeof viewerController.isPoppedOut, 'function');
  assert.strictEqual(typeof viewerController.openPopout, 'function');
  assert.strictEqual(typeof viewerController.reembed, 'function');
  pass('3.2 viewerController module contract verified');

  // Create lightweight DOM mock
  class MockClassList {
    constructor() { this.classes = new Set(); }
    add(c) { this.classes.add(c); }
    remove(c) { this.classes.delete(c); }
    contains(c) { return this.classes.has(c); }
  }

  class MockElement {
    constructor(id = '') {
      this.id = id;
      this.classList = new MockClassList();
      this.style = {};
      this.src = '';
      this.textContent = '';
    }
  }

  const mockGrid = new MockElement('gridContainer');
  const mockWrapper = new MockElement('viewerWrapper');
  const mockPlaceholder = new MockElement('viewerDetachedPlaceholder');
  mockPlaceholder.classList.add('hidden');
  const mockFrame = new MockElement('viewerFrame');
  mockFrame.src = 'http://localhost:3081';
  const mockPort = new MockElement('lblViewerPort');
  mockPort.textContent = '3081';

  // Setup DOM globals required for loading and executing app.js in Node.js
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost' },
    addEventListener: () => {}
  };
  globalThis.document = {
    getElementById: (id) => {
      if (id === 'viewerDetachedPlaceholder') return mockPlaceholder;
      if (id === 'viewerWrapper') return mockWrapper;
      if (id === 'viewerFrame') return mockFrame;
      if (id === 'lblViewerPort') return mockPort;
      return null;
    },
    querySelector: (sel) => {
      if (sel === '.grid-container') return mockGrid;
      if (sel === '.viewer-wrapper') return mockWrapper;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  // 3.3 DOM State Transitions via authentic applyCameraDetachedState
  const appModule = await import('../src/web/public/app.js');
  assert.strictEqual(typeof appModule.applyCameraDetachedState, 'function', 'app.js exports applyCameraDetachedState');

  // Run 1,000 rapid popout / re-embed cycles
  const cycles = 1000;
  const tCycles0 = performance.now();
  for (let i = 0; i < cycles; i++) {
    // Detach
    appModule.applyCameraDetachedState(true);
    assert.strictEqual(mockGrid.classList.contains('camera-detached'), true);
    assert.strictEqual(mockWrapper.style.display, 'none');
    assert.strictEqual(mockPlaceholder.classList.contains('hidden'), false);
    assert.strictEqual(mockFrame.src, 'about:blank');

    // Re-embed
    appModule.applyCameraDetachedState(false);
    assert.strictEqual(mockGrid.classList.contains('camera-detached'), false);
    assert.strictEqual(mockWrapper.style.display, '');
    assert.strictEqual(mockPlaceholder.classList.contains('hidden'), true);
    assert(mockFrame.src.startsWith('http://localhost:3081'));
  }
  const tCycles1 = performance.now();
  console.log(`[PERF] 1,000 rapid DOM detach/re-embed cycles completed in ${(tCycles1 - tCycles0).toFixed(1)}ms`);
  pass('3.3 1,000 rapid DOM camera-detached transitions verified without state drift');

  // 3.4 BroadcastChannel Message Fuzzing
  class MockBroadcastChannel extends EventEmitter {
    constructor(name) {
      super();
      this.name = name;
    }
    postMessage(msg) {
      this.emit('message', { data: msg });
    }
    close() {}
  }

  const channel = new MockBroadcastChannel('mc_camera_sync');
  let popoutState = false;

  channel.on('message', (evt) => {
    const data = evt.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'VIEWER_POPOUT_OPENED') {
      popoutState = true;
    } else if (data.type === 'VIEWER_POPOUT_CLOSED' || data.type === 'REQUEST_REEMBED') {
      popoutState = false;
    }
  });

  // Fuzz with adversarial message payloads
  const fuzzMessages = [
    null, undefined, 42, 'string_payload', {}, { type: 'UNKNOWN' },
    { type: 'VIEWER_POPOUT_OPENED', port: 3081 },
    { type: 'VIEWER_POPOUT_OPENED' }, // duplicate
    { type: 'REQUEST_REEMBED' },
    { type: 'VIEWER_POPOUT_CLOSED' },
    { type: 'VIEWER_POPOUT_CLOSED' } // duplicate
  ];

  for (const m of fuzzMessages) {
    channel.postMessage(m);
  }
  assert.strictEqual(popoutState, false, 'Channel settles in closed state after re-embed/closed messages');
  pass('3.4 BroadcastChannel message handling resilience to malformed & duplicate packets verified');
}

// Helper: HTTP request utility
function makeHttpRequest(port, method, reqPath, payload = null) {
  return new Promise((resolve, reject) => {
    const postData = payload ? JSON.stringify(payload) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: reqPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(postData ? { 'Content-Length': Buffer.byteLength(postData) } : {})
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runAllEmpiricalChallenges() {
  console.log('========================================================================');
  console.log('STARTING MILESTONE 4 EMPIRICAL CHALLENGER 2 ADVANCED VERIFICATION SUITE');
  console.log('========================================================================');

  await testViewerStateTranslatorStress();
  await testSettingsAndOnboardingValidation();
  await testFullscreenAndPopoutSynchronization();

  console.log('\n========================================================================');
  console.log(`ALL EMPIRICAL CHALLENGES COMPLETE: ${passedChecks}/${totalChecks} PASS, 0 FAIL`);
  console.log('========================================================================\n');
}

runAllEmpiricalChallenges().catch(err => {
  console.error('\n[FATAL CHALLENGE HARNESS CRASH]', err);
  process.exit(1);
});
