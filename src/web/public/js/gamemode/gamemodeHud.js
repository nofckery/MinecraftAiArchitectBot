/**
 * HUD Overlay: Crosshair, Raycast Inspection, Vitals (Health & Food), Hotbar & Telemetry Updates.
 */

import { sendWS } from '../wsClient.js';
import { gamemodeCtx } from './gamemodeContext.js';
import { getItemIcon } from './itemIcons.js';
import { renderItemSlotContent, renderFullInventory } from './gamemodeInventory.js';
import { renderTabList } from './gamemodeTablist.js';

let exitGamemodeFn = () => {};
let showDigProgressFn = () => {};
let hideDigProgressFn = () => {};

export function setHudDependencies(deps) {
  if (deps.exitGamemode) exitGamemodeFn = deps.exitGamemode;
  if (deps.showDigProgress) showDigProgressFn = deps.showDigProgress;
  if (deps.hideDigProgress) hideDigProgressFn = deps.hideDigProgress;
}

export function renderHearts(health) {
  const elements = gamemodeCtx.elements;
  if (!elements.hudHeartsContainer) return;
  let html = '';
  const fullHearts = Math.floor(health / 2);
  const hasHalf = (health % 2) >= 1;
  for (let i = 0; i < 10; i++) {
    if (i < fullHearts) {
      html += '<span class="heart-icon full"><img class="mc-hud-icon" src="/img/mc/heart_full.png" alt="❤"></span>';
    } else if (i === fullHearts && hasHalf) {
      html += '<span class="heart-icon half"><img class="mc-hud-icon" src="/img/mc/heart_half.png" alt="❤"></span>';
    } else {
      html += '<span class="heart-icon empty"><img class="mc-hud-icon" src="/img/mc/heart_empty.png" alt="🖤"></span>';
    }
  }
  elements.hudHeartsContainer.innerHTML = html;
}

export function renderFood(food) {
  const elements = gamemodeCtx.elements;
  if (!elements.hudFoodContainer) return;
  let html = '';
  const full = Math.floor(food / 2);
  const hasHalf = (food % 2) >= 1;
  for (let i = 0; i < 10; i++) {
    if (i < full) {
      html += '<span class="food-icon full"><img class="mc-hud-icon" src="/img/mc/food_full.png" alt="🍗"></span>';
    } else if (i === full && hasHalf) {
      html += '<span class="food-icon half"><img class="mc-hud-icon" src="/img/mc/food_half.png" alt="🍗"></span>';
    } else {
      html += '<span class="food-icon empty"><img class="mc-hud-icon" src="/img/mc/food_empty.png" alt="🍗"></span>';
    }
  }
  elements.hudFoodContainer.innerHTML = html;
}

export function renderHotbar(hotbar, activeSlot) {
  gamemodeCtx.currentSelectedSlot = activeSlot;
  const elements = gamemodeCtx.elements;
  for (let i = 0; i < 9; i++) {
    const slotEl = document.getElementById(`hotbarSlot${i}`);
    if (!slotEl) continue;
    const item = hotbar[i];
    slotEl.classList.toggle('active', i === activeSlot);

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      renderItemSlotContent(slotEl, item, null);
    } else {
      const iconEl = slotEl.querySelector ? slotEl.querySelector('.slot-icon') : null;
      const countEl = slotEl.querySelector ? slotEl.querySelector('.slot-count') : null;
      if (item && item.name) {
        if (iconEl) iconEl.textContent = getItemIcon(item.name);
        if (countEl) countEl.textContent = item.count > 1 ? String(item.count) : '';
      } else {
        if (iconEl) iconEl.textContent = '';
        if (countEl) countEl.textContent = '';
      }
    }

    if (item && item.name) {
      slotEl.title = item.displayName || item.name;
    } else {
      slotEl.title = 'Leer';
    }
  }

  // Update selection frame position
  if (elements.hotbarSelectionFrame) {
    elements.hotbarSelectionFrame.style.left = `${activeSlot * 20}px`;
  }

  // Update HUD offhand slot
  if (elements.hudOffhandSlot) {
    const offhandItem = gamemodeCtx.lastFullInventory ? gamemodeCtx.lastFullInventory.offhand : null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      renderItemSlotContent(elements.hudOffhandSlot, offhandItem, '/img/mc/empty_armor_slot_shield.png');
    }
  }
}

export function renderRaycast(raycast) {
  gamemodeCtx.lastRaycastData = raycast;
  const elements = gamemodeCtx.elements;
  if (!elements.gamemodeRaycastTooltip) return;
  if (!raycast || raycast.type === 'none') {
    elements.gamemodeRaycastTooltip.classList.add('hidden');
    return;
  }

  elements.gamemodeRaycastTooltip.classList.remove('hidden');
  if (elements.raycastTargetType) {
    const label = raycast.type === 'entity' ? 'Entity' : 'Block';
    elements.raycastTargetType.textContent = `${label}: ${raycast.displayName || raycast.name}`;
  }
  if (elements.raycastTargetDistance) {
    const dist = typeof raycast.distance === 'number' ? raycast.distance.toFixed(1) : raycast.distance;
    elements.raycastTargetDistance.textContent = `${dist}m`;
  }
  if (elements.raycastTargetCoords && raycast.position) {
    const faceText = raycast.face !== undefined && raycast.face !== null ? ` [Face: ${raycast.face}]` : '';
    elements.raycastTargetCoords.textContent = `X: ${raycast.position.x} Y: ${raycast.position.y} Z: ${raycast.position.z}${faceText}`;
  }
}

/**
 * Select active hotbar slot index (0..8).
 * @param {number} slot
 */
export function selectHotbarSlot(slot) {
  if (slot < 0 || slot > 8) return;
  gamemodeCtx.currentSelectedSlot = slot;

  // Update UI selection outline
  for (let i = 0; i < 9; i++) {
    const el = document.getElementById(`hotbarSlot${i}`);
    if (el) el.classList.toggle('active', i === slot);
  }

  // Show Toast
  const item = gamemodeCtx.lastHotbarData[slot];
  if (gamemodeCtx.elements.hotbarSelectedItemLabel) {
    gamemodeCtx.elements.hotbarSelectedItemLabel.textContent = item?.displayName || (item?.name ? item.name.replace(/_/g, ' ') : '');
  }

  // Send WS action
  sendWS({
    type: 'manual_action',
    action: 'select_slot',
    slot
  });
}

/**
 * Telemetry Updates for HUD: health, food, coordinates, raycast, hotbar, inventory, angles.
 * @param {Object} msg
 */
export function handleTelemetryUpdate(msg) {
  if (!msg) return;
  const elements = gamemodeCtx.elements;

  // 1. Angle Synchronization (only when NOT actively pointer locked to prevent jerking)
  if (typeof msg.yaw === 'number' && typeof msg.pitch === 'number') {
    if (typeof document === 'undefined' || !document.pointerLockElement) {
      gamemodeCtx.currentYaw = msg.yaw;
      gamemodeCtx.currentPitch = msg.pitch;
    }
  }

  // 2. Coordinates
  if (elements.gamemodeCoordinates && msg.pos) {
    const x = typeof msg.pos.x === 'number' ? msg.pos.x.toFixed(1) : msg.pos.x;
    const y = typeof msg.pos.y === 'number' ? msg.pos.y.toFixed(1) : msg.pos.y;
    const z = typeof msg.pos.z === 'number' ? msg.pos.z.toFixed(1) : msg.pos.z;
    elements.gamemodeCoordinates.textContent = `X: ${x} Y: ${y} Z: ${z}`;
  }

  // 3. Vitals (Health & Food)
  if (msg.health !== undefined && elements.hudHealthValue) {
    elements.hudHealthValue.textContent = `${Math.round(msg.health)} / 20`;
    renderHearts(msg.health);

    // Death detection
    if (msg.health <= 0) {
      if (elements.gamemodeDeathScreen) {
        elements.gamemodeDeathScreen.classList.remove('hidden');
      }
      if (typeof document !== 'undefined' && document.pointerLockElement) {
        try { document.exitPointerLock(); } catch {}
      }
    } else if (elements.gamemodeDeathScreen && !elements.gamemodeDeathScreen.classList.contains('hidden')) {
      elements.gamemodeDeathScreen.classList.add('hidden');
    }
  }

  if (msg.food !== undefined && elements.hudFoodValue) {
    elements.hudFoodValue.textContent = `${Math.round(msg.food)} / 20`;
    renderFood(msg.food);
  }

  // 4. Hotbar
  if (Array.isArray(msg.hotbar)) {
    gamemodeCtx.lastHotbarData = msg.hotbar;
    const activeSlot = (msg.manualControl && msg.manualControl.selectedSlot !== undefined)
      ? msg.manualControl.selectedSlot
      : gamemodeCtx.currentSelectedSlot;
    renderHotbar(msg.hotbar, activeSlot);
  }

  // 5. Full Player & Container Inventory
  if (msg.fullInventory) {
    gamemodeCtx.lastFullInventory = msg.fullInventory;
    if (gamemodeCtx.isInventoryOpen) {
      renderFullInventory(msg.fullInventory);
    }
  }

  // 6. Raycast Inspection
  if (msg.raycast) {
    gamemodeCtx.lastRaycastData = msg.raycast;
    renderRaycast(msg.raycast);
  }

  // 7. Live Digging Telemetry Sync
  if (msg.manualControl) {
    if (msg.manualControl.isDigging && typeof msg.manualControl.digProgress === 'number') {
      const pct = Math.round(msg.manualControl.digProgress * 100);
      showDigProgressFn(pct, `Abbau: ${gamemodeCtx.lastRaycastData?.displayName || gamemodeCtx.lastRaycastData?.name || 'Block'}`);
    } else if (!gamemodeCtx.isLeftMouseDown) {
      hideDigProgressFn();
    }
  }

  // 8. Player Tablist Data
  if (Array.isArray(msg.players)) {
    gamemodeCtx.lastPlayersList = msg.players;
  }
  if (msg.tablist) {
    gamemodeCtx.lastTablistData = msg.tablist;
  }
  if (gamemodeCtx.isTabListVisible) {
    renderTabList(gamemodeCtx.lastPlayersList, gamemodeCtx.lastTablistData);
  }
}

/**
 * Handle server-broadcast `manual_control_state`.
 * @param {Object} msg
 */
export function handleGamemodeState(msg) {
  if (!msg) return;
  if (msg.active === false && gamemodeCtx.isGamemodeActive) {
    exitGamemodeFn('server_revoked');
  }
  if (msg.selectedSlot !== undefined) {
    gamemodeCtx.currentSelectedSlot = msg.selectedSlot;
    for (let i = 0; i < 9; i++) {
      const el = document.getElementById(`hotbarSlot${i}`);
      if (el) el.classList.toggle('active', i === gamemodeCtx.currentSelectedSlot);
    }
  }
}
