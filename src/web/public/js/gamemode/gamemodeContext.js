/**
 * Shared state and context for Minecraft Gamemode submodules.
 */

export const gamemodeCtx = {
  isGamemodeActive: false,
  isPopoutMode: false,
  broadcastChannel: null,

  // Movement state tracking
  movementState: {
    forward: false,
    back: false,
    left: false,
    right: false,
    jump: false,
    sprint: false,
    sneak: false
  },

  // Look angles & deltas
  currentYaw: 0,
  currentPitch: 0,
  accumulatedDeltaX: 0,
  accumulatedDeltaY: 0,
  lookAnimationFrame: null,

  // Sensitivity & Settings
  mouseSensitivityMultiplier: 1.0,

  // Hotbar & Active State
  currentSelectedSlot: 0,
  lastHotbarData: [],
  lastFullInventory: null,
  hoveredSlotIndex: null,

  // Minecraft Item Textures Cache
  itemTexturesMap: {},
  texturesLoading: false,

  // Interaction & Mining States
  lastRaycastData: null,
  isLeftMouseDown: false,
  isRightMouseDown: false,
  continuousMiningInterval: null,
  continuousPlaceInterval: null,
  currentMiningBlockKey: null,
  currentMiningStartTime: 0,
  estimatedMiningDuration: 1000,

  // UI States
  isChatOpen: false,
  isInventoryOpen: false,
  isPauseMenuOpen: false,
  isHelpOpen: false,
  isTabListVisible: false,
  lastPlayersList: [],
  lastTablistData: { header: null, footer: null },
  chatHistory: [],
  chatHistoryIndex: -1,

  // DOM References Cache
  elements: {}
};

// Initialize sensitivity from localStorage if available
try {
  if (typeof localStorage !== 'undefined') {
    const savedSens = localStorage.getItem('mc_sensitivity');
    if (savedSens) gamemodeCtx.mouseSensitivityMultiplier = parseFloat(savedSens);
  }
} catch {}
