import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { atomicWriteFileWithRetry } from '../utils/fileUtils.js';

/**
 * Returns a deterministic master key derived from the host system environment,
 * with override via process.env.VAULT_MASTER_KEY.
 *
 * @returns {string}
 */
export function getSystemMasterKey() {
  if (process.env.VAULT_MASTER_KEY && process.env.VAULT_MASTER_KEY.trim().length > 0) {
    return process.env.VAULT_MASTER_KEY.trim();
  }

  const hostname = os.hostname() || 'localhost';
  let username = 'mcbot';
  try {
    const userInfo = os.userInfo();
    if (userInfo && userInfo.username) {
      username = userInfo.username;
    } else {
      username = process.env.USER || process.env.USERNAME || 'mcbot';
    }
  } catch (_) {
    username = process.env.USER || process.env.USERNAME || 'mcbot';
  }

  let homedir = '';
  try {
    homedir = os.homedir() || '';
  } catch (_) {
    homedir = '';
  }

  return `${hostname}::${username}::${homedir}::mc-architect-bot-v2`;
}

/**
 * CredentialVault
 *
 * Secure authenticated cryptographic vault for storing LLM API keys and credentials
 * using native node:crypto (AES-256-GCM + Scrypt KDF).
 * Zero C++ dependencies.
 */
export class CredentialVault {
  /**
   * @param {Object} [options]
   * @param {string} [options.vaultPath] - Path to vault file (default: data/credentials.vault)
   * @param {string} [options.masterKey] - Optional master key override
   */
  constructor(options = {}) {
    this.vaultPath = options.vaultPath
      ? path.resolve(options.vaultPath)
      : path.resolve('data', 'credentials.vault');
    this.masterKey = options.masterKey || getSystemMasterKey();
    this._cache = null;
    this._writeQueue = Promise.resolve();
  }

  /**
   * Serializes an asynchronous mutation task onto the FIFO mutex queue.
   * Error in a previous task is absorbed so subsequent tasks are not stalled.
   *
   * @param {() => Promise<any>} action
   * @returns {Promise<any>}
   * @private
   */
  _enqueue(action) {
    const previousQueue = this._writeQueue || Promise.resolve();
    const task = previousQueue
      .catch(() => {})
      .then(() => action());
    this._writeQueue = task;
    return task;
  }

  /**
   * Derives a 32-byte key using Scrypt KDF.
   *
   * @param {Buffer|string} salt - 32-byte salt buffer or 64-char hex string
   * @param {string} [masterKey] - Master key passphrase
   * @returns {Buffer} 32-byte key buffer
   */
  deriveKey(salt, masterKey = this.masterKey) {
    if (!salt) {
      throw new TypeError('Salt is required for key derivation');
    }
    const saltBuf = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
    if (saltBuf.length !== 32) {
      throw new TypeError(`Salt must be exactly 32 bytes, received ${saltBuf.length} bytes`);
    }
    const keyString = (typeof masterKey === 'string' ? masterKey : String(masterKey || '')) || getSystemMasterKey();

    return crypto.scryptSync(keyString, saltBuf, 32, {
      N: 16384,
      r: 8,
      p: 1,
      maxmem: 33554432 // 32 MB
    });
  }

  /**
   * Encrypts a payload with AES-256-GCM.
   *
   * @param {Object|string} payload - Object or string to encrypt
   * @param {string} [masterKey] - Master key passphrase
   * @param {string} [existingSaltHex] - Optional existing salt hex
   * @returns {{ version: number, kdf: string, cipher: string, salt: string, iv: string, tag: string, ciphertext: string }}
   */
  encrypt(payload, masterKey = this.masterKey, existingSaltHex = null) {
    if (payload === undefined || payload === null) {
      throw new TypeError('Payload cannot be null or undefined');
    }

    const saltBuf = existingSaltHex ? Buffer.from(existingSaltHex, 'hex') : crypto.randomBytes(32);
    const ivBuf = crypto.randomBytes(12); // NIST 96-bit recommended IV
    const key = this.deriveKey(saltBuf, masterKey);

    const cipher = crypto.createCipheriv('aes-256-gcm', key, ivBuf);
    const plaintext = typeof payload === 'string' ? payload : JSON.stringify(payload);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    return {
      version: 1,
      kdf: 'scrypt',
      cipher: 'aes-256-gcm',
      salt: saltBuf.toString('hex'),
      iv: ivBuf.toString('hex'),
      tag,
      ciphertext
    };
  }

  /**
   * Decrypts an envelope with AES-256-GCM and verifies authentication tag.
   *
   * @param {Object} envelope - Encrypted envelope object
   * @param {string} [masterKey] - Master key passphrase
   * @throws {Error} If tampering detected, tag mismatch, or wrong key
   * @returns {Object|string} Decrypted object or string
   */
  decrypt(envelope, masterKey = this.masterKey) {
    if (!envelope || typeof envelope !== 'object') {
      throw new Error('Vault integrity check failed: Invalid vault envelope');
    }
    if (envelope.version !== 1 || envelope.cipher !== 'aes-256-gcm') {
      throw new Error(`Vault integrity check failed: Unsupported cipher or version (${envelope.cipher} v${envelope.version})`);
    }
    if (!envelope.salt || !envelope.iv || !envelope.tag || envelope.ciphertext === undefined) {
      throw new Error('Vault integrity check failed: Missing envelope fields');
    }

    try {
      const saltBuf = Buffer.from(envelope.salt, 'hex');
      const ivBuf = Buffer.from(envelope.iv, 'hex');
      const tagBuf = Buffer.from(envelope.tag, 'hex');
      const ciphertextBuf = Buffer.from(envelope.ciphertext, 'hex');

      if (ivBuf.length !== 12 || tagBuf.length !== 16 || saltBuf.length !== 32) {
        throw new Error('Invalid buffer length');
      }

      const key = this.deriveKey(saltBuf, masterKey);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, ivBuf);
      decipher.setAuthTag(tagBuf);

      let decrypted = decipher.update(ciphertextBuf, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      try {
        return JSON.parse(decrypted);
      } catch {
        return decrypted;
      }
    } catch (_) {
      throw new Error('Vault integrity check failed: Authentication tag verification failed or corrupted ciphertext (vault tampering or invalid master key)');
    }
  }

  /**
   * Initializes the vault directory and loads or creates vault file.
   * @returns {Promise<void>}
   */
  async init() {
    const dir = path.dirname(this.vaultPath);
    await fs.promises.mkdir(dir, { recursive: true });
    await this.load();
  }

  /**
   * Loads and decrypts the vault file from disk.
   * If file does not exist, returns empty vault structure.
   * Employs retry logic for transient filesystem locks.
   *
   * @returns {Promise<{ updatedAt: string, secrets: Record<string, any> }>}
   */
  async load() {
    let raw;
    for (let attempt = 0; attempt <= 5; attempt++) {
      try {
        raw = await fs.promises.readFile(this.vaultPath, 'utf8');
        break;
      } catch (err) {
        if (err.code === 'ENOENT') {
          const defaultPayload = {
            updatedAt: new Date().toISOString(),
            secrets: {}
          };
          this._cache = defaultPayload;
          return defaultPayload;
        }
        if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 5) {
          await new Promise(r => setTimeout(r, 10 * Math.pow(2, attempt)));
          continue;
        }
        throw err;
      }
    }

    const envelope = JSON.parse(raw);
    const decrypted = this.decrypt(envelope);
    const payload = typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted;
    if (!payload || typeof payload !== 'object') {
      throw new Error('Corrupted vault content');
    }
    if (!payload.secrets) {
      payload.secrets = {};
    }
    this._cache = payload;
    return payload;
  }

  /**
   * Internal disk writer using atomic temp file + rename with retry.
   *
   * @param {{ updatedAt?: string, secrets: Record<string, any> }} payload
   * @returns {Promise<void>}
   * @private
   */
  async _doSave(payload) {
    const envelope = this.encrypt(payload);
    const json = JSON.stringify(envelope, null, 2);
    await atomicWriteFileWithRetry(this.vaultPath, json, 'utf8');
  }

  /**
   * Encrypts and atomically writes payload to disk using serialized FIFO queue.
   *
   * @param {{ updatedAt?: string, secrets: Record<string, any> }} payload
   * @returns {Promise<void>}
   */
  save(payload) {
    return this._enqueue(async () => {
      const toSave = {
        updatedAt: new Date().toISOString(),
        secrets: payload?.secrets || {}
      };
      await this._doSave(toSave);
      this._cache = toSave;
    });
  }

  /**
   * Stores a secret in the vault and persists atomically via FIFO mutex queue.
   *
   * @param {string} id - Secret identifier / credentialRef
   * @param {string|{ token: string, type?: string, provider?: string, expiresAt?: string|null }} secretData
   * @returns {Promise<string>} id
   */
  storeSecret(id, secretData) {
    if (!id || typeof id !== 'string') {
      return Promise.reject(new TypeError('Secret id must be a non-empty string'));
    }
    return this._enqueue(async () => {
      if (!this._cache) {
        await this.load();
      }

      const normalized = typeof secretData === 'string'
        ? { type: 'api_key', provider: 'Unknown', token: secretData, expiresAt: null }
        : {
            type: secretData?.type || 'api_key',
            provider: secretData?.provider || 'Unknown',
            token: secretData?.token ?? '',
            expiresAt: secretData?.expiresAt || null
          };

      const nextSecrets = {
        ...(this._cache.secrets || {}),
        [id]: normalized
      };
      const nextCache = {
        updatedAt: new Date().toISOString(),
        secrets: nextSecrets
      };

      await this._doSave(nextCache);
      this._cache = nextCache;
      return id;
    });
  }

  /**
   * Alias for storeSecret.
   */
  saveSecret(id, secretData) {
    return this.storeSecret(id, secretData);
  }

  /**
   * Retrieves raw secret token string by id.
   *
   * @param {string} id
   * @returns {Promise<string|null>} Token string or null
   */
  async getSecret(id) {
    if (!id) return null;
    const payload = this._cache || await this.load();
    const entry = payload.secrets?.[id];
    if (!entry) return null;
    return typeof entry === 'string' ? entry : (entry.token ?? null);
  }

  /**
   * Retrieves full secret metadata object by id.
   *
   * @param {string} id
   * @returns {Promise<{ token: string, type: string, provider: string, expiresAt: string|null }|null>}
   */
  async getSecretMetadata(id) {
    if (!id) return null;
    const payload = this._cache || await this.load();
    const entry = payload.secrets?.[id];
    if (!entry) return null;
    if (typeof entry === 'string') {
      return { type: 'api_key', provider: 'Unknown', token: entry, expiresAt: null };
    }
    return { ...entry };
  }

  /**
   * Checks if a secret exists and has a non-empty token.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  async hasSecret(id) {
    if (!id) return false;
    const payload = this._cache || await this.load();
    const entry = payload.secrets?.[id];
    if (!entry) return false;
    if (typeof entry === 'string') return entry.length > 0;
    return Boolean(entry.token && entry.token.length > 0);
  }

  /**
   * Deletes a secret from the vault and persists atomically via FIFO mutex queue.
   *
   * @param {string} id
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  deleteSecret(id) {
    if (!id || typeof id !== 'string') {
      return Promise.resolve(false);
    }
    return this._enqueue(async () => {
      if (!this._cache) {
        await this.load();
      }
      if (!this._cache.secrets || !(id in this._cache.secrets)) {
        return false;
      }

      const nextSecrets = { ...this._cache.secrets };
      delete nextSecrets[id];
      const nextCache = {
        updatedAt: new Date().toISOString(),
        secrets: nextSecrets
      };

      await this._doSave(nextCache);
      this._cache = nextCache;
      return true;
    });
  }

  /**
   * Lists all stored secret IDs without exposing tokens.
   *
   * @returns {Promise<string[]>}
   */
  async listSecretIds() {
    const payload = this._cache || await this.load();
    return Object.keys(payload.secrets || {});
  }
}
