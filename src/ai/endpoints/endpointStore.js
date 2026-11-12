import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFileWithRetry } from '../../utils/fileUtils.js';
import { inferModelCapabilities } from '../modelKnowledgeBase.js';

/**
 * Creates default role assignments dictionary.
 */
export function createDefaultRoleAssignments() {
  return {
    NANO_CHAT: { pinnedEndpointId: null, effectiveEndpointId: '' },
    PLANNER_JSON: { pinnedEndpointId: null, effectiveEndpointId: '' },
    ARCHITECT_CODE: { pinnedEndpointId: null, effectiveEndpointId: '' },
    REGION_DIFF: { pinnedEndpointId: null, effectiveEndpointId: '' },
    SELF_HEAL_REASONING: { pinnedEndpointId: null, effectiveEndpointId: '' }
  };
}

/**
 * Creates default telemetry structure.
 */
export function createDefaultTelemetry() {
  return {
    byRole: {
      NANO_CHAT: { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 },
      PLANNER_JSON: { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 },
      ARCHITECT_CODE: { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 },
      REGION_DIFF: { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 },
      SELF_HEAL_REASONING: { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 }
    },
    byModel: {},
    totalRequests: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalCostUSD: 0
  };
}

/**
 * Loads endpoint metadata from disk with retry logic for transient filesystem collisions.
 *
 * @param {string} configPath
 * @param {Object} [logger]
 * @returns {Promise<Object>}
 */
export async function loadEndpointsMetadata(configPath, logger) {
  let raw;
  for (let attempt = 0; attempt <= 5; attempt++) {
    try {
      raw = await fs.promises.readFile(configPath, 'utf8');
      break;
    } catch (err) {
      if (err.code === 'ENOENT') {
        return {
          version: 2,
          updatedAt: new Date().toISOString(),
          activeProfile: 'eco',
          roleAssignments: createDefaultRoleAssignments(),
          telemetry: createDefaultTelemetry(),
          activeFastEndpointId: '',
          activeArchitectEndpointId: '',
          zeroKeyFallbackEnabled: true,
          endpoints: []
        };
      }
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && attempt < 5) {
        await new Promise(r => setTimeout(r, 10 * Math.pow(2, attempt)));
        continue;
      }
      logger?.error?.(`[EndpointStore] Fehler beim Laden von ${configPath}: ${err.message}`);
      return {
        version: 2,
        updatedAt: new Date().toISOString(),
        activeProfile: 'eco',
        roleAssignments: createDefaultRoleAssignments(),
        telemetry: createDefaultTelemetry(),
        activeFastEndpointId: '',
        activeArchitectEndpointId: '',
        zeroKeyFallbackEnabled: true,
        endpoints: []
      };
    }
  }

  if (raw === undefined || raw === null || typeof raw !== 'string' || raw.trim() === '') {
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      activeProfile: 'eco',
      roleAssignments: createDefaultRoleAssignments(),
      telemetry: createDefaultTelemetry(),
      activeFastEndpointId: '',
      activeArchitectEndpointId: '',
      zeroKeyFallbackEnabled: true,
      endpoints: []
    };
  }

  try {
    const parsed = JSON.parse(raw);
    let endpoints = [];
    let version = 2;
    let updatedAt = new Date().toISOString();
    let activeProfile = 'eco';
    let roleAssignments = createDefaultRoleAssignments();
    let telemetry = createDefaultTelemetry();
    let activeFastEndpointId = '';
    let activeArchitectEndpointId = '';
    let zeroKeyFallbackEnabled = true;

    if (Array.isArray(parsed)) {
      endpoints = parsed;
    } else if (parsed && typeof parsed === 'object') {
      version = parsed.version || 2;
      updatedAt = parsed.updatedAt || new Date().toISOString();
      activeProfile = parsed.activeProfile || 'eco';
      if (parsed.roleAssignments && typeof parsed.roleAssignments === 'object') {
        roleAssignments = { ...roleAssignments, ...parsed.roleAssignments };
      }
      if (parsed.telemetry && typeof parsed.telemetry === 'object') {
        telemetry = { ...telemetry, ...parsed.telemetry };
      }
      activeFastEndpointId = parsed.activeFastEndpointId || '';
      activeArchitectEndpointId = parsed.activeArchitectEndpointId || '';
      zeroKeyFallbackEnabled = parsed.zeroKeyFallbackEnabled ?? true;
      endpoints = Array.isArray(parsed.endpoints) ? parsed.endpoints : [];
    }

    // Auto-enrich any endpoint lacking capabilities or pricing
    for (const ep of endpoints) {
      if (!ep.capabilities || ep.isFreeTier === undefined) {
        const inferred = inferModelCapabilities(ep.modelId, ep.provider);
        ep.capabilities = ep.capabilities || inferred.capabilities;
        if (ep.isFreeTier === undefined) ep.isFreeTier = inferred.isFreeTier;
        if (ep.costPer1MInput === undefined) ep.costPer1MInput = inferred.costPer1MInput;
        if (ep.costPer1MOutput === undefined) ep.costPer1MOutput = inferred.costPer1MOutput;
        if (!ep.tierRecommendation) ep.tierRecommendation = inferred.tierRecommendation;
        if (!Array.isArray(ep.roles)) ep.roles = [];
      }
    }

    return {
      version,
      updatedAt,
      activeProfile,
      roleAssignments,
      telemetry,
      activeFastEndpointId,
      activeArchitectEndpointId,
      zeroKeyFallbackEnabled,
      endpoints
    };
  } catch (err) {
    logger?.error?.(`[EndpointStore] Fehler beim Parsen von ${configPath}: ${err.message}`);
    return {
      version: 2,
      updatedAt: new Date().toISOString(),
      activeProfile: 'eco',
      roleAssignments: createDefaultRoleAssignments(),
      telemetry: createDefaultTelemetry(),
      activeFastEndpointId: '',
      activeArchitectEndpointId: '',
      zeroKeyFallbackEnabled: true,
      endpoints: []
    };
  }
}

/**
 * Atomically writes endpoints metadata to disk.
 *
 * @param {string} configPath
 * @param {Object} data
 * @returns {Promise<void>}
 */
export async function saveEndpointsMetadata(configPath, data) {
  const dir = path.dirname(configPath);
  await fs.promises.mkdir(dir, { recursive: true });
  await atomicWriteFileWithRetry(configPath, JSON.stringify(data, null, 2), 'utf8');
}
