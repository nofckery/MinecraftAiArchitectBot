import OpenAI from 'openai';

export class Endpoint {
  constructor(provider, apiKey, baseURL, model, tier, options = {}) {
    this.provider = provider;
    this.apiKey = apiKey;
    this.baseURL = baseURL;
    this.model = model;
    this.tier = tier; // 'FAST_TIER' | 'ARCHITECT_TIER' | 'REASONING_TIER'
    this.cooldownUntil = 0;
    this.disabled = false;
    this.isZeroKey = !!options.isZeroKey;
    this.isThinkingModel = !!options.isThinkingModel ||
      model.toLowerCase().includes('r1') ||
      model.toLowerCase().includes('reasoning') ||
      model.toLowerCase().includes('thinking') ||
      model.toLowerCase().includes('gpt-oss');

    // Tägliches Kontingent-Tracking (z. B. SambaNova 20 RPD)
    this.dailyRequestLimit = options.dailyRequestLimit || Infinity;
    this.requestsToday = 0;
    this.lastResetDay = new Date().getUTCDate();
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries ?? 0;

    // Telemetrie & Kosten-Tracking
    this.totalPromptTokens = 0;
    this.totalCompletionTokens = 0;
    this.totalCostUSD = 0;
    this.costPer1MInput = options.costPer1MInput ?? 0;
    this.costPer1MOutput = options.costPer1MOutput ?? 0;
    this.isFreeTier = Boolean(options.isFreeTier);
    this.capabilities = options.capabilities || { code: 70, reasoning: 70, speed: 70, json: 70 };
    this.tierRecommendation = options.tierRecommendation || 'NANO_CHAT';
    this.roles = Array.isArray(options.roles) ? options.roles : [];

    // Hinweis: Schlüssellose Gateways (Kilo AI, LLM7) verlangen einen nicht-leeren String für den OpenAI-SDK-Client
    // maxRetries: 0 verhindert SDK-interne Retries, sodass der LLMRouter sofort nach 30s zum nächsten Provider rotiert
    if (!options.deferClientCreation) {
      const defaultHeaders = { ...(options.defaultHeaders || {}) };
      if (this.isZeroKey || this.apiKey === 'none') {
        defaultHeaders['Authorization'] = undefined;
      }
      this.client = new OpenAI({
        apiKey: this.apiKey || 'dummy-key',
        baseURL: this.baseURL,
        timeout: this.timeout,
        maxRetries: this.maxRetries,
        defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined
      });
    }
  }

  isAvailable() {
    if (this.disabled) return false;

    // Prüfe täglichen Reset für Tageskontingente
    const currentDay = new Date().getUTCDate();
    if (currentDay !== this.lastResetDay) {
      this.requestsToday = 0;
      this.lastResetDay = currentDay;
    }

    if (this.requestsToday >= this.dailyRequestLimit) {
      return false;
    }

    return Date.now() >= this.cooldownUntil;
  }

  recordSuccess() {
    this.requestsToday++;
  }

  recordUsage(usage = {}) {
    this.requestsToday++;
    const prompt = usage.promptTokens || usage.prompt_tokens || 0;
    const completion = usage.completionTokens || usage.completion_tokens || 0;
    this.totalPromptTokens += prompt;
    this.totalCompletionTokens += completion;

    const inputCost = (prompt / 1000000) * (this.costPer1MInput || 0);
    const outputCost = (completion / 1000000) * (this.costPer1MOutput || 0);
    const cost = this.isFreeTier ? 0 : (inputCost + outputCost);
    this.totalCostUSD += cost;

    return {
      promptTokens: prompt,
      completionTokens: completion,
      costUSD: cost
    };
  }
}

/**
 * DynamicEndpoint
 * Cleanly encapsulates custom base URLs, model IDs, vault credentials, custom headers,
 * and Ollama context parameter handling while maintaining 100% backward compatibility.
 */
export class DynamicEndpoint extends Endpoint {
  constructor(config = {}) {
    const provider = config.provider || 'Custom';
    const apiKey = config.apiKey || (config.authType === 'none' ? 'none' : '');
    const baseURL = config.baseUrl || config.baseURL || 'https://api.openai.com/v1';
    const model = config.modelId || config.model || 'gpt-4o';
    const tier = config.tier || 'FAST_TIER';
    const timeout = config.timeout || 30000;

    const options = {
      isZeroKey: config.authType === 'none' || config.isZeroKey || apiKey === 'none',
      isThinkingModel: config.isThinkingModel ||
        model.toLowerCase().includes('r1') ||
        model.toLowerCase().includes('reasoning') ||
        model.toLowerCase().includes('thinking') ||
        model.toLowerCase().includes('gpt-oss'),
      dailyRequestLimit: config.dailyRequestLimit || Infinity,
      timeout,
      maxRetries: config.maxRetries ?? 0,
      deferClientCreation: true,
      capabilities: config.capabilities,
      isFreeTier: config.isFreeTier,
      costPer1MInput: config.costPer1MInput,
      costPer1MOutput: config.costPer1MOutput,
      tierRecommendation: config.tierRecommendation,
      roles: config.roles
    };

    super(provider, apiKey, baseURL, model, tier, options);

    this.id = config.id || `ep_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    this.name = config.name || `${provider} (${model})`;
    this.category = config.category || (baseURL.includes('127.0.0.1') || baseURL.includes('localhost') ? 'local' : 'cloud');
    this.authType = config.authType || (apiKey ? 'api_key' : 'none');
    this.credentialRef = config.credentialRef || '';
    this.priority = config.priority || 1;
    this.contextWindow = config.contextWindow || (this.category === 'local' ? 16384 : 128000);
    this.temperature = config.temperature ?? 0.2;
    this.maxTokens = config.maxTokens || 4000;
    this.localDetails = config.localDetails || null;
    this.customHeaders = config.customHeaders || {};
    this.timeout = timeout;
    this.maxRetries = options.maxRetries ?? 0;
    this.capabilities = config.capabilities || this.capabilities;
    this.isFreeTier = config.isFreeTier !== undefined ? Boolean(config.isFreeTier) : this.isFreeTier;
    this.costPer1MInput = config.costPer1MInput ?? this.costPer1MInput;
    this.costPer1MOutput = config.costPer1MOutput ?? this.costPer1MOutput;
    this.tierRecommendation = config.tierRecommendation || this.tierRecommendation;
    this.roles = Array.isArray(config.roles) ? config.roles : (this.roles || []);

    const defaultHeaders = { ...this.customHeaders };
    if (this.authType === 'bearer_token' || this.authType === 'oauth_device_flow' || this.authType === 'oauth_pkce') {
      if (this.apiKey && this.apiKey !== 'dummy-key' && this.apiKey !== 'none') {
        defaultHeaders['Authorization'] = `Bearer ${this.apiKey}`;
      }
    } else if (this.isZeroKey || this.authType === 'none' || this.apiKey === 'none') {
      defaultHeaders['Authorization'] = undefined;
    }

    this.client = new OpenAI({
      apiKey: this.apiKey || 'dummy-key',
      baseURL: this.baseURL,
      timeout: this.timeout,
      maxRetries: this.maxRetries,
      defaultHeaders: Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined
    });
  }
}
