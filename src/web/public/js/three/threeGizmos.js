/**
 * CAD Gizmos: Selection Box, 3D Measure Ruler, Camera Views, and Pointer Interaction.
 */

import { sendWS } from '../wsClient.js';
import { threeCtx } from './threeContext.js';
import {
  getActiveObject,
  selectSceneObject,
  updateSceneObject,
  applyVoxelEditToSceneObject
} from '../sceneGraph.js';
import { attachGizmoToActiveObject, disposeGroupChildren } from './threeStudioTerrain.js';

export function getCurrentSelectionBox() {
  return threeCtx.currentSelectionBox;
}

export function updateSelectionGizmo(c1, c2) {
  if (!threeCtx.scene || typeof THREE === 'undefined') return;
  if (threeCtx.selectionBoxGizmo) {
    threeCtx.scene.remove(threeCtx.selectionBoxGizmo);
    threeCtx.selectionBoxGizmo = null;
  }

  const minX = Math.min(c1.x, c2.x);
  const maxX = Math.max(c1.x, c2.x);
  const minY = Math.min(c1.y, c2.y);
  const maxY = Math.max(c1.y, c2.y);
  const minZ = Math.min(c1.z, c2.z);
  const maxZ = Math.max(c1.z, c2.z);

  const box = new THREE.Box3(
    new THREE.Vector3(minX - 0.05, minY - 0.05, minZ - 0.05),
    new THREE.Vector3(maxX + 1.05, maxY + 1.05, maxZ + 1.05)
  );

  const group = new THREE.Group();
  const boxHelper = new THREE.Box3Helper(box, 0xf59e0b);
  group.add(boxHelper);

  const sx = Math.max(0.1, maxX - minX + 1.04);
  const sy = Math.max(0.1, maxY - minY + 1.04);
  const sz = Math.max(0.1, maxZ - minZ + 1.04);
  const fillGeom = new THREE.BoxGeometry(sx, sy, sz);
  const fillMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.22,
    depthWrite: false
  });
  const fillMesh = new THREE.Mesh(fillGeom, fillMat);
  fillMesh.position.set(
    (minX + maxX + 1) / 2,
    (minY + maxY + 1) / 2,
    (minZ + maxZ + 1) / 2
  );
  group.add(fillMesh);

  threeCtx.selectionBoxGizmo = group;
  threeCtx.scene.add(threeCtx.selectionBoxGizmo);
}

export function clearSelectionBox() {
  threeCtx.currentSelectionBox = null;
  threeCtx.selectBoxStep = 0;
  threeCtx.selectBoxCorner1 = null;
  if (threeCtx.selectionBoxGizmo && threeCtx.scene) {
    threeCtx.scene.remove(threeCtx.selectionBoxGizmo);
    threeCtx.selectionBoxGizmo = null;
  }
  const selectionBadgeNotice = document.getElementById('selectionBadgeNotice');
  if (selectionBadgeNotice) selectionBadgeNotice.classList.add('hidden');
}

export function setActiveTool(tool) {
  threeCtx.activeTool = tool;
  const toolOrbit = document.getElementById('toolOrbit');
  const toolGizmoMove = document.getElementById('toolGizmoMove');
  const toolGizmoRotate = document.getElementById('toolGizmoRotate');
  const toolPlaceOnTerrain = document.getElementById('toolPlaceOnTerrain');
  const toolSelectBox = document.getElementById('toolSelectBox');
  const toolBrush = document.getElementById('toolBrush');
  const toolEraser = document.getElementById('toolEraser');
  const toolEyedropper = document.getElementById('toolEyedropper');
  const toolMeasure = document.getElementById('toolMeasure');

  [
    toolOrbit,
    toolGizmoMove,
    toolGizmoRotate,
    toolPlaceOnTerrain,
    toolSelectBox,
    toolBrush,
    toolEraser,
    toolEyedropper,
    toolMeasure
  ].forEach(b => {
    if (b) b.classList.remove('active');
  });

  if (tool === 'orbit' && toolOrbit) toolOrbit.classList.add('active');
  if (tool === 'gizmoMove' && toolGizmoMove) toolGizmoMove.classList.add('active');
  if (tool === 'gizmoRotate' && toolGizmoRotate) toolGizmoRotate.classList.add('active');
  if (tool === 'placeOnTerrain' && toolPlaceOnTerrain) toolPlaceOnTerrain.classList.add('active');
  if (tool === 'selectBox' && toolSelectBox) toolSelectBox.classList.add('active');
  if (tool === 'brush' && toolBrush) toolBrush.classList.add('active');
  if (tool === 'eraser' && toolEraser) toolEraser.classList.add('active');
  if (tool === 'eyedropper' && toolEyedropper) toolEyedropper.classList.add('active');
  if (tool === 'measure' && toolMeasure) toolMeasure.classList.add('active');

  if (threeCtx.transformControls) {
    if (tool === 'gizmoMove') {
      threeCtx.transformControls.setMode('translate');
      attachGizmoToActiveObject();
    } else if (tool === 'gizmoRotate') {
      threeCtx.transformControls.setMode('rotate');
      attachGizmoToActiveObject();
    } else {
      threeCtx.transformControls.detach();
    }
  }

  if (threeCtx.controls) {
    if (tool === 'orbit' || tool === 'gizmoMove' || tool === 'gizmoRotate') {
      threeCtx.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    } else {
      threeCtx.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    }
    threeCtx.controls.enableRotate = true;
  }
}

export function renderMeasureLine(pt1, pt2) {
  if (!threeCtx.scene || !threeCtx.measureGroup || typeof THREE === 'undefined') return;
  disposeGroupChildren(threeCtx.measureGroup);
  if (!pt1 || !pt2) return;

  const markerGeom = new THREE.BoxGeometry(1.08, 1.08, 1.08);
  const markerMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true });

  const m1 = new THREE.Mesh(markerGeom, markerMat);
  m1.position.set(pt1.x + 0.5, pt1.y + 0.5, pt1.z + 0.5);
  threeCtx.measureGroup.add(m1);

  const m2 = new THREE.Mesh(markerGeom, markerMat);
  m2.position.set(pt2.x + 0.5, pt2.y + 0.5, pt2.z + 0.5);
  threeCtx.measureGroup.add(m2);

  const dx = Math.abs(pt2.x - pt1.x) + 1;
  const dy = Math.abs(pt2.y - pt1.y) + 1;
  const dz = Math.abs(pt2.z - pt1.z) + 1;
  const dist = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y, pt2.z - pt1.z).toFixed(1);

  const badge = document.getElementById('studioMeasureReadout');
  if (badge) {
    badge.textContent = `📏 Maßband: ΔX=${dx} | ΔY=${dy} | ΔZ=${dz} (Distanz: ${dist}m)`;
    badge.classList.remove('hidden');
  }
}

export function setViewTop() {
  if (!threeCtx.camera || !threeCtx.controls || !threeCtx.currentBounds) return;
  const cx = ((threeCtx.currentBounds.minX || 0) + (threeCtx.currentBounds.maxX || 0) + 1) / 2;
  const cy = ((threeCtx.currentBounds.minY || 0) + (threeCtx.currentBounds.maxY || 0) + 1) / 2;
  const cz = ((threeCtx.currentBounds.minZ || 0) + (threeCtx.currentBounds.maxZ || 0) + 1) / 2;
  const maxDim = Math.max(
    Math.abs((threeCtx.currentBounds.maxX || 0) - (threeCtx.currentBounds.minX || 0) + 1),
    Math.abs((threeCtx.currentBounds.maxZ || 0) - (threeCtx.currentBounds.minZ || 0) + 1)
  );
  threeCtx.controls.target.set(cx, cy, cz);
  threeCtx.camera.position.set(cx, cy + Math.max(28, maxDim * 1.6), cz + 0.001);
  threeCtx.camera.lookAt(cx, cy, cz);
  threeCtx.controls.update();
}

export function setViewIso() {
  if (!threeCtx.camera || !threeCtx.controls || !threeCtx.currentBounds) return;
  const cx = ((threeCtx.currentBounds.minX || 0) + (threeCtx.currentBounds.maxX || 0) + 1) / 2;
  const cy = ((threeCtx.currentBounds.minY || 0) + (threeCtx.currentBounds.maxY || 0) + 1) / 2;
  const cz = ((threeCtx.currentBounds.minZ || 0) + (threeCtx.currentBounds.maxZ || 0) + 1) / 2;
  const maxDim = Math.max(
    Math.abs((threeCtx.currentBounds.maxX || 0) - (threeCtx.currentBounds.minX || 0) + 1),
    Math.abs((threeCtx.currentBounds.maxY || 0) - (threeCtx.currentBounds.minY || 0) + 1),
    Math.abs((threeCtx.currentBounds.maxZ || 0) - (threeCtx.currentBounds.minZ || 0) + 1)
  );
  const dist = Math.max(24, maxDim * 1.5);
  threeCtx.controls.target.set(cx, cy, cz);
  threeCtx.camera.position.set(cx + dist * 0.85, cy + dist * 0.65, cz + dist * 0.85);
  threeCtx.camera.lookAt(cx, cy, cz);
  threeCtx.controls.update();
}

export function resetFocus() {
  setViewIso();
}

export function setViewCardinal(direction = 'north') {
  if (!threeCtx.camera || !threeCtx.controls) return;
  const activeObj = getActiveObject();
  let cx = 0, cy = 64, cz = 0, dist = 36;

  if (activeObj) {
    const w = activeObj.bounds?.width || 12;
    const h = activeObj.bounds?.height || 12;
    const d = activeObj.bounds?.depth || 12;
    cx = (activeObj.position?.x || 0) + w / 2;
    cy = (activeObj.position?.y || 64) + h / 2;
    cz = (activeObj.position?.z || 0) + d / 2;
    dist = Math.max(22, Math.max(w, h, d) * 1.65);
  } else if (threeCtx.currentBounds) {
    cx = ((threeCtx.currentBounds.minX || 0) + (threeCtx.currentBounds.maxX || 0) + 1) / 2;
    cy = ((threeCtx.currentBounds.minY || 0) + (threeCtx.currentBounds.maxY || 0) + 1) / 2;
    cz = ((threeCtx.currentBounds.minZ || 0) + (threeCtx.currentBounds.maxZ || 0) + 1) / 2;
    dist = 42;
  }

  threeCtx.controls.target.set(cx, cy, cz);
  const elev = cy + dist * 0.35;

  if (direction === 'north') {
    threeCtx.camera.position.set(cx, elev, cz - dist);
  } else if (direction === 'south') {
    threeCtx.camera.position.set(cx, elev, cz + dist);
  } else if (direction === 'east') {
    threeCtx.camera.position.set(cx + dist, elev, cz);
  } else if (direction === 'west') {
    threeCtx.camera.position.set(cx - dist, elev, cz);
  }
  threeCtx.camera.lookAt(cx, cy, cz);
  threeCtx.controls.update();
}

export function onThreePointerDown(event) {
  if (event.button !== 0) return; // Left-click only for CAD interactions
  if (threeCtx.activeTool === 'orbit') return;
  if (threeCtx.transformControls && threeCtx.transformControls.dragging) return;

  const rect = threeCtx.renderer.domElement.getBoundingClientRect();
  threeCtx.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  threeCtx.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  threeCtx.raycaster.setFromCamera(threeCtx.mouse, threeCtx.camera);

  const candidateTargets = [];
  if (threeCtx.sceneObjectsGroup && threeCtx.sceneObjectsGroup.children.length > 0) {
    candidateTargets.push(...threeCtx.sceneObjectsGroup.children);
  }
  if (threeCtx.terrainGroup && threeCtx.terrainGroup.children.length > 0 && threeCtx.terrainGroup.visible) {
    candidateTargets.push(...threeCtx.terrainGroup.children);
  }
  if (threeCtx.voxelGroup && threeCtx.voxelGroup.children.length > 0) {
    candidateTargets.push(...threeCtx.voxelGroup.children);
  } else if (threeCtx.voxelMeshMap.size > 0) {
    candidateTargets.push(...Array.from(threeCtx.voxelMeshMap.values()));
  }

  const intersects = threeCtx.raycaster.intersectObjects(candidateTargets, true);
  if (intersects.length === 0) return;

  const hit = intersects[0];
  let targetObj = hit.object;

  // Find owning sceneObjectId if clicked on a SceneGraph object
  let hitSceneObjectId = null;
  let curr = targetObj;
  while (curr) {
    if (curr.userData?.sceneObjectId) {
      hitSceneObjectId = curr.userData.sceneObjectId;
      break;
    }
    curr = curr.parent;
  }

  while (targetObj && (!targetObj.userData || targetObj.userData.x === undefined) && targetObj.parent && targetObj.parent !== threeCtx.voxelGroup && targetObj.parent !== threeCtx.sceneObjectsGroup && targetObj.parent !== threeCtx.terrainGroup) {
    targetObj = targetObj.parent;
  }

  const voxelData = (targetObj.isInstancedMesh && targetObj.userData?.instanceData)
    ? targetObj.userData.instanceData[hit.instanceId]
    : targetObj.userData;

  if (!voxelData) return;

  // 1. Gizmo Select / Move / Rotate Tool
  if (threeCtx.activeTool === 'gizmoMove' || threeCtx.activeTool === 'gizmoRotate') {
    if (hitSceneObjectId) {
      selectSceneObject(hitSceneObjectId);
      attachGizmoToActiveObject();
    }
    return;
  }

  // 2. Click-on-Terrain Placement Tool
  if (threeCtx.activeTool === 'placeOnTerrain') {
    const activeObj = getActiveObject();
    if (activeObj && !activeObj.locked) {
      const worldX = voxelData.worldX !== undefined ? voxelData.worldX : voxelData.x;
      const worldY = voxelData.worldY !== undefined ? voxelData.worldY : voxelData.y;
      const worldZ = voxelData.worldZ !== undefined ? voxelData.worldZ : voxelData.z;
      const w = activeObj.bounds?.width || 12;
      const d = activeObj.bounds?.depth || 12;
      const newPos = {
        x: Math.round(worldX - w / 2),
        y: Math.round(worldY + 1),
        z: Math.round(worldZ - d / 2)
      };
      updateSceneObject(activeObj.id, { position: newPos }, `Objekt "${activeObj.name}" per Terrain-Klick auf (${newPos.x},${newPos.y},${newPos.z}) platziert`);
    }
    return;
  }

  // 3. 3D Ruler / Measure Tool
  if (threeCtx.activeTool === 'measure') {
    const wx = voxelData.worldX !== undefined ? voxelData.worldX : voxelData.x;
    const wy = voxelData.worldY !== undefined ? voxelData.worldY : voxelData.y;
    const wz = voxelData.worldZ !== undefined ? voxelData.worldZ : voxelData.z;
    if (threeCtx.measureStep === 0) {
      threeCtx.measurePoint1 = { x: wx, y: wy, z: wz };
      threeCtx.measureStep = 1;
      renderMeasureLine(threeCtx.measurePoint1, threeCtx.measurePoint1);
    } else {
      const pt2 = { x: wx, y: wy, z: wz };
      threeCtx.measureStep = 0;
      renderMeasureLine(threeCtx.measurePoint1, pt2);
    }
    return;
  }

  const txtBrushBlock = document.getElementById('txtBrushBlock');

  const getOffsetsForSize = (size) => {
    if (size === 2) return [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]];
    if (size === 3) {
      const list = [];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          list.push([dx, 0, dz]);
        }
      }
      return list;
    }
    return [[0, 0, 0]];
  };

  if (threeCtx.activeTool === 'brush') {
    const norm = hit.face.normal;
    const targetX = voxelData.x + Math.round(norm.x);
    const targetY = voxelData.y + Math.round(norm.y);
    const targetZ = voxelData.z + Math.round(norm.z);
    const blockString = (txtBrushBlock?.value || 'stone_bricks').trim();

    const offsets = getOffsetsForSize(threeCtx.brushSize);
    for (const [ox, oy, oz] of offsets) {
      if (hitSceneObjectId) {
        applyVoxelEditToSceneObject(hitSceneObjectId, targetX + ox, targetY + oy, targetZ + oz, blockString);
      }
      sendWS({
        type: 'manual_voxel_edit',
        x: targetX + ox,
        y: targetY + oy,
        z: targetZ + oz,
        blockString,
        objectId: hitSceneObjectId
      });
    }
  } else if (threeCtx.activeTool === 'eraser') {
    const offsets = getOffsetsForSize(threeCtx.brushSize);
    for (const [ox, oy, oz] of offsets) {
      if (hitSceneObjectId) {
        applyVoxelEditToSceneObject(hitSceneObjectId, voxelData.x + ox, voxelData.y + oy, voxelData.z + oz, 'air');
      }
      sendWS({
        type: 'manual_voxel_edit',
        x: voxelData.x + ox,
        y: voxelData.y + oy,
        z: voxelData.z + oz,
        blockString: 'air',
        objectId: hitSceneObjectId
      });
    }
  } else if (threeCtx.activeTool === 'eyedropper') {
    if (txtBrushBlock) txtBrushBlock.value = voxelData.name;
    setActiveTool('brush');
  } else if (threeCtx.activeTool === 'selectBox') {
    if (threeCtx.selectBoxStep === 0) {
      threeCtx.selectBoxCorner1 = { x: voxelData.x, y: voxelData.y, z: voxelData.z };
      threeCtx.selectBoxStep = 1;
      updateSelectionGizmo(threeCtx.selectBoxCorner1, threeCtx.selectBoxCorner1);
    } else {
      const corner2 = { x: voxelData.x, y: voxelData.y, z: voxelData.z };
      const minX = Math.min(threeCtx.selectBoxCorner1.x, corner2.x);
      const maxX = Math.max(threeCtx.selectBoxCorner1.x, corner2.x);
      const minY = Math.min(threeCtx.selectBoxCorner1.y, corner2.y);
      const maxY = Math.max(threeCtx.selectBoxCorner1.y, corner2.y);
      const minZ = Math.min(threeCtx.selectBoxCorner1.z, corner2.z);
      const maxZ = Math.max(threeCtx.selectBoxCorner1.z, corner2.z);

      threeCtx.currentSelectionBox = { minX, minY, minZ, maxX, maxY, maxZ };
      threeCtx.selectBoxStep = 0;
      updateSelectionGizmo({ x: minX, y: minY, z: minZ }, { x: maxX, y: maxY, z: maxZ });

      const lblSelectionCoords = document.getElementById('lblSelectionCoords');
      const selectionBadgeNotice = document.getElementById('selectionBadgeNotice');
      if (lblSelectionCoords) {
        lblSelectionCoords.textContent = `(${minX}..${maxX}, ${minY}..${maxY}, ${minZ}..${maxZ})`;
      }
      if (selectionBadgeNotice) {
        selectionBadgeNotice.classList.remove('hidden');
      }
    }
  }
}
