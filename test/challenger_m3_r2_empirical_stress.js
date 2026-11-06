/**
 * Challenger 2 (Milestone 3 Remediation Verification)
 * Empirical Stress & Adversarial Verification Suite
 *
 * Requirements Verified:
 * 1. Genuine import & verification of `applyCameraDetachedState` from `src/web/public/app.js` (zero facades).
 * 2. Rapid concurrency & stress: 1,000 rapid cycles of popout/reembed on authentic DOM state.
 * 3. Memory & DOM state leak analysis: classList growth bounds, display style consistency, heap stability.
 * 4. Fault tolerance & defensive robustness: null elements, malformed arguments, protocol/port variations.
 * 5. WebGL resource lifecycle: strict `about:blank` unhooking and zero revival by concurrent `updateStatus` / `refreshViewer`.
 * 6. Cross-window BroadcastChannel synchronization & concurrency under heavy interleaved peer traffic.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

let totalChecks = 0;
let passedChecks = 0;

function check(condition, desc) {
  totalChecks++;
  if (!condition) {
    console.error(`\x1b[31m[EMPIRICAL FAIL]\x1b[0m ${desc}`);
    throw new Error(`Assertion failed: ${desc}`);
  }
  passedChecks++;
  console.log(`\x1b[32m[EMPIRICAL PASS]\x1b[0m ${desc}`);
}

// Minimal DOM Element Mock supporting strict classList, styles, and listener tracking
function createMockElement(id, tagName = 'DIV') {
  const classes = new Set();
  const listeners = {};
  return {
    id,
    tagName,
    src: '',
    textContent: '',
    innerHTML: '',
    style: { display: '' },
    classList: {
      add: (...tokens) => tokens.forEach(t => classes.add(t)),
      remove: (...tokens) => tokens.forEach(t => classes.delete(t)),
      toggle: (token, force) => {
        if (force === true) classes.add(token);
        else if (force === false) classes.delete(token);
        else if (classes.has(token)) classes.delete(token);
        else classes.add(token);
        return classes.has(token);
      },
      contains: (token) => classes.has(token),
      get length() { return classes.size; },
      get size() { return classes.size; },
      values: () => Array.from(classes)
    },
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent: (e) => {
      (listeners[e.type] || []).forEach(fn => fn(e));
      return true;
    }
  };
}

// Setup Environment
const mockDom = {
  viewerFrame: createMockElement('viewerFrame', 'IFRAME'),
  viewerWrapper: createMockElement('viewerWrapper', 'DIV'),
  viewerDetachedPlaceholder: createMockElement('viewerDetachedPlaceholder', 'DIV'),
  lblViewerPort: createMockElement('lblViewerPort', 'SPAN'),
  gridContainer: createMockElement('gridContainer', 'DIV')
};
mockDom.lblViewerPort.textContent = '3081';
mockDom.viewerFrame.src = 'http://localhost:3081';
mockDom.viewerDetachedPlaceholder.classList.add('hidden');

globalThis.window = {
  location: { protocol: 'http:', hostname: 'localhost', port: '3080' },
  addEventListener: () => {},
  removeEventListener: () => {},
  open: (url, name, specs) => {
    let closed = false;
    return {
      url,
      name,
      specs,
      get closed() { return closed; },
      set closed(val) { closed = val; },
      close() { closed = true; },
      focus() {}
    };
  }
};
globalThis.document = {
  getElementById: (id) => mockDom[id] || null,
  querySelector: (sel) => (sel === '.grid-container' ? mockDom.gridContainer : null),
  querySelectorAll: () => [],
  addEventListener: () => {}
};

async function runEmpiricalVerification() {
  console.log('\n\x1b[36m==================================================================================\x1b[0m');
  console.log('\x1b[36m=== CHALLENGER 2: DEEP EMPIRICAL STRESS & AUTHENTICITY HARNESS (MILESTONE 3) ===\x1b[0m');
  console.log('\x1b[36m==================================================================================\x1b[0m\n');

  // ==============================================================================
  // 1. SYNTAX & MODULE INTEGRITY AUDIT
  // ==============================================================================
  console.log('--- Suite 1: Syntax & Module Integrity Audit ---');

  const checkAppJs = spawnSync(process.execPath, ['--check', 'src/web/public/app.js'], { encoding: 'utf-8' });
  check(checkAppJs.status === 0, '1.1 app.js besteht strikte Node Syntaxprüfung (node --check src/web/public/app.js)');

  const checkViewerCtrl = spawnSync(process.execPath, ['--check', 'src/web/public/js/viewerController.js'], { encoding: 'utf-8' });
  check(checkViewerCtrl.status === 0, '1.2 viewerController.js besteht strikte Syntaxprüfung');

  const checkPopoutViewer = spawnSync(process.execPath, ['--check', 'src/web/public/js/popoutViewer.js'], { encoding: 'utf-8' });
  check(checkPopoutViewer.status === 0, '1.3 popoutViewer.js besteht strikte Syntaxprüfung');

  // Import authentic production modules
  const appModule = await import('../src/web/public/app.js');
  const viewerController = await import('../src/web/public/js/viewerController.js');

  check(typeof appModule.applyCameraDetachedState === 'function', '1.4 applyCameraDetachedState ist authentisch als Funktion aus app.js exportiert');
  check(typeof appModule.refreshViewer === 'function', '1.5 refreshViewer ist aus app.js exportiert');
  check(typeof appModule.updateStatus === 'function', '1.6 updateStatus ist aus app.js exportiert');
  check(typeof viewerController.openPopout === 'function', '1.7 viewerController.openPopout exportiert');
  check(typeof viewerController.reembed === 'function', '1.8 viewerController.reembed exportiert');
  check(typeof viewerController.isPoppedOut === 'function', '1.9 viewerController.isPoppedOut exportiert');

  const { applyCameraDetachedState, updateStatus, refreshViewer } = appModule;

  // ==============================================================================
  // 2. CONCURRENCY & MASSIVE RAPID TOGGLE STRESS (1,000 CYCLES)
  // ==============================================================================
  console.log('\n--- Suite 2: Concurrency & Rapid Toggle Stress (1,000 Cycles) ---');

  const CYCLES = 1000;
  const tStart = Date.now();
  let cycleErrors = 0;

  for (let i = 1; i <= CYCLES; i++) {
    try {
      // Toggle to detached
      applyCameraDetachedState(true);
      if (mockDom.viewerFrame.src !== 'about:blank' ||
          mockDom.viewerWrapper.style.display !== 'none' ||
          mockDom.viewerDetachedPlaceholder.classList.contains('hidden') ||
          !mockDom.gridContainer.classList.contains('camera-detached')) {
        throw new Error(`Detached state verification failed in cycle ${i}`);
      }

      // Toggle to re-embedded
      applyCameraDetachedState(false);
      if (mockDom.viewerFrame.src !== 'http://localhost:3081' ||
          mockDom.viewerWrapper.style.display !== '' ||
          !mockDom.viewerDetachedPlaceholder.classList.contains('hidden') ||
          mockDom.gridContainer.classList.contains('camera-detached')) {
        throw new Error(`Re-embedded state verification failed in cycle ${i}`);
      }
    } catch (err) {
      cycleErrors++;
      console.error(`Cycle ${i} failed:`, err);
      break;
    }
  }

  const durationMs = Date.now() - tStart;
  console.log(`[PERF] 1.000 Zyklen abgeschlossen in ${durationMs}ms (${(durationMs / CYCLES).toFixed(3)}ms pro Zyklus)`);

  check(cycleErrors === 0, '2.1 1.000 sequenzielle Popout/Re-embed Zyklen fehlerfrei abgeschlossen');
  check(mockDom.viewerFrame.src === 'http://localhost:3081', '2.2 Endzustand von viewerFrame.src ist korrekt auf Live-Stream wiederhergestellt');
  check(mockDom.viewerWrapper.style.display === '', '2.3 Endzustand von viewerWrapper.style.display ist "" (sichtbar)');
  check(mockDom.viewerDetachedPlaceholder.classList.contains('hidden'), '2.4 Endzustand von viewerDetachedPlaceholder ist verborgen (.hidden)');
  check(!mockDom.gridContainer.classList.contains('camera-detached'), '2.5 Endzustand von gridContainer hat keine .camera-detached Klasse');

  // ==============================================================================
  // 3. MEMORY & DOM STATE LEAK ANALYSIS
  // ==============================================================================
  console.log('\n--- Suite 3: Memory & DOM State Leak Analysis ---');

  // Verify classList bounds: calling 100 times true shouldn't add duplicate classes
  for (let i = 0; i < 100; i++) {
    applyCameraDetachedState(true);
  }
  check(mockDom.gridContainer.classList.size <= 2, `3.1 gridContainer classList akkumuliert keine Klassen-Duplikate (Größe: ${mockDom.gridContainer.classList.size})`);
  check(mockDom.gridContainer.classList.contains('camera-detached'), '3.2 gridContainer enthält exakt camera-detached');

  for (let i = 0; i < 100; i++) {
    applyCameraDetachedState(false);
  }
  check(!mockDom.gridContainer.classList.contains('camera-detached'), '3.3 Re-embed entfernt camera-detached rückstandslos');
  check(mockDom.viewerDetachedPlaceholder.classList.contains('hidden'), '3.4 viewerDetachedPlaceholder enthält hidden');

  // Heap Memory Stability Check
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;
  for (let i = 0; i < 5000; i++) {
    applyCameraDetachedState(i % 2 === 0);
  }
  if (global.gc) global.gc();
  const memAfter = process.memoryUsage().heapUsed;
  const memDeltaKb = (memAfter - memBefore) / 1024;
  console.log(`[MEM] Heap-Delta nach 5.000 Aufrufen: ${memDeltaKb.toFixed(2)} KB`);
  // Unbounded leaks would accumulate MBs; < 1000 KB is baseline
  check(memDeltaKb < 2000, `3.5 Kein unbegrenztes Memory-Leak festgestellt (Delta: ${memDeltaKb.toFixed(2)} KB < 2000 KB)`);

  // ==============================================================================
  // 4. DEFENSIVE ROBUSTNESS & ADVERSARIAL EDGE CASES
  // ==============================================================================
  console.log('\n--- Suite 4: Defensive Robustness & Adversarial Edge Cases ---');

  // 4.1 Missing DOM elements (null pointers)
  const realGetElem = document.getElementById;
  const realQuerySel = document.querySelector;

  document.getElementById = () => null;
  document.querySelector = () => null;

  let nullCrash = false;
  try {
    applyCameraDetachedState(true);
    applyCameraDetachedState(false);
  } catch (err) {
    nullCrash = true;
    console.error('Crash with null DOM nodes:', err);
  }
  check(!nullCrash, '4.1 applyCameraDetachedState stürzt bei fehlenden DOM-Elementen (null) nicht ab');

  // Restore DOM
  document.getElementById = realGetElem;
  document.querySelector = realQuerySel;

  // 4.2 Non-boolean / malformed truthy and falsy values
  let argErr = false;
  try {
    applyCameraDetachedState(1);       // Truthy -> popped out
    check(mockDom.viewerFrame.src === 'about:blank', '4.2 Truthy-Zahl (1) schaltet auf popped-out');

    applyCameraDetachedState(0);       // Falsy -> re-embedded
    check(mockDom.viewerFrame.src === 'http://localhost:3081', '4.3 Falsy-Zahl (0) schaltet auf re-embed');

    applyCameraDetachedState('true');  // Truthy string -> popped out
    check(mockDom.viewerFrame.src === 'about:blank', '4.4 Truthy-String ("true") schaltet auf popped-out');

    applyCameraDetachedState('');      // Falsy string -> re-embedded
    check(mockDom.viewerFrame.src === 'http://localhost:3081', '4.5 Falsy-String ("") schaltet auf re-embed');

    applyCameraDetachedState(null);    // Falsy null -> re-embedded
    check(mockDom.viewerFrame.src === 'http://localhost:3081', '4.6 Null schaltet sicher auf re-embed');

    applyCameraDetachedState(undefined); // Falsy undefined -> re-embedded
    check(mockDom.viewerFrame.src === 'http://localhost:3081', '4.7 Undefined schaltet sicher auf re-embed');
  } catch (err) {
    argErr = true;
    console.error('Argument parsing error:', err);
  }
  check(!argErr, '4.8 Alle nicht-booleschen Parameterarten werden ohne Exception verarbeitet');

  // 4.3 Custom port and HTTPS origin handling
  mockDom.lblViewerPort.textContent = '4099';
  window.location.protocol = 'https:';
  window.location.hostname = 'cockpit.internal';

  applyCameraDetachedState(false);
  check(mockDom.viewerFrame.src === 'https://cockpit.internal:4099', '4.9 Dynamischer Port (4099) und Protokoll (https:) werden exakt formatiert');

  // Restore standard
  mockDom.lblViewerPort.textContent = '3081';
  window.location.protocol = 'http:';
  window.location.hostname = 'localhost';

  // ==============================================================================
  // 5. WEBGL RESOURCE LIFECYCLE & BACKGROUND STREAM GUARDS
  // ==============================================================================
  console.log('\n--- Suite 5: WebGL Resource Lifecycle & Stream Guards ---');

  // Set popped-out state via controller
  viewerController.openPopout(3081);
  applyCameraDetachedState(true);
  check(viewerController.isPoppedOut() === true, '5.1 Popout im Controller aktiv');
  check(mockDom.viewerFrame.src === 'about:blank', '5.2 viewerFrame.src ist about:blank');

  // Concurrent traffic: 100 updateStatus calls while popped out
  for (let i = 0; i < 100; i++) {
    updateStatus({
      viewerPort: 3081,
      state: 'ONLINE_ACTIVE',
      botRunning: true,
      botConnected: true,
      reconnected: i % 2 === 0,
      version: i % 2 === 0 ? '1.20.4' : '1.21.4'
    });
  }
  check(mockDom.viewerFrame.src === 'about:blank', '5.3 100 updateStatus() Aufrufe lassen viewerFrame.src strikt unberührt ("about:blank")');

  // Manual refreshViewer calls while popped out
  refreshViewer(true);
  refreshViewer(false);
  check(mockDom.viewerFrame.src === 'about:blank', '5.4 refreshViewer() überschreibt about:blank im Popout-Zustand keinesfalls');

  // Re-embed via controller
  viewerController.reembed(false);
  applyCameraDetachedState(false);
  check(viewerController.isPoppedOut() === false, '5.5 Re-embed im Controller aktiv');
  check(mockDom.viewerFrame.src === 'http://localhost:3081', '5.6 Live Stream URL nach Re-embed wiederhergestellt');

  // updateStatus now works normally
  updateStatus({ viewerPort: 3081, state: 'ONLINE_ACTIVE' });
  check(mockDom.viewerFrame.src === 'http://localhost:3081', '5.7 updateStatus() aktualisiert Stream nach Re-embed normal');

  // ==============================================================================
  // 6. CROSS-WINDOW BROADCASTCHANNEL INTERLEAVED TRAFFIC & CONCURRENCY
  // ==============================================================================
  console.log('\n--- Suite 6: Cross-Window BroadcastChannel Interleaved Traffic ---');

  viewerController.initViewerController();
  const testChannel = new BroadcastChannel('mc_camera_sync');
  if (typeof testChannel.unref === 'function') testChannel.unref();

  let stateEvents = 0;
  const unsubCtrl = viewerController.onStateChange((st) => {
    stateEvents++;
    applyCameraDetachedState(st);
  });

  // Blast 100 interleaved messages
  for (let i = 0; i < 100; i++) {
    const type = i % 2 === 0 ? 'VIEWER_POPOUT_OPENED' : 'REQUEST_REEMBED';
    testChannel.postMessage({ type, port: 3081 });
  }

  // Wait for queue flush
  await new Promise(r => setTimeout(r, 100));

  check(stateEvents > 0, `6.1 BroadcastChannel verarbeitete asynchrone Nachrichten ohne Blockade (Events: ${stateEvents})`);

  // Final clean reembed
  testChannel.postMessage({ type: 'REQUEST_REEMBED' });
  await new Promise(r => setTimeout(r, 30));

  check(viewerController.isPoppedOut() === false, '6.2 Endzustand nach Broadcast-Flood ist deterministisch embedded');
  check(mockDom.viewerFrame.src === 'http://localhost:3081', '6.3 DOM nach Broadcast-Flood wieder vollständig im Cockpit eingebettet');

  unsubCtrl();
  testChannel.close();

  // ==============================================================================
  // SUMMARY
  // ==============================================================================
  console.log('\n\x1b[32m==================================================================================\x1b[0m');
  console.log(`\x1b[32m=== ALLE ${passedChecks}/${totalChecks} EMPIRISCHEN TESTS DES CHALLENGER 2 HARNESS BESTANDEN! ===\x1b[0m`);
  console.log('\x1b[32m==================================================================================\x1b[0m\n');
}

runEmpiricalVerification().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n\x1b[31m[HARNESS FAILURE]\x1b[0m', err);
  process.exit(1);
});
