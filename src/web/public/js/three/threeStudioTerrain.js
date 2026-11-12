/**
 * 3D Scanned Minecraft Terrain relief, Multi-Object SceneGraph rendering, and 3D TransformControls.
 */

import { threeCtx } from './threeContext.js';
import {
  getBlockMaterial,
  resolveBlockTextureInfo,
  getBlockInstanceTransforms
} from '../textureManager.js';
import { getBlockColor } from './threePalette.js';
import {
  getSceneObjects,
  getActiveObject,
  getActiveObjectId,
  getSoloObjectId,
  isTerrainVisible,
  setTerrainVisible,
  getGlobalGhostOpacity
} from '../sceneGraph.js';

let setActiveToolFn = () => {};

export function setStudioTerrainDependencies(deps) {
  if (deps.setActiveTool) setActiveToolFn = deps.setActiveTool;
}

export function disposeGroupChildren(group) {
  if (!group) return;
  const disposedGeoms = new Set();
  const disposedMats = new Set();
  while (group.children.length > 0) {
    const child = group.children.pop();
    if (child.children && child.children.length > 0) {
      disposeGroupChildren(child);
    }
    if (child.geometry && !disposedGeoms.has(child.geometry)) {
      child.geometry.dispose();
      disposedGeoms.add(child.geometry);
    }
    if (child.material && !disposedMats.has(child.material)) {
      if (Array.isArray(child.material)) {
        child.material.forEach(m => m?.dispose && m.dispose());
      } else if (child.material.dispose) {
        child.material.dispose();
      }
      disposedMats.add(child.material);
    }
  }
}

/**
 * Renders the scanned 3D Minecraft terrain relief into `terrainGroup` using InstancedMesh.
 */
export function renderStudioTerrain(terrainData) {
  if (!threeCtx.scene || !threeCtx.terrainGroup || typeof THREE === 'undefined') return;
  disposeGroupChildren(threeCtx.terrainGroup);

  if (!terrainData || !Array.isArray(terrainData.terrainBlocks) || terrainData.terrainBlocks.length === 0) {
    return;
  }

  const soloId = getSoloObjectId();
  threeCtx.terrainGroup.visible = isTerrainVisible() && !soloId;

  const blocks = terrainData.terrainBlocks;
  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  const blockGroups = new Map();

  for (const b of blocks) {
    let list = blockGroups.get(b.name);
    if (!list) {
      list = [];
      blockGroups.set(b.name, list);
    }
    list.push(b);
  }

  const dummy = new THREE.Object3D();
  for (const [blockName, groupBlocks] of blockGroups.entries()) {
    let mat;
    if (threeCtx.renderMode === 'textures' || threeCtx.renderMode === 'wireframe') {
      mat = getBlockMaterial(blockName, { wireframe: threeCtx.renderMode === 'wireframe' });
    } else {
      mat = new THREE.MeshLambertMaterial({ color: getBlockColor(blockName) });
    }

    const instMesh = new THREE.InstancedMesh(boxGeom, mat, groupBlocks.length);
    const instanceData = [];

    for (let i = 0; i < groupBlocks.length; i++) {
      const b = groupBlocks[i];
      dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      instMesh.setMatrixAt(i, dummy.matrix);
      instanceData.push({
        x: b.x,
        y: b.y,
        z: b.z,
        worldX: b.x,
        worldY: b.y,
        worldZ: b.z,
        name: b.name,
        isTerrain: true
      });
    }

    instMesh.instanceMatrix.needsUpdate = true;
    instMesh.userData = { instanceData, isInstanced: true, isTerrainMesh: true };
    threeCtx.terrainGroup.add(instMesh);
  }

  // Align grid helper and camera to scanned terrain center if no custom bounds exist yet
  if (terrainData.bounds) {
    threeCtx.currentBounds = terrainData.bounds;
    if (threeCtx.gridHelperRef) {
      threeCtx.gridHelperRef.position.set(
        terrainData.center?.x || 0,
        (terrainData.bounds.minY || 64) - 0.02,
        terrainData.center?.z || 0
      );
    }
    if (threeCtx.controls && threeCtx.camera) {
      const cx = terrainData.center?.x || 0;
      const cy = terrainData.center?.y || 64;
      const cz = terrainData.center?.z || 0;
      threeCtx.controls.target.set(cx, cy, cz);
      const dist = Math.max(36, (terrainData.radius || 32) * 1.45);
      threeCtx.camera.position.set(cx + dist * 0.8, cy + dist * 0.65, cz + dist * 0.8);
      threeCtx.camera.lookAt(cx, cy, cz);
      threeCtx.controls.update();
    }
  }
}

/**
 * Renders all placed buildings/schematics from `sceneGraph.js` inside `sceneObjectsGroup`.
 */
export function renderSceneGraphObjects(snapshot = null) {
  if (!threeCtx.scene || !threeCtx.sceneObjectsGroup || typeof THREE === 'undefined') return;

  if (threeCtx.transformControls) {
    threeCtx.transformControls.detach();
  }
  disposeGroupChildren(threeCtx.sceneObjectsGroup);
  threeCtx.objectGroupMap.clear();

  const objects = snapshot?.objects || getSceneObjects();
  const activeId = snapshot?.activeObjectId !== undefined ? snapshot.activeObjectId : getActiveObjectId();
  const soloId = snapshot?.soloObjectId !== undefined ? snapshot.soloObjectId : getSoloObjectId();
  const ghostOpacity = snapshot?.globalGhostOpacity ?? getGlobalGhostOpacity();

  if (threeCtx.terrainGroup) {
    threeCtx.terrainGroup.visible = isTerrainVisible() && !soloId;
  }

  // Hide legacy single voxelGroup when Multi-Object SceneGraph is populated so there is no double-rendering
  if (threeCtx.voxelGroup) {
    threeCtx.voxelGroup.visible = objects.length === 0;
  }

  const boxGeom = new THREE.BoxGeometry(1, 1, 1);
  const dummy = new THREE.Object3D();

  for (const obj of objects) {
    if (!obj || obj.visible === false) continue;
    if (soloId && obj.id !== soloId) continue;

    const objGroup = new THREE.Group();
    objGroup.userData = { sceneObjectId: obj.id, name: obj.name };

    const pos = obj.position || { x: 0, y: 64, z: 0 };
    threeCtx.isSyncingTransform = true;
    objGroup.position.set(pos.x, pos.y, pos.z);
    objGroup.rotation.set(0, -((obj.rotation || 0) * Math.PI) / 180, 0);
    threeCtx.isSyncingTransform = false;

    const effectiveOpacity = Math.min(ghostOpacity, obj.opacity ?? 1.0);
    const isTransparent = effectiveOpacity < 0.99;

    const blocks = Array.isArray(obj.blocks) ? obj.blocks : [];
    const blockGroups = new Map();
    for (const b of blocks) {
      if (!b || !b.name || b.name === 'air') continue;
      let list = blockGroups.get(b.name);
      if (!list) {
        list = [];
        blockGroups.set(b.name, list);
      }
      list.push(b);
    }

    for (const [blockName, groupBlocks] of blockGroups.entries()) {
      let mat;
      if (threeCtx.renderMode === 'textures' || threeCtx.renderMode === 'wireframe') {
        const baseMat = getBlockMaterial(blockName, { wireframe: threeCtx.renderMode === 'wireframe' });
        if (isTransparent && baseMat && typeof baseMat.clone === 'function') {
          mat = baseMat.clone();
          mat.transparent = true;
          mat.opacity = effectiveOpacity;
        } else {
          mat = baseMat;
        }
      } else {
        mat = new THREE.MeshLambertMaterial({
          color: getBlockColor(blockName),
          transparent: isTransparent,
          opacity: effectiveOpacity
        });
      }

      const info = resolveBlockTextureInfo(blockName);
      let totalTransforms = 0;
      const blockTransformsList = [];
      for (const b of groupBlocks) {
        const transforms = getBlockInstanceTransforms(b, info);
        totalTransforms += transforms.length;
        blockTransformsList.push({ block: b, transforms });
      }

      if (totalTransforms === 0) continue;
      const instMesh = new THREE.InstancedMesh(boxGeom, mat, totalTransforms);
      const instanceData = [];
      let idx = 0;

      for (const item of blockTransformsList) {
        const b = item.block;
        for (const t of item.transforms) {
          dummy.position.set(t.px, t.py, t.pz);
          dummy.scale.set(t.sx, t.sy, t.sz);
          dummy.updateMatrix();
          instMesh.setMatrixAt(idx, dummy.matrix);
          instanceData.push({
            x: b.x,
            y: b.y,
            z: b.z,
            worldX: pos.x + b.x,
            worldY: pos.y + b.y,
            worldZ: pos.z + b.z,
            px: t.px,
            py: t.py,
            pz: t.pz,
            sx: t.sx,
            sy: t.sy,
            sz: t.sz,
            name: b.name,
            properties: b.properties,
            sceneObjectId: obj.id
          });
          idx++;
        }
      }

      instMesh.instanceMatrix.needsUpdate = true;
      instMesh.userData = { instanceData, isInstanced: true, sceneObjectId: obj.id };
      objGroup.add(instMesh);
    }

    // Active Object Bounding Box Highlight (Cyan for active, Subtle Slate for inactive)
    const bounds = obj.bounds || { minX: 0, minY: 0, minZ: 0, maxX: 12, maxY: 12, maxZ: 12 };
    const bBox = new THREE.Box3(
      new THREE.Vector3((bounds.minX || 0) - 0.04, (bounds.minY || 0) - 0.04, (bounds.minZ || 0) - 0.04),
      new THREE.Vector3((bounds.maxX || 0) + 1.04, (bounds.maxY || 0) + 1.04, (bounds.maxZ || 0) + 1.04)
    );
    const isSelected = obj.id === activeId;
    const helperColor = isSelected ? 0x00e5ff : 0x475569;
    const boxHelper = new THREE.Box3Helper(bBox, helperColor);
    objGroup.add(boxHelper);

    threeCtx.sceneObjectsGroup.add(objGroup);
    threeCtx.objectGroupMap.set(obj.id, objGroup);
  }

  if (threeCtx.activeTool === 'gizmoMove' || threeCtx.activeTool === 'gizmoRotate') {
    attachGizmoToActiveObject();
  }
}

export function attachGizmoToActiveObject() {
  if (!threeCtx.transformControls) return;
  const activeId = getActiveObjectId();
  const activeObj = getActiveObject();
  const targetGroup = activeId ? threeCtx.objectGroupMap.get(activeId) : null;

  if (targetGroup && activeObj && !activeObj.locked && (threeCtx.activeTool === 'gizmoMove' || threeCtx.activeTool === 'gizmoRotate')) {
    threeCtx.transformControls.setMode(threeCtx.activeTool === 'gizmoRotate' ? 'rotate' : 'translate');
    threeCtx.transformControls.attach(targetGroup);
  } else {
    threeCtx.transformControls.detach();
  }
}

export function setTransformGizmoMode(mode = 'translate') {
  if (mode === 'rotate') {
    setActiveToolFn('gizmoRotate');
  } else {
    setActiveToolFn('gizmoMove');
  }
}

export function setStudioTerrainVisibility(visible = true) {
  setTerrainVisible(Boolean(visible));
  if (threeCtx.terrainGroup) {
    threeCtx.terrainGroup.visible = Boolean(visible) && !getSoloObjectId();
  }
}
