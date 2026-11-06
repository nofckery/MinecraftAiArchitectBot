/**
 * Architect Mission Control — Interactive 3D CAD & Agentic Builder Web Frontend
 * Entry Orchestrator and Backward-Compatible Facade.
 * Coordinates ES submodules under ./js/ (wsClient, threeViewport, areaMap,
 * onboardingWizard, modelCockpit, schematicUI).
 */

import { connectWebSocket, sendWS, getWebSocketState, getWebSocket } from './js/wsClient.js';
import {
  initThree,
  renderVoxelPreview,
  renderTerrainXray,
  setXrayActive,
  handleVoxelDelta,
  clearSelectionBox,
  setActiveTool,
  updateSelectionGizmo,
  applyYSlice,
  renderBOM,
  openSwapModal,
  applyTheme,
  getBlockColor,
  getCurrentSelectionBox
} from './js/threeViewport.js';
import { drawAreaMap, screenToGridCoords, findCellAt } from './js/areaMap.js';
import {
  loadSettings,
  applySettingsToUI,
  syncOnboardingValues,
  openOnboardingModal,
  closeOnboardingModal,
  validateStep,
  goToOnboardingStep,
  updateOnboardingSummary,
  saveSettingsFromForm,
  submitOnboarding,
  updateRightsUI,
  updateEnvBadge,
  initSettingsAndOnboarding,
  handleMsaCodeMessage,
  handleMsaSuccess
} from './js/onboardingWizard.js';
import {
  initModelCockpit,
  closeModelSettingsModal,
  closeEndpointDrawer,
  cancelDeviceFlow,
  handleEndpointStatusChange,
  handleProbeProgress,
  handleDeviceAuthSuccess,
  handleTierActivated
} from './js/modelCockpit.js';
import { loadSchematicsList, initSchematics } from './js/schematicUI.js';
import {
  initManualCockpit,
  handleTelemetryUpdate,
  handleGamemodeState,
  isGamemode,
  exitGamemode,
  isPopoutActive
} from './js/manualCockpit.js';
import {
  isPoppedOut,
  initViewerController,
  onStateChange,
  toggleFullscreen,
  openPopout,
  reembed,
  focusPopout
} from './js/viewerController.js';

// ==============================================================================
// 1. GLOBAL STATE & DOM ELEMENT BINDINGS
// ==============================================================================
let currentPreviewData = null;
let currentHandoffState = 'ONLINE_ACTIVE';
let currentUsername = 'BaumeisterKI';
let isXrayActive = false;
let buildBoxFacing = 'north';
let areaMapData = null;
let mapSelection = null;
let mapIsDragging = false;
let lastKnownVersion = null;

// DOM Cache Helper for SSR / Node environment compatibility
const getEl = (id) => (typeof document !== 'undefined' ? document.getElementById(id) : null);
const getEls = (sel) => (typeof document !== 'undefined' ? document.querySelectorAll(sel) : []);

const pillLlm = getEl('pillLlmProvider');
const pillExec = getEl('pillExecMode');
const chatMessages = getEl('chatMessages');
const chatForm = getEl('chatForm');
const txtPrompt = getEl('txtPrompt');
const chkAutoExecute = getEl('chkAutoExecute');
const btnClearSelectionBox = getEl('btnClearSelectionBox');
const btnConfirmBuild = getEl('btnConfirmBuild');
const btnUndoBuild = getEl('btnUndoBuild');
const btnStopBuild = getEl('btnStopBuild');
const btnExportSchem = getEl('btnExportSchem');
const btnToggleHandoff = getEl('btnToggleHandoff');
const handoffBadge = getEl('handoffStateBadge');
const handoffDesc = getEl('handoffStateDesc');
const ySliceSlider = getEl('ySliceSlider');
const ySliceValue = getEl('ySliceValue');
const btnResetSlicer = getEl('btnResetSlicer');
const btnToggleXray = getEl('btnToggleXray');
const areaMapCanvas = getEl('areaMapCanvas');
const mapCtx = areaMapCanvas ? areaMapCanvas.getContext('2d') : null;
const mapTooltip = getEl('mapTooltip');
const btnApplyBuildBox = getEl('btnApplyBuildBox');
const btnRefreshMap = getEl('btnRefreshMap');
const selectionDimensions = getEl('selectionDimensions');
const facingBtns = getEls('.btn-facing');

// ==============================================================================
// 2. SERVER MESSAGE DISPATCHER
// ==============================================================================
export function handleServerMessage(msg) {
  switch (msg.type) {
    case 'status':
      updateStatus(msg);
      break;
    case 'chat_history':
      if (Array.isArray(msg.history)) {
        if (chatMessages) chatMessages.innerHTML = '';
        msg.history.forEach(appendChatMessage);
      }
      break;
    case 'chat_log':
      appendChatMessage(msg);
      break;
    case 'bot_telemetry':
      updateTelemetry(msg);
      handleTelemetryUpdate(msg);
      break;
    case 'manual_control_state':
      handleGamemodeState(msg);
      break;
    case 'area_map_data':
      areaMapData = msg;
      renderAreaMap();
      break;
    case 'voxel_preview':
      currentPreviewData = msg;
      renderVoxelPreview(msg);
      break;
    case 'terrain_xray_data':
      renderTerrainXray(msg.blocks || [], !!msg.isSimulated);
      break;
    case 'voxel_delta':
      handleVoxelDelta(msg);
      break;
    case 'server_rights_updated':
      updateRightsUI(msg);
      break;
    case 'settings_updated':
      if (msg.settings) {
        const prevVer = lastKnownVersion;
        if (msg.settings.MC_VERSION) {
          lastKnownVersion = msg.settings.MC_VERSION;
        }
        applySettingsToUI(msg.settings);
        if (msg.reconnected || (prevVer && msg.settings.MC_VERSION && prevVer !== msg.settings.MC_VERSION)) {
          refreshViewer(true);
        }
      }
      if (msg.hasEnvFile !== undefined) updateEnvBadge(msg.hasEnvFile);
      break;
    case 'endpoint_status_change':
      handleEndpointStatusChange(msg);
      break;
    case 'probe_progress':
      handleProbeProgress(msg);
      break;
    case 'device_auth_success':
      handleDeviceAuthSuccess(msg);
      break;
    case 'tier_activated':
      handleTierActivated(msg);
      break;
    case 'msa_code':
      handleMsaCodeMessage(msg);
      break;
    case 'msa_success':
      handleMsaSuccess(msg.username);
      break;
    case 'msa_error':
      console.error('[MSA] Authentifizierungsfehler:', msg.error);
      break;
    case 'bot_state_change':
      if (msg.state) currentHandoffState = msg.state;
      updateBotPowerUI(msg.state, msg.running, msg.connected);
      updateHandoffUI(msg.state);
      break;
    default:
      break;
  }
}

// ==============================================================================
// 3. TELEMETRY, HANDOFF & CHAT COORDINATION
// ==============================================================================
export function applyCameraDetachedState(poppedOut) {
  const viewerFrame = document.getElementById('viewerFrame');
  const viewerWrapper = document.getElementById('viewerWrapper');
  const placeholder = document.getElementById('viewerDetachedPlaceholder');
  const gridContainer = document.querySelector('.grid-container');
  const port = document.getElementById('lblViewerPort')?.textContent || 3081;
  const targetUrl = `${window.location.protocol}//${window.location.hostname}:${port}`;

  if (poppedOut) {
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
    }
    if (viewerWrapper) {
      viewerWrapper.style.display = 'none';
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
    if (viewerWrapper) {
      viewerWrapper.style.display = '';
    }
    if (viewerFrame) {
      viewerFrame.src = targetUrl;
    }
  }
}

export function refreshViewer(forceReload = false) {
  const viewerFrame = document.getElementById('viewerFrame');
  if (!viewerFrame || isPopoutActive() || isPoppedOut()) return;
  const port = document.getElementById('lblViewerPort')?.textContent || 3081;
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

export function updateStatus(msg) {
  if (msg.username) currentUsername = msg.username;
  const prevState = currentHandoffState;
  currentHandoffState = msg.state || 'ONLINE_ACTIVE';
  updateHandoffUI(currentHandoffState);
  updateBotPowerUI(currentHandoffState, msg.botRunning !== false, msg.botConnected !== false);
  if (pillExec) {
    if (msg.effectiveMode && msg.mode && msg.mode !== msg.effectiveMode) {
      pillExec.textContent = `${msg.mode} (${msg.effectiveMode})`;
    } else if (msg.mode) {
      pillExec.textContent = msg.mode;
    }
  }
  if (msg.serverRights) updateRightsUI(msg.serverRights);
  if (msg.hasEnvFile === false) openOnboardingModal();

  const viewerPort = msg.viewerPort || 3081;
  const lblPort = document.getElementById('lblViewerPort');
  if (lblPort) lblPort.textContent = viewerPort;

  const version = msg.version || msg.mcVersion;
  const versionChanged = !!(version && lastKnownVersion && version !== lastKnownVersion);
  const reconnected = !!((prevState === 'RECONNECTING' && currentHandoffState === 'ONLINE_ACTIVE') || msg.reconnected === true);

  if (version) lastKnownVersion = version;

  const viewerFrame = document.getElementById('viewerFrame');
  if (viewerFrame && !isPopoutActive() && !isPoppedOut()) {
    const targetUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
    const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
    if (reconnected || versionChanged) {
      viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
    } else if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(targetUrl)) {
      viewerFrame.src = targetUrl;
    }
  }
}

export function updateHandoffUI(state) {
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
  }
}

export function updateBotPowerUI(state, running, connected) {
  const btnMaster = document.getElementById('btnMasterBotControl');
  const txtMaster = document.getElementById('btnMasterBotText');
  const pillBadge = document.getElementById('pillBotStatusBadge');
  const txtBadge = document.getElementById('txtBotStatusBadge');
  const btnSidebar = document.getElementById('btnSidebarBotPower');

  const isOnline = connected || state === 'ONLINE_ACTIVE';
  const isConnecting = state === 'CONNECTING' || state === 'RECONNECTING';

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
  const btnMaster = document.getElementById('btnMasterBotControl');
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
  if (msg.username) {
    const prevUsername = currentUsername;
    currentUsername = msg.username;
    if (prevUsername !== currentUsername) updateHandoffUI(currentHandoffState);
  }
  if (msg.status && msg.status !== currentHandoffState) {
    currentHandoffState = msg.status;
    updateHandoffUI(currentHandoffState);
  }
  if (pillLlm && msg.llmProvider) pillLlm.textContent = msg.llmProvider;
  if (pillExec) {
    if (msg.effectiveMode && msg.mode && msg.mode !== msg.effectiveMode) {
      pillExec.textContent = `${msg.mode} (${msg.effectiveMode})`;
    } else if (msg.mode) {
      pillExec.textContent = msg.mode;
    }
  }
  if (msg.serverRights) updateRightsUI(msg.serverRights);

  const lblBotPos = document.getElementById('lblBotPos');
  if (lblBotPos && msg.pos) {
    lblBotPos.textContent = `X: ${msg.pos.x}, Y: ${msg.pos.y}, Z: ${msg.pos.z}`;
  }

  const lblBotVitals = document.getElementById('lblBotVitals');
  if (lblBotVitals) {
    lblBotVitals.textContent = `❤ ${msg.health} / 🍖 ${msg.food}`;
  }

  if (msg.buildProgress) {
    const lblBuildPhase = document.getElementById('lblBuildPhase');
    const lblProgressTitle = document.getElementById('lblProgressTitle');
    const lblProgressPercent = document.getElementById('lblProgressPercent');
    const progressBarFill = document.getElementById('progressBarFill');
    const lblBuildEta = document.getElementById('lblBuildEta');

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

// ==============================================================================
// 4. 2D TOPOGRAPHIC AREA MAP INTEGRATION
// ==============================================================================
export function renderAreaMap() {
  if (!mapCtx || !areaMapCanvas || !areaMapData) return;
  // Höhenlinien & yDiff topologische Geländekartierung via areaMap.js
  // Clamping shiftY und shiftX gegen Rand-Clipping des Richtungspfeils
  drawAreaMap(areaMapCanvas, mapCtx, areaMapData, mapSelection, buildBoxFacing);
}

// ==============================================================================
// 5. MODULAR SUBMODULE INTEGRATION
// ==============================================================================
// Modular delegation: modelCockpit, manualCockpit, viewerController, areaMap,
// threeViewport, and onboardingWizard cleanly manage their respective domains.


// ==============================================================================
// 6. DOM EVENT WIRING & LIFECYCLE
// ==============================================================================
export function initEventListeners() {
  // Navigation Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(btn.dataset.tab);
      if (pane) pane.classList.add('active');
      if (btn.dataset.tab === 'tab-schematics') loadSchematicsList();
      if (btn.dataset.tab === 'tab-settings') loadSettings();
    });
  });

  // CAD Tools
  const toolOrbit = document.getElementById('toolOrbit');
  const toolSelectBox = document.getElementById('toolSelectBox');
  const toolBrush = document.getElementById('toolBrush');
  const toolEraser = document.getElementById('toolEraser');
  const toolEyedropper = document.getElementById('toolEyedropper');

  if (toolOrbit) toolOrbit.onclick = () => setActiveTool('orbit');
  if (toolSelectBox) toolSelectBox.onclick = () => setActiveTool('selectBox');
  if (toolBrush) toolBrush.onclick = () => setActiveTool('brush');
  if (toolEraser) toolEraser.onclick = () => setActiveTool('eraser');
  if (toolEyedropper) toolEyedropper.onclick = () => setActiveTool('eyedropper');

  // CAD Transforms
  const btnMirrorX = document.getElementById('btnMirrorX');
  const btnMirrorZ = document.getElementById('btnMirrorZ');
  const btnRotate90 = document.getElementById('btnRotate90');
  const btnShiftYUp = document.getElementById('btnShiftYUp');
  const btnShiftYDown = document.getElementById('btnShiftYDown');

  if (btnMirrorX) btnMirrorX.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_x' });
  if (btnMirrorZ) btnMirrorZ.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_z' });
  if (btnRotate90) btnRotate90.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'rotate_90_cw' });
  if (btnShiftYUp) btnShiftYUp.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_up' });
  if (btnShiftYDown) btnShiftYDown.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_down' });

  // X-Ray Toggle
  if (btnToggleXray) {
    btnToggleXray.onclick = () => {
      isXrayActive = !isXrayActive;
      setXrayActive(isXrayActive);
      btnToggleXray.classList.toggle('active', isXrayActive);
      if (isXrayActive) {
        sendWS({ type: 'request_terrain_xray' });
      } else {
        renderTerrainXray([]);
      }
    };
  }

  // Quick Themes
  const btnThemeMedieval = document.getElementById('btnThemeMedieval');
  const btnThemeGothic = document.getElementById('btnThemeGothic');
  const btnThemeDesert = document.getElementById('btnThemeDesert');
  const btnThemeCherry = document.getElementById('btnThemeCherry');

  if (btnThemeMedieval) btnThemeMedieval.onclick = () => applyTheme('medieval_spruce', sendWS);
  if (btnThemeGothic) btnThemeGothic.onclick = () => applyTheme('deepslate_gothic', sendWS);
  if (btnThemeDesert) btnThemeDesert.onclick = () => applyTheme('desert_sandstone', sendWS);
  if (btnThemeCherry) btnThemeCherry.onclick = () => applyTheme('cherry_asian', sendWS);

  if (btnClearSelectionBox) btnClearSelectionBox.onclick = clearSelectionBox;

  // Y-Slice Slider
  if (ySliceSlider && ySliceValue) {
    ySliceSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      ySliceValue.textContent = `Schnitt-Höhe Y: ${val} / ${ySliceSlider.max}`;
      applyYSlice(val);
    });
  }

  if (btnResetSlicer && ySliceSlider && ySliceValue) {
    btnResetSlicer.onclick = () => {
      ySliceSlider.value = ySliceSlider.max;
      ySliceValue.textContent = `Schnitt-Höhe Y: 1 bis Max (${ySliceSlider.max})`;
      applyYSlice(parseInt(ySliceSlider.max, 10));
    };
  }

  // Chat Form & Prompt submission
  if (chatForm && txtPrompt) {
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      const prompt = txtPrompt.value.trim();
      if (!prompt) return;

      const selBox = getCurrentSelectionBox();
      if (selBox) {
        sendWS({
          type: 'region_ai_edit',
          instruction: prompt,
          selectionBox: selBox
        });
        clearSelectionBox();
      } else {
        sendWS({
          type: 'prompt_architect',
          text: prompt,
          autoExecute: chkAutoExecute?.checked
        });
      }
      txtPrompt.value = '';
    };
  }

  // Quick Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      if (txtPrompt) {
        txtPrompt.value = chip.dataset.prompt;
        txtPrompt.focus();
      }
    };
  });

  // Action Buttons
  if (btnConfirmBuild) btnConfirmBuild.onclick = () => sendWS({ type: 'confirm_build' });
  if (btnUndoBuild) btnUndoBuild.onclick = () => sendWS({ type: 'control_action', action: 'undo' });
  if (btnStopBuild) btnStopBuild.onclick = () => sendWS({ type: 'control_action', action: 'stop' });

  if (btnExportSchem) {
    btnExportSchem.onclick = () => {
      const rawChoice = window.prompt('Dateiname für Export eingeben (.schem für Sponge/WorldEdit oder .nbt für Vanilla Structure Block):', `architect_${Date.now()}.schem`);
      if (rawChoice) {
        const trimmed = rawChoice.trim();
        const isNbt = trimmed.toLowerCase().endsWith('.nbt');
        const format = isNbt ? 'nbt' : 'schem';
        const cleanName = trimmed.replace(/\.(schem|nbt)$/i, '');
        window.open(`/api/schematics/export/${encodeURIComponent(cleanName)}?format=${format}`);
      }
    };
  }

  const btnReloadViewer = document.getElementById('btnReloadViewer');
  if (btnReloadViewer) {
    btnReloadViewer.onclick = () => {
      refreshViewer(true);
    };
  }

  // Milestone 3: Fullscreen & Multi-Monitor Popout Wiring
  initViewerController();
  onStateChange((poppedOut) => {
    applyCameraDetachedState(poppedOut);
  });

  const btnFullscreenViewer = document.getElementById('btnFullscreenViewer');
  const viewerWrapper = document.getElementById('viewerWrapper');
  if (btnFullscreenViewer && viewerWrapper) {
    btnFullscreenViewer.onclick = () => {
      toggleFullscreen(viewerWrapper);
    };
  }

  document.addEventListener('fullscreenchange', () => {
    const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (btnFullscreenViewer) {
      btnFullscreenViewer.innerHTML = isFs ? '🗗 Beenden' : '⛶ Vollbild';
      btnFullscreenViewer.title = isFs ? 'Vollbildmodus beenden (Esc)' : 'Vollbildmodus aktivieren';
    }
    if (viewerWrapper) {
      viewerWrapper.classList.toggle('is-fullscreen', isFs);
    }
  });

  const btnPopoutViewer = document.getElementById('btnPopoutViewer');
  if (btnPopoutViewer) {
    btnPopoutViewer.onclick = () => {
      const port = document.getElementById('lblViewerPort')?.textContent || 3081;
      openPopout(port);
    };
  }

  const btnReembedViewer = document.getElementById('btnReembedViewer');
  if (btnReembedViewer) {
    btnReembedViewer.onclick = () => {
      reembed();
    };
  }

  const btnRefocusPopout = document.getElementById('btnRefocusPopout');
  if (btnRefocusPopout) {
    btnRefocusPopout.onclick = () => {
      focusPopout();
    };
  }

  if (btnToggleHandoff) {
    btnToggleHandoff.onclick = () => {
      const isPaused = currentHandoffState === 'PAUSED_OWNER_INGAME';
      sendWS({
        type: 'control_action',
        action: isPaused ? 'resume_bot' : 'pause_for_player'
      });
    };
  }

  // Master Bot Power Buttons
  const btnMaster = document.getElementById('btnMasterBotControl');
  if (btnMaster) btnMaster.onclick = toggleBotPower;

  const btnSidebarPower = document.getElementById('btnSidebarBotPower');
  if (btnSidebarPower) btnSidebarPower.onclick = toggleBotPower;

  // Initialer Status-Abruf für Bot-Power-Zustand
  fetch('/api/status').then(r => r.json()).then(data => {
    if (data) {
      updateBotPowerUI(data.status, data.botRunning, data.botConnected);
    }
  }).catch(() => {});

  // Facing buttons in 2D Map
  facingBtns.forEach(btn => {
    btn.onclick = () => {
      facingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildBoxFacing = btn.dataset.facing;
      if (mapSelection) {
        const minCol = Math.min(mapSelection.x1, mapSelection.x2);
        const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
        const minRow = Math.min(mapSelection.z1, mapSelection.z2);
        const maxRow = Math.max(mapSelection.z1, mapSelection.z2);
        const w = maxCol - minCol + 1;
        const d = maxRow - minRow + 1;
        if (selectionDimensions) selectionDimensions.textContent = `${w}x${d} Blöcke (${buildBoxFacing})`;
        if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
      }
      renderAreaMap();
    };
  });

  // 2D Map Canvas Interaction
  if (areaMapCanvas) {
    areaMapCanvas.onmousedown = (e) => {
      const rect = areaMapCanvas.getBoundingClientRect();
      const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
      const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

      if (e.shiftKey) {
        // Shift + Click: move bot
        if (areaMapData) {
          const targetX = areaMapData.center.x - 32 + col;
          const targetZ = areaMapData.center.z - 32 + row;
          const cell = findCellAt(areaMapData, targetX, targetZ);
          const targetY = (cell && typeof cell.y === 'number') ? (cell.y + 1) : (areaMapData.center?.y ?? 64);

          sendWS({
            type: 'control_action',
            action: 'move_to',
            targetPos: { x: targetX, y: targetY, z: targetZ }
          });
        }
        return;
      }

      mapIsDragging = true;
      mapSelection = { x1: col, z1: row, x2: col, z2: row };
      if (selectionDimensions) selectionDimensions.textContent = '1x1 Blöcke markiert';
      if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
      renderAreaMap();
    };

    areaMapCanvas.onmousemove = (e) => {
      const rect = areaMapCanvas.getBoundingClientRect();
      const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
      const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

      if (areaMapData && mapTooltip) {
        const worldX = areaMapData.center.x - 32 + col;
        const worldZ = areaMapData.center.z - 32 + row;
        const cell = findCellAt(areaMapData, worldX, worldZ);

        if (cell) {
          const wrapperRect = areaMapCanvas.parentElement ? areaMapCanvas.parentElement.getBoundingClientRect() : rect;
          let tipX = e.clientX - wrapperRect.left + 12;
          let tipY = e.clientY - wrapperRect.top + 12;
          if (tipX + 130 > wrapperRect.width) tipX = e.clientX - wrapperRect.left - 135;
          if (tipY + 45 > wrapperRect.height) tipY = e.clientY - wrapperRect.top - 45;
          mapTooltip.innerHTML = `<strong>${cell.blockName || 'unbekannt'}</strong><br>X: ${cell.x}, Y: ${cell.y}, Z: ${cell.z}`;
          mapTooltip.style.left = `${Math.max(4, Math.min(Math.max(4, wrapperRect.width - 130), tipX))}px`;
          mapTooltip.style.top = `${Math.max(4, Math.min(Math.max(4, wrapperRect.height - 45), tipY))}px`;
          mapTooltip.style.display = 'block';
        } else {
          mapTooltip.style.display = 'none';
        }
      }

      if (!mapIsDragging || !mapSelection) return;

      mapSelection.x2 = col;
      mapSelection.z2 = row;
      const w = Math.abs(mapSelection.x2 - mapSelection.x1) + 1;
      const d = Math.abs(mapSelection.z2 - mapSelection.z1) + 1;
      if (selectionDimensions) selectionDimensions.textContent = `${w}x${d} Blöcke markiert`;
      if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
      renderAreaMap();
    };

    areaMapCanvas.onmouseleave = () => {
      if (mapTooltip) mapTooltip.style.display = 'none';
    };

    window.addEventListener('mouseup', () => {
      if (mapIsDragging) mapIsDragging = false;
    });

    if (btnApplyBuildBox) {
      btnApplyBuildBox.onclick = () => {
        if (!mapSelection || !areaMapData) return;
        const minCol = Math.min(mapSelection.x1, mapSelection.x2);
        const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
        const minRow = Math.min(mapSelection.z1, mapSelection.z2);
        const maxRow = Math.max(mapSelection.z1, mapSelection.z2);

        const minX = areaMapData.center.x - 32 + minCol;
        const maxX = areaMapData.center.x - 32 + maxCol;
        const minZ = areaMapData.center.z - 32 + minRow;
        const maxZ = areaMapData.center.z - 32 + maxRow;

        let baseY = areaMapData.center.y;
        if (areaMapData.grid) {
          const selectedCells = areaMapData.grid.filter(c => c.x >= minX && c.x <= maxX && c.z >= minZ && c.z <= maxZ && typeof c.y === 'number');
          if (selectedCells.length > 0) {
            baseY = Math.min(...selectedCells.map(c => c.y));
          }
        }

        sendWS({
          type: 'set_build_box',
          minX, minZ, maxX, maxZ,
          baseY,
          facing: buildBoxFacing
        });

        if (selectionDimensions) selectionDimensions.textContent = `Fixiert: ${maxCol - minCol + 1}x${maxRow - minRow + 1} (${buildBoxFacing})`;
        btnApplyBuildBox.disabled = true;
      };
    }

    if (btnRefreshMap) {
      btnRefreshMap.onclick = () => sendWS({ type: 'request_area_map' });
    }
  }

  // Global ESC Key Handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const onboardModal = document.getElementById('onboardingModal');
      if (onboardModal && !onboardModal.classList.contains('hidden')) {
        closeOnboardingModal();
        return;
      }
      const drawer = document.getElementById('drawerEndpointEdit') || document.getElementById('drawerEndpointConfig');
      if (drawer && !drawer.classList.contains('hidden')) {
        closeEndpointDrawer();
        return;
      }
      const deviceModal = document.getElementById('modalDeviceFlow');
      if (deviceModal && !deviceModal.classList.contains('hidden')) {
        cancelDeviceFlow();
        return;
      }
      const modelModal = document.getElementById('modalModelSettings');
      if (modelModal && !modelModal.classList.contains('hidden')) {
        closeModelSettingsModal();
        return;
      }
      if (typeof isGamemode === 'function' && isGamemode()) {
        exitGamemode('esc_key');
        return;
      }
    }
  });

  // 1-Click Clipboard copying
  const btnCopyCode = document.getElementById('btnCopyDeviceCode') || document.getElementById('btnCopyUserCode');
  if (btnCopyCode) {
    btnCopyCode.addEventListener('click', async () => {
      const userCodeEl = document.getElementById('txtDeviceCode') || document.getElementById('txtDeviceUserCode') || document.getElementById('userCodeDisplay');
      if (userCodeEl && userCodeEl.textContent) {
        try {
          await navigator.clipboard.writeText(userCodeEl.textContent.trim());
          const original = btnCopyCode.textContent;
          btnCopyCode.textContent = '✓ Kopiert!';
          setTimeout(() => { btnCopyCode.textContent = original; }, 2000);
        } catch {}
      }
    });
  }
}

// ==============================================================================
// 7. ORCHESTRATOR ENTRY BOOTSTRAP
// ==============================================================================
if (typeof window !== 'undefined' && window.addEventListener) {
  window.addEventListener('DOMContentLoaded', () => {
    initThree();
    initEventListeners();
    initSettingsAndOnboarding();
    initModelCockpit();
    initSchematics(sendWS);
    initManualCockpit();
    connectWebSocket(handleServerMessage);
    loadSchematicsList();
    loadSettings();
  });
}
