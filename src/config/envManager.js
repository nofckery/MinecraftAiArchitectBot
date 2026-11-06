import fs from 'node:fs';
import path from 'node:path';
import { settings, validateSettings } from './settings.js';
import { VersionResolver } from './versionResolver.js';
import { logger } from '../utils/logger.js';
import { atomicWriteFileSyncWithRetry } from '../utils/fileUtils.js';

export const VALID_EXECUTION_MODES = ['auto', 'hybrid_visual', 'rcon_visual', 'pure_physical'];
export const VALID_AUTH_MODES = ['offline', 'microsoft'];

export class EnvManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.envPath = options.envPath || path.resolve(this.rootDir, '.env');
    this.exampleEnvPath = options.exampleEnvPath || path.resolve(this.rootDir, '.env.example');
  }

  hasEnvFile(customPath = null) {
    const targetPath = customPath || this.envPath;
    return fs.existsSync(targetPath);
  }

  getCurrentSettings() {
    return {
      MC_HOST: settings.MC_HOST,
      MC_PORT: settings.MC_PORT,
      MC_USERNAME: settings.MC_USERNAME,
      MC_AUTH: settings.MC_AUTH,
      MC_VERSION: settings.MC_VERSION === false ? 'auto' : (settings.MC_VERSION || 'auto'),
      BOT_OWNER: settings.BOT_OWNER,
      BUILD_EXECUTION_MODE: settings.BUILD_EXECUTION_MODE,
      ENABLE_GREEDY_FILL_OPTIMIZATION: settings.ENABLE_GREEDY_FILL_OPTIMIZATION,
      BUILD_OPERATIONS_PER_SECOND: settings.BUILD_OPERATIONS_PER_SECOND,
      MAX_BUILD_VOLUME_DIMENSION: settings.MAX_BUILD_VOLUME_DIMENSION,
      RCON_HOST: settings.RCON_HOST,
      RCON_PORT: settings.RCON_PORT,
      RCON_PASSWORD: settings.RCON_PASSWORD,
      SURVIVAL_AUTO_PROCUREMENT: settings.SURVIVAL_AUTO_PROCUREMENT,
      SURVIVAL_STORAGE_SCAN_RADIUS: settings.SURVIVAL_STORAGE_SCAN_RADIUS,
      SURVIVAL_AUTO_CRAFTING: settings.SURVIVAL_AUTO_CRAFTING,
      SURVIVAL_AUTO_HARVESTING: settings.SURVIVAL_AUTO_HARVESTING,
      SURVIVAL_STRICT_MATERIALS: settings.SURVIVAL_STRICT_MATERIALS,
      SURVIVAL_CONTAINER_TIMEOUT_MS: settings.SURVIVAL_CONTAINER_TIMEOUT_MS,
      SURVIVAL_CONTAINER_BLACKLIST_MS: settings.SURVIVAL_CONTAINER_BLACKLIST_MS,
      SURVIVAL_THREAT_RADIUS: settings.SURVIVAL_THREAT_RADIUS,
      SURVIVAL_CRITICAL_HEALTH: settings.SURVIVAL_CRITICAL_HEALTH,
      SURVIVAL_RETREAT_DISTANCE: settings.SURVIVAL_RETREAT_DISTANCE,
      SURVIVAL_ATTACK_COOLDOWN_MS: settings.SURVIVAL_ATTACK_COOLDOWN_MS,
      BED_SEARCH_RADIUS: settings.BED_SEARCH_RADIUS,
      SLEEP_DISCONNECT_ON_NO_BED: settings.SLEEP_DISCONNECT_ON_NO_BED,
      SLEEP_RECONNECT_DELAY_SEC: settings.SLEEP_RECONNECT_DELAY_SEC,
      SINGLE_ACCOUNT_HANDOFF_MODE: settings.SINGLE_ACCOUNT_HANDOFF_MODE,
      SERVER_PING_INTERVAL_MS: settings.SERVER_PING_INTERVAL_MS,
      WEB_DASHBOARD_PORT: settings.WEB_DASHBOARD_PORT,
      PRISMARINE_VIEWER_PORT: settings.PRISMARINE_VIEWER_PORT
    };
  }

  validateConfig(config) {
    const errors = [];

    if (config.BOT_OWNER !== undefined && (!config.BOT_OWNER || typeof config.BOT_OWNER !== 'string' || !config.BOT_OWNER.trim())) {
      errors.push('BOT_OWNER darf nicht leer sein.');
    }

    if (config.MC_HOST !== undefined && (!config.MC_HOST || typeof config.MC_HOST !== 'string' || !config.MC_HOST.trim())) {
      errors.push('MC_HOST darf nicht leer sein.');
    }

    if (config.MC_PORT !== undefined) {
      const port = parseInt(config.MC_PORT, 10);
      if (Number.isNaN(port) || port < 1 || port > 65535) {
        errors.push(`Ungültiger MC_PORT: ${config.MC_PORT}. Erlaubt ist 1 - 65535.`);
      }
    }

    if (config.RCON_PORT !== undefined && config.RCON_PORT !== '') {
      const rconPort = parseInt(config.RCON_PORT, 10);
      if (Number.isNaN(rconPort) || rconPort < 1 || rconPort > 65535) {
        errors.push(`Ungültiger RCON_PORT: ${config.RCON_PORT}. Erlaubt ist 1 - 65535.`);
      }
    }

    if (config.BUILD_OPERATIONS_PER_SECOND !== undefined && config.BUILD_OPERATIONS_PER_SECOND !== '') {
      const ops = parseInt(config.BUILD_OPERATIONS_PER_SECOND, 10);
      if (Number.isNaN(ops) || ops < 1) {
        errors.push(`Ungültiger BUILD_OPERATIONS_PER_SECOND: ${config.BUILD_OPERATIONS_PER_SECOND}. Muss mindestens 1 sein.`);
      }
    }

    if (config.MC_USERNAME !== undefined && (!config.MC_USERNAME || typeof config.MC_USERNAME !== 'string' || !config.MC_USERNAME.trim())) {
      errors.push('MC_USERNAME darf nicht leer sein.');
    }

    if (config.MC_AUTH !== undefined && !VALID_AUTH_MODES.includes(String(config.MC_AUTH).trim().toLowerCase())) {
      errors.push(`Ungültiges MC_AUTH: ${config.MC_AUTH}. Erlaubt: 'offline' oder 'microsoft'.`);
    }

    if (config.MC_VERSION !== undefined && config.MC_VERSION !== null) {
      if (typeof config.MC_VERSION === 'string') {
        const trimmed = config.MC_VERSION.trim();
        if (trimmed !== '' && !VersionResolver.isValidVersion(trimmed)) {
          errors.push(`Ungültige MC_VERSION: ${config.MC_VERSION}. Erlaubt sind 'auto' oder gültige Minecraft-Versionen (z. B. '26.3', '1.21.4', '1.20.4').`);
        }
      } else if (config.MC_VERSION !== false) {
        errors.push(`Ungültige MC_VERSION: ${config.MC_VERSION}. Erlaubt sind 'auto' oder gültige Minecraft-Versionen (z. B. '26.3', '1.21.4', '1.20.4').`);
      }
    }

    if (config.BUILD_EXECUTION_MODE !== undefined && !VALID_EXECUTION_MODES.includes(String(config.BUILD_EXECUTION_MODE).trim().toLowerCase())) {
      errors.push(`Ungültiger BUILD_EXECUTION_MODE: ${config.BUILD_EXECUTION_MODE}. Erlaubt: auto, hybrid_visual, rcon_visual, pure_physical.`);
    }

    return errors;
  }

  parseEnvFile(content) {
    const result = {};
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([A-Za-z0-9_]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        // If quoted with double quotes
        if (val.startsWith('"')) {
          const endQuote = val.indexOf('"', 1);
          if (endQuote !== -1) {
            val = val.slice(1, endQuote);
          } else {
            val = val.slice(1);
          }
        } else if (val.startsWith("'")) {
          const endQuote = val.indexOf("'", 1);
          if (endQuote !== -1) {
            val = val.slice(1, endQuote);
          } else {
            val = val.slice(1);
          }
        } else {
          // Unquoted: cut at '#'
          const commentIdx = val.indexOf('#');
          if (commentIdx !== -1) {
            val = val.substring(0, commentIdx).trim();
          }
        }
        result[key] = val;
      }
    }
    return result;
  }

  saveConfig(newConfig, customEnvPath = null, customExamplePath = null) {
    const targetEnv = customEnvPath || this.envPath;
    const targetExample = customExamplePath || this.exampleEnvPath;

    const validationErrors = this.validateConfig(newConfig);
    if (validationErrors.length > 0) {
      throw new Error(`Validierungsfehler: ${validationErrors.join(', ')}`);
    }

    // Vorlage laden: existierende .env oder .env.example
    let baseContent = '';
    if (fs.existsSync(targetEnv)) {
      baseContent = fs.readFileSync(targetEnv, 'utf-8');
    } else if (fs.existsSync(targetExample)) {
      baseContent = fs.readFileSync(targetExample, 'utf-8');
    }

    let lines = baseContent.length > 0 ? baseContent.split(/\r?\n/) : [];
    const handledKeys = new Set();

    for (const [key, rawValue] of Object.entries(newConfig)) {
      if (rawValue === undefined || rawValue === null) continue;
      let strVal = String(rawValue).trim();
      handledKeys.add(key);

      // Quote if it contains '#' or spaces and isn't already quoted
      if ((strVal.includes('#') || strVal.includes(' ')) && !((strVal.startsWith('"') && strVal.endsWith('"')) || (strVal.startsWith("'") && strVal.endsWith("'")))) {
        strVal = `"${strVal.replace(/"/g, '\\"')}"`;
      }

      let lineFound = false;
      lines = lines.map(line => {
        const match = line.match(/^(\s*)([A-Za-z0-9_]+)(\s*=\s*)(.*)$/);
        if (!match || match[2] !== key) return line;

        lineFound = true;
        const prefix = `${match[1]}${key}=`;
        const rest = match[4];

        // Find comment part in old line (if any)
        let comment = '';
        if (rest.startsWith('"')) {
          const endQuote = rest.indexOf('"', 1);
          if (endQuote !== -1) {
            comment = rest.slice(endQuote + 1);
          }
        } else if (rest.startsWith("'")) {
          const endQuote = rest.indexOf("'", 1);
          if (endQuote !== -1) {
            comment = rest.slice(endQuote + 1);
          }
        } else {
          const hashIdx = rest.indexOf('#');
          if (hashIdx !== -1) {
            comment = rest.slice(hashIdx);
            const leadingSpaces = rest.slice(0, hashIdx).match(/\s+$/);
            if (leadingSpaces) {
              comment = leadingSpaces[0] + comment;
            } else {
              comment = '                        ' + comment;
            }
          }
        }

        if (comment && !comment.startsWith(' ') && !comment.startsWith('\t')) {
          comment = '   ' + comment;
        }

        return `${prefix}${strVal}${comment}`;
      });

      if (!lineFound) {
        // Wenn Key noch nicht existierte, anhängen
        lines.push(`${key}=${strVal}`);
      }
    }

    let updatedContent = lines.join('\n');
    if (!updatedContent.endsWith('\n')) {
      updatedContent += '\n';
    }

    // Atomares Schreiben (erst temporäre Datei, dann ersetzen mit Retry-Logik)
    atomicWriteFileSyncWithRetry(targetEnv, updatedContent, 'utf-8');

    // Laufzeit-Settings und process.env aktualisieren
    this.applyToRuntimeSettings(newConfig);

    logger.info(`[EnvManager] .env erfolgreich aktualisiert (${handledKeys.size} Schlüssel geschrieben).`);
    return {
      success: true,
      envPath: targetEnv,
      keysUpdated: Array.from(handledKeys)
    };
  }

  applyToRuntimeSettings(newConfig) {
    for (const [key, rawValue] of Object.entries(newConfig)) {
      if (rawValue === undefined || rawValue === null) continue;
      const strVal = String(rawValue).trim();
      process.env[key] = strVal;

      if (key === 'MC_HOST') settings.MC_HOST = strVal;
      else if (key === 'MC_PORT') settings.MC_PORT = parseInt(strVal, 10) || 25565;
      else if (key === 'MC_USERNAME') settings.MC_USERNAME = strVal;
      else if (key === 'MC_AUTH') settings.MC_AUTH = strVal;
      else if (key === 'MC_VERSION') settings.MC_VERSION = VersionResolver.normalizeVersion(strVal);
      else if (key === 'BOT_OWNER') settings.BOT_OWNER = strVal;
      else if (key === 'BUILD_EXECUTION_MODE') settings.BUILD_EXECUTION_MODE = strVal;
      else if (key === 'ENABLE_GREEDY_FILL_OPTIMIZATION') settings.ENABLE_GREEDY_FILL_OPTIMIZATION = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'BUILD_OPERATIONS_PER_SECOND') settings.BUILD_OPERATIONS_PER_SECOND = parseInt(strVal, 10) || 12;
      else if (key === 'MAX_BUILD_VOLUME_DIMENSION') settings.MAX_BUILD_VOLUME_DIMENSION = parseInt(strVal, 10) || 64;
      else if (key === 'RCON_HOST') settings.RCON_HOST = strVal;
      else if (key === 'RCON_PORT') settings.RCON_PORT = parseInt(strVal, 10) || 25575;
      else if (key === 'RCON_PASSWORD') settings.RCON_PASSWORD = strVal;
      else if (key === 'SURVIVAL_AUTO_PROCUREMENT') settings.SURVIVAL_AUTO_PROCUREMENT = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SURVIVAL_STORAGE_SCAN_RADIUS') settings.SURVIVAL_STORAGE_SCAN_RADIUS = parseInt(strVal, 10) || 32;
      else if (key === 'SURVIVAL_AUTO_CRAFTING') settings.SURVIVAL_AUTO_CRAFTING = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SURVIVAL_AUTO_HARVESTING') settings.SURVIVAL_AUTO_HARVESTING = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SURVIVAL_STRICT_MATERIALS') settings.SURVIVAL_STRICT_MATERIALS = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SURVIVAL_CONTAINER_TIMEOUT_MS') settings.SURVIVAL_CONTAINER_TIMEOUT_MS = parseInt(strVal, 10) || 4000;
      else if (key === 'SURVIVAL_CONTAINER_BLACKLIST_MS') settings.SURVIVAL_CONTAINER_BLACKLIST_MS = parseInt(strVal, 10) || 60000;
      else if (key === 'SURVIVAL_THREAT_RADIUS') settings.SURVIVAL_THREAT_RADIUS = parseInt(strVal, 10) || 12;
      else if (key === 'SURVIVAL_CRITICAL_HEALTH') settings.SURVIVAL_CRITICAL_HEALTH = parseInt(strVal, 10) || 8;
      else if (key === 'SURVIVAL_RETREAT_DISTANCE') settings.SURVIVAL_RETREAT_DISTANCE = parseInt(strVal, 10) || 15;
      else if (key === 'SURVIVAL_ATTACK_COOLDOWN_MS') settings.SURVIVAL_ATTACK_COOLDOWN_MS = parseInt(strVal, 10) || 625;
      else if (key === 'BED_SEARCH_RADIUS') settings.BED_SEARCH_RADIUS = parseInt(strVal, 10) || 32;
      else if (key === 'SLEEP_DISCONNECT_ON_NO_BED') settings.SLEEP_DISCONNECT_ON_NO_BED = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SLEEP_RECONNECT_DELAY_SEC') settings.SLEEP_RECONNECT_DELAY_SEC = parseInt(strVal, 10) || 25;
      else if (key === 'SINGLE_ACCOUNT_HANDOFF_MODE') settings.SINGLE_ACCOUNT_HANDOFF_MODE = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'SERVER_PING_INTERVAL_MS') settings.SERVER_PING_INTERVAL_MS = parseInt(strVal, 10) || 10000;
      else if (key === 'WEB_DASHBOARD_PORT') settings.WEB_DASHBOARD_PORT = parseInt(strVal, 10) || 3080;
      else if (key === 'PRISMARINE_VIEWER_PORT') settings.PRISMARINE_VIEWER_PORT = parseInt(strVal, 10) || 3081;
      else if (key === 'CEREBRAS_API_KEYS') settings.CEREBRAS_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'CEREBRAS_FAST_MODEL') settings.CEREBRAS_FAST_MODEL = strVal;
      else if (key === 'CEREBRAS_ARCHITECT_MODEL') settings.CEREBRAS_ARCHITECT_MODEL = strVal;
      else if (key === 'GROQ_API_KEYS') settings.GROQ_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'GROQ_FAST_MODEL') settings.GROQ_FAST_MODEL = strVal;
      else if (key === 'GROQ_ARCHITECT_MODEL') settings.GROQ_ARCHITECT_MODEL = strVal;
      else if (key === 'MISTRAL_API_KEYS') settings.MISTRAL_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'CODESTRAL_MODEL') settings.CODESTRAL_MODEL = strVal;
      else if (key === 'GEMINI_API_KEYS') settings.GEMINI_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'GEMINI_MODEL') settings.GEMINI_MODEL = strVal;
      else if (key === 'SAMBANOVA_API_KEYS') settings.SAMBANOVA_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'SAMBANOVA_MODEL') settings.SAMBANOVA_MODEL = strVal;
      else if (key === 'CLOUDFLARE_API_TOKEN') settings.CLOUDFLARE_API_TOKEN = strVal;
      else if (key === 'CLOUDFLARE_ACCOUNT_ID') settings.CLOUDFLARE_ACCOUNT_ID = strVal;
      else if (key === 'CLOUDFLARE_MODEL') settings.CLOUDFLARE_MODEL = strVal;
      else if (key === 'NVIDIA_NIM_API_KEYS') settings.NVIDIA_NIM_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'NVIDIA_NIM_MODEL') settings.NVIDIA_NIM_MODEL = strVal;
      else if (key === 'OPENROUTER_API_KEYS') settings.OPENROUTER_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'OPENROUTER_FAST_MODEL') settings.OPENROUTER_FAST_MODEL = strVal;
      else if (key === 'OPENROUTER_ARCHITECT_MODEL') settings.OPENROUTER_ARCHITECT_MODEL = strVal;
      else if (key === 'ZHIPU_API_KEYS') settings.ZHIPU_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'ZHIPU_MODEL') settings.ZHIPU_MODEL = strVal;
      else if (key === 'SILICONFLOW_API_KEYS') settings.SILICONFLOW_API_KEYS = strVal.split(',').map(s => s.trim()).filter(Boolean);
      else if (key === 'SILICONFLOW_MODEL') settings.SILICONFLOW_MODEL = strVal;
      else if (key === 'GITHUB_TOKEN') settings.GITHUB_TOKEN = strVal;
      else if (key === 'GITHUB_FAST_MODEL') settings.GITHUB_FAST_MODEL = strVal;
      else if (key === 'GITHUB_ARCHITECT_MODEL') settings.GITHUB_ARCHITECT_MODEL = strVal;
      else if (key === 'ENABLE_ZERO_KEY_FALLBACK') settings.ENABLE_ZERO_KEY_FALLBACK = strVal.toLowerCase() === 'true' || strVal === '1';
      else if (key === 'KILO_GATEWAY_URL') settings.KILO_GATEWAY_URL = strVal;
      else if (key === 'LLM7_GATEWAY_URL') settings.LLM7_GATEWAY_URL = strVal;
      else if (key === 'KILO_MODEL') settings.KILO_MODEL = strVal;
      else if (key === 'LLM7_MODEL') settings.LLM7_MODEL = strVal;
    }
  }
}

export const envManager = new EnvManager();
