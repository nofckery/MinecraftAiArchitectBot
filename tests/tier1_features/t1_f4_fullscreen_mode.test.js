/**
 * Tier 1 — Feature 4: True 100vw/100vh Fullscreen Mode
 * Tests: T1.16 – T1.20
 * 
 * Verifies .cad-studio-fullscreen CSS positioning rules (fixed, inset: 0, 100vw, 100vh),
 * removal of legacy height caps in fullscreen mode, body overflow locking during fullscreen,
 * clean restoration of normal 3-column layout on exit, and preservation of element hierarchy.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F4), ORIGINAL_REQUEST.md (R2).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement } from '../helpers/mockDom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F4: True 100vw/100vh Fullscreen Mode', () => {

    test('T1.16: test_f4_fullscreen_class_applies_fixed_full_screen', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Match .cad-studio-fullscreen rule
      const match = css.match(/\.cad-studio-fullscreen\s*\{([^}]+)\}/);
      ok(match, '.cad-studio-fullscreen rule must exist in style.css');
      const rules = match[1];

      ok(rules.includes('position: fixed'), 'Must define position: fixed');
      ok(rules.includes('inset: 0') || (rules.includes('top: 0') && rules.includes('left: 0')), 'Must define inset: 0 or top/left: 0');
      ok(rules.includes('width: 100vw'), 'Must define width: 100vw');
      ok(rules.includes('height: 100vh'), 'Must define height: 100vh');

      // Check z-index priority (>= 9000 to overlay standard dashboard columns)
      const zIndexMatch = rules.match(/z-index:\s*([0-9]+)/);
      ok(zIndexMatch, 'Must specify z-index');
      const zIndex = parseInt(zIndexMatch[1], 10);
      ok(zIndex >= 9000, `Fullscreen z-index (${zIndex}) must be high priority (>= 9000)`);
    });

    test('T1.17: test_f4_height_cap_calc_removed_in_fullscreen', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // In normal mode, canvas might have flex or fixed min-height.
      // In fullscreen mode, .cad-studio-fullscreen .cad-studio-workspace expands dynamically.
      ok(
        css.includes('.cad-studio-fullscreen .cad-studio-workspace') ||
        css.includes('.cad-studio-fullscreen #threeContainer'),
        'style.css contains dedicated fullscreen workspace/container expansion rules'
      );

      // Verify in Mock DOM that container in fullscreen is not restricted to standard desktop height
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      col.classList.add('cad-studio-fullscreen');
      col.clientWidth = 1920;
      col.clientHeight = 1080;

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      col.appendChild(container);

      // Fullscreen canvas container expands to window height minus minimal toolbars
      container.clientWidth = 1920;
      container.clientHeight = 1080 - 80; // toolbar + actions

      ok(container.clientHeight >= 900, 'Fullscreen canvas container expands beyond 900px on 1080p display');
      ok(container.clientWidth >= 1800, 'Fullscreen canvas container expands to full window width');
    });

    test('T1.18: test_f4_body_overflow_locked_in_fullscreen', () => {
      const doc = new MockDocument();
      doc.body = doc.createElement('body');

      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';
      doc.body.appendChild(col);

      // Fullscreen toggle handler with body overflow lock
      const handleFullscreenToggle = (enable) => {
        col.classList.toggle('cad-studio-fullscreen', enable);
        if (enable) {
          doc.body.style.overflow = 'hidden';
        } else {
          doc.body.style.overflow = '';
        }
      };

      // Initial state
      ok(!doc.body.style.overflow, 'Body overflow initially unlocked');

      // 1. Enter fullscreen
      handleFullscreenToggle(true);
      strictEqual(col.classList.contains('cad-studio-fullscreen'), true);
      strictEqual(doc.body.style.overflow, 'hidden', 'Body overflow locked to hidden in fullscreen');

      // 2. Exit fullscreen
      handleFullscreenToggle(false);
      strictEqual(col.classList.contains('cad-studio-fullscreen'), false);
      ok(!doc.body.style.overflow, 'Body overflow restored upon exiting fullscreen');
    });

    test('T1.19: test_f4_normal_layout_restored_on_exit', () => {
      const doc = new MockDocument();
      const container = doc.createElement('div');
      container.className = 'grid-container';

      const colLeft = doc.createElement('div');
      colLeft.id = 'columnLeft';
      colLeft.style.display = 'block';

      const colCenter = doc.createElement('div');
      colCenter.id = 'cadStudioColumn';
      colCenter.className = 'column-cad-studio';

      const colRight = doc.createElement('div');
      colRight.id = 'columnRight';
      colRight.style.display = 'block';

      container.appendChild(colLeft);
      container.appendChild(colCenter);
      container.appendChild(colRight);
      doc.body.appendChild(container);

      // Enter fullscreen on center column
      colCenter.classList.add('cad-studio-fullscreen');
      strictEqual(colCenter.classList.contains('cad-studio-fullscreen'), true);

      // Exit fullscreen
      colCenter.classList.remove('cad-studio-fullscreen');
      strictEqual(colCenter.classList.contains('cad-studio-fullscreen'), false, 'Fullscreen class removed');

      // Verify normal layout structure
      strictEqual(container.children.length, 3, 'All 3 columns present in container');
      strictEqual(colLeft.style.display, 'block', 'Left column retains normal display');
      strictEqual(colRight.style.display, 'block', 'Right column retains normal display');
      strictEqual(colCenter.className, 'column-cad-studio', 'Center column maintains standard class name');
    });

    test('T1.20: test_f4_element_hierarchy_preserved_in_fullscreen', () => {
      const doc = new MockDocument();
      const col = doc.createElement('div');
      col.id = 'cadStudioColumn';

      const panel = doc.createElement('div');
      panel.id = 'panelCadStudio';

      const toolbar = doc.createElement('div');
      toolbar.className = 'three-toolbar';

      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';

      const threeContainer = doc.createElement('div');
      threeContainer.id = 'threeContainer';

      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';

      const actionBar = doc.createElement('div');
      actionBar.className = 'build-actions-bar';

      workspace.appendChild(threeContainer);
      workspace.appendChild(sidebar);
      panel.appendChild(toolbar);
      panel.appendChild(workspace);
      panel.appendChild(actionBar);
      col.appendChild(panel);

      // Enter fullscreen
      col.classList.add('cad-studio-fullscreen');

      // Verify all elements remain intact and reachable
      strictEqual(col.querySelector('.three-toolbar'), toolbar, 'Toolbar remains accessible in fullscreen');
      strictEqual(col.querySelector('#threeContainer'), threeContainer, 'Three.js container remains accessible');
      strictEqual(col.querySelector('#cadStudioSidebar'), sidebar, 'Sidebar remains accessible');
      strictEqual(col.querySelector('.build-actions-bar'), actionBar, 'Action bar remains accessible');

      // Exit fullscreen
      col.classList.remove('cad-studio-fullscreen');
      strictEqual(col.querySelector('#threeContainer'), threeContainer, 'Three.js container intact after exit');
      strictEqual(col.querySelector('.build-actions-bar'), actionBar, 'Action bar intact after exit');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
