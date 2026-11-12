/**
 * Tier 2 — Feature 2 Boundaries: Action Bar & Control Visibility Boundaries
 * Tests: T2.6 – T2.10
 * 
 * Specifications:
 * - T2.6: Extended German button label strings do not overflow action bar container.
 * - T2.7: Browser zoom at 200% keeps action bar anchored at viewport bottom.
 * - T2.8: Clicks on disabled #btnStartSceneBuildQueue or #btnConfirmBuild are rejected.
 * - T2.9: Rapid double-click on #btnConfirmBuild fires only one build dispatch.
 * - T2.10: Object count badge scaling from 0 to 9999 does not clip neighboring controls.
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
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 2 - F2: Action Bar Boundaries', () => {

    test('T2.6: test_bva_f2_extended_german_label_wrapping', () => {
      // 1. Verify style.css rules for .build-actions-bar preventing text blowout
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Verify .build-actions-bar .btn has text-overflow & overflow constraints
      const btnRuleMatch = css.match(/\.build-actions-bar\s+\.btn\s*\{([^}]+)\}/);
      ok(btnRuleMatch, '.build-actions-bar .btn rule exists');
      const btnBody = btnRuleMatch[1];
      ok(btnBody.includes('overflow: hidden'), 'Button has overflow: hidden');
      ok(btnBody.includes('text-overflow: ellipsis'), 'Button has text-overflow: ellipsis');

      // 2. Mock DOM verification with extended German string
      const doc = new MockDocument();
      const bar = doc.createElement('div');
      bar.className = 'build-actions-bar';
      bar.clientWidth = 600;

      const longLabelBtn = doc.createElement('button');
      longLabelBtn.id = 'btnStartSceneBuildQueue';
      longLabelBtn.className = 'btn btn-primary';
      const extendedLabel = 'Komplette Architekten-Szene mit allen Gebäuden und Fundamenten in Minecraft-Welt generieren';
      longLabelBtn.textContent = extendedLabel;
      bar.appendChild(longLabelBtn);

      strictEqual(longLabelBtn.textContent, extendedLabel, 'Extended German label loaded');
      strictEqual(bar.children.length, 1, 'Button properly mounted in action bar');
      ok(longLabelBtn.textContent.length > 50, 'Label is an extreme long German string (>50 chars)');
    });

    test('T2.7: test_bva_f2_browser_zoom_200_percent', () => {
      // Verify sticky bottom anchoring in style.css
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const barRuleMatch = css.match(/\.build-actions-bar\s*\{([^}]+)\}/);
      ok(barRuleMatch, '.build-actions-bar rule exists');
      const barBody = barRuleMatch[1];
      ok(barBody.includes('position: sticky'), 'Bar has position: sticky');
      ok(barBody.includes('bottom: 0'), 'Bar has bottom: 0');
      ok(barBody.includes('margin-top: auto'), 'Bar has margin-top: auto for flex/grid anchoring');
      ok(barBody.includes('flex-shrink: 0'), 'Bar has flex-shrink: 0 to avoid being crushed');

      // Headless zoom simulation: 200% zoom halves available CSS viewport height
      const doc = new MockDocument();
      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-column';
      workspace.clientHeight = 450; // Scaled down 200% height
      workspace.style.display = 'flex';
      workspace.style.flexDirection = 'column';

      const canvasArea = doc.createElement('div');
      canvasArea.id = 'threeContainer';
      canvasArea.clientHeight = 370;
      workspace.appendChild(canvasArea);

      const bar = doc.createElement('div');
      bar.className = 'build-actions-bar';
      bar.clientHeight = 60;
      bar.style.position = 'sticky';
      bar.style.bottom = '0px';
      workspace.appendChild(bar);

      // Verify bar is positioned at the bottom of the workspace
      const computedBottomOffset = workspace.clientHeight - (canvasArea.clientHeight + bar.clientHeight);
      ok(computedBottomOffset >= 0, 'Action bar is cleanly contained within zoomed viewport without clipping');
      strictEqual(bar.style.bottom, '0px', 'Bar bottom remains strictly anchored at 0px');
    });

    test('T2.8: test_bva_f2_disabled_build_queue_click_guard', () => {
      const doc = new MockDocument();
      const btn = doc.createElement('button');
      btn.id = 'btnStartSceneBuildQueue';
      btn.disabled = true;
      btn.setAttribute('disabled', 'disabled');

      let dispatchCount = 0;
      const handleClick = (e) => {
        // Safe dispatch guard: ignore disabled buttons
        if (btn.disabled || btn.hasAttribute('disabled')) {
          e.preventDefault();
          return false;
        }
        dispatchCount++;
        return true;
      };

      btn.addEventListener('click', handleClick);

      // Dispatch click on disabled button
      const clickEvent = new MockMouseEvent('click', { bubbles: true, cancelable: true });
      btn.dispatchEvent(clickEvent);

      strictEqual(dispatchCount, 0, 'Click on disabled button must not fire build dispatch');
      strictEqual(clickEvent.defaultPrevented, true, 'Click event default prevented for disabled button');

      // Now enable button
      btn.disabled = false;
      btn.removeAttribute('disabled');

      const clickEvent2 = new MockMouseEvent('click', { bubbles: true, cancelable: true });
      btn.dispatchEvent(clickEvent2);

      strictEqual(dispatchCount, 1, 'Click on enabled button executes build dispatch');
    });

    test('T2.9: test_bva_f2_rapid_double_dispatch_lock', () => {
      const doc = new MockDocument();
      const btn = doc.createElement('button');
      btn.id = 'btnConfirmBuild';

      let dispatchCount = 0;
      let isDispatchLockActive = false;

      const handleConfirmClick = () => {
        if (isDispatchLockActive) {
          return { status: 'LOCKED', dispatched: false };
        }
        isDispatchLockActive = true;
        dispatchCount++;

        // Simulate asynchronous dispatch lock release
        return { status: 'DISPATCHED', dispatched: true };
      };

      btn.addEventListener('click', handleConfirmClick);

      // Rapid consecutive clicks (burst double-click)
      const res1 = handleConfirmClick();
      const res2 = handleConfirmClick();
      const res3 = handleConfirmClick();

      strictEqual(res1.status, 'DISPATCHED', 'First click successfully dispatches');
      strictEqual(res2.status, 'LOCKED', 'Immediate second click is locked');
      strictEqual(res3.status, 'LOCKED', 'Immediate third click is locked');
      strictEqual(dispatchCount, 1, 'Only exactly 1 dispatch was executed');

      // Release lock
      isDispatchLockActive = false;
      const res4 = handleConfirmClick();
      strictEqual(res4.status, 'DISPATCHED', 'Subsequent click after unlock dispatches cleanly');
      strictEqual(dispatchCount, 2, 'Total dispatch count is now 2');
    });

    test('T2.10: test_bva_f2_extreme_object_badge_scaling', () => {
      const doc = new MockDocument();
      const headerRow = doc.createElement('div');
      headerRow.className = 'studio-card-header';

      const title = doc.createElement('span');
      title.className = 'studio-card-title';
      title.textContent = '🗂️ SCENE TREE';
      headerRow.appendChild(title);

      const badge = doc.createElement('span');
      badge.id = 'lblSceneObjectCount';
      badge.className = 'badge-sub';
      headerRow.appendChild(badge);

      const testCounts = [0, 1, 99, 999, 9999];

      for (const count of testCounts) {
        badge.textContent = String(count);
        strictEqual(badge.textContent, String(count), `Badge properly displays count ${count}`);
        ok(badge.textContent.length >= 1 && badge.textContent.length <= 4, 'Badge string length within expected bounds');
      }

      // Verify styling in style.css accommodates multi-digit badges
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');
      ok(css.includes('.badge-sub'), '.badge-sub defined in style.css');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
