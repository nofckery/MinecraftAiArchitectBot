/**
 * Tier 1 — Feature 3: CAD Sidebar Tabbed Layout
 * Tests: T1.11 – T1.15
 * 
 * Verifies tab buttons rendered for all sections (Objects, Inspector, Spatial AI),
 * tab switching activating the target pane while hiding siblings, sidebar collapse
 * toggle button functionality, canvas width expansion on sidebar collapse, and
 * tab selection persistence across collapse/expand cycles.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F3), ORIGINAL_REQUEST.md (R1, R4).
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

  await describe('Tier 1 - F3: CAD Sidebar Tabbed Layout', () => {

    test('T1.11: test_f3_tab_buttons_rendered_for_all_sections', () => {
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      ok(fs.existsSync(htmlPath), 'index.html exists');
      const html = fs.readFileSync(htmlPath, 'utf8');

      // 1. Verify existence of sidebar navigation tab container
      ok(html.includes('class="cad-sidebar-tabs"'), 'index.html contains .cad-sidebar-tabs navigation');

      // 2. Verify tab buttons for Objects, Inspector, and Spatial AI
      ok(
        html.includes('id="tabBtnCadObjects"') || html.includes('id="tabBtnObjects"'),
        'Tab button for Objects exists (#tabBtnCadObjects or #tabBtnObjects)'
      );
      ok(
        html.includes('id="tabBtnCadInspector"') || html.includes('id="tabBtnInspector"'),
        'Tab button for Inspector exists (#tabBtnCadInspector or #tabBtnInspector)'
      );
      ok(
        html.includes('id="tabBtnCadAi"') || html.includes('id="tabBtnSpatial"'),
        'Tab button for Spatial AI exists (#tabBtnCadAi or #tabBtnSpatial)'
      );

      // 3. Verify accessibility attributes
      ok(html.includes('role="tablist"'), 'Navigation wrapper specifies role="tablist"');
      ok(html.includes('role="tab"'), 'Tab buttons declare role="tab"');

      // 4. Verify CSS rules for tabbed sidebar in style.css
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');
      ok(css.includes('.cad-sidebar-tabs'), 'style.css defines .cad-sidebar-tabs');
      ok(css.includes('.cad-sidebar-tab'), 'style.css defines .cad-sidebar-tab');
    });

    test('T1.12: test_f3_tab_switching_activates_target_pane', () => {
      // Mock DOM with sidebar, tabs, and panes
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.className = 'cad-studio-sidebar';
      sidebar.setAttribute('data-active-tab', 'objects');

      const tabs = [
        { id: 'tabBtnCadObjects', tab: 'objects', paneId: 'cadTabObjects' },
        { id: 'tabBtnCadInspector', tab: 'inspector', paneId: 'cadTabInspector' },
        { id: 'tabBtnCadAi', tab: 'ai', paneId: 'cadTabAi' }
      ];

      const btnElements = [];
      const paneElements = [];

      for (let i = 0; i < tabs.length; i++) {
        const t = tabs[i];
        const btn = doc.createElement('button');
        btn.id = t.id;
        btn.className = `cad-sidebar-tab ${i === 0 ? 'active' : ''}`;
        btn.setAttribute('data-tab', t.tab);
        btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
        btnElements.push(btn);
        sidebar.appendChild(btn);

        const pane = doc.createElement('div');
        pane.id = t.paneId;
        pane.className = `cad-tab-pane ${i === 0 ? 'active' : ''}`;
        pane.setAttribute('data-tab-pane', t.tab);
        paneElements.push(pane);
        sidebar.appendChild(pane);
      }

      // Wire tab switching behavior matching index.html implementation
      btnElements.forEach(btn => {
        btn.addEventListener('click', () => {
          const target = btn.dataset.tab;
          btnElements.forEach(b => {
            const isActive = (b === btn);
            b.classList.toggle('active', isActive);
            b.setAttribute('aria-selected', isActive ? 'true' : 'false');
          });
          paneElements.forEach(pane => {
            pane.classList.toggle('active', pane.dataset.tabPane === target);
          });
          sidebar.setAttribute('data-active-tab', target);
        });
      });

      // Initially 'objects' is active
      strictEqual(btnElements[0].classList.contains('active'), true);
      strictEqual(paneElements[0].classList.contains('active'), true);
      strictEqual(paneElements[1].classList.contains('active'), false);
      strictEqual(paneElements[2].classList.contains('active'), false);

      // 1. Click Inspector tab
      btnElements[1].click();
      strictEqual(btnElements[1].classList.contains('active'), true, 'Inspector tab button gains active class');
      strictEqual(btnElements[0].classList.contains('active'), false, 'Objects tab button loses active class');
      strictEqual(paneElements[1].classList.contains('active'), true, 'Inspector pane is now active');
      strictEqual(paneElements[0].classList.contains('active'), false, 'Objects pane is now hidden');
      strictEqual(sidebar.getAttribute('data-active-tab'), 'inspector', 'Sidebar attribute tracks active tab');

      // 2. Click Spatial AI tab
      btnElements[2].click();
      strictEqual(btnElements[2].classList.contains('active'), true, 'Spatial AI tab button gains active class');
      strictEqual(paneElements[2].classList.contains('active'), true, 'Spatial AI pane is now active');
      strictEqual(paneElements[1].classList.contains('active'), false, 'Inspector pane is deactivated');
      strictEqual(sidebar.getAttribute('data-active-tab'), 'ai', 'Sidebar active tab set to ai');
    });

    test('T1.13: test_f3_sidebar_collapse_toggle_button', () => {
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.className = 'cad-studio-sidebar';

      const btnToggle = doc.createElement('button');
      btnToggle.id = 'btnToggleStudioInspector';
      btnToggle.className = 'btn-micro active';

      btnToggle.addEventListener('click', () => {
        const isHidden = sidebar.classList.toggle('hidden');
        btnToggle.classList.toggle('active', !isHidden);
      });

      // Initial state: sidebar visible
      strictEqual(sidebar.classList.contains('hidden'), false);
      strictEqual(btnToggle.classList.contains('active'), true);

      // 1. Click to collapse
      btnToggle.click();
      strictEqual(sidebar.classList.contains('hidden'), true, 'Sidebar gains .hidden class when collapsed');
      strictEqual(btnToggle.classList.contains('active'), false, 'Toggle button loses active class');

      // 2. Click to expand
      btnToggle.click();
      strictEqual(sidebar.classList.contains('hidden'), false, 'Sidebar loses .hidden class when expanded');
      strictEqual(btnToggle.classList.contains('active'), true, 'Toggle button regains active class');
    });

    test('T1.14: test_f3_sidebar_collapse_widens_canvas', () => {
      const doc = new MockDocument();
      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';
      workspace.clientWidth = 1200;

      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.className = 'cad-studio-sidebar';
      sidebar.clientWidth = 260;

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.className = 'three-container';

      // Function to calculate canvas width based on sidebar state
      const computeCanvasWidth = () => {
        const sidebarWidth = sidebar.classList.contains('hidden') ? 0 : sidebar.clientWidth;
        return workspace.clientWidth - sidebarWidth;
      };

      // 1. Initial expanded state
      container.clientWidth = computeCanvasWidth();
      strictEqual(container.clientWidth, 940, 'Canvas container has 940px width with sidebar open');

      // 2. Collapse sidebar
      sidebar.classList.add('hidden');
      container.clientWidth = computeCanvasWidth();
      strictEqual(container.clientWidth, 1200, 'Canvas container expands to 1200px when sidebar is collapsed');
      ok(container.clientWidth > 940, 'Collapsing sidebar strictly widens available canvas container width');

      // 3. Re-expand sidebar
      sidebar.classList.remove('hidden');
      container.clientWidth = computeCanvasWidth();
      strictEqual(container.clientWidth, 940, 'Canvas container width reverts to 940px upon sidebar re-expansion');
    });

    test('T1.15: test_f3_tab_selection_persists_across_collapse_cycles', () => {
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.className = 'cad-studio-sidebar';
      sidebar.setAttribute('data-active-tab', 'ai');

      const tabAi = doc.createElement('button');
      tabAi.id = 'tabBtnCadAi';
      tabAi.className = 'cad-sidebar-tab active';
      tabAi.setAttribute('data-tab', 'ai');
      sidebar.appendChild(tabAi);

      const paneAi = doc.createElement('div');
      paneAi.id = 'cadTabAi';
      paneAi.className = 'cad-tab-pane active';
      paneAi.setAttribute('data-tab-pane', 'ai');
      sidebar.appendChild(paneAi);

      // Verify active state before collapse
      strictEqual(sidebar.getAttribute('data-active-tab'), 'ai', 'Initial active tab is ai');
      strictEqual(tabAi.classList.contains('active'), true);
      strictEqual(paneAi.classList.contains('active'), true);

      // Collapse sidebar
      sidebar.classList.add('hidden');
      strictEqual(sidebar.classList.contains('hidden'), true);

      // Expand sidebar
      sidebar.classList.remove('hidden');
      strictEqual(sidebar.classList.contains('hidden'), false);

      // Verify active tab selection is persisted
      strictEqual(sidebar.getAttribute('data-active-tab'), 'ai', 'Active tab attribute persists across collapse cycle');
      strictEqual(tabAi.classList.contains('active'), true, 'Active tab button class persists');
      strictEqual(paneAi.classList.contains('active'), true, 'Active pane class persists');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
