/**
 * Bot-Cam Stream Toggling, LAN World Discovery & Kick Diagnostics
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { isPoppedOut, broadcastViewerState } from '../viewerController.js';
import { isPopoutActive } from '../manualCockpit.js';
import {
  isViewerOffline,
  isViewerStreamActive,
  setViewerStreamActive,
  resolveViewerPort,
  executeViewerProbe,
  setViewerOnlineStatus,
  probeViewerReachability,
  abortActiveProbe
} from './botCamProbe.js';

// Re-export probe API
export {
  isViewerOffline,
  isViewerStreamActive,
  setViewerStreamActive,
  resolveViewerPort,
  executeViewerProbe,
  setViewerOnlineStatus,
  probeViewerReachability,
  abortActiveProbe
};

let refreshViewerHandler = null;

export function setViewerRefreshCallback(fn) {
  refreshViewerHandler = fn;
}

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function applyViewerStreamEnabled(enabled, running = true, port = null) {
  setViewerStreamActive(Boolean(enabled));
  const isEnabled = isViewerStreamActive();
  const btnToggle = document.getElementById('btnToggleViewerStream');
  const disabledPlaceholder = document.getElementById('viewerDisabledPlaceholder');
  const viewerWrapper = document.getElementById('viewerWrapper');
  const viewerFrame = document.getElementById('viewerFrame');
  const resolvedPort = port || document.getElementById('lblViewerPort')?.textContent || 3081;
  const targetUrl = `${window.location.protocol}//${window.location.hostname}:${resolvedPort}`;

  if (btnToggle) {
    if (isEnabled) {
      btnToggle.textContent = '⏹️ Stream: An';
      btnToggle.title = 'Prismarine 3D-Viewer stoppen (schont CPU & RAM)';
      btnToggle.classList.remove('is-paused');
    } else {
      btnToggle.textContent = '▶️ Stream: Aus';
      btnToggle.title = 'Prismarine 3D-Viewer aktivieren';
      btnToggle.classList.add('is-paused');
    }
  }

  const cfgViewer = document.getElementById('cfgEnableViewer');
  if (cfgViewer && cfgViewer.checked !== isEnabled) {
    cfgViewer.checked = isEnabled;
  }

  // Multi-Monitor / Popout Fenster synchronisieren
  if (typeof broadcastViewerState === 'function') {
    broadcastViewerState(isEnabled, running, resolvedPort);
  }

  if (isPoppedOut() || isPopoutActive()) {
    return;
  }

  if (!isEnabled) {
    if (viewerFrame) {
      viewerFrame.src = 'about:blank';
    }
    if (viewerWrapper) {
      viewerWrapper.style.display = 'none';
    }
    if (disabledPlaceholder) {
      disabledPlaceholder.classList.remove('hidden');
    }
  } else {
    if (disabledPlaceholder) {
      disabledPlaceholder.classList.add('hidden');
    }
    if (viewerWrapper) {
      viewerWrapper.style.display = '';
    }
    const offlinePlaceholder = document.getElementById('viewerOfflinePlaceholder');
    if (offlinePlaceholder) {
      if (isViewerOffline()) {
        setViewerOnlineStatus(false, resolvedPort);
        probeViewerReachability(false, resolvedPort);
      } else {
        setViewerOnlineStatus(true, resolvedPort);
      }
    } else {
      if (viewerFrame && (!viewerFrame.src || viewerFrame.src === 'about:blank' || !viewerFrame.src.includes(`:${resolvedPort}`))) {
        viewerFrame.src = targetUrl;
      }
    }
  }
}

export async function toggleViewerStream(targetState = null) {
  try {
    const body = targetState !== null ? { enabled: Boolean(targetState) } : {};
    const res = await fetch('/api/viewer/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      applyViewerStreamEnabled(data.enabled, data.running, data.port);
    }
  } catch (err) {
    console.error('[ViewerToggle] Fehler beim Umschalten des Viewers:', err);
  }
}

export function renderDiscoveredLanWorlds(worlds = []) {
  const pill = document.getElementById('pillLanDiscovered');
  const info = document.getElementById('txtLanDiscoveredInfo');
  const list = document.getElementById('lanWorldsList');
  const obList = document.getElementById('obLanWorldsList');
  const obNotice = document.getElementById('obLanDetectionNotice');
  const scanStatus = document.getElementById('lanScanStatus');

  const count = Array.isArray(worlds) ? worlds.length : 0;

  if (pill) {
    pill.classList.toggle('hidden', count === 0);
    if (info) {
      if (count === 0) {
        info.textContent = 'Gefunden';
      } else if (count === 1) {
        const motd = worlds[0].motd || 'Minecraft LAN-Welt';
        info.textContent = motd.length > 20 ? `${motd.slice(0, 18)}…` : motd;
        pill.title = `Minecraft LAN-Welt erkannt: ${motd} (${worlds[0].host}:${worlds[0].port}). Klicke hier für Schnellverbindung.`;
      } else {
        info.textContent = `${count} Welten`;
        pill.title = `${count} Minecraft LAN-Welten im lokalen Netzwerk entdeckt! Klicke hier für Details.`;
      }
    }
  }

  if (scanStatus) {
    scanStatus.textContent = count > 0 ? `✅ ${count} Welt(en) aktiv` : '📡 Scannt 224.0.2.60:4445...';
  }

  const buildHtml = (targetWorlds, isWizard = false) => {
    if (!targetWorlds || targetWorlds.length === 0) {
      return '<div class="lan-world-empty">Keine aktiven LAN-Welten gefunden. Öffne deine Minecraft-Welt über ESC &rarr; &quot;Im LAN öffnen&quot;.</div>';
    }
    return targetWorlds.map(w => `
      <div class="lan-world-card" data-port="${w.port}" data-host="${escapeHtml(w.host)}">
        <div class="lan-world-info">
          <span class="lan-world-motd">${escapeHtml(w.motd || 'Minecraft LAN-Welt')}</span>
          <span class="lan-world-meta">${escapeHtml(w.host)}:${w.port}</span>
        </div>
        <button type="button" class="lan-world-connect-btn" data-port="${w.port}" data-host="${escapeHtml(w.host)}" title="${isWizard ? 'Server-IP und Port in den Einrichtungs-Assistenten übernehmen' : 'Direkt mit dieser LAN-Welt verbinden'}">${isWizard ? '⚡ Übernehmen' : '🎮 Beitreten'}</button>
      </div>
    `).join('');
  };

  if (list) {
    list.innerHTML = buildHtml(worlds, false);
    list.querySelectorAll('.lan-world-connect-btn').forEach(btn => {
      btn.onclick = () => {
        const ownerVal = document.getElementById('cfgBotOwner')?.value?.trim();
        const userVal = document.getElementById('cfgBotUsername')?.value?.trim();
        connectToLanWorld(btn.dataset.host, btn.dataset.port, ownerVal, userVal, btn);
      };
    });
  }

  if (obList) {
    obList.innerHTML = buildHtml(worlds, true);
    obList.querySelectorAll('.lan-world-connect-btn').forEach(btn => {
      btn.onclick = () => {
        const hostInput = document.getElementById('obHost');
        const portInput = document.getElementById('obPort');
        if (hostInput) hostInput.value = btn.dataset.host || '127.0.0.1';
        if (portInput) portInput.value = btn.dataset.port;
        const offlineRadio = document.querySelector('input[name="obAuthRadio"][value="offline"]');
        if (offlineRadio) {
          offlineRadio.checked = true;
          document.querySelectorAll('.auth-choice-grid .choice-card').forEach(c => c.classList.remove('active'));
          offlineRadio.closest('.choice-card')?.classList.add('active');
        }
        btn.textContent = '✓ Übernommen';
        setTimeout(() => { btn.textContent = '⚡ Übernehmen'; }, 2000);
      };
    });
  }

  if (obNotice) {
    obNotice.classList.toggle('hidden', count === 0);
  }
}

export async function connectToLanWorld(host, port, botOwner = undefined, botUsername = undefined, triggerBtn = null) {
  try {
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.textContent = '⏳ Verbinde...';
    }
    const body = { host, port };
    if (botOwner) body.botOwner = botOwner;
    if (botUsername) body.botUsername = botUsername;

    const res = await fetch('/api/lan/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success) {
      const feedback = document.getElementById('settingsSaveFeedback');
      if (feedback) {
        feedback.style.color = '#10b981';
        feedback.textContent = `✅ Verbinde mit LAN-Welt auf ${host}:${port}...`;
        setTimeout(() => { feedback.textContent = ''; }, 4000);
      }
      if (refreshViewerHandler) {
        refreshViewerHandler(true);
      }
      if (triggerBtn) {
        triggerBtn.textContent = '✓ Verbunden';
        setTimeout(() => {
          triggerBtn.disabled = false;
          triggerBtn.textContent = '🎮 Beitreten';
        }, 3000);
      }
    } else {
      alert(`Fehler: ${data.error}`);
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.textContent = '🎮 Beitreten';
      }
    }
  } catch (err) {
    console.error('[LanConnect] Fehler:', err);
    if (triggerBtn) {
      triggerBtn.disabled = false;
      triggerBtn.textContent = '🎮 Beitreten';
    }
  }
}

export function renderKickDiagnostic(classification = {}, rawReason = '') {
  const banner = document.getElementById('botKickDiagnosticBanner');
  if (!banner) return;

  const titleEl = document.getElementById('fabricDiagTitle');
  const msgEl = document.getElementById('fabricDiagMessage');
  const nsContainer = document.getElementById('fabricDiagNamespaces');
  const linkEl = document.getElementById('fabricDiagModrinthLink');
  const instPathEl = document.getElementById('fabricDiagInstancePath');
  const instNoticeEl = document.getElementById('fabricDiagInstalledNotice');
  const btnInstallBypass = document.getElementById('btnInstallFabricBypass');

  if (titleEl) {
    titleEl.textContent = classification.title || 'Fabric Loader & API erforderlich';
  }
  if (msgEl) {
    msgEl.textContent = classification.message || 'Der Server erfordert Fabric Loader/API für installierte Mods.';
  }

  if (nsContainer) {
    nsContainer.innerHTML = '';
    const namespaces = Array.isArray(classification.relatedNamespaces) ? classification.relatedNamespaces : [];
    if (namespaces.length > 0) {
      const label = document.createElement('span');
      label.style.fontSize = '11px';
      label.style.color = '#94a3b8';
      label.style.marginRight = '4px';
      label.textContent = 'Erkannte Mod-Namespaces:';
      nsContainer.appendChild(label);

      namespaces.forEach(ns => {
        const chip = document.createElement('span');
        chip.className = 'fabric-diag-chip';
        chip.textContent = ns;
        nsContainer.appendChild(chip);
      });
    }
  }

  if (linkEl && classification.modrinthUrl) {
    linkEl.href = classification.modrinthUrl;
  }

  const renderInstanceDetails = (inst) => {
    if (!inst) {
      if (instPathEl) instPathEl.textContent = 'Keine lokale Minecraft-Instanz erkannt. Bitte manuell im mods-Ordner installieren.';
      if (instNoticeEl) instNoticeEl.classList.add('hidden');
      if (btnInstallBypass) btnInstallBypass.classList.add('hidden');
      return;
    }

    if (instPathEl) {
      instPathEl.textContent = `${inst.name}: ${inst.modsDir}`;
    }

    if (inst.hasBypassMod) {
      if (instNoticeEl) instNoticeEl.classList.remove('hidden');
      if (btnInstallBypass) btnInstallBypass.classList.add('hidden');
    } else {
      if (instNoticeEl) instNoticeEl.classList.add('hidden');
      if (btnInstallBypass) {
        btnInstallBypass.classList.remove('hidden');
        btnInstallBypass.textContent = `⚡ 1-Klick Installation in "${inst.rawName || inst.name}"`;
        btnInstallBypass.onclick = async () => {
          btnInstallBypass.disabled = true;
          btnInstallBypass.textContent = '⏳ Installiere Bypass Fabric Check...';
          try {
            const resp = await fetch('/api/fabric/install-bypass', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ modsDir: inst.modsDir })
            });
            const data = await resp.json();
            if (data.success) {
              btnInstallBypass.classList.add('hidden');
              if (instNoticeEl) {
                instNoticeEl.textContent = '✅ "Bypass Fabric Check" wurde erfolgreich installiert! Starte Minecraft jetzt neu, lade deine Welt und öffne im LAN.';
                instNoticeEl.classList.remove('hidden');
              }
            } else {
              btnInstallBypass.disabled = false;
              btnInstallBypass.textContent = '❌ Fehler beim Installieren';
            }
          } catch (e) {
            btnInstallBypass.disabled = false;
            btnInstallBypass.textContent = '❌ Netzwerkfehler';
          }
        };
      }
    }
  };

  if (classification.detectedInstance) {
    renderInstanceDetails(classification.detectedInstance);
  } else {
    fetch('/api/fabric/instances')
      .then(r => r.json())
      .then(d => {
        if (d.success && d.bestMatch) {
          renderInstanceDetails(d.bestMatch);
        } else {
          renderInstanceDetails(null);
        }
      })
      .catch(() => renderInstanceDetails(null));
  }

  banner.classList.remove('hidden');

  const tabSettings = document.querySelector('button[data-tab="tab-settings"]');
  if (tabSettings && typeof tabSettings.click === 'function') {
    tabSettings.click();
    setTimeout(() => {
      banner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }
}
