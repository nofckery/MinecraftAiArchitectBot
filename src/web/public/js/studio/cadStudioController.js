/**
 * CAD World Studio, Scene Inspector, Block Catalog & Omnipresent Spatial AI Controller
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import {
  addSceneObject,
  removeSceneObject,
  selectSceneObject,
  toggleSoloObject,
  updateSceneObject,
  snapObjectToGround,
  getSceneSnapshot
} from '../sceneGraph.js';
import { resizeThreeViewport } from '../threeViewport.js';

let cadDiscoveryData = { worlds: [], externalSchematics: [], localSchematics: [] };
let isVerifierOverlayEnabled = true;
let preFullscreenSidebarHidden = null;
let preFullscreenScanBarHidden = null;

export function getCadDiscoveryData() {
  return cadDiscoveryData;
}

export function isVerifierOverlayActive() {
  return isVerifierOverlayEnabled;
}

export function setVerifierOverlayActive(val) {
  isVerifierOverlayEnabled = Boolean(val);
}

export async function initBlockCatalog() {
  const dl = document.getElementById('minecraftBlocksDatalist');
  if (!dl) return;
  try {
    const res = await fetch('/api/blocks');
    const data = await res.json();
    if (data.success && Array.isArray(data.blocks)) {
      dl.innerHTML = '';
      for (const b of data.blocks) {
        const opt = document.createElement('option');
        opt.value = b.name;
        opt.label = `${b.displayName} (${b.name})`;
        dl.appendChild(opt);
      }
    }
  } catch (err) {
    console.debug('[Blocks] Autocomplete Catalog konnte nicht geladen werden:', err.message);
  }
}

export function updateVerifierBadgesUI(report) {
  const badgesContainer = document.getElementById('studioVerifierBadges');
  const lblSolid = document.getElementById('lblVerifierSolid');
  const lblCol = document.getElementById('lblVerifierCollisions');
  const lblGaps = document.getElementById('lblVerifierGaps');
  if (!report || !report.summary) {
    if (badgesContainer) badgesContainer.classList.add('hidden');
    return;
  }
  const { solidSupportCount = 0, collisionCount = 0, foundationGapCount = 0 } = report.summary;
  if (badgesContainer) {
    badgesContainer.classList.toggle('hidden', solidSupportCount === 0 && collisionCount === 0 && foundationGapCount === 0);
  }
  if (lblSolid) lblSolid.textContent = `🟢 ${solidSupportCount} Solid`;
  if (lblCol) lblCol.textContent = `🔴 ${collisionCount} Kollisionen`;
  if (lblGaps) lblGaps.textContent = `🟡 ${foundationGapCount} Lücken`;
}

export function renderSceneTreeUI(snapshot) {
  const listEl = document.getElementById('sceneTreeList');
  if (!listEl) return;

  if (!snapshot || !Array.isArray(snapshot.objects) || snapshot.objects.length === 0) {
    listEl.innerHTML = '<div class="scene-tree-empty">Noch keine Gebäude in der Szene. Wähle oben ein Schematic oder nutze die KI.</div>';
    return;
  }

  listEl.innerHTML = '';
  for (const obj of snapshot.objects) {
    const row = document.createElement('div');
    row.className = `scene-tree-item${obj.id === snapshot.activeObjectId ? ' active' : ''}`;
    row.onclick = () => selectSceneObject(obj.id);

    const title = document.createElement('span');
    title.className = 'scene-tree-item-title';
    title.textContent = `${obj.category === 'infrastructure' ? '🛤️' : '🏠'} ${obj.name}`;

    const meta = document.createElement('span');
    meta.className = 'scene-tree-item-meta';
    meta.textContent = `(${obj.position.x},${obj.position.y},${obj.position.z})`;

    const actions = document.createElement('div');
    actions.className = 'scene-tree-actions';

    const btnVis = document.createElement('button');
    btnVis.type = 'button';
    btnVis.className = 'scene-tree-btn';
    btnVis.textContent = obj.visible !== false ? '👁️' : '🚫';
    btnVis.title = 'Sichtbarkeit umschalten';
    btnVis.onclick = (e) => {
      e.stopPropagation();
      updateSceneObject(obj.id, { visible: obj.visible === false });
    };

    const btnLock = document.createElement('button');
    btnLock.type = 'button';
    btnLock.className = 'scene-tree-btn';
    btnLock.textContent = obj.locked ? '🔒' : '🔓';
    btnLock.title = 'Sperren / Entsperren';
    btnLock.onclick = (e) => {
      e.stopPropagation();
      updateSceneObject(obj.id, { locked: !obj.locked });
    };

    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'scene-tree-btn';
    btnDel.textContent = '🗑️';
    btnDel.title = 'Aus Szene entfernen';
    btnDel.onclick = (e) => {
      e.stopPropagation();
      removeSceneObject(obj.id);
    };

    actions.appendChild(btnVis);
    actions.appendChild(btnLock);
    actions.appendChild(btnDel);

    row.appendChild(title);
    row.appendChild(meta);
    row.appendChild(actions);
    listEl.appendChild(row);
  }
}

export function syncInspectorUI(snapshot) {
  const inspector = document.getElementById('sceneObjectInspector');
  if (!inspector) return;

  const activeObj = snapshot?.objects?.find(o => o.id === snapshot.activeObjectId);
  if (!activeObj) {
    inspector.classList.add('hidden');
    return;
  }

  inspector.classList.remove('hidden');
  const inpName = document.getElementById('inpActiveObjName');
  const inpX = document.getElementById('inpObjPosX');
  const inpY = document.getElementById('inpObjPosY');
  const inpZ = document.getElementById('inpObjPosZ');
  const btnSolo = document.getElementById('btnSoloActiveObject');

  if (inpName && document.activeElement !== inpName) inpName.value = activeObj.name || '';
  if (inpX && document.activeElement !== inpX) inpX.value = activeObj.position.x;
  if (inpY && document.activeElement !== inpY) inpY.value = activeObj.position.y;
  if (inpZ && document.activeElement !== inpZ) inpZ.value = activeObj.position.z;
  if (btnSolo) btnSolo.classList.toggle('active', snapshot.soloObjectId === activeObj.id);

  document.querySelectorAll('.btn-rot-preset').forEach(btn => {
    const rot = Number(btn.dataset.rot) || 0;
    btn.classList.toggle('active', rot === Number(activeObj.rotation || 0));
  });
}

export function handleStudioAiResult(msg) {
  const statusEl = document.getElementById('lblStudioAiStatus');
  if (statusEl) {
    statusEl.textContent = msg.summary ? `✅ ${msg.summary}` : '✅ KI-Aktion abgeschlossen';
  }
  if (msg.action === 'add_object' && msg.object) {
    addSceneObject(msg.object);
  } else if (msg.action === 'add_objects' && Array.isArray(msg.objects)) {
    for (const o of msg.objects) addSceneObject(o);
  } else if (msg.action === 'update_object' && msg.object) {
    updateSceneObject(msg.object.id, {
      name: msg.object.name,
      blocks: msg.object.blocks,
      position: msg.object.position,
      rotation: msg.object.rotation
    });
  } else if ((msg.action === 'update_layout' || msg.action === 'autofix_scene') && Array.isArray(msg.objects)) {
    for (const updated of msg.objects) {
      if (updated && updated.id) {
        updateSceneObject(updated.id, {
          position: updated.position,
          rotation: updated.rotation,
          blocks: updated.blocks
        }, false);
      }
    }
  }
}

export function handleStudioBuildQueueProgress(msg) {
  const stats = document.getElementById('previewStats');
  if (!stats) return;
  if (msg.status === 'running') {
    stats.textContent = `🏗️ Bau-Queue [${msg.currentIndex}/${msg.totalObjects}]: ${msg.objectName} (${msg.phase || 'Baut'})`;
  } else if (msg.status === 'completed') {
    stats.textContent = `✅ Bau-Queue erfolgreich abgeschlossen (${msg.totalObjects} Objekte gebaut)!`;
  } else if (msg.status === 'error') {
    stats.textContent = `❌ Bau-Queue Fehler bei ${msg.objectName || 'Objekt'}: ${msg.error || ''}`;
  }
}

export async function loadCadStudioDiscovery() {
  try {
    const [discRes, projRes] = await Promise.all([
      fetch('/api/cad/discovery').then(r => r.json()).catch(() => null),
      fetch('/api/cad/projects').then(r => r.json()).catch(() => null)
    ]);

    if (discRes && discRes.success) {
      cadDiscoveryData = discRes;
      const selSource = document.getElementById('selWorldScanSource');
      if (selSource) {
        selSource.innerHTML = '<option value="bot">🤖 Live Bot-Umgebung (Geladene Chunks / Simulation)</option>';
        for (const w of (discRes.worlds || [])) {
          const opt = document.createElement('option');
          opt.value = `anvil:${w.worldPath}`;
          const spawnHint = w.spawn ? ` [Spawn ${w.spawn.x}, ${w.spawn.z}]` : '';
          opt.textContent = `🌍 ${w.name} (${w.launcher})${spawnHint}`;
          opt.dataset.spawnX = w.spawn?.x ?? 0;
          opt.dataset.spawnZ = w.spawn?.z ?? 0;
          selSource.appendChild(opt);
        }
      }

      const selSchem = document.getElementById('selQuickAddSchematic');
      if (selSchem) {
        selSchem.innerHTML = '<option value="">+ Bauwerk in Welt setzen...</option>';
        for (const s of (discRes.localSchematics || [])) {
          const opt = document.createElement('option');
          opt.value = `local:${s.filename}`;
          opt.textContent = `📦 ${s.filename} (${s.dimensions || 'Lokal'})`;
          selSchem.appendChild(opt);
        }
        for (const ext of (discRes.externalSchematics || [])) {
          const opt = document.createElement('option');
          opt.value = `ext:${ext.filePath}`;
          opt.textContent = `📂 ${ext.filename} (${ext.instanceName})`;
          selSchem.appendChild(opt);
        }
      }
    }

    if (projRes && projRes.success && Array.isArray(projRes.projects)) {
      const selProj = document.getElementById('selLoadCadProject');
      if (selProj) {
        selProj.innerHTML = '<option value="">📂 Projekt laden...</option>';
        for (const p of projRes.projects) {
          const opt = document.createElement('option');
          opt.value = p.filename;
          opt.textContent = `🗺️ ${p.projectName} (${p.objectCount} Objekte)`;
          selProj.appendChild(opt);
        }
      }
    }
  } catch (err) {
    console.debug('[CAD-Discovery] Fehler:', err.message);
  }
}

export async function addSchematicToStudioScene(sourceSpec) {
  if (!sourceSpec) return;
  try {
    const body = {};
    if (sourceSpec.startsWith('local:')) {
      body.filename = sourceSpec.slice(6);
    } else if (sourceSpec.startsWith('ext:')) {
      body.externalPath = sourceSpec.slice(4);
    } else {
      body.filename = sourceSpec;
    }

    const res = await fetch('/api/cad/load-object', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.success && data.object) {
      const snap = getSceneSnapshot();
      const offsetIdx = snap.objects.length;
      const centerX = snap.terrain?.center?.x ?? 0;
      const centerZ = snap.terrain?.center?.z ?? 0;
      const posX = centerX + (offsetIdx * 10);
      const posZ = centerZ;

      const added = addSceneObject({
        ...data.object,
        position: { x: posX, y: snap.terrain?.center?.y ?? 64, z: posZ }
      });
      if (added && snap.terrain) {
        snapObjectToGround(added.id);
      }
    }
  } catch (err) {
    console.error('[CAD-Studio] Fehler beim Laden des Schematics in die Szene:', err);
  }
}

export function toggleCadStudioFullscreen(forceState = null) {
  const col = document.getElementById('cadStudioColumn') || document.getElementById('panelCadStudio') || document.getElementById('columnCadStudio');
  const btn = document.getElementById('btnToggleCadFullscreen');
  const sidebar = document.getElementById('cadStudioSidebar');
  const scanBar = document.getElementById('cadWorldScanBar');
  const btnToggleSidebar = document.getElementById('btnToggleStudioInspector');
  const btnToggleScanBar = document.getElementById('btnToggleWorldScannerBar');

  if (!col) {
    return { success: false, reason: 'CAD_CONTAINER_NOT_FOUND' };
  }

  const isFs = col.classList.contains('cad-studio-fullscreen');
  const next = forceState !== null ? Boolean(forceState) : !isFs;

  if (next) {
    // Cache previous .hidden state before entering fullscreen
    preFullscreenSidebarHidden = sidebar ? sidebar.classList.contains('hidden') : false;
    preFullscreenScanBarHidden = scanBar ? scanBar.classList.contains('hidden') : false;

    col.classList.add('cad-studio-fullscreen');
    if (document.body) {
      document.body.style.overflow = 'hidden';
      document.body.classList.toggle('cad-fullscreen-locked', true);
    }
    if (sidebar) {
      sidebar.classList.remove('hidden');
      if (btnToggleSidebar) btnToggleSidebar.classList.add('active');
    }
    if (scanBar) {
      scanBar.classList.remove('hidden');
      if (btnToggleScanBar) btnToggleScanBar.classList.add('active');
    }
  } else {
    // Exiting fullscreen: restore prior states
    col.classList.remove('cad-studio-fullscreen');
    if (document.body) {
      document.body.style.overflow = '';
      document.body.classList.toggle('cad-fullscreen-locked', false);
    }
    if (sidebar && preFullscreenSidebarHidden !== null) {
      sidebar.classList.toggle('hidden', preFullscreenSidebarHidden);
      if (btnToggleSidebar) {
        btnToggleSidebar.classList.toggle('active', !preFullscreenSidebarHidden);
      }
    }
    if (scanBar && preFullscreenScanBarHidden !== null) {
      scanBar.classList.toggle('hidden', preFullscreenScanBarHidden);
      if (btnToggleScanBar) {
        btnToggleScanBar.classList.toggle('active', !preFullscreenScanBarHidden);
      }
    }
  }

  if (btn) {
    btn.textContent = next ? '🗗 Vollbild beenden [F]' : '⛶ CAD Vollbild [F]';
    btn.title = next ? 'Vollbildmodus beenden [F]' : 'Vollbild CAD Studio Workstation umschalten [F]';
    btn.classList.toggle('active', next);
  }

  const overlayBtn = document.getElementById('btnViewportCanvasFullscreen');
  if (overlayBtn) {
    overlayBtn.innerHTML = next ? '🗗 Beenden [F]' : '⛶ Vollbild [F]';
    overlayBtn.title = next ? 'Vollbildmodus beenden [F]' : 'CAD Vollbild umschalten [F]';
    overlayBtn.classList.toggle('active', next);
  }

  if (typeof resizeThreeViewport === 'function') {
    resizeThreeViewport();
    setTimeout(() => {
      try { resizeThreeViewport(); } catch (_) {}
    }, 60);
  }

  return { success: true, fullscreen: next };
}
