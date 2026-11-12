/**
 * Prismarine Viewer, Multi-Monitor Popout, LAN Discovery & Tab Navigation Event Wiring
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { loadSettings } from '../onboardingWizard.js';
import { loadSchematicsList } from '../schematicUI.js';
import {
  isPoppedOut,
  initViewerController,
  onStateChange,
  toggleFullscreen,
  openPopout,
  reembed,
  focusPopout
} from '../viewerController.js';
import {
  probeViewerReachability,
  abortActiveProbe,
  isViewerOffline,
  isViewerStreamActive,
  applyViewerStreamEnabled,
  toggleViewerStream,
  renderDiscoveredLanWorlds
} from '../ui/botCamDiagnostics.js';
import {
  applyCameraDetachedState,
  refreshViewer
} from '../ui/telemetryBar.js';

export function setupViewerEvents() {
  // Navigation Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanes = document.querySelectorAll('.tab-pane');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const prevActiveBtn = document.querySelector('.tab-btn.active');
      const prevTab = prevActiveBtn?.dataset?.tab;
      const newTab = btn.dataset.tab;

      // Abort in-flight reachability probes when leaving viewer tab
      if (prevTab === 'tab-viewer' && newTab !== 'tab-viewer') {
        abortActiveProbe();
        const btnRetry = document.getElementById('btnRetryViewerConnection');
        if (btnRetry) {
          btnRetry.disabled = false;
          btnRetry.classList.remove('loading');
          btnRetry.textContent = '↺ Verbindung wiederholen';
        }
      }

      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(newTab);
      if (pane) pane.classList.add('active');

      // When switching to tab-viewer, probe reachability if offline without storming
      if (newTab === 'tab-viewer' && isViewerStreamActive() && !isPoppedOut()) {
        const offlinePlaceholder = document.getElementById('viewerOfflinePlaceholder');
        if (offlinePlaceholder && isViewerOffline()) {
          probeViewerReachability(false);
        }
      }

      if (newTab === 'tab-schematics') loadSchematicsList();
      if (newTab === 'tab-settings') loadSettings();
    });
  });

  // Reload Viewer
  const btnReloadViewer = document.getElementById('btnReloadViewer');
  if (btnReloadViewer) {
    btnReloadViewer.onclick = () => {
      refreshViewer(true);
    };
  }

  // Fullscreen & Multi-Monitor Popout Wiring
  initViewerController();
  onStateChange((poppedOut) => {
    applyCameraDetachedState(poppedOut);
  });

  const btnFullscreenViewer = document.getElementById('btnFullscreenViewer');
  const viewerWrapper = document.getElementById('viewerWrapper');
  if (btnFullscreenViewer && viewerWrapper) {
    btnFullscreenViewer.onclick = () => {
      toggleFullscreen(viewerWrapper);
    };
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', () => {
      const isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
      if (btnFullscreenViewer) {
        btnFullscreenViewer.innerHTML = isFs ? '🗗 Beenden' : '⛶ Vollbild';
        btnFullscreenViewer.title = isFs ? 'Vollbildmodus beenden (Esc)' : 'Vollbildmodus aktivieren';
      }
      if (viewerWrapper) {
        viewerWrapper.classList.toggle('is-fullscreen', isFs);
      }
    });
  }

  const btnPopoutViewer = document.getElementById('btnPopoutViewer');
  if (btnPopoutViewer) {
    btnPopoutViewer.onclick = () => {
      const port = document.getElementById('lblViewerPort')?.textContent || 3081;
      openPopout(port);
    };
  }

  const btnReembedViewer = document.getElementById('btnReembedViewer');
  if (btnReembedViewer) {
    btnReembedViewer.onclick = () => {
      reembed();
    };
  }

  const btnRefocusPopout = document.getElementById('btnRefocusPopout');
  if (btnRefocusPopout) {
    btnRefocusPopout.onclick = () => {
      focusPopout();
    };
  }

  const btnRetryViewer = document.getElementById('btnRetryViewerConnection');
  if (btnRetryViewer) {
    btnRetryViewer.onclick = () => {
      probeViewerReachability(true);
    };
  }

  const btnToggleViewerStreamOffline = document.getElementById('btnToggleViewerStreamOffline');
  if (btnToggleViewerStreamOffline) {
    btnToggleViewerStreamOffline.onclick = () => {
      toggleViewerStream();
    };
  }

  // Prismarine Viewer Stream Controls
  const btnToggleViewer = document.getElementById('btnToggleViewerStream');
  if (btnToggleViewer) {
    btnToggleViewer.onclick = () => toggleViewerStream();
  }

  const btnEnableViewer = document.getElementById('btnEnableViewerStream');
  if (btnEnableViewer) {
    btnEnableViewer.onclick = () => toggleViewerStream(true);
  }

  // Minecraft LAN-World Header Pill
  const pillLan = document.getElementById('pillLanDiscovered');
  if (pillLan) {
    const handleLanClick = () => {
      const tabSettings = document.querySelector('button[data-tab="tab-settings"]');
      if (tabSettings) {
        tabSettings.click();
      }
      const lanBox = document.getElementById('lanDiscoveryBox');
      if (lanBox) {
        lanBox.scrollIntoView({ behavior: 'smooth' });
      }
    };
    pillLan.onclick = handleLanClick;
    pillLan.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleLanClick();
      }
    };
  }

  // Initialer Viewer- & LAN-Statusabruf
  fetch('/api/viewer/status')
    .then(r => r.json())
    .then(data => {
      if (data && data.success) {
        applyViewerStreamEnabled(data.enabled, data.running, data.port);
      }
    })
    .catch(() => {});

  fetch('/api/lan/worlds')
    .then(r => r.json())
    .then(data => {
      if (data && data.success && Array.isArray(data.worlds)) {
        renderDiscoveredLanWorlds(data.worlds);
      }
    })
    .catch(() => {});
}
