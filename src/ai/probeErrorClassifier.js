/**
 * Translates network / HTTP errors into the standardized error taxonomy.
 *
 * @param {any} err
 * @returns {{ code: string, message: string, userAction: string, httpStatus?: number }}
 */
export function classifyError(err) {
  if (!err) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Unbekannter Netzwerkfehler',
      userAction: 'Bitte Verbindungseinstellungen und Server-Erreichbarkeit prüfen.'
    };
  }

  const status = err.status || err.statusCode || err.httpStatus;
  const msg = (err.message || '').toLowerCase();
  const causeMsg = (err.cause?.message || '').toLowerCase();
  const causeCode = err.cause?.code || err.code;
  const bodyStr = typeof err.responseBody === 'string'
    ? err.responseBody.toLowerCase()
    : (typeof err.responseBody === 'object' ? JSON.stringify(err.responseBody).toLowerCase() : '');

  // 1. HTTP 401: Invalid API Key (or HTTP 400 with API key error, e.g. Google Gemini API_KEY_INVALID)
  if (status === 401 || (status === 400 && (msg.includes('api key') || bodyStr.includes('api key') || bodyStr.includes('api_key_invalid')))) {
    return {
      code: 'INVALID_KEY',
      message: 'API-Schlüssel ungültig oder abgelaufen.',
      userAction: 'Bitte prüfe den Schlüssel in der Provider-Konsole.',
      httpStatus: status
    };
  }

  // 2. HTTP 403: Forbidden / Permissions
  if (status === 403) {
    return {
      code: 'FORBIDDEN',
      message: 'Zugriff verweigert (HTTP 403).',
      userAction: 'Dein Account hat keine Berechtigung für dieses Modell.',
      httpStatus: 403
    };
  }

  // 3. HTTP 404: Model Not Found
  if (status === 404) {
    return {
      code: 'MODEL_NOT_FOUND',
      message: 'Modell nicht gefunden (HTTP 404).',
      userAction: 'Bitte prüfe die Modell-ID.',
      httpStatus: 404
    };
  }

  // 4. HTTP 429: Rate Limit or Insufficient Quota
  if (status === 429) {
    if (bodyStr.includes('insufficient_quota') || bodyStr.includes('quota') || bodyStr.includes('credit') || bodyStr.includes('balance')) {
      return {
        code: 'INSUFFICIENT_QUOTA',
        message: 'Guthaben aufgebraucht.',
        userAction: 'Bitte lade Credits auf.',
        httpStatus: 429
      };
    }
    return {
      code: 'RATE_LIMIT',
      message: 'Kurzzeitiges Rate-Limit erreicht.',
      userAction: 'Bot schaltet automatisch auf Backup-Provider um.',
      httpStatus: 429
    };
  }

  // 5. HTTP 5xx: Server Error
  if (status >= 500 && status < 600) {
    return {
      code: 'SERVER_ERROR',
      message: `Provider-Server meldet einen temporären Fehler (HTTP ${status}).`,
      userAction: 'Bitte versuche es später erneut oder nutze einen alternativen Provider.',
      httpStatus: status
    };
  }

  // 5b. INVALID_RESPONSE / Malformed JSON or Invalid Schema
  if (
    err.code === 'INVALID_RESPONSE' ||
    causeCode === 'INVALID_RESPONSE' ||
    msg.includes('ungültige json-antwort') ||
    msg.includes('ungültiges antwortformat')
  ) {
    return {
      code: 'INVALID_RESPONSE',
      message: err.message || 'Ungültiges Antwortformat vom Server.',
      userAction: 'Prüfe, ob der Endpunkt eine standardkonforme OpenAI-kompatible API bereitstellt.',
      httpStatus: status || 200
    };
  }

  // 6. ECONNREFUSED
  if (
    causeCode === 'ECONNREFUSED' ||
    err.code === 'ECONNREFUSED' ||
    msg.includes('econnrefused') ||
    msg.includes('connection refused') ||
    causeMsg.includes('econnrefused')
  ) {
    return {
      code: 'CONNECTION_REFUSED',
      message: 'Verbindung verweigert.',
      userAction: 'Bitte stelle sicher, dass der lokale Inferenz-Server gestartet ist.'
    };
  }

  // 7. TIMEOUT / AbortError
  if (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    causeCode === 'ETIMEDOUT' ||
    err.code === 'ETIMEDOUT' ||
    causeCode === 'ECONNABORTED' ||
    msg.includes('timeout') ||
    msg.includes('aborted')
  ) {
    return {
      code: 'TIMEOUT',
      message: 'Verbindung überschritt das Zeitlimit (Timeout).',
      userAction: 'Prüfe deine Netzwerkverbindung oder erhöhe das Timeout.'
    };
  }

  // 8. General Network Error
  return {
    code: 'NETWORK_ERROR',
    message: err.message || 'Unbekannter Netzwerkfehler',
    userAction: 'Bitte Verbindungseinstellungen und Server-Erreichbarkeit prüfen.',
    httpStatus: status
  };
}
