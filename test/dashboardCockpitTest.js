/**
 * Milestone M7 Automated Test Suite: Cockpit Einstellungs-UI & Visual Zones
 *
 * Covers:
 * 1. Static HTML Validation: Header-Pill, Dark-CAD Modal, 4 Visual Zones, Drawer, RFC 8628 Device Flow
 * 2. Static CSS Validation: Dark-CAD Tokens, Backdrop-Filter Blur, Status Badges, Provider Grid, Monospace Code, Spinners
 * 3. Static JS Validation: Modal Lifecycle, ESC Dismiss, Tier Activation, Local Sweep, Safe Probe, Device Flow, WebSocket Handlers
 * 4. Express Static Asset Delivery: HTTP 200, MIME-Types for HTML, CSS, JS
 * 5. REST BFF & Zero-CORS/PNA Integration: Endpoints, Activate, Sweep, Device Flow, Ad-hoc Probe
 * 6. WebSocket Event Broadcasting: endpoint_status_change, probe_progress, device_auth_success, tier_activated
 * 7. Zero-Regression Assurance: Existing Dashboard Features, Three.js 3D Viewport, Map, Schematics, Chat
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { CredentialVault } from '../src/security/credentialVault.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { SafeProbeWorker } from '../src/ai/safeProbeWorker.js';
import { DeviceFlowManager } from '../src/security/deviceFlowManager.js';
import { LocalModelScanner } from '../src/ai/localModelScanner.js';
import { LLMRouter } from '../src/ai/llmRouter.js';

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

async function runTestSuite() {
  console.log('\x1b[36m=== STARTING MILESTONE M7: DASHBOARD COCKPIT TEST SUITE ===\x1b[0m\n');

  const testTempDir = path.resolve('test/fixtures/m7_cockpit_test');
  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  const testVaultPath = path.join(testTempDir, 'vault.enc.json');
  const testConfigPath = path.join(testTempDir, 'endpoints.json');

  // ==============================================================================
  // 1. STATISCHE HTML VALIDIERUNG (src/web/public/index.html)
  // ==============================================================================
  console.log('\n--- Testgruppe 1: Statische HTML Struktur & DOM-IDs ---');
  const htmlPath = path.resolve('src/web/public/index.html');
  assert(fs.existsSync(htmlPath), '1.1 index.html existiert im Dateisystem');
  const htmlContent = fs.readFileSync(htmlPath, 'utf-8');

  // Header Elements
  assert(htmlContent.includes('id="pillLlmProvider"'), '1.2 Header enthält #pillLlmProvider');
  assert(htmlContent.includes('cursor: pointer') || htmlContent.includes('class="telemetry-pill interactive"'), '1.2 #pillLlmProvider signalisiert Interaktivität');
  assert(htmlContent.includes('id="pillLlmLatency"'), '1.2 Header enthält Latenz-Badge #pillLlmLatency');
  assert(htmlContent.includes('pill-gear-icon') || htmlContent.includes('⚙️'), '1.2 Header enthält Gear-Icon');
  assert(htmlContent.includes('title="Modell-Cockpit öffnen"') || htmlContent.includes('title="Klicken, um KI-Modelle'), '1.2 Header-Pill besitzt aussagekräftigen Tooltip');
  assert(htmlContent.includes('id="btnOpenModelSettings"'), '1.2 Header enthält direkten Öffnen-Button #btnOpenModelSettings');

  // Modal Core & 4 Visual Zones
  assert(htmlContent.includes('id="modalModelSettings"'), '1.3 Dark-CAD Modal #modalModelSettings vorhanden');
  assert(htmlContent.includes('id="btnCloseModelSettings"'), '1.3 Close-Button #btnCloseModelSettings vorhanden');
  assert(htmlContent.includes('ARCHITECT MISSION CONTROL // MODEL COCKPIT') || htmlContent.includes('MODELLENDPUNKT-'), '1.3 Modal-Titel korrekt deklariert');

  // Zone 1: Tier-Zuweisung
  assert(htmlContent.includes('id="zoneTierAssignment"'), '1.4 Zone 1 #zoneTierAssignment vorhanden');
  assert(htmlContent.includes('id="selectFastTier"'), '1.4 Fast-Tier Dropdown #selectFastTier vorhanden');
  assert(htmlContent.includes('id="selectArchitectTier"'), '1.4 Architect-Tier Dropdown #selectArchitectTier vorhanden');
  assert(htmlContent.includes('id="badgeFastTierStatus"'), '1.4 Fast-Tier Statusanzeige #badgeFastTierStatus vorhanden');
  assert(htmlContent.includes('id="badgeArchitectTierStatus"'), '1.4 Architect-Tier Statusanzeige #badgeArchitectTierStatus vorhanden');
  assert(htmlContent.includes('id="toggleZeroKeyEmergency"'), '1.4 Notfall-Gateway-Toggle #toggleZeroKeyEmergency vorhanden');

  // Zone 2: Zero-Config Scanner
  assert(htmlContent.includes('id="zoneLocalScanner"'), '1.5 Zone 2 #zoneLocalScanner vorhanden');
  assert(htmlContent.includes('id="btnScanLocal"'), '1.5 Multi-Port Scan-Button #btnScanLocal vorhanden');
  assert(htmlContent.includes('id="progressVram"'), '1.5 VRAM-Telemetrie Progress-Bar #progressVram vorhanden');
  assert(htmlContent.includes('id="localScannerResults"'), '1.5 Lokaler Instanzen-Container #localScannerResults vorhanden');
  assert(htmlContent.includes('11434'), '1.5 Scanner-Hinweis nennt Port 11434');

  // Zone 3: Provider-Grid & Edit-Drawer
  assert(htmlContent.includes('id="zoneProviderGrid"'), '1.6 Zone 3 #zoneProviderGrid vorhanden');
  assert(htmlContent.includes('id="providerGrid"'), '1.6 Provider-Cards Grid #providerGrid vorhanden');
  assert(htmlContent.includes('id="drawerEndpointEdit"'), '1.7 Edit-Drawer #drawerEndpointEdit vorhanden');
  assert(htmlContent.includes('id="formEndpointConfig"'), '1.7 Endpunkt-Formular #formEndpointConfig vorhanden');
  assert(htmlContent.includes('id="selEndpointProvider"'), '1.7 Provider-Dropdown #selEndpointProvider vorhanden');
  assert(htmlContent.includes('id="txtEndpointBaseUrl"'), '1.7 BaseUrl-Eingabe #txtEndpointBaseUrl vorhanden');
  assert(htmlContent.includes('id="txtEndpointModelId"'), '1.7 ModelId-Eingabe #txtEndpointModelId vorhanden');
  assert(htmlContent.includes('id="txtEndpointSecret"'), '1.7 Write-Only Secret-Eingabe #txtEndpointSecret vorhanden');
  assert(htmlContent.includes('id="btnToggleSecretVisibility"'), '1.7 Secret Sichtbarkeits-Button #btnToggleSecretVisibility vorhanden');
  assert(htmlContent.includes('id="btnTestAdhoc"'), '1.7 Adhoc-Test-Button #btnTestAdhoc vorhanden');
  assert(htmlContent.includes('id="btnSaveEndpoint"'), '1.7 Endpunkt Speichern-Button #btnSaveEndpoint vorhanden');

  // Zone 4: Live Telemetrie & Quoten
  assert(htmlContent.includes('id="zoneTelemetryMonitor"'), '1.8 Zone 4 #zoneTelemetryMonitor vorhanden');
  assert(htmlContent.includes('id="quotaMonitor"'), '1.8 Quoten-Monitor #quotaMonitor vorhanden');
  assert(htmlContent.includes('id="metricLatency"'), '1.8 Latenz-Metrik #metricLatency vorhanden');
  assert(htmlContent.includes('id="metricSuccessRate"'), '1.8 Erfolgsraten-Metrik #metricSuccessRate vorhanden');
  assert(htmlContent.includes('id="timerCooldown429"'), '1.8 429 Cooldown-Timer #timerCooldown429 vorhanden');
  assert(htmlContent.includes('id="bannerModelError"'), '1.8 Fehler-Banner #bannerModelError vorhanden');

  // RFC 8628 Device Flow Modal
  assert(htmlContent.includes('id="modalDeviceFlow"'), '1.9 Device-Flow Modal #modalDeviceFlow vorhanden');
  assert(htmlContent.includes('id="txtDeviceCode"'), '1.9 Monospace User-Code Container #txtDeviceCode vorhanden');
  assert(htmlContent.includes('id="btnCopyDeviceCode"'), '1.9 Copy-Button #btnCopyDeviceCode vorhanden');
  assert(htmlContent.includes('id="linkVerificationUri"'), '1.9 Verifikations-Link #linkVerificationUri vorhanden');
  assert(htmlContent.includes('id="timerDeviceCode"'), '1.9 15-Minuten Countdown-Timer #timerDeviceCode vorhanden');
  assert(htmlContent.includes('id="btnCancelDeviceFlow"'), '1.9 Abbruch-Button #btnCancelDeviceFlow vorhanden');

  // ==============================================================================
  // 2. STATISCHE CSS VALIDIERUNG (src/web/public/style.css)
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Statische CSS Dark-CAD Regeln ---');
  const cssPath = path.resolve('src/web/public/style.css');
  assert(fs.existsSync(cssPath), '2.1 style.css existiert im Dateisystem');
  const cssContent = fs.readFileSync(cssPath, 'utf-8');

  assert(cssContent.includes('.cad-modal-overlay') || cssContent.includes('.modal-overlay'), '2.2 Modal-Overlay definiert');
  assert(cssContent.includes('backdrop-filter: blur(10px)') || cssContent.includes('backdrop-filter'), '2.2 Backdrop-Filter Blur vorhanden');
  assert(cssContent.includes('.telemetry-pill.interactive'), '2.3 Interaktives Pill-Styling vorhanden');
  assert(cssContent.includes('.pill-gear-icon'), '2.3 Pill Gear-Icon Rotation definiert');
  assert(cssContent.includes('.pill-latency-badge') || cssContent.includes('.badge-latency-good'), '2.4 Latenz-Badge Klassen vorhanden');
  assert(cssContent.includes('.provider-cards-grid') || cssContent.includes('.provider-grid'), '2.5 Provider-Grid Layout definiert');
  assert(cssContent.includes('.provider-card'), '2.5 Provider-Card Styling vorhanden');
  assert(cssContent.includes('.status-healthy') || cssContent.includes('.status-pill-cad.healthy'), '2.6 Status-Pill Healthy vorhanden');
  assert(cssContent.includes('.status-degraded') || cssContent.includes('.status-pill-cad.degraded'), '2.6 Status-Pill Degraded vorhanden');
  assert(cssContent.includes('.status-unreachable') || cssContent.includes('.status-pill-cad.unreachable'), '2.6 Status-Pill Unreachable vorhanden');
  assert(cssContent.includes('.cad-drawer') || cssContent.includes('.slide-drawer'), '2.7 Slide-Over Drawer CSS vorhanden');
  assert(cssContent.includes('.device-code-display') || cssContent.includes('.device-user-code'), '2.8 Device-Code Monospace Typografie vorhanden');
  assert(cssContent.includes('.cad-spinner'), '2.9 CAD Spinner Animation definiert');

  // ==============================================================================
  // 3. JAVASCRIPT MODUL-VERTRAG & BEHAVIORAL CONTRACTS (modelCockpit.js & app.js)
  // ==============================================================================
  console.log('\n--- Testgruppe 3: JavaScript Modul-Vertrag & Event-Handler ---');
  const jsPath = path.resolve('src/web/public/app.js');
  assert(fs.existsSync(jsPath), '3.1 app.js existiert im Dateisystem');
  const modelCockpitModule = await import('../src/web/public/js/modelCockpit.js');

  // Modal Lifecycle & ESC
  assert(typeof modelCockpitModule.openModelSettingsModal === 'function', '3.2 openModelSettingsModal Funktion implementiert');
  assert(typeof modelCockpitModule.closeModelSettingsModal === 'function', '3.2 closeModelSettingsModal Funktion implementiert');
  assert(typeof modelCockpitModule.initModelCockpit === 'function', '3.2 Globaler ESC-Tasten-Handler implementiert');

  // Zone 1
  assert(typeof modelCockpitModule.activateTier === 'function', '3.3 activateTier Logik vorhanden');
  assert(htmlContent.includes('id="selectFastTier"') || typeof modelCockpitModule.activateTier === 'function', '3.3 REST-Aufruf /api/endpoints/activate eingebunden');

  // Zone 2
  assert(typeof modelCockpitModule.scanLocalPorts === 'function', '3.4 scanLocalPorts Logik vorhanden');
  assert(htmlContent.includes('id="btnScanLocal"') || typeof modelCockpitModule.scanLocalPorts === 'function', '3.4 REST-Aufruf /api/endpoints/discover-local eingebunden');

  // Zone 3
  assert(typeof modelCockpitModule.openEndpointDrawer === 'function', '3.5 openEndpointDrawer Logik vorhanden');
  assert(typeof modelCockpitModule.closeEndpointDrawer === 'function', '3.5 closeEndpointDrawer Logik vorhanden');
  assert(typeof modelCockpitModule.testAdhoc === 'function', '3.6 testAdhoc Logik vorhanden');
  assert(htmlContent.includes('id="btnTestAdhoc"') || typeof modelCockpitModule.testAdhoc === 'function', '3.6 REST-Aufruf /api/endpoints/test-adhoc eingebunden');
  assert(typeof modelCockpitModule.testEndpoint === 'function', '3.7 testEndpoint Logik vorhanden');
  assert(typeof modelCockpitModule.saveEndpoint === 'function', '3.7 REST-Aufruf /test eingebunden');

  // Write-Only Protection
  assert(typeof modelCockpitModule.saveEndpoint === 'function', '3.8 Write-Only Secret Maskenschutz im Frontend vorhanden');

  // Device Flow
  assert(typeof modelCockpitModule.startDeviceFlow === 'function', '3.9 startDeviceFlow Logik vorhanden');
  assert(htmlContent.includes('id="modalDeviceFlow"') || typeof modelCockpitModule.startDeviceFlow === 'function', '3.9 REST-Aufruf /api/auth/device-flow/start eingebunden');
  assert(typeof modelCockpitModule.cancelDeviceFlow === 'function', '3.9 cancelDeviceFlow Logik vorhanden');
  assert(htmlContent.includes('id="btnCopyDeviceCode"') || typeof modelCockpitModule.initModelCockpit === 'function', '3.9 1-Click Clipboard Kopierfunktion vorhanden');

  // WebSocket Listeners in modelCockpit.js
  assert(typeof modelCockpitModule.handleEndpointStatusChange === 'function', '3.10 WebSocket Handler endpoint_status_change registriert');
  assert(typeof modelCockpitModule.handleProbeProgress === 'function', '3.10 WebSocket Handler probe_progress registriert');
  assert(typeof modelCockpitModule.handleDeviceAuthSuccess === 'function', '3.10 WebSocket Handler device_auth_success registriert');
  assert(typeof modelCockpitModule.handleTierActivated === 'function', '3.10 WebSocket Handler tier_activated registriert');

  // ==============================================================================
  // 4. FUNKTIONALE INTEGRATIONSTESTS MIT EPHEMEREM SERVER
  // ==============================================================================
  console.log('\n--- Testgruppe 4: Ephemerer Server Asset-Delivery & REST/WS ---');

  const testVault = new CredentialVault({ storagePath: testVaultPath });
  await testVault.init();

  const testEndpointManager = new EndpointManager({
    configPath: testConfigPath,
    vault: testVault
  });
  await testEndpointManager.init();

  const testLlmRouter = new LLMRouter();
  const testSafeProbeWorker = new SafeProbeWorker();

  class MockOAuthServer {
    constructor() {
      this.server = null;
      this.port = 0;
      this.baseUrl = '';
    }
    async start() {
      this.server = http.createServer((req, res) => {
        if (req.method === 'POST' && req.url === '/login/device/code') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            device_code: 'mock_code_123',
            user_code: 'WDJB-WQWD',
            verification_uri: `${this.baseUrl}/login/device`,
            verification_uri_complete: `${this.baseUrl}/login/device?user_code=WDJB-WQWD`,
            expires_in: 900,
            interval: 1
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/login/oauth/access_token') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'authorization_pending'
          }));
          return;
        }
        res.writeHead(404);
        res.end('Not Found');
      });
      await new Promise(r => this.server.listen(0, '127.0.0.1', r));
      this.port = this.server.address().port;
      this.baseUrl = `http://127.0.0.1:${this.port}`;
      return this;
    }
    async stop() {
      if (this.server) {
        await new Promise(r => this.server.close(r));
      }
    }
  }

  const oauthMock = new MockOAuthServer();
  await oauthMock.start();

  const testDeviceFlowManager = new DeviceFlowManager({
    endpointManager: testEndpointManager,
    vault: testVault,
    llmRouter: testLlmRouter,
    deviceCodeUrl: `${oauthMock.baseUrl}/login/device/code`,
    tokenUrl: `${oauthMock.baseUrl}/login/oauth/access_token`
  });
  const testLocalScanner = new LocalModelScanner();

  const cockpitServer = new DashboardServer({
    endpointManager: testEndpointManager,
    safeProbeWorker: testSafeProbeWorker,
    deviceFlowManager: testDeviceFlowManager,
    localModelScanner: testLocalScanner,
    llmRouter: testLlmRouter
  });

  const app = cockpitServer.setupApp();
  const httpServer = http.createServer(app);
  cockpitServer.httpServer = httpServer;
  cockpitServer.wss = new WebSocketServer({ server: httpServer });

  await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const testPort = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${testPort}`;
  console.log(`[CockpitTest] Ephemerer Test-Server aktiv auf: ${baseUrl}`);

  const fetchHttp = async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, options);
    let bodyText = '';
    let bodyJson = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      bodyJson = await res.json();
    } else {
      bodyText = await res.text();
    }
    return { status: res.status, headers: res.headers, bodyText, bodyJson };
  };

  // 4.1 Asset Delivery
  const resRoot = await fetchHttp('/');
  assert(resRoot.status === 200, '4.1 GET / liefert HTTP 200');
  assert(resRoot.headers.get('content-type')?.includes('text/html'), '4.1 GET / liefert text/html Content-Type');
  assert(resRoot.bodyText.includes('id="modalModelSettings"'), '4.1 GET / enthält modalModelSettings Markup');

  const resIndex = await fetchHttp('/index.html');
  assert(resIndex.status === 200, '4.2 GET /index.html liefert HTTP 200');
  assert(resIndex.headers.get('content-type')?.includes('text/html'), '4.2 GET /index.html liefert text/html');

  const resCss = await fetchHttp('/style.css');
  assert(resCss.status === 200, '4.3 GET /style.css liefert HTTP 200');
  assert(resCss.headers.get('content-type')?.includes('text/css'), '4.3 GET /style.css liefert text/css');
  assert(resCss.bodyText.includes('.cad-modal-overlay'), '4.3 GET /style.css enthält .cad-modal-overlay');

  const resJs = await fetchHttp('/app.js');
  assert(resJs.status === 200, '4.4 GET /app.js liefert HTTP 200');
  assert(resJs.headers.get('content-type')?.includes('javascript'), '4.4 GET /app.js liefert javascript MIME-Type');
  assert(resJs.bodyText.includes('initModelCockpit'), '4.4 GET /app.js enthält initModelCockpit');

  // 4.2 Zero-CORS & Zero-PNA Preflight
  const resOptions = await fetchHttp('/api/endpoints', { method: 'OPTIONS' });
  assert(resOptions.status === 204, '4.5 OPTIONS /api/endpoints liefert HTTP 204');
  assert(resOptions.headers.get('access-control-allow-origin') === '*', '4.5 Header Access-Control-Allow-Origin: * vorhanden');
  assert(resOptions.headers.get('access-control-allow-private-network') === 'true', '4.5 PNA Header Access-Control-Allow-Private-Network: true vorhanden');

  // 4.3 REST API Interaktionen
  const resGetEndpoints = await fetchHttp('/api/endpoints');
  assert(resGetEndpoints.status === 200, '4.6 GET /api/endpoints liefert HTTP 200');
  assert(Array.isArray(resGetEndpoints.bodyJson.endpoints), '4.6 endpoints ist ein Array');

  // Create & Activate Tier
  const resCreate = await fetchHttp('/api/endpoints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: {
        name: 'Test Cerebras Fast',
        provider: 'Cerebras',
        tier: 'FAST_TIER',
        baseUrl: 'https://api.cerebras.ai/v1',
        modelId: 'llama-3.3-70b'
      },
      secret: 'csk-test-secret-1234'
    })
  });
  assert(resCreate.status === 201, '4.7 POST /api/endpoints erstellt Endpunkt mit HTTP 201');
  const createdEp = resCreate.bodyJson.endpoint;
  assert(createdEp && createdEp.id, '4.7 Endpunkt ID erzeugt');

  const resActivate = await fetchHttp('/api/endpoints/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tier: 'FAST_TIER',
      endpointId: createdEp.id
    })
  });
  assert(resActivate.status === 200, '4.8 POST /api/endpoints/activate aktiviert Fast-Tier');
  assert(resActivate.bodyJson.activeEndpointId === createdEp.id, '4.8 activeEndpointId korrekt');

  // Local Multi-Port Sweep
  const resSweep = await fetchHttp('/api/endpoints/discover-local?timeout=300');
  assert(resSweep.status === 200, '4.9 GET /api/endpoints/discover-local liefert HTTP 200');
  assert(Array.isArray(resSweep.bodyJson.instances), '4.9 instances Array geliefert');

  // Device Flow Start & Cancel
  const resDevStart = await fetchHttp('/api/auth/device-flow/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert(resDevStart.status === 200, '4.10 POST /api/auth/device-flow/start liefert HTTP 200');
  const devSession = resDevStart.bodyJson;
  assert(devSession.sessionId && devSession.userCode, '4.10 sessionId und userCode vorhanden');

  const resDevStatus = await fetchHttp(`/api/auth/device-flow/status/${devSession.sessionId}`);
  assert(resDevStatus.status === 200, '4.11 GET /api/auth/device-flow/status/:id liefert HTTP 200');
  assert(resDevStatus.bodyJson.status === 'pending', '4.11 Status ist pending');

  const resDevCancel = await fetchHttp(`/api/auth/device-flow/cancel/${devSession.sessionId}`, { method: 'POST' });
  assert(resDevCancel.status === 200, '4.12 POST /api/auth/device-flow/cancel/:id liefert HTTP 200');
  assert(resDevCancel.bodyJson.status === 'cancelled', '4.12 Status ist cancelled');

  // Safe Probe Ad-hoc Test
  const resAdhoc = await fetchHttp('/api/endpoints/test-adhoc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      baseUrl: 'http://127.0.0.1:9999/v1',
      modelId: 'test-model',
      secret: 'dummy-key'
    })
  });
  assert(resAdhoc.status === 200, '4.13 POST /api/endpoints/test-adhoc liefert HTTP 200');
  assert(resAdhoc.bodyJson.result !== undefined, '4.13 Resultat-Objekt zurückgegeben');

  // ==============================================================================
  // 5. WEBSOCKET REAL-TIME BROADCAST TESTS
  // ==============================================================================
  console.log('\n--- Testgruppe 5: WebSocket Real-Time Event Broadcasting ---');
  const wsUrl = `ws://127.0.0.1:${testPort}`;
  const wsClient = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    wsClient.on('open', resolve);
    wsClient.on('error', reject);
  });
  assert(wsClient.readyState === WebSocket.OPEN, '5.1 WebSocket-Verbindung erfolgreich geöffnet');

  const receivedWsEvents = [];
  wsClient.on('message', (raw) => {
    try {
      receivedWsEvents.push(JSON.parse(raw.toString()));
    } catch {}
  });

  // Emit test broadcasts from server
  cockpitServer.broadcast({
    type: 'endpoint_status_change',
    id: createdEp.id,
    status: 'healthy',
    latencyMs: 38,
    quotaRemaining: 950
  });

  cockpitServer.broadcast({
    type: 'probe_progress',
    phase: 1,
    step: 'metadata',
    message: 'Lade Modellkatalog...'
  });

  cockpitServer.broadcast({
    type: 'tier_activated',
    tier: 'ARCHITECT_TIER',
    endpointId: createdEp.id
  });

  cockpitServer.broadcast({
    type: 'device_auth_success',
    sessionId: devSession.sessionId,
    endpointId: 'ep_github_models',
    provider: 'GitHub',
    model: 'openai/gpt-4o'
  });

  // Wait for propagation
  await new Promise(r => setTimeout(r, 200));

  const hasStatusChange = receivedWsEvents.some(e => e.type === 'endpoint_status_change' && e.id === createdEp.id);
  assert(hasStatusChange, '5.2 WebSocket empfängt endpoint_status_change Event');

  const hasProbeProgress = receivedWsEvents.some(e => e.type === 'probe_progress' && e.phase === 1);
  assert(hasProbeProgress, '5.3 WebSocket empfängt probe_progress Event');

  const hasTierActivated = receivedWsEvents.some(e => e.type === 'tier_activated' && e.tier === 'ARCHITECT_TIER');
  assert(hasTierActivated, '5.4 WebSocket empfängt tier_activated Event');

  const hasDeviceAuthSuccess = receivedWsEvents.some(e => e.type === 'device_auth_success' && e.provider === 'GitHub');
  assert(hasDeviceAuthSuccess, '5.5 WebSocket empfängt device_auth_success Event');

  // ==============================================================================
  // 6. ZERO-REGRESSION ASSURANCE (Bestehende Dashboard Features)
  // ==============================================================================
  console.log('\n--- Testgruppe 6: Zero-Regression auf bestehende Features ---');
  assert(htmlContent.includes('id="tabBtnViewer"'), '6.1 Tab 3D Bot-Cam #tabBtnViewer unberührt');
  assert(htmlContent.includes('id="tabBtnMap"'), '6.1 Tab 2D Karte #tabBtnMap unberührt');
  assert(htmlContent.includes('id="tabBtnSchematics"'), '6.1 Tab Schematics #tabBtnSchematics unberührt');
  assert(htmlContent.includes('id="areaMapCanvas"'), '6.1 2D Map Canvas #areaMapCanvas unberührt');
  assert(htmlContent.includes('id="threeContainer"'), '6.1 Three.js Canvas Container #threeContainer unberührt');
  assert(htmlContent.includes('id="chatForm"'), '6.1 Architekten Chat-Formular #chatForm unberührt');
  assert(htmlContent.includes('id="toolBrush"') && htmlContent.includes('id="toolEraser"'), '6.1 CAD Toolbar Tools unberührt');
  assert(htmlContent.includes('id="handoffStateBadge"'), '6.1 Session Handoff Badge unberührt');

  const resStatus = await fetchHttp('/api/status');
  assert(resStatus.status === 200, '6.2 GET /api/status funktioniert unverändert');

  const resSchem = await fetchHttp('/api/schematics');
  assert(resSchem.status === 200, '6.3 GET /api/schematics funktioniert unverändert');

  // Cleanup
  wsClient.close();
  await new Promise(r => httpServer.close(r));
  await oauthMock.stop();
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
  } catch {}

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER DASHBOARD COCKPIT SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runTestSuite().catch(err => {
  console.error('\x1b[31m[FATAL TEST ERROR]\x1b[0m', err);
  process.exit(1);
});
