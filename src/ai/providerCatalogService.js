import { logger } from '../utils/logger.js';
import { inferModelCapabilities, KNOWN_MODELS } from './modelKnowledgeBase.js';

/**
 * Fallback / default model sets for each provider family if live catalog API is unreachable.
 */
export const PROVIDER_DEFAULT_MODELS = {
  gemini: [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-pro'
  ],
  github: [
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'meta/llama-3.3-70b-instruct',
    'mistralai/Mistral-Large-2411'
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant',
    'deepseek-r1-distill-llama-70b'
  ],
  cerebras: [
    'llama-3.3-70b',
    'gpt-oss-120b'
  ],
  mistral: [
    'codestral-2501',
    'codestral-latest',
    'mistral-small-latest',
    'mistral-large-latest'
  ],
  openrouter: [
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'deepseek/deepseek-r1:free'
  ],
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'o3-mini'
  ],
  ollama: [
    'qwen2.5-coder:14b',
    'qwen2.5-coder:7b',
    'llama3.3:latest'
  ],
  kiloai: [
    'kilo-auto/free'
  ],
  llm7: [
    'turbo'
  ]
};

export class ProviderCatalogService {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 4000;
  }

  /**
   * Identifies the provider family string (gemini, github, groq, cerebras, mistral, etc.)
   */
  getFamily(providerName = '', baseUrl = '') {
    const p = (providerName || '').toLowerCase();
    const u = (baseUrl || '').toLowerCase();

    if (p.includes('gemini') || p.includes('google') || u.includes('generativelanguage.googleapis')) return 'gemini';
    if (p.includes('github') || u.includes('models.github.ai')) return 'github';
    if (p.includes('groq') || u.includes('api.groq.com')) return 'groq';
    if (p.includes('cerebras') || u.includes('api.cerebras.ai')) return 'cerebras';
    if (p.includes('mistral') || p.includes('codestral') || u.includes('mistral.ai')) return 'mistral';
    if (p.includes('openrouter') || u.includes('openrouter.ai')) return 'openrouter';
    if (p.includes('openai') || u.includes('api.openai.com')) return 'openai';
    if (p.includes('ollama') || u.includes('11434')) return 'ollama';
    if (p.includes('kilo') || u.includes('kilo.ai')) return 'kiloai';
    if (p.includes('llm7') || u.includes('llm7.io')) return 'llm7';
    if (p.includes('sambanova') || u.includes('sambanova.ai')) return 'sambanova';
    if (p.includes('cloudflare') || u.includes('cloudflare.com')) return 'cloudflare';
    if (p.includes('nvidia') || u.includes('nvidia.com')) return 'nvidia';
    if (p.includes('siliconflow') || u.includes('siliconflow.cn')) return 'siliconflow';
    if (p.includes('zhipu') || u.includes('bigmodel.cn')) return 'zhipu';

    return 'custom';
  }

  /**
   * Fetches models from provider endpoint and combines them with enriched knowledge-base metadata.
   *
   * @param {Object} providerConfig - { baseUrl, provider, family, authType, customHeaders }
   * @param {string} [rawSecret] - API token
   * @returns {Promise<Array<Object>>} Enriched models list
   */
  async fetchLiveModels(providerConfig, rawSecret) {
    const family = providerConfig.family || this.getFamily(providerConfig.provider, providerConfig.baseUrl);
    const discoveredIds = new Set();

    // 1. Attempt live network fetch
    try {
      const rawIds = await this._queryProviderApi(providerConfig, rawSecret);
      for (const id of rawIds) {
        if (id && typeof id === 'string') discoveredIds.add(id.trim());
      }
    } catch (err) {
      logger.debug(`[ProviderCatalog] Live-Fetch für ${providerConfig.name || providerConfig.provider} nicht möglich (${err.message}). Verwende Fallback-Katalog.`);
    }

    // 2. Fallback to predefined set if live fetch returned empty or failed
    if (discoveredIds.size === 0) {
      const defaults = PROVIDER_DEFAULT_MODELS[family] || [];
      for (const id of defaults) {
        discoveredIds.add(id);
      }
    }

    // 3. Enrich every model with capabilities, pricing, and context
    const enrichedList = [];
    for (const modelId of discoveredIds) {
      const meta = inferModelCapabilities(modelId, providerConfig.provider || family);
      enrichedList.push({
        modelId,
        name: meta.name || modelId,
        enabled: true,
        contextWindow: meta.contextWindow || 128000,
        maxTokens: meta.maxTokens || 4000,
        isFreeTier: Boolean(meta.isFreeTier),
        isThinkingModel: Boolean(meta.isThinkingModel),
        costPer1MInput: meta.costPer1MInput ?? 0,
        costPer1MOutput: meta.costPer1MOutput ?? 0,
        capabilities: meta.capabilities || { code: 70, reasoning: 70, speed: 70, json: 70 },
        tierRecommendation: meta.tierRecommendation || 'NANO_CHAT',
        status: 'healthy',
        cooldownUntil: 0,
        latencyMs: null,
        lastTested: null,
        lastError: null
      });
    }

    // Sort by code/reasoning capability descending
    enrichedList.sort((a, b) => {
      const scoreA = (a.capabilities.code + a.capabilities.reasoning);
      const scoreB = (b.capabilities.code + b.capabilities.reasoning);
      return scoreB - scoreA;
    });

    return enrichedList;
  }

  /**
   * Internal API query router
   * @private
   */
  async _queryProviderApi(providerConfig, rawSecret) {
    const { baseUrl, customHeaders = {} } = providerConfig;
    if (!baseUrl) return [];

    const isLocal = baseUrl.includes('127.0.0.1') || baseUrl.includes('localhost');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    // Ollama special handling
    if (baseUrl.includes('11434')) {
      try {
        const ollamaUrl = baseUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '') + '/api/tags';
        const res = await fetch(ollamaUrl, { signal: controller.signal });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.models)) {
            return json.models.map(m => m.name || m.model).filter(Boolean);
          }
        }
      } catch (_) {}
    }

    // Standard OpenAI compatible GET /models
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const modelsUrl = cleanBase.endsWith('/models') ? cleanBase : `${cleanBase}/models`;

    const headers = {
      'Accept': 'application/json',
      ...customHeaders
    };

    if (rawSecret && rawSecret !== 'none' && !rawSecret.startsWith('dummy-')) {
      headers['Authorization'] = `Bearer ${rawSecret}`;
    }

    try {
      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (!res.ok) {
        return [];
      }

      const text = await res.text();
      if (!text || text.trim() === 'OK') return [];

      const data = JSON.parse(text);
      const ids = [];

      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (item?.id) ids.push(item.id);
        }
      } else if (Array.isArray(data?.models)) {
        for (const item of data.models) {
          if (item?.name) ids.push(item.name);
          else if (item?.id) ids.push(item.id);
        }
      } else if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string') ids.push(item);
          else if (item?.id) ids.push(item.id);
        }
      }

      return ids;
    } finally {
      clearTimeout(timer);
    }
  }
}

export const providerCatalogService = new ProviderCatalogService();
