/**
 * App Event Listeners Orchestrator
 * Coordinates modular event submodules under ./events/ (mapEvents, cadStudioEvents,
 * viewerEvents, hotkeyEvents, toolbarEvents).
 */

import {
  renderAreaMap,
  getAreaMapData,
  setAreaMapData,
  getMapSelection,
  getBuildBoxFacing,
  setBuildBoxFacing,
  setupMapEvents
} from './mapEvents.js';
import { setupCadStudioEvents } from './cadStudioEvents.js';
import { setupViewerEvents } from './viewerEvents.js';
import { setupHotkeyEvents } from './hotkeyEvents.js';
import { setupToolbarEvents } from './toolbarEvents.js';
import { initBlockCatalog } from '../studio/cadStudioController.js';

export {
  renderAreaMap,
  getAreaMapData,
  setAreaMapData,
  getMapSelection,
  getBuildBoxFacing,
  setBuildBoxFacing
};

export function initEventListeners() {
  // 1. 2D Map events
  setupMapEvents();

  // 2. Viewer & Navigation tabs
  setupViewerEvents();

  // 3. Toolbar, brush, action buttons & bot power
  setupToolbarEvents();

  // 4. CAD World Studio & Scene graph
  setupCadStudioEvents();

  // 5. Global hotkeys & clipboard
  setupHotkeyEvents();

  // 6. Block catalog autocomplete
  initBlockCatalog();
}
