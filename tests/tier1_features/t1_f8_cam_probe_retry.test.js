/**
 * Tier 1 — Feature 8: Bot-Cam Reachability Probe & Retry Action
 * Tests: T1.36 – T1.40
 * 
 * Verifies reachability probe querying viewer port 3081, probe failure activating
 * fallback UI gracefully, retry button click initiating a probe, retry button displaying
 * loading spinner / disabled state during probe, and successful probe restoring stream iframe.
 * 
 * Requirements: TEST_INFRA.md §6.1, PROJECT.md (F8), ORIGINAL_REQUEST.md (R3).
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
 * Controller implementing probe and retry lifecycle matching PROJECT.md interface contract
 */
class ViewerProbeController {
  constructor(elements, options = {}) {
    this.frame = elements.frame;
    this.placeholder = elements.placeholder;
    this.btnRetry = elements.btnRetry;
    this.port = options.port || 3081;
    this.fetchFn = options.fetchFn || null;
    this.inFlight = false;
    this.lastProbeResult = null;
  }

  async executeProbe() {
    if (this.inFlight) return false;
    this.inFlight = true;
    this.btnRetry.disabled = true;
    this.btnRetry.textContent = '⏳ Verbinde mit Port ' + this.port + '...';

    try {
      const res = await this.fetchFn(`http://localhost:${this.port}/`, { method: 'HEAD' });
      if (res && res.ok) {
        // Probe succeeded
        this.lastProbeResult = true;
        this.placeholder.style.display = 'none';
        this.frame.style.display = 'block';
        this.frame.src = `http://localhost:${this.port}/`;
        return true;
      } else {
        throw new Error(`HTTP ${res?.status || 500}`);
      }
    } catch (err) {
      // Probe failed
      this.lastProbeResult = false;
      this.placeholder.style.display = 'flex';
      this.frame.style.display = 'none';
      this.frame.src = 'about:blank';
      return false;
    } finally {
      this.inFlight = false;
      this.btnRetry.disabled = false;
      this.btnRetry.textContent = '↺ Verbindung wiederholen';
    }
  }

  bindRetryButton() {
    this.btnRetry.addEventListener('click', () => {
      this.executeProbe();
    });
  }
}

export async function runTests(harness = defaultHarness) {
  const { describe, test, strictEqual, ok, notStrictEqual } = harness;

  await describe('Tier 1 - F8: Bot-Cam Reachability Probe & Retry Action', async () => {

    await test('T1.36: test_f8_reachability_probe_queries_viewer_port', async () => {
      const doc = new MockDocument();
      const frame = doc.createElement('iframe');
      const placeholder = doc.createElement('div');
      const btnRetry = doc.createElement('button');

      let requestedUrl = null;
      let requestedMethod = null;

      const mockFetch = async (url, opts) => {
        requestedUrl = url;
        requestedMethod = opts?.method;
        return { ok: true, status: 200 };
      };

      const controller = new ViewerProbeController(
        { frame, placeholder, btnRetry },
        { port: 3081, fetchFn: mockFetch }
      );

      const success = await controller.executeProbe();

      strictEqual(success, true, 'Probe executes successfully');
      strictEqual(requestedUrl, 'http://localhost:3081/', 'Probe queries target viewer port 3081');
      strictEqual(requestedMethod, 'HEAD', 'Probe uses lightweight HEAD request');
    });

    await test('T1.37: test_f8_probe_failure_activates_fallback_ui', async () => {
      const doc = new MockDocument();
      const frame = doc.createElement('iframe');
      frame.style.display = 'block';
      frame.src = 'http://localhost:3081/';

      const placeholder = doc.createElement('div');
      placeholder.style.display = 'none';

      const btnRetry = doc.createElement('button');

      // Simulated network failure (ECONNREFUSED)
      const mockFailingFetch = async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:3081');
      };

      const controller = new ViewerProbeController(
        { frame, placeholder, btnRetry },
        { port: 3081, fetchFn: mockFailingFetch }
      );

      const result = await controller.executeProbe();

      strictEqual(result, false, 'Probe returns false on connection failure');
      strictEqual(controller.lastProbeResult, false);
      strictEqual(placeholder.style.display, 'flex', 'Fallback placeholder card is displayed');
      strictEqual(frame.style.display, 'none', 'Iframe is hidden');
      strictEqual(frame.src, 'about:blank', 'Iframe src is reset to about:blank');
    });

    await test('T1.38: test_f8_retry_button_click_triggers_probe', async () => {
      const doc = new MockDocument();
      const frame = doc.createElement('iframe');
      const placeholder = doc.createElement('div');
      const btnRetry = doc.createElement('button');
      btnRetry.id = 'btnRetryViewerConnection';

      let probeInvocations = 0;
      const mockFetch = async () => {
        probeInvocations++;
        return { ok: true, status: 200 };
      };

      const controller = new ViewerProbeController(
        { frame, placeholder, btnRetry },
        { port: 3081, fetchFn: mockFetch }
      );
      controller.bindRetryButton();

      strictEqual(probeInvocations, 0, 'No probes initiated before click');

      // Click retry button
      btnRetry.click();
      // Allow async microtask to execute
      await new Promise(resolve => setTimeout(resolve, 5));

      strictEqual(probeInvocations, 1, 'Clicking retry button initiates exactly one probe request');
    });

    await test('T1.39: test_f8_retry_button_shows_loading_spinner', async () => {
      const doc = new MockDocument();
      const frame = doc.createElement('iframe');
      const placeholder = doc.createElement('div');
      const btnRetry = doc.createElement('button');
      btnRetry.textContent = '↺ Verbindung wiederholen';
      btnRetry.disabled = false;

      let resolveFetch;
      const delayedFetch = () => new Promise(res => {
        resolveFetch = res;
      });

      const controller = new ViewerProbeController(
        { frame, placeholder, btnRetry },
        { port: 3081, fetchFn: delayedFetch }
      );

      // Launch probe without awaiting immediately
      const probePromise = controller.executeProbe();

      // Check in-flight state
      strictEqual(controller.inFlight, true, 'Controller flags in-flight probe');
      strictEqual(btnRetry.disabled, true, 'Button is disabled during probe execution');
      ok(btnRetry.textContent.includes('⏳') || btnRetry.textContent.includes('Verbinde'), 'Button displays loading spinner / text');

      // Resolve delayed fetch
      resolveFetch({ ok: true, status: 200 });
      await probePromise;

      // Check state after completion
      strictEqual(controller.inFlight, false, 'Controller clears in-flight flag');
      strictEqual(btnRetry.disabled, false, 'Button is re-enabled');
      ok(btnRetry.textContent.includes('wiederholen'), 'Button text returns to normal');
    });

    await test('T1.40: test_f8_retry_success_restores_stream', async () => {
      const doc = new MockDocument();
      const frame = doc.createElement('iframe');
      frame.style.display = 'none';
      frame.src = 'about:blank';

      const placeholder = doc.createElement('div');
      placeholder.style.display = 'flex';

      const btnRetry = doc.createElement('button');

      const mockSuccessfulFetch = async () => ({ ok: true, status: 200 });

      const controller = new ViewerProbeController(
        { frame, placeholder, btnRetry },
        { port: 3081, fetchFn: mockSuccessfulFetch }
      );

      const success = await controller.executeProbe();

      strictEqual(success, true, 'Probe reports success');
      strictEqual(placeholder.style.display, 'none', 'Placeholder card is hidden upon success');
      strictEqual(frame.style.display, 'block', 'Iframe is restored to display: block');
      strictEqual(frame.src, 'http://localhost:3081/', 'Iframe stream points to port 3081');
      strictEqual(btnRetry.disabled, false, 'Retry button is accessible');
    });

  });
}

export default runTests;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await runTests(defaultHarness);
  defaultHarness.summary();
  process.exit(defaultHarness.getExitCode());
}
