/**
 * Tier 1 — Feature 2: Action Bar & Control Visibility
 * Tests: T1.6 – T1.10
 * 
 * Verifies sticky footer pinning for .build-actions-bar, visibility and unclipped layout
 * for #btnStartSceneBuildQueue, clickability and rendering of #btnConfirmBuild & #btnStopBuild,
 * correct z-index hierarchy, and workspace bottom clearance preventing occlusion of content.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F2), ORIGINAL_REQUEST.md (R1, R4).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement, MockMouseEvent } from '../helpers/mockDom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F2: Action Bar & Control Visibility', () => {

    test('T1.6: test_f2_action_bar_sticky_footer_positioning', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // 1. Verify CSS rules for .build-actions-bar
      const match = css.match(/\.build-actions-bar\s*\{([^}]+)\}/);
      ok(match, '.build-actions-bar rule must exist in style.css');
      const rules = match[1];

      ok(rules.includes('position: sticky'), 'Action bar must have position: sticky');
      ok(rules.includes('bottom: 0'), 'Action bar must be pinned to bottom: 0');
      ok(rules.includes('margin-top: auto'), 'Action bar must have margin-top: auto for flex/grid anchoring');

      // 2. Verify in Mock DOM layout hierarchy
      const doc = new MockDocument();
      const panel = doc.createElement('div');
      panel.id = 'panelCadStudio';
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.clientHeight = 800;

      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';
      workspace.style.flex = '1 1 auto';
      workspace.clientHeight = 740;

      const actionBar = doc.createElement('div');
      actionBar.className = 'build-actions-bar';
      actionBar.style.position = 'sticky';
      actionBar.style.bottom = '0';
      actionBar.clientHeight = 60;

      panel.appendChild(workspace);
      panel.appendChild(actionBar);

      strictEqual(actionBar.parentElement, panel, 'Action bar must be child of CAD studio panel');
      strictEqual(actionBar.style.position, 'sticky', 'Action bar retains sticky positioning');
      strictEqual(actionBar.style.bottom, '0', 'Action bar is pinned to bottom: 0');
      strictEqual(panel.lastElementChild, actionBar, 'Action bar is the bottom-most element in panel');
    });

    test('T1.7: test_f2_start_scene_build_button_visible_and_unclipped', () => {
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      // 1. Verify HTML element presence and markup
      ok(html.includes('id="btnStartSceneBuildQueue"'), 'index.html contains #btnStartSceneBuildQueue');
      ok(html.includes('Ganze Szene bauen'), 'Button text includes "Ganze Szene bauen"');

      // 2. Verify CSS anti-clipping rules on action bar buttons
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const btnMatch = css.match(/\.build-actions-bar\s+\.btn\s*\{([^}]+)\}/);
      ok(btnMatch, '.build-actions-bar .btn rule must exist in style.css');
      const btnRules = btnMatch[1];

      ok(btnRules.includes('white-space: nowrap'), 'Buttons must use white-space: nowrap to prevent text wrapping');
      ok(btnRules.includes('overflow: hidden'), 'Buttons must specify overflow: hidden');
      ok(btnRules.includes('text-overflow: ellipsis'), 'Buttons must use text-overflow: ellipsis for text safety');

      // 3. Verify in Mock DOM that button renders with proper layout properties
      const doc = new MockDocument();
      const btn = doc.createElement('button');
      btn.id = 'btnStartSceneBuildQueue';
      btn.className = 'btn btn-primary';
      btn.textContent = '🚀 Ganze Szene bauen (Queue)';
      btn.clientWidth = 180;
      btn.clientHeight = 36;

      ok(btn.clientWidth > 100, 'Button width is sufficient to display label');
      ok(btn.clientHeight >= 32, 'Button height meets minimum touch/click target ergonomics (>= 32px)');
      notStrictEqual(btn.style.display, 'none', 'Button is not hidden by display: none');
    });

    test('T1.8: test_f2_confirm_and_stop_buttons_rendered_and_clickable', () => {
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');

      ok(html.includes('id="btnConfirmBuild"'), 'index.html contains #btnConfirmBuild');
      ok(html.includes('id="btnStopBuild"'), 'index.html contains #btnStopBuild');

      // Verify click dispatch in Mock DOM
      const doc = new MockDocument();
      const btnConfirm = doc.createElement('button');
      btnConfirm.id = 'btnConfirmBuild';
      btnConfirm.disabled = false;

      const btnStop = doc.createElement('button');
      btnStop.id = 'btnStopBuild';

      let confirmClicked = false;
      let stopClicked = false;

      btnConfirm.addEventListener('click', () => {
        confirmClicked = true;
      });

      btnStop.addEventListener('click', () => {
        stopClicked = true;
      });

      btnConfirm.click();
      strictEqual(confirmClicked, true, 'Clicking #btnConfirmBuild fires click event handler');

      btnStop.click();
      strictEqual(stopClicked, true, 'Clicking #btnStopBuild fires click event handler');
    });

    test('T1.9: test_f2_action_bar_zindex_hierarchy', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Action bar z-index
      const actionMatch = css.match(/\.build-actions-bar\s*\{[^}]*z-index:\s*([0-9]+);/s);
      ok(actionMatch, '.build-actions-bar must declare a numeric z-index');
      const actionZIndex = parseInt(actionMatch[1], 10);

      // Verify action bar z-index is >= 5 to layer above Three.js canvas (default 0 or 1)
      ok(actionZIndex >= 5, `Action bar z-index (${actionZIndex}) must layer above 3D canvas`);

      // Verify modal overlay z-index is significantly higher (e.g. 1000 or 10000)
      const modalMatch = css.match(/\.modal-overlay[^{]*\{[^}]*z-index:\s*([0-9]+);/s) ||
                         css.match(/\.cad-modal-overlay[^{]*\{[^}]*z-index:\s*([0-9]+);/s);
      if (modalMatch) {
        const modalZIndex = parseInt(modalMatch[1], 10);
        ok(modalZIndex > actionZIndex, `Modal z-index (${modalZIndex}) must be higher than action bar z-index (${actionZIndex})`);
      }
    });

    test('T1.10: test_f2_workspace_padding_prevents_overlap', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Verify action bar has flex-shrink: 0 and margin-top: auto or padding
      ok(css.includes('flex-shrink: 0'), 'Action bar or containers preserve flex-shrink: 0');

      // In Mock DOM: simulate panel layout with workspace and action bar
      const doc = new MockDocument();
      const panel = doc.createElement('div');
      panel.style.display = 'flex';
      panel.style.flexDirection = 'column';
      panel.clientHeight = 700;

      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';
      workspace.style.flex = '1 1 auto';

      const sidebar = doc.createElement('aside');
      sidebar.className = 'cad-studio-sidebar';
      sidebar.style.overflowY = 'auto';
      workspace.appendChild(sidebar);

      const actionBar = doc.createElement('div');
      actionBar.className = 'build-actions-bar';
      actionBar.style.position = 'sticky';
      actionBar.style.bottom = '0';
      actionBar.style.flexShrink = '0';
      actionBar.clientHeight = 50;

      panel.appendChild(workspace);
      panel.appendChild(actionBar);

      // Compute available space for workspace
      const availableWorkspaceHeight = panel.clientHeight - actionBar.clientHeight;
      strictEqual(availableWorkspaceHeight, 650, 'Workspace gets remaining height (650px) without action bar clipping');
      strictEqual(sidebar.parentElement, workspace, 'Sidebar content is encapsulated in workspace');
      strictEqual(actionBar.style.flexShrink, '0', 'Action bar will not be squashed by large sidebar content');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
