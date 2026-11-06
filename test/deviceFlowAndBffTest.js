/**
 * Milestone M6 Test Suite: Schlüssellose & moderne Authentifizierung
 *
 * Tests:
 * 1. RFC 8628 Device Authorization Grant (DeviceFlowManager + MockGitHubOAuthServer)
 *    - Session start & user code generation
 *    - Polling loop with authorization_pending
 *    - Dynamic slow_down backoff (+5s)
 *    - expired_token terminal state
 *    - access_denied terminal state
 *    - Automatic CredentialVault persistence & EndpointManager registration
 *    - Manual cancellation & cleanup
 * 2. Zero-Config Local Multi-Port Sweep (LocalModelScanner)
 *    - Ollama detection, model list & VRAM telemetry calculation (100%, 0% CPU fallback, idle)
 *    - LM Studio detection & model list
 *    - Fast timeout on dead ports (ECONNREFUSED < 50ms)
 *    - Hung socket timeout protection via AbortController
 *    - Parallel execution benchmark (< 2000ms)
 * 3. Express BFF REST API & Proxy Layer (DashboardServer)
 *    - Zero-CORS & Zero-PNA preflight/headers
 *    - GET /api/endpoints (masked secrets)
 *    - GET /api/endpoints/:id (200 & 404)
 *    - POST /api/endpoints (201 & 400 validation)
 *    - PUT /api/endpoints/:id (Write-Only Secret Invariant: masked bullet & empty string preserve vault)
 *    - PUT /api/endpoints/:id (Secret update with unmasked key)
 *    - DELETE /api/endpoints/:id (200 & 404, purges vault)
 *    - POST /api/endpoints/:id/test (Two-tier safe probe)
 *    - POST /api/endpoints/test-adhoc (Unsaved probe & masked fallback)
 *    - GET /api/endpoints/discover-local (Local sweep BFF endpoint)
 *    - POST /api/auth/device-flow/start & status & cancel
 *    - POST /api/endpoints/activate (Tier activation & hot-reload)
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DeviceFlowManager } from '../src/security/deviceFlowManager.js';
import { LocalModelScanner } from '../src/ai/localModelScanner.js';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { SafeProbeWorker } from '../src/ai/safeProbeWorker.js';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { LLMRouter } from '../src/ai/llmRouter.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

/**
 * In-memory Mock GitHub OAuth Server implementing RFC 8628 endpoints.
 */
class MockGitHubOAuthServer {
  constructor(options = {}) {
    this.server = null;
    this.port = 0;
    this.baseUrl = '';
    this.deviceCode = options.deviceCode || 'mock_device_code_12345';
    this.userCode = options.userCode || 'WDJB-WQWD';
    this.accessToken = options.accessToken || 'gho_mock_access_token_987654321';
    this.mode = options.mode || 'success'; // 'success' | 'slow_down' | 'access_denied' | 'expired_token'
    this.pendingPollCount = options.pendingPollCount ?? 2;
    this.currentPollCount = 0;
    this.pollRequests = [];
    this.slowDownIncrement = options.slowDownIncrement ?? 5;
  }

  async start() {
    this.server = http.createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        let parsedBody = {};
        if (body.startsWith('{')) {
          try { parsedBody = JSON.parse(body); } catch (_) {}
        } else if (body) {
          parsedBody = Object.fromEntries(new URLSearchParams(body));
        }

        // 1. POST /login/device/code
        if (req.method === 'POST' && req.url === '/login/device/code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            device_code: this.deviceCode,
            user_code: this.userCode,
            verification_uri: `${this.baseUrl}/login/device`,
            verification_uri_complete: `${this.baseUrl}/login/device?user_code=${this.userCode}`,
            expires_in: 900,
            interval: 1 // 1 second for fast offline test
          }));
          return;
        }

        // 2. POST /login/oauth/access_token
        if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
          this.currentPollCount++;
          this.pollRequests.push({ timestamp: Date.now(), body: parsedBody });

          if (this.mode === 'access_denied') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'access_denied',
              error_description: 'The user has denied the authorization request.'
            }));
            return;
          }

          if (this.mode === 'expired_token') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'expired_token',
              error_description: 'The device_code has expired.'
            }));
            return;
          }

          if (this.mode === 'slow_down' && this.currentPollCount === 1) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'slow_down',
              error_description: 'Too many requests.',
              interval: 6
            }));
            return;
          }

          if (this.currentPollCount <= this.pendingPollCount) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              error: 'authorization_pending',
              error_description: 'The authorization request is still pending.'
            }));
            return;
          }

          // Success terminal state
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: this.accessToken,
            token_type: 'bearer',
            scope: 'read:user'
          }));
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      });
    });

    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    this.baseUrl = `http://127.0.0.1:${this.port}`;
    return this;
  }

  async stop() {
    if (this.server) {
      await new Promise(r => this.server.close(r));
      this.server = null;
    }
  }
}

/**
 * Mock LLM inference server for Two-Tier Safe Probe tests.
 */
class MockInferenceServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.baseUrl = '';
  }

  async start() {
    this.server = http.createServer((req, res) => {
      // Phase 1: GET /v1/models
      if (req.method === 'GET' && req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          object: 'list',
          data: [
            { id: 'llama-3.3-70b', owned_by: 'mock' },
            { id: 'openai/gpt-4o', owned_by: 'mock' }
          ]
        }));
        return;
      }

      // Phase 2: POST /v1/chat/completions
      if (req.method === 'POST' && req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-ratelimit-remaining-requests': '850',
            'x-ratelimit-remaining-tokens': '240000'
          });
          res.end(JSON.stringify({
            id: 'chatcmpl-mock-1',
            object: 'chat.completion',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: 'Pong' }
              }
            ]
          }));
        });
        return;
      }

      res.writeHead(404);
      res.end('Not Found');
    });

    await new Promise(r => this.server.listen(0, '127.0.0.1', r));
    this.port = this.server.address().port;
    this.baseUrl = `http://127.0.0.1:${this.port}/v1`;
    return this;
  }

  async stop() {
    if (this.server) {
      await new Promise(r => this.server.close(r));
      this.server = null;
    }
  }
}

async function runDeviceFlowAndBffTests() {
  console.log('\x1b[35m=== STARTING MILESTONE M6: DEVICE FLOW & BFF PROXY TEST SUITE ===\x1b[0m\n');

  const testDir = path.resolve('data', 'test_m6_env');
  await fs.promises.mkdir(testDir, { recursive: true });
  const testConfigPath = path.join(testDir, 'endpoints_m6.json');
  const testVaultPath = path.join(testDir, 'vault_m6.enc');

  // =========================================================================
  // TESTGRUPPE 1: RFC 8628 DEVICE FLOW MANAGER
  // =========================================================================
  console.log('--- Testgruppe 1: RFC 8628 Device Authorization Grant ---');

  // Test 1.1: Session Start & Code Retrieval
  const oauthMock = new MockGitHubOAuthServer({ pendingPollCount: 1 });
  await oauthMock.start();

  const vault = new CredentialVault({ storagePath: testVaultPath });
  await vault.init();

  const endpointManager = new EndpointManager({
    configPath: testConfigPath,
    vault
  });
  await endpointManager.init();

  const llmRouter = new LLMRouter();

  const dfManager = new DeviceFlowManager({
    endpointManager,
    vault,
    llmRouter,
    deviceCodeUrl: `${oauthMock.baseUrl}/login/device/code`,
    tokenUrl: `${oauthMock.baseUrl}/login/oauth/access_token`
  });

  const sessionInit = await dfManager.startDeviceFlow();
  assert(sessionInit.success === true, '1.1 startDeviceFlow liefert success: true');
  assert(sessionInit.userCode === 'WDJB-WQWD', '1.1 userCode entspricht WDJB-WQWD');
  assert(sessionInit.verificationUriComplete.includes('user_code=WDJB-WQWD'), '1.1 verificationUriComplete enthält user_code');
  assert(sessionInit.interval === 1, '1.1 Polling-Intervall auf Test-Server 1s');

  const statusPending = dfManager.getSessionStatus(sessionInit.sessionId);
  assert(statusPending.status === 'pending', '1.1 Initiale Sitzung befindet sich im Status pending');

  // Test 1.2: Polling Loop, Token Acquisition & Automatic Vault Persistence
  const authEventPromise = new Promise(resolve => {
    dfManager.once('device_auth_success', resolve);
  });

  const successEvt = await authEventPromise;
  assert(successEvt.provider === 'GitHub', '1.2 Event device_auth_success meldet Provider GitHub');
  assert(successEvt.endpointId === 'ep_github_models', '1.2 Endpoint ep_github_models registriert');

  const statusSuccess = dfManager.getSessionStatus(sessionInit.sessionId);
  assert(statusSuccess.status === 'success', '1.2 Sitzungsstatus wechselt auf success');
  assert(statusSuccess.endpointId === 'ep_github_models', '1.2 getSessionStatus liefert endpointId');

  // Vault Verification
  const storedSecret = await vault.getSecret('sec_github_models');
  assert(storedSecret === oauthMock.accessToken, '1.2 Access-Token sicher im CredentialVault abgelegt');

  // EndpointManager Verification
  const ghEndpoint = endpointManager.getEndpoint('ep_github_models');
  assert(ghEndpoint !== null, '1.2 ep_github_models existiert in endpoints.json');
  assert(ghEndpoint.tier === 'ARCHITECT_TIER', '1.2 GitHub Models als ARCHITECT_TIER konfiguriert');
  assert(ghEndpoint.enabled === true, '1.2 Endpunkt aktiviert');
  assert(ghEndpoint.maskedSecret.startsWith('gho_'), '1.2 Maskiertes Secret vorhanden');

  await oauthMock.stop();
  dfManager.destroy();

  // Test 1.3: Dynamic slow_down Interval Backoff
  console.log('\n--- Test 1.3: Dynamic slow_down Handling ---');
  const slowDownMock = new MockGitHubOAuthServer({ mode: 'slow_down', pendingPollCount: 2 });
  await slowDownMock.start();

  const dfSlow = new DeviceFlowManager({
    endpointManager,
    vault,
    deviceCodeUrl: `${slowDownMock.baseUrl}/login/device/code`,
    tokenUrl: `${slowDownMock.baseUrl}/login/oauth/access_token`
  });

  const slowSess = await dfSlow.startDeviceFlow();
  const initialInterval = slowSess.interval;

  // Wait for first poll to encounter slow_down
  await new Promise(r => setTimeout(r, 1200));
  const slowSessionObj = dfSlow.sessions.get(slowSess.sessionId);
  assert(slowSessionObj.interval >= initialInterval + 5, `1.3 slow_down erhöht Polling-Intervall um mindestens +5s (vorher: ${initialInterval}s, jetzt: ${slowSessionObj.interval}s)`);

  dfSlow.destroy();
  await slowDownMock.stop();

  // Test 1.4: access_denied Terminal State
  console.log('\n--- Test 1.4: access_denied Terminal State ---');
  const deniedMock = new MockGitHubOAuthServer({ mode: 'access_denied' });
  await deniedMock.start();

  const dfDenied = new DeviceFlowManager({
    endpointManager,
    vault,
    deviceCodeUrl: `${deniedMock.baseUrl}/login/device/code`,
    tokenUrl: `${deniedMock.baseUrl}/login/oauth/access_token`
  });

  const deniedSess = await dfDenied.startDeviceFlow();
  const deniedPromise = new Promise(resolve => dfDenied.once('device_auth_denied', resolve));
  await deniedPromise;

  const deniedStatus = dfDenied.getSessionStatus(deniedSess.sessionId);
  assert(deniedStatus.status === 'denied', '1.4 access_denied setzt Sitzungsstatus auf denied');

  dfDenied.destroy();
  await deniedMock.stop();

  // Test 1.5: expired_token Terminal State
  console.log('\n--- Test 1.5: expired_token Terminal State ---');
  const expiredMock = new MockGitHubOAuthServer({ mode: 'expired_token' });
  await expiredMock.start();

  const dfExpired = new DeviceFlowManager({
    endpointManager,
    vault,
    deviceCodeUrl: `${expiredMock.baseUrl}/login/device/code`,
    tokenUrl: `${expiredMock.baseUrl}/login/oauth/access_token`
  });

  const expiredSess = await dfExpired.startDeviceFlow();
  const expiredPromise = new Promise(resolve => dfExpired.once('device_auth_expired', resolve));
  await expiredPromise;

  const expiredStatus = dfExpired.getSessionStatus(expiredSess.sessionId);
  assert(expiredStatus.status === 'expired', '1.5 expired_token setzt Sitzungsstatus auf expired');

  dfExpired.destroy();
  await expiredMock.stop();

  // Test 1.6: Manual Session Cancellation & Cleanup
  console.log('\n--- Test 1.6: Manual Cancellation & Cleanup ---');
  const dummyMock = new MockGitHubOAuthServer({ mode: 'success', pendingPollCount: 99 });
  await dummyMock.start();

  const dfCancel = new DeviceFlowManager({
    deviceCodeUrl: `${dummyMock.baseUrl}/login/device/code`,
    tokenUrl: `${dummyMock.baseUrl}/login/oauth/access_token`
  });

  const cancelSess = await dfCancel.startDeviceFlow();
  const cancelResult = dfCancel.cancelSession(cancelSess.sessionId);
  assert(cancelResult === true, '1.6 cancelSession gibt true zurück');
  assert(dfCancel.getSessionStatus(cancelSess.sessionId).status === 'cancelled', '1.6 Status ist cancelled');

  // cleanupExpiredSessions
  const rawSess = dfCancel.sessions.get(cancelSess.sessionId);
  rawSess.createdAt = Date.now() - 1000000; // Simulate old session
  dfCancel.cleanupExpiredSessions();
  assert(dfCancel.getSessionStatus(cancelSess.sessionId) === null, '1.6 cleanupExpiredSessions entfernt alte beendete Sitzungen');

  dfCancel.destroy();
  await dummyMock.stop();

  // =========================================================================
  // TESTGRUPPE 2: LOCAL MULTI-PORT SCANNER
  // =========================================================================
  console.log('\n--- Testgruppe 2: Zero-Config Local Multi-Port Scanner ---');

  // Test 2.1: Mock Ollama with 100% VRAM offload
  const mockOllamaServer = http.createServer((req, res) => {
    if (req.url === '/api/version') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '0.5.2' }));
      return;
    }
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: [
          {
            name: 'qwen2.5-coder:14b',
            details: { format: 'gguf', parameter_size: '14B', quantization_level: 'Q4_K_M' }
          }
        ]
      }));
      return;
    }
    if (req.url === '/api/ps') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: [
          {
            name: 'qwen2.5-coder:14b',
            size: 9000000000,
            size_vram: 9000000000,
            details: { format: 'gguf', parameter_size: '14B', quantization_level: 'Q4_K_M' }
          }
        ]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => mockOllamaServer.listen(0, '127.0.0.1', r));
  const ollamaPort = mockOllamaServer.address().port;

  // Test 2.2: Mock LM Studio server
  const mockLmStudioServer = http.createServer((req, res) => {
    if (req.url === '/v1/models') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Server': 'LMStudio/0.3.4'
      });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'meta-llama-3.1-8b-instruct', owned_by: 'lmstudio' }
        ]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => mockLmStudioServer.listen(0, '127.0.0.1', r));
  const lmStudioPort = mockLmStudioServer.address().port;

  // Test 2.3: Closed dead port
  const deadServer = net.createServer();
  await new Promise(r => deadServer.listen(0, '127.0.0.1', r));
  const deadPort = deadServer.address().port;
  await new Promise(r => deadServer.close(r)); // Immediate ECONNREFUSED

  // Test 2.4: Hung socket (Black Hole)
  const hungSockets = new Set();
  const hungServer = net.createServer((sock) => {
    hungSockets.add(sock);
    sock.on('close', () => hungSockets.delete(sock));
  });
  await new Promise(r => hungServer.listen(0, '127.0.0.1', r));
  const hungPort = hungServer.address().port;

  const scanner = new LocalModelScanner();

  // Test 2.5: Fast timeout on closed port
  const startDead = performance.now();
  const deadResult = await scanner.probePort('127.0.0.1', deadPort, 1200);
  const deadDuration = performance.now() - startDead;
  assert(deadResult === null, '2.5 Geschlossener Port liefert null');
  assert(deadDuration < 100, `2.5 ECONNREFUSED schlägt in unter 100ms fehl (tatsächlich: ${Math.round(deadDuration)}ms)`);

  // Test 2.6: Hung socket timeout protection
  const startHung = performance.now();
  const hungResult = await scanner.probePort('127.0.0.1', hungPort, 300); // 300ms bounded timeout for test
  const hungDuration = performance.now() - startHung;
  assert(hungResult === null, '2.6 Hung Socket bricht nach Timeout ab und liefert null');
  assert(hungDuration >= 280 && hungDuration < 600, `2.6 Timeout greift präzise (${Math.round(hungDuration)}ms)`);

  // Test 2.7: Ollama detection & 100% VRAM telemetry
  const ollamaResult = await scanner.probePort('127.0.0.1', ollamaPort, 1200);
  assert(ollamaResult !== null, '2.7 Ollama-Instanz erkannt');
  assert(ollamaResult.engine === 'ollama', '2.7 Engine ollama identifiziert');
  assert(ollamaResult.models.includes('qwen2.5-coder:14b'), '2.7 Modellkatalog enthält qwen2.5-coder:14b');
  assert(ollamaResult.vramOffloadPercentage === 100, '2.7 VRAM-Offload 100% berechnet');
  assert(ollamaResult.gpuStatus === 'optimal', '2.7 GPU-Status optimal');

  // Test 2.7b: Ollama CPU fallback (0% VRAM)
  const mockOllamaCpu = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama3:8b' }] }));
      return;
    }
    if (req.url === '/api/ps') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        models: [{ name: 'llama3:8b', size: 5000000000, size_vram: 0 }]
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => mockOllamaCpu.listen(0, '127.0.0.1', r));
  const cpuPort = mockOllamaCpu.address().port;
  const cpuResult = await scanner.probePort('127.0.0.1', cpuPort, 1200);
  assert(cpuResult !== null && cpuResult.vramOffloadPercentage === 0, '2.7b CPU Fallback berechnet vramOffloadPercentage === 0%');
  assert(cpuResult.gpuStatus === 'cpu_fallback', '2.7b GPU-Status ist cpu_fallback');
  await new Promise(r => mockOllamaCpu.close(r));

  // Test 2.7c: Ollama Standby (no running models in /api/ps)
  const mockOllamaStandby = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'mistral:7b' }] }));
      return;
    }
    if (req.url === '/api/ps') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [] }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => mockOllamaStandby.listen(0, '127.0.0.1', r));
  const standbyPort = mockOllamaStandby.address().port;
  const standbyResult = await scanner.probePort('127.0.0.1', standbyPort, 1200);
  assert(standbyResult !== null && standbyResult.vramOffloadPercentage === null, '2.7c Standby liefert vramOffloadPercentage === null');
  assert(standbyResult.gpuStatus === 'standby', '2.7c GPU-Status ist standby');
  assert(standbyResult.models.includes('mistral:7b'), '2.7c Katalog trotz Standby aus /api/tags geladen');
  await new Promise(r => mockOllamaStandby.close(r));

  // Test 2.8: LM Studio detection
  const lmResult = await scanner.probePort('127.0.0.1', lmStudioPort, 1200);
  assert(lmResult !== null, '2.8 LM Studio-Instanz erkannt');
  assert(lmResult.engine === 'lmstudio', '2.8 Engine lmstudio identifiziert');
  assert(lmResult.models.includes('meta-llama-3.1-8b-instruct'), '2.8 Modell meta-llama-3.1-8b-instruct gefunden');

  // Test 2.9: Full parallel scan benchmark
  const fullScan = await scanner.scan({
    ports: [ollamaPort, lmStudioPort, deadPort, hungPort],
    timeoutMs: 400
  });
  assert(fullScan.success === true, '2.9 Paralleler Sweep erfolgreich');
  assert(fullScan.totalFound === 2, `2.9 Exakt 2 aktive Instanzen gefunden (tatsächlich: ${fullScan.totalFound})`);
  assert(fullScan.durationMs < 1500, `2.9 Gesamter Sweep schließt in unter 1500ms ab (tatsächlich: ${fullScan.durationMs}ms)`);

  // Cleanup local mock servers
  await new Promise(r => mockOllamaServer.close(r));
  await new Promise(r => mockLmStudioServer.close(r));
  for (const s of hungSockets) {
    s.destroy();
  }
  await new Promise(r => hungServer.close(r));

  // =========================================================================
  // TESTGRUPPE 3: EXPRESS BFF REST API & PROXY LAYER
  // =========================================================================
  console.log('\n--- Testgruppe 3: Express BFF REST API Routes ---');

  const inferenceMock = new MockInferenceServer();
  await inferenceMock.start();

  const safeProbeWorker = new SafeProbeWorker({
    phase1TimeoutMs: 1500,
    phase2TimeoutMs: 2500
  });

  const bffServer = new DashboardServer({
    endpointManager,
    safeProbeWorker,
    deviceFlowManager: dfManager,
    localModelScanner: scanner,
    llmRouter
  });

  const app = bffServer.setupApp();
  const testHttpServer = http.createServer(app);
  await new Promise(r => testHttpServer.listen(0, '127.0.0.1', r));
  const bffPort = testHttpServer.address().port;
  const bffBaseUrl = `http://127.0.0.1:${bffPort}`;

  // Helper fetch wrapper
  async function apiFetch(endpointPath, options = {}) {
    const res = await fetch(`${bffBaseUrl}${endpointPath}`, {
      ...options,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const text = await res.text();
    let json = {};
    try { json = JSON.parse(text); } catch (_) {}
    return { status: res.status, headers: res.headers, json, text };
  }

  // Test 3.1: Zero-CORS and Zero-PNA Preflight & Headers
  const corsRes = await apiFetch('/api/endpoints', { method: 'OPTIONS' });
  assert(corsRes.status === 204, '3.1 OPTIONS Preflight liefert HTTP 204');
  assert(corsRes.headers.get('access-control-allow-origin') === '*', '3.1 CORS Header Access-Control-Allow-Origin: * vorhanden');
  assert(corsRes.headers.get('access-control-allow-private-network') === 'true', '3.1 PNA Header Access-Control-Allow-Private-Network: true vorhanden');

  // Test 3.2: GET /api/endpoints (List Masked)
  const listRes = await apiFetch('/api/endpoints');
  assert(listRes.status === 200, '3.2 GET /api/endpoints liefert HTTP 200');
  assert(Array.isArray(listRes.json.endpoints), '3.2 endpoints Array vorhanden');
  assert(listRes.json.endpoints.length > 0, '3.2 Mindestens 1 Endpunkt gelistet');
  const sampleEp = listRes.json.endpoints[0];
  assert(sampleEp.maskedSecret !== undefined, '3.2 Endpunkt enthält maskedSecret');
  assert(sampleEp.apiKey === undefined && sampleEp.token === undefined, '3.2 Keine unmaskierten Secrets in der API-Antwort');

  // Test 3.3: GET /api/endpoints/:id
  const getSingle = await apiFetch(`/api/endpoints/${sampleEp.id}`);
  assert(getSingle.status === 200, '3.3 GET /api/endpoints/:id liefert HTTP 200');
  assert(getSingle.json.endpoint.id === sampleEp.id, '3.3 Exakte ID zurückgegeben');

  const getMissing = await apiFetch('/api/endpoints/non_existent_id');
  assert(getMissing.status === 404, '3.3 GET auf unbekannte ID liefert HTTP 404');

  // Test 3.4: POST /api/endpoints (Create)
  const createRes = await apiFetch('/api/endpoints', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Custom Test Inference',
      provider: 'CustomMock',
      category: 'cloud',
      tier: 'FAST_TIER',
      baseUrl: inferenceMock.baseUrl,
      modelId: 'llama-3.3-70b',
      secret: 'csk_live_secret_key_123456789'
    })
  });
  assert(createRes.status === 201, '3.4 POST /api/endpoints liefert HTTP 201 Created');
  assert(createRes.json.success === true, '3.4 create success: true');
  const createdEp = createRes.json.endpoint;
  assert(createdEp.maskedSecret.startsWith('csk_'), '3.4 Secret wurde maskiert');

  // Test 3.5: POST /api/endpoints Validation Error
  const invalidCreate = await apiFetch('/api/endpoints', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Invalid Endpoint' // Missing baseUrl & modelId
    })
  });
  assert(invalidCreate.status === 400, '3.5 POST ohne baseUrl/modelId liefert HTTP 400');

  // Test 3.6: PUT /api/endpoints/:id (Write-Only Secret Invariant: Masked Placeholder)
  const putMasked = await apiFetch(`/api/endpoints/${createdEp.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: 'Renamed Provider Name',
      secret: '••••••••' // Masked placeholder from UI
    })
  });
  assert(putMasked.status === 200, '3.6 PUT mit Masken-Platzhalter liefert HTTP 200');
  const checkSecret = await vault.getSecret(createdEp.credentialRef);
  assert(checkSecret === 'csk_live_secret_key_123456789', '3.6 Ursprüngliches Secret im Vault blieb trotz Masken-Eingabe unverändert');

  // Test 3.7: PUT /api/endpoints/:id (Write-Only Secret Invariant: Empty String)
  const putEmpty = await apiFetch(`/api/endpoints/${createdEp.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      temperature: 0.3,
      secret: '' // Untouched password field
    })
  });
  assert(putEmpty.status === 200, '3.7 PUT mit leerem String liefert HTTP 200');
  const checkSecret2 = await vault.getSecret(createdEp.credentialRef);
  assert(checkSecret2 === 'csk_live_secret_key_123456789', '3.7 Ursprüngliches Secret im Vault blieb trotz leerer Eingabe unverändert');

  // Test 3.8: PUT /api/endpoints/:id (Real Secret Update)
  const putNewSecret = await apiFetch(`/api/endpoints/${createdEp.id}`, {
    method: 'PUT',
    body: JSON.stringify({
      secret: 'csk_updated_live_token_99999'
    })
  });
  assert(putNewSecret.status === 200, '3.8 PUT mit neuem Secret liefert HTTP 200');
  const checkSecret3 = await vault.getSecret(createdEp.credentialRef);
  assert(checkSecret3 === 'csk_updated_live_token_99999', '3.8 Vault-Secret erfolgreich aktualisiert');

  // Test 3.9: POST /api/endpoints/:id/test (Safe Probe Saved Endpoint)
  const testSaved = await apiFetch(`/api/endpoints/${createdEp.id}/test`, {
    method: 'POST'
  });
  assert(testSaved.status === 200, '3.9 POST /api/endpoints/:id/test liefert HTTP 200');
  assert(testSaved.json.success === true, '3.9 Safe Probe auf Mock-Inference erfolgreich');
  assert(testSaved.json.result.status === 'healthy', '3.9 Endpunkt-Status healthy');
  assert(testSaved.json.result.quotaRemaining === 850, '3.9 Quoten-Header (850) korrekt extrahiert');

  // Test 3.10: POST /api/endpoints/test-adhoc (Safe Probe Unsaved Endpoint)
  const testAdhoc = await apiFetch('/api/endpoints/test-adhoc', {
    method: 'POST',
    body: JSON.stringify({
      baseUrl: inferenceMock.baseUrl,
      modelId: 'llama-3.3-70b',
      secret: 'dummy-test-key'
    })
  });
  assert(testAdhoc.status === 200, '3.10 POST /api/endpoints/test-adhoc liefert HTTP 200');
  assert(testAdhoc.json.success === true, '3.10 Ad-hoc Probe erfolgreich');

  // Test 3.11: POST /api/endpoints/activate
  const activateRes = await apiFetch('/api/endpoints/activate', {
    method: 'POST',
    body: JSON.stringify({
      tier: 'FAST_TIER',
      endpointId: createdEp.id
    })
  });
  assert(activateRes.status === 200, '3.11 POST /api/endpoints/activate liefert HTTP 200');
  assert(activateRes.json.activeEndpointId === createdEp.id, '3.11 Endpunkt als primärer FAST_TIER aktiviert');

  // Test 3.12: DELETE /api/endpoints/:id
  const deleteRes = await apiFetch(`/api/endpoints/${createdEp.id}`, {
    method: 'DELETE'
  });
  assert(deleteRes.status === 200, '3.12 DELETE /api/endpoints/:id liefert HTTP 200');
  const checkDeleted = endpointManager.getEndpoint(createdEp.id);
  assert(checkDeleted === null, '3.12 Endpunkt aus endpoints.json entfernt');
  const checkSecretDeleted = await vault.hasSecret(createdEp.credentialRef);
  assert(checkSecretDeleted === false, '3.12 Secret aus Vault entfernt');

  // Test 3.13: GET /api/endpoints/discover-local
  const discoverRes = await apiFetch('/api/endpoints/discover-local');
  assert(discoverRes.status === 200, '3.13 GET /api/endpoints/discover-local liefert HTTP 200');
  assert(discoverRes.json.success === true, '3.13 discover-local success === true');
  assert(Array.isArray(discoverRes.json.instances), '3.13 discover-local liefert instances Array');

  // Test 3.14: POST /api/auth/device-flow/start
  const oauthMock2 = new MockGitHubOAuthServer();
  await oauthMock2.start();
  bffServer.deviceFlowManager.deviceCodeUrl = `${oauthMock2.baseUrl}/login/device/code`;
  bffServer.deviceFlowManager.tokenUrl = `${oauthMock2.baseUrl}/login/oauth/access_token`;

  const flowStartRes = await apiFetch('/api/auth/device-flow/start', { method: 'POST' });
  assert(flowStartRes.status === 200, '3.14 POST /api/auth/device-flow/start liefert HTTP 200');
  assert(flowStartRes.json.success === true, '3.14 Flow erfolgreich gestartet');
  assert(flowStartRes.json.userCode === 'WDJB-WQWD', '3.14 userCode WDJB-WQWD vorhanden');
  const bffSessionId = flowStartRes.json.sessionId;

  // Test 3.15: GET /api/auth/device-flow/status/:sessionId
  const flowStatusRes = await apiFetch(`/api/auth/device-flow/status/${bffSessionId}`);
  assert(flowStatusRes.status === 200, '3.15 GET /api/auth/device-flow/status/:sessionId liefert HTTP 200');
  assert(flowStatusRes.json.status === 'pending', '3.15 Status ist pending');

  // Test 3.16: POST /api/auth/device-flow/cancel/:sessionId
  const flowCancelRes = await apiFetch(`/api/auth/device-flow/cancel/${bffSessionId}`, { method: 'POST' });
  assert(flowCancelRes.status === 200, '3.16 POST /api/auth/device-flow/cancel/:sessionId liefert HTTP 200');
  assert(flowCancelRes.json.status === 'cancelled', '3.16 Status ist cancelled');

  await oauthMock2.stop();

  // Cleanup BFF server and mock inference server
  await new Promise(r => testHttpServer.close(r));
  await inferenceMock.stop();
  bffServer.stop();

  // Teardown temporary directory
  try {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  } catch (_) {}

  console.log(`\n\x1b[32m=== ALLE ${totalTests}/${totalTests} TESTS DER M6 SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runDeviceFlowAndBffTests().catch(err => {
  console.error(`\x1b[31m[TEST SUITE ERROR]\x1b[0m ${err.stack || err.message}`);
  process.exit(1);
});
