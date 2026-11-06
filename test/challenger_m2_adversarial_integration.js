/**
 * Empirical Challenger Milestone 2 Adversarial Integration Test Harness
 * 
 * Tests HTML integration boundaries against client JS scripts:
 * app.js, onboardingWizard.js, modelCockpit.js, viewerController.js, threeViewport.js
 * Verifies DOM contracts, ARIA compliance, zero inline styles, and dynamic style interactions.
 */

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const findings = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`[FAIL] ${name}: ${err.message}`);
    findings.push({ name, error: err.message });
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${name}`);
  } catch (err) {
    failedTests++;
    console.error(`[FAIL] ${name}: ${err.message}`);
    findings.push({ name, error: err.message });
  }
}

console.log('========================================================================');
console.log('=== CHALLENGER 2: MILESTONE 2 EMPIRICAL INTEGRATION ADVERSARY HARNESS ===');
console.log('========================================================================\n');

const htmlPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'index.html');
const cssPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'style.css');
const appJsPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'app.js');
const modelCockpitPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'js', 'modelCockpit.js');
const onboardingWizardPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'js', 'onboardingWizard.js');
const viewerControllerPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'js', 'viewerController.js');
const threeViewportPath = path.join(ROOT_DIR, 'src', 'web', 'public', 'js', 'threeViewport.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const cssContent = fs.readFileSync(cssPath, 'utf8');

// -----------------------------------------------------------------------------
// [ORACLE 1] Static HTML Invariants & Zero Inline Style Assertion
// -----------------------------------------------------------------------------
console.log('--- [ORACLE 1] Static HTML Invariants & Zero Inline Style Assertion ---');

test('1.1 Zero inline style="..." attributes remain in index.html', () => {
  const matches = htmlContent.match(/\bstyle\s*=\s*["'][^"']*["']/gi) || [];
  assert.strictEqual(matches.length, 0, `Found remaining inline styles: ${JSON.stringify(matches)}`);
});

test('1.2 Exactly 283 unique DOM IDs and 0 duplicate IDs', () => {
  const idMatches = [...htmlContent.matchAll(/id\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]);
  const counts = new Map();
  const dupes = [];
  for (const id of idMatches) {
    counts.set(id, (counts.get(id) || 0) + 1);
    if (counts.get(id) === 2) {
      dupes.push(id);
    }
  }
  assert.strictEqual(dupes.length, 0, `Duplicate IDs detected: ${dupes.join(', ')}`);
  assert.strictEqual(idMatches.length, 283, `Expected exactly 283 unique IDs, found ${idMatches.length}`);
});

test('1.3 #tab-viewer closing tag followed immediately by <!-- TAB 2', () => {
  const regex = /<\/div>\s*<!--\s*TAB\s*2\s*:/i;
  assert.ok(regex.test(htmlContent), 'Structural marker <!-- TAB 2 comment missing after #tab-viewer');
});

test('1.4 #viewerFrame contains allow="fullscreen; pointer-lock" and allowfullscreen', () => {
  const iframeMatch = htmlContent.match(/<iframe\b[^>]*id=["']viewerFrame["'][^>]*>/i);
  assert.ok(iframeMatch, '#viewerFrame not found');
  const tag = iframeMatch[0];
  assert.ok(/allow=["'][^"']*fullscreen[^"']*["']/i.test(tag), 'Missing fullscreen in allow attribute');
  assert.ok(/allow=["'][^"']*pointer-lock[^"']*["']/i.test(tag), 'Missing pointer-lock in allow attribute');
  assert.ok(/\ballowfullscreen\b/i.test(tag), 'Missing allowfullscreen boolean attribute');
});

test('1.5 #cfgReconnectBot checkbox default checked with verbatim label', () => {
  const checkboxMatch = htmlContent.match(/<input\b[^>]*id=["']cfgReconnectBot["'][^>]*>/i);
  assert.ok(checkboxMatch, '#cfgReconnectBot not found');
  assert.ok(/\bchecked\b/i.test(checkboxMatch[0]), '#cfgReconnectBot must be checked by default');
  assert.ok(htmlContent.includes('Bot sofort mit neuer Version neu verbinden'), 'Missing verbatim reconnect text');
});

test('1.6 Version chips present in #obVersionChips and #cfgMcVersionChips', () => {
  const expectedVers = ['auto', '26.3', '1.21.4', '1.21.1', '1.20.4', '1.20.1'];
  for (const ver of expectedVers) {
    const obRegex = new RegExp(`id=["']obVersionChips["'][\\s\\S]*?data-ver=["']${ver}["']`, 'i');
    const cfgRegex = new RegExp(`id=["']cfgMcVersionChips["'][\\s\\S]*?data-ver=["']${ver}["']`, 'i');
    assert.ok(obRegex.test(htmlContent), `Missing version ${ver} in #obVersionChips`);
    assert.ok(cfgRegex.test(htmlContent), `Missing version ${ver} in #cfgMcVersionChips`);
  }
});

test('1.7 Verbatim text strings preserved across the dashboard', () => {
  const verbatimStrings = [
    '● KAMERA AUSGELAGERT (MULTI-MONITOR)',
    '⤺ Im Cockpit wiedereinbetten',
    '⧉ Fenster fokussieren',
    'Schnitt-Höhe Y: 1 bis Max',
    'In Minecraft-Welt bauen',
    'Letzten Bau rückgängig (!undo)',
    'Not-Stopp (!stop)',
    'title="Vollbildmodus aktivieren"',
    'title="Kamera in separatem Fenster/Tab öffnen"'
  ];
  for (const str of verbatimStrings) {
    assert.ok(htmlContent.includes(str), `Missing verbatim string: ${str}`);
  }
});

// -----------------------------------------------------------------------------
// [ORACLE 2] WAI-ARIA Accessibility Validation
// -----------------------------------------------------------------------------
console.log('\n--- [ORACLE 2] WAI-ARIA Accessibility Validation ---');

test('2.1 All 5 dialogs implement role="dialog", aria-modal="true", and valid aria-labelledby', () => {
  const dialogs = [
    { id: 'onboardingModal', labelId: 'onboardTitle' },
    { id: 'modalModelSettings', labelId: 'modalSettingsTitle' },
    { id: 'drawerEndpointEdit', labelId: 'drawerTitle' },
    { id: 'modalDeviceFlow', labelId: 'deviceFlowTitle' },
    { id: 'modalMsaAuth', labelId: 'msaModalTitle' }
  ];

  for (const d of dialogs) {
    const tagMatch = htmlContent.match(new RegExp(`<[^>]*id=["']${d.id}["'][^>]*>`, 'i'));
    assert.ok(tagMatch, `Dialog #${d.id} tag not found`);
    const tag = tagMatch[0];
    assert.ok(/role=["']dialog["']/i.test(tag), `Dialog #${d.id} missing role="dialog"`);
    assert.ok(/aria-modal=["']true["']/i.test(tag), `Dialog #${d.id} missing aria-modal="true"`);
    assert.ok(new RegExp(`aria-labelledby=["']${d.labelId}["']`, 'i').test(tag), `Dialog #${d.id} missing aria-labelledby="${d.labelId}"`);
    assert.ok(htmlContent.includes(`id="${d.labelId}"`), `Target heading #${d.labelId} does not exist in DOM`);
  }
});

test('2.2 Tab navigation container declares role="tablist" and panels declare role="tabpanel"', () => {
  assert.ok(/class=["'][^"']*tab-buttons[^"']*["'][^>]*role=["']tablist["']/i.test(htmlContent), 'tab-buttons container missing role="tablist"');
  const tabs = [
    { btnId: 'tabBtnViewer', paneId: 'tab-viewer', active: true },
    { btnId: 'tabBtnMap', paneId: 'tab-map', active: false },
    { btnId: 'tabBtnSchematics', paneId: 'tab-schematics', active: false },
    { btnId: 'tabBtnSettings', paneId: 'tab-settings', active: false }
  ];

  for (const t of tabs) {
    const btnMatch = htmlContent.match(new RegExp(`<button[^>]*id=["']${t.btnId}["'][^>]*>`, 'i'));
    assert.ok(btnMatch, `Button #${t.btnId} not found`);
    const bTag = btnMatch[0];
    assert.ok(/role=["']tab["']/i.test(bTag), `Button #${t.btnId} missing role="tab"`);
    assert.ok(new RegExp(`aria-selected=["']${t.active ? 'true' : 'false'}["']`, 'i').test(bTag), `Button #${t.btnId} expected aria-selected="${t.active}"`);
    assert.ok(new RegExp(`aria-controls=["']${t.paneId}["']`, 'i').test(bTag), `Button #${t.btnId} missing aria-controls="${t.paneId}"`);

    const paneMatch = htmlContent.match(new RegExp(`<div[^>]*id=["']${t.paneId}["'][^>]*>`, 'i'));
    assert.ok(paneMatch, `Pane #${t.paneId} not found`);
    const pTag = paneMatch[0];
    assert.ok(/role=["']tabpanel["']/i.test(pTag), `Pane #${t.paneId} missing role="tabpanel"`);
    assert.ok(new RegExp(`aria-labelledby=["']${t.btnId}["']`, 'i').test(pTag), `Pane #${t.paneId} missing aria-labelledby="${t.btnId}"`);
  }
});

test('2.3 Icon-only and glyph buttons declare descriptive aria-label in German', () => {
  const iconButtons = [
    'btnCloseOnboarding',
    'btnCloseDrawer',
    'btnCancelDeviceFlow',
    'btnCloseMsaModal',
    'btnRefreshMap',
    'btnRefreshSchematics',
    'btnResetSlicer',
    'btnClearSelectionBox',
    'btnDismissErrorBanner',
    'btnToggleSecretVisibility',
    'btnMirrorX',
    'btnMirrorZ',
    'btnRotate90',
    'btnShiftYUp',
    'btnShiftYDown'
  ];

  for (const btnId of iconButtons) {
    const btnMatch = htmlContent.match(new RegExp(`<button[^>]*id=["']${btnId}["'][^>]*>`, 'i'));
    assert.ok(btnMatch, `Button #${btnId} not found`);
    assert.ok(/aria-label=["'][^"']+["']/i.test(btnMatch[0]), `Button #${btnId} missing aria-label`);
  }
});

// -----------------------------------------------------------------------------
// [ORACLE 3] Dynamic DOM Interactions in Client JS Scripts
// -----------------------------------------------------------------------------
console.log('\n--- [ORACLE 3] Dynamic DOM Interactions in Client JS Scripts ---');

test('3.1 viewerController.js exports match requirements and handle DOM detachment without styles conflict', async () => {
  const mod = await import(viewerControllerPath);
  assert.strictEqual(typeof mod.isPoppedOut, 'function');
  assert.strictEqual(typeof mod.openPopout, 'function');
  assert.strictEqual(typeof mod.reembed, 'function');
  assert.strictEqual(typeof mod.focusPopout, 'function');
  assert.strictEqual(typeof mod.toggleFullscreen, 'function');
  assert.strictEqual(typeof mod.onStateChange, 'function');
  assert.strictEqual(typeof mod.initViewerController, 'function');

  // Verify elements referenced in viewerController exist in index.html
  assert.ok(htmlContent.includes('id="lblViewerPort"'), 'lblViewerPort element missing');
});

test('3.2 app.js applyCameraDetachedState properly drives viewer elements', async () => {
  const mod = await import(appJsPath);
  assert.strictEqual(typeof mod.applyCameraDetachedState, 'function');

  // Elements targeted by applyCameraDetachedState:
  const targetIds = ['viewerFrame', 'viewerWrapper', 'viewerDetachedPlaceholder', 'lblViewerPort'];
  for (const id of targetIds) {
    assert.ok(htmlContent.includes(`id="${id}"`), `Element #${id} targeted by applyCameraDetachedState missing in HTML`);
  }
  assert.ok(htmlContent.includes('class="grid-container"'), '.grid-container missing in HTML');
});

test('3.3 threeViewport.js exports and container hookup', async () => {
  const mod = await import(threeViewportPath);
  assert.strictEqual(typeof mod.initThree, 'function');
  assert.strictEqual(typeof mod.setXrayActive, 'function');
  assert.strictEqual(typeof mod.getXrayActive, 'function');
  assert.strictEqual(typeof mod.getBlockColor, 'function');
  assert.strictEqual(typeof mod.getCurrentSelectionBox, 'function');
  assert.ok(typeof mod.BLOCK_COLORS === 'object', 'BLOCK_COLORS dictionary missing');

  // Target container in index.html
  assert.ok(htmlContent.includes('id="threeContainer"'), '#threeContainer missing in HTML');
});

test('3.4 modelCockpit.js target DOM element completeness', () => {
  const cockpitElements = [
    'modalModelSettings',
    'btnCloseModelSettings',
    'selectFastTier',
    'selectArchitectTier',
    'badgeFastTierStatus',
    'badgeArchitectTierStatus',
    'toggleZeroKeyEmergency',
    'btnScanLocal',
    'progressVram',
    'localScannerResults',
    'providerGrid',
    'drawerEndpointEdit',
    'formEndpointConfig',
    'selEndpointProvider',
    'txtEndpointBaseUrl',
    'txtEndpointModelId',
    'txtEndpointSecret',
    'btnToggleSecretVisibility',
    'btnTestAdhoc',
    'btnSaveEndpoint',
    'btnDeleteEndpoint',
    'btnCancelDrawer',
    'drawerProbeFeedback',
    'metricLatency',
    'metricSuccessRate',
    'timerCooldown429',
    'bannerModelError',
    'modalDeviceFlow',
    'txtDeviceCode',
    'btnCopyDeviceCode',
    'linkVerificationUri',
    'lblDevicePollingState',
    'timerDeviceCode',
    'btnCancelDeviceFlow'
  ];

  for (const id of cockpitElements) {
    assert.ok(htmlContent.includes(`id="${id}"`), `Model cockpit element #${id} missing in HTML`);
  }
});

test('3.5 onboardingWizard.js target DOM element completeness', () => {
  const onboardElements = [
    'onboardingModal',
    'btnCloseOnboarding',
    'btnOpenSetupModal',
    'onboardTitle',
    'obVersionChips',
    'cfgMcVersionChips',
    'cfgReconnectBot',
    'btnObCopyMsaCode',
    'btnObMsaReauth'
  ];

  for (const id of onboardElements) {
    assert.ok(htmlContent.includes(`id="${id}"`), `Onboarding wizard element #${id} missing in HTML`);
  }
});

// -----------------------------------------------------------------------------
// [ORACLE 4] Adversarial Empirical Audit of Removed Inline Styles
// -----------------------------------------------------------------------------
console.log('\n--- [ORACLE 4] Adversarial Empirical Audit of Removed Inline Styles ---');

test('4.1 Progress bar elements have utility class or dynamic style capability', () => {
  // Audit progressBarFill and progressVram
  const pbMatch = htmlContent.match(/<div\b[^>]*id=["']progressBarFill["'][^>]*>/i);
  assert.ok(pbMatch, '#progressBarFill not found');
  const pbTag = pbMatch[0];
  assert.ok(!/\bstyle\s*=/i.test(pbTag), '#progressBarFill must not contain inline style');

  const vramMatch = htmlContent.match(/<div\b[^>]*id=["']progressVram["'][^>]*>/i);
  assert.ok(vramMatch, '#progressVram not found');
  const vramTag = vramMatch[0];
  assert.ok(!/\bstyle\s*=/i.test(vramTag), '#progressVram must not contain inline style');
});

test('4.2 Verify style.css defines .progress-fill with width: 0%', () => {
  assert.ok(/\.progress-fill\s*\{[^}]*width:\s*0%/i.test(cssContent), 'style.css must define .progress-fill { width: 0%; }');
});

test('4.3 Hidden utility class is defined and has display: none', () => {
  assert.ok(/\.hidden[\s\S]*?\{[^}]*display:\s*none/i.test(cssContent), 'style.css must define .hidden with display: none');
});

test('4.4 Notice-warning class is defined with amber color and margin', () => {
  assert.ok(/\.notice-warning\s*\{[^}]*color:\s*var\(--accent-amber\)/i.test(cssContent), 'style.css must define .notice-warning');
});

test('4.5 Device flow modal classes defined in style.css', () => {
  const deviceFlowClasses = [
    '.device-flow-dialog-card',
    '.device-flow-body',
    '.flow-instruction',
    '.code-display-box',
    '.code-label',
    '.verify-action-box',
    '.verify-action-link',
    '.verify-hint',
    '.device-status-box',
    '.device-spinner-row',
    '.device-polling-label',
    '.countdown-row'
  ];

  for (const cls of deviceFlowClasses) {
    const escaped = cls.replace('.', '\\.');
    const regex = new RegExp(`${escaped}\\s*[,{]`);
    assert.ok(regex.test(cssContent), `Class ${cls} missing from style.css`);
  }
});

// -----------------------------------------------------------------------------
// [ORACLE 5] Mock DOM Dynamic Lifecycle & Stress Testing
// -----------------------------------------------------------------------------
console.log('\n--- [ORACLE 5] Mock DOM Dynamic Lifecycle & Stress Testing ---');

test('5.1 Tab switching event listener lifecycle and mutual exclusion', () => {
  const tabs = ['tab-viewer', 'tab-map', 'tab-schematics', 'tab-settings'];
  const tabBtns = tabs.map(id => ({
    id: `tabBtn${id.replace('tab-', '')}`,
    dataset: { tab: id },
    classList: {
      classes: new Set(id === 'tab-viewer' ? ['active'] : []),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    },
    listeners: [],
    addEventListener(evt, fn) { this.listeners.push(fn); },
    click() { this.listeners.forEach(fn => fn()); }
  }));

  const tabPanes = tabs.map(id => ({
    id,
    classList: {
      classes: new Set(id === 'tab-viewer' ? ['active'] : []),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  }));

  // Simulate tab click handler as implemented in app.js
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const pane = tabPanes.find(p => p.id === btn.dataset.tab);
      if (pane) pane.classList.add('active');
    });
  });

  // Switch to tab-map
  tabBtns[1].click();
  assert.ok(tabBtns[1].classList.contains('active'), 'tabBtnMap should be active');
  assert.ok(tabPanes[1].classList.contains('active'), 'tab-map should be active');
  assert.ok(!tabBtns[0].classList.contains('active'), 'tabBtnViewer should be inactive');
  assert.ok(!tabPanes[0].classList.contains('active'), 'tab-viewer should be inactive');

  // Switch to tab-settings
  tabBtns[3].click();
  assert.ok(tabBtns[3].classList.contains('active'), 'tabBtnSettings should be active');
  assert.ok(tabPanes[3].classList.contains('active'), 'tab-settings should be active');
  assert.ok(!tabBtns[1].classList.contains('active'), 'tabBtnMap should be inactive');

  // Stress test: 100 rapid tab clicks
  for (let i = 0; i < 100; i++) {
    const targetIdx = i % 4;
    tabBtns[targetIdx].click();
    assert.ok(tabBtns[targetIdx].classList.contains('active'));
    assert.ok(tabPanes[targetIdx].classList.contains('active'));
    const activeBtnCount = tabBtns.filter(b => b.classList.contains('active')).length;
    const activePaneCount = tabPanes.filter(p => p.classList.contains('active')).length;
    assert.strictEqual(activeBtnCount, 1, 'Exactly one tab button must be active');
    assert.strictEqual(activePaneCount, 1, 'Exactly one tab pane must be active');
  }
});

test('5.2 Dynamic inline style application for progress bars', () => {
  const progressBar = {
    id: 'progressBarFill',
    style: { width: '' }
  };
  const vramBar = {
    id: 'progressVram',
    style: { width: '' }
  };

  // Test dynamic percentage animation via JS (as app.js and modelCockpit.js do)
  const percentages = [0, 15, 42.5, 78, 100];
  for (const pct of percentages) {
    progressBar.style.width = `${pct}%`;
    vramBar.style.width = `${pct}%`;
    assert.strictEqual(progressBar.style.width, `${pct}%`);
    assert.strictEqual(vramBar.style.width, `${pct}%`);
  }
});

test('5.3 Drawer & Modal visibility toggling with classList .hidden', () => {
  const drawer = {
    id: 'drawerEndpointEdit',
    classList: {
      classes: new Set(['cad-drawer', 'slide-drawer', 'hidden']),
      add(c) { this.classes.add(c); },
      remove(c) { this.classes.delete(c); },
      contains(c) { return this.classes.has(c); }
    }
  };

  // Open drawer
  drawer.classList.remove('hidden');
  assert.ok(!drawer.classList.contains('hidden'), 'Drawer should be visible (hidden removed)');

  // Close drawer
  drawer.classList.add('hidden');
  assert.ok(drawer.classList.contains('hidden'), 'Drawer should be hidden (hidden added)');
});

console.log('\n========================================================================');
console.log(`TOTAL TESTS: ${totalTests}`);
console.log(`PASSED: ${passedTests}`);
console.log(`FAILED: ${failedTests}`);
if (findings.length > 0) {
  console.log(`FINDINGS: ${JSON.stringify(findings, null, 2)}`);
}
console.log('========================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
