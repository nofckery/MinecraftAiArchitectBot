/**
 * Architect Mission Control — Interactive 3D CAD & Agentic Builder Web Frontend
 */

// ==============================================================================
// 1. WEBSOCKET & STATE MANAGEMENT
// ==============================================================================
let ws = null;
let reconnectTimer = null;
let currentPreviewData = null;
let currentHandoffState = 'ONLINE_ACTIVE';
let currentUsername = 'BaumeisterKI';
let currentSelectionBox = null;
let activeTool = 'orbit'; // 'orbit' | 'selectBox' | 'brush' | 'eraser' | 'eyedropper'
let selectBoxStep = 0;
let selectBoxCorner1 = null;
let isXrayActive = false;
let xrayMeshes = [];
let buildBoxFacing = 'north';
let areaMapData = null;
let mapSelection = null;
let mapIsDragging = false;

// DOM Elements
const pillLlm = document.getElementById('pillLlmProvider');
const pillExec = document.getElementById('pillExecMode');
const connBadge = document.getElementById('connectionStatusBadge');
const connText = document.getElementById('connectionStatusText');

const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const txtPrompt = document.getElementById('txtPrompt');
const chkAutoExecute = document.getElementById('chkAutoExecute');
const selectionBadgeNotice = document.getElementById('selectionBadgeNotice');
const lblSelectionCoords = document.getElementById('lblSelectionCoords');
const btnClearSelectionBox = document.getElementById('btnClearSelectionBox');

const btnConfirmBuild = document.getElementById('btnConfirmBuild');
const btnUndoBuild = document.getElementById('btnUndoBuild');
const btnStopBuild = document.getElementById('btnStopBuild');
const btnExportSchem = document.getElementById('btnExportSchem');
const btnToggleHandoff = document.getElementById('btnToggleHandoff');
const handoffBadge = document.getElementById('handoffStateBadge');
const handoffDesc = document.getElementById('handoffStateDesc');

const previewStats = document.getElementById('previewStats');
const linterBadge = document.getElementById('linterBadge');
const ySliceSlider = document.getElementById('ySliceSlider');
const ySliceValue = document.getElementById('ySliceValue');
const btnResetSlicer = document.getElementById('btnResetSlicer');
const bomListContainer = document.getElementById('bomListContainer');
const asciiBlueprintView = document.getElementById('asciiBlueprintView');
const threeContainer = document.getElementById('threeContainer');
const threeOverlayNotice = document.getElementById('threeOverlayNotice');

// Tools & CAD Elements
const toolOrbit = document.getElementById('toolOrbit');
const toolSelectBox = document.getElementById('toolSelectBox');
const toolBrush = document.getElementById('toolBrush');
const toolEraser = document.getElementById('toolEraser');
const toolEyedropper = document.getElementById('toolEyedropper');
const txtBrushBlock = document.getElementById('txtBrushBlock');
const btnMirrorX = document.getElementById('btnMirrorX');
const btnMirrorZ = document.getElementById('btnMirrorZ');
const btnRotate90 = document.getElementById('btnRotate90');
const btnShiftYUp = document.getElementById('btnShiftYUp');
const btnShiftYDown = document.getElementById('btnShiftYDown');
const btnToggleXray = document.getElementById('btnToggleXray');

// Theme Buttons
const btnThemeMedieval = document.getElementById('btnThemeMedieval');
const btnThemeGothic = document.getElementById('btnThemeGothic');
const btnThemeDesert = document.getElementById('btnThemeDesert');
const btnThemeCherry = document.getElementById('btnThemeCherry');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanes = document.querySelectorAll('.tab-pane');

// Schematics Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const btnBrowseFile = document.getElementById('btnBrowseFile');
const txtSchemUrl = document.getElementById('txtSchemUrl');
const btnImportUrl = document.getElementById('btnImportUrl');
const schematicFilesList = document.getElementById('schematicFilesList');
const btnRefreshSchematics = document.getElementById('btnRefreshSchematics');
const btnCloneServerRegion = document.getElementById('btnCloneServerRegion');

// 2D Map Elements
const areaMapCanvas = document.getElementById('areaMapCanvas');
const mapCtx = areaMapCanvas ? areaMapCanvas.getContext('2d') : null;
const mapTooltip = document.getElementById('mapTooltip');
const btnApplyBuildBox = document.getElementById('btnApplyBuildBox');
const btnRefreshMap = document.getElementById('btnRefreshMap');
const selectionDimensions = document.getElementById('selectionDimensions');
const facingBtns = document.querySelectorAll('.btn-facing');

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${location.host}`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    connBadge.className = 'status-badge online';
    connText.textContent = 'Verbunden';
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onclose = () => {
    connBadge.className = 'status-badge paused';
    connText.textContent = 'Getrennt — Neu verbinden...';
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(connectWebSocket, 2000);
    }
  };

  ws.onerror = (err) => {
    console.error('WebSocket Error:', err);
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    } catch (e) {
      console.warn('JSON Parse Error:', e);
    }
  };
}

function sendWS(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  } else {
    console.warn('WebSocket nicht verbunden:', obj);
  }
}

// ==============================================================================
// 2. SERVER MESSAGE DISPATCHER
// ==============================================================================
function handleServerMessage(msg) {
  switch (msg.type) {
    case 'status':
      updateStatus(msg);
      break;
    case 'chat_history':
      if (Array.isArray(msg.history)) {
        chatMessages.innerHTML = '';
        msg.history.forEach(appendChatMessage);
      }
      break;
    case 'chat_log':
      appendChatMessage(msg);
      break;
    case 'bot_telemetry':
      updateTelemetry(msg);
      break;
    case 'area_map_data':
      areaMapData = msg;
      renderAreaMap();
      break;
    case 'voxel_preview':
      currentPreviewData = msg;
      renderVoxelPreview(msg);
      break;
    case 'terrain_xray_data':
      renderTerrainXray(msg.blocks || [], !!msg.isSimulated);
      break;
    case 'voxel_delta':
      handleVoxelDelta(msg);
      break;
    default:
      break;
  }
}

function updateStatus(msg) {
  if (msg.username) currentUsername = msg.username;
  currentHandoffState = msg.state || 'ONLINE_ACTIVE';
  updateHandoffUI(currentHandoffState);
  if (msg.mode && pillExec) {
    pillExec.textContent = msg.mode;
  }

  // 2.4 Dynamische Viewer-URL und Port-Auflösung
  const viewerPort = msg.viewerPort || 3081;
  const lblPort = document.getElementById('lblViewerPort');
  if (lblPort) lblPort.textContent = viewerPort;
  const viewerFrame = document.getElementById('viewerFrame');
  if (viewerFrame) {
    const targetUrl = `${window.location.protocol}//${window.location.hostname}:${viewerPort}`;
    if (!viewerFrame.src || viewerFrame.src === 'about:blank' || viewerFrame.src.includes('localhost')) {
      viewerFrame.src = targetUrl;
    }
  }
}

function updateHandoffUI(state) {
  if (state === 'ONLINE_ACTIVE') {
    handoffBadge.className = 'handoff-badge state-online';
    handoffBadge.textContent = `Bot Online (${currentUsername || 'DeinAccount'})`;
    handoffDesc.textContent = 'Bot steuert den Account. Wenn du selbst joinst, pausiert er automatisch.';
    btnToggleHandoff.textContent = 'Account freigeben / Bot pausieren';
    btnToggleHandoff.title = 'Account freigeben / Bot pausieren';
    btnToggleHandoff.disabled = false;
  } else if (state === 'PAUSED_OWNER_INGAME') {
    handoffBadge.className = 'handoff-badge state-paused';
    handoffBadge.textContent = 'Pausiert (Du bist im Spiel)';
    handoffDesc.textContent = 'Menschlicher Spieler ist ingame. Bot pausiert und wartet auf deinen Disconnect.';
    btnToggleHandoff.textContent = 'Bot wieder einloggen';
    btnToggleHandoff.title = 'Account wieder übernehmen & Weiterbauen';
    btnToggleHandoff.disabled = false;
  } else if (state === 'RECONNECTING') {
    handoffBadge.className = 'handoff-badge state-reconnecting';
    handoffBadge.textContent = 'Reconnecting...';
    handoffDesc.textContent = 'Cooldown läuft. Bot loggt in Kürze wieder ein...';
    btnToggleHandoff.textContent = 'Verbinde...';
    btnToggleHandoff.title = 'Verbinde...';
    btnToggleHandoff.disabled = true;
  }
}

function updateTelemetry(msg) {
  if (msg.username) {
    const prevUsername = currentUsername;
    currentUsername = msg.username;
    if (prevUsername !== currentUsername) {
      updateHandoffUI(currentHandoffState);
    }
  }
  if (msg.status && msg.status !== currentHandoffState) {
    currentHandoffState = msg.status;
    updateHandoffUI(currentHandoffState);
  }
  if (pillLlm && msg.llmProvider) pillLlm.textContent = msg.llmProvider;
  if (pillExec && msg.mode) pillExec.textContent = msg.mode;

  const lblBotPos = document.getElementById('lblBotPos');
  if (lblBotPos && msg.pos) {
    lblBotPos.textContent = `X: ${msg.pos.x}, Y: ${msg.pos.y}, Z: ${msg.pos.z}`;
  }

  const lblBotVitals = document.getElementById('lblBotVitals');
  if (lblBotVitals) {
    lblBotVitals.textContent = `❤ ${msg.health} / 🍖 ${msg.food}`;
  }

  if (msg.buildProgress) {
    const lblBuildPhase = document.getElementById('lblBuildPhase');
    const lblProgressTitle = document.getElementById('lblProgressTitle');
    const lblProgressPercent = document.getElementById('lblProgressPercent');
    const progressBarFill = document.getElementById('progressBarFill');
    const lblBuildEta = document.getElementById('lblBuildEta');

    if (lblBuildPhase) lblBuildPhase.textContent = msg.buildProgress.phase || 'Bereit';
    if (lblProgressTitle) lblProgressTitle.textContent = msg.buildProgress.title || 'Inaktiv';

    let percent = 0;
    if (typeof msg.buildProgress.progress === 'number') {
      percent = Math.round(msg.buildProgress.progress * 100);
    } else if (msg.buildProgress.totalBlocks > 0) {
      percent = Math.min(100, Math.round((msg.buildProgress.currentBlock / msg.buildProgress.totalBlocks) * 100));
    }
    if (lblProgressPercent) lblProgressPercent.textContent = `${percent}%`;
    if (progressBarFill) progressBarFill.style.width = `${percent}%`;

    if (lblBuildEta) {
      if (msg.buildProgress.active && msg.buildProgress.totalBlocks > msg.buildProgress.currentBlock) {
        const remaining = msg.buildProgress.totalBlocks - msg.buildProgress.currentBlock;
        const etaSeconds = Math.ceil(remaining / 12);
        if (etaSeconds < 60) {
          lblBuildEta.textContent = `${etaSeconds}s`;
        } else {
          const mins = Math.floor(etaSeconds / 60);
          const secs = etaSeconds % 60;
          lblBuildEta.textContent = `${mins}m ${secs}s`;
        }
      } else {
        lblBuildEta.textContent = '-';
      }
    }
  }
}

function appendChatMessage(entry) {
  const msgDiv = document.createElement('div');
  const sender = (entry.sender || 'SYSTEM').toLowerCase();
  msgDiv.className = `chat-msg ${sender.includes('bot') || sender.includes('ki') ? 'bot' : sender.includes('system') ? 'system' : 'user'}`;

  const senderSpan = document.createElement('span');
  senderSpan.className = 'msg-sender';
  senderSpan.textContent = entry.sender;

  const textSpan = document.createElement('span');
  textSpan.className = 'msg-text';
  textSpan.textContent = entry.message;

  msgDiv.appendChild(senderSpan);
  msgDiv.appendChild(textSpan);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ==============================================================================
// 3. THREE.JS 3D VOXEL PREVIEWER & INTERACTIVE CAD
// ==============================================================================
let scene, camera, renderer, controls;
let voxelGroup, selectionBoxGizmo;
let voxelMeshMap = new Map(); // key "x,y,z" -> THREE.Mesh
let raycaster, mouse;

const BLOCK_COLORS = {
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

function getBlockColor(name) {
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

function initThree() {
  if (!threeContainer) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0f16);

  camera = new THREE.PerspectiveCamera(45, threeContainer.clientWidth / threeContainer.clientHeight, 0.1, 1000);
  camera.position.set(24, 20, 30);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  threeContainer.appendChild(renderer.domElement);

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

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onThreePointerDown);

  animate();
}

function onWindowResize() {
  if (!threeContainer || !camera || !renderer) return;
  camera.aspect = threeContainer.clientWidth / threeContainer.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(threeContainer.clientWidth, threeContainer.clientHeight);
}

function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();
  if (renderer && scene && camera) renderer.render(scene, camera);
}

// 3D Raycasting & Tool Interaction
function onThreePointerDown(event) {
  if (event.button !== 0) return; // Nur linker Mausklick für CAD-Aktionen
  if (activeTool === 'orbit') return;

  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);
  const meshes = Array.from(voxelMeshMap.values());
  const intersects = raycaster.intersectObjects(meshes, false);

  if (intersects.length === 0) return;

  const hit = intersects[0];
  const voxelData = hit.object.userData; // { x, y, z, name }

  if (activeTool === 'brush') {
    // Voxel an der Nachbarfläche setzen
    const norm = hit.face.normal;
    const targetX = voxelData.x + Math.round(norm.x);
    const targetY = voxelData.y + Math.round(norm.y);
    const targetZ = voxelData.z + Math.round(norm.z);
    const blockString = (txtBrushBlock.value || 'stone_bricks').trim();

    sendWS({
      type: 'manual_voxel_edit',
      x: targetX,
      y: targetY,
      z: targetZ,
      blockString
    });
  } else if (activeTool === 'eraser') {
    // Voxel löschen
    sendWS({
      type: 'manual_voxel_edit',
      x: voxelData.x,
      y: voxelData.y,
      z: voxelData.z,
      blockString: 'air'
    });
  } else if (activeTool === 'eyedropper') {
    // Material pipettieren
    txtBrushBlock.value = voxelData.name;
    setActiveTool('brush');
  } else if (activeTool === 'selectBox') {
    // 3D-Bereich markieren (2 Klicks für Diagonale)
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

      lblSelectionCoords.textContent = `(${minX}..${maxX}, ${minY}..${maxY}, ${minZ}..${maxZ})`;
      selectionBadgeNotice.classList.remove('hidden');
    }
  }
}

function updateSelectionGizmo(c1, c2) {
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

function clearSelectionBox() {
  currentSelectionBox = null;
  selectBoxStep = 0;
  selectBoxCorner1 = null;
  if (selectionBoxGizmo) {
    scene.remove(selectionBoxGizmo);
    selectionBoxGizmo = null;
  }
  selectionBadgeNotice.classList.add('hidden');
}

function setActiveTool(tool) {
  activeTool = tool;
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
      // Bei CAD-Werkzeugen (Brush/Eraser/SelectBox): Links = CAD-Aktion, Rechts = Kamera rotieren
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    }
    controls.enableRotate = true;
  }
}

// 3D Voxel Render
function renderVoxelPreview(data) {
  threeOverlayNotice.classList.add('hidden');
  while (voxelGroup.children.length > 0) {
    const obj = voxelGroup.children.pop();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  }
  voxelMeshMap.clear();

  const blocks = data.blocks || [];
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const matCache = new Map();

  let maxY = 0;
  for (const b of blocks) {
    if (b.y > maxY) maxY = b.y;
    const color = getBlockColor(b.name);
    let mat = matCache.get(color);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color });
      matCache.set(color, mat);
    }

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
    mesh.userData = { x: b.x, y: b.y, z: b.z, name: b.name, properties: b.properties };
    voxelGroup.add(mesh);
    voxelMeshMap.set(`${b.x},${b.y},${b.z}`, mesh);
  }

  // Update Y-Slice Slider
  ySliceSlider.min = 1;
  ySliceSlider.max = Math.max(1, maxY + 1);
  ySliceSlider.value = ySliceSlider.max;
  ySliceSlider.disabled = false;
  ySliceValue.textContent = `Schnitt-Höhe Y: 1 bis Max (${ySliceSlider.max})`;

  // Center Controls
  if (data.bounds) {
    const cx = (data.bounds.minX + data.bounds.maxX + 1) / 2;
    const cy = (data.bounds.minY + data.bounds.maxY + 1) / 2;
    const cz = (data.bounds.minZ + data.bounds.maxZ + 1) / 2;
    controls.target.set(cx, cy, cz);
  }

  previewStats.textContent = `${blocks.length} Voxel geladen`;
  btnConfirmBuild.disabled = blocks.length === 0;

  // Linter Status
  if (data.lintReport) {
    const passed = data.lintReport.passed;
    linterBadge.className = `linter-badge ${passed ? 'pass' : 'warn'}`;
    linterBadge.textContent = passed ? 'Linter: Bestanden' : 'Linter: Warnungen';
  }

  // Render BOM & ASCII
  renderBOM(data.bom || {});
  if (asciiBlueprintView && data.asciiReport) {
    asciiBlueprintView.textContent = data.asciiReport;
  }
}

function renderTerrainXray(blocks, isSimulated = false) {
  xrayMeshes.forEach(m => scene.remove(m));
  xrayMeshes = [];

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

function handleVoxelDelta(msg) {
  const { x, y, z, blockString } = msg;
  const key = `${x},${y},${z}`;
  const isAir = !blockString || blockString === 'air' || blockString === 'cave_air' || blockString === 'void_air';

  if (isAir) {
    const existing = voxelMeshMap.get(key);
    if (existing) {
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
      voxelGroup.add(mesh);
      voxelMeshMap.set(key, mesh);
    }
  }

  previewStats.textContent = `${voxelMeshMap.size} Voxel geladen`;
}

// ==============================================================================
// 4. PALETTE SWAPPER & BOM
// ==============================================================================
function renderBOM(bom) {
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

function openSwapModal(fromBlock) {
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

  inputTarget.focus();
  inputTarget.select();

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

// Quick Theme Presets
function applyTheme(themeKey) {
  sendWS({ type: 'apply_theme', theme: themeKey });
}

// ==============================================================================
// 5. SCHEMATICS & IMPORT HANDLERS
// ==============================================================================
async function loadSchematicsList() {
  if (!schematicFilesList) return;
  try {
    const res = await fetch('/api/schematics');
    const data = await res.json();
    schematicFilesList.innerHTML = '';

    if (!data.files || data.files.length === 0) {
      schematicFilesList.innerHTML = '<span class="empty-hint">Keine Schematics vorhanden.</span>';
      return;
    }

    for (const f of data.files) {
      const item = document.createElement('div');
      item.className = 'schem-file-item';

      const info = document.createElement('div');
      info.className = 'schem-file-info';

      const name = document.createElement('span');
      name.className = 'schem-file-name';
      name.textContent = f.name;

      const meta = document.createElement('span');
      meta.className = 'schem-file-meta';
      meta.textContent = `${(f.size / 1024).toFixed(1)} KB • .${f.format}`;

      info.appendChild(name);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'schem-file-actions';

      const loadBtn = document.createElement('button');
      loadBtn.className = 'btn btn-secondary btn-sm';
      loadBtn.textContent = '3D-Editor';
      loadBtn.title = 'In 3D-Editor laden';
      loadBtn.onclick = () => {
        sendWS({ type: 'load_saved_schematic', filename: f.name });
      };

      const dlBtn = document.createElement('button');
      dlBtn.className = 'btn btn-secondary btn-sm';
      dlBtn.textContent = '📥';
      dlBtn.title = 'Als .schem herunterladen';
      dlBtn.onclick = () => {
        window.open(`/api/schematics/export/${encodeURIComponent(f.name.replace(/\.[^/.]+$/, ''))}`);
      };

      actions.appendChild(loadBtn);
      actions.appendChild(dlBtn);
      item.appendChild(info);
      item.appendChild(actions);
      schematicFilesList.appendChild(item);
    }
  } catch (err) {
    schematicFilesList.innerHTML = `<span class="empty-hint">Fehler: ${err.message}</span>`;
  }
}

async function uploadSchematicFile(file) {
  if (!file) return;
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/api/schematics/upload', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      loadSchematicsList();
    } else {
      alert(`Fehler beim Upload: ${result.error}`);
    }
  } catch (err) {
    alert(`Upload-Fehler: ${err.message}`);
  }
}

async function importFromUrl(url) {
  if (!url) return;
  try {
    const res = await fetch('/api/schematics/import-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const result = await res.json();
    if (result.success) {
      txtSchemUrl.value = '';
      loadSchematicsList();
    } else {
      alert(`Fehler beim Import: ${result.error}`);
    }
  } catch (err) {
    alert(`Import-Fehler: ${err.message}`);
  }
}

// ==============================================================================
// 6. 2D AREA MAP CANVAS
// ==============================================================================
function renderAreaMap() {
  if (!mapCtx || !areaMapData) return;

  // 2.1 Offline-Simulationsanzeige aktualisieren
  const mapNotice = document.getElementById('mapSimulatedNotice');
  if (mapNotice) {
    if (areaMapData.isSimulated) {
      mapNotice.classList.remove('hidden');
    } else {
      mapNotice.classList.add('hidden');
    }
  }

  const grid = areaMapData.grid || [];
  const dim = 64;
  const tileSize = areaMapCanvas.width / dim;
  const centerY = areaMapData.center?.y ?? 64;

  mapCtx.fillStyle = '#070b10';
  mapCtx.fillRect(0, 0, areaMapCanvas.width, areaMapCanvas.height);

  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    const col = (cell.x - areaMapData.center.x + 32);
    const row = (cell.z - areaMapData.center.z + 32);

    let color = '#388e3c'; // grass default
    const bName = (cell.blockName || '').toLowerCase();
    if (bName.includes('water')) {
      color = '#1976d2';
    } else if (bName.includes('wall') || bName.includes('fence')) {
      color = '#616161'; // wall
    } else if (bName.includes('brick')) {
      color = '#757575'; // brick
    } else if (bName.includes('stone') || bName.includes('deepslate') || bName.includes('cobble')) {
      color = '#78909c'; // stone
    } else if (bName.includes('wood') || bName.includes('log') || bName.includes('plank') || bName.includes('dirt')) {
      color = '#8d6e63'; // wood / dirt
    } else if (bName.includes('sand')) {
      color = '#d9c999'; // sand
    }

    mapCtx.fillStyle = color;
    mapCtx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);

    // Topographic Höhenlinien / Contour lines & Elevation shading
    const yDiff = (typeof cell.y === 'number') ? (cell.y - centerY) : 0;
    if (yDiff !== 0) {
      const tintAlpha = Math.min(0.25, Math.abs(yDiff) * 0.03);
      mapCtx.fillStyle = yDiff > 0 ? `rgba(255, 255, 255, ${tintAlpha})` : `rgba(0, 0, 0, ${tintAlpha})`;
      mapCtx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
    }

    // Höhenlinien (contour steps every 4 blocks)
    if (typeof cell.y === 'number' && Math.abs(cell.y) % 4 === 0) {
      mapCtx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      mapCtx.fillRect(col * tileSize, row * tileSize, tileSize, 1);
    }
  }

  // Draw Bot Position
  const bCol = 32 * tileSize;
  const bRow = 32 * tileSize;
  mapCtx.fillStyle = '#f43f5e';
  mapCtx.beginPath();
  mapCtx.arc(bCol + tileSize / 2, bRow + tileSize / 2, tileSize * 1.2, 0, Math.PI * 2);
  mapCtx.fill();

  // Draw Selection Box on Map if present
  if (mapSelection) {
    const minCol = Math.min(mapSelection.x1, mapSelection.x2);
    const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
    const minRow = Math.min(mapSelection.z1, mapSelection.z2);
    const maxRow = Math.max(mapSelection.z1, mapSelection.z2);

    const x = minCol * tileSize;
    const y = minRow * tileSize;
    const w = (maxCol - minCol + 1) * tileSize;
    const h = (maxRow - minRow + 1) * tileSize;

    mapCtx.strokeStyle = '#00e5ff';
    mapCtx.lineWidth = 2;
    mapCtx.strokeRect(x, y, w, h);
    mapCtx.fillStyle = 'rgba(0, 229, 255, 0.2)';
    mapCtx.fillRect(x, y, w, h);

    // Draw Facade Edge Highlight
    mapCtx.save();
    mapCtx.strokeStyle = '#ffea00';
    mapCtx.lineWidth = 3;
    mapCtx.beginPath();
    if (buildBoxFacing === 'north') {
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x + w, y);
    } else if (buildBoxFacing === 'south') {
      mapCtx.moveTo(x, y + h);
      mapCtx.lineTo(x + w, y + h);
    } else if (buildBoxFacing === 'west') {
      mapCtx.moveTo(x, y);
      mapCtx.lineTo(x, y + h);
    } else if (buildBoxFacing === 'east') {
      mapCtx.moveTo(x + w, y);
      mapCtx.lineTo(x + w, y + h);
    }
    mapCtx.stroke();
    mapCtx.restore();

    // Draw Direction Arrow indicating Facade / Entrance Door
    mapCtx.save();
    mapCtx.fillStyle = '#ffea00';
    mapCtx.strokeStyle = '#0a0e14';
    mapCtx.lineWidth = 1.5;

    const arrowLen = Math.max(12, Math.min(22, tileSize * 2));
    const arrowHalf = arrowLen * 0.55;

    mapCtx.beginPath();
    if (buildBoxFacing === 'north') {
      const cx = Math.max(arrowHalf + 2, Math.min(areaMapCanvas.width - arrowHalf - 2, x + w / 2));
      const cy = y;
      const shiftY = Math.max(0, 4 - (cy - arrowLen));
      const ay = cy + shiftY;
      mapCtx.moveTo(cx, ay - arrowLen);
      mapCtx.lineTo(cx + arrowHalf, ay + 1);
      mapCtx.lineTo(cx + arrowHalf * 0.35, ay + 1);
      mapCtx.lineTo(cx + arrowHalf * 0.35, ay + arrowLen * 0.6);
      mapCtx.lineTo(cx - arrowHalf * 0.35, ay + arrowLen * 0.6);
      mapCtx.lineTo(cx - arrowHalf * 0.35, ay + 1);
      mapCtx.lineTo(cx - arrowHalf, ay + 1);
    } else if (buildBoxFacing === 'south') {
      const cx = Math.max(arrowHalf + 2, Math.min(areaMapCanvas.width - arrowHalf - 2, x + w / 2));
      const cy = y + h;
      const shiftY = Math.min(0, (areaMapCanvas.height - 4) - (cy + arrowLen));
      const ay = cy + shiftY;
      mapCtx.moveTo(cx, ay + arrowLen);
      mapCtx.lineTo(cx + arrowHalf, ay - 1);
      mapCtx.lineTo(cx + arrowHalf * 0.35, ay - 1);
      mapCtx.lineTo(cx + arrowHalf * 0.35, ay - arrowLen * 0.6);
      mapCtx.lineTo(cx - arrowHalf * 0.35, ay - arrowLen * 0.6);
      mapCtx.lineTo(cx - arrowHalf * 0.35, ay - 1);
      mapCtx.lineTo(cx - arrowHalf, ay - 1);
    } else if (buildBoxFacing === 'west') {
      const cx = x;
      const cy = Math.max(arrowHalf + 2, Math.min(areaMapCanvas.height - arrowHalf - 2, y + h / 2));
      const shiftX = Math.max(0, 4 - (cx - arrowLen));
      const ax = cx + shiftX;
      mapCtx.moveTo(ax - arrowLen, cy);
      mapCtx.lineTo(ax + 1, cy - arrowHalf);
      mapCtx.lineTo(ax + 1, cy - arrowHalf * 0.35);
      mapCtx.lineTo(ax + arrowLen * 0.6, cy - arrowHalf * 0.35);
      mapCtx.lineTo(ax + arrowLen * 0.6, cy + arrowHalf * 0.35);
      mapCtx.lineTo(ax + 1, cy + arrowHalf * 0.35);
      mapCtx.lineTo(ax + 1, cy + arrowHalf);
    } else if (buildBoxFacing === 'east') {
      const cx = x + w;
      const cy = Math.max(arrowHalf + 2, Math.min(areaMapCanvas.height - arrowHalf - 2, y + h / 2));
      const shiftX = Math.min(0, (areaMapCanvas.width - 4) - (cx + arrowLen));
      const ax = cx + shiftX;
      mapCtx.moveTo(ax + arrowLen, cy);
      mapCtx.lineTo(ax - 1, cy - arrowHalf);
      mapCtx.lineTo(ax - 1, cy - arrowHalf * 0.35);
      mapCtx.lineTo(ax - arrowLen * 0.6, cy - arrowHalf * 0.35);
      mapCtx.lineTo(ax - arrowLen * 0.6, cy + arrowHalf * 0.35);
      mapCtx.lineTo(ax - 1, cy + arrowHalf * 0.35);
      mapCtx.lineTo(ax - 1, cy + arrowHalf);
    }
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.stroke();
    mapCtx.restore();
  }
}

// ==============================================================================
// 7. EVENT LISTENERS SETUP
// ==============================================================================
function initEventListeners() {
  // Tabs
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = document.getElementById(btn.dataset.tab);
      if (pane) pane.classList.add('active');
      if (btn.dataset.tab === 'tab-schematics') loadSchematicsList();
    });
  });

  // CAD Tools
  toolOrbit.onclick = () => setActiveTool('orbit');
  toolSelectBox.onclick = () => setActiveTool('selectBox');
  toolBrush.onclick = () => setActiveTool('brush');
  toolEraser.onclick = () => setActiveTool('eraser');
  toolEyedropper.onclick = () => setActiveTool('eyedropper');

  // CAD Transforms
  btnMirrorX.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_x' });
  btnMirrorZ.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'mirror_z' });
  btnRotate90.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'rotate_90_cw' });
  btnShiftYUp.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_up' });
  btnShiftYDown.onclick = () => sendWS({ type: 'transform_canvas', transformMode: 'shift_y_down' });

  // X-Ray Toggle
  btnToggleXray.onclick = () => {
    isXrayActive = !isXrayActive;
    btnToggleXray.classList.toggle('active', isXrayActive);
    if (isXrayActive) {
      sendWS({ type: 'request_terrain_xray' });
    } else {
      xrayMeshes.forEach(m => scene.remove(m));
      xrayMeshes = [];
    }
  };

  // Quick Themes
  btnThemeMedieval.onclick = () => applyTheme('medieval_spruce');
  btnThemeGothic.onclick = () => applyTheme('deepslate_gothic');
  btnThemeDesert.onclick = () => applyTheme('desert_sandstone');
  btnThemeCherry.onclick = () => applyTheme('cherry_asian');

  // Clear Selection Box
  btnClearSelectionBox.onclick = clearSelectionBox;

  // Y-Slice Slider
  ySliceSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    ySliceValue.textContent = `Schnitt-Höhe Y: ${val} / ${ySliceSlider.max}`;
    for (const [key, mesh] of voxelMeshMap.entries()) {
      mesh.visible = mesh.userData.y <= val;
    }
  });

  btnResetSlicer.onclick = () => {
    ySliceSlider.value = ySliceSlider.max;
    ySliceValue.textContent = `Schnitt-Höhe Y: 1 bis Max (${ySliceSlider.max})`;
    for (const mesh of voxelMeshMap.values()) {
      mesh.visible = true;
    }
  };

  // Chat Form & Prompt submission
  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const prompt = txtPrompt.value.trim();
    if (!prompt) return;

    if (currentSelectionBox) {
      // Region-AI Refinement Prompt
      sendWS({
        type: 'region_ai_edit',
        instruction: prompt,
        selectionBox: currentSelectionBox
      });
      clearSelectionBox();
    } else {
      // Standard Architect Prompt
      sendWS({
        type: 'prompt_architect',
        text: prompt,
        autoExecute: chkAutoExecute.checked
      });
    }

    txtPrompt.value = '';
  };

  // Quick Chips
  document.querySelectorAll('.chip').forEach(chip => {
    chip.onclick = () => {
      txtPrompt.value = chip.dataset.prompt;
      txtPrompt.focus();
    };
  });

  // Action Buttons
  btnConfirmBuild.onclick = () => sendWS({ type: 'confirm_build' });
  btnUndoBuild.onclick = () => sendWS({ type: 'control_action', action: 'undo' });
  btnStopBuild.onclick = () => sendWS({ type: 'control_action', action: 'stop' });

  btnExportSchem.onclick = () => {
    const rawChoice = window.prompt('Dateiname für Export eingeben (.schem für Sponge/WorldEdit oder .nbt für Vanilla Structure Block):', `architect_${Date.now()}.schem`);
    if (rawChoice) {
      const trimmed = rawChoice.trim();
      const isNbt = trimmed.toLowerCase().endsWith('.nbt');
      const format = isNbt ? 'nbt' : 'schem';
      const cleanName = trimmed.replace(/\.(schem|nbt)$/i, '');
      window.open(`/api/schematics/export/${encodeURIComponent(cleanName)}?format=${format}`);
    }
  };

  const btnReloadViewer = document.getElementById('btnReloadViewer');
  if (btnReloadViewer) {
    btnReloadViewer.onclick = () => {
      const viewerFrame = document.getElementById('viewerFrame');
      const port = document.getElementById('lblViewerPort')?.textContent || 3081;
      if (viewerFrame) {
        viewerFrame.src = `${window.location.protocol}//${window.location.hostname}:${port}`;
      }
    };
  }

  btnToggleHandoff.onclick = () => {
    const isPaused = currentHandoffState === 'PAUSED_OWNER_INGAME';
    sendWS({
      type: 'control_action',
      action: isPaused ? 'resume_bot' : 'pause_for_player'
    });
  };

  // Drag & Drop Schematics
  if (dropZone && fileInput) {
    btnBrowseFile.onclick = () => fileInput.click();
    fileInput.onchange = (e) => {
      if (e.target.files.length > 0) uploadSchematicFile(e.target.files[0]);
    };

    dropZone.ondragover = (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    };
    dropZone.ondragleave = () => dropZone.classList.remove('drag-over');
    dropZone.ondrop = (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      if (e.dataTransfer.files.length > 0) {
        uploadSchematicFile(e.dataTransfer.files[0]);
      }
    };
  }

  // URL Importer
  if (btnImportUrl) {
    btnImportUrl.onclick = () => importFromUrl(txtSchemUrl.value.trim());
  }

  // Refresh Schematics List
  if (btnRefreshSchematics) {
    btnRefreshSchematics.onclick = loadSchematicsList;
  }

  // Reverse Clone
  if (btnCloneServerRegion) {
    btnCloneServerRegion.onclick = () => {
      const minX = parseInt(document.getElementById('cloneMinX').value, 10) || 0;
      const minY = parseInt(document.getElementById('cloneMinY').value, 10) || 64;
      const minZ = parseInt(document.getElementById('cloneMinZ').value, 10) || 0;
      const maxX = parseInt(document.getElementById('cloneMaxX').value, 10) || 15;
      const maxY = parseInt(document.getElementById('cloneMaxY').value, 10) || 75;
      const maxZ = parseInt(document.getElementById('cloneMaxZ').value, 10) || 15;

      sendWS({
        type: 'clone_server_region',
        minX, minY, minZ, maxX, maxY, maxZ
      });
    };
  }

  // Facing selector in 2D Map
  facingBtns.forEach(btn => {
    btn.onclick = () => {
      facingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildBoxFacing = btn.dataset.facing;
      if (mapSelection) {
        const minCol = Math.min(mapSelection.x1, mapSelection.x2);
        const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
        const minRow = Math.min(mapSelection.z1, mapSelection.z2);
        const maxRow = Math.max(mapSelection.z1, mapSelection.z2);
        const w = maxCol - minCol + 1;
        const d = maxRow - minRow + 1;
        selectionDimensions.textContent = `${w}x${d} Blöcke (${buildBoxFacing})`;
        btnApplyBuildBox.disabled = false;
      }
      renderAreaMap();
    };
  });

  // 2D Map Interactions
  if (areaMapCanvas) {
    areaMapCanvas.onmousedown = (e) => {
      const rect = areaMapCanvas.getBoundingClientRect();
      const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
      const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

      if (e.shiftKey) {
        // Shift + Click: move bot
        if (areaMapData) {
          const targetX = areaMapData.center.x - 32 + col;
          const targetZ = areaMapData.center.z - 32 + row;
          const candidate = areaMapData.grid ? areaMapData.grid[col * 64 + row] : null;
          const cell = (candidate && candidate.x === targetX && candidate.z === targetZ)
            ? candidate
            : (areaMapData.grid ? areaMapData.grid.find(c => c.x === targetX && c.z === targetZ) : null);
          const targetY = (cell && typeof cell.y === 'number') ? (cell.y + 1) : (areaMapData.center?.y ?? 64);

          sendWS({
            type: 'control_action',
            action: 'move_to',
            targetPos: { x: targetX, y: targetY, z: targetZ }
          });
        }
        return;
      }

      mapIsDragging = true;
      mapSelection = { x1: col, z1: row, x2: col, z2: row };
      selectionDimensions.textContent = '1x1 Blöcke markiert';
      btnApplyBuildBox.disabled = false;
      renderAreaMap();
    };

    areaMapCanvas.onmousemove = (e) => {
      const rect = areaMapCanvas.getBoundingClientRect();
      const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
      const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

      // Interactive Tooltip
      if (areaMapData && mapTooltip) {
        const worldX = areaMapData.center.x - 32 + col;
        const worldZ = areaMapData.center.z - 32 + row;
        const candidate = areaMapData.grid ? areaMapData.grid[col * 64 + row] : null;
        const cell = (candidate && candidate.x === worldX && candidate.z === worldZ)
          ? candidate
          : (areaMapData.grid ? areaMapData.grid.find(c => c.x === worldX && c.z === worldZ) : null);

        if (cell) {
          const wrapperRect = areaMapCanvas.parentElement ? areaMapCanvas.parentElement.getBoundingClientRect() : rect;
          let tipX = e.clientX - wrapperRect.left + 12;
          let tipY = e.clientY - wrapperRect.top + 12;
          if (tipX + 130 > wrapperRect.width) {
            tipX = e.clientX - wrapperRect.left - 135;
          }
          if (tipY + 45 > wrapperRect.height) {
            tipY = e.clientY - wrapperRect.top - 45;
          }
          mapTooltip.innerHTML = `<strong>${cell.blockName || 'unbekannt'}</strong><br>X: ${cell.x}, Y: ${cell.y}, Z: ${cell.z}`;
          mapTooltip.style.left = `${Math.max(4, Math.min(Math.max(4, wrapperRect.width - 130), tipX))}px`;
          mapTooltip.style.top = `${Math.max(4, Math.min(Math.max(4, wrapperRect.height - 45), tipY))}px`;
          mapTooltip.style.display = 'block';
        } else {
          mapTooltip.style.display = 'none';
        }
      }

      if (!mapIsDragging || !mapSelection) return;

      mapSelection.x2 = col;
      mapSelection.z2 = row;
      const w = Math.abs(mapSelection.x2 - mapSelection.x1) + 1;
      const d = Math.abs(mapSelection.z2 - mapSelection.z1) + 1;
      selectionDimensions.textContent = `${w}x${d} Blöcke markiert`;
      btnApplyBuildBox.disabled = false;
      renderAreaMap();
    };

    areaMapCanvas.onmouseleave = () => {
      if (mapTooltip) {
        mapTooltip.style.display = 'none';
      }
    };

    window.addEventListener('mouseup', () => {
      if (mapIsDragging) mapIsDragging = false;
    });

    btnApplyBuildBox.onclick = () => {
      if (!mapSelection || !areaMapData) return;
      const minCol = Math.min(mapSelection.x1, mapSelection.x2);
      const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
      const minRow = Math.min(mapSelection.z1, mapSelection.z2);
      const maxRow = Math.max(mapSelection.z1, mapSelection.z2);

      const minX = areaMapData.center.x - 32 + minCol;
      const maxX = areaMapData.center.x - 32 + maxCol;
      const minZ = areaMapData.center.z - 32 + minRow;
      const maxZ = areaMapData.center.z - 32 + maxRow;

      let baseY = areaMapData.center.y;
      if (areaMapData.grid) {
        const selectedCells = areaMapData.grid.filter(c => c.x >= minX && c.x <= maxX && c.z >= minZ && c.z <= maxZ && typeof c.y === 'number');
        if (selectedCells.length > 0) {
          baseY = Math.min(...selectedCells.map(c => c.y));
        }
      }

      sendWS({
        type: 'set_build_box',
        minX, minZ, maxX, maxZ,
        baseY,
        facing: buildBoxFacing
      });

      selectionDimensions.textContent = `Fixiert: ${maxCol - minCol + 1}x${maxRow - minRow + 1} (${buildBoxFacing})`;
      btnApplyBuildBox.disabled = true;
    };

    btnRefreshMap.onclick = () => sendWS({ type: 'request_area_map' });
  }
}

// ==============================================================================
// 8. INITIALIZATION
// ==============================================================================
window.addEventListener('DOMContentLoaded', () => {
  initThree();
  initEventListeners();
  connectWebSocket();
  loadSchematicsList();
});
