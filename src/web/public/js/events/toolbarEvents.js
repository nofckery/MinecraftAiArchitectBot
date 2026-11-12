/**
 * CAD Toolbar, Brush Controls, Transforms, Chat Form & Action Buttons
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { sendWS } from '../wsClient.js';
import {
  renderTerrainXray,
  setXrayActive,
  clearSelectionBox,
  setActiveTool,
  setBrushSize,
  setRenderMode,
  setViewTop,
  setViewIso,
  resetFocus,
  applyYSlice,
  applyDualYSlice,
  applyTheme,
  getCurrentSelectionBox
} from '../threeViewport.js';
import {
  getCurrentHandoffState,
  updateBotPowerUI,
  toggleBotPower,
  showDashboardToast
} from '../ui/telemetryBar.js';
import { renderKickDiagnostic } from '../ui/botCamDiagnostics.js';

let isXrayActive = false;

export function setupToolbarEvents() {
  // CAD Tools
  const toolOrbit = document.getElementById('toolOrbit');
  const toolSelectBox = document.getElementById('toolSelectBox');
  const toolBrush = document.getElementById('toolBrush');
  const toolEraser = document.getElementById('toolEraser');
  const toolEyedropper = document.getElementById('toolEyedropper');

  if (toolOrbit) toolOrbit.onclick = () => setActiveTool('orbit');
  if (toolSelectBox) toolSelectBox.onclick = () => setActiveTool('selectBox');
  if (toolBrush) toolBrush.onclick = () => setActiveTool('brush');
  if (toolEraser) toolEraser.onclick = () => setActiveTool('eraser');
  if (toolEyedropper) toolEyedropper.onclick = () => setActiveTool('eyedropper');

  // Render Mode Selector (100% Minecraft Texturen vs CAD vs Wireframe)
  const btnModeTextures = document.getElementById('btnModeTextures');
  const btnModeHologram = document.getElementById('btnModeHologram');
  const btnModeWireframe = document.getElementById('btnModeWireframe');
  const renderModeItems = [
    { btn: btnModeTextures, mode: 'textures' },
    { btn: btnModeHologram, mode: 'cad' },
    { btn: btnModeWireframe, mode: 'wireframe' }
  ];
  renderModeItems.forEach(({ btn, mode }) => {
    if (btn) {
      btn.onclick = () => {
        renderModeItems.forEach(item => item.btn?.classList.remove('active'));
        btn.classList.add('active');
        setRenderMode(mode);
      };
    }
  });

  // Brush Size Toggle (1x, 2x, 3x)
  const btnBrush1x = document.getElementById('btnBrush1x');
  const btnBrush2x = document.getElementById('btnBrush2x');
  const btnBrush3x = document.getElementById('btnBrush3x');
  const brushSizeBtns = [btnBrush1x, btnBrush2x, btnBrush3x];
  brushSizeBtns.forEach((btn, idx) => {
    if (btn) {
      btn.onclick = () => {
        brushSizeBtns.forEach(b => b?.classList.remove('active'));
        btn.classList.add('active');
        setBrushSize(idx + 1);
      };
    }
  });

  // Camera View Presets
  const btnViewIso = document.getElementById('btnViewIso');
  const btnViewTop = document.getElementById('btnViewTop');
  const btnViewFocus = document.getElementById('btnViewFocus');
  if (btnViewIso) btnViewIso.onclick = () => setViewIso();
  if (btnViewTop) btnViewTop.onclick = () => setViewTop();
  if (btnViewFocus) btnViewFocus.onclick = () => resetFocus();

  // Quick Swatches
  const txtBrushBlock = document.getElementById('txtBrushBlock');
  document.querySelectorAll('.swatch-btn').forEach(btn => {
    btn.onclick = () => {
      const b = btn.dataset.block;
      if (b && txtBrushBlock) {
        txtBrushBlock.value = b;
        setActiveTool('brush');
      }
    };
  });

  // CAD Transforms
  const btnMirrorX = document.getElementById('btnMirrorX');
  const btnMirrorZ = document.getElementById('btnMirrorZ');
  const btnRotate90 = document.getElementById('btnRotate90');
  const btnShiftYUp = document.getElementById('btnShiftYUp');
  const btnShiftYDown = document.getElementById('btnShiftYDown');

  if (btnMirrorX) btnMirrorX.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_x' });
  if (btnMirrorZ) btnMirrorZ.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_z' });
  if (btnRotate90) btnRotate90.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'rotate_90_cw' });
  if (btnShiftYUp) btnShiftYUp.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_up' });
  if (btnShiftYDown) btnShiftYDown.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_down' });

  // X-Ray Toggle
  const btnToggleXray = document.getElementById('btnToggleXray');
  if (btnToggleXray) {
    btnToggleXray.onclick = () => {
      isXrayActive = !isXrayActive;
      setXrayActive(isXrayActive);
      btnToggleXray.classList.toggle('active', isXrayActive);
      if (isXrayActive) {
        sendWS({ type: 'request_terrain_xray' });
      } else {
        renderTerrainXray([]);
      }
    };
  }

  // Quick Themes
  const btnThemeMedieval = document.getElementById('btnThemeMedieval');
  const btnThemeGothic = document.getElementById('btnThemeGothic');
  const btnThemeDesert = document.getElementById('btnThemeDesert');
  const btnThemeCherry = document.getElementById('btnThemeCherry');

  if (btnThemeMedieval) btnThemeMedieval.onclick = () => applyTheme('medieval_spruce', sendWS);
  if (btnThemeGothic) btnThemeGothic.onclick = () => applyTheme('deepslate_gothic', sendWS);
  if (btnThemeDesert) btnThemeDesert.onclick = () => applyTheme('desert_sandstone', sendWS);
  if (btnThemeCherry) btnThemeCherry.onclick = () => applyTheme('cherry_asian', sendWS);

  const btnClearSelectionBox = document.getElementById('btnClearSelectionBox');
  if (btnClearSelectionBox) btnClearSelectionBox.onclick = clearSelectionBox;

  // Selection Box Fill & Clear Actions
  const btnFillSelection = document.getElementById('btnFillSelection');
  const btnClearSelection = document.getElementById('btnClearSelection');
  if (btnFillSelection) {
    btnFillSelection.onclick = () => {
      const box = getCurrentSelectionBox();
      if (!box) return;
      const blockString = (txtBrushBlock?.value || 'stone_bricks').trim();
      sendWS({
        type: 'fill_selection',
        selectionBox: box,
        blockString
      });
    };
  }
  if (btnClearSelection) {
    btnClearSelection.onclick = () => {
      const box = getCurrentSelectionBox();
      if (!box) return;
      sendWS({
        type: 'clear_selection',
        selectionBox: box
      });
    };
  }

  // Y-Slice Slider & Stepper Controls
  const ySliceSlider = document.getElementById('ySliceSlider');
  const ySliceValue = document.getElementById('ySliceValue');
  const btnSliceDown = document.getElementById('btnSliceDown');
  const btnSliceUp = document.getElementById('btnSliceUp');
  const btnResetSlicer = document.getElementById('btnResetSlicer');

  if (ySliceSlider && ySliceValue) {
    ySliceSlider.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      ySliceValue.textContent = `Schnitt-Höhe Y: ${val} / ${ySliceSlider.max}`;
      applyYSlice(val);
    });
  }

  if (btnSliceDown && ySliceSlider && ySliceValue) {
    btnSliceDown.onclick = () => {
      const cur = parseInt(ySliceSlider.value, 10);
      const next = Math.max(1, cur - 1);
      ySliceSlider.value = next;
      ySliceValue.textContent = `Schnitt-Höhe Y: ${next} / ${ySliceSlider.max}`;
      applyYSlice(next);
    };
  }

  if (btnSliceUp && ySliceSlider && ySliceValue) {
    btnSliceUp.onclick = () => {
      const cur = parseInt(ySliceSlider.value, 10);
      const next = Math.min(parseInt(ySliceSlider.max, 10), cur + 1);
      ySliceSlider.value = next;
      ySliceValue.textContent = `Schnitt-Höhe Y: ${next} / ${ySliceSlider.max}`;
      applyYSlice(next);
    };
  }

  if (btnResetSlicer && ySliceSlider && ySliceValue) {
    btnResetSlicer.onclick = () => {
      ySliceSlider.value = ySliceSlider.max;
      ySliceValue.textContent = `Schnitt-Höhe Y: 1 bis Max (${ySliceSlider.max})`;
      applyYSlice(parseInt(ySliceSlider.max, 10));
    };
  }

  // Single-Layer Y-Slicer Checkbox
  const chkSingleLayerSlice = document.getElementById('chkSingleLayerSlice');
  if (chkSingleLayerSlice && ySliceSlider) {
    chkSingleLayerSlice.onchange = () => {
      const maxVal = parseInt(ySliceSlider.value, 10);
      applyDualYSlice(1, maxVal, Boolean(chkSingleLayerSlice.checked));
    };
    ySliceSlider.addEventListener('input', (e) => {
      const maxVal = parseInt(e.target.value, 10);
      applyDualYSlice(1, maxVal, Boolean(chkSingleLayerSlice.checked));
    });
  }

  // Chat Form & Prompt submission
  const chatForm = document.getElementById('chatForm');
  const txtPrompt = document.getElementById('txtPrompt');
  const chkAutoExecute = document.getElementById('chkAutoExecute');
  if (chatForm && txtPrompt) {
    chatForm.onsubmit = (e) => {
      e.preventDefault();
      const prompt = txtPrompt.value.trim();
      if (!prompt) return;

      const selBox = getCurrentSelectionBox();
      if (selBox) {
        sendWS({
          type: 'region_ai_edit',
          instruction: prompt,
          selectionBox: selBox
        });
        clearSelectionBox();
      } else {
        sendWS({
          type: 'prompt_architect',
          text: prompt,
          autoExecute: chkAutoExecute?.checked
        });
      }
      txtPrompt.value = '';
      showDashboardToast(`⚡ Befehl übermittelt: ${prompt}`, 'command');
    };
  }

  // Interactive Bot Command Deck (1-Click Missions & Actions)
  document.querySelectorAll('.btn-bot-command').forEach(btn => {
    btn.onclick = () => {
      const command = (btn.dataset.command || '').trim();
      const instant = btn.dataset.instant === 'true';
      const label = btn.textContent.trim();

      // Visual click feedback
      btn.classList.add('command-active');
      setTimeout(() => btn.classList.remove('command-active'), 400);

      if (txtPrompt) txtPrompt.value = command;

      if (instant && command) {
        if (command === '!stop') {
          sendWS({ type: 'control_action', action: 'stop' });
          showDashboardToast('🛑 Universal-Not-Stopp ausgeführt!', 'danger');
        } else {
          sendWS({
            type: 'prompt_architect',
            text: command,
            autoExecute: true
          });
          showDashboardToast(`⚡ Ausgeführt: ${label}`, 'command');
        }
      } else if (txtPrompt) {
        txtPrompt.focus();
        showDashboardToast(`Befehl geladen: ${label}`, 'info');
      }
    };
  });

  // Quick Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      if (txtPrompt) {
        txtPrompt.value = chip.dataset.prompt;
        txtPrompt.focus();
        showDashboardToast(`Vorlage übernommen: ${chip.textContent.trim()}`, 'info', 2000);
      }
    };
  });

  // Action Buttons
  const btnConfirmBuild = document.getElementById('btnConfirmBuild');
  const btnUndoBuild = document.getElementById('btnUndoBuild');
  const btnStopBuild = document.getElementById('btnStopBuild');
  const btnExportSchem = document.getElementById('btnExportSchem');

  if (btnConfirmBuild) {
    btnConfirmBuild.onclick = () => {
      sendWS({ type: 'confirm_build' });
      showDashboardToast('🔨 Bauauftrag in Minecraft-Welt gestartet!', 'success');
    };
  }
  if (btnUndoBuild) {
    btnUndoBuild.onclick = () => {
      sendWS({ type: 'control_action', action: 'undo' });
      showDashboardToast('↩ Rollback des letzten Bauwerks gestartet...', 'warning');
    };
  }
  if (btnStopBuild) {
    btnStopBuild.onclick = () => {
      sendWS({ type: 'control_action', action: 'stop' });
      showDashboardToast('⛔ Universal-Not-Stopp ausgeführt!', 'danger');
    };
  }

  if (btnExportSchem) {
    btnExportSchem.onclick = () => {
      const rawChoice = window.prompt('Dateiname für Export eingeben (.schem für Sponge/WorldEdit oder .nbt für Vanilla Structure Block):', `architect_${Date.now()}.schem`);
      if (rawChoice) {
        const trimmed = rawChoice.trim();
        const isNbt = trimmed.toLowerCase().endsWith('.nbt');
        const format = isNbt ? 'nbt' : 'schem';
        const cleanName = trimmed.replace(/\.(schem|nbt)$/i, '');
        window.open(`/api/schematics/export/${encodeURIComponent(cleanName)}?format=${format}`);
      }
    };
  }

  // Handoff & Night Disconnect Toggle
  const btnToggleHandoff = document.getElementById('btnToggleHandoff');
  if (btnToggleHandoff) {
    btnToggleHandoff.onclick = () => {
      const state = getCurrentHandoffState();
      const isPaused = state === 'PAUSED_OWNER_INGAME' || state === 'PAUSED_SLEEP_NIGHT';
      sendWS({
        type: 'control_action',
        action: isPaused ? 'resume_bot' : 'pause_for_player'
      });
    };
  }

  const toggleNight = document.getElementById('toggleNightDisconnect');
  if (toggleNight) {
    toggleNight.onchange = (e) => {
      const enabled = Boolean(e.target.checked);
      const lbl = document.getElementById('lblNightDisconnectStatus');
      if (lbl) lbl.textContent = enabled ? 'Aktiv (Nacht-Skip)' : 'Aus (bleibt auf Server)';
      const cfgSleep = document.getElementById('cfgSleepDisconnect');
      if (cfgSleep) cfgSleep.checked = enabled;
      sendWS({
        type: 'toggle_sleep_disconnect',
        enabled
      });
    };
  }

  // Master & Sidebar Bot Power
  const btnMaster = document.getElementById('btnMasterBotControl');
  if (btnMaster) btnMaster.onclick = toggleBotPower;

  const btnSidebarPower = document.getElementById('btnSidebarBotPower');
  if (btnSidebarPower) btnSidebarPower.onclick = toggleBotPower;

  // Fabric Mod-Mismatch Diagnostic Banner Events
  const btnDismissDiag = document.getElementById('btnDismissFabricDiag');
  if (btnDismissDiag) {
    btnDismissDiag.onclick = () => {
      const banner = document.getElementById('botKickDiagnosticBanner');
      if (banner) banner.classList.add('hidden');
    };
  }

  const btnRetryFabric = document.getElementById('btnRetryFabricConnect');
  if (btnRetryFabric) {
    btnRetryFabric.onclick = async () => {
      btnRetryFabric.disabled = true;
      btnRetryFabric.textContent = '⏳ Verbinde...';
      try {
        await fetch('/api/bot/start', { method: 'POST' });
      } catch {}
      setTimeout(() => {
        btnRetryFabric.disabled = false;
        btnRetryFabric.textContent = '🔄 Erneut verbinden';
      }, 3000);
    };
  }

  // Initialer Status-Abruf für Bot-Power-Zustand & Diagnose
  fetch('/api/status').then(r => r.json()).then(data => {
    if (data) {
      updateBotPowerUI(data.status, data.botRunning, data.botConnected);
      if (data.lastKickClassification) {
        renderKickDiagnostic(data.lastKickClassification);
      }
    }
  }).catch(() => {});
}
