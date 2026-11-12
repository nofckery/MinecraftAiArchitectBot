import { inferModelCapabilities } from '../modelKnowledgeBase.js';
import { providerCatalogService } from '../providerCatalogService.js';
import {
  maskSecret,
  isMaskedPlaceholder,
  INVISIBLE_AND_CONTROL_CHARS
} from '../secretMasker.js';

const ALLOWED_METADATA_KEYS = [
  'name', 'provider', 'category', 'tier', 'enabled', 'priority',
  'baseUrl', 'modelId', 'authType', 'temperature', 'maxTokens',
  'contextWindow', 'isThinkingModel', 'customHeaders', 'localDetails',
  'dailyRequestLimit', 'status', 'latencyMs', 'lastTested',
  'quotaRemaining', 'lastError', 'capabilities', 'isFreeTier',
  'costPer1MInput', 'costPer1MOutput', 'tierRecommendation', 'roles'
];

/**
 * Creates a new endpoint and securely stores the secret if provided.
 *
 * @param {Object} state
 * @param {Object} vault
 * @param {Object} endpointData
 * @param {string} [rawSecret]
 * @param {Function} [onCreated]
 * @returns {Promise<Object>} Created endpoint
 */
export async function executeCreateEndpoint(state, vault, endpointData, rawSecret, onCreated) {
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
    await vault.storeSecret(credentialRef, {
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

  const inferred = inferModelCapabilities(newEndpoint.modelId, newEndpoint.provider);
  newEndpoint.capabilities = endpointData.capabilities || inferred.capabilities;
  newEndpoint.isFreeTier = endpointData.isFreeTier !== undefined ? Boolean(endpointData.isFreeTier) : inferred.isFreeTier;
  newEndpoint.costPer1MInput = endpointData.costPer1MInput ?? inferred.costPer1MInput;
  newEndpoint.costPer1MOutput = endpointData.costPer1MOutput ?? inferred.costPer1MOutput;
  newEndpoint.tierRecommendation = endpointData.tierRecommendation || inferred.tierRecommendation;
  newEndpoint.roles = Array.isArray(endpointData.roles) ? endpointData.roles : [];

  if (endpointData.localDetails) {
    newEndpoint.localDetails = endpointData.localDetails;
  }
  if (endpointData.dailyRequestLimit) {
    newEndpoint.dailyRequestLimit = endpointData.dailyRequestLimit;
  }

  state.endpoints.push(newEndpoint);
  if (typeof onCreated === 'function') {
    onCreated(JSON.parse(JSON.stringify(newEndpoint)));
  }
  return JSON.parse(JSON.stringify(newEndpoint));
}

/**
 * Updates an endpoint while strictly enforcing the Write-Only Protection Invariant.
 *
 * @param {Object} state
 * @param {Object} vault
 * @param {string} id
 * @param {Object} updates
 * @param {string} [candidateSecret]
 * @param {Function} [onUpdated]
 * @returns {Promise<Object>} Updated endpoint
 */
export async function executeUpdateEndpoint(state, vault, id, updates = {}, candidateSecret, onUpdated) {
  const existingIndex = state.endpoints.findIndex(e => e.id === id);
  if (existingIndex === -1) {
    throw new Error(`Endpoint with id '${id}' not found`);
  }

  const existing = state.endpoints[existingIndex];
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

    await vault.storeSecret(ref, {
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
  for (const key of ALLOWED_METADATA_KEYS) {
    if (updates[key] !== undefined) {
      existing[key] = updates[key];
    }
  }

  const result = JSON.parse(JSON.stringify(existing));
  if (typeof onUpdated === 'function') {
    onUpdated(result);
  }
  return result;
}

/**
 * Deletes an endpoint and removes associated secret from the vault.
 *
 * @param {Object} state
 * @param {Object} vault
 * @param {string} id
 * @param {Function} [onDeleted]
 * @returns {Promise<boolean>}
 */
export async function executeDeleteEndpoint(state, vault, id, onDeleted) {
  const index = state.endpoints.findIndex(e => e.id === id);
  if (index === -1) return false;

  const existing = state.endpoints[index];
  if (existing.credentialRef) {
    await vault.deleteSecret(existing.credentialRef);
  }

  state.endpoints.splice(index, 1);
  if (typeof onDeleted === 'function') {
    onDeleted(id);
  }
  return true;
}

/**
 * Updates health telemetry for an endpoint.
 *
 * @param {Object} state
 * @param {string} id
 * @param {Object} statusData
 * @param {Function} [onStatusChanged]
 */
export function executeUpdateEndpointStatus(state, id, statusData = {}, onStatusChanged) {
  const ep = state.endpoints.find(e => e.id === id);
  if (!ep) return;

  if (statusData.status !== undefined) ep.status = statusData.status;
  if (statusData.latencyMs !== undefined) ep.latencyMs = statusData.latencyMs;
  if (statusData.quotaRemaining !== undefined) ep.quotaRemaining = statusData.quotaRemaining;
  if (statusData.lastError !== undefined) ep.lastError = statusData.lastError;
  ep.lastTested = new Date().toISOString();

  if (typeof onStatusChanged === 'function') {
    onStatusChanged({ id, status: ep.status, latencyMs: ep.latencyMs, lastTested: ep.lastTested });
  }
}

/**
 * Discovers and synchronizes all available models for a given provider or endpoint.
 *
 * @param {Object} state
 * @param {Object} vault
 * @param {string} targetId
 * @param {Function} [onReloaded]
 * @returns {Promise<Array<Object>>}
 */
export async function executeSyncProviderModels(state, vault, targetId, onReloaded) {
  const target = state.endpoints.find(e => e.id === targetId || e.provider?.toLowerCase() === targetId.toLowerCase());
  if (!target) {
    throw new Error(`Weder Endpunkt noch Provider '${targetId}' gefunden.`);
  }

  let secret = null;
  if (target.credentialRef) {
    secret = await vault.getSecret(target.credentialRef);
  }

  const discovered = await providerCatalogService.fetchLiveModels({
    baseUrl: target.baseUrl,
    provider: target.provider,
    authType: target.authType,
    customHeaders: target.customHeaders
  }, secret);

  const affected = [];

  for (const disc of discovered) {
    let existing = state.endpoints.find(e =>
      (e.provider === target.provider || e.baseUrl === target.baseUrl) &&
      (e.modelId === disc.modelId)
    );

    if (existing) {
      existing.capabilities = disc.capabilities;
      existing.contextWindow = disc.contextWindow || existing.contextWindow;
      existing.maxTokens = disc.maxTokens || existing.maxTokens;
      existing.isFreeTier = disc.isFreeTier;
      existing.isThinkingModel = disc.isThinkingModel;
      existing.costPer1MInput = disc.costPer1MInput;
      existing.costPer1MOutput = disc.costPer1MOutput;
      existing.tierRecommendation = disc.tierRecommendation;
      affected.push(JSON.parse(JSON.stringify(existing)));
    } else {
      const safeModelSlug = disc.modelId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const newId = `ep_${(target.provider || 'custom').toLowerCase()}_${safeModelSlug}`;
      const newEp = {
        id: newId,
        name: `${target.provider} (${disc.name || disc.modelId})`,
        provider: target.provider,
        category: target.category || 'cloud',
        tier: disc.tierRecommendation === 'ARCHITECT_CODE' || disc.tierRecommendation === 'SELF_HEAL_REASONING' ? 'ARCHITECT_TIER' : 'FAST_TIER',
        enabled: true,
        priority: target.priority || 10,
        baseUrl: target.baseUrl,
        modelId: disc.modelId,
        authType: target.authType,
        credentialRef: target.credentialRef || '',
        temperature: 0.2,
        maxTokens: disc.maxTokens || 4000,
        contextWindow: disc.contextWindow || 128000,
        isThinkingModel: disc.isThinkingModel,
        customHeaders: target.customHeaders || {},
        maskedSecret: target.maskedSecret || '',
        hasSecret: Boolean(target.hasSecret),
        isSystemDefault: false,
        capabilities: disc.capabilities,
        isFreeTier: disc.isFreeTier,
        costPer1MInput: disc.costPer1MInput,
        costPer1MOutput: disc.costPer1MOutput,
        tierRecommendation: disc.tierRecommendation,
        roles: [disc.tierRecommendation],
        status: 'untested',
        latencyMs: null,
        lastTested: null,
        quotaRemaining: null,
        lastError: null
      };
      state.endpoints.push(newEp);
      affected.push(JSON.parse(JSON.stringify(newEp)));
    }
  }

  if (typeof onReloaded === 'function') {
    onReloaded();
  }
  return affected;
}
