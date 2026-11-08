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

// Minecraft Item Textures Cache
let itemTexturesMap = {};
let texturesLoading = false;

// Interaction & Mining States
let lastRaycastData = null;
let isLeftMouseDown = false;
let isRightMouseDown = false;
let continuousMiningInterval = null;
let continuousPlaceInterval = null;
let currentMiningBlockKey = null;
let currentMiningStartTime = 0;
let estimatedMiningDuration = 1000;

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
    gamemodeDigProgress: document.getElementById('gamemodeDigProgress'),
    digProgressFill: document.getElementById('digProgressFill'),
    digProgressText: document.getElementById('digProgressText'),
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
    hotbarSelectionFrame: document.getElementById('hotbarSelectionFrame'),
    hudOffhandSlot: document.getElementById('hudOffhandSlot'),

    // In-Game Chat Elements
    gamemodeChatArea: document.getElementById('gamemodeChatArea'),
    gamemodeChatLog: document.getElementById('gamemodeChatLog'),
    gamemodeChatInputContainer: document.getElementById('gamemodeChatInputContainer'),
    gamemodeChatInput: document.getElementById('gamemodeChatInput'),
    btnSendGamemodeChat: document.getElementById('btnSendGamemodeChat'),

    // In-Game Full Inventory Elements
    btnOpenInventory: document.getElementById('btnOpenInventory'),
    gamemodeInventoryModal: document.getElementById('gamemodeInventoryModal'),
    btnCloseInventory: document.getElementById('btnCloseInventory'),
    btnCloseContainer: document.getElementById('btnCloseContainer'),
    mcPlayerInventoryWindow: document.getElementById('mcPlayerInventoryWindow'),
    mcPlayerDollCanvas: document.getElementById('mcPlayerDollCanvas'),
    inventoryContainerSection: document.getElementById('inventoryContainerSection'),
    invContainerTitle: document.getElementById('invContainerTitle'),
    invContainerGrid: document.getElementById('invContainerGrid'),
    invContainerPlayerMainGrid: document.getElementById('invContainerPlayerMainGrid'),
    invContainerPlayerHotbarGrid: document.getElementById('invContainerPlayerHotbarGrid'),
    invSlot0: document.getElementById('invSlot0'),
    invSlot1: document.getElementById('invSlot1'),
    invSlot2: document.getElementById('invSlot2'),
    invSlot3: document.getElementById('invSlot3'),
    invSlot4: document.getElementById('invSlot4'),
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
  if (elements.btnOpenInventory) {
    elements.btnOpenInventory.onclick = () => toggleInventory();
  }
  if (elements.btnCloseInventory) {
    elements.btnCloseInventory.onclick = () => closeInventory();
  }
  if (elements.btnCloseContainer) {
    elements.btnCloseContainer.onclick = () => closeInventory();
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
  if (elements.hudOffhandSlot) {
    elements.hudOffhandSlot.onclick = () => {
      sendWS({ type: 'manual_action', action: 'swap_hands' });
    };
  }

  // Fixed inventory slots: Crafting output (0), 2x2 Crafting (1-4), Armor (5-8), Offhand (45)
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 45].forEach(slotId => {
    const el = document.getElementById(`invSlot${slotId}`);
    if (el) {
      el.onclick = (e) => handleInventorySlotClick(slotId, e);
      el.oncontextmenu = (e) => handleInventorySlotClick(slotId, e);
      el.onmouseenter = () => { hoveredSlotIndex = slotId; showSlotTooltip(el, slotId); };
      el.onmouseleave = () => { if (hoveredSlotIndex === slotId) hoveredSlotIndex = null; hideSlotTooltip(); };
    }
  });

  // Clicking outside inventory window (backdrop) drops held cursor item (slot: -999)
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.addEventListener('click', (e) => {
      if (e.target === elements.gamemodeInventoryModal && lastFullInventory && lastFullInventory.selectedItem) {
        sendWS({ type: 'inventory_click', slot: -999, button: 0, mode: 0 });
      }
    });
    elements.gamemodeInventoryModal.addEventListener('contextmenu', (e) => {
      if (e.target === elements.gamemodeInventoryModal && lastFullInventory && lastFullInventory.selectedItem) {
        e.preventDefault();
        sendWS({ type: 'inventory_click', slot: -999, button: 1, mode: 0 });
      }
    });
  }

  // Mouse tracking on player inventory to turn Steve's doll preview
  if (elements.mcPlayerInventoryWindow) {
    elements.mcPlayerInventoryWindow.addEventListener('mousemove', (e) => {
      if (typeof elements.mcPlayerInventoryWindow.getBoundingClientRect === 'function') {
        const rect = elements.mcPlayerInventoryWindow.getBoundingClientRect();
        const normX = rect.width ? (e.clientX - rect.left) / rect.width : 0.5;
        const normY = rect.height ? (e.clientY - rect.top) / rect.height : 0.5;
        renderPlayerDoll(lastFullInventory, normX, normY);
      }
    });
  }

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

  // 13. Preload Authentic Minecraft Item Textures
  loadItemTextures();
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

  // Request fresh inventory from server
  sendWS({ type: 'get_inventory' });

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

/**
 * Asynchronously load item textures map from pre-generated JSON or API.
 */
export async function loadItemTextures() {
  if (typeof fetch === 'undefined') return;
  if (Object.keys(itemTexturesMap).length > 0 || texturesLoading) return;
  texturesLoading = true;
  try {
    const res = await fetch('/img/mc/item_textures.json');
    if (res && res.ok) {
      itemTexturesMap = await res.json();
      if (isInventoryOpen && lastFullInventory) {
        renderFullInventory(lastFullInventory);
      }
      if (lastHotbarData && lastHotbarData.length > 0) {
        renderHotbar(lastHotbarData, currentSelectedSlot);
      }
    }
  } catch (err) {
    console.warn('[ManualCockpit] Could not load item textures:', err);
  } finally {
    texturesLoading = false;
  }
}

/**
 * Get texture URL for a given Minecraft item or block name.
 * @param {string} name
 * @returns {string|null}
 */
export function getItemTextureUrl(name) {
  if (!name) return null;
  const clean = String(name).toLowerCase().trim().replace(/^minecraft:/, '');
  if (itemTexturesMap && itemTexturesMap[clean]) {
    return itemTexturesMap[clean];
  }
  return `/textures/1.20.1/item/${clean}.png`;
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

  const name = item.displayName || item.name.replace(/_/g, ' ');
  let html = `<div class="tooltip-title">${name}</div>`;
  if (item.count > 1) {
    html += `<div class="tooltip-meta">Anzahl: ${item.count}</div>`;
  }
  if (item.maxDurability > 0) {
    const remaining = Math.max(0, item.maxDurability - (item.durabilityUsed || 0));
    html += `<div class="tooltip-durability">Haltbarkeit: ${remaining} / ${item.maxDurability}</div>`;
  }

  elements.inventoryItemTooltip.innerHTML = html;
  elements.inventoryItemTooltip.classList.remove('hidden');
}

function hideSlotTooltip() {
  if (elements.inventoryItemTooltip) {
    elements.inventoryItemTooltip.classList.add('hidden');
  }
}

/**
 * Render slot content with authentic Minecraft textures, count labels, durability bars, and ghost icons.
 */
function renderItemSlotContent(el, item, ghostIconUrl = null) {
  if (!el) return;
  el._itemData = item;

  // Mock test fallback where document.createElement might not be present
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    if (item && item.name) {
      el.innerHTML = `<span class="slot-icon">${getItemIcon(item.name)}</span><span class="slot-count">${item.count > 1 ? item.count : ''}</span>`;
      if (el.classList && el.classList.add) el.classList.add('has-item');
    } else {
      el.innerHTML = `<span class="slot-icon"></span><span class="slot-count"></span>`;
      if (el.classList && el.classList.remove) el.classList.remove('has-item');
    }
    return;
  }

  el.innerHTML = '';

  if (item && item.name) {
    el.classList.add('has-item');

    // 1. Pixelated Item Texture Image
    const img = document.createElement('img');
    img.className = 'mc-item-icon slot-icon';
    img.alt = item.displayName || item.name;
    const texUrl = getItemTextureUrl(item.name);
    if (texUrl) {
      img.src = texUrl;
      img.onerror = () => {
        img.style.display = 'none';
        if (!el.querySelector('.slot-icon-fallback')) {
          const fb = document.createElement('span');
          fb.className = 'slot-icon-fallback slot-icon';
          fb.textContent = getItemIcon(item.name);
          el.insertBefore(fb, el.firstChild);
        }
      };
    } else {
      img.style.display = 'none';
      const fb = document.createElement('span');
      fb.className = 'slot-icon-fallback slot-icon';
      fb.textContent = getItemIcon(item.name);
      el.appendChild(fb);
    }
    el.appendChild(img);

    // 2. Stack count label with Minecraft font
    if (item.count > 1) {
      const countEl = document.createElement('span');
      countEl.className = 'mc-item-count slot-count';
      countEl.textContent = String(item.count);
      el.appendChild(countEl);
    }

    // 3. Durability Bar
    if (item.maxDurability > 0 && item.durabilityUsed > 0) {
      const remaining = Math.max(0, item.maxDurability - item.durabilityUsed);
      const pct = Math.max(0, Math.min(100, Math.round((remaining / item.maxDurability) * 100)));
      const durBar = document.createElement('div');
      durBar.className = 'mc-durability-bar';
      const color = pct > 50 ? '#55ff55' : (pct > 20 ? '#ffff55' : '#ff5555');
      durBar.innerHTML = `<div class="mc-durability-fill" style="width:${pct}%;background:${color}"></div>`;
      el.appendChild(durBar);
    }
  } else {
    el.classList.remove('has-item');
    if (ghostIconUrl) {
      const ghost = document.createElement('img');
      ghost.className = 'slot-ghost-icon';
      ghost.src = ghostIconUrl;
      ghost.alt = '';
      el.appendChild(ghost);
    }
  }
}

/**
 * Render Steve player preview doll with animated head tracking and equipped armor.
 */
function renderPlayerDoll(inv, normX = 0.5, normY = 0.5) {
  const canvas = elements.mcPlayerDollCanvas || (typeof document !== 'undefined' ? document.getElementById('mcPlayerDollCanvas') : null);
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const lookX = Math.max(-1, Math.min(1, (normX - 0.5) * 2));
  const lookY = Math.max(-1, Math.min(1, (normY - 0.5) * 2));

  const scale = 2.0;
  const cx = canvas.width / 2;
  const baseY = canvas.height - 4;

  ctx.save();
  ctx.translate(cx, baseY);

  const getArmorColor = (item) => {
    if (!item || !item.name) return null;
    const n = item.name.toLowerCase();
    if (n.includes('leather')) return '#7f5231';
    if (n.includes('chainmail')) return '#878787';
    if (n.includes('iron')) return '#d8d8d8';
    if (n.includes('golden') || n.includes('gold')) return '#fbe84e';
    if (n.includes('diamond')) return '#4dedf0';
    if (n.includes('netherite')) return '#443a3b';
    return '#aaaaaa';
  };

  const headArmor = getArmorColor(inv?.armor?.head);
  const bodyArmor = getArmorColor(inv?.armor?.torso);
  const legsArmor = getArmorColor(inv?.armor?.legs);
  const feetArmor = getArmorColor(inv?.armor?.feet);

  // 1. Legs
  const legW = 4 * scale;
  const legH = 12 * scale;
  const legY = -legH;

  // Left Leg
  ctx.fillStyle = legsArmor || '#2b367d';
  ctx.fillRect(-legW - 0.5, legY, legW, legH);
  ctx.fillStyle = feetArmor || '#4c4c4c';
  ctx.fillRect(-legW - 0.5, -3 * scale, legW, 3 * scale);

  // Right Leg
  ctx.fillStyle = legsArmor || '#2b367d';
  ctx.fillRect(0.5, legY, legW, legH);
  ctx.fillStyle = feetArmor || '#4c4c4c';
  ctx.fillRect(0.5, -3 * scale, legW, 3 * scale);

  // 2. Torso
  const torsoW = 8 * scale;
  const torsoH = 12 * scale;
  const torsoY = legY - torsoH;
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(-torsoW / 2, torsoY, torsoW, torsoH);

  // Neck skin
  if (!bodyArmor) {
    ctx.fillStyle = '#c68c59';
    ctx.fillRect(-scale, torsoY, 2 * scale, 1.5 * scale);
  }

  // 3. Arms
  const armW = 4 * scale;
  // Left Arm
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(-torsoW / 2 - armW, torsoY, armW, 4 * scale);
  ctx.fillStyle = bodyArmor || '#c68c59';
  ctx.fillRect(-torsoW / 2 - armW, torsoY + 4 * scale, armW, 8 * scale);

  // Right Arm
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(torsoW / 2, torsoY, armW, 4 * scale);
  ctx.fillStyle = bodyArmor || '#c68c59';
  ctx.fillRect(torsoW / 2, torsoY + 4 * scale, armW, 8 * scale);

  // 4. Head
  const headSize = 8 * scale;
  const headY = torsoY - headSize;
  const headOffsetX = lookX * 2.2;
  const headOffsetY = lookY * 1.4;

  ctx.save();
  ctx.translate(headOffsetX, headOffsetY);

  // Skin
  ctx.fillStyle = '#c68c59';
  ctx.fillRect(-headSize / 2, headY, headSize, headSize);

  // Hair
  ctx.fillStyle = '#4a3219';
  ctx.fillRect(-headSize / 2, headY, headSize, 2.5 * scale);
  ctx.fillRect(-headSize / 2, headY + 2.5 * scale, 1 * scale, 3 * scale);
  ctx.fillRect(headSize / 2 - 1 * scale, headY + 2.5 * scale, 1 * scale, 3 * scale);

  // Eyes
  const eyeY = headY + 3.5 * scale;
  const eyeShift = lookX * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-3 * scale + eyeShift, eyeY, 2 * scale, scale);
  ctx.fillStyle = '#29388c';
  ctx.fillRect(-2 * scale + eyeShift, eyeY, scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1 * scale + eyeShift, eyeY, 2 * scale, scale);
  ctx.fillStyle = '#29388c';
  ctx.fillRect(1 * scale + eyeShift, eyeY, scale, scale);

  // Nose / mouth
  ctx.fillStyle = '#9c5936';
  ctx.fillRect(-scale + eyeShift * 0.5, eyeY + 1.5 * scale, 2 * scale, scale);

  // Helmet
  if (headArmor) {
    ctx.fillStyle = headArmor;
    ctx.fillRect(-headSize / 2 - 0.5 * scale, headY - 0.5 * scale, headSize + scale, headSize * 0.7);
    ctx.fillRect(-headSize / 2 - 0.5 * scale, headY, scale, headSize * 0.9);
    ctx.fillRect(headSize / 2 - 0.5 * scale, headY, scale, headSize * 0.9);
  }

  ctx.restore();
  ctx.restore();
}

function renderFullInventory(inv) {
  if (!inv) return;

  // 1. Container Window vs Player Inventory Window
  const isContainerOpen = inv.container && Array.isArray(inv.container.slots) && inv.container.slots.length > 0;

  if (isContainerOpen) {
    if (elements.mcPlayerInventoryWindow) elements.mcPlayerInventoryWindow.classList.add('hidden');
    if (elements.inventoryContainerSection) {
      elements.inventoryContainerSection.classList.remove('hidden');
      const numSlots = inv.container.slots.length;
      if (numSlots > 27) {
        elements.inventoryContainerSection.classList.add('double-chest');
        elements.inventoryContainerSection.classList.remove('single-chest');
      } else {
        elements.inventoryContainerSection.classList.add('single-chest');
        elements.inventoryContainerSection.classList.remove('double-chest');
      }

      if (elements.invContainerTitle) {
        elements.invContainerTitle.textContent = inv.container.title || 'Behälter';
      }

      if (elements.invContainerGrid) {
        elements.invContainerGrid.innerHTML = '';
        inv.container.slots.forEach((item, idx) => {
          const slotEl = createInventorySlotElement(idx, item);
          elements.invContainerGrid.appendChild(slotEl);
        });
      }

      // Container Player Main Grid (inventoryStart .. inventoryStart + 26)
      const invStart = inv.container.inventoryStart !== undefined ? inv.container.inventoryStart : numSlots;
      if (elements.invContainerPlayerMainGrid) {
        elements.invContainerPlayerMainGrid.innerHTML = '';
        const mainItems = Array.isArray(inv.main) ? inv.main : [];
        for (let i = 0; i < 27; i++) {
          const slotIdx = invStart + i;
          const item = mainItems[i] || null;
          const slotEl = createInventorySlotElement(slotIdx, item);
          elements.invContainerPlayerMainGrid.appendChild(slotEl);
        }
      }

      // Container Player Hotbar Grid (inventoryStart + 27 .. inventoryStart + 35)
      if (elements.invContainerPlayerHotbarGrid) {
        elements.invContainerPlayerHotbarGrid.innerHTML = '';
        const hotbarItems = Array.isArray(inv.hotbar) ? inv.hotbar : [];
        for (let i = 0; i < 9; i++) {
          const slotIdx = invStart + 27 + i;
          const item = hotbarItems[i] || null;
          const slotEl = createInventorySlotElement(slotIdx, item);
          if (i === currentSelectedSlot) slotEl.classList.add('active');
          elements.invContainerPlayerHotbarGrid.appendChild(slotEl);
        }
      }
    }
  } else {
    // Normal Player Inventory Window
    if (elements.inventoryContainerSection) elements.inventoryContainerSection.classList.add('hidden');
    if (elements.mcPlayerInventoryWindow) elements.mcPlayerInventoryWindow.classList.remove('hidden');

    // Crafting Output (Slot 0)
    const slot0El = elements.invSlot0 || document.getElementById('invSlot0');
    if (slot0El) {
      renderItemSlotContent(slot0El, inv.craftResult || null, null);
    }

    // 2x2 Crafting Grid (Slots 1, 2, 3, 4)
    const craftingItems = Array.isArray(inv.crafting) ? inv.crafting : [];
    [1, 2, 3, 4].forEach(slotId => {
      const craftEl = document.getElementById(`invSlot${slotId}`);
      if (craftEl) {
        renderItemSlotContent(craftEl, craftingItems[slotId - 1] || null, null);
      }
    });

    // Armor Slots (5, 6, 7, 8) & Offhand (45)
    const armorDefs = [
      { id: 'invSlot5', item: inv.armor?.head, ghost: '/img/mc/empty_armor_slot_helmet.png' },
      { id: 'invSlot6', item: inv.armor?.torso, ghost: '/img/mc/empty_armor_slot_chestplate.png' },
      { id: 'invSlot7', item: inv.armor?.legs, ghost: '/img/mc/empty_armor_slot_leggings.png' },
      { id: 'invSlot8', item: inv.armor?.feet, ghost: '/img/mc/empty_armor_slot_boots.png' },
      { id: 'invSlot45', item: inv.offhand, ghost: '/img/mc/empty_armor_slot_shield.png' }
    ];
    armorDefs.forEach(({ id, item, ghost }) => {
      const el = document.getElementById(id);
      if (el) {
        renderItemSlotContent(el, item, ghost);
      }
    });

    // Steve doll canvas
    renderPlayerDoll(inv);

    // Main Inventory (Slots 9..35 = 27 slots)
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

    // Hotbar Grid (Slots 36..44 = 9 slots)
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
  }

  // Floating Held Item on cursor
  if (elements.gamemodeHeldItemCursor) {
    if (inv.selectedItem && inv.selectedItem.name) {
      elements.gamemodeHeldItemCursor.classList.remove('hidden');
      const icon = elements.gamemodeHeldItemCursor.querySelector('.held-icon');
      const count = elements.gamemodeHeldItemCursor.querySelector('.held-count');
      const texUrl = getItemTextureUrl(inv.selectedItem.name);

      if (icon) {
        if (texUrl && typeof document !== 'undefined' && typeof document.createElement === 'function') {
          icon.innerHTML = `<img src="${texUrl}" class="mc-item-icon" alt="" style="width:32px;height:32px;image-rendering:pixelated">`;
        } else {
          icon.textContent = getItemIcon(inv.selectedItem.name);
        }
      }
      if (count) {
        count.textContent = inv.selectedItem.count > 1 ? String(inv.selectedItem.count) : '';
      }
    } else {
      elements.gamemodeHeldItemCursor.classList.add('hidden');
    }
  }
}

function createInventorySlotElement(slotIndex, item) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return {
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      dataset: { slot: String(slotIndex) },
      _itemData: item,
      innerHTML: ''
    };
  }

  const el = document.createElement('div');
  el.className = 'mc-slot inv-slot';
  el.dataset.slot = String(slotIndex);
  renderItemSlotContent(el, item, null);

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
      if (isInventoryOpen && hoveredSlotIndex !== null) {
        // Swap hovered slot item with hotbar slot (Minecraft Mode 2)
        sendWS({
          type: 'inventory_click',
          slot: hoveredSlotIndex,
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
      if (isInventoryOpen && hoveredSlotIndex !== null) {
        // Swap hovered slot item with offhand (button 40 in mode 2)
        sendWS({
          type: 'inventory_click',
          slot: hoveredSlotIndex,
          button: 40,
          mode: 2
        });
      } else {
        sendWS({ type: 'manual_action', action: 'swap_hands' });
      }
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

  isLeftMouseDown = false;
  isRightMouseDown = false;
  if (continuousMiningInterval) {
    clearInterval(continuousMiningInterval);
    continuousMiningInterval = null;
  }
  if (continuousPlaceInterval) {
    clearInterval(continuousPlaceInterval);
    continuousPlaceInterval = null;
  }
  currentMiningBlockKey = null;
  hideDigProgress();

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

function showDigProgress(percent, label = '') {
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

function hideDigProgress() {
  if (elements.gamemodeDigProgress && elements.gamemodeDigProgress.classList) {
    elements.gamemodeDigProgress.classList.add('hidden');
    if (elements.digProgressFill) elements.digProgressFill.style.width = '0%';
    if (elements.digProgressText) elements.digProgressText.textContent = '0%';
  }
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
    isLeftMouseDown = true;
    currentMiningStartTime = Date.now();
    estimatedMiningDuration = (lastRaycastData && lastRaycastData.digTime) ? lastRaycastData.digTime : 800;
    currentMiningBlockKey = (lastRaycastData && lastRaycastData.position)
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
    if (continuousMiningInterval) clearInterval(continuousMiningInterval);
    continuousMiningInterval = setInterval(() => {
      if (!isLeftMouseDown || !isGamemodeActive) {
        clearInterval(continuousMiningInterval);
        continuousMiningInterval = null;
        hideDigProgress();
        return;
      }

      if (lastRaycastData?.type === 'block' && lastRaycastData.position) {
        const blockKey = `${lastRaycastData.position.x},${lastRaycastData.position.y},${lastRaycastData.position.z}`;
        if (blockKey !== currentMiningBlockKey) {
          // Changed target block while holding left click -> dig new block
          currentMiningBlockKey = blockKey;
          currentMiningStartTime = Date.now();
          estimatedMiningDuration = lastRaycastData.digTime || 800;
          sendWS({
            type: 'manual_action',
            action: 'dig_start',
            targetBlockPos: lastRaycastData.position,
            targetFace: lastRaycastData.faceVector
          });
        }

        const elapsed = Date.now() - currentMiningStartTime;
        const pct = Math.min(100, (elapsed / estimatedMiningDuration) * 100);
        const name = lastRaycastData.displayName || lastRaycastData.name || 'Block';
        showDigProgress(pct, `Abbau: ${name}`);
      } else {
        hideDigProgress();
      }
    }, 50);

  } else if (e.button === 2) {
    // Right-click: place block or use item (eating, drinking, bow, shield)
    if (typeof e.preventDefault === 'function') e.preventDefault();
    isRightMouseDown = true;

    sendWS({
      type: 'manual_action',
      action: 'place',
      targetBlockPos: lastRaycastData?.position,
      targetFace: lastRaycastData?.faceVector
    });
    sendWS({ type: 'manual_action', action: 'use_item_start' });

    // Auto-repeat placement while holding right-click (Minecraft style)
    if (continuousPlaceInterval) clearInterval(continuousPlaceInterval);
    continuousPlaceInterval = setInterval(() => {
      if (!isRightMouseDown || !isGamemodeActive) {
        clearInterval(continuousPlaceInterval);
        continuousPlaceInterval = null;
        return;
      }
      sendWS({
        type: 'manual_action',
        action: 'place',
        targetBlockPos: lastRaycastData?.position,
        targetFace: lastRaycastData?.faceVector
      });
    }, 200);
  }
}

function onMouseUp(e) {
  if (!isGamemodeActive) return;

  if (e.button === 0) {
    isLeftMouseDown = false;
    if (continuousMiningInterval) {
      clearInterval(continuousMiningInterval);
      continuousMiningInterval = null;
    }
    currentMiningBlockKey = null;
    hideDigProgress();
    sendWS({ type: 'manual_action', action: 'dig_stop' });
  } else if (e.button === 2) {
    isRightMouseDown = false;
    if (continuousPlaceInterval) {
      clearInterval(continuousPlaceInterval);
      continuousPlaceInterval = null;
    }
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
    lastRaycastData = msg.raycast;
    renderRaycast(msg.raycast);
  }

  // 7. Live Digging Telemetry Sync
  if (msg.manualControl) {
    if (msg.manualControl.isDigging && typeof msg.manualControl.digProgress === 'number') {
      const pct = Math.round(msg.manualControl.digProgress * 100);
      showDigProgress(pct, `Abbau: ${lastRaycastData?.displayName || lastRaycastData?.name || 'Block'}`);
    } else if (!isLeftMouseDown) {
      hideDigProgress();
    }
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
      html += '<span class="heart-icon full"><img class="mc-hud-icon" src="/img/mc/heart_full.png" alt="❤"></span>';
    } else if (i === fullHearts && hasHalf) {
      html += '<span class="heart-icon half"><img class="mc-hud-icon" src="/img/mc/heart_half.png" alt="❤"></span>';
    } else {
      html += '<span class="heart-icon empty"><img class="mc-hud-icon" src="/img/mc/heart_empty.png" alt="🖤"></span>';
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
      html += '<span class="food-icon full"><img class="mc-hud-icon" src="/img/mc/food_full.png" alt="🍗"></span>';
    } else if (i === full && hasHalf) {
      html += '<span class="food-icon half"><img class="mc-hud-icon" src="/img/mc/food_half.png" alt="🍗"></span>';
    } else {
      html += '<span class="food-icon empty"><img class="mc-hud-icon" src="/img/mc/food_empty.png" alt="🍗"></span>';
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
    const offhandItem = lastFullInventory ? lastFullInventory.offhand : null;
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      renderItemSlotContent(elements.hudOffhandSlot, offhandItem, '/img/mc/empty_armor_slot_shield.png');
    }
  }
}

import { getItemIcon } from './gamemode/itemIcons.js';
export { getItemIcon };

function renderRaycast(raycast) {
  lastRaycastData = raycast;
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
