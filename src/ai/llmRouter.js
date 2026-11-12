import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { Endpoint, DynamicEndpoint } from './router/DynamicEndpoint.js';
import { TASK_ROLES, ROUTING_PROFILES } from './modelKnowledgeBase.js';
import { initializeStaticPools } from './router/poolInitializer.js';
import { reloadDynamicPools } from './router/poolReloader.js';
import { getCandidatesForRole } from './router/candidateSelector.js';
import { handleRouterError } from './router/routerErrorHandler.js';

export { Endpoint, DynamicEndpoint, TASK_ROLES, ROUTING_PROFILES };

export class LLMRouter {
  constructor() {
    this.fastEndpoints = [];
    this.architectEndpoints = [];
    this.allEndpoints = [];
    this.endpointManager = null;
    this.activeProfile = 'eco';
    this.roleAssignments = {
      NANO_CHAT: { pinnedEndpointId: null, effectiveEndpointId: '' },
      PLANNER_JSON: { pinnedEndpointId: null, effectiveEndpointId: '' },
      ARCHITECT_CODE: { pinnedEndpointId: null, effectiveEndpointId: '' },
      REGION_DIFF: { pinnedEndpointId: null, effectiveEndpointId: '' },
      SELF_HEAL_REASONING: { pinnedEndpointId: null, effectiveEndpointId: '' }
    };
    this.lastActiveProvider = 'Cerebras';
    this._reloadQueue = Promise.resolve();
    this.initPools();
  }

  getActiveProviderName() {
    return this.lastActiveProvider || 'Cerebras';
  }

  initPools() {
    const pools = initializeStaticPools(settings);
    this.fastEndpoints = pools.fastEndpoints;
    this.architectEndpoints = pools.architectEndpoints;
    this.allEndpoints = pools.allEndpoints;
  }

  getCandidatesForRole(role, attempt = 1) {
    return getCandidatesForRole({
      role,
      attempt,
      allEndpoints: this.allEndpoints,
      fastEndpoints: this.fastEndpoints,
      architectEndpoints: this.architectEndpoints,
      roleAssignments: this.roleAssignments,
      activeProfile: this.activeProfile
    });
  }

  getEndpointsForTier(tier) {
    return tier === 'FAST_TIER' ? this.fastEndpoints : this.architectEndpoints;
  }

  getFallbackEndpoints(tier) {
    return tier === 'FAST_TIER' ? this.architectEndpoints : this.fastEndpoints;
  }

  /**
   * Hot-reloads model pools from an EndpointManager instance using a serialized FIFO Async Mutex Queue.
   * Guarantees zero downtime for in-flight requests and prevents out-of-order state corruption.
   *
   * @param {Object} endpointManager - EndpointManager instance
   * @returns {Promise<void>}
   */
  reloadPools(endpointManager) {
    const previousQueue = this._reloadQueue || Promise.resolve();
    const task = previousQueue
      .catch(() => {}) // Prevent stalled queue on prior error
      .then(async () => {
        return await this._doReloadPools(endpointManager);
      });
    this._reloadQueue = task;
    return task;
  }

  async _doReloadPools(endpointManager) {
    if (!endpointManager) {
      logger.warn('[LLMRouter] Kein EndpointManager übergeben, setze Standard-Pools zurück.');
      this.initPools();
      return;
    }

    this.endpointManager = endpointManager;
    const reloaded = await reloadDynamicPools(endpointManager, settings);
    if (reloaded) {
      if (reloaded.activeProfile) this.activeProfile = reloaded.activeProfile;
      if (reloaded.roleAssignments) this.roleAssignments = reloaded.roleAssignments;
      // Atomic pointer swap
      this.fastEndpoints = reloaded.fastEndpoints;
      this.architectEndpoints = reloaded.architectEndpoints;
      this.allEndpoints = reloaded.allEndpoints;
    }
  }

  handleError(endpoint, error) {
    return handleRouterError(endpoint, error);
  }

  async executeTask(role, messages, options = {}) {
    return this.executeRequest(role, messages, options);
  }

  async executeRequest(roleOrTier, messages, options = {}) {
    const attempt = options.attempt || 1;
    let candidateEndpoints = [];

    if (roleOrTier === 'FAST_TIER' || roleOrTier === 'ARCHITECT_TIER') {
      const primaryEndpoints = this.getEndpointsForTier(roleOrTier);
      const fallbackEndpoints = this.getFallbackEndpoints(roleOrTier);
      candidateEndpoints = [...primaryEndpoints, ...fallbackEndpoints];
    } else if (Object.values(TASK_ROLES).includes(roleOrTier)) {
      candidateEndpoints = this.getCandidatesForRole(roleOrTier, attempt);
    } else {
      candidateEndpoints = this.getCandidatesForRole(TASK_ROLES.PLANNER_JSON, attempt);
    }

    if (candidateEndpoints.length === 0) {
      throw new Error(`Keine aktiven LLM-Endpoints konfiguriert für '${roleOrTier}'. Bitte prüfe deine Konfiguration.`);
    }

    let lastError = null;
    const availableEndpoints = candidateEndpoints.filter(e => e.isAvailable());
    const endpointsToTry = availableEndpoints.length > 0 ? availableEndpoints : candidateEndpoints;

    if (availableEndpoints.length === 0) {
      const minWaitMs = Math.min(...candidateEndpoints.filter(e => !e.disabled).map(e => Math.max(0, e.cooldownUntil - Date.now())));
      if (minWaitMs > 0 && minWaitMs !== Infinity) {
        logger.warn(`Alle LLM-Endpoints für ${roleOrTier} im Cooldown. Kürzeste Wartezeit: ${Math.round(minWaitMs / 1000)}s.`);
      }
    }

    for (const endpoint of endpointsToTry) {
      if (!endpoint.isAvailable() && endpointsToTry === availableEndpoints) continue;

      try {
        logger.debug(`Sende Anfrage an [${endpoint.provider} (${endpoint.model})] (Rolle: ${roleOrTier}, Versuch: ${attempt})...`);

        let tokenLimit = options.max_tokens ?? 4000;
        if (endpoint.isThinkingModel && tokenLimit < 6500) {
          tokenLimit = 6500;
        }

        const isOseries = /(^|\/)(o1|o3)(-[a-z0-9]+)?$/i.test(endpoint.model);
        const requestPayload = {
          model: endpoint.model,
          messages
        };

        if (isOseries) {
          requestPayload.max_completion_tokens = tokenLimit;
        } else {
          requestPayload.temperature = options.temperature ?? endpoint.temperature ?? 0.2;
          requestPayload.max_tokens = tokenLimit;
        }

        if (endpoint.category === 'local' || endpoint.baseURL?.includes('11434')) {
          requestPayload.options = { num_ctx: endpoint.contextWindow || 16384 };
        }

        const requestOptions = {
          timeout: options.timeout || endpoint.timeout || 30000,
          maxRetries: options.maxRetries ?? endpoint.maxRetries ?? 0
        };

        const response = await endpoint.client.chat.completions.create(requestPayload, requestOptions);
        const reply = response.choices?.[0]?.message?.content || '';

        const usageData = endpoint.recordUsage({
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          role: roleOrTier
        });

        if (this.endpointManager && typeof this.endpointManager.recordTelemetry === 'function') {
          this.endpointManager.recordTelemetry({
            role: roleOrTier,
            modelId: endpoint.model,
            promptTokens: usageData.promptTokens,
            completionTokens: usageData.completionTokens,
            costUSD: usageData.costUSD
          });
        }

        this.lastActiveProvider = endpoint.provider;

        return {
          content: reply,
          endpoint,
          usage: response.usage || null
        };
      } catch (err) {
        lastError = err;
        this.handleError(endpoint, err);
      }
    }

    throw new Error(`Alle LLM-Provider und API-Keys sind erschöpft oder im Cooldown. Letzter Fehler: ${lastError?.message || 'Unbekannt'}`);
  }

  async completeJSON(roleOrTier, systemPrompt, userPrompt, options = {}) {
    const role = (roleOrTier && Object.values(TASK_ROLES).includes(roleOrTier))
      ? roleOrTier
      : TASK_ROLES.PLANNER_JSON;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.executeRequest(role, messages, { temperature: 0.2, ...options });
    let text = result.content.trim();

    if (text.includes('</think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    }

    if (text.startsWith('```')) {
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(text);
    } catch {
      try {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          return JSON.parse(match[0]);
        }
      } catch (innerErr) {
        logger.debug(`Innerer JSON-Regex-Parse-Fehler: ${innerErr.message}`);
      }
      throw new Error(`Ungültige JSON-Antwort vom LLM (${result.endpoint.provider}):\n${text}`);
    }
  }

  async generateCode(systemPrompt, userPrompt, options = {}) {
    let role = TASK_ROLES.ARCHITECT_CODE;
    if (options.isSelfHealing || (options.attempt && options.attempt > 1)) {
      role = TASK_ROLES.SELF_HEAL_REASONING;
    } else if (options.isDiff || options.isModification) {
      role = TASK_ROLES.REGION_DIFF;
    } else if (options.role) {
      role = options.role;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.executeRequest(role, messages, {
      temperature: 0.2,
      max_tokens: 4500,
      attempt: options.attempt || 1,
      ...options
    });
    let text = result.content.trim();

    if (text.includes('</think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/i, '').trim();
    }

    const codeMatch = text.match(/```(?:javascript|js)?([\s\S]*?)```/i);
    if (codeMatch) {
      return codeMatch[1].trim();
    }

    return text;
  }
}

export const llmRouter = new LLMRouter();
