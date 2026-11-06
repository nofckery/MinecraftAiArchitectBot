/**
 * CHALLENGER M7-2 EMPIRICAL STRESS TEST HARNESS
 *
 * Rigorous empirical stress-testing for Milestone M7:
 * 1. Device Flow Lifecycle & Error Resilience (RFC 8628, slow_down, 15-min expiration, cancel route, race condition)
 * 2. Multi-Port Scanner Sweep Under Extreme Conditions (closed ports, hung ports, partial VRAM, malformed JSON)
 * 3. Two-Tier Probe Failure Modes (429 Rate Limit, 429 Insufficient Quota, 503 Server Error, 90s Cold Start)
 * 4. Express Backend Robustness & Client Disconnect Mid-Probe (aborted sockets, burst disconnects, zero crash/hang)
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DeviceFlowManager } from '../src/security/deviceFlowManager.js';
import { LocalModelScanner } from '../src/ai/localModelScanner.js';
import { SafeProbeWorker } from '../src/ai/safeProbeWorker.js';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { LLMRouter } from '../src/ai/llmRouter.js';

let totalTests = 0;
let passedTests = 0;
const failures = [];

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    failures.push(message);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

/**
 * Creates an ephemeral HTTP server on an OS-assigned free port.
 */
function createEphemeralServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, baseUrl: `http://127.0.0.1:${port}` });
    });
    server.on('error', reject);
  });
}

/**
 * Helper to close a server safely.
 */
function closeServer(server) {
  return new Promise((resolve) => {
    if (!server || !server.listening) return resolve();
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

/**
 * Helper for making HTTP requests.
 */
function makeRequest(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json
        });
      });
    });

    req.on('error', reject);

    if (body) {
      if (typeof body === 'object') {
        if (!reqOptions.headers['Content-Type']) {
          req.setHeader('Content-Type', 'application/json');
        }
        req.write(JSON.stringify(body));
      } else {
        req.write(body);
      }
    }
    req.end();
  });
}

async function runEmpiricalStressSuite() {
  console.log('\x1b[35m========================================================================\x1b[0m');
  console.log('\x1b[35m=== CHALLENGER M7-2: EMPIRICAL STRESS TEST & ERROR RESILIENCE SUITE ===\x1b[0m');
  console.log('\x1b[35m========================================================================\x1b[0m\n');

  // Track uncaught errors or unhandled rejections during test execution
  let unhandledRejectionsCount = 0;
  let uncaughtExceptionsCount = 0;
  const onUnhandled = (err) => {
    unhandledRejectionsCount++;
    console.error('\x1b[41m[UNHANDLED REJECTION CAUGHT IN TEST HARNESS]\x1b[0m', err);
  };
  const onUncaught = (err) => {
    uncaughtExceptionsCount++;
    console.error('\x1b[41m[UNCAUGHT EXCEPTION CAUGHT IN TEST HARNESS]\x1b[0m', err);
  };
  process.on('unhandledRejection', onUnhandled);
  process.on('uncaughtException', onUncaught);

  const fixtureDir = path.resolve('test/fixtures/challenger_m7_stress');
  if (!fs.existsSync(fixtureDir)) fs.mkdirSync(fixtureDir, { recursive: true });

  const testVaultFile = path.join(fixtureDir, 'stress_vault.enc.json');
  const testConfigFile = path.join(fixtureDir, 'stress_endpoints.json');
  if (fs.existsSync(testVaultFile)) fs.unlinkSync(testVaultFile);
  if (fs.existsSync(testConfigFile)) fs.unlinkSync(testConfigFile);

  const vault = new CredentialVault({ storagePath: testVaultFile });
  await vault.init();

  const router = new LLMRouter();
  const endpointManager = new EndpointManager({
    configPath: testConfigFile,
    vault,
    llmRouter: router
  });
  await endpointManager.init();

  const probeWorker = new SafeProbeWorker({
    phase1TimeoutMs: 1200,
    phase2TimeoutMs: 2000,
    localPhase2TimeoutMs: 3000
  });

  const dashboard = new DashboardServer({
    port: 0,
    vault,
    endpointManager,
    safeProbeWorker: probeWorker,
    llmRouter: router
  });
  dashboard.setupApp();
  const dashboardHttp = http.createServer(dashboard.app);
  await new Promise(r => dashboardHttp.listen(0, '127.0.0.1', r));
  const dashboardPort = dashboardHttp.address().port;
  const bffBase = `http://127.0.0.1:${dashboardPort}`;
  console.log(`[Setup] Stress DashboardServer listening on ${bffBase}`);

  try {
    // =========================================================================
    // GROUP 1: DEVICE FLOW LIFECYCLE & ERROR RESILIENCE
    // =========================================================================
    console.log('\n\x1b[36m--- TEST GROUP 1: RFC 8628 DEVICE FLOW LIFECYCLE & ERROR RESILIENCE ---\x1b[0m');

    // Setup an ephemeral mock OAuth server for device flow
    let mockPollCount = 0;
    let mockPollResponses = [];
    const mockOAuth = await createEphemeralServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/login/device/code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            device_code: 'mock_dev_code_stress_999',
            user_code: 'STRS-9999',
            verification_uri: `${mockOAuth.baseUrl}/login/device`,
            verification_uri_complete: `${mockOAuth.baseUrl}/login/device?user_code=STRS-9999`,
            expires_in: 900, // 15:00 min
            interval: 1
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
          mockPollCount++;
          if (mockPollResponses.length > 0) {
            const nextResp = mockPollResponses.shift();
            res.writeHead(nextResp.status || 200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(nextResp.body));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'authorization_pending' }));
          return;
        }

        res.writeHead(404);
        res.end();
      });
    });

    const devFlowManager = new DeviceFlowManager({
      deviceCodeUrl: `${mockOAuth.baseUrl}/login/device/code`,
      tokenUrl: `${mockOAuth.baseUrl}/login/oauth/access_token`,
      vault,
      endpointManager,
      llmRouter: router
    });
    dashboard.deviceFlowManager = devFlowManager;

    // 1.1 Start device flow via REST endpoint
    const startRes = await makeRequest(`${bffBase}/api/auth/device-flow/start`, { method: 'POST' });
    assert(startRes.status === 200, '1.1 POST /api/auth/device-flow/start returns HTTP 200');
    assert(startRes.json?.success === true, '1.1 Session response contains success: true');
    assert(startRes.json?.userCode === 'STRS-9999', '1.1 User code STRS-9999 returned');
    assert(startRes.json?.expiresIn === 900, '1.1 Expiration timer initialised to 900s (15:00 min)');
    assert(typeof startRes.json?.sessionId === 'string', '1.1 Valid sessionId generated');
    const sessionId1 = startRes.json.sessionId;

    // 1.2 Check initial status
    const status1 = await makeRequest(`${bffBase}/api/auth/device-flow/status/${sessionId1}`);
    assert(status1.status === 200, '1.2 GET status returns HTTP 200');
    assert(status1.json?.status === 'pending', '1.2 Initial status is pending');
    assert(status1.json?.expiresInRemaining <= 900 && status1.json?.expiresInRemaining >= 895, '1.2 Remaining countdown is within 15-min window');

    // 1.3 slow_down response handling (RFC 8628 §3.5)
    // Configure mock OAuth server to return slow_down
    mockPollResponses.push({
      status: 200,
      body: { error: 'slow_down', interval: 6 }
    });
    mockPollResponses.push({
      status: 200,
      body: { error: 'authorization_pending' }
    });

    // Wait for the polling loop to trigger slow_down
    await new Promise(r => setTimeout(r, 1200));
    const statusSlow = await makeRequest(`${bffBase}/api/auth/device-flow/status/${sessionId1}`);
    assert(statusSlow.json?.interval >= 6, `1.3 slow_down dynamically increased polling interval (now ${statusSlow.json?.interval}s >= 6s)`);

    // 1.4 Cancel route testing: POST /api/auth/device-flow/cancel/:sessionId
    const cancelRes = await makeRequest(`${bffBase}/api/auth/device-flow/cancel/${sessionId1}`, { method: 'POST' });
    assert(cancelRes.status === 200, '1.4 POST /api/auth/device-flow/cancel/:sessionId returns HTTP 200');
    assert(cancelRes.json?.status === 'cancelled', '1.4 Session state updated to cancelled');

    const statusCancelled = await makeRequest(`${bffBase}/api/auth/device-flow/status/${sessionId1}`);
    assert(statusCancelled.json?.status === 'cancelled', '1.4 Querying status confirms session is cancelled');

    // Verify calling cancel on nonexistent session returns 404
    const cancelNotFound = await makeRequest(`${bffBase}/api/auth/device-flow/cancel/nonexistent_session_id_404`, { method: 'POST' });
    assert(cancelNotFound.status === 404, '1.4 Cancelling unknown session returns HTTP 404');

    // 1.5 Expiration Timer Behavior (Simulated 15:00 min timeout)
    const startRes2 = await devFlowManager.startDeviceFlow({
      deviceCodeUrl: `${mockOAuth.baseUrl}/login/device/code`,
      tokenUrl: `${mockOAuth.baseUrl}/login/oauth/access_token`
    });
    const session2 = devFlowManager.sessions.get(startRes2.sessionId);
    assert(session2 !== undefined, '1.5 Session 2 successfully registered in memory');

    // Simulate clock advancing past 15 minutes
    session2.expiresAt = Date.now() - 1000;
    let expiredEventFired = false;
    devFlowManager.once('device_auth_expired', () => { expiredEventFired = true; });

    // Trigger poll when already past expiration
    await devFlowManager._poll(startRes2.sessionId);
    assert(session2.status === 'expired', '1.5 Session status transitioned to expired upon timeout');
    assert(session2.error.includes('expired'), '1.5 Session records expired error message');
    assert(expiredEventFired === true, '1.5 device_auth_expired event fired upon expiration');

    // 1.6 Race Condition: Cancel while poll returns success
    // If user cancelled, but token is delivered in same tick, cancelled status must prevail or not resurrect timers
    const startRes3 = await devFlowManager.startDeviceFlow({
      deviceCodeUrl: `${mockOAuth.baseUrl}/login/device/code`,
      tokenUrl: `${mockOAuth.baseUrl}/login/oauth/access_token`
    });
    devFlowManager.cancelSession(startRes3.sessionId);
    assert(devFlowManager.sessions.get(startRes3.sessionId).status === 'cancelled', '1.6 Session immediately cancelled');
    // Call _poll on cancelled session
    await devFlowManager._poll(startRes3.sessionId);
    assert(devFlowManager.sessions.get(startRes3.sessionId).status === 'cancelled', '1.6 Cancelled session ignores further poll execution');
    assert(devFlowManager.sessions.get(startRes3.sessionId).timerId === null, '1.6 No dangling timers left for cancelled session');

    await closeServer(mockOAuth.server);

    // =========================================================================
    // GROUP 2: MULTI-PORT SCANNER SWEEP UNDER EXTREME CONDITIONS
    // =========================================================================
    console.log('\n\x1b[36m--- TEST GROUP 2: MULTI-PORT SCANNER SWEEP UNDER EXTREME CONDITIONS ---\x1b[0m');

    const scanner = new LocalModelScanner({ timeoutMs: 800 });

    // 2.1 All ports closed / unreachable (ECONNREFUSED)
    // Choose 5 random high ports where definitely nothing is running
    const deadPorts = [59111, 59112, 59113, 59114, 59115];
    const deadSweepStart = performance.now();
    const deadSweep = await scanner.scan({ ports: deadPorts, timeoutMs: 600 });
    const deadSweepDuration = performance.now() - deadSweepStart;

    assert(deadSweep.success === true, '2.1 Scanner returns success: true even when all ports closed');
    assert(deadSweep.instances.length === 0, '2.1 Zero instances discovered on dead ports');
    assert(deadSweep.totalFound === 0, '2.1 totalFound is 0');
    assert(deadSweepDuration < 1500, `2.1 Parallel scan across 5 closed ports took ${Math.round(deadSweepDuration)}ms (< 1500ms fast fail)`);

    // 2.2 Slow / hung ports (Simulate network hang / blackhole socket)
    // Server accepts TCP connection but never sends HTTP headers back
    const hungSockets = new Set();
    const hungServer = net.createServer((socket) => {
      hungSockets.add(socket);
      socket.on('close', () => hungSockets.delete(socket));
    });
    const hungPort = await new Promise((resolve) => {
      hungServer.listen(0, '127.0.0.1', () => resolve(hungServer.address().port));
    });

    const hungSweepStart = performance.now();
    const hungSweep = await scanner.scan({ ports: [hungPort], timeoutMs: 500 });
    const hungSweepDuration = performance.now() - hungSweepStart;

    assert(hungSweep.instances.length === 0, '2.2 Hung port yielded 0 instances');
    assert(hungSweepDuration < 1200, `2.2 Hung port aborted by timeout in ${Math.round(hungSweepDuration)}ms (< 1200ms) without hanging process`);

    hungServer.closeAllConnections?.();
    for (const socket of hungSockets) {
      socket.destroy();
    }
    await new Promise(r => hungServer.close(r));

    // 2.3 Partial VRAM Payloads
    // Create mock Ollama runner that tests various VRAM permutations
    let vramMockMode = 'missing_fields';
    const mockOllamaServer = await createEphemeralServer((req, res) => {
      if (req.url === '/api/tags') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          models: [
            { name: 'llama3.2:latest', size: 4000000000, details: { format: 'gguf', parameter_size: '3B' } }
          ]
        }));
        return;
      }

      if (req.url === '/api/version') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ version: '0.4.1' }));
        return;
      }

      if (req.url === '/api/ps') {
        if (vramMockMode === 'missing_fields') {
          // Model present, but size_vram and size completely missing
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:latest' }]
          }));
          return;
        }

        if (vramMockMode === 'zero_sizes') {
          // Both 0 -> potential division by zero
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:latest', size_vram: 0, size: 0 }]
          }));
          return;
        }

        if (vramMockMode === 'partial_offload_50') {
          // 4GB VRAM out of 8GB total -> 50% hybrid
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:latest', size_vram: 4000000000, size: 8000000000 }]
          }));
          return;
        }

        if (vramMockMode === 'full_offload_100') {
          // 8GB VRAM out of 8GB total -> 100% optimal
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            models: [{ name: 'llama3.2:latest', size_vram: 8000000000, size: 8000000000 }]
          }));
          return;
        }

        if (vramMockMode === 'empty_ps') {
          // Idle Ollama instance (no models loaded into VRAM)
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ models: [] }));
          return;
        }

        if (vramMockMode === 'ps_http_500') {
          // Error in /api/ps endpoint
          res.writeHead(500);
          res.end('Internal Server Error in GPU monitor');
          return;
        }
      }

      res.writeHead(404);
      res.end();
    });

    // 2.3a Missing fields
    vramMockMode = 'missing_fields';
    const rMissing = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(rMissing !== null, '2.3a Ollama detected despite missing VRAM fields');
    assert(rMissing.vramOffloadPercentage === 0 || rMissing.vramOffloadPercentage === null, '2.3a Missing fields safely handled without NaN or crash');
    assert(rMissing.gpuStatus === 'cpu_fallback', '2.3a GPU status identified as cpu_fallback');

    // 2.3b Zero sizes (division by zero defense)
    vramMockMode = 'zero_sizes';
    const rZero = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(rZero.vramOffloadPercentage === 0, '2.3b Zero size division handled gracefully (0% offload)');
    assert(rZero.gpuStatus === 'cpu_fallback', '2.3b Zero VRAM mapped to cpu_fallback');

    // 2.3c 50% Hybrid offload
    vramMockMode = 'partial_offload_50';
    const r50 = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(r50.vramOffloadPercentage === 50, '2.3c 50% VRAM offload calculated accurately');
    assert(r50.gpuStatus === 'hybrid', '2.3c GPU status mapped to hybrid');

    // 2.3d 100% Optimal offload
    vramMockMode = 'full_offload_100';
    const r100 = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(r100.vramOffloadPercentage === 100, '2.3d 100% VRAM offload calculated accurately');
    assert(r100.gpuStatus === 'optimal', '2.3d GPU status mapped to optimal');

    // 2.3e Empty ps (idle runner)
    vramMockMode = 'empty_ps';
    const rEmpty = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(rEmpty.activeModel === null, '2.3e Idle runner has activeModel null');
    assert(rEmpty.gpuStatus === 'standby', '2.3e Idle runner mapped to standby');

    // 2.3f /api/ps error (HTTP 500)
    vramMockMode = 'ps_http_500';
    const r500 = await scanner.probePort('127.0.0.1', mockOllamaServer.port, 800);
    assert(r500.online === true, '2.3f Server identified as online despite /api/ps failure');
    assert(r500.models.length === 1, '2.3f Model catalog still retrieved from /api/tags');

    await closeServer(mockOllamaServer.server);

    // 2.4 Malformed JSON handling
    const malformedServer = await createEphemeralServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url.includes('/api/tags')) {
        // Return raw HTML instead of JSON
        res.end('<!DOCTYPE html><html><body><h1>502 Bad Gateway Nginx</h1></body></html>');
      } else {
        // Truncated JSON
        res.end('{"models": [{"name": "broken');
      }
    });

    const malformedResult = await scanner.probePort('127.0.0.1', malformedServer.port, 600);
    assert(malformedResult === null, '2.4 Malformed HTML and truncated JSON returned null without throwing uncaught parse error');

    await closeServer(malformedServer.server);

    // 2.5 REST endpoint /api/endpoints/discover-local via Express BFF
    const bffDiscoverRes = await makeRequest(`${bffBase}/api/endpoints/discover-local?ports=${deadPorts.slice(0, 2).join(',')}&timeout=500`);
    assert(bffDiscoverRes.status === 200, '2.5 GET /api/endpoints/discover-local returns HTTP 200');
    assert(bffDiscoverRes.json?.success === true, '2.5 Discover response success is true');
    assert(Array.isArray(bffDiscoverRes.json?.instances), '2.5 Instances array returned');

    // =========================================================================
    // GROUP 3: TWO-TIER PROBE FAILURE MODES & COLD-START RESILIENCE
    // =========================================================================
    console.log('\n\x1b[36m--- TEST GROUP 3: TWO-TIER PROBE FAILURE MODES & COLD-STARTS ---\x1b[0m');

    // Setup an ephemeral Mock LLM Provider to test failure modes
    let mockLlmBehavior = 'healthy';
    const mockLlmServer = await createEphemeralServer((req, res) => {
      if (req.url === '/v1/models') {
        if (mockLlmBehavior === '401_invalid_key') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API Key', code: 'invalid_api_key' } }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ id: 'gpt-4o' }, { id: 'llama-3.3-70b' }]
        }));
        return;
      }

      if (req.url === '/v1/chat/completions') {
        if (mockLlmBehavior === '429_rate_limit') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '15',
            'x-ratelimit-remaining-requests': '0'
          });
          res.end(JSON.stringify({
            error: { message: 'Rate limit reached for RPM', type: 'requests' }
          }));
          return;
        }

        if (mockLlmBehavior === '429_insufficient_quota') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: 'You exceeded your current quota, please check your plan and billing details.',
              type: 'insufficient_quota',
              code: 'insufficient_quota'
            }
          }));
          return;
        }

        if (mockLlmBehavior === '503_server_error') {
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('Service Temporarily Unavailable: High GPU cluster load');
          return;
        }

        if (mockLlmBehavior === 'malformed_choice_schema') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'chatcmpl-invalid',
            choices: [] // Empty choices array!
          }));
          return;
        }

        if (mockLlmBehavior === 'slow_cold_start') {
          // Simulate 350ms delay in local model memory load
          setTimeout(() => {
            res.writeHead(200, {
              'Content-Type': 'application/json',
              'x-ratelimit-remaining-requests': '999'
            });
            res.end(JSON.stringify({
              id: 'chatcmpl-local-1',
              choices: [{ message: { role: 'assistant', content: '1' } }]
            }));
          }, 350);
          return;
        }

        // Healthy default
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'x-ratelimit-remaining-requests': '850',
          'x-ratelimit-remaining-tokens': '150000'
        });
        res.end(JSON.stringify({
          id: 'chatcmpl-healthy-1',
          choices: [{ message: { role: 'assistant', content: '1' } }]
        }));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    // 3.1 HTTP 429 Rate Limit Simulation
    mockLlmBehavior = '429_rate_limit';
    const probe429 = await probeWorker.probeEndpoint({
      baseUrl: `${mockLlmServer.baseUrl}/v1`,
      modelId: 'gpt-4o'
    }, 'dummy-key');

    assert(probe429.success === false, '3.1 Rate limit probe returned success: false');
    assert(probe429.status === 'cooldown', '3.1 Status categorized as cooldown');
    assert(probe429.error?.code === 'RATE_LIMIT', '3.1 Error taxonomy identified as RATE_LIMIT');
    assert(probe429.rateLimits?.retryAfterSec === 15, '3.1 Extracted Retry-After header of 15 seconds');
    assert(probe429.rateLimits?.remainingRequests === 0, '3.1 Extracted remainingRequests: 0');

    // 3.2 HTTP 429 Insufficient Quota Simulation
    mockLlmBehavior = '429_insufficient_quota';
    const probeQuota = await probeWorker.probeEndpoint({
      baseUrl: `${mockLlmServer.baseUrl}/v1`,
      modelId: 'gpt-4o'
    }, 'dummy-key');

    assert(probeQuota.success === false, '3.2 Insufficient quota probe returned success: false');
    assert(probeQuota.error?.code === 'INSUFFICIENT_QUOTA', '3.2 Error taxonomy identified as INSUFFICIENT_QUOTA');
    assert(probeQuota.error?.message.includes('Guthaben'), '3.2 Actionable German message "Guthaben aufgebraucht"');

    // 3.3 HTTP 503 Service Unavailable Simulation
    mockLlmBehavior = '503_server_error';
    const probe503 = await probeWorker.probeEndpoint({
      baseUrl: `${mockLlmServer.baseUrl}/v1`,
      modelId: 'gpt-4o'
    }, 'dummy-key');

    assert(probe503.success === false, '3.3 503 probe returned success: false');
    assert(probe503.status === 'degraded', '3.3 Status categorized as degraded');
    assert(probe503.error?.code === 'SERVER_ERROR', '3.3 Error taxonomy identified as SERVER_ERROR');
    assert(probe503.error?.httpStatus === 503, '3.3 HTTP status 503 preserved');

    // 3.4 Schema Validation: Missing or empty choices array
    mockLlmBehavior = 'malformed_choice_schema';
    const probeMalformed = await probeWorker.probeEndpoint({
      baseUrl: `${mockLlmServer.baseUrl}/v1`,
      modelId: 'gpt-4o'
    }, 'dummy-key');

    assert(probeMalformed.success === false, '3.4 Malformed schema probe returned success: false');
    assert(probeMalformed.error?.code === 'INVALID_RESPONSE', '3.4 Empty choices caught as INVALID_RESPONSE');

    // 3.5 Local model cold-start handling & 90s timeout logic
    mockLlmBehavior = 'slow_cold_start';
    const isLocalDetected = probeWorker.isLocalUrl(`http://127.0.0.1:${mockLlmServer.port}/v1`);
    assert(isLocalDetected === true, '3.5 127.0.0.1 correctly recognized as local URL');

    let coldStartProgressReceived = false;
    const progressListener = (p) => {
      if (p.message && p.message.includes('Cold-Start')) {
        coldStartProgressReceived = true;
      }
    };
    probeWorker.on('progress', progressListener);

    const probeColdStart = await probeWorker.probeEndpoint({
      baseUrl: `http://127.0.0.1:${mockLlmServer.port}/v1`,
      modelId: 'gpt-4o'
    }, 'none');

    probeWorker.removeListener('progress', progressListener);

    assert(probeColdStart.success === true, '3.5 Cold-start probe succeeded');
    assert(probeColdStart.latencyMs >= 300, `3.5 Accurate RTT latency recorded (${probeColdStart.latencyMs}ms >= 300ms)`);
    assert(coldStartProgressReceived === true, '3.5 Cold-start progress event emitted informing client of model load');

    await closeServer(mockLlmServer.server);

    // =========================================================================
    // GROUP 4: EXPRESS BACKEND ROBUSTNESS & CLIENT DISCONNECT MID-PROBE
    // =========================================================================
    console.log('\n\x1b[36m--- TEST GROUP 4: BACKEND ROBUSTNESS & CLIENT DISCONNECT MID-PROBE ---\x1b[0m');

    // Setup an endpoint that takes 200ms to respond to simulate an in-flight probe
    const slowBackendServer = await createEphemeralServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-slow-model' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: 'chatcmpl-slow',
              choices: [{ message: { role: 'assistant', content: 'done' } }]
            }));
          }
        }, 200);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    // Register this endpoint in endpointManager
    const slowEndpoint = await endpointManager.saveEndpoint({
      name: 'Slow Mock Endpoint',
      provider: 'Custom',
      tier: 'FAST_TIER',
      baseUrl: `${slowBackendServer.baseUrl}/v1`,
      modelId: 'mock-slow-model'
    }, 'test-secret');

    // 4.1 Abrupt Client Disconnect mid-probe (POST /api/endpoints/:id/test)
    // Client opens request, sends payload, and destroys socket after 30ms while server is in middle of probe
    const disconnectPromise = new Promise((resolve, reject) => {
      const clientReq = http.request({
        hostname: '127.0.0.1',
        port: dashboardPort,
        path: `/api/endpoints/${slowEndpoint.id}/test`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }, (res) => {
        // Should not reach full completion because client disconnects
      });

      clientReq.on('error', (err) => {
        // Expected ECONNRESET / socket destroyed on client side
        resolve('client_socket_destroyed');
      });

      clientReq.write(JSON.stringify({}));
      // Destroy socket after 30ms (probe is still running in background on Express)
      setTimeout(() => {
        clientReq.destroy();
      }, 30);
    });

    await disconnectPromise;
    console.log('    [4.1] Client destroyed socket during active safe probe.');

    // Wait 300ms for backend to finish the probe and attempt to write response to aborted socket
    await new Promise(r => setTimeout(r, 350));
    assert(uncaughtExceptionsCount === 0, '4.1 Express backend did not throw uncaught exception when client aborted mid-probe');
    assert(unhandledRejectionsCount === 0, '4.1 No unhandled promise rejections on client abort');

    // 4.2 Burst Disconnect Storm: 10 concurrent clients aborting mid-probe
    console.log('    [4.2] Launching burst storm of 10 concurrent client disconnects...');
    const stormPromises = [];
    for (let i = 0; i < 10; i++) {
      stormPromises.push(new Promise((resolve) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port: dashboardPort,
          path: '/api/endpoints/test-adhoc',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        req.on('error', () => resolve('aborted'));
        req.write(JSON.stringify({
          baseUrl: `${slowBackendServer.baseUrl}/v1`,
          modelId: 'mock-slow-model'
        }));
        // Abruptly destroy each socket with variable jitter
        setTimeout(() => req.destroy(), 10 + (i * 5));
      }));
    }
    await Promise.all(stormPromises);
    await new Promise(r => setTimeout(r, 350));

    assert(uncaughtExceptionsCount === 0, '4.2 Zero uncaught exceptions during burst disconnect storm');
    assert(unhandledRejectionsCount === 0, '4.2 Zero unhandled rejections during burst disconnect storm');

    // 4.3 Health Check Verification: Backend remains fully responsive and operational
    const healthCheck = await makeRequest(`${bffBase}/api/status`);
    assert(healthCheck.status === 200, '4.3 GET /api/status returns HTTP 200 immediately after disconnect storms');
    assert(healthCheck.json?.llmProvider !== undefined, '4.3 Backend state intact and responding with valid telemetry');

    // 4.4 Subsequent safe probe succeeds without latency penalty or hung state
    const subsequentTest = await makeRequest(`${bffBase}/api/endpoints/${slowEndpoint.id}/test`, { method: 'POST' });
    assert(subsequentTest.status === 200, '4.4 Subsequent safe probe succeeds with HTTP 200');
    assert(subsequentTest.json?.success === true, '4.4 Subsequent safe probe result indicates success');
    assert(subsequentTest.json?.result?.latencyMs >= 150, '4.4 Accurate RTT latency recorded without socket corruption');

    await closeServer(slowBackendServer.server);

    // Clean up dashboard HTTP server
    await closeServer(dashboardHttp);
    devFlowManager.destroy();

    // Remove temp test files
    try {
      if (fs.existsSync(testVaultFile)) fs.unlinkSync(testVaultFile);
      if (fs.existsSync(testConfigFile)) fs.unlinkSync(testConfigFile);
      if (fs.existsSync(fixtureDir)) fs.rmdirSync(fixtureDir);
    } catch (_) {}

  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    process.removeListener('uncaughtException', onUncaught);
  }

  console.log('\n\x1b[32m========================================================================\x1b[0m');
  console.log(`\x1b[32m=== EMPIRICAL STRESS SUITE COMPLETE: ${passedTests}/${totalTests} TESTS PASSED ===\x1b[0m`);
  console.log('\x1b[32m========================================================================\x1b[0m\n');

  if (failures.length > 0) {
    console.error(`\x1b[31mFailures detected (${failures.length}):\x1b[0m`, failures);
    process.exit(1);
  }
}

runEmpiricalStressSuite().catch((err) => {
  console.error('\x1b[41mFATAL TEST RUNNER EXCEPTION:\x1b[0m', err);
  process.exit(1);
});
