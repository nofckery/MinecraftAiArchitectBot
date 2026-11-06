/**
 * EMPIRICAL CHALLENGER PROBE: Milestone 2 — HTML Structure, Accessibility & Invariant Stress
 *
 * Requirements:
 * 1. Check that regex `style\s*=` finds 0 matches in the entire file.
 * 2. Check all 283 DOM IDs: ensure zero duplicates, ensure no IDs with whitespace or invalid characters.
 * 3. Check all <dialog> or [role="dialog"] elements: verify aria-modal="true" and valid aria-labelledby IDs referencing existing headers.
 * 4. Check all <div role="tablist"> elements: verify all child tabs have valid aria-controls referencing existing pane IDs, and that panes have matching aria-labelledby.
 * 5. Check all <button> elements without text content: ensure every single one has an aria-label or title.
 * 6. Check the structural comment invariant: verify regex `/<div\s+id=["']tab-viewer["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*TAB 2/i`.
 * 7. Cross-reference all ARIA pointers (aria-labelledby, aria-describedby, aria-controls, label for) for dangling IDs.
 */

import fs from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const failures = [];

function check(title, condition, extraInfo = '') {
  if (condition) {
    passed++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${title}`);
  } else {
    failed++;
    const errMsg = `\x1b[31m[FAIL]\x1b[0m ${title}${extraInfo ? ' -> ' + extraInfo : ''}`;
    console.error(errMsg);
    failures.push({ title, extraInfo });
  }
}

function parseAttributes(tagHtml) {
  const attrs = {};
  // Match key="val", key='val', key=val, or boolean key
  const attrRegex = /([a-zA-Z0-9_\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  // skip the tag name
  const firstSpace = tagHtml.search(/\s/);
  if (firstSpace === -1) return attrs;
  const attrString = tagHtml.slice(firstSpace, tagHtml.endsWith('/>') ? -2 : -1);

  while ((m = attrRegex.exec(attrString)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : ''));
    attrs[key] = val;
  }
  return attrs;
}

function runAdversarialProbe() {
  console.log('\x1b[35m================================================================================\x1b[0m');
  console.log('\x1b[35m=== EMPIRICAL CHALLENGER PROBE: M2 HTML STRUCTURE, A11Y & INVARIANTS         ===\x1b[0m');
  console.log('\x1b[35m================================================================================\x1b[0m\n');

  const htmlPath = path.resolve('src/web/public/index.html');
  check('File existence: src/web/public/index.html exists', fs.existsSync(htmlPath));
  if (!fs.existsSync(htmlPath)) {
    process.exit(1);
  }

  const html = fs.readFileSync(htmlPath, 'utf8');

  // ==============================================================================
  // SUITE 1: Inline Style Elimination
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 1] Inline Style Elimination Stress Check ---\x1b[0m');

  const styleAttrMatches = html.match(/style\s*=/gi) || [];
  check('1.1 Regex style\\s*= finds 0 matches in index.html', styleAttrMatches.length === 0, `Found: ${styleAttrMatches.length}`);

  const multilineStyleMatches = html.match(/style[\s\r\n\t]*=/gi) || [];
  check('1.2 Multiline style[\\s\\r\\n\\t]*= finds 0 matches', multilineStyleMatches.length === 0, `Found: ${multilineStyleMatches.length}`);

  // Tag level parser: check every HTML opening tag for any attribute named 'style'
  const openingTags = html.match(/<[a-zA-Z0-9\-]+(?:\s+[^>]*)?>/g) || [];
  const tagsWithStyle = [];
  for (const tag of openingTags) {
    if (tag.startsWith('<!--')) continue;
    const attrs = parseAttributes(tag);
    if ('style' in attrs) {
      tagsWithStyle.push(tag);
    }
  }
  check('1.3 Zero opening HTML tags contain a style attribute', tagsWithStyle.length === 0, `Tags found: ${tagsWithStyle.join(', ')}`);

  // ==============================================================================
  // SUITE 2: DOM ID Integrity, Uniqueness & Format Validation
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 2] DOM ID Integrity, Uniqueness & Format Validation ---\x1b[0m');

  const idRegex = /id=["']([^"']+)["']/g;
  const rawIds = [];
  const idCounts = {};
  let idMatch;
  while ((idMatch = idRegex.exec(html)) !== null) {
    const id = idMatch[1];
    rawIds.push(id);
    idCounts[id] = (idCounts[id] || 0) + 1;
  }

  const uniqueIds = Object.keys(idCounts);
  const duplicateIds = uniqueIds.filter(id => idCounts[id] > 1);

  check('2.1 Total unique DOM IDs count matches exactly 283', uniqueIds.length === 283, `Found ${uniqueIds.length} unique IDs (raw total: ${rawIds.length})`);
  check('2.2 Zero duplicate IDs exist in index.html', duplicateIds.length === 0, `Duplicates: ${duplicateIds.join(', ')}`);

  // Validate format of each ID: no whitespace, no invalid characters
  const malformedIds = rawIds.filter(id => {
    // Standard HTML5 / CSS identifier pattern: must not contain whitespace and should match valid token chars
    return /\s/.test(id) || !/^[A-Za-z0-9_\-]+$/.test(id);
  });
  check('2.3 All DOM IDs have valid format without whitespace or forbidden characters', malformedIds.length === 0, `Malformed: ${malformedIds.join(', ')}`);

  // Verify critical known IDs
  const criticalIds = [
    'onboardingModal', 'drawerEndpointEdit', 'modalModelSettings', 'modalDeviceFlow', 'modalMsaAuth',
    'tab-viewer', 'tab-map', 'tab-schematics', 'tab-settings',
    'tabBtnViewer', 'tabBtnMap', 'tabBtnSchematics', 'tabBtnSettings',
    'viewerWrapper', 'viewerFrame', 'btnFullscreenViewer', 'btnPopoutViewer', 'viewerDetachedPlaceholder', 'btnReembedViewer', 'btnRefocusPopout',
    'obVersionChips', 'cfgMcVersionChips', 'cfgReconnectBot', 'obVersion', 'cfgMcVersion',
    'btnConfirmBuild', 'btnUndoBuild', 'btnStopBuild', 'chatMessages', 'chatForm', 'txtPrompt', 'chkAutoExecute'
  ];
  let missingCritical = criticalIds.filter(id => !idCounts[id]);
  check('2.4 All critical contract DOM IDs are present', missingCritical.length === 0, `Missing: ${missingCritical.join(', ')}`);

  // ==============================================================================
  // SUITE 3: Dialog & Modal Accessibility Semantics
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 3] Dialog & Modal Accessibility Semantics ---\x1b[0m');

  // Find all <dialog> or elements with role="dialog"
  // Scan all tags in the document
  const dialogElements = [];
  for (const tag of openingTags) {
    if (tag.toLowerCase().startsWith('<dialog') || /role=["']dialog["']/i.test(tag)) {
      const attrs = parseAttributes(tag);
      dialogElements.push({ tag, attrs });
    }
  }

  check('3.1 Dialog elements found in index.html (at least 5 modals/drawers)', dialogElements.length >= 5, `Found: ${dialogElements.length}`);

  let allDialogsHaveModal = true;
  let allDialogsHaveAriaLabelledby = true;
  let allDialogHeadersExist = true;
  const invalidDialogs = [];

  for (const dlg of dialogElements) {
    const id = dlg.attrs.id || '(no-id)';
    const ariaModal = dlg.attrs['aria-modal'];
    const ariaLabelledby = dlg.attrs['aria-labelledby'];

    if (ariaModal !== 'true') {
      allDialogsHaveModal = false;
      invalidDialogs.push(`${id} missing aria-modal="true" (has "${ariaModal}")`);
    }

    if (!ariaLabelledby) {
      allDialogsHaveAriaLabelledby = false;
      invalidDialogs.push(`${id} missing aria-labelledby attribute`);
    } else {
      // Check if the referenced header ID exists in the DOM
      if (!idCounts[ariaLabelledby]) {
        allDialogHeadersExist = false;
        invalidDialogs.push(`${id} aria-labelledby="${ariaLabelledby}" references non-existent ID`);
      }
    }
  }

  check('3.2 All dialog/modal elements declare aria-modal="true"', allDialogsHaveModal, invalidDialogs.join('; '));
  check('3.3 All dialog/modal elements declare aria-labelledby referencing existing headers', allDialogsHaveAriaLabelledby && allDialogHeadersExist, invalidDialogs.join('; '));

  // Verify close buttons within dialogs
  const closeButtonIds = ['btnCloseOnboarding', 'btnCloseDrawer', 'btnCancelDeviceFlow', 'btnCloseMsaModal'];
  let missingCloseButtons = closeButtonIds.filter(id => !idCounts[id]);
  check('3.4 All modal close buttons exist in DOM', missingCloseButtons.length === 0, `Missing: ${missingCloseButtons.join(', ')}`);

  // ==============================================================================
  // SUITE 4: Tablist, Tabs, and Tabpanels Semantic Hierarchy
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 4] Tablist, Tabs & Tabpanels Accessibility Hierarchy ---\x1b[0m');

  const tablists = openingTags.filter(t => /role=["']tablist["']/i.test(t));
  check('4.1 Exactly one primary tablist container found', tablists.length === 1, `Found: ${tablists.length}`);

  if (tablists.length > 0) {
    const tablistAttrs = parseAttributes(tablists[0]);
    check('4.2 Tablist has aria-label or aria-labelledby', Boolean(tablistAttrs['aria-label'] || tablistAttrs['aria-labelledby']), `Attrs: ${JSON.stringify(tablistAttrs)}`);
  }

  // Find all role="tab" elements
  const tabButtons = [];
  for (const tag of openingTags) {
    if (/role=["']tab["']/i.test(tag)) {
      tabButtons.push({ tag, attrs: parseAttributes(tag) });
    }
  }

  check('4.3 Tab buttons found (expect 4 navigation tabs)', tabButtons.length === 4, `Found: ${tabButtons.length}`);

  let allTabsHaveControls = true;
  let allTabsHaveSelected = true;
  let allControlledPanesExist = true;
  let activeTabCount = 0;
  const invalidTabs = [];

  for (const tab of tabButtons) {
    const id = tab.attrs.id || '(no-id)';
    const controls = tab.attrs['aria-controls'];
    const selected = tab.attrs['aria-selected'];

    if (!controls) {
      allTabsHaveControls = false;
      invalidTabs.push(`${id} missing aria-controls`);
    } else if (!idCounts[controls]) {
      allControlledPanesExist = false;
      invalidTabs.push(`${id} aria-controls="${controls}" target does not exist`);
    }

    if (selected === undefined) {
      allTabsHaveSelected = false;
      invalidTabs.push(`${id} missing aria-selected`);
    } else if (selected === 'true') {
      activeTabCount++;
    }
  }

  check('4.4 All tab buttons have valid aria-controls referencing existing pane IDs', allTabsHaveControls && allControlledPanesExist, invalidTabs.join('; '));
  check('4.5 All tab buttons have aria-selected ("true" or "false")', allTabsHaveSelected, invalidTabs.join('; '));
  check('4.6 Exactly one tab is initially marked active (aria-selected="true")', activeTabCount === 1, `Active tabs: ${activeTabCount}`);

  // Find all role="tabpanel" elements
  const tabPanels = [];
  for (const tag of openingTags) {
    if (/role=["']tabpanel["']/i.test(tag)) {
      tabPanels.push({ tag, attrs: parseAttributes(tag) });
    }
  }

  check('4.7 Tab panels found (expect 4 navigation panels)', tabPanels.length === 4, `Found: ${tabPanels.length}`);

  let allPanesHaveLabelledby = true;
  let allReferencedTabsExist = true;
  const invalidPanes = [];

  for (const pane of tabPanels) {
    const id = pane.attrs.id || '(no-id)';
    const labelledby = pane.attrs['aria-labelledby'];

    if (!labelledby) {
      allPanesHaveLabelledby = false;
      invalidPanes.push(`${id} missing aria-labelledby`);
    } else if (!idCounts[labelledby]) {
      allReferencedTabsExist = false;
      invalidPanes.push(`${id} aria-labelledby="${labelledby}" target does not exist`);
    }
  }

  check('4.8 All tab panels have valid aria-labelledby referencing existing tab button IDs', allPanesHaveLabelledby && allReferencedTabsExist, invalidPanes.join('; '));

  // Verify reciprocal mapping between tab and tabpanel
  let reciprocalValid = true;
  const reciprocalErrors = [];
  for (const tab of tabButtons) {
    const tabId = tab.attrs.id;
    const paneId = tab.attrs['aria-controls'];
    const matchingPane = tabPanels.find(p => p.attrs.id === paneId);
    if (!matchingPane) {
      reciprocalValid = false;
      reciprocalErrors.push(`Tab #${tabId} controls non-panel #${paneId}`);
    } else if (matchingPane.attrs['aria-labelledby'] !== tabId) {
      reciprocalValid = false;
      reciprocalErrors.push(`Tab #${tabId} controls #${paneId}, but #${paneId} has aria-labelledby="${matchingPane.attrs['aria-labelledby']}"`);
    }
  }
  check('4.9 Reciprocal mapping between tabs (aria-controls) and panels (aria-labelledby) is 100% consistent', reciprocalValid, reciprocalErrors.join('; '));

  // ==============================================================================
  // SUITE 5: Empty / Icon Button Accessibility
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 5] Empty / Icon Button Accessibility ---\x1b[0m');

  // Parse all <button ...>...</button>
  const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  let btnMatch;
  const allButtons = [];
  const inaccessibleButtons = [];

  while ((btnMatch = buttonRegex.exec(html)) !== null) {
    const fullAttrs = btnMatch[1];
    const innerContent = btnMatch[2];
    const attrs = parseAttributes('<button ' + fullAttrs + '>');

    // Strip HTML tags from inner content to see visible text
    const textContent = innerContent.replace(/<[^>]*>/g, '').trim();

    // Check if button text is empty or consists purely of non-alphanumeric icon/symbols
    // Common icon glyphs: ✕, ✖, ⤺, ⧉, ⚙️, ⟳, 👁️, 🔍, ✏️, ▶, ⏸, ▲, ▼, ◄, ►, ↕, ↔, ⤿, ⥀, +, -, etc.
    const isGlyphOnly = /^[^a-zA-Z0-9\u00C0-\u017F]*$/.test(textContent);
    const isEmptyOrIcon = textContent.length === 0 || isGlyphOnly;

    const hasAriaLabel = Boolean(attrs['aria-label'] && attrs['aria-label'].trim().length > 0);
    const hasTitle = Boolean(attrs['title'] && attrs['title'].trim().length > 0);
    const hasAccessibleName = hasAriaLabel || hasTitle || (!isEmptyOrIcon && textContent.length > 0);

    const btnInfo = {
      id: attrs.id || '(no-id)',
      class: attrs.class || '',
      textContent,
      hasAriaLabel,
      ariaLabel: attrs['aria-label'],
      hasTitle,
      title: attrs.title,
      isEmptyOrIcon
    };

    allButtons.push(btnInfo);

    if (isEmptyOrIcon && !hasAriaLabel && !hasTitle) {
      inaccessibleButtons.push(btnInfo);
    }
  }

  check('5.1 All buttons in index.html parsed', allButtons.length > 0, `Total buttons found: ${allButtons.length}`);
  check('5.2 Every icon-only or glyph button has an aria-label or title', inaccessibleButtons.length === 0,
    inaccessibleButtons.length > 0 ? `Inaccessible buttons: ${inaccessibleButtons.map(b => `${b.id} ("${b.textContent}")`).join(', ')}` : null);

  // Spot-check explicit required icon buttons
  const requiredIconButtons = [
    { id: 'btnCloseOnboarding', expected: 'Schließen' },
    { id: 'btnCloseDrawer', expected: 'Schließen' },
    { id: 'btnCancelDeviceFlow', expected: 'Schließen' },
    { id: 'btnCloseMsaModal', expected: 'Schließen' },
    { id: 'btnRefreshMap', expected: '2D-Grundstücksraster aktualisieren' },
    { id: 'btnRefreshSchematics', expected: 'Lokale Schematic-Dateien aktualisieren' },
    { id: 'btnResetSlicer', expected: 'Y-Schnitt-Höhe auf Maximum zurücksetzen' },
    { id: 'btnClearSelectionBox', expected: 'Aktiven 3D-Auswahlbereich aufheben' },
    { id: 'btnDismissErrorBanner', expected: 'Modell-Fehlermeldung ausblenden' },
    { id: 'btnToggleSecretVisibility', expected: 'API-Schlüssel Sichtbarkeit umschalten' },
    { id: 'btnMirrorX', expected: 'spiegeln' },
    { id: 'btnMirrorZ', expected: 'spiegeln' },
    { id: 'btnRotate90', expected: 'drehen' },
    { id: 'btnShiftYUp', expected: 'verschieben' },
    { id: 'btnShiftYDown', expected: 'verschieben' }
  ];

  for (const req of requiredIconButtons) {
    const btn = allButtons.find(b => b.id === req.id);
    const hasMatch = btn && ((btn.ariaLabel && btn.ariaLabel.includes(req.expected)) || (btn.title && btn.title.includes(req.expected)));
    check(`5.3 Required button #${req.id} has descriptive label containing "${req.expected}"`, Boolean(hasMatch),
      btn ? `Got aria-label="${btn.ariaLabel}", title="${btn.title}"` : 'Button not found');
  }

  // ==============================================================================
  // SUITE 6: Structural Comment & Test Invariant Compliance
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 6] Structural Comment & Test Invariants ---\x1b[0m');

  const tab2CommentRegex = /<div\s+id=["']tab-viewer["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*TAB 2/i;
  const tab2Match = tab2CommentRegex.test(html);
  check('6.1 Invariant: <div id="tab-viewer"> closing tag is immediately followed by <!-- TAB 2', tab2Match);

  // Check iframe attributes
  const iframeMatch = html.match(/<iframe\b([^>]*)>/i);
  check('6.2 #viewerFrame iframe tag exists', Boolean(iframeMatch));
  if (iframeMatch) {
    const iframeAttrs = parseAttributes(iframeMatch[0]);
    check('6.3 Iframe id is "viewerFrame"', iframeAttrs.id === 'viewerFrame');
    check('6.4 Iframe allow includes "fullscreen"', (iframeAttrs.allow || '').includes('fullscreen'));
    check('6.5 Iframe allow includes "pointer-lock"', (iframeAttrs.allow || '').includes('pointer-lock'));
    check('6.6 Iframe has allowfullscreen boolean attribute', 'allowfullscreen' in iframeAttrs);
  }

  // Check #cfgReconnectBot checkbox
  const reconnectInput = html.match(/<input\b[^>]*id=["']cfgReconnectBot["'][^>]*>/i);
  check('6.7 #cfgReconnectBot input exists', Boolean(reconnectInput));
  if (reconnectInput) {
    const attrs = parseAttributes(reconnectInput[0]);
    check('6.8 #cfgReconnectBot is type="checkbox"', attrs.type === 'checkbox');
    check('6.9 #cfgReconnectBot is checked by default', 'checked' in attrs);
  }

  // Check version chips in both containers
  const obChipsMatch = html.match(/<div\b[^>]*id=["']obVersionChips["'][^>]*>([\s\S]*?)<\/div>/i);
  const cfgChipsMatch = html.match(/<div\b[^>]*id=["']cfgMcVersionChips["'][^>]*>([\s\S]*?)<\/div>/i);
  check('6.10 #obVersionChips container found', Boolean(obChipsMatch));
  check('6.11 #cfgMcVersionChips container found', Boolean(cfgChipsMatch));

  const expectedVersions = ['auto', '26.3', '1.21.4', '1.21.1', '1.20.4', '1.20.1'];
  if (obChipsMatch) {
    for (const v of expectedVersions) {
      check(`6.12 #obVersionChips contains chip data-ver="${v}"`, obChipsMatch[1].includes(`data-ver="${v}"`));
    }
  }
  if (cfgChipsMatch) {
    for (const v of expectedVersions) {
      check(`6.13 #cfgMcVersionChips contains chip data-ver="${v}"`, cfgChipsMatch[1].includes(`data-ver="${v}"`));
    }
  }

  // Check verbatim German strings verified by test suites
  const verbatimStrings = [
    '● KAMERA AUSGELAGERT (MULTI-MONITOR)',
    '⤺ Im Cockpit wiedereinbetten',
    '⧉ Fenster fokussieren',
    'Schnitt-Höhe Y: 1 bis Max',
    'In Minecraft-Welt bauen',
    'Letzten Bau rückgängig (!undo)',
    'Not-Stopp (!stop)',
    'title="Vollbildmodus aktivieren"',
    'title="Kamera in separatem Fenster/Tab öffnen"'
  ];

  for (const str of verbatimStrings) {
    check(`6.14 Verbatim string preserved: "${str}"`, html.includes(str));
  }

  // ==============================================================================
  // SUITE 7: Cross-Reference DOM Pointer Validation (Adversarial)
  // ==============================================================================
  console.log('\n\x1b[36m--- [SUITE 7] Global ARIA & Label Pointer Cross-Reference Validation ---\x1b[0m');

  // Check all label for="..."
  const labelForRegex = /<label\b[^>]*\bfor=["']([^"']+)["'][^>]*>/gi;
  let lblMatch;
  const danglingLabels = [];
  while ((lblMatch = labelForRegex.exec(html)) !== null) {
    const targetId = lblMatch[1];
    if (!idCounts[targetId]) {
      danglingLabels.push(targetId);
    }
  }
  check('7.1 All <label for="..."> attributes reference existing DOM IDs', danglingLabels.length === 0, `Dangling label targets: ${danglingLabels.join(', ')}`);

  // Check all aria-labelledby throughout document
  const ariaLabelledbyRegex = /\baria-labelledby=["']([^"']+)["']/gi;
  let alMatch;
  const danglingLabelledby = [];
  while ((alMatch = ariaLabelledbyRegex.exec(html)) !== null) {
    const targetIds = alMatch[1].split(/\s+/).filter(Boolean);
    for (const tid of targetIds) {
      if (!idCounts[tid]) {
        danglingLabelledby.push(tid);
      }
    }
  }
  check('7.2 All aria-labelledby attributes reference existing DOM IDs', danglingLabelledby.length === 0, `Dangling aria-labelledby targets: ${danglingLabelledby.join(', ')}`);

  // Check all aria-describedby throughout document
  const ariaDescribedbyRegex = /\baria-describedby=["']([^"']+)["']/gi;
  let adMatch;
  const danglingDescribedby = [];
  while ((adMatch = ariaDescribedbyRegex.exec(html)) !== null) {
    const targetIds = adMatch[1].split(/\s+/).filter(Boolean);
    for (const tid of targetIds) {
      if (!idCounts[tid]) {
        danglingDescribedby.push(tid);
      }
    }
  }
  check('7.3 All aria-describedby attributes reference existing DOM IDs', danglingDescribedby.length === 0, `Dangling aria-describedby targets: ${danglingDescribedby.join(', ')}`);

  // ==============================================================================
  // Summary
  // ==============================================================================
  console.log('\n\x1b[35m================================================================================\x1b[0m');
  console.log(`\x1b[35m=== SUMMARY: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed}) ===\x1b[0m`);
  console.log('\x1b[35m================================================================================\x1b[0m\n');

  if (failed > 0) {
    console.error('\x1b[31mFailure Details:\x1b[0m');
    failures.forEach((f, idx) => {
      console.error(`  ${idx + 1}. ${f.title} ${f.extraInfo ? '(' + f.extraInfo + ')' : ''}`);
    });
    process.exit(1);
  } else {
    console.log('\x1b[32m[ALL ADVERSARIAL HTML CHECKS PASSED]\x1b[0m');
    process.exit(0);
  }
}

runAdversarialProbe();
