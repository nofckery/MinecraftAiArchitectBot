import dotenv from 'dotenv';
import { VersionResolver } from './versionResolver.js';
dotenv.config();

function parseBoolean(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  return String(val).trim().toLowerCase() === 'true' || String(val).trim() === '1';
}

function parseInteger(val, defaultVal = 0) {
  if (val === undefined || val === null || val === '') return defaultVal;
  const num = parseInt(val, 10);
  return Number.isNaN(num) ? defaultVal : num;
}

function parseList(val) {
  if (!val) return [];
  return String(val)
    .split(',')
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

export const settings = {
  // Minecraft Server
  MC_HOST: process.env.MC_HOST || '127.0.0.1',
  MC_PORT: parseInteger(process.env.MC_PORT, 25565),
  MC_USERNAME: process.env.MC_USERNAME || 'BaumeisterKI',
  MC_AUTH: process.env.MC_AUTH || 'offline',
  MC_VERSION: VersionResolver.normalizeVersion(process.env.MC_VERSION),
  BOT_OWNER: process.env.BOT_OWNER || 'DeinSpielerName',

  // Survival & Resource Management
  SURVIVAL_AUTO_PROCUREMENT: parseBoolean(process.env.SURVIVAL_AUTO_PROCUREMENT, true),
  SURVIVAL_STORAGE_SCAN_RADIUS: parseInteger(process.env.SURVIVAL_STORAGE_SCAN_RADIUS, 32),
  SURVIVAL_AUTO_CRAFTING: parseBoolean(process.env.SURVIVAL_AUTO_CRAFTING, true),
  SURVIVAL_AUTO_HARVESTING: parseBoolean(process.env.SURVIVAL_AUTO_HARVESTING, false),
  SURVIVAL_STRICT_MATERIALS: parseBoolean(process.env.SURVIVAL_STRICT_MATERIALS, false),
  SURVIVAL_CONTAINER_TIMEOUT_MS: parseInteger(process.env.SURVIVAL_CONTAINER_TIMEOUT_MS, 4000),
  SURVIVAL_CONTAINER_BLACKLIST_MS: parseInteger(process.env.SURVIVAL_CONTAINER_BLACKLIST_MS, 60000),
  SURVIVAL_THREAT_RADIUS: parseInteger(process.env.SURVIVAL_THREAT_RADIUS, 12),
  SURVIVAL_CRITICAL_HEALTH: parseInteger(process.env.SURVIVAL_CRITICAL_HEALTH, 8),
  SURVIVAL_RETREAT_DISTANCE: parseInteger(process.env.SURVIVAL_RETREAT_DISTANCE, 15),
  SURVIVAL_ATTACK_COOLDOWN_MS: parseInteger(process.env.SURVIVAL_ATTACK_COOLDOWN_MS, 625),
  BED_SEARCH_RADIUS: parseInteger(process.env.BED_SEARCH_RADIUS, 32),
  SLEEP_DISCONNECT_ON_NO_BED: parseBoolean(process.env.SLEEP_DISCONNECT_ON_NO_BED, true),
  SLEEP_RECONNECT_DELAY_SEC: parseInteger(process.env.SLEEP_RECONNECT_DELAY_SEC, 25),
  SURVIVAL_SCAFFOLDING_ENABLED: parseBoolean(process.env.SURVIVAL_SCAFFOLDING_ENABLED, true),
  SURVIVAL_SCAFFOLD_BLOCKS: process.env.SURVIVAL_SCAFFOLD_BLOCKS || 'scaffolding,dirt,coarse_dirt,cobblestone,netherrack',
  SURVIVAL_MAX_REACH: parseFloat(process.env.SURVIVAL_MAX_REACH) || 3.8,

  // Execution & Server Protection
  BUILD_EXECUTION_MODE: process.env.BUILD_EXECUTION_MODE || 'auto', // 'auto' | 'hybrid_visual' | 'rcon_visual' | 'pure_physical'
  ENABLE_GREEDY_FILL_OPTIMIZATION: parseBoolean(process.env.ENABLE_GREEDY_FILL_OPTIMIZATION, true),
  BUILD_OPERATIONS_PER_SECOND: parseInteger(process.env.BUILD_OPERATIONS_PER_SECOND, 12),
  MAX_BUILD_VOLUME_DIMENSION: parseInteger(process.env.MAX_BUILD_VOLUME_DIMENSION, 64),

  // RCON
  RCON_HOST: process.env.RCON_HOST || '127.0.0.1',
  RCON_PORT: parseInteger(process.env.RCON_PORT, 25575),
  RCON_PASSWORD: process.env.RCON_PASSWORD || '',

  // --- STUFE 1: HIGH-SPEED & AGENTIC LOOPS (Cerebras & Groq) ---
  CEREBRAS_API_KEYS: parseList(process.env.CEREBRAS_API_KEYS),
  CEREBRAS_FAST_MODEL: process.env.CEREBRAS_FAST_MODEL || 'llama-3.3-70b',
  CEREBRAS_ARCHITECT_MODEL: process.env.CEREBRAS_ARCHITECT_MODEL || 'gpt-oss-120b',

  GROQ_API_KEYS: parseList(process.env.GROQ_API_KEYS),
  GROQ_FAST_MODEL: process.env.GROQ_FAST_MODEL || 'llama-3.3-70b-versatile',
  GROQ_ARCHITECT_MODEL: process.env.GROQ_ARCHITECT_MODEL || 'openai/gpt-oss-120b',

  // --- STUFE 2: DEEP CONTEXT & CODE SYNTHESIS (Mistral / Codestral & Google AI Studio) ---
  MISTRAL_API_KEYS: parseList(process.env.MISTRAL_API_KEYS),
  CODESTRAL_API_KEYS: parseList(process.env.CODESTRAL_API_KEYS),
  MISTRAL_FAST_MODEL: process.env.MISTRAL_FAST_MODEL || 'mistral-small-latest',
  MISTRAL_ARCHITECT_MODEL: process.env.MISTRAL_ARCHITECT_MODEL || 'codestral-2501',

  GEMINI_API_KEYS: parseList(process.env.GEMINI_API_KEYS),
  GEMINI_FAST_MODEL: process.env.GEMINI_FAST_MODEL || 'gemini-2.5-flash',
  // Hinweis: gemini-2.5-flash bietet 1M Kontext & hohe Quoten (im Gegensatz zu 2.5-pro mit 25 RPD im Free Tier)
  GEMINI_ARCHITECT_MODEL: process.env.GEMINI_ARCHITECT_MODEL || 'gemini-2.5-flash',

  // --- STUFE 3: HEAVY REASONING & SPEZIAL-TASKS (SambaNova, Cloudflare & NVIDIA NIM) ---
  SAMBANOVA_API_KEYS: parseList(process.env.SAMBANOVA_API_KEYS),
  SAMBANOVA_MODEL: process.env.SAMBANOVA_MODEL || 'DeepSeek-V3.1',

  CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || '',
  CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID || '',
  CLOUDFLARE_MODEL: process.env.CLOUDFLARE_MODEL || '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',

  NVIDIA_NIM_API_KEYS: parseList(process.env.NVIDIA_NIM_API_KEYS),
  NVIDIA_NIM_MODEL: process.env.NVIDIA_NIM_MODEL || 'nvidia/nemotron-3-super-120b-a12b',

  // --- STUFE 4: UNBEGRENZTER FALLBACK-POOL (OpenRouter, Zhipu AI, SiliconFlow & Zero-Key) ---
  OPENROUTER_API_KEYS: parseList(process.env.OPENROUTER_API_KEYS),
  OPENROUTER_FAST_MODEL: process.env.OPENROUTER_FAST_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
  OPENROUTER_ARCHITECT_MODEL: process.env.OPENROUTER_ARCHITECT_MODEL || 'openai/gpt-oss-120b:free',

  ZHIPU_API_KEYS: parseList(process.env.ZHIPU_API_KEYS),
  ZHIPU_MODEL: process.env.ZHIPU_MODEL || 'glm-4-flash',

  SILICONFLOW_API_KEYS: parseList(process.env.SILICONFLOW_API_KEYS),
  SILICONFLOW_MODEL: process.env.SILICONFLOW_MODEL || 'Qwen/Qwen3-8B',

  // --- GITHUB MODELS (RFC 8628 Device Flow & GITHUB_TOKEN) ---
  GITHUB_TOKEN: process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || '',
  GITHUB_FAST_MODEL: process.env.GITHUB_FAST_MODEL || 'openai/gpt-4o-mini',
  GITHUB_ARCHITECT_MODEL: process.env.GITHUB_ARCHITECT_MODEL || 'openai/gpt-4o',

  // Zero-Key Notfall-Gateways (Funktioniert sofort out-of-the-box ohne API-Key)
  ENABLE_ZERO_KEY_FALLBACK: parseBoolean(process.env.ENABLE_ZERO_KEY_FALLBACK, true),
  KILO_GATEWAY_URL: process.env.KILO_GATEWAY_URL || 'https://api.kilo.ai/api/gateway',
  LLM7_GATEWAY_URL: process.env.LLM7_GATEWAY_URL || 'https://api.llm7.io/v1',
  KILO_MODEL: process.env.KILO_MODEL || 'kilo-auto/free',
  LLM7_MODEL: process.env.LLM7_MODEL || 'turbo',

  // Mission Control Web-UI & 1-Account Session-Handoff
  WEB_DASHBOARD_PORT: parseInteger(process.env.WEB_DASHBOARD_PORT, 3080),
  PRISMARINE_VIEWER_PORT: parseInteger(process.env.PRISMARINE_VIEWER_PORT, 3081),
  SINGLE_ACCOUNT_HANDOFF_MODE: parseBoolean(process.env.SINGLE_ACCOUNT_HANDOFF_MODE, true),
  SERVER_PING_INTERVAL_MS: parseInteger(process.env.SERVER_PING_INTERVAL_MS, 10000)
};

export function validateSettings() {
  const issues = [];
  if (!['auto', 'hybrid_visual', 'rcon_visual', 'pure_physical'].includes(settings.BUILD_EXECUTION_MODE)) {
    issues.push(`Ungültiger BUILD_EXECUTION_MODE: ${settings.BUILD_EXECUTION_MODE}. Erlaubt: auto, hybrid_visual, rcon_visual, pure_physical`);
  }
  if (settings.BUILD_EXECUTION_MODE === 'rcon_visual' && !settings.RCON_PASSWORD) {
    issues.push('BUILD_EXECUTION_MODE ist "rcon_visual", aber RCON_PASSWORD ist leer.');
  }

  // Zähle konfigurierte API-Schlüssel über alle Anbieter
  const keyCount = (settings.GITHUB_TOKEN ? 1 : 0) +
                   settings.CEREBRAS_API_KEYS.length +
                   settings.GROQ_API_KEYS.length +
                   settings.MISTRAL_API_KEYS.length +
                   settings.CODESTRAL_API_KEYS.length +
                   settings.GEMINI_API_KEYS.length +
                   settings.SAMBANOVA_API_KEYS.length +
                   (settings.CLOUDFLARE_API_TOKEN ? 1 : 0) +
                   settings.NVIDIA_NIM_API_KEYS.length +
                   settings.OPENROUTER_API_KEYS.length +
                   settings.ZHIPU_API_KEYS.length +
                   settings.SILICONFLOW_API_KEYS.length;

  if (keyCount === 0) {
    if (settings.ENABLE_ZERO_KEY_FALLBACK) {
      issues.push('Keine eigenen API-Keys in .env hinterlegt. Der Bot läuft im ZERO-KEY-MODUS (Kilo AI Gateway / LLM7 Fallback). Für maximale Geschwindigkeit und Quoten empfehlen wir kostenlose Keys bei Cerebras, Groq oder Mistral.');
    } else {
      issues.push('Keine LLM-API-Keys konfiguriert und Zero-Key-Fallback deaktiviert. LLM-Funktionen stehen erst nach Eintrag in .env zur Verfügung.');
    }
  }

  // Prüfung auf abgekündigte Endpunkte
  if (settings.GROQ_FAST_MODEL?.includes('compound') || settings.GROQ_ARCHITECT_MODEL?.includes('compound')) {
    issues.push('WARNUNG: groq/compound Modelle wurden im September 2026 abgeschaltet. Verwende stattdessen llama-3.3-70b-versatile oder openai/gpt-oss-120b.');
  }

  return issues;
}
