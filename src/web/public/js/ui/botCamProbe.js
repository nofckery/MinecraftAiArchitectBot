/**
 * Bot-Cam Reachability Probing & Port Resolution
 * Decoupled UI Subsystem for Architect Mission Control.
 */

let isViewerOfflineState = true;
let isProbeInFlight = false;
let activeProbeAbortController = null;
let isViewerEnabled = true;

export function isViewerOffline() {
  return isViewerOfflineState;
}

export function isViewerStreamActive() {
  return isViewerEnabled;
}

export function setViewerStreamActive(val) {
  isViewerEnabled = Boolean(val);
}

export function resolveViewerPort(explicitPort = null) {
  if (explicitPort !== null && explicitPort !== undefined) {
    const parsed = parseInt(explicitPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) return parsed;
  }
  if (typeof document !== 'undefined' && document.getElementById) {
    const portEl = document.getElementById('lblViewerPort');
    if (portEl && portEl.textContent) {
      const parsed = parseInt(portEl.textContent.trim(), 10);
      if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) return parsed;
    }
  }
  return 3081;
}

export async function executeViewerProbe(options = {}) {
  const opts = (typeof options === 'number' || typeof options === 'string')
    ? { port: options }
    : (options || {});

  const port = resolveViewerPort(opts.port);
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) ? window.location.hostname : 'localhost';
  const protocol = (typeof window !== 'undefined' && window.location?.protocol) ? window.location.protocol : 'http:';
  const targetUrl = `${protocol}//${hostname}:${port}/`;
  const timeoutMs = opts.timeoutMs || 3000;
  const fetchFn = opts.fetchFn || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : (typeof fetch !== 'undefined' ? fetch : null));

  if (!fetchFn) return { online: false, reason: 'NO_FETCH' };

  const timeoutController = new AbortController();
  let timerId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      timeoutController.abort();
      reject(new Error('TIMEOUT_EXCEEDED'));
    }, timeoutMs);
  });

  const signal = opts.signal;
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timerId);
      timeoutController.abort();
      return { online: false, reason: 'ABORTED' };
    }
    signal.addEventListener('abort', () => {
      clearTimeout(timerId);
      timeoutController.abort();
    }, { once: true });
  }

  try {
    const fetchPromise = fetchFn(targetUrl, {
      method: opts.method || 'HEAD',
      mode: 'no-cors',
      cache: 'no-store',
      signal: timeoutController.signal
    });

    const res = await Promise.race([fetchPromise, timeoutPromise]);
    clearTimeout(timerId);

    if (res && res.status >= 500) {
      return { online: false, reason: 'SERVER_ERROR', status: res.status };
    }

    if (res && (res.ok || res.type === 'opaque' || res.status === 200 || res.status === 0)) {
      return { online: true, port, url: targetUrl, status: res.status || 200 };
    }

    return { online: false, reason: 'HTTP_ERROR', status: res?.status };
  } catch (err) {
    clearTimeout(timerId);
    const isTimeout = err.name === 'AbortError' || err.message?.includes('TIMEOUT') || timeoutController.signal.aborted;
    const isAborted = signal?.aborted;
    return {
      online: false,
      reason: isAborted ? 'ABORTED' : (isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR'),
      error: err.name || 'Error',
      errorMessage: err.message
    };
  }
}

export function setViewerOnlineStatus(isOnline, port = null, errorDetails = null) {
  isViewerOfflineState = !isOnline;
  const resolvedPort = resolveViewerPort(port);
  if (typeof document === 'undefined') return;

  const viewerFrame = document.getElementById('viewerFrame');
  const placeholder = document.getElementById('viewerOfflinePlaceholder');
  const btnRetry = document.getElementById('btnRetryViewerConnection');
  const offlinePortDisplay = document.getElementById('offlinePortDisplay');
  const hostname = (typeof window !== 'undefined' && window.location?.hostname) ? window.location.hostname : 'localhost';
  const protocol = (typeof window !== 'undefined' && window.location?.protocol) ? window.location.protocol : 'http:';
  const targetUrl = `${protocol}//${hostname}:${resolvedPort}/`;

  if (offlinePortDisplay) {
    offlinePortDisplay.textContent = String(resolvedPort);
  }

  if (isOnline) {
    if (placeholder) {
      placeholder.style.display = 'none';
    }
    if (viewerFrame) {
      viewerFrame.style.display = 'block';
      const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
      const baseTarget = targetUrl.replace(/\/$/, '');
      if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(baseTarget)) {
        viewerFrame.src = targetUrl;
      }
    }
    if (btnRetry) {
      btnRetry.disabled = false;
      btnRetry.classList.remove('loading');
      btnRetry.textContent = '↺ Verbindung wiederholen';
    }
  } else {
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
      viewerFrame.style.display = 'none';
    }
    if (placeholder) {
      placeholder.style.display = 'flex';
      const titleEl = placeholder.querySelector('.detached-title');
      const descEl = placeholder.querySelector('.detached-desc');

      if (errorDetails?.reason === 'TIMEOUT') {
        if (titleEl) {
          titleEl.innerHTML = `● BOT-CAM OFFLINE: Prismarine-Viewer auf Port <span id="offlinePortDisplay">${resolvedPort}</span> nicht erreichbar`;
        }
        if (descEl) {
          descEl.textContent = `Verbindungs-Timeout (>3000ms): Prismarine 3D-Viewer antwortet nicht auf Port ${resolvedPort}.`;
        }
      } else if (errorDetails?.reason === 'SERVER_ERROR' || (errorDetails?.status && errorDetails.status >= 500)) {
        if (titleEl) {
          titleEl.textContent = `● VIEWER SERVER-FEHLER (HTTP ${errorDetails.status || 500})`;
        }
        if (descEl) {
          descEl.textContent = `Der 3D-Viewer Server meldet einen internen Fehler (HTTP ${errorDetails.status || 500}).`;
        }
      } else {
        if (titleEl) {
          titleEl.innerHTML = `● BOT-CAM OFFLINE: Prismarine-Viewer auf Port <span id="offlinePortDisplay">${resolvedPort}</span> nicht erreichbar`;
        }
        if (descEl) {
          descEl.textContent = `Der 3D-Kamera-Stream konnte auf Port ${resolvedPort} nicht erreicht werden. Der Bot ist noch nicht gestartet, der Prismarine-Viewer pausiert oder der Port wird blockiert.`;
        }
      }
    }
  }
}

export async function probeViewerReachability(userInitiated = false, explicitPort = null) {
  const btnRetry = typeof document !== 'undefined' ? document.getElementById('btnRetryViewerConnection') : null;
  const port = resolveViewerPort(explicitPort);

  if (isProbeInFlight || (userInitiated && btnRetry && btnRetry.disabled)) {
    return { throttled: true };
  }

  isProbeInFlight = true;

  if (btnRetry) {
    btnRetry.disabled = true;
    btnRetry.classList.add('loading');
    btnRetry.textContent = `⏳ Verbinde mit Port ${port}...`;
  }

  if (activeProbeAbortController) {
    try {
      activeProbeAbortController.abort();
    } catch {
      // Ignore abort errors
    }
  }
  activeProbeAbortController = new AbortController();

  try {
    const outcome = await executeViewerProbe({
      port,
      signal: activeProbeAbortController.signal
    });

    if (activeProbeAbortController?.signal?.aborted || outcome.reason === 'ABORTED') {
      return { aborted: true };
    }

    if (outcome.online) {
      setViewerOnlineStatus(true, port);
      return { success: true, reconnected: true, streamUrl: `http://localhost:${port}/` };
    } else {
      setViewerOnlineStatus(false, port, outcome);
      return { success: false, reason: outcome.reason };
    }
  } catch (err) {
    setViewerOnlineStatus(false, port, { reason: 'EXCEPTION', message: err.message });
    return { success: false, error: err.message };
  } finally {
    isProbeInFlight = false;
    activeProbeAbortController = null;
    if (btnRetry) {
      btnRetry.disabled = false;
      btnRetry.classList.remove('loading');
      btnRetry.textContent = '↺ Verbindung wiederholen';
    }
  }
}

export function abortActiveProbe() {
  if (activeProbeAbortController) {
    try {
      activeProbeAbortController.abort();
    } catch (_) {}
    activeProbeAbortController = null;
  }
  isProbeInFlight = false;
}
