/**
 * RFC 8628 Device Authorization Grant UI & Polling Manager for Model Cockpit.
 */

import { modelCtx } from './modelContext.js';
import { loadEndpoints } from './modelApiClient.js';

export async function startDeviceFlow() {
  try {
    const res = await fetch('/api/auth/device-flow/start', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Device Flow Start fehlgeschlagen');

    modelCtx.deviceFlowSession = data;
    const modal = document.getElementById('modalDeviceFlow');
    const userCodeEl = document.getElementById('txtDeviceCode') || document.getElementById('txtDeviceUserCode') || document.getElementById('userCodeDisplay');
    const linkEl = document.getElementById('linkVerificationUri') || document.getElementById('lnkDeviceVerification') || document.getElementById('deviceVerificationLink');
    const pollingStateEl = document.getElementById('lblDevicePollingState');

    if (userCodeEl) userCodeEl.textContent = data.userCode || '----';
    if (linkEl) {
      linkEl.href = data.verificationUriComplete || 'https://github.com/login/device';
    }
    if (pollingStateEl) {
      pollingStateEl.textContent = 'Warte auf Autorisierung auf github.com...';
    }

    if (modal) modal.classList.remove('hidden');

    let remainingSec = data.expiresIn || 900;
    const timerEl = document.getElementById('timerDeviceCode') || document.getElementById('lblDeviceCountdown') || document.getElementById('deviceCountdownTimer');
    clearInterval(modelCtx.deviceCountdownInterval);
    modelCtx.deviceCountdownInterval = setInterval(() => {
      remainingSec--;
      if (remainingSec <= 0) {
        clearInterval(modelCtx.deviceCountdownInterval);
        clearInterval(modelCtx.devicePollInterval);
        if (timerEl) {
          timerEl.textContent = '00:00 (Abgelaufen)';
          timerEl.style.color = '#ef4444';
        }
        if (pollingStateEl) pollingStateEl.textContent = 'Zeitfenster abgelaufen. Bitte neu starten.';
      } else {
        const m = Math.floor(remainingSec / 60).toString().padStart(2, '0');
        const s = (remainingSec % 60).toString().padStart(2, '0');
        if (timerEl) timerEl.textContent = `${m}:${s} min`;
      }
    }, 1000);

    let pollSec = data.interval || 5;
    clearInterval(modelCtx.devicePollInterval);
    modelCtx.devicePollInterval = setInterval(async () => {
      if (!modelCtx.deviceFlowSession) return;
      try {
        const stRes = await fetch(`/api/auth/device-flow/status/${modelCtx.deviceFlowSession.sessionId}`);
        const stData = await stRes.json();
        if (stData.status === 'success') {
          handleDeviceAuthSuccess({
            provider: 'GitHub',
            model: 'gpt-4o',
            endpointId: stData.endpointId
          });
        } else if (stData.status === 'denied' || stData.status === 'expired') {
          clearInterval(modelCtx.devicePollInterval);
          clearInterval(modelCtx.deviceCountdownInterval);
          if (pollingStateEl) pollingStateEl.textContent = `Sitzung beendet: ${stData.status}`;
        }
      } catch (err) {
        console.warn('[DeviceFlow] Polling Fehler:', err);
      }
    }, pollSec * 1000);

    return data;
  } catch (err) {
    alert(`GitHub Device Flow Fehler: ${err.message}`);
  }
  return null;
}

export async function cancelDeviceFlow() {
  clearInterval(modelCtx.deviceCountdownInterval);
  clearInterval(modelCtx.devicePollInterval);
  if (modelCtx.deviceFlowSession && modelCtx.deviceFlowSession.sessionId) {
    try {
      await fetch(`/api/auth/device-flow/cancel/${modelCtx.deviceFlowSession.sessionId}`, { method: 'POST' });
    } catch {}
  }
  modelCtx.deviceFlowSession = null;
  const modal = document.getElementById('modalDeviceFlow');
  if (modal) modal.classList.add('hidden');
}

export function handleDeviceAuthSuccess(msg) {
  clearInterval(modelCtx.deviceCountdownInterval);
  clearInterval(modelCtx.devicePollInterval);

  const pollingStateEl = document.getElementById('lblDevicePollingState');
  if (pollingStateEl) {
    pollingStateEl.textContent = '✓ GitHub Models erfolgreich autorisiert!';
    pollingStateEl.style.color = '#10b981';
  }

  setTimeout(() => {
    const modal = document.getElementById('modalDeviceFlow');
    if (modal) modal.classList.add('hidden');
    modelCtx.deviceFlowSession = null;
    loadEndpoints();
  }, 1200);
}
