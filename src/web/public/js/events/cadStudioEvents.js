/**
 * CAD World Studio, Scene Inspector, Verifier & Spatial AI Event Wiring
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { sendWS } from '../wsClient.js';
import {
  renderStudioTerrain,
  setStudioTerrainVisibility,
  renderSceneGraphObjects,
  setVerifierOverlayVisible,
  setSunTimeOfDay,
  setGhostOpacity,
  renderBOM,
  resizeThreeViewport,
  setActiveTool,
  setViewCardinal
} from '../threeViewport.js';
import {
  onSceneGraphChange,
  getSceneSnapshot,
  setTerrainData,
  toggleSoloObject,
  updateSceneObject,
  snapObjectToGround,
  undoSceneAction,
  redoSceneAction,
  serializeSceneProject,
  loadSceneProjectState
} from '../sceneGraph.js';
import {
  loadCadStudioDiscovery,
  addSchematicToStudioScene,
  renderSceneTreeUI,
  syncInspectorUI,
  toggleCadStudioFullscreen,
  isVerifierOverlayActive,
  setVerifierOverlayActive
} from '../studio/cadStudioController.js';

export function setupCadStudioEvents() {
  loadCadStudioDiscovery();

  onSceneGraphChange((snapshot, reason, deltaMessage) => {
    renderSceneGraphObjects(snapshot);
    renderSceneTreeUI(snapshot);
    syncInspectorUI(snapshot);
    if (snapshot.objects.length > 0) {
      renderBOM(snapshot.masterBom);
    }
    if (reason !== 'terrain_loaded' && reason !== 'verifier_updated') {
      sendWS({
        type: 'studio_sync_scene',
        objects: snapshot.objects,
        activeObjectId: snapshot.activeObjectId,
        userDeltas: snapshot.userDeltas,
        deltaMessage,
        requestVerify: true
      });
    }
  });

  const btnToggleCadFs = document.getElementById('btnToggleCadFullscreen');
  if (btnToggleCadFs) btnToggleCadFs.onclick = () => toggleCadStudioFullscreen();

  const btnViewportCanvasFs = document.getElementById('btnViewportCanvasFullscreen');
  if (btnViewportCanvasFs) btnViewportCanvasFs.onclick = () => toggleCadStudioFullscreen();

  const btnToggleScannerBar = document.getElementById('btnToggleWorldScannerBar');
  const cadWorldScanBar = document.getElementById('cadWorldScanBar');
  if (btnToggleScannerBar && cadWorldScanBar) {
    btnToggleScannerBar.onclick = () => {
      cadWorldScanBar.classList.toggle('hidden');
      btnToggleScannerBar.classList.toggle('active', !cadWorldScanBar.classList.contains('hidden'));
    };
  }

  const btnToggleStudioInsp = document.getElementById('btnToggleStudioInspector');
  const cadStudioSidebar = document.getElementById('cadStudioSidebar');
  if (btnToggleStudioInsp && cadStudioSidebar) {
    btnToggleStudioInsp.onclick = () => {
      cadStudioSidebar.classList.toggle('hidden');
      btnToggleStudioInsp.classList.toggle('active', !cadStudioSidebar.classList.contains('hidden'));
      setTimeout(() => resizeThreeViewport(), 50);
    };
  }

  const selWorldScanSource = document.getElementById('selWorldScanSource');
  if (selWorldScanSource) {
    selWorldScanSource.onchange = () => {
      const selectedOpt = selWorldScanSource.options[selWorldScanSource.selectedIndex];
      if (selectedOpt && selectedOpt.dataset.spawnX !== undefined) {
        const inpX = document.getElementById('inpScanCenterX');
        const inpZ = document.getElementById('inpScanCenterZ');
        if (inpX && !inpX.value) inpX.value = selectedOpt.dataset.spawnX;
        if (inpZ && !inpZ.value) inpZ.value = selectedOpt.dataset.spawnZ;
      }
    };
  }

  const btnScanWorldIntoCad = document.getElementById('btnScanWorldIntoCad');
  if (btnScanWorldIntoCad) {
    btnScanWorldIntoCad.onclick = async () => {
      const rawSource = document.getElementById('selWorldScanSource')?.value || 'bot';
      const radius = Number(document.getElementById('selScanRadius')?.value) || 48;
      const includeFoliage = Boolean(document.getElementById('chkScanFoliage')?.checked);
      const rawX = document.getElementById('inpScanCenterX')?.value;
      const rawZ = document.getElementById('inpScanCenterZ')?.value;

      const payload = {
        source: rawSource.startsWith('anvil:') ? 'anvil' : 'bot',
        worldPath: rawSource.startsWith('anvil:') ? rawSource.slice(6) : undefined,
        radius,
        includeFoliage,
        centerX: rawX !== '' && rawX !== undefined ? Number(rawX) : undefined,
        centerZ: rawZ !== '' && rawZ !== undefined ? Number(rawZ) : undefined
      };

      const origText = btnScanWorldIntoCad.textContent;
      btnScanWorldIntoCad.disabled = true;
      btnScanWorldIntoCad.textContent = '⏳ Scanne...';
      try {
        const res = await fetch('/api/cad/scan-terrain', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success && data.terrain) {
          setTerrainData(data.terrain);
          renderStudioTerrain(data.terrain);
          sendWS({
            type: 'studio_scan_terrain',
            ...payload
          });
        }
      } catch (err) {
        console.error('[WorldScan] Fehler:', err);
      } finally {
        btnScanWorldIntoCad.disabled = false;
        btnScanWorldIntoCad.textContent = origText;
      }
    };
  }

  const chkToggleTerrainVis = document.getElementById('chkToggleTerrainVisible');
  if (chkToggleTerrainVis) {
    chkToggleTerrainVis.onchange = (e) => {
      setStudioTerrainVisibility(Boolean(e.target.checked));
    };
  }

  const btnSaveCadProj = document.getElementById('btnSaveCadProject');
  if (btnSaveCadProj) {
    btnSaveCadProj.onclick = async () => {
      const name = window.prompt('Projektname für CAD-Weltszenario eingeben:', `Siedlung_${new Date().toISOString().slice(0, 10)}`);
      if (!name) return;
      try {
        const projectPayload = serializeSceneProject(name.trim());
        const res = await fetch('/api/cad/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(projectPayload)
        });
        const data = await res.json();
        if (data.success) {
          await loadCadStudioDiscovery();
        }
      } catch (err) {
        console.error('[CAD-Project] Speichern fehlgeschlagen:', err);
      }
    };
  }

  const selLoadCadProj = document.getElementById('selLoadCadProject');
  if (selLoadCadProj) {
    selLoadCadProj.onchange = async () => {
      const filename = selLoadCadProj.value;
      if (!filename) return;
      try {
        const res = await fetch(`/api/cad/projects/${encodeURIComponent(filename)}`);
        const data = await res.json();
        if (data.success && data.project) {
          loadSceneProjectState(data.project);
          if (data.project.terrain) {
            renderStudioTerrain(data.project.terrain);
          }
        }
      } catch (err) {
        console.error('[CAD-Project] Laden fehlgeschlagen:', err);
      }
    };
  }

  // Gizmo & Placement Tools
  const toolGizmoMove = document.getElementById('toolGizmoMove');
  const toolGizmoRotate = document.getElementById('toolGizmoRotate');
  const toolPlaceOnTerrain = document.getElementById('toolPlaceOnTerrain');
  const toolMeasure = document.getElementById('toolMeasure');
  const btnSceneUndo = document.getElementById('btnSceneUndo');
  const btnSceneRedo = document.getElementById('btnSceneRedo');

  if (toolGizmoMove) toolGizmoMove.onclick = () => setActiveTool('gizmoMove');
  if (toolGizmoRotate) toolGizmoRotate.onclick = () => setActiveTool('gizmoRotate');
  if (toolPlaceOnTerrain) toolPlaceOnTerrain.onclick = () => setActiveTool('placeOnTerrain');
  if (toolMeasure) toolMeasure.onclick = () => setActiveTool('measure');
  if (btnSceneUndo) btnSceneUndo.onclick = () => undoSceneAction();
  if (btnSceneRedo) btnSceneRedo.onclick = () => redoSceneAction();

  // Cardinal Camera Buttons
  const btnViewNorth = document.getElementById('btnViewNorth');
  const btnViewSouth = document.getElementById('btnViewSouth');
  const btnViewEast = document.getElementById('btnViewEast');
  const btnViewWest = document.getElementById('btnViewWest');
  if (btnViewNorth) btnViewNorth.onclick = () => setViewCardinal('N');
  if (btnViewSouth) btnViewSouth.onclick = () => setViewCardinal('S');
  if (btnViewEast) btnViewEast.onclick = () => setViewCardinal('E');
  if (btnViewWest) btnViewWest.onclick = () => setViewCardinal('W');

  // Sun Lighting & Ghost Opacity Sliders
  const sliderSunTime = document.getElementById('sliderSunTime');
  if (sliderSunTime) {
    sliderSunTime.oninput = (e) => setSunTimeOfDay(Number(e.target.value));
  }
  const sliderGhostOpacity = document.getElementById('sliderGhostOpacity');
  if (sliderGhostOpacity) {
    sliderGhostOpacity.oninput = (e) => setGhostOpacity(Number(e.target.value) / 100);
  }

  const btnToggleVerifier = document.getElementById('btnToggleVerifier');
  if (btnToggleVerifier) {
    btnToggleVerifier.onclick = () => {
      const active = !isVerifierOverlayActive();
      setVerifierOverlayActive(active);
      btnToggleVerifier.classList.toggle('active', active);
      setVerifierOverlayVisible(active);
    };
  }

  // Add Schematic to Scene
  const btnAddSchemToScene = document.getElementById('btnAddSchematicToScene');
  if (btnAddSchemToScene) {
    btnAddSchemToScene.onclick = () => {
      const sel = document.getElementById('selQuickAddSchematic');
      if (sel && sel.value) {
        addSchematicToStudioScene(sel.value);
      }
    };
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('cad:add-schematic', (e) => {
      if (e.detail?.filename) {
        addSchematicToStudioScene(`local:${e.detail.filename}`);
      }
    });
  }

  // Inspector Controls
  const btnSoloActive = document.getElementById('btnSoloActiveObject');
  if (btnSoloActive) {
    btnSoloActive.onclick = () => {
      const snap = getSceneSnapshot();
      if (snap.activeObjectId) toggleSoloObject(snap.activeObjectId);
    };
  }

  const inpActiveObjName = document.getElementById('inpActiveObjName');
  if (inpActiveObjName) {
    inpActiveObjName.onchange = () => {
      const snap = getSceneSnapshot();
      if (snap.activeObjectId && inpActiveObjName.value.trim()) {
        updateSceneObject(snap.activeObjectId, { name: inpActiveObjName.value.trim() });
      }
    };
  }

  const applyInspectorCoords = () => {
    const snap = getSceneSnapshot();
    if (!snap.activeObjectId) return;
    const x = Number(document.getElementById('inpObjPosX')?.value) || 0;
    const y = Number(document.getElementById('inpObjPosY')?.value) || 0;
    const z = Number(document.getElementById('inpObjPosZ')?.value) || 0;
    updateSceneObject(snap.activeObjectId, { position: { x, y, z } });
  };

  ['inpObjPosX', 'inpObjPosY', 'inpObjPosZ'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = applyInspectorCoords;
  });

  document.querySelectorAll('.btn-rot-preset').forEach(btn => {
    btn.onclick = () => {
      const snap = getSceneSnapshot();
      if (!snap.activeObjectId) return;
      const rot = Number(btn.dataset.rot) || 0;
      updateSceneObject(snap.activeObjectId, { rotation: rot });
    };
  });

  const btnSnapToGround = document.getElementById('btnSnapToGround');
  if (btnSnapToGround) {
    btnSnapToGround.onclick = () => {
      const snap = getSceneSnapshot();
      if (snap.activeObjectId) snapObjectToGround(snap.activeObjectId);
    };
  }

  // Omnipresent Spatial AI Co-Pilot Execution
  const btnRunStudioAi = document.getElementById('btnRunStudioAi');
  if (btnRunStudioAi) {
    btnRunStudioAi.onclick = () => {
      const mode = document.getElementById('selStudioAiMode')?.value || 'focus_object';
      const instruction = document.getElementById('txtStudioAiPrompt')?.value?.trim() || '';
      const statusEl = document.getElementById('lblStudioAiStatus');
      if (statusEl) statusEl.textContent = '⏳ Spatial KI analysiert Szene & führt Auftrag aus...';

      const snap = getSceneSnapshot();
      sendWS({
        type: 'studio_ai_copilot',
        mode,
        instruction,
        sceneSnapshot: {
          objects: snap.objects,
          activeObjectId: snap.activeObjectId,
          userDeltas: snap.userDeltas
        }
      });
    };
  }

  // Sequential Build Queue & Composite Export
  const btnStartSceneBuildQueue = document.getElementById('btnStartSceneBuildQueue');
  if (btnStartSceneBuildQueue) {
    btnStartSceneBuildQueue.onclick = () => {
      const snap = getSceneSnapshot();
      if (snap.objects.length === 0) {
        sendWS({ type: 'confirm_build' });
        return;
      }
      const autoFoundation = Boolean(document.getElementById('chkAutoFoundation')?.checked);
      const autoTerraform = Boolean(document.getElementById('chkAutoTerraform')?.checked);
      sendWS({
        type: 'studio_execute_build_queue',
        objects: snap.objects,
        autoFoundation,
        autoTerraform
      });
    };
  }

  const btnExportCompositeScene = document.getElementById('btnExportCompositeScene');
  if (btnExportCompositeScene) {
    btnExportCompositeScene.onclick = async () => {
      const snap = getSceneSnapshot();
      if (snap.objects.length === 0) {
        const btnExportSchem = document.getElementById('btnExportSchem');
        btnExportSchem?.click();
        return;
      }
      const name = window.prompt('Dateiname für Composite-Szene (.schem oder .nbt):', `composite_settlement_${Date.now()}.schem`);
      if (!name) return;
      const isNbt = name.trim().toLowerCase().endsWith('.nbt');
      try {
        const res = await fetch('/api/cad/export-composite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            format: isNbt ? 'nbt' : 'schem',
            objects: snap.objects
          })
        });
        const data = await res.json();
        if (data.success && data.downloadUrl) {
          window.open(data.downloadUrl, '_blank');
        }
      } catch (err) {
        console.error('[CompositeExport] Fehler:', err);
      }
    };
  }
}
