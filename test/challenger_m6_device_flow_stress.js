/**
 * Challenger M6 Stress Suite: Device Flow Stress & State Machine Fuzzing
 *
 * Adversarially challenges and empirical stress-tests `src/security/deviceFlowManager.js`:
 *
 * 1. Simultaneous Sessions Isolation (20 concurrent sessions, zero cross-session pollution, verified device codes)
 * 2. Dynamic Polling Dynamics & Multiple Consecutive `slow_down` (+5s backoff accumulation, custom server intervals)
 * 3. Hostile Network Chaos & Error Handling (corrupted JSON, socket ECONNRESET, HTTP 500 HTML, HTTP 500 JSON, 502/503/504)
 * 4. Cancellation & Expiration Resource Management (immediate timer cleanup, no poll leakage, expired purging, destroy)
 * 5. End-to-End Vault Persistence & Endpoint Registration (AES-256-GCM ciphertext, endpoint idempotency, LLMRouter reload)
 */

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DeviceFlowManager } from '../src/security/deviceFlowManager.js';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { LLMRouter } from '../src/ai/llmRouter.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failureDetails.push(message);
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

/**
 * Advanced Multi-Mode Mock OAuth Server for adversarial fuzzing & stress testing
 */
class AdvancedMockOAuthServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.baseUrl = '';
    this.requestLog = [];
    this.sessionHandlers = new Map(); // deviceCode -> handler function
    this.defaultHandler = null;
    this.globalPollCount = 0;
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

        const reqRecord = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: parsedBody,
          rawBody: body,
          timestamp: Date.now()
        };
        this.requestLog.push(reqRecord);

        // POST /login/device/code
        if (req.method === 'POST' && req.url === '/login/device/code') {
          const deviceCode = `devcode_${crypto.randomUUID()}`;
          const userCode = `UC-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`;
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            device_code: deviceCode,
            user_code: userCode,
            verification_uri: `${this.baseUrl}/login/device`,
            verification_uri_complete: `${this.baseUrl}/login/device?user_code=${userCode}`,
            expires_in: 900,
            interval: 1
          }));
          return;
        }

        // POST /login/oauth/access_token
        if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
          this.globalPollCount++;
          const devCode = parsedBody.device_code;
          if (devCode && this.sessionHandlers.has(devCode)) {
            const handler = this.sessionHandlers.get(devCode);
            handler(req, res, parsedBody);
            return;
          }

          if (this.defaultHandler) {
            this.defaultHandler(req, res, parsedBody);
            return;
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'authorization_pending',
            error_description: 'Default authorization pending'
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

  registerSessionHandler(deviceCode, handlerFn) {
    this.sessionHandlers.set(deviceCode, handlerFn);
  }

  async stop() {
    if (this.server) {
      await new Promise(r => this.server.close(r));
      this.server = null;
    }
  }
}

async function runAdversarialStressSuite() {
  console.log('\x1b[36m====================================================================\x1b[0m');
  console.log('\x1b[36m   CHALLENGER M6: ADVERSARIAL STRESS & STATE MACHINE FUZZING SUITE   \x1b[0m');
  console.log('\x1b[36m====================================================================\x1b[0m\n');

  const testDir = path.resolve('data', 'test_stress_m6_env');
  await fs.promises.mkdir(testDir, { recursive: true });
  const testVaultPath = path.join(testDir, 'vault_stress_m6.enc');
  const testConfigPath = path.join(testDir, 'endpoints_stress_m6.json');

  const vault = new CredentialVault({ storagePath: testVaultPath });
  await vault.init();

  const endpointManager = new EndpointManager({
    configPath: testConfigPath,
    vault
  });
  await endpointManager.init();

  const llmRouter = new LLMRouter();

  // =========================================================================
  // SECTION 1: 20 CONCURRENT DEVICE FLOW SESSIONS & STATE MACHINE ISOLATION
  // =========================================================================
  console.log('>>> [STRESS TEST 1] 20 Concurrent Sessions Isolation & Terminal Convergence');
  const server1 = new AdvancedMockOAuthServer();
  await server1.start();

  const dfManager1 = new DeviceFlowManager({
    endpointManager,
    vault,
    llmRouter,
    deviceCodeUrl: `${server1.baseUrl}/login/device/code`,
    tokenUrl: `${server1.baseUrl}/login/oauth/access_token`
  });

  // Track per-session state in mock server
  const sessionBehavior = new Map(); // deviceCode -> { targetState, currentPolls }
  const terminalResults = new Map(); // sessionId -> terminal status

  // Prepare 20 sessions concurrently
  const startTime = Date.now();
  const sessionPromises = Array.from({ length: 20 }, async (_, index) => {
    return dfManager1.startDeviceFlow();
  });

  const startedSessions = await Promise.all(sessionPromises);
  const elapsedStart = Date.now() - startTime;
  console.log(`[*] 20 Device Flow Sessions started simultaneously in ${elapsedStart}ms`);

  assert(startedSessions.length === 20, '1.1 Exakt 20 Sitzungen parallel instanziiert');

  // Verify unique identifiers
  const sessionIds = new Set(startedSessions.map(s => s.sessionId));
  assert(sessionIds.size === 20, '1.2 Alle 20 sessionId Werte sind kryptografisch eindeutig');

  const userCodes = new Set(startedSessions.map(s => s.userCode));
  assert(userCodes.size === 20, '1.3 Alle 20 userCode Werte sind eindeutig generiert');

  // Assign distinct behaviors to the 20 sessions:
  // - 5 sessions: SUCCESS after 2 polls
  // - 5 sessions: ACCESS_DENIED after 1 poll
  // - 5 sessions: EXPIRED_TOKEN after 2 polls
  // - 5 sessions: CANCELLED externally mid-flight
  const internalSessions = Array.from(dfManager1.sessions.values());
  assert(internalSessions.length === 20, '1.4 DeviceFlowManager.sessions Map enthält exakt 20 Einträge');

  internalSessions.forEach((s, idx) => {
    const devCode = s.deviceCode;
    let behaviorType;
    if (idx < 5) behaviorType = 'success';
    else if (idx < 10) behaviorType = 'denied';
    else if (idx < 15) behaviorType = 'expired';
    else behaviorType = 'cancel';

    sessionBehavior.set(devCode, {
      sessionId: s.sessionId,
      type: behaviorType,
      polls: 0,
      token: `gho_token_session_${idx}_${crypto.randomBytes(4).toString('hex')}`
    });

    server1.registerSessionHandler(devCode, (req, res, body) => {
      const beh = sessionBehavior.get(devCode);
      beh.polls++;

      if (beh.type === 'success') {
        if (beh.polls < 2) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'authorization_pending' }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            access_token: beh.token,
            token_type: 'bearer',
            scope: 'read:user'
          }));
        }
      } else if (beh.type === 'denied') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'access_denied',
          error_description: 'User rejected authorization'
        }));
      } else if (beh.type === 'expired') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: 'expired_token',
          error_description: 'Device code expired'
        }));
      } else if (beh.type === 'cancel') {
        // Keeps returning pending until external cancel is invoked
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'authorization_pending' }));
      }
    });
  });

  // Cancel the 5 cancel-designated sessions after 200ms
  setTimeout(() => {
    internalSessions.slice(15, 20).forEach(s => {
      const didCancel = dfManager1.cancelSession(s.sessionId);
      assert(didCancel === true, `1.5 cancelSession(${s.sessionId}) liefert true`);
    });
  }, 200);

  // Await terminal resolution for all 20 sessions (timeout after 5000ms)
  const pollCheckStart = Date.now();
  while (Date.now() - pollCheckStart < 5000) {
    let pendingCount = 0;
    for (const s of dfManager1.sessions.values()) {
      const status = dfManager1.getSessionStatus(s.sessionId);
      if (status.status === 'pending') {
        pendingCount++;
      } else if (status.status === 'success' && !status.endpointId) {
        pendingCount++; // Still in _handleSuccess async completion window
      }
    }
    if (pendingCount === 0) break;
    await new Promise(r => setTimeout(r, 100));
  }

  // Evaluate states of all 20 sessions
  let successCount = 0;
  let deniedCount = 0;
  let expiredCount = 0;
  let cancelledCount = 0;

  for (let i = 0; i < 20; i++) {
    const s = internalSessions[i];
    const status = dfManager1.getSessionStatus(s.sessionId);
    if (i < 5) {
      console.log(`[DEBUG] Session ${i} getSessionStatus:`, JSON.stringify(status), 'internalSession:', JSON.stringify({ endpointId: s.endpointId, status: s.status, error: s.error }));
      assert(status.status === 'success', `1.6a Session ${i} (Erfolg) hat status === 'success' (aktuell: ${status.status})`);
      assert(status.endpointId === 'ep_github_models', `1.6a Session ${i} liefert endpointId ep_github_models`);
      successCount++;
    } else if (i < 10) {
      assert(status.status === 'denied', `1.6b Session ${i} (Verweigert) hat status === 'denied' (aktuell: ${status.status})`);
      deniedCount++;
    } else if (i < 15) {
      assert(status.status === 'expired', `1.6c Session ${i} (Abgelaufen) hat status === 'expired' (aktuell: ${status.status})`);
      expiredCount++;
    } else {
      assert(status.status === 'cancelled', `1.6d Session ${i} (Abgebrochen) hat status === 'cancelled' (aktuell: ${status.status})`);
      cancelledCount++;
    }
  }

  assert(successCount === 5, '1.7 Exakt 5/20 Sitzungen erreichten Erfolg');
  assert(deniedCount === 5, '1.7 Exakt 5/20 Sitzungen erreichten Denied');
  assert(expiredCount === 5, '1.7 Exakt 5/20 Sitzungen erreichten Expired');
  assert(cancelledCount === 5, '1.7 Exakt 5/20 Sitzungen erreichten Cancelled');

  // Verify request bodies sent to OAuth server
  const tokenPollRequests = server1.requestLog.filter(r => r.url === '/login/oauth/access_token');
  assert(tokenPollRequests.length >= 20, `1.8 Mindestens 20 Polling-Requests empfangen (tatsächlich: ${tokenPollRequests.length})`);

  // Verify that every single request sent the grant_type urn:ietf:params:oauth:grant-type:device_code and matching device_code
  for (const req of tokenPollRequests) {
    assert(req.body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code', '1.9 RFC 8628 grant_type korrekt übergeben');
    assert(typeof req.body.device_code === 'string' && req.body.device_code.startsWith('devcode_'), '1.9 device_code entspricht Format devcode_');
  }

  dfManager1.destroy();
  await server1.stop();
  console.log('[*] Test 1 abgeschlossen: 20 simultane Sitzungen ohne Cross-Session-Pollution isoliert.\n');

  // =========================================================================
  // SECTION 2: DYNAMIC POLLING DYNAMICS & MULTIPLE CONSECUTIVE SLOW_DOWN
  // =========================================================================
  console.log('>>> [STRESS TEST 2] Polling Edge Cases: Multiple Consecutive slow_down Backoff Accumulation');
  const server2 = new AdvancedMockOAuthServer();
  await server2.start();

  const dfManager2 = new DeviceFlowManager({
    deviceCodeUrl: `${server2.baseUrl}/login/device/code`,
    tokenUrl: `${server2.baseUrl}/login/oauth/access_token`
  });

  let slowDownPollCount = 0;
  const observedIntervals = [];

  server2.defaultHandler = (req, res, body) => {
    slowDownPollCount++;
    if (slowDownPollCount === 1) {
      // 1st: Standard slow_down (+5s backoff)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'slow_down', error_description: 'Too frequent polling' }));
      return;
    }
    if (slowDownPollCount === 2) {
      // 2nd: Consecutive slow_down (+5s backoff again)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'slow_down', error_description: 'Slow down more' }));
      return;
    }
    if (slowDownPollCount === 3) {
      // 3rd: slow_down with explicit higher interval from server (e.g. 25s)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'slow_down', interval: 25 }));
      return;
    }
    if (slowDownPollCount === 4) {
      // 4th: Consecutive slow_down after 25s (+5s -> 30s)
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'slow_down' }));
      return;
    }
    // Terminal success
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ access_token: 'gho_final_accumulated_slowdown_token' }));
  };

  const slowSession = await dfManager2.startDeviceFlow();
  assert(slowSession.interval === 1, '2.1 Initiales Test-Intervall ist 1s');

  const sessObj = dfManager2.sessions.get(slowSession.sessionId);

  // We manually simulate or intercept the rapid poll step progression to verify exact math:
  // Step 1: Initial interval is 1
  assert(sessObj.interval === 1, '2.2 sessObj.interval ist 1');

  // Trigger 1st poll
  await dfManager2._poll(slowSession.sessionId);
  assert(slowDownPollCount === 1, '2.3 1. Poll ausgeführt');
  assert(sessObj.interval === 6, `2.3 1. slow_down erhöht Intervall um +5s (1 -> 6, tatsächlich: ${sessObj.interval})`);

  // Trigger 2nd poll
  await dfManager2._poll(slowSession.sessionId);
  assert(slowDownPollCount === 2, '2.4 2. Poll ausgeführt');
  assert(sessObj.interval === 11, `2.4 2. aufeinanderfolgendes slow_down akkumuliert erneut +5s (6 -> 11, tatsächlich: ${sessObj.interval})`);

  // Trigger 3rd poll (server provides interval: 25)
  await dfManager2._poll(slowSession.sessionId);
  assert(slowDownPollCount === 3, '2.5 3. Poll ausgeführt');
  assert(sessObj.interval === 25, `2.5 3. slow_down übernimmt expliziten Server-Intervallwert (11 + 5 = 16 < 25 -> 25, tatsächlich: ${sessObj.interval})`);

  // Trigger 4th poll
  await dfManager2._poll(slowSession.sessionId);
  assert(slowDownPollCount === 4, '2.6 4. Poll ausgeführt');
  assert(sessObj.interval === 30, `2.6 4. slow_down erhöht von 25 auf 30 (+5s, tatsächlich: ${sessObj.interval})`);

  // Trigger 5th poll -> Success
  await dfManager2._poll(slowSession.sessionId);
  assert(slowDownPollCount === 5, '2.7 5. Poll ausgeführt');
  assert(sessObj.status === 'success', `2.7 Status wechselt nach slow_down-Kette erfolgreich auf success (tatsächlich: ${sessObj.status})`);
  assert(sessObj.accessToken === 'gho_final_accumulated_slowdown_token', '2.7 access_token korrekt gespeichert');

  dfManager2.destroy();
  await server2.stop();
  console.log('[*] Test 2 abgeschlossen: Mehrfache slow_down Reaktionen dynamisch und RFC 8628-konform akkumuliert.\n');

  // =========================================================================
  // SECTION 3: HOSTILE ERROR HANDLING, NETWORK CHAOS & FUZZING
  // =========================================================================
  console.log('>>> [STRESS TEST 3] Adversarial Error Handling & Hostile Network Resilience');
  const server3 = new AdvancedMockOAuthServer();
  await server3.start();

  const dfManager3 = new DeviceFlowManager({
    deviceCodeUrl: `${server3.baseUrl}/login/device/code`,
    tokenUrl: `${server3.baseUrl}/login/oauth/access_token`
  });

  // Track unhandled errors at process level during test
  let uncaughtErrorDetected = false;
  const uncaughtHandler = (err) => {
    uncaughtErrorDetected = true;
    console.error(`[UNCAUGHT EXCEPTION DETECTED]: ${err.message}`);
  };
  process.on('uncaughtException', uncaughtHandler);
  process.on('unhandledRejection', uncaughtHandler);

  const chaosSession = await dfManager3.startDeviceFlow();
  const cSessObj = dfManager3.sessions.get(chaosSession.sessionId);

  // 3a. Malformed JSON Response (Garbage body)
  server3.defaultHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"error": "trunca---GARBAGE-JSON-NOT-PARSABLE');
  };
  await dfManager3._poll(chaosSession.sessionId);
  assert(cSessObj.status === 'pending', '3.1 Korruptes JSON stürzt nicht ab, Status bleibt pending');

  // 3b. Empty Body with HTTP 200
  server3.defaultHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('');
  };
  await dfManager3._poll(chaosSession.sessionId);
  assert(cSessObj.status === 'pending', '3.2 Leere HTTP 200-Antwort stürzt nicht ab, Status bleibt pending');

  // 3c. Abrupt Socket Destruction / ECONNRESET
  server3.defaultHandler = (req, res) => {
    req.socket.destroy(); // Abrupt drop
  };
  await dfManager3._poll(chaosSession.sessionId);
  assert(cSessObj.status === 'pending', '3.3 Abrupter TCP-Socket-Reset (ECONNRESET) abgefangen, Status bleibt pending');

  // 3d. HTTP 500 Internal Server Error with HTML body
  server3.defaultHandler = (req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<html><body><h1>500 Internal Server Error</h1><p>GitHub Models is down</p></body></html>');
  };
  await dfManager3._poll(chaosSession.sessionId);
  assert(cSessObj.status === 'pending', '3.4 HTTP 500 mit HTML-Fehlerseite abgefangen, Status bleibt pending');

  // 3e. HTTP 502 Bad Gateway / HTTP 503 Service Unavailable / HTTP 504 Gateway Timeout
  const proxyErrorCodes = [502, 503, 504];
  for (const code of proxyErrorCodes) {
    server3.defaultHandler = (req, res) => {
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end(`Upstream error ${code}`);
    };
    await dfManager3._poll(chaosSession.sessionId);
    assert(cSessObj.status === 'pending', `3.5 HTTP ${code} Proxy-Fehler überstanden, Status bleibt pending`);
  }

  // 3f. HTTP 500 with RFC OAuth Error JSON Body (Server Error)
  let errorEventEmitted = false;
  dfManager3.once('device_auth_error', (evt) => {
    errorEventEmitted = true;
    assert(evt.sessionId === chaosSession.sessionId, '3.6 Event device_auth_error enthält korrekte sessionId');
  });

  server3.defaultHandler = (req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'server_error',
      error_description: 'GitHub Authorization Server internal failure'
    }));
  };
  await dfManager3._poll(chaosSession.sessionId);
  assert(cSessObj.status === 'error', '3.7 server_error führt zu terminalem Status error');
  assert(errorEventEmitted === true, '3.7 device_auth_error Event wurde ausgelöst');
  assert(cSessObj.error.includes('GitHub Authorization Server'), '3.7 Fehlermeldung enthält Beschreibung');

  // 3g. Network error when session has already reached expiresAt
  const expiredNetSession = await dfManager3.startDeviceFlow();
  const expNetObj = dfManager3.sessions.get(expiredNetSession.sessionId);
  expNetObj.expiresAt = Date.now() - 1000; // Force expired timestamp
  server3.defaultHandler = (req, res) => {
    req.socket.destroy();
  };

  let expAuthError = false;
  dfManager3.once('device_auth_expired', () => { expAuthError = true; });
  await dfManager3._poll(expiredNetSession.sessionId);
  assert(expNetObj.status === 'expired', '3.8 Abgelaufene Sitzung bei Netzwerkfehler wechselt sauber auf expired');
  assert(expAuthError === true, '3.8 device_auth_expired Event sauber ausgelöst');

  assert(uncaughtErrorDetected === false, '3.9 Absolut null unhandled exceptions/rejections im gesamten Fehler-Stresstest');

  process.removeListener('uncaughtException', uncaughtHandler);
  process.removeListener('unhandledRejection', uncaughtHandler);
  dfManager3.destroy();
  await server3.stop();
  console.log('[*] Test 3 abgeschlossen: Sämtliche Netzwerk- und Server-Chaos-Szenarien ohne Prozessabsturz überstanden.\n');

  // =========================================================================
  // SECTION 4: CANCEL & EXPIRATION RESOURCE LEAK STRESS
  // =========================================================================
  console.log('>>> [STRESS TEST 4] Cancellation & Expiration Resource Cleanup (Timer & Memory Leak Checks)');
  const server4 = new AdvancedMockOAuthServer();
  await server4.start();

  const dfManager4 = new DeviceFlowManager({
    deviceCodeUrl: `${server4.baseUrl}/login/device/code`,
    tokenUrl: `${server4.baseUrl}/login/oauth/access_token`
  });

  // 4a. Immediate Cancellation & Timer Disarm
  const sessToCancel = await dfManager4.startDeviceFlow();
  const cObj = dfManager4.sessions.get(sessToCancel.sessionId);
  assert(cObj.timerId !== null, '4.1 Aktiver Timer vor Abbruch registriert');

  let cancelEventFired = false;
  dfManager4.once('device_auth_cancelled', (evt) => {
    cancelEventFired = true;
    assert(evt.sessionId === sessToCancel.sessionId, '4.2 device_auth_cancelled meldet korrekte sessionId');
  });

  const cancelResult = dfManager4.cancelSession(sessToCancel.sessionId);
  assert(cancelResult === true, '4.3 cancelSession gibt true zurück');
  assert(cObj.status === 'cancelled', '4.3 Status ist cancelled');
  assert(cObj.timerId === null, '4.3 Timer nach Abbruch vollständig geleert (timerId === null)');
  assert(cancelEventFired === true, '4.3 device_auth_cancelled Event emittiert');

  // Repeated cancel call should return true (or handle gracefully)
  const repeatCancel = dfManager4.cancelSession(sessToCancel.sessionId);
  assert(repeatCancel === true, '4.4 Wiederholter Abbruch verhält sich idempotent');

  // Cancel non-existent session
  const invalidCancel = dfManager4.cancelSession('devflow_does_not_exist_xyz');
  assert(invalidCancel === false, '4.5 Abbruch unbekannter Sitzung liefert false');

  // Verify cancelled session does not execute poll even after interval
  const reqCountBefore = server4.requestLog.length;
  await new Promise(r => setTimeout(r, 1200));
  const reqCountAfter = server4.requestLog.length;
  assert(reqCountBefore === reqCountAfter, '4.6 Keine weiteren HTTP-Polling-Anfragen nach Sitzungsabbruch gesendet');

  // 4b. Expiration Detection
  const sessToExpire = await dfManager4.startDeviceFlow();
  const expObj = dfManager4.sessions.get(sessToExpire.sessionId);
  expObj.expiresAt = Date.now() - 50; // Expired

  let expEventFired = false;
  dfManager4.once('device_auth_expired', (evt) => {
    expEventFired = true;
    assert(evt.sessionId === sessToExpire.sessionId, '4.7 device_auth_expired meldet abgelaufene ID');
  });

  await dfManager4._poll(sessToExpire.sessionId);
  assert(expObj.status === 'expired', '4.8 Sitzungsstatus ist expired');
  assert(expEventFired === true, '4.8 device_auth_expired emittiert');

  // 4c. cleanupExpiredSessions pruning logic
  // Create mock sessions in map with synthetic timestamps
  const now = Date.now();
  // 1. Old finished session (> 15 minutes ago)
  dfManager4.sessions.set('sess_old_finished', {
    sessionId: 'sess_old_finished',
    status: 'success',
    createdAt: now - 950000,
    expiresAt: now + 500000,
    timerId: null
  });

  // 2. Fresh finished session (< 15 minutes ago)
  dfManager4.sessions.set('sess_fresh_finished', {
    sessionId: 'sess_fresh_finished',
    status: 'success',
    createdAt: now - 30000,
    expiresAt: now + 500000,
    timerId: null
  });

  // 3. Expired session past grace period (> 60s past expiresAt)
  dfManager4.sessions.set('sess_old_expired', {
    sessionId: 'sess_old_expired',
    status: 'expired',
    createdAt: now - 500000,
    expiresAt: now - 70000,
    timerId: null
  });

  // 4. Pending session still valid
  dfManager4.sessions.set('sess_active_pending', {
    sessionId: 'sess_active_pending',
    status: 'pending',
    createdAt: now - 50000,
    expiresAt: now + 500000,
    timerId: setTimeout(() => {}, 100000)
  });

  dfManager4.cleanupExpiredSessions();

  assert(!dfManager4.sessions.has('sess_old_finished'), '4.9 Alte beendete Sitzung (> 15min) wurde bereinigt');
  assert(dfManager4.sessions.has('sess_fresh_finished'), '4.10 Frische beendete Sitzung bleibt im Cache erhalten');
  assert(!dfManager4.sessions.has('sess_old_expired'), '4.11 Länger als 60s abgelaufene Sitzung wurde bereinigt');
  assert(dfManager4.sessions.has('sess_active_pending'), '4.12 Aktive ausstehende Sitzung bleibt unberührt');

  // 4d. destroy() stops all active timers and clears map
  dfManager4.destroy();
  assert(dfManager4.sessions.size === 0, '4.13 destroy() leert die gesamte Sitzungs-Map');

  await server4.stop();
  console.log('[*] Test 4 abgeschlossen: Keine Timer- oder Speicherlecks bei Abbruch und Ablauf.\n');

  // =========================================================================
  // SECTION 5: TOKEN REGISTRATION, CREDENTIALVAULT PERSISTENCE & ENDPOINT INTEGRATION
  // =========================================================================
  console.log('>>> [STRESS TEST 5] CredentialVault & EndpointManager Integration & Idempotency');
  const server5 = new AdvancedMockOAuthServer();
  await server5.start();

  const vaultIntegrationPath = path.join(testDir, 'vault_integration_test.enc');
  const configIntegrationPath = path.join(testDir, 'endpoints_integration_test.json');

  const intVault = new CredentialVault({ storagePath: vaultIntegrationPath });
  await intVault.init();

  const intEndpointMgr = new EndpointManager({
    configPath: configIntegrationPath,
    vault: intVault
  });
  await intEndpointMgr.init();

  let reloadPoolsCalled = 0;
  const mockRouter = {
    reloadPools: async (mgr) => {
      reloadPoolsCalled++;
    }
  };

  const dfManager5 = new DeviceFlowManager({
    endpointManager: intEndpointMgr,
    vault: intVault,
    llmRouter: mockRouter,
    deviceCodeUrl: `${server5.baseUrl}/login/device/code`,
    tokenUrl: `${server5.baseUrl}/login/oauth/access_token`
  });

  const secretToken1 = 'gho_alpha_production_secret_key_112233445566778899';
  server5.defaultHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: secretToken1,
      token_type: 'bearer',
      scope: 'read:user'
    }));
  };

  // 5a. First device flow success (Creation of endpoint and secret)
  const session1 = await dfManager5.startDeviceFlow();
  
  const authSuccessPromise = new Promise(resolve => dfManager5.once('device_auth_success', resolve));
  await authSuccessPromise;

  assert(reloadPoolsCalled >= 1, '5.1 llmRouter.reloadPools() wurde nach erfolgreicher Autorisierung aufgerufen');

  // Vault Verification
  const vaultStoredToken = await intVault.getSecret('sec_github_models');
  assert(vaultStoredToken === secretToken1, '5.2 Secret im CredentialVault entspricht exakt dem gelieferten Access-Token');

  // Verify file on disk is encrypted (Envelope check)
  const rawDiskVault = await fs.promises.readFile(intVault.vaultPath, 'utf8');
  assert(!rawDiskVault.includes(secretToken1), '5.3 Rohdatei des Tresors enthält NIEMALS das Klartext-Token (Kryptografische Sicherheit)');
  const parsedEnvelope = JSON.parse(rawDiskVault);
  assert(parsedEnvelope.cipher === 'aes-256-gcm', '5.4 Tresor mit AES-256-GCM verschlüsselt');
  assert(typeof parsedEnvelope.ciphertext === 'string' && parsedEnvelope.ciphertext.length > 20, '5.4 Ciphertext vorhanden');

  // Endpoint Verification
  const initialEndpointsCount = intEndpointMgr.getAllEndpoints().length;
  const createdEp = intEndpointMgr.getEndpoint('ep_github_models');
  assert(createdEp !== null, '5.5 Endpunkt ep_github_models existiert');
  assert(createdEp.provider === 'GitHub', '5.5 Provider ist GitHub');
  assert(createdEp.tier === 'ARCHITECT_TIER', '5.5 Tier ist ARCHITECT_TIER');
  assert(createdEp.baseUrl === 'https://models.github.ai/inference', '5.5 baseUrl ist models.github.ai');
  assert(createdEp.modelId === 'openai/gpt-4o', '5.5 modelId ist openai/gpt-4o');
  assert(createdEp.credentialRef === 'sec_github_models', '5.5 credentialRef ist sec_github_models');
  assert(createdEp.authType === 'oauth_device_flow', '5.5 authType ist oauth_device_flow');
  assert(createdEp.enabled === true, '5.5 Endpunkt ist aktiviert');
  assert(createdEp.maskedSecret.startsWith('gho_'), '5.5 Maskiertes Secret vorhanden');

  // 5b. Second device flow success (Idempotent update without duplicate endpoints)
  const secretToken2 = 'gho_beta_updated_secret_key_998877665544332211';
  server5.defaultHandler = (req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      access_token: secretToken2,
      token_type: 'bearer',
      scope: 'read:user'
    }));
  };

  const reloadBeforeSecond = reloadPoolsCalled;
  const session2 = await dfManager5.startDeviceFlow();
  const authSuccessPromise2 = new Promise(resolve => dfManager5.once('device_auth_success', resolve));
  await authSuccessPromise2;

  assert(reloadPoolsCalled > reloadBeforeSecond, '5.6 llmRouter.reloadPools() wurde bei erneutem Flow erneut getriggert');

  // Check endpoint count (must not create duplicate ep_github_models)
  const endpointsAfterSecond = intEndpointMgr.getAllEndpoints().length;
  assert(endpointsAfterSecond === initialEndpointsCount, `5.7 Keine Duplikate in endpoints.json erzeugt (Anzahl bleibt ${initialEndpointsCount})`);

  // 5c. Resilient handling when vault or endpoint manager encounters transient storage errors
  const faultyVault = {
    storeSecret: async () => { throw new Error('EACCES: permission denied / disk read-only'); }
  };
  const dfManagerFaulty = new DeviceFlowManager({
    vault: faultyVault,
    deviceCodeUrl: `${server5.baseUrl}/login/device/code`,
    tokenUrl: `${server5.baseUrl}/login/oauth/access_token`
  });

  const faultySession = await dfManagerFaulty.startDeviceFlow();
  const fSessObj = dfManagerFaulty.sessions.get(faultySession.sessionId);

  // Poll against successful server
  await dfManagerFaulty._poll(faultySession.sessionId);
  // Verify that an exception from vault is safely caught inside _poll without crashing process
  assert(fSessObj.status === 'success' || fSessObj.status === 'error', '5.9 Fehlerhafte Vault-Speicherung bringt Node-Prozess nicht zum Absturz');
  dfManagerFaulty.destroy();

  dfManager5.destroy();
  await server5.stop();
  console.log('[*] Test 5 abgeschlossen: Token-Registrierung, Tresor-Verschlüsselung und Endpunkt-Aktualisierung vollständig verifiziert.\n');

  // =========================================================================
  // SUMMARY RESULTS
  // =========================================================================
  console.log('\x1b[35m====================================================================\x1b[0m');
  console.log(`\x1b[35m   STRESS TEST ERGEBNIS: ${passedTests} BESTANDEN, ${failedTests} FEHLGESCHLAGEN   \x1b[0m`);
  console.log('\x1b[35m====================================================================\x1b[0m\n');

  if (failedTests > 0) {
    console.error('\x1b[31m[FEHLGESCHLAGENE TESTS]:\x1b[0m');
    failureDetails.forEach(f => console.error(` - ${f}`));
    process.exit(1);
  } else {
    console.log('\x1b[32m[VERDICT: CONFIRM CORRECTNESS] Sämtliche 5 Stress- und Fuzzing-Bereiche wurden fehlerfrei und empirisch validiert!\x1b[0m\n');
  }
}

runAdversarialStressSuite().catch(err => {
  console.error('\x1b[31m[FATAL SUITE CRASH]\x1b[0m', err);
  process.exit(1);
});
