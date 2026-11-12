/**
 * Architect Mission Control — Settings & 6-Step Onboarding Wizard Submodule
 * Manages configuration persistence via /api/settings and /api/setup,
 * multi-step onboarding validation, server rights UI, and Microsoft Account authentication flow.
 */

import {
  SUPPORTED_VERSIONS_FALLBACK,
  updateVersionChipsActive,
  setupVersionChips
} from './onboarding/versionChips.js';

import {
  toggleMsaContainer,
  checkMsaStatus,
  startMsaFlow,
  displayMsaCode,
  startMsaPolling,
  stopMsaPolling,
  handleMsaSuccess,
  handleMsaCodeMessage
} from './onboarding/msaAuthFlow.js';

import {
  applySettingsToUI,
  syncOnboardingValues,
  updateRightsUI,
  updateEnvBadge,
  submitOnboarding,
  saveSettingsFromForm
} from './onboarding/settingsFormSync.js';

import {
  getCurrentOnboardStep,
  validateStep,
  goToOnboardingStep,
  updateOnboardingSummary,
  openOnboardingModal as baseOpenOnboardingModal,
  closeOnboardingModal
} from './onboarding/stepNavigator.js';

export {
  SUPPORTED_VERSIONS_FALLBACK,
  updateVersionChipsActive,
  setupVersionChips,
  toggleMsaContainer,
  checkMsaStatus,
  startMsaFlow,
  displayMsaCode,
  startMsaPolling,
  stopMsaPolling,
  handleMsaSuccess,
  handleMsaCodeMessage,
  applySettingsToUI,
  syncOnboardingValues,
  updateRightsUI,
  updateEnvBadge,
  submitOnboarding,
  saveSettingsFromForm,
  getCurrentOnboardStep,
  validateStep,
  goToOnboardingStep,
  updateOnboardingSummary,
  closeOnboardingModal
};

let currentSettingsData = null;

export function getCurrentSettings() {
  return currentSettingsData;
}

export function openOnboardingModal(step = null) {
  baseOpenOnboardingModal(step, currentSettingsData);
}

export async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      currentSettingsData = data.settings;
      const versions = data.versionMetadata?.supportedGameVersions ||
                       data.supportedVersions?.supportedGameVersions ||
                       SUPPORTED_VERSIONS_FALLBACK;
      setupVersionChips('obVersionChips', 'obVersion', versions);
      setupVersionChips('cfgMcVersionChips', 'cfgMcVersion', versions);
      applySettingsToUI(data.settings);
      if (data.serverRights) {
        updateRightsUI(data.serverRights);
      }
      updateEnvBadge(data.hasEnvFile, data.isFullyConfigured);
      if (data.hasEnvFile === false || data.isFullyConfigured === false) {
        openOnboardingModal();
      }
      return data;
    }
  } catch (err) {
    console.error('[Onboarding] Fehler beim Laden der Einstellungen:', err);
  }
  return null;
}

export function initSettingsAndOnboarding() {
  const btnOpenSetup = document.getElementById('btnOpenSetupModal');
  if (btnOpenSetup) btnOpenSetup.onclick = () => openOnboardingModal(1);

  const btnLaunch = document.getElementById('btnLaunchOnboarding');
  if (btnLaunch) btnLaunch.onclick = () => openOnboardingModal(1);

  const btnClose = document.getElementById('btnCloseOnboarding');
  if (btnClose) btnClose.onclick = closeOnboardingModal;

  const onboardModal = document.getElementById('onboardingModal');
  if (onboardModal) {
    onboardModal.addEventListener('click', (e) => {
      if (e.target === onboardModal) {
        closeOnboardingModal();
      }
    });
  }

  const btnOnboardStart = document.getElementById('btnOnboardStart');
  if (btnOnboardStart) btnOnboardStart.onclick = () => goToOnboardingStep(2);

  document.querySelectorAll('.btn-step-next').forEach(btn => {
    btn.onclick = () => {
      const targetStep = parseInt(btn.dataset.to, 10);
      goToOnboardingStep(targetStep);
    };
  });

  document.querySelectorAll('.btn-step-back').forEach(btn => {
    btn.onclick = () => {
      const targetStep = parseInt(btn.dataset.to, 10);
      goToOnboardingStep(targetStep);
    };
  });

  document.querySelectorAll('.onboarding-steps-bar .step-dot').forEach(dot => {
    dot.onclick = () => {
      const step = parseInt(dot.dataset.step, 10);
      if (step) goToOnboardingStep(step);
    };
  });

  const authCards = document.querySelectorAll('.auth-choice-grid .choice-card');
  authCards.forEach(card => {
    card.onclick = () => {
      authCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) {
        radio.checked = true;
        toggleMsaContainer(radio.value === 'microsoft');
      }
    };
  });

  const btnObStartMsa = document.getElementById('btnObStartMsa');
  if (btnObStartMsa) btnObStartMsa.onclick = () => startMsaFlow(false);

  const btnObMsaReauth = document.getElementById('btnObMsaReauth');
  if (btnObMsaReauth) btnObMsaReauth.onclick = () => startMsaFlow(true);

  const btnObCopyMsaCode = document.getElementById('btnObCopyMsaCode');
  if (btnObCopyMsaCode) {
    btnObCopyMsaCode.onclick = () => {
      const code = document.getElementById('obMsaUserCode')?.textContent?.trim();
      if (code && code !== '--------') {
        navigator.clipboard.writeText(code).then(() => {
          btnObCopyMsaCode.textContent = '✓ Kopiert!';
          setTimeout(() => { btnObCopyMsaCode.textContent = '📋 Kopieren'; }, 2000);
        });
      }
    };
  }

  const btnCopyMsaGlobalCode = document.getElementById('btnCopyMsaGlobalCode');
  if (btnCopyMsaGlobalCode) {
    btnCopyMsaGlobalCode.onclick = () => {
      const code = document.getElementById('txtMsaGlobalCode')?.textContent?.trim();
      if (code && code !== '--------') {
        navigator.clipboard.writeText(code).then(() => {
          btnCopyMsaGlobalCode.textContent = '✓ Kopiert!';
          setTimeout(() => { btnCopyMsaGlobalCode.textContent = '📋 Code kopieren'; }, 2000);
        });
      }
    };
  }

  const btnCloseMsaModal = document.getElementById('btnCloseMsaModal');
  if (btnCloseMsaModal) {
    btnCloseMsaModal.onclick = () => {
      document.getElementById('modalMsaAuth')?.classList.add('hidden');
    };
  }

  const modeCards = document.querySelectorAll('.mode-choice-grid .mode-card');
  modeCards.forEach(card => {
    card.onclick = () => {
      modeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    };
  });

  setupVersionChips('obVersionChips', 'obVersion');
  setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

  ['obOwner', 'obBotUsername', 'obHost', 'obPort'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', () => {
        if (id === 'obOwner') document.getElementById('obErrorStep2')?.classList.add('hidden');
        if (id === 'obBotUsername') document.getElementById('obErrorStep3')?.classList.add('hidden');
        if (id === 'obHost' || id === 'obPort') document.getElementById('obErrorStep4')?.classList.add('hidden');
      });
    }
  });

  const modeSelect = document.getElementById('cfgBuildExecutionMode');
  if (modeSelect) {
    modeSelect.onchange = () => {
      const isRcon = modeSelect.value === 'rcon_visual';
      const rconGroup = document.getElementById('rconConfigGroup');
      if (rconGroup) rconGroup.classList.toggle('hidden', !isRcon);
    };
  }

  const btnOnboardSave = document.getElementById('btnOnboardSave');
  if (btnOnboardSave) {
    btnOnboardSave.onclick = async () => {
      if (!validateStep(2) || !validateStep(3) || !validateStep(4)) {
        return;
      }

      const feedback = document.getElementById('onboardSaveFeedback');
      if (feedback) {
        feedback.className = 'onboard-feedback';
        feedback.textContent = 'Speichere Konfiguration und erstelle .env...';
      }

      const payload = {
        BOT_OWNER: document.getElementById('obOwner')?.value.trim(),
        MC_USERNAME: document.getElementById('obBotUsername')?.value.trim(),
        MC_AUTH: document.querySelector('input[name="obAuthRadio"]:checked')?.value || 'offline',
        MC_HOST: document.getElementById('obHost')?.value.trim(),
        MC_PORT: parseInt(document.getElementById('obPort')?.value, 10) || 25565,
        MC_VERSION: document.getElementById('obVersion')?.value.trim() || 'auto',
        BUILD_EXECUTION_MODE: document.querySelector('input[name="obModeRadio"]:checked')?.value || 'auto',
        SURVIVAL_AUTO_PROCUREMENT: Boolean(document.getElementById('obChkProcure')?.checked),
        SURVIVAL_STRICT_MATERIALS: Boolean(document.getElementById('obChkStrict')?.checked),
        SURVIVAL_AUTO_HARVESTING: Boolean(document.getElementById('obChkHarvest')?.checked),
        SLEEP_DISCONNECT_ON_NO_BED: Boolean(document.getElementById('obChkSleep')?.checked),
        SINGLE_ACCOUNT_HANDOFF_MODE: Boolean(document.getElementById('obChkHandoff')?.checked),
        reconnectBot: true
      };

      try {
        const result = await submitOnboarding(payload);
        if (result.success) {
          if (feedback) {
            feedback.className = 'onboard-feedback success';
            feedback.textContent = '✅ .env erfolgreich generiert! Starte Bot...';
          }
          await loadSettings();
          setTimeout(() => {
            closeOnboardingModal();
          }, 1200);
        } else {
          if (feedback) {
            feedback.className = 'onboard-feedback error';
            feedback.textContent = `Fehler: ${result.error || 'Speichern fehlgeschlagen.'}`;
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.className = 'onboard-feedback error';
          feedback.textContent = `Netzwerkfehler: ${err.message}`;
        }
      }
    };
  }

  const settingsForm = document.getElementById('settingsForm');
  if (settingsForm) {
    settingsForm.onsubmit = async (e) => {
      e.preventDefault();
      const feedback = document.getElementById('settingsSaveFeedback');
      if (feedback) {
        feedback.style.color = '#38bdf8';
        feedback.textContent = 'Speichere .env...';
      }

      const getVal = (id) => document.getElementById(id)?.value;
      const getChk = (id) => Boolean(document.getElementById(id)?.checked);

      const payload = {
        BOT_OWNER: getVal('cfgBotOwner'),
        MC_USERNAME: getVal('cfgMcUsername'),
        MC_AUTH: getVal('cfgMcAuth'),
        MC_HOST: getVal('cfgMcHost'),
        MC_PORT: parseInt(getVal('cfgMcPort'), 10),
        MC_VERSION: getVal('cfgMcVersion'),
        BUILD_EXECUTION_MODE: getVal('cfgBuildExecutionMode'),
        ENABLE_GREEDY_FILL_OPTIMIZATION: getChk('cfgGreedyOptimization'),
        BUILD_OPERATIONS_PER_SECOND: parseInt(getVal('cfgBuildOpsPerSec'), 10),
        MAX_BUILD_VOLUME_DIMENSION: parseInt(getVal('cfgMaxDimension'), 10),
        RCON_HOST: getVal('cfgRconHost'),
        RCON_PORT: parseInt(getVal('cfgRconPort'), 10),
        RCON_PASSWORD: getVal('cfgRconPassword'),
        SURVIVAL_AUTO_PROCUREMENT: getChk('cfgAutoProcurement'),
        SURVIVAL_STORAGE_SCAN_RADIUS: parseInt(getVal('cfgScanRadius'), 10),
        SURVIVAL_STRICT_MATERIALS: getChk('cfgStrictMaterials'),
        SURVIVAL_AUTO_HARVESTING: getChk('cfgAutoHarvesting'),
        SURVIVAL_CONTAINER_TIMEOUT_MS: parseInt(getVal('cfgContainerTimeout'), 10),
        SURVIVAL_CONTAINER_BLACKLIST_MS: parseInt(getVal('cfgContainerBlacklist'), 10),
        SURVIVAL_THREAT_RADIUS: parseInt(getVal('cfgThreatRadius'), 10),
        SURVIVAL_CRITICAL_HEALTH: parseInt(getVal('cfgCritHealth'), 10),
        SURVIVAL_RETREAT_DISTANCE: parseInt(getVal('cfgRetreatDistance'), 10),
        SURVIVAL_ATTACK_COOLDOWN_MS: parseInt(getVal('cfgAttackCooldown'), 10),
        BED_SEARCH_RADIUS: parseInt(getVal('cfgBedRadius'), 10),
        SLEEP_RECONNECT_DELAY_SEC: parseInt(getVal('cfgReconnectDelay'), 10),
        SLEEP_DISCONNECT_ON_NO_BED: getChk('cfgSleepDisconnect'),
        SINGLE_ACCOUNT_HANDOFF_MODE: getChk('cfgSingleAccountHandoff'),
        ENABLE_PRISMARINE_VIEWER: getChk('cfgEnableViewer'),
        ENABLE_MINECRAFT_CHAT: getChk('cfgEnableMinecraftChat'),
        reconnectBot: document.getElementById('cfgReconnectBot')?.checked ?? true
      };

      try {
        const result = await saveSettingsFromForm(payload);
        if (result.success) {
          if (feedback) {
            feedback.style.color = '#10b981';
            feedback.textContent = '✅ Einstellungen in .env gespeichert!';
            setTimeout(() => { feedback.textContent = ''; }, 3500);
          }
          await loadSettings();
        } else {
          if (feedback) {
            feedback.style.color = '#ef4444';
            feedback.textContent = `Fehler: ${result.error}`;
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = `Netzwerkfehler: ${err.message}`;
        }
      }
    };
  }

  const btnReconnect = document.getElementById('btnReconnectBot');
  if (btnReconnect) {
    btnReconnect.onclick = async () => {
      const feedback = document.getElementById('settingsSaveFeedback');
      if (feedback) {
        feedback.style.color = '#38bdf8';
        feedback.textContent = 'Starte Bot-Reconnect...';
      }
      try {
        const res = await fetch('/api/bot/reconnect', { method: 'POST' });
        const result = await res.json();
        if (result.success) {
          if (feedback) {
            feedback.style.color = '#10b981';
            feedback.textContent = '⚡ Bot-Reconnect erfolgreich gesendet!';
            setTimeout(() => { feedback.textContent = ''; }, 3500);
          }
        } else {
          if (feedback) {
            feedback.style.color = '#ef4444';
            feedback.textContent = `Fehler: ${result.error}`;
          }
        }
      } catch (err) {
        if (feedback) {
          feedback.style.color = '#ef4444';
          feedback.textContent = `Netzwerkfehler: ${err.message}`;
        }
      }
    };
  }

  const btnApplyLan = document.getElementById('btnApplyLanPreset');
  if (btnApplyLan) {
    btnApplyLan.onclick = () => {
      const hostInput = document.getElementById('cfgMcHost');
      const authSelect = document.getElementById('cfgMcAuth');
      if (hostInput) hostInput.value = '127.0.0.1';
      if (authSelect) authSelect.value = 'offline';
      const feedback = document.getElementById('settingsSaveFeedback');
      if (feedback) {
        feedback.style.color = '#38bdf8';
        feedback.textContent = '⚡ LAN-Standardwerte gesetzt (127.0.0.1 / offline). Trage jetzt den im Spiel angezeigten LAN-Port ein oder wähle oben eine Welt.';
        setTimeout(() => { feedback.textContent = ''; }, 4500);
      }
    };
  }
}
