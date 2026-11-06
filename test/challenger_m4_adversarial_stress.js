/**
 * Challenger M4: Empirical Adversarial Stress Suite
 * Author: challenger_m4_r4_2 (critic, specialist)
 * Objective: Empirically challenge frontend UI lifecycle, popout synchronization, and decoupled test suites:
 *   1. Popout viewer lifecycle, fullscreen toggling, BroadcastChannel communication.
 *   2. Onboarding wizard and settings modal version chips interaction.
 *   3. Behavioral test decoupling verification (zero fs.readFileSync on app.js).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

let passedTests = 0;
let totalTests = 0;

async function test(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${name}`);
  } catch (err) {
    console.error(`  \x1b[31m[FAIL]\x1b[0m ${name}: ${err.message}`);
    throw err;
  }
}

// Mock DOM elements and environment
function createMockElement(id, tagName = 'DIV') {
  const classes = new Set();
  const listeners = {};
  return {
    id,
    tagName,
    textContent: '',
    value: '',
    style: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
      contains: (c) => classes.has(c)
    },
    addEventListener: (evt, fn) => {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    removeEventListener: (evt, fn) => {
      if (listeners[evt]) listeners[evt] = listeners[evt].filter(f => f !== fn);
    },
    dispatchEvent: (evt) => {
      const type = evt.type || evt;
      if (listeners[type]) listeners[type].forEach(fn => fn(evt));
      return true;
    },
    click: () => {
      if (listeners['click']) listeners['click'].forEach(fn => fn({ type: 'click' }));
    },
    querySelectorAll: () => [],
    querySelector: () => null,
    requestFullscreen: async () => {},
    webkitRequestFullscreen: async () => {}
  };
}

// Setup mock globals before importing modules
const storageStore = new Map();
global.localStorage = {
  getItem: (k) => storageStore.get(k) || null,
  setItem: (k, v) => storageStore.set(k, String(v)),
  removeItem: (k) => storageStore.delete(k),
  clear: () => storageStore.clear()
};

const broadcastChannels = new Map();
class MockBroadcastChannel {
  constructor(name) {
    this.name = name;
    if (!broadcastChannels.has(name)) {
      broadcastChannels.set(name, new Set());
    }
    broadcastChannels.get(name).add(this);
    this.onmessage = null;
  }
  postMessage(data) {
    const peers = broadcastChannels.get(this.name) || new Set();
    peers.forEach(peer => {
      if (peer !== this && typeof peer.onmessage === 'function') {
        peer.onmessage({ data });
      }
    });
  }
  close() {
    const peers = broadcastChannels.get(this.name);
    if (peers) peers.delete(this);
  }
}
global.BroadcastChannel = MockBroadcastChannel;

const windowListeners = {};
global.window = {
  location: { protocol: 'http:', hostname: 'localhost', search: '' },
  addEventListener: (evt, fn) => {
    if (!windowListeners[evt]) windowListeners[evt] = [];
    windowListeners[evt].push(fn);
  },
  trigger: (evt, e = {}) => {
    if (windowListeners[evt]) windowListeners[evt].forEach(fn => fn(e));
  },
  open: (url, name, specs) => ({
    closed: false,
    close: function() { this.closed = true; },
    focus: function() {}
  }),
  setInterval: global.setInterval,
  clearInterval: global.clearInterval
};

const documentElements = {
  lblViewerPort: createMockElement('lblViewerPort'),
  viewerWrapper: createMockElement('viewerWrapper'),
  viewerFrame: createMockElement('viewerFrame', 'IFRAME'),
  viewerDetachedPlaceholder: createMockElement('viewerDetachedPlaceholder')
};
documentElements.lblViewerPort.textContent = '3081';

global.document = {
  getElementById: (id) => documentElements[id] || null,
  querySelector: (sel) => {
    if (sel === '.viewer-wrapper') return documentElements.viewerWrapper;
    return null;
  },
  querySelectorAll: (sel) => [],
  documentElement: createMockElement('documentElement'),
  fullscreenElement: null,
  exitFullscreen: async () => { global.document.fullscreenElement = null; },
  webkitExitFullscreen: async () => { global.document.fullscreenElement = null; },
  addEventListener: () => {}
};

async function runTestSuite() {
  console.log('======================================================================');
  console.log('CHALLENGER M4: EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
  console.log('======================================================================\n');

  // ==============================================================================
  // SUITE 1: VIEWER POPOUT, FULLSCREEN & BROADCASTCHANNEL LIFECYCLE
  // ==============================================================================
  console.log('--- [SUITE 1] Viewer Popout, Fullscreen & BroadcastChannel Lifecycle ---');

  const {
    isPoppedOut,
    openPopout,
    reembed,
    focusPopout,
    toggleFullscreen,
    onStateChange,
    initViewerController
  } = await import('../src/web/public/js/viewerController.js');

  await test('1.1 Initial state: isPoppedOut() is false', async () => {
    assert.strictEqual(isPoppedOut(), false, 'isPoppedOut should initially be false');
  });

  await test('1.2 openPopout() creates window ref and sets isPoppedOut() to true', async () => {
    let notifiedState = null;
    const unsub = onStateChange((s) => { notifiedState = s; });
    const win = openPopout(3081);
    assert.ok(win, 'openPopout should return window reference');
    assert.strictEqual(isPoppedOut(), true, 'isPoppedOut() should be true');
    assert.strictEqual(notifiedState, true, 'onStateChange should notify with true');
    unsub();
  });

  await test('1.3 reembed() closes window ref and resets isPoppedOut() to false', async () => {
    let notifiedState = null;
    const unsub = onStateChange((s) => { notifiedState = s; });
    reembed(false);
    assert.strictEqual(isPoppedOut(), false, 'isPoppedOut() should be false after reembed');
    assert.strictEqual(notifiedState, false, 'onStateChange should notify with false');
    unsub();
  });

  await test('1.4 Listener error isolation: throwing listener does not break other listeners', async () => {
    let secondListenerCalled = false;
    const unsub1 = onStateChange(() => {
      throw new Error('Simulated listener crash');
    });
    const unsub2 = onStateChange(() => {
      secondListenerCalled = true;
    });

    openPopout(3081);
    assert.strictEqual(secondListenerCalled, true, 'Second listener must be invoked despite first throwing');

    unsub1();
    unsub2();
    reembed(false);
  });

  await test('1.5 Listener unsubscription: unsub callback removes listener from notifications', async () => {
    let callCount = 0;
    const unsub = onStateChange(() => { callCount++; });

    openPopout(3081);
    assert.strictEqual(callCount, 1, 'Listener should be called once on open');

    unsub(); // unregister

    reembed(false);
    assert.strictEqual(callCount, 1, 'Listener should NOT be called after unsubscribe');
  });

  await test('1.6 High-frequency cycling: 100 rapid sequential open/reembed cycles survive cleanly', async () => {
    for (let i = 0; i < 100; i++) {
      openPopout(3081);
      assert.strictEqual(isPoppedOut(), true);
      reembed(false);
      assert.strictEqual(isPoppedOut(), false);
    }
  });

  await test('1.7 Window close detection: when external window closes, reembed restores state', async () => {
    const win = openPopout(3081);
    assert.strictEqual(isPoppedOut(), true);
    // Simulate user closing popup window
    win.closed = true;

    // Wait for pollInterval (1000ms check, let's wait 1150ms)
    await new Promise(r => setTimeout(r, 1150));
    assert.strictEqual(isPoppedOut(), false, 'Polling loop must detect closed window and reembed');
  });

  await test('1.8 Fullscreen toggling: enter and exit fullscreen updates document state', async () => {
    global.document.fullscreenElement = null;
    const target = createMockElement('targetWrapper');
    let reqCalled = false;
    target.requestFullscreen = async () => {
      reqCalled = true;
      global.document.fullscreenElement = target;
    };

    await toggleFullscreen(target);
    assert.strictEqual(reqCalled, true, 'requestFullscreen should be called on target');
    assert.strictEqual(global.document.fullscreenElement, target, 'document.fullscreenElement should match target');

    // Toggle again to exit fullscreen
    let exitCalled = false;
    global.document.exitFullscreen = async () => {
      exitCalled = true;
      global.document.fullscreenElement = null;
    };

    await toggleFullscreen(target);
    assert.strictEqual(exitCalled, true, 'exitFullscreen should be called when already fullscreen');
    assert.strictEqual(global.document.fullscreenElement, null, 'document.fullscreenElement should be null');
  });

  await test('1.9 Fullscreen error resilience: permission denial does not throw unhandled rejection', async () => {
    global.document.fullscreenElement = null;
    const target = createMockElement('deniedTarget');
    target.requestFullscreen = async () => {
      throw new Error('NotAllowedError: Permissions check failed');
    };
    // Should catch internally and log without throwing
    await toggleFullscreen(target);
  });

  await test('1.10 Storage sync resilience: throwing localStorage does not crash', async () => {
    const originalSet = global.localStorage.setItem;
    global.localStorage.setItem = () => {
      throw new Error('QuotaExceededError: DOM Exception 22');
    };

    // Should succeed without throwing
    openPopout(3081);
    reembed(false);

    global.localStorage.setItem = originalSet;
  });

  await test('1.11 BroadcastChannel message fuzzing: handles malformed, null and unknown messages', async () => {
    initViewerController();
    const testChannel = new MockBroadcastChannel('mc_camera_sync');

    // Fuzz with corrupt payloads
    testChannel.postMessage(null);
    testChannel.postMessage(undefined);
    testChannel.postMessage({});
    testChannel.postMessage({ type: 'UNKNOWN_TYPE_123' });
    testChannel.postMessage({ type: 'VIEWER_POPOUT_OPENED', port: 'abc' });
    testChannel.postMessage({ type: 'REQUEST_REEMBED' });
    assert.strictEqual(isPoppedOut(), false, 'Should process REQUEST_REEMBED cleanly');
  });

  // ==============================================================================
  // SUITE 2: ONBOARDING WIZARD & SETTINGS MODAL VERSION CHIPS INTERACTION
  // ==============================================================================
  console.log('\n--- [SUITE 2] Onboarding Wizard & Settings Modal Version Chips Interaction ---');

  const {
    setupVersionChips,
    updateVersionChipsActive,
    SUPPORTED_VERSIONS_FALLBACK,
    applySettingsToUI
  } = await import('../src/web/public/js/onboardingWizard.js');

  function createMockChipContainer(id) {
    const container = createMockElement(id);
    const chips = [];

    container.innerHTMLSetter = (html) => {
      chips.length = 0;
      const matches = [...html.matchAll(/data-ver="([^"]+)">([^<]+)<\/button>/g)];
      matches.forEach(m => {
        const chip = createMockElement('chip_' + m[1], 'BUTTON');
        chip.dataset = { ver: m[1] };
        chip.textContent = m[2];
        chips.push(chip);
      });
    };

    Object.defineProperty(container, 'innerHTML', {
      set: container.innerHTMLSetter,
      get: () => chips.map(c => `<button data-ver="${c.dataset.ver}">${c.textContent}</button>`).join('')
    });

    container.querySelectorAll = (sel) => {
      if (sel === '.chip-sm') return chips;
      return [];
    };

    return { container, chips };
  }

  await test('2.1 setupVersionChips populates container with fallback versions when none provided', async () => {
    const { container, chips } = createMockChipContainer('obVersionChips');
    const input = createMockElement('obVersion', 'INPUT');
    documentElements.obVersionChips = container;
    documentElements.obVersion = input;

    setupVersionChips('obVersionChips', 'obVersion');
    assert.strictEqual(chips.length, SUPPORTED_VERSIONS_FALLBACK.length, 'Should render all fallback version chips');
    assert.strictEqual(chips[0].dataset.ver, 'auto');
    assert.strictEqual(chips[1].dataset.ver, '26.3');
    assert.strictEqual(chips[2].dataset.ver, '1.21.4');
  });

  await test('2.2 Clicking a chip updates input.value, dispatches input/change events, and toggles active class', async () => {
    const { container, chips } = createMockChipContainer('obVersionChips');
    const input = createMockElement('obVersion', 'INPUT');
    documentElements.obVersionChips = container;
    documentElements.obVersion = input;

    let inputEventFired = false;
    let changeEventFired = false;
    input.addEventListener('input', () => { inputEventFired = true; });
    input.addEventListener('change', () => { changeEventFired = true; });

    setupVersionChips('obVersionChips', 'obVersion');

    // Click on 1.21.4
    const targetChip = chips.find(c => c.dataset.ver === '1.21.4');
    assert.ok(targetChip, 'Chip 1.21.4 must exist');
    targetChip.onclick();

    assert.strictEqual(input.value, '1.21.4', 'input.value should be updated to 1.21.4');
    assert.strictEqual(targetChip.classList.contains('active'), true, 'Clicked chip must have active class');
    assert.strictEqual(chips[0].classList.contains('active'), false, 'Auto chip must not have active class');
    assert.strictEqual(inputEventFired, true, 'input event must be dispatched');
    assert.strictEqual(changeEventFired, true, 'change event must be dispatched');
  });

  await test('2.3 Two-way synchronization: typing matching version in input activates corresponding chip', async () => {
    const { container, chips } = createMockChipContainer('cfgMcVersionChips');
    const input = createMockElement('cfgMcVersion', 'INPUT');
    documentElements.cfgMcVersionChips = container;
    documentElements.cfgMcVersion = input;

    setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

    // Direct manual input change
    input.value = '26.3';
    input.dispatchEvent({ type: 'input' });

    const sotaChip = chips.find(c => c.dataset.ver === '26.3');
    const autoChip = chips.find(c => c.dataset.ver === 'auto');
    assert.strictEqual(sotaChip.classList.contains('active'), true, '26.3 chip must be active');
    assert.strictEqual(autoChip.classList.contains('active'), false, 'auto chip must be inactive');
  });

  await test('2.4 Case and whitespace tolerance: leading/trailing spaces and upper-case match correctly', async () => {
    const { container, chips } = createMockChipContainer('cfgMcVersionChips');
    const input = createMockElement('cfgMcVersion', 'INPUT');
    documentElements.cfgMcVersionChips = container;
    documentElements.cfgMcVersion = input;

    setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

    updateVersionChipsActive('cfgMcVersionChips', '  1.21.4  ');
    const chip1214 = chips.find(c => c.dataset.ver === '1.21.4');
    assert.strictEqual(chip1214.classList.contains('active'), true, 'Padded string should match');

    updateVersionChipsActive('cfgMcVersionChips', 'AUTO');
    const chipAuto = chips.find(c => c.dataset.ver === 'auto');
    assert.strictEqual(chipAuto.classList.contains('active'), true, 'Upper-case AUTO should match auto');
  });

  await test('2.5 Unlisted version handling: unsupported or custom version deactivates all chips without error', async () => {
    const { container, chips } = createMockChipContainer('cfgMcVersionChips');
    const input = createMockElement('cfgMcVersion', 'INPUT');
    documentElements.cfgMcVersionChips = container;
    documentElements.cfgMcVersion = input;

    setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

    updateVersionChipsActive('cfgMcVersionChips', '1.16.5');
    const activeChips = chips.filter(c => c.classList.contains('active'));
    assert.strictEqual(activeChips.length, 0, 'No chip should be active for unlisted version');
  });

  await test('2.6 Multi-modal coexistence: Onboarding and Settings version chips maintain distinct state', async () => {
    const { container: obContainer, chips: obChips } = createMockChipContainer('obVersionChips');
    const obInput = createMockElement('obVersion', 'INPUT');
    documentElements.obVersionChips = obContainer;
    documentElements.obVersion = obInput;

    const { container: cfgContainer, chips: cfgChips } = createMockChipContainer('cfgMcVersionChips');
    const cfgInput = createMockElement('cfgMcVersion', 'INPUT');
    documentElements.cfgMcVersionChips = cfgContainer;
    documentElements.cfgMcVersion = cfgInput;

    setupVersionChips('obVersionChips', 'obVersion');
    setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

    // Select 1.21.1 on onboarding
    obChips.find(c => c.dataset.ver === '1.21.1').onclick();
    // Select 26.3 on settings
    cfgChips.find(c => c.dataset.ver === '26.3').onclick();

    assert.strictEqual(obInput.value, '1.21.1');
    assert.strictEqual(cfgInput.value, '26.3');
    assert.strictEqual(obChips.find(c => c.dataset.ver === '1.21.1').classList.contains('active'), true);
    assert.strictEqual(cfgChips.find(c => c.dataset.ver === '26.3').classList.contains('active'), true);
    assert.strictEqual(obChips.find(c => c.dataset.ver === '26.3').classList.contains('active'), false);
  });

  await test('2.7 applySettingsToUI correctly synchronizes cfgMcVersion and active chip', async () => {
    const { container, chips } = createMockChipContainer('cfgMcVersionChips');
    const input = createMockElement('cfgMcVersion', 'INPUT');
    documentElements.cfgMcVersionChips = container;
    documentElements.cfgMcVersion = input;

    setupVersionChips('cfgMcVersionChips', 'cfgMcVersion');

    applySettingsToUI({
      MC_VERSION: '1.20.4',
      BOT_OWNER: 'testOwner',
      MC_USERNAME: 'testBot'
    });

    assert.strictEqual(input.value, '1.20.4', 'Input value should be updated by applySettingsToUI');
    const chip1204 = chips.find(c => c.dataset.ver === '1.20.4');
    assert.strictEqual(chip1204.classList.contains('active'), true, '1.20.4 chip should be active');
  });

  await test('2.8 Fuzzing version chips helpers: null container, undefined values, non-existent inputs', async () => {
    // Should not throw
    setupVersionChips('nonExistentContainer', 'nonExistentInput');
    updateVersionChipsActive('nonExistentContainer', null);
    updateVersionChipsActive('nonExistentContainer', undefined);
    updateVersionChipsActive('cfgMcVersionChips', null);
    updateVersionChipsActive('cfgMcVersionChips', undefined);
    updateVersionChipsActive('cfgMcVersionChips', 12345);
  });

  // ==============================================================================
  // SUITE 3: BEHAVIORAL TEST DECOUPLING & SOURCE SCRAPING ELIMINATION ORACLE
  // ==============================================================================
  console.log('\n--- [SUITE 3] Behavioral Test Decoupling & Source Scraping Elimination Oracle ---');

  const testFilesToVerify = [
    'test/manualGamemodeFrontendTest.js',
    'test/dashboardCockpitTest.js',
    'test/missionControlTest.js',
    'test/challenger_refactor_2_adversarial.js'
  ];

  for (const testFile of testFilesToVerify) {
    await test(`3.1 Verify ${testFile} contains ZERO fs.readFileSync on app.js`, async () => {
      const fullPath = path.resolve(testFile);
      assert.ok(fs.existsSync(fullPath), `Test file ${testFile} must exist`);
      const content = fs.readFileSync(fullPath, 'utf8');

      // Regex check: any fs.readFileSync reading app.js
      const scrapingRegex = /(?:fs\.)?readFileSync\s*\([^)]*app\.js[^)]*\)/i;
      const match = scrapingRegex.exec(content);
      assert.strictEqual(
        match,
        null,
        `Found forbidden source scraping of app.js in ${testFile}: ${match ? match[0] : ''}`
      );
    });
  }

  await test('3.2 Verify test/manualGamemodeFrontendTest.js verifies runtime module exports dynamically', async () => {
    const content = fs.readFileSync(path.resolve('test/manualGamemodeFrontendTest.js'), 'utf8');
    assert.ok(
      content.includes("import('../src/web/public/js/manualCockpit.js')"),
      'manualGamemodeFrontendTest.js must dynamically import manualCockpit.js'
    );
    assert.ok(
      content.includes("typeof manualCockpitModule[exp] === 'function'"),
      'manualGamemodeFrontendTest.js must verify export functions at runtime'
    );
  });

  await test('3.3 Verify test/dashboardCockpitTest.js verifies modelCockpit.js interface without scraping app.js', async () => {
    const content = fs.readFileSync(path.resolve('test/dashboardCockpitTest.js'), 'utf8');
    assert.ok(
      content.includes("import('../src/web/public/js/modelCockpit.js')"),
      'dashboardCockpitTest.js must dynamically import modelCockpit.js'
    );
    assert.ok(
      content.includes('typeof modelCockpitModule.openModelSettingsModal ==='),
      'dashboardCockpitTest.js must test modelCockpitModule exports directly'
    );
  });

  await test('3.4 Verify app.js does not leak internal submodule functions as redundant facades', async () => {
    const appModule = await import('../src/web/public/app.js');
    const forbiddenFacades = [
      'toggleGamemode',
      'openGamemodePopout',
      'initManualCockpit',
      'openModelSettingsModal',
      'activateTier',
      'scanLocalPorts',
      'initViewerController',
      'drawAreaMap',
      'closeModelSettingsModal'
    ];

    for (const facade of forbiddenFacades) {
      assert.strictEqual(
        appModule[facade],
        undefined,
        `app.js should NOT export internal submodule function '${facade}' as a facade`
      );
    }
  });

  await test('3.5 Verify app.js correctly exports expected top-level orchestrator contracts', async () => {
    const appModule = await import('../src/web/public/app.js');
    const expectedExports = [
      'handleServerMessage',
      'updateStatus',
      'updateTelemetry',
      'applyCameraDetachedState',
      'refreshViewer',
      'toggleBotPower',
      'updateBotPowerUI',
      'updateHandoffUI'
    ];

    for (const exp of expectedExports) {
      assert.strictEqual(
        typeof appModule[exp],
        'function',
        `app.js must export '${exp}' as an orchestrator contract`
      );
    }
  });

  console.log('\n======================================================================');
  console.log(`ALL ${passedTests}/${totalTests} ADVERSARIAL STRESS TESTS PASSED!`);
  console.log('Verdict: APPROVE — Frontend lifecycle, version chips, and decoupled tests verified.');
  console.log('======================================================================\n');
}

runTestSuite().catch(err => {
  console.error('\nADVERSARIAL SUITE CRASHED:', err);
  process.exit(1);
});
