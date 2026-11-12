/**
 * Shared state and context for Three.js 3D Viewport submodules.
 */

export const threeCtx = {
  scene: null,
  camera: null,
  renderer: null,
  controls: null,
  transformControls: null,
  containerResizeObserver: null,
  isContextLost: false,

  voxelGroup: null,
  terrainGroup: null,
  sceneObjectsGroup: null,
  verifierGroup: null,
  measureGroup: null,
  selectionBoxGizmo: null,

  ambientLightRef: null,
  dirLightRef: null,
  fillLightRef: null,
  hemiLightRef: null,
  gridHelperRef: null,

  voxelMeshMap: new Map(), // key "x,y,z" -> THREE.Mesh
  objectGroupMap: new Map(), // objectId -> THREE.Group

  raycaster: null,
  mouse: null,

  activeTool: 'orbit',
  brushSize: 1,
  renderMode: 'textures',
  lastPreviewData: null,
  currentBounds: null,
  selectBoxStep: 0,
  selectBoxCorner1: null,
  currentSelectionBox: null,
  isXrayActive: false,
  xrayMeshes: [],
  measureStep: 0,
  measurePoint1: null,
  sunTimeOfDay: 12.0,
  isSyncingTransform: false
};
