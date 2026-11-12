/**
 * Telemetry Bar, Vitals, Handoff Status, Bot Power, Chat Log & Viewer Sync
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import {
  openOnboardingModal,
  applySettingsToUI,
  updateRightsUI,
  updateEnvBadge
} from '../onboardingWizard.js';
import { sendWS } from '../wsClient.js';
import { isPopoutActive } from '../manualCockpit.js';
import { isPoppedOut } from '../viewerController.js';
import {
  resolveViewerPort,
  probeViewerReachability,
  setViewerOnlineStatus,
  applyViewerStreamEnabled,
  isViewerOffline,
  isViewerStreamActive,
  setViewerRefreshCallback
} from './botCamDiagnostics.js';

let currentHandoffState = 'ONLINE_ACTIVE';
let currentUsername = 'BaumeisterKI';
let lastKnownVersion = null;

// DOM Elements Cache Helper
const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);

export function getCurrentHandoffState() {
  return currentHandoffState;
}

export function setCurrentHandoffState(st) {
  if (st) currentHandoffState = st;
}

export function getCurrentUsername() {
  return currentUsername;
}

export function setCurrentUsername(name) {
  if (name) currentUsername = name;
}

export function getLastKnownVersion() {
  return lastKnownVersion;
}

export function setLastKnownVersion(v) {
  lastKnownVersion = v;
}

export function updateHandoffUI(state) {
  const handoffBadge = getEl('handoffStateBadge');
  const handoffDesc = getEl('handoffStateDesc');
  const btnToggleHandoff = getEl('btnToggleHandoff');
  if (!handoffBadge || !handoffDesc || !btnToggleHandoff) return;

  if (state === 'ONLINE_ACTIVE') {
    handoffBadge.className = 'handoff-badge state-online';
    handoffBadge.textContent = `Bot Online (${currentUsername || 'DeinAccount'})`;
    handoffDesc.textContent = 'Bot steuert den Account. Wenn du selbst joinst, pausiert er automatisch.';
    btnToggleHandoff.textContent = 'Account freigeben / Bot pausieren';
    btnToggleHandoff.title = 'Account freigeben / Bot pausieren';
    btnToggleHandoff.disabled = false;
  } else if (state === 'PAUSED_OWNER_INGAME') {
    handoffBadge.className = 'handoff-badge state-paused';
    handoffBadge.textContent = 'Pausiert (Du bist im Spiel)';
    handoffDesc.textContent = 'Menschlicher Spieler ist ingame. Bot pausiert und wartet auf deinen Disconnect.';
    btnToggleHandoff.textContent = 'Bot wieder einloggen';
    btnToggleHandoff.title = 'Account wieder übernehmen & Weiterbauen';
    btnToggleHandoff.disabled = false;
  } else if (state === 'RECONNECTING') {
    handoffBadge.className = 'handoff-badge state-reconnecting';
    handoffBadge.textContent = 'Reconnecting...';
    handoffDesc.textContent = 'Cooldown läuft. Bot loggt in Kürze wieder ein...';
    btnToggleHandoff.textContent = 'Verbinde...';
    btnToggleHandoff.title = 'Verbinde...';
    btnToggleHandoff.disabled = true;
  } else if (state === 'PAUSED_SLEEP_NIGHT') {
    handoffBadge.className = 'handoff-badge state-night';
    handoffBadge.textContent = '🌙 Nacht-Pause';
    handoffDesc.textContent = 'Bot hat den Server verlassen, damit Mitspieler schlafen können. Reconnect erfolgt morgens.';
    btnToggleHandoff.textContent = 'Bot jetzt einloggen';
    btnToggleHandoff.title = 'Nacht-Disconnect abbrechen & sofort einloggen';
    btnToggleHandoff.disabled = false;
  } else if (state === 'FABRIC_MISMATCH') {
    handoffBadge.className = 'handoff-badge state-fabric-mismatch';
    handoffBadge.textContent = '⚠️ Fabric Mod-Check';
    handoffDesc.textContent = 'Server verlangt Fabric Loader/API. Installiere die Mod "Bypass Fabric Check" auf dem Host.';
    btnToggleHandoff.textContent = 'Erneut verbinden';
    btnToggleHandoff.title = 'Erneut verbinden nach Mod-Installation';
    btnToggleHandoff.disabled = false;
  }
}

export function updateBotPowerUI(state, running, connected) {
  const btnMaster = getEl('btnMasterBotControl');
  const txtMaster = getEl('btnMasterBotText');
  const pillBadge = getEl('pillBotStatusBadge');
  const txtBadge = getEl('txtBotStatusBadge');
  const btnSidebar = getEl('btnSidebarBotPower');

  const isOnline = Boolean(connected);
  const isFabricMismatch = !isOnline && state === 'FABRIC_MISMATCH';
  const isConnecting = !isOnline && !isFabricMismatch && (state === 'CONNECTING' || state === 'RECONNECTING');

  if (isOnline) {
    if (btnMaster) {
      btnMaster.className = 'btn-bot-master stop';
      btnMaster.disabled = false;
      btnMaster.title = 'Bot trennen & stoppen';
    }
    if (txtMaster) txtMaster.textContent = 'Bot Stoppen';
    if (pillBadge) pillBadge.className = 'bot-power-badge online';
    if (txtBadge) txtBadge.textContent = 'Online';

    if (btnSidebar) {
      btnSidebar.className = 'btn btn-bot-power stop';
      btnSidebar.textContent = '⏹ Bot Stoppen';
      btnSidebar.title = 'Bot trennen & stoppen';
    }
  } else if (isFabricMismatch) {
    if (btnMaster) {
      btnMaster.className = 'btn-bot-master start';
      btnMaster.disabled = false;
      btnMaster.title = 'Fabric Mod-Mismatch erkannt. Erneut versuchen?';
    }
    if (txtMaster) txtMaster.textContent = 'Erneut verbinden';
    if (pillBadge) pillBadge.className = 'bot-power-badge fabric-mismatch';
    if (txtBadge) txtBadge.textContent = 'Fabric Mod-Check';

    if (btnSidebar) {
      btnSidebar.className = 'btn btn-bot-power start';
      btnSidebar.textContent = '🔄 Erneut verbinden';
      btnSidebar.title = 'Erneut verbinden nach Mod-Installation';
    }
  } else if (isConnecting) {
    if (btnMaster) {
      btnMaster.className = 'btn-bot-master connecting';
      btnMaster.disabled = false;
      btnMaster.title = 'Verbindung wird aufgebaut...';
    }
    if (txtMaster) txtMaster.textContent = 'Verbinde...';
    if (pillBadge) pillBadge.className = 'bot-power-badge connecting';
    if (txtBadge) txtBadge.textContent = 'Verbinde...';

    if (btnSidebar) {
      btnSidebar.className = 'btn btn-bot-power stop';
      btnSidebar.textContent = '⏳ Verbinde...';
      btnSidebar.title = 'Verbindungsaufbau läuft';
    }
  } else {
    if (btnMaster) {
      btnMaster.className = 'btn-bot-master start';
      btnMaster.disabled = false;
      btnMaster.title = 'Bot auf dem Server starten';
    }
    if (txtMaster) txtMaster.textContent = 'Bot Starten';
    if (pillBadge) pillBadge.className = 'bot-power-badge stopped';
    if (txtBadge) txtBadge.textContent = 'Gestoppt';

    if (btnSidebar) {
      btnSidebar.className = 'btn btn-bot-power start';
      btnSidebar.textContent = '▶ Bot Starten';
      btnSidebar.title = 'Bot mit Server verbinden';
    }
  }
}

export async function toggleBotPower() {
  const btnMaster = getEl('btnMasterBotControl');
  const isCurrentlyOnline = btnMaster && btnMaster.classList.contains('stop');
  const isConnecting = btnMaster && btnMaster.classList.contains('connecting');

  if (isCurrentlyOnline || isConnecting) {
    updateBotPowerUI('STOPPED', false, false);
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
    } catch {
      sendWS({ type: 'control_action', action: 'stop_bot' });
    }
  } else {
    updateBotPowerUI('CONNECTING', true, false);
    try {
      await fetch('/api/bot/start', { method: 'POST' });
    } catch {
      sendWS({ type: 'control_action', action: 'start_bot' });
    }
  }
}

export function updateTelemetry(msg) {
  const pillLlm = getEl('pillLlmProvider');
  const pillExec = getEl('pillExecMode');

  if (msg.username) {
    const prevUsername = currentUsername;
    currentUsername = msg.username;
    if (prevUsername !== currentUsername) updateHandoffUI(currentHandoffState);
  }
  if (msg.status && msg.status !== currentHandoffState) {
    currentHandoffState = msg.status;
    updateHandoffUI(currentHandoffState);
  }

  // Preserve gear icon and latency badge in pillLlmProvider
  const txtActiveLlm = getEl('txtActiveLlmName');
  if (txtActiveLlm && msg.llmProvider) {
    txtActiveLlm.textContent = msg.llmProvider;
  } else if (pillLlm && msg.llmProvider && !txtActiveLlm) {
    pillLlm.textContent = msg.llmProvider;
  }

  if (pillExec) {
    if (msg.effectiveMode && msg.mode && msg.mode !== msg.effectiveMode) {
      pillExec.textContent = `${msg.mode} (${msg.effectiveMode})`;
    } else if (msg.mode) {
      pillExec.textContent = msg.mode;
    }
  }
  if (msg.serverRights) updateRightsUI(msg.serverRights);

  // Live Bot Activity & Status
  if (msg.activity) {
    const lblBadge = getEl('lblBotActivityBadge');
    const lblDetails = getEl('lblBotActivityDetails');
    if (lblBadge) {
      lblBadge.className = `activity-badge ${msg.activity.badgeClass || 'idle'}`;
      lblBadge.textContent = msg.activity.label || 'Bereit';
    }
    if (lblDetails) {
      lblDetails.textContent = msg.activity.details || '';
    }
  }

  const lblBotPos = getEl('lblBotPos');
  if (lblBotPos && msg.pos) {
    lblBotPos.textContent = `X: ${msg.pos.x}, Y: ${msg.pos.y}, Z: ${msg.pos.z}`;
  }

  const lblBotVitals = getEl('lblBotVitals');
  if (lblBotVitals) {
    lblBotVitals.textContent = `❤ ${msg.health} / 🍖 ${msg.food}`;
  }

  if (msg.buildProgress) {
    const lblBuildPhase = getEl('lblBuildPhase');
    const lblProgressTitle = getEl('lblProgressTitle');
    const lblProgressPercent = getEl('lblProgressPercent');
    const progressBarFill = getEl('progressBarFill');
    const lblBuildEta = getEl('lblBuildEta');

    if (lblBuildPhase) lblBuildPhase.textContent = msg.buildProgress.phase || 'Bereit';
    if (lblProgressTitle) lblProgressTitle.textContent = msg.buildProgress.title || 'Inaktiv';

    let percent = 0;
    if (typeof msg.buildProgress.progress === 'number') {
      percent = Math.round(msg.buildProgress.progress * 100);
    } else if (msg.buildProgress.totalBlocks > 0) {
      percent = Math.min(100, Math.round((msg.buildProgress.currentBlock / msg.buildProgress.totalBlocks) * 100));
    }
    if (lblProgressPercent) lblProgressPercent.textContent = `${percent}%`;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;

    if (lblBuildEta) {
      if (msg.buildProgress.active && msg.buildProgress.totalBlocks > msg.buildProgress.currentBlock) {
        const remaining = msg.buildProgress.totalBlocks - msg.buildProgress.currentBlock;
        const etaSeconds = Math.ceil(remaining / 12);
        if (etaSeconds < 60) {
          lblBuildEta.textContent = `${etaSeconds}s`;
        } else {
          const mins = Math.floor(etaSeconds / 60);
          const secs = etaSeconds % 60;
          lblBuildEta.textContent = `${mins}m ${secs}s`;
        }
      } else {
        lblBuildEta.textContent = '-';
      }
    }
  }
}

export function appendChatMessage(entry) {
  const chatMessages = getEl('chatMessages');
  if (!chatMessages) return;
  const msgDiv = document.createElement('div');
  const sender = (entry.sender || 'SYSTEM').toLowerCase();
  msgDiv.className = `chat-msg ${sender.includes('bot') || sender.includes('ki') ? 'bot' : sender.includes('system') ? 'system' : 'user'}`;

  const senderSpan = document.createElement('span');
  senderSpan.className = 'msg-sender';
  senderSpan.textContent = entry.sender;

  const textSpan = document.createElement('span');
  textSpan.className = 'msg-text';
  textSpan.textContent = entry.message;

  msgDiv.appendChild(senderSpan);
  msgDiv.appendChild(textSpan);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

export function applyCameraDetachedState(poppedOut) {
  const viewerFrame = getEl('viewerFrame');
  const viewerWrapper = getEl('viewerWrapper');
  const placeholder = getEl('viewerDetachedPlaceholder');
  const disabledPlaceholder = getEl('viewerDisabledPlaceholder');
  const gridContainer = typeof document !== 'undefined' ? document.querySelector('.grid-container') : null;
  const port = getEl('lblViewerPort')?.textContent || 3081;
  const targetUrl = `${window.location.protocol}//${window.location.hostname}:${port}`;

  if (poppedOut) {
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
    }
    if (viewerWrapper) {
      viewerWrapper.style.display = 'none';
    }
    if (disabledPlaceholder) {
      disabledPlaceholder.classList.add('hidden');
    }
    if (placeholder) {
      placeholder.classList.remove('hidden');
    }
    if (gridContainer) {
      gridContainer.classList.add('camera-detached');
    }
  } else {
    if (gridContainer) {
      gridContainer.classList.remove('camera-detached');
    }
    if (placeholder) {
      placeholder.classList.add('hidden');
    }
    if (!isViewerStreamActive()) {
      if (disabledPlaceholder) disabledPlaceholder.classList.remove('hidden');
      if (viewerWrapper) viewerWrapper.style.display = 'none';
      if (viewerFrame) viewerFrame.src = 'about:blank';
    } else {
      if (disabledPlaceholder) disabledPlaceholder.classList.add('hidden');
      if (viewerWrapper) viewerWrapper.style.display = '';
      if (viewerFrame) viewerFrame.src = targetUrl;
    }
  }
}

export function refreshViewer(forceReload = false) {
  if (!isViewerStreamActive()) return;
  const viewerFrame = getEl('viewerFrame');
  if (!viewerFrame || isPopoutActive() || isPoppedOut()) return;
  const port = resolveViewerPort();
  const offlinePlaceholder = getEl('viewerOfflinePlaceholder');

  if (offlinePlaceholder) {
    probeViewerReachability(forceReload, port);
  } else {
    const targetUrl = `${window.location.protocol}//${window.location.hostname}:${port}`;
    if (forceReload) {
      viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
    } else {
      const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
      if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(targetUrl)) {
        viewerFrame.src = targetUrl;
      }
    }
  }
}

// Register refreshViewer callback with botCamDiagnostics
setViewerRefreshCallback(refreshViewer);

export function updateStatus(msg) {
  if (msg.username) currentUsername = msg.username;
  const prevState = currentHandoffState;
  currentHandoffState = msg.state || 'ONLINE_ACTIVE';
  updateHandoffUI(currentHandoffState);
  updateBotPowerUI(currentHandoffState, msg.botRunning !== false, msg.botConnected !== false);

  const pillExec = getEl('pillExecMode');
  if (pillExec) {
    if (msg.effectiveMode && msg.mode && msg.mode !== msg.effectiveMode) {
      pillExec.textContent = `${msg.mode} (${msg.effectiveMode})`;
    } else if (msg.mode) {
      pillExec.textContent = msg.mode;
    }
  }
  if (msg.serverRights) updateRightsUI(msg.serverRights);
  if (msg.hasEnvFile === false || msg.isFullyConfigured === false) openOnboardingModal();

  const viewerPort = msg.viewerPort || 3081;
  const lblPort = getEl('lblViewerPort');
  if (lblPort) lblPort.textContent = viewerPort;

  if (msg.viewerEnabled !== undefined) {
    applyViewerStreamEnabled(msg.viewerEnabled, msg.viewerRunning, viewerPort);
  }

  const version = msg.version || msg.mcVersion;
  const versionChanged = !!(version && lastKnownVersion && version !== lastKnownVersion);
  const reconnected = !!((prevState === 'RECONNECTING' && currentHandoffState === 'ONLINE_ACTIVE') || msg.reconnected === true);

  if (version) lastKnownVersion = version;

  const viewerFrame = getEl('viewerFrame');
  const offlinePlaceholder = getEl('viewerOfflinePlaceholder');
  if (viewerFrame && !isPopoutActive() && !isPoppedOut() && isViewerStreamActive()) {
    if (offlinePlaceholder) {
      if (msg.viewerRunning === false || msg.botConnected === false) {
        setViewerOnlineStatus(false, viewerPort);
      } else if (reconnected) {
        probeViewerReachability(false, viewerPort);
      } else if (!isViewerOffline()) {
        const targetUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
        const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
        if (versionChanged) {
          viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
        } else if (!viewerFrame.src || !currentSrc.startsWith(targetUrl)) {
          viewerFrame.src = targetUrl;
        }
      }
    } else {
      const targetUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
      const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
      if (reconnected || versionChanged) {
        viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
      } else if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(targetUrl)) {
        viewerFrame.src = targetUrl;
      }
    }
  }
}

/**
 * Displays a non-intrusive Dark-CAD / Glassmorphic toast notification.
 * @param {string} message
 * @param {'info'|'success'|'warning'|'danger'|'command'} [type='info']
 * @param {number} [duration=3200]
 */
export function showDashboardToast(message, type = 'info', duration = 3200) {
  if (typeof document === 'undefined') return;
  let container = document.getElementById('dashboardToastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'dashboardToastContainer';
    container.className = 'dashboard-toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `dashboard-toast toast-${type}`;

  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  else if (type === 'warning') icon = '⚠️';
  else if (type === 'danger' || type === 'error') icon = '⛔';
  else if (type === 'command') icon = '⚡';

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));

  setTimeout(() => {
    toast.classList.remove('visible');
    toast.classList.add('fade-out');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, duration);
}
