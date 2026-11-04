import OpenAI from 'openai';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';

class Endpoint {
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

    // Hinweis: Schlüssellose Gateways (Kilo AI, LLM7) verlangen einen nicht-leeren String für den OpenAI-SDK-Client
    this.client = new OpenAI({
      apiKey: this.apiKey || 'dummy-key',
      baseURL: this.baseURL
    });
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

export class LLMRouter {
  constructor() {
    this.fastEndpoints = [];
    this.architectEndpoints = [];
    this.lastActiveProvider = 'Cerebras';
    this.initPools();
  }

  getActiveProviderName() {
    return this.lastActiveProvider || 'Cerebras';
  }

  initPools() {
    this.fastEndpoints = [];
    this.architectEndpoints = [];

    // =========================================================================
    // STUFE 1: HIGH-SPEED & AGENTIC LOOPS (Cerebras & Groq)
    // Bis zu 2.600 tok/s, 1 Mio. TPD (Cerebras) & 200K TPD (Groq)
    // =========================================================================

    // 1. Cerebras
    for (const key of settings.CEREBRAS_API_KEYS) {
      if (settings.CEREBRAS_FAST_MODEL) {
        this.fastEndpoints.push(
          new Endpoint('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_FAST_MODEL, 'FAST_TIER')
        );
      }
      if (settings.CEREBRAS_ARCHITECT_MODEL) {
        this.architectEndpoints.push(
          new Endpoint('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_ARCHITECT_MODEL, 'ARCHITECT_TIER', { isThinkingModel: true })
        );
      }
    }

    // 2. GroqCloud
    for (const key of settings.GROQ_API_KEYS) {
      if (settings.GROQ_FAST_MODEL) {
        this.fastEndpoints.push(
          new Endpoint('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_FAST_MODEL, 'FAST_TIER')
        );
      }
      if (settings.GROQ_ARCHITECT_MODEL) {
        this.architectEndpoints.push(
          new Endpoint('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_ARCHITECT_MODEL, 'ARCHITECT_TIER')
        );
      }
    }

    // =========================================================================
    // STUFE 2: DEEP CONTEXT & CODE SYNTHESIS (Mistral / Codestral & Google AI Studio)
    // 1 Mrd. Tokens/Monat (Mistral) & 1M Kontext (Gemini Flash)
    // =========================================================================

    // 3. Mistral / Codestral (Spezialisierter Codestral-Endpunkt)
    for (const key of settings.CODESTRAL_API_KEYS) {
      this.architectEndpoints.push(
        new Endpoint('Codestral', key, 'https://codestral.mistral.ai/v1', 'codestral-latest', 'ARCHITECT_TIER')
      );
    }
    for (const key of settings.MISTRAL_API_KEYS) {
      if (settings.MISTRAL_FAST_MODEL) {
        this.fastEndpoints.push(
          new Endpoint('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_FAST_MODEL, 'FAST_TIER')
        );
      }
      if (settings.MISTRAL_ARCHITECT_MODEL) {
        this.architectEndpoints.push(
          new Endpoint('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_ARCHITECT_MODEL, 'ARCHITECT_TIER')
        );
      }
    }

    // 4. Google AI Studio (Gemini Flash & Flash-Lite mit 1M Kontext)
    for (const key of settings.GEMINI_API_KEYS) {
      if (settings.GEMINI_FAST_MODEL) {
        this.fastEndpoints.push(
          new Endpoint('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_FAST_MODEL, 'FAST_TIER')
        );
      }
      if (settings.GEMINI_ARCHITECT_MODEL) {
        this.architectEndpoints.push(
          new Endpoint('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_ARCHITECT_MODEL, 'ARCHITECT_TIER')
        );
      }
    }

    // =========================================================================
    // STUFE 3: HEAVY REASONING & SPEZIAL-TASKS (SambaNova, Cloudflare & NVIDIA NIM)
    // =========================================================================

    // 5. SambaNova Cloud (200K TPD, geschützt durch 20 RPD Tages-Limit)
    for (const key of settings.SAMBANOVA_API_KEYS) {
      this.architectEndpoints.push(
        new Endpoint('SambaNova', key, 'https://api.sambanova.ai/v1', settings.SAMBANOVA_MODEL, 'ARCHITECT_TIER', {
          dailyRequestLimit: 20,
          isThinkingModel: true
        })
      );
    }

    // 6. Cloudflare Workers AI (10.000 tägliche Neurons)
    if (settings.CLOUDFLARE_API_TOKEN && settings.CLOUDFLARE_ACCOUNT_ID) {
      const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/ai/v1`;
      this.architectEndpoints.push(
        new Endpoint('CloudflareAI', settings.CLOUDFLARE_API_TOKEN, cfBaseUrl, settings.CLOUDFLARE_MODEL, 'ARCHITECT_TIER')
      );
    }

    // 7. NVIDIA NIM (40 RPM Prototyping)
    for (const key of settings.NVIDIA_NIM_API_KEYS) {
      this.architectEndpoints.push(
        new Endpoint('NVIDIA_NIM', key, 'https://integrate.api.nvidia.com/v1', settings.NVIDIA_NIM_MODEL, 'ARCHITECT_TIER')
      );
    }

    // =========================================================================
    // STUFE 4: UNBEGRENZTER FALLBACK-POOL (OpenRouter, Zhipu AI & SiliconFlow)
    // =========================================================================

    // 8. OpenRouter (:free Modelle)
    for (const key of settings.OPENROUTER_API_KEYS) {
      if (settings.OPENROUTER_FAST_MODEL) {
        this.fastEndpoints.push(
          new Endpoint('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_FAST_MODEL, 'FAST_TIER')
        );
      }
      if (settings.OPENROUTER_ARCHITECT_MODEL) {
        this.architectEndpoints.push(
          new Endpoint('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_ARCHITECT_MODEL, 'ARCHITECT_TIER')
        );
      }
    }

    // 9. Zhipu AI (Dauerhaft kostenlose Flash-Linie)
    for (const key of settings.ZHIPU_API_KEYS) {
      this.fastEndpoints.push(
        new Endpoint('ZhipuAI', key, 'https://open.bigmodel.cn/api/paas/v4', settings.ZHIPU_MODEL, 'FAST_TIER')
      );
      this.architectEndpoints.push(
        new Endpoint('ZhipuAI', key, 'https://open.bigmodel.cn/api/paas/v4', settings.ZHIPU_MODEL, 'ARCHITECT_TIER')
      );
    }

    // 10. SiliconFlow (Dauerhaft kostenlose L0-Modelle)
    for (const key of settings.SILICONFLOW_API_KEYS) {
      this.fastEndpoints.push(
        new Endpoint('SiliconFlow', key, 'https://api.siliconflow.com/v1', settings.SILICONFLOW_MODEL, 'FAST_TIER')
      );
      this.architectEndpoints.push(
        new Endpoint('SiliconFlow', key, 'https://api.siliconflow.com/v1', settings.SILICONFLOW_MODEL, 'ARCHITECT_TIER')
      );
    }

    // =========================================================================
    // ZERO-KEY EMERGENCY FALLBACK (Kilo AI Gateway & LLM7)
    // Schützt vor Totalausfall und erlaubt Out-of-the-Box Funktion ohne API-Keys
    // =========================================================================
    if (settings.ENABLE_ZERO_KEY_FALLBACK) {
      // Kilo AI Gateway (Schlüssellos)
      const kiloFast = new Endpoint('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'FAST_TIER', { isZeroKey: true });
      const kiloArch = new Endpoint('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'ARCHITECT_TIER', { isZeroKey: true });
      this.fastEndpoints.push(kiloFast);
      this.architectEndpoints.push(kiloArch);

      // LLM7.io Turbo Pool
      const llm7Fast = new Endpoint('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'FAST_TIER', { isZeroKey: true });
      const llm7Arch = new Endpoint('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'ARCHITECT_TIER', { isZeroKey: true });
      this.fastEndpoints.push(llm7Fast);
      this.architectEndpoints.push(llm7Arch);
    }

    logger.info(`LLM Router v2.0 bereit: ${this.fastEndpoints.length} Fast-Endpoints, ${this.architectEndpoints.length} Architect-Endpoints aktiv.`);
  }

  getEndpointsForTier(tier) {
    return tier === 'FAST_TIER' ? this.fastEndpoints : this.architectEndpoints;
  }

  getFallbackEndpoints(tier) {
    return tier === 'FAST_TIER' ? this.architectEndpoints : this.fastEndpoints;
  }

  handleError(endpoint, error) {
    const status = error.status || error.statusCode || error.response?.status;
    const headers = error.headers || error.response?.headers;

    let retryAfterSec = null;
    if (headers) {
      const rawHeader = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after'];
      if (rawHeader) {
        const parsed = parseInt(rawHeader, 10);
        if (!Number.isNaN(parsed)) {
          retryAfterSec = parsed;
        }
      }
    }

    if (status === 401 || status === 403) {
      endpoint.disabled = true;
      logger.warn(`API-Schlüssel für [${endpoint.provider} (${endpoint.model})] ungültig oder abgelaufen (HTTP ${status}). Deaktiviere Key für diese Sitzung.`);
    } else if (status === 429) {
      const waitMs = retryAfterSec ? retryAfterSec * 1000 : 65000;
      endpoint.cooldownUntil = Date.now() + waitMs;
      logger.warn(`Rate-Limit (HTTP 429) auf [${endpoint.provider} (${endpoint.model})]. Cooldown für ${Math.round(waitMs / 1000)}s gesetzt. Wechsle sofort nächsten Provider...`);
    } else {
      // Allgemeiner Netzwerk-/Serverfehler: Kurzer Cooldown von 10 Sekunden
      endpoint.cooldownUntil = Date.now() + 10000;
      logger.warn(`Fehler auf [${endpoint.provider} (${endpoint.model})]: ${error.message}. Kurzer Cooldown gesetzt.`);
    }
  }

  async executeRequest(tier, messages, options = {}) {
    const primaryEndpoints = this.getEndpointsForTier(tier);
    const fallbackEndpoints = this.getFallbackEndpoints(tier);
    const candidateEndpoints = [...primaryEndpoints, ...fallbackEndpoints];

    if (candidateEndpoints.length === 0) {
      throw new Error(`Keine aktiven LLM-Endpoints konfiguriert für Tier '${tier}'. Bitte prüfe deine .env-Datei.`);
    }

    let lastError = null;

    // Suche verfügbaren Endpoint mit Cross-Provider-Rotation
    for (let attempt = 0; attempt < candidateEndpoints.length; attempt++) {
      const endpoint = candidateEndpoints.find(e => e.isAvailable());

      if (!endpoint) {
        const minWaitMs = Math.min(...candidateEndpoints.filter(e => !e.disabled).map(e => Math.max(0, e.cooldownUntil - Date.now())));
        if (minWaitMs > 0 && minWaitMs !== Infinity) {
          logger.warn(`Alle LLM-Endpoints im Cooldown. Kürzeste Wartezeit: ${Math.round(minWaitMs / 1000)}s.`);
        }
        break;
      }

      try {
        logger.debug(`Sende Anfrage an [${endpoint.provider} (${endpoint.model})] (${tier})...`);

        // Puffer für Thinking- und Reasoning-Modelle (verhindert abgeschnittene Antworten durch CoT)
        let tokenLimit = options.max_tokens ?? 4000;
        if (endpoint.isThinkingModel && tokenLimit < 6500) {
          tokenLimit = 6500;
        }

        const requestPayload = {
          model: endpoint.model,
          messages,
          temperature: options.temperature ?? 0.2,
          max_tokens: tokenLimit
        };

        const response = await endpoint.client.chat.completions.create(requestPayload);
        const reply = response.choices?.[0]?.message?.content || '';

        endpoint.recordSuccess();
        this.lastActiveProvider = endpoint.provider;

        return {
          content: reply,
          endpoint
        };
      } catch (err) {
        lastError = err;
        this.handleError(endpoint, err);
        // Sofortiges Failover zum nächsten Provider (< 20 ms)
      }
    }

    throw new Error(`Alle LLM-Provider und API-Keys sind erschöpft oder im Cooldown. Letzter Fehler: ${lastError?.message || 'Unbekannt'}`);
  }

  async completeJSON(tier, systemPrompt, userPrompt) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.executeRequest(tier, messages, { temperature: 0.2 });
    let text = result.content.trim();

    // Bereinige Markdown-Fences ```json ... ```
    if (text.startsWith('```')) {
      text = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '');
    }

    try {
      return JSON.parse(text);
    } catch {
      // Regex-Fallback für JSON-Objekte (mit innerem Schutz vor ungültigem Regex-Match)
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

  async generateCode(systemPrompt, userPrompt) {
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await this.executeRequest('ARCHITECT_TIER', messages, { temperature: 0.2, max_tokens: 4500 });
    let text = result.content.trim();

    // Code aus Markdown-Fences extrahieren
    const codeMatch = text.match(/```(?:javascript|js)?([\s\S]*?)```/i);
    if (codeMatch) {
      return codeMatch[1].trim();
    }

    return text;
  }
}

export const llmRouter = new LLMRouter();
