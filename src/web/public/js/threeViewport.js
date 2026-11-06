/**
 * Architect Mission Control — Three.js 3D Viewport & Interactive CAD Submodule
 * Manages 3D scene, OrbitControls, voxel preview rendering, interactive CAD tools,
 * X-Ray inspection, BOM generation, and palette swapping.
 */

import { sendWS } from './wsClient.js';

let scene, camera, renderer, controls;
let voxelGroup, selectionBoxGizmo;
const voxelMeshMap = new Map(); // key "x,y,z" -> THREE.Mesh
let raycaster, mouse;

let activeTool = 'orbit'; // 'orbit' | 'selectBox' | 'brush' | 'eraser' | 'eyedropper'
let selectBoxStep = 0;
let selectBoxCorner1 = null;
let currentSelectionBox = null;
let isXrayActive = false;
let xrayMeshes = [];

export function setXrayActive(active) {
  isXrayActive = !!active;
  return isXrayActive;
}

export function getXrayActive() {
  return isXrayActive;
}

export const BLOCK_COLORS = {
  stone: 0x828282,
  stone_bricks: 0x767676,
  cracked_stone_bricks: 0x6e6e6e,
  mossy_stone_bricks: 0x5e7256,
  cobblestone: 0x696969,
  mossy_cobblestone: 0x546b50,
  oak_planks: 0xb58e58,
  spruce_planks: 0x6c4c2d,
  birch_planks: 0xd7cb8d,
  dark_oak_planks: 0x3d2715,
  cherry_planks: 0xdf8f8f,
  oak_log: 0x6d5334,
  spruce_log: 0x3b2a1a,
  dark_oak_log: 0x2e1e12,
  white_terracotta: 0xd1b1a1,
  bricks: 0x994837,
  glass: 0xa8d5e5,
  glass_pane: 0xa8d5e5,
  water: 0x2266aa,
  iron_bars: 0x888888,
  dirt: 0x866043,
  grass_block: 0x4f8737,
  sandstone: 0xd9c999,
  deepslate_bricks: 0x3b3b44,
  blackstone: 0x26232d
};

export function getBlockColor(name) {
  const clean = (name || '').replace(/\[.*\]$/, '').replace('minecraft:', '').toLowerCase();
  if (BLOCK_COLORS[clean]) return BLOCK_COLORS[clean];
  if (clean.includes('plank')) return 0x967347;
  if (clean.includes('stair')) return 0x84705a;
  if (clean.includes('slab')) return 0x7c6954;
  if (clean.includes('brick')) return 0x777777;
  if (clean.includes('log') || clean.includes('wood')) return 0x543d2b;
  if (clean.includes('glass')) return 0xbee1ee;
  if (clean.includes('leaf') || clean.includes('leaves')) return 0x3a6a28;
  if (clean.includes('door') || clean.includes('trapdoor')) return 0x705232;
  return 0x8a9ba8;
}

export function getCurrentSelectionBox() {
  return currentSelectionBox;
}

export function initThree(containerEl = null) {
  const container = containerEl || document.getElementById('threeContainer');
  if (!container || typeof THREE === 'undefined') return;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f16);

  camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
  camera.position.set(24, 20, 30);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 5, 0);
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambientLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(30, 50, 40);
  scene.add(dirLight);

  const gridHelper = new THREE.GridHelper(48, 48, 0x00e5ff, 0x1f2e42);
  gridHelper.position.y = -0.01;
  scene.add(gridHelper);

  voxelGroup = new THREE.Group();
  scene.add(voxelGroup);

  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  window.addEventListener('resize', () => {
    if (!container || !camera || !renderer) return;
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
  });

  renderer.domElement.addEventListener('pointerdown', onThreePointerDown);

  function animate() {
    requestAnimationFrame(animate);
    if (controls) controls.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  }
  animate();
}

function onThreePointerDown(event) {
  if (event.button !== 0) return; // Left-click only for CAD interactions
  if (activeTool === 'orbit') return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const targets = (voxelGroup && voxelGroup.children.length > 0)
    ? voxelGroup.children
    : Array.from(voxelMeshMap.values());
  const intersects = raycaster.intersectObjects(targets, false);

  if (intersects.length === 0) return;

  const hit = intersects[0];
  const voxelData = (hit.object.isInstancedMesh && hit.object.userData?.instanceData)
    ? hit.object.userData.instanceData[hit.instanceId]
    : hit.object.userData;

  if (!voxelData) return;

  const txtBrushBlock = document.getElementById('txtBrushBlock');

  if (activeTool === 'brush') {
    const norm = hit.face.normal;
    const targetX = voxelData.x + Math.round(norm.x);
    const targetY = voxelData.y + Math.round(norm.y);
    const targetZ = voxelData.z + Math.round(norm.z);
    const blockString = (txtBrushBlock?.value || 'stone_bricks').trim();

    sendWS({
      type: 'manual_voxel_edit',
      x: targetX,
      y: targetY,
      z: targetZ,
      blockString
    });
  } else if (activeTool === 'eraser') {
    sendWS({
      type: 'manual_voxel_edit',
      x: voxelData.x,
      y: voxelData.y,
      z: voxelData.z,
      blockString: 'air'
    });
  } else if (activeTool === 'eyedropper') {
    if (txtBrushBlock) txtBrushBlock.value = voxelData.name;
    setActiveTool('brush');
  } else if (activeTool === 'selectBox') {
    if (selectBoxStep === 0) {
      selectBoxCorner1 = { x: voxelData.x, y: voxelData.y, z: voxelData.z };
      selectBoxStep = 1;
      updateSelectionGizmo(selectBoxCorner1, selectBoxCorner1);
    } else {
      const corner2 = { x: voxelData.x, y: voxelData.y, z: voxelData.z };
      const minX = Math.min(selectBoxCorner1.x, corner2.x);
      const maxX = Math.max(selectBoxCorner1.x, corner2.x);
      const minY = Math.min(selectBoxCorner1.y, corner2.y);
      const maxY = Math.max(selectBoxCorner1.y, corner2.y);
      const minZ = Math.min(selectBoxCorner1.z, corner2.z);
      const maxZ = Math.max(selectBoxCorner1.z, corner2.z);

      currentSelectionBox = { minX, minY, minZ, maxX, maxY, maxZ };
      selectBoxStep = 0;
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

export function updateSelectionGizmo(c1, c2) {
  if (!scene || typeof THREE === 'undefined') return;
  if (selectionBoxGizmo) {
    scene.remove(selectionBoxGizmo);
    selectionBoxGizmo = null;
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

  selectionBoxGizmo = group;
  scene.add(selectionBoxGizmo);
}

export function clearSelectionBox() {
  currentSelectionBox = null;
  selectBoxStep = 0;
  selectBoxCorner1 = null;
  if (selectionBoxGizmo && scene) {
    scene.remove(selectionBoxGizmo);
    selectionBoxGizmo = null;
  }
  const selectionBadgeNotice = document.getElementById('selectionBadgeNotice');
  if (selectionBadgeNotice) selectionBadgeNotice.classList.add('hidden');
}

export function setActiveTool(tool) {
  activeTool = tool;
  const toolOrbit = document.getElementById('toolOrbit');
  const toolSelectBox = document.getElementById('toolSelectBox');
  const toolBrush = document.getElementById('toolBrush');
  const toolEraser = document.getElementById('toolEraser');
  const toolEyedropper = document.getElementById('toolEyedropper');

  [toolOrbit, toolSelectBox, toolBrush, toolEraser, toolEyedropper].forEach(b => {
    if (b) b.classList.remove('active');
  });

  if (tool === 'orbit' && toolOrbit) toolOrbit.classList.add('active');
  if (tool === 'selectBox' && toolSelectBox) toolSelectBox.classList.add('active');
  if (tool === 'brush' && toolBrush) toolBrush.classList.add('active');
  if (tool === 'eraser' && toolEraser) toolEraser.classList.add('active');
  if (tool === 'eyedropper' && toolEyedropper) toolEyedropper.classList.add('active');

  if (controls) {
    if (tool === 'orbit') {
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    } else {
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    }
    controls.enableRotate = true;
  }
}

export function renderVoxelPreview(data) {
  const threeOverlayNotice = document.getElementById('threeOverlayNotice');
  if (threeOverlayNotice) threeOverlayNotice.classList.add('hidden');

  if (voxelGroup) {
    const disposedGeometries = new Set();
    const disposedMaterials = new Set();
    while (voxelGroup.children.length > 0) {
      const obj = voxelGroup.children.pop();
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
  voxelMeshMap.clear();

  const blocks = data.blocks || [];
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const matCache = new Map();

  let maxY = 0;
  for (const b of blocks) {
    if (b.y > maxY) maxY = b.y;
  }

  // Für Großprojekte (> 2500 Voxel) optimiertes InstancedMesh-Rendering nutzen
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
      if (voxelGroup) voxelGroup.add(instMesh);
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
      if (voxelGroup) voxelGroup.add(mesh);
      voxelMeshMap.set(`${b.x},${b.y},${b.z}`, mesh);
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

  if (data.bounds && controls) {
    const cx = (data.bounds.minX + data.bounds.maxX + 1) / 2;
    const cy = (data.bounds.minY + data.bounds.maxY + 1) / 2;
    const cz = (data.bounds.minZ + data.bounds.maxZ + 1) / 2;
    controls.target.set(cx, cy, cz);
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
}

export function renderTerrainXray(blocks, isSimulated = false) {
  if (!scene) return;
  xrayMeshes.forEach(m => scene.remove(m));
  xrayMeshes = [];

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

  if (!isXrayActive || blocks.length === 0) return;

  const geom = new THREE.BoxGeometry(0.98, 0.98, 0.98);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.5, wireframe: false });
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.5, wireframe: false });

  for (const b of blocks) {
    const mat = b.isCollision ? redMat : blueMat;
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    scene.add(mesh);
    xrayMeshes.push(mesh);
  }
}

export function handleVoxelDelta(msg) {
  const { x, y, z, blockString } = msg;
  const key = `${x},${y},${z}`;
  const isAir = !blockString || blockString === 'air' || blockString === 'cave_air' || blockString === 'void_air';

  if (isAir) {
    const existing = voxelMeshMap.get(key);
    if (existing && voxelGroup) {
      voxelGroup.remove(existing);
      if (existing.geometry) existing.geometry.dispose();
      if (existing.material) existing.material.dispose();
      voxelMeshMap.delete(key);
    }
  } else {
    const match = blockString.match(/^([^\[]+)/);
    const blockName = match ? match[1] : blockString;
    const color = getBlockColor(blockName);

    let existing = voxelMeshMap.get(key);
    if (existing) {
      if (existing.material) existing.material.dispose();
      existing.material = new THREE.MeshLambertMaterial({ color });
      existing.userData = { x, y, z, name: blockName };
    } else {
      const geom = new THREE.BoxGeometry(1, 1, 1);
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
      mesh.userData = { x, y, z, name: blockName };
      if (voxelGroup) voxelGroup.add(mesh);
      voxelMeshMap.set(key, mesh);
    }
  }

  const previewStats = document.getElementById('previewStats');
  if (previewStats) {
    const totalCount = (voxelGroup && voxelGroup.children.some(c => c.isInstancedMesh))
      ? 'Voxel (Instanced) aktualisiert'
      : `${voxelMeshMap.size} Voxel geladen`;
    previewStats.textContent = totalCount;
  }
}

export function applyYSlice(maxY) {
  // 1. Reguläre Einzel-Meshes
  for (const mesh of voxelMeshMap.values()) {
    mesh.visible = mesh.userData.y <= maxY;
  }

  // 2. InstancedMeshes (Maßstabs-Update der Instanzmatrizen)
  if (voxelGroup && typeof THREE !== 'undefined') {
    const dummy = new THREE.Object3D();
    for (const child of voxelGroup.children) {
      if (child.isInstancedMesh && child.userData?.instanceData) {
        let changed = false;
        for (let i = 0; i < child.userData.instanceData.length; i++) {
          const d = child.userData.instanceData[i];
          if (d.y <= maxY) {
            dummy.position.set(d.x + 0.5, d.y + 0.5, d.z + 0.5);
            dummy.scale.set(1, 1, 1);
          } else {
            dummy.position.set(d.x + 0.5, d.y + 0.5, d.z + 0.5);
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

export function renderBOM(bom, containerEl = null) {
  const bomListContainer = containerEl || document.getElementById('bomListContainer');
  if (!bomListContainer) return;
  bomListContainer.innerHTML = '';
  const entries = Object.entries(bom).sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) {
    bomListContainer.innerHTML = '<span class="empty-hint">Kein Bauplan aktiv.</span>';
    return;
  }

  for (const [name, count] of entries) {
    const row = document.createElement('div');
    row.className = 'bom-row';

    const left = document.createElement('div');
    left.className = 'bom-row-left';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'bom-name';
    nameSpan.textContent = name;

    const countSpan = document.createElement('span');
    countSpan.className = 'bom-count';
    countSpan.textContent = `${count}x`;

    left.appendChild(countSpan);
    left.appendChild(nameSpan);

    const swapBtn = document.createElement('button');
    swapBtn.className = 'btn-swap';
    swapBtn.textContent = '⇄ Tauschen';
    swapBtn.type = 'button';
    swapBtn.onclick = () => openSwapModal(name);

    row.appendChild(left);
    row.appendChild(swapBtn);
    bomListContainer.appendChild(row);
  }
}

export function openSwapModal(fromBlock) {
  const modal = document.createElement('div');
  modal.className = 'swap-dialog-modal';

  const card = document.createElement('div');
  card.className = 'swap-dialog-card';

  card.innerHTML = `
    <div class="swap-dialog-title">Material austauschen: <strong>${fromBlock}</strong></div>
    <label class="control-label">Neuer Blockname:</label>
    <input type="text" id="modalSwapTarget" class="swap-dialog-input" placeholder="z. B. dark_oak_stairs..." value="${fromBlock}">
    <label class="checkbox-container mt-1">
      <input type="checkbox" id="modalSmartGroup" checked>
      <span class="checkmark"></span>
      Ganze Holz-/Steingruppe automatisch mittauschen
    </label>
    <div class="swap-dialog-actions">
      <button id="modalBtnCancel" class="btn btn-secondary btn-sm" type="button">Abbrechen</button>
      <button id="modalBtnApply" class="btn btn-primary btn-sm" type="button">Anwenden</button>
    </div>
  `;

  modal.appendChild(card);
  document.body.appendChild(modal);

  const inputTarget = card.querySelector('#modalSwapTarget');
  const chkSmart = card.querySelector('#modalSmartGroup');
  const btnCancel = card.querySelector('#modalBtnCancel');
  const btnApply = card.querySelector('#modalBtnApply');

  inputTarget?.focus();
  inputTarget?.select();

  btnCancel.onclick = () => document.body.removeChild(modal);
  btnApply.onclick = () => {
    const toBlock = inputTarget.value.trim();
    if (toBlock && toBlock !== fromBlock) {
      sendWS({
        type: 'swap_material',
        fromBlock,
        toBlock,
        smartGroupSwap: chkSmart.checked
      });
    }
    document.body.removeChild(modal);
  };
}

export function applyTheme(themeKey, sendWsFn = null) {
  const sender = sendWsFn || sendWS;
  sender({ type: 'apply_theme', theme: themeKey });
}
