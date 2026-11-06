import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager, maskSecret, isMaskedPlaceholder } from '../src/ai/endpointManager.js';

const FIXTURES_DIR = path.resolve('test', 'fixtures');
const STRESS_VAULT_PATH = path.join(FIXTURES_DIR, 'stress_vault.vault');
const STRESS_EP_PATH = path.join(FIXTURES_DIR, 'stress_endpoints.json');

async function cleanupFixtures() {
  try {
    if (fs.existsSync(FIXTURES_DIR)) {
      const files = await fs.promises.readdir(FIXTURES_DIR);
      for (const f of files) {
        if (f.startsWith('stress_')) {
          try {
            await fs.promises.unlink(path.join(FIXTURES_DIR, f));
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

const results = {
  tamper: { total: 0, passed: 0, failed: 0, falseAccepts: 0 },
  concurrencyVaultReads: { total: 0, passed: 0, failed: 0 },
  concurrencyVaultWrites: { total: 0, passed: 0, failed: 0, epermCount: 0, secretsSurvived: 0 },
  concurrencyVaultMixed: { total: 0, passed: 0, failed: 0, epermCount: 0, secretsSurvived: 0 },
  concurrencyEndpoints: { total: 0, passed: 0, failed: 0, epermCount: 0, diskMatchesMemory: false },
  masking: { total: 0, preserved: 0, overwritten: 0, cases: [] }
};

// =============================================================================
// SUITE 1: Cryptographic Bit/Byte Tampering & AEAD GCM Integrity
// =============================================================================
async function runTamperingSuite() {
  console.log('\n============================================================');
  console.log('SUITE 1: Cryptographic Integrity & Tampering Attacks (AEAD)');
  console.log('============================================================');

  const vault = new CredentialVault({ masterKey: 'master-key-stress-harness-2026' });
  const originalPayload = {
    secrets: {
      ep_cerebras_1: { token: 'csk_live_token_1234567890abcdef', provider: 'Cerebras' },
      ep_openai_1: { token: 'sk-proj-supersecretkey999999999999', provider: 'OpenAI' }
    }
  };

  const envelope = vault.encrypt(originalPayload);

  // 1.1 Ciphertext Tampering (100 trials with randomized byte mutations)
  console.log('[1.1] Testing 100 random byte mutations in ciphertext...');
  for (let i = 0; i < 100; i++) {
    results.tamper.total++;
    const buf = Buffer.from(envelope.ciphertext, 'hex');
    const targetIdx = Math.floor(Math.random() * buf.length);
    const flipByte = 1 + Math.floor(Math.random() * 255);
    buf[targetIdx] ^= flipByte;

    const tampered = { ...envelope, ciphertext: buf.toString('hex') };
    try {
      vault.decrypt(tampered);
      results.tamper.falseAccepts++;
      results.tamper.failed++;
      console.error(`[CRITICAL SECURITY FAIL] Tampered ciphertext was accepted at byte offset ${targetIdx}`);
    } catch (err) {
      assert(err.message.includes('Vault integrity check failed'));
      results.tamper.passed++;
    }
  }

  // 1.2 AuthTag Tampering (100 trials with randomized byte mutations)
  console.log('[1.2] Testing 100 random byte mutations in authTag...');
  for (let i = 0; i < 100; i++) {
    results.tamper.total++;
    const buf = Buffer.from(envelope.tag, 'hex');
    const targetIdx = Math.floor(Math.random() * buf.length);
    const flipByte = 1 + Math.floor(Math.random() * 255);
    buf[targetIdx] ^= flipByte;

    const tampered = { ...envelope, tag: buf.toString('hex') };
    try {
      vault.decrypt(tampered);
      results.tamper.falseAccepts++;
      results.tamper.failed++;
      console.error(`[CRITICAL SECURITY FAIL] Tampered authTag was accepted at byte offset ${targetIdx}`);
    } catch (err) {
      assert(err.message.includes('Vault integrity check failed'));
      results.tamper.passed++;
    }
  }

  // 1.3 IV Tampering (100 trials with randomized byte mutations)
  console.log('[1.3] Testing 100 random byte mutations in IV (Nonce)...');
  for (let i = 0; i < 100; i++) {
    results.tamper.total++;
    const buf = Buffer.from(envelope.iv, 'hex');
    const targetIdx = Math.floor(Math.random() * buf.length);
    const flipByte = 1 + Math.floor(Math.random() * 255);
    buf[targetIdx] ^= flipByte;

    const tampered = { ...envelope, iv: buf.toString('hex') };
    try {
      vault.decrypt(tampered);
      results.tamper.falseAccepts++;
      results.tamper.failed++;
      console.error(`[CRITICAL SECURITY FAIL] Tampered IV was accepted at byte offset ${targetIdx}`);
    } catch (err) {
      assert(err.message.includes('Vault integrity check failed'));
      results.tamper.passed++;
    }
  }

  // 1.4 Salt Tampering (50 trials with randomized byte mutations)
  console.log('[1.4] Testing 50 random byte mutations in Scrypt Salt...');
  for (let i = 0; i < 50; i++) {
    results.tamper.total++;
    const buf = Buffer.from(envelope.salt, 'hex');
    const targetIdx = Math.floor(Math.random() * buf.length);
    const flipByte = 1 + Math.floor(Math.random() * 255);
    buf[targetIdx] ^= flipByte;

    const tampered = { ...envelope, salt: buf.toString('hex') };
    try {
      vault.decrypt(tampered);
      results.tamper.falseAccepts++;
      results.tamper.failed++;
      console.error(`[CRITICAL SECURITY FAIL] Tampered Salt was accepted at byte offset ${targetIdx}`);
    } catch (err) {
      assert(err.message.includes('Vault integrity check failed'));
      results.tamper.passed++;
    }
  }

  // 1.5 Structural & Buffer Boundary Violations (Truncation, Extensions, Corrupted Hex)
  console.log('[1.5] Testing structural boundary tampering and malformed envelopes...');
  const structuralTests = [
    { desc: 'Truncated IV (10 bytes instead of 12)', env: { ...envelope, iv: envelope.iv.slice(0, 20) } },
    { desc: 'Extended IV (14 bytes instead of 12)', env: { ...envelope, iv: envelope.iv + 'abcd' } },
    { desc: 'Truncated Tag (14 bytes instead of 16)', env: { ...envelope, tag: envelope.tag.slice(0, 28) } },
    { desc: 'Extended Tag (18 bytes instead of 16)', env: { ...envelope, tag: envelope.tag + '1234' } },
    { desc: 'Truncated Salt (28 bytes instead of 32)', env: { ...envelope, salt: envelope.salt.slice(0, 56) } },
    { desc: 'Extended Salt (36 bytes instead of 32)', env: { ...envelope, salt: envelope.salt + 'deadbeef' } },
    { desc: 'Invalid non-hex chars in ciphertext', env: { ...envelope, ciphertext: 'zz' + envelope.ciphertext.slice(2) } },
    { desc: 'Empty ciphertext with non-matching tag', env: { ...envelope, ciphertext: '' } },
    { desc: 'Altered cipher name (aes-256-cbc)', env: { ...envelope, cipher: 'aes-256-cbc' } },
    { desc: 'Unsupported version (version: 2)', env: { ...envelope, version: 2 } },
    { desc: 'Missing tag property', env: { version: 1, cipher: 'aes-256-gcm', salt: envelope.salt, iv: envelope.iv, ciphertext: envelope.ciphertext } },
    { desc: 'Completely null envelope', env: null }
  ];

  for (const st of structuralTests) {
    results.tamper.total++;
    try {
      vault.decrypt(st.env);
      results.tamper.falseAccepts++;
      results.tamper.failed++;
      console.error(`[CRITICAL SECURITY FAIL] Structural violation accepted: ${st.desc}`);
    } catch (err) {
      assert(err.message.includes('Vault integrity check failed'));
      results.tamper.passed++;
    }
  }

  console.log(`-> Suite 1 Tamper Results: ${results.tamper.passed}/${results.tamper.total} passed. False accepts: ${results.tamper.falseAccepts}`);
}

// =============================================================================
// SUITE 2: High Concurrency Stress Testing & Race Conditions (100 Ops)
// =============================================================================
async function runConcurrencySuite() {
  console.log('\n============================================================');
  console.log('SUITE 2: 100 Concurrent Async Operations & Race Conditions');
  console.log('============================================================');

  // 2.1 100 Concurrent Async Reads
  console.log('[2.1] Testing 100 concurrent async read operations (getSecret)...');
  await cleanupFixtures();
  const readVault = new CredentialVault({ vaultPath: STRESS_VAULT_PATH });
  await readVault.init();
  await readVault.storeSecret('seed_token', 'seed_value_initial_token_999');

  const readPromises = [];
  for (let i = 0; i < 100; i++) {
    readPromises.push(readVault.getSecret('seed_token'));
  }
  const readResults = await Promise.all(readPromises);
  results.concurrencyVaultReads.total = 100;
  results.concurrencyVaultReads.passed = readResults.filter(r => r === 'seed_value_initial_token_999').length;
  results.concurrencyVaultReads.failed = 100 - results.concurrencyVaultReads.passed;
  console.log(`-> 100 Concurrent Reads: ${results.concurrencyVaultReads.passed}/100 succeeded.`);

  // 2.2 100 Concurrent Async Writes
  console.log('[2.2] Testing 100 concurrent async write operations (storeSecret)...');
  await cleanupFixtures();
  const writeVault = new CredentialVault({ vaultPath: STRESS_VAULT_PATH });
  await writeVault.init();

  const writePromises = [];
  for (let i = 0; i < 100; i++) {
    writePromises.push(
      writeVault.storeSecret(`sec_key_${i}`, `token_value_${i}`)
        .then(() => ({ success: true }))
        .catch(err => ({ success: false, error: err }))
    );
  }
  const writeResults = await Promise.all(writePromises);
  results.concurrencyVaultWrites.total = 100;
  results.concurrencyVaultWrites.passed = writeResults.filter(r => r.success).length;
  results.concurrencyVaultWrites.failed = writeResults.filter(r => !r.success).length;
  results.concurrencyVaultWrites.epermCount = writeResults.filter(r => r.error && r.error.code === 'EPERM').length;

  // Inspect on-disk persistence
  try {
    const persisted = await writeVault.load();
    results.concurrencyVaultWrites.secretsSurvived = Object.keys(persisted.secrets || {}).length;
  } catch (_) {
    results.concurrencyVaultWrites.secretsSurvived = 0;
  }
  console.log(`-> 100 Concurrent Writes: ${results.concurrencyVaultWrites.passed} succeeded, ${results.concurrencyVaultWrites.failed} failed.`);
  console.log(`   EPERM rename collisions: ${results.concurrencyVaultWrites.epermCount}`);
  console.log(`   Secrets surviving in vault file: ${results.concurrencyVaultWrites.secretsSurvived} / 100`);

  // 2.3 100 Mixed Operations (50 reads + 50 writes concurrently)
  console.log('[2.3] Testing 100 mixed concurrent operations (50 reads + 50 writes)...');
  await cleanupFixtures();
  const mixedVault = new CredentialVault({ vaultPath: STRESS_VAULT_PATH });
  await mixedVault.init();
  await mixedVault.storeSecret('seed_key', 'seed_value');

  const mixedPromises = [];
  for (let i = 0; i < 50; i++) {
    mixedPromises.push(
      mixedVault.getSecret('seed_key')
        .then(val => ({ type: 'read', success: val === 'seed_value' }))
        .catch(err => ({ type: 'read', success: false, error: err }))
    );
    mixedPromises.push(
      mixedVault.storeSecret(`mixed_key_${i}`, `mixed_val_${i}`)
        .then(() => ({ type: 'write', success: true }))
        .catch(err => ({ type: 'write', success: false, error: err }))
    );
  }
  const mixedResults = await Promise.all(mixedPromises);
  results.concurrencyVaultMixed.total = 100;
  results.concurrencyVaultMixed.passed = mixedResults.filter(r => r.success).length;
  results.concurrencyVaultMixed.failed = mixedResults.filter(r => !r.success).length;
  results.concurrencyVaultMixed.epermCount = mixedResults.filter(r => r.error && r.error.code === 'EPERM').length;

  try {
    const persisted = await mixedVault.load();
    results.concurrencyVaultMixed.secretsSurvived = Object.keys(persisted.secrets || {}).length;
  } catch (_) {
    results.concurrencyVaultMixed.secretsSurvived = 0;
  }
  console.log(`-> 100 Mixed Operations: ${results.concurrencyVaultMixed.passed} succeeded, ${results.concurrencyVaultMixed.failed} failed.`);
  console.log(`   EPERM rename collisions: ${results.concurrencyVaultMixed.epermCount}`);
  console.log(`   Secrets surviving in vault file: ${results.concurrencyVaultMixed.secretsSurvived} / 51 (1 seed + 50 writes)`);

  // 2.4 100 Concurrent Operations on EndpointManager
  console.log('[2.4] Testing 100 concurrent createEndpoint calls on EndpointManager...');
  await cleanupFixtures();
  const epManager = new EndpointManager({
    configPath: STRESS_EP_PATH,
    vault: new CredentialVault({ vaultPath: STRESS_VAULT_PATH }),
    logger: { info: () => {}, error: () => {}, warn: () => {} }
  });
  await epManager.init();

  const epPromises = [];
  for (let i = 0; i < 100; i++) {
    epPromises.push(
      epManager.createEndpoint({ name: `EP_${i}`, modelId: `model_${i}` }, `secret_val_${i}`)
        .then(() => ({ success: true }))
        .catch(err => ({ success: false, error: err }))
    );
  }
  const epResults = await Promise.all(epPromises);
  results.concurrencyEndpoints.total = 100;
  results.concurrencyEndpoints.passed = epResults.filter(r => r.success).length;
  results.concurrencyEndpoints.failed = epResults.filter(r => !r.success).length;
  results.concurrencyEndpoints.epermCount = epResults.filter(r => r.error && r.error.code === 'EPERM').length;

  try {
    const rawDisk = await fs.promises.readFile(STRESS_EP_PATH, 'utf8');
    const diskParsed = JSON.parse(rawDisk);
    const inMemCount = epManager.getAllEndpoints().length;
    const diskCount = diskParsed.endpoints.length;
    results.concurrencyEndpoints.diskMatchesMemory = inMemCount === diskCount;
    console.log(`-> EndpointManager: in-memory endpoints = ${inMemCount}, on-disk endpoints = ${diskCount}`);
  } catch (err) {
    console.log(`-> EndpointManager disk read error: ${err.message}`);
  }
  console.log(`   EPERM rename collisions: ${results.concurrencyEndpoints.epermCount}`);
}

// =============================================================================
// SUITE 3: Adversarial Secret Masking & Protection Invariant
// =============================================================================
async function runMaskingSuite() {
  console.log('\n============================================================');
  console.log('SUITE 3: Adversarial Secret Masking Injection (updateEndpoint)');
  console.log('============================================================');

  await cleanupFixtures();
  const vault = new CredentialVault({ vaultPath: STRESS_VAULT_PATH });
  const manager = new EndpointManager({
    configPath: STRESS_EP_PATH,
    vault,
    logger: { info: () => {}, error: () => {}, warn: () => {} }
  });
  await manager.init();

  const ORIGINAL_SECRET = 'csk_live_genuine_vault_api_key_ABC123456789';
  const ep = await manager.createEndpoint({ name: 'Protection Test EP' }, ORIGINAL_SECRET);
  const ref = ep.credentialRef;

  const testVectors = [
    // Standard masking formats
    { name: 'Standard OpenAI mask', input: 'sk-proj-...-123', expectPreserved: true },
    { name: 'Full 8 bullets mask', input: '••••••••', expectPreserved: true },
    { name: 'Generic short prefix mask', input: 'sk-...abc', expectPreserved: true },
    { name: 'GitHub device token mask', input: 'gho_16...6912', expectPreserved: true },
    { name: 'Codestral mask', input: 'csk_...abcd', expectPreserved: true },
    { name: 'Ellipsis with 4-char suffix', input: '...1234', expectPreserved: true },
    { name: 'Short 4 bullets mask', input: '••••', expectPreserved: true },
    { name: 'Black circle bullets', input: '●●●●●●●●', expectPreserved: true },
    { name: 'Asterisk mask', input: '********', expectPreserved: true },

    // Empty & Whitespace variations
    { name: 'Empty string', input: '', expectPreserved: true },
    { name: 'ASCII spaces', input: '   ', expectPreserved: true },
    { name: 'Tabs', input: '\t\t\t', expectPreserved: true },
    { name: 'CRLF newlines', input: '\r\n\r\n', expectPreserved: true },
    { name: 'Mixed whitespace & tabs', input: '  \t \r\n ', expectPreserved: true },

    // Unicode whitespace & invisible chars
    { name: 'Non-breaking space (U+00A0)', input: '\u00A0', expectPreserved: true },
    { name: 'En space (U+2002)', input: '\u2002', expectPreserved: true },
    { name: 'Em space (U+2003)', input: '\u2003', expectPreserved: true },
    { name: 'Ideographic space (U+3000)', input: '\u3000', expectPreserved: true },
    { name: 'BOM / ZWNBSP (U+FEFF)', input: '\uFEFF', expectPreserved: true },
    { name: 'Zero-width space (U+200B)', input: '\u200B', expectPreserved: true },
    { name: 'Zero-width non-joiner (U+200C)', input: '\u200C', expectPreserved: true },
    { name: 'Zero-width joiner (U+200D)', input: '\u200D', expectPreserved: true },

    // Control characters
    { name: 'NUL byte (U+0000)', input: '\u0000', expectPreserved: true },
    { name: 'SOH byte (U+0001)', input: '\u0001', expectPreserved: true },
    { name: 'ESC byte (U+001B)', input: '\x1b', expectPreserved: true },
    { name: 'BEL byte (U+0007)', input: '\x07', expectPreserved: true },
    { name: 'DEL byte (U+007F)', input: '\x7f', expectPreserved: true },

    // Edge case patterns
    { name: 'Naked ellipsis (...)', input: '...', expectPreserved: true },
    { name: 'Prefix only (sk-...)', input: 'sk-...', expectPreserved: true },
    { name: 'Ellipsis with trailing space', input: '... ', expectPreserved: true },
    { name: 'Prefix with bullets (sk-••••)', input: 'sk-••••', expectPreserved: true }
  ];

  for (const tv of testVectors) {
    results.masking.total++;
    // Re-seed original secret
    await vault.storeSecret(ref, ORIGINAL_SECRET);

    // Call updateEndpoint
    await manager.updateEndpoint(ep.id, { name: `Update_${tv.name}` }, tv.input);
    const vaultVal = await vault.getSecret(ref);
    const isPreserved = (vaultVal === ORIGINAL_SECRET);

    if (isPreserved) {
      results.masking.preserved++;
    } else {
      results.masking.overwritten++;
    }

    const testPassed = tv.expectPreserved ? isPreserved : !isPreserved;
    const outcome = isPreserved ? 'PRESERVED' : `OVERWRITTEN (became: ${JSON.stringify(vaultVal)})`;
    console.log(`[${testPassed ? 'PASS' : 'FAIL'}] ${tv.name.padEnd(35)} -> ${outcome}`);

    results.masking.cases.push({
      name: tv.name,
      input: tv.input,
      expectPreserved: tv.expectPreserved,
      isPreserved,
      testPassed,
      storedVal: vaultVal
    });
  }

  console.log(`-> Suite 3 Masking Results: ${results.masking.preserved}/${results.masking.total} preserved original secret, ${results.masking.overwritten} overwrote.`);
}

// =============================================================================
// MAIN ENTRYPOINT
// =============================================================================
async function main() {
  const startTime = performance.now();
  console.log('############################################################');
  console.log('#   ADVERSARIAL STRESS TEST HARNESS — MILESTONE M5         #');
  console.log('############################################################');

  await runTamperingSuite();
  await runConcurrencySuite();
  await runMaskingSuite();
  await cleanupFixtures();

  const duration = ((performance.now() - startTime) / 1000).toFixed(2);
  console.log('\n============================================================');
  console.log(`FINAL STRESS HARNESS SUMMARY (Completed in ${duration}s)`);
  console.log('============================================================');
  console.log(`Suite 1 (AEAD GCM Tampering): ${results.tamper.passed}/${results.tamper.total} passed. False accepts: ${results.tamper.falseAccepts}`);
  console.log(`Suite 2 (100 Concurrent Reads): ${results.concurrencyVaultReads.passed}/100 passed.`);
  console.log(`Suite 2 (100 Concurrent Writes): ${results.concurrencyVaultWrites.passed} succeeded, ${results.concurrencyVaultWrites.failed} failed (EPERM: ${results.concurrencyVaultWrites.epermCount}, Survived: ${results.concurrencyVaultWrites.secretsSurvived}/100).`);
  console.log(`Suite 2 (100 Mixed Ops): ${results.concurrencyVaultMixed.passed} succeeded, ${results.concurrencyVaultMixed.failed} failed (EPERM: ${results.concurrencyVaultMixed.epermCount}, Survived: ${results.concurrencyVaultMixed.secretsSurvived}/51).`);
  console.log(`Suite 2 (100 Endpoint Ops): ${results.concurrencyEndpoints.passed} succeeded, ${results.concurrencyEndpoints.failed} failed (EPERM: ${results.concurrencyEndpoints.epermCount}).`);
  console.log(`Suite 3 (Adversarial Masking): ${results.masking.preserved}/${results.masking.total} preserved, ${results.masking.overwritten} overwrote secret.`);

  // Assertions enforcing the zero-regression and survival invariants
  assert.strictEqual(results.tamper.failed, 0, 'Suite 1 (Tamper): Detected failures');
  assert.strictEqual(results.tamper.falseAccepts, 0, 'Suite 1 (Tamper): Detected false accepts');
  assert.strictEqual(results.concurrencyVaultReads.passed, 100, 'Suite 2.1 (Concurrent Reads): Failed');
  assert.strictEqual(results.concurrencyVaultWrites.failed, 0, 'Suite 2.2 (Concurrent Writes): Failed operations');
  assert.strictEqual(results.concurrencyVaultWrites.epermCount, 0, 'Suite 2.2 (Concurrent Writes): EPERM collisions');
  assert.strictEqual(results.concurrencyVaultWrites.secretsSurvived, 100, 'Suite 2.2 (Concurrent Writes): Lost secrets');
  assert.strictEqual(results.concurrencyVaultMixed.failed, 0, 'Suite 2.3 (Mixed Ops): Failed operations');
  assert.strictEqual(results.concurrencyVaultMixed.epermCount, 0, 'Suite 2.3 (Mixed Ops): EPERM collisions');
  assert.strictEqual(results.concurrencyVaultMixed.secretsSurvived, 51, 'Suite 2.3 (Mixed Ops): Lost secrets');
  assert.strictEqual(results.concurrencyEndpoints.failed, 0, 'Suite 2.4 (Endpoint Ops): Failed operations');
  assert.strictEqual(results.concurrencyEndpoints.epermCount, 0, 'Suite 2.4 (Endpoint Ops): EPERM collisions');
  assert.strictEqual(results.concurrencyEndpoints.diskMatchesMemory, true, 'Suite 2.4 (Endpoint Ops): Disk/Memory desync');
  assert.strictEqual(results.masking.overwritten, 0, 'Suite 3 (Masking): Overwrote authentic secrets');
  assert.strictEqual(results.masking.preserved, results.masking.total, 'Suite 3 (Masking): Failed to preserve all secrets');

  // Write machine-readable JSON output for report generation
  const reportPath = path.resolve('test', 'fixtures', 'stress_results.json');
  await fs.promises.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.promises.writeFile(reportPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Results written to ${reportPath}`);
}

main().catch(err => {
  console.error('Stress harness failed unexpectedly:', err);
  process.exit(1);
});
