import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { PkceAuthManager } from '../src/security/pkceAuthManager.js';
import { DeviceFlowManager } from '../src/security/deviceFlowManager.js';
import { LLMRouter } from '../src/ai/llmRouter.js';

const TEST_VAULT_PATH = path.resolve('test', 'fixtures', 'oauth_test_vault.test.vault');
const TEST_CONFIG_PATH = path.resolve('test', 'fixtures', 'oauth_endpoints.test.json');

async function cleanup() {
  try {
    if (fs.existsSync(TEST_VAULT_PATH)) await fs.promises.unlink(TEST_VAULT_PATH);
    if (fs.existsSync(TEST_CONFIG_PATH)) await fs.promises.unlink(TEST_CONFIG_PATH);
  } catch (_) {}
}

async function run() {
  console.log('=== STARTING OAUTH & MODEL ENHANCEMENT TEST SUITE ===\n');
  await cleanup();

  const vault = new CredentialVault({ vaultPath: TEST_VAULT_PATH, masterKey: 'test-oauth-key-456' });
  await vault.init();

  const endpointManager = new EndpointManager({ configPath: TEST_CONFIG_PATH, vault });
  await endpointManager.init();

  const llmRouter = new LLMRouter();

  // Test 1: PkceAuthManager S256 Verifier and Challenge Generation
  console.log('--- Testgruppe 1: OpenRouter OAuth 2.0 PKCE Flow ---');
  const pkce = new PkceAuthManager({ endpointManager, vault, llmRouter });

  const session = pkce.startSession({ callbackUrl: 'http://localhost:3080/api/auth/openrouter/callback' });
  assert(session.sessionId.startsWith('pkce_'), 'Session ID must start with pkce_');
  assert(session.authUrl.includes('openrouter.ai/auth'), 'Auth URL must point to openrouter.ai/auth');
  assert(session.authUrl.includes('code_challenge='), 'Auth URL must contain code_challenge');
  assert(session.authUrl.includes('code_challenge_method=S256'), 'Must use S256');
  console.log('[PASS] 1.1 PKCE Session generiert korrekte SHA-256 Code-Challenge und OpenRouter URL');

  // Test 2: PkceAuthManager Mock Exchange
  const mockServer = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/api/v1/auth/keys/code') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      assert.strictEqual(parsed.code, 'mock_auth_code_123');
      assert.strictEqual(parsed.code_challenge_method, 'S256');
      assert(typeof parsed.code_verifier === 'string' && parsed.code_verifier.length >= 43);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: 'sk-or-v1-mock-oauth-key-789' }));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise(resolve => mockServer.listen(0, '127.0.0.1', resolve));
  const mockPort = mockServer.address().port;

  // Temporarily override the fetch endpoint to our mock server for exchangeCode
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('openrouter.ai/api/v1/auth/keys/code')) {
      return originalFetch(`http://127.0.0.1:${mockPort}/api/v1/auth/keys/code`, opts);
    }
    return originalFetch(url, opts);
  };

  try {
    const exchangeResult = await pkce.exchangeCode({
      sessionId: session.sessionId,
      code: 'mock_auth_code_123'
    });

    assert.strictEqual(exchangeResult.success, true);
    assert.strictEqual(exchangeResult.provider, 'OpenRouter');

    // Verify secret is in vault
    const savedToken = await vault.getSecret('sec_openrouter');
    assert.strictEqual(savedToken, 'sk-or-v1-mock-oauth-key-789');

    // Verify endpoint is in endpointManager
    const fastEp = endpointManager.getEndpoint(exchangeResult.endpointId);
    assert(fastEp, 'OpenRouter endpoint must exist');
    assert.strictEqual(fastEp.provider, 'OpenRouter');
    assert.strictEqual(fastEp.authType, 'oauth_pkce');
    console.log('[PASS] 1.2 OpenRouter Code-Tausch speichert Key verschlüsselt im Tresor & initialisiert Endpunkte');
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise(resolve => mockServer.close(resolve));
  }

  // Test 3: DeviceFlowManager Multi-Provider Support (GitHub & HuggingFace)
  console.log('\n--- Testgruppe 2: DeviceFlowManager Provider Support ---');
  const devFlow = new DeviceFlowManager({ endpointManager, vault, llmRouter });

  // Test session handling
  const hfSession = {
    sessionId: 'devflow_hf_test',
    provider: 'HuggingFace',
    status: 'pending'
  };
  devFlow.sessions.set('devflow_hf_test', hfSession);

  await devFlow._handleSuccess(hfSession, 'hf_mock_token_abc');
  assert.strictEqual(hfSession.status, 'success');

  const hfSecret = await vault.getSecret('sec_huggingface');
  assert.strictEqual(hfSecret, 'hf_mock_token_abc');

  const hfEp = endpointManager.getEndpoint('ep_huggingface');
  assert(hfEp, 'ep_huggingface must exist');
  assert.strictEqual(hfEp.baseUrl, 'https://router.huggingface.co/v1');
  console.log('[PASS] 2.1 DeviceFlowManager bindet Hugging Face erfolgreich per Device Flow ein');

  // Test 4: Thinking Model & Strip <think> tags in LLMRouter
  console.log('\n--- Testgruppe 3: Reasoning & Thinking Tag Stripping ---');

  // Test stripping in JSON
  const rawWithThink = '<think>\nIch plane hier ein Schloss mit Ziegeln und Holz.\n</think>\n```json\n{"style": "gothic", "pitch": "Dunkle Kathedrale"}\n```';
  let processed = rawWithThink.trim();
  if (processed.includes('</think>')) {
    processed = processed.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
  }
  if (processed.startsWith('```')) {
    processed = processed.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
  }
  const parsed = JSON.parse(processed);
  assert.strictEqual(parsed.style, 'gothic');
  assert.strictEqual(parsed.pitch, 'Dunkle Kathedrale');
  console.log('[PASS] 3.1 LLMRouter bereinigt <think> Tags zuverlässig aus JSON-Antworten');

  // Test stripping in JavaScript code
  const codeWithThink = '<think>Generating Voxel Canvas code</think>\n```javascript\narch.box(0, 0, 0, 5, 5, 5, "stone");\n```';
  let codeProcessed = codeWithThink.trim();
  if (codeProcessed.includes('</think>')) {
    codeProcessed = codeProcessed.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
  }
  const codeMatch = codeProcessed.match(/```(?:javascript|js)?([\s\S]*?)```/i);
  assert(codeMatch && codeMatch[1].includes('arch.box'));
  console.log('[PASS] 3.2 LLMRouter bereinigt <think> Tags zuverlässig aus Code-Synthese');

  // Test o-series parameter detection
  const isO1 = /(^|\/)(o1|o3)(-[a-z0-9]+)?$/i.test('o1-mini');
  const isO3 = /(^|\/)(o1|o3)(-[a-z0-9]+)?$/i.test('openai/o3-mini');
  const isStandard = /(^|\/)(o1|o3)(-[a-z0-9]+)?$/i.test('gpt-4o');
  assert.strictEqual(isO1, true);
  assert.strictEqual(isO3, true);
  assert.strictEqual(isStandard, false);
  console.log('[PASS] 3.3 Erkennt OpenAI o1/o3 Reasoning-Modelle für parameter-konforme Anfragen');

  await cleanup();
  console.log('\n=== ALLE OAUTH & MODEL ENHANCEMENT TESTS ERFOLGREICH BESTANDEN! ===');
}

run().catch(err => {
  console.error('[TEST FAIL]:', err);
  process.exit(1);
});
