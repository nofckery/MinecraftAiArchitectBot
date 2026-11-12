import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { registerDeviceFlowEndpoints } from './deviceFlowEndpoints.js';
import { CredentialVault } from './credentialVault.js';
import { logger } from '../utils/logger.js';

/**
 * DeviceFlowManager
 *
 * Implements RFC 8628 (OAuth 2.0 Device Authorization Grant) for GitHub Models.
 * Manages device flow sessions, asynchronous token polling with dynamic slow_down backoff,
 * terminal state handling, automated vault storage, and EndpointManager registration.
 */
export class DeviceFlowManager extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {EndpointManager} [options.endpointManager]
   * @param {CredentialVault} [options.vault]
   * @param {LLMRouter} [options.llmRouter]
   * @param {string} [options.clientId]
   * @param {string} [options.scope]
   * @param {string} [options.deviceCodeUrl]
   * @param {string} [options.tokenUrl]
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    super();
    this.endpointManager = options.endpointManager || null;
    this.vault = options.vault || options.endpointManager?.vault || new CredentialVault();
    this.llmRouter = options.llmRouter || null;
    this.log = options.logger || logger;

    this.provider = options.provider || 'GitHub';
    this.clientId = options.clientId || process.env.GITHUB_CLIENT_ID || '178c6fc778ccc68e1d6a';
    this.scope = options.scope !== undefined ? options.scope : (process.env.GITHUB_DEVICE_SCOPE || 'read:user');
    this.deviceCodeUrl = options.deviceCodeUrl || process.env.GITHUB_DEVICE_CODE_URL || 'https://github.com/login/device/code';
    this.tokenUrl = options.tokenUrl || process.env.GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token';

    /** @type {Map<string, Object>} */
    this.sessions = new Map();
  }

  /**
   * Initiates a new RFC 8628 device flow session with GitHub (or mock OAuth server).
   *
   * @param {Object} [options]
   * @param {string} [options.clientId]
   * @param {string} [options.scope]
   * @param {string} [options.deviceCodeUrl]
   * @param {string} [options.tokenUrl]
   * @returns {Promise<Object>} Session info with userCode, verificationUri, etc.
   */
  async startDeviceFlow(options = {}) {
    const provider = options.provider || this.provider || 'GitHub';
    let clientId = options.clientId || this.clientId;
    let scope = options.scope !== undefined ? options.scope : this.scope;
    let deviceCodeUrl = options.deviceCodeUrl || this.deviceCodeUrl;
    let tokenUrl = options.tokenUrl || this.tokenUrl;
    let defaultVerificationUri = 'https://github.com/login/device';

    if (provider.toLowerCase() === 'huggingface' || provider.toLowerCase() === 'hf') {
      clientId = options.clientId || process.env.HUGGINGFACE_CLIENT_ID || 'mc-architect-bot';
      scope = options.scope !== undefined ? options.scope : 'inference-api';
      deviceCodeUrl = options.deviceCodeUrl || 'https://huggingface.co/oauth/device';
      tokenUrl = options.tokenUrl || 'https://huggingface.co/oauth/token';
      defaultVerificationUri = 'https://huggingface.co/device';
    }

    const payload = {
      client_id: clientId
    };
    if (scope) {
      payload.scope = scope;
    }

    let res;
    try {
      res = await fetch(deviceCodeUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (netErr) {
      this.log?.error?.(`[DeviceFlowManager] Netzwerkfehler beim Aufruf von ${deviceCodeUrl}: ${netErr.message}`);
      throw new Error(`Device code request failed: ${netErr.message}`);
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.log?.error?.(`[DeviceFlowManager] HTTP ${res.status} von ${deviceCodeUrl}: ${errText}`);
      throw new Error(`Device code request failed with HTTP ${res.status}: ${errText}`);
    }

    let data;
    try {
      data = await res.json();
    } catch (parseErr) {
      throw new Error(`Invalid JSON response from device code endpoint: ${parseErr.message}`);
    }

    if (data.error) {
      throw new Error(data.error_description || data.error);
    }

    const sessionId = `devflow_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex')}`;
    const expiresIn = Number(data.expires_in) || 900;
    const interval = Math.max(1, Number(data.interval) || 5);
    const userCode = data.user_code || '';
    const verificationUri = data.verification_uri || defaultVerificationUri;
    const verificationUriComplete = data.verification_uri_complete || `${verificationUri}?user_code=${encodeURIComponent(userCode)}`;

    const session = {
      sessionId,
      provider,
      clientId,
      tokenUrl,
      deviceCode: data.device_code,
      userCode,
      verificationUri,
      verificationUriComplete,
      expiresIn,
      expiresAt: Date.now() + expiresIn * 1000,
      interval,
      status: 'pending',
      endpointId: null,
      error: null,
      createdAt: Date.now(),
      timerId: null,
      pollCount: 0
    };

    this.sessions.set(sessionId, session);

    // Start background polling loop
    this._schedulePoll(sessionId, session.interval * 1000);

    return {
      success: true,
      sessionId: session.sessionId,
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      verificationUriComplete: session.verificationUriComplete,
      expiresIn: session.expiresIn,
      interval: session.interval
    };
  }

  /**
   * Alias for startDeviceFlow.
   */
  async startSession(options = {}) {
    return this.startDeviceFlow(options);
  }

  /**
   * Schedules next poll for a session after delayMs.
   *
   * @param {string} sessionId
   * @param {number} delayMs
   * @private
   */
  _schedulePoll(sessionId, delayMs) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'pending') return;

    if (session.timerId) {
      clearTimeout(session.timerId);
    }
    session.timerId = setTimeout(() => {
      this._poll(sessionId).catch(err => {
        this.log?.error?.(`[DeviceFlowManager] Unerwarteter Fehler im Polling-Loop für ${sessionId}: ${err.message}`);
      });
    }, Math.max(10, delayMs));
  }

  /**
   * Internal polling execution against token endpoint.
   *
   * @param {string} sessionId
   * @private
   */
  async _poll(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'pending') return;

    if (Date.now() >= session.expiresAt) {
      session.status = 'expired';
      session.error = 'Device flow session has expired.';
      this.emit('device_auth_expired', { sessionId, error: session.error });
      return;
    }

    session.pollCount++;

    try {
      const res = await fetch(session.tokenUrl || this.tokenUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: session.clientId || this.clientId,
          device_code: session.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
        })
      });

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        // Transient error or malformed body; retry on next interval
        this._schedulePoll(sessionId, session.interval * 1000);
        return;
      }

      if (data.error === 'authorization_pending') {
        // User has not yet completed flow; continue polling
        this._schedulePoll(sessionId, session.interval * 1000);
        return;
      }

      if (data.error === 'slow_down') {
        // RFC 8628 §3.5: Must increase interval by at least +5 seconds
        session.interval = (session.interval || 5) + 5;
        if (data.interval && Number(data.interval) > session.interval) {
          session.interval = Number(data.interval);
        }
        this.log?.info?.(`[DeviceFlowManager] slow_down empfangen. Neues Intervall: ${session.interval}s`);
        this._schedulePoll(sessionId, session.interval * 1000);
        return;
      }

      if (data.error === 'expired_token') {
        session.status = 'expired';
        session.error = data.error_description || 'The device code has expired.';
        this.emit('device_auth_expired', { sessionId, error: session.error });
        return;
      }

      if (data.error === 'access_denied') {
        session.status = 'denied';
        session.error = data.error_description || 'The user has denied the authorization request.';
        this.emit('device_auth_denied', { sessionId, error: session.error });
        return;
      }

      if (data.error) {
        session.status = 'error';
        session.error = data.error_description || data.error;
        this.emit('device_auth_error', { sessionId, error: session.error });
        return;
      }

      if (data.access_token) {
        await this._handleSuccess(session, data.access_token);
        return;
      }

      // Fallback: Continue polling if token not yet provided
      this._schedulePoll(sessionId, session.interval * 1000);
    } catch (netErr) {
      this.log?.warn?.(`[DeviceFlowManager] Temporärer Netzwerkfehler bei Poll (#${session.pollCount}): ${netErr.message}`);
      if (Date.now() < session.expiresAt) {
        this._schedulePoll(sessionId, session.interval * 1000);
      } else {
        session.status = 'error';
        session.error = netErr.message;
        this.emit('device_auth_error', { sessionId, error: netErr.message });
      }
    }
  }

  /**
   * Handles successful access_token retrieval:
   * stores secret in vault, registers endpoint in EndpointManager,
   * triggers llmRouter reload, and emits events.
   *
   * @param {Object} session
   * @param {string} accessToken
   * @private
   */
  async _handleSuccess(session, accessToken) {
    session.status = 'success';
    session.accessToken = accessToken;
    const provider = session.provider || 'GitHub';

    const result = await registerDeviceFlowEndpoints({
      vault: this.vault,
      endpointManager: this.endpointManager,
      llmRouter: this.llmRouter,
      provider,
      accessToken,
      log: this.log
    });

    session.endpointId = result.endpointId;

    const payload = {
      sessionId: session.sessionId,
      endpointId: result.endpointId,
      provider: result.provider,
      model: result.model
    };

    this.log?.info?.(`[DeviceFlowManager] ${payload.provider} Models erfolgreich autorisiert (Endpoint: ${result.endpointId}).`);
    this.emit('authenticated', { ...payload, token: accessToken });
    this.emit('device_auth_success', payload);
  }

  /**
   * Retrieves status of a device flow session.
   *
   * @param {string} sessionId
   * @returns {Object|null}
   */
  getSessionStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    const expiresInRemaining = Math.max(0, Math.round((session.expiresAt - Date.now()) / 1000));
    const result = {
      status: session.status,
      sessionId: session.sessionId,
      interval: session.interval,
      expiresInRemaining
    };

    if (session.status === 'success') {
      result.endpointId = session.endpointId;
      result.provider = session.provider || 'GitHub';
      result.model = (session.provider === 'HuggingFace') ? 'meta-llama/Llama-3.3-70B-Instruct:fastest' : 'openai/gpt-4o';
    } else if (session.error) {
      result.error = session.error;
    }

    return result;
  }

  /**
   * Alias for getSessionStatus.
   */
  getSession(sessionId) {
    return this.getSessionStatus(sessionId);
  }

  /**
   * Cancels an active polling session and stops timers.
   *
   * @param {string} sessionId
   * @returns {boolean} True if cancelled, false if not found
   */
  cancelSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.timerId) {
      clearTimeout(session.timerId);
      session.timerId = null;
    }
    session.status = 'cancelled';
    this.emit('device_auth_cancelled', { sessionId });
    return true;
  }

  /**
   * Purges expired or finished sessions older than lifetime.
   */
  cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (session.status !== 'pending' && (now - session.createdAt > 900000)) {
        if (session.timerId) clearTimeout(session.timerId);
        this.sessions.delete(id);
      } else if (now > session.expiresAt + 60000) {
        if (session.timerId) clearTimeout(session.timerId);
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Stops all active timers on shutdown.
   */
  destroy() {
    for (const session of this.sessions.values()) {
      if (session.timerId) {
        clearTimeout(session.timerId);
        session.timerId = null;
      }
    }
    this.sessions.clear();
  }
}
