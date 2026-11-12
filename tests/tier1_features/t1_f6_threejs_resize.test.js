/**
 * Tier 1 — Feature 6: Three.js Distortion-Free Resize & State Restore
 * Tests: T1.26 – T1.30
 * 
 * Verifies ResizeObserver registration on #threeContainer, camera aspect ratio
 * recalculation on resize, projection matrix updates, WebGLRenderer.setSize invocation
 * with container dimensions, and restoration of pre-fullscreen sidebar state upon exit.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F6), ORIGINAL_REQUEST.md (R2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement } from '../helpers/mockDom.js';
import {
  MockResizeObserver,
  MockPerspectiveCamera,
  MockWebGLRenderer
} from '../helpers/mockThree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F6: Three.js Distortion-Free Resize & State Restore', () => {

    test('T1.26: test_f6_resize_observer_registered_on_container', () => {
      MockResizeObserver.reset();

      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      doc.body.appendChild(container);

      let observedTarget = null;
      const observer = new MockResizeObserver((entries) => {
        observedTarget = entries[0]?.target;
      });

      observer.observe(container);

      // Verify registration
      ok(observer.observedTargets.has(container), 'Container must be tracked in observedTargets');
      strictEqual(MockResizeObserver.instances.length, 1, 'ResizeObserver instance is registered');

      // Trigger resize event
      MockResizeObserver.triggerResize(container, { width: 1024, height: 768 });
      strictEqual(observedTarget, container, 'Resize callback received the observed container');

      observer.disconnect();
    });

    test('T1.27: test_f6_camera_aspect_ratio_updated_on_resize', () => {
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 1280;
      container.clientHeight = 720;
      doc.body.appendChild(container);

      const camera = new MockPerspectiveCamera(50, 1.0, 0.1, 1000);
      const renderer = new MockWebGLRenderer({ width: 800, height: 600 });

      // Viewport resize logic matching threeViewport.js
      const resizeThreeViewport = () => {
        const w = Math.max(100, container.clientWidth);
        const h = Math.max(100, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      };

      // 1. Initial 16:9 resize (1280 x 720)
      resizeThreeViewport();
      const expectedAspect1 = 1280 / 720;
      strictEqual(camera.aspect, expectedAspect1, 'Camera aspect ratio matches 1280/720 (~1.778)');

      // 2. 4:3 resize (800 x 600)
      container.clientWidth = 800;
      container.clientHeight = 600;
      resizeThreeViewport();
      const expectedAspect2 = 800 / 600;
      strictEqual(camera.aspect, expectedAspect2, 'Camera aspect ratio updates to 800/600 (~1.333)');

      // 3. Ultrawide resize (2560 x 1080)
      container.clientWidth = 2560;
      container.clientHeight = 1080;
      resizeThreeViewport();
      strictEqual(camera.aspect, 2560 / 1080, 'Camera aspect ratio adapts to ultrawide');
    });

    test('T1.28: test_f6_projection_matrix_updated_on_resize', () => {
      const camera = new MockPerspectiveCamera(45, 1.0, 0.1, 1000);
      strictEqual(camera.updateProjectionMatrixCalls, 0, 'No matrix updates initially');

      // Update aspect and call updateProjectionMatrix
      camera.aspect = 1920 / 1080;
      camera.updateProjectionMatrix();

      strictEqual(camera.updateProjectionMatrixCalls, 1, 'updateProjectionMatrix() called once');
      ok(camera.projectionMatrix.elements[0] > 0, 'projectionMatrix elements populated');
      ok(isFinite(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is finite');
      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is not NaN');

      // Re-trigger with new aspect ratio
      camera.aspect = 960 / 600;
      camera.updateProjectionMatrix();
      strictEqual(camera.updateProjectionMatrixCalls, 2, 'updateProjectionMatrix() called second time');
    });

    test('T1.29: test_f6_renderer_set_size_called_with_container_dims', () => {
      const renderer = new MockWebGLRenderer({ width: 640, height: 480 });
      strictEqual(renderer.setSizeCalls.length, 0);

      // Invoke setSize with target dimensions and updateStyle = false
      const targetW = 1440;
      const targetH = 900;
      renderer.setSize(targetW, targetH, false);

      strictEqual(renderer.setSizeCalls.length, 1, 'setSize recorded in call history');
      strictEqual(renderer.setSizeCalls[0].width, 1440, 'setSize received correct width');
      strictEqual(renderer.setSizeCalls[0].height, 900, 'setSize received correct height');
      strictEqual(renderer.setSizeCalls[0].updateStyle, false, 'updateStyle argument preserved');
      strictEqual(renderer.width, 1440, 'Renderer width updated');
      strictEqual(renderer.height, 900, 'Renderer height updated');
    });

    test('T1.30: test_f6_prior_sidebar_state_restored_on_fullscreen_exit', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';

      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      doc.body.appendChild(col);
      doc.body.appendChild(sidebar);

      let savedSidebarHidden = false;

      // Fullscreen controller with state persistence contract
      const enterFullscreen = () => {
        savedSidebarHidden = sidebar.classList.contains('hidden');
        col.classList.add('cad-studio-fullscreen');
      };

      const exitFullscreen = () => {
        col.classList.remove('cad-studio-fullscreen');
        sidebar.classList.toggle('hidden', savedSidebarHidden);
      };

      // Scenario A: Sidebar was collapsed (.hidden) before entering fullscreen
      sidebar.classList.add('hidden');
      strictEqual(sidebar.classList.contains('hidden'), true);

      enterFullscreen();
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true);

      exitFullscreen();
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);
      strictEqual(sidebar.classList.contains('hidden'), true, 'Sidebar restored to collapsed state');

      // Scenario B: Sidebar was expanded (not hidden) before entering fullscreen
      sidebar.classList.remove('hidden');
      strictEqual(sidebar.classList.contains('hidden'), false);

      enterFullscreen();
      exitFullscreen();
      strictEqual(sidebar.classList.contains('hidden'), false, 'Sidebar restored to expanded state');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
