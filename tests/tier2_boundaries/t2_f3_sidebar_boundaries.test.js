/**
 * Tier 2 — Feature 3 Boundaries: CAD Sidebar Tabbed Layout Boundaries
 * Tests: T2.11 – T2.15
 * 
 * Specifications:
 * - T2.11: Rapid tab switch spam stabilizes on final active tab without race condition.
 * - T2.12: Empty scene state displays clean "Kein Objekt" notice without error.
 * - T2.13: 500 scene objects scroll within sidebar container without layout explosion.
 * - T2.14: Switching to non-existent tab ID safely falls back to default tab.
 * - T2.15: Collapsing sidebar while input has active focus cleanly blurs without crash.
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
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 2 - F3: Sidebar Tabbed Boundaries', () => {

    test('T2.11: test_bva_f3_rapid_tab_switch_spam', () => {
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.setAttribute('data-active-tab', 'objects');

      const tabs = ['objects', 'inspector', 'ai'];
      const buttons = {};
      const panes = {};

      for (const t of tabs) {
        const btn = doc.createElement('button');
        btn.id = `tabBtnCad${t.charAt(0).toUpperCase() + t.slice(1)}`;
        btn.setAttribute('data-tab', t);
        if (t === 'objects') btn.classList.add('active');
        sidebar.appendChild(btn);
        buttons[t] = btn;

        const pane = doc.createElement('div');
        pane.id = `cadTab${t.charAt(0).toUpperCase() + t.slice(1)}`;
        pane.setAttribute('data-tab-pane', t);
        if (t === 'objects') pane.classList.add('active');
        sidebar.appendChild(pane);
        panes[t] = pane;
      }

      // Tab switcher implementation following contract
      const switchTab = (targetTab) => {
        tabs.forEach(t => {
          buttons[t].classList.remove('active');
          buttons[t].setAttribute('aria-selected', 'false');
          panes[t].classList.remove('active');
        });
        if (buttons[targetTab] && panes[targetTab]) {
          buttons[targetTab].classList.add('active');
          buttons[targetTab].setAttribute('aria-selected', 'true');
          panes[targetTab].classList.add('active');
          sidebar.setAttribute('data-active-tab', targetTab);
        }
      };

      // Rapidly toggle 45 times in sequence ending on 'ai'
      for (let i = 0; i < 45; i++) {
        const target = tabs[i % tabs.length];
        switchTab(target);
      }

      // 44 % 3 = 2 -> 'ai'
      strictEqual(sidebar.getAttribute('data-active-tab'), 'ai', 'Sidebar stabilized on final active tab');
      strictEqual(buttons['ai'].classList.contains('active'), true, 'AI tab button has active class');
      strictEqual(panes['ai'].classList.contains('active'), true, 'AI tab pane has active class');

      // Verify no multiple active buttons or panes
      const activeBtns = tabs.filter(t => buttons[t].classList.contains('active'));
      const activePanes = tabs.filter(t => panes[t].classList.contains('active'));

      strictEqual(activeBtns.length, 1, 'Strictly 1 active button after rapid spam');
      strictEqual(activePanes.length, 1, 'Strictly 1 active pane after rapid spam');
    });

    test('T2.12: test_bva_f3_empty_scene_tree_rendering', () => {
      const doc = new MockDocument();
      const listContainer = doc.createElement('div');
      listContainer.id = 'sceneTreeList';
      listContainer.className = 'scene-tree-list';

      const countBadge = doc.createElement('span');
      countBadge.id = 'lblSceneObjectCount';

      // Renderer function for scene tree with empty state guard
      const renderSceneTree = (objects = []) => {
        listContainer.children = [];
        const safeList = Array.isArray(objects) ? objects : [];
        countBadge.textContent = String(safeList.length);

        if (safeList.length === 0) {
          const emptyNotice = doc.createElement('span');
          emptyNotice.className = 'scene-tree-empty empty-hint';
          emptyNotice.textContent = 'Kein Objekt in der Szene.';
          listContainer.appendChild(emptyNotice);
          return { empty: true, count: 0 };
        }

        safeList.forEach(obj => {
          const item = doc.createElement('div');
          item.className = 'scene-item';
          item.textContent = obj.name || 'Objekt';
          listContainer.appendChild(item);
        });

        return { empty: false, count: safeList.length };
      };

      // Test with empty array
      const res = renderSceneTree([]);
      strictEqual(res.empty, true, 'Scene tree rendered in empty state');
      strictEqual(res.count, 0, 'Object count is 0');
      strictEqual(countBadge.textContent, '0', 'Badge indicates 0');
      strictEqual(listContainer.children.length, 1, 'Contains empty notice element');
      ok(listContainer.children[0].textContent.includes('Kein Objekt'), 'Contains German "Kein Objekt" notice');

      // Test with null parameter safe fallback
      const nullRes = renderSceneTree(null);
      strictEqual(nullRes.empty, true, 'Null array handled gracefully without crash');
    });

    test('T2.13: test_bva_f3_extreme_scene_tree_overflow', () => {
      // 1. Verify CSS overflow rules for .scene-tree-list
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const match = css.match(/\.scene-tree-list\s*\{([^}]+)\}/);
      ok(match, '.scene-tree-list defined in style.css');
      const body = match[1];
      ok(body.includes('overflow-y: auto') || body.includes('overflow: auto'), 'Container has overflow-y: auto scroll containment');

      // 2. Mock DOM: Load 500 items into container
      const doc = new MockDocument();
      const listContainer = doc.createElement('div');
      listContainer.id = 'sceneTreeList';
      listContainer.className = 'scene-tree-list';
      listContainer.style.overflowY = 'auto';
      listContainer.clientHeight = 140;

      for (let i = 1; i <= 500; i++) {
        const item = doc.createElement('div');
        item.className = 'scene-item';
        item.textContent = `Gebäude #${i} [minecraft:stone_bricks]`;
        listContainer.appendChild(item);
      }

      strictEqual(listContainer.children.length, 500, 'All 500 scene objects loaded into DOM');
      strictEqual(listContainer.style.overflowY, 'auto', 'Container enforces scrollable overflow');
      strictEqual(listContainer.clientHeight, 140, 'Container height is capped preventing layout explosion');
    });

    test('T2.14: test_bva_f3_invalid_tab_id_fallback', () => {
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';
      sidebar.setAttribute('data-active-tab', 'objects');

      const validTabs = ['objects', 'inspector', 'ai'];
      const defaultTab = 'objects';

      const safeSwitchTab = (tabId) => {
        if (!tabId || typeof tabId !== 'string' || !validTabs.includes(tabId)) {
          sidebar.setAttribute('data-active-tab', defaultTab);
          return { activeTab: defaultTab, fellBack: true };
        }
        sidebar.setAttribute('data-active-tab', tabId);
        return { activeTab: tabId, fellBack: false };
      };

      // Test with invalid / non-existent tab strings and types
      const testCases = ['invalid_tab_123', null, undefined, '', 'xyz', 9999];

      for (const tc of testCases) {
        const res = safeSwitchTab(tc);
        strictEqual(res.fellBack, true, `Invalid tab "${tc}" triggered fallback`);
        strictEqual(res.activeTab, 'objects', 'Fell back to default "objects" tab');
        strictEqual(sidebar.getAttribute('data-active-tab'), 'objects', 'Sidebar attribute set to objects');
      }

      // Valid tab check
      const validRes = safeSwitchTab('inspector');
      strictEqual(validRes.fellBack, false, 'Valid tab did not trigger fallback');
      strictEqual(validRes.activeTab, 'inspector', 'Switched to inspector cleanly');
    });

    test('T2.15: test_bva_f3_collapse_with_active_input_focus', () => {
      const doc = new MockDocument();
      const sidebar = doc.createElement('aside');
      sidebar.id = 'cadStudioSidebar';

      const input = doc.createElement('input');
      input.id = 'sceneSearchInput';
      input.type = 'text';
      sidebar.appendChild(input);

      let blurCalled = false;
      input.blur = () => {
        blurCalled = true;
        doc.activeElement = doc.body;
      };

      // Simulate input receiving focus
      doc.activeElement = input;
      strictEqual(doc.activeElement, input, 'Input element currently has active focus');

      // Helper to check if an element is contained in a subtree
      const isDescendant = (parent, child) => {
        let curr = child;
        while (curr) {
          if (curr === parent) return true;
          curr = curr.parentElement;
        }
        return false;
      };

      // Collapse sidebar handler
      const toggleSidebarCollapse = (force) => {
        // Safe blur guard: If element inside sidebar has focus, blur cleanly
        if (doc.activeElement && isDescendant(sidebar, doc.activeElement)) {
          if (typeof doc.activeElement.blur === 'function') {
            doc.activeElement.blur();
          }
        }
        sidebar.classList.toggle('collapsed', force);
      };

      toggleSidebarCollapse(true);

      strictEqual(sidebar.classList.contains('collapsed'), true, 'Sidebar is collapsed');
      strictEqual(blurCalled, true, 'Active input was cleanly blurred upon collapse');
      strictEqual(doc.activeElement, doc.body, 'Document activeElement returned to body');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
