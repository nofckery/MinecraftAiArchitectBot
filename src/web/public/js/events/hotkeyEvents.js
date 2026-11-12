/**
 * Global Keyboard Shortcuts & Clipboard Handlers
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { setActiveTool } from '../threeViewport.js';
import { undoSceneAction, redoSceneAction } from '../sceneGraph.js';
import { closeOnboardingModal } from '../onboardingWizard.js';
import { closeModelSettingsModal, closeEndpointDrawer, cancelDeviceFlow } from '../modelCockpit.js';
import { isGamemode, exitGamemode } from '../manualCockpit.js';
import { toggleCadStudioFullscreen } from '../studio/cadStudioController.js';

export function setupHotkeyEvents() {
  if (typeof window === 'undefined') return;

  // Global Keyboard Shortcuts (B, E, I, O, S, F, G, M, Ctrl+Z, Ctrl+Y)
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.isComposing || e.keyCode === 229) return;

    const activeEl = document.activeElement;
    const targetEl = e.target;
    const tag = (activeEl?.tagName || targetEl?.tagName || '').toLowerCase();
    const isFormOrEditable =
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select' ||
      activeEl?.isContentEditable ||
      activeEl?.getAttribute?.('contenteditable') === 'true' ||
      targetEl?.isContentEditable ||
      targetEl?.getAttribute?.('contenteditable') === 'true' ||
      (typeof targetEl?.closest === 'function' && targetEl.closest('[contenteditable="true"]'));
    if (isFormOrEditable) {
      return;
    }

    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undoSceneAction();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redoSceneAction();
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) {
      return;
    }

    if (typeof isGamemode === 'function' && isGamemode()) {
      return;
    }

    const key = e.key ? e.key.toLowerCase() : '';
    if (key === 'b') setActiveTool('brush');
    else if (key === 'e') setActiveTool('eraser');
    else if (key === 'i') setActiveTool('eyedropper');
    else if (key === 'o') setActiveTool('orbit');
    else if (key === 's') setActiveTool('selectBox');
    else if (key === 'g') setActiveTool('gizmoMove');
    else if (key === 'r') setActiveTool('gizmoRotate');
    else if (key === 'm') setActiveTool('measure');
    else if (key === 'f') {
      e.preventDefault();
      toggleCadStudioFullscreen();
    }
  });

  // Global ESC Key Handler
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const onboardModal = document.getElementById('onboardingModal');
      if (onboardModal && !onboardModal.classList.contains('hidden')) {
        closeOnboardingModal();
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
      const cadCol = document.getElementById('cadStudioColumn') || document.getElementById('panelCadStudio') || document.getElementById('columnCadStudio');
      if (cadCol && cadCol.classList.contains('cad-studio-fullscreen')) {
        toggleCadStudioFullscreen(false);
        return;
      }
      if (typeof isGamemode === 'function' && isGamemode()) {
        exitGamemode('esc_key');
        return;
      }
    }
  });

  // 1-Click Clipboard copying
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
}
