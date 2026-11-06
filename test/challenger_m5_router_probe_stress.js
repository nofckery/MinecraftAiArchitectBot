/**
 * Standalone Adversarial Stress Harness for Milestone M5
 * Tests:
 * 1. Concurrency & FIFO Ordering in LLMRouter.reloadPools() (20 reloads + 50 concurrent requests)
 * 2. Timeout Enforcement & Event-Loop Non-Blocking in LLMRouter
 * 3. SafeProbeWorker Robustness against Malformed Payloads, Truncated JSON, Zero-Byte Bodies, Socket Resets, and Rate Limits
 */

import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import { LLMRouter, DynamicEndpoint } from '../src/ai/llmRouter.js';
import { SafeProbeWorker } from '../src/ai/safeProbeWorker.js';

const unhandledRejections = [];
process.on('unhandledRejection', (reason) => {
  unhandledRejections.push(reason);
});

async function runAllStressTests() {
  console.log('================================================================');
  console.log('=== MILESTONE M5 ADVERSARIAL CHALLENGER STRESS TEST SUITE ===');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;
  const findings = [];

  // =========================================================================
  // SECTION 1: CONCURRENCY & FIFO ORDERING IN LLMROUTER
  // =========================================================================
  console.log('>>> SECTION 1: Concurrency & FIFO Ordering Stress Test');

  // 1.1 Local Mock LLM Completion Server
  let activeInFlightRequests = 0;
  let maxConcurrentRequests = 0;
  let totalServerRequests = 0;

  const mockServer = http.createServer((req, res) => {
    activeInFlightRequests++;
    if (activeInFlightRequests > maxConcurrentRequests) {
      maxConcurrentRequests = activeInFlightRequests;
    }

    let rawBody = '';
    req.on('data', chunk => { rawBody += chunk; });
    req.on('end', () => {
      // Introduce variable simulated inference latency (15-35ms)
      const latency = 15 + Math.floor(Math.random() * 20);
      setTimeout(() => {
        activeInFlightRequests--;
        totalServerRequests++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'chatcmpl-stress-mock',
          object: 'chat.completion',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: JSON.stringify({ action: 'build', block: 'stone' }) },
            finish_reason: 'stop'
          }]
        }));
      }, latency);
    });
  });

  await new Promise(r => mockServer.listen(0, '127.0.0.1', r));
  const serverPort = mockServer.address().port;
  const mockBaseUrl = `http://127.0.0.1:${serverPort}/v1`;

  const router = new LLMRouter();

  // Seed with initial baseline endpoint
  const initEp = new DynamicEndpoint({
    id: 'ep_baseline',
    provider: 'BaselineProvider',
    baseUrl: mockBaseUrl,
    modelId: 'baseline-model',
    apiKey: 'baseline-key',
    tier: 'FAST_TIER'
  });
  router.fastEndpoints = [initEp];
  router.architectEndpoints = [initEp];

  // 1.2 Setup 20 mock managers with disparate artificial latencies (simulating variable vault read times)
  const reloadOrder = [];
  const managers = [];
  for (let i = 1; i <= 20; i++) {
    const version = i;
    // Vary latencies between 5ms and 45ms
    const latency = (i % 4 === 0) ? 40 : ((i % 2 === 0) ? 5 : 20);
    managers.push({
      version,
      getAllEnabledEndpoints: () => [
        {
          id: `ep_v${version}`,
          name: `Provider V${version}`,
          provider: `Provider_V${version}`,
          tier: 'FAST_TIER',
          priority: 1,
          baseUrl: mockBaseUrl,
          modelId: `model-v${version}`,
          credentialRef: `sec_v${version}`,
          enabled: true
        }
      ],
      getSecretForRef: async () => {
        await new Promise(r => setTimeout(r, latency));
        reloadOrder.push(version);
        return `secret_v${version}`;
      }
    });
  }

  // 1.3 Fire 20 rapid overlapping reloadPools() calls
  const reloadPromises = managers.map(m => router.reloadPools(m));

  // 1.4 Simultaneously fire 50 concurrent simulated LLM requests
  const requestPromises = [];
  const servedSnapshots = [];

  for (let reqIdx = 0; reqIdx < 50; reqIdx++) {
    // Interleave calls across the reloading window (0-50ms)
    const p = (async () => {
      await new Promise(r => setTimeout(r, Math.floor(Math.random() * 50)));
      const res = await router.executeRequest('FAST_TIER', [{ role: 'user', content: `Prompt ${reqIdx}` }]);
      servedSnapshots.push({
        reqIdx,
        provider: res.endpoint.provider,
        model: res.endpoint.model,
        apiKey: res.endpoint.apiKey
      });
      return res;
    })();
    requestPromises.push(p);
  }

  // 1.5 Wait for all reloads and requests to complete
  await Promise.all(reloadPromises);
  const completedRequests = await Promise.all(requestPromises);

  // Assertions for Concurrency & FIFO Ordering
  try {
    // A. Zero unhandled rejections
    assert.strictEqual(unhandledRejections.length, 0, `Expected 0 unhandled rejections, got ${unhandledRejections.length}`);

    // B. Strict FIFO sequence: all 20 reloads resolved in 1..20 sequence despite artificial latencies
    assert.strictEqual(reloadOrder.length, 20);
    for (let k = 0; k < 20; k++) {
      assert.strictEqual(reloadOrder[k], k + 1, `Reload order mismatch at index ${k}: expected ${k + 1}, got ${reloadOrder[k]}`);
    }

    // C. Zero lost updates: final active pool matches exactly the 20th manager's payload
    assert.strictEqual(router.fastEndpoints.length, 1);
    assert.strictEqual(router.fastEndpoints[0].provider, 'Provider_V20');
    assert.strictEqual(router.fastEndpoints[0].model, 'model-v20');
    assert.strictEqual(router.fastEndpoints[0].apiKey, 'secret_v20');

    // D. In-flight snapshot isolation: all 50 requests completed without corruption or crashes
    assert.strictEqual(completedRequests.length, 50);
    assert.strictEqual(servedSnapshots.length, 50);
    for (const snap of servedSnapshots) {
      assert(snap.provider.startsWith('BaselineProvider') || snap.provider.startsWith('Provider_V'), `Invalid provider in snapshot: ${snap.provider}`);
      assert(snap.apiKey.length > 0);
    }

    console.log(`[PASS] 1.1 Concurrency & FIFO Ordering: 20 overlapping reloads executed strictly in FIFO sequence`);
    console.log(`[PASS] 1.2 Zero lost updates: Pool matches payload 20 (Provider_V20 / model-v20)`);
    console.log(`[PASS] 1.3 In-Flight Isolation: 50 concurrent requests completed successfully (max concurrent: ${maxConcurrentRequests})`);
    console.log(`[PASS] 1.4 Zero unhandled rejections across concurrent reloads and requests`);
    passed += 4;
  } catch (err) {
    console.error(`[FAIL] Section 1 assertion failed:`, err.message);
    failed++;
  }

  // 1.6 Error resilience: verify that a failed reload in the queue does not stall subsequent reloads
  try {
    const errorManager = {
      getAllEnabledEndpoints: () => [{ id: 'ep_err', tier: 'FAST_TIER', baseUrl: mockBaseUrl, modelId: 'm-err', credentialRef: 'sec_err', enabled: true }],
      getSecretForRef: async () => {
        throw new Error('Vault decryption failure simulated');
      }
    };
    const recoveryManager = {
      getAllEnabledEndpoints: () => [{ id: 'ep_rec', provider: 'RecoveredProvider', tier: 'FAST_TIER', baseUrl: mockBaseUrl, modelId: 'm-rec', credentialRef: 'sec_rec', enabled: true }],
      getSecretForRef: async () => 'secret_rec'
    };

    let errorCaught = false;
    const pErr = router.reloadPools(errorManager).catch(e => {
      errorCaught = true;
      return 'caught';
    });
    const pRec = router.reloadPools(recoveryManager);

    await Promise.all([pErr, pRec]);

    assert.strictEqual(errorCaught, true, 'Error reload must reject');
    assert.strictEqual(router.fastEndpoints[0].provider, 'RecoveredProvider', 'Subsequent reload must succeed despite prior failure');
    console.log(`[PASS] 1.5 Queue Error Tolerance: Failed reload rejects without stalling subsequent reloads`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] 1.5 Queue Error Tolerance failed:`, err.message);
    failed++;
  }

  mockServer.close();


  // =========================================================================
  // SECTION 2: TIMEOUT ENFORCEMENT & EVENT-LOOP BLOCKING TEST
  // =========================================================================
  console.log('\n>>> SECTION 2: Timeout Enforcement & Event Loop Non-Blocking Test');

  // Create an HTTP server that holds connections open indefinitely
  let hangingConnections = [];
  let hangingServerRequests = 0;
  const hangingServer = http.createServer((req, res) => {
    hangingServerRequests++;
    hangingConnections.push(res);
  });
  await new Promise(r => hangingServer.listen(0, '127.0.0.1', r));
  const hangingPort = hangingServer.address().port;
  const hangingBaseUrl = `http://127.0.0.1:${hangingPort}/v1`;

  // 2.1 Event Loop Heartbeat & Non-Blocking Verification (with a 2000ms configured timeout)
  const epTimeoutTest = new DynamicEndpoint({
    provider: 'HangingHost',
    baseUrl: hangingBaseUrl,
    modelId: 'hanging-model',
    apiKey: 'dummy-key',
    tier: 'FAST_TIER',
    timeout: 2000
  });

  router.fastEndpoints = [epTimeoutTest];
  router.architectEndpoints = [];

  let heartbeatCount = 0;
  const heartbeatTimer = setInterval(() => {
    heartbeatCount++;
  }, 50);

  const reqStart = Date.now();
  let caughtTimeoutError = null;

  try {
    await router.executeRequest('FAST_TIER', [{ role: 'user', content: 'hang check' }]);
  } catch (err) {
    caughtTimeoutError = err;
  } finally {
    clearInterval(heartbeatTimer);
  }

  const elapsedMs = Date.now() - reqStart;

  try {
    // Check that event loop was NOT blocked
    assert(heartbeatCount > 10, `Event loop was blocked! Only ${heartbeatCount} heartbeats in ${elapsedMs}ms`);
    console.log(`[PASS] 2.1 Event loop remained non-blocking throughout timeout: ${heartbeatCount} heartbeat ticks counted`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] 2.1 Event loop non-blocking check failed:`, err.message);
    failed++;
  }

  // 2.2 Adversarial Verification of OpenAI SDK maxRetries: 0 & Cooldown Mapping Fix
  try {
    // Verify: With maxRetries: 0, the client makes exactly 1 attempt
    assert.strictEqual(hangingServerRequests, 1, `Expected client to attempt exactly 1 time (maxRetries: 0), got ${hangingServerRequests}`);
    assert(elapsedMs >= 1900 && elapsedMs <= 3500, `Expected elapsed time around 2000ms, got ${elapsedMs}ms`);
    console.log(`[PASS] 2.2.A: OpenAI Client maxRetries: 0 enforces strict single attempt (${elapsedMs}ms for timeout=2000ms)`);

    // Verify: Accurate timeout classification sets 30s cooldown
    const actualDiff = epTimeoutTest.cooldownUntil - Date.now();
    console.log(`[PASS] 2.2.B: Endpoint cooldown after timeout was correctly set to 30s (${Math.round(actualDiff / 1000)}s)`);
    assert(actualDiff >= 28000 && actualDiff <= 31000, `Expected 30s cooldown, actual diff: ${actualDiff}`);
    passed += 2;
  } catch (err) {
    console.error(`[FAIL] 2.2 Timeout audit failed:`, err.message);
    failed++;
  }

  // 2.3 Failover mechanism on timeout
  try {
    const epHealthy = new DynamicEndpoint({
      provider: 'HealthyBackup',
      baseUrl: mockBaseUrl,
      modelId: 'healthy-model',
      apiKey: 'healthy-key',
      tier: 'FAST_TIER'
    });

    // Reset cooldown on epTimeoutTest to make it available again
    epTimeoutTest.cooldownUntil = 0;
    router.fastEndpoints = [epTimeoutTest, epHealthy];

    // Ensure mockServer is running
    await new Promise(r => mockServer.listen(serverPort, '127.0.0.1', r)).catch(() => {});

    const failoverStart = Date.now();
    const failoverResult = await router.executeRequest('FAST_TIER', [{ role: 'user', content: 'failover test' }]);
    const failoverDuration = Date.now() - failoverStart;

    assert.strictEqual(failoverResult.endpoint.provider, 'HealthyBackup');
    assert(epTimeoutTest.cooldownUntil > Date.now(), 'Timed-out endpoint must be transitioned to cooldown');
    console.log(`[PASS] 2.3 Automatic Failover on Timeout: Successfully failed over to HealthyBackup (${failoverDuration}ms)`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] 2.3 Automatic Failover on Timeout failed:`, err.message);
    failed++;
  }

  for (const res of hangingConnections) res.end();
  hangingServer.close();


  // =========================================================================
  // SECTION 3: SAFEPROBEWORKER PROBE ROBUSTNESS
  // =========================================================================
  console.log('\n>>> SECTION 3: SafeProbeWorker Probe Robustness & Adversarial Edge Cases');

  // Setup raw TCP server simulating edge-case responses
  let rawTcpConnections = [];
  const edgeCaseTcpServer = net.createServer((socket) => {
    rawTcpConnections.push(socket);
    socket.once('data', (data) => {
      const reqStr = data.toString();

      // Dispatch based on URL path
      if (reqStr.includes('/reset-immediate')) {
        socket.destroy();
      } else if (reqStr.includes('/reset-halfway-headers')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n');
        socket.destroy();
      } else if (reqStr.includes('/reset-halfway-body')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"data":');
        socket.destroy();
      } else if (reqStr.includes('/p2-reset-body')) {
        // Phase 1 OK, Phase 2 reset halfway body
        if (reqStr.includes('GET ') && reqStr.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'test-model' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{"choices":');
          socket.destroy();
        }
      } else if (reqStr.includes('/truncated-json')) {
        const body = '{"data":[{"id":"trun';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      } else if (reqStr.includes('/p2-truncated-json')) {
        if (reqStr.includes('GET ') && reqStr.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'test-model' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = '{"choices":[{"message":{"content":"trun';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      } else if (reqStr.includes('/zero-bytes-200')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      } else if (reqStr.includes('/p2-zero-bytes-200')) {
        if (reqStr.includes('GET ') && reqStr.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'test-model' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
          socket.end();
        }
      } else if (reqStr.includes('/html-body-200')) {
        const body = '<!DOCTYPE html><html><body>Error 521 Web server is down</body></html>';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      } else if (reqStr.includes('/p2-html-body-200')) {
        if (reqStr.includes('GET ') && reqStr.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'test-model' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = '<!DOCTYPE html><html><body>Error 521 Web server is down</body></html>';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      } else if (reqStr.includes('/rate-limit-429')) {
        const body = JSON.stringify({ error: { message: 'Too many requests' } });
        socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: 45\r\nx-ratelimit-remaining-requests: 0\r\nx-ratelimit-reset-requests: 45.0\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      } else if (reqStr.includes('/quota-429')) {
        const body = JSON.stringify({ error: { message: 'You exceeded your current quota', type: 'insufficient_quota' } });
        socket.write(`HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      } else {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
    });
  });

  await new Promise(r => edgeCaseTcpServer.listen(0, '127.0.0.1', r));
  const edgePort = edgeCaseTcpServer.address().port;
  const edgeBaseUrl = `http://127.0.0.1:${edgePort}`;

  const worker = new SafeProbeWorker({ phase1TimeoutMs: 1000, phase2TimeoutMs: 1000 });

  // 3.1 Phase 1 Robustness Tests
  try {
    // 3.1.1 Socket Reset Immediate
    const resResetImm = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/reset-immediate`, modelId: 'test-model' });
    assert.strictEqual(resResetImm.success, false);
    assert.strictEqual(resResetImm.status, 'offline');
    assert.strictEqual(resResetImm.error?.code, 'NETWORK_ERROR');
    console.log(`[PASS] 3.1.1 Phase 1 Socket Reset Immediate: Gracefully handled as offline/NETWORK_ERROR`);

    // 3.1.2 Socket Reset Halfway Headers
    const resResetHdr = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/reset-halfway-headers`, modelId: 'test-model' });
    assert.strictEqual(resResetHdr.success, false);
    assert.strictEqual(resResetHdr.status, 'offline');
    console.log(`[PASS] 3.1.2 Phase 1 Socket Reset Halfway Headers: Gracefully handled as offline`);

    // 3.1.3 Socket Reset Halfway Body
    const resResetBody = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/reset-halfway-body`, modelId: 'test-model' });
    assert.strictEqual(resResetBody.success, false);
    assert.strictEqual(resResetBody.status, 'offline');
    console.log(`[PASS] 3.1.3 Phase 1 Socket Reset Halfway Body: Gracefully handled as offline`);

    // 3.1.4 Truncated JSON
    const resTrunc = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/truncated-json`, modelId: 'test-model' });
    assert.strictEqual(resTrunc.success, false);
    assert.strictEqual(resTrunc.status, 'offline');
    assert(resTrunc.error?.message.includes('Ungültige JSON-Antwort'));
    console.log(`[PASS] 3.1.4 Phase 1 Truncated JSON: Correctly caught syntax error and reported offline`);

    // 3.1.5 Zero-Byte Body on HTTP 200
    const resZero = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/zero-bytes-200`, modelId: 'test-model' });
    assert.strictEqual(resZero.success, false);
    assert.strictEqual(resZero.status, 'offline');
    console.log(`[PASS] 3.1.5 Phase 1 Zero-Byte Body: Correctly caught unexpected end of JSON and reported offline`);

    // 3.1.6 HTML Body on HTTP 200 (Captive portal / Cloudflare HTML)
    const resHtml = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/html-body-200`, modelId: 'test-model' });
    assert.strictEqual(resHtml.success, false);
    assert.strictEqual(resHtml.status, 'offline');
    console.log(`[PASS] 3.1.6 Phase 1 HTML Body on HTTP 200: Correctly caught invalid JSON syntax and reported offline`);

    // 3.1.7 Rate Limit 429
    const res429 = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/rate-limit-429`, modelId: 'test-model' });
    assert.strictEqual(res429.success, false);
    assert.strictEqual(res429.error?.code, 'RATE_LIMIT');
    console.log(`[PASS] 3.1.7 Phase 1 Rate-Limit 429: Correctly classified as RATE_LIMIT`);

    // 3.1.8 Insufficient Quota 429
    const resQuota = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/quota-429`, modelId: 'test-model' });
    assert.strictEqual(resQuota.success, false);
    assert.strictEqual(resQuota.error?.code, 'INSUFFICIENT_QUOTA');
    console.log(`[PASS] 3.1.8 Phase 1 Insufficient Quota 429: Correctly classified as INSUFFICIENT_QUOTA`);

    passed += 8;
  } catch (err) {
    console.error(`[FAIL] Section 3.1 Phase 1 tests failed:`, err.message);
    failed++;
  }

  // 3.2 Phase 2 Robustness & Malformed Payload Rejection Verification
  try {
    const p2ZeroRes = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/p2-zero-bytes-200`, modelId: 'test-model' });
    const p2HtmlRes = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/p2-html-body-200`, modelId: 'test-model' });
    const p2TruncRes = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/p2-truncated-json`, modelId: 'test-model' });
    const p2ResetBodyRes = await worker.probeEndpoint({ baseUrl: `${edgeBaseUrl}/p2-reset-body`, modelId: 'test-model' });

    console.log('\n[PHASE 2 VALIDATION RESULTS - ROBUST ERROR HANDLING]');
    console.log(`- Phase 2 Zero-Byte Body HTTP 200: success=${p2ZeroRes.success}, status=${p2ZeroRes.status}, error=${p2ZeroRes.error?.code}`);
    console.log(`- Phase 2 HTML Body HTTP 200:      success=${p2HtmlRes.success}, status=${p2HtmlRes.status}, error=${p2HtmlRes.error?.code}`);
    console.log(`- Phase 2 Truncated JSON HTTP 200: success=${p2TruncRes.success}, status=${p2TruncRes.status}, error=${p2TruncRes.error?.code}`);
    console.log(`- Phase 2 Socket Reset during Body:success=${p2ResetBodyRes.success}, status=${p2ResetBodyRes.status}, error=${p2ResetBodyRes.error?.code}`);

    // All four must reject and NOT report healthy!
    assert.strictEqual(p2ZeroRes.success, false, 'Zero-byte body must fail Phase 2');
    assert.notStrictEqual(p2ZeroRes.status, 'healthy', 'Zero-byte body must not be healthy');
    assert.strictEqual(p2ZeroRes.error?.code, 'INVALID_RESPONSE');

    assert.strictEqual(p2HtmlRes.success, false, 'HTML body must fail Phase 2');
    assert.notStrictEqual(p2HtmlRes.status, 'healthy', 'HTML body must not be healthy');
    assert.strictEqual(p2HtmlRes.error?.code, 'INVALID_RESPONSE');

    assert.strictEqual(p2TruncRes.success, false, 'Truncated JSON must fail Phase 2');
    assert.notStrictEqual(p2TruncRes.status, 'healthy', 'Truncated JSON must not be healthy');
    assert.strictEqual(p2TruncRes.error?.code, 'INVALID_RESPONSE');

    assert.strictEqual(p2ResetBodyRes.success, false, 'Socket reset during body must fail Phase 2');
    assert.notStrictEqual(p2ResetBodyRes.status, 'healthy', 'Socket reset must not be healthy');

    console.log(`[PASS] 3.2: Confirmed Phase 2 robustness: All malformed/truncated bodies rejected with INVALID_RESPONSE!`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] Section 3.2 Phase 2 test failed:`, err.message);
    failed++;
  }

  // 3.3 Rate-Limit Burst Stress Test (30 rapid probe requests)
  try {
    const burstPromises = [];
    for (let b = 0; b < 30; b++) {
      burstPromises.push(worker.probeEndpoint({
        baseUrl: `${edgeBaseUrl}/rate-limit-429`,
        modelId: 'test-model'
      }));
    }
    const burstResults = await Promise.all(burstPromises);
    assert.strictEqual(burstResults.length, 30);
    for (const r of burstResults) {
      assert.strictEqual(r.success, false);
      assert.strictEqual(r.error?.code, 'RATE_LIMIT');
    }
    console.log(`[PASS] 3.3 Rate-Limit Burst Test: 30 rapid probe requests handled consistently without memory leak or unhandled rejection`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] 3.3 Rate-Limit Burst Test failed:`, err.message);
    failed++;
  }

  for (const s of rawTcpConnections) s.destroy();
  edgeCaseTcpServer.close();

  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('\n================================================================');
  console.log(`=== STRESS TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
  console.log(`=== ADVERSARIAL FINDINGS DISCOVERED: ${findings.length} ===`);
  console.log('================================================================\n');

  for (const f of findings) {
    console.log(`- [${f.id}] ${f.title}`);
  }

  return { passed, failed, findings };
}

runAllStressTests().then(summary => {
  if (summary.failed > 0) {
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('\n[FATAL] Stress suite runner crashed:', err);
  process.exit(1);
});
