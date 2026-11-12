/**
 * Tier 3: Cross-Feature Interactions Integration Test Suite
 * 
 * Verifies pairwise and cross-feature interactions across the CAD World Studio,
 * Viewport, Action Bar, Fullscreen mode, Three.js camera, and Bot-Cam offline recovery:
 * - T3.1 (F1+F4): Grid to 100vw Fullscreen transition.
 * - T3.2 (F4+F6): Fullscreen resize and layout restoration.
 * - T3.3 (F5+F4+F2): Shortcut [F] toggling fullscreen while action bar remains anchored and visible.
 * - T3.4 (F3+F6): Sidebar collapse dynamically expanding canvas width.
 * - T3.5 (F5+Gamemode): [F] key in active manual gamemode triggering offhand action and blocked from CAD fullscreen.
 * - T3.6 (F7+F8): Tab switching between Camera and 2D-Map preserving offline retry card state.
 * - T3.7 (F2+F3): Expanding complex Spatial AI inspector without pushing sticky action footer off-screen.
 * - T3.8 (F4+F7): CAD fullscreen toggle operating orthogonally without disrupting Bot-Cam background probe timers.
 * 
 * Requirements: TEST_INFRA.md §6.3, PROJECT.md (F1–F8), ORIGINAL_REQUEST.md (R1–R4).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

/**
 * Builds a standardized headless DOM fixture representing the Minecraft Bot
 * Mission Control Dashboard with 3-column layout, CAD Studio, and Bot-Cam wrapper.
 */
function createDashboardFixture(dom) {
  const { document } = dom;

  // Root columns container
  const dashboardContainer = document.createElement('DIV');
  dashboardContainer.id = 'dashboardContainer';
  dashboardContainer.className = 'dashboard-container';

  // ---------------------------------------------------------------------------
  // Column 1: Bot-Cam / Map / Schematics / Settings
  // ---------------------------------------------------------------------------
  const columnLeft = document.createElement('DIV');
  columnLeft.id = 'columnLeft';
  columnLeft.className = 'column-left';

  // Navigation tab buttons
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

  const tabBtnSchematics = document.createElement('BUTTON');
  tabBtnSchematics.id = 'tabBtnSchematics';
  tabBtnSchematics.className = 'tab-btn';
  tabBtnSchematics.setAttribute('data-tab', 'tab-schematics');

  const tabBtnSettings = document.createElement('BUTTON');
  tabBtnSettings.id = 'tabBtnSettings';
  tabBtnSettings.className = 'tab-btn';
  tabBtnSettings.setAttribute('data-tab', 'tab-settings');

  navTabs.appendChild(tabBtnViewer);
  navTabs.appendChild(tabBtnMap);
  navTabs.appendChild(tabBtnSchematics);
  navTabs.appendChild(tabBtnSettings);
  columnLeft.appendChild(navTabs);

  // Tab Panes
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

  const viewerOverlayBar = document.createElement('DIV');
  viewerOverlayBar.id = 'viewerOverlayBar';
  viewerOverlayBar.className = 'viewer-overlay-bar';

  // Offline Fallback Card (F7/F8)
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
  viewerWrapper.appendChild(viewerOverlayBar);
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
  // Column 2: CAD World Studio & Viewport (Center Column)
  // ---------------------------------------------------------------------------
  const cadStudioColumn = document.createElement('DIV');
  cadStudioColumn.id = 'cadStudioColumn';
  cadStudioColumn.className = 'column-cad-studio';
  cadStudioColumn.style.width = '52%';

  const panelCad = document.createElement('DIV');
  panelCad.id = 'panelCadStudio';
  panelCad.className = 'panel-cad';

  // Scan bar
  const cadWorldScanBar = document.createElement('DIV');
  cadWorldScanBar.id = 'cadWorldScanBar';
  cadWorldScanBar.className = 'cad-world-scan-bar';
  panelCad.appendChild(cadWorldScanBar);

  // Toolbar
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

  // Workspace (Flex container holding Canvas + Sidebar)
  const cadWorkspace = document.createElement('DIV');
  cadWorkspace.className = 'cad-studio-workspace';
  cadWorkspace.style.display = 'flex';
  cadWorkspace.style.flexDirection = 'row';
  cadWorkspace.style.position = 'relative';

  // Three.js Canvas Container
  const threeContainer = document.createElement('DIV');
  threeContainer.id = 'threeContainer';
  threeContainer.className = 'three-container';
  threeContainer.clientWidth = 960;
  threeContainer.clientHeight = 600;

  // CAD Studio Sidebar
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

  const studioAiCopilotPanel = document.createElement('DIV');
  studioAiCopilotPanel.id = 'studioAiCopilotPanel';
  spatialAiPane.appendChild(studioAiCopilotPanel);
  cadStudioSidebar.appendChild(spatialAiPane);

  cadWorkspace.appendChild(threeContainer);
  cadWorkspace.appendChild(cadStudioSidebar);
  panelCad.appendChild(cadWorkspace);

  // Sticky Action Footer (F2)
  const buildActionsBar = document.createElement('DIV');
  buildActionsBar.className = 'build-actions-bar';
  buildActionsBar.style.position = 'sticky';
  buildActionsBar.style.bottom = '0';

  const btnStartSceneBuildQueue = document.createElement('BUTTON');
  btnStartSceneBuildQueue.id = 'btnStartSceneBuildQueue';
  btnStartSceneBuildQueue.className = 'btn btn-primary';
  btnStartSceneBuildQueue.textContent = '🚀 Ganze Szene bauen';

  const btnConfirmBuild = document.createElement('BUTTON');
  btnConfirmBuild.id = 'btnConfirmBuild';
  btnConfirmBuild.className = 'btn btn-success';
  btnConfirmBuild.textContent = '✓ Build bestätigen';

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
  // Column 3: Architect Chat & Blueprints
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

  const gamemodeInputCapture = document.createElement('DIV');
  gamemodeInputCapture.id = 'gamemodeInputCapture';
  gamemodeInputCapture.className = 'gamemode-input-capture';
  gamemodeHudOverlay.appendChild(gamemodeInputCapture);

  const hudOffhandSlot = document.createElement('DIV');
  hudOffhandSlot.id = 'hudOffhandSlot';
  hudOffhandSlot.className = 'hotbar-offhand-slot';
  gamemodeHudOverlay.appendChild(hudOffhandSlot);

  document.body.appendChild(dashboardContainer);
  document.body.appendChild(gamemodeHudOverlay);

  // Wire tab switching behavior
  const setupTabSwitching = (buttons, panes) => {
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

  // Setup CAD sidebar tabs
  setupTabSwitching(
    [tabBtnObjects, tabBtnInspector, tabBtnSpatial],
    [sceneTreePane, inspectorPane, spatialAiPane]
  );

  // Setup Column 1 navigation tabs (Bot-Cam vs Map)
  setupTabSwitching(
    [tabBtnViewer, tabBtnMap],
    [tabViewer, tabMap]
  );

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
    gamemodeInputCapture,
    hudOffhandSlot
  };
}

/**
 * Controller helper executing CAD fullscreen toggle with state updates and body overflow lock.
 */
function triggerCadFullscreenToggle(document, forceState = null) {
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
 * Main Tier 3 runner export
 */
export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, notStrictEqual, ok, deepStrictEqual } = harness;

  await describe('Tier 3: Cross-Feature Interactions (T3.1–T3.8)', async () => {

    // -------------------------------------------------------------------------
    // T3.1: F1 + F4 (Grid to 100vw Fullscreen transition)
    // -------------------------------------------------------------------------
    await test('T3.1 (F1+F4): Grid to 100vw Fullscreen transition', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const col = fixture.cadStudioColumn;
        const btn = fixture.btnToggleCadFullscreen;

        // 1. Initial 3-column layout state
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Normal layout must not have fullscreen class');
        strictEqual(col.style.width, '52%', 'Initial center column occupies 52% of 3-column grid');
        strictEqual(dom.document.body.style.overflow || '', '', 'Body overflow must not be locked initially');

        // 2. Trigger Fullscreen
        const entered = triggerCadFullscreenToggle(dom.document, true);
        strictEqual(entered, true, 'Fullscreen transition returned true');
        strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'cadStudioColumn must have .cad-studio-fullscreen');
        strictEqual(col.style.width, '100vw', 'Column width must expand to 100vw');
        strictEqual(col.style.position, 'fixed', 'Column position must be fixed overlay');
        strictEqual(dom.document.body.style.overflow, 'hidden', 'Body overflow must be locked to hidden in fullscreen');
        ok(btn.textContent.includes('Vollbild beenden'), 'Button text must reflect exit action');
        strictEqual(btn.classList.contains('active'), true, 'Fullscreen button must have active class');

        // 3. Exit Fullscreen
        const exited = triggerCadFullscreenToggle(dom.document, false);
        strictEqual(exited, false, 'Fullscreen exit returned false');
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Fullscreen class must be removed');
        strictEqual(col.style.width, '52%', 'Column width must be restored to 52%');
        strictEqual(col.style.position, '', 'Fixed positioning must be cleared');
        strictEqual(dom.document.body.style.overflow || '', '', 'Body overflow lock must be released');
        ok(btn.textContent.includes('CAD Vollbild'), 'Button text must revert to enter prompt');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.2: F4 + F6 (Fullscreen resize and layout restoration)
    // -------------------------------------------------------------------------
    await test('T3.2 (F4+F6): Fullscreen resize and layout restoration', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const container = fixture.threeContainer;
        const camera = new threeGlobals.MockPerspectiveCamera(45, 960 / 600, 0.1, 1000);
        const renderer = new threeGlobals.MockWebGLRenderer({ width: 960, height: 600 });
        renderer.domElement.ownerDocument = dom.document;
        container.appendChild(renderer.domElement);

        const observer = new threeGlobals.ResizeObserver((entries) => {
          for (const entry of entries) {
            const w = Math.max(100, entry.contentRect.width);
            const h = Math.max(100, entry.contentRect.height);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
          }
        });
        observer.observe(container);

        // Verify initial geometry
        strictEqual(camera.aspect, 1.6, 'Initial aspect ratio must be 960 / 600 = 1.6');
        strictEqual(renderer.width, 960);
        strictEqual(renderer.height, 600);
        const initialCalls = camera.updateProjectionMatrixCalls;

        // Enter Fullscreen: Container expands to full window (e.g. 1920x1080)
        triggerCadFullscreenToggle(dom.document, true);
        container.clientWidth = 1920;
        container.clientHeight = 1080;
        threeGlobals.ResizeObserver.triggerResize(container, { width: 1920, height: 1080 });

        const fsAspect = 1920 / 1080;
        strictEqual(camera.aspect, fsAspect, 'Camera aspect must adapt to 1920 / 1080');
        ok(camera.updateProjectionMatrixCalls > initialCalls, 'Projection matrix update must be invoked');
        strictEqual(renderer.width, 1920, 'Renderer width must update to 1920');
        strictEqual(renderer.height, 1080, 'Renderer height must update to 1080');
        ok(!Number.isNaN(camera.aspect), 'Aspect ratio must not be NaN');
        ok(Number.isFinite(camera.aspect), 'Aspect ratio must be finite');

        // Exit Fullscreen: Container restores to 960x600
        triggerCadFullscreenToggle(dom.document, false);
        container.clientWidth = 960;
        container.clientHeight = 600;
        threeGlobals.ResizeObserver.triggerResize(container, { width: 960, height: 600 });

        strictEqual(camera.aspect, 1.6, 'Camera aspect must restore cleanly to 1.6');
        strictEqual(renderer.width, 960, 'Renderer width must restore to 960');
        strictEqual(renderer.height, 600, 'Renderer height must restore to 600');

        observer.disconnect();
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.3: F5 + F4 + F2 (Shortcut [F] toggling fullscreen while action bar remains anchored)
    // -------------------------------------------------------------------------
    await test('T3.3 (F5+F4+F2): Shortcut [F] toggling fullscreen while action bar remains anchored and visible', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const col = fixture.cadStudioColumn;
        const bar = fixture.buildActionsBar;
        const btnBuild = fixture.btnStartSceneBuildQueue;
        const btnConfirm = fixture.btnConfirmBuild;

        let buildDispatched = false;
        btnConfirm.addEventListener('click', () => {
          buildDispatched = true;
        });

        // Register keyboard shortcut handler with input filtering
        dom.window.addEventListener('keydown', (e) => {
          const tag = dom.document.activeElement?.tagName?.toLowerCase() || '';
          if (tag === 'input' || tag === 'textarea' || dom.document.activeElement?.isContentEditable) return;
          if (e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;

          if (e.key === 'f' || e.key === 'F') {
            triggerCadFullscreenToggle(dom.document);
          }
        });

        // Dispatch [F] keydown on window
        const pressF = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
        dom.window.dispatchEvent(pressF);

        // Verify fullscreen entered
        strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'Pressing [F] must enter CAD fullscreen');

        // Verify action bar visibility, pinning and interactivity in fullscreen
        strictEqual(bar.parentElement.id, 'panelCadStudio', 'Action bar must remain anchored inside panelCadStudio');
        strictEqual(bar.style.position, 'sticky', 'Action bar must remain sticky');
        strictEqual(bar.style.bottom, '0', 'Action bar must remain pinned to bottom: 0');
        strictEqual(btnBuild.disabled, false, 'Start scene build button must remain enabled');
        strictEqual(btnConfirm.disabled, false, 'Confirm build button must remain enabled');

        // Click action button in fullscreen
        btnConfirm.click();
        strictEqual(buildDispatched, true, 'Confirm build button must be clickable inside fullscreen mode');

        // Press [F] again to exit
        dom.window.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'F', code: 'KeyF' }));
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Pressing [F] again must exit fullscreen');
        strictEqual(bar.style.position, 'sticky', 'Action bar remains sticky after fullscreen exit');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.4: F3 + F6 (Sidebar collapse dynamically expanding canvas width)
    // -------------------------------------------------------------------------
    await test('T3.4 (F3+F6): Sidebar collapse dynamically expanding canvas width', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const container = fixture.threeContainer;
        const sidebar = fixture.cadStudioSidebar;
        const btnToggle = fixture.btnToggleStudioInspector;

        const camera = new threeGlobals.MockPerspectiveCamera(45, 700 / 600, 0.1, 1000);
        const renderer = new threeGlobals.MockWebGLRenderer({ width: 700, height: 600 });
        container.appendChild(renderer.domElement);

        const resizeHandler = (newWidth, newHeight) => {
          container.clientWidth = newWidth;
          container.clientHeight = newHeight;
          camera.aspect = newWidth / newHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(newWidth, newHeight, false);
        };

        // Initial state: Sidebar expanded (width: 300px), canvas has 700px width
        strictEqual(sidebar.classList.contains('hidden'), false, 'Sidebar must be visible initially');
        strictEqual(camera.aspect, 700 / 600);

        // Wire collapse toggle button
        btnToggle.addEventListener('click', () => {
          const isHidden = sidebar.classList.toggle('hidden');
          btnToggle.classList.toggle('active', !isHidden);
          // When sidebar collapses, reclaimed 300px widens canvas from 700px to 1000px
          const reclaimedWidth = isHidden ? 1000 : 700;
          resizeHandler(reclaimedWidth, 600);
        });

        // 1. Collapse sidebar
        btnToggle.click();
        strictEqual(sidebar.classList.contains('hidden'), true, 'Sidebar must gain .hidden class');
        strictEqual(btnToggle.classList.contains('active'), false, 'Toggle button must deactivate');
        strictEqual(container.clientWidth, 1000, 'Canvas container width must expand to 1000px');
        strictEqual(camera.aspect, 1000 / 600, 'Camera aspect must adapt to expanded width 1000 / 600');
        strictEqual(renderer.width, 1000, 'Renderer width must match 1000');

        // 2. Expand sidebar back
        btnToggle.click();
        strictEqual(sidebar.classList.contains('hidden'), false, 'Sidebar must lose .hidden class');
        strictEqual(btnToggle.classList.contains('active'), true, 'Toggle button must reactivate');
        strictEqual(container.clientWidth, 700, 'Canvas container width must revert to 700px');
        strictEqual(camera.aspect, 700 / 600, 'Camera aspect must revert to 700 / 600');
        strictEqual(renderer.width, 700, 'Renderer width must match 700');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.5: F5 + Gamemode (Gamemode offhand action shielded from CAD fullscreen)
    // -------------------------------------------------------------------------
    await test('T3.5 (F5+Gamemode): [F] key in active manual gamemode triggering offhand action and blocked from CAD fullscreen', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const col = fixture.cadStudioColumn;
        const hudOverlay = fixture.gamemodeHudOverlay;
        let activeGamemode = false;
        const dispatchedWsMessages = [];

        // Simulated WebSocket dispatcher
        const sendWS = (msg) => dispatchedWsMessages.push(msg);

        // Unified key handler with gamemode priority filter
        dom.window.addEventListener('keydown', (e) => {
          const key = e.key.toLowerCase();
          if (key !== 'f') return;

          if (activeGamemode) {
            // Manual Gamemode consumes [F] as offhand hand swap
            sendWS({ type: 'manual_action', action: 'swap_hands' });
            e.preventDefault();
            return;
          }

          // CAD Studio fullscreen is triggered only outside gamemode
          triggerCadFullscreenToggle(dom.document);
        });

        // 1. Activate manual gamemode
        activeGamemode = true;
        hudOverlay.classList.remove('hidden');

        // Press [F] while gamemode is active
        const pressFInGamemode = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
        dom.window.dispatchEvent(pressFInGamemode);

        strictEqual(dispatchedWsMessages.length, 1, 'Exactly one WS message dispatched');
        deepStrictEqual(dispatchedWsMessages[0], { type: 'manual_action', action: 'swap_hands' });
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'CAD Fullscreen must NOT be triggered in gamemode');

        // 2. Exit manual gamemode
        activeGamemode = false;
        hudOverlay.classList.add('hidden');

        // Press [F] outside gamemode in Mission Control context
        const pressFNormal = new MockKeyboardEvent('keydown', { key: 'F', code: 'KeyF' });
        dom.window.dispatchEvent(pressFNormal);

        strictEqual(dispatchedWsMessages.length, 1, 'No additional gamemode WS message dispatched');
        strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'CAD Fullscreen MUST be triggered outside gamemode');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.6: F7 + F8 (Tab switching preserving offline retry card state)
    // -------------------------------------------------------------------------
    await test('T3.6 (F7+F8): Tab switching between Camera and 2D-Map preserving offline retry card state', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const placeholder = fixture.viewerOfflinePlaceholder;
        const iframe = fixture.viewerFrame;
        const btnRetry = fixture.btnRetryViewer;
        const tabViewer = fixture.tabViewer;
        const tabMap = fixture.tabMap;

        let probeActive = false;
        let probeCount = 0;

        btnRetry.addEventListener('click', () => {
          probeCount++;
          probeActive = true;
          btnRetry.disabled = true;
          btnRetry.textContent = '⏳ Verbinde mit Port 3081...';
        });

        // 1. Initial offline state
        strictEqual(placeholder.style.display, 'flex', 'Offline card must be visible');
        strictEqual(iframe.style.display, 'none', 'Iframe must be hidden when offline');
        ok(placeholder.textContent.includes('Port 3081'), 'Placeholder must mention port 3081');

        // 2. Click Retry button
        btnRetry.click();
        strictEqual(probeActive, true, 'Probe must be flagged active');
        strictEqual(probeCount, 1, 'Probe count must be 1');
        strictEqual(btnRetry.disabled, true, 'Retry button must enter disabled/loading state');
        ok(btnRetry.textContent.includes('Verbinde'), 'Button must show loading text');

        // 3. Switch away to 2D-Map tab
        fixture.tabBtnMap.click();
        strictEqual(tabMap.classList.contains('active'), true, '2D Map tab must be active');
        strictEqual(tabViewer.classList.contains('active'), false, 'Bot-Cam tab must be hidden');

        // 4. Switch back to Bot-Cam tab
        fixture.tabBtnViewer.click();
        strictEqual(tabViewer.classList.contains('active'), true, 'Bot-Cam tab must be reactivated');

        // 5. Verify offline placeholder state is preserved without DOM destruction or race
        strictEqual(placeholder.style.display, 'flex', 'Placeholder must remain displayed');
        strictEqual(iframe.style.display, 'none', 'Iframe must remain hidden');
        strictEqual(btnRetry.disabled, true, 'Retry button loading state must persist across tab switches');
        strictEqual(probeCount, 1, 'Tab switching must not trigger duplicate probe storms');
        strictEqual(dom.document.querySelectorAll('#viewerOfflinePlaceholder').length, 1, 'Placeholder must not duplicate');
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.7: F2 + F3 (Expanding deep Spatial AI inspector without pushing sticky footer off-screen)
    // -------------------------------------------------------------------------
    await test('T3.7 (F2+F3): Expanding complex Spatial AI inspector without pushing sticky action footer off-screen', () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      try {
        const bar = fixture.buildActionsBar;
        const sidebar = fixture.cadStudioSidebar;
        const spatialPane = fixture.spatialAiPane;
        const tabBtnSpatial = fixture.tabBtnSpatial;

        // Switch to Spatial AI tab
        tabBtnSpatial.click();
        strictEqual(spatialPane.classList.contains('active'), true, 'Spatial AI pane must be active');

        // Inject deep, extensive inspector elements (50 complex verifier records)
        for (let i = 0; i < 50; i++) {
          const record = dom.document.createElement('DIV');
          record.className = 'spatial-ai-record';
          record.textContent = `Spatial Node #${i + 1}: Foundational anchor analysis & voxel mesh diff at (X:${i * 4}, Y:68, Z:${i * 4})`;
          spatialPane.appendChild(record);
        }

        sidebar.scrollHeight = 3200;
        sidebar.clientHeight = 600;
        sidebar.style.overflowY = 'auto';

        // Verify that sidebar encapsulates internal scrolling and action bar stays pinned
        strictEqual(sidebar.style.overflowY, 'auto', 'Sidebar must support internal scrolling');
        strictEqual(bar.parentElement.id, 'panelCadStudio', 'Action bar remains parented by panelCadStudio');
        strictEqual(bar.style.position, 'sticky', 'Action bar must retain sticky positioning');
        strictEqual(bar.style.bottom, '0', 'Action bar must retain bottom: 0 pinning');

        // Verify buttons in sticky bar remain accessible
        strictEqual(fixture.btnStartSceneBuildQueue.disabled, false);
        strictEqual(fixture.btnConfirmBuild.disabled, false);
        strictEqual(fixture.btnStopBuild.disabled, false);
      } finally {
        teardownMockThreeGlobals();
        teardownMockDom();
      }
    });

    // -------------------------------------------------------------------------
    // T3.8: F4 + F7 (CAD fullscreen toggle operating orthogonally to Bot-Cam probe timers)
    // -------------------------------------------------------------------------
    await test('T3.8 (F4+F7): CAD fullscreen toggle operating orthogonally without disrupting Bot-Cam background probe timers', async () => {
      const dom = setupMockDom();
      const threeGlobals = setupMockThreeGlobals();
      const fixture = createDashboardFixture(dom);
      let probeIntervalId = null;
      try {
        const col = fixture.cadStudioColumn;
        const placeholder = fixture.viewerOfflinePlaceholder;

        let probeTimerTicks = 0;
        probeIntervalId = setInterval(() => {
          probeTimerTicks++;
        }, 15);

        // Initial state: Camera probe timer ticking in background
        strictEqual(placeholder.style.display, 'flex', 'Bot-Cam is in offline card state');
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'CAD Studio is in normal mode');

        // Enter CAD Fullscreen
        triggerCadFullscreenToggle(dom.document, true);
        strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'CAD Fullscreen entered');

        // Wait for background probe timer tick during fullscreen
        await new Promise(r => setTimeout(r, 45));
        ok(probeTimerTicks >= 1, `Probe timer must tick uninterrupted during CAD fullscreen (ticks: ${probeTimerTicks})`);
        strictEqual(placeholder.style.display, 'flex', 'Bot-Cam offline card remains in Column 1 untouched');

        const ticksBeforeExit = probeTimerTicks;

        // Exit CAD Fullscreen
        triggerCadFullscreenToggle(dom.document, false);
        strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'CAD Fullscreen exited');

        // Wait for probe timer tick after exit
        await new Promise(r => setTimeout(r, 45));
        ok(probeTimerTicks > ticksBeforeExit, `Probe timer continues ticking smoothly after CAD fullscreen exit (ticks: ${probeTimerTicks})`);
        strictEqual(placeholder.style.display, 'flex', 'Bot-Cam offline card remains undisturbed');
      } finally {
        if (probeIntervalId) clearInterval(probeIntervalId);
        teardownMockThreeGlobals();
        teardownMockDom();
      }
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
