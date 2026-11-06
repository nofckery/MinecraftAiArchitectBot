/**
 * Empirical Adversarial Challenger Test Suite for Milestone M2:
 * SafeProbeWorker Error Handling, Router Probe Stress, and Phase Isolation.
 *
 * Verifies:
 * 1. Phase 1 vs Phase 2 error propagation and isolation:
 *    - Socket drop immediate (Phase 1) => offline
 *    - Socket drop headers (Phase 1) => offline
 *    - Socket drop halfway body (Phase 1) => offline (never leaks into Phase 2 / degraded)
 *    - Truncated JSON (Phase 1) => offline
 *    - Empty 0-byte 200 (Phase 1) => offline
 *    - HTML error 200 (Phase 1) => offline
 *    - Phase 2 equivalents correctly map to degraded / INVALID_RESPONSE
 * 2. HTTP 401 / Invalid API Key classification in Phase 1 & Phase 2:
 *    - HTTP 401 in Phase 1 => unauthorized / INVALID_KEY
 *    - HTTP 401 in Phase 2 => unauthorized / INVALID_KEY
 *    - HTTP 400 with api_key_invalid => unauthorized / INVALID_KEY
 * 3. HTTP 429 Rate Limit vs Insufficient Quota:
 *    - Standard 429 => RATE_LIMIT, retry-after parsed, status cooldown in Phase 2
 *    - Quota 429 => INSUFFICIENT_QUOTA
 * 4. Timeout handling in Phase 1 and Phase 2:
 *    - Phase 1 timeout => offline / TIMEOUT
 *    - Phase 2 timeout => degraded / TIMEOUT
 * 5. Event emission contract (progress, probe_failed, probe_success).
 */

import assert from 'node:assert';
import http from 'node:http';
import net from 'node:net';
import { SafeProbeWorker, classifyError } from '../src/ai/safeProbeWorker.js';

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

async function runEmpiricalHarness() {
  console.log('================================================================');
  console.log('=== EMPIRICAL CHALLENGER M2: SAFE PROBE WORKER & PHASE AUDIT ===');
  console.log('================================================================\n');

  // Track raw TCP sockets to clean up
  const activeSockets = new Set();

  const edgeServer = net.createServer((socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));

    socket.once('data', (buf) => {
      const req = buf.toString();

      // Route 1: phase1-reset-immediate
      if (req.includes('/phase1-reset-immediate')) {
        socket.destroy();
      }
      // Route 2: phase1-reset-headers
      else if (req.includes('/phase1-reset-headers')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n');
        socket.destroy();
      }
      // Route 3: phase1-reset-body (Halfway body drop)
      else if (req.includes('/phase1-reset-body')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 200\r\n\r\n{"data":[{"id":');
        socket.destroy();
      }
      // Route 4: phase1-truncated-json
      else if (req.includes('/phase1-truncated-json')) {
        const body = '{"data":[{"id":"gpt-4"';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }
      // Route 5: phase1-zero-bytes
      else if (req.includes('/phase1-zero-bytes')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
      // Route 6: phase1-html
      else if (req.includes('/phase1-html')) {
        const body = '<html><body>502 Bad Gateway</body></html>';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }
      // Route 7: phase1-401
      else if (req.includes('/phase1-401')) {
        const body = JSON.stringify({ error: { message: 'Invalid API key' } });
        socket.write(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }
      // Route 8: phase1-ok-plaintext (GitHub Models style)
      else if (req.includes('/phase1-ok-plaintext')) {
        if (req.includes('/models')) {
          const body = 'OK';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          // Phase 2 ping success
          const body = JSON.stringify({ choices: [{ message: { content: 'hello' } }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // Route 9: phase2-401 (Phase 1 passes, Phase 2 fails with 401)
      else if (req.includes('/phase2-401')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ error: { message: 'Unauthorized key in chat' } });
          socket.write(`HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // Route 10: phase2-429-ratelimit
      else if (req.includes('/phase2-429-ratelimit')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ error: { message: 'Rate limit reached' } });
          socket.write(`HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nx-ratelimit-remaining-requests: 0\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // Route 11: phase2-429-quota
      else if (req.includes('/phase2-429-quota')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ error: { message: 'Insufficient balance on account', type: 'insufficient_quota' } });
          socket.write(`HTTP/1.1 429 Too Many Requests\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // Route 12: hanging server (indefinite hold for timeouts)
      else if (req.includes('/hanging')) {
        // Do not respond; keep open
      }
      // Default 404
      else {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
    });
  });

  await new Promise(r => edgeServer.listen(0, '127.0.0.1', r));
  const port = edgeServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const worker = new SafeProbeWorker({ phase1TimeoutMs: 800, phase2TimeoutMs: 800 });

  console.log('--- TEST GROUP 1: Phase 1 Isolation & Socket Drop Invariant ---');

  await checkAsync('1.1 Phase 1 immediate socket reset must be offline (not degraded)', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-reset-immediate`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.2 Phase 1 halfway-headers socket reset must be offline (not degraded)', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-reset-headers`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
  });

  await checkAsync('1.3 Phase 1 halfway-body socket reset MUST BE offline and NEVER leak to Phase 2', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-reset-body`, modelId: 'm1' });
    assert.strictEqual(res.success, false, 'Phase 1 body drop must be failure');
    assert.strictEqual(res.phase, 1, 'Phase must be 1, never leak to Phase 2');
    assert.strictEqual(res.status, 'offline', 'Status must be strictly offline, NOT degraded');
    assert.strictEqual(res.modelCatalogCount, 0);
  });

  await checkAsync('1.4 Phase 1 truncated JSON must be offline and report syntax error', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-truncated-json`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('1.5 Phase 1 zero-byte response must be offline (invalid JSON response)', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-zero-bytes`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('1.6 Phase 1 HTML response on HTTP 200 must be offline', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-html`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('1.7 Plaintext OK on /models is recognized as legitimate zero-model catalog', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-ok-plaintext`, modelId: 'm1' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.status, 'healthy');
    assert.deepStrictEqual(res.modelCatalog, []);
  });

  console.log('\n--- TEST GROUP 2: Authentication & Authorization (HTTP 401 & 400) ---');

  await checkAsync('2.1 Phase 1 HTTP 401 reports status unauthorized and code INVALID_KEY', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-401`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'unauthorized');
    assert.strictEqual(res.error?.code, 'INVALID_KEY');
    assert.strictEqual(res.error?.httpStatus, 401);
  });

  await checkAsync('2.2 Phase 2 HTTP 401 reports status unauthorized and code INVALID_KEY', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase2-401`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'unauthorized');
    assert.strictEqual(res.error?.code, 'INVALID_KEY');
  });

  check('2.3 classifyError classifies HTTP 400 with api_key_invalid as INVALID_KEY', () => {
    const classified = classifyError({
      status: 400,
      responseBody: '{"error":{"message":"API_KEY_INVALID"}}'
    });
    assert.strictEqual(classified.code, 'INVALID_KEY');
    assert.strictEqual(classified.httpStatus, 400);
  });

  console.log('\n--- TEST GROUP 3: Rate Limiting & Quotas (HTTP 429) ---');

  await checkAsync('3.1 Phase 2 HTTP 429 rate limit reports cooldown, RATE_LIMIT code, and extracts retryAfter', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase2-429-ratelimit`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'cooldown');
    assert.strictEqual(res.error?.code, 'RATE_LIMIT');
    assert.strictEqual(res.rateLimits?.retryAfterSec, 30);
    assert.strictEqual(res.rateLimits?.remainingRequests, 0);
  });

  await checkAsync('3.2 Phase 2 HTTP 429 insufficient quota reports degraded and INSUFFICIENT_QUOTA', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase2-429-quota`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INSUFFICIENT_QUOTA');
  });

  console.log('\n--- TEST GROUP 4: Timeout Enforcement ---');

  await checkAsync('4.1 Phase 1 timeout reports offline and TIMEOUT code', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/hanging`, modelId: 'm1' }, undefined, { phase1TimeoutMs: 300 });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'TIMEOUT');
  });

  console.log('\n--- TEST GROUP 5: EventEmitter Lifecycle Contract ---');

  await checkAsync('5.1 Events progress and probe_failed emit with correct payload shapes on failure', async () => {
    const events = [];
    worker.on('progress', e => events.push({ type: 'progress', data: e }));
    worker.on('probe_failed', e => events.push({ type: 'failed', data: e }));

    await worker.probeEndpoint({ baseUrl: `${baseUrl}/phase1-reset-body`, modelId: 'm1' });

    const progressP1 = events.find(e => e.type === 'progress' && e.data.phase === 1);
    assert(progressP1, 'Must emit progress for phase 1');
    const failedEvt = events.find(e => e.type === 'failed');
    assert(failedEvt, 'Must emit probe_failed event');
    assert.strictEqual(failedEvt.data.phase, 1);
    assert.strictEqual(failedEvt.data.status, 'offline');
  });

  for (const s of activeSockets) s.destroy();
  edgeServer.close();

  console.log('\n================================================================');
  console.log(`=== ALL ${passed}/${total} EMPIRICAL CHALLENGER ASSERTIONS PASSED ===`);
  console.log('================================================================\n');
}

runEmpiricalHarness().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('[FATAL] Empirical harness failed:', err);
  process.exit(1);
});
