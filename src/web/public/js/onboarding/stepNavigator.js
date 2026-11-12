/**
 * Onboarding Step Navigation, Validation & Modal Lifecycle.
 */

import { syncOnboardingValues } from './settingsFormSync.js';
import { toggleMsaContainer, stopMsaPolling } from './msaAuthFlow.js';

let currentOnboardStep = 1;

export function getCurrentOnboardStep() {
  return currentOnboardStep;
}

export function validateStep(stepNumber) {
  if (stepNumber === 2) {
    const owner = document.getElementById('obOwner')?.value.trim();
    const errEl = document.getElementById('obErrorStep2');
    if (!owner) {
      if (errEl) {
        errEl.textContent = 'Bitte gib deinen Minecraft-Spielernamen (Besitzer) an.';
        errEl.classList.remove('hidden');
      }
      return false;
    }
    if (errEl) errEl.classList.add('hidden');
    return true;
  }

  if (stepNumber === 3) {
    const botUser = document.getElementById('obBotUsername')?.value.trim();
    const errEl = document.getElementById('obErrorStep3');
    if (!botUser) {
      if (errEl) {
        errEl.textContent = 'Bitte gib einen Namen für den Minecraft-Bot an.';
        errEl.classList.remove('hidden');
      }
      return false;
    }
    if (errEl) errEl.classList.add('hidden');
    return true;
  }

  if (stepNumber === 4) {
    const host = document.getElementById('obHost')?.value.trim();
    const port = parseInt(document.getElementById('obPort')?.value, 10);
    const errEl = document.getElementById('obErrorStep4');
    if (!host) {
      if (errEl) {
        errEl.textContent = 'Bitte gib die Server-Adresse (MC_HOST) an.';
        errEl.classList.remove('hidden');
      }
      return false;
    }
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      if (errEl) {
        errEl.textContent = 'Der Port muss zwischen 1 und 65535 liegen.';
        errEl.classList.remove('hidden');
      }
      return false;
    }
    if (errEl) errEl.classList.add('hidden');
    return true;
  }

  return true;
}

export function goToOnboardingStep(targetStep) {
  const desiredStep = Math.max(1, Math.min(6, targetStep));

  if (desiredStep > currentOnboardStep) {
    for (let s = currentOnboardStep; s < desiredStep; s++) {
      if (!validateStep(s)) {
        return;
      }
    }
  }

  currentOnboardStep = desiredStep;

  for (let i = 1; i <= 6; i++) {
    const stepPane = document.getElementById(`onboardStep${i}`);
    if (stepPane) {
      stepPane.classList.toggle('active', i === currentOnboardStep);
    }
  }

  const dots = document.querySelectorAll('.onboarding-steps-bar .step-dot');
  dots.forEach(dot => {
    const dotStep = parseInt(dot.dataset.step, 10);
    dot.classList.remove('active', 'completed');
    if (dotStep === currentOnboardStep) {
      dot.classList.add('active');
    } else if (dotStep < currentOnboardStep) {
      dot.classList.add('completed');
    }
  });

  if (currentOnboardStep === 3) {
    const isMsa = document.querySelector('input[name="obAuthRadio"]:checked')?.value === 'microsoft';
    toggleMsaContainer(isMsa);
  }

  if (currentOnboardStep === 6) {
    updateOnboardingSummary();
  }
}

export function updateOnboardingSummary() {
  const obOwner = document.getElementById('obOwner')?.value.trim() || 'DeinSpielerName';
  const obBotUsername = document.getElementById('obBotUsername')?.value.trim() || 'BaumeisterKI';
  const obAuth = document.querySelector('input[name="obAuthRadio"]:checked')?.value || 'offline';
  const obHost = document.getElementById('obHost')?.value.trim() || '127.0.0.1';
  const obPort = document.getElementById('obPort')?.value || '25565';
  const obVersion = document.getElementById('obVersion')?.value.trim() || 'auto';
  const obMode = document.querySelector('input[name="obModeRadio"]:checked')?.value || 'auto';

  const sumOwner = document.getElementById('sumOwner');
  const sumBotAccount = document.getElementById('sumBotAccount');
  const sumServer = document.getElementById('sumServer');
  const sumVersion = document.getElementById('sumVersion');
  const sumMode = document.getElementById('sumMode');

  if (sumOwner) sumOwner.textContent = obOwner;
  if (sumBotAccount) sumBotAccount.textContent = `${obBotUsername} (${obAuth})`;
  if (sumServer) sumServer.textContent = `${obHost}:${obPort}`;
  if (sumVersion) sumVersion.textContent = obVersion;
  if (sumMode) {
    let modeText = obMode;
    if (obMode === 'auto') modeText = '🌟 auto (Dynamische Rechte-Erkennung)';
    else if (obMode === 'pure_physical') modeText = '🪓 pure_physical (Reines Survival)';
    else if (obMode === 'hybrid_visual') modeText = '⚡ hybrid_visual (Kreativ / OP)';
    else if (obMode === 'rcon_visual') modeText = '📡 rcon_visual (RCON)';
    sumMode.textContent = modeText;
  }
}

export function openOnboardingModal(step = null, currentSettingsData = null) {
  const modal = document.getElementById('onboardingModal');
  if (modal) {
    const isAlreadyOpen = !modal.classList.contains('hidden');
    modal.classList.remove('hidden');
    if (currentSettingsData) {
      syncOnboardingValues(currentSettingsData);
    }
    if (step !== null) {
      goToOnboardingStep(step);
    } else if (!isAlreadyOpen) {
      goToOnboardingStep(1);
    }
  }
}

export function closeOnboardingModal() {
  const modal = document.getElementById('onboardingModal');
  if (modal) {
    modal.classList.add('hidden');
  }
  stopMsaPolling();
}
