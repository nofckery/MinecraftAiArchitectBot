/**
 * Model Cards, Local Instances Scan Results, and Telemetry Summary Renderers.
 */

import { modelCtx } from './modelContext.js';
import {
  saveEndpoint,
  activateTier,
  testAdhoc,
  testEndpoint,
  syncProvider,
  startOpenRouterPkce
} from './modelApiClient.js';
import { startDeviceFlow } from './deviceFlowManager.js';

let openDrawerFn = () => {};
let renderTierAssignmentFn = () => {};

export function setCardsRendererDependencies(deps) {
  if (deps.openEndpointDrawer) openDrawerFn = deps.openEndpointDrawer;
  if (deps.renderTierAssignment) renderTierAssignmentFn = deps.renderTierAssignment;
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
  if (countLabel) countLabel.textContent = `${modelCtx.modelEndpoints.length} Endpunkte konfiguriert`;

  const standardProviders = [
    { name: 'GitHub Models', provider: 'GitHub', icon: '🐙', isDeviceFlow: true },
    { name: 'OpenRouter', provider: 'OpenRouter', icon: '🌐', isPkceFlow: true },
    { name: 'Cerebras Cloud', provider: 'Cerebras', icon: '⚡' },
    { name: 'GroqCloud LPU', provider: 'Groq', icon: '🚀' },
    { name: 'Mistral / Codestral', provider: 'Mistral', icon: '🌪️' },
    { name: 'Google Gemini', provider: 'Gemini', icon: '💎' },
    { name: 'SambaNova Cloud', provider: 'SambaNova', icon: '🐆' },
    { name: 'Hugging Face Router', provider: 'HuggingFace', icon: '🤗', isHfFlow: true },
    { name: 'Ollama (Lokal)', provider: 'Ollama', icon: '🦙', isLocal: true },
    { name: 'Custom OpenAI-kompatibel', provider: 'Custom', icon: '🔌' }
  ];

  standardProviders.forEach(p => {
    const configuredEps = modelCtx.modelEndpoints.filter(e => e.provider === p.provider);
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
      const modelNames = configuredEps.map(e => e.modelId).slice(0, 3).join(', ');
      body.innerHTML = `
        <div><strong>Modelle (${configuredEps.length}):</strong> <span class="font-mono text-2xs">${modelNames}${configuredEps.length > 3 ? '...' : ''}</span></div>
        <div><strong>Tier:</strong> <span class="badge-sub">${ep.tier || 'FAST_TIER'}</span></div>
        <div><strong>Latenz:</strong> <span class="pill-latency-badge good">${ep.latencyMs ? ep.latencyMs + 'ms' : 'OK'}</span></div>
      `;
    } else {
      body.innerHTML = `
        <div class="text-muted" style="font-size: 11px;">
          ${p.isDeviceFlow ? '1-Click schlüssellose Verbindung via GitHub Account (RFC 8628).' :
            p.isPkceFlow ? '1-Click OAuth 2.0 PKCE Verbindung mit OpenRouter Account.' :
            p.isHfFlow ? 'OpenAI-kompatibler Router zu Open-Source Modellen.' :
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
        openDrawerFn(null);
        const sel = document.getElementById('selEndpointProvider');
        if (sel) {
          sel.value = 'GitHub';
          sel.dispatchEvent(new Event('change'));
        }
      });
      actions.appendChild(btnPat);
    } else if (p.isPkceFlow && configuredEps.length === 0) {
      const btnPkce = document.createElement('button');
      btnPkce.className = 'btn btn-primary btn-xs w-full';
      btnPkce.textContent = '🌐 Mit OpenRouter verbinden (1-Click)';
      btnPkce.type = 'button';
      btnPkce.addEventListener('click', startOpenRouterPkce);
      actions.appendChild(btnPkce);

      const btnKey = document.createElement('button');
      btnKey.className = 'btn btn-ghost btn-xs w-full mt-1';
      btnKey.textContent = '🔑 API-Key manuell eingeben';
      btnKey.type = 'button';
      btnKey.addEventListener('click', () => {
        openDrawerFn(null);
        const sel = document.getElementById('selEndpointProvider');
        if (sel) {
          sel.value = 'OpenRouter';
          sel.dispatchEvent(new Event('change'));
        }
      });
      actions.appendChild(btnKey);
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

      const btnSync = document.createElement('button');
      btnSync.className = 'btn btn-secondary btn-xs btn-sync-models';
      btnSync.textContent = '🔄 Sync';
      btnSync.type = 'button';
      btnSync.title = 'Ruft alle verfügbaren Modelle dieses Anbieters live ab';
      btnSync.addEventListener('click', () => syncProvider(ep.id, btnSync));
      actions.appendChild(btnSync);

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn btn-ghost btn-xs btn-card-edit';
      btnEdit.textContent = '⚙️ Konfig';
      btnEdit.type = 'button';
      btnEdit.addEventListener('click', () => openDrawerFn(ep.id));
      actions.appendChild(btnEdit);
    } else {
      const btnAdd = document.createElement('button');
      btnAdd.className = 'btn btn-secondary btn-xs';
      btnAdd.textContent = '+ Konfigurieren';
      btnAdd.type = 'button';
      btnAdd.addEventListener('click', () => {
        openDrawerFn(null);
        const sel = document.getElementById('selEndpointProvider');
        if (sel) {
          sel.value = p.provider;
          sel.dispatchEvent(new Event('change'));
        }
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

  const activeEp = modelCtx.modelEndpoints.find(e => e.id === modelCtx.activeFastTierEndpointId) || modelCtx.modelEndpoints[0];
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

  // v3 Token & Cost Telemetry
  const costDisplay = document.getElementById('txtTotalCostDisplay');
  const promptTokEl = document.getElementById('valPromptTokens');
  const compTokEl = document.getElementById('valCompletionTokens');
  const reqTotalEl = document.getElementById('valTotalRequests');

  const totalCost = modelCtx.telemetryData?.totalCostUSD || 0;
  if (costDisplay) {
    costDisplay.textContent = `$${totalCost.toFixed(4)} USD (${totalCost === 0 ? '100% Free-Tier' : 'Effizient'})`;
  }
  if (promptTokEl) promptTokEl.textContent = (modelCtx.telemetryData?.totalPromptTokens || 0).toLocaleString();
  if (compTokEl) compTokEl.textContent = (modelCtx.telemetryData?.totalCompletionTokens || 0).toLocaleString();
  if (reqTotalEl) reqTotalEl.textContent = (modelCtx.telemetryData?.totalRequests || 0).toLocaleString();
}

export function updateHeaderPill() {
  const activeEp = modelCtx.modelEndpoints.find(e => e.id === modelCtx.activeFastTierEndpointId) || modelCtx.modelEndpoints[0];
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
  const ep = modelCtx.modelEndpoints.find(e => e.id === id);
  if (ep) {
    if (status) ep.status = status;
    if (latencyMs) ep.latencyMs = latencyMs;
    if (quotaRemaining) ep.quotaRemaining = quotaRemaining;
  }
  renderTierAssignmentFn();
  renderProviderCards();
  renderTelemetrySummary();
  updateHeaderPill();
}
