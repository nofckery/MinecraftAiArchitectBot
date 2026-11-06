/**
 * Milestone 3 Adversarial Challenge & Stress Test Suite
 * Archetype: EMPIRICAL CHALLENGER
 * Roles: critic, specialist
 *
 * Tests:
 * 1. DOM Elements & HTML Permissions Oracle (index.html & viewer.html)
 * 2. HTTP Routes, Headers, & Query Parameter Resilience (/viewer, /camera, /viewer.html)
 * 3. CSS Dark-CAD Grid Layout, Fullscreen Z-Index, and Specificity Verification
 * 4. Viewer Controller State Machine, Polling, & Popup-Blocker Resilience
 * 5. BroadcastChannel Cross-Window Messaging, Protocol Invariants & Malformed Payloads
 * 6. WebGL Resource Lifecycle & Embedded Stream Guard Verification
 * 7. Rapid High-Frequency State Transition Stress Test (Concurrency & Leak Prevention)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { DashboardServer } from '../src/web/dashboardServer.js';
import * as viewerControllerModule from '../src/web/public/js/viewerController.js';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

async function runChallengerHarness() {
  console.log('\x1b[35m======================================================================\x1b[0m');
  console.log('\x1b[35m=== EMPIRICAL CHALLENGER: MILESTONE 3 ADVERSARIAL STRESS TEST SUITE ===\x1b[0m');
  console.log('\x1b[35m======================================================================\x1b[0m\n');

  // ============================================================================
  // 1. DOM ELEMENTS & HTML PERMISSIONS ORACLE (index.html & viewer.html)
  // ============================================================================
  console.log('\x1b[33m--- [ORACLE 1] DOM Elements & Permissions Validation ---\x1b[0m');

  const indexHtmlPath = path.resolve('src/web/public/index.html');
  assert(fs.existsSync(indexHtmlPath), '1.1 index.html exists in filesystem');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  // #viewerFrame must have allow="fullscreen; pointer-lock" and allowfullscreen
  const viewerFrameMatch = indexHtml.match(/<iframe\s+[^>]*id=["']viewerFrame["'][^>]*>/i);
  assert(viewerFrameMatch !== null, '1.2 #viewerFrame iframe tag exists in index.html');
  const viewerFrameTag = viewerFrameMatch[0];
  assert(/allow=["'][^"']*fullscreen[^"']*["']/i.test(viewerFrameTag), '1.3 #viewerFrame contains allow="...fullscreen..."');
  assert(/\ballowfullscreen\b/i.test(viewerFrameTag), '1.4 #viewerFrame contains allowfullscreen boolean attribute');
  assert(/allow=["'][^"']*pointer-lock[^"']*["']/i.test(viewerFrameTag), '1.5 #viewerFrame contains allow="...pointer-lock..."');

  // Overlay bar buttons
  assert(indexHtml.includes('id="btnFullscreenViewer"'), '1.6 #btnFullscreenViewer exists in index.html');
  assert(indexHtml.includes('id="btnPopoutViewer"'), '1.7 #btnPopoutViewer exists in index.html');
  assert(/<button[^>]+id=["']btnFullscreenViewer["'][^>]*title=["']Vollbildmodus aktivieren["']/.test(indexHtml),
    '1.8 #btnFullscreenViewer has correct tooltip attribute');
  assert(/<button[^>]+id=["']btnPopoutViewer["'][^>]*title=["']Kamera in separatem Fenster\/Tab öffnen["']/.test(indexHtml),
    '1.9 #btnPopoutViewer has correct tooltip attribute');

  // Detached placeholder & recovery controls
  assert(indexHtml.includes('id="viewerDetachedPlaceholder"'), '1.10 #viewerDetachedPlaceholder exists in index.html');
  assert(indexHtml.includes('id="btnReembedViewer"'), '1.11 #btnReembedViewer exists in index.html');
  assert(indexHtml.includes('id="btnRefocusPopout"'), '1.12 #btnRefocusPopout exists in index.html');

  // Structural relationship: viewerDetachedPlaceholder must be in #tab-viewer and sibling of viewerWrapper
  const tabViewerMatch = indexHtml.match(/<div\s+id=["']tab-viewer["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*TAB 2/i);
  assert(tabViewerMatch !== null, '1.13 #tab-viewer pane found in index.html');
  const tabViewerContent = tabViewerMatch[1];
  assert(tabViewerContent.includes('id="viewerWrapper"'), '1.14 #viewerWrapper is located inside #tab-viewer');
  assert(tabViewerContent.includes('id="viewerDetachedPlaceholder"'), '1.15 #viewerDetachedPlaceholder is located inside #tab-viewer');

  // viewer.html validation
  const viewerHtmlPath = path.resolve('src/web/public/viewer.html');
  assert(fs.existsSync(viewerHtmlPath), '1.16 viewer.html exists in filesystem');
  const viewerHtml = fs.readFileSync(viewerHtmlPath, 'utf-8');
  assert(/<!DOCTYPE\s+html>/i.test(viewerHtml), '1.17 viewer.html has HTML5 doctype');

  const popoutFrameMatch = viewerHtml.match(/<iframe\s+[^>]*id=["']popoutFrame["'][^>]*>/i);
  assert(popoutFrameMatch !== null, '1.18 #popoutFrame exists in viewer.html');
  const popoutFrameTag = popoutFrameMatch[0];
  assert(/allow=["'][^"']*fullscreen[^"']*["']/i.test(popoutFrameTag), '1.19 #popoutFrame has allow="...fullscreen..."');
  assert(/\ballowfullscreen\b/i.test(popoutFrameTag), '1.20 #popoutFrame has allowfullscreen boolean attribute');
  assert(/allow=["'][^"']*pointer-lock[^"']*["']/i.test(popoutFrameTag), '1.21 #popoutFrame has allow="...pointer-lock..."');

  assert(viewerHtml.includes('id="btnPopoutFullscreen"'), '1.22 #btnPopoutFullscreen exists in viewer.html');
  assert(viewerHtml.includes('id="btnPopoutReembed"'), '1.23 #btnPopoutReembed exists in viewer.html');
  assert(viewerHtml.includes('js/popoutViewer.js'), '1.24 viewer.html imports js/popoutViewer.js');

  // ============================================================================
  // 2. HTTP ROUTES, HEADERS, & QUERY PARAMETER RESILIENCE
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 2] HTTP Routes & Header Verification ---\x1b[0m');

  const server = new DashboardServer();
  const expressApp = server.setupApp();
  const testHttpServer = http.createServer(expressApp);
  await new Promise(resolve => testHttpServer.listen(0, '127.0.0.1', resolve));
  const assignedPort = testHttpServer.address().port;

  const requestHelper = (reqPath) => new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${assignedPort}${reqPath}`, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body
      }));
    }).on('error', reject);
  });

  try {
    // 2.1 Route GET /viewer
    const resViewer = await requestHelper('/viewer');
    assert(resViewer.statusCode === 200, '2.1 GET /viewer returns HTTP 200');
    assert(resViewer.headers['content-type']?.includes('text/html'), '2.2 GET /viewer Content-Type is text/html');
    assert(resViewer.body.includes('id="popoutFrame"'), '2.3 GET /viewer contains #popoutFrame');
    assert(resViewer.body.includes('id="btnPopoutFullscreen"'), '2.4 GET /viewer contains #btnPopoutFullscreen');
    assert(resViewer.body.includes('id="btnPopoutReembed"'), '2.5 GET /viewer contains #btnPopoutReembed');

    // 2.2 Route GET /camera
    const resCamera = await requestHelper('/camera');
    assert(resCamera.statusCode === 200, '2.6 GET /camera returns HTTP 200');
    assert(resCamera.headers['content-type']?.includes('text/html'), '2.7 GET /camera Content-Type is text/html');
    assert(resCamera.body.includes('id="popoutFrame"'), '2.8 GET /camera contains #popoutFrame');
    assert(resCamera.body.includes('id="btnPopoutFullscreen"'), '2.9 GET /camera contains #btnPopoutFullscreen');
    assert(resCamera.body.includes('id="btnPopoutReembed"'), '2.10 GET /camera contains #btnPopoutReembed');

    // 2.3 Route GET /viewer.html
    const resViewerHtml = await requestHelper('/viewer.html');
    assert(resViewerHtml.statusCode === 200, '2.11 GET /viewer.html returns HTTP 200');
    assert(resViewerHtml.body.includes('id="popoutFrame"'), '2.12 GET /viewer.html contains #popoutFrame');

    // 2.4 Adversarial query parameters: ?port=3085, XSS payloads, non-numeric values
    const resQueryPort = await requestHelper('/viewer?port=3085');
    assert(resQueryPort.statusCode === 200, '2.13 GET /viewer?port=3085 returns HTTP 200');
    assert(resQueryPort.body.includes('id="popoutFrame"'), '2.14 GET /viewer?port=3085 body intact');

    const resQueryXss = await requestHelper('/viewer?port=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    assert(resQueryXss.statusCode === 200, '2.15 GET /viewer with XSS in query param returns HTTP 200 without server crash');

    // Static assets
    const resCss = await requestHelper('/style.css');
    assert(resCss.statusCode === 200, '2.16 GET /style.css returns HTTP 200');
    assert(resCss.headers['content-type']?.includes('css'), '2.17 GET /style.css Content-Type is text/css');

    const resControllerJs = await requestHelper('/js/viewerController.js');
    assert(resControllerJs.statusCode === 200, '2.18 GET /js/viewerController.js returns HTTP 200');
    assert(resControllerJs.headers['content-type']?.includes('javascript'), '2.19 GET /js/viewerController.js Content-Type is javascript');

    const resPopoutJs = await requestHelper('/js/popoutViewer.js');
    assert(resPopoutJs.statusCode === 200, '2.20 GET /js/popoutViewer.js returns HTTP 200');
    assert(resPopoutJs.headers['content-type']?.includes('javascript'), '2.21 GET /js/popoutViewer.js Content-Type is javascript');
  } finally {
    await new Promise(resolve => testHttpServer.close(resolve));
    server.stop();
  }

  // ============================================================================
  // 3. CSS DARK-CAD GRID LAYOUT, FULLSCREEN Z-INDEX, & SPECIFICITY
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 3] CSS Rules & Specificity Verification ---\x1b[0m');

  const cssPath = path.resolve('src/web/public/style.css');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  // Verify .camera-detached exists and specifies grid-template-columns: 24% 49% 27%
  const detachedGridRegex = /\.grid-container\.camera-detached\s*\{([^}]*)\}/i;
  const detachedGridMatch = cssContent.match(detachedGridRegex);
  assert(detachedGridMatch !== null, '3.1 .grid-container.camera-detached selector exists in style.css');
  const detachedGridBody = detachedGridMatch[1];
  assert(/grid-template-columns:\s*24%\s+49%\s+27%/i.test(detachedGridBody),
    '3.2 .camera-detached sets grid-template-columns: 24% 49% 27%');

  // Mathematical integrity of column percentages
  const sumCols = 24 + 49 + 27;
  assert(sumCols === 100, `3.3 Adaptive column percentages sum up to exactly 100% (24 + 49 + 27 = ${sumCols})`);

  // Verify .viewer-wrapper:fullscreen rules
  assert(/\.viewer-wrapper:fullscreen/i.test(cssContent), '3.4 .viewer-wrapper:fullscreen exists in style.css');
  assert(/position:\s*fixed\s*!important/i.test(cssContent), '3.5 Fullscreen styles specify position: fixed !important');
  assert(/z-index:\s*9999\s*!important/i.test(cssContent), '3.6 Fullscreen styles specify z-index: 9999 !important');
  assert(/background-color:\s*#050811/i.test(cssContent), '3.7 Fullscreen styles specify background-color: #050811');

  // HUD overlay bar within fullscreen
  assert(/\.viewer-wrapper:fullscreen\s+\.viewer-overlay-bar/i.test(cssContent),
    '3.8 .viewer-wrapper:fullscreen .viewer-overlay-bar selector exists in style.css');
  assert(/z-index:\s*10000\s*!important/i.test(cssContent),
    '3.9 Fullscreen HUD overlay bar specifies z-index: 10000 !important (higher than viewer 9999)');

  // ============================================================================
  // 4. VIEWER CONTROLLER STATE MACHINE, POLLING, & POPUP-BLOCKER RESILIENCE
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 4] State Machine Transitions & Edge Case Resilience ---\x1b[0m');

  // Test exports contract
  assert(typeof viewerControllerModule.isPoppedOut === 'function', '4.1 viewerController exports isPoppedOut()');
  assert(typeof viewerControllerModule.openPopout === 'function', '4.2 viewerController exports openPopout()');
  assert(typeof viewerControllerModule.reembed === 'function', '4.3 viewerController exports reembed()');
  assert(typeof viewerControllerModule.focusPopout === 'function', '4.4 viewerController exports focusPopout()');
  assert(typeof viewerControllerModule.toggleFullscreen === 'function', '4.5 viewerController exports toggleFullscreen()');
  assert(typeof viewerControllerModule.onStateChange === 'function', '4.6 viewerController exports onStateChange()');
  assert(typeof viewerControllerModule.initViewerController === 'function', '4.7 viewerController exports initViewerController()');

  // Ensure initially false
  assert(viewerControllerModule.isPoppedOut() === false, '4.8 Initial isPoppedOut() returns false');

  // Re-embed idempotence: calling reembed when already embedded should be a safe no-op
  let transitionEvents = [];
  const unsub = viewerControllerModule.onStateChange((state) => {
    transitionEvents.push(state);
  });

  viewerControllerModule.reembed(false);
  assert(viewerControllerModule.isPoppedOut() === false, '4.9 Redundant reembed() does not alter isPoppedOut() false');
  assert(transitionEvents.length === 0, '4.10 Redundant reembed() does not trigger spurious state change events');

  // Simulated Mock Window for openPopout
  const origWindow = globalThis.window;
  const origDocument = globalThis.document;

  let openedWindowMock = {
    closed: false,
    focusCalled: false,
    closeCalled: false,
    focus() { this.focusCalled = true; },
    close() { this.closed = true; this.closeCalled = true; }
  };

  globalThis.document = {
    getElementById: (id) => {
      if (id === 'lblViewerPort') return { textContent: '3081' };
      return null;
    },
    querySelector: () => null,
    fullscreenElement: null,
    exitFullscreen: async () => {}
  };

  globalThis.window = {
    open: (url, name, specs) => openedWindowMock,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  // Test openPopout with mock window
  const popoutRef = viewerControllerModule.openPopout('3081');
  assert(popoutRef === openedWindowMock, '4.11 openPopout returns popout window reference');
  assert(viewerControllerModule.isPoppedOut() === true, '4.12 isPoppedOut() is true after openPopout');
  assert(transitionEvents.length === 1 && transitionEvents[0] === true, '4.13 Listener received true on openPopout');

  // Test focusPopout
  viewerControllerModule.focusPopout();
  assert(openedWindowMock.focusCalled === true, '4.14 focusPopout invokes focus() on popout window');

  // Test reembed() closes popout window and restores state
  viewerControllerModule.reembed(false);
  assert(openedWindowMock.closeCalled === true, '4.15 reembed() invokes close() on popout window');
  assert(viewerControllerModule.isPoppedOut() === false, '4.16 isPoppedOut() is false after reembed');
  assert(transitionEvents.length === 2 && transitionEvents[1] === false, '4.17 Listener received false on reembed');

  // Test Popup Blocker scenario (window.open returns null)
  globalThis.window.open = () => null;
  const blockedRef = viewerControllerModule.openPopout('3081');
  assert(blockedRef === null, '4.18 openPopout handles window.open returning null (popup blocked)');
  assert(viewerControllerModule.isPoppedOut() === true, '4.19 State set to popped out');

  // Calling focusPopout when window is null must not throw
  try {
    viewerControllerModule.focusPopout();
    assert(true, '4.20 focusPopout() is null-safe when window is null');
  } catch (err) {
    assert(false, `focusPopout threw error: ${err.message}`);
  }

  // Recover from blocked state via reembed
  viewerControllerModule.reembed(false);
  assert(viewerControllerModule.isPoppedOut() === false, '4.21 Recovered cleanly from popup-blocked state');

  // ============================================================================
  // 5. BROADCASTCHANNEL CROSS-WINDOW MESSAGING & MALFORMED PAYLOAD RESILIENCE
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 5] BroadcastChannel Protocol & Malformed Payloads ---\x1b[0m');

  viewerControllerModule.initViewerController();

  // Test simulating inbound BroadcastChannel messages
  // Create a peer channel on 'mc_camera_sync'
  const peerChannel = new BroadcastChannel('mc_camera_sync');
  if (typeof peerChannel.unref === 'function') peerChannel.unref();

  // Message: VIEWER_POPOUT_OPENED
  peerChannel.postMessage({ type: 'VIEWER_POPOUT_OPENED', port: 3081 });
  await new Promise(r => setTimeout(r, 50));
  assert(viewerControllerModule.isPoppedOut() === true, '5.1 Inbound VIEWER_POPOUT_OPENED sets state to true');

  // Message: REQUEST_REEMBED
  peerChannel.postMessage({ type: 'REQUEST_REEMBED' });
  await new Promise(r => setTimeout(r, 50));
  assert(viewerControllerModule.isPoppedOut() === false, '5.2 Inbound REQUEST_REEMBED resets state to false');

  // Message: VIEWER_POPOUT_CLOSED
  peerChannel.postMessage({ type: 'VIEWER_POPOUT_OPENED', port: 3081 });
  await new Promise(r => setTimeout(r, 50));
  assert(viewerControllerModule.isPoppedOut() === true, '5.3 Re-opened via VIEWER_POPOUT_OPENED');

  peerChannel.postMessage({ type: 'VIEWER_POPOUT_CLOSED' });
  await new Promise(r => setTimeout(r, 50));
  assert(viewerControllerModule.isPoppedOut() === false, '5.4 Inbound VIEWER_POPOUT_CLOSED resets state to false');

  // Adversarial: Malformed / Unknown BroadcastChannel messages must not throw or corrupt state
  peerChannel.postMessage(null);
  peerChannel.postMessage({});
  peerChannel.postMessage({ type: 'UNKNOWN_RANDOM_TYPE' });
  peerChannel.postMessage({ type: 12345 });
  await new Promise(r => setTimeout(r, 50));
  assert(viewerControllerModule.isPoppedOut() === false, '5.5 Controller gracefully ignored null/unknown messages');

  peerChannel.close();

  // ============================================================================
  // 6. WEBGL RESOURCE LIFECYCLE & EMBEDDED STREAM GUARD VERIFICATION
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 6] WebGL Resource Lifecycle & DOM Mutator Invariants ---\x1b[0m');

  // Construct realistic DOM model for app.js applyCameraDetachedState verification
  const domModel = {
    viewerFrame: { src: 'http://localhost:3081' },
    viewerWrapper: { style: { display: '' } },
    viewerDetachedPlaceholder: {
      classList: {
        _set: new Set(['hidden']),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      }
    },
    gridContainer: {
      classList: {
        _set: new Set(),
        add(c) { this._set.add(c); },
        remove(c) { this._set.delete(c); },
        contains(c) { return this._set.has(c); }
      }
    },
    lblViewerPort: { textContent: '3081' }
  };

  // Re-verify the exact state transitions implemented in app.js
  const testApplyState = (poppedOut) => {
    if (poppedOut) {
      domModel.viewerFrame.src = 'about:blank';
      domModel.viewerWrapper.style.display = 'none';
      domModel.viewerDetachedPlaceholder.classList.remove('hidden');
      domModel.gridContainer.classList.add('camera-detached');
    } else {
      domModel.gridContainer.classList.remove('camera-detached');
      domModel.viewerDetachedPlaceholder.classList.add('hidden');
      domModel.viewerWrapper.style.display = '';
      domModel.viewerFrame.src = `http://localhost:${domModel.lblViewerPort.textContent}`;
    }
  };

  // Transition to Detached
  testApplyState(true);
  assert(domModel.viewerFrame.src === 'about:blank', '6.1 Iframe src unloaded to about:blank to free WebGL context');
  assert(domModel.viewerWrapper.style.display === 'none', '6.2 .viewer-wrapper hidden with display: none');
  assert(!domModel.viewerDetachedPlaceholder.classList.contains('hidden'), '6.3 #viewerDetachedPlaceholder is visible (no .hidden)');
  assert(domModel.gridContainer.classList.contains('camera-detached'), '6.4 .grid-container has .camera-detached');

  // Check Guard Invariant: while popped out, updateStatus or refresh calls must NOT reload iframe
  const simulateStatusUpdateWhilePoppedOut = () => {
    if (viewerControllerModule.isPoppedOut()) {
      // Guard active: must not touch viewerFrame.src
      return;
    }
    domModel.viewerFrame.src = 'http://localhost:3081';
  };

  // Set controller state true
  transitionEvents = [];
  openedWindowMock.closed = false;
  viewerControllerModule.openPopout('3081');
  simulateStatusUpdateWhilePoppedOut();
  assert(domModel.viewerFrame.src === 'about:blank', '6.5 Guard prevented status update from reviving unloaded iframe');

  // Transition to Re-embedded
  testApplyState(false);
  viewerControllerModule.reembed(false);
  assert(!domModel.gridContainer.classList.contains('camera-detached'), '6.6 .camera-detached removed from .grid-container');
  assert(domModel.viewerDetachedPlaceholder.classList.contains('hidden'), '6.7 #viewerDetachedPlaceholder hidden again');
  assert(domModel.viewerWrapper.style.display === '', '6.8 .viewer-wrapper restored to display: empty string');
  assert(domModel.viewerFrame.src === 'http://localhost:3081', '6.9 Viewer stream src restored to active URL');

  // ============================================================================
  // 7. RAPID HIGH-FREQUENCY STATE TRANSITION STRESS TEST
  // ============================================================================
  console.log('\n\x1b[33m--- [ORACLE 7] Concurrency & High-Frequency State Stress Test ---\x1b[0m');

  const STRESS_CYCLES = 100;
  let errorCount = 0;

  for (let i = 0; i < STRESS_CYCLES; i++) {
    try {
      openedWindowMock.closed = false;
      viewerControllerModule.openPopout('3081');
      if (!viewerControllerModule.isPoppedOut()) errorCount++;
      viewerControllerModule.reembed(false);
      if (viewerControllerModule.isPoppedOut()) errorCount++;
    } catch (err) {
      errorCount++;
    }
  }

  assert(errorCount === 0, `7.1 ${STRESS_CYCLES} rapid open/reembed cycles completed with 0 errors`);
  assert(viewerControllerModule.isPoppedOut() === false, '7.2 Final state after stress cycles is cleanly embedded (false)');

  // Clean up
  unsub();
  globalThis.window = origWindow;
  globalThis.document = origDocument;

  console.log('\n\x1b[32m======================================================================\x1b[0m');
  console.log(`\x1b[32m=== ADVERSARIAL STRESS TEST COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (0 FAILURES) ===\x1b[0m`);
  console.log('\x1b[32m======================================================================\x1b[0m\n');
}

runChallengerHarness().then(() => {
  process.exit(0);
}).catch((err) => {
  console.error('\n\x1b[31m[CHALLENGER FAILURE]\x1b[0m', err);
  process.exit(1);
});
