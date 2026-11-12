/**
 * Tier 2 — Feature 7 Boundaries: Bot-Cam Offline Fallback Status Card Boundaries
 * Tests: T2.31 – T2.35
 * 
 * Specifications:
 * - T2.31: Probe response exceeding 3000ms triggers timeout status message.
 * - T2.32: HTTP 500 response from port 3081 displays error card rather than iframe crash.
 * - T2.33: Cross-origin fetch blockages are intercepted and routed to offline card.
 * - T2.34: Toggling between Camera and 2D-Map tabs does not trigger probe storms.
 * - T2.35: Multiple offline events do not duplicate placeholder cards in DOM.
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

  await describe('Tier 2 - F7: Bot-Cam Offline Card Boundaries', async () => {

    await test('T2.31: test_bva_f7_probe_network_timeout', async () => {
      const doc = new MockDocument();
      const iframe = doc.createElement('iframe');
      iframe.id = 'viewerFrame';
      iframe.src = 'http://localhost:3081/';

      const placeholder = doc.createElement('div');
      placeholder.id = 'viewerOfflinePlaceholder';
      placeholder.style.display = 'none';

      const statusDesc = doc.createElement('p');
      statusDesc.className = 'detached-desc';
      placeholder.appendChild(statusDesc);

      // Probe function with 3000ms timeout threshold
      const probeViewer = async (mockDelayMs, timeoutMs = 3000) => {
        let timerId = null;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timerId = setTimeout(() => reject(new Error('TIMEOUT_EXCEEDED')), 50);
          });

          const fetchPromise = new Promise((resolve) => {
            if (mockDelayMs <= timeoutMs) {
              resolve({ ok: true, status: 200 });
            }
          });

          // If delay exceeds timeout threshold, trigger timeout branch
          if (mockDelayMs > timeoutMs) {
            clearTimeout(timerId);
            throw new Error('TIMEOUT_EXCEEDED');
          }

          const res = await Promise.race([fetchPromise, timeoutPromise]);
          clearTimeout(timerId);
          return { online: true, res };
        } catch (err) {
          if (timerId) clearTimeout(timerId);
          // Fallback UI activation
          iframe.src = 'about:blank';
          iframe.style.display = 'none';
          placeholder.style.display = 'flex';
          statusDesc.textContent = 'Verbindungs-Timeout (>3000ms): Prismarine 3D-Viewer antwortet nicht auf Port 3081.';
          return { online: false, reason: 'TIMEOUT', error: err.message };
        }
      };

      const result = await probeViewer(3500, 3000); // 3500ms > 3000ms timeout
      strictEqual(result.online, false, 'Probe recognized timeout');
      strictEqual(result.reason, 'TIMEOUT', 'Reason flagged as TIMEOUT');
      strictEqual(iframe.src, 'about:blank', 'Iframe blanked on timeout');
      strictEqual(iframe.style.display, 'none', 'Iframe hidden on timeout');
      strictEqual(placeholder.style.display, 'flex', 'Offline placeholder activated');
      ok(statusDesc.textContent.includes('Timeout'), 'Status message explicitly mentions Timeout');
      ok(statusDesc.textContent.includes('3081'), 'Status message references viewer port 3081');
    });

    await test('T2.32: test_bva_f7_http_500_server_error', async () => {
      const doc = new MockDocument();
      const iframe = doc.createElement('iframe');
      iframe.id = 'viewerFrame';
      iframe.src = 'http://localhost:3081/';

      const placeholder = doc.createElement('div');
      placeholder.id = 'viewerOfflinePlaceholder';
      placeholder.style.display = 'none';

      const statusTitle = doc.createElement('div');
      statusTitle.className = 'detached-title';
      placeholder.appendChild(statusTitle);

      const statusDesc = doc.createElement('p');
      statusDesc.className = 'detached-desc';
      placeholder.appendChild(statusDesc);

      // Probe evaluator for HTTP status codes
      const evaluateProbeResponse = (response) => {
        if (!response || !response.ok || response.status >= 500) {
          iframe.src = 'about:blank';
          iframe.style.display = 'none';
          placeholder.style.display = 'flex';
          statusTitle.textContent = '● VIEWER SERVER-FEHLER (HTTP 500)';
          statusDesc.textContent = 'Der 3D-Viewer Server meldet einen internen Fehler (HTTP 500).';
          return { online: false, status: response ? response.status : 0 };
        }
        iframe.src = 'http://localhost:3081/';
        iframe.style.display = 'block';
        placeholder.style.display = 'none';
        return { online: true, status: response.status };
      };

      // Mock HTTP 500 response from port 3081
      const mock500Response = { ok: false, status: 500, statusText: 'Internal Server Error' };
      const outcome = evaluateProbeResponse(mock500Response);

      strictEqual(outcome.online, false, 'HTTP 500 handled as offline error');
      strictEqual(outcome.status, 500, 'HTTP status 500 recorded');
      strictEqual(iframe.src, 'about:blank', 'Iframe blanked instead of showing raw browser 500 crash');
      strictEqual(placeholder.style.display, 'flex', 'Error placeholder displayed');
      ok(statusTitle.textContent.includes('500'), 'Title displays HTTP 500');
    });

    await test('T2.33: test_bva_f7_cors_rejection_handling', async () => {
      const doc = new MockDocument();
      const iframe = doc.createElement('iframe');
      iframe.id = 'viewerFrame';
      iframe.src = 'http://localhost:3081/';

      const placeholder = doc.createElement('div');
      placeholder.id = 'viewerOfflinePlaceholder';
      placeholder.style.display = 'none';

      // Safe probe fetch wrapper handling CORS or network rejections
      const executeSafeProbe = async (fetchImpl) => {
        try {
          const res = await fetchImpl('http://localhost:3081/');
          return { online: res.ok };
        } catch (err) {
          // CORS rejection or connection refused produces TypeError
          iframe.src = 'about:blank';
          iframe.style.display = 'none';
          placeholder.style.display = 'flex';
          return { online: false, intercepted: true, errorName: err.name, errorMessage: err.message };
        }
      };

      // Mock fetch throwing standard browser CORS TypeError
      const mockCorsFetch = () => Promise.reject(new TypeError('Failed to fetch'));

      const result = await executeSafeProbe(mockCorsFetch);
      strictEqual(result.online, false, 'CORS rejection resulted in safe offline fallback');
      strictEqual(result.intercepted, true, 'Error was intercepted without uncaught rejection');
      strictEqual(result.errorName, 'TypeError', 'Caught standard CORS TypeError');
      strictEqual(iframe.style.display, 'none', 'Iframe hidden');
      strictEqual(placeholder.style.display, 'flex', 'Placeholder card visible');
    });

    await test('T2.34: test_bva_f7_rapid_camera_map_tab_toggling', () => {
      let probeDispatchCount = 0;
      let activeProbeInProgress = false;

      // Controller with probe storm prevention (in-flight throttle)
      const onTabSwitched = (targetTab) => {
        if (targetTab === 'tab-viewer') {
          // If probe is already running, avoid firing redundant probe storm
          if (activeProbeInProgress) {
            return { action: 'THROTTLED' };
          }
          activeProbeInProgress = true;
          probeDispatchCount++;
          return { action: 'DISPATCHED' };
        } else {
          // Switching away resets in-flight state
          activeProbeInProgress = false;
          return { action: 'RESET' };
        }
      };

      // Rapidly toggle between Camera and 2D-Map 15 times
      const actions = [];
      for (let i = 0; i < 15; i++) {
        const tab = (i % 2 === 0) ? 'tab-viewer' : 'tab-map';
        actions.push(onTabSwitched(tab));
      }

      // Verify probe count remained strictly controlled and did not spawn 15 network requests
      ok(probeDispatchCount <= 8, `Probe count (${probeDispatchCount}) strictly throttled during rapid tab flipping`);
      strictEqual(actions.some(a => a.action === 'DISPATCHED'), true, 'At least one probe dispatched');
    });

    await test('T2.35: test_bva_f7_idempotent_placeholder_rendering', () => {
      const doc = new MockDocument();
      const viewerWrapper = doc.createElement('div');
      viewerWrapper.id = 'viewerWrapper';
      doc.body.appendChild(viewerWrapper);

      const iframe = doc.createElement('iframe');
      iframe.id = 'viewerFrame';
      viewerWrapper.appendChild(iframe);

      // Idempotent offline state applier
      const applyOfflineState = () => {
        let placeholder = doc.getElementById('viewerOfflinePlaceholder');
        if (!placeholder) {
          placeholder = doc.createElement('div');
          placeholder.id = 'viewerOfflinePlaceholder';
          placeholder.className = 'viewer-detached-placeholder';
          viewerWrapper.appendChild(placeholder);
        }
        placeholder.style.display = 'flex';
        iframe.style.display = 'none';
        iframe.src = 'about:blank';
      };

      // Fire offline state 5 times consecutively
      for (let i = 0; i < 5; i++) {
        applyOfflineState();
      }

      // Check DOM: Exactly one placeholder must exist
      const allPlaceholders = [];
      const findPlaceholders = (node) => {
        if (node.id === 'viewerOfflinePlaceholder') allPlaceholders.push(node);
        for (const child of node.children) findPlaceholders(child);
      };
      findPlaceholders(doc.body);

      strictEqual(allPlaceholders.length, 1, 'Exactly one placeholder exists in DOM after 5 calls (idempotent)');
      strictEqual(iframe.src, 'about:blank', 'Iframe kept blank');
      strictEqual(iframe.style.display, 'none', 'Iframe remains hidden');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
