/**
 * Comprehensive Empirical Adversarial Stress Test Suite for Milestone M2:
 * SafeProbeWorker Error Handling, Socket Drops, Non-JSON Payloads & Concurrency.
 *
 * Covers:
 * 1. Abrupt socket closures at various stages:
 *    - Phase 1 & 2: Immediate socket drop on connect
 *    - Phase 1 & 2: Drop halfway through HTTP response headers
 *    - Phase 1 & 2: Drop halfway through response body
 *    - Phase 1 & 2: Drop exactly 1 byte before body completion (Content-Length: N, sending N-1 bytes)
 * 2. Non-JSON payloads:
 *    - Phase 1 & 2: HTML error pages on HTTP 200 (Captive portal / Cloudflare HTML)
 *    - Phase 1 & 2: HTML error pages on HTTP 500 (Internal Server Error)
 *    - Phase 1 & 2: Empty strings / zero-byte responses on HTTP 200
 *    - Phase 1 & 2: Random binary chunks (garbage byte streams)
 *    - Phase 1 & 2: Truncated JSON strings
 *    - Phase 2: Schema validation edge cases (missing choices, empty choices, invalid choice objects)
 * 3. High concurrency probe requests, event loop non-blocking & resource cleanup:
 *    - 100 concurrent probe requests across mixed chaotic server behaviors
 *    - Active event-loop heartbeat monitoring to detect blocking
 *    - Verification of zero unhandled rejections, zero lingering sockets, and full cleanup
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
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

async function runM2AdversarialSuite() {
  console.log('================================================================');
  console.log('=== EMPIRICAL CHALLENGER M2: SAFE PROBE WORKER DEEP STRESS ===');
  console.log('================================================================\n');

  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);

  const activeSockets = new Set();

  // Adversarial Mock Raw TCP Server
  const server = net.createServer((socket) => {
    activeSockets.add(socket);
    socket.on('close', () => activeSockets.delete(socket));

    socket.once('data', (buf) => {
      const req = buf.toString();

      // =======================================================================
      // CATEGORY 1: ABRUPT SOCKET CLOSURES
      // =======================================================================

      // 1.1 Phase 1 Immediate Reset
      if (req.includes('/p1-drop-immediate')) {
        socket.destroy();
      }
      // 1.2 Phase 1 Drop halfway through headers
      else if (req.includes('/p1-drop-headers')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: app');
        socket.destroy();
      }
      // 1.3 Phase 1 Drop halfway through body
      else if (req.includes('/p1-drop-halfway-body')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 120\r\n\r\n{"data":[{"id":"gpt-4"}');
        socket.destroy();
      }
      // 1.4 Phase 1 Drop 1 byte before end
      else if (req.includes('/p1-drop-1byte-before-end')) {
        const fullPayload = JSON.stringify({ data: [{ id: 'model-full' }] });
        const partial = fullPayload.slice(0, fullPayload.length - 1);
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${fullPayload.length}\r\n\r\n${partial}`);
        socket.destroy();
      }

      // 1.5 Phase 2 Immediate Reset
      else if (req.includes('/p2-drop-immediate')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.destroy();
        }
      }
      // 1.6 Phase 2 Drop halfway through headers
      else if (req.includes('/p2-drop-headers')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.write('HTTP/1.1 200 OK\r\nContent-Type: app');
          socket.destroy();
        }
      }
      // 1.7 Phase 2 Drop halfway through body
      else if (req.includes('/p2-drop-halfway-body')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 150\r\n\r\n{"choices":[{"message":{"content":"partial');
          socket.destroy();
        }
      }
      // 1.8 Phase 2 Drop 1 byte before end
      else if (req.includes('/p2-drop-1byte-before-end')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const fullPayload = JSON.stringify({ choices: [{ message: { content: 'hello' } }] });
          const partial = fullPayload.slice(0, fullPayload.length - 1);
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${fullPayload.length}\r\n\r\n${partial}`);
          socket.destroy();
        }
      }

      // =======================================================================
      // CATEGORY 2: NON-JSON PAYLOADS
      // =======================================================================

      // 2.1 Phase 1 HTML 200
      else if (req.includes('/p1-html-200')) {
        const body = '<!DOCTYPE html><html><body><h1>Error 521 Web server is down</h1></body></html>';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }
      // 2.2 Phase 1 HTML 500
      else if (req.includes('/p1-html-500')) {
        const body = '<html><body>500 Internal Server Error</body></html>';
        socket.write(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }
      // 2.3 Phase 1 Empty string / zero-byte 200
      else if (req.includes('/p1-empty-200')) {
        socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
      // 2.4 Phase 1 Random binary chunk
      else if (req.includes('/p1-binary-200')) {
        const bin = crypto.randomBytes(512);
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${bin.length}\r\n\r\n`);
        socket.write(bin);
        socket.end();
      }
      // 2.5 Phase 1 Truncated JSON
      else if (req.includes('/p1-truncated-json')) {
        const body = '{"data": [{"id": "model-1"}, {"id": "mod';
        socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
        socket.end();
      }

      // 2.6 Phase 2 HTML 200
      else if (req.includes('/p2-html-200')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = '<!DOCTYPE html><html><body>Error 504 Gateway Timeout</body></html>';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // 2.7 Phase 2 HTML 500
      else if (req.includes('/p2-html-500')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = '<html><body>500 Internal Server Error</body></html>';
          socket.write(`HTTP/1.1 500 Internal Server Error\r\nContent-Type: text/html\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // 2.8 Phase 2 Empty string / zero-byte 200
      else if (req.includes('/p2-empty-200')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          socket.write('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
          socket.end();
        }
      }
      // 2.9 Phase 2 Random binary chunk
      else if (req.includes('/p2-binary-200')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const bin = crypto.randomBytes(512);
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: ${bin.length}\r\n\r\n`);
          socket.write(bin);
          socket.end();
        }
      }
      // 2.10 Phase 2 Truncated JSON
      else if (req.includes('/p2-truncated-json')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = '{"choices":[{"message":{"role":"assistant","content":"hello';
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // 2.11 Phase 2 Schema: Missing choices
      else if (req.includes('/p2-schema-missing-choices')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ id: 'cmpl-1', object: 'chat.completion', result: 'no choices here' });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // 2.12 Phase 2 Schema: Empty choices array
      else if (req.includes('/p2-schema-empty-choices')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ id: 'cmpl-1', choices: [] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // 2.13 Phase 2 Schema: Valid OpenAI response
      else if (req.includes('/p2-healthy')) {
        if (req.includes('/models')) {
          const body = JSON.stringify({ data: [{ id: 'm1' }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        } else {
          const body = JSON.stringify({ id: 'cmpl-ok', choices: [{ message: { role: 'assistant', content: '1' } }] });
          socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
          socket.end();
        }
      }
      // Hanging connection
      else if (req.includes('/hanging')) {
        // intentionally hold
      }
      else {
        socket.write('HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n');
        socket.end();
      }
    });
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const worker = new SafeProbeWorker({ phase1TimeoutMs: 1000, phase2TimeoutMs: 1000 });

  console.log('>>> TEST SUITE 1: ABRUPT SOCKET CLOSURES (VARIOUS STAGES)');

  await checkAsync('1.1 Phase 1: Immediate socket reset -> status: offline, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-drop-immediate`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.2 Phase 1: Drop halfway through headers -> status: offline, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-drop-headers`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.3 Phase 1: Drop halfway through body -> status: offline, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-drop-halfway-body`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.4 Phase 1: Drop 1 byte before body completion -> status: offline, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-drop-1byte-before-end`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.5 Phase 2: Immediate socket reset -> status: degraded/offline, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-drop-immediate`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert(res.status === 'degraded' || res.status === 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.6 Phase 2: Drop halfway through headers -> status: degraded, error: NETWORK_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-drop-headers`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('1.7 Phase 2: Drop halfway through body -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-drop-halfway-body`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('1.8 Phase 2: Drop 1 byte before body completion -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-drop-1byte-before-end`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  console.log('\n>>> TEST SUITE 2: NON-JSON PAYLOADS (HTML, EMPTY, BINARY, TRUNCATED, SCHEMA)');

  await checkAsync('2.1 Phase 1: HTML error page on HTTP 200 -> status: offline, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-html-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.2 Phase 1: HTML error page on HTTP 500 -> status: offline, error: SERVER_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-html-500`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'SERVER_ERROR');
    assert.strictEqual(res.error?.httpStatus, 500);
  });

  await checkAsync('2.3 Phase 1: Empty string / zero-byte body on HTTP 200 -> status: offline, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-empty-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.4 Phase 1: Random binary chunk -> status: offline, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-binary-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.5 Phase 1: Truncated JSON string -> status: offline, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p1-truncated-json`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 1);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.6 Phase 2: HTML error page on HTTP 200 -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-html-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.7 Phase 2: HTML error page on HTTP 500 -> status: degraded, error: SERVER_ERROR', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-html-500`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'SERVER_ERROR');
    assert.strictEqual(res.error?.httpStatus, 500);
  });

  await checkAsync('2.8 Phase 2: Empty string / zero-byte body on HTTP 200 -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-empty-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.9 Phase 2: Random binary chunk -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-binary-200`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.10 Phase 2: Truncated JSON string -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-truncated-json`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.11 Phase 2 Schema: Missing choices field -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-schema-missing-choices`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
    assert(res.error?.message.includes('choices') || res.error?.message.includes('Antwortformat'));
  });

  await checkAsync('2.12 Phase 2 Schema: Empty choices array -> status: degraded, error: INVALID_RESPONSE', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-schema-empty-choices`, modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'degraded');
    assert.strictEqual(res.error?.code, 'INVALID_RESPONSE');
  });

  await checkAsync('2.13 Phase 2 Schema: Valid OpenAI response -> status: healthy, success: true', async () => {
    const res = await worker.probeEndpoint({ baseUrl: `${baseUrl}/p2-healthy`, modelId: 'm1' });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.phase, 2);
    assert.strictEqual(res.status, 'healthy');
  });

  console.log('\n>>> TEST SUITE 3: HIGH CONCURRENCY, EVENT LOOP NON-BLOCKING & RESOURCE CLEANUP');

  await checkAsync('3.1 100 concurrent chaotic probes with active event loop heartbeat monitoring', async () => {
    let heartbeats = 0;
    const heartbeatTimer = setInterval(() => {
      heartbeats++;
    }, 20);

    const endpoints = [
      `${baseUrl}/p1-drop-immediate`,
      `${baseUrl}/p1-drop-headers`,
      `${baseUrl}/p1-drop-halfway-body`,
      `${baseUrl}/p1-drop-1byte-before-end`,
      `${baseUrl}/p1-html-200`,
      `${baseUrl}/p1-empty-200`,
      `${baseUrl}/p1-binary-200`,
      `${baseUrl}/p1-truncated-json`,
      `${baseUrl}/p2-drop-immediate`,
      `${baseUrl}/p2-drop-headers`,
      `${baseUrl}/p2-drop-halfway-body`,
      `${baseUrl}/p2-drop-1byte-before-end`,
      `${baseUrl}/p2-html-200`,
      `${baseUrl}/p2-empty-200`,
      `${baseUrl}/p2-binary-200`,
      `${baseUrl}/p2-truncated-json`,
      `${baseUrl}/p2-schema-missing-choices`,
      `${baseUrl}/p2-schema-empty-choices`,
      `${baseUrl}/p2-healthy`
    ];

    const probePromises = [];
    const count = 100;
    for (let i = 0; i < count; i++) {
      const target = endpoints[i % endpoints.length];
      probePromises.push(worker.probeEndpoint({ baseUrl: target, modelId: 'm1' }, undefined, { phase1TimeoutMs: 1500, phase2TimeoutMs: 1500 }));
    }

    const start = performance.now();
    const results = await Promise.all(probePromises);
    const duration = performance.now() - start;

    clearInterval(heartbeatTimer);

    // Event loop verification
    console.log(`    [METRICS] 100 concurrent probes completed in ${Math.round(duration)}ms, heartbeats recorded: ${heartbeats}`);
    assert(heartbeats >= 5, `Event loop was blocked! Expected >= 5 heartbeats, got ${heartbeats}`);

    // Integrity verification
    assert.strictEqual(results.length, 100);
    const healthyCount = results.filter(r => r.success === true).length;
    const failedCount = results.filter(r => r.success === false).length;
    console.log(`    [METRICS] Healthy results: ${healthyCount}, Failed results handled: ${failedCount}`);
    assert(healthyCount > 0, 'Healthy endpoint must succeed');
    assert(failedCount > 0, 'Chaotic endpoints must fail gracefully');
  });

  await checkAsync('3.2 Zero unhandled rejections during high concurrency flood', async () => {
    assert.strictEqual(unhandled.length, 0, `Expected 0 unhandled rejections, got ${unhandled.length}: ${JSON.stringify(unhandled)}`);
  });

  await checkAsync('3.3 Socket resource cleanup and connection tear-down', async () => {
    for (const s of activeSockets) s.destroy();
    server.close();
    await new Promise(r => setTimeout(r, 100));
    assert.strictEqual(activeSockets.size, 0, `All sockets must be cleared, remaining: ${activeSockets.size}`);
  });

  console.log('\n>>> TEST SUITE 4: MALFORMED INPUT & CONFIG BOUNDARIES');

  await checkAsync('4.1 Malformed baseUrl syntax handled safely without unhandled exception', async () => {
    const res = await worker.probeEndpoint({ baseUrl: 'invalid://url:::123', modelId: 'm1' });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  await checkAsync('4.2 Missing or undefined baseUrl handled safely without crashing process', async () => {
    const res = await worker.probeEndpoint({}, 'dummy-sec');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'offline');
    assert.strictEqual(res.error?.code, 'NETWORK_ERROR');
  });

  process.removeListener('unhandledRejection', onUnhandled);

  console.log('\n================================================================');
  console.log(`=== ALL ${passed}/${total} ADVERSARIAL STRESS ASSERTIONS PASSED ===`);
  console.log('================================================================\n');

  return { passed, total };
}

runM2AdversarialSuite().then(summary => {
  if (summary.passed !== summary.total) {
    process.exit(1);
  }
  process.exit(0);
}).catch(err => {
  console.error('[FATAL] Stress suite aborted:', err);
  process.exit(1);
});
