import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CredentialVault, getSystemMasterKey } from '../src/security/credentialVault.js';

const TEST_VAULT_PATH = path.resolve('test', 'fixtures', 'credentials.test.vault');

async function cleanupTestFixtures() {
  try {
    if (fs.existsSync(TEST_VAULT_PATH)) {
      await fs.promises.unlink(TEST_VAULT_PATH);
    }
    const dir = path.dirname(TEST_VAULT_PATH);
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir);
      if (files.length === 0) {
        await fs.promises.rmdir(dir);
      }
    }
  } catch (_) {
    // Ignore cleanup errors
  }
}

async function runTests() {
  console.log('=== STARTING CREDENTIAL VAULT TEST SUITE ===\n');
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
    const vault = new CredentialVault({
      vaultPath: TEST_VAULT_PATH,
      masterKey: 'test-master-key-xyz-12345'
    });

    // =========================================================================
    // Testgruppe 1: Scrypt KDF Schlüsselableitung
    // =========================================================================
    console.log('--- Testgruppe 1: Scrypt KDF Schlüsselableitung ---');

    test('1.1 deriveKey liefert einen Buffer mit exakt 32 Bytes (256 Bits)', () => {
      const salt = crypto.randomBytes(32);
      const key = vault.deriveKey(salt, 'master123');
      assert(Buffer.isBuffer(key), 'Key must be a Buffer');
      assert.strictEqual(key.length, 32, 'Key length must be 32 bytes');
    });

    test('1.2 Determinismus: Zweifacher Aufruf mit identischem Salt und Key liefert identische Bytes', () => {
      const salt = crypto.randomBytes(32);
      const key1 = vault.deriveKey(salt, 'same-passphrase');
      const key2 = vault.deriveKey(salt, 'same-passphrase');
      assert.deepStrictEqual(key1, key2, 'Derived keys must be strictly identical');
    });

    test('1.3 Entropie: Unterschiedliche Salts bei gleichem Key liefern unterschiedliche Bytes', () => {
      const salt1 = crypto.randomBytes(32);
      const salt2 = crypto.randomBytes(32);
      const key1 = vault.deriveKey(salt1, 'same-passphrase');
      const key2 = vault.deriveKey(salt2, 'same-passphrase');
      assert.notDeepStrictEqual(key1, key2, 'Keys from different salts must differ');
    });

    test('1.4 Passphrase-Sensitivität: Unterschiedliche Passphrasen bei gleichem Salt liefern unterschiedliche Bytes', () => {
      const salt = crypto.randomBytes(32);
      const key1 = vault.deriveKey(salt, 'passphrase-A');
      const key2 = vault.deriveKey(salt, 'passphrase-B');
      assert.notDeepStrictEqual(key1, key2, 'Keys from different passphrases must differ');
    });

    test('1.5 getSystemMasterKey liefert nicht-leeren String', () => {
      const sysKey = getSystemMasterKey();
      assert(typeof sysKey === 'string' && sysKey.length > 0, 'System master key must be a non-empty string');
    });

    // =========================================================================
    // Testgruppe 2: AES-256-GCM Verschlüsselung & Entschlüsselung (Roundtrip)
    // =========================================================================
    console.log('\n--- Testgruppe 2: AES-256-GCM Verschlüsselung & Entschlüsselung ---');

    test('2.1 Verschlüsseln erzeugt gültiges EncryptedVaultFile Schema', () => {
      const original = {
        updatedAt: '2026-11-04T20:00:00.000Z',
        secrets: { ep1: { type: 'api_key', provider: 'Cerebras', token: 'csk-test12345', expiresAt: null } }
      };
      const envelope = vault.encrypt(original);
      assert.strictEqual(envelope.version, 1);
      assert.strictEqual(envelope.kdf, 'scrypt');
      assert.strictEqual(envelope.cipher, 'aes-256-gcm');
      assert.strictEqual(typeof envelope.salt, 'string');
      assert.strictEqual(envelope.salt.length, 64); // 32 bytes in hex
      assert.strictEqual(typeof envelope.iv, 'string');
      assert.strictEqual(envelope.iv.length, 24); // 12 bytes in hex
      assert.strictEqual(typeof envelope.tag, 'string');
      assert.strictEqual(envelope.tag.length, 32); // 16 bytes in hex
      assert.strictEqual(typeof envelope.ciphertext, 'string');
      assert(envelope.ciphertext.length > 0);
    });

    test('2.2 IV-Randomisierung: Zweimaliges Verschlüsseln erzeugt unterschiedliche IVs und Ciphertexte', () => {
      const payload = { test: 'consistent-data' };
      const env1 = vault.encrypt(payload);
      const env2 = vault.encrypt(payload);
      assert.notStrictEqual(env1.iv, env2.iv, 'IVs must be randomly generated');
      assert.notStrictEqual(env1.ciphertext, env2.ciphertext, 'Ciphertexts must differ due to distinct IV');
    });

    test('2.3 Verlustfreier Roundtrip: Entschlüsseln liefert identische Original-Struktur', () => {
      const original = {
        updatedAt: '2026-11-04T20:15:30.123Z',
        secrets: {
          ep_cerebras_1: { type: 'api_key', provider: 'Cerebras', token: 'csk_actual123', expiresAt: null },
          ep_github_1: { type: 'oauth_device_flow', provider: 'GitHub', token: 'gho_oauthToken456', expiresAt: '2027-01-01T00:00:00.000Z' }
        }
      };
      const envelope = vault.encrypt(original);
      const decrypted = vault.decrypt(envelope);
      assert.deepStrictEqual(decrypted, original);
    });

    // =========================================================================
    // Testgruppe 3: Ciphertext-Tampering & GCM Auth-Tag Schutz
    // =========================================================================
    console.log('\n--- Testgruppe 3: Ciphertext-Tampering & GCM Auth-Tag Integritätsschutz ---');

    test('3.1 Modifikation eines einzelnen Bytes im Ciphertext wirft Integritätsfehler', () => {
      const envelope = vault.encrypt({ secret: 'my-sensitive-token' });
      const tamperedCiphertext = envelope.ciphertext.slice(0, 2) === 'aa'
        ? 'bb' + envelope.ciphertext.slice(2)
        : 'aa' + envelope.ciphertext.slice(2);
      const tamperedEnv = { ...envelope, ciphertext: tamperedCiphertext };

      assert.throws(() => {
        vault.decrypt(tamperedEnv);
      }, /Vault integrity check failed/i);
    });

    test('3.2 Bit-Flip im Auth-Tag wirft Integritätsfehler', () => {
      const envelope = vault.encrypt({ secret: 'my-sensitive-token' });
      // Flip last character in hex
      const lastChar = envelope.tag.slice(-1);
      const flippedChar = lastChar === '0' ? '1' : '0';
      const tamperedTag = envelope.tag.slice(0, -1) + flippedChar;
      const tamperedEnv = { ...envelope, tag: tamperedTag };

      assert.throws(() => {
        vault.decrypt(tamperedEnv);
      }, /Vault integrity check failed/i);
    });

    test('3.3 Modifikation des IV wirft Integritätsfehler', () => {
      const envelope = vault.encrypt({ secret: 'my-sensitive-token' });
      const tamperedIv = envelope.iv.slice(0, 2) === '00' ? '11' + envelope.iv.slice(2) : '00' + envelope.iv.slice(2);
      const tamperedEnv = { ...envelope, iv: tamperedIv };

      assert.throws(() => {
        vault.decrypt(tamperedEnv);
      }, /Vault integrity check failed/i);
    });

    test('3.4 Modifikation des Salts wirft Integritätsfehler', () => {
      const envelope = vault.encrypt({ secret: 'my-sensitive-token' });
      const tamperedSalt = envelope.salt.slice(0, 2) === 'ff' ? 'ee' + envelope.salt.slice(2) : 'ff' + envelope.salt.slice(2);
      const tamperedEnv = { ...envelope, salt: tamperedSalt };

      assert.throws(() => {
        vault.decrypt(tamperedEnv);
      }, /Vault integrity check failed/i);
    });

    test('3.5 Entschlüsselung mit falschem Master-Key schlägt fehl', () => {
      const envelope = vault.encrypt({ secret: 'protected-data' });
      assert.throws(() => {
        vault.decrypt(envelope, 'wrong-passphrase-totally-incorrect');
      }, /Vault integrity check failed/i);
    });

    // =========================================================================
    // Testgruppe 4: Leere Secrets, Sonderzeichen & Randfälle
    // =========================================================================
    console.log('\n--- Testgruppe 4: Leere Secrets, Sonderzeichen & Multibyte UTF-8 ---');

    test('4.1 Leeres Secret "" wird verlustfrei verschlüsselt und wiederhergestellt', () => {
      const envelope = vault.encrypt('');
      const decrypted = vault.decrypt(envelope);
      assert.strictEqual(decrypted, '');
    });

    test('4.2 Whitespace-Secret wird exakt ohne Trimming im Krypto-Layer erhalten', () => {
      const ws = '   \t  \n  spaces-preserved  \r\n ';
      const envelope = vault.encrypt(ws);
      const decrypted = vault.decrypt(envelope);
      assert.strictEqual(decrypted, ws);
    });

    test('4.3 Unicode, Sonderzeichen und Emojis werden verlustfrei erhalten', () => {
      const utf8Text = '🤖_Gültiger_Schlüssel_äöüß_€_🏰_汉字_العربية_🚀_💎';
      const envelope = vault.encrypt(utf8Text);
      const decrypted = vault.decrypt(envelope);
      assert.strictEqual(decrypted, utf8Text);
    });

    test('4.4 Steuerzeichen, Backslashes, Anführungszeichen und Base64-Padding', () => {
      const complexText = 'Line1\nLine2\r\nLine3\t"quoted"\\backslash\\\'single\'===Padding==+';
      const envelope = vault.encrypt(complexText);
      const decrypted = vault.decrypt(envelope);
      assert.strictEqual(decrypted, complexText);
    });

    test('4.5 Großes Secret mit 10.000 Zeichen wird korrekt verarbeitet', () => {
      const largeSecret = 'A'.repeat(10000);
      const envelope = vault.encrypt(largeSecret);
      const decrypted = vault.decrypt(envelope);
      assert.strictEqual(decrypted, largeSecret);
      assert.strictEqual(decrypted.length, 10000);
    });

    // =========================================================================
    // Testgruppe 5: Vault Store/Get/Delete/Has Lifecycle
    // =========================================================================
    console.log('\n--- Testgruppe 5: Secret Lifecycle (Store / Get / Has / Delete) ---');

    await asyncTest('5.1 storeSecret speichert Secret als String oder Objekt', async () => {
      await vault.init();
      const id1 = await vault.storeSecret('ref_simple', 'raw-api-key-123');
      assert.strictEqual(id1, 'ref_simple');

      const id2 = await vault.storeSecret('ref_structured', {
        type: 'api_key',
        provider: 'Mistral',
        token: 'mistral-token-456',
        expiresAt: null
      });
      assert.strictEqual(id2, 'ref_structured');
    });

    await asyncTest('5.2 hasSecret prüft Existenz und Nicht-Leerheit', async () => {
      assert.strictEqual(await vault.hasSecret('ref_simple'), true);
      assert.strictEqual(await vault.hasSecret('ref_structured'), true);
      assert.strictEqual(await vault.hasSecret('non_existent_key'), false);
    });

    await asyncTest('5.3 getSecret ruft Klartext-Token ab', async () => {
      const secret1 = await vault.getSecret('ref_simple');
      assert.strictEqual(secret1, 'raw-api-key-123');

      const secret2 = await vault.getSecret('ref_structured');
      assert.strictEqual(secret2, 'mistral-token-456');

      const secretMissing = await vault.getSecret('non_existent_key');
      assert.strictEqual(secretMissing, null);
    });

    await asyncTest('5.4 getSecretMetadata ruft vollständiges Metadaten-Objekt ab', async () => {
      const meta = await vault.getSecretMetadata('ref_structured');
      assert(meta !== null);
      assert.strictEqual(meta.token, 'mistral-token-456');
      assert.strictEqual(meta.provider, 'Mistral');
      assert.strictEqual(meta.type, 'api_key');
    });

    await asyncTest('5.5 listSecretIds liefert Liste aller gespeicherten IDs', async () => {
      const ids = await vault.listSecretIds();
      assert(Array.isArray(ids));
      assert(ids.includes('ref_simple'));
      assert(ids.includes('ref_structured'));
    });

    await asyncTest('5.6 deleteSecret löscht vorhandenes Secret und liefert true', async () => {
      const deleted = await vault.deleteSecret('ref_simple');
      assert.strictEqual(deleted, true);
      assert.strictEqual(await vault.hasSecret('ref_simple'), false);
      assert.strictEqual(await vault.getSecret('ref_simple'), null);
    });

    await asyncTest('5.7 deleteSecret auf nicht-existente ID liefert false', async () => {
      const deleted = await vault.deleteSecret('non_existent_key');
      assert.strictEqual(deleted, false);
    });

    // =========================================================================
    // Testgruppe 6: Dateisystem-Persistenz & Auto-Recovery
    // =========================================================================
    console.log('\n--- Testgruppe 6: Dateisystem-Persistenz & Auto-Recovery ---');

    await asyncTest('6.1 save erzeugt Datei physisch auf der Festplatte', async () => {
      assert(fs.existsSync(TEST_VAULT_PATH), 'Vault file must exist on disk');
      const content = await fs.promises.readFile(TEST_VAULT_PATH, 'utf8');
      const parsed = JSON.parse(content);
      assert.strictEqual(parsed.cipher, 'aes-256-gcm');
      assert.strictEqual(parsed.version, 1);
    });

    await asyncTest('6.2 Neue Vault-Instanz mit gleichem Key liest gespeicherte Daten fehlerfrei', async () => {
      const freshVault = new CredentialVault({
        vaultPath: TEST_VAULT_PATH,
        masterKey: 'test-master-key-xyz-12345'
      });
      await freshVault.init();
      assert.strictEqual(await freshVault.hasSecret('ref_structured'), true);
      const secret = await freshVault.getSecret('ref_structured');
      assert.strictEqual(secret, 'mistral-token-456');
    });

    await asyncTest('6.3 Fehlende Datei führt zu sauberem Default-Tresor ohne Fehler (Auto-Recovery)', async () => {
      const nonExistentPath = path.resolve('test', 'fixtures', 'does-not-exist.vault');
      const freshVault = new CredentialVault({
        vaultPath: nonExistentPath,
        masterKey: 'recovery-key'
      });
      const data = await freshVault.load();
      assert.deepStrictEqual(data.secrets, {});
      assert(typeof data.updatedAt === 'string');
    });

    // =========================================================================
    // Testgruppe 7: Concurrency & Mutex Verification
    // =========================================================================
    console.log('\n--- Testgruppe 7: Concurrency & Mutex Verification ---');

    await asyncTest('7.1 100 concurrent storeSecret calls succeed with 100% persistence', async () => {
      const cVault = new CredentialVault({
        vaultPath: path.resolve('test', 'fixtures', 'vault_concurrent.vault')
      });
      await cVault.init();

      const writePromises = [];
      for (let i = 0; i < 100; i++) {
        writePromises.push(cVault.storeSecret(`concurrent_key_${i}`, `val_${i}`));
      }
      const results = await Promise.all(writePromises);
      assert.strictEqual(results.length, 100);

      // Verify on-disk persistence
      const onDisk = await cVault.load();
      const keys = Object.keys(onDisk.secrets || {});
      assert.strictEqual(keys.length, 100, `Expected 100 secrets on disk, got ${keys.length}`);
      for (let i = 0; i < 100; i++) {
        assert.strictEqual(onDisk.secrets[`concurrent_key_${i}`].token, `val_${i}`);
      }
    });

    await asyncTest('7.2 Queue does not stall when an operation rejects', async () => {
      const cVault = new CredentialVault({
        vaultPath: path.resolve('test', 'fixtures', 'vault_error_queue.vault')
      });
      await cVault.init();

      let failedError = null;
      const p1 = cVault.storeSecret('valid_1', 'token_1');
      const p2 = cVault.storeSecret('', 'invalid_key').catch(err => { failedError = err; });
      const p3 = cVault.storeSecret('valid_2', 'token_2');

      await Promise.all([p1, p2, p3]);
      assert(failedError instanceof TypeError, 'p2 should reject with TypeError');
      assert.strictEqual(await cVault.getSecret('valid_1'), 'token_1');
      assert.strictEqual(await cVault.getSecret('valid_2'), 'token_2');
    });

    console.log(`\n=== CREDENTIAL VAULT TEST SUITE ERFOLGREICH: ${passed}/${total} TESTS BESTANDEN ===\n`);
  } finally {
    await cleanupTestFixtures();
  }
}

runTests().catch(err => {
  console.error('\n[FATAL] CredentialVault Test Suite fehlgeschlagen:', err);
  process.exit(1);
});
