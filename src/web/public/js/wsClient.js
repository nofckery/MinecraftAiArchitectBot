/**
 * Architect Mission Control — WebSocket Client Submodule
 * Handles WebSocket connection lifecycle, heartbeats, reconnect loops, and message transmission.
 */

let ws = null;
let reconnectTimer = null;
const messageListeners = new Set();
const statusListeners = new Set();

/**
 * Connect to WebSocket server with automatic reconnection.
 * @param {Function} [onMessageCallback] - Primary message handler callback
 * @param {Function} [onStatusCallback] - Primary status change handler callback
 * @returns {WebSocket}
 */
export function connectWebSocket(onMessageCallback, onStatusCallback) {
  if (onMessageCallback) messageListeners.add(onMessageCallback);
  if (onStatusCallback) statusListeners.add(onStatusCallback);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    updateDomConnectionStatus(true);
    for (const listener of statusListeners) {
      try { listener('connected'); } catch (e) { console.error(e); }
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onclose = () => {
    updateDomConnectionStatus(false);
    for (const listener of statusListeners) {
      try { listener('disconnected'); } catch (e) { console.error(e); }
    }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 2000);
    }
  };

  ws.onerror = (err) => {
    console.error('[WebSocket] Fehler aufgetreten:', err);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      for (const listener of messageListeners) {
        try { listener(msg); } catch (e) { console.error('[WebSocket] Listener Error:', e); }
      }
    } catch (e) {
      console.warn('[WebSocket] JSON Parse Error:', e);
    }
  };

  return ws;
}

/**
 * Send a JSON message over WebSocket if open.
 * @param {Object} payload
 * @returns {boolean}
 */
export function sendWS(payload) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
    return true;
  }
  console.warn('[WebSocket] Nicht verbunden, Nachricht verworfen:', payload);
  return false;
}

/**
 * Return current WebSocket connection state.
 * @returns {number} WebSocket.readyState or 3 (CLOSED)
 */
export function getWebSocketState() {
  return ws ? ws.readyState : (typeof WebSocket !== 'undefined' ? WebSocket.CLOSED : 3);
}

/**
 * Return active WebSocket instance.
 * @returns {WebSocket|null}
 */
export function getWebSocket() {
  return ws;
}

/**
 * Register additional message subscriber.
 * @param {Function} fn
 */
export function addMessageHandler(fn) {
  if (typeof fn === 'function') messageListeners.add(fn);
}

/**
 * Remove registered message subscriber.
 * @param {Function} fn
 */
export function removeMessageHandler(fn) {
  messageListeners.delete(fn);
}

function updateDomConnectionStatus(isOnline) {
  const connBadge = document.getElementById('connectionStatusBadge');
  const connText = document.getElementById('connectionStatusText');
  if (connBadge) {
    connBadge.className = isOnline ? 'status-badge online' : 'status-badge paused';
  }
  if (connText) {
    connText.textContent = isOnline ? 'Verbunden' : 'Getrennt — Neu verbinden...';
  }
}
