/**
 * Popout Viewer — Client controller for the standalone multi-monitor popout window.
 * Synchronizes lifecycle events with the main cockpit via BroadcastChannel ('mc_camera_sync')
 * and localStorage fallbacks.
 */

const CHANNEL_NAME = 'mc_camera_sync';
const STORAGE_KEY = 'mc_camera_sync_event';

let channel = null;
if (typeof BroadcastChannel !== 'undefined') {
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    if (typeof channel.unref === 'function') {
      channel.unref();
    }
  } catch (err) {
    console.warn('[PopoutViewer] BroadcastChannel unavailable:', err);
  }
}

/**
 * Broadcasts an event to the main cockpit dashboard
 */
function broadcast(msg) {
  if (channel) {
    try {
      channel.postMessage(msg);
    } catch (err) {
      console.warn('[PopoutViewer] Broadcast message error:', err);
    }
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...msg, _t: Date.now() }));
    }
  } catch {}
}

// Extract port and bind stream iframe
const params = new URLSearchParams(window.location.search);
const viewerPort = params.get('port') || '3081';
const popoutFrame = document.getElementById('popoutFrame');

if (popoutFrame) {
  const streamUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
  popoutFrame.src = streamUrl;
}

// Notify cockpit that popout view is mounted
broadcast({ type: 'VIEWER_POPOUT_OPENED', port: viewerPort });

// Listen for re-embed or close requests from main cockpit
if (channel) {
  channel.onmessage = (event) => {
    const data = event.data;
    if (!data) return;
    if (data.type === 'REQUEST_REEMBED' || data.type === 'VIEWER_POPOUT_CLOSED') {
      window.close();
    }
  };
}

window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY && event.newValue) {
    try {
      const data = JSON.parse(event.newValue);
      if (data.type === 'REQUEST_REEMBED') {
        window.close();
      }
    } catch {}
  }
});

// Re-embed button: notify main cockpit and close this window
const btnReembed = document.getElementById('btnPopoutReembed');
if (btnReembed) {
  btnReembed.addEventListener('click', () => {
    broadcast({ type: 'REQUEST_REEMBED' });
    setTimeout(() => {
      window.close();
    }, 50);
  });
}

// Reload button
const btnReload = document.getElementById('btnPopoutReload');
if (btnReload && popoutFrame) {
  btnReload.addEventListener('click', () => {
    const streamUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
    popoutFrame.src = `${streamUrl}?v=${Date.now()}`;
  });
}

// Fullscreen toggle button
const btnFullscreen = document.getElementById('btnPopoutFullscreen');
const popoutWrapper = document.getElementById('popoutWrapper') || document.documentElement;

if (btnFullscreen) {
  btnFullscreen.addEventListener('click', async () => {
    try {
      if (document.fullscreenElement || document.webkitFullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) await document.webkitExitFullscreen();
      } else {
        if (popoutWrapper.requestFullscreen) await popoutWrapper.requestFullscreen();
        else if (popoutWrapper.webkitRequestFullscreen) await popoutWrapper.webkitRequestFullscreen();
      }
    } catch (err) {
      console.error('[PopoutViewer] Fullscreen error:', err);
    }
  });
}

document.addEventListener('fullscreenchange', () => {
  const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (btnFullscreen) {
    btnFullscreen.textContent = isFs ? '🗗 Beenden' : '⛶ Vollbild';
    btnFullscreen.title = isFs ? 'Vollbildmodus beenden (Esc)' : 'Vollbildmodus aktivieren (Esc)';
  }
});

// Lifecycle unmount cleanup
let hasCleanedUp = false;
function notifyUnload() {
  if (hasCleanedUp) return;
  hasCleanedUp = true;
  broadcast({ type: 'VIEWER_POPOUT_CLOSED' });
}

window.addEventListener('beforeunload', notifyUnload);
window.addEventListener('pagehide', notifyUnload);

export {
  broadcast,
  viewerPort
};
