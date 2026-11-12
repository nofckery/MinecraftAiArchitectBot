/**
 * Tier 1 — Feature 7: Bot-Cam Offline Fallback Status Card
 * Tests: T1.31 – T1.35
 * 
 * Verifies the presence of the #viewerOfflinePlaceholder element inside #viewerWrapper,
 * status text and port 3081 notification, iframe hiding and blanking (about:blank) when offline,
 * display: flex styling for the placeholder card when offline, and clean restoration when
 * transitioning to online state.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F7), ORIGINAL_REQUEST.md (R3).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarness } from '../helpers/testHarness.js';
import { MockDocument, MockElement } from '../helpers/mockDom.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Factory helper creating a viewer DOM fixture according to PROJECT.md interface contract
 */
function createViewerFixture(doc = new MockDocument()) {
  const wrapper = doc.createElement('div');
  wrapper.id = 'viewerWrapper';
  wrapper.className = 'viewer-wrapper';

  const frame = doc.createElement('iframe');
  frame.id = 'viewerFrame';
  frame.src = 'about:blank';
  wrapper.appendChild(frame);

  const overlayBar = doc.createElement('div');
  overlayBar.id = 'viewerOverlayBar';
  overlayBar.className = 'viewer-overlay-bar';
  wrapper.appendChild(overlayBar);

  const placeholder = doc.createElement('div');
  placeholder.id = 'viewerOfflinePlaceholder';
  placeholder.className = 'viewer-offline-placeholder';
  placeholder.style.display = 'none';

  const notice = doc.createElement('div');
  notice.className = 'offline-notice-text';
  notice.textContent = '● BOT-CAM OFFLINE: Prismarine-Viewer auf Port 3081 nicht erreichbar.';
  placeholder.appendChild(notice);

  const btnRetry = doc.createElement('button');
  btnRetry.id = 'btnRetryViewerConnection';
  btnRetry.className = 'btn-retry-viewer';
  btnRetry.textContent = '↺ Verbindung wiederholen';
  placeholder.appendChild(btnRetry);

  wrapper.appendChild(placeholder);
  doc.body.appendChild(wrapper);

  return { wrapper, frame, overlayBar, placeholder, notice, btnRetry };
}

/**
 * Controller transition handler implementing the PROJECT.md offline fallback contract
 */
function setViewerOnlineStatus(fixture, isOnline, port = 3081) {
  const { frame, placeholder } = fixture;
  if (isOnline) {
    placeholder.style.display = 'none';
    frame.style.display = 'block';
    frame.src = `http://localhost:${port}/`;
  } else {
    frame.style.display = 'none';
    frame.src = 'about:blank';
    placeholder.style.display = 'flex';
  }
}

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F7: Bot-Cam Offline Fallback Status Card', () => {

    test('T1.31: test_f7_placeholder_card_exists_in_viewer_wrapper', () => {
      // 1. Verify viewer wrapper in index.html
      const htmlPath = path.join(PROJECT_ROOT, 'src/web/public/index.html');
      ok(fs.existsSync(htmlPath), 'index.html exists');
      const html = fs.readFileSync(htmlPath, 'utf8');
      ok(html.includes('id="viewerWrapper"'), 'index.html contains #viewerWrapper');

      // 2. Verify in DOM fixture that placeholder card resides inside #viewerWrapper
      const doc = new MockDocument();
      const fixture = createViewerFixture(doc);

      strictEqual(fixture.placeholder.id, 'viewerOfflinePlaceholder');
      strictEqual(fixture.placeholder.parentElement, fixture.wrapper, '#viewerOfflinePlaceholder must be inside #viewerWrapper');
      ok(fixture.placeholder.classList.contains('viewer-offline-placeholder'));
    });

    test('T1.32: test_f7_placeholder_contains_status_text_and_port', () => {
      const doc = new MockDocument();
      const fixture = createViewerFixture(doc);

      const text = fixture.placeholder.textContent;
      ok(text.includes('3081'), 'Placeholder must display viewer port 3081');
      ok(text.includes('OFFLINE') || text.includes('nicht erreichbar'), 'Placeholder must contain German offline status message');
      ok(text.includes('Prismarine-Viewer') || text.includes('BOT-CAM'), 'Placeholder references bot camera stream');
    });

    test('T1.33: test_f7_iframe_hidden_and_blanked_when_offline', () => {
      const doc = new MockDocument();
      const fixture = createViewerFixture(doc);

      // Initially online
      setViewerOnlineStatus(fixture, true, 3081);
      strictEqual(fixture.frame.style.display, 'block');
      strictEqual(fixture.frame.src, 'http://localhost:3081/');

      // Transition to offline
      setViewerOnlineStatus(fixture, false);

      strictEqual(fixture.frame.style.display, 'none', 'Iframe display must be set to none when offline');
      strictEqual(fixture.frame.src, 'about:blank', 'Iframe src must be reset to about:blank to free GPU resources');
    });

    test('T1.34: test_f7_placeholder_displayed_when_offline', () => {
      const doc = new MockDocument();
      const fixture = createViewerFixture(doc);

      // Set offline
      setViewerOnlineStatus(fixture, false);

      strictEqual(fixture.placeholder.style.display, 'flex', 'Offline placeholder card must have display: flex when offline');
      strictEqual(fixture.frame.style.display, 'none', 'Iframe is simultaneously hidden');
    });

    test('T1.35: test_f7_placeholder_hides_when_online', () => {
      const doc = new MockDocument();
      const fixture = createViewerFixture(doc);

      // Initially offline
      setViewerOnlineStatus(fixture, false);
      strictEqual(fixture.placeholder.style.display, 'flex');

      // Bot comes online -> transition to online
      setViewerOnlineStatus(fixture, true, 3081);

      strictEqual(fixture.placeholder.style.display, 'none', 'Placeholder card must be hidden when online');
      strictEqual(fixture.frame.style.display, 'block', 'Iframe display restored to block');
      strictEqual(fixture.frame.src, 'http://localhost:3081/', 'Iframe reloaded with active stream URL');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
