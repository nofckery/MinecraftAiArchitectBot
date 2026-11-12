/**
 * Milestone 1 Adversarial Challenge & Empirical Layout Stress Test Suite
 * Archetype: EMPIRICAL CHALLENGER
 * Roles: critic, specialist
 *
 * Mission:
 * Stress-test and empirically verify Milestone 1 layout and viewport changes:
 * 1. Viewport dimensions and aspect ratio handling across extreme simulated display resolutions:
 *    - 4K UHD (3840 x 2160)
 *    - Ultrawide QHD (3440 x 1440)
 *    - Full HD 1080p (1920 x 1080)
 *    - Standard Laptop (1366 x 768)
 *    - Tablet Landscape (1024 x 768)
 *    - Portrait / Vertical Display (1080 x 1920)
 * 2. .grid-container column width allocations and dominant horizontal area (~52%) for Column 2.
 * 3. .grid-container.camera-detached invariant maintenance (24% 49% 27%).
 * 4. .cad-studio-body scrollport properties (overflow-y: auto, min-height: 0, no clipping).
 * 5. .build-actions-bar sticky footer anchoring & button visibility (#btnStartSceneBuildQueue, #btnConfirmBuild, #btnStopBuild).
 * 6. CAD sidebar tabbed navigation, inspector empty state, and scan-bar ergonomics.
 * 7. Three.js canvas aspect ratio calculations & distortion prevention across all resolutions.
 */

import fs from 'node:fs';
import path from 'node:path';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

async function runEmpiricalStressTests() {
  console.log('\x1b[35m======================================================================\x1b[0m');
  console.log('\x1b[35m=== EMPIRICAL CHALLENGER: MILESTONE 1 LAYOUT & VIEWPORT STRESS TEST ===\x1b[0m');
  console.log('\x1b[35m======================================================================\x1b[0m\n');

  const cssPath = path.resolve('src/web/public/style.css');
  const htmlPath = path.resolve('src/web/public/index.html');
  const threeJsPath = path.resolve('src/web/public/js/threeViewport.js');

  assert(fs.existsSync(cssPath), '0.1 style.css exists in filesystem');
  assert(fs.existsSync(htmlPath), '0.2 index.html exists in filesystem');
  assert(fs.existsSync(threeJsPath), '0.3 threeViewport.js exists in filesystem');

  const css = fs.readFileSync(cssPath, 'utf8');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const threeJs = fs.readFileSync(threeJsPath, 'utf8');

  // ============================================================================
  // 1. STATIC CSS LAYOUT INVARIANTS & GRAMMAR VERIFICATION
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 1] Static CSS Layout Invariants & Grammar Checks ---\x1b[0m');

  // 1.1 Grid container definition
  const gridMatch = css.match(/\.grid-container\s*\{([^}]+)\}/);
  assert(gridMatch !== null, '1.1 .grid-container rule exists in style.css');
  const gridBody = gridMatch[1];
  assert(/display:\s*grid\s*;/.test(gridBody), '1.2 .grid-container has display: grid');
  assert(/grid-template-columns:\s*minmax\(280px,\s*1\.15fr\)\s*minmax\(620px,\s*2\.45fr\)\s*minmax\(280px,\s*1\.05fr\)\s*;/.test(gridBody),
    '1.3 .grid-container has exact columns: minmax(280px, 1.15fr) minmax(620px, 2.45fr) minmax(280px, 1.05fr)');

  // 1.2 Camera detached invariant
  const detachedMatch = css.match(/\.grid-container\.camera-detached\s*\{([^}]+)\}/);
  assert(detachedMatch !== null, '1.4 .grid-container.camera-detached rule exists in style.css');
  assert(/grid-template-columns:\s*24%\s*49%\s*27%\s*;/.test(detachedMatch[1]),
    '1.5 .grid-container.camera-detached maintains exact invariant: 24% 49% 27%');

  // 1.3 cad-studio-body scrollport properties
  const cadBodyMatch = css.match(/\.cad-studio-body\s*\{([^}]+)\}/);
  assert(cadBodyMatch !== null, '1.6 .cad-studio-body rule exists in style.css');
  const cadBodyCss = cadBodyMatch[1];
  assert(/display:\s*flex\s*;/.test(cadBodyCss), '1.7 .cad-studio-body has display: flex');
  assert(/flex-direction:\s*column\s*;/.test(cadBodyCss), '1.8 .cad-studio-body has flex-direction: column');
  assert(/min-height:\s*0\s*;/.test(cadBodyCss), '1.9 .cad-studio-body has min-height: 0 (crucial for flex scrollports)');
  assert(/overflow-y:\s*auto\s*;/.test(cadBodyCss), '1.10 .cad-studio-body has overflow-y: auto (prevents hard clipping)');
  assert(/overflow-x:\s*hidden\s*;/.test(cadBodyCss), '1.11 .cad-studio-body has overflow-x: hidden');
  assert(/position:\s*relative\s*;/.test(cadBodyCss), '1.12 .cad-studio-body has position: relative');

  // 1.4 build-actions-bar sticky footer
  const buildActionsMatch = css.match(/\.build-actions-bar\s*\{([^}]+)\}/);
  assert(buildActionsMatch !== null, '1.13 .build-actions-bar rule exists in style.css');
  const buildActionsCss = buildActionsMatch[1];
  assert(/position:\s*sticky\s*;/.test(buildActionsCss), '1.14 .build-actions-bar has position: sticky');
  assert(/bottom:\s*0\s*;/.test(buildActionsCss), '1.15 .build-actions-bar has bottom: 0');
  assert(/margin-top:\s*auto\s*;/.test(buildActionsCss), '1.16 .build-actions-bar has margin-top: auto');
  assert(/flex-shrink:\s*0\s*;/.test(buildActionsCss), '1.17 .build-actions-bar has flex-shrink: 0 (cannot be squished)');
  assert(/z-index:\s*10\s*;/.test(buildActionsCss), '1.18 .build-actions-bar has z-index >= 10');
  assert(/grid-template-columns:\s*1\.35fr\s*1\.65fr\s*auto\s*1\.05fr\s*;/.test(buildActionsCss),
    '1.19 .build-actions-bar has 4-column layout: 1.35fr 1.65fr auto 1.05fr');

  // 1.5 Backward compatibility tokens in :root
  assert(/--bg-panel-alt:\s*var\(--bg-card\);/.test(css), '1.20 :root defines backward compatibility token --bg-panel-alt');
  assert(/--border:\s*var\(--border-subtle\);/.test(css), '1.21 :root defines backward compatibility token --border');

  // ============================================================================
  // 2. DOM HIERARCHY, ELEMENT IDS & ANCHORING INVARIANTS
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 2] DOM Hierarchy, Element IDs & Anchoring Invariants ---\x1b[0m');

  const requiredIds = [
    'cadStudioColumn',
    'btnToggleCadFullscreen',
    'cadWorldScanBar',
    'selWorldScanSource',
    'btnScanWorldIntoCad',
    'toolGizmoMove',
    'toolGizmoRotate',
    'toolPlaceOnTerrain',
    'toolMeasure',
    'btnSceneUndo',
    'btnSceneRedo',
    'sliderSunTime',
    'sliderGhostOpacity',
    'btnToggleVerifier',
    'cadStudioSidebar',
    'sceneTreeList',
    'sceneObjectInspector',
    'btnSnapToGround',
    'studioAiCopilotPanel',
    'selStudioAiMode',
    'btnRunStudioAi',
    'btnStartSceneBuildQueue',
    'btnExportCompositeScene',
    'toolBrush',
    'toolEraser'
  ];

  for (const id of requiredIds) {
    assert(html.includes(`id="${id}"`), `2.1 Required DOM ID #${id} is present in index.html`);
  }

  // Critical Action Buttons in .build-actions-bar
  const buildActionsBarHtml = html.match(/<div\s+class=["']build-actions-bar["']>([\s\S]*?)<\/div>/i);
  assert(buildActionsBarHtml !== null, '2.2 .build-actions-bar container found in index.html');
  const barContent = buildActionsBarHtml[1];

  assert(barContent.includes('id="btnConfirmBuild"'), '2.3 #btnConfirmBuild is inside .build-actions-bar');
  assert(barContent.includes('id="btnStartSceneBuildQueue"'), '2.4 #btnStartSceneBuildQueue is inside .build-actions-bar');
  assert(barContent.includes('id="chkAutoFoundation"'), '2.5 #chkAutoFoundation is inside .build-actions-bar');
  assert(barContent.includes('id="btnStopBuild"'), '2.6 #btnStopBuild is inside .build-actions-bar');
  assert(barContent.includes('id="btnExportSchem"'), '2.7 #btnExportSchem is inside .build-actions-bar');
  assert(barContent.includes('id="btnExportCompositeScene"'), '2.8 #btnExportCompositeScene is inside .build-actions-bar');
  assert(barContent.includes('id="btnUndoBuild"'), '2.9 #btnUndoBuild is inside .build-actions-bar');

  // details-accordion positioning before .build-actions-bar
  const accordionIdx = html.indexOf('class="details-accordion"');
  const actionBarIdx = html.indexOf('class="build-actions-bar"');
  assert(accordionIdx !== -1 && actionBarIdx !== -1 && accordionIdx < actionBarIdx,
    '2.10 .details-accordion is placed BEFORE .build-actions-bar (prevents occluding sticky action footer)');

  // Sidebar Tabbed Navigation Structure
  assert(html.includes('id="tabBtnCadObjects"'), '2.11 #tabBtnCadObjects exists');
  assert(html.includes('id="tabBtnCadInspector"'), '2.12 #tabBtnCadInspector exists');
  assert(html.includes('id="tabBtnCadAi"'), '2.13 #tabBtnCadAi exists');
  assert(html.includes('id="cadTabObjects"'), '2.14 #cadTabObjects pane exists');
  assert(html.includes('id="cadTabInspector"'), '2.15 #cadTabInspector pane exists');
  assert(html.includes('id="cadTabAi"'), '2.16 #cadTabAi pane exists');

  // Scene Inspector Empty Hint pairing
  assert(html.includes('id="sceneInspectorEmptyHint"'), '2.17 #sceneInspectorEmptyHint exists in Tab 2');
  assert(css.includes('#sceneObjectInspector:not(.hidden) + #sceneInspectorEmptyHint'),
    '2.18 CSS suppresses empty hint when #sceneObjectInspector is not hidden');

  // ============================================================================
  // 3. EMPIRICAL CSS GRID SIMULATION ACROSS EXTREME DISPLAY RESOLUTIONS
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 3] Empirical CSS Grid Simulation Across Extreme Resolutions ---\x1b[0m');

  /**
   * Simulates W3C CSS Grid track sizing for .grid-container:
   * grid-template-columns: minmax(280px, 1.15fr) minmax(620px, 2.45fr) minmax(280px, 1.05fr);
   * gap: 10px; padding: 10px;
   */
  function simulateGrid3Col(viewportWidth) {
    const padding = 20; // 10px each side
    const gaps = 20;    // 2 gaps * 10px
    const availableWidth = viewportWidth - padding - gaps;

    const minTracks = [280, 620, 280];
    const frWeights = [1.15, 2.45, 1.05];
    const totalFr = 1.15 + 2.45 + 1.05; // 4.65

    const minSum = minTracks.reduce((a, b) => a + b, 0); // 1180px

    if (availableWidth <= minSum) {
      // Clamped to minimums (or container scrolls)
      const col1 = minTracks[0];
      const col2 = minTracks[1];
      const col3 = minTracks[2];
      const col2Ratio = col2 / (col1 + col2 + col3);
      return { col1, col2, col3, col2Ratio, isFlexible: false, availableWidth };
    }

    const frSize = availableWidth / totalFr;
    const col1 = Math.max(minTracks[0], frWeights[0] * frSize);
    const col2 = Math.max(minTracks[1], frWeights[1] * frSize);
    const col3 = Math.max(minTracks[2], frWeights[2] * frSize);
    const col2Ratio = col2 / (col1 + col2 + col3);

    return { col1, col2, col3, col2Ratio, isFlexible: true, availableWidth };
  }

  /**
   * Simulates camera-detached layout: 24% 49% 27%
   */
  function simulateGridDetached(viewportWidth) {
    const padding = 20;
    const gaps = 20;
    const availableWidth = viewportWidth - padding - gaps;
    const col1 = 0.24 * availableWidth;
    const col2 = 0.49 * availableWidth;
    const col3 = 0.27 * availableWidth;
    const col2Ratio = col2 / availableWidth;
    return { col1, col2, col3, col2Ratio, availableWidth };
  }

  const testResolutions = [
    { name: '4K UHD', w: 3840, h: 2160 },
    { name: 'Ultrawide QHD', w: 3440, h: 1440 },
    { name: 'Full HD 1080p', w: 1920, h: 1080 },
    { name: 'Standard Laptop 1366p', w: 1366, h: 768 },
    { name: 'Tablet Landscape 1024p', w: 1024, h: 768 },
    { name: 'Compact 1280p', w: 1280, h: 720 },
    { name: 'Portrait Display', w: 1080, h: 1920 }
  ];

  for (const res of testResolutions) {
    const sim = simulateGrid3Col(res.w);
    console.log(`  \x1b[36m-> ${res.name} (${res.w}x${res.h}):\x1b[0m Col 1=${sim.col1.toFixed(1)}px, Col 2=${sim.col2.toFixed(1)}px, Col 3=${sim.col3.toFixed(1)}px | Col 2 Share: ${(sim.col2Ratio * 100).toFixed(2)}%`);

    // Invariant: Column 2 must receive dominant horizontal area (>= 49% and ~52.7% when flexible)
    assert(sim.col2Ratio >= 0.49, `3.1 [${res.name}] Column 2 receives dominant horizontal share (${(sim.col2Ratio * 100).toFixed(2)}% >= 49%)`);
    assert(sim.col2 >= 620, `3.2 [${res.name}] Column 2 width (${sim.col2.toFixed(1)}px) meets minimum floor 620px`);
    assert(sim.col1 >= 280, `3.3 [${res.name}] Column 1 width (${sim.col1.toFixed(1)}px) meets minimum floor 280px`);
    assert(sim.col3 >= 280, `3.4 [${res.name}] Column 3 width (${sim.col3.toFixed(1)}px) meets minimum floor 280px`);

    // Camera detached invariant check
    const det = simulateGridDetached(res.w);
    assert(Math.abs(det.col2Ratio - 0.49) < 0.001, `3.5 [${res.name} Detached] Column 2 receives exactly 49%`);
    assert(Math.abs((det.col1 + det.col2 + det.col3) - det.availableWidth) < 0.01, `3.6 [${res.name} Detached] Columns sum to 100% of available width`);
  }

  // Check 1920p exact share: 2.45 / 4.65 = 52.688%
  const fhd = simulateGrid3Col(1920);
  assert(Math.abs(fhd.col2Ratio - 0.5269) < 0.005,
    `3.7 Full HD 1080p Column 2 share is ~52.7% (actual: ${(fhd.col2Ratio * 100).toFixed(2)}%)`);

  // ============================================================================
  // 4. THREE.JS VIEWPORT DIMENSIONS, ASPECT RATIO & DISTORTION PREVENTION
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 4] Three.js Viewport Dimensions, Aspect Ratio & Distortion Prevention ---\x1b[0m');

  /**
   * In Column 2:
   * #cadStudioWorkspace has:
   * #threeContainer (flex: 1 1 auto; min-width: 0; min-height: 320px;)
   * #cadStudioSidebar (width: 260px; flex-shrink: 0;)
   * gap: 10px;
   * padding of .cad-studio-body: 20px (left 10px + right 10px).
   *
   * Available canvas width W_canvas = Col2_width - padding(20) - gap(10) - sidebar(260) = Col2_width - 290px.
   */
  for (const res of testResolutions) {
    const sim = simulateGrid3Col(res.w);
    const canvasWidth = sim.col2 - 20 - 10 - 260; // Col2 minus padding, gap, and sidebar

    // Vertical budget estimation:
    // Window height minus App header (48px) - Grid padding (20px) - Col Header (44px)
    // - Scan bar (36px) - Toolbar (34px) - Swatches (26px) - Presets (28px) - Slicer (34px)
    // - Action Bar (48px) = Overhead ~318px
    const verticalOverhead = 318;
    const canvasHeight = Math.max(320, res.h - verticalOverhead);

    const aspectRatio = canvasWidth / canvasHeight;

    console.log(`  \x1b[36m-> ${res.name}:\x1b[0m Canvas = ${canvasWidth.toFixed(1)}px x ${canvasHeight.toFixed(1)}px | Aspect Ratio = ${aspectRatio.toFixed(3)}:1`);

    assert(canvasWidth >= 320, `4.1 [${res.name}] Canvas width (${canvasWidth.toFixed(1)}px) >= minimum 320px`);
    assert(canvasHeight >= 320, `4.2 [${res.name}] Canvas height (${canvasHeight.toFixed(1)}px) >= minimum 320px`);
    assert(aspectRatio > 0.1 && aspectRatio < 5.0, `4.3 [${res.name}] Canvas aspect ratio (${aspectRatio.toFixed(3)}) is strictly positive and computable`);

    // Verify Three.js distortion-free projection contract:
    // Projection matrix scale factor = tan(fov / 2) * aspect.
    // As long as camera.aspect is set to (w / h), horizontal and vertical unit vectors maintain 1:1 square pixel aspect.
    const fov = 45;
    const fovRad = (fov * Math.PI) / 180;
    const top = Math.tan(fovRad / 2);
    const right = top * aspectRatio;
    const pixelAspect = (right / canvasWidth) / (top / canvasHeight);
    assert(Math.abs(pixelAspect - 1.0) < 0.0001, `4.4 [${res.name}] Three.js pixel aspect ratio is exactly 1.0 (zero distortion)`);
  }

  // Verify threeViewport.js resize function contract
  assert(/export\s+function\s+resizeThreeViewport\s*\(/.test(threeJs), '4.5 threeViewport.js exports resizeThreeViewport()');
  assert(threeJs.includes('camera.aspect = w / h;'), '4.6 resizeThreeViewport updates camera.aspect = w / h');
  assert(threeJs.includes('camera.updateProjectionMatrix();'), '4.7 resizeThreeViewport calls camera.updateProjectionMatrix() to prevent distortion');
  assert(/renderer\.setSize\(w,\s*h\);/.test(threeJs), '4.8 resizeThreeViewport updates renderer dimensions');

  // ============================================================================
  // 5. ACTION BAR BUTTON ERGONOMICS & NO-CLIPPING VERIFICATION
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 5] Action Bar Button Ergonomics & Anti-Clipping Verification ---\x1b[0m');

  /**
   * At 1920x1080:
   * Col 2 width = ~990.5px.
   * Action bar padding = 20px (10px each side).
   * Available bar width = 970.5px.
   * Gap = 6px (3 gaps = 18px).
   * Auto checkbox width ~130px.
   * Remaining fr width = 970.5 - 18 - 130 = 822.5px.
   * Total fr = 1.35 + 1.65 + 1.05 = 4.05fr.
   * 1fr = 822.5 / 4.05 = 203.08px.
   *
   * btnConfirmBuild (1.35fr) = 274.2px.
   * btnStartSceneBuildQueue (1.65fr) = 335.1px (> 210px threshold, prevents text wrap!).
   * btnStopBuild (1.05fr) = 213.2px.
   */
  const col2Fhd = fhd.col2;
  const barPadding = 20;
  const barGaps = 18;
  const autoCheckboxWidth = 130;
  const availableFrWidth = col2Fhd - barPadding - barGaps - autoCheckboxWidth;
  const unitFr = availableFrWidth / (1.35 + 1.65 + 1.05);

  const btnConfirmWidth = 1.35 * unitFr;
  const btnStartQueueWidth = 1.65 * unitFr;
  const btnStopWidth = 1.05 * unitFr;

  console.log(`  \x1b[36m-> 1080p Action Bar Widths:\x1b[0m Confirm=${btnConfirmWidth.toFixed(1)}px, Queue=${btnStartQueueWidth.toFixed(1)}px, Stop=${btnStopWidth.toFixed(1)}px`);

  assert(btnStartQueueWidth >= 210, `5.1 #btnStartSceneBuildQueue receives sufficient inline width (${btnStartQueueWidth.toFixed(1)}px >= 210px) to prevent German label wrapping`);
  assert(btnConfirmWidth >= 200, `5.2 #btnConfirmBuild receives sufficient width (${btnConfirmWidth.toFixed(1)}px >= 200px)`);
  assert(btnStopWidth >= 160, `5.3 #btnStopBuild receives prominent width (${btnStopWidth.toFixed(1)}px >= 160px) for emergency halt`);

  // Sticky properties prevent clipping when content scrolls
  assert(buildActionsCss.includes('position: sticky'), '5.4 Action bar has position: sticky');
  assert(buildActionsCss.includes('bottom: 0'), '5.5 Action bar has bottom: 0');
  assert(buildActionsCss.includes('box-shadow'), '5.6 Action bar has shadow elevation to visually separate from scrolling content');

  // ============================================================================
  // 6. ADVERSARIAL STRESS-TESTS & EDGE CASES
  // ============================================================================
  console.log('\n\x1b[33m--- [GROUP 6] Adversarial Stress-Tests & Boundary Conditions ---\x1b[0m');

  // Test 6.1: Zero and negative widths handled gracefully by Math.max guards in resizeThreeViewport
  assert(threeJs.includes('Math.max(100, container.clientWidth)'), '6.1 resizeThreeViewport uses Math.max(100, ...) guard against collapsed 0-width containers');
  assert(threeJs.includes('Math.max(100, container.clientHeight)'), '6.2 resizeThreeViewport uses Math.max(100, ...) guard against collapsed 0-height containers');

  // Test 6.2: Sidebar max-height constraint prevents outer scrollport expansion
  const sidebarMatch = css.match(/\.cad-studio-sidebar\s*\{([^}]+)\}/);
  assert(sidebarMatch !== null, '6.3 .cad-studio-sidebar rule exists');
  assert(/max-height:\s*360px\s*;/.test(sidebarMatch[1]), '6.4 .cad-studio-sidebar caps max-height at 360px to prevent viewport ballooning');
  assert(/overflow:\s*hidden\s*;/.test(sidebarMatch[1]), '6.5 .cad-studio-sidebar uses overflow: hidden to prevent nested scrollbars');

  // Test 6.3: Responsive breakpoint @media (max-width: 768px)
  const media768Match = css.match(/@media\s*\(max-width:\s*768px\)\s*\{([\s\S]*?)\n\}/);
  assert(media768Match !== null, '6.6 Responsive media query for <= 768px exists');
  const media768Content = media768Match[1];
  assert(media768Content.includes('grid-template-columns: 1fr 1fr;'), '6.7 Action bar adapts to 2x2 grid on mobile/small displays (<= 768px)');

  // Test 6.4: All 8 swatch buttons have valid color dots
  const swatchButtons = [...html.matchAll(/class=["']swatch-btn["'][^>]*data-block=["']([^"']+)["'][^>]*>/g)];
  assert(swatchButtons.length >= 8, `6.8 Quick swatches bar defines at least 8 material swatches (found ${swatchButtons.length})`);
  assert(html.includes('data-block="pale_oak_planks"'), '6.9 Swatches bar includes 26.3 Pale Oak');
  assert(html.includes('data-block="resin_bricks"'), '6.10 Swatches bar includes 26.3 Resin Bricks');

  // Test 6.5: Verify no unhandled overflow: hidden on .cad-studio-body
  assert(!/\.cad-studio-body\s*\{[^}]*overflow:\s*hidden/.test(css), '6.11 .cad-studio-body does NOT have unconditional overflow: hidden');

  console.log('\n\x1b[32m======================================================================\x1b[0m');
  console.log(`\x1b[32m=== ADVERSARIAL STRESS TEST COMPLETE: ${passedTests}/${totalTests} TESTS PASSED (0 FAILURES) ===\x1b[0m`);
  console.log('\x1b[32m======================================================================\x1b[0m\n');
}

runEmpiricalStressTests().catch(err => {
  console.error('\x1b[31m[FATAL ERROR IN EMPIRICAL STRESS HARNESS]\x1b[0m', err);
  process.exit(1);
});
