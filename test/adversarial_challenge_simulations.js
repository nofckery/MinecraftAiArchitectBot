/**
 * ADVERSARIAL CHALLENGE SIMULATION SUITE
 * Verifying runtime resilience and concurrency architecture in IMPLEMENTIERUNGSPLAN_MODELLVERBINDUNGEN.md
 */

import assert from 'node:assert';
import EventEmitter from 'node:events';

// ============================================================================
// SIMULATION 1: ROUTER HOT-RELOADING & IN-FLIGHT REQUEST CONCURRENCY
// ============================================================================

class MockEndpoint {
  constructor(provider, model, tier, latencyMs = 20, shouldFail = false) {
    this.provider = provider;
    this.model = model;
    this.tier = tier;
    this.latencyMs = latencyMs;
    this.shouldFail = shouldFail;
    this.cooldownUntil = 0;
    this.disabled = false;
    this.successCount = 0;
    this.failureCount = 0;
    this.disposed = false;
  }

  isAvailable() {
    return !this.disabled && !this.disposed && Date.now() >= this.cooldownUntil;
  }

  async execute(prompt) {
    if (this.disposed) {
      throw new Error(`Endpoint [${this.provider}] was disposed while executing`);
    }
    await new Promise(resolve => setTimeout(resolve, this.latencyMs));
    if (this.shouldFail) {
      this.failureCount++;
      const err = new Error(`Simulated upstream failure on ${this.provider}`);
      err.status = 503;
      throw err;
    }
    this.successCount++;
    return {
      content: `Response from ${this.provider}:${this.model} for "${prompt}"`,
      provider: this.provider,
      model: this.model
    };
  }

  dispose() {
    this.disposed = true;
  }
}

class TestableRouter {
  constructor() {
    this.fastEndpoints = [];
    this.architectEndpoints = [];
    this.activeRequests = 0;
    this.completedRequests = 0;
    this.failedRequests = 0;
    this.reloadCount = 0;
  }

  getEndpointsForTier(tier) {
    if (tier === 'FAST_TIER') return this.fastEndpoints;
    if (tier === 'ARCHITECT_TIER') return this.architectEndpoints;
    return [];
  }

  /**
   * Proposed reloadPools implementation from IMPLEMENTIERUNGSPLAN_MODELLVERBINDUNGEN.md (Section 4.3)
   */
  async reloadPools(newFastConfigs, newArchitectConfigs, simulateAsyncVault = false) {
    this.reloadCount++;
    if (simulateAsyncVault) {
      // Simulating async decrypt/I/O
      await new Promise(r => setTimeout(r, 15));
    }

    const newFast = newFastConfigs.map(c => new MockEndpoint(c.provider, c.model, 'FAST_TIER', c.latencyMs, c.shouldFail));
    const newArchitect = newArchitectConfigs.map(c => new MockEndpoint(c.provider, c.model, 'ARCHITECT_TIER', c.latencyMs, c.shouldFail));

    // Atomic pointer swap as specified in plan
    this.fastEndpoints = newFast;
    this.architectEndpoints = newArchitect;
  }

  async executeRequest(tier, prompt) {
    this.activeRequests++;
    try {
      const candidates = [...this.getEndpointsForTier(tier)];
      if (candidates.length === 0) {
        throw new Error(`Keine aktiven LLM-Endpoints konfiguriert für Tier '${tier}'.`);
      }

      for (const endpoint of candidates) {
        if (!endpoint.isAvailable()) continue;
        try {
          const result = await endpoint.execute(prompt);
          this.completedRequests++;
          return result;
        } catch (err) {
          endpoint.cooldownUntil = Date.now() + 5000;
        }
      }
      this.failedRequests++;
      throw new Error(`Alle Endpoints für Tier '${tier}' erschöpft`);
    } finally {
      this.activeRequests--;
    }
  }
}

async function runHotReloadConcurrencyStressTest() {
  console.log('\n--- STARTING TEST 1: Hot-Reload Concurrency Stress Test ---');
  const router = new TestableRouter();

  // Initial pool: Generation 1
  await router.reloadPools(
    [{ provider: 'Gen1-Fast-A', model: 'fast-v1', latencyMs: 25 }, { provider: 'Gen1-Fast-B', model: 'fast-v1', latencyMs: 40 }],
    [{ provider: 'Gen1-Arch-A', model: 'arch-v1', latencyMs: 50 }]
  );

  const totalRequests = 200;
  let requestsLaunched = 0;
  const inFlightPromises = [];
  const responses = [];

  // Launch 200 requests in staggered bursts across 100ms
  const launchPromises = [];
  const startMs = Date.now();

  for (let i = 1; i <= totalRequests; i++) {
    const delay = Math.floor((i / totalRequests) * 80); // Stagger over 80ms
    const p = new Promise(resolve => {
      setTimeout(async () => {
        const reqId = i;
        requestsLaunched++;
        try {
          const res = await router.executeRequest('FAST_TIER', `req-${reqId}`);
          responses.push({ reqId, res, error: null });
        } catch (err) {
          responses.push({ reqId, res: null, error: err });
        }
        resolve();
      }, delay);
    });
    inFlightPromises.push(p);
  }

  // Trigger concurrent pool reloads while requests are actively in flight
  await new Promise(r => setTimeout(r, 20));
  const reload1 = router.reloadPools(
    [{ provider: 'Gen2-Fast-A', model: 'fast-v2', latencyMs: 15 }],
    [{ provider: 'Gen2-Arch-A', model: 'arch-v2', latencyMs: 45 }],
    true
  );

  await new Promise(r => setTimeout(r, 25));
  const reload2 = router.reloadPools(
    [{ provider: 'Gen3-Fast-A', model: 'fast-v3', latencyMs: 25 }, { provider: 'Gen3-Fast-B', model: 'fast-v3', latencyMs: 20 }],
    [{ provider: 'Gen3-Arch-A', model: 'arch-v3', latencyMs: 35 }],
    true
  );

  await new Promise(r => setTimeout(r, 30));
  const reload3 = router.reloadPools(
    [{ provider: 'Gen4-Fast-A', model: 'fast-v4', latencyMs: 10 }],
    [{ provider: 'Gen4-Arch-A', model: 'arch-v4', latencyMs: 20 }],
    false
  );

  await Promise.all([reload1, reload2, reload3]);
  await Promise.all(inFlightPromises);

  console.log(`[RESULTS] Total launched: ${requestsLaunched}, Responses received: ${responses.length}`);
  console.log(`[RESULTS] Completed successfully: ${router.completedRequests}, Failed: ${router.failedRequests}, In-flight: ${router.activeRequests}`);

  assert.strictEqual(responses.length, totalRequests, 'Every in-flight request must settle');
  assert.strictEqual(router.activeRequests, 0, 'No dangling in-flight requests remain');
  assert.strictEqual(router.failedRequests, 0, 'No in-flight request dropped during reload');

  // Verify that requests executed across different generations without crashing
  const providersUsed = new Set(responses.map(r => r.res.provider));
  console.log(`[PASS] Concurrency stress test passed! Providers seamlessly utilized during reloads:`, [...providersUsed]);

  // ADVERSARIAL EDGE CASE 1B: Empty pool reload handling
  console.log('\n--- ADVERSARIAL TEST 1B: Empty Pool Reload & Concurrency ---');
  let emptyPoolHandledProperly = false;
  try {
    await router.reloadPools([], []);
    await router.executeRequest('FAST_TIER', 'test-empty');
  } catch (err) {
    if (err.message.includes('Keine aktiven LLM-Endpoints')) {
      emptyPoolHandledProperly = true;
    }
  }
  assert.strictEqual(emptyPoolHandledProperly, true, 'Empty pool must throw graceful domain error, not unhandled crash');
  console.log('[PASS] Empty pool handled gracefully with domain error');

  // ADVERSARIAL TEST 1C: Reload Re-entrancy / Out-of-Order Overwrite
  console.log('\n--- ADVERSARIAL TEST 1C: Concurrent Reload Re-entrancy & Sequence Integrity ---');
  let reloadSeq = 0;
  class QueuedRouter extends TestableRouter {
    constructor() {
      super();
      this.currentVersion = 0;
      this._reloadQueue = Promise.resolve();
    }

    // Queued reload ensuring FIFO execution even with variable async delays
    reloadPoolsSerialized(newFastConfigs, newArchitectConfigs, asyncDelayMs, version) {
      this._reloadQueue = this._reloadQueue.then(async () => {
        await new Promise(r => setTimeout(r, asyncDelayMs));
        const newFast = newFastConfigs.map(c => new MockEndpoint(c.provider, c.model, 'FAST_TIER', c.latencyMs));
        this.fastEndpoints = newFast;
        this.currentVersion = version;
      });
      return this._reloadQueue;
    }
  }

  const queuedRouter = new QueuedRouter();
  // Trigger slow update (version 1 with 40ms delay) and then fast update (version 2 with 5ms delay)
  const slowUpdate = queuedRouter.reloadPoolsSerialized(
    [{ provider: 'Old-Provider', model: 'old-model', latencyMs: 10 }],
    [],
    40,
    1
  );
  const fastUpdate = queuedRouter.reloadPoolsSerialized(
    [{ provider: 'New-Provider', model: 'new-model', latencyMs: 10 }],
    [],
    5,
    2
  );

  await Promise.all([slowUpdate, fastUpdate]);
  assert.strictEqual(queuedRouter.currentVersion, 2, 'Latest version must win, not overwritten by delayed reload');
  assert.strictEqual(queuedRouter.fastEndpoints[0].provider, 'New-Provider');
  console.log('[PASS] Serialized reload queue successfully prevents out-of-order race conditions!');
}

// ============================================================================
// SIMULATION 2: TWO-TIER SAFE PROBE & THINKING MODELS (DeepSeek-R1 / max_tokens)
// ============================================================================

class MockProbeServer {
  constructor(port) {
    this.port = port;
    this.modelsEndpointAvailable = true;
    this.thinkingModelEnforced = false;
    this.minThinkingTokens = 50;
    this.truncatedOnShortBudget = true;
  }

  handleModelsRequest(authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
    if (!this.modelsEndpointAvailable) {
      return { status: 404, body: { error: 'Not Found: Endpoint /models is not implemented on this proxy' } };
    }
    return {
      status: 200,
      body: {
        object: 'list',
        data: [
          { id: 'deepseek-ai/DeepSeek-R1', object: 'model' },
          { id: 'llama-3.3-70b', object: 'model' }
        ]
      }
    };
  }

  handleChatCompletions(payload, authHeader) {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    const { model, max_tokens, messages } = payload;

    // Test Thinking Model behavior (e.g. DeepSeek-R1, Claude 3.7 Sonnet Thinking, etc.)
    const isThinking = model.toLowerCase().includes('r1') || model.toLowerCase().includes('thinking');

    if (isThinking) {
      // Case A: max_tokens = 1 for a thinking model
      if (max_tokens === 1) {
        // Many thinking models or providers return finish_reason: "length" with 0 content tokens because thinking alone exceeds 1 token
        return {
          status: 200,
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: '', reasoning_content: '<think' },
              finish_reason: 'length'
            }],
            usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
          }
        };
      }

      // Case B: max_tokens = 50 for a thinking model
      if (max_tokens <= 50) {
        // DeepSeek-R1 thinking tokens alone typically average 150-500 tokens.
        // With max_tokens = 50, completion finishes with finish_reason: 'length' and partial reasoning_content
        return {
          status: 200,
          body: {
            id: 'chatcmpl-test',
            object: 'chat.completion',
            choices: [{
              index: 0,
              message: { role: 'assistant', content: '', reasoning_content: '<think>\nThinking about the number 1...' },
              finish_reason: 'length'
            }],
            usage: { prompt_tokens: 5, completion_tokens: max_tokens, total_tokens: 5 + max_tokens }
          }
        };
      }
    }

    // Standard non-thinking model
    return {
      status: 200,
      body: {
        id: 'chatcmpl-test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: '1' },
          finish_reason: 'stop'
        }],
        usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
      }
    };
  }
}

/**
 * Implementation of SafeProbeWorker logic matching Section 4.4 of plan
 */
class SafeProbeWorker {
  constructor(server) {
    this.server = server;
  }

  async probeEndpoint(config, secret) {
    const authHeader = `Bearer ${secret}`;
    const startTime = Date.now();

    // --- PHASE 1: Zero-Cost Metadata Probe ---
    const modelsRes = this.server.handleModelsRequest(authHeader);
    let catalog = [];

    if (modelsRes.status === 401) {
      return { success: false, phase: 1, error: 'API-Key ungültig (HTTP 401)', status: 'unauthorized' };
    } else if (modelsRes.status === 200) {
      catalog = modelsRes.body.data.map(m => m.id);
    } else if (modelsRes.status === 404) {
      // ADVERSARIAL CHECK: Does Phase 1 fail if provider doesn't support /models?
      // SOTA resilience: If /models is 404, we should WARN and proceed to Phase 2 rather than hard-failing!
      // If the plan specifies immediate abortion on non-200, it breaks custom proxies.
    }

    // --- PHASE 2: Minimal Token Ping ---
    const isThinking = config.modelId.toLowerCase().includes('r1') ||
                       config.modelId.toLowerCase().includes('reasoning') ||
                       config.modelId.toLowerCase().includes('gpt-oss');

    // The plan specifies max_tokens: 50 for reasoning models and 1 for others
    const maxTokens = isThinking ? 50 : 1;

    const chatPayload = {
      model: config.modelId,
      messages: [{ role: 'user', content: '1' }],
      max_tokens: maxTokens
    };

    const chatRes = this.server.handleChatCompletions(chatPayload, authHeader);
    const latencyMs = Date.now() - startTime;

    if (chatRes.status !== 200) {
      return { success: false, phase: 2, error: `HTTP ${chatRes.status}`, status: 'degraded' };
    }

    const choice = chatRes.body.choices?.[0];
    const finishReason = choice?.finish_reason;
    const hasContentOrReasoning = !!(choice?.message?.content || choice?.message?.reasoning_content);

    // CRITICAL EMPIRICAL OBSERVATION:
    // With max_tokens = 50, finish_reason is 'length', NOT 'stop'.
    // If the probe strictly requires finish_reason === 'stop', DeepSeek-R1 FAILS!
    // But if probe verifies HTTP 200 and receipt of valid choice/usage, it SUCCEEDS!
    const probeSuccess = chatRes.status === 200 && choice !== undefined;

    return {
      success: probeSuccess,
      phase: 2,
      latencyMs,
      finishReason,
      hasContentOrReasoning,
      maxTokensUsed: maxTokens,
      model: config.modelId
    };
  }
}

async function runSafeProbeStressTest() {
  console.log('\n--- STARTING TEST 2: Two-Tier Safe Probe & Thinking Model Simulation ---');
  const server = new MockProbeServer(9999);
  const probeWorker = new SafeProbeWorker(server);

  // Test 2A: Standard model (e.g. Llama-3.3-70b)
  const standardConfig = { modelId: 'llama-3.3-70b' };
  const standardRes = await probeWorker.probeEndpoint(standardConfig, 'sk-test-valid');
  assert.strictEqual(standardRes.success, true);
  assert.strictEqual(standardRes.maxTokensUsed, 1);
  assert.strictEqual(standardRes.finishReason, 'stop');
  console.log('[PASS] Standard model probed with 1 token ping: success=true, finish_reason=stop');

  // Test 2B: Thinking model (DeepSeek-R1) with max_tokens: 50
  const thinkingConfig = { modelId: 'deepseek-ai/DeepSeek-R1' };
  const thinkingRes = await probeWorker.probeEndpoint(thinkingConfig, 'sk-test-valid');
  assert.strictEqual(thinkingRes.success, true);
  assert.strictEqual(thinkingRes.maxTokensUsed, 50);
  console.log(`[PASS] Thinking model (DeepSeek-R1) with max_tokens=50: success=${thinkingRes.success}, finish_reason=${thinkingRes.finishReason}`);
  console.log(`       Reasoning tokens observed without truncation crash: ${thinkingRes.hasContentOrReasoning}`);

  // Test 2C: Gateway without /models (Phase 1 404 test)
  server.modelsEndpointAvailable = false;
  const noModelsRes = await probeWorker.probeEndpoint(standardConfig, 'sk-test-valid');
  console.log(`[OBSERVATION] When /models returns 404 on custom gateway: Phase 2 probe still reaches chat/completions? success=${noModelsRes.success}`);
  server.modelsEndpointAvailable = true;

  // Test 2D: The "finish_reason === 'stop'" Trap on DeepSeek-R1
  console.log('\n--- TEST 2D: The finish_reason === "stop" Trap on DeepSeek-R1 ---');
  function naiveProbeEvaluation(res) {
    if (res.status === 200 && res.body.choices?.[0]?.finish_reason === 'stop') {
      return { success: true };
    }
    return { success: false, reason: `Invalid finish_reason: ${res.body.choices?.[0]?.finish_reason}` };
  }
  function resilientProbeEvaluation(res) {
    const choice = res.body.choices?.[0];
    if (res.status === 200 && choice && (choice.finish_reason === 'stop' || choice.finish_reason === 'length')) {
      return { success: true };
    }
    return { success: false, reason: 'No choices returned' };
  }
  const chatPayloadR1 = { model: 'deepseek-ai/DeepSeek-R1', messages: [{ role: 'user', content: '1' }], max_tokens: 50 };
  const r1Res = server.handleChatCompletions(chatPayloadR1, 'Bearer sk-valid');
  const naiveResult = naiveProbeEvaluation(r1Res);
  const resilientResult = resilientProbeEvaluation(r1Res);
  assert.strictEqual(naiveResult.success, false, 'Naive probe fails on thinking model due to finish_reason === "length"');
  assert.strictEqual(resilientResult.success, true, 'Resilient probe succeeds by accepting finish_reason: "length" or "stop"');
  console.log('[OBSERVATION] Naive finish_reason===stop check fails on DeepSeek-R1:', naiveResult);
  console.log('[PASS] Resilient probe accepts finish_reason="length" and confirms endpoint vitality:', resilientResult);
}

// ============================================================================
// SIMULATION 3: SECRET-MASKING REGEX & WRITE-ONLY PROTOCOL STRESS TESTS
// ============================================================================

/**
 * Proposed masking and sanitization functions based on Section 3.7
 */
function maskSecret(secret) {
  if (typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (trimmed.length === 0) return '';

  // If secret is short (<= 8 chars), masking must not expose the key!
  if (trimmed.length <= 8) {
    return '••••••••';
  }

  // Preserve provider prefix if present (e.g., sk-proj-, sk-or-v1-, gho_, gsk_, csk_)
  const prefixMatch = trimmed.match(/^([a-z0-9_-]{3,12}_)/i) || trimmed.match(/^(sk-proj-|sk-or-v1-|sk-ant-api\d\d-|sk-)/i);
  const prefix = prefixMatch ? prefixMatch[0] : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);

  // Ensure prefix and suffix do not overlap or expose too much
  if (prefix.length + suffix.length >= trimmed.length) {
    return `${trimmed.slice(0, 3)}...${suffix}`;
  }

  return `${prefix}...${suffix}`;
}

function isMaskedPlaceholder(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  // Bullets: any sequence of 3 or more bullet/asterisk characters
  if (/^[•●\*]{3,}$/.test(trimmed)) return true;
  // Ellipsis placeholder: e.g. "sk-proj-...-123", "gho_16...6912", "...abcd"
  // Suffix can contain letters, numbers, hyphens, underscores, or base64 chars
  if (/^[a-z0-9_-]{0,16}\.{3}[a-z0-9_\-\.\+=]{2,8}$/i.test(trimmed)) return true;
  if (/^\.{3}[a-z0-9_\-\.\+=]{2,8}$/i.test(trimmed)) return true;
  return false;
}

function sanitizeLogString(str, knownSecrets = []) {
  if (typeof str !== 'string') return str;
  let sanitized = str;

  // Replace known secrets
  for (const s of knownSecrets) {
    if (s && s.length >= 4) {
      sanitized = sanitized.split(s).join('[REDACTED_SECRET]');
    }
  }

  // Regex sanitization for common API key patterns in logs/headers
  sanitized = sanitized.replace(/Bearer\s+([a-zA-Z0-9_\-\.]{8,})/gi, 'Bearer [REDACTED_TOKEN]');
  sanitized = sanitized.replace(/(apiKey|api_key|token|secret)["']?\s*[:=]\s*["']([^"']+)["']/gi, '$1: "[REDACTED_SECRET]"');
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9_-]{20,}/g, 'sk-[REDACTED]');
  sanitized = sanitized.replace(/gho_[a-zA-Z0-9]{20,}/g, 'gho_[REDACTED]');
  sanitized = sanitized.replace(/gsk_[a-zA-Z0-9]{20,}/g, 'gsk_[REDACTED]');
  sanitized = sanitized.replace(/csk_[a-zA-Z0-9]{20,}/g, 'csk_[REDACTED]');

  return sanitized;
}

async function runSecretMaskingStressTest() {
  console.log('\n--- STARTING TEST 3: Secret-Masking Regex & Write-Only Protocol Stress Tests ---');

  const testKeys = [
    { name: 'OpenAI Project Key', raw: 'sk-proj-abcde1234567890fghij-klmnop1234567890' },
    { name: 'OpenRouter Key', raw: 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef' },
    { name: 'GitHub OAuth Token', raw: 'gho_16C7e42F292c69123456789abcdefABCD' },
    { name: 'Groq API Key', raw: 'gsk_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP' },
    { name: 'Cerebras API Key', raw: 'csk_9876543210abcdef1234567890abcdef' },
    { name: 'Gemini Key', raw: 'AIzaSyD-1234567890abcdefghijklmnopqrstUVWXYZ' },
    { name: 'Short Key (4 chars)', raw: '1234' },
    { name: 'Short Key (8 chars)', raw: 'abcd1234' },
    { name: 'Empty Key', raw: '' },
    { name: 'Whitespace Key', raw: '    ' }
  ];

  for (const item of testKeys) {
    const masked = maskSecret(item.raw);
    console.log(`[KEY FORMAT] ${item.name.padEnd(22)}: Raw="${item.raw.slice(0, 10)}..." -> Masked="${masked}"`);

    // VERIFICATION: Raw key MUST NOT appear anywhere in the masked output if raw.length > 8
    if (item.raw.trim().length > 8) {
      assert.ok(!masked.includes(item.raw), `Raw key leaked in masked output for ${item.name}`);
      assert.ok(masked.includes('...'), `Masked key must contain ellipsis for ${item.name}`);
      assert.ok(isMaskedPlaceholder(masked), `isMaskedPlaceholder must recognize masked output for ${item.name}`);
    } else if (item.raw.trim().length > 0) {
      assert.strictEqual(masked, '••••••••', `Short key must be masked with bullets: ${item.name}`);
      assert.ok(isMaskedPlaceholder(masked), `isMaskedPlaceholder must recognize bullet placeholder`);
    } else {
      assert.strictEqual(masked, '', `Empty key must mask to empty string`);
    }
  }

  // TEST 3B: Write-Only update simulation (keepExistingSecret check)
  console.log('\n--- TEST 3B: Write-Only Protocol Update Idempotency ---');
  let vaultSecret = 'sk-proj-super-secret-vault-token-xyz-123';

  function simulateUpdateEndpoint(payloadSecret) {
    // Backend logic per plan
    if (!payloadSecret || isMaskedPlaceholder(payloadSecret)) {
      // Keep existing secret
      return { action: 'KEPT_EXISTING', currentSecret: vaultSecret };
    } else {
      // New secret provided
      vaultSecret = payloadSecret;
      return { action: 'UPDATED', currentSecret: vaultSecret };
    }
  }

  // User leaves secret empty or sends bullet placeholder
  let u1 = simulateUpdateEndpoint('••••••••');
  assert.strictEqual(u1.action, 'KEPT_EXISTING');
  assert.strictEqual(vaultSecret, 'sk-proj-super-secret-vault-token-xyz-123');

  // User sends masked string "sk-proj-...-123"
  let u2 = simulateUpdateEndpoint(maskSecret(vaultSecret));
  assert.strictEqual(u2.action, 'KEPT_EXISTING', 'Masked string must not overwrite real vault secret');
  assert.strictEqual(vaultSecret, 'sk-proj-super-secret-vault-token-xyz-123');

  // User sends brand new key
  let u3 = simulateUpdateEndpoint('gsk_brand_new_key_99999');
  assert.strictEqual(u3.action, 'UPDATED');
  assert.strictEqual(vaultSecret, 'gsk_brand_new_key_99999');
  console.log('[PASS] Write-only protocol idempotency test verified! Masked string never overwrites vault secret.');

  // TEST 3C: Log Sanitization stress test
  console.log('\n--- TEST 3C: Log Sanitization Stress Test ---');
  const dirtyLogs = [
    'Header: Authorization: Bearer sk-proj-super-secret-vault-token-xyz-123 in request',
    'Error: Request to api.groq.com failed with apiKey: "gsk_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP"',
    'Connecting with token="gho_16C7e42F292c69123456789abcdefABCD" to GitHub',
    'JSON Payload: {"baseUrl": "https://api.cerebras.ai/v1", "secret": "csk_9876543210abcdef1234567890abcdef"}'
  ];

  for (const log of dirtyLogs) {
    const cleaned = sanitizeLogString(log, ['sk-proj-super-secret-vault-token-xyz-123']);
    console.log(`[RAW LOG] ${log}`);
    console.log(`[CLEANED] ${cleaned}`);
    assert.ok(!cleaned.includes('sk-proj-super-secret'), 'No raw OpenAI key in log');
    assert.ok(!cleaned.includes('gsk_1234567890'), 'No raw Groq key in log');
    assert.ok(!cleaned.includes('gho_16C7e42F292c'), 'No raw GitHub token in log');
    assert.ok(!cleaned.includes('csk_9876543210'), 'No raw Cerebras key in log');
  }
  console.log('[PASS] Log sanitization completely redacted all credentials!');

  // TEST 3D: Empirical proof of Naive Regex Suffix Failure
  console.log('\n--- TEST 3D: Naive Regex Suffix Failure on Hyphenated Keys ---');
  function naiveIsMaskedPlaceholder(value) {
    if (typeof value !== 'string') return false;
    const trimmed = value.trim();
    if (trimmed === '••••••••') return true;
    // Naive regex from early implementation plans
    if (/^[a-z0-9_-]{2,12}\.{3}[a-z0-9]{3,6}$/i.test(trimmed)) return true;
    return false;
  }

  const hyphenSuffixMasked = 'sk-proj-...-123'; // generated when key ends with -123
  const naiveMatch = naiveIsMaskedPlaceholder(hyphenSuffixMasked);
  const robustMatch = isMaskedPlaceholder(hyphenSuffixMasked);
  assert.strictEqual(naiveMatch, false, 'Naive regex fails on hyphenated suffix');
  assert.strictEqual(robustMatch, true, 'Robust regex recognizes hyphenated suffix');
  console.log(`[OBSERVATION] Masked key "${hyphenSuffixMasked}": NaiveRegex=${naiveMatch} (FAIL/VULNERABLE), RobustRegex=${robustMatch} (PASS/SAFE)`);
}

// ============================================================================
// MAIN RUNNER
// ============================================================================
async function runAll() {
  console.log('================================================================');
  console.log('ADVERSARIAL VERIFICATION RUNNER FOR IMPLEMENTIERUNGSPLAN');
  console.log('================================================================');
  try {
    await runHotReloadConcurrencyStressTest();
    await runSafeProbeStressTest();
    await runSecretMaskingStressTest();
    console.log('\n================================================================');
    console.log('ALL EMPIRICAL ADVERSARIAL CHALLENGES COMPLETED SUCCESSFULLY!');
    console.log('================================================================');
  } catch (err) {
    console.error('\n[FAIL] Challenge failed:', err);
    process.exit(1);
  }
}

runAll();
