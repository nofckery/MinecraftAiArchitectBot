/**
 * CAD UI: Bill of Materials (BOM), Material Swap Modal, Themes, and Verifier Overlays.
 */

import { sendWS } from '../wsClient.js';
import { threeCtx } from './threeContext.js';
import {
  getVerifierReport,
  isVerifierOverlayEnabled,
  setVerifierOverlayEnabled
} from '../sceneGraph.js';
import { disposeGroupChildren } from './threeStudioTerrain.js';

export function renderBOM(bom, containerEl = null) {
  const bomListContainer = containerEl || document.getElementById('bomListContainer');
  if (!bomListContainer) return;
  bomListContainer.innerHTML = '';
  const entries = Object.entries(bom || {}).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    bomListContainer.innerHTML = '<span class="empty-hint">Kein Bauplan aktiv.</span>';
    return;
  }

  for (const [name, count] of entries) {
    const row = document.createElement('div');
    row.className = 'bom-row';

    const left = document.createElement('div');
    left.className = 'bom-row-left';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'bom-name';
    nameSpan.textContent = name;

    const countSpan = document.createElement('span');
    countSpan.className = 'bom-count';
    countSpan.textContent = `${count}x`;

    left.appendChild(countSpan);
    left.appendChild(nameSpan);

    const swapBtn = document.createElement('button');
    swapBtn.className = 'btn-swap';
    swapBtn.textContent = '⇄ Tauschen';
    swapBtn.type = 'button';
    swapBtn.onclick = () => openSwapModal(name);

    row.appendChild(left);
    row.appendChild(swapBtn);
    bomListContainer.appendChild(row);
  }
}

export function openSwapModal(fromBlock) {
  const modal = document.createElement('div');
  modal.className = 'swap-dialog-modal';

  const card = document.createElement('div');
  card.className = 'swap-dialog-card';

  card.innerHTML = `
    <div class="swap-dialog-title">Material austauschen: <strong>${fromBlock}</strong></div>
    <label class="control-label">Neuer Blockname:</label>
    <input type="text" id="modalSwapTarget" class="swap-dialog-input" placeholder="z. B. dark_oak_stairs..." value="${fromBlock}">
    <label class="checkbox-container mt-1">
      <input type="checkbox" id="modalSmartGroup" checked>
      <span class="checkmark"></span>
      Ganze Holz-/Steingruppe automatisch mittauschen
    </label>
    <div class="swap-dialog-actions">
      <button id="modalBtnCancel" class="btn btn-secondary btn-sm" type="button">Abbrechen</button>
      <button id="modalBtnApply" class="btn btn-primary btn-sm" type="button">Anwenden</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const inputTarget = card.querySelector('#modalSwapTarget');
  const chkSmart = card.querySelector('#modalSmartGroup');
  const btnCancel = card.querySelector('#modalBtnCancel');
  const btnApply = card.querySelector('#modalBtnApply');

  inputTarget?.focus();
  inputTarget?.select();

  btnCancel.onclick = () => document.body.removeChild(modal);
  btnApply.onclick = () => {
    const toBlock = inputTarget.value.trim();
    if (toBlock && toBlock !== fromBlock) {
      sendWS({
        type: 'swap_material',
        fromBlock,
        toBlock,
        smartGroupSwap: chkSmart.checked
      });
    }
    document.body.removeChild(modal);
  };
}

export function applyTheme(themeKey, sendWsFn = null) {
  const sender = sendWsFn || sendWS;
  sender({ type: 'apply_theme', theme: themeKey });
}

/**
 * Renders Litematica-Style Verifier Overlays:
 * - Red (0xef4444): Collision with terrain or other object
 * - Yellow (0xf59e0b): Floating foundation gap
 * - Green (0x10b981): Solid foundation contact
 * - Pink (0xec4899): Interior obstacle to clear via Auto-Terraforming
 */
export function renderVerifierOverlay(report = null) {
  if (!threeCtx.scene || !threeCtx.verifierGroup || typeof THREE === 'undefined') return;
  disposeGroupChildren(threeCtx.verifierGroup);

  const activeReport = report || getVerifierReport();
  if (!activeReport || !isVerifierOverlayEnabled() || !Array.isArray(activeReport.verifierBlocks)) {
    return;
  }

  const vBlocks = activeReport.verifierBlocks;
  if (vBlocks.length === 0) return;

  const geom = new THREE.BoxGeometry(1.03, 1.03, 1.03);
  const colors = {
    collision: 0xef4444,      // Red
    foundation_gap: 0xf59e0b, // Yellow
    solid_support: 0x10b981,  // Green
    obstacle_air: 0xec4899    // Pink
  };

  const buckets = new Map();
  for (const vb of vBlocks) {
    const st = vb.status || 'collision';
    let arr = buckets.get(st);
    if (!arr) {
      arr = [];
      buckets.set(st, arr);
    }
    arr.push(vb);
  }

  const dummy = new THREE.Object3D();
  for (const [status, list] of buckets.entries()) {
    const color = colors[status] || 0xef4444;
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: status === 'solid_support' ? 0.28 : 0.52,
      depthWrite: false
    });
    const inst = new THREE.InstancedMesh(geom, mat, list.length);
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
    threeCtx.verifierGroup.add(inst);
  }
}

export function setVerifierOverlayVisible(visible = true) {
  setVerifierOverlayEnabled(Boolean(visible));
  if (threeCtx.verifierGroup) {
    threeCtx.verifierGroup.visible = Boolean(visible);
  }
  if (visible) {
    renderVerifierOverlay();
  }
}
