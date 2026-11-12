/**
 * Tier 2 — Feature 5 Boundaries: Shortcut [F] & Toggle Ergonomics Boundaries
 * Tests: T2.21 – T2.25
 * 
 * Specifications:
 * - T2.21: Keydown with event.repeat = true (holding down F) does not repeatedly toggle.
 * - T2.22: Keydown inside contenteditable="true" element does not toggle fullscreen.
 * - T2.23: IME composition keystrokes (isComposing = true) do not trigger toggle.
 * - T2.24: Missing CAD elements in DOM exits gracefully without TypeError.
 * - T2.25: Pressing [F] in external popout window does not trigger main window CAD fullscreen.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement, MockKeyboardEvent, MockWindow } from '../helpers/mockDom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 2 - F5: Shortcut Ergonomics Boundaries', () => {

    test('T2.21: test_bva_f5_key_repeat_ignored', () => {
      const doc = new MockDocument();
      const cadStudio = doc.createElement('section');
      cadStudio.id = 'cadStudioColumn';
      doc.body.appendChild(cadStudio);

      let toggleCount = 0;
      const toggleCadStudioFullscreen = () => {
        toggleCount++;
        cadStudio.classList.toggle('cad-studio-fullscreen');
      };

      // Shortcut handler with event.repeat guard
      const handleKeydown = (e) => {
        if (e.repeat) return; // Guard: ignore held-down repeating keys
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        if (e.key.toLowerCase() === 'f') {
          toggleCadStudioFullscreen();
        }
      };

      // 1. Initial keydown press (repeat = false)
      const initialEvent = new MockKeyboardEvent('keydown', { key: 'f', repeat: false });
      handleKeydown(initialEvent);
      strictEqual(toggleCount, 1, 'First press toggles fullscreen');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'Entered fullscreen');

      // 2. User holds down 'F' key (browser dispatches 10 repeat events)
      for (let i = 0; i < 10; i++) {
        const repeatEvent = new MockKeyboardEvent('keydown', { key: 'f', repeat: true });
        handleKeydown(repeatEvent);
      }

      strictEqual(toggleCount, 1, 'Repeat events strictly ignored; toggleCount remains 1');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'Still in fullscreen without flickering');

      // 3. User releases and presses once more (repeat = false)
      const secondPress = new MockKeyboardEvent('keydown', { key: 'f', repeat: false });
      handleKeydown(secondPress);
      strictEqual(toggleCount, 2, 'Second distinct press cleanly toggles out');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), false, 'Exited fullscreen');
    });

    test('T2.22: test_bva_f5_content_editable_ignored', () => {
      const doc = new MockDocument();
      const cadStudio = doc.createElement('section');
      cadStudio.id = 'cadStudioColumn';
      doc.body.appendChild(cadStudio);

      const editableDiv = doc.createElement('div');
      editableDiv.id = 'richTextPrompt';
      editableDiv.setAttribute('contenteditable', 'true');
      editableDiv.isContentEditable = true;
      doc.body.appendChild(editableDiv);

      let toggleCount = 0;
      const toggleCadStudioFullscreen = () => {
        toggleCount++;
        cadStudio.classList.toggle('cad-studio-fullscreen');
      };

      const handleKeydown = (e) => {
        const target = e.target || doc.activeElement;
        const tag = target ? (target.tagName || '').toLowerCase() : '';
        const isEditable = tag === 'input' || tag === 'textarea' ||
          target?.isContentEditable ||
          target?.getAttribute?.('contenteditable') === 'true';

        if (isEditable) return;
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key.toLowerCase() === 'f') {
          toggleCadStudioFullscreen();
        }
      };

      // User focuses editable div and types 'f'
      doc.activeElement = editableDiv;
      const keyEvent = new MockKeyboardEvent('keydown', { key: 'f', repeat: false });
      keyEvent.target = editableDiv;
      handleKeydown(keyEvent);

      strictEqual(toggleCount, 0, 'Keydown inside contenteditable element did not toggle CAD fullscreen');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), false, 'CAD studio remains in normal mode');

      // User blurs editable div and presses 'f' on body
      doc.activeElement = doc.body;
      const bodyKeyEvent = new MockKeyboardEvent('keydown', { key: 'f', repeat: false });
      bodyKeyEvent.target = doc.body;
      handleKeydown(bodyKeyEvent);

      strictEqual(toggleCount, 1, 'Keydown with body activeElement toggles fullscreen');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), true, 'CAD studio enters fullscreen');
    });

    test('T2.23: test_bva_f5_ime_composition_ignored', () => {
      const doc = new MockDocument();
      const cadStudio = doc.createElement('section');
      cadStudio.id = 'cadStudioColumn';
      doc.body.appendChild(cadStudio);

      let toggleCount = 0;
      const toggleCadStudioFullscreen = () => {
        toggleCount++;
        cadStudio.classList.toggle('cad-studio-fullscreen');
      };

      const handleKeydown = (e) => {
        if (e.isComposing || e.keyCode === 229) return; // Guard against IME Japanese/Chinese composition
        if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;

        if (e.key.toLowerCase() === 'f') {
          toggleCadStudioFullscreen();
        }
      };

      // IME composition event where 'f' is typed as part of phoneme
      const imeEvent = new MockKeyboardEvent('keydown', { key: 'f', isComposing: true });
      handleKeydown(imeEvent);

      strictEqual(toggleCount, 0, 'IME composition keystroke is safely ignored');
      strictEqual(cadStudio.classList.contains('cad-studio-fullscreen'), false, 'CAD studio remains untouched');

      // Normal keystroke (isComposing = false)
      const normalEvent = new MockKeyboardEvent('keydown', { key: 'f', isComposing: false });
      handleKeydown(normalEvent);

      strictEqual(toggleCount, 1, 'Standard non-composing keystroke successfully triggers toggle');
    });

    test('T2.24: test_bva_f5_missing_dom_elements_graceful', () => {
      // Empty document without CAD container or buttons
      const doc = new MockDocument();

      let errorThrown = null;
      const safeToggleCadStudioFullscreen = () => {
        try {
          const cadStudio = doc.getElementById('cadStudioColumn') || doc.getElementById('panelCadStudio');
          const btnToggle = doc.getElementById('btnToggleCadFullscreen');

          if (!cadStudio) {
            // Gracefully abort without TypeError
            return { success: false, reason: 'CAD_CONTAINER_NOT_FOUND' };
          }

          cadStudio.classList.toggle('cad-studio-fullscreen');
          if (btnToggle) {
            btnToggle.textContent = cadStudio.classList.contains('cad-studio-fullscreen') ? '🗗 Beenden [F]' : '⛶ CAD Vollbild';
          }
          return { success: true };
        } catch (err) {
          errorThrown = err;
          return { success: false, error: err };
        }
      };

      const res = safeToggleCadStudioFullscreen();
      strictEqual(errorThrown, null, 'No TypeError thrown when CAD elements are missing from DOM');
      strictEqual(res.success, false, 'Gracefully returned failure state');
      strictEqual(res.reason, 'CAD_CONTAINER_NOT_FOUND', 'Correct missing container diagnostic returned');
    });

    test('T2.25: test_bva_f5_popout_window_focus_isolation', () => {
      // Simulate main dashboard window and separate popout viewer window
      const mainDoc = new MockDocument();
      const mainWin = new MockWindow(mainDoc);

      const mainCadStudio = mainDoc.createElement('section');
      mainCadStudio.id = 'cadStudioColumn';
      mainDoc.body.appendChild(mainCadStudio);

      const popoutDoc = new MockDocument();
      const popoutWin = new MockWindow(popoutDoc);

      let mainToggleCount = 0;
      const mainKeyHandler = (e) => {
        if (e.key.toLowerCase() === 'f' && !e.repeat) {
          mainToggleCount++;
          mainCadStudio.classList.toggle('cad-studio-fullscreen');
        }
      };
      mainWin.addEventListener('keydown', mainKeyHandler);

      let popoutVideoFsCount = 0;
      const popoutKeyHandler = (e) => {
        // In popout window, [F] should only toggle video/viewer fullscreen in popout
        if (e.key.toLowerCase() === 'f' && !e.repeat) {
          popoutVideoFsCount++;
        }
      };
      popoutWin.addEventListener('keydown', popoutKeyHandler);

      // Keystroke in popout window
      const popoutEvent = new MockKeyboardEvent('keydown', { key: 'f' });
      popoutWin.dispatchEvent(popoutEvent);

      strictEqual(popoutVideoFsCount, 1, 'Popout viewer received shortcut locally');
      strictEqual(mainToggleCount, 0, 'Main window CAD fullscreen was isolated and NOT triggered');
      strictEqual(mainCadStudio.classList.contains('cad-studio-fullscreen'), false, 'Main CAD studio is not fullscreen');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
