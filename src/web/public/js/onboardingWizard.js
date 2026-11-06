/**
 * Architect Mission Control — Settings & 6-Step Onboarding Wizard Submodule
 * Manages configuration persistence via /api/settings and /api/setup,
 * multi-step onboarding validation, server rights UI, and Microsoft Account authentication flow.
 */

let currentSettingsData = null;
let currentOnboardStep = 1;
let msaPollInterval = null;

export const SUPPORTED_VERSIONS_FALLBACK = [
  { version: 'auto', label: 'auto (Empfohlen)' },
  { version: '26.3', label: '26.3 (SOTA)' },
  { version: '1.21.4', label: '1.21.4' },
  { version: '1.21.1', label: '1.21.1' },
  { version: '1.20.4', label: '1.20.4' },
  { version: '1.20.1', label: '1.20.1' }
];

export function updateVersionChipsActive(containerId, versionValue) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const targetVer = (versionValue || 'auto').toString().trim().toLowerCase();
  const chips = container.querySelectorAll('.chip-sm');
  chips.forEach(chip => {
    const chipVer = (chip.dataset.ver || '').toLowerCase();
    chip.classList.toggle('active', chipVer === targetVer);
  });
}

export function setupVersionChips(containerId, inputId, versions = SUPPORTED_VERSIONS_FALLBACK) {
  const container = document.getElementById(containerId);
  const input = document.getElementById(inputId);
  if (!container || !input) return;

  if (Array.isArray(versions) && versions.length > 0) {
    container.innerHTML = versions.map(v => {
      const ver = typeof v === 'string' ? v : v.version;
      const label = typeof v === 'string' ? v : (v.label || v.version);
      return `<button type="button" class="chip-sm" data-ver="${ver}">${label}</button>`;
    }).join('\n');
  }

  const chips = container.querySelectorAll('.chip-sm');
  chips.forEach(chip => {
    chip.onclick = () => {
      const ver = chip.dataset.ver;
      input.value = ver;
      updateVersionChipsActive(containerId, ver);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
  });

  if (!input._hasVersionChipSync) {
    input.addEventListener('input', () => {
      updateVersionChipsActive(containerId, input.value);
    });
    input._hasVersionChipSync = true;
  }

  updateVersionChipsActive(containerId, input.value || 'auto');
}

export function getCurrentSettings() {
  return currentSettingsData;
}

export function getCurrentOnboardStep() {
  return currentOnboardStep;
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

export function applySettingsToUI(s) {
  if (!s) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.checked = Boolean(val);
  };

  setVal('cfgBotOwner', s.BOT_OWNER);
  setVal('cfgMcUsername', s.MC_USERNAME);
  setVal('cfgMcAuth', s.MC_AUTH);
  setVal('cfgMcHost', s.MC_HOST);
  setVal('cfgMcPort', s.MC_PORT);
  setVal('cfgMcVersion', s.MC_VERSION);
  updateVersionChipsActive('cfgMcVersionChips', s.MC_VERSION);
  setVal('cfgBuildExecutionMode', s.BUILD_EXECUTION_MODE);
  setChk('cfgGreedyOptimization', s.ENABLE_GREEDY_FILL_OPTIMIZATION);
  setVal('cfgBuildOpsPerSec', s.BUILD_OPERATIONS_PER_SECOND);
  setVal('cfgMaxDimension', s.MAX_BUILD_VOLUME_DIMENSION);
  setVal('cfgRconHost', s.RCON_HOST);
  setVal('cfgRconPort', s.RCON_PORT);
  setVal('cfgRconPassword', s.RCON_PASSWORD);

  setChk('cfgAutoProcurement', s.SURVIVAL_AUTO_PROCUREMENT);
  setVal('cfgScanRadius', s.SURVIVAL_STORAGE_SCAN_RADIUS);
  setChk('cfgStrictMaterials', s.SURVIVAL_STRICT_MATERIALS);
  setChk('cfgAutoHarvesting', s.SURVIVAL_AUTO_HARVESTING);
  setVal('cfgContainerTimeout', s.SURVIVAL_CONTAINER_TIMEOUT_MS);
  setVal('cfgContainerBlacklist', s.SURVIVAL_CONTAINER_BLACKLIST_MS);
  setVal('cfgThreatRadius', s.SURVIVAL_THREAT_RADIUS);
  setVal('cfgCritHealth', s.SURVIVAL_CRITICAL_HEALTH);
  setVal('cfgRetreatDistance', s.SURVIVAL_RETREAT_DISTANCE);
  setVal('cfgAttackCooldown', s.SURVIVAL_ATTACK_COOLDOWN_MS);
  setVal('cfgBedRadius', s.BED_SEARCH_RADIUS);
  setVal('cfgReconnectDelay', s.SLEEP_RECONNECT_DELAY_SEC);
  setChk('cfgSleepDisconnect', s.SLEEP_DISCONNECT_ON_NO_BED);
  setChk('cfgSingleAccountHandoff', s.SINGLE_ACCOUNT_HANDOFF_MODE);

  const rconGroup = document.getElementById('rconConfigGroup');
  if (rconGroup) {
    rconGroup.classList.toggle('hidden', s.BUILD_EXECUTION_MODE !== 'rcon_visual');
  }

  syncOnboardingValues(s);
}

export function syncOnboardingValues(s) {
  if (!s) return;
  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.value = val;
  };
  const setChk = (id, val) => {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) el.checked = Boolean(val);
  };

  setVal('obOwner', s.BOT_OWNER);
  setVal('obBotUsername', s.MC_USERNAME);
  setVal('obHost', s.MC_HOST);
  setVal('obPort', s.MC_PORT);
  setVal('obVersion', s.MC_VERSION);

  if (s.MC_AUTH) {
    const authRadio = document.querySelector(`input[name="obAuthRadio"][value="${s.MC_AUTH}"]`);
    if (authRadio) {
      authRadio.checked = true;
      document.querySelectorAll('.auth-choice-grid .choice-card').forEach(c => c.classList.remove('active'));
      authRadio.closest('.choice-card')?.classList.add('active');
    }
  }

  if (s.BUILD_EXECUTION_MODE) {
    const modeRadio = document.querySelector(`input[name="obModeRadio"][value="${s.BUILD_EXECUTION_MODE}"]`);
    if (modeRadio) {
      modeRadio.checked = true;
      document.querySelectorAll('.mode-choice-grid .mode-card').forEach(c => c.classList.remove('active'));
      modeRadio.closest('.mode-card')?.classList.add('active');
    }
  }

  if (s.MC_VERSION) {
    updateVersionChipsActive('obVersionChips', s.MC_VERSION);
    updateVersionChipsActive('cfgMcVersionChips', s.MC_VERSION);
  }

  setChk('obChkProcure', s.SURVIVAL_AUTO_PROCUREMENT);
  setChk('obChkStrict', s.SURVIVAL_STRICT_MATERIALS);
  setChk('obChkHarvest', s.SURVIVAL_AUTO_HARVESTING);
  setChk('obChkSleep', s.SLEEP_DISCONNECT_ON_NO_BED);
  setChk('obChkHandoff', s.SINGLE_ACCOUNT_HANDOFF_MODE);
}

export function openOnboardingModal(step = null) {
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

export async function submitOnboarding(payload) {
  const res = await fetch('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export async function saveSettingsFromForm(payload) {
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

export function updateRightsUI(rights) {
  if (!rights) return;
  const pillRights = document.getElementById('pillServerRights');
  const badgeRights = document.getElementById('settingsRightsBadge');
  const isOp = rights.isOp;
  const level = rights.permissionLevel !== undefined ? rights.permissionLevel : (isOp ? 4 : 0);
  const text = isOp ? `OP (Level ${level})` : 'Survival (Non-OP)';

  if (pillRights) {
    pillRights.textContent = text;
    pillRights.style.color = isOp ? '#10b981' : '#38bdf8';
  }
  if (badgeRights) {
    badgeRights.textContent = `Server-Rechte: ${text}`;
  }
}

export function updateEnvBadge(hasEnvFile, isFullyConfigured = true) {
  const envBadge = document.getElementById('settingsEnvBadge');
  if (envBadge) {
    if (hasEnvFile && isFullyConfigured) {
      envBadge.textContent = '📄 Konfiguration aktiv';
      envBadge.style.color = '#10b981';
    } else if (hasEnvFile && !isFullyConfigured) {
      envBadge.textContent = '⚙️ Onboarding ausstehend';
      envBadge.style.color = '#f59e0b';
    } else {
      envBadge.textContent = '⚠️ Keine .env (Nicht eingerichtet)';
      envBadge.style.color = '#ef4444';
    }
  }
}

// MSA Helpers
export function toggleMsaContainer(show) {
  const container = document.getElementById('obMsaContainer');
  if (!container) return;
  container.classList.toggle('hidden', !show);
  if (show) {
    const username = document.getElementById('obBotUsername')?.value || 'BaumeisterKI';
    checkMsaStatus(username);
  } else {
    stopMsaPolling();
  }
}

export async function checkMsaStatus(username) {
  if (!username) return;
  const statusText = document.getElementById('obMsaStatusText');
  const badge = document.getElementById('obMsaBadge');
  const promptSec = document.getElementById('obMsaPromptSection');
  const codeSec = document.getElementById('obMsaCodeSection');
  const successSec = document.getElementById('obMsaSuccessSection');

  try {
    const res = await fetch(`/api/auth/msa/status?username=${encodeURIComponent(username)}`);
    const data = await res.json();

    if (data.status === 'authenticated') {
      if (statusText) statusText.textContent = `Autorisiert für Minecraft: ${data.profile?.name || username}`;
      if (badge) {
        badge.textContent = '✅ Verbunden';
        badge.className = 'badge-sub status-pill-healthy';
      }
      if (promptSec) promptSec.classList.add('hidden');
      if (codeSec) codeSec.classList.add('hidden');
      if (successSec) {
        successSec.classList.remove('hidden');
        const userEl = document.getElementById('obMsaSuccessUser');
        if (userEl) userEl.textContent = `Erfolgreich mit Microsoft autorisiert als '${data.profile?.name || username}'!`;
      }
      stopMsaPolling();
    } else if (data.status === 'pending' && data.session) {
      displayMsaCode(data.session);
    } else {
      if (statusText) statusText.textContent = 'Noch keine Verbindung vorhanden';
      if (badge) {
        badge.textContent = '⚠️ Nicht verifiziert';
        badge.className = 'badge-sub status-pill-unreachable';
      }
      if (promptSec) promptSec.classList.remove('hidden');
      if (codeSec) codeSec.classList.add('hidden');
      if (successSec) successSec.classList.add('hidden');
      stopMsaPolling();
    }
  } catch (err) {
    console.error('[MSA] Fehler beim Prüfen des Status:', err);
  }
}

export async function startMsaFlow(forceRefresh = false) {
  const username = (document.getElementById('obBotUsername')?.value || 'BaumeisterKI').trim();
  const btnStart = document.getElementById('btnObStartMsa');
  if (btnStart) {
    btnStart.disabled = true;
    btnStart.textContent = 'Verbinde mit Microsoft...';
  }

  try {
    const res = await fetch('/api/auth/msa/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, forceRefresh })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      alert(`Fehler beim Starten der Authentifizierung: ${data.error || 'Unbekannter Fehler'}`);
      if (btnStart) {
        btnStart.disabled = false;
        btnStart.textContent = '🔐 Microsoft-Konto jetzt verbinden';
      }
      return;
    }

    if (data.status === 'authenticated') {
      checkMsaStatus(username);
      return;
    }

    displayMsaCode(data);
    startMsaPolling(username);
  } catch (err) {
    alert(`Netzwerkfehler: ${err.message}`);
  } finally {
    if (btnStart) {
      btnStart.disabled = false;
      btnStart.textContent = '🔐 Microsoft-Konto jetzt verbinden';
    }
  }
}

export function displayMsaCode(codeData) {
  const promptSec = document.getElementById('obMsaPromptSection');
  const codeSec = document.getElementById('obMsaCodeSection');
  const successSec = document.getElementById('obMsaSuccessSection');
  const userCodeEl = document.getElementById('obMsaUserCode');
  const directLink = document.getElementById('lnkObMsaDirect');
  const badge = document.getElementById('obMsaBadge');
  const statusText = document.getElementById('obMsaStatusText');

  if (promptSec) promptSec.classList.add('hidden');
  if (successSec) successSec.classList.add('hidden');
  if (codeSec) codeSec.classList.remove('hidden');

  if (userCodeEl) userCodeEl.textContent = codeData.userCode || '--------';
  if (directLink) {
    directLink.href = codeData.directUrl || codeData.verificationUri || 'https://www.microsoft.com/link';
  }
  if (badge) {
    badge.textContent = '⏳ Warte auf Code-Eingabe';
    badge.className = 'badge-sub status-pill-degraded';
  }
  if (statusText) statusText.textContent = `Code ${codeData.userCode} im Browser eingeben`;

  const txtGlobal = document.getElementById('txtMsaGlobalCode');
  const lnkGlobal = document.getElementById('linkMsaGlobalDirect');
  if (txtGlobal) txtGlobal.textContent = codeData.userCode || '--------';
  if (lnkGlobal) lnkGlobal.href = codeData.directUrl || codeData.verificationUri || 'https://www.microsoft.com/link';
}

export function startMsaPolling(username) {
  stopMsaPolling();
  msaPollInterval = setInterval(async () => {
    try {
      const res = await fetch(`/api/auth/msa/status?username=${encodeURIComponent(username)}`);
      const data = await res.json();
      if (data.status === 'authenticated') {
        stopMsaPolling();
        handleMsaSuccess(data.profile?.name || username);
      }
    } catch (e) {
      // transient poll error
    }
  }, 3000);
}

export function stopMsaPolling() {
  if (msaPollInterval) {
    clearInterval(msaPollInterval);
    msaPollInterval = null;
  }
}

export function handleMsaSuccess(username) {
  stopMsaPolling();
  const promptSec = document.getElementById('obMsaPromptSection');
  const codeSec = document.getElementById('obMsaCodeSection');
  const successSec = document.getElementById('obMsaSuccessSection');
  const badge = document.getElementById('obMsaBadge');
  const statusText = document.getElementById('obMsaStatusText');
  const obBotUsername = document.getElementById('obBotUsername');

  if (promptSec) promptSec.classList.add('hidden');
  if (codeSec) codeSec.classList.add('hidden');
  if (successSec) {
    successSec.classList.remove('hidden');
    const userEl = document.getElementById('obMsaSuccessUser');
    if (userEl) userEl.textContent = `Erfolgreich mit Microsoft autorisiert als '${username}'!`;
  }
  if (badge) {
    badge.textContent = '✅ Verbunden';
    badge.className = 'badge-sub status-pill-healthy';
  }
  if (statusText) statusText.textContent = `Minecraft-Konto: ${username}`;

  if (obBotUsername && username) {
    obBotUsername.value = username;
  }

  const modalGlobal = document.getElementById('modalMsaAuth');
  if (modalGlobal) {
    const lblGlobal = document.getElementById('lblMsaGlobalStatus');
    if (lblGlobal) lblGlobal.textContent = `✅ Erfolgreich verbunden als '${username}'!`;
    setTimeout(() => {
      modalGlobal.classList.add('hidden');
    }, 1500);
  }
}

export function handleMsaCodeMessage(msg) {
  displayMsaCode(msg);
  const onboardModal = document.getElementById('onboardingModal');
  const isObOpen = onboardModal && !onboardModal.classList.contains('hidden');
  if (!isObOpen) {
    const globalModal = document.getElementById('modalMsaAuth');
    if (globalModal) {
      globalModal.classList.remove('hidden');
      const txtGlobal = document.getElementById('txtMsaGlobalCode');
      const lnkGlobal = document.getElementById('linkMsaGlobalDirect');
      const lblGlobal = document.getElementById('lblMsaGlobalStatus');
      if (txtGlobal) txtGlobal.textContent = msg.userCode;
      if (lnkGlobal) lnkGlobal.href = msg.directUrl || msg.verificationUri;
      if (lblGlobal) lblGlobal.textContent = 'Warte auf Bestätigung bei Microsoft...';
    }
  }
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
}
