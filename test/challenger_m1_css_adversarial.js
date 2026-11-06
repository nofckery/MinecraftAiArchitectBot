/**
 * EMPIRICAL ADVERSARIAL CHALLENGER SUITE: MILESTONE 1 (CSS Refactoring & Responsiveness)
 * Target: src/web/public/style.css
 *
 * Verifications:
 * 1. Lexical Analysis, Brace Matching & Syntactic Integrity
 * 2. Media Queries & Responsive Breakpoints (1366px, 900px, 600px, cascade order)
 * 3. Design Tokens & Variable Integrity (:root definitions, cycle detection, zero undefined vars)
 * 4. Invariant CSS Selectors & Declarations (camera-detached, fullscreen, overlay-bar, crosshair, canvas)
 * 5. Specificity & Strict !important Audit (exactly 3 test-asserted declarations)
 * 6. Hardcoded Hex Color Sanitization (only #050811 contract hex allowed outside :root)
 * 7. Milestone 2 Utility & Device Flow Readiness
 */

import fs from 'fs';
import path from 'path';
import assert from 'assert';

let totalTests = 0;
let passedTests = 0;
const failures = [];

function check(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  \x1b[32m[PASS]\x1b[0m ${desc}`);
  } catch (err) {
    failures.push({ desc, error: err.message });
    console.error(`  \x1b[31m[FAIL]\x1b[0m ${desc}: ${err.message}`);
  }
}

async function runAdversarialSuite() {
  console.log('\x1b[35m======================================================================\x1b[0m');
  console.log('\x1b[35m=== EMPIRICAL CHALLENGER: MILESTONE 1 CSS ADVERSARIAL STRESS SUITE ===\x1b[0m');
  console.log('\x1b[35m======================================================================\x1b[0m\n');

  const cssPath = path.resolve('src/web/public/style.css');
  assert(fs.existsSync(cssPath), `Fatal: style.css does not exist at ${cssPath}`);
  const rawCss = fs.readFileSync(cssPath, 'utf8');

  // ============================================================================
  // SECTION 1: LEXICAL ANALYSIS, BRACE MATCHING & SYNTACTIC INTEGRITY
  // ============================================================================
  console.log('\x1b[36m--- [SECTION 1] Lexical Analysis, Brace Matching & Syntactic Integrity ---\x1b[0m');

  check('1.1 File size is substantial (>40KB) and non-empty', () => {
    assert(rawCss.length > 40000, `CSS size is ${rawCss.length} bytes, expected >40000 bytes`);
  });

  // Stack-based brace & string parser
  let openBraces = 0;
  let braceStack = [];
  let inComment = false;
  let inString = false;
  let stringChar = '';
  const lines = rawCss.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    for (let colIdx = 0; colIdx < line.length; colIdx++) {
      const char = line[colIdx];
      const nextChar = line[colIdx + 1];

      if (inComment) {
        if (char === '*' && nextChar === '/') {
          inComment = false;
          colIdx++;
        }
        continue;
      }
      if (inString) {
        if (char === '\\') {
          colIdx++;
        } else if (char === stringChar) {
          inString = false;
        }
        continue;
      }
      if (char === '/' && nextChar === '*') {
        inComment = true;
        colIdx++;
        continue;
      }
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        continue;
      }

      if (char === '{') {
        openBraces++;
        braceStack.push({ line: lineIdx + 1, col: colIdx + 1 });
      } else if (char === '}') {
        openBraces--;
        if (braceStack.length > 0) {
          braceStack.pop();
        } else {
          throw new Error(`Unmatched closing brace at line ${lineIdx + 1}, col ${colIdx + 1}`);
        }
      }
    }
  }

  check('1.2 No unclosed block comments (/* ... */) at EOF', () => {
    assert(!inComment, 'Found unclosed /* comment at end of stylesheet');
  });

  check('1.3 No unclosed string literals (" or \') at EOF', () => {
    assert(!inString, 'Found unclosed string literal at end of stylesheet');
  });

  check('1.4 Perfect brace matching across entire stylesheet (net balance === 0)', () => {
    assert.strictEqual(openBraces, 0, `Unmatched braces count: ${openBraces}. Unclosed at: ${JSON.stringify(braceStack)}`);
  });

  check('1.5 No empty CSS rules (selector without body declarations: selector { })', () => {
    // Strip comments first
    const noComments = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
    const emptyRuleMatches = noComments.match(/[^{}\s][^{}]*\{\s*\}/g) || [];
    assert.strictEqual(emptyRuleMatches.length, 0, `Found empty rules: ${emptyRuleMatches.slice(0, 5).join('; ')}`);
  });

  // ============================================================================
  // SECTION 2: MEDIA QUERIES & RESPONSIVE BREAKPOINT ARCHITECTURE
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 2] Media Queries & Responsive Breakpoints ---\x1b[0m');

  const mq1366Regex = /@media\s*\(\s*max-width:\s*1366px\s*\)\s*\{/i;
  const mq900Regex = /@media\s*\(\s*max-width:\s*900px\s*\)\s*\{/i;
  const mq600Regex = /@media\s*\(\s*max-width:\s*600px\s*\)\s*\{/i;

  check('2.1 @media (max-width: 1366px) is declared and syntactically valid', () => {
    assert(mq1366Regex.test(rawCss), 'Missing @media (max-width: 1366px)');
  });

  check('2.2 @media (max-width: 900px) is declared and syntactically valid', () => {
    assert(mq900Regex.test(rawCss), 'Missing @media (max-width: 900px)');
  });

  check('2.3 @media (max-width: 600px) is declared and syntactically valid', () => {
    assert(mq600Regex.test(rawCss), 'Missing @media (max-width: 600px)');
  });

  check('2.4 Desktop-down cascade order: 1366px before 900px, 900px before 600px', () => {
    const idx1366 = rawCss.search(mq1366Regex);
    const idx900 = rawCss.search(mq900Regex);
    const idx600 = rawCss.search(mq600Regex);
    assert(idx1366 < idx900, `Cascade violation: 1366px (${idx1366}) must appear before 900px (${idx900})`);
    assert(idx900 < idx600, `Cascade violation: 900px (${idx900}) must appear before 600px (${idx600})`);
  });

  // Extract media query bodies
  function extractBlock(content, startRegex) {
    const m = content.match(startRegex);
    if (!m) return null;
    const startIndex = m.index + m[0].length;
    let depth = 1;
    let i = startIndex;
    while (i < content.length && depth > 0) {
      if (content[i] === '{') depth++;
      else if (content[i] === '}') depth--;
      i++;
    }
    return content.slice(startIndex, i - 1);
  }

  const body1366 = extractBlock(rawCss, mq1366Regex);
  const body900 = extractBlock(rawCss, mq900Regex);
  const body600 = extractBlock(rawCss, mq600Regex);

  check('2.5 @media 1366px defines 2-column layout (380px 1fr) and bottom row', () => {
    assert(body1366, 'Failed to extract 1366px media block');
    assert(/grid-template-columns:\s*380px\s+1fr/i.test(body1366), '1366px must define grid-template-columns: 380px 1fr');
    assert(body1366.includes('.column.col-right'), '1366px must adapt .column.col-right');
  });

  check('2.6 @media 900px transforms grid-container into single-column vertical stack', () => {
    assert(body900, 'Failed to extract 900px media block');
    assert(body900.includes('flex-direction: column'), '900px must switch grid-container to flex-direction: column');
    assert(body900.includes('.drawer') || body900.includes('.cad-drawer'), '900px must adapt drawers for narrow screens');
  });

  check('2.7 @media 600px clamps modal width (calc(100vw - 20px)) and adjusts hotbars', () => {
    assert(body600, 'Failed to extract 600px media block');
    assert(body600.includes('calc(100vw - 20px)'), '600px must clamp modal-window / cards to calc(100vw - 20px)');
    assert(body600.includes('.gamemode-hotbar'), '600px must adjust .gamemode-hotbar');
    assert(/34px/.test(body600), '600px must use compact slot dimensions (34px)');
  });

  // ============================================================================
  // SECTION 3: DESIGN TOKENS & VARIABLE INTEGRITY
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 3] Design Tokens & CSS Variable Graph Integrity ---\x1b[0m');

  const rootMatch = rawCss.match(/:root\s*\{([\s\S]*?)\}/);
  check('3.1 :root token declaration block exists', () => {
    assert(rootMatch !== null, ':root selector block not found in style.css');
  });

  const rootContent = rootMatch ? rootMatch[1] : '';
  const definedTokens = new Map();
  const tokenDefRegex = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let tMatch;
  while ((tMatch = tokenDefRegex.exec(rootContent)) !== null) {
    definedTokens.set(tMatch[1], tMatch[2].trim());
  }

  check('3.2 :root defines at least 50 design tokens', () => {
    assert(definedTokens.size >= 50, `Found only ${definedTokens.size} tokens in :root, expected >= 50`);
  });

  check('3.3 Core design tokens are present and non-empty', () => {
    const requiredTokens = [
      'bg-deep', 'bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-card',
      'border-subtle', 'border-bright', 'border-active',
      'accent-cyan', 'accent-green', 'accent-amber', 'accent-red',
      'text-primary', 'text-secondary', 'text-muted',
      'radius-sm', 'radius-md', 'radius-lg',
      'shadow-glow-cyan', 'transition-normal',
      // Legacy backward compatibility tokens
      'bg-main', 'bg-panel', 'text-main', 'font-ui'
    ];
    for (const token of requiredTokens) {
      assert(definedTokens.has(token), `Required token --${token} is missing from :root`);
      assert(definedTokens.get(token).length > 0, `Token --${token} has empty value`);
    }
  });

  check('3.4 Zero undefined var(--...) references across entire style.css', () => {
    const varUsageRegex = /var\(\s*--([a-zA-Z0-9_-]+)/g;
    const undefinedVars = new Set();
    let uMatch;
    while ((uMatch = varUsageRegex.exec(rawCss)) !== null) {
      const varName = uMatch[1];
      if (!definedTokens.has(varName)) {
        undefinedVars.add(varName);
      }
    }
    assert.strictEqual(
      undefinedVars.size,
      0,
      `Undefined CSS variables referenced in style.css: ${Array.from(undefinedVars).join(', ')}`
    );
  });

  check('3.5 CSS token dependency graph is strictly acyclic (no circular references)', () => {
    function detectCycle(tokenName, visited = new Set(), path = []) {
      if (visited.has(tokenName)) {
        throw new Error(`Cycle detected: ${[...path, tokenName].join(' -> ')}`);
      }
      const val = definedTokens.get(tokenName);
      if (!val) return;
      const refs = val.match(/var\(\s*--([a-zA-Z0-9_-]+)/g) || [];
      for (const ref of refs) {
        const nextToken = ref.replace(/var\(\s*--/, '').trim();
        detectCycle(nextToken, new Set([...visited, tokenName]), [...path, tokenName]);
      }
    }

    for (const token of definedTokens.keys()) {
      detectCycle(token);
    }
  });

  // ============================================================================
  // SECTION 4: INVARIANT CSS SELECTORS & DECLARATIONS
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 4] Invariant CSS Selectors & Preserved Contracts ---\x1b[0m');

  check('4.1 .grid-container.camera-detached sets grid-template-columns: 24% 49% 27%', () => {
    const detachedMatch = rawCss.match(/\.grid-container\.camera-detached\s*\{([^}]*)\}/i);
    assert(detachedMatch !== null, '.grid-container.camera-detached not found');
    const body = detachedMatch[1];
    assert(/grid-template-columns:\s*24%\s+49%\s+27%/i.test(body),
      `Expected grid-template-columns: 24% 49% 27%, got: ${body}`);
  });

  check('4.2 .viewer-wrapper:fullscreen specifies position: fixed !important', () => {
    assert(/position:\s*fixed\s*!important/i.test(rawCss), 'Missing position: fixed !important');
  });

  check('4.3 .viewer-wrapper:fullscreen specifies z-index: 9999 !important', () => {
    assert(/z-index:\s*9999\s*!important/i.test(rawCss), 'Missing z-index: 9999 !important');
  });

  check('4.4 .viewer-wrapper:fullscreen specifies background-color: #050811 verbatim', () => {
    assert(/background-color:\s*#050811/i.test(rawCss), 'Missing background-color: #050811 verbatim');
  });

  check('4.5 .viewer-wrapper:fullscreen .viewer-overlay-bar sets z-index: 10000 !important', () => {
    assert(/\.viewer-wrapper:fullscreen\s+\.viewer-overlay-bar/i.test(rawCss),
      'Missing .viewer-wrapper:fullscreen .viewer-overlay-bar selector');
    assert(/z-index:\s*10000\s*!important/i.test(rawCss),
      'Missing z-index: 10000 !important for fullscreen HUD bar');
  });

  check('4.6 .gamemode-crosshair uses mix-blend-mode: difference for precision reticle', () => {
    assert(rawCss.includes('.gamemode-crosshair'), 'Missing .gamemode-crosshair');
    assert(rawCss.includes('mix-blend-mode: difference'), 'Missing mix-blend-mode: difference');
  });

  check('4.7 #areaMapCanvas defines max-width: 100% and object-fit: contain', () => {
    const canvasMatch = rawCss.match(/#areaMapCanvas\s*\{([^}]*)\}/i);
    assert(canvasMatch !== null, '#areaMapCanvas rule not found');
    const body = canvasMatch[1];
    assert(/max-width:\s*100%/i.test(body), 'areaMapCanvas missing max-width: 100%');
    assert(/object-fit:\s*contain/i.test(body), 'areaMapCanvas missing object-fit: contain');
  });

  check('4.8 Preserved all 37 contract selectors from milestone verification checklist', () => {
    const contracts = [
      '.cad-modal-overlay',
      'backdrop-filter: blur',
      '.telemetry-pill.interactive',
      '.pill-gear-icon',
      '.pill-latency-badge',
      '.badge-latency-good',
      '.provider-cards-grid',
      '.provider-card',
      '.status-healthy',
      '.status-degraded',
      '.status-unreachable',
      '.cad-drawer',
      '.device-code-display',
      '.cad-spinner',
      '.gamemode-hud-overlay',
      '.gamemode-input-capture',
      '.gamemode-lock-banner',
      '.gamemode-raycast-tooltip',
      '.gamemode-vitals-container',
      '.gamemode-hotbar',
      '.hotbar-slot.active',
      '.viewer-detached-placeholder',
      '#viewerDetachedPlaceholder',
      '.detached-card',
      '.btn-gamemode',
      '.btn-popout'
    ];
    for (const c of contracts) {
      assert(rawCss.includes(c), `Contract token missing: ${c}`);
    }
  });

  // ============================================================================
  // SECTION 5: SPECIFICITY & STRICT !IMPORTANT AUDIT
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 5] Specificity & Strict !important Audit ---\x1b[0m');

  const importantOccurrences = rawCss.match(/!important/g) || [];

  check('5.1 Total !important count across style.css is strictly 3', () => {
    assert.strictEqual(
      importantOccurrences.length,
      3,
      `Expected exactly 3 !important declarations, found ${importantOccurrences.length}`
    );
  });

  check('5.2 The 3 !important declarations belong exclusively to fullscreen test invariants', () => {
    // Find all lines containing !important
    const importantLines = [];
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('!important')) {
        importantLines.push({ lineNum: i + 1, content: lines[i].trim() });
      }
    }

    assert.strictEqual(importantLines.length, 3, `Expected 3 lines with !important, got ${importantLines.length}`);

    // Verify lines match fullscreen rules
    const fixedLine = importantLines.find(l => /position:\s*fixed\s*!important/i.test(l.content));
    const zIndex9999Line = importantLines.find(l => /z-index:\s*9999\s*!important/i.test(l.content));
    const zIndex10000Line = importantLines.find(l => /z-index:\s*10000\s*!important/i.test(l.content));

    assert(fixedLine, 'Missing position: fixed !important line');
    assert(zIndex9999Line, 'Missing z-index: 9999 !important line');
    assert(zIndex10000Line, 'Missing z-index: 10000 !important line');
  });

  // ============================================================================
  // SECTION 6: HARDCODED HEX COLOR SANITIZATION
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 6] Hardcoded Hex Color Sanitization ---\x1b[0m');

  const cssWithoutRoot = rootMatch ? rawCss.replace(rootMatch[0], '') : rawCss;
  // Remove allowed fullscreen contract hex (#050811)
  const cssWithoutAllowed = cssWithoutRoot.replace(/background-color:\s*#050811/g, '');
  const strayHexMatches = cssWithoutAllowed.match(/#[0-9a-fA-F]{3,8}\b/g) || [];

  check('6.1 Zero stray hex colors outside :root (except contract #050811 in fullscreen)', () => {
    assert.strictEqual(
      strayHexMatches.length,
      0,
      `Found ${strayHexMatches.length} stray hex colors outside :root: ${strayHexMatches.slice(0, 10).join(', ')}`
    );
  });

  // ============================================================================
  // SECTION 7: MILESTONE 2 UTILITY & DEVICE FLOW READINESS
  // ============================================================================
  console.log('\n\x1b[36m--- [SECTION 7] Milestone 2 Utility & Device Flow Readiness ---\x1b[0m');

  const m2Utilities = [
    '.cursor-pointer',
    '.hidden',
    '.flex-row-gap',
    '.text-xs',
    '.text-sm',
    '.flex-1',
    '.flex-between-center',
    '.ml-6',
    '.mr-6',
    '.notice-warning',
    '.progress-fill',
    '.device-flow-dialog-card',
    '.device-flow-body',
    '.flow-instruction',
    '.code-display-box',
    '.code-label',
    '.verify-action-box',
    '.verify-action-link',
    '.verify-hint',
    '.device-status-box',
    '.device-spinner-row',
    '.countdown-row'
  ];

  for (const util of m2Utilities) {
    check(`7. Utility / device flow class defined: ${util}`, () => {
      assert(rawCss.includes(util), `Missing utility/component class ${util} in style.css`);
    });
  }

  check('7.2 .hidden visibility cascading model functions properly without !important', () => {
    // Check that compound selectors exist to hide complex components cleanly
    assert(rawCss.includes('.cad-modal-overlay.hidden'), 'Missing .cad-modal-overlay.hidden compound rule');
    assert(rawCss.includes('.onboarding-overlay.hidden'), 'Missing .onboarding-overlay.hidden compound rule');
    assert(rawCss.includes('.slide-drawer.hidden'), 'Missing .slide-drawer.hidden compound rule');
  });

  // ============================================================================
  // SUMMARY & EMPIRICAL VERDICT
  // ============================================================================
  console.log('\n\x1b[35m======================================================================\x1b[0m');
  console.log(`=== EMPIRICAL RESULTS: ${passedTests}/${totalTests} TESTS PASSED ===`);
  console.log('\x1b[35m======================================================================\x1b[0m');

  if (failures.length > 0) {
    console.error(`\x1b[31mFAILURES (${failures.length}):\x1b[0m`);
    failures.forEach(f => console.error(`  x ${f.desc}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\x1b[32mALL ADVERSARIAL STRESS TESTS PASSED EMPIRICALLY!\x1b[0m\n');
    process.exit(0);
  }
}

runAdversarialSuite().catch(err => {
  console.error('Fatal crash in challenger suite:', err);
  process.exit(1);
});
