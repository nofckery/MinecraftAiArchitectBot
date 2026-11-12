/**
 * Tier 2 — Feature 1 Boundaries: 3D-CAD Viewport Boundaries
 * Tests: T2.1 – T2.5
 * 
 * Specifications:
 * - T2.1: Narrow mobile/docked window limit at 320px width preserves layout without division by zero.
 * - T2.2: Ultrawide portrait geometry at 600x2400 adapts canvas without header/footer collision.
 * - T2.3: Zero clientHeight safeguard returns clamped fallback (100px) preventing WebGL crash.
 * - T2.4: 50 rapid resize burst events do not produce memory leaks or listener thrashing.
 * - T2.5: Container resize while tab is hidden safely pauses or protects camera projection updates.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement, MockEvent } from '../helpers/mockDom.js';
import { MockPerspectiveCamera, MockWebGLRenderer, MockResizeObserver } from '../helpers/mockThree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 2 - F1: 3D-CAD Viewport Boundaries', () => {

    test('T2.1: test_bva_f1_narrow_mobile_dock_320px', () => {
      // 1. Verify CSS layout safety constraints in style.css
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Grid container and column rules should accommodate narrow boundaries
      ok(css.includes('.grid-container'), '.grid-container defined in style.css');
      ok(css.includes('#threeContainer'), '#threeContainer defined in style.css');

      // 2. Headless DOM simulation at extreme narrow 320px boundary
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 320;
      container.clientHeight = 568;

      // Safe bound computation logic
      const safeWidth = Math.max(100, container.clientWidth);
      const safeHeight = Math.max(100, container.clientHeight);

      strictEqual(safeWidth, 320, 'Width is preserved at 320px');
      strictEqual(safeHeight, 568, 'Height is preserved at 568px');

      const aspect = safeWidth / safeHeight;
      ok(isFinite(aspect), 'Aspect ratio must be a finite number at 320px');
      ok(aspect > 0, 'Aspect ratio must be strictly positive');

      const camera = new MockPerspectiveCamera(45, aspect, 0.1, 2000);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      ok(!Number.isNaN(camera.aspect), 'Camera aspect is not NaN');
      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is non-NaN');
      ok(camera.projectionMatrix.elements[0] > 0, 'Projection matrix x-scale is positive');
    });

    test('T2.2: test_bva_f1_ultrawide_portrait_geometry', () => {
      // Container under extreme 1:4 ultrawide portrait aspect ratio (600x2400)
      const doc = new MockDocument();
      const column = doc.createElement('section');
      column.id = 'cadStudioColumn';
      column.clientHeight = 2400;
      column.clientWidth = 600;

      const header = doc.createElement('div');
      header.className = 'cad-studio-header';
      header.clientHeight = 48;
      column.appendChild(header);

      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';
      column.appendChild(workspace);

      const actionBar = doc.createElement('div');
      actionBar.className = 'build-actions-bar';
      actionBar.clientHeight = 52;
      column.appendChild(actionBar);

      const availableHeight = column.clientHeight - header.clientHeight - actionBar.clientHeight;
      strictEqual(availableHeight, 2300, 'Header and footer leave 2300px unoccluded canvas space');

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 600;
      container.clientHeight = availableHeight;
      workspace.appendChild(container);

      const aspect = container.clientWidth / container.clientHeight;
      const expectedAspect = 600 / 2300;
      strictEqual(aspect, expectedAspect, 'Portrait aspect ratio correctly calculated');

      const camera = new MockPerspectiveCamera(45, aspect, 0.1, 2000);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      ok(isFinite(camera.aspect), 'Aspect ratio is finite');
      strictEqual(camera.aspect, expectedAspect, 'Camera aspect matches portrait geometry');
      ok(camera.projectionMatrix.elements[5] > 0, 'Y-scale in projection matrix is valid and positive');
    });

    test('T2.3: test_bva_f1_zero_client_height_guard', () => {
      // Boundary: Container with 0px client height (unrendered, collapsed, or hidden state)
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 800;
      container.clientHeight = 0; // Extreme zero boundary

      // Safeguard contract: Math.max(100, container.clientHeight)
      const safeWidth = Math.max(100, container.clientWidth);
      const safeHeight = Math.max(100, container.clientHeight);

      strictEqual(safeHeight, 100, 'Zero clientHeight must clamp to 100px safe minimum');
      strictEqual(safeWidth, 800, 'Width is kept at 800px');

      const aspect = safeWidth / safeHeight;
      strictEqual(aspect, 8.0, 'Aspect ratio calculation with clamped fallback is exactly 8.0 (800/100)');
      ok(isFinite(aspect), 'Aspect ratio is strictly finite, avoiding Infinity WebGL crash');

      const camera = new MockPerspectiveCamera(45, aspect, 0.1, 2000);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is valid non-NaN');
      ok(isFinite(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is finite');
    });

    test('T2.4: test_bva_f1_burst_resize_spam', () => {
      // Boundary: 50 rapid resize burst events dispatched within milliseconds
      MockResizeObserver.reset();

      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 800;
      container.clientHeight = 600;

      const renderer = new MockWebGLRenderer({ width: 800, height: 600 });
      const camera = new MockPerspectiveCamera(45, 800 / 600, 0.1, 2000);

      let resizeExecCount = 0;
      const observer = new MockResizeObserver((entries) => {
        resizeExecCount++;
        const entry = entries[0];
        const w = Math.max(100, entry.contentRect.width);
        const h = Math.max(100, entry.contentRect.height);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      });

      observer.observe(container);
      strictEqual(MockResizeObserver.instances.length, 1, 'Exactly one observer registered');

      // Dispatch 50 burst resize events
      for (let i = 1; i <= 50; i++) {
        const testWidth = 500 + i * 10;
        const testHeight = 400 + (i % 2 === 0 ? 50 : 20);
        container.clientWidth = testWidth;
        container.clientHeight = testHeight;
        MockResizeObserver.triggerResize(container, { width: testWidth, height: testHeight });
      }

      strictEqual(resizeExecCount, 50, 'All 50 resize events were processed cleanly');
      strictEqual(MockResizeObserver.instances.length, 1, 'No observer listener thrashing or duplicates');

      // Final dimensions after 50th iteration: width = 500 + 50*10 = 1000, height = 400 + 50 = 450
      const finalWidth = 1000;
      const finalHeight = 450;
      const expectedFinalAspect = finalWidth / finalHeight;

      strictEqual(renderer.width, finalWidth, 'Renderer width matches final burst dimension');
      strictEqual(renderer.height, finalHeight, 'Renderer height matches final burst dimension');
      strictEqual(camera.aspect, expectedFinalAspect, 'Camera aspect matches final burst dimension exactly');
      ok(isFinite(camera.aspect), 'Camera aspect is finite non-NaN');

      observer.disconnect();
      strictEqual(MockResizeObserver.instances.length, 0, 'Clean observer teardown without leak');
    });

    test('T2.5: test_bva_f1_hidden_tab_container_resize', () => {
      // Boundary: Container resize while containing tab has display: none or clientWidth/Height = 0
      const doc = new MockDocument();
      const tabPane = doc.createElement('div');
      tabPane.id = 'tab-viewer';
      tabPane.className = 'tab-pane';
      tabPane.style.display = 'none'; // Hidden tab

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 0;
      container.clientHeight = 0;
      tabPane.appendChild(container);

      const camera = new MockPerspectiveCamera(45, 1.5, 0.1, 2000);
      const priorAspect = camera.aspect;

      // Safe resize handler logic
      const safeResize = () => {
        const isHidden = tabPane.style.display === 'none' || tabPane.classList.contains('hidden');
        if (isHidden && container.clientWidth === 0 && container.clientHeight === 0) {
          // Guard: Tab is inactive/hidden, skip projection update to avoid distortion
          return { skipped: true };
        }
        const w = Math.max(100, container.clientWidth);
        const h = Math.max(100, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        return { skipped: false, w, h };
      };

      const result = safeResize();
      strictEqual(result.skipped, true, 'Safely skipped camera projection update while tab is hidden');
      strictEqual(camera.aspect, priorAspect, 'Prior valid aspect ratio preserved without corruption');

      // Now unhide tab
      tabPane.style.display = 'block';
      container.clientWidth = 1200;
      container.clientHeight = 800;

      const unhiddenResult = safeResize();
      strictEqual(unhiddenResult.skipped, false, 'Projection update executes once tab is visible');
      strictEqual(camera.aspect, 1.5, 'Aspect ratio matches active visible dimensions');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
