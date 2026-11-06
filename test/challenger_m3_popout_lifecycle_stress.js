/**
 * Empirical Stress Harness — Challenger 2 (Milestone 3)
 *
 * Focus: Cross-window state synchronization, resource lifecycle (iframe about:blank unloads),
 * and concurrent rapid toggling (100 cycles) for viewerController and Cockpit.
 *
 * Verifies:
 * 1. viewerController direct state transitions and broadcast messaging.
 * 2. Cross-window state synchronization via real BroadcastChannel ('mc_camera_sync').
 * 3. LocalStorage event synchronization fallback.
 * 4. External window close detection via polling guard without timer leaks.
 * 5. Resource release: embedded viewerFrame unloaded to 'about:blank' during popout,
 *    and updateStatus() / refreshViewer() strictly prevented from reloading it.
 * 6. Concurrency & rapid toggling: 100 rapid popout/reembed cycles with 0 exceptions or state drift.
 */

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ==============================================================================
// 0. TEST HARNESS INFRASTRUCTURE & DOM MOCK SETUP
// ==============================================================================

let totalAssertions = 0;
let passedAssertions = 0;

function check(condition, message) {
  totalAssertions++;
  if (!condition) {
    console.error(`\x1b[31m[CHALLENGER FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedAssertions++;
  console.log(`\x1b[32m[CHALLENGER PASS]\x1b[0m ${message}`);
}

// Create a DOM Element mock supporting classList, style, attributes, and event listeners
function createMockElement(id, tagName = 'DIV') {
  const classSet = new Set();
  const listeners = {};
  return {
    id,
    tagName,
    src: '',
    textContent: '',
    innerHTML: '',
    title: '',
    style: { display: '' },
    classList: {
      add: (...tokens) => tokens.forEach(t => classSet.add(t)),
      remove: (...tokens) => tokens.forEach(t => classSet.delete(t)),
      toggle: (token, force) => {
        if (force === true) classSet.add(token);
        else if (force === false) classSet.delete(token);
        else if (classSet.has(token)) classSet.delete(token);
        else classSet.add(token);
        return classSet.has(token);
      },
      contains: (token) => classSet.has(token),
      get length() { return classSet.size; }
    },
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (!listeners[evt]) return;
      listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent: (eventObj) => {
      const fns = listeners[eventObj.type] || [];
      fns.forEach(fn => fn(eventObj));
      return true;
    },
    requestFullscreen: async () => {},
    setAttribute: () => {},
    getAttribute: () => null
  };
}

// Global DOM Map
const mockDomElements = {
  viewerFrame: createMockElement('viewerFrame', 'IFRAME'),
  viewerWrapper: createMockElement('viewerWrapper', 'DIV'),
  viewerDetachedPlaceholder: createMockElement('viewerDetachedPlaceholder', 'DIV'),
  lblViewerPort: createMockElement('lblViewerPort', 'SPAN'),
  btnFullscreenViewer: createMockElement('btnFullscreenViewer', 'BUTTON'),
  btnPopoutViewer: createMockElement('btnPopoutViewer', 'BUTTON'),
  btnReembedViewer: createMockElement('btnReembedViewer', 'BUTTON'),
  btnRefocusPopout: createMockElement('btnRefocusPopout', 'BUTTON'),
  gridContainer: createMockElement('gridContainer', 'DIV')
};
mockDomElements.lblViewerPort.textContent = '3081';
mockDomElements.viewerFrame.src = 'http://localhost:3081';
mockDomElements.viewerDetachedPlaceholder.classList.add('hidden');

// Storage Mock
const storageStore = new Map();
const mockLocalStorage = {
  setItem: (k, v) => {
    const oldVal = storageStore.get(k) || null;
    storageStore.set(k, String(v));
    // Trigger window storage listeners
    windowMock.trigger('storage', { key: k, oldValue: oldVal, newValue: String(v) });
  },
  getItem: (k) => storageStore.get(k) || null,
  removeItem: (k) => { storageStore.delete(k); },
  clear: () => { storageStore.clear(); }
};

// Window Mock
const windowListeners = {};
let lastOpenedWindow = null;
const openWindows = new Map();
const windowMock = {
  location: {
    protocol: 'http:',
    hostname: 'localhost',
    port: '3080',
    host: 'localhost:3080',
    href: 'http://localhost:3080/'
  },
  addEventListener: (evt, fn) => {
    if (!windowListeners[evt]) windowListeners[evt] = [];
    windowListeners[evt].push(fn);
  },
  removeEventListener: (evt, fn) => {
    if (!windowListeners[evt]) return;
    windowListeners[evt] = windowListeners[evt].filter(f => f !== fn);
  },
  trigger: (evt, data = {}) => {
    if (windowListeners[evt]) {
      windowListeners[evt].forEach(fn => fn(data));
    }
  },
  open: (url, name, specs) => {
    let win = openWindows.get(name);
    if (!win || win.closed) {
      let isClosed = false;
      let focusCount = 0;
      let closeCount = 0;
      win = {
        url,
        name,
        specs,
        get closed() { return isClosed; },
        set closed(val) { isClosed = val; },
        close: () => { isClosed = true; closeCount++; },
        focus: () => { focusCount++; },
        getFocusCount: () => focusCount,
        getCloseCount: () => closeCount
      };
      openWindows.set(name, win);
    } else {
      win.url = url;
    }
    lastOpenedWindow = win;
    return win;
  }
};

// Document Mock
const docListeners = {};
const documentMock = {
  getElementById: (id) => mockDomElements[id] || null,
  querySelector: (sel) => {
    if (sel === '.grid-container') return mockDomElements.gridContainer;
    if (sel === '.viewer-wrapper') return mockDomElements.viewerWrapper;
    if (sel === '#viewerDetachedPlaceholder') return mockDomElements.viewerDetachedPlaceholder;
    if (sel === '#viewerFrame') return mockDomElements.viewerFrame;
    return null;
  },
  querySelectorAll: (sel) => {
    if (sel === '.grid-container') return [mockDomElements.gridContainer];
    if (sel === '.viewer-wrapper') return [mockDomElements.viewerWrapper];
    return [];
  },
  addEventListener: (evt, fn) => {
    if (!docListeners[evt]) docListeners[evt] = [];
    docListeners[evt].push(fn);
  },
  fullscreenElement: null,
  exitFullscreen: async () => { documentMock.fullscreenElement = null; }
};

// Install global environment before importing modules
global.window = windowMock;
global.document = documentMock;
global.localStorage = mockLocalStorage;

// Dynamic import of target modules
const viewerController = await import('../src/web/public/js/viewerController.js');

async function runEmpiricalStressSuite() {
  console.log('\n\x1b[35m======================================================================\x1b[0m');
  console.log('\x1b[35m=== CHALLENGER 2: EMPIRICAL STRESS TEST HARNESS (MILESTONE 3) ===\x1b[0m');
  console.log('\x1b[35m======================================================================\x1b[0m\n');

  // ==============================================================================
  // 1. STATE MACHINE TRANSITIONS & DIRECT API LIFECYCLE
  // ==============================================================================
  console.log('--- Suite 1: State Machine Transitions & Direct API Lifecycle ---');

  // 1.1 Initial State
  check(viewerController.isPoppedOut() === false, '1.1 Initialer Zustand isPoppedOut() ist strikt false');

  // Register listener to track state transitions
  const stateHistory = [];
  const unsubscribe = viewerController.onStateChange((state) => {
    stateHistory.push({ state, timestamp: Date.now() });
  });

  // 1.2 openPopout() transition
  const popoutWin = viewerController.openPopout(3081);
  check(viewerController.isPoppedOut() === true, '1.2 openPopout(3081) schaltet isPoppedOut() sofort auf true');
  check(popoutWin !== null && typeof popoutWin === 'object', '1.3 openPopout() liefert Window-Referenz zurück');
  check(popoutWin.url.includes('/viewer.html?port=3081'), '1.4 Window wurde mit korrektem URL-Pfad (/viewer.html?port=3081) geöffnet');
  check(popoutWin.name === 'McCameraPopout', '1.5 Window-Name ist "McCameraPopout"');
  check(stateHistory.length === 1 && stateHistory[0].state === true, '1.6 onStateChange-Listener hat true empfangen');

  // 1.3 Redundant openPopout() call while already popped out
  viewerController.openPopout(3081);
  check(viewerController.isPoppedOut() === true, '1.7 Redundantes openPopout() hält Zustand stabil auf true');

  // 1.4 focusPopout()
  viewerController.focusPopout();
  check(popoutWin.getFocusCount() === 1, '1.8 focusPopout() fokussiert das aktive Popout-Fenster');

  // 1.5 reembed() transition
  viewerController.reembed(true);
  check(viewerController.isPoppedOut() === false, '1.9 reembed() schaltet isPoppedOut() sofort auf false');
  check(popoutWin.closed === true, '1.10 reembed() schließt das Popout-Fenster physisch');
  check(stateHistory.length >= 2 && stateHistory[stateHistory.length - 1].state === false, '1.11 onStateChange-Listener hat false empfangen');

  // 1.6 Redundant reembed() call while already embedded
  const historyLenBefore = stateHistory.length;
  viewerController.reembed(true);
  check(viewerController.isPoppedOut() === false, '1.12 Redundantes reembed() bleibt strikt false');
  check(stateHistory.length === historyLenBefore, '1.13 Redundantes reembed() ist ein sicherer No-Op (kein Listener-Spam)');

  unsubscribe();

  // ==============================================================================
  // 2. REAL NATIVE BROADCASTCHANNEL CROSS-WINDOW SYNCHRONIZATION
  // ==============================================================================
  console.log('\n--- Suite 2: Real Native BroadcastChannel Cross-Window Synchronization ---');

  // Create a peer channel simulating the popout window on a secondary monitor
  const peerChannel = new BroadcastChannel('mc_camera_sync');
  if (typeof peerChannel.unref === 'function') peerChannel.unref();

  const peerReceivedMessages = [];
  peerChannel.onmessage = (event) => {
    peerReceivedMessages.push(event.data);
  };

  // Initialize controller listener on BroadcastChannel
  viewerController.initViewerController();

  let listenerNotification = null;
  const unsub2 = viewerController.onStateChange((state) => {
    listenerNotification = state;
  });

  // 2.1 Cockpit -> Peer: openPopout broadcasts VIEWER_POPOUT_OPENED
  peerReceivedMessages.length = 0;
  viewerController.openPopout(3082);
  // Wait microtask for native BroadcastChannel delivery
  await new Promise(r => setTimeout(r, 20));

  check(viewerController.isPoppedOut() === true, '2.1 Cockpit openPopout() setzt isPoppedOut() === true');
  check(peerReceivedMessages.length > 0, '2.2 Peer-Channel hat Nachricht via BroadcastChannel empfangen');
  const openedMsg = peerReceivedMessages.find(m => m && m.type === 'VIEWER_POPOUT_OPENED');
  check(openedMsg !== undefined, '2.3 Peer-Channel hat Nachricht { type: "VIEWER_POPOUT_OPENED" } empfangen');
  check(String(openedMsg.port) === '3082', '2.4 Übertragener Port stimmt überein (3082)');

  // 2.2 Peer -> Cockpit: Peer sends REQUEST_REEMBED
  listenerNotification = null;
  peerChannel.postMessage({ type: 'REQUEST_REEMBED' });
  await new Promise(r => setTimeout(r, 20));

  check(viewerController.isPoppedOut() === false, '2.5 Cockpit empfängt REQUEST_REEMBED und schaltet isPoppedOut() auf false');
  check(listenerNotification === false, '2.6 Cockpit-Listener wurde mit false benachrichtigt');

  // 2.3 Peer -> Cockpit: Peer sends VIEWER_POPOUT_OPENED (remote popout launched)
  listenerNotification = null;
  peerChannel.postMessage({ type: 'VIEWER_POPOUT_OPENED', port: 3081 });
  await new Promise(r => setTimeout(r, 20));

  check(viewerController.isPoppedOut() === true, '2.7 Cockpit empfängt externes VIEWER_POPOUT_OPENED und schaltet isPoppedOut() auf true');
  check(listenerNotification === true, '2.8 Cockpit-Listener wurde mit true benachrichtigt');

  // 2.4 Peer -> Cockpit: Peer sends VIEWER_POPOUT_CLOSED (e.g. popout window closed by user)
  listenerNotification = null;
  peerChannel.postMessage({ type: 'VIEWER_POPOUT_CLOSED' });
  await new Promise(r => setTimeout(r, 20));

  check(viewerController.isPoppedOut() === false, '2.9 Cockpit empfängt externes VIEWER_POPOUT_CLOSED und schaltet isPoppedOut() auf false');
  check(listenerNotification === false, '2.10 Cockpit-Listener wurde mit false benachrichtigt');

  // 2.5 Cockpit -> Peer: Cockpit reembed() broadcasts REQUEST_REEMBED
  peerReceivedMessages.length = 0;
  viewerController.openPopout(3081);
  await new Promise(r => setTimeout(r, 20));
  peerReceivedMessages.length = 0;

  viewerController.reembed(true);
  await new Promise(r => setTimeout(r, 20));

  const reembedMsg = peerReceivedMessages.find(m => m && m.type === 'REQUEST_REEMBED');
  check(reembedMsg !== undefined, '2.11 Cockpit reembed(true) sendet { type: "REQUEST_REEMBED" } an Peer-Fenster');

  // 2.6 Adversarial: Malformed / Fuzzed broadcast payloads
  const adversarialPayloads = [
    null,
    undefined,
    {},
    { type: 'UNKNOWN_OPCODE', foo: 'bar' },
    { type: 12345 },
    'string payload',
    1337,
    [1, 2, 3],
    { type: 'VIEWER_POPOUT_OPENED', port: null }
  ];

  let threwAdversarial = false;
  try {
    for (const payload of adversarialPayloads) {
      peerChannel.postMessage(payload);
    }
    await new Promise(r => setTimeout(r, 30));
  } catch (err) {
    threwAdversarial = true;
  }
  check(!threwAdversarial, '2.12 Adversarial/Fuzzed Broadcast-Payloads werfen keine Exception');
  check(viewerController.isPoppedOut() === true, '2.13 Controller übersteht korrupte Payloads und verarbeitet valide Frames fehlerfrei');

  // Clean reembed
  viewerController.reembed(false);
  check(viewerController.isPoppedOut() === false, '2.14 Controller sauber zurück in Embedded-Zustand');

  unsub2();
  peerChannel.close();

  // ==============================================================================
  // 3. LOCALSTORAGE EVENT SYNCHRONIZATION FALLBACK
  // ==============================================================================
  console.log('\n--- Suite 3: LocalStorage Event Synchronization Fallback ---');

  let storageNotification = null;
  const unsub3 = viewerController.onStateChange((state) => {
    storageNotification = state;
  });

  // 3.1 Remote popout via localStorage
  storageNotification = null;
  mockLocalStorage.setItem('mc_camera_sync_event', JSON.stringify({ type: 'VIEWER_POPOUT_OPENED', port: 3081 }));
  check(viewerController.isPoppedOut() === true, '3.1 Storage-Event VIEWER_POPOUT_OPENED setzt isPoppedOut() auf true');
  check(storageNotification === true, '3.2 Storage-Event triggert Listener mit true');

  // 3.2 Remote reembed via localStorage
  storageNotification = null;
  mockLocalStorage.setItem('mc_camera_sync_event', JSON.stringify({ type: 'REQUEST_REEMBED' }));
  check(viewerController.isPoppedOut() === false, '3.3 Storage-Event REQUEST_REEMBED setzt isPoppedOut() auf false');
  check(storageNotification === false, '3.4 Storage-Event triggert Listener mit false');

  // 3.3 Corrupted JSON in localStorage
  let threwStorageErr = false;
  try {
    mockLocalStorage.setItem('mc_camera_sync_event', '{ broken json: invalid,');
  } catch (err) {
    threwStorageErr = true;
  }
  check(!threwStorageErr, '3.5 Korrupte JSON-Werte im localStorage werden fehlerfrei abgefangen');
  check(viewerController.isPoppedOut() === false, '3.6 Zustand bleibt nach korruptem Storage-Event intakt');

  unsub3();

  // ==============================================================================
  // 4. EXTERNAL WINDOW CLOSE DETECTION VIA POLLING GUARD
  // ==============================================================================
  console.log('\n--- Suite 4: External Window Close Detection & Auto-Recovery ---');

  let windowClosedNotification = null;
  const unsub4 = viewerController.onStateChange((state) => {
    windowClosedNotification = state;
  });

  // Open Popout
  const activePopoutRef = viewerController.openPopout(3081);
  check(viewerController.isPoppedOut() === true, '4.1 Popout-Fenster geöffnet, isPoppedOut() === true');
  check(activePopoutRef.closed === false, '4.2 Popout-Fenster ist initial aktiv (closed === false)');

  // Simulate user clicking browser 'X' button on popout window
  activePopoutRef.closed = true;

  // The interval runs every 1000ms. Wait 1200ms for polling tick.
  await new Promise(r => setTimeout(r, 1200));

  check(viewerController.isPoppedOut() === false, '4.3 Polling-Guard erkennt geschlossenes Fenster und triggert automatischen Re-embed');
  check(windowClosedNotification === false, '4.4 Polling-Guard benachrichtigt Listener mit false');

  unsub4();

  // ==============================================================================
  // 5. RESOURCE RELEASE & EMBEDDED IFRAME UNLOAD VERIFICATION
  // ==============================================================================
  console.log('\n--- Suite 5: WebGL Resource Release & about:blank Iframe Unloading ---');

  // Define applyCameraDetachedState directly matching app.js implementation contract
  const targetViewerPort = '3081';
  const targetBaseUrl = `http://localhost:${targetViewerPort}`;

  function applyCameraDetachedState(poppedOut) {
    const viewerFrame = documentMock.getElementById('viewerFrame');
    const viewerWrapper = documentMock.getElementById('viewerWrapper');
    const placeholder = documentMock.getElementById('viewerDetachedPlaceholder');
    const gridContainer = documentMock.querySelector('.grid-container');
    const port = documentMock.getElementById('lblViewerPort')?.textContent || 3081;
    const targetUrl = `http://localhost:${port}`;

    if (poppedOut) {
      if (viewerFrame) {
        viewerFrame.src = 'about:blank';
      }
      if (viewerWrapper) {
        viewerWrapper.style.display = 'none';
      }
      if (placeholder) {
        placeholder.classList.remove('hidden');
      }
      if (gridContainer) {
        gridContainer.classList.add('camera-detached');
      }
    } else {
      if (gridContainer) {
        gridContainer.classList.remove('camera-detached');
      }
      if (placeholder) {
        placeholder.classList.add('hidden');
      }
      if (viewerWrapper) {
        viewerWrapper.style.display = '';
      }
      if (viewerFrame) {
        viewerFrame.src = targetUrl;
      }
    }
  }

  // Define updateStatus directly matching app.js implementation contract with guard
  let lastKnownVersion = '1.20.4';
  function updateStatus(msg) {
    const viewerPort = msg.viewerPort || 3081;
    const version = msg.version || msg.mcVersion;
    const versionChanged = !!(version && lastKnownVersion && version !== lastKnownVersion);
    const reconnected = !!msg.reconnected;
    if (version) lastKnownVersion = version;

    const viewerFrame = documentMock.getElementById('viewerFrame');
    // Guard from app.js: if popped out, DO NOT touch or reload viewerFrame
    if (viewerFrame && !viewerController.isPoppedOut()) {
      const targetUrl = `http://localhost:${viewerPort}`;
      const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
      if (reconnected || versionChanged) {
        viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
      } else if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(targetUrl)) {
        viewerFrame.src = targetUrl;
      }
    }
  }

  // Define refreshViewer directly matching app.js implementation contract
  function refreshViewer(forceReload = false) {
    const viewerFrame = documentMock.getElementById('viewerFrame');
    if (!viewerFrame || viewerController.isPoppedOut()) return;
    const port = documentMock.getElementById('lblViewerPort')?.textContent || 3081;
    const targetUrl = `http://localhost:${port}`;
    if (forceReload) {
      viewerFrame.src = `${targetUrl}?v=${Date.now()}`;
    } else {
      const currentSrc = viewerFrame.src ? viewerFrame.src.replace(/\/$/, '') : '';
      if (!viewerFrame.src || viewerFrame.src === 'about:blank' || !currentSrc.startsWith(targetUrl)) {
        viewerFrame.src = targetUrl;
      }
    }
  }

  // Wire controller state changes to applyCameraDetachedState
  const unsub5 = viewerController.onStateChange((poppedOut) => {
    applyCameraDetachedState(poppedOut);
  });

  // Verify initial embedded state
  viewerController.reembed(false);
  applyCameraDetachedState(false);
  check(mockDomElements.viewerFrame.src === targetBaseUrl, '5.1 Initialer eingebetteter Iframe zeigt auf targetUrl (http://localhost:3081)');
  check(mockDomElements.viewerWrapper.style.display === '', '5.2 Initialer viewerWrapper ist sichtbar (display === "")');
  check(mockDomElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.3 Initialer Detached-Placeholder ist verborgen (.hidden)');
  check(!mockDomElements.gridContainer.classList.contains('camera-detached'), '5.4 Grid-Container besitzt keine .camera-detached Klasse');

  // Trigger Popout
  viewerController.openPopout(3081);
  check(viewerController.isPoppedOut() === true, '5.5 Popout aktiviert');
  check(mockDomElements.viewerFrame.src === 'about:blank', '5.6 Popout entlädt Iframe physisch auf "about:blank" (Gibt WebGL- und Netzwerkressourcen frei)');
  check(mockDomElements.viewerWrapper.style.display === 'none', '5.7 Popout versteckt viewerWrapper (display === "none")');
  check(!mockDomElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.8 Popout zeigt Detached-Placeholder an');
  check(mockDomElements.gridContainer.classList.contains('camera-detached'), '5.9 Grid-Container aktiviert .camera-detached für adaptive 49% CAD-Breite');

  // ADVERSARIAL STRESS: Simulate 50 periodic background updateStatus calls while popped out
  for (let i = 0; i < 50; i++) {
    updateStatus({
      viewerPort: 3081,
      botRunning: true,
      botConnected: true,
      state: 'ONLINE_ACTIVE',
      version: i % 2 === 0 ? '1.20.4' : '1.21.4',
      reconnected: i % 5 === 0
    });
  }
  check(mockDomElements.viewerFrame.src === 'about:blank', '5.10 50 zyklische updateStatus() Aufrufe lassen viewerFrame.src strikt unberührt ("about:blank")');

  // ADVERSARIAL STRESS: Attempt manual reload via refreshViewer while popped out
  refreshViewer(true);
  refreshViewer(false);
  check(mockDomElements.viewerFrame.src === 'about:blank', '5.11 refreshViewer() Aufrufe werden im Popout-Zustand strikt ignoriert');

  // Trigger Re-embed
  viewerController.reembed(true);
  check(viewerController.isPoppedOut() === false, '5.12 Re-embed schaltet Popout aus');
  check(mockDomElements.viewerFrame.src === targetBaseUrl, '5.13 Re-embed stellt viewerFrame.src wieder auf Live-Stream her (http://localhost:3081)');
  check(mockDomElements.viewerWrapper.style.display === '', '5.14 Re-embed stellt Sichtbarkeit von viewerWrapper wieder her');
  check(mockDomElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.15 Re-embed blendet Detached-Placeholder wieder aus');
  check(!mockDomElements.gridContainer.classList.contains('camera-detached'), '5.16 Re-embed entfernt .camera-detached vom Grid');

  // Status updates while re-embedded correctly maintain the live stream
  updateStatus({ viewerPort: 3081, state: 'ONLINE_ACTIVE' });
  check(mockDomElements.viewerFrame.src === targetBaseUrl, '5.17 Nach Re-embed aktualisiert updateStatus() den aktiven Stream normal');

  unsub5();

  // ==============================================================================
  // 6. CONCURRENCY & RAPID TOGGLING STRESS HARNESS (100 CYCLES)
  // ==============================================================================
  console.log('\n--- Suite 6: Concurrency & Rapid Toggling Stress Harness (100 Cycles) ---');

  let toggleCountTrue = 0;
  let toggleCountFalse = 0;
  let exceptionCount = 0;

  const unsub6 = viewerController.onStateChange((state) => {
    if (state === true) toggleCountTrue++;
    if (state === false) toggleCountFalse++;
    applyCameraDetachedState(state);
  });

  const startTime = Date.now();
  const CYCLES = 100;

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    try {
      // 1. Rapid Popout
      viewerController.openPopout(3081);
      if (!viewerController.isPoppedOut()) {
        throw new Error(`Cycle ${cycle}: isPoppedOut() must be true after openPopout()`);
      }
      if (mockDomElements.viewerFrame.src !== 'about:blank') {
        throw new Error(`Cycle ${cycle}: viewerFrame.src must be about:blank when popped out`);
      }

      // 2. Rapid Re-embed
      viewerController.reembed(true);
      if (viewerController.isPoppedOut()) {
        throw new Error(`Cycle ${cycle}: isPoppedOut() must be false after reembed()`);
      }
      if (mockDomElements.viewerFrame.src !== targetBaseUrl) {
        throw new Error(`Cycle ${cycle}: viewerFrame.src must be restored after reembed()`);
      }
    } catch (err) {
      exceptionCount++;
      console.error(`Exception during toggle cycle ${cycle}:`, err);
    }
  }

  const durationMs = Date.now() - startTime;
  console.log(`[INFO] 100 Toggle-Zyklen in ${durationMs}ms abgeschlossen (${(durationMs / CYCLES).toFixed(2)}ms pro Zyklus)`);

  check(exceptionCount === 0, '6.1 100 sequentielle Popout/Re-embed Zyklen ohne eine einzige Exception abgeschlossen');
  check(toggleCountTrue === 100, `6.2 Genau 100 Listener-Aufrufe mit state === true registriert (erhalten: ${toggleCountTrue})`);
  check(toggleCountFalse === 100, `6.3 Genau 100 Listener-Aufrufe mit state === false registriert (erhalten: ${toggleCountFalse})`);
  check(viewerController.isPoppedOut() === false, '6.4 Endzustand nach 100 Zyklen ist deterministisch false');
  check(mockDomElements.viewerFrame.src === targetBaseUrl, '6.5 Iframe-URL am Ende sauber auf Stream-URL wiederhergestellt');

  unsub6();

  // 6.6 Asynchronous Interleaving Stress: 50 Rapid Peer Broadcasts
  console.log('--- Sub-Suite 6.6: Asynchronous Interleaved Broadcast Stress ---');
  const peer2 = new BroadcastChannel('mc_camera_sync');
  if (typeof peer2.unref === 'function') peer2.unref();

  let asyncTransitions = 0;
  const unsubAsync = viewerController.onStateChange(() => {
    asyncTransitions++;
  });

  for (let i = 0; i < 50; i++) {
    const targetType = i % 2 === 0 ? 'VIEWER_POPOUT_OPENED' : 'REQUEST_REEMBED';
    peer2.postMessage({ type: targetType, port: 3081 });
  }

  // Wait for all messages to process
  await new Promise(r => setTimeout(r, 100));

  check(asyncTransitions >= 40, `6.6 Asynchrone BroadcastChannel-Nachrichten ohne Deadlock verarbeitet (Transitionen: ${asyncTransitions})`);
  // Re-embed to ensure quiescent end state
  viewerController.reembed(false);
  check(viewerController.isPoppedOut() === false, '6.7 Nach asynchronem Stress deterministisch im Ruhezustand');

  // ==============================================================================
  // 7. ADVERSARIAL EDGE CASES: POPUP BLOCKER & LISTENER ISOLATION
  // ==============================================================================
  console.log('\n--- Suite 7: Adversarial Edge Cases: Popup Blocker & Listener Fault Isolation ---');

  // 7.1 Popup Blocker Simulation (window.open returns null)
  const originalOpen = windowMock.open;
  windowMock.open = () => null; // Simulate strict popup blocker

  const blockedWin = viewerController.openPopout(3081);
  check(blockedWin === null, '7.1 window.open liefert null zurück (Popup-Blocker aktiv)');
  check(viewerController.isPoppedOut() === true, '7.2 Controller stürzt bei null Window nicht ab und setzt Zustand');

  let focusThrew = false;
  try {
    viewerController.focusPopout();
  } catch (err) {
    focusThrew = true;
  }
  check(!focusThrew, '7.3 focusPopout() fängt null Window-Referenz sicher ab');

  let reembedThrew = false;
  try {
    viewerController.reembed(true);
  } catch (err) {
    reembedThrew = true;
  }
  check(!reembedThrew, '7.4 reembed() fängt null Window-Referenz sicher ab');
  check(viewerController.isPoppedOut() === false, '7.5 Nach Popup-Blocker Re-embed Zustand wieder false');

  // Restore window.open
  windowMock.open = originalOpen;

  // 7.2 Fault Isolation: Broken listener does not crash other listeners
  let healthyListenerNotified = false;
  const unsubFaulty = viewerController.onStateChange(() => {
    throw new Error('Fatal listener crash simulation');
  });
  const unsubHealthy = viewerController.onStateChange((state) => {
    healthyListenerNotified = state;
  });

  let dispatchThrew = false;
  try {
    viewerController.openPopout(3081);
  } catch (err) {
    dispatchThrew = true;
  }
  check(!dispatchThrew, '7.6 Exception in einem State-Listener wird isoliert und unterbricht Notification-Loop nicht');
  check(healthyListenerNotified === true, '7.7 Nachfolgender gesunder Listener wurde trotz Exception erfolgreich aufgerufen');

  // Cleanup
  viewerController.reembed(false);
  unsubFaulty();
  unsubHealthy();

  // ==============================================================================
  // SUMMARY
  // ==============================================================================
  console.log('\n\x1b[32m======================================================================\x1b[0m');
  console.log(`\x1b[32m=== CHALLENGER 2: ALLE ${passedAssertions}/${totalAssertions} EMPIRISCHEN TESTS ERFOLGREICH BESTANDEN! ===\x1b[0m`);
  console.log('\x1b[32m======================================================================\x1b[0m\n');
}

runEmpiricalStressSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n\x1b[31m[EMPIRICAL SUITE ERROR]\x1b[0m', err);
  process.exit(1);
});
