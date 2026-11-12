/**
 * Settings Form Synchronization, Server Rights UI & API Client Helpers.
 */

import { updateVersionChipsActive } from './versionChips.js';

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
  setChk('toggleNightDisconnect', s.SLEEP_DISCONNECT_ON_NO_BED);
  const lblNight = document.getElementById('lblNightDisconnectStatus');
  if (lblNight) {
    lblNight.textContent = s.SLEEP_DISCONNECT_ON_NO_BED ? 'Aktiv (Nacht-Skip)' : 'Aus (bleibt auf Server)';
  }
  setChk('cfgSingleAccountHandoff', s.SINGLE_ACCOUNT_HANDOFF_MODE);
  setChk('cfgEnableViewer', s.ENABLE_PRISMARINE_VIEWER !== false);
  setChk('cfgEnableMinecraftChat', s.ENABLE_MINECRAFT_CHAT !== false);

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
