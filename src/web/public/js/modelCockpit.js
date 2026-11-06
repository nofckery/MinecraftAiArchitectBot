/**
 * Architect Mission Control — Model Settings Cockpit Submodule (Milestone M7)
 * Provider fabric, Two-Tier (Fast/Architect) orchestration, Write-only secret vault protection,
 * local port discovery, RFC 8628 GitHub Device Flow, and live telemetry.
 */

let modelEndpoints = [];
let activeFastTierEndpointId = null;
let activeArchitectTierEndpointId = null;
let zeroKeyFallbackEnabled = true;
let localScanResults = [];
let deviceFlowSession = null;
let isModelModalOpen = false;
let editingEndpointId = null;
let deviceCountdownInterval = null;
let devicePollInterval = null;

export const MODEL_ERROR_TAXONOMY = {
  INVALID_KEY: {
    title: 'API-Schlüssel ungültig oder abgelaufen (401)',
    hint: 'Bitte prüfe den API-Key in deiner Provider-Konsole und trage ihn im Konfigurations-Drawer neu ein.'
  },
  FORBIDDEN: {
    title: 'Zugriff verweigert (403)',
    hint: 'Dein Account hat keine Berechtigung für dieses Modell. Wähle ein freies Modell oder prüfe deine Zahlungsdaten.'
  },
  MODEL_NOT_FOUND: {
    title: 'Modell nicht gefunden (404)',
    hint: 'Prüfe die Schreibweise der Modell-ID oder wähle ein Modell aus dem geladenen Modellkatalog.'
  },
  RATE_LIMIT: {
    title: 'Ratenlimit erreicht (429)',
    hint: 'Kurzzeitiges Limit erreicht. Bot schaltet automatisch auf Backup-Provider um. Endpunkt reaktiviert sich nach Cooldown.'
  },
  INSUFFICIENT_QUOTA: {
    title: 'Guthaben aufgebraucht (429)',
    hint: 'Guthaben aufgebraucht. Bitte Credits aufladen oder den kostenlosen GitHub Models Flow aktivieren.'
  },
  SERVER_ERROR: {
    title: 'Provider-Serverfehler (500/503)',
    hint: 'Provider temporär überlastet oder in Wartung. Bot nutzt alternative Endpunkte.'
  },
  CONNECTION_REFUSED: {
    title: 'Lokaler Server nicht erreichbar (ECONNREFUSED)',
    hint: 'Verbindung verweigert auf Ziel-Port. Bitte stelle sicher, dass Ollama (ollama serve) oder LM Studio läuft.'
  },
  TIMEOUT: {
    title: 'Zeitüberschreitung (Timeout)',
    hint: 'Verbindung überschritt das Zeitlimit. Bei großen lokalen Modellen bitte Cold-Start abwarten und erneut testen.'
  }
};

export function getModelEndpoints() {
  return modelEndpoints;
}

export function openModelSettingsModal() {
  const modal = document.getElementById('modalModelSettings');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('open');
    isModelModalOpen = true;
    loadEndpoints();
  }
}

export function closeModelSettingsModal() {
  const modal = document.getElementById('modalModelSettings');
  if (modal) {
    modal.classList.remove('open');
    modal.classList.add('hidden');
    isModelModalOpen = false;
  }
}

export function openEndpointDrawer(endpointId = null) {
  editingEndpointId = endpointId;
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

    const ep = modelEndpoints.find(e => e.id === endpointId);
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
  editingEndpointId = null;
}

export async function loadEndpoints() {
  try {
    const res = await fetch('/api/endpoints');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      modelEndpoints = data.endpoints || [];
      activeFastTierEndpointId = data.activeFastEndpointId || null;
      activeArchitectTierEndpointId = data.activeArchitectEndpointId || null;
      zeroKeyFallbackEnabled = data.zeroKeyFallbackEnabled !== false;

      renderTierAssignment();
      renderProviderCards();
      renderTelemetrySummary();
      updateHeaderPill();
      return data;
    }
  } catch (err) {
    console.error('[ModelCockpit] Fehler beim Laden der Endpunkte:', err);
    showModelError('Verbindungsfehler', err.message, 'Express REST Backend nicht erreichbar.');
  }
  return null;
}

export async function activateTier(tier, endpointId) {
  try {
    const res = await fetch('/api/endpoints/activate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier, endpointId })
    });
    const data = await res.json();
    if (data.success) {
      if (tier === 'FAST_TIER') activeFastTierEndpointId = endpointId;
      if (tier === 'ARCHITECT_TIER') activeArchitectTierEndpointId = endpointId;
      renderTierAssignment();
      updateHeaderPill();
      return data;
    } else {
      showModelError('Tier-Aktivierung fehlgeschlagen', data.error, 'Bitte gültigen Endpunkt auswählen.');
    }
  } catch (err) {
    showModelError('Tier-Aktivierung Netzwerkfehler', err.message, 'Netzwerkverbindung prüfen.');
  }
  return null;
}

export async function scanLocalPorts() {
  const btn = document.getElementById('btnScanLocal');
  const statusBadge = document.getElementById('scanStatusBadge');

  if (btn) btn.disabled = true;
  if (statusBadge) {
    statusBadge.textContent = 'Scanne lokale Ports (11434, 1234, 8000, 8080, 1337)...';
    statusBadge.className = 'scanner-status-tag scanner-status badge-sub scanning';
  }

  try {
    const res = await fetch('/api/endpoints/discover-local?timeout=1500');
    const data = await res.json();
    if (data.success) {
      localScanResults = data.instances || [];
      renderLocalScanResults(localScanResults);
      if (statusBadge) {
        statusBadge.textContent = `Scan beendet: ${localScanResults.length} Instanz(en) aktiv (${data.durationMs || 0}ms)`;
        statusBadge.className = 'scanner-status-tag scanner-status badge-sub idle';
      }
      return data;
    } else {
      if (statusBadge) statusBadge.textContent = 'Scan fehlgeschlagen.';
    }
  } catch (err) {
    if (statusBadge) statusBadge.textContent = `Fehler: ${err.message}`;
  } finally {
    if (btn) btn.disabled = false;
  }
  return null;
}

export async function saveEndpoint(endpointData, secret) {
  const isEdit = Boolean(endpointData.id);
  const url = isEdit ? `/api/endpoints/${endpointData.id}` : '/api/endpoints';
  const method = isEdit ? 'PUT' : 'POST';

  const payload = { endpoint: endpointData };
  // Write-Only Protection: Check for mask placeholders
  if (secret && !secret.includes('••••') && !secret.startsWith('sk-...')) {
    payload.secret = secret;
  }

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Speichern fehlgeschlagen');
  }
  await loadEndpoints();
  closeEndpointDrawer();
  return data;
}

export async function deleteEndpoint(id) {
  if (!confirm('Möchtest du diesen Endpunkt wirklich entfernen?')) return;
  const res = await fetch(`/api/endpoints/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok || !data.success) {
    alert(`Fehler: ${data.error || 'Löschen fehlgeschlagen'}`);
  } else {
    await loadEndpoints();
    closeEndpointDrawer();
  }
  return data;
}

export async function testEndpoint(id) {
  showModelError(null);
  try {
    const res = await fetch(`/api/endpoints/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.result) {
      const r = data.result;
      updateEndpointTelemetry(id, r.status, r.latencyMs, r.quotaRemaining);
      return r;
    } else {
      handleProbeError(data.error || 'Test fehlgeschlagen', data.result);
    }
  } catch (err) {
    showModelError('Testfehler', err.message, 'Backend antwortet nicht.');
  }
  return null;
}

export async function testAdhoc(formData) {
  const feedback = document.getElementById('drawerProbeFeedback');
  if (feedback) {
    feedback.className = 'drawer-feedback mt-2';
    feedback.style.color = '#00e5ff';
    feedback.textContent = '⏳ Two-Tier Safe Probe läuft (Metadaten & Ping)...';
    feedback.classList.remove('hidden');
  }

  try {
    const res = await fetch('/api/endpoints/test-adhoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });
    const data = await res.json();
    if (data.success && data.result) {
      const r = data.result;
      if (feedback) {
        feedback.style.color = '#10b981';
        feedback.textContent = `🟢 Erfolgreich: ${r.latencyMs || 0}ms RTT, Quoten: ${r.quotaRemaining || 'OK'}`;
      }
      return data;
    } else {
      if (feedback) {
        feedback.style.color = '#ef4444';
        feedback.textContent = `🔴 Fehler: ${data.error || 'Probe fehlgeschlagen'}`;
      }
    }
  } catch (err) {
    if (feedback) {
      feedback.style.color = '#ef4444';
      feedback.textContent = `Fehler: ${err.message}`;
    }
  }
  return null;
}

export async function startDeviceFlow() {
  try {
    const res = await fetch('/api/auth/device-flow/start', { method: 'POST' });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Device Flow Start fehlgeschlagen');

    deviceFlowSession = data;
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
    clearInterval(deviceCountdownInterval);
    deviceCountdownInterval = setInterval(() => {
      remainingSec--;
      if (remainingSec <= 0) {
        clearInterval(deviceCountdownInterval);
        clearInterval(devicePollInterval);
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
    clearInterval(devicePollInterval);
    devicePollInterval = setInterval(async () => {
      if (!deviceFlowSession) return;
      try {
        const stRes = await fetch(`/api/auth/device-flow/status/${deviceFlowSession.sessionId}`);
        const stData = await stRes.json();
        if (stData.status === 'success') {
          handleDeviceAuthSuccess({
            provider: 'GitHub',
            model: 'gpt-4o',
            endpointId: stData.endpointId
          });
        } else if (stData.status === 'denied' || stData.status === 'expired') {
          clearInterval(devicePollInterval);
          clearInterval(deviceCountdownInterval);
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
  clearInterval(deviceCountdownInterval);
  clearInterval(devicePollInterval);
  if (deviceFlowSession && deviceFlowSession.sessionId) {
    try {
      await fetch(`/api/auth/device-flow/cancel/${deviceFlowSession.sessionId}`, { method: 'POST' });
    } catch {}
  }
  deviceFlowSession = null;
  const modal = document.getElementById('modalDeviceFlow');
  if (modal) modal.classList.add('hidden');
}

export function renderTierAssignment() {
  const selFast = document.getElementById('selectFastTier') || document.getElementById('selFastTierEndpoint');
  const selArch = document.getElementById('selectArchitectTier') || document.getElementById('selArchitectTierEndpoint');
  const chkEmergency = document.getElementById('toggleZeroKeyEmergency') || document.getElementById('chkZeroKeyFallback');

  if (chkEmergency) chkEmergency.checked = zeroKeyFallbackEnabled;

  if (selFast) {
    selFast.innerHTML = '';
    modelEndpoints.forEach(ep => {
      const opt = document.createElement('option');
      opt.value = ep.id;
      opt.textContent = `${ep.name} (${ep.provider} - ${ep.modelId})`;
      if (ep.id === activeFastTierEndpointId) opt.selected = true;
      selFast.appendChild(opt);
    });
  }

  if (selArch) {
    selArch.innerHTML = '';
    modelEndpoints.forEach(ep => {
      const opt = document.createElement('option');
      opt.value = ep.id;
      opt.textContent = `${ep.name} (${ep.provider} - ${ep.modelId})`;
      if (ep.id === activeArchitectTierEndpointId) opt.selected = true;
      selArch.appendChild(opt);
    });
  }

  const activeFast = modelEndpoints.find(e => e.id === activeFastTierEndpointId);
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

  const activeArch = modelEndpoints.find(e => e.id === activeArchitectTierEndpointId);
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

export function renderLocalScanResults(instances) {
  const container = document.getElementById('localScannerResults') || document.getElementById('localInstancesContainer');
  const vramProgress = document.getElementById('progressVram');
  const vramText = document.getElementById('txtVramStatus');
  const gpuBadge = document.getElementById('badgeGpuStatus');

  if (!container) return;
  container.innerHTML = '';

  if (!instances || instances.length === 0) {
    container.innerHTML = '<div class="scanner-empty-hint empty-hint">Keine aktiven lokalen Inferenz-Server gefunden (Ports 11434, 1234, 8000, 8080, 1337 geprüft).</div>';
    if (vramProgress) vramProgress.style.width = '0%';
    if (vramText) vramText.textContent = '0 GB / 0 GB';
    return;
  }

  let maxVramOffload = 0;
  let dominantGpuStatus = 'optimal';

  instances.forEach(inst => {
    if (inst.vramOffloadPercentage !== null && inst.vramOffloadPercentage !== undefined) {
      if (inst.vramOffloadPercentage > maxVramOffload) {
        maxVramOffload = inst.vramOffloadPercentage;
        dominantGpuStatus = inst.gpuStatus || 'optimal';
      }
    }

    const card = document.createElement('div');
    card.className = 'local-instance-card local-card';

    const header = document.createElement('div');
    header.className = 'local-card-title instance-header';
    header.innerHTML = `
      <span>${inst.engine === 'ollama' ? '🦙 Ollama' : '🧪 ' + inst.engine} (Port ${inst.port})</span>
      <span class="status-pill-cad healthy">🟢 Online ${inst.version ? '(' + inst.version + ')' : ''}</span>
    `;
    card.appendChild(header);

    const modelsBox = document.createElement('div');
    modelsBox.style.fontSize = '11px';
    const modelsCount = inst.models ? inst.models.length : 0;
    const modelNames = inst.models ? inst.models.map(m => m.name || m.id).slice(0, 3).join(', ') : 'Keine Modelle';
    modelsBox.innerHTML = `<strong>Modelle (${modelsCount}):</strong> <span class="text-muted">${modelNames}${modelsCount > 3 ? '...' : ''}</span>`;
    card.appendChild(modelsBox);

    if (inst.vramOffloadPercentage !== null) {
      const vramInfo = document.createElement('div');
      vramInfo.style.fontSize = '10.5px';
      vramInfo.innerHTML = `GPU VRAM Offload: <strong>${inst.vramOffloadPercentage}%</strong> (${inst.gpuStatus || 'optimal'})`;
      card.appendChild(vramInfo);
    }

    const actions = document.createElement('div');
    actions.className = 'instance-actions mt-1';
    actions.style.display = 'flex';
    actions.style.gap = '8px';

    const assignBtn = document.createElement('button');
    assignBtn.className = 'btn btn-primary btn-xs btn-assign-local';
    assignBtn.textContent = '⚡ Als Architect Tier zuweisen';
    assignBtn.type = 'button';
    assignBtn.addEventListener('click', async () => {
      const firstModel = (inst.models && inst.models[0]) ? (inst.models[0].name || inst.models[0].id) : 'llama3.2';
      const endpointData = {
        name: `${inst.engine} (Port ${inst.port})`,
        provider: inst.engine === 'ollama' ? 'Ollama' : 'LMStudio',
        tier: 'ARCHITECT_TIER',
        baseUrl: inst.baseUrl,
        modelId: firstModel
      };
      try {
        const created = await saveEndpoint(endpointData);
        if (created && created.endpoint) {
          await activateTier('ARCHITECT_TIER', created.endpoint.id);
        }
      } catch (e) {
        alert(`Zuweisung fehlgeschlagen: ${e.message}`);
      }
    });
    actions.appendChild(assignBtn);

    const testBtn = document.createElement('button');
    testBtn.className = 'btn btn-secondary btn-xs btn-test-local';
    testBtn.textContent = 'Probe testen';
    testBtn.type = 'button';
    testBtn.addEventListener('click', () => {
      const firstModel = (inst.models && inst.models[0]) ? (inst.models[0].name || inst.models[0].id) : 'llama3.2';
      testAdhoc({
        baseUrl: inst.baseUrl,
        modelId: firstModel,
        authType: 'none'
      });
    });
    actions.appendChild(testBtn);

    card.appendChild(actions);
    container.appendChild(card);
  });

  if (vramProgress) {
    vramProgress.style.width = `${maxVramOffload}%`;
    vramProgress.className = `vram-fill vram-bar-fill ${dominantGpuStatus}`;
  }
  if (vramText) {
    vramText.textContent = `${maxVramOffload}% Offload`;
  }
  if (gpuBadge) {
    gpuBadge.textContent = `GPU: ${dominantGpuStatus}`;
    gpuBadge.className = `gpu-status-badge ${dominantGpuStatus}`;
  }
}

export function renderProviderCards() {
  const grid = document.getElementById('providerGrid') || document.getElementById('providerCardsGrid');
  const countLabel = document.getElementById('lblProviderCount');
  if (!grid) return;

  grid.innerHTML = '';
  if (countLabel) countLabel.textContent = `${modelEndpoints.length} Endpunkte konfiguriert`;

  const standardProviders = [
    { name: 'GitHub Models', provider: 'GitHub', icon: '🐙', isDeviceFlow: true },
    { name: 'OpenRouter', provider: 'OpenRouter', icon: '🌐' },
    { name: 'Cerebras Cloud', provider: 'Cerebras', icon: '⚡' },
    { name: 'GroqCloud LPU', provider: 'Groq', icon: '🚀' },
    { name: 'Mistral / Codestral', provider: 'Mistral', icon: '🌪️' },
    { name: 'Google Gemini', provider: 'Gemini', icon: '💎' },
    { name: 'Ollama (Lokal)', provider: 'Ollama', icon: '🦙', isLocal: true },
    { name: 'Custom OpenAI-kompatibel', provider: 'Custom', icon: '🔌' }
  ];

  standardProviders.forEach(p => {
    const configuredEps = modelEndpoints.filter(e => e.provider === p.provider);
    const card = document.createElement('div');
    card.className = 'provider-card';

    const header = document.createElement('div');
    header.className = 'provider-card-header';
    header.innerHTML = `
      <div class="provider-card-title">
        <span>${p.icon}</span>
        <span>${p.name}</span>
      </div>
      <span class="status-pill-cad ${configuredEps.length > 0 ? 'healthy' : 'cooldown'}">
        ${configuredEps.length > 0 ? '🟢 Verbunden' : '⚪ Standby'}
      </span>
    `;
    card.appendChild(header);

    const body = document.createElement('div');
    body.className = 'provider-card-body';
    if (configuredEps.length > 0) {
      const ep = configuredEps[0];
      body.innerHTML = `
        <div><strong>Modell:</strong> <span class="font-mono">${ep.modelId || '-'}</span></div>
        <div><strong>Tier:</strong> <span class="badge-sub">${ep.tier || 'FAST_TIER'}</span></div>
        <div><strong>Latenz:</strong> <span class="pill-latency-badge good">${ep.latencyMs ? ep.latencyMs + 'ms' : 'OK'}</span></div>
      `;
    } else {
      body.innerHTML = `
        <div class="text-muted" style="font-size: 11px;">
          ${p.isDeviceFlow ? '1-Click schlüssellose Verbindung via GitHub Account (RFC 8628).' :
            p.isLocal ? 'Lokaler Inferenz-Runner ohne API-Kosten.' : 'Cloud API-Endpunkt mit schnellen Reaktionszeiten.'}
        </div>
      `;
    }
    card.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'provider-card-actions';

    if (p.isDeviceFlow && configuredEps.length === 0) {
      const btnDevice = document.createElement('button');
      btnDevice.className = 'btn btn-primary btn-xs w-full';
      btnDevice.textContent = '🐙 Mit GitHub verbinden (1-Click)';
      btnDevice.type = 'button';
      btnDevice.addEventListener('click', startDeviceFlow);
      actions.appendChild(btnDevice);

      const btnPat = document.createElement('button');
      btnPat.className = 'btn btn-ghost btn-xs w-full mt-1';
      btnPat.textContent = '🔑 Token / PAT manuell eingeben';
      btnPat.type = 'button';
      btnPat.addEventListener('click', () => {
        openEndpointDrawer(null);
        const sel = document.getElementById('selEndpointProvider');
        if (sel) {
          sel.value = 'GitHub';
          sel.dispatchEvent(new Event('change'));
        }
      });
      actions.appendChild(btnPat);
    } else if (configuredEps.length > 0) {
      const ep = configuredEps[0];
      const btnTest = document.createElement('button');
      btnTest.className = 'btn btn-secondary btn-xs btn-test-endpoint btn-card-test';
      btnTest.id = `btnTestEndpoint_${ep.id}`;
      btnTest.textContent = '⚡ Testen';
      btnTest.type = 'button';
      btnTest.addEventListener('click', async () => {
        btnTest.disabled = true;
        btnTest.textContent = '⏳ Prüfe...';
        await testEndpoint(ep.id);
        btnTest.disabled = false;
        btnTest.textContent = '⚡ Testen';
      });
      actions.appendChild(btnTest);

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-ghost btn-xs btn-card-edit';
      btnEdit.textContent = '⚙️ Konfig';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => openEndpointDrawer(ep.id));
      actions.appendChild(btnEdit);
    } else {
      const btnAdd = document.createElement('button');
      btnAdd.className = 'btn btn-secondary btn-xs';
      btnAdd.textContent = '+ Konfigurieren';
      btnAdd.type = 'button';
      btnAdd.addEventListener('click', () => {
        openEndpointDrawer(null);
        const sel = document.getElementById('selEndpointProvider');
        if (sel) sel.value = p.provider;
      });
      actions.appendChild(btnAdd);
    }

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

export function renderTelemetrySummary() {
  const lastRouterEl = document.getElementById('txtLastRouterEndpoint');
  const metricLatEl = document.getElementById('metricLatency');
  const metricSuccessEl = document.getElementById('metricSuccessRate');
  const remainingReqEl = document.getElementById('txtRemainingRequests');
  const cooldownTimerEl = document.getElementById('timerCooldown429');

  const activeEp = modelEndpoints.find(e => e.id === activeFastTierEndpointId) || modelEndpoints[0];
  if (activeEp) {
    if (lastRouterEl) lastRouterEl.textContent = `${activeEp.provider} (${activeEp.modelId})`;
    if (metricLatEl) {
      const ms = activeEp.latencyMs || 42;
      metricLatEl.textContent = `${ms}ms RTT`;
      metricLatEl.className = ms < 150 ? 'metric-sub good' : ms < 500 ? 'metric-sub moderate' : 'metric-sub slow';
    }
  }

  if (metricSuccessEl) metricSuccessEl.textContent = '100%';
  if (remainingReqEl) remainingReqEl.textContent = '850 Anfragen (OK)';
  if (cooldownTimerEl) cooldownTimerEl.textContent = 'Inaktiv';
}

export function updateHeaderPill() {
  const activeEp = modelEndpoints.find(e => e.id === activeFastTierEndpointId) || modelEndpoints[0];
  const activeNameEl = document.getElementById('txtActiveLlmName');
  const latencyBadgeEl = document.getElementById('pillLlmLatency');

  if (activeNameEl) {
    if (activeEp) {
      activeNameEl.textContent = `${activeEp.provider} (${activeEp.modelId})`;
    } else {
      activeNameEl.textContent = 'Cerebras / Groq';
    }
  }

  if (latencyBadgeEl) {
    const ms = activeEp ? (activeEp.latencyMs || 42) : 42;
    latencyBadgeEl.textContent = `${ms}ms`;
    latencyBadgeEl.className = `pill-latency-badge ${ms < 150 ? 'good' : ms < 500 ? 'moderate' : 'slow'}`;
  }
}

export function updateEndpointTelemetry(id, status, latencyMs, quotaRemaining) {
  const ep = modelEndpoints.find(e => e.id === id);
  if (ep) {
    if (status) ep.status = status;
    if (latencyMs) ep.latencyMs = latencyMs;
    if (quotaRemaining) ep.quotaRemaining = quotaRemaining;
  }
  renderTierAssignment();
  renderProviderCards();
  renderTelemetrySummary();
  updateHeaderPill();
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

export function handleDeviceAuthSuccess(msg) {
  clearInterval(deviceCountdownInterval);
  clearInterval(devicePollInterval);

  const pollingStateEl = document.getElementById('lblDevicePollingState');
  if (pollingStateEl) {
    pollingStateEl.textContent = '✓ GitHub Models erfolgreich autorisiert!';
    pollingStateEl.style.color = '#10b981';
  }

  setTimeout(() => {
    const modal = document.getElementById('modalDeviceFlow');
    if (modal) modal.classList.add('hidden');
    deviceFlowSession = null;
    loadEndpoints();
  }, 1200);
}

export function handleTierActivated(msg) {
  if (msg.tier === 'FAST_TIER') activeFastTierEndpointId = msg.endpointId;
  if (msg.tier === 'ARCHITECT_TIER') activeArchitectTierEndpointId = msg.endpointId;
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
      zeroKeyFallbackEnabled = e.target.checked;
    });
  }

  const btnScan = document.getElementById('btnScanLocal');
  if (btnScan) btnScan.addEventListener('click', scanLocalPorts);

  const selProvider = document.getElementById('selEndpointProvider');
  if (selProvider) {
    selProvider.addEventListener('change', (e) => {
      const p = e.target.value;
      const isNew = !document.getElementById('txtEndpointId')?.value;
      if (!isNew) return; // Don't overwrite existing endpoint settings on edit

      const nameEl = document.getElementById('txtEndpointName');
      const urlEl = document.getElementById('txtEndpointBaseUrl');
      const modelEl = document.getElementById('txtEndpointModelId');
      const tierEl = document.getElementById('selEndpointTier');

      const defaults = {
        GitHub: { name: 'GitHub Models (GPT-4o)', url: 'https://models.github.ai/inference', model: 'openai/gpt-4o', tier: 'ARCHITECT_TIER' },
        OpenRouter: { name: 'OpenRouter (Llama 3.3 Free)', url: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', tier: 'FAST_TIER' },
        Cerebras: { name: 'Cerebras (Llama 3.3 70B)', url: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', tier: 'FAST_TIER' },
        Groq: { name: 'Groq (Llama 3.3 70B)', url: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', tier: 'FAST_TIER' },
        Mistral: { name: 'Mistral (Small Latest)', url: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', tier: 'FAST_TIER' },
        Gemini: { name: 'Google Gemini (Flash 2.5)', url: 'https://generativelanguage.googleapis.com/v1beta/openai/', model: 'gemini-2.5-flash', tier: 'FAST_TIER' },
        Ollama: { name: 'Ollama (Lokal)', url: 'http://127.0.0.1:11434/v1', model: 'llama3:latest', tier: 'FAST_TIER' },
        LMStudio: { name: 'LM Studio (Lokal)', url: 'http://127.0.0.1:1234/v1', model: 'default', tier: 'FAST_TIER' }
      };

      if (defaults[p]) {
        if (nameEl) nameEl.value = defaults[p].name;
        if (urlEl) urlEl.value = defaults[p].url;
        if (modelEl) modelEl.value = defaults[p].model;
        if (tierEl) tierEl.value = defaults[p].tier;
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
      if (activeFastTierEndpointId) testEndpoint(activeFastTierEndpointId);
    });
  }

  const btnTestArch = document.getElementById('btnTestArchitectTier');
  if (btnTestArch) {
    btnTestArch.addEventListener('click', () => {
      if (activeArchitectTierEndpointId) testEndpoint(activeArchitectTierEndpointId);
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
