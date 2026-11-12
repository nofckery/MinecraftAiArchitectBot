/**
 * Architect Mission Control — CAD World Studio Multi-Object Scene Graph
 * Manages multiple placed schematics/structures in a shared 3D Minecraft world scene,
 * including Undo/Redo history stack, Solo isolation mode, Ground Snapping,
 * Master Bill of Materials (BOM), and real-time Spatial AI context synchronization.
 */

const MAX_HISTORY_STEPS = 35;

const FACING_BY_ROTATION = {
  0: 'north',
  90: 'east',
  180: 'south',
  270: 'west'
};

const ROTATION_BY_FACING = {
  north: 0,
  east: 90,
  south: 180,
  west: 270
};

let sceneObjects = [];
let activeObjectId = null;
let soloObjectId = null;
let terrainData = null;
let terrainVisible = true;
let verifierReport = null;
let verifierOverlayEnabled = true;
let globalGhostOpacity = 1.0;
let userDeltas = [];

const undoStack = [];
const redoStack = [];
const listeners = new Set();

function cloneObjectsState(objs) {
  return objs.map(o => ({
    ...o,
    position: { ...(o.position || { x: 0, y: 64, z: 0 }) },
    bounds: o.bounds ? { ...o.bounds } : { width: 16, height: 16, depth: 16 },
    bom: o.bom ? { ...o.bom } : {},
    blocks: Array.isArray(o.blocks) ? o.blocks.map(b => ({ ...b, properties: b.properties ? { ...b.properties } : {} })) : []
  }));
}

function pushUndoSnapshot(actionLabel = '') {
  undoStack.push({
    objects: cloneObjectsState(sceneObjects),
    activeObjectId,
    actionLabel
  });
  if (undoStack.length > MAX_HISTORY_STEPS) {
    undoStack.shift();
  }
  redoStack.length = 0;
}

export function recordStudioUserDelta(description) {
  if (!description) return;
  const entry = `${description}`;
  userDeltas.push(entry);
  if (userDeltas.length > 30) {
    userDeltas.shift();
  }
}

function notifyListeners(reason = 'update', deltaMessage = null) {
  if (deltaMessage) {
    recordStudioUserDelta(deltaMessage);
  }
  const snapshot = getSceneSnapshot();
  for (const fn of listeners) {
    try {
      fn(snapshot, reason, deltaMessage);
    } catch {}
  }
}

export function onSceneGraphChange(callback) {
  if (typeof callback === 'function') {
    listeners.add(callback);
  }
  return () => listeners.delete(callback);
}

export function getSceneObjects() {
  return sceneObjects;
}

export function getActiveObjectId() {
  return activeObjectId;
}

export function getActiveObject() {
  return sceneObjects.find(o => o.id === activeObjectId) || null;
}

export function getSoloObjectId() {
  return soloObjectId;
}

export function setSoloObjectId(id) {
  soloObjectId = soloObjectId === id ? null : id;
  notifyListeners('solo_changed');
  return soloObjectId;
}

export function toggleSoloObject(id = activeObjectId) {
  return setSoloObjectId(id);
}

export function getTerrainData() {
  return terrainData;
}

export function setTerrainData(terrain) {
  terrainData = terrain || null;
  notifyListeners('terrain_updated', terrain ? `Gelände gescannt (${terrain.source}, Radius ${terrain.radius})` : null);
  return terrainData;
}

export function isTerrainVisible() {
  return terrainVisible;
}

export function setTerrainVisible(visible) {
  terrainVisible = Boolean(visible);
  notifyListeners('terrain_visibility');
  return terrainVisible;
}

export function getVerifierReport() {
  return verifierReport;
}

export function setVerifierReport(report) {
  verifierReport = report || null;
  notifyListeners('verifier_updated');
  return verifierReport;
}

export function isVerifierOverlayEnabled() {
  return verifierOverlayEnabled;
}

export function setVerifierOverlayEnabled(enabled) {
  verifierOverlayEnabled = Boolean(enabled);
  notifyListeners('verifier_toggle');
  return verifierOverlayEnabled;
}

export function getGlobalGhostOpacity() {
  return globalGhostOpacity;
}

export function setGlobalGhostOpacity(opacity) {
  const num = parseFloat(opacity);
  globalGhostOpacity = Number.isFinite(num) ? Math.max(0.15, Math.min(1.0, num)) : 1.0;
  notifyListeners('opacity_changed');
  return globalGhostOpacity;
}

export function computeBoundsFromBlocks(blocks = []) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, width: 1, height: 1, depth: 1, count: 0 };
  }
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const b of blocks) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
  }

  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    width: Math.max(1, maxX - minX + 1),
    height: Math.max(1, maxY - minY + 1),
    depth: Math.max(1, maxZ - minZ + 1),
    count: blocks.length
  };
}

export function computeBomFromBlocks(blocks = []) {
  const bom = {};
  for (const b of blocks) {
    if (!b) continue;
    const blockName = b.name || b.block;
    if (!blockName || blockName === 'air') continue;
    bom[blockName] = (bom[blockName] || 0) + 1;
  }
  return bom;
}

/**
 * Adds a new object (schematic or AI build) into the Scene Graph.
 */
export function addSceneObject(spec = {}, options = {}) {
  const replaceActiveIfSingle = Boolean(options.replaceIfDefault);
  if (!options.skipUndo) {
    pushUndoSnapshot(`Add ${spec.name || 'Objekt'}`);
  }

  const blocks = Array.isArray(spec.blocks) ? spec.blocks : [];
  const bounds = spec.bounds || computeBoundsFromBlocks(blocks);
  const bom = spec.bom || computeBomFromBlocks(blocks);

  // Determine smart non-overlapping initial world position if not explicitly given
  let defaultPos = { x: 0, y: 64, z: 0 };
  if (terrainData?.center) {
    defaultPos = { ...terrainData.center };
  }

  if (!spec.position && sceneObjects.length > 0 && !replaceActiveIfSingle) {
    // Offset next to the last placed building so they don't stack identically
    const last = sceneObjects[sceneObjects.length - 1];
    const lastW = last.bounds?.width || 14;
    defaultPos = {
      x: (last.position?.x || 0) + lastW + 4,
      y: last.position?.y || 64,
      z: last.position?.z || 0
    };
  }

  const pos = spec.position
    ? {
        x: Math.floor(Number(spec.position.x) || 0),
        y: Math.floor(Number(spec.position.y) ?? 64),
        z: Math.floor(Number(spec.position.z) || 0)
      }
    : defaultPos;

  // Auto-snap Y to terrain surface if terrain heightMap is available and no explicit Y was forced
  if (terrainData?.heightMap && !spec.preserveExactY && spec.position?.y === undefined) {
    const midX = Math.round(pos.x + (bounds.width || 12) / 2);
    const midZ = Math.round(pos.z + (bounds.depth || 12) / 2);
    const surfY = terrainData.heightMap[`${midX},${midZ}`] ?? terrainData.heightMap[`${pos.x},${pos.z}`];
    if (surfY !== undefined) {
      pos.y = surfY + 1;
    }
  }

  const rot = Number.isFinite(Number(spec.rotation))
    ? (((Number(spec.rotation) % 360) + 360) % 360)
    : (ROTATION_BY_FACING[spec.facing] ?? 0);
  const facing = FACING_BY_ROTATION[rot] || spec.facing || 'north';

  const newObj = {
    id: spec.id || `obj_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: spec.name || `Bauwerk ${sceneObjects.length + 1}`,
    sourceFilename: spec.sourceFilename || null,
    sourceCode: spec.sourceCode || null,
    position: pos,
    rotation: rot,
    facing,
    visible: spec.visible !== false,
    locked: Boolean(spec.locked),
    isInfrastructure: Boolean(spec.isInfrastructure),
    opacity: Number.isFinite(Number(spec.opacity)) ? Number(spec.opacity) : 1.0,
    bounds,
    blocks,
    bom,
    doorways: Array.isArray(spec.doorways) ? spec.doorways : [],
    lintReport: spec.lintReport || null
  };

  if (replaceActiveIfSingle && sceneObjects.length === 1 && sceneObjects[0].isAutoPreview) {
    newObj.isAutoPreview = Boolean(spec.isAutoPreview);
    sceneObjects[0] = newObj;
  } else {
    newObj.isAutoPreview = Boolean(spec.isAutoPreview);
    sceneObjects.push(newObj);
  }

  activeObjectId = newObj.id;
  notifyListeners('object_added', `Objekt "${newObj.name}" zur Szene hinzugefügt bei (${pos.x}, ${pos.y}, ${pos.z})`);
  return newObj;
}

export function updateSceneObject(objectId, patch = {}, deltaText = null) {
  const idx = sceneObjects.findIndex(o => o.id === objectId);
  if (idx === -1) return null;

  const target = sceneObjects[idx];
  if (target.locked && patch.locked === undefined) return target;

  if (!patch.skipUndo) {
    pushUndoSnapshot(`Update ${target.name}`);
  }

  if (patch.name !== undefined) target.name = String(patch.name).trim() || target.name;
  if (patch.visible !== undefined) target.visible = Boolean(patch.visible);
  if (patch.locked !== undefined) target.locked = Boolean(patch.locked);
  if (patch.opacity !== undefined) target.opacity = Math.max(0.15, Math.min(1.0, Number(patch.opacity) || 1.0));

  if (patch.position) {
    target.position = {
      x: Math.round(Number(patch.position.x ?? target.position.x)),
      y: Math.round(Number(patch.position.y ?? target.position.y)),
      z: Math.round(Number(patch.position.z ?? target.position.z))
    };
  }

  if (patch.rotation !== undefined) {
    const normRot = ((Math.round(Number(patch.rotation) / 90) * 90) % 360 + 360) % 360;
    target.rotation = normRot;
    target.facing = FACING_BY_ROTATION[normRot] || 'north';
  } else if (patch.facing && ROTATION_BY_FACING[patch.facing] !== undefined) {
    target.facing = patch.facing;
    target.rotation = ROTATION_BY_FACING[patch.facing];
  }

  if (Array.isArray(patch.blocks)) {
    target.blocks = patch.blocks;
    target.bounds = patch.bounds || computeBoundsFromBlocks(patch.blocks);
    target.bom = patch.bom || computeBomFromBlocks(patch.blocks);
  }

  if (patch.lintReport !== undefined) target.lintReport = patch.lintReport;
  if (patch.sourceCode !== undefined) target.sourceCode = patch.sourceCode;

  notifyListeners(
    'object_updated',
    deltaText || `Objekt "${target.name}" aktualisiert: Pos(${target.position.x},${target.position.y},${target.position.z}), Rot(${target.rotation}°)`
  );
  return target;
}

export function selectSceneObject(objectId) {
  if (activeObjectId === objectId) return getActiveObject();
  activeObjectId = objectId;
  notifyListeners('selection_changed');
  return getActiveObject();
}

export function removeSceneObject(objectId) {
  const idx = sceneObjects.findIndex(o => o.id === objectId);
  if (idx === -1) return false;
  const removed = sceneObjects[idx];
  pushUndoSnapshot(`Remove ${removed.name}`);
  sceneObjects.splice(idx, 1);
  if (soloObjectId === objectId) soloObjectId = null;
  if (activeObjectId === objectId) {
    activeObjectId = sceneObjects[sceneObjects.length - 1]?.id || null;
  }
  notifyListeners('object_removed', `Objekt "${removed.name}" aus Szene entfernt`);
  return true;
}

export function duplicateSceneObject(objectId) {
  const orig = sceneObjects.find(o => o.id === objectId);
  if (!orig) return null;
  pushUndoSnapshot(`Duplicate ${orig.name}`);
  const w = orig.bounds?.width || 12;
  const copy = addSceneObject({
    ...orig,
    id: `obj_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
    name: `${orig.name} (Kopie)`,
    position: {
      x: orig.position.x + w + 3,
      y: orig.position.y,
      z: orig.position.z
    },
    blocks: orig.blocks.map(b => ({ ...b, properties: b.properties ? { ...b.properties } : {} }))
  }, { skipUndo: true });
  return copy;
}

/**
 * Snaps the specified object (or active object) cleanly onto the scanned terrain surface beneath its footprint.
 * @param {string} [objectId]
 * @param {'max'|'avg'|'min'} [mode='max']
 */
export function snapObjectToGround(objectId = activeObjectId, mode = 'max') {
  const obj = sceneObjects.find(o => o.id === (objectId || activeObjectId));
  if (!obj || obj.locked) return null;

  const heightMap = terrainData?.heightMap || {};
  const w = obj.bounds?.width || 12;
  const d = obj.bounds?.depth || 12;
  const spanX = (obj.rotation === 90 || obj.rotation === 270) ? d : w;
  const spanZ = (obj.rotation === 90 || obj.rotation === 270) ? w : d;

  const samples = [];
  for (let x = obj.position.x; x < obj.position.x + spanX; x++) {
    for (let z = obj.position.z; z < obj.position.z + spanZ; z++) {
      const sy = heightMap[`${x},${z}`];
      if (sy !== undefined) samples.push(sy);
    }
  }

  let targetY = terrainData?.center?.y ?? 64;
  if (samples.length > 0) {
    if (mode === 'min') {
      targetY = Math.min(...samples) + 1;
    } else if (mode === 'avg') {
      targetY = Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) + 1;
    } else {
      targetY = Math.max(...samples) + 1;
    }
  }

  return updateSceneObject(
    obj.id,
    { position: { x: obj.position.x, y: targetY, z: obj.position.z } },
    `Objekt "${obj.name}" per Snap-to-Ground (${mode}) auf Geländehöhe Y=${targetY} gesetzt`
  );
}

/**
 * Applies a single local voxel edit (brush / eraser) to the active object in the Scene Graph.
 */
export function applyVoxelEditToSceneObject(objectId, localX, localY, localZ, blockString) {
  const obj = sceneObjects.find(o => o.id === (objectId || activeObjectId));
  if (!obj || obj.locked) return null;

  let lx = localX;
  let ly = localY;
  let lz = localZ;
  let bStr = blockString;

  if (localX && typeof localX === 'object') {
    lx = Number(localX.x) || 0;
    ly = Number(localX.y) || 0;
    lz = Number(localX.z) || 0;
    bStr = localX.action === 'remove' ? 'air' : (localX.block || localX.name || 'stone');
  }

  const isAir = !bStr || bStr === 'air' || bStr === 'cave_air' || bStr === 'void_air';
  const cleanName = isAir ? 'air' : String(bStr).replace(/^minecraft:/, '').replace(/\[.*\]$/, '').trim().toLowerCase();

  const existingIdx = obj.blocks.findIndex(b => b.x === lx && b.y === ly && b.z === lz);
  if (isAir) {
    if (existingIdx !== -1) {
      obj.blocks.splice(existingIdx, 1);
    }
  } else {
    if (existingIdx !== -1) {
      obj.blocks[existingIdx] = { x: lx, y: ly, z: lz, name: cleanName, block: cleanName, properties: {} };
    } else {
      obj.blocks.push({ x: lx, y: ly, z: lz, name: cleanName, block: cleanName, properties: {} });
    }
  }

  obj.bounds = computeBoundsFromBlocks(obj.blocks);
  obj.bom = computeBomFromBlocks(obj.blocks);

  notifyListeners(
    'voxel_edited',
    `Manueller Voxel-Edit in "${obj.name}" bei lokal (${lx},${ly},${lz}) -> ${cleanName}`
  );
  return obj;
}

export function undoSceneAction() {
  if (undoStack.length === 0) return false;
  redoStack.push({
    objects: cloneObjectsState(sceneObjects),
    activeObjectId
  });
  const prev = undoStack.pop();
  sceneObjects = prev.objects;
  activeObjectId = prev.activeObjectId;
  notifyListeners('undo', `Undo ausgeführt (${prev.actionLabel || 'Schritt zurück'})`);
  return true;
}

export function redoSceneAction() {
  if (redoStack.length === 0) return false;
  undoStack.push({
    objects: cloneObjectsState(sceneObjects),
    activeObjectId
  });
  const next = redoStack.pop();
  sceneObjects = next.objects;
  activeObjectId = next.activeObjectId;
  notifyListeners('redo', 'Redo ausgeführt');
  return true;
}

export function clearSceneObjects() {
  if (sceneObjects.length === 0) return;
  pushUndoSnapshot('Clear Scene');
  sceneObjects = [];
  activeObjectId = null;
  soloObjectId = null;
  verifierReport = null;
  notifyListeners('scene_cleared', 'Alle Objekte aus der Szene entfernt');
}

export function loadProjectIntoSceneGraph(project = {}) {
  pushUndoSnapshot('Load Project');
  sceneObjects = Array.isArray(project.objects) ? cloneObjectsState(project.objects) : [];
  activeObjectId = sceneObjects[0]?.id || null;
  soloObjectId = null;
  if (project.terrain) {
    terrainData = project.terrain;
  }
  if (project.environment?.ghostOpacity !== undefined) {
    globalGhostOpacity = Number(project.environment.ghostOpacity) || 1.0;
  }
  notifyListeners('project_loaded', `Projekt "${project.projectName || project.name || 'Unbenannt'}" geladen (${sceneObjects.length} Objekte)`);
  return getSceneSnapshot();
}

export function loadSceneProjectState(project = {}) {
  return loadProjectIntoSceneGraph(project);
}

export function serializeSceneProject(projectName = 'Unbenannt') {
  return {
    projectName,
    name: projectName,
    createdAt: new Date().toISOString(),
    objects: cloneObjectsState(sceneObjects),
    terrain: terrainData,
    environment: {
      ghostOpacity: globalGhostOpacity
    }
  };
}

export function resetSceneGraph() {
  sceneObjects = [];
  activeObjectId = null;
  soloObjectId = null;
  terrainData = null;
  verifierReport = null;
  undoStack.length = 0;
  redoStack.length = 0;
  userDeltas.length = 0;
}

export function computeMasterBOM() {
  const master = {};
  for (const obj of sceneObjects) {
    if (!obj || obj.visible === false) continue;
    const bom = obj.bom || computeBomFromBlocks(obj.blocks);
    for (const [blockName, count] of Object.entries(bom)) {
      master[blockName] = (master[blockName] || 0) + count;
    }
  }
  return master;
}

export function getSceneSnapshot() {
  return {
    objects: sceneObjects,
    activeObjectId,
    soloObjectId,
    terrain: terrainData,
    terrainVisible,
    verifierReport,
    verifierOverlayEnabled,
    globalGhostOpacity,
    masterBom: computeMasterBOM(),
    userDeltas: [...userDeltas],
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0
  };
}
