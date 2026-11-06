import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { CredentialVault } from '../security/credentialVault.js';
import { atomicWriteFileWithRetry } from '../utils/fileUtils.js';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { buildBootstrapEndpoints } from './endpointBootstrap.js';

/**
 * Matches all Unicode whitespace, format characters, control bytes, and zero-width codes.
 * - \s: All standard ECMAScript whitespace and newlines
 * - \u200B-\u200D: Zero-Width Space (ZWSP), Zero-Width Non-Joiner (ZWNJ), Zero-Width Joiner (ZWJ)
 * - \uFEFF: Byte Order Mark / Zero-Width No-Break Space (ZWNBSP)
 * - \x00-\x1F: ASCII C0 control characters (NUL, SOH, STX, BEL, ESC, etc.)
 * - \x7F: ASCII DEL control character
 */
const INVISIBLE_AND_CONTROL_CHARS = /[\s\u200B-\u200D\uFEFF\x00-\x1F\x7F]/g;

/**
 * Pure bullet, black circle, or asterisk masks of 1 or more characters.
 */
const PURE_BULLET_MASK_REGEX = /^[•●\*]+$/;

/**
 * Prefixed bullet, black circle, or asterisk masks with optional suffix.
 */
const PREFIXED_BULLET_MASK_REGEX = /^[a-zA-Z0-9_-]+[•●\*]+[a-zA-Z0-9_\-\.\+=]*$/i;

/**
 * Naked ellipsis of 3 or more dots.
 */
const NAKED_ELLIPSIS_REGEX = /^\.{3,}$/;

/**
 * Prefix, infix, or suffix ellipsis patterns without requiring a mandatory suffix.
 */
const GENERAL_ELLIPSIS_MASK_REGEX = /^[a-zA-Z0-9_-]*\.{3,}[a-zA-Z0-9_\-\.\+=]*$/i;

/**
 * Masks a secret API key or token for UI display and logging.
 * Shows prefix...suffix, or bullets for short secrets (<= 8 chars).
 * Strips invisible and control characters before computing mask.
 *
 * @param {string} secret
 * @returns {string}
 */
export function maskSecret(secret) {
  if (typeof secret !== 'string') return '';
  const cleaned = secret.replace(INVISIBLE_AND_CONTROL_CHARS, '');
  if (cleaned.length === 0) return '';

  // Short secrets (<= 8 characters) are never partially exposed
  if (cleaned.length <= 8) {
    return '••••••••';
  }

  // Detect common provider prefixes (e.g. sk-proj-, sk-or-v1-, gho_, gsk_, csk_)
  const prefixMatch = cleaned.match(/^([a-z0-9_-]{3,12}_)/i) ||
                      cleaned.match(/^(sk-proj-|sk-or-v1-|sk-ant-api\d\d-|sk-)/i);
  const prefix = prefixMatch ? prefixMatch[0] : cleaned.slice(0, 4);
  const suffix = cleaned.slice(-4);

  // Overlap protection for short strings
  if (prefix.length + suffix.length >= cleaned.length) {
    return `${cleaned.slice(0, 3)}...${suffix}`;
  }

  return `${prefix}...${suffix}`;
}

/**
 * Hardened check to detect masked placeholder strings from web UI / inputs.
 * Prevents masked placeholders, zero-width characters, control bytes,
 * and trivially corrupted inputs from accidentally overwriting actual keys.
 *
 * @param {any} value
 * @returns {boolean}
 */
export function isMaskedPlaceholder(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;

  // 1. Strip all Unicode whitespace, format, control, and zero-width characters
  const cleaned = value.replace(INVISIBLE_AND_CONTROL_CHARS, '');
  if (cleaned.length === 0) return true;

  // 2. Pure bullet / asterisk / dot masks
  if (PURE_BULLET_MASK_REGEX.test(cleaned)) return true;

  // 3. Prefixed bullet / asterisk masks (e.g. "sk-••••", "csk_********")
  if (PREFIXED_BULLET_MASK_REGEX.test(cleaned)) return true;

  // 4. Naked ellipsis (e.g. "...", "....")
  if (NAKED_ELLIPSIS_REGEX.test(cleaned)) return true;

  // 5. Hardened ellipsis patterns with optional prefix and suffix
  if (GENERAL_ELLIPSIS_MASK_REGEX.test(cleaned)) return true;

  // 6. Guard against trivially short corrupted inputs (< 8 chars unless explicitly 'none' or 'test')
  if (cleaned.length < 8 && !['none', 'test'].includes(cleaned.toLowerCase())) {
    return true;
  }

  return false;
}

/**
 * EndpointManager
 *
 * Manages data/endpoints.json metadata and enforces the Write-Only Secret Protection Invariant.
 * Automatically seeds endpoints from .env upon first boot without data loss.
 */
export class EndpointManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {string} [options.configPath] - Path to data/endpoints.json
   * @param {CredentialVault} [options.vault] - Vault instance
   * @param {Object} [options.logger] - Logger instance
   */
  constructor(options = {}) {
    super();
    this.configPath = options.configPath
      ? path.resolve(options.configPath)
      : path.resolve('data', 'endpoints.json');
    this.vault = options.vault || new CredentialVault();
    this.log = options.logger || logger;

    this.version = 1;
    this.updatedAt = new Date().toISOString();
    this.activeFastEndpointId = '';
    this.activeArchitectEndpointId = '';
    this.zeroKeyFallbackEnabled = true;
    this.endpoints = [];
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
   * Initializes the manager, loads vault, and seeds from environment if endpoints.json is missing.
   * @returns {Promise<void>}
   */
  async init() {
    await this.vault.init();
    const dir = path.dirname(this.configPath);
    await fs.promises.mkdir(dir, { recursive: true });

    if (!fs.existsSync(this.configPath)) {
      this.log?.info?.('[EndpointManager] data/endpoints.json nicht gefunden. Starte Bootstrap aus Umgebungsvariablen (.env)...');
      await this.bootstrapFromEnvironment();
    } else {
      await this.loadEndpointMetadata();
    }

    this.emit('endpoints_reloaded', this.getAllEndpoints());
  }

  /**
   * Loads endpoints metadata from disk with retry logic for transient filesystem collisions.
   * @returns {Promise<void>}
   */
  async loadEndpointMetadata() {
    let raw;
    for (let attempt = 0; attempt <= 5; attempt++) {
      try {
        raw = await fs.promises.readFile(this.configPath, 'utf8');
        break;
      } catch (err) {
        if (err.code === 'ENOENT') {
          this.endpoints = [];
          return;
        }
        if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 5) {
          await new Promise(r => setTimeout(r, 10 * Math.pow(2, attempt)));
          continue;
        }
        this.log?.error?.(`[EndpointManager] Fehler beim Laden von ${this.configPath}: ${err.message}`);
        this.endpoints = [];
        return;
      }
    }

    if (raw === undefined || raw === null || typeof raw !== 'string' || raw.trim() === '') {
      this.endpoints = [];
      return;
    }

    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        this.endpoints = parsed;
      } else if (parsed && typeof parsed === 'object') {
        this.version = parsed.version || 1;
        this.updatedAt = parsed.updatedAt || new Date().toISOString();
        this.activeFastEndpointId = parsed.activeFastEndpointId || '';
        this.activeArchitectEndpointId = parsed.activeArchitectEndpointId || '';
        this.zeroKeyFallbackEnabled = parsed.zeroKeyFallbackEnabled ?? true;
        this.endpoints = Array.isArray(parsed.endpoints) ? parsed.endpoints : [];
      } else {
        this.endpoints = [];
      }
    } catch (err) {
      this.log?.error?.(`[EndpointManager] Fehler beim Parsen von ${this.configPath}: ${err.message}`);
      this.endpoints = [];
    }
  }

  /**
   * Internal disk writer using atomic temp file + rename with retry.
   *
   * @returns {Promise<void>}
   * @private
   */
  async _doSaveEndpointMetadata() {
    this.updatedAt = new Date().toISOString();
    const dataToSave = {
      version: this.version,
      updatedAt: this.updatedAt,
      activeFastEndpointId: this.activeFastEndpointId,
      activeArchitectEndpointId: this.activeArchitectEndpointId,
      zeroKeyFallbackEnabled: this.zeroKeyFallbackEnabled,
      endpoints: this.endpoints
    };

    await atomicWriteFileWithRetry(this.configPath, JSON.stringify(dataToSave, null, 2), 'utf8');
  }

  /**
   * Atomically writes endpoints metadata to disk using serialized FIFO queue.
   *
   * @returns {Promise<void>}
   */
  saveEndpointMetadata() {
    return this._enqueue(() => this._doSaveEndpointMetadata());
  }

  /**
   * Migrates configured .env keys across all 12 provider families into CredentialVault
   * and populates data/endpoints.json with masked metadata.
   *
   * @returns {Promise<void>}
   */
  async bootstrapFromEnvironment() {
    const bootstrapResult = await buildBootstrapEndpoints(this.vault, settings, { maskSecret });
    this.endpoints = bootstrapResult.endpoints;
    this.activeFastEndpointId = bootstrapResult.activeFastEndpointId;
    this.activeArchitectEndpointId = bootstrapResult.activeArchitectEndpointId;

    await this.saveEndpointMetadata();
    this.log?.info?.(`[EndpointManager] Bootstrap abgeschlossen. ${this.endpoints.length} Modell-Endpunkte initialisiert.`);
  }

  /**
   * Returns all endpoints in masked representation.
   * Guarantees raw secrets are never leaked.
   *
   * @returns {Array<Object>}
   */
  getAllEndpoints() {
    return JSON.parse(JSON.stringify(this.endpoints));
  }

  /**
   * Alias for getAllEndpoints.
   */
  getEndpointsMasked() {
    return this.getAllEndpoints();
  }

  /**
   * Returns all enabled endpoints.
   *
   * @returns {Array<Object>}
   */
  getAllEnabledEndpoints() {
    return this.getAllEndpoints().filter(e => e.enabled);
  }

  /**
   * Returns a single endpoint by id (masked).
   *
   * @param {string} id
   * @returns {Object|null}
   */
  getEndpoint(id) {
    if (!id) return null;
    const found = this.endpoints.find(e => e.id === id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  /**
   * Alias for getEndpoint.
   */
  getEndpointById(id) {
    return this.getEndpoint(id);
  }

  /**
   * Retrieves raw secret string for internal backend use (SafeProbeWorker, LLMRouter).
   *
   * @param {string} credentialRef
   * @returns {Promise<string|null>}
   */
  async getSecretForRef(credentialRef) {
    if (!credentialRef) return null;
    return this.vault.getSecret(credentialRef);
  }

  /**
   * Retrieves raw secret for an endpoint by endpoint id.
   *
   * @param {string} id
   * @returns {Promise<string|null>}
   */
  async getSecretForEndpoint(id) {
    const ep = this.getEndpoint(id);
    if (!ep || !ep.credentialRef) return null;
    return this.vault.getSecret(ep.credentialRef);
  }

  /**
   * Creates a new endpoint and securely stores the secret if provided.
   *
   * @param {Object} endpointData
   * @param {string} [rawSecret]
   * @returns {Promise<Object>} Created endpoint
   */
  createEndpoint(endpointData, rawSecret) {
    return this._enqueue(async () => {
      const id = endpointData.id || `ep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const credentialRef = endpointData.credentialRef || `sec_${id}`;

      const cleanedSecret = typeof rawSecret === 'string'
        ? rawSecret.replace(INVISIBLE_AND_CONTROL_CHARS, '')
        : '';
      const hasRealSecret = typeof rawSecret === 'string' &&
        cleanedSecret.length > 0 &&
        !isMaskedPlaceholder(rawSecret);

      if (hasRealSecret) {
        const tokenToStore = rawSecret.trim().replace(/[\u200B-\u200D\uFEFF\x00-\x1F\x7F]/g, '');
        await this.vault.storeSecret(credentialRef, {
          type: endpointData.authType || 'api_key',
          provider: endpointData.provider || 'Custom',
          token: tokenToStore,
          expiresAt: null
        });
      }

      const newEndpoint = {
        id,
        name: endpointData.name || `${endpointData.provider || 'Custom'} (${endpointData.modelId || 'default'})`,
        provider: endpointData.provider || 'Custom',
        category: endpointData.category || 'cloud',
        tier: endpointData.tier || 'FAST_TIER',
        enabled: endpointData.enabled !== undefined ? Boolean(endpointData.enabled) : true,
        priority: endpointData.priority !== undefined ? Number(endpointData.priority) : 10,
        baseUrl: endpointData.baseUrl || 'https://api.openai.com/v1',
        modelId: endpointData.modelId || 'gpt-4o',
        authType: endpointData.authType || (hasRealSecret ? 'api_key' : 'none'),
        credentialRef: hasRealSecret ? credentialRef : (endpointData.credentialRef || ''),
        temperature: endpointData.temperature ?? 0.2,
        maxTokens: endpointData.maxTokens ?? 4000,
        contextWindow: endpointData.contextWindow ?? (endpointData.category === 'local' ? 16384 : 128000),
        isThinkingModel: Boolean(endpointData.isThinkingModel),
        customHeaders: endpointData.customHeaders || {},
        maskedSecret: hasRealSecret ? maskSecret(rawSecret) : (endpointData.maskedSecret || ''),
        hasSecret: hasRealSecret || Boolean(endpointData.hasSecret),
        isSystemDefault: Boolean(endpointData.isSystemDefault),
        status: endpointData.status || 'untested',
        latencyMs: endpointData.latencyMs ?? null,
        lastTested: endpointData.lastTested ?? null,
        quotaRemaining: endpointData.quotaRemaining ?? null,
        lastError: endpointData.lastError ?? null
      };

      if (endpointData.localDetails) {
        newEndpoint.localDetails = endpointData.localDetails;
      }
      if (endpointData.dailyRequestLimit) {
        newEndpoint.dailyRequestLimit = endpointData.dailyRequestLimit;
      }

      this.endpoints.push(newEndpoint);
      await this._doSaveEndpointMetadata();
      this.emit('endpoint_created', JSON.parse(JSON.stringify(newEndpoint)));
      return JSON.parse(JSON.stringify(newEndpoint));
    });
  }

  /**
   * Alias for createEndpoint / save new.
   */
  async saveEndpoint(endpointData, rawSecret) {
    if (endpointData.id && this.endpoints.some(e => e.id === endpointData.id)) {
      return this.updateEndpoint(endpointData.id, endpointData, rawSecret);
    }
    return this.createEndpoint(endpointData, rawSecret);
  }

  /**
   * Updates an endpoint while strictly enforcing the Write-Only Protection Invariant.
   * If candidateSecret is empty, whitespace, or a masked placeholder, the vault secret is NOT overwritten.
   *
   * @param {string} id
   * @param {Object} updates
   * @param {string} [candidateSecret]
   * @returns {Promise<Object>} Updated endpoint
   */
  updateEndpoint(id, updates = {}, candidateSecret) {
    return this._enqueue(async () => {
      const existingIndex = this.endpoints.findIndex(e => e.id === id);
      if (existingIndex === -1) {
        throw new Error(`Endpoint with id '${id}' not found`);
      }

      const existing = this.endpoints[existingIndex];
      const secretCandidate = candidateSecret !== undefined ? candidateSecret : updates.secret;

      const cleanedCandidate = typeof secretCandidate === 'string'
        ? secretCandidate.replace(INVISIBLE_AND_CONTROL_CHARS, '')
        : '';

      const isPlaceholder = !secretCandidate ||
        cleanedCandidate.length === 0 ||
        isMaskedPlaceholder(secretCandidate);

      if (!isPlaceholder && typeof secretCandidate === 'string') {
        const ref = existing.credentialRef || `sec_${id}`;
        const tokenToStore = secretCandidate.trim().replace(/[\u200B-\u200D\uFEFF\x00-\x1F\x7F]/g, '');

        await this.vault.storeSecret(ref, {
          type: updates.authType || existing.authType || 'api_key',
          provider: updates.provider || existing.provider || 'Custom',
          token: tokenToStore,
          expiresAt: null
        });
        existing.credentialRef = ref;
        existing.hasSecret = true;
        existing.maskedSecret = maskSecret(tokenToStore);
      }

      // Apply metadata updates (excluding transient secret fields)
      const allowedKeys = [
        'name', 'provider', 'category', 'tier', 'enabled', 'priority',
        'baseUrl', 'modelId', 'authType', 'temperature', 'maxTokens',
        'contextWindow', 'isThinkingModel', 'customHeaders', 'localDetails',
        'dailyRequestLimit', 'status', 'latencyMs', 'lastTested',
        'quotaRemaining', 'lastError'
      ];

      for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
          existing[key] = updates[key];
        }
      }

      await this._doSaveEndpointMetadata();
      const result = JSON.parse(JSON.stringify(existing));
      this.emit('endpoint_updated', result);
      return result;
    });
  }

  /**
   * Deletes an endpoint and removes associated secret from the vault.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  deleteEndpoint(id) {
    return this._enqueue(async () => {
      const index = this.endpoints.findIndex(e => e.id === id);
      if (index === -1) return false;

      const existing = this.endpoints[index];
      if (existing.credentialRef) {
        await this.vault.deleteSecret(existing.credentialRef);
      }

      this.endpoints.splice(index, 1);
      await this._doSaveEndpointMetadata();
      this.emit('endpoint_deleted', id);
      return true;
    });
  }

  /**
   * Updates health telemetry (status, latency, quota, errors) for an endpoint.
   *
   * @param {string} id
   * @param {Object} statusData
   * @returns {Promise<void>}
   */
  updateEndpointStatus(id, statusData = {}) {
    return this._enqueue(async () => {
      const ep = this.endpoints.find(e => e.id === id);
      if (!ep) return;

      if (statusData.status !== undefined) ep.status = statusData.status;
      if (statusData.latencyMs !== undefined) ep.latencyMs = statusData.latencyMs;
      if (statusData.quotaRemaining !== undefined) ep.quotaRemaining = statusData.quotaRemaining;
      if (statusData.lastError !== undefined) ep.lastError = statusData.lastError;
      ep.lastTested = new Date().toISOString();

      await this._doSaveEndpointMetadata();
      this.emit('endpoint_status_change', { id, status: ep.status, latencyMs: ep.latencyMs, lastTested: ep.lastTested });
    });
  }

  /**
   * Sets an endpoint as the primary active provider for a tier.
   *
   * @param {'FAST_TIER'|'ARCHITECT_TIER'|'REASONING_TIER'} tier
   * @param {string} endpointId
   * @returns {Promise<void>}
   */
  activateTier(tier, endpointId) {
    return this._enqueue(async () => {
      const target = this.endpoints.find(e => e.id === endpointId);
      if (!target) {
        throw new Error(`Endpoint with id '${endpointId}' not found`);
      }

      target.tier = tier;
      target.enabled = true;
      target.priority = 1;

      for (const ep of this.endpoints) {
        if (ep.id !== endpointId && ep.tier === tier) {
          ep.priority = Math.max(2, (ep.priority || 1) + 1);
        }
      }

      if (tier === 'FAST_TIER') {
        this.activeFastEndpointId = endpointId;
      } else if (tier === 'ARCHITECT_TIER') {
        this.activeArchitectEndpointId = endpointId;
      }

      await this._doSaveEndpointMetadata();
      this.emit('tier_activated', { tier, endpointId });
    });
  }

  /**
   * Alias for activateTier.
   */
  async setActiveEndpointForTier(tier, endpointId) {
    return this.activateTier(tier, endpointId);
  }
}

export { buildBootstrapEndpoints };
