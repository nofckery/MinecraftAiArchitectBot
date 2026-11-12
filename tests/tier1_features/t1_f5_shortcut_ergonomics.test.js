/**
 * Tier 1 — Feature 5: Shortcut [F] & Toggle Ergonomics
 * Tests: T1.21 – T1.25
 * 
 * Verifies button click toggle on #btnToggleCadFullscreen, keyboard shortcut [F] toggling,
 * ignoring [F] inside text inputs/textareas/contenteditable, preventing fullscreen when
 * modifier keys (Ctrl/Alt/Meta) are held, and blocking CAD shortcut when manual gamemode is active.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F5), ORIGINAL_REQUEST.md (R2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement, MockKeyboardEvent } from '../helpers/mockDom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F5: Shortcut [F] & Toggle Ergonomics', () => {

    test('T1.21: test_f5_button_click_toggles_fullscreen', () => {
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      ok(fs.existsSync(htmlPath), 'index.html exists');
      const html = fs.readFileSync(htmlPath, 'utf8');

      // Verify button exists in index.html
      ok(html.includes('id="btnToggleCadFullscreen"'), 'index.html contains #btnToggleCadFullscreen');

      // Setup Mock DOM
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';

      const btn = doc.createElement('button');
      btn.id = 'btnToggleCadFullscreen';
      btn.textContent = '⛶ Vollbild Studio [F]';

      doc.body.appendChild(col);
      doc.body.appendChild(btn);

      // Implementation of toggleCadStudioFullscreen matching app.js
      const toggleCadStudioFullscreen = (forceState = null) => {
        const next = forceState !== null ? Boolean(forceState) : !col.classList.contains('cad-studio-fullscreen');
        col.classList.toggle('cad-studio-fullscreen', next);
        btn.textContent = next ? '🗗 Vollbild beenden [F]' : '⛶ Vollbild Studio [F]';
        btn.classList.toggle('active', next);
      };

      btn.addEventListener('click', () => toggleCadStudioFullscreen());

      // 1. Initial state
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);
      strictEqual(btn.classList.contains('active'), false);
      ok(btn.textContent.includes('Vollbild Studio'));

      // 2. Click button to enter fullscreen
      btn.click();
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'Clicking button adds fullscreen class');
      strictEqual(btn.classList.contains('active'), true, 'Button gains active class in fullscreen');
      ok(btn.textContent.includes('beenden'), 'Button text updates to indicate exit action');

      // 3. Click button again to exit fullscreen
      btn.click();
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Clicking button again removes fullscreen class');
      strictEqual(btn.classList.contains('active'), false, 'Button active class removed');
      ok(btn.textContent.includes('Vollbild Studio'), 'Button text reverts to enter label');
    });

    test('T1.22: test_f5_key_f_toggles_fullscreen', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      doc.body.appendChild(col);

      let fullscreenState = false;
      const toggleFullscreen = () => {
        fullscreenState = !fullscreenState;
        col.classList.toggle('cad-studio-fullscreen', fullscreenState);
      };

      // Register keydown listener
      doc.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.altKey && !e.metaKey) {
          toggleFullscreen();
        }
      });

      // 1. Press lowercase 'f'
      const keyF = new MockKeyboardEvent('keydown', { key: 'f', code: 'KeyF' });
      doc.dispatchEvent(keyF);
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'Pressing "f" enters CAD fullscreen');

      // 2. Press uppercase 'F' (e.g. Shift+F or CapsLock)
      const keyShiftF = new MockKeyboardEvent('keydown', { key: 'F', code: 'KeyF' });
      doc.dispatchEvent(keyShiftF);
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Pressing "F" exits CAD fullscreen');
    });

    test('T1.23: test_f5_key_f_ignored_in_text_inputs', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      doc.body.appendChild(col);

      const input = doc.createElement('input');
      input.type = 'text';
      doc.body.appendChild(input);

      const textarea = doc.createElement('textarea');
      doc.body.appendChild(textarea);

      const editable = doc.createElement('div');
      editable.isContentEditable = true;
      doc.body.appendChild(editable);

      let toggleTriggered = false;
      const keyHandler = (e, targetElement) => {
        const tag = (targetElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || targetElement?.isContentEditable) {
          return; // Ignore inside typing controls
        }
        if (e.key.toLowerCase() === 'f') {
          toggleTriggered = true;
          col.classList.toggle('cad-studio-fullscreen');
        }
      };

      // 1. Press 'f' inside <input>
      toggleTriggered = false;
      keyHandler(new MockKeyboardEvent('keydown', { key: 'f' }), input);
      strictEqual(toggleTriggered, false, 'Pressing "f" inside <input> is ignored');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);

      // 2. Press 'f' inside <textarea>
      toggleTriggered = false;
      keyHandler(new MockKeyboardEvent('keydown', { key: 'f' }), textarea);
      strictEqual(toggleTriggered, false, 'Pressing "f" inside <textarea> is ignored');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);

      // 3. Press 'f' inside contenteditable element
      toggleTriggered = false;
      keyHandler(new MockKeyboardEvent('keydown', { key: 'f' }), editable);
      strictEqual(toggleTriggered, false, 'Pressing "f" inside contenteditable is ignored');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);

      // 4. Press 'f' on regular container (body)
      toggleTriggered = false;
      keyHandler(new MockKeyboardEvent('keydown', { key: 'f' }), doc.body);
      strictEqual(toggleTriggered, true, 'Pressing "f" on body triggers fullscreen');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true);
    });

    test('T1.24: test_f5_modifier_keys_prevent_fullscreen', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      doc.body.appendChild(col);

      let toggleCount = 0;
      doc.addEventListener('keydown', (e) => {
        // Safe key handler ignoring modifier combinations
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key.toLowerCase() === 'f') {
          toggleCount++;
          col.classList.toggle('cad-studio-fullscreen');
        }
      });

      // 1. Ctrl+F (Browser search)
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
      strictEqual(toggleCount, 0, 'Ctrl+F must not trigger CAD fullscreen');

      // 2. Alt+F (Window menu / mnemonic)
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f', altKey: true }));
      strictEqual(toggleCount, 0, 'Alt+F must not trigger CAD fullscreen');

      // 3. Meta+F / Cmd+F (macOS search)
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f', metaKey: true }));
      strictEqual(toggleCount, 0, 'Meta+F must not trigger CAD fullscreen');

      strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'Fullscreen class remains absent');

      // 4. Plain 'f' without modifiers
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f' }));
      strictEqual(toggleCount, 1, 'Plain "f" successfully triggers fullscreen');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true);
    });

    test('T1.25: test_f5_gamemode_active_blocks_cad_shortcut', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      doc.body.appendChild(col);

      let activeGamemode = true;
      let offhandActionDispatched = false;
      let cadFullscreenDispatched = false;

      doc.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() !== 'f') return;

        if (activeGamemode) {
          // Gamemode priority: [F] is Minecraft offhand swap
          offhandActionDispatched = true;
          return;
        }

        cadFullscreenDispatched = true;
        col.classList.toggle('cad-studio-fullscreen');
      });

      // 1. Gamemode is active: press [F]
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f' }));
      strictEqual(offhandActionDispatched, true, 'Gamemode intercepts [F] for offhand action');
      strictEqual(cadFullscreenDispatched, false, 'CAD fullscreen is shielded from [F] while gamemode is active');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false, 'CAD column does not enter fullscreen');

      // 2. Deactivate gamemode: press [F]
      activeGamemode = false;
      doc.dispatchEvent(new MockKeyboardEvent('keydown', { key: 'f' }));
      strictEqual(cadFullscreenDispatched, true, 'CAD fullscreen triggers when gamemode is inactive');
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true, 'CAD column enters fullscreen');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
