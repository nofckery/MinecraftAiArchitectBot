/**
 * Architect Mission Control — Interactive 3D CAD & Agentic Builder Web Frontend
 * Entry Orchestrator and Backward-Compatible Facade.
 * Coordinates modular ES submodules under ./js/ (wsClient, threeViewport, areaMap,
 * onboardingWizard, modelCockpit, schematicUI, manualCockpit, viewerController,
 * ui/botCamDiagnostics, ui/telemetryBar, studio/cadStudioController, events/appEventListeners).
 */

import { connectWebSocket, sendWS, getWebSocketState, getWebSocket } from './js/wsClient.js';
import {
  initThree,
  renderVoxelPreview,
  renderTerrainXray,
  handleVoxelDelta,
  renderStudioTerrain,
  renderVerifierOverlay
} from './js/threeViewport.js';
import {
  getSceneSnapshot,
  setTerrainData,
  setVerifierReport
} from './js/sceneGraph.js';
import {
  loadSettings,
  applySettingsToUI,
  updateRightsUI,
  updateEnvBadge,
  initSettingsAndOnboarding,
  handleMsaCodeMessage,
  handleMsaSuccess
} from './js/onboardingWizard.js';
import {
  initModelCockpit,
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
  handleIncomingChat
} from './js/manualCockpit.js';
import { isPoppedOut } from './js/viewerController.js';

// Modular Subsystems
import {
  resolveViewerPort,
  executeViewerProbe,
  setViewerOnlineStatus,
  probeViewerReachability,
  applyViewerStreamEnabled,
  toggleViewerStream,
  renderDiscoveredLanWorlds,
  connectToLanWorld,
  renderKickDiagnostic,
  isViewerStreamActive
} from './js/ui/botCamDiagnostics.js';

import {
  updateStatus,
  updateHandoffUI,
  updateBotPowerUI,
  toggleBotPower,
  updateTelemetry,
  appendChatMessage,
  applyCameraDetachedState,
  refreshViewer,
  setCurrentHandoffState,
  getLastKnownVersion,
  setLastKnownVersion,
  showDashboardToast
} from './js/ui/telemetryBar.js';

import {
  initBlockCatalog,
  updateVerifierBadgesUI,
  renderSceneTreeUI,
  syncInspectorUI,
  handleStudioAiResult,
  handleStudioBuildQueueProgress,
  loadCadStudioDiscovery,
  addSchematicToStudioScene,
  toggleCadStudioFullscreen
} from './js/studio/cadStudioController.js';

import {
  initEventListeners,
  renderAreaMap,
  setAreaMapData
} from './js/events/appEventListeners.js';

// Re-export required orchestrator contracts
export {
  updateStatus,
  updateTelemetry,
  applyCameraDetachedState,
  refreshViewer,
  toggleBotPower,
  updateBotPowerUI,
  updateHandoffUI,
  initEventListeners,
  renderAreaMap,
  appendChatMessage,
  renderKickDiagnostic,
  resolveViewerPort,
  executeViewerProbe,
  setViewerOnlineStatus,
  probeViewerReachability,
  applyViewerStreamEnabled,
  toggleViewerStream,
  renderDiscoveredLanWorlds,
  connectToLanWorld,
  initBlockCatalog,
  updateVerifierBadgesUI,
  renderSceneTreeUI,
  syncInspectorUI,
  handleStudioAiResult,
  handleStudioBuildQueueProgress,
  loadCadStudioDiscovery,
  addSchematicToStudioScene,
  toggleCadStudioFullscreen,
  showDashboardToast
};

// Global state cache
let currentPreviewData = null;

// ==============================================================================
// SERVER MESSAGE DISPATCHER
// ==============================================================================
export function handleServerMessage(msg) {
  switch (msg.type) {
    case 'status':
      updateStatus(msg);
      break;
    case 'chat_history':
      if (Array.isArray(msg.history)) {
        const chatMessages = typeof document !== 'undefined' ? document.getElementById('chatMessages') : null;
        if (chatMessages) chatMessages.innerHTML = '';
        msg.history.forEach(appendChatMessage);
      }
      break;
    case 'chat_log':
      appendChatMessage(msg);
      handleIncomingChat(msg);
      break;
    case 'bot_telemetry':
      updateTelemetry(msg);
      handleTelemetryUpdate(msg);
      break;
    case 'manual_control_state':
      handleGamemodeState(msg);
      break;
    case 'area_map_data':
      setAreaMapData(msg);
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
    case 'night_disconnect_toggled': {
      const tEl = typeof document !== 'undefined' ? document.getElementById('toggleNightDisconnect') : null;
      if (tEl) tEl.checked = Boolean(msg.enabled);
      const lEl = typeof document !== 'undefined' ? document.getElementById('lblNightDisconnectStatus') : null;
      if (lEl) lEl.textContent = msg.enabled ? 'Aktiv (Nacht-Skip)' : 'Aus (bleibt auf Server)';
      const cEl = typeof document !== 'undefined' ? document.getElementById('cfgSleepDisconnect') : null;
      if (cEl) cEl.checked = Boolean(msg.enabled);
      break;
    }
    case 'settings_updated':
      if (msg.settings) {
        const prevVer = getLastKnownVersion();
        if (msg.settings.MC_VERSION) {
          setLastKnownVersion(msg.settings.MC_VERSION);
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
      if (msg.state) setCurrentHandoffState(msg.state);
      updateBotPowerUI(msg.state, msg.running, msg.connected);
      updateHandoffUI(msg.state);
      break;
    case 'viewer_state_changed':
      applyViewerStreamEnabled(msg.enabled, msg.running, msg.port);
      break;
    case 'lan_worlds_updated':
      renderDiscoveredLanWorlds(msg.worlds);
      break;
    case 'bot_kick_diagnostic':
      renderKickDiagnostic(msg.classification, msg.reason);
      break;
    case 'studio_terrain_data':
      if (msg.terrain) {
        setTerrainData(msg.terrain);
        renderStudioTerrain(msg.terrain);
        const snap = getSceneSnapshot();
        if (snap.objects.length > 0) {
          sendWS({
            type: 'studio_sync_scene',
            objects: snap.objects,
            activeObjectId: snap.activeObjectId,
            userDeltas: snap.userDeltas,
            requestVerify: true
          });
        }
      }
      break;
    case 'studio_verifier_report':
      if (msg.report) {
        setVerifierReport(msg.report);
        renderVerifierOverlay(msg.report);
        updateVerifierBadgesUI(msg.report);
      }
      break;
    case 'studio_ai_result':
      handleStudioAiResult(msg);
      break;
    case 'studio_build_queue_progress':
      handleStudioBuildQueueProgress(msg);
      break;
    default:
      break;
  }
}

// Diagnostic DOM hooks contract references:
// Elements #btnDismissFabricDiag, #btnRetryFabricConnect and FABRIC_MISMATCH state are handled
// by botCamDiagnostics.js and telemetryBar.js; refreshViewer utilizes cache-buster ?v=${Date.now()}.

// ==============================================================================
// ORCHESTRATOR ENTRY BOOTSTRAP
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

    // Initial Bot-Cam reachability check
    if (isViewerStreamActive() && !isPoppedOut()) {
      probeViewerReachability(false);
    }
  });
}
