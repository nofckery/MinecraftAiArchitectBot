import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { CredentialVault } from '../security/credentialVault.js';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { buildBootstrapEndpoints } from './endpointBootstrap.js';
import {
  maskSecret,
  isMaskedPlaceholder,
  INVISIBLE_AND_CONTROL_CHARS,
  PURE_BULLET_MASK_REGEX,
  PREFIXED_BULLET_MASK_REGEX,
  NAKED_ELLIPSIS_REGEX,
  GENERAL_ELLIPSIS_MASK_REGEX
} from './secretMasker.js';
import {
  createDefaultRoleAssignments,
  createDefaultTelemetry,
  loadEndpointsMetadata,
  saveEndpointsMetadata
} from './endpoints/endpointStore.js';
import { recordEndpointTelemetry } from './endpoints/endpointTelemetry.js';
import {
  applySetRoutingProfile,
  applyPinRole,
  applyUnpinRole,
  applyActivateTier
} from './endpoints/roleAssignmentManager.js';
import {
  executeCreateEndpoint,
  executeUpdateEndpoint,
  executeDeleteEndpoint,
  executeUpdateEndpointStatus,
  executeSyncProviderModels
} from './endpoints/endpointCrudOperations.js';

export {
  maskSecret,
  isMaskedPlaceholder,
  INVISIBLE_AND_CONTROL_CHARS,
  PURE_BULLET_MASK_REGEX,
  PREFIXED_BULLET_MASK_REGEX,
  NAKED_ELLIPSIS_REGEX,
  GENERAL_ELLIPSIS_MASK_REGEX,
  buildBootstrapEndpoints
};

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

    this.version = 2;
    this.updatedAt = new Date().toISOString();
    this.activeProfile = 'eco';
    this.roleAssignments = createDefaultRoleAssignments();
    this.activeFastEndpointId = '';
    this.activeArchitectEndpointId = '';
    this.zeroKeyFallbackEnabled = true;
    this.endpoints = [];
    this.telemetry = createDefaultTelemetry();
    this._writeQueue = Promise.resolve();
  }

  /**
   * Serializes an asynchronous mutation task onto the FIFO mutex queue.
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
   * Loads endpoints metadata from disk with retry logic.
   * @returns {Promise<void>}
   */
  async loadEndpointMetadata() {
    const loaded = await loadEndpointsMetadata(this.configPath, this.log);
    this.version = loaded.version;
    this.updatedAt = loaded.updatedAt;
    this.activeProfile = loaded.activeProfile;
    this.roleAssignments = loaded.roleAssignments;
    this.telemetry = loaded.telemetry;
    this.activeFastEndpointId = loaded.activeFastEndpointId;
    this.activeArchitectEndpointId = loaded.activeArchitectEndpointId;
    this.zeroKeyFallbackEnabled = loaded.zeroKeyFallbackEnabled;
    this.endpoints = loaded.endpoints;
  }

  /**
   * Internal disk writer using atomic temp file + rename with retry.
   * @private
   */
  async _doSaveEndpointMetadata() {
    this.updatedAt = new Date().toISOString();
    const dataToSave = {
      version: this.version || 2,
      updatedAt: this.updatedAt,
      activeProfile: this.activeProfile || 'eco',
      roleAssignments: this.roleAssignments,
      telemetry: this.telemetry,
      activeFastEndpointId: this.activeFastEndpointId,
      activeArchitectEndpointId: this.activeArchitectEndpointId,
      zeroKeyFallbackEnabled: this.zeroKeyFallbackEnabled,
      endpoints: this.endpoints
    };
    await saveEndpointsMetadata(this.configPath, dataToSave);
  }

  /**
   * Atomically writes endpoints metadata to disk using serialized FIFO queue.
   * @returns {Promise<void>}
   */
  saveEndpointMetadata() {
    return this._enqueue(() => this._doSaveEndpointMetadata());
  }

  /**
   * Migrates configured .env keys across all 12 provider families into CredentialVault.
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

  getAllEndpoints() {
    return JSON.parse(JSON.stringify(this.endpoints));
  }

  getEndpointsMasked() {
    return this.getAllEndpoints();
  }

  getAllEnabledEndpoints() {
    return this.getAllEndpoints().filter(e => e.enabled);
  }

  getEndpoint(id) {
    if (!id) return null;
    const found = this.endpoints.find(e => e.id === id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  getEndpointById(id) {
    return this.getEndpoint(id);
  }

  async getSecretForRef(credentialRef) {
    if (!credentialRef) return null;
    return this.vault.getSecret(credentialRef);
  }

  async getSecretForEndpoint(id) {
    const ep = this.getEndpoint(id);
    if (!ep || !ep.credentialRef) return null;
    return this.vault.getSecret(ep.credentialRef);
  }

  createEndpoint(endpointData, rawSecret) {
    return this._enqueue(async () => {
      const created = await executeCreateEndpoint(this, this.vault, endpointData, rawSecret, ep => {
        this.emit('endpoint_created', ep);
      });
      await this._doSaveEndpointMetadata();
      return created;
    });
  }

  async saveEndpoint(endpointData, rawSecret) {
    if (endpointData.id && this.endpoints.some(e => e.id === endpointData.id)) {
      return this.updateEndpoint(endpointData.id, endpointData, rawSecret);
    }
    return this.createEndpoint(endpointData, rawSecret);
  }

  updateEndpoint(id, updates = {}, candidateSecret) {
    return this._enqueue(async () => {
      const result = await executeUpdateEndpoint(this, this.vault, id, updates, candidateSecret, ep => {
        this.emit('endpoint_updated', ep);
      });
      await this._doSaveEndpointMetadata();
      return result;
    });
  }

  deleteEndpoint(id) {
    return this._enqueue(async () => {
      const deleted = await executeDeleteEndpoint(this, this.vault, id, deletedId => {
        this.emit('endpoint_deleted', deletedId);
      });
      if (deleted) {
        await this._doSaveEndpointMetadata();
      }
      return deleted;
    });
  }

  updateEndpointStatus(id, statusData = {}) {
    return this._enqueue(async () => {
      executeUpdateEndpointStatus(this, id, statusData, payload => {
        this.emit('endpoint_status_change', payload);
      });
      await this._doSaveEndpointMetadata();
    });
  }

  activateTier(tier, endpointId) {
    return this._enqueue(async () => {
      applyActivateTier(this, tier, endpointId, payload => {
        this.emit('tier_activated', payload);
      });
      await this._doSaveEndpointMetadata();
    });
  }

  setRoutingProfile(profile) {
    return this._enqueue(async () => {
      const active = applySetRoutingProfile(this, profile, payload => {
        this.emit('profile_changed', payload);
      });
      await this._doSaveEndpointMetadata();
      return active;
    });
  }

  getRoutingProfile() {
    return this.activeProfile || 'eco';
  }

  pinRole(role, endpointId) {
    return this._enqueue(async () => {
      const assignment = applyPinRole(this, role, endpointId, payload => {
        this.emit('role_pinned', payload);
      });
      await this._doSaveEndpointMetadata();
      return assignment;
    });
  }

  unpinRole(role) {
    return this._enqueue(async () => {
      const assignment = applyUnpinRole(this, role, payload => {
        this.emit('role_unpinned', payload);
      });
      await this._doSaveEndpointMetadata();
      return assignment;
    });
  }

  getRoleAssignments() {
    return JSON.parse(JSON.stringify(this.roleAssignments));
  }

  getTelemetry() {
    return JSON.parse(JSON.stringify(this.telemetry));
  }

  recordTelemetry(data = {}) {
    recordEndpointTelemetry(this.telemetry, data, snapshot => {
      this.emit('telemetry_updated', snapshot);
    });
  }

  syncProviderModels(targetId) {
    return this._enqueue(async () => {
      const affected = await executeSyncProviderModels(this, this.vault, targetId, () => {
        this.emit('endpoints_reloaded', this.getAllEndpoints());
      });
      await this._doSaveEndpointMetadata();
      return affected;
    });
  }

  async setActiveEndpointForTier(tier, endpointId) {
    return this.activateTier(tier, endpointId);
  }
}
