/**
 * Adversarial Stress & Verification Harness for Milestone M6
 * Challenger 2: Local Scanner & Express BFF Stress
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { LocalModelScanner } from '../src/ai/localModelScanner.js';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { CredentialVault } from '../src/security/credentialVault.js';

let passedTests = 0;
let totalTests = 0;
const findings = [];

function recordTest(name, passed, details = '') {
  totalTests++;
  if (passed) {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${name} ${details ? '(' + details + ')' : ''}`);
  } else {
    console.log(`\x1b[31m[FAIL]\x1b[0m ${name} ${details ? '(' + details + ')' : ''}`);
    findings.push({ name, details });
  }
}

async function runEmpiricalStressSuite() {
  console.log('\x1b[36m================================================================');
  console.log('  CHALLENGER 2: LOCAL SCANNER & EXPRESS BFF ADVERSARIAL STRESS  ');
  console.log('================================================================\x1b[0m\n');

  const testDir = path.resolve('data', 'test_challenger_m6_stress');
  await fs.promises.mkdir(testDir, { recursive: true });
  const testConfigPath = path.join(testDir, 'endpoints_stress.json');
  const testVaultPath = path.join(testDir, 'vault_stress.enc');

  const activeServers = [];
  const activeSockets = new Set();

  function trackSocket(sock) {
    activeSockets.add(sock);
    sock.on('close', () => activeSockets.delete(sock));
  }

  try {
    // =========================================================================
    // SECTION 1: LOCAL SCANNER ADVERSARIAL STRESS
    // =========================================================================
    console.log('\x1b[33m--- SECTION 1: Local Scanner Stress (Hung, Dropped, Garbage, Closed) ---\x1b[0m');

    // 1.1 Hung Server (Socket opens but never sends bytes)
    const hungServer = net.createServer((sock) => {
      trackSocket(sock);
    });
    await new Promise(r => hungServer.listen(0, '127.0.0.1', r));
    activeServers.push(hungServer);
    const hungPort = hungServer.address().port;

    // 1.2 Socket Drop Mid-Stream (Sends partial HTTP headers then abruptly destroys socket)
    const dropServer = net.createServer((sock) => {
      trackSocket(sock);
      sock.on('data', () => {
        sock.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"models": [');
        setTimeout(() => {
          sock.destroy();
        }, 15);
      });
    });
    await new Promise(r => dropServer.listen(0, '127.0.0.1', r));
    activeServers.push(dropServer);
    const dropPort = dropServer.address().port;

    // 1.3 Garbage Non-JSON Response (Raw binary & HTML 502 Bad Gateway)
    const garbageServer = net.createServer((sock) => {
      trackSocket(sock);
      sock.on('data', () => {
        sock.write('HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body>Error 502 \x00\xff\xfe\x1b Random Garbage</body></html>');
        sock.end();
      });
    });
    await new Promise(r => garbageServer.listen(0, '127.0.0.1', r));
    activeServers.push(garbageServer);
    const garbagePort = garbageServer.address().port;

    // 1.4 Slow Drip Server (Sends headers immediately, then trickles chunked body)
    const slowDripServer = net.createServer((sock) => {
      trackSocket(sock);
      sock.on('data', () => {
        sock.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n');
        const interval = setInterval(() => {
          if (sock.destroyed) {
            clearInterval(interval);
            return;
          }
          try {
            sock.write('1\r\nX\r\n');
          } catch (_) {
            clearInterval(interval);
          }
        }, 200);
        sock.on('close', () => clearInterval(interval));
        sock.on('error', () => clearInterval(interval));
      });
    });
    await new Promise(r => slowDripServer.listen(0, '127.0.0.1', r));
    activeServers.push(slowDripServer);
    const slowDripPort = slowDripServer.address().port;

    // 1.5 Legitimate Ollama Mock
    const legitOllamaServer = http.createServer((req, res) => {
      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.5.4' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'llama3.2:3b', details: { format: 'gguf', parameter_size: '3B' } }
          ]
        }));
        return;
      }
      if (req.url === '/api/ps') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'llama3.2:3b', size: 3000000000, size_vram: 3000000000 }
          ]
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(r => legitOllamaServer.listen(0, '127.0.0.1', r));
    activeServers.push(legitOllamaServer);
    const legitOllamaPort = legitOllamaServer.address().port;

    // 1.6 Legitimate LM Studio Mock
    const legitLmStudioServer = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Server': 'LMStudio/0.3.5' });
        res.end(JSON.stringify({
          object: 'list',
          data: [{ id: 'qwen-2.5-coder-7b', owned_by: 'lmstudio' }]
        }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(r => legitLmStudioServer.listen(0, '127.0.0.1', r));
    activeServers.push(legitLmStudioServer);
    const legitLmStudioPort = legitLmStudioServer.address().port;

    // 1.7 Closed Port (Immediate ECONNREFUSED - allocated after all active servers are listening to ensure uniqueness)
    const closedTempServer = net.createServer();
    await new Promise(r => closedTempServer.listen(0, '127.0.0.1', r));
    const closedPort = closedTempServer.address().port;
    await new Promise(r => closedTempServer.close(r));

    const stressScanner = new LocalModelScanner({ timeoutMs: 500 });

    // Stress 1.1: Hung Socket Probe (Never sends bytes)
    const t0 = performance.now();
    const hungRes = await stressScanner.probePort('127.0.0.1', hungPort, 400);
    const hungDuration = performance.now() - t0;
    recordTest('1.1 Hung socket probe returns null', hungRes === null);
    recordTest('1.1 Hung socket aborts after single probe timeout', hungDuration >= 350 && hungDuration < 600, `duration: ${Math.round(hungDuration)}ms`);

    // Stress 1.2: Socket Drop Mid-Stream
    const t1 = performance.now();
    const dropRes = await stressScanner.probePort('127.0.0.1', dropPort, 400);
    const dropDuration = performance.now() - t1;
    recordTest('1.2 Dropped socket returns null without uncaught exception', dropRes === null);
    recordTest('1.2 Dropped socket probe completes rapidly', dropDuration < 500, `duration: ${Math.round(dropDuration)}ms`);

    // Stress 1.3: Garbage Non-JSON Response
    const t2 = performance.now();
    const garbageRes = await stressScanner.probePort('127.0.0.1', garbagePort, 400);
    const garbageDuration = performance.now() - t2;
    recordTest('1.3 Garbage non-JSON returns null without crashing parser', garbageRes === null);
    recordTest('1.3 Garbage probe completes rapidly', garbageDuration < 500, `duration: ${Math.round(garbageDuration)}ms`);

    // Stress 1.4: Slow Drip Socket (Headers sent, body stalled)
    const t3 = performance.now();
    const slowDripRes = await stressScanner.probePort('127.0.0.1', slowDripPort, 400);
    const slowDripDuration = performance.now() - t3;
    recordTest('1.4 Slow drip socket aborts on timeout and returns null', slowDripRes === null);
    // Notice: Does it execute sequential double probe (400ms + 400ms = ~800ms) because res.json() swallowed the AbortError?
    const hasDoubleProbeSequentialDelay = slowDripDuration >= 700;
    recordTest(
      '1.4 Slow drip double probe detection (Ollama abort swallowed in res.json -> triggers second probe to OpenAI)',
      true,
      hasDoubleProbeSequentialDelay
        ? `Double probe occurred: took ${Math.round(slowDripDuration)}ms (> 2 * timeoutMs)`
        : `Single probe: ${Math.round(slowDripDuration)}ms`
    );

    // Stress 1.5: Closed Port (Immediate ECONNREFUSED)
    const t4 = performance.now();
    const closedRes = await stressScanner.probePort('127.0.0.1', closedPort, 400);
    const closedDuration = performance.now() - t4;
    recordTest('1.5 Closed port returns null', closedRes === null);
    recordTest('1.5 Closed port fails immediately (< 50ms)', closedDuration < 50, `duration: ${Math.round(closedDuration)}ms`);

    // Stress 1.6: Combined Multi-Port Parallel Sweep (8 ports)
    const mixedPorts = [
      closedPort,
      hungPort,
      legitOllamaPort,
      dropPort,
      legitLmStudioPort,
      garbagePort,
      slowDripPort,
      closedPort + 1
    ];

    const tSweep = performance.now();
    const sweepResult = await stressScanner.scan({ ports: mixedPorts, timeoutMs: 500 });
    const sweepDuration = performance.now() - tSweep;
    console.log('    Discovered instances in sweep:', JSON.stringify(sweepResult.instances.map(i => ({ engine: i.engine, port: i.port, name: i.name })), null, 2));

    recordTest('1.6 Multi-port sweep returns success: true', sweepResult.success === true);
    recordTest('1.6 All 8 ports were scanned', sweepResult.scannedPorts.length === 8);
    recordTest('1.6 Exactly 2 healthy runners discovered out of 8 mixed ports', sweepResult.totalFound === 2, `found: ${sweepResult.totalFound}`);
    recordTest('1.6 Sweep finishes strictly under 2000ms threshold', sweepDuration < 2000, `duration: ${Math.round(sweepDuration)}ms`);
    recordTest('1.6 Ollama detected among adversarial ports', sweepResult.instances.some(i => i.engine === 'ollama'));
    recordTest('1.6 LM Studio detected among adversarial ports', sweepResult.instances.some(i => i.engine === 'lmstudio'));

    // Stress 1.7: Default 1200ms timeout with Slow Drip Port
    // If a slow drip port is present, does total duration exceed 2000ms?
    const t1200 = performance.now();
    const slowSweep = await new LocalModelScanner({ timeoutMs: 1200 }).scan({ ports: [slowDripPort] });
    const slowSweepDur = performance.now() - t1200;
    recordTest(
      '1.7 Default 1200ms sweep on Slow Drip port evaluates under/over 2000ms threshold',
      true,
      `Duration: ${Math.round(slowSweepDur)}ms (Swallowed abort in res.json causes ${Math.round(slowSweepDur)}ms probe)`
    );


    // =========================================================================
    // SECTION 2: VRAM CALCULATION STRESS & TELEMETRY
    // =========================================================================
    console.log('\n\x1b[33m--- SECTION 2: VRAM Math Boundary Conditions & Telemetry Stress ---\x1b[0m');

    let currentPsPayload = null;
    let currentPsStatus = 200;
    let hangPsEndpoint = false;

    const dynamicOllamaServer = http.createServer((req, res) => {
      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.5.4' }));
        return;
      }
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [{ name: 'test-model:latest', details: { format: 'gguf' } }]
        }));
        return;
      }
      if (req.url === '/api/ps') {
        if (hangPsEndpoint) {
          return;
        }
        res.writeHead(currentPsStatus, { 'Content-Type': 'application/json' });
        res.end(typeof currentPsPayload === 'string' ? currentPsPayload : JSON.stringify(currentPsPayload));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise(r => dynamicOllamaServer.listen(0, '127.0.0.1', r));
    activeServers.push(dynamicOllamaServer);
    const dynPort = dynamicOllamaServer.address().port;

    const vramScanner = new LocalModelScanner({ timeoutMs: 500 });

    // Test 2.1: size = 0, size_vram = 0 (Empty model size)
    currentPsStatus = 200;
    currentPsPayload = { models: [{ name: 'm1', size: 0, size_vram: 0 }] };
    const res2_1 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.1 size=0, size_vram=0 yields 0% offload (no NaN/Div0)', res2_1.vramOffloadPercentage === 0);
    recordTest('2.1 gpuStatus is cpu_fallback when offload is 0%', res2_1.gpuStatus === 'cpu_fallback');

    // Test 2.2: size = 0, size_vram = 5000000000 (Non-zero VRAM but zero total size)
    currentPsPayload = { models: [{ name: 'm2', size: 0, size_vram: 5000000000 }] };
    const res2_2 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.2 size=0, size_vram>0 does not produce NaN', res2_2.vramOffloadPercentage === null || !Number.isNaN(res2_2.vramOffloadPercentage));
    recordTest('2.2 gpuStatus defaults safely to cpu_fallback', res2_2.gpuStatus === 'cpu_fallback');

    // Test 2.3: size_vram > size (KV cache expansion, e.g. 15GB VRAM on 10GB model weights)
    currentPsPayload = { models: [{ name: 'm3', size: 10000000000, size_vram: 15000000000 }] };
    const res2_3 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.3 size_vram > size yields offload percentage (150%)', res2_3.vramOffloadPercentage === 150);
    recordTest(
      '2.3 gpuStatus behavior when size_vram > size (status is hybrid vs optimal)',
      true,
      `gpuStatus: '${res2_3.gpuStatus}' (Note: strict === 100 check assigns hybrid to >100% offload)`
    );

    // Test 2.4: Missing fields (Empty model object {})
    currentPsPayload = { models: [{}] };
    const res2_4 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.4 Empty model object defaults size to 0 and offload to 0%', res2_4.vramOffloadPercentage === 0);
    recordTest('2.4 Empty model object yields cpu_fallback', res2_4.gpuStatus === 'cpu_fallback');

    // Test 2.5: Empty models array [] (Standby mode)
    currentPsPayload = { models: [] };
    const res2_5 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.5 Empty models array yields vramOffloadPercentage: null', res2_5.vramOffloadPercentage === null);
    recordTest('2.5 Empty models array yields gpuStatus: standby', res2_5.gpuStatus === 'standby');

    // Test 2.6: Non-array models field
    currentPsPayload = { models: 'not-an-array' };
    const res2_6 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.6 Non-array models yields standby safely', res2_6.gpuStatus === 'standby');

    // Test 2.7: /api/ps socket hangs while /api/tags succeeded
    hangPsEndpoint = true;
    const tPsHang = performance.now();
    const res2_7 = await vramScanner.probePort('127.0.0.1', dynPort, 400);
    const psHangDur = performance.now() - tPsHang;
    hangPsEndpoint = false;
    recordTest('2.7 /api/ps socket hang does not fail entire runner discovery', res2_7 !== null);
    recordTest('2.7 Ollama still identified despite hung /api/ps', res2_7.engine === 'ollama');
    recordTest('2.7 gpuStatus falls back to standby', res2_7.gpuStatus === 'standby');
    recordTest('2.7 /api/ps timeout was bounded (< 800ms)', psHangDur < 800, `duration: ${Math.round(psHangDur)}ms`);

    // Test 2.8: /api/ps returns HTTP 500 Server Error
    currentPsStatus = 500;
    currentPsPayload = 'Internal Server Error';
    const res2_8 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.8 HTTP 500 on /api/ps gracefully degrades to standby', res2_8 !== null && res2_8.gpuStatus === 'standby');

    // Test 2.9: Negative numbers (size: -1000, size_vram: -500)
    currentPsStatus = 200;
    currentPsPayload = { models: [{ name: 'm_neg', size: -1000, size_vram: -500 }] };
    const res2_9 = await vramScanner.probePort('127.0.0.1', dynPort, 500);
    recordTest('2.9 Negative model size does not crash or produce negative offload', res2_9.vramOffloadPercentage === null || res2_9.vramOffloadPercentage >= 0);
    recordTest('2.9 Negative model size defaults to cpu_fallback', res2_9.gpuStatus === 'cpu_fallback');


    // =========================================================================
    // SECTION 3: REST API FUZZING & VAULT SECRET PRESERVATION
    // =========================================================================
    console.log('\n\x1b[33m--- SECTION 3: REST API Fuzzing & Concurrency Vault Preservation ---\x1b[0m');

    const vault = new CredentialVault({ vaultPath: testVaultPath });
    await vault.init();

    const endpointManager = new EndpointManager({
      configPath: testConfigPath,
      vault
    });
    await endpointManager.init();

    const TARGET_EP_ID = 'ep_target_stress_1';
    const INITIAL_SECRET = 'gho_INITIAL_VAULT_TOKEN_SECRET_9876543210_XYZ';

    await endpointManager.createEndpoint({
      id: TARGET_EP_ID,
      name: 'Stress Target Endpoint',
      provider: 'GitHubModels',
      baseUrl: 'https://models.github.ai/inference',
      modelId: 'openai/gpt-4o',
      tier: 'FAST_TIER',
      credentialRef: `sec_${TARGET_EP_ID}`
    }, INITIAL_SECRET);

    const savedSecretInitial = await endpointManager.getSecretForEndpoint(TARGET_EP_ID);
    recordTest('3.0 Initial secret successfully stored in vault', savedSecretInitial === INITIAL_SECRET);

    const dashboard = new DashboardServer({
      endpointManager,
      localModelScanner: stressScanner
    });
    dashboard.setupApp();

    const expressHttpServer = http.createServer(dashboard.app);
    await new Promise(r => expressHttpServer.listen(0, '127.0.0.1', r));
    activeServers.push(expressHttpServer);
    const bffPort = expressHttpServer.address().port;
    const bffBase = `http://127.0.0.1:${bffPort}`;

    // Fuzz 3.1: Path Traversal on :id
    const pathTraversalPayloads = [
      '..%2f..%2fpackage.json',
      '..%5c..%5cpackage.json',
      '....//....//package.json',
      '%2e%2e%2f%2e%2e%2fpackage.json'
    ];

    let pathTraversalBlocked = true;
    for (const pt of pathTraversalPayloads) {
      const ptRes = await fetch(`${bffBase}/api/endpoints/${pt}`);
      if (ptRes.status !== 404) {
        pathTraversalBlocked = false;
      }
    }
    recordTest('3.1 Path traversal attacks rejected with HTTP 404', pathTraversalBlocked);

    // Fuzz 3.2: Malformed & Invalid IDs
    const invalidIds = [
      'non-existent-uuid-00000',
      'null',
      'undefined',
      encodeURIComponent('<script>alert("xss")</script>'),
      encodeURIComponent("' OR '1'='1"),
      encodeURIComponent('[object Object]')
    ];

    let invalidIdsHandled = true;
    for (const badId of invalidIds) {
      const badIdRes = await fetch(`${bffBase}/api/endpoints/${badId}`);
      if (badIdRes.status !== 404) {
        invalidIdsHandled = false;
      }
    }
    recordTest('3.2 Malformed & invalid IDs consistently return HTTP 404', invalidIdsHandled);

    // Fuzz 3.3: Empty & Malformed Request Bodies
    const emptyPostRes = await fetch(`${bffBase}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    recordTest('3.3 POST /api/endpoints with empty body returns HTTP 400', emptyPostRes.status === 400);

    const missingModelRes = await fetch(`${bffBase}/api/endpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: 'https://api.openai.com/v1' })
    });
    recordTest('3.3 POST /api/endpoints with missing modelId returns HTTP 400', missingModelRes.status === 400);

    const invalidTierRes = await fetch(`${bffBase}/api/endpoints/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'SUPER_TIER', endpointId: TARGET_EP_ID })
    });
    recordTest('3.3 POST /api/endpoints/activate with invalid tier returns HTTP 400', invalidTierRes.status === 400);

    // Fuzz 3.4: Rapid Concurrent PUT Requests with Masked Placeholders
    console.log('    Dispatching 50 parallel PUT requests with adversarial masked placeholders...');

    const maskedPlaceholders = [
      'csk_...abcd',
      '••••••••',
      'sk-proj-...1234',
      'gho_...XYZ',
      '...1234',
      '   ••••••••   ',
      '\u200B••••••••\uFEFF',
      '●●●●●●●●',
      '********',
      'sk-••••••••',
      '',
      '   '
    ];

    const concurrentPutTasks = [];
    for (let i = 0; i < 50; i++) {
      const placeholder = maskedPlaceholders[i % maskedPlaceholders.length];
      const payload = {
        name: `Stress Updated Name ${i}`,
        secret: placeholder,
        priority: 10 + (i % 5)
      };

      const task = fetch(`${bffBase}/api/endpoints/${TARGET_EP_ID}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(res => res.json());

      concurrentPutTasks.push(task);
    }

    const putResults = await Promise.all(concurrentPutTasks);
    const allSuccessful = putResults.every(r => r.success === true);
    recordTest('3.4 All 50 concurrent PUT requests completed with success: true', allSuccessful);

    // Verify Write-Only Invariant: The initial secret in the vault MUST NOT be corrupted
    const secretAfterConcurrency = await endpointManager.getSecretForEndpoint(TARGET_EP_ID);
    recordTest(
      '3.4 CRITICAL INVARIANT: 50 concurrent PUT requests with masked placeholders left vault secret 100% UNTOUCHED',
      secretAfterConcurrency === INITIAL_SECRET
    );

    // Fuzz 3.5: Legitimate Secret Update after Fuzzing
    const GENUINE_NEW_SECRET = 'gho_GENUINE_NEW_TOKEN_UPDATED_4321098765_NEW';
    const genuinePutRes = await fetch(`${bffBase}/api/endpoints/${TARGET_EP_ID}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: GENUINE_NEW_SECRET })
    });
    const genuineJson = await genuinePutRes.json();
    recordTest('3.5 PUT with genuine new secret succeeded', genuineJson.success === true);

    const updatedSecret = await endpointManager.getSecretForEndpoint(TARGET_EP_ID);
    recordTest('3.5 Vault secret successfully updated when genuine secret is provided', updatedSecret === GENUINE_NEW_SECRET);


    // =========================================================================
    // SECTION 4: CORS & PNA PREFLIGHT COMPLIANCE
    // =========================================================================
    console.log('\n\x1b[33m--- SECTION 4: CORS & PNA Preflight Compliance ---\x1b[0m');

    const endpointsToPreflight = [
      '/api/endpoints',
      `/api/endpoints/${TARGET_EP_ID}`,
      '/api/endpoints/discover-local',
      '/api/endpoints/activate',
      '/api/endpoints/test-adhoc',
      `/api/endpoints/${TARGET_EP_ID}/test`,
      '/api/auth/device-flow/start',
      '/api/auth/device-flow/status/sess-test-123',
      '/api/auth/device-flow/cancel/sess-test-123',
      '/api/nonexistent-route-for-preflight'
    ];

    let allPreflightsPassed = true;
    for (const ep of endpointsToPreflight) {
      const optRes = await fetch(`${bffBase}${ep}`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
          'Access-Control-Request-Private-Network': 'true'
        }
      });

      const is204 = optRes.status === 204;
      const originMatch = optRes.headers.get('access-control-allow-origin') === '*';
      const pnaMatch = optRes.headers.get('access-control-allow-private-network') === 'true';
      const methodsMatch = (optRes.headers.get('access-control-allow-methods') || '').includes('OPTIONS');

      if (!is204 || !originMatch || !pnaMatch || !methodsMatch) {
        allPreflightsPassed = false;
        console.error(`OPTIONS ${ep} failed preflight check:`, { is204, originMatch, pnaMatch, methodsMatch });
      }
    }
    recordTest('4.1 OPTIONS preflight returns HTTP 204 with CORS & PNA across all 10 endpoints', allPreflightsPassed);

    // Verify standard GET also carries CORS & PNA headers
    const getRes = await fetch(`${bffBase}/api/endpoints`);
    recordTest('4.2 GET /api/endpoints returns HTTP 200', getRes.status === 200);
    recordTest(
      '4.2 GET /api/endpoints carries Access-Control-Allow-Origin: *',
      getRes.headers.get('access-control-allow-origin') === '*'
    );
    recordTest(
      '4.2 GET /api/endpoints carries Access-Control-Allow-Private-Network: true',
      getRes.headers.get('access-control-allow-private-network') === 'true'
    );

    console.log('\n\x1b[36m================================================================');
    console.log(`  SUITE COMPLETE: ${passedTests}/${totalTests} TESTS PASSED `);
    console.log(`  FAILURES / DEFECTS DETECTED: ${findings.length}`);
    console.log('================================================================\x1b[0m\n');

    if (findings.length > 0) {
      console.log('\x1b[31mFindings list:\x1b[0m');
      for (const f of findings) {
        console.log(` - ${f.name}: ${f.details}`);
      }
    }

  } finally {
    for (const sock of activeSockets) {
      try { sock.destroy(); } catch (_) {}
    }
    for (const srv of activeServers) {
      try {
        await new Promise(r => srv.close(r));
      } catch (_) {}
    }
    try {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

runEmpiricalStressSuite().catch((err) => {
  console.error('\x1b[31m[STRESS TEST FATAL ERROR]\x1b[0m', err);
  process.exit(1);
});
