/**
 * Model Knowledge Base & Capability Matrix for LLM Routing v3.0
 * Contains curated benchmark scores, pricing, context sizes, and heuristic analysis
 * for dynamically discovered models across all major AI providers.
 */

export const TASK_ROLES = {
  NANO_CHAT: 'NANO_CHAT',
  PLANNER_JSON: 'PLANNER_JSON',
  ARCHITECT_CODE: 'ARCHITECT_CODE',
  REGION_DIFF: 'REGION_DIFF',
  SELF_HEAL_REASONING: 'SELF_HEAL_REASONING'
};

export const ROUTING_PROFILES = {
  ECO: 'eco',
  BALANCED: 'balanced',
  QUALITY: 'quality'
};

/**
 * Curated knowledge database for known popular models.
 * Capabilities are rated on a 0-100 scale.
 * Pricing is expressed in USD per 1 Million tokens.
 */
export const KNOWN_MODELS = {
  // Google Gemini Family
  'gemini-2.5-flash-lite': {
    name: 'Gemini 2.5 Flash-Lite',
    provider: 'Gemini',
    contextWindow: 1048576,
    maxTokens: 65536,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.075,
    costPer1MOutput: 0.30,
    capabilities: { code: 74, reasoning: 72, speed: 98, json: 92 },
    tierRecommendation: TASK_ROLES.NANO_CHAT
  },
  'gemini-2.5-flash': {
    name: 'Gemini 2.5 Flash',
    provider: 'Gemini',
    contextWindow: 1048576,
    maxTokens: 65536,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    capabilities: { code: 88, reasoning: 86, speed: 94, json: 98 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'gemini-2.0-flash': {
    name: 'Gemini 2.0 Flash',
    provider: 'Gemini',
    contextWindow: 1048576,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.40,
    capabilities: { code: 84, reasoning: 82, speed: 95, json: 96 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'gemini-2.5-pro': {
    name: 'Gemini 2.5 Pro (Thinking)',
    provider: 'Gemini',
    contextWindow: 2097152,
    maxTokens: 65536,
    isFreeTier: false,
    isThinkingModel: true,
    costPer1MInput: 1.25,
    costPer1MOutput: 5.00,
    capabilities: { code: 96, reasoning: 98, speed: 65, json: 97 },
    tierRecommendation: TASK_ROLES.SELF_HEAL_REASONING
  },

  // Mistral & Codestral Family
  'codestral-2501': {
    name: 'Codestral 2501',
    provider: 'Mistral',
    contextWindow: 256000,
    maxTokens: 8192,
    isFreeTier: false,
    isThinkingModel: false,
    costPer1MInput: 0.30,
    costPer1MOutput: 0.90,
    capabilities: { code: 97, reasoning: 90, speed: 85, json: 94 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },
  'codestral-latest': {
    name: 'Codestral Latest',
    provider: 'Mistral',
    contextWindow: 256000,
    maxTokens: 8192,
    isFreeTier: false,
    isThinkingModel: false,
    costPer1MInput: 0.30,
    costPer1MOutput: 0.90,
    capabilities: { code: 96, reasoning: 89, speed: 85, json: 94 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },
  'mistral-small-latest': {
    name: 'Mistral Small Latest',
    provider: 'Mistral',
    contextWindow: 128000,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.10,
    costPer1MOutput: 0.30,
    capabilities: { code: 82, reasoning: 80, speed: 92, json: 93 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },

  // GitHub Models / OpenAI Family
  'openai/gpt-4o': {
    name: 'GPT-4o (GitHub Models)',
    provider: 'GitHub',
    contextWindow: 128000,
    maxTokens: 4096,
    isFreeTier: true, // Free on GitHub Models tier limits
    isThinkingModel: false,
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    capabilities: { code: 95, reasoning: 94, speed: 82, json: 98 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },
  'openai/gpt-4o-mini': {
    name: 'GPT-4o-mini (GitHub Models)',
    provider: 'GitHub',
    contextWindow: 128000,
    maxTokens: 4096,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    capabilities: { code: 85, reasoning: 82, speed: 95, json: 96 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'gpt-4o': {
    name: 'OpenAI GPT-4o',
    provider: 'OpenAI',
    contextWindow: 128000,
    maxTokens: 4096,
    isFreeTier: false,
    isThinkingModel: false,
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    capabilities: { code: 95, reasoning: 94, speed: 82, json: 98 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },
  'gpt-4o-mini': {
    name: 'OpenAI GPT-4o-mini',
    provider: 'OpenAI',
    contextWindow: 128000,
    maxTokens: 4096,
    isFreeTier: false,
    isThinkingModel: false,
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    capabilities: { code: 85, reasoning: 82, speed: 95, json: 96 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'o3-mini': {
    name: 'OpenAI o3-mini',
    provider: 'OpenAI',
    contextWindow: 200000,
    maxTokens: 65536,
    isFreeTier: false,
    isThinkingModel: true,
    costPer1MInput: 1.10,
    costPer1MOutput: 4.40,
    capabilities: { code: 97, reasoning: 98, speed: 70, json: 95 },
    tierRecommendation: TASK_ROLES.SELF_HEAL_REASONING
  },

  // Cerebras / Groq LPU Models
  'llama-3.3-70b': {
    name: 'Llama 3.3 70B (Cerebras Ultra-Speed)',
    provider: 'Cerebras',
    contextWindow: 128000,
    maxTokens: 8192,
    isFreeTier: true, // 1M free daily tokens on Cerebras
    isThinkingModel: false,
    costPer1MInput: 0.60,
    costPer1MOutput: 0.60,
    capabilities: { code: 88, reasoning: 87, speed: 100, json: 92 },
    tierRecommendation: TASK_ROLES.REGION_DIFF
  },
  'llama-3.3-70b-versatile': {
    name: 'Llama 3.3 70B Versatile (Groq)',
    provider: 'Groq',
    contextWindow: 128000,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.59,
    costPer1MOutput: 0.79,
    capabilities: { code: 88, reasoning: 87, speed: 99, json: 93 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'llama-3.1-8b-instant': {
    name: 'Llama 3.1 8B Instant (Groq)',
    provider: 'Groq',
    contextWindow: 128000,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.05,
    costPer1MOutput: 0.08,
    capabilities: { code: 70, reasoning: 68, speed: 100, json: 88 },
    tierRecommendation: TASK_ROLES.NANO_CHAT
  },

  // DeepSeek Family
  'deepseek/deepseek-r1:free': {
    name: 'DeepSeek R1 (OpenRouter Free)',
    provider: 'OpenRouter',
    contextWindow: 64000,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: true,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
    capabilities: { code: 96, reasoning: 99, speed: 50, json: 90 },
    tierRecommendation: TASK_ROLES.SELF_HEAL_REASONING
  },
  'deepseek-r1': {
    name: 'DeepSeek R1',
    provider: 'DeepSeek',
    contextWindow: 64000,
    maxTokens: 8192,
    isFreeTier: false,
    isThinkingModel: true,
    costPer1MInput: 0.55,
    costPer1MOutput: 2.19,
    capabilities: { code: 97, reasoning: 99, speed: 52, json: 90 },
    tierRecommendation: TASK_ROLES.SELF_HEAL_REASONING
  },
  'deepseek-ai/DeepSeek-V3': {
    name: 'DeepSeek V3',
    provider: 'DeepSeek',
    contextWindow: 64000,
    maxTokens: 8192,
    isFreeTier: false,
    isThinkingModel: false,
    costPer1MInput: 0.27,
    costPer1MOutput: 1.10,
    capabilities: { code: 94, reasoning: 93, speed: 80, json: 95 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },

  // Qwen Local & Cloud
  'qwen2.5-coder:14b': {
    name: 'Qwen 2.5 Coder 14B (Local)',
    provider: 'Ollama',
    contextWindow: 16384,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
    capabilities: { code: 91, reasoning: 85, speed: 80, json: 92 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },
  'qwen/qwen-2.5-coder-32b-instruct:free': {
    name: 'Qwen 2.5 Coder 32B (OpenRouter Free)',
    provider: 'OpenRouter',
    contextWindow: 32768,
    maxTokens: 8192,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
    capabilities: { code: 94, reasoning: 89, speed: 78, json: 93 },
    tierRecommendation: TASK_ROLES.ARCHITECT_CODE
  },

  // Zero-Key Emergency Gateways
  'kilo-auto/free': {
    name: 'Kilo AI Gateway (Free)',
    provider: 'KiloAI',
    contextWindow: 128000,
    maxTokens: 4000,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
    capabilities: { code: 78, reasoning: 75, speed: 85, json: 88 },
    tierRecommendation: TASK_ROLES.PLANNER_JSON
  },
  'turbo': {
    name: 'LLM7 Turbo Pool',
    provider: 'LLM7',
    contextWindow: 128000,
    maxTokens: 4000,
    isFreeTier: true,
    isThinkingModel: false,
    costPer1MInput: 0.00,
    costPer1MOutput: 0.00,
    capabilities: { code: 76, reasoning: 74, speed: 88, json: 86 },
    tierRecommendation: TASK_ROLES.NANO_CHAT
  }
};

/**
 * Heuristically infers capabilities and metadata for dynamically discovered or unknown models.
 * Uses naming conventions (e.g. -lite, -coder, -r1, 70b) and provider traits.
 *
 * @param {string} modelId
 * @param {string} [provider='Custom']
 * @returns {Object} Estimated model metadata
 */
export function inferModelCapabilities(modelId, provider = 'Custom') {
  if (!modelId) {
    return {
      name: 'Default Model',
      provider,
      contextWindow: 32768,
      maxTokens: 4000,
      isFreeTier: false,
      isThinkingModel: false,
      costPer1MInput: 0.50,
      costPer1MOutput: 1.50,
      capabilities: { code: 70, reasoning: 70, speed: 70, json: 70 },
      tierRecommendation: TASK_ROLES.NANO_CHAT
    };
  }

  // Exact match from knowledge base
  const cleanId = modelId.trim();
  if (KNOWN_MODELS[cleanId]) {
    return { ...KNOWN_MODELS[cleanId] };
  }

  // Substring match check in knowledge base
  for (const [key, meta] of Object.entries(KNOWN_MODELS)) {
    if (cleanId.toLowerCase() === key.toLowerCase() || cleanId.endsWith(`/${key}`)) {
      return { ...meta, name: meta.name || modelId };
    }
  }

  const idLower = cleanId.toLowerCase();
  const provLower = (provider || '').toLowerCase();

  // Heuristic trait detection
  const isCoder = idLower.includes('coder') || idLower.includes('code') || idLower.includes('dev');
  const isReasoning = idLower.includes('r1') || idLower.includes('reason') || idLower.includes('thinking') ||
                      idLower.includes('o1') || idLower.includes('o3') || idLower.includes('nemotron');
  const isLite = idLower.includes('lite') || idLower.includes('nano') || idLower.includes('micro') ||
                 idLower.includes('instant') || idLower.includes('mini') || idLower.includes('flash-lite');
  const isFlash = idLower.includes('flash') || idLower.includes('turbo') || idLower.includes('fast');
  const isLarge = idLower.includes('70b') || idLower.includes('120b') || idLower.includes('pro') ||
                  idLower.includes('large') || idLower.includes('plus') || idLower.includes('max');
  const isFree = idLower.includes(':free') || provLower.includes('kilo') || provLower.includes('llm7') ||
                 provLower.includes('ollama') || (provLower.includes('gemini') && (isFlash || isLite));

  // Determine scores (0 - 100)
  let code = isCoder ? 95 : (isLarge ? 88 : (isReasoning ? 90 : 75));
  let reasoning = isReasoning ? 96 : (isLarge ? 90 : (isLite ? 72 : 80));
  let speed = (isLite || isFlash) ? 95 : (isReasoning ? 55 : (isLarge ? 70 : 85));
  let json = isLarge ? 95 : ((isFlash || isCoder) ? 92 : 85);

  let costPer1MInput = isFree ? 0.0 : (isLarge ? 2.50 : (isLite ? 0.10 : 0.40));
  let costPer1MOutput = isFree ? 0.0 : (isLarge ? 7.50 : (isLite ? 0.30 : 1.20));

  let contextWindow = 128000;
  if (provLower.includes('gemini')) contextWindow = 1048576;
  if (provLower.includes('ollama')) contextWindow = 16384;
  if (isLite) contextWindow = 32768;

  let tierRecommendation = TASK_ROLES.NANO_CHAT;
  if (isReasoning) {
    tierRecommendation = TASK_ROLES.SELF_HEAL_REASONING;
  } else if (isCoder) {
    tierRecommendation = TASK_ROLES.ARCHITECT_CODE;
  } else if (isFlash && !isLite) {
    tierRecommendation = TASK_ROLES.PLANNER_JSON;
  } else if (isLarge) {
    tierRecommendation = TASK_ROLES.REGION_DIFF;
  }

  return {
    name: modelId,
    provider,
    contextWindow,
    maxTokens: isReasoning ? 16384 : 4096,
    isFreeTier: isFree,
    isThinkingModel: isReasoning,
    costPer1MInput,
    costPer1MOutput,
    capabilities: { code, reasoning, speed, json },
    tierRecommendation
  };
}

/**
 * Calculates a match score for a model for a specific task role and routing profile.
 * Higher score = higher priority.
 *
 * @param {Object} model - Model metadata with capabilities, pricing, status
 * @param {string} role - TASK_ROLES value
 * @param {string} [profile='eco'] - ROUTING_PROFILES value
 * @returns {number} Score (higher is better)
 */
export function computeRoleScore(model, role, profile = ROUTING_PROFILES.ECO) {
  if (!model) return -Infinity;
  if (model.enabled === false) return -Infinity;

  // Active cooldown disqualifies model from immediate selection
  if (model.cooldownUntil && model.cooldownUntil > Date.now()) {
    return -Infinity;
  }

  const caps = model.capabilities || { code: 70, reasoning: 70, speed: 70, json: 70 };
  let fitScore = 0;

  switch (role) {
    case TASK_ROLES.NANO_CHAT:
      // Focus on speed and base communication
      fitScore = (caps.speed * 0.55) + (caps.reasoning * 0.25) + (caps.json * 0.20);
      break;

    case TASK_ROLES.PLANNER_JSON:
      // Focus on structured JSON and stability
      fitScore = (caps.json * 0.50) + (caps.reasoning * 0.30) + (caps.speed * 0.20);
      break;

    case TASK_ROLES.ARCHITECT_CODE:
      // Focus on code precision & spatial reasoning
      fitScore = (caps.code * 0.60) + (caps.reasoning * 0.25) + (caps.json * 0.15);
      break;

    case TASK_ROLES.REGION_DIFF:
      // Focus on code diffing, context comprehension & speed
      fitScore = (caps.code * 0.45) + (caps.reasoning * 0.30) + (caps.speed * 0.25);
      break;

    case TASK_ROLES.SELF_HEAL_REASONING:
      // Focus on deep reasoning (Chain-of-thought) & code correction
      fitScore = (caps.reasoning * 0.55) + (caps.code * 0.35) + (caps.json * 0.10);
      if (model.isThinkingModel) fitScore += 15;
      break;

    default:
      fitScore = (caps.speed + caps.code + caps.reasoning + caps.json) / 4;
  }

  // Tier recommendation bonus: models specially tuned or designated for this role get a priority bonus
  if (model.tierRecommendation === role || (Array.isArray(model.roles) && model.roles.includes(role))) {
    fitScore += 12;
  }

  // Cost scoring: Free-tier gets high bonus, and lower cost per 1M tokens scores higher
  const avgCost = ((model.costPer1MInput || 0) + (model.costPer1MOutput || 0)) / 2;
  const baseCostScore = Math.max(0, 100 - (avgCost * 20));
  const costScore = model.isFreeTier ? (50 + baseCostScore * 0.5) : baseCostScore;

  let finalScore = 0;
  if (profile === ROUTING_PROFILES.ECO) {
    // 60% Cost/Free-tier priority, 40% capability fit
    const freeTierBonus = model.isFreeTier ? 40 : 0;
    finalScore = (costScore * 0.6) + (fitScore * 0.4) + freeTierBonus;
  } else if (profile === ROUTING_PROFILES.QUALITY) {
    // 80% Capability fit, 20% Cost
    finalScore = (fitScore * 0.8) + (costScore * 0.2);
  } else {
    // Balanced: 50% Capability, 50% Cost
    const freeTierBonus = model.isFreeTier ? 15 : 0;
    finalScore = (fitScore * 0.5) + (costScore * 0.5) + freeTierBonus;
  }

  // Apply penalty if recent error was recorded
  if (model.lastError && (Date.now() - (model.lastTestedTimestamp || 0)) < 120000) {
    finalScore -= 20;
  }

  return finalScore;
}
