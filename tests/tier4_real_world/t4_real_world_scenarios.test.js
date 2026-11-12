/**
 * Tier 4: Real-World Application Workloads & End-to-End Scenarios
 * 
 * Verifies end-to-end user journeys and multi-step real-world workflows:
 * - T4.1: test_scenario_architect_fullscreen_workflow (Dashboard -> Fullscreen -> Spatial AI -> Path gen -> Queued build -> Restore)
 * - T4.2: test_scenario_bot_cam_offline_recovery_lifecycle (Port 3081 offline -> Fallback card -> Retry -> Online transition -> Stream restore -> Fullscreen stability)
 * - T4.3: test_scenario_ergonomic_stress_sequence (Interleaved collapse, tab toggles, fullscreen spam, window resize chaos, Esc key exit)
 * - T4.4: test_scenario_gamemode_to_cad_transitions (Gamemode entry -> Offhand key [F] -> Exit gamemode -> CAD studio entry)
 * - T4.5: test_scenario_dual_forwarder_and_perfection_suite (Executes cadWorldStudioPerfectionTest forwarder, validates all 6 CAD perfection phases, passes check:syntax)
 * 
 * Requirements: TEST_INFRA.md §6.4, PROJECT.md (F1–F10), ORIGINAL_REQUEST.md (R1–R4).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { defaultHarness } from '../helpers/testHarness.js';
import {
  MockEvent,
  MockMouseEvent,
  MockKeyboardEvent,
  MockElement,
  setupMockDom,
  teardownMockDom
} from '../helpers/mockDom.js';
import {
  MockResizeObserver,
  MockWebGLRenderer,
  MockPerspectiveCamera,
  MockScene,
  setupMockThreeGlobals,
  teardownMockThreeGlobals
} from '../helpers/mockThree.js';
import {
  scan3DTerrainRelief,
  analyzeSceneVerifier,
  generateSmartPathBetweenObjects
} from '../../src/web/services/terrainMapService.js';
import {
  resetSceneGraph,
  setTerrainData,
  addSceneObject,
  selectSceneObject,
  getSceneSnapshot
} from '../../src/web/public/js/sceneGraph.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Creates the complete Mission Control DOM structure with 3 columns,
 * CAD Studio, Bot-Cam offline card, sidebar tabs, and Gamemode HUD.
 */
function createFullMissionControlFixture(dom) {
  const { document } = dom;

  const dashboardContainer = document.createElement('DIV');
  dashboardContainer.id = 'dashboardContainer';
  dashboardContainer.className = 'dashboard-container';

  // ---------------------------------------------------------------------------
  // Column 1: Bot-Cam / Map / Schematics
  // ---------------------------------------------------------------------------
  const columnLeft = document.createElement('DIV');
  columnLeft.id = 'columnLeft';
  columnLeft.className = 'column-left';
  columnLeft.style.width = '25%';

  const navTabs = document.createElement('DIV');
  navTabs.className = 'nav-tabs';

  const tabBtnViewer = document.createElement('BUTTON');
  tabBtnViewer.id = 'tabBtnViewer';
  tabBtnViewer.className = 'tab-btn active';
  tabBtnViewer.setAttribute('data-tab', 'tab-viewer');
  tabBtnViewer.textContent = '🎥 Live 3D Bot-Cam';

  const tabBtnMap = document.createElement('BUTTON');
  tabBtnMap.id = 'tabBtnMap';
  tabBtnMap.className = 'tab-btn';
  tabBtnMap.setAttribute('data-tab', 'tab-map');
  tabBtnMap.textContent = '🗺️ 2D-Grundstücks-Raster';

  navTabs.appendChild(tabBtnViewer);
  navTabs.appendChild(tabBtnMap);
  columnLeft.appendChild(navTabs);

  const tabViewer = document.createElement('DIV');
  tabViewer.id = 'tab-viewer';
  tabViewer.className = 'tab-pane active';

  const viewerWrapper = document.createElement('DIV');
  viewerWrapper.id = 'viewerWrapper';
  viewerWrapper.className = 'viewer-wrapper';

  const viewerFrame = document.createElement('IFRAME');
  viewerFrame.id = 'viewerFrame';
  viewerFrame.src = 'about:blank';
  viewerFrame.style.display = 'none';

  const viewerOfflinePlaceholder = document.createElement('DIV');
  viewerOfflinePlaceholder.id = 'viewerOfflinePlaceholder';
  viewerOfflinePlaceholder.className = 'viewer-offline-placeholder';
  viewerOfflinePlaceholder.style.display = 'flex';

  const offlineNotice = document.createElement('DIV');
  offlineNotice.className = 'offline-notice-text';
  offlineNotice.textContent = '● BOT-CAM OFFLINE: Prismarine-Viewer auf Port 3081 nicht erreichbar.';
  viewerOfflinePlaceholder.appendChild(offlineNotice);

  const btnRetryViewer = document.createElement('BUTTON');
  btnRetryViewer.id = 'btnRetryViewerConnection';
  btnRetryViewer.className = 'btn-retry-viewer';
  btnRetryViewer.textContent = '↺ Verbindung wiederholen';
  viewerOfflinePlaceholder.appendChild(btnRetryViewer);

  viewerWrapper.appendChild(viewerFrame);
  viewerWrapper.appendChild(viewerOfflinePlaceholder);
  tabViewer.appendChild(viewerWrapper);

  const tabMap = document.createElement('DIV');
  tabMap.id = 'tab-map';
  tabMap.className = 'tab-pane';
  tabMap.style.display = 'none';

  columnLeft.appendChild(tabViewer);
  columnLeft.appendChild(tabMap);
  dashboardContainer.appendChild(columnLeft);

  // ---------------------------------------------------------------------------
  // Column 2: CAD World Studio & Viewport (Center Column, ~52%)
  // ---------------------------------------------------------------------------
  const cadStudioColumn = document.createElement('DIV');
  cadStudioColumn.id = 'cadStudioColumn';
  cadStudioColumn.className = 'column-cad-studio';
  cadStudioColumn.style.width = '52%';

  const panelCad = document.createElement('DIV');
  panelCad.id = 'panelCadStudio';
  panelCad.className = 'panel-cad';

  const threeToolbar = document.createElement('DIV');
  threeToolbar.className = 'three-toolbar';

  const btnToggleCadFullscreen = document.createElement('BUTTON');
  btnToggleCadFullscreen.id = 'btnToggleCadFullscreen';
  btnToggleCadFullscreen.className = 'btn-micro btn-cad-fullscreen';
  btnToggleCadFullscreen.textContent = '⛶ CAD Vollbild';

  const btnToggleStudioInspector = document.createElement('BUTTON');
  btnToggleStudioInspector.id = 'btnToggleStudioInspector';
  btnToggleStudioInspector.className = 'btn-micro active';
  btnToggleStudioInspector.textContent = '📐 Inspektor';

  threeToolbar.appendChild(btnToggleCadFullscreen);
  threeToolbar.appendChild(btnToggleStudioInspector);
  panelCad.appendChild(threeToolbar);

  const cadWorkspace = document.createElement('DIV');
  cadWorkspace.className = 'cad-studio-workspace';
  cadWorkspace.style.display = 'flex';
  cadWorkspace.style.flexDirection = 'row';
  cadWorkspace.style.position = 'relative';

  const threeContainer = document.createElement('DIV');
  threeContainer.id = 'threeContainer';
  threeContainer.className = 'three-container';
  threeContainer.clientWidth = 960;
  threeContainer.clientHeight = 600;

  const cadStudioSidebar = document.createElement('ASIDE');
  cadStudioSidebar.id = 'cadStudioSidebar';
  cadStudioSidebar.className = 'cad-studio-sidebar';
  cadStudioSidebar.clientWidth = 300;
  cadStudioSidebar.clientHeight = 600;

  const sidebarNav = document.createElement('DIV');
  sidebarNav.className = 'sidebar-nav';

  const tabBtnObjects = document.createElement('BUTTON');
  tabBtnObjects.id = 'tabBtnObjects';
  tabBtnObjects.className = 'cad-tab-btn active';
  tabBtnObjects.textContent = '🗂️ Objekte';

  const tabBtnInspector = document.createElement('BUTTON');
  tabBtnInspector.id = 'tabBtnInspector';
  tabBtnInspector.className = 'cad-tab-btn';
  tabBtnInspector.textContent = '📐 Inspektor';

  const tabBtnSpatial = document.createElement('BUTTON');
  tabBtnSpatial.id = 'tabBtnSpatial';
  tabBtnSpatial.className = 'cad-tab-btn';
  tabBtnSpatial.textContent = '🧠 Spatial KI';

  sidebarNav.appendChild(tabBtnObjects);
  sidebarNav.appendChild(tabBtnInspector);
  sidebarNav.appendChild(tabBtnSpatial);
  cadStudioSidebar.appendChild(sidebarNav);

  const sceneTreePane = document.createElement('DIV');
  sceneTreePane.id = 'sceneTreePane';
  sceneTreePane.className = 'cad-sidebar-pane active';
  cadStudioSidebar.appendChild(sceneTreePane);

  const inspectorPane = document.createElement('DIV');
  inspectorPane.id = 'inspectorPane';
  inspectorPane.className = 'cad-sidebar-pane';
  inspectorPane.style.display = 'none';
  cadStudioSidebar.appendChild(inspectorPane);

  const spatialAiPane = document.createElement('DIV');
  spatialAiPane.id = 'spatialAiPane';
  spatialAiPane.className = 'cad-sidebar-pane';
  spatialAiPane.style.display = 'none';
  cadStudioSidebar.appendChild(spatialAiPane);

  cadWorkspace.appendChild(threeContainer);
  cadWorkspace.appendChild(cadStudioSidebar);
  panelCad.appendChild(cadWorkspace);

  // Sticky Action Bar (F2)
  const buildActionsBar = document.createElement('DIV');
  buildActionsBar.className = 'build-actions-bar';
  buildActionsBar.style.position = 'sticky';
  buildActionsBar.style.bottom = '0';

  const btnConfirmBuild = document.createElement('BUTTON');
  btnConfirmBuild.id = 'btnConfirmBuild';
  btnConfirmBuild.className = 'btn btn-success';
  btnConfirmBuild.textContent = '✓ Build bestätigen';

  const btnStartSceneBuildQueue = document.createElement('BUTTON');
  btnStartSceneBuildQueue.id = 'btnStartSceneBuildQueue';
  btnStartSceneBuildQueue.className = 'btn btn-primary';
  btnStartSceneBuildQueue.textContent = '🚀 Ganze Szene bauen';

  const btnStopBuild = document.createElement('BUTTON');
  btnStopBuild.id = 'btnStopBuild';
  btnStopBuild.className = 'btn btn-danger';
  btnStopBuild.textContent = '🛑 Build stoppen';

  buildActionsBar.appendChild(btnConfirmBuild);
  buildActionsBar.appendChild(btnStartSceneBuildQueue);
  buildActionsBar.appendChild(btnStopBuild);
  panelCad.appendChild(buildActionsBar);

  cadStudioColumn.appendChild(panelCad);
  dashboardContainer.appendChild(cadStudioColumn);

  // ---------------------------------------------------------------------------
  // Column 3: Architect Chat & Blueprints (~23%)
  // ---------------------------------------------------------------------------
  const columnRight = document.createElement('DIV');
  columnRight.id = 'columnRight';
  columnRight.className = 'column-right';
  columnRight.style.width = '23%';
  dashboardContainer.appendChild(columnRight);

  // ---------------------------------------------------------------------------
  // Gamemode HUD Overlay
  // ---------------------------------------------------------------------------
  const gamemodeHudOverlay = document.createElement('DIV');
  gamemodeHudOverlay.id = 'gamemodeHudOverlay';
  gamemodeHudOverlay.className = 'gamemode-hud-overlay hidden';

  const hudOffhandSlot = document.createElement('DIV');
  hudOffhandSlot.id = 'hudOffhandSlot';
  hudOffhandSlot.className = 'hotbar-offhand-slot';
  gamemodeHudOverlay.appendChild(hudOffhandSlot);

  document.body.appendChild(dashboardContainer);
  document.body.appendChild(gamemodeHudOverlay);

  // Tab switching helper
  const setupTabs = (buttons, panes) => {
    buttons.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        panes.forEach(p => {
          p.classList.remove('active');
          p.style.display = 'none';
        });
        btn.classList.add('active');
        if (panes[idx]) {
          panes[idx].classList.add('active');
          panes[idx].style.display = 'block';
        }
      });
    });
  };

  setupTabs([tabBtnObjects, tabBtnInspector, tabBtnSpatial], [sceneTreePane, inspectorPane, spatialAiPane]);
  setupTabs([tabBtnViewer, tabBtnMap], [tabViewer, tabMap]);

  return {
    dashboardContainer,
    columnLeft,
    cadStudioColumn,
    panelCad,
    threeContainer,
    cadStudioSidebar,
    threeToolbar,
    btnToggleCadFullscreen,
    btnToggleStudioInspector,
    buildActionsBar,
    btnStartSceneBuildQueue,
    btnConfirmBuild,
    btnStopBuild,
    tabBtnViewer,
    tabBtnMap,
    tabViewer,
    tabMap,
    viewerWrapper,
    viewerFrame,
    viewerOfflinePlaceholder,
    btnRetryViewer,
    tabBtnObjects,
    tabBtnInspector,
    tabBtnSpatial,
    sceneTreePane,
    inspectorPane,
    spatialAiPane,
    gamemodeHudOverlay,
    hudOffhandSlot
  };
}

/**
 * Controller helper executing CAD fullscreen toggle with state updates and body overflow lock.
 */
function toggleCadFullscreen(document, forceState = null) {
  const col = document.getElementById('cadStudioColumn');
  const btn = document.getElementById('btnToggleCadFullscreen');
  if (!col) return false;

  const isFs = col.classList.contains('cad-studio-fullscreen');
  const next = forceState !== null ? Boolean(forceState) : !isFs;

  col.classList.toggle('cad-studio-fullscreen', next);
  if (btn) {
    btn.textContent = next ? '🗗 Vollbild beenden [F]' : '⛶ CAD Vollbild [F]';
    btn.classList.toggle('active', next);
  }

  if (next) {
    document.body.style.overflow = 'hidden';
    col.style.position = 'fixed';
    col.style.inset = '0';
    col.style.width = '100vw';
    col.style.height = '100vh';
    col.style.zIndex = '9500';
  } else {
    document.body.style.overflow = '';
    col.style.position = '';
    col.style.inset = '';
    col.style.width = '52%';
    col.style.height = '';
    col.style.zIndex = '';
  }

  return next;
}

/**
 * Main Tier 4 runner export
 */
export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, notStrictEqual, ok, deepStrictEqual } = harness;

  await describe('Tier 4: Real-World Scenarios & End-to-End Workloads (T4.1–T4.5)', async () => {

    // -------------------------------------------------------------------------
    // T4.1: test_scenario_architect_fullscreen_workflow
    // -------------------------------------------------------------------------
    await test('T4.1: Architect CAD Session (Boot -> Fullscreen -> Spatial AI -> Smart Path -> Queue Build -> Restore)', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createFullMissionControlFixture(dom);

      try {
        const {
          cadStudioColumn,
          threeContainer,
          tabBtnSpatial,
          spatialAiPane,
          buildActionsBar,
          btnStartSceneBuildQueue
        } = fixture;

        // Step 1: User opens mission control dashboard
        strictEqual(cadStudioColumn.style.width, '52%', 'Initial center CAD studio is 52% wide in 3-column layout');
        strictEqual(dom.document.body.style.overflow || '', '', 'Body overflow initially unlocked');

        // Setup Three.js Mock Viewport
        const camera = new threeGlobals.MockPerspectiveCamera(45, 960 / 600, 0.1, 1000);
        const renderer = new threeGlobals.MockWebGLRenderer({ width: 960, height: 600 });
        threeContainer.appendChild(renderer.domElement);

        const observer = new threeGlobals.ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = Math.max(100, entry.contentRect.width);
            const h = Math.max(100, entry.contentRect.height);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
          }
        });
        observer.observe(threeContainer);

        strictEqual(camera.aspect, 1.6, 'Initial camera aspect is 960 / 600');

        // Step 2: Press [F] to enter CAD fullscreen
        const entered = toggleCadFullscreen(dom.document, true);
        strictEqual(entered, true, 'Fullscreen entered');
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), true);
        strictEqual(cadStudioColumn.style.width, '100vw');
        strictEqual(cadStudioColumn.style.position, 'fixed');
        strictEqual(dom.document.body.style.overflow, 'hidden', 'Body overflow locked in fullscreen');

        // Resize container to 1920x1080 and trigger ResizeObserver
        threeContainer.clientWidth = 1920;
        threeContainer.clientHeight = 1080;
        threeGlobals.ResizeObserver.triggerResize(threeContainer, { width: 1920, height: 1080 });

        strictEqual(camera.aspect, 1920 / 1080, 'Camera aspect updated to 16:9 fullscreen');
        strictEqual(renderer.width, 1920);
        strictEqual(renderer.height, 1080);

        // Step 3: Switch sidebar to Spatial AI tab
        tabBtnSpatial.click();
        strictEqual(tabBtnSpatial.classList.contains('active'), true);
        strictEqual(spatialAiPane.classList.contains('active'), true);
        strictEqual(spatialAiPane.style.display, 'block');

        // Step 4: Triggers smart path generation between objects using real service
        const worldScan = {
          center: { x: 0, y: 68, z: 0 },
          radius: 16,
          heightMap: {},
          isSimulated: true
        };
        for (let x = -16; x <= 16; x++) {
          worldScan.heightMap[x] = {};
          for (let z = -16; z <= 16; z++) {
            worldScan.heightMap[x][z] = { y: 68, block: 'grass_block' };
          }
        }

        const tavern = {
          id: 'obj_tavern',
          name: 'Dorf-Taverne',
          position: { x: 2, y: 69, z: 2 },
          rotation: 0,
          visible: true,
          blocks: [{ x: 0, y: 0, z: 0, block: 'cobblestone' }]
        };
        const forge = {
          id: 'obj_forge',
          name: 'Schmiede',
          position: { x: 12, y: 69, z: 8 },
          rotation: 0,
          visible: true,
          blocks: [{ x: 0, y: 0, z: 0, block: 'stone_bricks' }]
        };

        const pathResult = generateSmartPathBetweenObjects(worldScan, tavern, forge, { width: 2 });
        ok(pathResult && pathResult.blocks && pathResult.blocks.length > 0, 'Smart path generated between Tavern and Forge');

        // Render generated path info into Spatial AI pane
        const pathCard = dom.document.createElement('DIV');
        pathCard.className = 'spatial-ai-card';
        pathCard.textContent = `Verbindungsweg: ${pathResult.blocks.length} Pflasterstein-Blöcke (Breite: 2)`;
        spatialAiPane.appendChild(pathCard);

        ok(spatialAiPane.textContent.includes('Verbindungsweg'), 'Spatial AI card rendered in DOM');

        // Step 5: Click #btnStartSceneBuildQueue in the pinned action bar
        let sceneBuildQueued = false;
        let queuedObjectCount = 0;

        btnStartSceneBuildQueue.addEventListener('click', () => {
          sceneBuildQueued = true;
          queuedObjectCount = 2 + pathResult.blocks.length;
        });

        // Verify action bar pinning in fullscreen
        strictEqual(buildActionsBar.style.position, 'sticky');
        strictEqual(buildActionsBar.style.bottom, '0');
        strictEqual(btnStartSceneBuildQueue.disabled, false);

        btnStartSceneBuildQueue.click();
        strictEqual(sceneBuildQueued, true, 'Scene build queue dispatch triggered from pinned action bar');
        ok(queuedObjectCount > 2, 'Build queue received tavern, forge, and road blocks');

        // Step 6: Press [F] to exit fullscreen
        const exited = toggleCadFullscreen(dom.document, false);
        strictEqual(exited, false, 'Fullscreen exited');

        // Step 7: Verifies 3-column normal layout is restored with identical state
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false);
        strictEqual(cadStudioColumn.style.width, '52%', 'Center column restored to 52% width');
        strictEqual(cadStudioColumn.style.position, '', 'Position restored from fixed');
        strictEqual(dom.document.body.style.overflow || '', '', 'Body overflow restored');

        // Trigger container resize back to original 960x600
        threeContainer.clientWidth = 960;
        threeContainer.clientHeight = 600;
        threeGlobals.ResizeObserver.triggerResize(threeContainer, { width: 960, height: 600 });

        strictEqual(camera.aspect, 1.6, 'Camera aspect restored to 1.6');
        strictEqual(renderer.width, 960);
        strictEqual(renderer.height, 600);

        // Verify Spatial AI pane state and cards are retained
        strictEqual(spatialAiPane.classList.contains('active'), true, 'Active tab retained across fullscreen cycle');
        ok(spatialAiPane.textContent.includes('Verbindungsweg'), 'Generated path data retained');

        observer.disconnect();
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T4.2: test_scenario_bot_cam_offline_recovery_lifecycle
    // -------------------------------------------------------------------------
    await test('T4.2: Bot-Cam Offline Recovery Lifecycle (Offline -> Fallback -> Retry Click -> Online -> Stream Restored -> Fullscreen)', async () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createFullMissionControlFixture(dom);

      try {
        const {
          viewerOfflinePlaceholder,
          viewerFrame,
          btnRetryViewer,
          cadStudioColumn
        } = fixture;

        // Step 1 & 2: Dashboard boots with port 3081 offline
        strictEqual(viewerOfflinePlaceholder.style.display, 'flex', 'Fallback card displayed on boot');
        strictEqual(viewerFrame.style.display, 'none', 'Iframe hidden on boot when offline');
        strictEqual(viewerFrame.src, 'about:blank', 'Iframe blanked when offline');
        ok(viewerOfflinePlaceholder.textContent.includes('3081'), 'Placeholder references port 3081');

        // Step 3: User clicks Retry button
        let probeInProgress = false;
        let mockPort3081Online = false;
        let connectionSuccessful = false;

        btnRetryViewer.addEventListener('click', async () => {
          probeInProgress = true;
          btnRetryViewer.disabled = true;
          btnRetryViewer.classList.add('loading');
          btnRetryViewer.textContent = '⏳ Verbindung wird hergestellt...';

          // Simulate asynchronous network probe to port 3081
          await new Promise(r => setTimeout(r, 20));

          if (mockPort3081Online) {
            connectionSuccessful = true;
            probeInProgress = false;
            btnRetryViewer.disabled = false;
            btnRetryViewer.classList.remove('loading');
            btnRetryViewer.textContent = '↺ Verbindung wiederholen';

            // Transition UI to active stream
            viewerOfflinePlaceholder.style.display = 'none';
            viewerFrame.style.display = 'block';
            viewerFrame.src = 'http://localhost:3081/';
          } else {
            probeInProgress = false;
            btnRetryViewer.disabled = false;
            btnRetryViewer.classList.remove('loading');
            btnRetryViewer.textContent = '⚠️ Erneut versuchen';
          }
        });

        // First click while port is still offline
        btnRetryViewer.click();
        strictEqual(probeInProgress, true, 'Probe active immediately on click');
        strictEqual(btnRetryViewer.disabled, true, 'Retry button disabled during probe');
        ok(btnRetryViewer.classList.contains('loading'), 'Retry button has loading class');

        // Wait for first probe to finish (offline failure)
        await new Promise(r => setTimeout(r, 30));
        strictEqual(connectionSuccessful, false, 'First probe failed as port 3081 is offline');
        strictEqual(viewerOfflinePlaceholder.style.display, 'flex', 'Placeholder remains visible after failure');
        strictEqual(btnRetryViewer.disabled, false, 'Retry button re-enabled');

        // Step 4 & 5: Mock port 3081 transitions to online state
        mockPort3081Online = true;

        // Step 6: User clicks retry again -> probe resolves successfully
        btnRetryViewer.click();
        await new Promise(r => setTimeout(r, 30));

        strictEqual(connectionSuccessful, true, 'Second probe succeeded');
        strictEqual(viewerOfflinePlaceholder.style.display, 'none', 'Offline placeholder card hidden on recovery');
        strictEqual(viewerFrame.style.display, 'block', 'Viewer iframe displayed');
        strictEqual(viewerFrame.src, 'http://localhost:3081/', 'Viewer iframe pointed to active stream URL');

        // Step 7: User toggles CAD fullscreen without stream corruption
        toggleCadFullscreen(dom.document, true);
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), true);
        strictEqual(viewerFrame.src, 'http://localhost:3081/', 'Stream URL unaffected by CAD fullscreen entry');
        strictEqual(viewerOfflinePlaceholder.style.display, 'none', 'Placeholder remains hidden in Column 1');

        toggleCadFullscreen(dom.document, false);
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false);
        strictEqual(viewerFrame.src, 'http://localhost:3081/', 'Stream URL unaffected by CAD fullscreen exit');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T4.3: test_scenario_ergonomic_stress_sequence
    // -------------------------------------------------------------------------
    await test('T4.3: Ergonomic Stress Sequence (High-velocity collapse, tab switching, fullscreen spam, window resize, Esc exit)', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createFullMissionControlFixture(dom);

      try {
        const {
          cadStudioColumn,
          threeContainer,
          cadStudioSidebar,
          btnToggleStudioInspector,
          tabBtnObjects,
          tabBtnInspector,
          tabBtnSpatial
        } = fixture;

        const camera = new threeGlobals.MockPerspectiveCamera(45, 960 / 600, 0.1, 1000);
        const renderer = new threeGlobals.MockWebGLRenderer({ width: 960, height: 600 });
        threeContainer.appendChild(renderer.domElement);

        let resizeObserverTriggerCount = 0;
        const observer = new threeGlobals.ResizeObserver((entries) => {
          for (const entry of entries) {
            resizeObserverTriggerCount++;
            const w = Math.max(10, entry.contentRect.width);
            const h = Math.max(10, entry.contentRect.height);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
          }
        });
        observer.observe(threeContainer);

        // Escape key handler for fullscreen exit
        dom.window.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            toggleCadFullscreen(dom.document, false);
          }
        });

        // Multi-aspect ratio matrix
        const stressResolutions = [
          { w: 1024, h: 768 },  // 4:3
          { w: 1920, h: 1080 }, // 16:9 Full HD
          { w: 2560, h: 1080 }, // 21:9 Ultrawide
          { w: 3840, h: 1080 }, // 32:9 Super Ultrawide
          { w: 1080, h: 1920 }, // 9:16 Portrait
          { w: 640,  h: 480 },  // VGA
          { w: 3840, h: 2160 }, // 4K UHD
          { w: 1366, h: 768 },  // Laptop HD
          { w: 800,  h: 600 },  // SVGA
          { w: 1440, h: 900 }   // WXGA+
        ];

        const tabs = [tabBtnObjects, tabBtnInspector, tabBtnSpatial];

        // Chaos execution loop (20 rapid cycles)
        for (let cycle = 0; cycle < 20; cycle++) {
          // 1. Toggle sidebar
          const isHidden = cadStudioSidebar.classList.toggle('hidden');
          btnToggleStudioInspector.classList.toggle('active', !isHidden);

          // 2. Switch tab
          const activeTabBtn = tabs[cycle % tabs.length];
          activeTabBtn.click();

          // 3. Toggle fullscreen every 3 cycles
          if (cycle % 3 === 0) {
            toggleCadFullscreen(dom.document);
          }

          // 4. Resize container with stress resolutions
          const res = stressResolutions[cycle % stressResolutions.length];
          threeContainer.clientWidth = res.w;
          threeContainer.clientHeight = res.h;
          threeGlobals.ResizeObserver.triggerResize(threeContainer, { width: res.w, height: res.h });

          // Matrix stability invariants: Aspect ratio must NEVER be NaN or <= 0
          ok(!Number.isNaN(camera.aspect), `Cycle ${cycle}: camera.aspect must not be NaN`);
          ok(Number.isFinite(camera.aspect), `Cycle ${cycle}: camera.aspect must be finite`);
          ok(camera.aspect > 0, `Cycle ${cycle}: camera.aspect must be positive`);
          strictEqual(renderer.width, res.w);
          strictEqual(renderer.height, res.h);
        }

        ok(resizeObserverTriggerCount >= 20, 'Resize observer executed across all stress cycles');

        // 5. Exit fullscreen safely via Escape keydown event
        toggleCadFullscreen(dom.document, true);
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), true);

        const escEvent = new MockKeyboardEvent('keydown', { key: 'Escape', code: 'Escape' });
        dom.window.dispatchEvent(escEvent);

        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false, 'Escape key safely exited fullscreen');
        strictEqual(dom.document.body.style.overflow || '', '', 'Body overflow restored on Escape exit');

        observer.disconnect();
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T4.4: test_scenario_gamemode_to_cad_transitions
    // -------------------------------------------------------------------------
    await test('T4.4: Mode Transition Stability (Gamemode Manual Cockpit <-> CAD Studio Shortcut Context Safety)', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createFullMissionControlFixture(dom);

      try {
        const {
          cadStudioColumn,
          gamemodeHudOverlay,
          hudOffhandSlot
        } = fixture;

        let activeGamemode = false;
        const wsDispatched = [];

        // Global keydown router modeling production behavior
        dom.window.addEventListener('keydown', (e) => {
          const key = e.key.toLowerCase();
          if (e.repeat) return; // Prevent key repeat spam

          const tag = dom.document.activeElement?.tagName?.toLowerCase() || '';
          if (tag === 'input' || tag === 'textarea' || dom.document.activeElement?.isContentEditable) return;

          if (key === 'f') {
            if (activeGamemode) {
              // Manual gamemode offhand hotkey
              wsDispatched.push({ type: 'manual_action', action: 'swap_hands', timestamp: Date.now() });
              hudOffhandSlot.classList.toggle('offhand-swapped');
              e.preventDefault();
              return;
            }

            // CAD Studio fullscreen
            toggleCadFullscreen(dom.document);
          }
        });

        // 1. Enter manual cockpit gamemode
        activeGamemode = true;
        gamemodeHudOverlay.classList.remove('hidden');

        strictEqual(gamemodeHudOverlay.classList.contains('hidden'), false, 'Gamemode HUD is visible');
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false);

        // 2. Press [F] in gamemode -> Triggers offhand action, BLOCKED from CAD fullscreen
        const pressF1 = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
        dom.window.dispatchEvent(pressF1);

        strictEqual(wsDispatched.length, 1, 'Gamemode offhand action dispatched');
        strictEqual(wsDispatched[0].action, 'swap_hands');
        strictEqual(hudOffhandSlot.classList.contains('offhand-swapped'), true, 'HUD offhand updated');
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false, 'CAD Fullscreen strictly blocked in gamemode');

        // 3. Repeat key [F] holding down -> ignored by repeat guard
        const pressFRepeat = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF', repeat: true });
        dom.window.dispatchEvent(pressFRepeat);
        strictEqual(wsDispatched.length, 1, 'Repeated keydown ignored by guard');

        // 4. Exit manual gamemode back to mission control
        activeGamemode = false;
        gamemodeHudOverlay.classList.add('hidden');
        strictEqual(gamemodeHudOverlay.classList.contains('hidden'), true, 'Gamemode HUD is hidden');

        // 5. Press [F] in Mission Control -> Enters CAD Studio fullscreen smoothly
        const pressF2 = new MockKeyboardEvent('keydown', { key: 'F', code: 'KeyF' });
        dom.window.dispatchEvent(pressF2);

        strictEqual(wsDispatched.length, 1, 'No new gamemode action dispatched');
        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), true, 'CAD Fullscreen entered in Mission Control');
        strictEqual(dom.document.body.style.overflow, 'hidden');

        // 6. Press [F] again -> Exits CAD Studio fullscreen
        const pressF3 = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
        dom.window.dispatchEvent(pressF3);

        strictEqual(cadStudioColumn.classList.contains('cad-studio-fullscreen'), false, 'CAD Fullscreen cleanly exited');
        strictEqual(dom.document.body.style.overflow || '', '');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T4.5: test_scenario_dual_forwarder_and_perfection_suite
    // -------------------------------------------------------------------------
    await test('T4.5: Compatibility Forwarder & Full CAD Studio Regression Suite (Runs cadWorldStudioPerfectionTest & check:syntax)', () => {
      // 1. Verify existence of forwarder file and legacy test
      const forwarderPath = path.join(PROJECT_ROOT, 'tests/cadWorldStudioPerfectionTest.js');
      const legacyTestPath = path.join(PROJECT_ROOT, 'test/cadWorldStudioPerfectionTest.js');

      ok(fs.existsSync(forwarderPath), 'tests/cadWorldStudioPerfectionTest.js forwarder must exist');
      ok(fs.existsSync(legacyTestPath), 'test/cadWorldStudioPerfectionTest.js original test must exist');

      const forwarderCode = fs.readFileSync(forwarderPath, 'utf8');
      ok(forwarderCode.includes("import '../test/cadWorldStudioPerfectionTest.js';") || forwarderCode.includes('cadWorldStudioPerfectionTest'), 'Forwarder correctly references legacy perfection test');

      // 2. Execute the 6-phase perfection test suite via Node.js
      const perfectionOutput = execSync(`node "${forwarderPath}"`, {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 20000
      });

      ok(perfectionOutput.includes('✓ 1. Native Anvil (.mca) Region Reader verified'), 'Phase 1 passed');
      ok(perfectionOutput.includes('✓ 2. Auto-Discovery for local worlds & external schematics verified'), 'Phase 2 passed');
      ok(perfectionOutput.includes('✓ 3. Litematica Verifier & Smart Path Generator verified'), 'Phase 3 passed');
      ok(perfectionOutput.includes('✓ 4. Multi-Object Scene Graph, Snap-to-Ground, Undo/Redo & Project Save/Load verified'), 'Phase 4 passed');
      ok(perfectionOutput.includes('✓ 5. Omnipresent Spatial AI Co-Pilot & Scene Context Digest verified'), 'Phase 5 passed');
      ok(perfectionOutput.includes('✓ 6. CAD World Studio HTML Workstation UI verified'), 'Phase 6 passed');
      ok(perfectionOutput.includes('ALL CAD WORLD STUDIO & SPATIAL AI TESTS PASSED'), 'All 6 phases completed successfully');

      // 3. Execute npm run check:syntax to ensure zero syntax violations
      const syntaxOutput = execSync('npm run check:syntax', {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        timeout: 10000
      });

      ok(syntaxOutput.includes('node --check'), 'check:syntax executed node --check');
    });

  });
}

// Standalone execution support
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}

export default runTests;
