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

    // Hinweis: Schlüssellose Gateways (Kilo AI, LLM7) verlangen einen nicht-leeren String für den OpenAI-SDK-Client
    // maxRetries: 0 verhindert SDK-interne Retries, sodass der LLMRouter sofort nach 30s zum nächsten Provider rotiert
    if (!options.deferClientCreation) {
      this.client = new OpenAI({
        apiKey: this.apiKey || 'dummy-key',
        baseURL: this.baseURL,
        timeout: this.timeout,
        maxRetries: this.maxRetries
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
      deferClientCreation: true
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

    const defaultHeaders = { ...this.customHeaders };
    if (this.authType === 'bearer_token' || this.authType === 'oauth_device_flow' || this.authType === 'oauth_pkce') {
      if (this.apiKey && this.apiKey !== 'dummy-key' && this.apiKey !== 'none') {
        defaultHeaders['Authorization'] = `Bearer ${this.apiKey}`;
      }
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
