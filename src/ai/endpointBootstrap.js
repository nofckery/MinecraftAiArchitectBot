import { settings as defaultSettings } from '../config/settings.js';
import { inferModelCapabilities } from './modelKnowledgeBase.js';

/**
 * Builds the bootstrap endpoint catalog from environment configuration and seeds keys into CredentialVault.
 *
 * @param {Object} vault - CredentialVault instance
 * @param {Object} [customSettings] - Optional settings override
 * @param {Object} [options] - Options (e.g. { maskSecret })
 * @returns {Promise<{ endpoints: Array<Object>, activeFastEndpointId: string|null, activeArchitectEndpointId: string|null }>}
 */
export async function buildBootstrapEndpoints(vault, customSettings, options = {}) {
  const settings = customSettings || defaultSettings;
  const maskFn = options.maskSecret || ((s) => (s ? '••••••••' : ''));

  const newEndpoints = [];
  let prioritySeq = 1;

  // Helper to register an endpoint and persist secret in vault
  const addEndpointFromKey = async (provider, key, baseUrl, modelId, tier, epOptions = {}) => {
    const id = `ep_${provider.toLowerCase()}_${tier.toLowerCase()}_${newEndpoints.length + 1}`;
    const credentialRef = `sec_${id}`;

    if (vault && key && key !== 'none') {
      await vault.storeSecret(credentialRef, {
        type: epOptions.authType || 'api_key',
        provider,
        token: key.trim(),
        expiresAt: null
      });
    }

    const ep = {
      id,
      name: epOptions.name || `${provider} (${modelId})`,
      provider,
      category: epOptions.category || 'cloud',
      tier,
      enabled: epOptions.enabled ?? true,
      priority: epOptions.priority ?? prioritySeq++,
      baseUrl,
      modelId,
      authType: epOptions.authType || (key === 'none' ? 'none' : 'api_key'),
      credentialRef: key && key !== 'none' ? credentialRef : '',
      temperature: epOptions.temperature ?? 0.2,
      maxTokens: epOptions.maxTokens ?? 4000,
      contextWindow: epOptions.contextWindow ?? (epOptions.category === 'local' ? 16384 : 128000),
      isThinkingModel: epOptions.isThinkingModel ?? (
        modelId.toLowerCase().includes('r1') ||
        modelId.toLowerCase().includes('reasoning') ||
        modelId.toLowerCase().includes('thinking') ||
        modelId.toLowerCase().includes('gpt-oss')
      ),
      customHeaders: epOptions.customHeaders || {},
      maskedSecret: key && key !== 'none' ? maskFn(key) : '',
      hasSecret: Boolean(key && key !== 'none'),
      isSystemDefault: true,
      status: 'untested',
      latencyMs: null,
      lastTested: null,
      quotaRemaining: null,
      lastError: null
    };

    if (epOptions.localDetails) {
      ep.localDetails = epOptions.localDetails;
    }
    if (epOptions.dailyRequestLimit) {
      ep.dailyRequestLimit = epOptions.dailyRequestLimit;
    }

    const inferred = inferModelCapabilities(modelId, provider);
    ep.capabilities = epOptions.capabilities || inferred.capabilities;
    ep.isFreeTier = epOptions.isFreeTier !== undefined ? Boolean(epOptions.isFreeTier) : inferred.isFreeTier;
    ep.costPer1MInput = epOptions.costPer1MInput ?? inferred.costPer1MInput;
    ep.costPer1MOutput = epOptions.costPer1MOutput ?? inferred.costPer1MOutput;
    ep.tierRecommendation = epOptions.tierRecommendation || inferred.tierRecommendation;
    ep.roles = Array.isArray(epOptions.roles) ? epOptions.roles : [ep.tierRecommendation];

    newEndpoints.push(ep);
  };

  // 0. GitHub Models (via GITHUB_TOKEN / GITHUB_PAT in .env)
  if (settings.GITHUB_TOKEN && settings.GITHUB_TOKEN.trim().length > 0) {
    const ghToken = settings.GITHUB_TOKEN.trim();
    if (settings.GITHUB_FAST_MODEL) {
      await addEndpointFromKey('GitHub', ghToken, 'https://models.github.ai/inference', settings.GITHUB_FAST_MODEL, 'FAST_TIER', {
        name: `GitHub Models (${settings.GITHUB_FAST_MODEL})`,
        priority: 1
      });
    }
    if (settings.GITHUB_ARCHITECT_MODEL) {
      await addEndpointFromKey('GitHub', ghToken, 'https://models.github.ai/inference', settings.GITHUB_ARCHITECT_MODEL, 'ARCHITECT_TIER', {
        name: `GitHub Models (${settings.GITHUB_ARCHITECT_MODEL})`,
        priority: 1
      });
    }
  }

  // 1. Cerebras
  if (settings.CEREBRAS_API_KEYS && settings.CEREBRAS_API_KEYS.length > 0) {
    for (const key of settings.CEREBRAS_API_KEYS) {
      if (settings.CEREBRAS_FAST_MODEL) {
        await addEndpointFromKey('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_FAST_MODEL, 'FAST_TIER', { priority: 1 });
      }
      if (settings.CEREBRAS_ARCHITECT_MODEL) {
        await addEndpointFromKey('Cerebras', key, 'https://api.cerebras.ai/v1', settings.CEREBRAS_ARCHITECT_MODEL, 'ARCHITECT_TIER', { priority: 1, isThinkingModel: true });
      }
    }
  }

  // 2. GroqCloud
  if (settings.GROQ_API_KEYS && settings.GROQ_API_KEYS.length > 0) {
    for (const key of settings.GROQ_API_KEYS) {
      if (settings.GROQ_FAST_MODEL) {
        await addEndpointFromKey('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_FAST_MODEL, 'FAST_TIER', { priority: 2 });
      }
      if (settings.GROQ_ARCHITECT_MODEL) {
        await addEndpointFromKey('Groq', key, 'https://api.groq.com/openai/v1', settings.GROQ_ARCHITECT_MODEL, 'ARCHITECT_TIER', { priority: 2 });
      }
    }
  }

  // 3. Mistral / Codestral
  if (settings.CODESTRAL_API_KEYS && settings.CODESTRAL_API_KEYS.length > 0) {
    for (const key of settings.CODESTRAL_API_KEYS) {
      await addEndpointFromKey('Codestral', key, 'https://codestral.mistral.ai/v1', 'codestral-latest', 'ARCHITECT_TIER', { priority: 3 });
    }
  }
  if (settings.MISTRAL_API_KEYS && settings.MISTRAL_API_KEYS.length > 0) {
    for (const key of settings.MISTRAL_API_KEYS) {
      if (settings.MISTRAL_FAST_MODEL) {
        await addEndpointFromKey('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_FAST_MODEL, 'FAST_TIER', { priority: 3 });
      }
      if (settings.MISTRAL_ARCHITECT_MODEL) {
        await addEndpointFromKey('Mistral', key, 'https://api.mistral.ai/v1', settings.MISTRAL_ARCHITECT_MODEL, 'ARCHITECT_TIER', { priority: 3 });
      }
    }
  }

  // 4. Google Gemini
  if (settings.GEMINI_API_KEYS && settings.GEMINI_API_KEYS.length > 0) {
    for (const key of settings.GEMINI_API_KEYS) {
      if (settings.GEMINI_FAST_MODEL) {
        await addEndpointFromKey('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_FAST_MODEL, 'FAST_TIER', { priority: 4 });
      }
      if (settings.GEMINI_ARCHITECT_MODEL) {
        await addEndpointFromKey('Gemini', key, 'https://generativelanguage.googleapis.com/v1beta/openai/', settings.GEMINI_ARCHITECT_MODEL, 'ARCHITECT_TIER', { priority: 4 });
      }
    }
  }

  // 5. SambaNova
  if (settings.SAMBANOVA_API_KEYS && settings.SAMBANOVA_API_KEYS.length > 0) {
    for (const key of settings.SAMBANOVA_API_KEYS) {
      await addEndpointFromKey('SambaNova', key, 'https://api.sambanova.ai/v1', settings.SAMBANOVA_MODEL || 'DeepSeek-V3.1', 'ARCHITECT_TIER', {
        priority: 5,
        dailyRequestLimit: 20
      });
    }
  }

  // 6. Cloudflare Workers AI
  if (settings.CLOUDFLARE_API_TOKEN) {
    const cfBase = settings.CLOUDFLARE_ACCOUNT_ID
      ? `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/ai/v1`
      : 'https://api.cloudflare.com/client/v4/ai/v1';
    await addEndpointFromKey('Cloudflare', settings.CLOUDFLARE_API_TOKEN, cfBase, settings.CLOUDFLARE_MODEL, 'ARCHITECT_TIER', { priority: 6 });
  }

  // 7. NVIDIA NIM
  if (settings.NVIDIA_NIM_API_KEYS && settings.NVIDIA_NIM_API_KEYS.length > 0) {
    for (const key of settings.NVIDIA_NIM_API_KEYS) {
      await addEndpointFromKey('NVIDIA', key, 'https://integrate.api.nvidia.com/v1', settings.NVIDIA_NIM_MODEL, 'ARCHITECT_TIER', { priority: 7 });
    }
  }

  // 8. OpenRouter
  if (settings.OPENROUTER_API_KEYS && settings.OPENROUTER_API_KEYS.length > 0) {
    for (const key of settings.OPENROUTER_API_KEYS) {
      if (settings.OPENROUTER_FAST_MODEL) {
        await addEndpointFromKey('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_FAST_MODEL, 'FAST_TIER', {
          priority: 8,
          customHeaders: { 'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot', 'X-Title': 'MC Architect Bot' }
        });
      }
      if (settings.OPENROUTER_ARCHITECT_MODEL) {
        await addEndpointFromKey('OpenRouter', key, 'https://openrouter.ai/api/v1', settings.OPENROUTER_ARCHITECT_MODEL, 'ARCHITECT_TIER', {
          priority: 8,
          customHeaders: { 'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot', 'X-Title': 'MC Architect Bot' }
        });
      }
    }
  }

  // 9. Zhipu AI
  if (settings.ZHIPU_API_KEYS && settings.ZHIPU_API_KEYS.length > 0) {
    for (const key of settings.ZHIPU_API_KEYS) {
      await addEndpointFromKey('Zhipu', key, 'https://open.bigmodel.cn/api/paas/v4', settings.ZHIPU_MODEL || 'glm-4-flash', 'FALLBACK_POOL', { priority: 9 });
    }
  }

  // 10. SiliconFlow
  if (settings.SILICONFLOW_API_KEYS && settings.SILICONFLOW_API_KEYS.length > 0) {
    for (const key of settings.SILICONFLOW_API_KEYS) {
      await addEndpointFromKey('SiliconFlow', key, 'https://api.siliconflow.cn/v1', settings.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B', 'FALLBACK_POOL', { priority: 10 });
    }
  }

  // 11. Zero-Key Gateways (Kilo AI & LLM7)
  if (settings.ENABLE_ZERO_KEY_FALLBACK) {
    await addEndpointFromKey('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'FAST_TIER', {
      name: 'Kilo AI Gateway (Free)',
      category: 'gateway',
      authType: 'none',
      priority: 99
    });
    await addEndpointFromKey('KiloAI', 'none', settings.KILO_GATEWAY_URL, settings.KILO_MODEL, 'ARCHITECT_TIER', {
      name: 'Kilo AI Gateway (Free)',
      category: 'gateway',
      authType: 'none',
      priority: 99
    });
    await addEndpointFromKey('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'FAST_TIER', {
      name: 'LLM7 Turbo Pool',
      category: 'gateway',
      authType: 'none',
      priority: 100
    });
    await addEndpointFromKey('LLM7', 'none', settings.LLM7_GATEWAY_URL, settings.LLM7_MODEL, 'ARCHITECT_TIER', {
      name: 'LLM7 Turbo Pool',
      category: 'gateway',
      authType: 'none',
      priority: 100
    });
  }

  // 12. Local Ollama Placeholder
  await addEndpointFromKey('Ollama', 'none', 'http://127.0.0.1:11434/v1', 'qwen2.5-coder:14b', 'FAST_TIER', {
    name: 'Ollama (Local qwen2.5-coder)',
    category: 'local',
    authType: 'none',
    enabled: false,
    priority: 50,
    contextWindow: 16384,
    localDetails: { engine: 'ollama', port: 11434 }
  });

  let activeFastEndpointId = null;
  let activeArchitectEndpointId = null;
  const fastPrimary = newEndpoints.find(e => e.tier === 'FAST_TIER' && e.enabled);
  const archPrimary = newEndpoints.find(e => e.tier === 'ARCHITECT_TIER' && e.enabled);
  if (fastPrimary) activeFastEndpointId = fastPrimary.id;
  if (archPrimary) activeArchitectEndpointId = archPrimary.id;

  return {
    endpoints: newEndpoints,
    activeFastEndpointId,
    activeArchitectEndpointId
  };
}
