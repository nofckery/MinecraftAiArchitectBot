/**
 * Empirical Challenger Test Suite for Milestone 2
 * (Variable Version Configuration in Onboarding & Settings)
 *
 * Stress-tests:
 * 1. Malformed and adversarial MC_VERSION inputs in EnvManager.validateConfig()
 * 2. VersionResolver.isValidVersion() boundary checks and regex vs real dataset gap
 * 3. VersionResolver.resolveViewerVersion() mapping across versions, minors, and fallbacks
 * 4. EnvManager.saveConfig() persistence, file integrity, and injection resistance
 * 5. Full API contract verification (GET /api/settings, POST /api/settings, reconnectBot)
 * 6. UI & Markup consistency for chips, reconnect controls, and cache-busting
 */

import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'module';
import { EnvManager, envManager } from '../src/config/envManager.js';
import { VersionResolver } from '../src/config/versionResolver.js';
import { DashboardServer } from '../src/web/dashboardServer.js';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const mineflayerVersion = require('mineflayer/lib/version.js');

let totalTests = 0;
let passedTests = 0;
const findings = [];

function check(name, condition, details = '') {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
  } else {
    findings.push({ name, details });
    console.error(`\x1b[31m[FINDING]\x1b[0m ${name}${details ? ' - ' + details : ''}`);
  }
}

async function runEmpiricalHarness() {
  console.log('\x1b[35m=== EMPIRICAL CHALLENGER TEST SUITE: MILESTONE 2 ===\x1b[0m\n');
  VersionResolver.applyCompatibilityShims();

  // --------------------------------------------------------------------------
  // TEST GROUP 1: Adversarial & Malformed Inputs in validateConfig
  // --------------------------------------------------------------------------
  console.log('--- Testgruppe 1: Adversarial & Malformed Inputs in validateConfig ---');

  // 1.1 XSS injection
  const errXss = envManager.validateConfig({ MC_VERSION: '<script>' });
  check('1.1 validateConfig catches <script>', errXss.length > 0, `Returned: ${JSON.stringify(errXss)}`);

  const errXss2 = envManager.validateConfig({ MC_VERSION: '"><svg/onload=alert(1)>' });
  check('1.1b validateConfig catches SVG onload XSS', errXss2.length > 0, `Returned: ${JSON.stringify(errXss2)}`);

  // 1.2 Shell injection / Command chaining
  const errCmd = envManager.validateConfig({ MC_VERSION: '1.20; rm -rf' });
  check('1.2 validateConfig catches "1.20; rm -rf"', errCmd.length > 0, `Returned: ${JSON.stringify(errCmd)}`);

  const errCmd2 = envManager.validateConfig({ MC_VERSION: '1.20.4 && echo hacked' });
  check('1.2b validateConfig catches shell operators', errCmd2.length > 0, `Returned: ${JSON.stringify(errCmd2)}`);

  // 1.3 Literal 'NaN' and Number.NaN
  const errNaNStr = envManager.validateConfig({ MC_VERSION: 'NaN' });
  check('1.3 validateConfig catches string "NaN"', errNaNStr.length > 0, `Returned: ${JSON.stringify(errNaNStr)}`);

  const errNaNNum = envManager.validateConfig({ MC_VERSION: Number.NaN });
  check('1.3b validateConfig catches Number.NaN', errNaNNum.length > 0, `Returned: ${JSON.stringify(errNaNNum)}`);

  // 1.4 Literal 'null' string vs primitive null
  const errNullStr = envManager.validateConfig({ MC_VERSION: 'null' });
  check('1.4 validateConfig catches string "null"', errNullStr.length > 0, `Returned: ${JSON.stringify(errNullStr)}`);

  const errNullPrim = envManager.validateConfig({ MC_VERSION: null });
  check('1.4b validateConfig handles primitive null gracefully (no error, skipped in config)', errNullPrim.length === 0, `Returned: ${JSON.stringify(errNullPrim)}`);

  // 1.5 Literal '{}' string vs object literal {}
  const errObjStr = envManager.validateConfig({ MC_VERSION: '{}' });
  check('1.5 validateConfig catches string "{}"', errObjStr.length > 0, `Returned: ${JSON.stringify(errObjStr)}`);

  const errObjPrim = envManager.validateConfig({ MC_VERSION: {} });
  check('1.5b validateConfig catches object literal {}', errObjPrim.length > 0, `Returned: ${JSON.stringify(errObjPrim)}`);

  // 1.6 Boolean true vs boolean false
  const errTrue = envManager.validateConfig({ MC_VERSION: true });
  check('1.6 validateConfig catches boolean true', errTrue.length > 0, `Returned: ${JSON.stringify(errTrue)}`);

  const errFalse = envManager.validateConfig({ MC_VERSION: false });
  check('1.6b validateConfig accepts boolean false (Mineflayer auto-detection)', errFalse.length === 0, `Returned: ${JSON.stringify(errFalse)}`);

  // 1.7 Numeric primitives and arrays
  const errNumber = envManager.validateConfig({ MC_VERSION: 12345 });
  check('1.7 validateConfig catches number 12345', errNumber.length > 0, `Returned: ${JSON.stringify(errNumber)}`);

  const errArray = envManager.validateConfig({ MC_VERSION: ['1.21.4'] });
  check('1.7b validateConfig catches array ["1.21.4"]', errArray.length > 0, `Returned: ${JSON.stringify(errArray)}`);

  // 1.8 Newline / env file injection
  const errNewline = envManager.validateConfig({ MC_VERSION: '1.20.4\nMC_HOST=evil.com' });
  check('1.8 validateConfig catches newline env injection', errNewline.length > 0, `Returned: ${JSON.stringify(errNewline)}`);

  // 1.9 '99.99.99' - Empirical verification of non-existent version
  const err99 = envManager.validateConfig({ MC_VERSION: '99.99.99' });
  const isMcData99 = !!mcData('99.99.99');
  const isMineflayer99 = Array.isArray(mineflayerVersion.testedVersions) && mineflayerVersion.testedVersions.includes('99.99.99');

  console.log(`[EMPIRICAL AUDIT] MC_VERSION '99.99.99':`);
  console.log(`  - Known to minecraft-data: ${isMcData99}`);
  console.log(`  - Known to mineflayer testedVersions: ${isMineflayer99}`);
  console.log(`  - validateConfig errors returned: ${JSON.stringify(err99)}`);
  console.log(`  - VersionResolver.isValidVersion('99.99.99'): ${VersionResolver.isValidVersion('99.99.99')}`);

  const catches99 = err99.length > 0;
  check(
    '1.9 (VULNERABILITY PROBE) validateConfig catches non-existent version "99.99.99"',
    catches99,
    `Over-permissive regex /^\\d+(\\.\\d+)+$/ allows non-existent version '99.99.99' without error (errors: ${JSON.stringify(err99)}). Mineflayer crashes with 'unsupported protocol version: 99.99.99'.`
  );

  // --------------------------------------------------------------------------
  // TEST GROUP 2: Valid inputs passing cleanly
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 2: Valid inputs passing cleanly ---');

  const validCases = [
    { input: '1.21.4', label: '1.21.4' },
    { input: '1.20.1', label: '1.20.1' },
    { input: '1.20.4', label: '1.20.4' },
    { input: '26.3', label: '26.3' },
    { input: 'auto', label: 'auto' },
    { input: '', label: 'empty string' },
    { input: '   ', label: 'whitespace only string' },
    { input: false, label: 'false' }
  ];

  for (const vc of validCases) {
    const errs = envManager.validateConfig({ MC_VERSION: vc.input });
    check(`2.1 Valid input '${vc.label}' passes cleanly`, errs.length === 0, `Unexpected errors: ${JSON.stringify(errs)}`);
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 3: VersionResolver.resolveViewerVersion() Mapping
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 3: VersionResolver.resolveViewerVersion Mapping ---');

  const viewerMappings = [
    { input: '1.21.4', expected: '1.21.4', desc: 'Direct supported 1.21.4' },
    { input: '1.21.1', expected: '1.21.1', desc: 'Direct supported 1.21.1' },
    { input: '1.21', expected: '1.21.4', desc: 'Minor 1.21 -> 1.21.4' },
    { input: '1.21.3', expected: '1.21.4', desc: 'Patch 1.21.3 -> 1.21.4' },
    { input: '1.20.4', expected: '1.20.1', desc: '1.20.4 mapped to closest 1.20.1' },
    { input: '1.20.2', expected: '1.20.1', desc: '1.20.2 mapped to closest 1.20.1' },
    { input: '1.20.1', expected: '1.20.1', desc: 'Direct supported 1.20.1' },
    { input: '1.20', expected: '1.20.1', desc: '1.20 mapped to closest 1.20.1' },
    { input: '26.3', expected: '1.21.4', desc: '26.3 SOTA mapped to 1.21.4' },
    { input: '777', expected: '1.21.4', desc: 'Protocol 777 mapped to 1.21.4' },
    { input: 'auto', expected: '1.21.4', desc: 'auto mapped to 1.21.4 fallback' },
    { input: false, expected: '1.21.4', desc: 'false mapped to 1.21.4 fallback' },
    { input: '', expected: '1.21.4', desc: 'empty string mapped to 1.21.4 fallback' },
    { input: null, expected: '1.21.4', desc: 'null mapped to 1.21.4 fallback' },
    { input: undefined, expected: '1.21.4', desc: 'undefined mapped to 1.21.4 fallback' },
    { input: '1.19.4', expected: '1.19', desc: '1.19.4 mapped to 1.19' },
    { input: '1.18.2', expected: '1.18.1', desc: '1.18.2 mapped to 1.18.1' },
    { input: '1.17.1', expected: '1.17.1', desc: '1.17.1 direct supported' },
    { input: '1.16.5', expected: '1.16.4', desc: '1.16.5 mapped to 1.16.4' },
    { input: '1.15.2', expected: '1.15.2', desc: '1.15.2 direct supported' },
    { input: '1.14.4', expected: '1.14.4', desc: '1.14.4 direct supported' },
    { input: '1.13.2', expected: '1.13.2', desc: '1.13.2 direct supported' },
    { input: '1.12.2', expected: '1.12.2', desc: '1.12.2 direct supported' }
  ];

  for (const vm of viewerMappings) {
    const actual = VersionResolver.resolveViewerVersion(vm.input);
    check(`3.1 resolveViewerVersion('${vm.input}') -> '${vm.expected}' (${vm.desc})`, actual === vm.expected, `Got: '${actual}', expected: '${vm.expected}'`);
  }

  // --------------------------------------------------------------------------
  // TEST GROUP 4: Persistence, File Integrity & saveConfig Stress
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 4: Persistence & saveConfig File Integrity ---');

  const testTempDir = path.resolve('test/fixtures/env_challenge_m2');
  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  const testEnvPath = path.join(testTempDir, '.env.test');
  const testExamplePath = path.join(testTempDir, '.env.example.test');

  fs.writeFileSync(testExamplePath, '# Template\nMC_HOST=127.0.0.1\nMC_PORT=25565\nMC_VERSION=auto\n', 'utf-8');

  const testEnvMgr = new EnvManager({
    rootDir: testTempDir,
    envPath: testEnvPath,
    exampleEnvPath: testExamplePath
  });

  // 4.1 Save valid versions and verify roundtrip parsing
  const persistVersions = ['1.21.4', '1.20.1', '26.3', 'auto'];
  for (const ver of persistVersions) {
    testEnvMgr.saveConfig({ MC_VERSION: ver }, testEnvPath, testExamplePath);
    const parsed = testEnvMgr.parseEnvFile(fs.readFileSync(testEnvPath, 'utf-8'));
    check(`4.1 saveConfig persists MC_VERSION=${ver} correctly`, parsed.MC_VERSION === ver, `Parsed value was: ${parsed.MC_VERSION}`);
  }

  // 4.2 Malformed input rejection prevents file corruption
  const previousContent = fs.readFileSync(testEnvPath, 'utf-8');
  let threwOnScript = false;
  try {
    testEnvMgr.saveConfig({ MC_VERSION: '<script>alert("xss")</script>' }, testEnvPath, testExamplePath);
  } catch (err) {
    threwOnScript = true;
  }
  check('4.2 saveConfig rejects <script> and throws error', threwOnScript);
  check('4.2b .env file unchanged after rejected saveConfig', fs.readFileSync(testEnvPath, 'utf-8') === previousContent);

  // 4.3 Clean up test fixture
  try {
    if (fs.existsSync(testEnvPath)) fs.unlinkSync(testEnvPath);
    if (fs.existsSync(testExamplePath)) fs.unlinkSync(testExamplePath);
    if (fs.existsSync(testTempDir)) fs.rmdirSync(testTempDir);
  } catch {}

  // --------------------------------------------------------------------------
  // TEST GROUP 5: API Endpoints (GET /api/settings, POST /api/settings)
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 5: API Endpoints (GET & POST /api/settings) ---');

  const mockApp = {
    getRoutes: {},
    postRoutes: {},
    get(path, handler) { this.getRoutes[path] = handler; },
    post(path, handler) { this.postRoutes[path] = handler; }
  };

  const { registerBaseRoutes } = await import('../src/web/routes/baseRoutes.js');
  let broadcastedMessage = null;
  let reconnectedCalled = false;

  const mockContext = {
    currentBot: null,
    botClient: {
      reconnect() { reconnectedCalled = true; }
    },
    llmRouter: { getActiveProviderName: () => 'cerebras' },
    broadcast(msg) { broadcastedMessage = msg; }
  };

  registerBaseRoutes(mockApp, mockContext);

  // 5.1 GET /api/settings provides version metadata
  let getResultData = null;
  const mockResGet = {
    json(data) { getResultData = data; return this; },
    status() { return this; }
  };
  mockApp.getRoutes['/api/settings']({}, mockResGet);

  check('5.1 GET /api/settings returns success: true', getResultData && getResultData.success === true);
  check('5.1b GET /api/settings includes versionMetadata.supportedGameVersions', Array.isArray(getResultData?.versionMetadata?.supportedGameVersions));
  check('5.1c GET /api/settings includes versionMetadata.supportedViewerVersions', Array.isArray(getResultData?.versionMetadata?.supportedViewerVersions));

  // 5.2 POST /api/settings with reconnectBot: true triggers botClient.reconnect()
  let postResultData = null;
  let postStatus = 200;
  const mockResPost = {
    status(code) { postStatus = code; return this; },
    json(data) { postResultData = data; return this; }
  };

  reconnectedCalled = false;
  broadcastedMessage = null;
  await mockApp.postRoutes['/api/settings']({
    body: { MC_VERSION: '1.21.4', reconnectBot: true }
  }, mockResPost);

  check('5.2 POST /api/settings with reconnectBot: true triggers activeBotClient.reconnect()', reconnectedCalled === true);
  check('5.2b POST /api/settings broadcasts reconnected: true in websocket event', broadcastedMessage?.reconnected === true);

  // 5.3 POST /api/settings with invalid version returns HTTP 400
  let postErrData = null;
  let postErrStatus = 200;
  const mockResPostErr = {
    status(code) { postErrStatus = code; return this; },
    json(data) { postErrData = data; return this; }
  };

  await mockApp.postRoutes['/api/settings']({
    body: { MC_VERSION: '<script>evil()</script>' }
  }, mockResPostErr);

  check('5.3 POST /api/settings with <script> returns HTTP 400', postErrStatus === 400);
  check('5.3b POST /api/settings returns success: false on validation error', postErrData?.success === false);

  // --------------------------------------------------------------------------
  // TEST GROUP 6: Frontend Markup & Script Integrity
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 6: Frontend Markup & Script Integrity ---');

  const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf-8');
  const onboardingJs = fs.readFileSync(path.resolve('src/web/public/js/onboardingWizard.js'), 'utf-8');
  const appJs = fs.readFileSync(path.resolve('src/web/public/app.js'), 'utf-8');

  check('6.1 index.html contains #obVersionChips in Onboarding Step 4', indexHtml.includes('id="obVersionChips"'));
  check('6.2 index.html contains #cfgMcVersionChips in Settings Tab', indexHtml.includes('id="cfgMcVersionChips"'));
  check('6.3 index.html contains #cfgReconnectBot checkbox in Settings Tab', indexHtml.includes('id="cfgReconnectBot"'));
  check('6.4 onboardingWizard.js binds setupVersionChips for bidirectional sync', onboardingJs.includes('setupVersionChips'));
  check('6.5 onboardingWizard.js uses cfgReconnectBot checked state on submit', onboardingJs.includes('cfgReconnectBot') && !onboardingJs.includes('reconnectBot: false'));
  
  const hasCacheBuster = appJs.includes('?v=${Date.now()}') || appJs.includes("'?v=' + Date.now()");
  check('6.6 app.js reloads viewerFrame.src with cache-buster parameter (?v=Date.now())', hasCacheBuster, 'app.js includes ?v=${Date.now()}');

  // --------------------------------------------------------------------------
  // SUMMARY & VERDICT
  // --------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TOTAL EMPIRICAL TESTS: ${totalTests}`);
  console.log(`PASSED: ${passedTests}`);
  console.log(`FINDINGS / GAPS: ${findings.length}`);
  console.log('================================================================');

  if (findings.length > 0) {
    console.log('\nEMPIRICAL FINDINGS IDENTIFIED:');
    for (const f of findings) {
      console.log(`- \x1b[33m${f.name}\x1b[0m: ${f.details}`);
    }
  }

  return { totalTests, passedTests, findings };
}

runEmpiricalHarness().then(({ findings }) => {
  if (findings.length > 0) {
    console.log(`\x1b[33m\n[EMPIRICAL FINDINGS SUMMARY] ${findings.length} finding(s) discovered during stress testing.\x1b[0m`);
    process.exit(0);
  } else {
    console.log('\x1b[32m\n[ALL EMPIRICAL TESTS PASSED]\x1b[0m');
    process.exit(0);
  }
}).catch(err => {
  console.error('[FATAL ERROR IN HARNESS]', err);
  process.exit(1);
});
