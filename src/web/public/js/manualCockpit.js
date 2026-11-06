/**
 * Architect Mission Control — Manual Gamemode & First-Person Cockpit Submodule
 *
 * Coordinates:
 * - Pointer Lock and Browser Fullscreen APIs
 * - Real-time Keyboard (WASD, Space, Shift, Ctrl, 1-9, Q, F, E, T, /) and Mouse Controls
 * - In-Game Minecraft Chat HUD (T / Slash) with History & Server Messaging
 * - Full Player & Container Inventory GUI (E) with Click, Shift-Click & Drop Support
 * - Pause Menu (ESC) with Sensitivity Slider & Standby Handoff
 * - Death & Respawn Screen
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

// Sensitivity & Settings
let mouseSensitivityMultiplier = 1.0;
try {
  if (typeof localStorage !== 'undefined') {
    const savedSens = localStorage.getItem('mc_sensitivity');
    if (savedSens) mouseSensitivityMultiplier = parseFloat(savedSens);
  }
} catch {}

// Hotbar & Active State
let currentSelectedSlot = 0;
let lastHotbarData = [];
let lastFullInventory = null;
let hoveredSlotIndex = null;

// UI States
let isChatOpen = false;
let isInventoryOpen = false;
let isPauseMenuOpen = false;
const chatHistory = [];
let chatHistoryIndex = -1;

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
    hotbarSelectedItemLabel: document.getElementById('hotbarSelectedItemLabel'),

    // In-Game Chat Elements
    gamemodeChatArea: document.getElementById('gamemodeChatArea'),
    gamemodeChatLog: document.getElementById('gamemodeChatLog'),
    gamemodeChatInputContainer: document.getElementById('gamemodeChatInputContainer'),
    gamemodeChatInput: document.getElementById('gamemodeChatInput'),
    btnSendGamemodeChat: document.getElementById('btnSendGamemodeChat'),

    // In-Game Full Inventory Elements
    gamemodeInventoryModal: document.getElementById('gamemodeInventoryModal'),
    btnCloseInventory: document.getElementById('btnCloseInventory'),
    inventoryContainerSection: document.getElementById('inventoryContainerSection'),
    invContainerTitle: document.getElementById('invContainerTitle'),
    invContainerGrid: document.getElementById('invContainerGrid'),
    invMainGrid: document.getElementById('invMainGrid'),
    invHotbarGrid: document.getElementById('invHotbarGrid'),
    btnInvDropHeld: document.getElementById('btnInvDropHeld'),
    btnInvSwapHands: document.getElementById('btnInvSwapHands'),
    gamemodeHeldItemCursor: document.getElementById('gamemodeHeldItemCursor'),
    inventoryItemTooltip: document.getElementById('inventoryItemTooltip'),

    // Pause Menu & Settings
    gamemodePauseMenu: document.getElementById('gamemodePauseMenu'),
    btnResumeGame: document.getElementById('btnResumeGame'),
    btnOpenInventoryFromPause: document.getElementById('btnOpenInventoryFromPause'),
    btnOpenChatFromPause: document.getElementById('btnOpenChatFromPause'),
    sliderMouseSensitivity: document.getElementById('sliderMouseSensitivity'),
    lblMouseSensitivity: document.getElementById('lblMouseSensitivity'),
    btnExitFromPause: document.getElementById('btnExitFromPause'),

    // Death Screen
    gamemodeDeathScreen: document.getElementById('gamemodeDeathScreen'),
    btnGamemodeRespawn: document.getElementById('btnGamemodeRespawn')
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

  // 2. Chat UI listeners
  if (elements.btnSendGamemodeChat && elements.gamemodeChatInput) {
    elements.btnSendGamemodeChat.onclick = () => {
      sendChatMessage(elements.gamemodeChatInput.value);
    };
  }
  if (elements.gamemodeChatInput) {
    elements.gamemodeChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendChatMessage(elements.gamemodeChatInput.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeChat();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        navigateChatHistory(-1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        navigateChatHistory(1);
      }
    });
  }

  // 3. Inventory UI listeners
  if (elements.btnCloseInventory) {
    elements.btnCloseInventory.onclick = () => closeInventory();
  }
  if (elements.btnInvDropHeld) {
    elements.btnInvDropHeld.onclick = () => {
      sendWS({ type: 'manual_action', action: 'drop_item', dropAll: false });
    };
  }
  if (elements.btnInvSwapHands) {
    elements.btnInvSwapHands.onclick = () => {
      sendWS({ type: 'manual_action', action: 'swap_hands' });
    };
  }

  // Armor & offhand slot clicks
  [5, 6, 7, 8, 45].forEach(slotId => {
    const el = document.getElementById(`invSlot${slotId}`);
    if (el) {
      el.onclick = (e) => handleInventorySlotClick(slotId, e);
      el.oncontextmenu = (e) => handleInventorySlotClick(slotId, e);
      el.onmouseenter = () => { hoveredSlotIndex = slotId; showSlotTooltip(el, slotId); };
      el.onmouseleave = () => { if (hoveredSlotIndex === slotId) hoveredSlotIndex = null; hideSlotTooltip(); };
    }
  });

  // 4. Pause Menu listeners
  if (elements.btnResumeGame) {
    elements.btnResumeGame.onclick = () => closePauseMenu();
  }
  if (elements.btnOpenInventoryFromPause) {
    elements.btnOpenInventoryFromPause.onclick = () => {
      closePauseMenu();
      openInventory();
    };
  }
  if (elements.btnOpenChatFromPause) {
    elements.btnOpenChatFromPause.onclick = () => {
      closePauseMenu();
      openChat('');
    };
  }
  if (elements.btnExitFromPause) {
    elements.btnExitFromPause.onclick = () => {
      closePauseMenu();
      exitGamemode('user_pause_menu_exit');
    };
  }
  if (elements.sliderMouseSensitivity) {
    elements.sliderMouseSensitivity.value = Math.round(mouseSensitivityMultiplier * 100);
    if (elements.lblMouseSensitivity) {
      elements.lblMouseSensitivity.textContent = `${Math.round(mouseSensitivityMultiplier * 100)}%`;
    }
    elements.sliderMouseSensitivity.oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      mouseSensitivityMultiplier = val / 100;
      if (elements.lblMouseSensitivity) {
        elements.lblMouseSensitivity.textContent = `${val}%`;
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('mc_sensitivity', String(mouseSensitivityMultiplier));
        }
      } catch {}
    };
  }

  // 5. Death screen listener
  if (elements.btnGamemodeRespawn) {
    elements.btnGamemodeRespawn.onclick = () => {
      sendWS({ type: 'respawn' });
      if (elements.gamemodeDeathScreen) {
        elements.gamemodeDeathScreen.classList.add('hidden');
      }
      setTimeout(() => requestPointerLock(), 200);
    };
  }

  // 6. Floating held-item cursor follower
  if (typeof document !== 'undefined') {
    document.addEventListener('mousemove', (e) => {
      if (elements.gamemodeHeldItemCursor && !elements.gamemodeHeldItemCursor.classList.contains('hidden')) {
        elements.gamemodeHeldItemCursor.style.left = `${e.clientX + 14}px`;
        elements.gamemodeHeldItemCursor.style.top = `${e.clientY + 14}px`;
      }
      if (elements.inventoryItemTooltip && !elements.inventoryItemTooltip.classList.contains('hidden')) {
        elements.inventoryItemTooltip.style.left = `${e.clientX + 16}px`;
        elements.inventoryItemTooltip.style.top = `${e.clientY + 16}px`;
      }
    });
  }

  // 7. Pointer Lock event listeners
  document.addEventListener('pointerlockchange', onPointerLockChange);
  document.addEventListener('pointerlockerror', onPointerLockError);

  // 8. Fullscreen change listeners
  document.addEventListener('fullscreenchange', onFullscreenChange);

  // 9. Stuck-key prevention on blur & focus loss
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => clearAllControls('window_blur'));
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAllControls('visibility_hidden');
  });

  // 10. Input capture event wiring
  if (elements.gamemodeInputCapture) {
    elements.gamemodeInputCapture.addEventListener('mousedown', onMouseDown);
    elements.gamemodeInputCapture.addEventListener('mouseup', onMouseUp);
    elements.gamemodeInputCapture.addEventListener('mousemove', onMouseMove);
    elements.gamemodeInputCapture.addEventListener('wheel', onMouseWheel, { passive: false });
    elements.gamemodeInputCapture.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 11. Global keyboard listeners for Gamemode
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
  }

  // 12. Hotbar slot click selection
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

  // Close modals
  closeChat();
  closeInventory();
  closePauseMenu();

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
  if (isChatOpen || isInventoryOpen || isPauseMenuOpen) return;
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
    // If pointer lock lost while gamemode still active and no menu is open -> show banner
    if (isGamemodeActive && !isChatOpen && !isInventoryOpen && !isPauseMenuOpen) {
      clearAllControls('pointer_lock_lost');
      if (elements.gamemodeLockBanner) elements.gamemodeLockBanner.classList.remove('hidden');
    }
  }
}

function onPointerLockError() {
  if (isGamemodeActive && !isChatOpen && !isInventoryOpen && !isPauseMenuOpen && elements.gamemodeLockBanner) {
    elements.gamemodeLockBanner.classList.remove('hidden');
  }
}

function onFullscreenChange() {
  if (typeof document === 'undefined') return;
  if (!document.fullscreenElement && isGamemodeActive) {
    // Gracefully exit gamemode on fullscreen escape
    exitGamemode('fullscreen_exit');
  }
}

// ==============================================================================
// IN-GAME CHAT IMPLEMENTATION (T & Slash)
// ==============================================================================

export function openChat(prefill = '') {
  if (!isGamemodeActive) return;
  if (isInventoryOpen) closeInventory();
  if (isPauseMenuOpen) closePauseMenu();

  isChatOpen = true;
  if (elements.gamemodeChatInputContainer) {
    elements.gamemodeChatInputContainer.classList.remove('hidden');
  }
  if (elements.gamemodeChatInput) {
    elements.gamemodeChatInput.value = prefill;
    elements.gamemodeChatInput.focus();
  }
  // Exit pointer lock so user can type freely
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControls('chat_opened');
}

export function closeChat() {
  isChatOpen = false;
  chatHistoryIndex = -1;
  if (elements.gamemodeChatInputContainer) {
    elements.gamemodeChatInputContainer.classList.add('hidden');
  }
  if (elements.gamemodeChatInput) {
    elements.gamemodeChatInput.value = '';
    elements.gamemodeChatInput.blur();
  }
  if (isGamemodeActive && !isInventoryOpen && !isPauseMenuOpen) {
    requestPointerLock();
  }
}

export function sendChatMessage(text) {
  const clean = (text || '').trim();
  if (clean) {
    sendWS({
      type: 'send_chat',
      message: clean
    });
    chatHistory.push(clean);
    if (chatHistory.length > 50) chatHistory.shift();
  }
  closeChat();
}

function navigateChatHistory(direction) {
  if (!chatHistory.length) return;
  chatHistoryIndex += direction;
  if (chatHistoryIndex < 0) chatHistoryIndex = 0;
  if (chatHistoryIndex >= chatHistory.length) {
    chatHistoryIndex = chatHistory.length;
    if (elements.gamemodeChatInput) elements.gamemodeChatInput.value = '';
    return;
  }
  const item = chatHistory[chatHistoryIndex];
  if (elements.gamemodeChatInput && item) {
    elements.gamemodeChatInput.value = item;
  }
}

export function handleIncomingChat(msg) {
  if (!msg || !elements.gamemodeChatLog) return;
  const sender = msg.sender || 'Server';
  const text = msg.message || '';

  const lineEl = document.createElement('div');
  lineEl.className = 'gamemode-chat-line';

  const senderEl = document.createElement('span');
  senderEl.className = 'chat-sender';
  senderEl.textContent = `<${sender}> `;

  const textEl = document.createElement('span');
  textEl.className = 'chat-text';
  textEl.textContent = text;

  lineEl.appendChild(senderEl);
  lineEl.appendChild(textEl);
  elements.gamemodeChatLog.appendChild(lineEl);
  elements.gamemodeChatLog.scrollTop = elements.gamemodeChatLog.scrollHeight;

  // Auto-fade chat message after 8 seconds
  setTimeout(() => {
    if (!isChatOpen) {
      lineEl.classList.add('fading');
      setTimeout(() => lineEl.remove(), 1000);
    }
  }, 8000);
}

// ==============================================================================
// FULL MINECRAFT INVENTORY GUI IMPLEMENTATION (Key: E)
// ==============================================================================

export function openInventory() {
  if (!isGamemodeActive) return;
  if (isChatOpen) closeChat();
  if (isPauseMenuOpen) closePauseMenu();

  isInventoryOpen = true;
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.classList.remove('hidden');
  }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControls('inventory_opened');

  if (lastFullInventory) {
    renderFullInventory(lastFullInventory);
  }
}

export function closeInventory() {
  isInventoryOpen = false;
  hoveredSlotIndex = null;
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.classList.add('hidden');
  }
  if (elements.inventoryItemTooltip) {
    elements.inventoryItemTooltip.classList.add('hidden');
  }
  if (elements.gamemodeHeldItemCursor) {
    elements.gamemodeHeldItemCursor.classList.add('hidden');
  }

  // Notify server to close any active container window
  sendWS({ type: 'close_window' });

  if (isGamemodeActive && !isChatOpen && !isPauseMenuOpen) {
    requestPointerLock();
  }
}

export function toggleInventory() {
  if (isInventoryOpen) {
    closeInventory();
  } else {
    openInventory();
  }
}

function handleInventorySlotClick(slotIndex, e) {
  if (typeof slotIndex !== 'number') return;
  e.preventDefault();
  e.stopPropagation();

  // Mode: 0 = normal click, 1 = shift click, 4 = drop
  let mode = 0;
  let button = e.button === 2 ? 1 : 0; // 0 = left, 1 = right

  if (e.shiftKey) {
    mode = 1;
    button = 0;
  }

  sendWS({
    type: 'inventory_click',
    slot: slotIndex,
    button,
    mode
  });
}

function showSlotTooltip(targetEl, slotIndex) {
  if (!elements.inventoryItemTooltip || !targetEl) return;
  const item = targetEl._itemData;
  if (!item || !item.name) {
    elements.inventoryItemTooltip.classList.add('hidden');
    return;
  }

  const name = item.displayName || item.name;
  let html = `<strong>${name}</strong>`;
  if (item.count > 1) html += ` <span style="color:#94a3b8">x${item.count}</span>`;
  if (item.maxDurability > 0) {
    const remaining = item.maxDurability - (item.durabilityUsed || 0);
    html += `<br><span style="color:#22c55e;font-size:10px">Haltbarkeit: ${remaining} / ${item.maxDurability}</span>`;
  }

  elements.inventoryItemTooltip.innerHTML = html;
  elements.inventoryItemTooltip.classList.remove('hidden');
}

function hideSlotTooltip() {
  if (elements.inventoryItemTooltip) {
    elements.inventoryItemTooltip.classList.add('hidden');
  }
}

function renderFullInventory(inv) {
  if (!inv) return;

  // 1. Armor Slots (5, 6, 7, 8)
  const armorSlots = [
    { id: 'invSlot5', item: inv.armor?.head, defaultIcon: '🪖' },
    { id: 'invSlot6', item: inv.armor?.torso, defaultIcon: '🥋' },
    { id: 'invSlot7', item: inv.armor?.legs, defaultIcon: '👖' },
    { id: 'invSlot8', item: inv.armor?.feet, defaultIcon: '👢' },
    { id: 'invSlot45', item: inv.offhand, defaultIcon: '🛡️' }
  ];

  armorSlots.forEach(({ id, item, defaultIcon }) => {
    const el = document.getElementById(id);
    if (!el) return;
    el._itemData = item;
    if (item && item.name) {
      el.innerHTML = `<span class="slot-icon">${getItemIcon(item.name)}</span><span class="slot-count">${item.count > 1 ? item.count : ''}</span>`;
      el.classList.add('has-item');
    } else {
      el.innerHTML = `<span class="slot-bg-icon">${defaultIcon}</span><span class="slot-count"></span>`;
      el.classList.remove('has-item');
    }
  });

  // 2. Main Inventory Grid (Slots 9..35 = 27 slots)
  if (elements.invMainGrid) {
    elements.invMainGrid.innerHTML = '';
    const mainItems = Array.isArray(inv.main) ? inv.main : [];
    for (let i = 0; i < 27; i++) {
      const slotIndex = 9 + i;
      const item = mainItems[i] || null;
      const slotEl = createInventorySlotElement(slotIndex, item);
      elements.invMainGrid.appendChild(slotEl);
    }
  }

  // 3. Hotbar Grid (Slots 36..44 = 9 slots)
  if (elements.invHotbarGrid) {
    elements.invHotbarGrid.innerHTML = '';
    const hotbarItems = Array.isArray(inv.hotbar) ? inv.hotbar : [];
    for (let i = 0; i < 9; i++) {
      const slotIndex = 36 + i;
      const item = hotbarItems[i] || null;
      const slotEl = createInventorySlotElement(slotIndex, item);
      if (i === currentSelectedSlot) slotEl.classList.add('active');
      elements.invHotbarGrid.appendChild(slotEl);
    }
  }

  // 4. Container Grid (if active container opened, e.g. chest)
  if (elements.inventoryContainerSection && elements.invContainerGrid) {
    if (inv.container && Array.isArray(inv.container.slots) && inv.container.slots.length > 0) {
      elements.inventoryContainerSection.classList.remove('hidden');
      if (elements.invContainerTitle) {
        elements.invContainerTitle.textContent = inv.container.title || 'Behälter';
      }
      elements.invContainerGrid.innerHTML = '';
      inv.container.slots.forEach((item, idx) => {
        const slotEl = createInventorySlotElement(idx, item);
        elements.invContainerGrid.appendChild(slotEl);
      });
    } else {
      elements.inventoryContainerSection.classList.add('hidden');
    }
  }

  // 5. Floating Held Item on cursor
  if (elements.gamemodeHeldItemCursor) {
    if (inv.selectedItem && inv.selectedItem.name) {
      elements.gamemodeHeldItemCursor.classList.remove('hidden');
      const icon = elements.gamemodeHeldItemCursor.querySelector('.held-icon');
      const count = elements.gamemodeHeldItemCursor.querySelector('.held-count');
      if (icon) icon.textContent = getItemIcon(inv.selectedItem.name);
      if (count) count.textContent = inv.selectedItem.count > 1 ? String(inv.selectedItem.count) : '';
    } else {
      elements.gamemodeHeldItemCursor.classList.add('hidden');
    }
  }
}

function createInventorySlotElement(slotIndex, item) {
  const el = document.createElement('div');
  el.className = 'inv-slot';
  el.dataset.slot = String(slotIndex);
  el._itemData = item;

  if (item && item.name) {
    el.classList.add('has-item');
    let durHtml = '';
    if (item.maxDurability > 0 && item.durabilityUsed > 0) {
      const percent = Math.max(0, Math.min(100, Math.round(((item.maxDurability - item.durabilityUsed) / item.maxDurability) * 100)));
      const color = percent > 50 ? '#22c55e' : (percent > 20 ? '#eab308' : '#ef4444');
      durHtml = `<div class="slot-durability"><div class="durability-fill" style="width:${percent}%;background:${color}"></div></div>`;
    }
    el.innerHTML = `
      <span class="slot-icon">${getItemIcon(item.name)}</span>
      <span class="slot-count">${item.count > 1 ? item.count : ''}</span>
      ${durHtml}
    `;
  } else {
    el.innerHTML = `<span class="slot-icon"></span><span class="slot-count"></span>`;
  }

  el.onclick = (e) => handleInventorySlotClick(slotIndex, e);
  el.oncontextmenu = (e) => handleInventorySlotClick(slotIndex, e);
  el.onmouseenter = () => {
    hoveredSlotIndex = slotIndex;
    showSlotTooltip(el, slotIndex);
  };
  el.onmouseleave = () => {
    if (hoveredSlotIndex === slotIndex) hoveredSlotIndex = null;
    hideSlotTooltip();
  };

  return el;
}

// ==============================================================================
// PAUSE MENU IMPLEMENTATION
// ==============================================================================

export function openPauseMenu() {
  if (!isGamemodeActive) return;
  isPauseMenuOpen = true;
  if (elements.gamemodePauseMenu) {
    elements.gamemodePauseMenu.classList.remove('hidden');
  }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControls('pause_menu_opened');
}

export function closePauseMenu() {
  isPauseMenuOpen = false;
  if (elements.gamemodePauseMenu) {
    elements.gamemodePauseMenu.classList.add('hidden');
  }
  if (isGamemodeActive && !isChatOpen && !isInventoryOpen) {
    requestPointerLock();
  }
}

// ==============================================================================
// KEYBOARD & INPUT HANDLING
// ==============================================================================

function onKeyDown(e) {
  if (!isGamemodeActive) return;

  // Ignore if user is typing in standard text input outside game
  if (e.target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) {
    if (e.target === elements.gamemodeChatInput) {
      // Let chat input handle its own keys
      return;
    }
    return;
  }
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
      selectHotbarSlot(slot);
      break;
    }
    case 'KeyQ':
      if (isInventoryOpen && hoveredSlotIndex !== null) {
        // Drop item from hovered inventory slot
        sendWS({
          type: 'inventory_click',
          slot: hoveredSlotIndex,
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
      sendWS({ type: 'manual_action', action: 'swap_hands' });
      if (typeof e.preventDefault === 'function') e.preventDefault();
      break;
    case 'KeyE':
      if (!isChatOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        toggleInventory();
      }
      break;
    case 'KeyT':
      if (!isChatOpen && !isInventoryOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        openChat('');
      }
      break;
    case 'Slash':
      if (!isChatOpen && !isInventoryOpen) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        openChat('/');
      }
      break;
    case 'Escape': {
      // 1. If Chat is open -> close Chat first
      if (isChatOpen) {
        closeChat();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 2. If Inventory is open -> close Inventory first
      if (isInventoryOpen) {
        closeInventory();
        if (typeof e.preventDefault === 'function') e.preventDefault();
        return;
      }
      // 3. If Pause Menu is open -> close Pause Menu
      if (isPauseMenuOpen) {
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
      exitGamemode('esc_key');
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

  // Also stop any ongoing digging & item use
  sendWS({ type: 'manual_action', action: 'dig_stop' });
  sendWS({ type: 'manual_action', action: 'use_item_stop' });
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

  const SENSITIVITY = 0.0022 * mouseSensitivityMultiplier;
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
    isDelta: false,
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
    // Right-click: place block or use item (eating, drinking, bow, shield)
    e.preventDefault();
    sendWS({ type: 'manual_action', action: 'place' });
    sendWS({ type: 'manual_action', action: 'use_item_start' });
  }
}

function onMouseUp(e) {
  if (!isGamemodeActive) return;
  if (e.button === 0) {
    sendWS({ type: 'manual_action', action: 'dig_stop' });
  } else if (e.button === 2) {
    sendWS({ type: 'manual_action', action: 'use_item_stop' });
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
 * Telemetry Updates for HUD: health, food, coordinates, raycast, hotbar, inventory, angles.
 * @param {Object} msg
 */
export function handleTelemetryUpdate(msg) {
  if (!msg) return;

  // 1. Angle Synchronization (only when NOT actively pointer locked to prevent jerking)
  if (typeof msg.yaw === 'number' && typeof msg.pitch === 'number') {
    if (typeof document === 'undefined' || !document.pointerLockElement) {
      currentYaw = msg.yaw;
      currentPitch = msg.pitch;
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
    lastHotbarData = msg.hotbar;
    const activeSlot = (msg.manualControl && msg.manualControl.selectedSlot !== undefined)
      ? msg.manualControl.selectedSlot
      : currentSelectedSlot;
    renderHotbar(msg.hotbar, activeSlot);
  }

  // 5. Full Player & Container Inventory
  if (msg.fullInventory) {
    lastFullInventory = msg.fullInventory;
    if (isInventoryOpen) {
      renderFullInventory(msg.fullInventory);
    }
  }

  // 6. Raycast Inspection
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

/**
 * Universal Item Icon Map matching standard Minecraft items.
 */
export function getItemIcon(name) {
  if (!name) return '';
  const lower = name.toLowerCase();

  // Weapons & Tools
  if (lower.includes('sword')) return '⚔️';
  if (lower.includes('bow')) return '🏹';
  if (lower.includes('arrow')) return '🎯';
  if (lower.includes('shield')) return '🛡️';
  if (lower.includes('trident')) return '🔱';
  if (lower.includes('pickaxe')) return '⛏️';
  if (lower.includes('axe')) return '🪓';
  if (lower.includes('shovel')) return '🥄';
  if (lower.includes('hoe')) return '🧑‍🌾';
  if (lower.includes('shears')) return '✂️';
  if (lower.includes('fishing_rod')) return '🎣';
  if (lower.includes('flint_and_steel')) return '🔥';

  // Armor
  if (lower.includes('helmet') || lower.includes('cap')) return '🪖';
  if (lower.includes('chestplate') || lower.includes('tunic')) return '🥋';
  if (lower.includes('leggings') || lower.includes('pants')) return '👖';
  if (lower.includes('boots')) return '👢';
  if (lower.includes('elytra')) return '🪽';

  // Food & Potions
  if (lower.includes('golden_apple')) return '🍏';
  if (lower.includes('apple')) return '🍎';
  if (lower.includes('bread')) return '🍞';
  if (lower.includes('beef') || lower.includes('pork') || lower.includes('mutton') || lower.includes('chicken')) return '🍖';
  if (lower.includes('fish') || lower.includes('salmon') || lower.includes('cod')) return '🐟';
  if (lower.includes('carrot')) return '🥕';
  if (lower.includes('potato')) return '🥔';
  if (lower.includes('melon')) return '🍉';
  if (lower.includes('potion') || lower.includes('bottle')) return '🧪';

  // Ores & Minerals
  if (lower.includes('diamond')) return '💎';
  if (lower.includes('emerald')) return '🟢';
  if (lower.includes('iron_ingot')) return '🪙';
  if (lower.includes('gold_ingot')) return '🧈';
  if (lower.includes('netherite')) return '⬛';
  if (lower.includes('coal') || lower.includes('charcoal')) return '🪨';
  if (lower.includes('redstone')) return '🔴';
  if (lower.includes('lapis')) return '🔷';
  if (lower.includes('quartz')) return '⚪';
  if (lower.includes('copper')) return '🟫';

  // Utility & Misc
  if (lower.includes('torch')) return '🕯️';
  if (lower.includes('lantern')) return '🏮';
  if (lower.includes('bed')) return '🛏️';
  if (lower.includes('chest') || lower.includes('barrel') || lower.includes('shulker')) return '📦';
  if (lower.includes('crafting_table')) return '🪚';
  if (lower.includes('furnace')) return '♨️';
  if (lower.includes('anvil')) return '🔨';
  if (lower.includes('door') || lower.includes('trapdoor')) return '🚪';
  if (lower.includes('glass')) return '🪟';
  if (lower.includes('bucket')) return '🪣';
  if (lower.includes('water')) return '💧';
  if (lower.includes('lava')) return '🔥';
  if (lower.includes('tnt')) return '🧨';
  if (lower.includes('book')) return '📖';
  if (lower.includes('stick')) return '🥢';
  if (lower.includes('string')) return '🧵';
  if (lower.includes('feather')) return '🪶';
  if (lower.includes('bone')) return '🦴';

  // Blocks
  if (lower.includes('log') || lower.includes('plank') || lower.includes('wood')) return '🪵';
  if (lower.includes('cobble') || lower.includes('stone') || lower.includes('brick') || lower.includes('deepslate')) return '🧱';
  if (lower.includes('dirt') || lower.includes('grass')) return '🟫';
  if (lower.includes('sand')) return '🟨';

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
