import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';
import { classifyError } from './probeErrorClassifier.js';

export { classifyError };

/**
 * SafeProbeWorker
 *
 * Implements two-tier safe connection probing for LLM endpoints:
 * Tier 1: Zero-Cost metadata probe (GET /models, 0 tokens, $0.00 cost)
 * Tier 2: Minimal 1-token ping (POST /chat/completions, max_tokens: 1 or 50)
 *
 * Includes RTT latency measurement (performance.now()), rate-limit quota header extraction,
 * cold-start support for local runners (up to 90s), and a standardized error taxonomy.
 */
export class SafeProbeWorker extends EventEmitter {
  /**
   * @param {Object} [options]
   * @param {number} [options.phase1TimeoutMs] - Timeout for metadata probe (default: 1500 ms)
   * @param {number} [options.phase2TimeoutMs] - Timeout for ping probe (default: 15000 ms)
   * @param {number} [options.localPhase2TimeoutMs] - Timeout for local runners / cold-starts (default: 90000 ms)
   */
  constructor(options = {}) {
    super();
    this.phase1TimeoutMs = options.phase1TimeoutMs || 1500;
    this.phase2TimeoutMs = options.phase2TimeoutMs || 15000;
    this.localPhase2TimeoutMs = options.localPhase2TimeoutMs || 90000;
  }

  /**
   * Checks whether a base URL points to a local runner (Ollama, LM Studio, etc.).
   *
   * @param {string} url
   * @returns {boolean}
   */
  isLocalUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return url.includes('127.0.0.1') ||
           url.includes('localhost') ||
           url.includes('[::1]') ||
           url.includes('.local');
  }

  /**
   * Translates network / HTTP errors into the standardized error taxonomy.
   *
   * @param {any} err
   * @returns {{ code: string, message: string, userAction: string, httpStatus?: number }}
   */
  classifyError(err) {
    return classifyError(err);
  }

  /**
   * Phase 1: Zero-Cost Metadata Probe (GET /models).
   *
   * @param {string} baseUrl
   * @param {string} [rawSecret]
   * @param {Object} [customHeaders]
   * @param {number} [timeoutMs]
   * @returns {Promise<{ models: string[], status: number }>}
   */
  async probePhase1Metadata(baseUrl, rawSecret, customHeaders = {}, timeoutMs = this.phase1TimeoutMs) {
    const cleanUrl = baseUrl.replace(/\/+$/, '') + '/models';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'Accept': 'application/json',
      ...customHeaders
    };

    if (rawSecret && rawSecret !== 'none' && !rawSecret.startsWith('dummy-')) {
      headers['Authorization'] = `Bearer ${rawSecret}`;
    }

    try {
      const res = await fetch(cleanUrl, {
        method: 'GET',
        headers,
        signal: controller.signal
      });

      if (!res.ok) {
        let errorBody = '';
        try {
          errorBody = await res.text();
        } catch (_) {}
        const err = new Error(`Metadata probe failed with HTTP ${res.status}`);
        err.status = res.status;
        err.responseBody = errorBody;
        throw err;
      }

      let text;
      try {
        text = await res.text();
      } catch (streamErr) {
        const err = new Error(`Netzwerkfehler beim Lesen des Antwort-Streams von /models: ${streamErr.message}`);
        err.name = streamErr.name || 'Error';
        err.code = streamErr.code || 'NETWORK_ERROR';
        err.cause = streamErr;
        throw err;
      }

      const trimmed = (text || '').trim();
      if (trimmed === 'OK') {
        // Some compliant providers (e.g. GitHub Models models.github.ai) return plain text "OK" on /models
        return { models: [], status: res.status };
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        const err = new Error(`Ungültige JSON-Antwort von /models: ${parseErr.message}`);
        err.code = 'INVALID_RESPONSE';
        err.status = res.status;
        err.responseBody = text;
        err.cause = parseErr;
        throw err;
      }

      const models = [];
      if (Array.isArray(data?.data)) {
        for (const item of data.data) {
          if (item?.id) models.push(item.id);
          else if (item?.name) models.push(item.name);
        }
      } else if (Array.isArray(data?.models)) {
        for (const item of data.models) {
          if (item?.name) models.push(item.name);
          else if (item?.id) models.push(item.id);
        }
      } else if (Array.isArray(data)) {
        for (const item of data) {
          if (typeof item === 'string') models.push(item);
          else if (item?.id) models.push(item.id);
          else if (item?.name) models.push(item.name);
        }
      }

      return { models, status: res.status };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Phase 2: Minimal 1-Token Ping (POST /chat/completions).
   *
   * @param {string} baseUrl
   * @param {string} modelId
   * @param {string} [rawSecret]
   * @param {boolean} [isThinkingModel=false]
   * @param {number} [timeoutMs]
   * @param {Object} [customHeaders]
   * @returns {Promise<{ latencyMs: number, quota: Object, responsePayload: Object }>}
   */
  async probePhase2Ping(baseUrl, modelId, rawSecret, isThinkingModel = false, timeoutMs = this.phase2TimeoutMs, customHeaders = {}) {
    const cleanUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...customHeaders
    };

    if (rawSecret && rawSecret !== 'none' && !rawSecret.startsWith('dummy-')) {
      headers['Authorization'] = `Bearer ${rawSecret}`;
    }

    const payload = {
      model: modelId,
      messages: [{ role: 'user', content: '1' }],
      max_tokens: isThinkingModel ? 50 : 1
    };

    const startTime = performance.now();

    try {
      const res = await fetch(cleanUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const latencyMs = Math.round(performance.now() - startTime);

      // Extract rate-limit and quota headers
      const quota = {};
      const getH = (name) => res.headers?.get?.(name) || res.headers?.[name];

      const remainingReq = getH('x-ratelimit-remaining-requests');
      if (remainingReq) quota.remainingRequests = parseInt(remainingReq, 10);

      const remainingTok = getH('x-ratelimit-remaining-tokens');
      if (remainingTok) quota.remainingTokens = parseInt(remainingTok, 10);

      const retryAfter = getH('retry-after');
      if (retryAfter) quota.retryAfterSec = parseInt(retryAfter, 10);

      const resetReq = getH('x-ratelimit-reset-requests');
      if (resetReq) quota.resetRequestsSec = parseFloat(resetReq);

      if (!res.ok) {
        let errorBody = '';
        try {
          errorBody = await res.text();
        } catch (_) {}
        const err = new Error(`Ping probe failed with HTTP ${res.status}`);
        err.status = res.status;
        err.responseBody = errorBody;
        err.headers = res.headers;
        err.latencyMs = latencyMs;
        err.quota = quota;
        throw err;
      }

      let responsePayload;
      try {
        responsePayload = await res.json();
      } catch (parseErr) {
        const err = new Error(`Ungültige JSON-Antwort von /chat/completions: ${parseErr.message}`);
        err.code = 'INVALID_RESPONSE';
        err.status = res.status;
        err.latencyMs = latencyMs;
        err.quota = quota;
        err.cause = parseErr;
        throw err;
      }

      // Validierung des Antwort-Schemas (OpenAI-kompatibles Format)
      const firstChoice = responsePayload?.choices?.[0];
      const hasValidChoice =
        Array.isArray(responsePayload?.choices) &&
        responsePayload.choices.length > 0 &&
        firstChoice &&
        typeof firstChoice === 'object' &&
        (firstChoice.message !== undefined ||
          firstChoice.delta !== undefined ||
          firstChoice.text !== undefined);

      if (!hasValidChoice) {
        const err = new Error(
          'Ungültiges Antwortformat von /chat/completions: Feld "choices" fehlt, ist leer oder enthält keine gültige Choice-Struktur'
        );
        err.code = 'INVALID_RESPONSE';
        err.status = res.status;
        err.latencyMs = latencyMs;
        err.quota = quota;
        err.responseBody = responsePayload;
        throw err;
      }

      return {
        latencyMs,
        quota,
        responsePayload
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Executes full two-tier safe probe against an endpoint configuration.
   *
   * @param {Object} config - EndpointConfiguration
   * @param {string} [rawSecret] - Decrypted secret from vault
   * @param {Object} [options] - Options override
   * @returns {Promise<Object>} ProbeResult
   */
  async probeEndpoint(config, rawSecret, options = {}) {
    const isLocal = this.isLocalUrl(config.baseUrl);
    const p1Timeout = options.phase1TimeoutMs || this.phase1TimeoutMs;
    const p2Timeout = options.phase2TimeoutMs || (isLocal ? this.localPhase2TimeoutMs : this.phase2TimeoutMs);

    // =========================================================================
    // TIER 1: Zero-Cost Metadata Probe (GET /models)
    // =========================================================================
    this.emit('progress', { phase: 1, step: 'metadata', message: 'Lade Modellkatalog (Tier 1 Zero-Cost)...' });

    let phase1Result;
    try {
      phase1Result = await this.probePhase1Metadata(
        config.baseUrl,
        rawSecret,
        config.customHeaders,
        p1Timeout
      );
    } catch (err) {
      const errorClassification = this.classifyError(err);
      const failureResult = {
        success: false,
        phase: 1,
        status: errorClassification.code === 'INVALID_KEY' ? 'unauthorized' : 'offline',
        latencyMs: 0,
        modelCatalogCount: 0,
        modelCatalog: [],
        modelFound: false,
        quotaRemaining: null,
        error: errorClassification
      };

      this.emit('probe_failed', failureResult);
      return failureResult;
    }

    const modelCatalog = phase1Result.models || [];
    const modelFound = modelCatalog.length === 0 || modelCatalog.includes(config.modelId);

    // =========================================================================
    // TIER 2: Minimal 1-Token Ping (POST /chat/completions)
    // =========================================================================
    this.emit('progress', {
      phase: 2,
      step: 'ping',
      message: isLocal
        ? 'Führe Ping durch (lokaler Server, bis zu 90s Cold-Start)...'
        : 'Messe Latenz & Quoten (Tier 2 Minimal-Ping)...'
    });

    let phase2Result;
    try {
      phase2Result = await this.probePhase2Ping(
        config.baseUrl,
        config.modelId,
        rawSecret,
        config.isThinkingModel,
        p2Timeout,
        config.customHeaders
      );
    } catch (err) {
      const errorClassification = this.classifyError(err);
      const isCooldown = errorClassification.code === 'RATE_LIMIT';

      const failureResult = {
        success: false,
        phase: 2,
        status: isCooldown
          ? 'cooldown'
          : (errorClassification.code === 'INVALID_KEY'
            ? 'unauthorized'
            : (errorClassification.code === 'CONNECTION_REFUSED' ? 'offline' : 'degraded')),
        latencyMs: err.latencyMs || 0,
        modelCatalogCount: modelCatalog.length,
        modelCatalog,
        modelFound,
        quotaRemaining: err.quota?.remainingRequests ?? null,
        rateLimits: err.quota || {},
        error: errorClassification
      };

      this.emit('probe_failed', failureResult);
      return failureResult;
    }

    const successResult = {
      success: true,
      phase: 2,
      status: 'healthy',
      latencyMs: phase2Result.latencyMs,
      modelCatalogCount: modelCatalog.length,
      modelCatalog,
      modelFound,
      quotaRemaining: phase2Result.quota?.remainingRequests ?? null,
      rateLimits: phase2Result.quota || {}
    };

    this.emit('probe_success', successResult);
    return successResult;
  }
}
