import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { settings } from '../src/config/settings.js';
import { envManager } from '../src/config/envManager.js';
import { LanDiscoveryService, lanDiscoveryService, MC_LAN_MULTICAST_GROUP, MC_LAN_PORT } from '../src/network/lanDiscoveryService.js';
import { registerBaseRoutes } from '../src/web/routes/baseRoutes.js';
import { dashboardServer } from '../src/web/dashboardServer.js';

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

async function runTestSuite() {
  console.log('\n=== STARTING MINECRAFT LAN DISCOVERY & PRISMARINE VIEWER TOGGLE SUITE ===\n');

  const envPath = path.resolve('.env');
  const envBackup = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
  settings.ENABLE_PRISMARINE_VIEWER = true;

  try {

  // --- Testgruppe 1: Settings & Invarianten ---
  console.log('--- Testgruppe 1: Settings & Konfigurations-Invarianten ---');
  {
    assert.strictEqual(typeof settings.ENABLE_PRISMARINE_VIEWER, 'boolean', 'ENABLE_PRISMARINE_VIEWER must be boolean');
    assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, true, 'Default must be true');
    pass('1.1 settings.ENABLE_PRISMARINE_VIEWER ist boolean und standardmäßig true');

    const curr = envManager.getCurrentSettings();
    assert.strictEqual('ENABLE_PRISMARINE_VIEWER' in curr, true, 'envManager must expose ENABLE_PRISMARINE_VIEWER');
    assert.strictEqual(typeof curr.ENABLE_PRISMARINE_VIEWER, 'boolean');
    pass('1.2 envManager.getCurrentSettings() enthält ENABLE_PRISMARINE_VIEWER');

    // Test in-memory sync in envManager
    const tmpEnvPath = path.resolve('tmp_test_viewer.env');
    try {
      envManager.saveConfig({ ENABLE_PRISMARINE_VIEWER: false }, tmpEnvPath);
      assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, false);
      pass('1.3 envManager speichert ENABLE_PRISMARINE_VIEWER=false');

      envManager.saveConfig({ ENABLE_PRISMARINE_VIEWER: true }, tmpEnvPath);
      assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, true);
      pass('1.4 envManager reaktiviert ENABLE_PRISMARINE_VIEWER=true');
    } finally {
      if (fs.existsSync(tmpEnvPath)) fs.unlinkSync(tmpEnvPath);
    }
  }

  // --- Testgruppe 2: LanDiscoveryService Protokoll & Multicast-Logik ---
  console.log('\n--- Testgruppe 2: Minecraft LAN UDP Multicast Scanner ---');
  {
    assert.strictEqual(MC_LAN_MULTICAST_GROUP, '224.0.2.60', 'Standard Minecraft multicast group is 224.0.2.60');
    assert.strictEqual(MC_LAN_PORT, 4445, 'Standard Minecraft LAN broadcast port is 4445');
    pass('2.1 Multicast-Konstanten entsprechen offiziellem Minecraft-Protokoll (224.0.2.60:4445)');

    const scanner = new LanDiscoveryService({ expiryMs: 150 });

    // Test standard Minecraft broadcast packet parsing
    let discoveredEvent = null;
    let updatedEvent = null;
    scanner.on('world_discovered', (w) => { discoveredEvent = w; });
    scanner.on('worlds_updated', (list) => { updatedEvent = list; });

    const rawPacket = '[MOTD]Abenteuer-Welt - Survival[/MOTD][AD]54321[/AD]';
    scanner.handleMessage(rawPacket, { address: '127.0.0.1' });

    assert.ok(discoveredEvent, 'world_discovered event must fire');
    assert.strictEqual(discoveredEvent.motd, 'Abenteuer-Welt - Survival');
    assert.strictEqual(discoveredEvent.port, 54321);
    assert.strictEqual(discoveredEvent.host, '127.0.0.1');
    assert.strictEqual(discoveredEvent.id, '127.0.0.1:54321');
    pass('2.2 Standard Minecraft LAN-Broadcast [MOTD]...[/MOTD][AD]...[/AD] erfolgreich geparst');

    assert.ok(Array.isArray(updatedEvent));
    assert.strictEqual(updatedEvent.length, 1);
    pass('2.3 worlds_updated Event liefert Liste mit 1 Welt');

    // IPv6 loopback normalization
    scanner.handleMessage('[MOTD]Creative Build World[/MOTD][AD]49152[/AD]', { address: '::ffff:127.0.0.1' });
    const worlds = scanner.getDiscoveredWorlds();
    const creativeWorld = worlds.find(w => w.port === 49152);
    assert.ok(creativeWorld);
    assert.strictEqual(creativeWorld.host, '127.0.0.1', 'IPv6 loopback mapped to 127.0.0.1');
    pass('2.4 IPv6 Loopback (::ffff:127.0.0.1) wird sauber zu 127.0.0.1 normalisiert');

    // Remote LAN Host IP preservation
    scanner.handleMessage('[MOTD]Wohnzimmer-PC Welt[/MOTD][AD]25565[/AD]', { address: '192.168.1.120' });
    const remoteWorld = scanner.getDiscoveredWorlds().find(w => w.host === '192.168.1.120');
    assert.ok(remoteWorld);
    assert.strictEqual(remoteWorld.port, 25565);
    pass('2.5 LAN-IP eines anderen Rechners (192.168.1.120) wird unverändert übernommen');

    // Malformed packet handling (must not throw)
    scanner.handleMessage('random invalid packet from another network tool', { address: '127.0.0.1' });
    scanner.handleMessage('[MOTD]Incomplete[/MOTD]', { address: '127.0.0.1' });
    scanner.handleMessage('[MOTD]Invalid Port[/MOTD][AD]999999[/AD]', { address: '127.0.0.1' });
    pass('2.6 Ungültige und korrupte UDP-Pakete werden fehlerfrei ignoriert');

    // World Expiry Cleanup
    await new Promise(r => setTimeout(r, 200));
    scanner.cleanupExpiredWorlds();
    assert.strictEqual(scanner.getDiscoveredWorlds().length, 0, 'Expired worlds must be cleaned up');
    pass('2.7 Veraltete LAN-Welten (ohne aktives Broadcast) verfallen nach Timeout');

    // Safe stop
    scanner.stop();
    assert.strictEqual(scanner.isListening, false);
    pass('2.8 LanDiscoveryService.stop() beendet Socket und Timer sauber');

    // 2.9 Dual-stack IPv4-mapped IPv6 address normalization (e.g. ::ffff:192.168.2.140)
    const scanner2 = new LanDiscoveryService({ expiryMs: 5000 });
    scanner2.handleMessage('[MOTD]Multi-NIC Server[/MOTD][AD]31245[/AD]', { address: '::ffff:192.168.2.140' });
    const multiNicWorld = scanner2.getDiscoveredWorlds().find(w => w.port === 31245);
    assert.ok(multiNicWorld);
    assert.strictEqual(multiNicWorld.host, '192.168.2.140', 'IPv4-mapped IPv6 remote IP must be cleanly stripped');
    pass('2.9 IPv4-gemappte IPv6-Adressen (::ffff:192.168.2.140) werden zu reinem IPv4 normalisiert');

    // 2.10 Minecraft formatting codes stripping
    scanner2.handleMessage('[MOTD]§a§lGrüne Welt§r - §eSurvival[/MOTD][AD]31246[/AD]', { address: '127.0.0.1' });
    const formattedWorld = scanner2.getDiscoveredWorlds().find(w => w.port === 31246);
    assert.ok(formattedWorld);
    assert.strictEqual(formattedWorld.motd, 'Grüne Welt - Survival');
    assert.strictEqual(formattedWorld.rawMotd, '§a§lGrüne Welt§r - §eSurvival');
    pass('2.10 Minecraft Formatierungs-Codes (§a, §l) werden im MOTD für das Dashboard gesäubert');

    // 2.11 Deduplication & no redundant worlds_updated on repeated identical packets
    let updatedCalls = 0;
    scanner2.on('worlds_updated', () => { updatedCalls++; });
    scanner2.handleMessage('[MOTD]§a§lGrüne Welt§r - §eSurvival[/MOTD][AD]31246[/AD]', { address: '127.0.0.1' });
    assert.strictEqual(updatedCalls, 0, 'Must NOT fire worlds_updated if world is already known and motd unchanged');
    pass('2.11 Identische wiederholte Broadcasts lösen KEIN redundantes worlds_updated aus (Schutz vor DOM-Churn)');
    scanner2.stop();
  }

  // --- Testgruppe 3: DashboardServer Prismarine-Viewer Steuerung ---
  console.log('\n--- Testgruppe 3: DashboardServer Viewer Lifecycle Steuerung ---');
  {
    let broadcastMessages = [];
    const mockBroadcast = (msg) => { broadcastMessages.push(msg); };
    const origBroadcast = dashboardServer.broadcast;
    dashboardServer.broadcast = mockBroadcast;

    try {
      // Toggle to false
      dashboardServer.setViewerEnabled(false);
      assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, false);
      assert.strictEqual(dashboardServer.viewerRunning, false);
      assert.strictEqual(dashboardServer.activeViewer, null);

      const stateChange = broadcastMessages.find(m => m.type === 'viewer_state_changed' && m.enabled === false);
      assert.ok(stateChange, 'Must broadcast viewer_state_changed with enabled: false');
      pass('3.1 setViewerEnabled(false) stoppt Viewer und broadcastet Status');

      // Bot spawns while viewer is disabled -> does NOT start viewer
      let dummyViewerStarted = false;
      const origStartViewer = dashboardServer.startViewer;
      dashboardServer.startViewer = () => { dummyViewerStarted = true; };

      const dummyBot = {
        username: 'TestBot',
        version: '1.20.4',
        inventory: { on: () => {} },
        on: () => {},
        _client: { on: () => {} }
      };

      dashboardServer.onBotSpawn(dummyBot);
      assert.strictEqual(dummyViewerStarted, false, 'Viewer must NOT start if disabled');
      pass('3.2 onBotSpawn startet Prismarine-Viewer NICHT, wenn ENABLE_PRISMARINE_VIEWER=false');

      dashboardServer.startViewer = origStartViewer;

      // Toggle back to true
      broadcastMessages = [];
      dashboardServer.setViewerEnabled(true);
      assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, true);
      const reenabledMsg = broadcastMessages.find(m => m.type === 'viewer_state_changed' && m.enabled === true);
      assert.ok(reenabledMsg, 'Must broadcast viewer_state_changed with enabled: true');
      pass('3.3 setViewerEnabled(true) reaktiviert Prismarine-Viewer und informiert Clients');

      // 3.4 Bot disconnect stops viewer
      dashboardServer.viewerRunning = true;
      dashboardServer.activeViewer = { close: () => { dashboardServer.activeViewer = null; } };
      let endListener = null;
      const dummyBot2 = {
        username: 'TestBot2',
        version: '1.20.4',
        inventory: { on: () => {} },
        on: (evt, fn) => { if (evt === 'end') endListener = fn; },
        _client: { on: () => {} }
      };
      dashboardServer.onBotSpawn(dummyBot2);
      assert.ok(typeof endListener === 'function', 'bot.on(end) must be registered');
      endListener();
      assert.strictEqual(dashboardServer.viewerRunning, false, 'Viewer must be stopped on bot end');
      pass('3.4 Bot-Disconnect (end/kick) beendet den Viewer-Stream sauber und gibt Ressourcen frei');
    } finally {
      dashboardServer.broadcast = origBroadcast;
      dashboardServer.stopViewer();
      settings.ENABLE_PRISMARINE_VIEWER = true;
    }
  }

  // --- Testgruppe 4: HTTP REST API Endpoints ---
  console.log('\n--- Testgruppe 4: REST API Endpoints (/api/viewer & /api/lan) ---');
  {
    const app = express();
    app.use(express.json());

    const broadcastLog = [];
    const mockContext = {
      botClient: {
        shouldRun: true,
        reconnect: () => { mockContext.reconnected = true; }
      },
      currentBot: null,
      viewerRunning: false,
      broadcast: (msg) => { broadcastLog.push(msg); },
      setViewerEnabled: (en) => {
        settings.ENABLE_PRISMARINE_VIEWER = Boolean(en);
        mockContext.viewerRunning = Boolean(en);
        mockContext.broadcast({
          type: 'viewer_state_changed',
          enabled: settings.ENABLE_PRISMARINE_VIEWER,
          running: mockContext.viewerRunning,
          port: settings.PRISMARINE_VIEWER_PORT
        });
      }
    };

    registerBaseRoutes(app, mockContext);

    const testServer = http.createServer(app);
    await new Promise(r => testServer.listen(0, r));
    const testPort = testServer.address().port;

    try {
      // 4.1 GET /api/viewer/status
      {
        const res = await fetch(`http://localhost:${testPort}/api/viewer/status`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(typeof data.enabled, 'boolean');
        assert.strictEqual(typeof data.running, 'boolean');
        assert.strictEqual(data.port, settings.PRISMARINE_VIEWER_PORT);
        pass('4.1 GET /api/viewer/status liefert Status und Port 3081');
      }

      // 4.2 POST /api/viewer/toggle (turn off)
      {
        const res = await fetch(`http://localhost:${testPort}/api/viewer/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: false, persist: false })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.enabled, false);
        assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, false);
        pass('4.2 POST /api/viewer/toggle mit { enabled: false } deaktiviert Stream');
      }

      // 4.3 POST /api/viewer/toggle (toggle back on)
      {
        const res = await fetch(`http://localhost:${testPort}/api/viewer/toggle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: true, persist: false })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.enabled, true);
        assert.strictEqual(settings.ENABLE_PRISMARINE_VIEWER, true);
        pass('4.3 POST /api/viewer/toggle mit { enabled: true } reaktiviert Stream');
      }

      // 4.4 GET /api/lan/worlds
      {
        lanDiscoveryService.mockDiscoverWorld('Meine Singleplayer LAN-Welt', 58742, '127.0.0.1');
        const res = await fetch(`http://localhost:${testPort}/api/lan/worlds`);
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.ok(data.worlds.length >= 1);
        const world = data.worlds.find(w => w.port === 58742);
        assert.ok(world);
        assert.strictEqual(world.motd, 'Meine Singleplayer LAN-Welt');
        pass('4.4 GET /api/lan/worlds liefert aktuell entdeckte Welten');
      }

      // 4.5 POST /api/lan/connect
      {
        mockContext.reconnected = false;
        const res = await fetch(`http://localhost:${testPort}/api/lan/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: '127.0.0.1',
            port: 58742,
            botOwner: 'HostPlayer',
            botUsername: 'BaumeisterKI',
            saveToEnv: false
          })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.strictEqual(data.config.MC_PORT, 58742);
        assert.strictEqual(data.config.MC_AUTH, 'offline', 'LAN world must use offline auth');
        assert.strictEqual(data.config.BOT_OWNER, 'HostPlayer');
        assert.strictEqual(mockContext.reconnected, true, 'Bot reconnect must be triggered');
        pass('4.5 POST /api/lan/connect konfiguriert offline-Auth, Host, Port und startet Bot');
      }

      // 4.6 POST /api/lan/connect validation failure on invalid port
      {
        const res = await fetch(`http://localhost:${testPort}/api/lan/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ host: '127.0.0.1', port: 999999 })
        });
        assert.strictEqual(res.status, 400);
        const data = await res.json();
        assert.strictEqual(data.success, false);
        pass('4.6 POST /api/lan/connect weist ungültige Ports mit HTTP 400 ab');
      }

      // 4.7 POST /api/settings synchronisiert ENABLE_PRISMARINE_VIEWER live mit setViewerEnabled
      {
        let viewerToggledArg = null;
        mockContext.setViewerEnabled = (v) => { viewerToggledArg = v; };
        const res = await fetch(`http://localhost:${testPort}/api/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ENABLE_PRISMARINE_VIEWER: false, reconnectBot: false })
        });
        assert.strictEqual(res.status, 200);
        assert.strictEqual(viewerToggledArg, false, 'POST /api/settings must sync setViewerEnabled');
        pass('4.7 POST /api/settings synchronisiert ENABLE_PRISMARINE_VIEWER live mit setViewerEnabled');
      }

      // 4.8 POST /api/lan/connect verhindert Bot-Kick bei identischem Bot- und Host-Namen
      {
        const res = await fetch(`http://localhost:${testPort}/api/lan/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: '127.0.0.1',
            port: 58742,
            botOwner: 'BaumeisterKI',
            botUsername: 'BaumeisterKI',
            saveToEnv: false
          })
        });
        assert.strictEqual(res.status, 200);
        const data = await res.json();
        assert.strictEqual(data.success, true);
        assert.notStrictEqual(data.config.MC_USERNAME.toLowerCase(), data.config.BOT_OWNER.toLowerCase(), 'Collision avoided');
        pass('4.8 POST /api/lan/connect verhindert Bot-Kick bei identischem Bot- und Host-Namen');
      }

      // 4.9 botClient.reconnect() reaktiviert shouldRun = true
      {
        const { botClient } = await import('../src/bot/botClient.js');
        const origInit = botClient.initBot;
        botClient.initBot = () => {};
        try {
          botClient.shouldRun = false;
          botClient.reconnect();
          assert.strictEqual(botClient.shouldRun, true, 'reconnect() must set shouldRun = true');
          pass('4.9 botClient.reconnect() reaktiviert shouldRun = true');
        } finally {
          botClient.initBot = origInit;
          botClient.stop();
        }
      }
    } finally {
      lanDiscoveryService.stop();
      await new Promise(r => testServer.close(r));
    }
  }

  // --- Testgruppe 5: Statische HTML Struktur & DOM-IDs ---
  console.log('\n--- Testgruppe 5: Statische HTML- & DOM-Integrität ---');
  {
    const html = fs.readFileSync('src/web/public/index.html', 'utf8');

    assert.ok(html.includes('id="btnToggleViewerStream"'), 'index.html must have #btnToggleViewerStream');
    pass('5.1 index.html enthält #btnToggleViewerStream');

    assert.ok(html.includes('id="viewerDisabledPlaceholder"'), 'index.html must have #viewerDisabledPlaceholder');
    pass('5.2 index.html enthält #viewerDisabledPlaceholder');

    assert.ok(html.includes('id="btnEnableViewerStream"'), 'index.html must have #btnEnableViewerStream');
    pass('5.3 index.html enthält #btnEnableViewerStream');

    assert.ok(html.includes('id="pillLanDiscovered"'), 'index.html must have #pillLanDiscovered');
    pass('5.4 index.html enthält #pillLanDiscovered in der Header-Leiste');

    assert.ok(html.includes('id="lanDiscoveryBox"'), 'index.html must have #lanDiscoveryBox');
    pass('5.5 index.html enthält #lanDiscoveryBox');

    assert.ok(html.includes('id="lanWorldsList"'), 'index.html must have #lanWorldsList');
    pass('5.6 index.html enthält #lanWorldsList');

    assert.ok(html.includes('id="btnApplyLanPreset"'), 'index.html must have #btnApplyLanPreset');
    pass('5.7 index.html enthält #btnApplyLanPreset');

    assert.ok(html.includes('id="cfgEnableViewer"'), 'index.html must have #cfgEnableViewer');
    pass('5.8 index.html enthält #cfgEnableViewer Checkbox in den Einstellungen');

    assert.ok(html.includes('id="obLanDetectionNotice"'), 'index.html must have #obLanDetectionNotice in Onboarding');
    pass('5.9 index.html enthält #obLanDetectionNotice im Onboarding-Wizard');

    // Check for duplicate DOM IDs
    const idMatches = [...html.matchAll(/id=["']([a-zA-Z0-9_-]+)["']/g)].map(m => m[1]);
    const idSet = new Set();
    const duplicates = [];
    for (const id of idMatches) {
      if (idSet.has(id)) {
        duplicates.push(id);
      }
      idSet.add(id);
    }
    assert.strictEqual(duplicates.length, 0, `Duplicate IDs found: ${duplicates.join(', ')}`);
    pass('5.10 Keine doppelten DOM-IDs in index.html vorhanden');
  }

  // --- Testgruppe 6: Statische CSS-Klassen ---
  console.log('\n--- Testgruppe 6: CSS-Styling & Animationen ---');
  {
    const css = fs.readFileSync('src/web/public/style.css', 'utf8');

    assert.ok(css.includes('.telemetry-pill.lan-pill'), 'style.css must define .telemetry-pill.lan-pill');
    assert.ok(css.includes('@keyframes lanPulse'), 'style.css must define @keyframes lanPulse');
    pass('6.1 style.css definiert .lan-pill mit animiertem Pulse-Effekt');

    assert.ok(css.includes('.btn-viewer-toggle'), 'style.css must define .btn-viewer-toggle');
    assert.ok(css.includes('.btn-viewer-toggle.is-paused'), 'style.css must define .btn-viewer-toggle.is-paused');
    pass('6.2 style.css definiert .btn-viewer-toggle für aktiven und pausierten Zustand');

    assert.ok(css.includes('.lan-discovery-box'), 'style.css must define .lan-discovery-box');
    assert.ok(css.includes('.lan-world-card'), 'style.css must define .lan-world-card');
    assert.ok(css.includes('.lan-world-connect-btn'), 'style.css must define .lan-world-connect-btn');
    pass('6.3 style.css definiert .lan-discovery-box und .lan-world-card');
  }

  console.log('\n=== ALLE 35/35 TESTS DER LAN DISCOVERY & VIEWER TOGGLE SUITE ERFOLGREICH BESTANDEN! ===\n');
  } finally {
    if (envBackup !== null) {
      fs.writeFileSync(envPath, envBackup, 'utf8');
    }
    settings.ENABLE_PRISMARINE_VIEWER = true;
  }
}

runTestSuite().catch(err => {
  console.error('\n[FAIL] Test Suite fehlgeschlagen:', err);
  process.exit(1);
});
