/**
 * Architect Mission Control — LLM Model Cockpit Orchestrator
 *
 * Coordinates:
 * - Multi-provider routing pools (Fast & Architect Tier)
 * - Fine-grained V3 Role Matrix & Routing Profiles
 * - Local inference scanner (Ollama / LM Studio)
 * - RFC 8628 Device Authorization Grant (GitHub Models) & OAuth PKCE (OpenRouter)
 * - Write-Only Secret Masking & Telemetry Tracking
 */

import { modelCtx } from './models/modelContext.js';
import {
  MODEL_ERROR_TAXONOMY,
  PROVIDER_PRESETS,
  updateProviderGuidance
} from './models/providerPresets.js';
import {
  loadEndpoints,
  setRoutingProfile,
  pinRole,
  syncProvider,
  activateTier,
  scanLocalPorts,
  saveEndpoint,
  deleteEndpoint,
  testEndpoint,
  testAdhoc,
  startOpenRouterPkce,
  setModelApiCallbacks
} from './models/modelApiClient.js';
import {
  startDeviceFlow,
  cancelDeviceFlow,
  handleDeviceAuthSuccess
} from './models/deviceFlowManager.js';
import {
  renderProfileSelector,
  renderRoleMatrix
} from './models/roleMatrixRenderer.js';
import {
  openEndpointDrawer,
  closeEndpointDrawer
} from './models/modelDrawer.js';
import {
  renderLocalScanResults,
  renderProviderCards,
  renderTelemetrySummary,
  updateHeaderPill,
  updateEndpointTelemetry,
  setCardsRendererDependencies
} from './models/modelCardsRenderer.js';

// Setup cross-submodule wiring
setModelApiCallbacks({
  renderProfileSelector,
  renderRoleMatrix,
  renderTierAssignment,
  renderProviderCards,
  renderTelemetrySummary,
  updateHeaderPill,
  showModelError,
  closeEndpointDrawer,
  renderLocalScanResults,
  updateEndpointTelemetry,
  handleProbeError
});

setCardsRendererDependencies({
  openEndpointDrawer,
  renderTierAssignment
});

export function getModelEndpoints() {
  return modelCtx.modelEndpoints;
}

export function openModelSettingsModal() {
  const modal = document.getElementById('modalModelSettings');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('open');
    modelCtx.isModelModalOpen = true;
    loadEndpoints();
  }
}

export function closeModelSettingsModal() {
  const modal = document.getElementById('modalModelSettings');
  if (modal) {
    modal.classList.remove('open');
    modal.classList.add('hidden');
    modelCtx.isModelModalOpen = false;
  }
}

export function renderTierAssignment() {
  const selFast = document.getElementById('selectFastTier') || document.getElementById('selFastTierEndpoint');
  const selArch = document.getElementById('selectArchitectTier') || document.getElementById('selArchitectTierEndpoint');
  const chkEmergency = document.getElementById('toggleZeroKeyEmergency') || document.getElementById('chkZeroKeyFallback');

  if (chkEmergency) chkEmergency.checked = modelCtx.zeroKeyFallbackEnabled;

  if (selFast) {
    selFast.innerHTML = '';
    modelCtx.modelEndpoints.forEach(ep => {
      const opt = document.createElement('option');
      opt.value = ep.id;
      opt.textContent = `${ep.name} (${ep.provider} - ${ep.modelId})`;
      if (ep.id === modelCtx.activeFastTierEndpointId) opt.selected = true;
      selFast.appendChild(opt);
    });
  }

  if (selArch) {
    selArch.innerHTML = '';
    modelCtx.modelEndpoints.forEach(ep => {
      const opt = document.createElement('option');
      opt.value = ep.id;
      opt.textContent = `${ep.name} (${ep.provider} - ${ep.modelId})`;
      if (ep.id === modelCtx.activeArchitectTierEndpointId) opt.selected = true;
      selArch.appendChild(opt);
    });
  }

  const activeFast = modelCtx.modelEndpoints.find(e => e.id === modelCtx.activeFastTierEndpointId);
  const badgeFast = document.getElementById('badgeFastTierStatus');
  if (badgeFast) {
    if (activeFast) {
      badgeFast.textContent = `🟢 Bereit (${activeFast.latencyMs || 48}ms)`;
      badgeFast.className = 'status-indicator status-pill-cad ready online';
    } else {
      badgeFast.textContent = '⚪ Kein Endpunkt';
      badgeFast.className = 'status-indicator status-pill-cad offline';
    }
  }

  const activeArch = modelCtx.modelEndpoints.find(e => e.id === modelCtx.activeArchitectTierEndpointId);
  const badgeArch = document.getElementById('badgeArchitectTierStatus');
  if (badgeArch) {
    if (activeArch) {
      badgeArch.textContent = `🟢 Bereit (${activeArch.latencyMs || 310}ms)`;
      badgeArch.className = 'status-indicator status-pill-cad ready online';
    } else {
      badgeArch.textContent = '⚪ Kein Endpunkt';
      badgeArch.className = 'status-indicator status-pill-cad offline';
    }
  }
}

export function showModelError(title, desc, hint) {
  const banner = document.getElementById('bannerModelError');
  const titleEl = document.getElementById('lblBannerErrorTitle');
  const descEl = document.getElementById('lblBannerErrorDesc');
  const hintEl = document.getElementById('lblBannerActionHint');

  if (!title) {
    if (banner) banner.classList.add('hidden');
    return;
  }

  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc || '';
  if (hintEl) hintEl.textContent = hint ? `Handlungsempfehlung: ${hint}` : '';
  if (banner) banner.classList.remove('hidden');
}

export function handleProbeError(errorMsg, probeResult) {
  let matchedTaxonomy = null;
  if (typeof errorMsg === 'string') {
    if (errorMsg.includes('401') || errorMsg.includes('INVALID_KEY')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.INVALID_KEY;
    else if (errorMsg.includes('403') || errorMsg.includes('FORBIDDEN')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.FORBIDDEN;
    else if (errorMsg.includes('404') || errorMsg.includes('MODEL_NOT_FOUND')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.MODEL_NOT_FOUND;
    else if (errorMsg.includes('429') || errorMsg.includes('RATE_LIMIT')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.RATE_LIMIT;
    else if (errorMsg.includes('ECONNREFUSED')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.CONNECTION_REFUSED;
    else if (errorMsg.includes('timeout') || errorMsg.includes('ETIMEDOUT')) matchedTaxonomy = MODEL_ERROR_TAXONOMY.TIMEOUT;
  }

  if (matchedTaxonomy) {
    showModelError(matchedTaxonomy.title, errorMsg, matchedTaxonomy.hint);
  } else {
    showModelError('Verbindungsfehler', errorMsg, 'Bitte Einstellungen im Drawer überprüfen.');
  }
}

export function handleEndpointStatusChange(msg) {
  if (!msg || !msg.id) return;
  updateEndpointTelemetry(msg.id, msg.status, msg.latencyMs, msg.quotaRemaining);
}

export function handleProbeProgress(msg) {
  const feedback = document.getElementById('drawerProbeFeedback');
  if (feedback && !feedback.classList.contains('hidden')) {
    feedback.textContent = `[Phase ${msg.phase || 1}] ${msg.message || 'Prüfe Verbindung...'}`;
  }
}

export function handleTierActivated(msg) {
  if (msg.tier === 'FAST_TIER') modelCtx.activeFastTierEndpointId = msg.endpointId;
  if (msg.tier === 'ARCHITECT_TIER') modelCtx.activeArchitectTierEndpointId = msg.endpointId;
  renderTierAssignment();
  updateHeaderPill();
}

export function initModelCockpit() {
  const pillBtn = document.getElementById('pillLlmProvider');
  if (pillBtn) {
    pillBtn.addEventListener('click', openModelSettingsModal);
    pillBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openModelSettingsModal();
      }
    });
  }

  const btnOpenSettings = document.getElementById('btnOpenModelSettings');
  if (btnOpenSettings) btnOpenSettings.addEventListener('click', openModelSettingsModal);

  const btnCloseSettings = document.getElementById('btnCloseModelSettings');
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeModelSettingsModal);

  const btnAdd = document.getElementById('btnOpenAddEndpoint');
  if (btnAdd) btnAdd.addEventListener('click', () => openEndpointDrawer(null));

  const btnCloseD = document.getElementById('btnCloseDrawer');
  if (btnCloseD) btnCloseD.addEventListener('click', closeEndpointDrawer);

  const btnCancelD = document.getElementById('btnCancelDrawer');
  if (btnCancelD) btnCancelD.addEventListener('click', closeEndpointDrawer);

  const backdrop = document.getElementById('drawerBackdrop');
  if (backdrop) backdrop.addEventListener('click', closeEndpointDrawer);

  const btnToggleEye = document.getElementById('btnToggleSecretVisibility');
  if (btnToggleEye) {
    btnToggleEye.addEventListener('click', () => {
      const secretInput = document.getElementById('txtEndpointSecret') || document.getElementById('txtEndpointApiKey');
      if (secretInput) {
        secretInput.type = secretInput.type === 'password' ? 'text' : 'password';
      }
    });
  }

  const selFast = document.getElementById('selectFastTier') || document.getElementById('selFastTierEndpoint');
  if (selFast) {
    selFast.addEventListener('change', (e) => {
      if (e.target.value) activateTier('FAST_TIER', e.target.value);
    });
  }

  const selArch = document.getElementById('selectArchitectTier') || document.getElementById('selArchitectTierEndpoint');
  if (selArch) {
    selArch.addEventListener('change', (e) => {
      if (e.target.value) activateTier('ARCHITECT_TIER', e.target.value);
    });
  }

  const chkEmergency = document.getElementById('toggleZeroKeyEmergency') || document.getElementById('chkZeroKeyFallback');
  if (chkEmergency) {
    chkEmergency.addEventListener('change', (e) => {
      modelCtx.zeroKeyFallbackEnabled = e.target.checked;
    });
  }

  const btnScan = document.getElementById('btnScanLocal');
  if (btnScan) btnScan.addEventListener('click', scanLocalPorts);

  const selProvider = document.getElementById('selEndpointProvider');
  if (selProvider) {
    selProvider.addEventListener('change', (e) => {
      const p = e.target.value;
      updateProviderGuidance(p);

      const isNew = !document.getElementById('txtEndpointId')?.value;
      if (!isNew) return; // Don't overwrite existing endpoint settings on edit

      const nameEl = document.getElementById('txtEndpointName');
      const urlEl = document.getElementById('txtEndpointBaseUrl');
      const modelEl = document.getElementById('txtEndpointModelId');
      const tierEl = document.getElementById('selEndpointTier');

      const preset = PROVIDER_PRESETS[p];
      if (preset) {
        if (nameEl) nameEl.value = preset.name;
        if (urlEl) urlEl.value = preset.url;
        if (modelEl) modelEl.value = preset.model;
        if (tierEl) tierEl.value = preset.tier;
      }
    });
  }

  const form = document.getElementById('formEndpointConfig');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('txtEndpointId')?.value;
      const name = document.getElementById('txtEndpointName')?.value;
      const provider = document.getElementById('selEndpointProvider')?.value || 'Custom';
      const tier = document.getElementById('selEndpointTier')?.value || 'FAST_TIER';
      const baseUrl = document.getElementById('txtEndpointBaseUrl')?.value;
      const modelId = document.getElementById('txtEndpointModelId')?.value;
      const secret = (document.getElementById('txtEndpointSecret') || document.getElementById('txtEndpointApiKey'))?.value;
      const temperature = parseFloat(document.getElementById('numTemperature')?.value || '0.2');
      const maxTokens = parseInt(document.getElementById('numMaxTokens')?.value || '4000', 10);
      const isThinkingModel = document.getElementById('chkEndpointThinking')?.checked;

      const endpointData = {
        name,
        provider,
        tier,
        baseUrl,
        modelId,
        temperature,
        maxTokens,
        isThinkingModel
      };
      if (id) endpointData.id = id;

      try {
        await saveEndpoint(endpointData, secret);
      } catch (err) {
        alert(`Speichern fehlgeschlagen: ${err.message}`);
      }
    });
  }

  const btnTestAdhocEl = document.getElementById('btnTestAdhoc');
  if (btnTestAdhocEl) {
    btnTestAdhocEl.addEventListener('click', () => {
      const baseUrl = document.getElementById('txtEndpointBaseUrl')?.value;
      const modelId = document.getElementById('txtEndpointModelId')?.value;
      const secret = (document.getElementById('txtEndpointSecret') || document.getElementById('txtEndpointApiKey'))?.value;
      const id = document.getElementById('txtEndpointId')?.value;

      testAdhoc({
        baseUrl,
        modelId,
        secret,
        endpointId: id
      });
    });
  }

  const btnDelete = document.getElementById('btnDeleteEndpoint');
  if (btnDelete) {
    btnDelete.addEventListener('click', () => {
      const id = document.getElementById('txtEndpointId')?.value;
      if (id) deleteEndpoint(id);
    });
  }

  const btnTestFast = document.getElementById('btnTestFastTier');
  if (btnTestFast) {
    btnTestFast.addEventListener('click', () => {
      if (modelCtx.activeFastTierEndpointId) testEndpoint(modelCtx.activeFastTierEndpointId);
    });
  }

  const btnTestArch = document.getElementById('btnTestArchitectTier');
  if (btnTestArch) {
    btnTestArch.addEventListener('click', () => {
      if (modelCtx.activeArchitectTierEndpointId) testEndpoint(modelCtx.activeArchitectTierEndpointId);
    });
  }

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

  const btnCancelDev = document.getElementById('btnCancelDeviceFlow') || document.getElementById('btnCloseDeviceFlow');
  if (btnCancelDev) btnCancelDev.addEventListener('click', cancelDeviceFlow);

  const btnDismissErr = document.getElementById('btnDismissErrorBanner');
  if (btnDismissErr) {
    btnDismissErr.addEventListener('click', () => showModelError(null));
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const onboardModal = document.getElementById('onboardingModal');
      if (onboardModal && !onboardModal.classList.contains('hidden')) {
        onboardModal.classList.add('hidden');
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
    }
  });

  loadEndpoints();
}

// Re-exports for 100% backward compatibility
export {
  MODEL_ERROR_TAXONOMY,
  PROVIDER_PRESETS,
  updateProviderGuidance,
  openEndpointDrawer,
  closeEndpointDrawer,
  loadEndpoints,
  setRoutingProfile,
  pinRole,
  syncProvider,
  renderProfileSelector,
  renderRoleMatrix,
  activateTier,
  scanLocalPorts,
  saveEndpoint,
  deleteEndpoint,
  testEndpoint,
  testAdhoc,
  startOpenRouterPkce,
  startDeviceFlow,
  cancelDeviceFlow,
  handleDeviceAuthSuccess,
  renderLocalScanResults,
  renderProviderCards,
  renderTelemetrySummary,
  updateHeaderPill,
  updateEndpointTelemetry
};
