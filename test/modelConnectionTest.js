import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager, maskSecret, isMaskedPlaceholder } from '../src/ai/endpointManager.js';
import { SafeProbeWorker } from '../src/ai/safeProbeWorker.js';
import { LLMRouter, Endpoint, DynamicEndpoint } from '../src/ai/llmRouter.js';

const TEST_VAULT_PATH = path.resolve('test', 'fixtures', 'model_conn_vault.test.vault');
const TEST_CONFIG_PATH = path.resolve('test', 'fixtures', 'endpoints.test.json');

async function cleanupTestFixtures() {
  try {
    const dir = path.resolve('test', 'fixtures');
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir);
      for (const f of files) {
        if (f.startsWith('model_conn_') || f.startsWith('endpoints.test') || f.startsWith('ep_concurrent')) {
          try {
            await fs.promises.unlink(path.join(dir, f));
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

async function runTests() {
  console.log('=== STARTING MODEL CONNECTION & BACKEND INFRASTRUCTURE TEST SUITE ===\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  await cleanupTestFixtures();

  try {
    // =========================================================================
    // Testgruppe 1: EndpointManager .env-Seeding & Auto-Migration
    // =========================================================================
    console.log('--- Testgruppe 1: EndpointManager .env-Seeding & Auto-Migration ---');

    const vault1 = new CredentialVault({
      vaultPath: TEST_VAULT_PATH,
      masterKey: 'test-seed-master-key-123'
    });
    const manager1 = new EndpointManager({
      configPath: TEST_CONFIG_PATH,
      vault: vault1
    });

    await asyncTest('1.1 Initialisierung bei fehlender endpoints.json führt Erst-Bootstrap durch', async () => {
      assert.strictEqual(fs.existsSync(TEST_CONFIG_PATH), false);
      await manager1.init();
      assert.strictEqual(fs.existsSync(TEST_CONFIG_PATH), true);
      const all = manager1.getAllEndpoints();
      assert(all.length > 0, 'Endpoints must be seeded from environment');
    });

    await asyncTest('1.2 Erzeugt Endpunkte mit isSystemDefault: true für Umgebungsvariablen', async () => {
      const all = manager1.getAllEndpoints();
      const systemDefaults = all.filter(e => e.isSystemDefault);
      assert(systemDefaults.length > 0, 'Should have system default endpoints');
      assert(all.some(e => e.provider === 'KiloAI' || e.provider === 'LLM7' || e.provider === 'Ollama'));
    });

    await asyncTest('1.3 Speichert keine unmaskierten Secrets in endpoints.json', async () => {
      const rawConfig = await fs.promises.readFile(TEST_CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(rawConfig);
      for (const ep of parsed.endpoints) {
        assert.strictEqual(ep.apiKey, undefined, 'API key must not be exposed in metadata JSON');
        if (ep.hasSecret) {
          assert(typeof ep.maskedSecret === 'string');
          assert(ep.maskedSecret.includes('...') || ep.maskedSecret.includes('•'));
        }
      }
    });

    // =========================================================================
    // Testgruppe 2: Maskierungs-Engine & Write-Only Invariante
    // =========================================================================
    console.log('\n--- Testgruppe 2: Maskierungs-Engine & Write-Only Invariante ---');

    test('2.1 maskSecret formatiert Schlüssel sicher nach Provider-Präfixen', () => {
      assert.strictEqual(maskSecret('csk_9876543210abcdef1234'), 'csk_...1234');
      assert.strictEqual(maskSecret('gho_16C7e42F292c69123456789abcdefABCD'), 'gho_...ABCD');
      assert.strictEqual(maskSecret('sk-proj-abcde1234567890fghij-klmnop1234567890'), 'sk-proj-...7890');
      assert.strictEqual(maskSecret('short'), '••••••••');
      assert.strictEqual(maskSecret('12345678'), '••••••••');
      assert.strictEqual(maskSecret(''), '');
      assert.strictEqual(maskSecret(null), '');
      assert.strictEqual(maskSecret(undefined), '');
      assert.strictEqual(maskSecret('\u0000'), '');
      assert.strictEqual(maskSecret('\u200B'), '');
      assert.strictEqual(maskSecret('   \r\n\t'), '');
    });

    test('2.2 isMaskedPlaceholder erkennt zuverlässig UI-Platzhalter aller Provider', () => {
      // Pure bullets & asterisks
      assert.strictEqual(isMaskedPlaceholder('••••••••'), true);
      assert.strictEqual(isMaskedPlaceholder('●●●●●●●●'), true);
      assert.strictEqual(isMaskedPlaceholder('********'), true);
      assert.strictEqual(isMaskedPlaceholder('••••'), true);

      // Prefixed bullets
      assert.strictEqual(isMaskedPlaceholder('sk-••••'), true);
      assert.strictEqual(isMaskedPlaceholder('csk_********'), true);

      // Ellipsis masks (with and without suffixes)
      assert.strictEqual(isMaskedPlaceholder('...'), true);
      assert.strictEqual(isMaskedPlaceholder('sk-...'), true);
      assert.strictEqual(isMaskedPlaceholder('... '), true);
      assert.strictEqual(isMaskedPlaceholder('sk-proj-...-123'), true);
      assert.strictEqual(isMaskedPlaceholder('gho_16...6912'), true);
      assert.strictEqual(isMaskedPlaceholder('...1234'), true);
      assert.strictEqual(isMaskedPlaceholder('csk_...abcd'), true);

      // Zero-width & control bytes
      assert.strictEqual(isMaskedPlaceholder('\u200B'), true);
      assert.strictEqual(isMaskedPlaceholder('\u200C'), true);
      assert.strictEqual(isMaskedPlaceholder('\u200D'), true);
      assert.strictEqual(isMaskedPlaceholder('\u0000'), true);
      assert.strictEqual(isMaskedPlaceholder('\x1b'), true);
      assert.strictEqual(isMaskedPlaceholder('\x7f'), true);

      // Trivially short inputs (< 8 chars)
      assert.strictEqual(isMaskedPlaceholder('123'), true);
      assert.strictEqual(isMaskedPlaceholder('abc'), true);

      // Echte Schlüssel dürfen niemals fälschlicherweise als Platzhalter erkannt werden
      assert.strictEqual(isMaskedPlaceholder('sk-proj-abcde1234567890fghij-klmnop1234567890'), false);
      assert.strictEqual(isMaskedPlaceholder('csk_actualSecretKeyWithNoDots123456789'), false);
      assert.strictEqual(isMaskedPlaceholder('none'), false);
      assert.strictEqual(isMaskedPlaceholder('test'), false);
      assert.strictEqual(isMaskedPlaceholder(''), false);
      assert.strictEqual(isMaskedPlaceholder(null), false);
      assert.strictEqual(isMaskedPlaceholder(undefined), false);
    });

    await asyncTest('2.3 Write-Only Invariante beim Update: Masken und Leerwerte überschreiben Secret NICHT', async () => {
      const created = await manager1.createEndpoint({
        name: 'Test Protect Invariant',
        provider: 'Custom',
        baseUrl: 'https://api.example.com/v1',
        modelId: 'gpt-test'
      }, 'original-secret-key-123456789');

      assert.strictEqual(created.hasSecret, true);
      const originalVaultSecret = await manager1.getSecretForRef(created.credentialRef);
      assert.strictEqual(originalVaultSecret, 'original-secret-key-123456789');

      // 1. Update mit Masken-Platzhalter
      await manager1.updateEndpoint(created.id, { name: 'Name Changed 1' }, '••••••••');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      // 2. Update mit Ellipsis-Platzhalter
      await manager1.updateEndpoint(created.id, { name: 'Name Changed 2' }, 'sk-proj-...-123');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      // 3. Update mit leerem String
      await manager1.updateEndpoint(created.id, { name: 'Name Changed 3' }, '');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      // 4. Update mit Whitespace
      await manager1.updateEndpoint(created.id, { name: 'Name Changed 4' }, '   ');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      // 5. Update mit Zero-Width & Control Characters
      await manager1.updateEndpoint(created.id, { name: 'Adversarial ZWSP' }, '\u200B');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      await manager1.updateEndpoint(created.id, { name: 'Adversarial NUL' }, '\u0000');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      await manager1.updateEndpoint(created.id, { name: 'Adversarial Ellipsis' }, '...');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      await manager1.updateEndpoint(created.id, { name: 'Adversarial Prefix' }, 'sk-...');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      await manager1.updateEndpoint(created.id, { name: 'Adversarial Hybrid' }, 'sk-••••');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'original-secret-key-123456789');

      // 6. Update mit echtem neuen Schlüssel überschreibt Vault
      await manager1.updateEndpoint(created.id, { name: 'Name Changed 5' }, 'brand-new-actual-api-key-999');
      assert.strictEqual(await manager1.getSecretForRef(created.credentialRef), 'brand-new-actual-api-key-999');
    });

    await asyncTest('2.4 activateTier setzt Prioritäten korrekt', async () => {
      const ep1 = await manager1.createEndpoint({ name: 'Fast 1', tier: 'FAST_TIER', priority: 2 });
      const ep2 = await manager1.createEndpoint({ name: 'Fast 2', tier: 'FAST_TIER', priority: 1 });

      await manager1.activateTier('FAST_TIER', ep1.id);
      const updated1 = manager1.getEndpoint(ep1.id);
      const updated2 = manager1.getEndpoint(ep2.id);

      assert.strictEqual(updated1.priority, 1);
      assert.strictEqual(updated1.enabled, true);
      assert(updated2.priority >= 2);
    });

    // =========================================================================
    // Testgruppe 3 & 4: SafeProbeWorker & Mock HTTP Server (Two-Tier & Error Taxonomy)
    // =========================================================================
    console.log('\n--- Testgruppe 3 & 4: SafeProbeWorker & Mock HTTP Server ---');

    let mockMode = 'success';
    let mockDelayMs = 0;
    const server = http.createServer(async (req, res) => {
      if (mockDelayMs > 0) {
        await new Promise(r => setTimeout(r, mockDelayMs));
      }

      if (mockMode === 'success') {
        if (req.url === '/models' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model-1' }, { id: 'test-model-2' }] }));
          return;
        }
        if (req.url === '/chat/completions' && req.method === 'POST') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'x-ratelimit-remaining-requests': '120',
            'x-ratelimit-remaining-tokens': '50000'
          });
          res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
          return;
        }
      }

      if (mockMode === 'auth_error_phase1') {
        if (req.url === '/models') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Invalid API key provided' } }));
          return;
        }
        if (req.url === '/chat/completions') {
          // Should not be called!
          res.writeHead(500);
          res.end('Phase 2 should not have been reached');
          return;
        }
      }

      if (mockMode === 'model_not_found_phase2') {
        if (req.url === '/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model-1' }] }));
          return;
        }
        if (req.url === '/chat/completions') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Model nonexistent not found' } }));
          return;
        }
      }

      if (mockMode === 'rate_limit_phase2') {
        if (req.url === '/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model-1' }] }));
          return;
        }
        if (req.url === '/chat/completions') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'retry-after': '25'
          });
          res.end(JSON.stringify({ error: { message: 'Rate limit reached' } }));
          return;
        }
      }

      if (mockMode === 'insufficient_quota_phase2') {
        if (req.url === '/models') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ data: [{ id: 'test-model-1' }] }));
          return;
        }
        if (req.url === '/chat/completions') {
          res.writeHead(429, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { code: 'insufficient_quota', message: 'You have exceeded your current quota' } }));
          return;
        }
      }

      if (mockMode === 'server_error_503') {
        if (req.url === '/models') {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Service Unavailable' }));
          return;
        }
      }

      if (mockMode === 'hung_socket') {
        // Do not respond, let timeout trigger
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const mockBaseUrl = `http://127.0.0.1:${port}`;

    const probeWorker = new SafeProbeWorker({
      phase1TimeoutMs: 1000,
      phase2TimeoutMs: 1500,
      localPhase2TimeoutMs: 2000
    });

    try {
      await asyncTest('3.1 Tier 1 & Tier 2 erfolgreich: Phase 1 lädt Katalog, Phase 2 misst Latenz & Quoten', async () => {
        mockMode = 'success';
        mockDelayMs = 5;
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.phase, 2);
        assert.strictEqual(result.status, 'healthy');
        assert.strictEqual(result.modelFound, true);
        assert.strictEqual(result.modelCatalogCount, 2);
        assert(result.latencyMs >= 0);
        assert.strictEqual(result.quotaRemaining, 120);
      });

      await asyncTest('3.2 Katalog-Fehlabgleich: modelFound wird false, führt aber Phase 2 trotzdem aus', async () => {
        mockMode = 'success';
        mockDelayMs = 0;
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'unknown-model-id-999'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.modelFound, false);
      });

      await asyncTest('4.1 HTTP 401 bricht sofort nach Phase 1 ab mit INVALID_KEY (Phase 2 wird übersprungen)', async () => {
        mockMode = 'auth_error_phase1';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'bad-secret');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.phase, 1);
        assert.strictEqual(result.status, 'unauthorized');
        assert.strictEqual(result.error?.code, 'INVALID_KEY');
      });

      await asyncTest('4.2 HTTP 404 in Phase 2 liefert MODEL_NOT_FOUND', async () => {
        mockMode = 'model_not_found_phase2';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'nonexistent'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.phase, 2);
        assert.strictEqual(result.error?.code, 'MODEL_NOT_FOUND');
      });

      await asyncTest('4.3 HTTP 429 Rate Limit liefert RATE_LIMIT & Status cooldown mit retryAfterSec', async () => {
        mockMode = 'rate_limit_phase2';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.status, 'cooldown');
        assert.strictEqual(result.error?.code, 'RATE_LIMIT');
        assert.strictEqual(result.rateLimits?.retryAfterSec, 25);
      });

      await asyncTest('4.4 HTTP 429 Insufficient Quota liefert INSUFFICIENT_QUOTA', async () => {
        mockMode = 'insufficient_quota_phase2';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error?.code, 'INSUFFICIENT_QUOTA');
      });

      await asyncTest('4.5 HTTP 503 Service Unavailable liefert SERVER_ERROR', async () => {
        mockMode = 'server_error_503';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error?.code, 'SERVER_ERROR');
      });

      await asyncTest('4.6 Hung Socket bricht nach Timeout ab mit TIMEOUT', async () => {
        mockMode = 'hung_socket';
        const config = {
          baseUrl: mockBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret', { phase1TimeoutMs: 200 });
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error?.code, 'TIMEOUT');
      });

      await asyncTest('4.7 Inaktiver Port liefert CONNECTION_REFUSED', async () => {
        const deadBaseUrl = 'http://127.0.0.1:59999';
        const config = {
          baseUrl: deadBaseUrl,
          modelId: 'test-model-1'
        };

        const result = await probeWorker.probeEndpoint(config, 'valid-secret', { phase1TimeoutMs: 500 });
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error?.code, 'CONNECTION_REFUSED');
      });
    } finally {
      server.close();
    }

    // =========================================================================
    // Testgruppe 5: LLMRouter.reloadPools() FIFO Mutex & Concurrency
    // =========================================================================
    console.log('\n--- Testgruppe 5: LLMRouter.reloadPools() FIFO Mutex & Concurrency ---');

    const router = new LLMRouter();

    await asyncTest('5.1 reloadPools(endpointManager) tauscht Pools atomar aus', async () => {
      const mockManager = {
        getAllEnabledEndpoints: () => [
          {
            id: 'ep_dyn_fast',
            name: 'Dynamic Fast Provider',
            provider: 'MockFast',
            tier: 'FAST_TIER',
            priority: 1,
            baseUrl: 'http://127.0.0.1:1234/v1',
            modelId: 'mock-fast-model',
            credentialRef: 'sec_dyn_fast',
            enabled: true
          },
          {
            id: 'ep_dyn_arch',
            name: 'Dynamic Architect Provider',
            provider: 'MockArch',
            tier: 'ARCHITECT_TIER',
            priority: 1,
            baseUrl: 'http://127.0.0.1:1234/v1',
            modelId: 'mock-arch-model',
            credentialRef: 'sec_dyn_arch',
            enabled: true
          }
        ],
        getSecretForRef: async (ref) => `secret_for_${ref}`
      };

      await router.reloadPools(mockManager);

      assert.strictEqual(router.fastEndpoints.length, 1);
      assert.strictEqual(router.fastEndpoints[0].provider, 'MockFast');
      assert.strictEqual(router.fastEndpoints[0].model, 'mock-fast-model');
      assert.strictEqual(router.fastEndpoints[0].apiKey, 'secret_for_sec_dyn_fast');

      assert.strictEqual(router.architectEndpoints.length, 1);
      assert.strictEqual(router.architectEndpoints[0].provider, 'MockArch');
      assert.strictEqual(router.architectEndpoints[0].apiKey, 'secret_for_sec_dyn_arch');
    });

    await asyncTest('5.2 In-Flight Concurrency: Anfragen während reloadPools laufen auf bestehendem Snapshot weiter', async () => {
      // 1. Initialer Zustand
      const initialEndpoint = router.fastEndpoints[0];
      assert(initialEndpoint);

      let reloadFinished = false;
      const slowManager = {
        getAllEnabledEndpoints: () => [
          {
            id: 'ep_slow_after',
            name: 'After Slow Reload',
            provider: 'SlowProvider',
            tier: 'FAST_TIER',
            priority: 1,
            baseUrl: 'http://127.0.0.1:1234/v1',
            modelId: 'slow-model',
            credentialRef: 'sec_slow',
            enabled: true
          }
        ],
        getSecretForRef: async () => {
          await new Promise(r => setTimeout(r, 60));
          reloadFinished = true;
          return 'slow-secret';
        }
      };

      // 2. Snapshot array vor dem Reload
      const inFlightSnapshot = [...router.getEndpointsForTier('FAST_TIER')];

      // 3. Starte asynchronen Reload
      const reloadPromise = router.reloadPools(slowManager);

      // Während Reload läuft: inFlightSnapshot hält weiterhin initialEndpoint
      assert.strictEqual(reloadFinished, false);
      assert.strictEqual(inFlightSnapshot[0].provider, 'MockFast');

      await reloadPromise;
      assert.strictEqual(reloadFinished, true);
      assert.strictEqual(router.fastEndpoints[0].provider, 'SlowProvider');
    });

    await asyncTest('5.3 FIFO Mutex Queue: Parallele Reload-Aufrufe werden strikt sequentiell abgearbeitet', async () => {
      const executionOrder = [];

      const managerA = {
        getAllEnabledEndpoints: () => [{ id: 'A', provider: 'A', tier: 'FAST_TIER', baseUrl: 'http://localhost/v1', modelId: 'mA', credentialRef: 'sec_A', enabled: true }],
        getSecretForRef: async () => {
          await new Promise(r => setTimeout(r, 40));
          executionOrder.push('A');
          return 'keyA';
        }
      };

      const managerB = {
        getAllEnabledEndpoints: () => [{ id: 'B', provider: 'B', tier: 'FAST_TIER', baseUrl: 'http://localhost/v1', modelId: 'mB', credentialRef: 'sec_B', enabled: true }],
        getSecretForRef: async () => {
          await new Promise(r => setTimeout(r, 10));
          executionOrder.push('B');
          return 'keyB';
        }
      };

      const managerC = {
        getAllEnabledEndpoints: () => [{ id: 'C', provider: 'C', tier: 'FAST_TIER', baseUrl: 'http://localhost/v1', modelId: 'mC', credentialRef: 'sec_C', enabled: true }],
        getSecretForRef: async () => {
          await new Promise(r => setTimeout(r, 5));
          executionOrder.push('C');
          return 'keyC';
        }
      };

      // Trigger all 3 concurrently
      const pA = router.reloadPools(managerA);
      const pB = router.reloadPools(managerB);
      const pC = router.reloadPools(managerC);

      await Promise.all([pA, pB, pC]);

      // FIFO order must be strictly A -> B -> C regardless of individual delays
      assert.deepStrictEqual(executionOrder, ['A', 'B', 'C']);
      assert.strictEqual(router.fastEndpoints[0].provider, 'C');
    });

    test('5.4 DynamicEndpoint initialisiert OpenAI-Client mit 30s Timeout', () => {
      const ep = new DynamicEndpoint({
        provider: 'TimeoutCheck',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'timeout-model',
        apiKey: 'test-key',
        tier: 'FAST_TIER'
      });

      assert.strictEqual(ep.timeout, 30000);
      assert.strictEqual(ep.client.timeout, 30000);
    });

    test('5.5 handleError setzt Cooldown bei Timeout-Fehler auf 30 Sekunden', () => {
      const ep = new DynamicEndpoint({
        provider: 'TimeoutEndpoint',
        baseUrl: 'http://127.0.0.1:1234/v1',
        modelId: 'm',
        apiKey: 'k',
        tier: 'FAST_TIER'
      });

      const timeoutError = new Error('Connection timed out');
      timeoutError.name = 'APIConnectionTimeoutError';

      const before = Date.now();
      router.handleError(ep, timeoutError);

      assert(ep.cooldownUntil >= before + 29000);
      assert(ep.cooldownUntil <= before + 31000);
    });

    // =========================================================================
    // Testgruppe 6: EndpointManager Concurrency & Atomic Consistency
    // =========================================================================
    console.log('\n--- Testgruppe 6: EndpointManager Concurrency & Atomic Consistency ---');

    await asyncTest('6.1 100 concurrent createEndpoint calls persist 100 endpoints and match disk', async () => {
      const cVault = new CredentialVault({
        vaultPath: path.resolve('test', 'fixtures', 'ep_concurrent_vault.vault')
      });
      const epMgr = new EndpointManager({
        configPath: path.resolve('test', 'fixtures', 'ep_concurrent.json'),
        vault: cVault,
        logger: { info: () => {}, error: () => {}, warn: () => {} }
      });
      await epMgr.init();

      const initialCount = epMgr.getAllEndpoints().length;
      const initialVaultObj = await cVault.load();
      const initialVaultCount = Object.keys(initialVaultObj.secrets || {}).length;

      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(epMgr.createEndpoint({ name: `Concurrent_EP_${i}`, modelId: `model_${i}` }, `secret_token_${i}`));
      }
      await Promise.all(promises);

      const inMem = epMgr.getAllEndpoints();
      assert.strictEqual(inMem.length, initialCount + 100);

      const diskRaw = await fs.promises.readFile(path.resolve('test', 'fixtures', 'ep_concurrent.json'), 'utf8');
      const diskData = JSON.parse(diskRaw);
      assert.strictEqual(diskData.endpoints.length, initialCount + 100);
      assert.strictEqual(inMem.length, diskData.endpoints.length);

      // Check vault secrets
      const vaultOnDisk = await cVault.load();
      assert.strictEqual(Object.keys(vaultOnDisk.secrets || {}).length, initialVaultCount + 100);
    });

    console.log(`\n=== MODEL CONNECTION TEST SUITE ERFOLGREICH: ${passed}/${total} TESTS BESTANDEN ===\n`);
  } finally {
    await cleanupTestFixtures();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL] Model Connection Test Suite fehlgeschlagen:', err);
  process.exit(1);
});
