/**
 * Architect Mission Control — Manual Gamemode & First-Person Cockpit Submodule
 *
 * Coordinates:
 * - Pointer Lock and Browser Fullscreen APIs
 * - Real-time Keyboard (WASD, Space, Shift, Ctrl, 1-9, Q, F) and Mouse Controls
 * - Stuck-Key Prevention on window.blur, visibilitychange, and pointerlockchange
 * - HUD Overlay (Crosshair, Raycast Inspection, Vitals, 9-Slot Hotbar)
 * - Standalone Popout Window & BroadcastChannel Coordination
 */

import { sendWS } from './wsClient.js';

let isGamemodeActive = false;
let isPopoutMode = false;
let broadcastChannel = null;

// Movement state tracking
const movementState = {
  forward: false,
  back: false,
  left: false,
  right: false,
  jump: false,
  sprint: false,
  sneak: false
};

// Look angles & deltas
let currentYaw = 0;
let currentPitch = 0;
let accumulatedDeltaX = 0;
let accumulatedDeltaY = 0;
let lookAnimationFrame = null;

// Hotbar & Active State
let currentSelectedSlot = 0;
let lastHotbarData = [];

// DOM References Cache
let elements = {};

/**
 * Initialize Manual Cockpit DOM listeners and HUD elements.
 */
export function initManualCockpit() {
  if (typeof document === 'undefined') return;

  elements = {
    viewerWrapper: document.getElementById('viewerWrapper') || document.querySelector('.viewer-wrapper'),
    viewerFrame: document.getElementById('viewerFrame'),
    viewerOverlayBar: document.getElementById('viewerOverlayBar'),
    btnToggleGamemode: document.getElementById('btnToggleGamemode'),
    btnPopoutGamemode: document.getElementById('btnPopoutGamemode'),
    btnFullscreenViewer: document.getElementById('btnFullscreenViewer'),
    btnExitGamemode: document.getElementById('btnExitGamemode'),
    btnReattachGamemode: document.getElementById('btnReattachGamemode'),
    viewerDetachedPlaceholder: document.getElementById('viewerDetachedPlaceholder'),
    gamemodeHudOverlay: document.getElementById('gamemodeHudOverlay'),
    gamemodeInputCapture: document.getElementById('gamemodeInputCapture'),
    gamemodeLockBanner: document.getElementById('gamemodeLockBanner'),
    gamemodeCoordinates: document.getElementById('gamemodeCoordinates'),
    gamemodeCrosshair: document.getElementById('gamemodeCrosshair'),
    gamemodeRaycastTooltip: document.getElementById('gamemodeRaycastTooltip'),
    raycastTargetType: document.getElementById('raycastTargetType'),
    raycastTargetDistance: document.getElementById('raycastTargetDistance'),
    raycastTargetCoords: document.getElementById('raycastTargetCoords'),
    hudHeartsContainer: document.getElementById('hudHeartsContainer'),
    hudHealthValue: document.getElementById('hudHealthValue'),
    hudFoodContainer: document.getElementById('hudFoodContainer'),
    hudFoodValue: document.getElementById('hudFoodValue'),
    gamemodeHotbar: document.getElementById('gamemodeHotbar'),
    hotbarSelectedItemLabel: document.getElementById('hotbarSelectedItemLabel')
  };

  // BroadcastChannel for cross-window / popout sync
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      broadcastChannel = new BroadcastChannel('mc_gamemode_sync');
      broadcastChannel.onmessage = handlePopoutBroadcast;
    } catch {
      // BroadcastChannel not supported in this context
    }
  }

  // 1. Button click listeners
  if (elements.btnToggleGamemode) {
    elements.btnToggleGamemode.onclick = () => toggleGamemode();
  }
  if (elements.btnPopoutGamemode) {
    elements.btnPopoutGamemode.onclick = () => openGamemodePopout();
  }
  if (elements.btnFullscreenViewer) {
    elements.btnFullscreenViewer.onclick = () => toggleFullscreen();
  }
  if (elements.btnExitGamemode) {
    elements.btnExitGamemode.onclick = () => exitGamemode('user_exit_button');
  }
  if (elements.btnReattachGamemode) {
    elements.btnReattachGamemode.onclick = () => reattachGamemode();
  }
  if (elements.gamemodeLockBanner) {
    elements.gamemodeLockBanner.onclick = () => requestPointerLock();
  }

  // 2. Pointer Lock event listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('pointerlockerror', onPointerLockError);

  // 3. Fullscreen change listeners
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // 4. Stuck-key prevention on blur & focus loss (3 layers)
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => clearAllControls('window_blur'));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAllControls('visibility_hidden');
  });

  // 5. Input capture event wiring
  if (elements.gamemodeInputCapture) {
    elements.gamemodeInputCapture.addEventListener('mousedown', onMouseDown);
    elements.gamemodeInputCapture.addEventListener('mouseup', onMouseUp);
    elements.gamemodeInputCapture.addEventListener('mousemove', onMouseMove);
    elements.gamemodeInputCapture.addEventListener('wheel', onMouseWheel, { passive: false });
    elements.gamemodeInputCapture.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 6. Global keyboard listeners for Gamemode
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  // 7. Hotbar slot click selection
  for (let i = 0; i < 9; i++) {
    const slotEl = document.getElementById(`hotbarSlot${i}`);
    if (slotEl) {
      slotEl.onclick = () => selectHotbarSlot(i);
    }
  }
}

/**
 * Toggle manual Gamemode on/off.
 * @param {boolean} [forceState]
 */
export function toggleGamemode(forceState) {
  const targetState = forceState !== undefined ? forceState : !isGamemodeActive;
  if (targetState) {
    enterGamemode();
  } else {
    exitGamemode('toggle_button');
  }
}

/**
 * Enter Gamemode: requests fullscreen, pointer lock, and notifies server.
 */
export function enterGamemode() {
  if (isGamemodeActive) return;
  isGamemodeActive = true;

  // Request browser Fullscreen on viewer container
  if (elements.viewerWrapper && typeof document !== 'undefined' && !document.fullscreenElement) {
    if (elements.viewerWrapper.requestFullscreen) {
      elements.viewerWrapper.requestFullscreen().catch(() => {});
    }
  }

  // Show HUD overlay
  if (elements.gamemodeHudOverlay) {
    elements.gamemodeHudOverlay.classList.remove('hidden');
  }
  if (elements.viewerWrapper) {
    elements.viewerWrapper.classList.add('gamemode-active');
  }

  // Request Pointer Lock on capture overlay
  requestPointerLock();

  // Send server activation message
  sendWS({
    type: 'toggle_manual_control',
    enabled: true,
    clientId: 'cockpit_main'
  });
}

/**
 * Exit Gamemode: releases pointer lock, exits fullscreen, clears controls, parks bot in standby.
 * @param {string} [reason='default']
 */
export function exitGamemode(reason = 'default') {
  if (!isGamemodeActive) return;
  isGamemodeActive = false;

  // Release Pointer Lock
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }

  // Exit Fullscreen if active
  if (typeof document !== 'undefined' && document.fullscreenElement) {
    try { document.exitFullscreen().catch(() => {}); } catch {}
  }

  // Hide HUD overlay and banners
  if (elements.gamemodeHudOverlay) {
    elements.gamemodeHudOverlay.classList.add('hidden');
  }
  if (elements.gamemodeLockBanner) {
    elements.gamemodeLockBanner.classList.add('hidden');
  }
  if (elements.viewerWrapper) {
    elements.viewerWrapper.classList.remove('gamemode-active');
  }

  // Clear all controls immediately
  clearAllControls(reason);

  // Notify server of exit
  sendWS({
    type: 'toggle_manual_control',
    enabled: false,
    reason
  });
}

/**
 * Open dedicated Gamemode popout window.
 */
export function openGamemodePopout() {
  if (typeof window === 'undefined') return;
  const popoutUrl = '/gamemode.html';
  const popout = window.open(
    popoutUrl,
    'AMC_GAMEMODE_VIEWPORT',
    'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
  );
  if (popout) {
    isPopoutMode = true;
    if (elements.viewerFrame) elements.viewerFrame.src = 'about:blank';
    if (elements.viewerDetachedPlaceholder) elements.viewerDetachedPlaceholder.classList.remove('hidden');
    if (broadcastChannel) {
      broadcastChannel.postMessage({ type: 'popout_opened' });
    }
  }
}

/**
 * Re-embed Gamemode back into main cockpit.
 */
export function reattachGamemode() {
  isPopoutMode = false;
  if (elements.viewerDetachedPlaceholder) elements.viewerDetachedPlaceholder.classList.add('hidden');
  if (elements.viewerFrame && typeof document !== 'undefined') {
    const port = document.getElementById('lblViewerPort')?.textContent || 3081;
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    elements.viewerFrame.src = `${protocol}//${hostname}:${port}`;
  }
  if (broadcastChannel) {
    broadcastChannel.postMessage({ type: 'popout_closed' });
  }
}

/**
 * Toggle browser fullscreen on viewer container.
 */
export function toggleFullscreen() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement) {
    if (elements.viewerWrapper && elements.viewerWrapper.requestFullscreen) {
      elements.viewerWrapper.requestFullscreen().catch(() => {});
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
  }
}

/**
 * Handle incoming cross-window BroadcastChannel sync message.
 * @param {MessageEvent} event
 */
function handlePopoutBroadcast(event) {
  if (!event || !event.data) return;
  if (event.data.type === 'popout_closed') {
    reattachGamemode();
  }
}

/**
 * Request pointer lock on the input capture layer.
 */
function requestPointerLock() {
  if (elements.gamemodeInputCapture && elements.gamemodeInputCapture.requestPointerLock) {
    try {
      elements.gamemodeInputCapture.requestPointerLock();
    } catch {
      // Browser rejected or secure context constraint
    }
  }
}

function onPointerLockChange() {
  if (typeof document === 'undefined') return;
  const isLocked = (document.pointerLockElement === elements.gamemodeInputCapture);
  if (isLocked) {
    if (elements.gamemodeLockBanner) elements.gamemodeLockBanner.classList.add('hidden');
  } else {
    // If pointer lock lost while gamemode still active -> show click to re-lock banner & clear moving keys
    if (isGamemodeActive) {
      clearAllControls('pointer_lock_lost');
      if (elements.gamemodeLockBanner) elements.gamemodeLockBanner.classList.remove('hidden');
    }
  }
}

function onPointerLockError() {
  if (isGamemodeActive && elements.gamemodeLockBanner) {
    elements.gamemodeLockBanner.classList.remove('hidden');
  }
}

function onFullscreenChange() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement && isGamemodeActive) {
    // If user closed fullscreen via ESC, gracefully exit gamemode
    exitGamemode('fullscreen_exit');
  }
}

/**
 * Keyboard Handling
 */
function onKeyDown(e) {
  if (!isGamemodeActive) return;

  // Ignore if user is typing in a modal or text input
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.target && e.target.isContentEditable) return;

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
      e.preventDefault();
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
      selectHotbarSlot(slot);
      break;
    }
    case 'KeyQ':
      sendWS({ type: 'manual_action', action: 'drop_item', dropAll: !!e.ctrlKey });
      break;
    case 'KeyF':
      sendWS({ type: 'manual_action', action: 'swap_hands' });
      break;
    case 'Escape': {
      // Respect LIFO priority: If higher-priority modals or drawers are open, do not consume ESC
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
      exitGamemode('esc_key');
      e.preventDefault();
      break;
    }
    default:
      break;
  }

  if (stateChanged) {
    dispatchMovementState();
  }
}

function onKeyUp(e) {
  if (!isGamemodeActive) return;
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

function dispatchMovementState() {
  sendWS({
    type: 'manual_movement',
    state: { ...movementState }
  });
}

/**
 * Stuck-Key Protection: Clears all movement states and halts digging.
 * @param {string} [reason='unspecified']
 */
export function clearAllControls(reason = 'unspecified') {
  let wasMoving = false;
  for (const k in movementState) {
    if (movementState[k]) wasMoving = true;
    movementState[k] = false;
  }

  sendWS({ type: 'clear_movement' });

  if (wasMoving) {
    sendWS({
      type: 'manual_movement',
      state: { ...movementState }
    });
  }

  // Also stop any ongoing digging
  sendWS({ type: 'manual_action', action: 'dig_stop' });
}

/**
 * Mouse & Look Handling
 */
function onMouseMove(e) {
  if (!isGamemodeActive) return;
  if (typeof document !== 'undefined' && document.pointerLockElement !== elements.gamemodeInputCapture) return;

  accumulatedDeltaX += e.movementX;
  accumulatedDeltaY += e.movementY;

  if (!lookAnimationFrame && typeof requestAnimationFrame !== 'undefined') {
    lookAnimationFrame = requestAnimationFrame(flushLookDeltas);
  }
}

function flushLookDeltas() {
  lookAnimationFrame = null;
  if (accumulatedDeltaX === 0 && accumulatedDeltaY === 0) return;

  const SENSITIVITY = 0.0025;
  currentYaw -= accumulatedDeltaX * SENSITIVITY;
  currentPitch -= accumulatedDeltaY * SENSITIVITY;

  // Clamp pitch to -89.4° to +89.4° to prevent gimbal flip
  const MAX_PITCH = (Math.PI / 2) - 0.01;
  currentPitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, currentPitch));

  sendWS({
    type: 'manual_look',
    yaw: currentYaw,
    pitch: currentPitch,
    delta: { dx: accumulatedDeltaX, dy: accumulatedDeltaY },
    force: true
  });

  accumulatedDeltaX = 0;
  accumulatedDeltaY = 0;
}

function onMouseDown(e) {
  if (!isGamemodeActive) return;
  if (e.button === 0) {
    // Left-click: attack or start digging
    sendWS({ type: 'manual_action', action: 'attack' });
    sendWS({ type: 'manual_action', action: 'dig_start' });
  } else if (e.button === 2) {
    // Right-click: place block or use item
    e.preventDefault();
    sendWS({ type: 'manual_action', action: 'place' });
    sendWS({ type: 'manual_action', action: 'use_item' });
  }
}

function onMouseUp(e) {
  if (!isGamemodeActive) return;
  if (e.button === 0) {
    sendWS({ type: 'manual_action', action: 'dig_stop' });
  }
}

function onMouseWheel(e) {
  if (!isGamemodeActive) return;
  e.preventDefault();
  const dir = e.deltaY > 0 ? 1 : -1;
  const newSlot = (currentSelectedSlot + dir + 9) % 9;
  selectHotbarSlot(newSlot);
}

/**
 * Select active hotbar slot index (0..8).
 * @param {number} slot
 */
export function selectHotbarSlot(slot) {
  if (slot < 0 || slot > 8) return;
  currentSelectedSlot = slot;

  // Update UI selection outline
  for (let i = 0; i < 9; i++) {
    const el = document.getElementById(`hotbarSlot${i}`);
    if (el) el.classList.toggle('active', i === slot);
  }

  // Show Toast
  const item = lastHotbarData[slot];
  if (elements.hotbarSelectedItemLabel) {
    elements.hotbarSelectedItemLabel.textContent = item?.displayName || (item?.name ? item.name.replace(/_/g, ' ') : '');
  }

  // Send WS action
  sendWS({
    type: 'manual_action',
    action: 'select_slot',
    slot
  });
}

/**
 * Telemetry Updates for HUD: health, food, coordinates, raycast, hotbar.
 * @param {Object} msg
 */
export function handleTelemetryUpdate(msg) {
  if (!msg) return;

  // 1. Coordinates
  if (elements.gamemodeCoordinates && msg.pos) {
    const x = typeof msg.pos.x === 'number' ? msg.pos.x.toFixed(1) : msg.pos.x;
    const y = typeof msg.pos.y === 'number' ? msg.pos.y.toFixed(1) : msg.pos.y;
    const z = typeof msg.pos.z === 'number' ? msg.pos.z.toFixed(1) : msg.pos.z;
    elements.gamemodeCoordinates.textContent = `X: ${x} Y: ${y} Z: ${z}`;
  }

  // 2. Vitals (Health & Food)
  if (msg.health !== undefined && elements.hudHealthValue) {
    elements.hudHealthValue.textContent = `${Math.round(msg.health)} / 20`;
    renderHearts(msg.health);
  }
  if (msg.food !== undefined && elements.hudFoodValue) {
    elements.hudFoodValue.textContent = `${Math.round(msg.food)} / 20`;
    renderFood(msg.food);
  }

  // 3. Hotbar
  if (Array.isArray(msg.hotbar)) {
    lastHotbarData = msg.hotbar;
    const activeSlot = (msg.manualControl && msg.manualControl.selectedSlot !== undefined)
      ? msg.manualControl.selectedSlot
      : currentSelectedSlot;
    renderHotbar(msg.hotbar, activeSlot);
  }

  // 4. Raycast Inspection
  if (msg.raycast) {
    renderRaycast(msg.raycast);
  }
}

/**
 * Handle server-broadcast `manual_control_state`.
 * @param {Object} msg
 */
export function handleGamemodeState(msg) {
  if (!msg) return;
  if (msg.active === false && isGamemodeActive) {
    // Server revoked control (disconnect, timeout, etc.)
    exitGamemode('server_revoked');
  }
  if (msg.selectedSlot !== undefined) {
    currentSelectedSlot = msg.selectedSlot;
    for (let i = 0; i < 9; i++) {
      const el = document.getElementById(`hotbarSlot${i}`);
      if (el) el.classList.toggle('active', i === currentSelectedSlot);
    }
  }
}

function renderHearts(health) {
  if (!elements.hudHeartsContainer) return;
  let html = '';
  const fullHearts = Math.floor(health / 2);
  const hasHalf = (health % 2) >= 1;
  for (let i = 0; i < 10; i++) {
    if (i < fullHearts) {
      html += '<span class="heart-icon full" style="color:#ef4444">❤</span>';
    } else if (i === fullHearts && hasHalf) {
      html += '<span class="heart-icon half" style="color:#ef4444;opacity:0.7">❤</span>';
    } else {
      html += '<span class="heart-icon empty" style="color:#334155">🖤</span>';
    }
  }
  elements.hudHeartsContainer.innerHTML = html;
}

function renderFood(food) {
  if (!elements.hudFoodContainer) return;
  let html = '';
  const full = Math.floor(food / 2);
  const hasHalf = (food % 2) >= 1;
  for (let i = 0; i < 10; i++) {
    if (i < full) {
      html += '<span class="food-icon full" style="color:#f59e0b">🍗</span>';
    } else if (i === full && hasHalf) {
      html += '<span class="food-icon half" style="color:#f59e0b;opacity:0.7">🍗</span>';
    } else {
      html += '<span class="food-icon empty" style="color:#334155">🍗</span>';
    }
  }
  elements.hudFoodContainer.innerHTML = html;
}

function renderHotbar(hotbar, activeSlot) {
  currentSelectedSlot = activeSlot;
  for (let i = 0; i < 9; i++) {
    const slotEl = document.getElementById(`hotbarSlot${i}`);
    if (!slotEl) continue;
    const item = hotbar[i];
    slotEl.classList.toggle('active', i === activeSlot);

    const iconEl = slotEl.querySelector('.slot-icon');
    const countEl = slotEl.querySelector('.slot-count');

    if (item && item.name) {
      if (iconEl) iconEl.textContent = getItemIcon(item.name);
      if (countEl) countEl.textContent = item.count > 1 ? String(item.count) : '';
      slotEl.title = item.displayName || item.name;
    } else {
      if (iconEl) iconEl.textContent = '';
      if (countEl) countEl.textContent = '';
      slotEl.title = 'Leer';
    }
  }
}

function getItemIcon(name) {
  if (!name) return '';
  const lower = name.toLowerCase();
  if (lower.includes('sword')) return '⚔️';
  if (lower.includes('pickaxe')) return '⛏️';
  if (lower.includes('axe')) return '🪓';
  if (lower.includes('shovel')) return '🥄';
  if (lower.includes('torch')) return '🕯️';
  if (lower.includes('beef') || lower.includes('pork') || lower.includes('bread') || lower.includes('apple')) return '🍖';
  if (lower.includes('log') || lower.includes('plank')) return '🪵';
  if (lower.includes('stone') || lower.includes('cobble')) return '🧱';
  return '📦';
}

function renderRaycast(raycast) {
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
    elements.raycastTargetCoords.textContent = `X: ${raycast.position.x} Y: ${raycast.position.y} Z: ${raycast.position.z}`;
  }
}

/**
 * Return whether Gamemode is currently active.
 * @returns {boolean}
 */
export function isGamemode() {
  return isGamemodeActive;
}

/**
 * Return whether popout mode is currently active.
 * @returns {boolean}
 */
export function isPopoutActive() {
  return isPopoutMode;
}
