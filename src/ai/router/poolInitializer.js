import { Endpoint } from './DynamicEndpoint.js';
import { inferModelCapabilities } from '../modelKnowledgeBase.js';
import { logger } from '../../utils/logger.js';

/**
 * Initialisiert die Standard-Modell-Pools aus den Einstellungen.
 */
export function initializeStaticPools(settings) {
  const fastEndpoints = [];
  const architectEndpoints = [];

  // =========================================================================
  // STUFE 0: GITHUB MODELS (RFC 8628 Device Flow / GITHUB_TOKEN)
  // =========================================================================
  if (settings.GITHUB_TOKEN && settings.GITHUB_TOKEN.trim().length > 0) {
    const ghToken = settings.GITHUB_TOKEN.trim();
    if (settings.GITHUB_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('GitHub', ghToken, 'https://models.github.ai/inference', settings.GITHUB_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.GITHUB_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('GitHub', ghToken, 'https://models.github.ai/inference', settings.GITHUB_ARCHITECT_MODEL, 'ARCHITECT_TIER')
      );
    }
  }

  // =========================================================================
  // STUFE 1: HIGH-SPEED & AGENTIC LOOPS (Cerebras & Groq)
  // Bis zu 2.600 tok/s, 1 Mio. TPD (Cerebras) & 200K TPD (Groq)
  // =========================================================================
  for (const key of settings.CEREBRAS_API_KEYS || []) {
    if (settings.CEREBRAS_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.CEREBRAS_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_ARCHITECT_MODEL, 'ARCHITECT_TIER', { isThinkingModel: true })
      );
    }
  }

  for (const key of settings.GROQ_API_KEYS || []) {
    if (settings.GROQ_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.GROQ_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_ARCHITECT_MODEL, 'ARCHITECT_TIER')
      );
    }
  }

  // =========================================================================
  // STUFE 2: DEEP CONTEXT & CODE SYNTHESIS (Mistral / Codestral & Google AI Studio)
  // =========================================================================
  for (const key of settings.CODESTRAL_API_KEYS || []) {
    architectEndpoints.push(
      new Endpoint('Codestral', key, 'https://codestral.mistral.ai/v1', 'codestral-latest', 'ARCHITECT_TIER')
    );
  }
  for (const key of settings.MISTRAL_API_KEYS || []) {
    if (settings.MISTRAL_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.MISTRAL_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_ARCHITECT_MODEL, 'ARCHITECT_TIER')
      );
    }
  }

  for (const key of settings.GEMINI_API_KEYS || []) {
    if (settings.GEMINI_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.GEMINI_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_ARCHITECT_MODEL, 'ARCHITECT_TIER')
      );
    }
  }

  // =========================================================================
  // STUFE 3: HEAVY REASONING & SPEZIAL-TASKS (SambaNova, Cloudflare & NVIDIA NIM)
  // =========================================================================
  for (const key of settings.SAMBANOVA_API_KEYS || []) {
    architectEndpoints.push(
      new Endpoint('SambaNova', key, 'https://api.sambanova.ai/v1', settings.SAMBANOVA_MODEL, 'ARCHITECT_TIER', {
        dailyRequestLimit: 20,
        isThinkingModel: true
      })
    );
  }

  if (settings.CLOUDFLARE_API_TOKEN && settings.CLOUDFLARE_ACCOUNT_ID) {
    const cfBaseUrl = `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/ai/v1`;
    architectEndpoints.push(
      new Endpoint('CloudflareAI', settings.CLOUDFLARE_API_TOKEN, cfBaseUrl, settings.CLOUDFLARE_MODEL, 'ARCHITECT_TIER')
    );
  }

  for (const key of settings.NVIDIA_NIM_API_KEYS || []) {
    architectEndpoints.push(
      new Endpoint('NVIDIA_NIM', key, 'https://integrate.api.nvidia.com/v1', settings.NVIDIA_NIM_MODEL, 'ARCHITECT_TIER')
    );
  }

  // =========================================================================
  // STUFE 4: UNBEGRENZTER FALLBACK-POOL (OpenRouter, Zhipu AI & SiliconFlow)
  // =========================================================================
  for (const key of settings.OPENROUTER_API_KEYS || []) {
    if (settings.OPENROUTER_FAST_MODEL) {
      fastEndpoints.push(
        new Endpoint('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_FAST_MODEL, 'FAST_TIER')
      );
    }
    if (settings.OPENROUTER_ARCHITECT_MODEL) {
      architectEndpoints.push(
        new Endpoint('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_ARCHITECT_MODEL, 'ARCHITECT_TIER')
      );
    }
  }

  for (const key of settings.ZHIPU_API_KEYS || []) {
    fastEndpoints.push(
      new Endpoint('ZhipuAI', key, 'https://open.bigmodel.cn/api/paas/v4', settings.ZHIPU_MODEL, 'FAST_TIER')
    );
    architectEndpoints.push(
      new Endpoint('ZhipuAI', key, 'https://open.bigmodel.cn/api/paas/v4', settings.ZHIPU_MODEL, 'ARCHITECT_TIER')
    );
  }

  for (const key of settings.SILICONFLOW_API_KEYS || []) {
    fastEndpoints.push(
      new Endpoint('SiliconFlow', key, 'https://api.siliconflow.cn/v1', settings.SILICONFLOW_MODEL, 'FAST_TIER')
    );
    architectEndpoints.push(
      new Endpoint('SiliconFlow', key, 'https://api.siliconflow.cn/v1', settings.SILICONFLOW_MODEL, 'ARCHITECT_TIER')
    );
  }

  // =========================================================================
  // ZERO-KEY EMERGENCY FALLBACK (Kilo AI Gateway & LLM7)
  // =========================================================================
  if (settings.ENABLE_ZERO_KEY_FALLBACK) {
    const kiloFast = new Endpoint('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'FAST_TIER', { isZeroKey: true });
    const kiloArch = new Endpoint('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'ARCHITECT_TIER', { isZeroKey: true });
    fastEndpoints.push(kiloFast);
    architectEndpoints.push(kiloArch);

    const llm7Fast = new Endpoint('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'FAST_TIER', { isZeroKey: true });
    const llm7Arch = new Endpoint('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'ARCHITECT_TIER', { isZeroKey: true });
    fastEndpoints.push(llm7Fast);
    architectEndpoints.push(llm7Arch);
  }

  const allEndpoints = [...new Set([...fastEndpoints, ...architectEndpoints])];
  for (const ep of allEndpoints) {
    if (!ep.capabilities) {
      const inf = inferModelCapabilities(ep.model, ep.provider);
      ep.capabilities = inf.capabilities;
      ep.isFreeTier = inf.isFreeTier;
      ep.costPer1MInput = inf.costPer1MInput;
      ep.costPer1MOutput = inf.costPer1MOutput;
      ep.tierRecommendation = inf.tierRecommendation;
    }
  }

  logger.info(`LLM Router v3.0 bereit: ${fastEndpoints.length} Fast, ${architectEndpoints.length} Architect, ${allEndpoints.length} Gesamt-Endpoints aktiv.`);

  return { fastEndpoints, architectEndpoints, allEndpoints };
}
