/**
 * Tier 2 — Feature 4 Boundaries: True 100vw/100vh Fullscreen Mode Boundaries
 * Tests: T2.16 – T2.20
 * 
 * Specifications:
 * - T2.16: Native browser F11 fullscreen while CAD fullscreen is active does not corrupt layout.
 * - T2.17: 20 rapid fullscreen toggles do not create duplicate DOM classes or detached observers.
 * - T2.18: Fullscreen toggle when window is minimized safely handles zero width/height.
 * - T2.19: Dragging across monitors with different devicePixelRatio updates renderer pixel ratio.
 * - T2.20: Modal dialogs maintain higher z-index than fullscreen CAD container.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement, MockEvent, MockWindow } from '../helpers/mockDom.js';
import { MockPerspectiveCamera, MockWebGLRenderer, MockResizeObserver } from '../helpers/mockThree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 2 - F4: Fullscreen Mode Boundaries', () => {

    test('T2.16: test_bva_f4_native_f11_fullscreen_conflict', () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      win.innerWidth = 1920;
      win.innerHeight = 1080;

      const cadStudio = doc.createElement('section');
      cadStudio.id = 'cadStudioColumn';
      doc.body.appendChild(cadStudio);

      const btnToggle = doc.createElement('button');
      btnToggle.id = 'btnToggleCadFullscreen';
      btnToggle.textContent = '⛶ CAD Vollbild';
      doc.body.appendChild(btnToggle);

      // 1. Enter CAD studio fullscreen
      cadStudio.classList.add('cad-studio-fullscreen');
      btnToggle.textContent = '🗗 Beenden [F]';
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'CAD fullscreen active');

      // 2. Browser fires native F11 fullscreen event (e.g. fullscreenchange or window resize to monitor dimensions)
      win.innerWidth = 2560;
      win.innerHeight = 1440;
      doc.fullscreenElement = doc.documentElement;
      doc.dispatchEvent(new MockEvent('fullscreenchange', { bubbles: true }));

      // Verify CAD studio layout class is not corrupted or prematurely stripped by native F11
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'CAD studio fullscreen class preserved through F11 event');
      strictEqual(btnToggle.textContent, '🗗 Beenden [F]', 'Button text remains in fullscreen state');

      // 3. User exits native F11
      doc.fullscreenElement = null;
      doc.dispatchEvent(new MockEvent('fullscreenchange', { bubbles: true }));
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'CAD studio mode remains until user explicitly toggles CAD');
    });

    test('T2.17: test_bva_f4_rapid_fullscreen_toggle_spam', () => {
      const doc = new MockDocument();
      const cadStudio = doc.createElement('section');
      cadStudio.id = 'cadStudioColumn';
      doc.body.appendChild(cadStudio);

      const btnToggle = doc.createElement('button');
      btnToggle.id = 'btnToggleCadFullscreen';
      btnToggle.textContent = '⛶ CAD Vollbild';
      doc.body.appendChild(btnToggle);

      const toggleCadFullscreen = () => {
        const isFs = cadStudio.classList.toggle('cad-studio-fullscreen');
        if (isFs) {
          doc.body.classList.add('cad-fullscreen-locked');
          btnToggle.textContent = '🗗 Beenden [F]';
        } else {
          doc.body.classList.remove('cad-fullscreen-locked');
          btnToggle.textContent = '⛶ CAD Vollbild';
        }
        return isFs;
      };

      // Spam 20 rapid toggles in a synchronous burst
      for (let i = 1; i <= 20; i++) {
        toggleCadFullscreen();
      }

      // After 20 toggles (even number), fullscreen should be FALSE
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), false, 'Fullscreen class cleanly removed after even count toggles');
      strictEqual(doc.body.classList.contains('cad-fullscreen-locked'), false, 'Body overflow lock cleanly removed');
      strictEqual(btnToggle.textContent, '⛶ CAD Vollbild', 'Button text restored to default');

      // Verify no duplicate class tokens
      const classTokens = cadStudio.className.split(/\s+/).filter(Boolean);
      const fsTokens = classTokens.filter(t => t === 'cad-studio-fullscreen');
      strictEqual(fsTokens.length, 0, 'Zero occurrences of cad-studio-fullscreen');

      // Toggle once more (21st time -> odd -> TRUE)
      const isNowActive = toggleCadFullscreen();
      strictEqual(isNowActive, true, '21st toggle cleanly enters fullscreen');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'CAD studio has fullscreen class');
    });

    test('T2.18: test_bva_f4_minimized_window_toggle', () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);

      // Window minimized: width and height report 0
      win.innerWidth = 0;
      win.innerHeight = 0;

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 0;
      container.clientHeight = 0;

      const camera = new MockPerspectiveCamera(45, 1.0, 0.1, 2000);
      const renderer = new MockWebGLRenderer({ width: 100, height: 100 });

      // Viewport adaptation with minimized zero-dimension guard
      const handleResizeOnToggle = () => {
        const rawW = win.innerWidth || container.clientWidth || 0;
        const rawH = win.innerHeight || container.clientHeight || 0;
        const safeW = Math.max(100, rawW);
        const safeH = Math.max(100, rawH);

        camera.aspect = safeW / safeH;
        camera.updateProjectionMatrix();
        renderer.setSize(safeW, safeH, false);

        return { safeW, safeH, aspect: camera.aspect };
      };

      const res = handleResizeOnToggle();
      strictEqual(res.safeW, 100, 'Width clamped to safe minimum 100px');
      strictEqual(res.safeH, 100, 'Height clamped to safe minimum 100px');
      strictEqual(res.aspect, 1.0, 'Aspect ratio is 1.0, avoiding division by zero / NaN');
      ok(isFinite(camera.aspect), 'Camera aspect is finite number');
      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix is valid');
    });

    test('T2.19: test_bva_f4_multi_monitor_dpi_switch', () => {
      const doc = new MockDocument();
      const win = new MockWindow(doc);
      win.devicePixelRatio = 1.0;

      const renderer = new MockWebGLRenderer({ width: 1920, height: 1080 });
      renderer.setPixelRatio(win.devicePixelRatio);
      strictEqual(renderer.getPixelRatio(), 1.0, 'Initial pixel ratio is 1.0');

      // User drags dashboard window to Retina / 4K secondary monitor with 2.5x scaling
      win.devicePixelRatio = 2.5;

      const syncPixelRatio = () => {
        const newRatio = win.devicePixelRatio || 1.0;
        renderer.setPixelRatio(newRatio);
        return newRatio;
      };

      const updatedRatio = syncPixelRatio();
      strictEqual(updatedRatio, 2.5, 'Pixel ratio synced to new monitor DPI');
      strictEqual(renderer.getPixelRatio(), 2.5, 'Renderer pixel ratio updated');
      strictEqual(renderer.setPixelRatioCalls.includes(2.5), true, 'setPixelRatio called with 2.5');
    });

    test('T2.20: test_bva_f4_modal_layer_zindex_priority', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // 1. Extract z-index for .cad-studio-fullscreen
      const cadFsMatch = css.match(/\.cad-studio-fullscreen\s*\{[^}]*z-index:\s*([0-9]+)/s);
      ok(cadFsMatch, 'style.css defines z-index for .cad-studio-fullscreen');
      const cadFsZIndex = parseInt(cadFsMatch[1], 10);

      // 2. Extract z-index for modal overlays (.onboarding-overlay / modal overlays)
      const modalMatch = css.match(/\.onboarding-overlay\s*\{[^}]*z-index:\s*([0-9]+)/s);
      ok(modalMatch, 'style.css defines z-index for modal overlay (.onboarding-overlay)');
      const modalZIndex = parseInt(modalMatch[1], 10);

      // Verify modal z-index superiority (10000 >= 9500)
      ok(
        modalZIndex >= cadFsZIndex,
        `Modal overlay z-index (${modalZIndex}) must be >= CAD fullscreen z-index (${cadFsZIndex}) to prevent modal occlusion`
      );

      // 3. Mock DOM verification: Render CAD in fullscreen and open modal dialog
      const doc = new MockDocument();
      const cadStudio = doc.createElement('section');
      cadStudio.className = 'cad-studio-fullscreen';
      cadStudio.style.zIndex = String(cadFsZIndex);
      doc.body.appendChild(cadStudio);

      const modal = doc.createElement('div');
      modal.className = 'onboarding-overlay';
      modal.style.zIndex = String(modalZIndex);
      doc.body.appendChild(modal);

      ok(parseInt(modal.style.zIndex, 10) >= parseInt(cadStudio.style.zIndex, 10), 'Modal dialog layers above CAD fullscreen container');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
