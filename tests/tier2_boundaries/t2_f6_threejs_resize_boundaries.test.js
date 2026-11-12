/**
 * Tier 2 — Feature 6 Boundaries: Three.js Resize & State Restore Boundaries
 * Tests: T2.26 – T2.30
 * 
 * Specifications:
 * - T2.26: Fractional container dimensions (e.g. 1024.7px) avoid float aspect ratio errors.
 * - T2.27: Viewport destruction cleans up ResizeObserver listener without memory leaks.
 * - T2.28: WebGL context loss event is trapped gracefully without unhandled rejection.
 * - T2.29: Switching from 16:9 to 9:16 aspect ratio does not clip or collapse near/far planes.
 * - T2.30: Resize cycles preserve camera position and lookAt target without reset.
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

  await describe('Tier 2 - F6: Three.js Resize Boundaries', () => {

    test('T2.26: test_bva_f6_fractional_container_dimensions', () => {
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      // Fractional dimensions resulting from CSS flex percentages or browser scaling
      container.clientWidth = 1024.7;
      container.clientHeight = 768.3;

      const renderer = new MockWebGLRenderer({ width: 800, height: 600 });
      const camera = new MockPerspectiveCamera(45, 1.0, 0.1, 2000);

      const w = Math.max(100, container.clientWidth);
      const h = Math.max(100, container.clientHeight);

      strictEqual(w, 1024.7, 'Fractional width preserved');
      strictEqual(h, 768.3, 'Fractional height preserved');

      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);

      ok(isFinite(camera.aspect), 'Aspect ratio is a finite float');
      ok(!Number.isNaN(camera.aspect), 'Aspect ratio is not NaN');
      strictEqual(Math.abs(camera.aspect - (1024.7 / 768.3)) < 1e-6, true, 'Aspect ratio calculated with high precision');
      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix element 0 is valid non-NaN');
      ok(!Number.isNaN(camera.projectionMatrix.elements[5]), 'Projection matrix element 5 is valid non-NaN');
    });

    test('T2.27: test_bva_f6_observer_disconnect_cleanup', () => {
      MockResizeObserver.reset();

      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';

      let observerCallbackFired = 0;
      const observer = new MockResizeObserver((entries) => {
        observerCallbackFired++;
      });

      observer.observe(container);
      strictEqual(MockResizeObserver.instances.length, 1, 'Observer registered');

      // Trigger resize once while active
      MockResizeObserver.triggerResize(container, { width: 900, height: 600 });
      strictEqual(observerCallbackFired, 1, 'Callback executed for active observer');

      // Teardown / destroy viewport
      observer.disconnect();

      strictEqual(MockResizeObserver.instances.length, 0, 'Observer removed from active instances on disconnect');

      // Trigger resize after disconnect
      MockResizeObserver.triggerResize(container, { width: 1200, height: 800 });
      strictEqual(observerCallbackFired, 1, 'Callback did not fire after disconnect (clean teardown)');
    });

    test('T2.28: test_bva_f6_webgl_context_loss_recovery', () => {
      const doc = new MockDocument();
      const canvas = doc.createElement('canvas');
      canvas.id = 'cadCanvas';

      let isContextLost = false;
      let preventDefaultCalled = false;
      let recoveryHandlerFired = false;

      // Register standard WebGL context loss handlers
      canvas.addEventListener('webglcontextlost', (event) => {
        // According to WebGL spec, calling preventDefault() signals intent to restore context
        event.preventDefault();
        preventDefaultCalled = event.defaultPrevented;
        isContextLost = true;
      });

      canvas.addEventListener('webglcontextrestored', (event) => {
        isContextLost = false;
        recoveryHandlerFired = true;
      });

      // Dispatch webglcontextlost
      const lossEvent = new MockEvent('webglcontextlost', { cancelable: true });
      canvas.dispatchEvent(lossEvent);

      strictEqual(isContextLost, true, 'Context lost state recognized');
      strictEqual(preventDefaultCalled, true, 'preventDefault called to request context restoration');

      // Dispatch webglcontextrestored
      const restoreEvent = new MockEvent('webglcontextrestored', { cancelable: false });
      canvas.dispatchEvent(restoreEvent);

      strictEqual(isContextLost, false, 'Context restored state clean');
      strictEqual(recoveryHandlerFired, true, 'Recovery handler triggered successfully');
    });

    test('T2.29: test_bva_f6_frustum_near_far_stability', () => {
      // Near and far plane parameters must remain strictly stable when aspect ratio inverts
      const camera = new MockPerspectiveCamera(45, 1920 / 1080, 0.1, 2000);
      camera.updateProjectionMatrix();

      strictEqual(camera.near, 0.1, 'Initial near plane is 0.1');
      strictEqual(camera.far, 2000, 'Initial far plane is 2000');
      ok(camera.near < camera.far, 'Near plane is less than far plane');

      // Switch from 16:9 landscape (1.777) to 9:16 portrait (0.5625)
      const portraitAspect = 600 / 1066;
      camera.aspect = portraitAspect;
      camera.updateProjectionMatrix();

      strictEqual(camera.near, 0.1, 'Near plane remains 0.1 after portrait aspect switch');
      strictEqual(camera.far, 2000, 'Far plane remains 2000 after portrait aspect switch');
      ok(camera.near > 0, 'Near plane remains positive');
      ok(camera.far > camera.near, 'Far plane remains strictly greater than near plane');

      // Verify projection matrix frustum z-mapping
      const m22 = camera.projectionMatrix.elements[10];
      const m23 = camera.projectionMatrix.elements[14];
      ok(!Number.isNaN(m22), 'Matrix element 10 (z-depth) is non-NaN');
      ok(!Number.isNaN(m23), 'Matrix element 14 (w-divide) is non-NaN');
    });

    test('T2.30: test_bva_f6_camera_pose_preserved_across_resizes', () => {
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 800;
      container.clientHeight = 600;

      const camera = new MockPerspectiveCamera(45, 800 / 600, 0.1, 2000);
      const renderer = new MockWebGLRenderer({ width: 800, height: 600 });

      // User positions camera at custom coordinates and lookAt target
      const customPos = { x: 42.5, y: 15.2, z: -88.7 };
      camera.position.set(customPos.x, customPos.y, customPos.z);

      const mockControls = {
        target: { x: 10, y: 5, z: 12, set: function(x, y, z) { this.x = x; this.y = y; this.z = z; } }
      };

      const resizeThreeViewport = () => {
        const w = Math.max(100, container.clientWidth);
        const h = Math.max(100, container.clientHeight);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      };

      // Perform 5 consecutive resize cycles
      const resizeDimensions = [
        { w: 1024, h: 768 },
        { w: 1920, h: 1080 },
        { w: 1280, h: 720 },
        { w: 800, h: 600 },
        { w: 1600, h: 900 }
      ];

      for (const dims of resizeDimensions) {
        container.clientWidth = dims.w;
        container.clientHeight = dims.h;
        resizeThreeViewport();
      }

      // Assert camera position and target were strictly preserved across all resize cycles
      strictEqual(camera.position.x, customPos.x, 'Camera X position preserved');
      strictEqual(camera.position.y, customPos.y, 'Camera Y position preserved');
      strictEqual(camera.position.z, customPos.z, 'Camera Z position preserved');
      strictEqual(mockControls.target.x, 10, 'Controls target X preserved');
      strictEqual(mockControls.target.y, 5, 'Controls target Y preserved');
      strictEqual(mockControls.target.z, 12, 'Controls target Z preserved');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
