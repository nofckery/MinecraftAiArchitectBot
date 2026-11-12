/**
 * Microsoft Account (MSA) Device Flow & Authentication Handler.
 */

let msaPollInterval = null;

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
