/**
 * Model API Client: REST calls for endpoint management, probing, local scan, and OAuth PKCE.
 */

import { modelCtx } from './modelContext.js';

let callbacks = {
  renderProfileSelector: () => {},
  renderRoleMatrix: () => {},
  renderTierAssignment: () => {},
  renderProviderCards: () => {},
  renderTelemetrySummary: () => {},
  updateHeaderPill: () => {},
  showModelError: () => {},
  closeEndpointDrawer: () => {},
  renderLocalScanResults: () => {},
  updateEndpointTelemetry: () => {},
  handleProbeError: () => {}
};

export function setModelApiCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs };
}

export async function loadEndpoints() {
  try {
    const res = await fetch('/api/endpoints');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.success) {
      modelCtx.modelEndpoints = data.endpoints || [];
      modelCtx.activeFastTierEndpointId = data.activeFastEndpointId || null;
      modelCtx.activeArchitectTierEndpointId = data.activeArchitectEndpointId || null;
      modelCtx.zeroKeyFallbackEnabled = data.zeroKeyFallbackEnabled !== false;
      modelCtx.activeProfile = data.activeProfile || 'eco';
      modelCtx.roleAssignments = data.roleAssignments || {};
      modelCtx.telemetryData = data.telemetry || {};

      // Load roles status from /api/models/roles
      try {
        const rolesRes = await fetch('/api/models/roles');
        if (rolesRes.ok) {
          const rolesJson = await rolesRes.json();
          if (rolesJson.success) {
            modelCtx.rolesStatus = rolesJson.roles || {};
            modelCtx.activeProfile = rolesJson.profile || modelCtx.activeProfile;
          }
        }
      } catch (_) {}

      callbacks.renderProfileSelector();
      callbacks.renderRoleMatrix();
      callbacks.renderTierAssignment();
      callbacks.renderProviderCards();
      callbacks.renderTelemetrySummary();
      callbacks.updateHeaderPill();
      return data;
    }
  } catch (err) {
    console.error('[ModelCockpit] Fehler beim Laden der Endpunkte:', err);
    callbacks.showModelError('Verbindungsfehler', err.message, 'Express REST Backend nicht erreichbar.');
  }
  return null;
}

export async function setRoutingProfile(profile) {
  try {
    const res = await fetch('/api/models/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile })
    });
    const data = await res.json();
    if (data.success) {
      modelCtx.activeProfile = profile;
      await loadEndpoints();
    }
  } catch (err) {
    alert(`Fehler beim Profilwechsel: ${err.message}`);
  }
}

export async function pinRole(role, endpointId) {
  try {
    const res = await fetch('/api/models/roles/pin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, endpointId })
    });
    const data = await res.json();
    if (data.success) {
      await loadEndpoints();
    }
  } catch (err) {
    alert(`Fehler beim Pinnen: ${err.message}`);
  }
}

export async function syncProvider(providerId, btnEl) {
  if (btnEl) {
    btnEl.disabled = true;
    btnEl.textContent = '⏳ Synchronisiere...';
  }
  try {
    const res = await fetch(`/api/providers/${encodeURIComponent(providerId)}/sync`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      await loadEndpoints();
      alert(`Erfolgreich synchronisiert: ${data.syncedCount} Modelle für ${data.provider} gefunden.`);
    } else {
      alert(`Synchronisation fehlgeschlagen: ${data.error}`);
    }
  } catch (err) {
    alert(`Fehler bei Synchronisation: ${err.message}`);
  } finally {
    if (btnEl) {
      btnEl.disabled = false;
      btnEl.textContent = '🔄 Modelle synchronisieren';
    }
  }
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
      if (tier === 'FAST_TIER') modelCtx.activeFastTierEndpointId = endpointId;
      if (tier === 'ARCHITECT_TIER') modelCtx.activeArchitectTierEndpointId = endpointId;
      callbacks.renderTierAssignment();
      callbacks.updateHeaderPill();
      return data;
    } else {
      callbacks.showModelError('Tier-Aktivierung fehlgeschlagen', data.error, 'Bitte gültigen Endpunkt auswählen.');
    }
  } catch (err) {
    callbacks.showModelError('Tier-Aktivierung Netzwerkfehler', err.message, 'Netzwerkverbindung prüfen.');
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
      modelCtx.localScanResults = data.instances || [];
      callbacks.renderLocalScanResults(modelCtx.localScanResults);
      if (statusBadge) {
        statusBadge.textContent = `Scan beendet: ${modelCtx.localScanResults.length} Instanz(en) aktiv (${data.durationMs || 0}ms)`;
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
  callbacks.closeEndpointDrawer();
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
    callbacks.closeEndpointDrawer();
  }
  return data;
}

export async function testEndpoint(id) {
  callbacks.showModelError(null);
  try {
    const res = await fetch(`/api/endpoints/${id}/test`, { method: 'POST' });
    const data = await res.json();
    if (data.success && data.result) {
      const r = data.result;
      callbacks.updateEndpointTelemetry(id, r.status, r.latencyMs, r.quotaRemaining);
      return r;
    } else {
      callbacks.handleProbeError(data.error || 'Test fehlgeschlagen', data.result);
    }
  } catch (err) {
    callbacks.showModelError('Testfehler', err.message, 'Backend antwortet nicht.');
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

export async function startOpenRouterPkce() {
  try {
    const res = await fetch('/api/auth/openrouter/pkce/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callbackUrl: `${window.location.origin}/api/auth/openrouter/callback`
      })
    });
    const data = await res.json();
    if (!data.success || !data.authUrl) {
      throw new Error(data.error || 'PKCE Start fehlgeschlagen');
    }

    const popup = window.open(data.authUrl, 'OpenRouterAuth', 'width=620,height=740,menubar=no,toolbar=no');
    if (!popup) {
      window.location.href = data.authUrl;
      return null;
    }

    const onAuthMessage = async (event) => {
      if (event.data && event.data.type === 'openrouter_auth_success') {
        window.removeEventListener('message', onAuthMessage);
        await loadEndpoints();
      }
    };
    window.addEventListener('message', onAuthMessage);

    const pollInterval = setInterval(async () => {
      try {
        const stRes = await fetch(`/api/auth/openrouter/pkce/status/${data.sessionId}`);
        const st = await stRes.json();
        if (st.status === 'success') {
          clearInterval(pollInterval);
          window.removeEventListener('message', onAuthMessage);
          await loadEndpoints();
        } else if (st.status === 'expired' || (popup && popup.closed)) {
          clearInterval(pollInterval);
        }
      } catch (_) {}
    }, 2500);

    return data;
  } catch (err) {
    alert(`OpenRouter OAuth Fehler: ${err.message}`);
    return null;
  }
}
