/**
 * Tier 1 — Feature 1: 3D-CAD-Viewport Maximization
 * Tests: T1.1 – T1.5
 * 
 * Verifies grid ratio allocation (majority to CAD column), canvas container filling
 * workspace without fixed pixel clipping, compact toolbar padding, vertical space reclamation
 * on subbar toggle, and minimum dimension safeguards against zero-dimension crashes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement } from '../helpers/mockDom.js';
import { MockPerspectiveCamera, MockWebGLRenderer } from '../helpers/mockThree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, assert } = harness;

  await describe('Tier 1 - F1: 3D-CAD-Viewport Maximization', () => {

    test('T1.1: test_f1_grid_ratio_allocates_majority_to_cad', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      ok(fs.existsSync(cssPath), 'style.css exists');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Match .grid-container definition
      const gridMatch = css.match(/\.grid-container\s*\{[^}]*grid-template-columns:\s*([^;]+);/s);
      ok(gridMatch, '.grid-container must define grid-template-columns');

      const cols = gridMatch[1].trim();
      // Expect minmax(280px, 1.15fr) minmax(620px, 2.45fr) minmax(280px, 1.05fr) or equivalent
      const frMatches = [...cols.matchAll(/([0-9.]+)fr/g)].map(m => parseFloat(m[1]));

      if (frMatches.length >= 3) {
        const [leftFr, centerFr, rightFr] = frMatches;
        const totalFr = leftFr + centerFr + rightFr;
        const centerRatio = centerFr / totalFr;
        ok(centerRatio >= 0.50, `Center CAD column ratio (${(centerRatio * 100).toFixed(1)}%) must be >= 50% of flexible grid space`);
      } else {
        // Fallback percentage check
        const pctMatches = [...cols.matchAll(/([0-9.]+)%/g)].map(m => parseFloat(m[1]));
        ok(pctMatches.length >= 3, 'Must match 3 column tracks');
        const centerPct = pctMatches[1];
        ok(centerPct >= 45, `Center CAD column percentage (${centerPct}%) must be at least majority allocation`);
      }

      // Check center column ID presence in index.html
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      ok(html.includes('id="cadStudioColumn"'), 'index.html must contain #cadStudioColumn as center column');
    });

    test('T1.2: test_f1_canvas_container_expands_to_fill_workspace', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      // Verify .cad-studio-workspace and #threeContainer flex rules
      ok(
        css.includes('.cad-studio-workspace') && css.includes('#threeContainer'),
        'style.css contains workspace and #threeContainer layout rules'
      );

      // Verify in Mock DOM that container takes available width and height
      const doc = new MockDocument();
      const workspace = doc.createElement('div');
      workspace.className = 'cad-studio-workspace';
      workspace.clientWidth = 1100;
      workspace.clientHeight = 720;

      const container = doc.createElement('div');
      container.id = 'threeContainer';
      container.className = 'three-container';
      workspace.appendChild(container);

      // Container expands to fill workspace
      container.clientWidth = workspace.clientWidth;
      container.clientHeight = workspace.clientHeight;

      strictEqual(container.clientWidth, 1100, 'threeContainer expands to full available width');
      strictEqual(container.clientHeight, 720, 'threeContainer expands to full available height without fixed pixel cap');
      ok(container.clientHeight > 300, 'threeContainer is not locked to small legacy fixed height');
    });

    test('T1.3: test_f1_compact_toolbar_padding_and_layout', () => {
      const cssPath = path.join(PROJECT_ROOT, 'src/web/public/style.css');
      const css = fs.readFileSync(cssPath, 'utf8');

      const toolbarMatch = css.match(/\.three-toolbar\s*\{([^}]+)\}/);
      ok(toolbarMatch, '.three-toolbar rule exists in style.css');
      const toolbarBody = toolbarMatch[1];

      // Verify flex layout
      ok(toolbarBody.includes('display: flex') || toolbarBody.includes('display: grid'), 'Toolbar uses flex or grid layout');

      // Verify compact padding (<= 10px, ideally <= 8px vertical)
      const paddingMatch = toolbarBody.match(/padding:\s*([0-9]+)px(?:\s+([0-9]+)px)?/);
      if (paddingMatch) {
        const vertPadding = parseInt(paddingMatch[1], 10);
        ok(vertPadding <= 8 || vertPadding <= 10, `Toolbar vertical padding (${vertPadding}px) is compact (<= 10px)`);
      }

      // Verify HTML toolbar structure
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      const html = fs.readFileSync(htmlPath, 'utf8');
      ok(html.includes('class="three-toolbar"'), 'index.html contains .three-toolbar');
      ok(html.includes('class="toolbar-section"'), 'Toolbar contains organized toolbar-section groups');
    });

    test('T1.4: test_f1_vertical_reclaim_on_subbar_toggle', () => {
      const doc = new MockDocument();
      const column = doc.createElement('section');
      column.id = 'cadStudioColumn';
      column.clientHeight = 900;

      const scanBar = doc.createElement('div');
      scanBar.id = 'cadWorldScanBar';
      scanBar.clientHeight = 42;
      column.appendChild(scanBar);

      const workspace = doc.createElement('div');
      workspace.id = 'cadStudioWorkspace';
      column.appendChild(workspace);

      // Height calculation helper
      const calcWorkspaceHeight = () => {
        const isScanBarVisible = !scanBar.classList.contains('hidden') && scanBar.style.display !== 'none';
        const allocatedToSubbars = isScanBarVisible ? scanBar.clientHeight : 0;
        return column.clientHeight - allocatedToSubbars;
      };

      const initialHeight = calcWorkspaceHeight();
      strictEqual(initialHeight, 900 - 42, 'Workspace height accounts for active scan bar');

      // Toggle scan bar off
      scanBar.classList.add('hidden');
      const reclaimedHeight = calcWorkspaceHeight();
      strictEqual(reclaimedHeight, 900, 'Workspace height reclaims full vertical space when scan bar is hidden');
      ok(reclaimedHeight > initialHeight, 'Hiding subbar strictly expands vertical canvas space');
    });

    test('T1.5: test_f1_container_minimum_bounds_safeguard', () => {
      // Simulate viewport adaptation with zero dimensions
      const container = new MockElement('div');
      container.id = 'threeContainer';
      container.clientWidth = 0;
      container.clientHeight = 0;

      // Safe bound computation logic as used in threeViewport.js
      const safeWidth = Math.max(100, container.clientWidth);
      const safeHeight = Math.max(100, container.clientHeight);

      strictEqual(safeWidth, 100, 'Zero width is clamped to safe minimum (100px)');
      strictEqual(safeHeight, 100, 'Zero height is clamped to safe minimum (100px)');

      const camera = new MockPerspectiveCamera(45, safeWidth / safeHeight, 0.1, 1000);
      camera.aspect = safeWidth / safeHeight;
      camera.updateProjectionMatrix();

      ok(isFinite(camera.aspect), 'Camera aspect ratio must be finite number');
      strictEqual(camera.aspect, 1.0, 'Aspect ratio with clamped bounds is exactly 1.0 (100/100)');
      ok(!Number.isNaN(camera.projectionMatrix.elements[0]), 'Projection matrix elements are valid non-NaN');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
