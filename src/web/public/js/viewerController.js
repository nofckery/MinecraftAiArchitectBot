/**
 * Viewer Controller — State controller managing camera attachment lifecycle,
 * fullscreen API, and multi-monitor popout synchronization via BroadcastChannel & localStorage.
 */

const CHANNEL_NAME = 'mc_camera_sync';
const STORAGE_KEY = 'mc_camera_sync_event';

let isPoppedOutState = false;
let popoutWindowRef = null;
let pollInterval = null;
const stateListeners = new Set();
let channel = null;

// Initialize BroadcastChannel if supported
if (typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    if (typeof channel.unref === 'function') {
      channel.unref();
    }
  } catch (e) {
    console.warn('[ViewerController] BroadcastChannel unavailable:', e);
  }
}

/**
 * Broadcasts a synchronization message to peer windows
 */
function broadcastMessage(msg) {
  if (channel) {
    try {
      channel.postMessage(msg);
    } catch (err) {
      console.warn('[ViewerController] postMessage failed:', err);
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...msg, _t: Date.now() }));
    }
  } catch (err) {
    // localStorage might be unavailable in private browsing or sandboxes
  }
}

/**
 * Notifies all registered state change listeners
 */
function notifyListeners(poppedOut) {
  stateListeners.forEach(listener => {
    try {
      listener(poppedOut);
    } catch (err) {
      console.error('[ViewerController] Listener error:', err);
    }
  });
}

/**
 * Checks whether the viewer camera is currently popped out
 * @returns {boolean}
 */
export function isPoppedOut() {
  return isPoppedOutState;
}

/**
 * Opens the standalone viewer popout window
 * @param {number|string} [port]
 * @returns {Window|null}
 */
export function openPopout(port) {
  const resolvedPort = port || document.getElementById('lblViewerPort')?.textContent || 3081;
  const targetUrl = `/viewer.html?port=${encodeURIComponent(resolvedPort)}`;

  isPoppedOutState = true;
  popoutWindowRef = window.open(
    targetUrl,
    'McCameraPopout',
    'width=1280,height=720,menubar=no,toolbar=no,status=no,resizable=yes'
  );

  broadcastMessage({ type: 'VIEWER_POPOUT_OPENED', port: resolvedPort });
  notifyListeners(true);

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    if (isPoppedOutState && popoutWindowRef && popoutWindowRef.closed) {
      reembed(false);
    }
  }, 1000);

  return popoutWindowRef;
}

/**
 * Re-embeds the camera into the main cockpit dashboard
 * @param {boolean} [notifyRemote=true]
 */
export function reembed(notifyRemote = true) {
  if (!isPoppedOutState && (!popoutWindowRef || popoutWindowRef.closed)) {
    return;
  }

  isPoppedOutState = false;

  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  if (notifyRemote) {
    broadcastMessage({ type: 'REQUEST_REEMBED' });
  }

  if (popoutWindowRef && !popoutWindowRef.closed) {
    try {
      popoutWindowRef.close();
    } catch (err) {
      // Ignore cross-origin/closed errors
    }
  }
  popoutWindowRef = null;

  notifyListeners(false);
}

/**
 * Focuses the popped out window if open
 */
export function focusPopout() {
  if (popoutWindowRef && !popoutWindowRef.closed) {
    try {
      popoutWindowRef.focus();
    } catch (err) {
      console.warn('[ViewerController] Could not focus popout window:', err);
    }
  }
}

/**
 * Toggles fullscreen mode on a given element using the HTML5 Fullscreen API
 * @param {HTMLElement} [element]
 * @returns {Promise<void>}
 */
export async function toggleFullscreen(element) {
  const target = element || document.querySelector('.viewer-wrapper') || document.documentElement;
  try {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      } else if (document.webkitExitFullscreen) {
        await document.webkitExitFullscreen();
      }
    } else {
      if (target.requestFullscreen) {
        await target.requestFullscreen();
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      }
    }
  } catch (err) {
    console.error('[ViewerController] Fullscreen toggle error:', err);
  }
}

/**
 * Subscribes to popout state changes
 * @param {function(boolean): void} listener
 * @returns {function(): void} Unsubscribe callback
 */
export function onStateChange(listener) {
  if (typeof listener === 'function') {
    stateListeners.add(listener);
  }
  return () => stateListeners.delete(listener);
}

/**
 * Initializes controller event listeners for BroadcastChannel and storage sync
 */
export function initViewerController() {
  if (channel) {
    channel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      if (data.type === 'VIEWER_POPOUT_OPENED') {
        if (!isPoppedOutState) {
          isPoppedOutState = true;
          notifyListeners(true);
        }
      } else if (data.type === 'VIEWER_POPOUT_CLOSED' || data.type === 'REQUEST_REEMBED') {
        if (isPoppedOutState) {
          reembed(false);
        }
      }
    };
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY && event.newValue) {
        try {
          const data = JSON.parse(event.newValue);
          if (data.type === 'VIEWER_POPOUT_OPENED') {
            if (!isPoppedOutState) {
              isPoppedOutState = true;
              notifyListeners(true);
            }
          } else if (data.type === 'VIEWER_POPOUT_CLOSED' || data.type === 'REQUEST_REEMBED') {
            if (isPoppedOutState) {
              reembed(false);
            }
          }
        } catch {}
      }
    });

    window.addEventListener('beforeunload', () => {
      if (pollInterval) clearInterval(pollInterval);
    });
  }
}

export const viewerController = {
  isPoppedOut,
  openPopout,
  reembed,
  focusPopout,
  toggleFullscreen,
  onStateChange,
  initViewerController
};

export default viewerController;
