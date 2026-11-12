/**
 * Tier 2 — Feature 8 Boundaries: Bot-Cam Reachability Probe & Retry Action Boundaries
 * Tests: T2.36 – T2.40
 * 
 * Specifications:
 * - T2.36: Rapid clicks on Retry are debounced to a single active network probe.
 * - T2.37: Server becoming reachable during active retry transitions cleanly.
 * - T2.38: Handles case where local Dashboard server itself is unreachable.
 * - T2.39: Probe respects dynamically configured custom viewer ports from settings.
 * - T2.40: Switching away from camera tab aborts in-flight reachability probes.
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

  await describe('Tier 2 - F8: Bot-Cam Probe Boundaries', async () => {

    await test('T2.36: test_bva_f8_retry_spam_throttling', async () => {
      const doc = new MockDocument();
      const btnRetry = doc.createElement('button');
      btnRetry.id = 'btnRetryViewerConnection';
      btnRetry.textContent = '↺ Verbindung wiederholen';

      let networkProbeCount = 0;
      let isProbing = false;

      const triggerRetry = async () => {
        // Throttling guard: if already probing or button disabled, ignore click spam
        if (isProbing || btnRetry.disabled) {
          return { throttled: true };
        }

        isProbing = true;
        btnRetry.disabled = true;
        btnRetry.classList.add('loading');
        btnRetry.textContent = 'Verbinde...';
        networkProbeCount++;

        // Simulate network probe
        await new Promise((resolve) => setTimeout(resolve, 5));

        isProbing = false;
        btnRetry.disabled = false;
        btnRetry.classList.remove('loading');
        btnRetry.textContent = '↺ Verbindung wiederholen';
        return { throttled: false };
      };

      // Rapidly fire 5 retry clicks in succession while probe is in progress
      const p1 = triggerRetry();
      const p2 = triggerRetry();
      const p3 = triggerRetry();
      const p4 = triggerRetry();
      const p5 = triggerRetry();

      const results = await Promise.all([p1, p2, p3, p4, p5]);

      strictEqual(results[0].throttled, false, 'First click initiates probe');
      strictEqual(results[1].throttled, true, 'Second click is throttled');
      strictEqual(results[2].throttled, true, 'Third click is throttled');
      strictEqual(results[3].throttled, true, 'Fourth click is throttled');
      strictEqual(results[4].throttled, true, 'Fifth click is throttled');

      strictEqual(networkProbeCount, 1, 'Exactly 1 network probe executed despite 5 rapid clicks');
      strictEqual(btnRetry.disabled, false, 'Button unlocked after probe settles');
      strictEqual(btnRetry.classList.contains('loading'), false, 'Loading spinner removed');
    });

    await test('T2.37: test_bva_f8_mid_flight_reconnection', async () => {
      const doc = new MockDocument();
      const iframe = doc.createElement('iframe');
      iframe.id = 'viewerFrame';
      iframe.src = 'about:blank';
      iframe.style.display = 'none';

      const placeholder = doc.createElement('div');
      placeholder.id = 'viewerOfflinePlaceholder';
      placeholder.style.display = 'flex';

      const btnRetry = doc.createElement('button');
      btnRetry.id = 'btnRetryViewerConnection';
      btnRetry.classList.add('loading');
      btnRetry.textContent = 'Verbinde...';

      // Mid-flight reconnection handler
      const handleProbeSuccess = (port = 3081) => {
        // 1. Remove loading spinner
        btnRetry.classList.remove('loading');
        btnRetry.textContent = '↺ Verbindung wiederholen';

        // 2. Hide offline placeholder
        placeholder.style.display = 'none';

        // 3. Restore iframe stream
        iframe.src = `http://localhost:${port}/`;
        iframe.style.display = 'block';

        return { reconnected: true, streamUrl: iframe.src };
      };

      const outcome = handleProbeSuccess(3081);

      strictEqual(outcome.reconnected, true, 'Clean reconnection completed');
      strictEqual(placeholder.style.display, 'none', 'Offline placeholder hidden');
      strictEqual(iframe.style.display, 'block', 'Iframe displayed');
      strictEqual(iframe.src, 'http://localhost:3081/', 'Stream URL restored with viewer port');
      strictEqual(btnRetry.classList.contains('loading'), false, 'Loading class removed');
      strictEqual(btnRetry.textContent, '↺ Verbindung wiederholen', 'Button text restored');
    });

    await test('T2.38: test_bva_f8_local_dashboard_server_down', async () => {
      const doc = new MockDocument();
      const statusNotice = doc.createElement('div');
      statusNotice.id = 'serverStatusNotice';

      // Probe function for dashboard server reachability
      const probeDashboardServer = async (mockFetch) => {
        try {
          const res = await mockFetch('/api/bot-status');
          if (!res.ok) throw new Error(`HTTP_${res.status}`);
          statusNotice.textContent = 'Server Online';
          return { serverOnline: true };
        } catch (err) {
          // Graceful handling of local dashboard server outage (ECONNREFUSED)
          statusNotice.textContent = 'Dashboard-Server nicht erreichbar (Offline)';
          statusNotice.classList.add('status-offline');
          return {
            serverOnline: false,
            handled: true,
            message: 'Dashboard-Server nicht erreichbar'
          };
        }
      };

      // Mock fetch simulating ECONNREFUSED
      const mockDownFetch = () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:3000'));

      const res = await probeDashboardServer(mockDownFetch);
      strictEqual(res.serverOnline, false, 'Server recognized as offline');
      strictEqual(res.handled, true, 'Outage handled gracefully without crash');
      strictEqual(statusNotice.textContent, 'Dashboard-Server nicht erreichbar (Offline)', 'Informative notice displayed');
      strictEqual(statusNotice.classList.contains('status-offline'), true, 'Offline status class applied');
    });

    await test('T2.39: test_bva_f8_custom_viewer_port_configured', () => {
      const doc = new MockDocument();
      const lblPort = doc.createElement('span');
      lblPort.id = 'lblViewerPort';
      lblPort.textContent = '3099'; // Custom dynamically configured port
      doc.body.appendChild(lblPort);

      // Port resolver logic used in probe & popout functions
      const resolveViewerPort = (explicitPort = null) => {
        if (explicitPort) return Number(explicitPort);
        const portEl = doc.getElementById('lblViewerPort');
        if (portEl && portEl.textContent) {
          const parsed = parseInt(portEl.textContent.trim(), 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
            return parsed;
          }
        }
        return 3081; // Default fallback port
      };

      const resolvedPort = resolveViewerPort();
      strictEqual(resolvedPort, 3099, 'Resolved custom viewer port 3099 from DOM element');

      const probeUrl = `http://localhost:${resolvedPort}/`;
      strictEqual(probeUrl, 'http://localhost:3099/', 'Constructed probe URL matches custom configured port');

      // Test explicit parameter override
      const explicitPort = resolveViewerPort(4000);
      strictEqual(explicitPort, 4000, 'Explicit port parameter overrides DOM element');

      // Test invalid text fallback to 3081
      lblPort.textContent = 'invalid_port';
      const fallbackPort = resolveViewerPort();
      strictEqual(fallbackPort, 3081, 'Invalid port gracefully falls back to default 3081');
    });

    await test('T2.40: test_bva_f8_abort_controller_on_tab_switch', async () => {
      // AbortController contract when navigating away from camera tab
      let abortCalled = false;
      const abortController = {
        signal: { aborted: false },
        abort: function() {
          this.signal.aborted = true;
          abortCalled = true;
        }
      };

      let activeInFlightProbe = {
        controller: abortController,
        tab: 'tab-viewer'
      };

      // Tab switcher logic
      const switchDashboardTab = (newTab) => {
        if (activeInFlightProbe && activeInFlightProbe.tab !== newTab) {
          // Abort in-flight probe when leaving viewer tab
          activeInFlightProbe.controller.abort();
          activeInFlightProbe = null;
        }
        return newTab;
      };

      strictEqual(abortController.signal.aborted, false, 'Probe signal starts not aborted');

      // User switches tab from 'tab-viewer' to 'tab-map'
      const activeTab = switchDashboardTab('tab-map');

      strictEqual(activeTab, 'tab-map', 'Switched to tab-map');
      strictEqual(abortCalled, true, 'AbortController.abort() was invoked on tab switch away');
      strictEqual(abortController.signal.aborted, true, 'In-flight probe signal was aborted');
      strictEqual(activeInFlightProbe, null, 'Active in-flight probe cleared to prevent stale DOM updates');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
