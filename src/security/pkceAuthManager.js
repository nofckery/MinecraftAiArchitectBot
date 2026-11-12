import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import { CredentialVault } from './credentialVault.js';

/**
 * PkceAuthManager
 *
 * Implements RFC 7636 (Proof Key for Code Exchange by OAuth Public Clients)
 * specifically for OpenRouter and similar OAuth 2.0 PKCE providers.
 *
 * Flow:
 * 1. startPkceSession(options): Generates a cryptographic code_verifier (base64url)
 *    and derives code_challenge = SHA256(code_verifier). Builds the authorization URL.
 * 2. exchangeCode(sessionId, code, callbackUrl): Calls POST https://openrouter.ai/api/v1/auth/keys/code
 *    with code and code_verifier, stores the returned API key in CredentialVault,
 *    and registers/updates the OpenRouter endpoints in EndpointManager.
 */
export class PkceAuthManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {Object} [options.endpointManager]
   * @param {CredentialVault} [options.vault]
   * @param {Object} [options.llmRouter]
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.endpointManager = options.endpointManager || null;
    this.vault = options.vault || options.endpointManager?.vault || new CredentialVault();
    this.llmRouter = options.llmRouter || null;
    this.log = options.logger || logger;

    /** @type {Map<string, Object>} */
    this.sessions = new Map();
  }

  /**
   * Generates a URL-safe Base64 string without padding.
   *
   * @param {Buffer} buffer
   * @returns {string}
   */
  _base64UrlEncode(buffer) {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Generates a cryptographically random code_verifier (43-128 chars).
   *
   * @returns {string}
   */
  generateCodeVerifier() {
    return this._base64UrlEncode(crypto.randomBytes(32));
  }

  /**
   * Computes the S256 code_challenge from code_verifier.
   *
   * @param {string} verifier
   * @returns {string}
   */
  computeCodeChallenge(verifier) {
    const hash = crypto.createHash('sha256').update(verifier).digest();
    return this._base64UrlEncode(hash);
  }

  /**
   * Starts a new PKCE session for OpenRouter.
   *
   * @param {Object} [options]
   * @param {string} [options.callbackUrl] - The callback URL where OpenRouter redirects back
   * @param {string} [options.provider] - Default 'OpenRouter'
   * @returns {Object} Session details including sessionId, authUrl, codeChallenge
   */
  startSession(options = {}) {
    const provider = options.provider || 'OpenRouter';
    const callbackUrl = options.callbackUrl || 'http://localhost:3080/api/auth/openrouter/callback';
    const sessionId = `pkce_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}`;

    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.computeCodeChallenge(codeVerifier);

    const authUrl = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(callbackUrl)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=S256`;

    const session = {
      sessionId,
      provider,
      callbackUrl,
      codeVerifier,
      codeChallenge,
      authUrl,
      status: 'pending',
      createdAt: Date.now(),
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutes
    };

    this.sessions.set(sessionId, session);
    this.log?.info?.(`[PkceAuthManager] Neue PKCE-Sitzung ${sessionId} für ${provider} gestartet.`);

    return {
      success: true,
      sessionId,
      provider,
      callbackUrl,
      authUrl,
      codeChallenge
    };
  }

  /**
   * Retrieves a session by its ID.
   *
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
    }
    return session;
  }

  /**
   * Finds the most recent pending session for a provider.
   *
   * @param {string} [provider='OpenRouter']
   * @returns {Object|null}
   */
  findLatestPendingSession(provider = 'OpenRouter') {
    let latest = null;
    for (const session of this.sessions.values()) {
      if (session.provider === provider && session.status === 'pending' && Date.now() < session.expiresAt) {
        if (!latest || session.createdAt > latest.createdAt) {
          latest = session;
        }
      }
    }
    return latest;
  }

  /**
   * Exchanges an authorization code for an API key at OpenRouter.
   *
   * @param {Object} params
   * @param {string} [params.sessionId] - Session ID (optional if latest pending can be resolved)
   * @param {string} params.code - Authorization code from callback
   * @param {string} [params.callbackUrl] - Callback URL
   * @returns {Promise<Object>} Result containing apiKey, endpointId, etc.
   */
  async exchangeCode(params = {}) {
    const { code } = params;
    if (!code) {
      throw new Error('Authorization code ist erforderlich.');
    }

    let session = params.sessionId ? this.getSession(params.sessionId) : null;
    if (!session) {
      session = this.findLatestPendingSession('OpenRouter');
    }

    if (!session) {
      throw new Error('Keine aktive PKCE-Sitzung gefunden oder Sitzung abgelaufen.');
    }

    if (Date.now() > session.expiresAt) {
      session.status = 'expired';
      throw new Error('PKCE-Sitzung ist abgelaufen. Bitte erneut starten.');
    }

    const callbackUrl = params.callbackUrl || session.callbackUrl;

    this.log?.info?.(`[PkceAuthManager] Tausche Autorisierungs-Code bei OpenRouter ein (Session: ${session.sessionId})...`);

    let res;
    try {
      res = await fetch('https://openrouter.ai/api/v1/auth/keys/code', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          callback_url: callbackUrl,
          code: code.trim(),
          code_verifier: session.codeVerifier,
          code_challenge_method: 'S256'
        })
      });
    } catch (netErr) {
      this.log?.error?.(`[PkceAuthManager] Netzwerkfehler beim Token-Tausch: ${netErr.message}`);
      throw new Error(`Netzwerkfehler beim Token-Tausch: ${netErr.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.log?.error?.(`[PkceAuthManager] OpenRouter Token-Tausch fehlgeschlagen (HTTP ${res.status}): ${errText}`);
      throw new Error(`OpenRouter Token-Tausch fehlgeschlagen (${res.status}): ${errText}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error(`Ungültige JSON-Antwort von OpenRouter: ${parseErr.message}`);
    }

    const apiKey = data.key || data.api_key;
    if (!apiKey) {
      throw new Error(`OpenRouter lieferte keinen API-Schlüssel zurück: ${JSON.stringify(data)}`);
    }

    session.status = 'success';
    session.apiKey = apiKey;

    // Persist in CredentialVault and EndpointManager
    await this._handleSuccess(session, apiKey);

    return {
      success: true,
      provider: 'OpenRouter',
      sessionId: session.sessionId,
      endpointId: session.endpointId
    };
  }

  /**
   * Persists the retrieved API key into CredentialVault and updates EndpointManager.
   *
   * @param {Object} session
   * @param {string} apiKey
   * @private
   */
  async _handleSuccess(session, apiKey) {
    const credentialRef = 'sec_openrouter';

    // 1. Vault Storage
    if (this.vault) {
      await this.vault.storeSecret(credentialRef, {
        type: 'oauth_pkce',
        provider: 'OpenRouter',
        token: apiKey.trim(),
        expiresAt: null
      });
    }

    // 2. EndpointManager registration
    let endpointId = 'ep_openrouter_fast';
    if (this.endpointManager) {
      const all = typeof this.endpointManager.getAllEndpoints === 'function'
        ? this.endpointManager.getAllEndpoints()
        : [];

      // 2a. Fast Tier (Llama 3.3 70B Free)
      const existingFast = all.find(e =>
        e.id === 'ep_openrouter_fast' ||
        (e.provider === 'OpenRouter' && e.tier === 'FAST_TIER')
      );

      if (existingFast) {
        endpointId = existingFast.id;
        await this.endpointManager.updateEndpoint(existingFast.id, {
          enabled: true,
          authType: 'oauth_pkce',
          credentialRef,
          baseUrl: 'https://openrouter.ai/api/v1',
          modelId: existingFast.modelId || 'meta-llama/llama-3.3-70b-instruct:free',
          customHeaders: {
            'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot',
            'X-Title': 'MC Architect Bot'
          }
        }, apiKey);
      } else {
        const created = await this.endpointManager.createEndpoint({
          id: 'ep_openrouter_fast',
          name: 'OpenRouter (Llama 3.3 Free)',
          provider: 'OpenRouter',
          category: 'cloud',
          tier: 'FAST_TIER',
          enabled: true,
          priority: 2,
          baseUrl: 'https://openrouter.ai/api/v1',
          modelId: 'meta-llama/llama-3.3-70b-instruct:free',
          authType: 'oauth_pkce',
          credentialRef,
          temperature: 0.2,
          maxTokens: 4000,
          contextWindow: 128000,
          isThinkingModel: false,
          customHeaders: {
            'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot',
            'X-Title': 'MC Architect Bot'
          }
        }, apiKey);
        endpointId = created.id;
      }

      // 2b. Architect Tier (Qwen 2.5 Coder 32B Free / DeepSeek R1 Free)
      const existingArch = all.find(e =>
        e.id === 'ep_openrouter_architect' ||
        (e.provider === 'OpenRouter' && e.tier === 'ARCHITECT_TIER')
      );

      if (existingArch) {
        await this.endpointManager.updateEndpoint(existingArch.id, {
          enabled: true,
          authType: 'oauth_pkce',
          credentialRef,
          baseUrl: 'https://openrouter.ai/api/v1',
          modelId: existingArch.modelId || 'qwen/qwen-2.5-coder-32b-instruct:free',
          customHeaders: {
            'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot',
            'X-Title': 'MC Architect Bot'
          }
        }, apiKey);
      } else {
        await this.endpointManager.createEndpoint({
          id: 'ep_openrouter_architect',
          name: 'OpenRouter (Qwen 2.5 Coder Free)',
          provider: 'OpenRouter',
          category: 'cloud',
          tier: 'ARCHITECT_TIER',
          enabled: true,
          priority: 2,
          baseUrl: 'https://openrouter.ai/api/v1',
          modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
          authType: 'oauth_pkce',
          credentialRef,
          temperature: 0.2,
          maxTokens: 4500,
          contextWindow: 128000,
          isThinkingModel: false,
          customHeaders: {
            'HTTP-Referer': 'https://github.com/nofckery/MinecraftAiArchitectBot',
            'X-Title': 'MC Architect Bot'
          }
        }, apiKey);
      }

      // 3. Hot-Reload Pools in LLMRouter
      if (this.llmRouter) {
        await this.llmRouter.reloadPools(this.endpointManager);
      }
    }

    session.endpointId = endpointId;
    this.log?.info?.(`[PkceAuthManager] OpenRouter erfolgreich über OAuth PKCE autorisiert!`);
    this.emit('authenticated', {
      sessionId: session.sessionId,
      provider: 'OpenRouter',
      endpointId
    });
  }

  /**
   * Cleans up expired sessions.
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now > session.expiresAt) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Destroys all session tracking.
   */
  destroy() {
    this.sessions.clear();
  }
}
