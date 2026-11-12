/**
 * First-Person Input & Movement Handling, Mouse Look, Mining Loops, and Pause Menu.
 */

import { sendWS } from '../wsClient.js';
import { gamemodeCtx } from './gamemodeContext.js';
import { openChat, closeChat } from './gamemodeChat.js';
import { openInventory, closeInventory, toggleInventory } from './gamemodeInventory.js';
import { showTabList, hideTabList } from './gamemodeTablist.js';
import { selectHotbarSlot } from './gamemodeHud.js';

let exitGamemodeFn = () => {};

export function setInputDependencies(deps) {
  if (deps.exitGamemode) exitGamemodeFn = deps.exitGamemode;
}

/**
 * Request pointer lock on the input capture layer.
 */
export function requestPointerLock() {
  if (gamemodeCtx.isChatOpen || gamemodeCtx.isInventoryOpen || gamemodeCtx.isPauseMenuOpen || gamemodeCtx.isHelpOpen) return;
  const captureEl = gamemodeCtx.elements.gamemodeInputCapture;
  if (captureEl && captureEl.requestPointerLock) {
    try {
      captureEl.requestPointerLock();
    } catch {
      // Browser rejected or secure context constraint
    }
  }
}

export function onPointerLockChange() {
  if (typeof document === 'undefined') return;
  const isLocked = (document.pointerLockElement === gamemodeCtx.elements.gamemodeInputCapture);
  if (isLocked) {
    if (gamemodeCtx.elements.gamemodeLockBanner) gamemodeCtx.elements.gamemodeLockBanner.classList.add('hidden');
  } else {
    // If pointer lock lost while gamemode still active and no menu is open -> show banner
    if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen && !gamemodeCtx.isPauseMenuOpen && !gamemodeCtx.isHelpOpen) {
      clearAllControls('pointer_lock_lost');
      if (gamemodeCtx.elements.gamemodeLockBanner) gamemodeCtx.elements.gamemodeLockBanner.classList.remove('hidden');
    }
  }
}

export function onPointerLockError() {
  if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen && !gamemodeCtx.isPauseMenuOpen && !gamemodeCtx.isHelpOpen && gamemodeCtx.elements.gamemodeLockBanner) {
    gamemodeCtx.elements.gamemodeLockBanner.classList.remove('hidden');
  }
}

export function openGamemodeHelp() {
  if (!gamemodeCtx.isGamemodeActive) return;
  gamemodeCtx.isHelpOpen = true;
  if (gamemodeCtx.elements.gamemodeHelpOverlay) {
    gamemodeCtx.elements.gamemodeHelpOverlay.classList.remove('hidden');
  }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControls('help_overlay_opened');
}

export function closeGamemodeHelp() {
  gamemodeCtx.isHelpOpen = false;
  if (gamemodeCtx.elements.gamemodeHelpOverlay) {
    gamemodeCtx.elements.gamemodeHelpOverlay.classList.add('hidden');
  }
  if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen && !gamemodeCtx.isPauseMenuOpen) {
    requestPointerLock();
  }
}

export function toggleGamemodeHelp() {
  if (gamemodeCtx.isHelpOpen) {
    closeGamemodeHelp();
  } else {
    if (gamemodeCtx.isChatOpen) closeChat();
    if (gamemodeCtx.isInventoryOpen) closeInventory();
    if (gamemodeCtx.isPauseMenuOpen) closePauseMenu();
    openGamemodeHelp();
  }
}

export function onFullscreenChange() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement && gamemodeCtx.isGamemodeActive) {
    // Gracefully exit gamemode on fullscreen escape
    exitGamemodeFn('fullscreen_exit');
  }
}

export function openPauseMenu() {
  if (!gamemodeCtx.isGamemodeActive) return;
  gamemodeCtx.isPauseMenuOpen = true;
  if (gamemodeCtx.elements.gamemodePauseMenu) {
    gamemodeCtx.elements.gamemodePauseMenu.classList.remove('hidden');
  }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControls('pause_menu_opened');
}

export function closePauseMenu() {
  gamemodeCtx.isPauseMenuOpen = false;
  if (gamemodeCtx.elements.gamemodePauseMenu) {
    gamemodeCtx.elements.gamemodePauseMenu.classList.add('hidden');
  }
  if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen) {
    requestPointerLock();
  }
}

export function dispatchMovementState() {
  sendWS({
    type: 'manual_movement',
    state: { ...gamemodeCtx.movementState }
  });
}

/**
 * Stuck-Key Protection: Clears all movement states and halts digging.
 * @param {string} [reason='unspecified']
 */
export function clearAllControls(reason = 'unspecified') {
  hideTabList();
  let wasMoving = false;
  for (const k in gamemodeCtx.movementState) {
    if (gamemodeCtx.movementState[k]) wasMoving = true;
    gamemodeCtx.movementState[k] = false;
  }

  gamemodeCtx.isLeftMouseDown = false;
  gamemodeCtx.isRightMouseDown = false;
  if (gamemodeCtx.continuousMiningInterval) {
    clearInterval(gamemodeCtx.continuousMiningInterval);
    gamemodeCtx.continuousMiningInterval = null;
  }
  if (gamemodeCtx.continuousPlaceInterval) {
    clearInterval(gamemodeCtx.continuousPlaceInterval);
    gamemodeCtx.continuousPlaceInterval = null;
  }
  gamemodeCtx.currentMiningBlockKey = null;
  hideDigProgress();

  sendWS({ type: 'clear_movement' });

  if (wasMoving) {
    sendWS({
      type: 'manual_movement',
      state: { ...gamemodeCtx.movementState }
    });
  }

  // Also stop any ongoing digging & item use
  sendWS({ type: 'manual_action', action: 'dig_stop' });
  sendWS({ type: 'manual_action', action: 'use_item_stop' });
}

export function showDigProgress(percent, label = '') {
  const elements = gamemodeCtx.elements;
  if (!elements.gamemodeDigProgress && typeof document !== 'undefined' && typeof document.createElement === 'function') {
    const parent = elements.gamemodeCrosshair?.parentElement || elements.gamemodeHudOverlay;
    if (parent && typeof parent.appendChild === 'function') {
      const el = document.createElement('div');
      el.id = 'gamemodeDigProgress';
      el.className = 'gamemode-dig-progress';
      el.innerHTML = '<div class="dig-progress-bar"><div id="digProgressFill" class="dig-progress-fill" style="width:0%"></div></div><span id="digProgressText" class="dig-progress-text">0%</span>';
      parent.appendChild(el);
      elements.gamemodeDigProgress = el;
      elements.digProgressFill = el.querySelector ? el.querySelector('#digProgressFill') : null;
      elements.digProgressText = el.querySelector ? el.querySelector('#digProgressText') : null;
    }
  }
  if (elements.gamemodeDigProgress && elements.gamemodeDigProgress.classList) {
    elements.gamemodeDigProgress.classList.remove('hidden');
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (elements.digProgressFill) elements.digProgressFill.style.width = `${clamped}%`;
    if (elements.digProgressText) elements.digProgressText.textContent = label ? `${label} (${clamped}%)` : `${clamped}%`;
  }
}

export function hideDigProgress() {
  const elements = gamemodeCtx.elements;
  if (elements.gamemodeDigProgress && elements.gamemodeDigProgress.classList) {
    elements.gamemodeDigProgress.classList.add('hidden');
    if (elements.digProgressFill) elements.digProgressFill.style.width = '0%';
    if (elements.digProgressText) elements.digProgressText.textContent = '0%';
  }
}

/**
 * Mouse & Look Handling
 */
export function onMouseMove(e) {
  if (!gamemodeCtx.isGamemodeActive) return;
  if (typeof document !== 'undefined' && document.pointerLockElement !== gamemodeCtx.elements.gamemodeInputCapture) return;

  gamemodeCtx.accumulatedDeltaX += e.movementX;
  gamemodeCtx.accumulatedDeltaY += e.movementY;

  if (!gamemodeCtx.lookAnimationFrame && typeof requestAnimationFrame !== 'undefined') {
    gamemodeCtx.lookAnimationFrame = requestAnimationFrame(flushLookDeltas);
  }
}

export function flushLookDeltas() {
  gamemodeCtx.lookAnimationFrame = null;
  if (gamemodeCtx.accumulatedDeltaX === 0 && gamemodeCtx.accumulatedDeltaY === 0) return;

  const SENSITIVITY = 0.0022 * gamemodeCtx.mouseSensitivityMultiplier;
  gamemodeCtx.currentYaw -= gamemodeCtx.accumulatedDeltaX * SENSITIVITY;
  gamemodeCtx.currentPitch -= gamemodeCtx.accumulatedDeltaY * SENSITIVITY;

  // Clamp pitch to -89.4° to +89.4° to prevent gimbal flip
  const MAX_PITCH = (Math.PI / 2) - 0.01;
  gamemodeCtx.currentPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, gamemodeCtx.currentPitch));

  sendWS({
    type: 'manual_look',
    yaw: gamemodeCtx.currentYaw,
    pitch: gamemodeCtx.currentPitch,
    delta: { dx: gamemodeCtx.accumulatedDeltaX, dy: gamemodeCtx.accumulatedDeltaY },
    isDelta: false,
    force: true
  });

  gamemodeCtx.accumulatedDeltaX = 0;
  gamemodeCtx.accumulatedDeltaY = 0;
}

export function onMouseDown(e) {
  if (!gamemodeCtx.isGamemodeActive) return;
  const lastRaycastData = gamemodeCtx.lastRaycastData;

  if (e.button === 0) {
    // Left-click: attack or start digging
    gamemodeCtx.isLeftMouseDown = true;
    gamemodeCtx.currentMiningStartTime = Date.now();
    gamemodeCtx.estimatedMiningDuration = (lastRaycastData && lastRaycastData.digTime) ? lastRaycastData.digTime : 800;
    gamemodeCtx.currentMiningBlockKey = (lastRaycastData && lastRaycastData.position)
      ? `${lastRaycastData.position.x},${lastRaycastData.position.y},${lastRaycastData.position.z}`
      : null;

    sendWS({
      type: 'manual_action',
      action: 'attack',
      targetEntityId: lastRaycastData?.type === 'entity' ? lastRaycastData.id : null
    });
    sendWS({
      type: 'manual_action',
      action: 'dig_start',
      targetBlockPos: lastRaycastData?.position,
      targetFace: lastRaycastData?.faceVector
    });

    // Start continuous mining loop (Minecraft style)
    if (gamemodeCtx.continuousMiningInterval) clearInterval(gamemodeCtx.continuousMiningInterval);
    gamemodeCtx.continuousMiningInterval = setInterval(() => {
      if (!gamemodeCtx.isLeftMouseDown || !gamemodeCtx.isGamemodeActive) {
        clearInterval(gamemodeCtx.continuousMiningInterval);
        gamemodeCtx.continuousMiningInterval = null;
        hideDigProgress();
        return;
      }

      const raycast = gamemodeCtx.lastRaycastData;
      if (raycast?.type === 'block' && raycast.position) {
        const blockKey = `${raycast.position.x},${raycast.position.y},${raycast.position.z}`;
        if (blockKey !== gamemodeCtx.currentMiningBlockKey) {
          // Changed target block while holding left click -> dig new block
          gamemodeCtx.currentMiningBlockKey = blockKey;
          gamemodeCtx.currentMiningStartTime = Date.now();
          gamemodeCtx.estimatedMiningDuration = raycast.digTime || 800;
          sendWS({
            type: 'manual_action',
            action: 'dig_start',
            targetBlockPos: raycast.position,
            targetFace: raycast.faceVector
          });
        }

        const elapsed = Date.now() - gamemodeCtx.currentMiningStartTime;
        const pct = Math.min(100, (elapsed / gamemodeCtx.estimatedMiningDuration) * 100);
        const name = raycast.displayName || raycast.name || 'Block';
        showDigProgress(pct, `Abbau: ${name}`);
      } else {
        hideDigProgress();
      }
    }, 50);

  } else if (e.button === 2) {
    // Right-click: place block or use item (eating, drinking, bow, shield)
    if (typeof e.preventDefault === 'function') e.preventDefault();
    gamemodeCtx.isRightMouseDown = true;

    sendWS({
      type: 'manual_action',
      action: 'place',
      targetBlockPos: lastRaycastData?.position,
      targetFace: lastRaycastData?.faceVector
    });
    sendWS({ type: 'manual_action', action: 'use_item_start' });

    // Auto-repeat placement while holding right-click (Minecraft style)
    if (gamemodeCtx.continuousPlaceInterval) clearInterval(gamemodeCtx.continuousPlaceInterval);
    gamemodeCtx.continuousPlaceInterval = setInterval(() => {
      if (!gamemodeCtx.isRightMouseDown || !gamemodeCtx.isGamemodeActive) {
        clearInterval(gamemodeCtx.continuousPlaceInterval);
        gamemodeCtx.continuousPlaceInterval = null;
        return;
      }
      const raycast = gamemodeCtx.lastRaycastData;
      sendWS({
        type: 'manual_action',
        action: 'place',
        targetBlockPos: raycast?.position,
        targetFace: raycast?.faceVector
      });
    }, 200);
  }
}

export function onMouseUp(e) {
  if (!gamemodeCtx.isGamemodeActive) return;

  if (e.button === 0) {
    gamemodeCtx.isLeftMouseDown = false;
    if (gamemodeCtx.continuousMiningInterval) {
      clearInterval(gamemodeCtx.continuousMiningInterval);
      gamemodeCtx.continuousMiningInterval = null;
    }
    gamemodeCtx.currentMiningBlockKey = null;
    hideDigProgress();
    sendWS({ type: 'manual_action', action: 'dig_stop' });
  } else if (e.button === 2) {
    gamemodeCtx.isRightMouseDown = false;
    if (gamemodeCtx.continuousPlaceInterval) {
      clearInterval(gamemodeCtx.continuousPlaceInterval);
      gamemodeCtx.continuousPlaceInterval = null;
    }
    sendWS({ type: 'manual_action', action: 'use_item_stop' });
  }
}

export function onMouseWheel(e) {
  if (!gamemodeCtx.isGamemodeActive) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  const newSlot = (gamemodeCtx.currentSelectedSlot + dir + 9) % 9;
  selectHotbarSlot(newSlot);
}

export function onKeyDown(e) {
  if (!gamemodeCtx.isGamemodeActive) return;
  const elements = gamemodeCtx.elements;
  const movementState = gamemodeCtx.movementState;

  // Ignore if user is typing in standard text input outside game
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if (e.target === elements.gamemodeChatInput) {
      // Let chat input handle its own keys
      return;
    }
    return;
  }
  if (e.target && e.target.isContentEditable) return;

  // Minecraft Tablist (Player List) - Show on hold
  if (e.code === 'Tab' || e.key === 'Tab') {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (!gamemodeCtx.isTabListVisible) {
      showTabList();
    }
    return;
  }

  let stateChanged = false;

  switch (e.code) {
    case 'KeyW':
      if (!movementState.forward) { movementState.forward = true; stateChanged = true; }
      break;
    case 'KeyS':
      if (!movementState.back) { movementState.back = true; stateChanged = true; }
      break;
    case 'KeyA':
      if (!movementState.left) { movementState.left = true; stateChanged = true; }
      break;
    case 'KeyD':
      if (!movementState.right) { movementState.right = true; stateChanged = true; }
      break;
    case 'Space':
      if (!movementState.jump) { movementState.jump = true; stateChanged = true; }
      if (typeof e.preventDefault === 'function') e.preventDefault();
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      if (!movementState.sneak) { movementState.sneak = true; stateChanged = true; }
      break;
    case 'ControlLeft':
    case 'ControlRight':
      if (!movementState.sprint) { movementState.sprint = true; stateChanged = true; }
      break;
    case 'Digit1': case 'Digit2': case 'Digit3':
    case 'Digit4': case 'Digit5': case 'Digit6':
    case 'Digit7': case 'Digit8': case 'Digit9': {
      const slot = parseInt(e.code.replace('Digit', ''), 10) - 1;
      if (gamemodeCtx.isInventoryOpen && gamemodeCtx.hoveredSlotIndex !== null) {
        // Swap hovered slot item with hotbar slot (Minecraft Mode 2)
        sendWS({
          type: 'inventory_click',
          slot: gamemodeCtx.hoveredSlotIndex,
          button: slot,
          mode: 2
        });
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      selectHotbarSlot(slot);
      break;
    }
    case 'KeyQ':
      if (gamemodeCtx.isInventoryOpen && gamemodeCtx.hoveredSlotIndex !== null) {
        // Drop item from hovered inventory slot
        sendWS({
          type: 'inventory_click',
          slot: gamemodeCtx.hoveredSlotIndex,
          button: e.ctrlKey ? 1 : 0,
          mode: 4
        });
      } else {
        // Drop item from active hotbar hand
        sendWS({ type: 'manual_action', action: 'drop_item', dropAll: !!e.ctrlKey });
      }
      if (typeof e.preventDefault === 'function') e.preventDefault();
      break;
    case 'KeyF':
      if (gamemodeCtx.isInventoryOpen && gamemodeCtx.hoveredSlotIndex !== null) {
        // Swap hovered slot item with offhand (button 40 in mode 2)
        sendWS({
          type: 'inventory_click',
          slot: gamemodeCtx.hoveredSlotIndex,
          button: 40,
          mode: 2
        });
      } else {
        sendWS({ type: 'manual_action', action: 'swap_hands' });
      }
      if (typeof e.preventDefault === 'function') e.preventDefault();
      break;
    case 'KeyE':
      if (!gamemodeCtx.isChatOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        toggleInventory();
      }
      break;
    case 'KeyT':
      if (!gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        openChat('');
      }
      break;
    case 'Slash':
      if (!gamemodeCtx.isChatOpen && !gamemodeCtx.isInventoryOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        openChat('/');
      }
      break;
    case 'KeyH':
    case 'F1':
      if (!gamemodeCtx.isChatOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        toggleGamemodeHelp();
      }
      break;
    case 'Escape': {
      // 0. If Help Overlay is open -> close Help first
      if (gamemodeCtx.isHelpOpen) {
        closeGamemodeHelp();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 1. If Chat is open -> close Chat first
      if (gamemodeCtx.isChatOpen) {
        closeChat();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 2. If Inventory is open -> close Inventory first
      if (gamemodeCtx.isInventoryOpen) {
        closeInventory();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 3. If Pause Menu is open -> close Pause Menu
      if (gamemodeCtx.isPauseMenuOpen) {
        closePauseMenu();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 4. Respect LIFO priority: If higher-priority modals or drawers are open outside, do not consume ESC
      if (typeof document !== 'undefined') {
        const onboardModal = document.getElementById('onboardingModal');
        const drawer = document.getElementById('drawerEndpointEdit') || document.getElementById('drawerEndpointConfig');
        const deviceModal = document.getElementById('modalDeviceFlow');
        const modelModal = document.getElementById('modalModelSettings');
        const hasOpenOverlay = (onboardModal && !onboardModal.classList.contains('hidden')) ||
                               (drawer && !drawer.classList.contains('hidden')) ||
                               (deviceModal && !deviceModal.classList.contains('hidden')) ||
                               (modelModal && !modelModal.classList.contains('hidden'));
        if (hasOpenOverlay) {
          return;
        }
      }
      // 5. Exit gamemode cleanly and park bot in standby
      exitGamemodeFn('esc_key');
      if (typeof e.preventDefault === 'function') e.preventDefault();
      break;
    }
    default:
      break;
  }

  if (stateChanged) {
    dispatchMovementState();
  }
}

export function onKeyUp(e) {
  if (!gamemodeCtx.isGamemodeActive) return;
  const movementState = gamemodeCtx.movementState;

  // Minecraft Tablist (Player List) - Hide on release
  if (e.code === 'Tab' || e.key === 'Tab') {
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (gamemodeCtx.isTabListVisible) {
      hideTabList();
    }
    return;
  }

  let stateChanged = false;

  switch (e.code) {
    case 'KeyW':
      if (movementState.forward) { movementState.forward = false; stateChanged = true; }
      break;
    case 'KeyS':
      if (movementState.back) { movementState.back = false; stateChanged = true; }
      break;
    case 'KeyA':
      if (movementState.left) { movementState.left = false; stateChanged = true; }
      break;
    case 'KeyD':
      if (movementState.right) { movementState.right = false; stateChanged = true; }
      break;
    case 'Space':
      if (movementState.jump) { movementState.jump = false; stateChanged = true; }
      break;
    case 'ShiftLeft':
    case 'ShiftRight':
      if (movementState.sneak) { movementState.sneak = false; stateChanged = true; }
      break;
    case 'ControlLeft':
    case 'ControlRight':
      if (movementState.sprint) { movementState.sprint = false; stateChanged = true; }
      break;
    default:
      break;
  }

  if (stateChanged) {
    dispatchMovementState();
  }
}
