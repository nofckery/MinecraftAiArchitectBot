/**
 * Architect Mission Control — Three.js 3D Viewport & Interactive CAD Submodule
 * Manages 3D scene, OrbitControls, voxel preview rendering, interactive CAD tools,
 * X-Ray inspection, BOM generation, and palette swapping.
 */

import { threeCtx } from './three/threeContext.js';
import { BLOCK_COLORS, getBlockColor } from './three/threePalette.js';
import {
  initThree,
  destroyThreeViewport,
  setSunTimeOfDay,
  setThreeCoreDependencies
} from './three/threeCore.js';
import {
  renderStudioTerrain,
  renderSceneGraphObjects,
  attachGizmoToActiveObject,
  setTransformGizmoMode,
  setStudioTerrainVisibility,
  setStudioTerrainDependencies
} from './three/threeStudioTerrain.js';
import {
  getCurrentSelectionBox,
  updateSelectionGizmo,
  clearSelectionBox,
  setActiveTool,
  renderMeasureLine,
  setViewTop,
  setViewIso,
  resetFocus,
  setViewCardinal,
  onThreePointerDown
} from './three/threeGizmos.js';
import {
  renderBOM,
  openSwapModal,
  applyTheme,
  renderVerifierOverlay,
  setVerifierOverlayVisible
} from './three/threeUI.js';
import {
  setRenderMode,
  getRenderMode,
  setBrushSize,
  getBrushSize,
  setXrayActive,
  getXrayActive,
  setGhostOpacity,
  renderVoxelPreview,
  renderTerrainXray,
  handleVoxelDelta,
  applyYSlice,
  applyDualYSlice
} from './three/threeVoxelRenderer.js';

// Wire up cross-submodule dependencies
setThreeCoreDependencies({ resizeThreeViewport, onThreePointerDown });
setStudioTerrainDependencies({ setActiveTool });

/**
 * Resizes the Three.js viewport canvas and projection matrix to prevent distortion.
 * Includes Math.max(100, ...) guards against collapsed containers.
 * @param {number} [explicitW]
 * @param {number} [explicitH]
 */
export function resizeThreeViewport(explicitW, explicitH) {
  const container = document.getElementById('threeContainer');
  const camera = threeCtx.camera;
  const renderer = threeCtx.renderer;
  if (!container || !camera || !renderer) return;

  const w = explicitW !== undefined ? Math.max(100, explicitW) : Math.max(100, container.clientWidth);
  const h = explicitH !== undefined ? Math.max(100, explicitH) : Math.max(100, container.clientHeight);

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  if (typeof window !== 'undefined' && renderer.setPixelRatio) {
    renderer.setPixelRatio(window.devicePixelRatio || 1);
  }
  renderer.setSize(w, h);
}

// Re-exports for 100% backward compatibility
export {
  BLOCK_COLORS,
  getBlockColor,
  initThree,
  destroyThreeViewport,
  setSunTimeOfDay,
  setRenderMode,
  getRenderMode,
  setBrushSize,
  getBrushSize,
  setXrayActive,
  getXrayActive,
  setGhostOpacity,
  renderVoxelPreview,
  renderTerrainXray,
  handleVoxelDelta,
  applyYSlice,
  applyDualYSlice,
  renderStudioTerrain,
  renderSceneGraphObjects,
  attachGizmoToActiveObject,
  setTransformGizmoMode,
  setStudioTerrainVisibility,
  getCurrentSelectionBox,
  updateSelectionGizmo,
  clearSelectionBox,
  setActiveTool,
  renderMeasureLine,
  setViewTop,
  setViewIso,
  resetFocus,
  setViewCardinal,
  renderBOM,
  openSwapModal,
  applyTheme,
  renderVerifierOverlay,
  setVerifierOverlayVisible
};
