/**
 * Endpoint Drawer Form Management & Field Population.
 */

import { modelCtx } from './modelContext.js';
import { updateProviderGuidance } from './providerPresets.js';

export function openEndpointDrawer(endpointId = null) {
  modelCtx.editingEndpointId = endpointId;
  const drawer = document.getElementById('drawerEndpointEdit') || document.getElementById('drawerEndpointConfig');
  const backdrop = document.getElementById('drawerBackdrop');
  const title = document.getElementById('drawerTitle');
  const feedback = document.getElementById('drawerProbeFeedback');
  const btnDelete = document.getElementById('btnDeleteEndpoint');

  if (feedback) {
    feedback.textContent = '';
    feedback.className = 'drawer-feedback mt-2 hidden';
  }

  if (endpointId) {
    if (title) title.textContent = 'Endpunkt bearbeiten';
    if (btnDelete) btnDelete.classList.remove('hidden');

    const ep = modelCtx.modelEndpoints.find(e => e.id === endpointId);
    if (ep) {
      const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val !== undefined ? val : '';
      };
      setVal('txtEndpointId', ep.id);
      setVal('txtEndpointName', ep.name || '');
      setVal('selEndpointProvider', ep.provider || 'Custom');
      setVal('selEndpointTier', ep.tier || 'FAST_TIER');
      setVal('txtEndpointBaseUrl', ep.baseUrl || '');
      setVal('txtEndpointModelId', ep.modelId || '');
      setVal('numTemperature', ep.temperature !== undefined ? ep.temperature : 0.2);
      setVal('numMaxTokens', ep.maxTokens !== undefined ? ep.maxTokens : 4000);

      const chkThink = document.getElementById('chkEndpointThinking');
      if (chkThink) chkThink.checked = Boolean(ep.isThinkingModel);

      const secretInput = document.getElementById('txtEndpointSecret') || document.getElementById('txtEndpointApiKey');
      if (secretInput) {
        secretInput.value = ep.maskedSecret || '••••••••';
      }
      const vaultStatus = document.getElementById('lblSecretVaultStatus');
      if (vaultStatus) vaultStatus.textContent = '🔒 Im Vault gesichert (Write-Only)';
      updateProviderGuidance(ep.provider || 'Custom');
    }
  } else {
    if (title) title.textContent = 'Neuer Endpunkt';
    if (btnDelete) btnDelete.classList.add('hidden');

    const form = document.getElementById('formEndpointConfig');
    if (form) form.reset();

    const idInput = document.getElementById('txtEndpointId');
    if (idInput) idInput.value = '';

    const secretInput = document.getElementById('txtEndpointSecret') || document.getElementById('txtEndpointApiKey');
    if (secretInput) secretInput.value = '';

    const vaultStatus = document.getElementById('lblSecretVaultStatus');
    if (vaultStatus) vaultStatus.textContent = '🔑 Neues Secret eingeben';

    const currentSelProvider = document.getElementById('selEndpointProvider')?.value || 'Cerebras';
    updateProviderGuidance(currentSelProvider);
  }

  if (backdrop) backdrop.classList.remove('hidden');
  if (drawer) {
    drawer.classList.remove('hidden');
    drawer.classList.add('open');
  }
}

export function closeEndpointDrawer() {
  const drawer = document.getElementById('drawerEndpointEdit') || document.getElementById('drawerEndpointConfig');
  const backdrop = document.getElementById('drawerBackdrop');
  if (drawer) {
    drawer.classList.remove('open');
    drawer.classList.add('hidden');
  }
  if (backdrop) backdrop.classList.add('hidden');
  modelCtx.editingEndpointId = null;
}
