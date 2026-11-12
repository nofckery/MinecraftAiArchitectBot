import { logger } from '../../utils/logger.js';

/**
 * Behandelt Fehler bei LLM-Anfragen (401/403 Invalid Key, 429 Rate Limit Cooldown, Timeouts).
 */
export function handleRouterError(endpoint, error) {
  const status = error.status || error.statusCode || error.response?.status;
  const headers = error.headers || error.response?.headers;

  const isTimeout = error.name === 'APIConnectionTimeoutError' ||
                    error.name === 'TimeoutError' ||
                    error.constructor?.name === 'APIConnectionTimeoutError' ||
                    (typeof OpenAI !== 'undefined' && OpenAI.APIConnectionTimeoutError && error instanceof OpenAI.APIConnectionTimeoutError) ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ECONNABORTED' ||
                    error.cause?.code === 'ETIMEDOUT' ||
                    error.cause?.code === 'ECONNABORTED' ||
                    /(timeout|timed\s*out)/i.test(error.message || '') ||
                    /(timeout|timed\s*out)/i.test(error.cause?.message || '');

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

  const errMsg = (error.message || '').toLowerCase();
  const errorBody = error.error || error.response?.data || {};
  const errorBodyMsg = (typeof errorBody === 'string' ? errorBody : (errorBody.message || JSON.stringify(errorBody))).toLowerCase();
  const isInvalidKey = status === 401 || status === 403 ||
    (status === 400 && (errMsg.includes('api key') || errorBodyMsg.includes('api key') || errorBodyMsg.includes('api_key_invalid') || errorBodyMsg.includes('invalid_argument')));

  if (isInvalidKey) {
    endpoint.disabled = true;
    logger.warn(`API-Schlüssel für [${endpoint.provider} (${endpoint.model})] ungültig oder abgelaufen (HTTP ${status}). Deaktiviere Key für diese Sitzung.`);
  } else if (status === 429) {
    const waitMs = retryAfterSec ? retryAfterSec * 1000 : 65000;
    endpoint.cooldownUntil = Date.now() + waitMs;
    logger.warn(`Rate-Limit (HTTP 429) auf [${endpoint.provider} (${endpoint.model})]. Cooldown für ${Math.round(waitMs / 1000)}s gesetzt. Wechsle sofort nächsten Provider...`);
  } else if (isTimeout) {
    endpoint.cooldownUntil = Date.now() + 30000;
    logger.warn(`Zeitüberschreitung (Timeout 30s) auf [${endpoint.provider} (${endpoint.model})]. Wechsle sofort nächsten Provider...`);
  } else {
    endpoint.cooldownUntil = Date.now() + 10000;
    logger.warn(`Fehler auf [${endpoint.provider} (${endpoint.model})]: ${error.message}. Kurzer Cooldown gesetzt.`);
  }
}
