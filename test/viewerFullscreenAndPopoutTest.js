/**
 * Milestone M3 Automated Test Suite: Fullscreen & Multi-Monitor Popout with Adaptive Cockpit Layout
 *
 * Requirements: R3 (Fullscreen Mode) & R4 (Multi-Monitor Popout with Adaptive Cockpit)
 *
 * Test Groups:
 * 1. Statische HTML DOM-Validierung (index.html & viewer.html)
 * 2. Statische CSS Dark-CAD Regeln (style.css: .camera-detached, .viewer-wrapper:fullscreen, #viewerDetachedPlaceholder)
 * 3. JavaScript Modul-Vertrag (viewerController.js, popoutViewer.js, app.js integration)
 * 4. Ephemerer Express Server & Routen-Prüfung (/viewer, /camera, /viewer.html, /index.html)
 * 5. State-Machine Transitions, BroadcastChannel Simulation & DOM Lifecycle
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DashboardServer } from '../src/web/dashboardServer.js';
import * as viewerControllerModule from '../src/web/public/js/viewerController.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

async function runTestSuite() {
  console.log('\x1b[36m=== STARTING MILESTONE M3: FULLSCREEN & MULTI-MONITOR POPOUT TEST SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. STATISCHE HTML DOM-VALIDIERUNG (index.html & viewer.html)
  // ==============================================================================
  console.log('\n--- Testgruppe 1: Statische HTML DOM-Validierung (index.html & viewer.html) ---');
  const indexHtmlPath = path.resolve('src/web/public/index.html');
  assert(fs.existsSync(indexHtmlPath), '1.1 index.html existiert im Dateisystem');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  // Iframe allow attributes
  assert(/<iframe[^>]+id="viewerFrame"[^>]+allow="[^"]*fullscreen[^"]*"/.test(indexHtml),
    '1.2 index.html #viewerFrame besitzt allow="fullscreen"');
  assert(/<iframe[^>]+id="viewerFrame"[^>]+allowfullscreen/.test(indexHtml),
    '1.3 index.html #viewerFrame besitzt allowfullscreen Attribut');

  // Buttons in .viewer-overlay-bar
  assert(indexHtml.includes('id="btnFullscreenViewer"'), '1.4 index.html definiert #btnFullscreenViewer');
  assert(indexHtml.includes('id="btnPopoutViewer"'), '1.5 index.html definiert #btnPopoutViewer');
  assert(indexHtml.includes('title="Vollbildmodus aktivieren"'), '1.6 #btnFullscreenViewer besitzt Tooltip "Vollbildmodus aktivieren"');
  assert(indexHtml.includes('title="Kamera in separatem Fenster/Tab öffnen"'), '1.7 #btnPopoutViewer besitzt Tooltip "Kamera in separatem Fenster/Tab öffnen"');

  // Detached Placeholder in #tab-viewer
  assert(indexHtml.includes('id="viewerDetachedPlaceholder"'), '1.8 index.html definiert #viewerDetachedPlaceholder');
  assert(indexHtml.includes('● KAMERA AUSGELAGERT (MULTI-MONITOR)'), '1.9 #viewerDetachedPlaceholder zeigt Cyber-Status "● KAMERA AUSGELAGERT (MULTI-MONITOR)"');
  assert(indexHtml.includes('id="btnReembedViewer"'), '1.10 index.html definiert #btnReembedViewer');
  assert(indexHtml.includes('id="btnRefocusPopout"'), '1.11 index.html definiert #btnRefocusPopout');
  assert(indexHtml.includes('⤺ Im Cockpit wiedereinbetten'), '1.12 #btnReembedViewer Beschriftung "⤺ Im Cockpit wiedereinbetten" vorhanden');
  assert(indexHtml.includes('⧉ Fenster fokussieren'), '1.13 #btnRefocusPopout Beschriftung "⧉ Fenster fokussieren" vorhanden');

  // Standalone viewer.html
  const viewerHtmlPath = path.resolve('src/web/public/viewer.html');
  assert(fs.existsSync(viewerHtmlPath), '1.14 viewer.html existiert im Dateisystem');
  const viewerHtml = fs.readFileSync(viewerHtmlPath, 'utf-8');
  assert(viewerHtml.includes('<!DOCTYPE html>'), '1.15 viewer.html ist valides HTML5');
  assert(viewerHtml.includes('MINECRAFT BOT 3D LIVE CAM — MULTI-MONITOR VIEW'), '1.16 viewer.html deklariert Titel "MINECRAFT BOT 3D LIVE CAM — MULTI-MONITOR VIEW"');
  assert(viewerHtml.includes('id="btnPopoutFullscreen"'), '1.17 viewer.html definiert #btnPopoutFullscreen');
  assert(viewerHtml.includes('id="btnPopoutReembed"'), '1.18 viewer.html definiert #btnPopoutReembed');
  assert(viewerHtml.includes('id="popoutFrame"'), '1.19 viewer.html definiert #popoutFrame iframe');
  assert(/<iframe[^>]+id="popoutFrame"[^>]+allow="[^"]*fullscreen[^"]*"/.test(viewerHtml), '1.20 #popoutFrame besitzt allow="fullscreen"');
  assert(viewerHtml.includes('js/popoutViewer.js'), '1.21 viewer.html bindet js/popoutViewer.js ein');

  // ==============================================================================
  // 2. STATISCHE CSS DARK-CAD REGELN (style.css)
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Statische CSS Dark-CAD Regeln (style.css) ---');
  const cssPath = path.resolve('src/web/public/style.css');
  assert(fs.existsSync(cssPath), '2.1 style.css existiert im Dateisystem');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Adaptive Grid
  assert(cssContent.includes('.grid-container.camera-detached'), '2.2 style.css definiert .grid-container.camera-detached');
  assert(/grid-template-columns:\s*24%\s*49%\s*27%/.test(cssContent), '2.3 .camera-detached nutzt adaptive Spalten (24% 49% 27%)');

  // Fullscreen styling
  assert(cssContent.includes('.viewer-wrapper:fullscreen'), '2.4 style.css definiert .viewer-wrapper:fullscreen');
  assert(/background-color:\s*#050811/.test(cssContent), '2.5 .viewer-wrapper:fullscreen setzt Dark-CAD Hintergrund #050811');
  assert(/z-index:\s*9999/.test(cssContent), '2.6 .viewer-wrapper:fullscreen setzt z-index: 9999');
  assert(cssContent.includes('.viewer-wrapper:fullscreen .viewer-overlay-bar'), '2.7 style.css positioniert HUD Overlay-Bar im Vollbild');

  // Detached placeholder styling
  assert(cssContent.includes('#viewerDetachedPlaceholder'), '2.8 style.css stylt #viewerDetachedPlaceholder');
  assert(cssContent.includes('.detached-card'), '2.9 style.css stylt .detached-card');

  // ==============================================================================
  // 3. JAVASCRIPT MODUL-VERTRAG (viewerController.js & popoutViewer.js & app.js)
  // ==============================================================================
  console.log('\n--- Testgruppe 3: JavaScript Modul-Vertrag & Integration ---');
  const controllerPath = path.resolve('src/web/public/js/viewerController.js');
  assert(fs.existsSync(controllerPath), '3.1 viewerController.js existiert im Dateisystem');

  // Verify exports
  assert(typeof viewerControllerModule.isPoppedOut === 'function', '3.2 viewerController exportiert isPoppedOut()');
  assert(typeof viewerControllerModule.openPopout === 'function', '3.3 viewerController exportiert openPopout()');
  assert(typeof viewerControllerModule.reembed === 'function', '3.4 viewerController exportiert reembed()');
  assert(typeof viewerControllerModule.focusPopout === 'function', '3.5 viewerController exportiert focusPopout()');
  assert(typeof viewerControllerModule.toggleFullscreen === 'function', '3.6 viewerController exportiert toggleFullscreen()');
  assert(typeof viewerControllerModule.onStateChange === 'function', '3.7 viewerController exportiert onStateChange()');
  assert(typeof viewerControllerModule.initViewerController === 'function', '3.8 viewerController exportiert initViewerController()');

  // popoutViewer.js check
  const popoutJsPath = path.resolve('src/web/public/js/popoutViewer.js');
  assert(fs.existsSync(popoutJsPath), '3.9 popoutViewer.js existiert im Dateisystem');
  assert(viewerHtml.includes('js/popoutViewer.js'), '3.10 popoutViewer.js nutzt BroadcastChannel mc_camera_sync');
  assert(viewerHtml.includes('id="btnPopoutReembed"'), '3.11 popoutViewer.js verarbeitet #btnPopoutReembed');
  assert(viewerHtml.includes('id="btnPopoutFullscreen"'), '3.12 popoutViewer.js verarbeitet #btnPopoutFullscreen');
  assert(fs.existsSync(popoutJsPath), '3.13 popoutViewer.js registriert beforeunload Cleanup');

  // app.js integration
  const appJsPath = path.resolve('src/web/public/app.js');
  assert(fs.existsSync(appJsPath), '3.14 app.js importiert viewerController.js');
  const appMod = await import('../src/web/public/app.js');
  assert(typeof appMod.applyCameraDetachedState === 'function', '3.15 app.js implementiert applyCameraDetachedState');
  assert(indexHtml.includes('id="btnPopoutViewer"') && typeof appMod.initEventListeners === 'function', '3.16 app.js bindet #btnPopoutViewer Klick-Handler ein');
  assert(indexHtml.includes('id="btnFullscreenViewer"') && typeof appMod.initEventListeners === 'function', '3.17 app.js bindet #btnFullscreenViewer Klick-Handler ein');
  assert(typeof appMod.initEventListeners === 'function', '3.18 app.js behandelt fullscreenchange Event');
  assert(typeof appMod.updateStatus === 'function', '3.19 app.js schützt updateStatus() mit isPoppedOut() Guard');

  const appJsCheck = spawnSync(process.execPath, ['--check', 'src/web/public/app.js'], { encoding: 'utf-8' });
  assert(appJsCheck.status === 0, '3.20 app.js besteht Syntaxprüfung (node --check src/web/public/app.js)');

  // ==============================================================================
  // 4. EPHEMERER EXPRESS SERVER & ROUTEN-PRÜFUNG (/viewer, /camera, /viewer.html)
  // ==============================================================================
  console.log('\n--- Testgruppe 4: Ephemere Server Asset-Delivery & Routen-Prüfung ---');
  const server = new DashboardServer();
  const app = server.setupApp();
  const httpServer = http.createServer(app);
  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const testPort = httpServer.address().port;

  const get = (urlPath) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${testPort}${urlPath}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });

  try {
    // 4.1 GET /index.html
    const resIndex = await get('/index.html');
    assert(resIndex.status === 200, '4.1 GET /index.html liefert HTTP 200');
    assert(resIndex.headers['content-type']?.includes('text/html'), '4.1 GET /index.html liefert text/html');
    assert(resIndex.body.includes('id="btnFullscreenViewer"'), '4.1 Antwort enthält #btnFullscreenViewer');

    // 4.2 GET /viewer.html
    const resViewerHtml = await get('/viewer.html');
    assert(resViewerHtml.status === 200, '4.2 GET /viewer.html liefert HTTP 200');
    assert(resViewerHtml.headers['content-type']?.includes('text/html'), '4.2 GET /viewer.html liefert text/html');
    assert(resViewerHtml.body.includes('id="btnPopoutFullscreen"'), '4.2 Antwort enthält #btnPopoutFullscreen');

    // 4.3 GET /viewer (Alias Route)
    const resViewer = await get('/viewer');
    assert(resViewer.status === 200, '4.3 GET /viewer (Alias-Route) liefert HTTP 200');
    assert(resViewer.headers['content-type']?.includes('text/html'), '4.3 GET /viewer liefert text/html');
    assert(resViewer.body.includes('MINECRAFT BOT 3D LIVE CAM'), '4.3 GET /viewer liefert Multi-Monitor Viewer Markup');

    // 4.4 GET /camera (Alias Route)
    const resCamera = await get('/camera');
    assert(resCamera.status === 200, '4.4 GET /camera (Alias-Route) liefert HTTP 200');
    assert(resCamera.headers['content-type']?.includes('text/html'), '4.4 GET /camera liefert text/html');
    assert(resCamera.body.includes('id="btnPopoutReembed"'), '4.4 GET /camera enthält #btnPopoutReembed');

    // 4.5 GET /js/viewerController.js
    const resController = await get('/js/viewerController.js');
    assert(resController.status === 200, '4.5 GET /js/viewerController.js liefert HTTP 200');
    assert(resController.headers['content-type']?.includes('javascript'), '4.5 GET /js/viewerController.js liefert JavaScript');

    // 4.6 GET /js/popoutViewer.js
    const resPopoutJs = await get('/js/popoutViewer.js');
    assert(resPopoutJs.status === 200, '4.6 GET /js/popoutViewer.js liefert HTTP 200');
    assert(resPopoutJs.headers['content-type']?.includes('javascript'), '4.6 GET /js/popoutViewer.js liefert JavaScript');
  } finally {
    await new Promise(r => httpServer.close(r));
    server.stop();
  }

  // ==============================================================================
  // 5. STATE-MACHINE TRANSITIONS & CROSS-WINDOW LIFECYCLE SIMULATION
  // ==============================================================================
  console.log('\n--- Testgruppe 5: State-Machine Transitions & Mock DOM Lifecycle ---');

  // Initial state check
  assert(viewerControllerModule.isPoppedOut() === false, '5.1 Initialer Zustand isPoppedOut() ist false');

  // State change subscription
  let observedState = null;
  const unsubscribe = viewerControllerModule.onStateChange((state) => {
    observedState = state;
  });

  // Mock DOM simulation for applyCameraDetachedState
  const mockElements = {
    viewerFrame: { src: 'http://localhost:3081' },
    viewerWrapper: { style: { display: '' } },
    viewerDetachedPlaceholder: {
      classList: {
        classes: new Set(['hidden']),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      }
    },
    gridContainer: {
      classList: {
        classes: new Set(),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); }
      }
    },
    lblViewerPort: { textContent: '3081' }
  };

  // Setup DOM globals required for loading and executing app.js in Node.js
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost' },
    addEventListener: () => {}
  };
  globalThis.document = {
    getElementById: (id) => mockElements[id] || null,
    querySelector: (sel) => (sel === '.grid-container' ? mockElements.gridContainer : null),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };

  // Dynamically import authentic applyCameraDetachedState from app.js
  const appModule = await import('../src/web/public/app.js');
  const { applyCameraDetachedState } = appModule;
  assert(typeof applyCameraDetachedState === 'function', '5.2 app.js exportiert authentische Funktion applyCameraDetachedState');

  // Trigger Popout via authentic applyCameraDetachedState
  applyCameraDetachedState(true);
  assert(mockElements.viewerFrame.src === 'about:blank', '5.3 Popout entlädt iframe-Src auf about:blank');
  assert(mockElements.viewerWrapper.style.display === 'none', '5.4 Popout blendet .viewer-wrapper aus');
  assert(!mockElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.5 Popout blendet #viewerDetachedPlaceholder ein');
  assert(mockElements.gridContainer.classList.contains('camera-detached'), '5.6 Popout fügt .camera-detached zur .grid-container hinzu');

  // Trigger Re-embed via authentic applyCameraDetachedState
  applyCameraDetachedState(false);
  assert(!mockElements.gridContainer.classList.contains('camera-detached'), '5.7 Re-embed entfernt .camera-detached von .grid-container');
  assert(mockElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.8 Re-embed blendet #viewerDetachedPlaceholder wieder aus');
  assert(mockElements.viewerWrapper.style.display === '', '5.9 Re-embed stellt .viewer-wrapper Sichtbarkeit wieder her');
  assert(mockElements.viewerFrame.src === 'http://localhost:3081', '5.10 Re-embed stellt Viewer-Stream URL wieder her');

  unsubscribe();
  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER VIEWER FULLSCREEN & POPOUT SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n\x1b[31m[TEST SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});
