import { DynamicEndpoint } from './DynamicEndpoint.js';
import { logger } from '../../utils/logger.js';

/**
 * Lädt die Endpunkte asynchron und atomar aus dem EndpointManager neu.
 */
export async function reloadDynamicPools(endpointManager, settings) {
  if (!endpointManager) {
    return null;
  }

  logger.info('[LLMRouter] Starte Hot-Reload der Modell-Pools...');
  let activeProfile = 'eco';
  let roleAssignments = null;

  if (typeof endpointManager.getRoutingProfile === 'function') {
    activeProfile = endpointManager.getRoutingProfile();
  }
  if (typeof endpointManager.getRoleAssignments === 'function') {
    roleAssignments = endpointManager.getRoleAssignments();
  }

  const configs = typeof endpointManager.getAllEnabledEndpoints === 'function'
    ? endpointManager.getAllEnabledEndpoints()
    : (typeof endpointManager.getAllEndpoints === 'function'
        ? endpointManager.getAllEndpoints().filter(e => e.enabled)
        : []);

  const newFast = [];
  const newArchitect = [];
  const newAll = [];

  for (const config of configs) {
    let rawSecret = '';
    if (typeof endpointManager.getSecretForRef === 'function' && config.credentialRef) {
      rawSecret = await endpointManager.getSecretForRef(config.credentialRef);
    } else if (typeof endpointManager.getSecretForRef === 'function') {
      rawSecret = await endpointManager.getSecretForRef(config.id);
    } else if (typeof endpointManager.getSecret === 'function') {
      rawSecret = await endpointManager.getSecret(config.id);
    } else if (config.apiKey) {
      rawSecret = config.apiKey;
    }

    const endpoint = new DynamicEndpoint({
      ...config,
      apiKey: rawSecret || 'none'
    });

    newAll.push(endpoint);

    if (config.tier === 'FAST_TIER') newFast.push(endpoint);
    if (config.tier === 'ARCHITECT_TIER') newArchitect.push(endpoint);
    if (config.tier === 'FALLBACK_POOL' || config.tier === 'REASONING_TIER') {
      newFast.push(endpoint);
      newArchitect.push(endpoint);
    }
  }

  // Sort by priority ascending (1 = highest priority)
  newFast.sort((a, b) => (a.priority || 99) - (b.priority || 99));
  newArchitect.sort((a, b) => (a.priority || 99) - (b.priority || 99));

  // Safety net: If pools are empty and zero-key is enabled, inject emergency gateways
  if (newFast.length === 0 || newArchitect.length === 0) {
    if (settings.ENABLE_ZERO_KEY_FALLBACK) {
      const kiloFast = new DynamicEndpoint({
        provider: 'KiloAI',
        baseURL: settings.KILO_GATEWAY_URL,
        model: settings.KILO_MODEL,
        tier: 'FAST_TIER',
        authType: 'none',
        isZeroKey: true
      });
      const kiloArch = new DynamicEndpoint({
        provider: 'KiloAI',
        baseURL: settings.KILO_GATEWAY_URL,
        model: settings.KILO_MODEL,
        tier: 'ARCHITECT_TIER',
        authType: 'none',
        isZeroKey: true
      });
      if (newFast.length === 0) {
        newFast.push(kiloFast);
        newAll.push(kiloFast);
      }
      if (newArchitect.length === 0) {
        newArchitect.push(kiloArch);
        newAll.push(kiloArch);
      }
    }
  }

  logger.info(`[LLMRouter] Hot-Reload abgeschlossen: ${newFast.length} Fast, ${newArchitect.length} Architect, ${newAll.length} Gesamt Endpoints aktiv.`);

  return {
    fastEndpoints: newFast,
    architectEndpoints: newArchitect,
    allEndpoints: newAll,
    activeProfile,
    roleAssignments
  };
}
