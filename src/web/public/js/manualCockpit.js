/**
 * Architect Mission Control — Manual Gamemode & First-Person Cockpit Orchestrator
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
 * - Pitch clamping boundaries [-89.4, +89.4]
 */

import { sendWS } from './wsClient.js';
import { gamemodeCtx } from './gamemode/gamemodeContext.js';
import { getItemIcon } from './gamemode/itemIcons.js';
import {
  openChat,
  closeChat,
  sendChatMessage,
  handleIncomingChat,
  setChatDependencies
} from './gamemode/gamemodeChat.js';
import {
  openInventory,
  closeInventory,
  toggleInventory,
  loadItemTextures,
  getItemTextureUrl,
  handleInventorySlotClick,
  showSlotTooltip,
  hideSlotTooltip,
  renderFullInventory,
  setInventoryDependencies
} from './gamemode/gamemodeInventory.js';
import { renderPlayerDoll } from './gamemode/gamemodeDoll.js';
import {
  renderHearts,
  renderFood,
  renderHotbar,
  renderRaycast,
  selectHotbarSlot,
  handleTelemetryUpdate,
  handleGamemodeState,
  setHudDependencies
} from './gamemode/gamemodeHud.js';
import {
  requestPointerLock,
  onPointerLockChange,
  onPointerLockError,
  onFullscreenChange,
  openPauseMenu,
  closePauseMenu,
  clearAllControls,
  showDigProgress,
  hideDigProgress,
  onMouseMove,
  flushLookDeltas,
  onMouseDown,
  onMouseUp,
  onMouseWheel,
  onKeyDown,
  onKeyUp,
  openGamemodeHelp,
  closeGamemodeHelp,
  toggleGamemodeHelp,
  setInputDependencies
} from './gamemode/gamemodeInput.js';
import {
  getPingBarsHtml,
  renderTabList,
  showTabList,
  hideTabList,
  isTabListOpen,
  getPlayersList
} from './gamemode/gamemodeTablist.js';

// Wire cross-module dependencies
setChatDependencies({ requestPointerLock, clearAllControls, closeInventory, closePauseMenu });
setInventoryDependencies({ requestPointerLock, clearAllControls, closeChat, closePauseMenu, renderHotbar });
setHudDependencies({ exitGamemode, showDigProgress, hideDigProgress });
setInputDependencies({ exitGamemode });

// Pitch clamping boundary contracts [-89.4, +89.4]
export const MINECRAFT_MAX_PITCH = 89.4;
export const MINECRAFT_MIN_PITCH = -89.4;

/**
 * Initialize Manual Cockpit DOM listeners and HUD elements.
 */
export function initManualCockpit() {
  if (typeof document === 'undefined') return;

  gamemodeCtx.elements = {
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
    btnGamemodeRespawn: document.getElementById('btnGamemodeRespawn'),

    // Minecraft Player List (Tablist)
    gamemodePlayerTablist: document.getElementById('gamemodePlayerTablist'),
    mcTablistHeader: document.getElementById('mcTablistHeader'),
    mcTablistPlayerCount: document.getElementById('mcTablistPlayerCount'),
    mcTablistPlayerGrid: document.getElementById('mcTablistPlayerGrid'),
    mcTablistFooter: document.getElementById('mcTablistFooter'),

    // Controls Cheat Sheet & Help Overlay
    btnGamemodeHelp: document.getElementById('btnGamemodeHelp'),
    gamemodeHelpOverlay: document.getElementById('gamemodeHelpOverlay'),
    btnCloseGamemodeHelp: document.getElementById('btnCloseGamemodeHelp'),
    btnDismissHelpFooter: document.getElementById('btnDismissHelpFooter'),
    btnOpenHelpFromPause: document.getElementById('btnOpenHelpFromPause')
  };

  const elements = gamemodeCtx.elements;

  // BroadcastChannel for cross-window / popout sync
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      gamemodeCtx.broadcastChannel = new BroadcastChannel('mc_gamemode_sync');
      gamemodeCtx.broadcastChannel.onmessage = handlePopoutBroadcast;
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
  if (elements.btnGamemodeHelp) {
    elements.btnGamemodeHelp.onclick = () => toggleGamemodeHelp();
  }
  if (elements.btnCloseGamemodeHelp) {
    elements.btnCloseGamemodeHelp.onclick = () => closeGamemodeHelp();
  }
  if (elements.btnDismissHelpFooter) {
    elements.btnDismissHelpFooter.onclick = () => closeGamemodeHelp();
  }
  if (elements.btnOpenHelpFromPause) {
    elements.btnOpenHelpFromPause.onclick = () => {
      closePauseMenu();
      openGamemodeHelp();
    };
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
      el.onmouseenter = () => { gamemodeCtx.hoveredSlotIndex = slotId; showSlotTooltip(el, slotId); };
      el.onmouseleave = () => { if (gamemodeCtx.hoveredSlotIndex === slotId) gamemodeCtx.hoveredSlotIndex = null; hideSlotTooltip(); };
    }
  });

  // Clicking outside inventory window (backdrop) drops held cursor item (slot: -999)
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.addEventListener('click', (e) => {
      if (e.target === elements.gamemodeInventoryModal && gamemodeCtx.lastFullInventory && gamemodeCtx.lastFullInventory.selectedItem) {
        sendWS({ type: 'inventory_click', slot: -999, button: 0, mode: 0 });
      }
    });
    elements.gamemodeInventoryModal.addEventListener('contextmenu', (e) => {
      if (e.target === elements.gamemodeInventoryModal && gamemodeCtx.lastFullInventory && gamemodeCtx.lastFullInventory.selectedItem) {
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
        renderPlayerDoll(gamemodeCtx.lastFullInventory, normX, normY);
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
    elements.sliderMouseSensitivity.value = Math.round(gamemodeCtx.mouseSensitivityMultiplier * 100);
    if (elements.lblMouseSensitivity) {
      elements.lblMouseSensitivity.textContent = `${Math.round(gamemodeCtx.mouseSensitivityMultiplier * 100)}%`;
    }
    elements.sliderMouseSensitivity.oninput = (e) => {
      const val = parseInt(e.target.value, 10);
      gamemodeCtx.mouseSensitivityMultiplier = val / 100;
      if (elements.lblMouseSensitivity) {
        elements.lblMouseSensitivity.textContent = `${val}%`;
      }
      try {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('mc_sensitivity', String(gamemodeCtx.mouseSensitivityMultiplier));
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
  const targetState = forceState !== undefined ? forceState : !gamemodeCtx.isGamemodeActive;
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
  if (gamemodeCtx.isGamemodeActive) return;
  gamemodeCtx.isGamemodeActive = true;
  const elements = gamemodeCtx.elements;

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
  if (!gamemodeCtx.isGamemodeActive) return;
  gamemodeCtx.isGamemodeActive = false;
  const elements = gamemodeCtx.elements;

  // Close modals & overlays
  closeChat();
  closeInventory();
  closePauseMenu();
  closeGamemodeHelp();
  hideTabList();

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
    gamemodeCtx.isPopoutMode = true;
    const elements = gamemodeCtx.elements;
    if (elements.viewerFrame) elements.viewerFrame.src = 'about:blank';
    if (elements.viewerDetachedPlaceholder) elements.viewerDetachedPlaceholder.classList.remove('hidden');
    if (gamemodeCtx.broadcastChannel) {
      gamemodeCtx.broadcastChannel.postMessage({ type: 'popout_opened' });
    }
  }
}

/**
 * Re-embed Gamemode back into main cockpit.
 */
export function reattachGamemode() {
  gamemodeCtx.isPopoutMode = false;
  const elements = gamemodeCtx.elements;
  if (elements.viewerDetachedPlaceholder) elements.viewerDetachedPlaceholder.classList.add('hidden');
  if (elements.viewerFrame && typeof document !== 'undefined') {
    const port = document.getElementById('lblViewerPort')?.textContent || 3081;
    const protocol = typeof window !== 'undefined' ? window.location.protocol : 'http:';
    const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
    elements.viewerFrame.src = `${protocol}//${hostname}:${port}`;
  }
  if (gamemodeCtx.broadcastChannel) {
    gamemodeCtx.broadcastChannel.postMessage({ type: 'popout_closed' });
  }
}

/**
 * Toggle browser fullscreen on viewer container.
 */
export function toggleFullscreen() {
  if (typeof document === 'undefined') return;
  const elements = gamemodeCtx.elements;
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
 * Return whether Gamemode is currently active.
 * @returns {boolean}
 */
export function isGamemode() {
  return gamemodeCtx.isGamemodeActive;
}

/**
 * Return whether popout mode is currently active.
 * @returns {boolean}
 */
export function isPopoutActive() {
  return gamemodeCtx.isPopoutMode;
}

// Re-exports for 100% backward compatibility
export {
  openChat,
  closeChat,
  sendChatMessage,
  handleIncomingChat,
  openInventory,
  closeInventory,
  toggleInventory,
  loadItemTextures,
  getItemTextureUrl,
  getItemIcon,
  openPauseMenu,
  closePauseMenu,
  clearAllControls,
  selectHotbarSlot,
  handleTelemetryUpdate,
  handleGamemodeState,
  showTabList,
  hideTabList,
  renderTabList,
  isTabListOpen,
  getPingBarsHtml,
  getPlayersList
};
