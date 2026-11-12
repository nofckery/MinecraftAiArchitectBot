/**
 * Voxel Preview Rendering, Instanced Mesh Voxel Engine, Y-Slicing, X-Ray, and Delta Edits.
 */

import { threeCtx } from './threeContext.js';
import {
  getBlockMaterial,
  createMinecraftBlockMesh,
  resolveBlockTextureInfo,
  getBlockInstanceTransforms
} from '../textureManager.js';
import { getBlockColor } from './threePalette.js';
import { renderBOM } from './threeUI.js';
import { renderSceneGraphObjects } from './threeStudioTerrain.js';
import {
  getSceneObjects,
  getActiveObject,
  updateSceneObject,
  addSceneObject,
  setGlobalGhostOpacity
} from '../sceneGraph.js';

export function setRenderMode(mode) {
  threeCtx.renderMode = mode;
  if (threeCtx.lastPreviewData) {
    renderVoxelPreview(threeCtx.lastPreviewData);
  }
  return threeCtx.renderMode;
}

export function getRenderMode() {
  return threeCtx.renderMode;
}

export function setBrushSize(size) {
  threeCtx.brushSize = Math.max(1, Math.min(3, parseInt(size, 10) || 1));
  return threeCtx.brushSize;
}

export function getBrushSize() {
  return threeCtx.brushSize;
}

export function setXrayActive(active) {
  threeCtx.isXrayActive = !!active;
  return threeCtx.isXrayActive;
}

export function getXrayActive() {
  return threeCtx.isXrayActive;
}

export function setGhostOpacity(opacity) {
  const val = setGlobalGhostOpacity(opacity);
  renderSceneGraphObjects();
  return val;
}

export function renderVoxelPreview(data) {
  const threeOverlayNotice = document.getElementById('threeOverlayNotice');
  if (threeOverlayNotice) threeOverlayNotice.classList.add('hidden');

  if (threeCtx.voxelGroup) {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    while (threeCtx.voxelGroup.children.length > 0) {
      const obj = threeCtx.voxelGroup.children.pop();
      if (obj.geometry && !disposedGeometries.has(obj.geometry)) {
        obj.geometry.dispose();
        disposedGeometries.add(obj.geometry);
      }
      if (obj.material && !disposedMaterials.has(obj.material)) {
        obj.material.dispose();
        disposedMaterials.add(obj.material);
      }
    }
  }
  threeCtx.voxelMeshMap.clear();

  threeCtx.lastPreviewData = data;
  const blocks = data.blocks || [];
  let maxY = 0;
  for (const b of blocks) {
    if (b.y > maxY) maxY = b.y;
  }

  if (threeCtx.renderMode === 'textures' || threeCtx.renderMode === 'wireframe') {
    const isWf = threeCtx.renderMode === 'wireframe';
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
      const mat = getBlockMaterial(blockName, { wireframe: isWf });
      const info = resolveBlockTextureInfo(blockName);

      let totalTransforms = 0;
      const blockTransformsList = [];
      for (const b of groupBlocks) {
        const transforms = getBlockInstanceTransforms(b, info);
        totalTransforms += transforms.length;
        blockTransformsList.push({ block: b, transforms });
      }

      const instMesh = new THREE.InstancedMesh(boxGeom, mat, totalTransforms);
      if (typeof THREE.DynamicDrawUsage !== 'undefined') {
        instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      }

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
            px: t.px,
            py: t.py,
            pz: t.pz,
            sx: t.sx,
            sy: t.sy,
            sz: t.sz,
            name: b.name,
            properties: b.properties
          });
          idx++;
        }
      }

      instMesh.instanceMatrix.needsUpdate = true;
      instMesh.userData = { instanceData, isInstanced: true };
      if (threeCtx.voxelGroup) threeCtx.voxelGroup.add(instMesh);
    }
  } else {
    // Modus 'cad': Farbig schattiertes Hologramm (InstancedMesh für > 2500 Voxel)
    const geom = new THREE.BoxGeometry(1, 1, 1);
    const matCache = new Map();
    const useInstancing = blocks.length > 2500 && typeof THREE.InstancedMesh === 'function';

    if (useInstancing) {
      const colorGroups = new Map();
      for (const b of blocks) {
        const color = getBlockColor(b.name);
        let list = colorGroups.get(color);
        if (!list) {
          list = [];
          colorGroups.set(color, list);
        }
        list.push(b);
      }

      const dummy = new THREE.Object3D();
      for (const [color, groupBlocks] of colorGroups.entries()) {
        let mat = matCache.get(color);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color });
          matCache.set(color, mat);
        }
        const instMesh = new THREE.InstancedMesh(geom, mat, groupBlocks.length);
        if (typeof THREE.DynamicDrawUsage !== 'undefined') {
          instMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        }
        const instanceData = [];

        for (let i = 0; i < groupBlocks.length; i++) {
          const b = groupBlocks[i];
          dummy.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          instMesh.setMatrixAt(i, dummy.matrix);
          instanceData.push({ x: b.x, y: b.y, z: b.z, name: b.name, properties: b.properties });
        }

        instMesh.instanceMatrix.needsUpdate = true;
        instMesh.userData = { instanceData, isInstanced: true };
        if (threeCtx.voxelGroup) threeCtx.voxelGroup.add(instMesh);
      }
    } else {
      for (const b of blocks) {
        const color = getBlockColor(b.name);
        let mat = matCache.get(color);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({ color });
          matCache.set(color, mat);
        }

        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
        mesh.userData = { x: b.x, y: b.y, z: b.z, name: b.name, properties: b.properties };
        if (threeCtx.voxelGroup) threeCtx.voxelGroup.add(mesh);
        threeCtx.voxelMeshMap.set(`${b.x},${b.y},${b.z}`, mesh);
      }
    }
  }

  const ySliceSlider = document.getElementById('ySliceSlider');
  const ySliceValue = document.getElementById('ySliceValue');
  if (ySliceSlider && ySliceValue) {
    ySliceSlider.min = 1;
    ySliceSlider.max = Math.max(1, maxY + 1);
    ySliceSlider.value = ySliceSlider.max;
    ySliceSlider.disabled = false;
    ySliceValue.textContent = `Schnitt-Höhe Y: 1 bis Max (${ySliceSlider.max})`;
  }

  threeCtx.currentBounds = data.bounds || null;

  if (data.bounds && threeCtx.controls) {
    const cx = (data.bounds.minX + data.bounds.maxX + 1) / 2;
    const cy = (data.bounds.minY + data.bounds.maxY + 1) / 2;
    const cz = (data.bounds.minZ + data.bounds.maxZ + 1) / 2;
    threeCtx.controls.target.set(cx, cy, cz);

    if (threeCtx.camera) {
      const spanX = Math.max(1, ((data.bounds.maxX || 0) - (data.bounds.minX || 0) + 1));
      const spanY = Math.max(1, ((data.bounds.maxY || 0) - (data.bounds.minY || 0) + 1));
      const spanZ = Math.max(1, ((data.bounds.maxZ || 0) - (data.bounds.minZ || 0) + 1));
      const maxDim = Math.max(spanX, spanY, spanZ);
      const dist = Math.max(24, maxDim * 1.5);
      threeCtx.camera.position.set(cx + dist * 0.85, cy + dist * 0.65, cz + dist * 0.85);
      threeCtx.camera.lookAt(cx, cy, cz);
      threeCtx.controls.update();
    }
  }

  const previewStats = document.getElementById('previewStats');
  if (previewStats) previewStats.textContent = `${blocks.length} Voxel geladen`;

  const btnConfirmBuild = document.getElementById('btnConfirmBuild');
  if (btnConfirmBuild) btnConfirmBuild.disabled = blocks.length === 0;

  const linterBadge = document.getElementById('linterBadge');
  if (linterBadge && data.lintReport) {
    const passed = data.lintReport.passed;
    linterBadge.className = `linter-badge ${passed ? 'pass' : 'warn'}`;
    linterBadge.textContent = passed ? 'Linter: Bestanden' : 'Linter: Warnungen';
  }

  renderBOM(data.bom || {});
  const asciiBlueprintView = document.getElementById('asciiBlueprintView');
  if (asciiBlueprintView && data.asciiReport) {
    asciiBlueprintView.textContent = data.asciiReport;
  }

  if (blocks.length > 0 && data.syncToSceneGraph !== false) {
    const activeObj = getActiveObject();
    if (activeObj && activeObj.isAutoPreview) {
      updateSceneObject(activeObj.id, {
        name: data.userRequest || activeObj.name,
        blocks,
        bounds: data.bounds,
        bom: data.bom,
        lintReport: data.lintReport,
        skipUndo: true
      });
    } else if (getSceneObjects().length === 0) {
      addSceneObject({
        name: data.userRequest || 'Aktueller Entwurf',
        position: data.siteInfo?.origin || { x: 0, y: 64, z: 0 },
        facing: data.siteInfo?.facing || 'north',
        blocks,
        bounds: data.bounds,
        bom: data.bom,
        lintReport: data.lintReport,
        isAutoPreview: true,
        preserveExactY: true
      }, { replaceIfDefault: true, skipUndo: true });
    }
  }
}

export function renderTerrainXray(blocks, isSimulated = false) {
  if (!threeCtx.scene) return;
  threeCtx.xrayMeshes.forEach(m => threeCtx.scene.remove(m));
  threeCtx.xrayMeshes = [];

  const threeOverlayNotice = document.getElementById('threeOverlayNotice');
  if (isSimulated && threeOverlayNotice) {
    threeOverlayNotice.textContent = 'ℹ️ Bot offline — Röntgen-Kollision zeigt Offline-Simulation';
    threeOverlayNotice.classList.remove('hidden');
    setTimeout(() => {
      if (threeOverlayNotice.textContent.includes('Röntgen')) {
        threeOverlayNotice.classList.add('hidden');
      }
    }, 4000);
  }

  if (!threeCtx.isXrayActive || blocks.length === 0) return;

  const geom = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.5, wireframe: false });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5, wireframe: false });

  for (const b of blocks) {
    const mat = b.isCollision ? redMat : blueMat;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    threeCtx.scene.add(mesh);
    threeCtx.xrayMeshes.push(mesh);
  }
}

export function handleVoxelDelta(msg) {
  const { x, y, z, blockString } = msg;
  const key = `${x},${y},${z}`;
  const isAir = !blockString || blockString === 'air' || blockString === 'cave_air' || blockString === 'void_air';

  if (isAir) {
    const existing = threeCtx.voxelMeshMap.get(key);
    if (existing && threeCtx.voxelGroup) {
      threeCtx.voxelGroup.remove(existing);
      if (existing.geometry) existing.geometry.dispose();
      if (existing.material) existing.material.dispose();
      threeCtx.voxelMeshMap.delete(key);
    }
  } else {
    const match = blockString.match(/^([^\[]+)/);
    const blockName = match ? match[1] : blockString;

    const existing = threeCtx.voxelMeshMap.get(key);
    if (existing && threeCtx.voxelGroup) {
      threeCtx.voxelGroup.remove(existing);
      if (existing.geometry) existing.geometry.dispose();
      threeCtx.voxelMeshMap.delete(key);
    }

    let mesh;
    if (threeCtx.renderMode === 'textures' || threeCtx.renderMode === 'wireframe') {
      const mat = getBlockMaterial(blockName, { wireframe: threeCtx.renderMode === 'wireframe' });
      mesh = createMinecraftBlockMesh({ x, y, z, name: blockName }, mat);
    } else {
      const color = getBlockColor(blockName);
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial({ color });
      mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.userData = { x, y, z, name: blockName };
    }

    if (mesh && threeCtx.voxelGroup) {
      threeCtx.voxelGroup.add(mesh);
      threeCtx.voxelMeshMap.set(key, mesh);
    }
  }

  const previewStats = document.getElementById('previewStats');
  if (previewStats) {
    const totalCount = (threeCtx.voxelGroup && threeCtx.voxelGroup.children.some(c => c.isInstancedMesh))
      ? 'Voxel (Instanced) aktualisiert'
      : `${threeCtx.voxelMeshMap.size} Voxel geladen`;
    previewStats.textContent = totalCount;
  }
}

export function applyYSlice(maxY) {
  // 1. Reguläre Einzel-Meshes
  for (const mesh of threeCtx.voxelMeshMap.values()) {
    mesh.visible = mesh.userData.y <= maxY;
  }

  // 2. InstancedMeshes (Maßstabs-Update der Instanzmatrizen)
  if (threeCtx.voxelGroup && typeof THREE !== 'undefined') {
    const dummy = new THREE.Object3D();
    for (const child of threeCtx.voxelGroup.children) {
      if (child.isInstancedMesh && child.userData?.instanceData) {
        let changed = false;
        for (let i = 0; i < child.userData.instanceData.length; i++) {
          const d = child.userData.instanceData[i];
          const px = d.px !== undefined ? d.px : (d.x + 0.5);
          const py = d.py !== undefined ? d.py : (d.y + 0.5);
          const pz = d.pz !== undefined ? d.pz : (d.z + 0.5);
          const sx = d.sx !== undefined ? d.sx : 1;
          const sy = d.sy !== undefined ? d.sy : 1;
          const sz = d.sz !== undefined ? d.sz : 1;

          dummy.position.set(px, py, pz);
          if (d.y <= maxY) {
            dummy.scale.set(sx, sy, sz);
          } else {
            dummy.scale.set(0, 0, 0); // Voxel unsichtbar schrumpfen
          }
          dummy.updateMatrix();
          child.setMatrixAt(i, dummy.matrix);
          changed = true;
        }
        if (changed) child.instanceMatrix.needsUpdate = true;
      }
    }
  }
}

/**
 * Litematica-Style Dual Y-Slicer (Min-Y .. Max-Y or Single Layer Floor Focus)
 * Works across both Multi-Object SceneGraph and Legacy VoxelGroup.
 */
export function applyDualYSlice(minY = -64, maxY = 320, singleLayerOnly = false) {
  const effectiveMinY = singleLayerOnly ? maxY : minY;
  const effectiveMaxY = maxY;

  for (const mesh of threeCtx.voxelMeshMap.values()) {
    mesh.visible = mesh.userData.y >= effectiveMinY && mesh.userData.y <= effectiveMaxY;
  }

  const applyToInstancedChildren = (group) => {
    if (!group || typeof THREE === 'undefined') return;
    const dummy = new THREE.Object3D();
    for (const child of group.children) {
      if (child.isGroup) {
        applyToInstancedChildren(child);
      } else if (child.isInstancedMesh && child.userData?.instanceData) {
        let changed = false;
        for (let i = 0; i < child.userData.instanceData.length; i++) {
          const d = child.userData.instanceData[i];
          const px = d.px !== undefined ? d.px : (d.x + 0.5);
          const py = d.py !== undefined ? d.py : (d.y + 0.5);
          const pz = d.pz !== undefined ? d.pz : (d.z + 0.5);
          const sx = d.sx !== undefined ? d.sx : 1;
          const sy = d.sy !== undefined ? d.sy : 1;
          const sz = d.sz !== undefined ? d.sz : 1;

          dummy.position.set(px, py, pz);
          if (d.y >= effectiveMinY && d.y <= effectiveMaxY) {
            dummy.scale.set(sx, sy, sz);
          } else {
            dummy.scale.set(0, 0, 0);
          }
          dummy.updateMatrix();
          child.setMatrixAt(i, dummy.matrix);
          changed = true;
        }
        if (changed) child.instanceMatrix.needsUpdate = true;
      }
    }
  };

  applyToInstancedChildren(threeCtx.voxelGroup);
  applyToInstancedChildren(threeCtx.sceneObjectsGroup);
}
