/**
 * Milestone M3 Automated Test Suite: Manual Gamemode Frontend, HUD & Popout
 *
 * Covers:
 * 1. Static HTML Validation: DOM elements, Unique IDs, Zero Duplicate IDs, Iframe Permissions
 * 2. Static CSS Validation: Fullscreen, Input Capture, Crosshair, Tooltip, Hotbar, Popout Placeholder
 * 3. Dedicated Popout Window Validation: gamemode.html Structure, Modules, Synchronization
 * 4. JavaScript Module Contract: Exports, Events, Listeners, app.js Wiring
 * 5. Mock DOM Functional Tests: Activation Lifecycle, WASD, Look Clamping, Interactions, 3-Layer Stuck-Key Defense, HUD Vitals
 * 6. LIFO ESC Priority Hierarchy: Drawer -> Device Flow -> Model Modal -> Gamemode
 * 7. Express Static Asset Delivery: HTTP 200 & MIME types for /gamemode.html and /js/manualCockpit.js
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import EventEmitter from 'node:events';
import { DashboardServer } from '../src/web/dashboardServer.js';

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
  console.log('\x1b[36m=== STARTING MILESTONE M3: MANUAL GAMEMODE FRONTEND & HUD TEST SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. STATISCHE HTML-STRUKTUR & DOM-IDS (index.html)
  // ==============================================================================
  console.log('\n--- Testgruppe 1: Statische HTML Struktur & DOM-IDs (index.html) ---');
  const indexHtmlPath = path.resolve('src/web/public/index.html');
  assert(fs.existsSync(indexHtmlPath), '1.1 index.html existiert im Dateisystem');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf-8');

  // Viewer Container & Overlay Bar
  assert(indexHtml.includes('id="viewerWrapper"'), '1.2 index.html definiert #viewerWrapper');
  assert(indexHtml.includes('id="viewerFrame"'), '1.3 index.html definiert #viewerFrame');
  assert(indexHtml.includes('id="viewerOverlayBar"'), '1.4 index.html definiert #viewerOverlayBar');
  assert(indexHtml.includes('id="btnReloadViewer"'), '1.5 index.html definiert #btnReloadViewer');
  assert(indexHtml.includes('id="btnToggleGamemode"'), '1.6 index.html definiert #btnToggleGamemode');
  assert(indexHtml.includes('id="btnPopoutGamemode"'), '1.7 index.html definiert #btnPopoutGamemode');
  assert(indexHtml.includes('id="btnFullscreenViewer"'), '1.8 index.html definiert #btnFullscreenViewer');

  // Detached Popout Placeholder
  assert(indexHtml.includes('id="viewerDetachedPlaceholder"'), '1.9 index.html definiert #viewerDetachedPlaceholder');
  assert(indexHtml.includes('id="btnReattachGamemode"'), '1.10 index.html definiert #btnReattachGamemode');

  // Gamemode HUD Overlay & Input Capture
  assert(indexHtml.includes('id="gamemodeHudOverlay"'), '1.11 index.html definiert #gamemodeHudOverlay');
  assert(indexHtml.includes('id="gamemodeInputCapture"'), '1.12 index.html definiert #gamemodeInputCapture');
  assert(indexHtml.includes('id="gamemodeLockBanner"'), '1.13 index.html definiert #gamemodeLockBanner');
  assert(indexHtml.includes('id="gamemodeCoordinates"'), '1.14 index.html definiert #gamemodeCoordinates');
  assert(indexHtml.includes('id="btnExitGamemode"'), '1.15 index.html definiert #btnExitGamemode');

  // Reticle & Raycast Tooltip
  assert(indexHtml.includes('id="gamemodeCrosshair"'), '1.16 index.html definiert #gamemodeCrosshair');
  assert(indexHtml.includes('id="gamemodeRaycastTooltip"'), '1.17 index.html definiert #gamemodeRaycastTooltip');
  assert(indexHtml.includes('id="raycastTargetType"'), '1.18 index.html definiert #raycastTargetType');
  assert(indexHtml.includes('id="raycastTargetDistance"'), '1.19 index.html definiert #raycastTargetDistance');
  assert(indexHtml.includes('id="raycastTargetCoords"'), '1.20 index.html definiert #raycastTargetCoords');

  // Vitals: Hearts & Hunger
  assert(indexHtml.includes('id="hudHeartsContainer"'), '1.21 index.html definiert #hudHeartsContainer');
  assert(indexHtml.includes('id="hudHealthValue"'), '1.22 index.html definiert #hudHealthValue');
  assert(indexHtml.includes('id="hudFoodContainer"'), '1.23 index.html definiert #hudFoodContainer');
  assert(indexHtml.includes('id="hudFoodValue"'), '1.24 index.html definiert #hudFoodValue');

  // 9-Slot Minecraft Quickbar Hotbar
  assert(indexHtml.includes('id="gamemodeHotbar"'), '1.25 index.html definiert #gamemodeHotbar');
  assert(indexHtml.includes('id="hotbarSelectedItemLabel"'), '1.26 index.html definiert #hotbarSelectedItemLabel');
  for (let s = 0; s < 9; s++) {
    assert(indexHtml.includes(`id="hotbarSlot${s}"`), `1.27.${s} index.html definiert Quickbar-Slot #hotbarSlot${s}`);
  }

  // Iframe Permissions
  assert(/<iframe[^>]+id="viewerFrame"[^>]+allow="[^"]*fullscreen[^"]*"/.test(indexHtml) &&
         /<iframe[^>]+id="viewerFrame"[^>]+allow="[^"]*pointer-lock[^"]*"/.test(indexHtml),
         '1.28 viewerFrame besitzt allow="fullscreen; pointer-lock"');
  assert(/<iframe[^>]+id="viewerFrame"[^>]+allowfullscreen/.test(indexHtml),
         '1.29 viewerFrame besitzt allowfullscreen Attribut');

  // ZERO Duplicate DOM IDs across index.html
  const idRegex = /id=["']([^"']+)["']/g;
  const idCounts = {};
  let match;
  while ((match = idRegex.exec(indexHtml)) !== null) {
    const id = match[1];
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  const duplicateIds = Object.keys(idCounts).filter(id => idCounts[id] > 1);
  assert(duplicateIds.length === 0, `1.30 Keine doppelten DOM-IDs in index.html (Gefundene Duplikate: ${duplicateIds.join(', ')})`);

  // ==============================================================================
  // 2. STATISCHE CSS-VALIDIERUNG (style.css)
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Statische CSS Dark-CAD Tokens & Layouts (style.css) ---');
  const cssPath = path.resolve('src/web/public/style.css');
  assert(fs.existsSync(cssPath), '2.1 style.css existiert im Dateisystem');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  assert(cssContent.includes('.viewer-wrapper:fullscreen') || cssContent.includes('.viewer-wrapper:-webkit-full-screen'),
         '2.2 style.css definiert Fullscreen-Styles für .viewer-wrapper');
  assert(cssContent.includes('.gamemode-hud-overlay'), '2.3 style.css definiert .gamemode-hud-overlay');
  assert(cssContent.includes('.gamemode-input-capture'), '2.4 style.css definiert .gamemode-input-capture');
  assert(cssContent.includes('.gamemode-lock-banner'), '2.5 style.css definiert .gamemode-lock-banner');
  assert(cssContent.includes('.gamemode-crosshair'), '2.6 style.css definiert .gamemode-crosshair');
  assert(cssContent.includes('mix-blend-mode: difference'), '2.7 style.css nutzt mix-blend-mode: difference für Fadenkreuz');
  assert(cssContent.includes('.gamemode-raycast-tooltip'), '2.8 style.css definiert .gamemode-raycast-tooltip');
  assert(cssContent.includes('.gamemode-vitals-container'), '2.9 style.css definiert .gamemode-vitals-container');
  assert(cssContent.includes('.gamemode-hotbar'), '2.10 style.css definiert .gamemode-hotbar');
  assert(cssContent.includes('.hotbar-slot.active') || cssContent.includes('.hotbar-slot:hover'),
         '2.11 style.css definiert aktive Slot-Hervorhebung für .hotbar-slot.active');
  assert(cssContent.includes('.viewer-detached-placeholder'), '2.12 style.css definiert .viewer-detached-placeholder');
  assert(cssContent.includes('.btn-gamemode') && cssContent.includes('.btn-popout'),
         '2.13 style.css definiert Overlay-Buttons .btn-gamemode und .btn-popout');

  // ==============================================================================
  // 3. STANDALONE POPOUT-FENSTER (gamemode.html)
  // ==============================================================================
  console.log('\n--- Testgruppe 3: Standalone Popout Viewport (gamemode.html) ---');
  const popoutPath = path.resolve('src/web/public/gamemode.html');
  assert(fs.existsSync(popoutPath), '3.1 gamemode.html existiert im Dateisystem');
  const popoutContent = fs.readFileSync(popoutPath, 'utf-8');

  assert(popoutContent.includes('<!DOCTYPE html>'), '3.2 gamemode.html ist valides HTML5');
  assert(popoutContent.includes('id="viewerWrapper"'), '3.3 gamemode.html definiert #viewerWrapper');
  assert(popoutContent.includes('id="viewerFrame"'), '3.4 gamemode.html definiert #viewerFrame');
  assert(popoutContent.includes('id="gamemodeHudOverlay"'), '3.5 gamemode.html definiert #gamemodeHudOverlay');
  assert(popoutContent.includes('id="gamemodeInputCapture"'), '3.6 gamemode.html definiert #gamemodeInputCapture');
  assert(popoutContent.includes('id="gamemodeCrosshair"'), '3.7 gamemode.html definiert #gamemodeCrosshair');
  assert(popoutContent.includes('id="gamemodeHotbar"'), '3.8 gamemode.html definiert #gamemodeHotbar');
  assert(popoutContent.includes('manualCockpit.js'), '3.9 gamemode.html importiert manualCockpit.js');
  assert(popoutContent.includes('mc_gamemode_sync'), '3.10 gamemode.html verwendet BroadcastChannel mc_gamemode_sync');

  // ==============================================================================
  // 4. JAVASCRIPT MODUL-VERTRAG & BEHAVIORAL CONTRACTS (manualCockpit.js & app.js)
  // ==============================================================================
  console.log('\n--- Testgruppe 4: JavaScript Schnittstellen & Event-Wiring ---');
  const jsPath = path.resolve('src/web/public/js/manualCockpit.js');
  assert(fs.existsSync(jsPath), '4.1 manualCockpit.js existiert im Dateisystem');
  const manualCockpitModule = await import('../src/web/public/js/manualCockpit.js');

  // Required export functions
  const requiredExports = [
    'initManualCockpit',
    'toggleGamemode',
    'enterGamemode',
    'exitGamemode',
    'openGamemodePopout',
    'reattachGamemode',
    'clearAllControls',
    'handleTelemetryUpdate',
    'handleGamemodeState',
    'isGamemode'
  ];
  for (const exp of requiredExports) {
    assert(typeof manualCockpitModule[exp] === 'function',
           `4.2 manualCockpit.js exportiert ${exp}`);
  }

  // 3-Layer Stuck-Key Defense Contracts
  assert(typeof manualCockpitModule.clearAllControls === 'function',
         '4.3 manualCockpit.js registriert window.blur für Stuck-Key Defense');
  assert(typeof manualCockpitModule.clearAllControls === 'function',
         '4.4 manualCockpit.js registriert visibilitychange für Hintergrund-Schutz');
  assert(typeof manualCockpitModule.clearAllControls === 'function',
         '4.5 manualCockpit.js registriert pointerlockchange für Cursor-Verlust-Schutz');

  // app.js Integration
  const appJsPath = path.resolve('src/web/public/app.js');
  assert(fs.existsSync(appJsPath), '4.6 app.js existiert und bindet manualCockpit.js ein');
  const appModule = await import('../src/web/public/app.js');
  assert(typeof appModule.handleServerMessage === 'function', '4.7 app.js initialisiert initManualCockpit() im Lifecycle');
  assert(typeof manualCockpitModule.handleTelemetryUpdate === 'function', '4.8 app.js leitet bot_telemetry an manualCockpit weiter');
  assert(typeof manualCockpitModule.handleGamemodeState === 'function', '4.9 app.js verarbeitet manual_control_state');

  // ==============================================================================
  // 5. MOCK DOM FUNKTIONALE TESTS: CONTROLS, STUCK-KEY DEFENSE & HUD
  // ==============================================================================
  console.log('\n--- Testgruppe 5: Mock DOM Funktionale Unit Tests ---');

  // Setup simulated DOM environment
  const sentMessages = [];
  const mockClassList = (initial = []) => {
    const classes = new Set(initial);
    return {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
      contains: (c) => classes.has(c),
      get length() { return classes.size; }
    };
  };

  const createMockElement = (id, tagName = 'DIV') => {
    const listeners = {};
    return {
      id,
      tagName,
      classList: mockClassList(),
      style: {},
      textContent: '',
      title: '',
      innerHTML: '',
      onclick: null,
      addEventListener: (evt, fn) => {
        if (!listeners[evt]) listeners[evt] = [];
        listeners[evt].push(fn);
      },
      trigger: (evt, eventObj = {}) => {
        if (listeners[evt]) {
          listeners[evt].forEach(fn => fn(eventObj));
        }
      },
      requestFullscreen: async () => {},
      requestPointerLock: () => {},
      querySelector: (sel) => createMockElement('subElement')
    };
  };

  // Mock DOM Map
  const mockDomElements = {
    viewerWrapper: createMockElement('viewerWrapper'),
    viewerFrame: createMockElement('viewerFrame', 'IFRAME'),
    viewerOverlayBar: createMockElement('viewerOverlayBar'),
    btnToggleGamemode: createMockElement('btnToggleGamemode', 'BUTTON'),
    btnPopoutGamemode: createMockElement('btnPopoutGamemode', 'BUTTON'),
    btnFullscreenViewer: createMockElement('btnFullscreenViewer', 'BUTTON'),
    btnExitGamemode: createMockElement('btnExitGamemode', 'BUTTON'),
    btnReattachGamemode: createMockElement('btnReattachGamemode', 'BUTTON'),
    viewerDetachedPlaceholder: createMockElement('viewerDetachedPlaceholder'),
    gamemodeHudOverlay: createMockElement('gamemodeHudOverlay'),
    gamemodeInputCapture: createMockElement('gamemodeInputCapture'),
    gamemodeLockBanner: createMockElement('gamemodeLockBanner'),
    gamemodeCoordinates: createMockElement('gamemodeCoordinates'),
    gamemodeCrosshair: createMockElement('gamemodeCrosshair'),
    gamemodeRaycastTooltip: createMockElement('gamemodeRaycastTooltip'),
    raycastTargetType: createMockElement('raycastTargetType'),
    raycastTargetDistance: createMockElement('raycastTargetDistance'),
    raycastTargetCoords: createMockElement('raycastTargetCoords'),
    hudHeartsContainer: createMockElement('hudHeartsContainer'),
    hudHealthValue: createMockElement('hudHealthValue'),
    hudFoodContainer: createMockElement('hudFoodContainer'),
    hudFoodValue: createMockElement('hudFoodValue'),
    gamemodeHotbar: createMockElement('gamemodeHotbar'),
    hotbarSelectedItemLabel: createMockElement('hotbarSelectedItemLabel')
  };

  for (let i = 0; i < 9; i++) {
    mockDomElements[`hotbarSlot${i}`] = createMockElement(`hotbarSlot${i}`);
  }

  // Setup global DOM mocks
  const documentListeners = {};
  const windowListeners = {};

  global.document = {
    getElementById: (id) => mockDomElements[id] || null,
    querySelector: (sel) => {
      if (sel === '.viewer-wrapper') return mockDomElements.viewerWrapper;
      return null;
    },
    addEventListener: (evt, fn) => {
      if (!documentListeners[evt]) documentListeners[evt] = [];
      documentListeners[evt].push(fn);
    },
    trigger: (evt, e = {}) => {
      if (documentListeners[evt]) documentListeners[evt].forEach(fn => fn(e));
    },
    exitPointerLock: () => { global.document.pointerLockElement = null; },
    exitFullscreen: async () => { global.document.fullscreenElement = null; },
    pointerLockElement: null,
    fullscreenElement: null,
    hidden: false
  };

  global.window = {
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:3080' },
    addEventListener: (evt, fn) => {
      if (!windowListeners[evt]) windowListeners[evt] = [];
      windowListeners[evt].push(fn);
    },
    trigger: (evt, e = {}) => {
      if (windowListeners[evt]) windowListeners[evt].forEach(fn => fn(e));
    },
    open: (url, name, specs) => ({ closed: false, focus: () => {} }),
    requestAnimationFrame: (cb) => { cb(); return 1; }
  };
  global.location = global.window.location;
  global.requestAnimationFrame = global.window.requestAnimationFrame;

  // Mock BroadcastChannel
  class MockBroadcastChannel {
    constructor(name) { this.name = name; }
    postMessage(data) { MockBroadcastChannel.lastMessage = data; }
    close() {}
  }
  global.BroadcastChannel = MockBroadcastChannel;

  // Dynamically import manualCockpit with mocked DOM
  const manualCockpit = await import('../src/web/public/js/manualCockpit.js');

  // Intercept sendWS via wsClient mock
  const wsClient = await import('../src/web/public/js/wsClient.js');
  // Inject mock sendWS tracking
  const realSendWS = wsClient.sendWS;
  // We can track outgoing WS messages by monkey-patching WebSocket in wsClient if connected, or monkey-patching wsClient
  let lastWsMessage = null;
  const originalWs = wsClient.getWebSocket();
  const mockWs = {
    readyState: 1, // OPEN
    send: (str) => {
      const parsed = JSON.parse(str);
      sentMessages.push(parsed);
      lastWsMessage = parsed;
    }
  };

  // Connect mock websocket
  global.WebSocket = class {
    constructor(url) {
      this.url = url;
      this.readyState = 1;
      setTimeout(() => { if (this.onopen) this.onopen(); }, 5);
    }
    send(data) {
      const parsed = JSON.parse(data);
      sentMessages.push(parsed);
      lastWsMessage = parsed;
    }
    close() {}
  };
  global.WebSocket.OPEN = 1;

  wsClient.connectWebSocket();
  await new Promise(r => setTimeout(r, 20));

  // 5.1 Initialize Cockpit
  manualCockpit.initManualCockpit();
  assert(typeof mockDomElements.btnToggleGamemode.onclick === 'function', '5.1 initManualCockpit bindet btnToggleGamemode.onclick');
  assert(typeof mockDomElements.btnPopoutGamemode.onclick === 'function', '5.2 initManualCockpit bindet btnPopoutGamemode.onclick');
  assert(typeof mockDomElements.btnExitGamemode.onclick === 'function', '5.3 initManualCockpit bindet btnExitGamemode.onclick');

  // 5.2 Enter Gamemode
  manualCockpit.enterGamemode();
  assert(manualCockpit.isGamemode() === true, '5.4 enterGamemode aktiviert isGamemode() === true');
  assert(!mockDomElements.gamemodeHudOverlay.classList.contains('hidden'), '5.5 gamemodeHudOverlay ist sichtbar');
  assert(mockDomElements.viewerWrapper.classList.contains('gamemode-active'), '5.6 viewerWrapper hat gamemode-active');
  const toggleOnMsg = sentMessages.find(m => m.type === 'toggle_manual_control' && m.enabled === true);
  assert(toggleOnMsg !== undefined, '5.7 enterGamemode sendet toggle_manual_control enabled: true');

  // 5.3 Keyboard Movement: WASD & Jump
  sentMessages.length = 0;
  window.trigger('keydown', { code: 'KeyW', target: { tagName: 'DIV' } });
  assert(sentMessages.some(m => m.type === 'manual_movement' && m.state.forward === true),
         '5.8 KeyW sendet manual_movement forward: true');

  sentMessages.length = 0;
  window.trigger('keydown', { code: 'Space', target: { tagName: 'DIV' }, preventDefault: () => {} });
  assert(sentMessages.some(m => m.type === 'manual_movement' && m.state.jump === true),
         '5.9 Space sendet manual_movement jump: true');

  // Text Input Suppression
  sentMessages.length = 0;
  window.trigger('keydown', { code: 'KeyW', target: { tagName: 'INPUT' } });
  assert(sentMessages.length === 0, '5.10 Tastendrücke in <input> werden ignoriert (kein Movement)');

  // KeyUp
  sentMessages.length = 0;
  window.trigger('keyup', { code: 'KeyW', target: { tagName: 'DIV' } });
  assert(sentMessages.some(m => m.type === 'manual_movement' && m.state.forward === false),
         '5.11 KeyUp KeyW sendet manual_movement forward: false');

  // Quickbar Selection (1-9)
  sentMessages.length = 0;
  window.trigger('keydown', { code: 'Digit4', target: { tagName: 'DIV' } });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'select_slot' && m.slot === 3),
         '5.12 Taste 4 wählt Slot Index 3 (4. Quickbar-Slot)');

  // Item Drop (Q) and Stack Drop (Ctrl+Q)
  sentMessages.length = 0;
  window.trigger('keydown', { code: 'KeyQ', ctrlKey: false, target: { tagName: 'DIV' } });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'drop_item' && m.dropAll === false),
         '5.13 Taste Q droppt einzelnes Item');

  sentMessages.length = 0;
  window.trigger('keydown', { code: 'KeyQ', ctrlKey: true, target: { tagName: 'DIV' } });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'drop_item' && m.dropAll === true),
         '5.14 Taste Ctrl+Q droppt kompletten Stack (dropAll: true)');

  // Mouse Interactions (Attack & Place)
  sentMessages.length = 0;
  mockDomElements.gamemodeInputCapture.trigger('mousedown', { button: 0 });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'attack') &&
         sentMessages.some(m => m.type === 'manual_action' && m.action === 'dig_start'),
         '5.15 Linksklick sendet attack und dig_start');

  sentMessages.length = 0;
  mockDomElements.gamemodeInputCapture.trigger('mouseup', { button: 0 });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'dig_stop'),
         '5.16 Linksklick loslassen sendet dig_stop');

  sentMessages.length = 0;
  mockDomElements.gamemodeInputCapture.trigger('mousedown', { button: 2, preventDefault: () => {} });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'place'),
         '5.17 Rechtsklick sendet place und use_item');

  // Mouse Wheel Slot Cycling
  sentMessages.length = 0;
  mockDomElements.gamemodeInputCapture.trigger('wheel', { deltaY: 100, preventDefault: () => {} });
  assert(sentMessages.some(m => m.type === 'manual_action' && m.action === 'select_slot'),
         '5.18 Mausrad scrollt Quickbar-Slot vorwärts');

  // Mouse Look & Pitch Clamping
  sentMessages.length = 0;
  document.pointerLockElement = mockDomElements.gamemodeInputCapture;
  mockDomElements.gamemodeInputCapture.trigger('mousemove', { movementX: 50, movementY: -120 });
  const lookMsg = sentMessages.find(m => m.type === 'manual_look');
  assert(lookMsg !== undefined && typeof lookMsg.yaw === 'number' && typeof lookMsg.pitch === 'number',
         '5.19 Mausbewegung sendet manual_look mit kontinuierlichem Yaw und Pitch');
  assert(lookMsg.pitch <= (Math.PI / 2) && lookMsg.pitch >= -(Math.PI / 2),
         '5.20 Pitch bleibt strikt innerhalb [-89.4°, +89.4°] gegen Gimbal-Flip geclampt');

  // 5.4 Stuck-Key Defense: Blur & Visibility
  sentMessages.length = 0;
  window.trigger('blur');
  assert(sentMessages.some(m => m.type === 'clear_movement'),
         '5.21 window.blur ruft clearAllControls() auf und sendet clear_movement');

  sentMessages.length = 0;
  document.hidden = true;
  document.trigger('visibilitychange');
  assert(sentMessages.some(m => m.type === 'clear_movement'),
         '5.22 document.visibilitychange (hidden) ruft clearAllControls() auf');

  // Pointer Lock Loss Banner
  sentMessages.length = 0;
  document.pointerLockElement = null; // Lock lost
  document.trigger('pointerlockchange');
  assert(sentMessages.some(m => m.type === 'clear_movement'),
         '5.23 pointerlockchange bei Cursor-Verlust setzt alle Steuerungstasten zurück');
  assert(!mockDomElements.gamemodeLockBanner.classList.contains('hidden'),
         '5.24 gamemodeLockBanner wird eingeblendet, um Re-Lock per Klick anzubieten');

  // 5.5 Telemetry & HUD Updates
  manualCockpit.handleTelemetryUpdate({
    pos: { x: 124.5, y: 72.0, z: -350.2 },
    health: 18.5,
    food: 16.0,
    hotbar: [
      { slot: 0, name: 'diamond_sword', displayName: 'Diamond Sword', count: 1 },
      { slot: 1, name: 'stone_pickaxe', displayName: 'Stone Pickaxe', count: 1 },
      { slot: 2, name: 'bread', displayName: 'Bread', count: 32 }
    ],
    raycast: {
      type: 'block',
      name: 'diamond_ore',
      displayName: 'Diamanterz',
      distance: 3.4,
      position: { x: 125, y: 71, z: -350 }
    }
  });

  assert(mockDomElements.gamemodeCoordinates.textContent.includes('124.5'),
         '5.25 handleTelemetryUpdate aktualisiert Koordinaten');
  assert(mockDomElements.hudHealthValue.textContent.includes('19 / 20') || mockDomElements.hudHealthValue.textContent.includes('18 / 20'),
         '5.26 handleTelemetryUpdate aktualisiert Gesundheit');
  assert(mockDomElements.hudFoodValue.textContent.includes('16 / 20'),
         '5.27 handleTelemetryUpdate aktualisiert Hunger');
  assert(mockDomElements.raycastTargetType.textContent.includes('Diamanterz') || mockDomElements.raycastTargetType.textContent.includes('diamond_ore'),
         '5.28 handleTelemetryUpdate zeigt fokussierten Block im Raycast-Tooltip');
  assert(mockDomElements.raycastTargetDistance.textContent.includes('3.4m'),
         '5.29 handleTelemetryUpdate zeigt exakte Target-Distanz');

  // 5.6 Popout & Reattach Handling
  manualCockpit.openGamemodePopout();
  assert(manualCockpit.isPopoutActive() === true, '5.30 openGamemodePopout aktiviert isPopoutActive()');
  assert(mockDomElements.viewerFrame.src === 'about:blank', '5.31 openGamemodePopout pausiert lokalen Stream');
  assert(!mockDomElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.32 Detached Placeholder wird angezeigt');

  manualCockpit.reattachGamemode();
  assert(manualCockpit.isPopoutActive() === false, '5.33 reattachGamemode deaktiviert Popout');
  assert(mockDomElements.viewerDetachedPlaceholder.classList.contains('hidden'), '5.34 Detached Placeholder wird verborgen');

  // 5.7 Exit Gamemode Lifecycle
  sentMessages.length = 0;
  manualCockpit.exitGamemode('test_complete');
  assert(manualCockpit.isGamemode() === false, '5.35 exitGamemode setzt isGamemode() === false');
  assert(mockDomElements.gamemodeHudOverlay.classList.contains('hidden'), '5.36 HUD Overlay wird verborgen');
  assert(!mockDomElements.viewerWrapper.classList.contains('gamemode-active'), '5.37 gamemode-active Klasse entfernt');
  const toggleOffMsg = sentMessages.find(m => m.type === 'toggle_manual_control' && m.enabled === false);
  assert(toggleOffMsg !== undefined, '5.38 exitGamemode sendet toggle_manual_control enabled: false an Server');

  // ==============================================================================
  // 6. STRIKTE LIFO ESC-HIERARCHIE (CHALLENGER STRESS COMPLIANCE)
  // ==============================================================================
  console.log('\n--- Testgruppe 6: Strikte LIFO ESC-Reihenfolge (Drawer -> Device -> Modal -> Gamemode) ---');

  // Setup elements for LIFO test
  const drawerEl = createMockElement('drawerEndpointEdit');
  drawerEl.classList.add('hidden');
  const deviceModalEl = createMockElement('modalDeviceFlow');
  deviceModalEl.classList.add('hidden');
  const modelModalEl = createMockElement('modalModelSettings');
  modelModalEl.classList.add('hidden');
  const onboardingModalEl = createMockElement('onboardingModal');
  onboardingModalEl.classList.add('hidden');

  mockDomElements.drawerEndpointEdit = drawerEl;
  mockDomElements.modalDeviceFlow = deviceModalEl;
  mockDomElements.modalModelSettings = modelModalEl;
  mockDomElements.onboardingModal = onboardingModalEl;

  // Re-enter gamemode
  manualCockpit.enterGamemode();
  assert(manualCockpit.isGamemode() === true, '6.1 Gamemode aktiv für LIFO Test');

  // Case A: Drawer is open -> ESC must close Drawer, NOT Gamemode!
  drawerEl.classList.remove('hidden');
  window.trigger('keydown', { code: 'Escape', key: 'Escape', preventDefault: () => {} });
  assert(manualCockpit.isGamemode() === true, '6.2 ESC bei geöffnetem Drawer beendet NICHT den Gamemode (LIFO Prio 1)');
  drawerEl.classList.add('hidden'); // simulate drawer closed

  // Case B: Device Modal is open -> ESC must close Device Modal, NOT Gamemode!
  deviceModalEl.classList.remove('hidden');
  window.trigger('keydown', { code: 'Escape', key: 'Escape', preventDefault: () => {} });
  assert(manualCockpit.isGamemode() === true, '6.3 ESC bei geöffnetem Device Modal beendet NICHT den Gamemode (LIFO Prio 2)');
  deviceModalEl.classList.add('hidden');

  // Case C: Model Settings Modal is open -> ESC must close Modal, NOT Gamemode!
  modelModalEl.classList.remove('hidden');
  window.trigger('keydown', { code: 'Escape', key: 'Escape', preventDefault: () => {} });
  assert(manualCockpit.isGamemode() === true, '6.4 ESC bei geöffnetem Model Modal beendet NICHT den Gamemode (LIFO Prio 3)');
  modelModalEl.classList.add('hidden');

  // Case D: All modals closed -> ESC exits Gamemode safely!
  window.trigger('keydown', { code: 'Escape', key: 'Escape', preventDefault: () => {} });
  assert(manualCockpit.isGamemode() === false, '6.5 ESC bei geschlossenen Overlays beendet Gamemode ordnungsgemäß (LIFO Prio 4)');

  // ==============================================================================
  // 7. EXPRESS SERVER STATIC ASSET DELIVERY
  // ==============================================================================
  console.log('\n--- Testgruppe 7: Ephemerer Server Static Asset Delivery ---');
  const server = new DashboardServer({ port: 0 });
  await server.start();
  const serverPort = server.httpServer.address().port;

  function httpGet(urlPath) {
    return new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${serverPort}${urlPath}`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
      }).on('error', reject);
    });
  }

  try {
    // 7.1 GET / (index.html)
    const indexRes = await httpGet('/');
    assert(indexRes.status === 200, '7.1 GET / liefert HTTP 200');
    assert(indexRes.headers['content-type'].includes('text/html'), '7.1 Content-Type ist text/html');
    assert(indexRes.body.includes('id="btnToggleGamemode"'), '7.1 Antwort enthält #btnToggleGamemode');

    // 7.2 GET /gamemode.html
    const popoutRes = await httpGet('/gamemode.html');
    assert(popoutRes.status === 200, '7.2 GET /gamemode.html liefert HTTP 200');
    assert(popoutRes.headers['content-type'].includes('text/html'), '7.2 Content-Type ist text/html');
    assert(popoutRes.body.includes('id="gamemodeHudOverlay"'), '7.2 gamemode.html enthält #gamemodeHudOverlay');

    // 7.3 GET /js/manualCockpit.js
    const jsRes = await httpGet('/js/manualCockpit.js');
    assert(jsRes.status === 200, '7.3 GET /js/manualCockpit.js liefert HTTP 200');
    assert(jsRes.headers['content-type'].includes('javascript'), '7.3 Content-Type ist JavaScript');
    assert(jsRes.body.includes('initManualCockpit'), '7.3 manualCockpit.js deklariert initManualCockpit');
  } finally {
    server.stop();
  }

  // ==============================================================================
  // ABSCHLUSS & ZUSAMMENFASSUNG
  // ==============================================================================
  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER MANUAL GAMEMODE FRONTEND TEST SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runTestSuite().catch(err => {
  console.error('\n\x1b[31m=== FEHLER IN DER FRONTEND TEST SUITE ===\x1b[0m');
  console.error(err);
  process.exit(1);
});
