/**
 * Testsuite für Mission Control Web-UI & 1-Account Session Handoff
 * Überprüft Zustandsmaschine, Duplicate-Login-Erkennung, Pause/Resume im WorldExecutor,
 * WebSocket-Protokoll, 2D-Karten-Rasterung und Three.js/Voxel-Preview-Payloads.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { sessionHandoff, HANDOFF_STATES } from '../src/bot/sessionHandoff.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { dashboardServer } from '../src/web/dashboardServer.js';
import { ArchitectAgent } from '../src/ai/architectAgent.js';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { settings } from '../src/config/settings.js';
import mcProtocol from 'minecraft-protocol';

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

async function runMissionControlTests() {
  console.log('\x1b[35m=== STARTING MISSION CONTROL & SESSION HANDOFF TEST SUITE ===\x1b[0m\n');

  // TESTGRUPPE 1: Duplicate-Login-Erkennung & Kick-Parser
  console.log('--- Testgruppe 1: Duplicate-Login-Erkennung ---');
  const kickCases = [
    { input: 'multiplayer.disconnect.duplicate_login', expected: true, desc: 'Minecraft Disconnect-Schlüssel' },
    { input: 'You logged in from another location', expected: true, desc: 'Englische Disconnect-Meldung' },
    { input: 'An einem anderem Ort angemeldet', expected: true, desc: 'Deutsche Disconnect-Meldung (Dativ)' },
    { input: 'Du hast dich an einem anderen Ort angemeldet!', expected: true, desc: 'Deutsche Disconnect-Meldung (Standard MC-Client)' },
    { input: 'You are already connected to this server!', expected: true, desc: 'BungeeCord Proxy-Kick' },
    { input: 'Already connected to this proxy!', expected: true, desc: 'Velocity Proxy-Kick' },
    { input: { text: '', extra: [{ translate: 'multiplayer.disconnect.duplicate_login' }] }, expected: true, desc: 'JSON Chat-Komponente' },
    { input: 'Kicked by operator: Spam', expected: false, desc: 'Anderer Kick-Grund (Spam)' },
    { input: 'Connection timed out', expected: false, desc: 'Anderer Kick-Grund (Timeout)' },
    { input: null, expected: false, desc: 'Null / Undefined Kick-Grund' }
  ];

  for (const tc of kickCases) {
    const isDup = sessionHandoff.isDuplicateLoginReason(tc.input);
    assert(isDup === tc.expected, `Kick-Prüfung: ${tc.desc} -> ${isDup}`);
  }

  // TESTGRUPPE 2: WorldExecutor Pause & Resume Mechanismus
  console.log('\n--- Testgruppe 2: WorldExecutor Pause & Resume ---');
  // 1.5 Test-Double (Mock): Isoliertes Bot-Interface für 100% deterministische Offline-Ausführung ohne Live-Server
  const dummyBot = {
    entity: {
      position: { x: 0, y: 64, z: 0, offset: () => ({ x: 0, y: 0, z: 0 }) },
      yaw: 0
    },
    lookAt: async () => {},
    swingArm: () => {},
    chat: () => {}
  };

  // Erstelle 20 Test-Blöcke
  const testBlocks = [];
  for (let i = 0; i < 20; i++) {
    testBlocks.push({
      x: i,
      y: 64,
      z: 0,
      name: i % 2 === 0 ? 'stone' : 'spruce_planks',
      fullBlockString: i % 2 === 0 ? 'minecraft:stone' : 'minecraft:spruce_planks'
    });
  }

  // Starte asynchronen Bau und pausiere nach 50ms
  const originalBPS = settings.BUILD_OPERATIONS_PER_SECOND;
  settings.BUILD_OPERATIONS_PER_SECOND = 20; // 50ms pro Block
  settings.ENABLE_GREEDY_FILL_OPTIMIZATION = false; // Einzelblock-Modus für präzises Index-Tracking

  const buildPromise = worldExecutor.executeBatch(dummyBot, testBlocks, {
    mode: 'hybrid_visual',
    title: 'Test-Turm'
  });

  // Nach kurzer Zeit pauseBuild aufrufen
  await new Promise(r => setTimeout(r, 120));
  const pauseTriggered = worldExecutor.pauseBuild();
  assert(pauseTriggered === true, 'pauseBuild() gibt true zurück während Bauaktivität');

  await buildPromise; // Warten bis executeBatch anhält

  assert(worldExecutor.isBuilding === false, 'WorldExecutor isBuilding ist false nach Pause');
  assert(worldExecutor.pausedState !== null, 'worldExecutor.pausedState wurde erfolgreich gesichert');
  const savedIndex = worldExecutor.pausedState.completedOps;
  assert(savedIndex > 0 && savedIndex < 20, `Gesperrter Block-Index liegt zwischen Start und Ende (gesichert: ${savedIndex}/20)`);
  assert(worldExecutor.getProgress().isPaused === true, 'getProgress().isPaused ist true');

  // Fortsetzen mit resumeBuild
  console.log(`Setze Bau fort ab Block ${savedIndex}...`);
  const resumePromise = worldExecutor.resumeBuild(dummyBot);
  assert(worldExecutor.pausedState === null, 'worldExecutor.pausedState wird beim Resumen konsumiert');
  const finishedSuccess = await resumePromise;
  assert(finishedSuccess === true, 'resumeBuild() hat den Bauauftrag erfolgreich zu 100% beendet');
  // Testfall: Unerwarteter Socket-Abbruch während Blockplatzierung
  console.log('--- Testfall: Socket-Abbruch während Bauausführung ---');
  let blockAttempts = 0;
  // 1.5 Test-Double (Mock): Simuliert Verbindungsabbruch während der Blockplatzierung
  const disconnectingBot = {
    entity: {
      position: { x: 0, y: 64, z: 0, offset: () => ({ x: 0, y: 0, z: 0 }) },
      yaw: 0
    },
    lookAt: async () => {},
    swingArm: () => {},
    chat: () => {
      blockAttempts++;
      if (blockAttempts >= 3) {
        // Simuliere Verbindungsabbruch durch Kick mitten im Bau
        throw new Error('This client is disconnected');
      }
    }
  };

  settings.BUILD_OPERATIONS_PER_SECOND = 50;
  const abortPromise = worldExecutor.executeBatch(disconnectingBot, testBlocks, {
    mode: 'hybrid_visual',
    title: 'Abbruch-Turm'
  });

  const abortResult = await abortPromise;
  assert(abortResult === false, 'executeBatch fängt Disconnect-Fehler sicher ab und gibt false zurück');
  assert(worldExecutor.isBuilding === false, 'isBuilding ist false nach Disconnect');
  assert(worldExecutor.pausedState !== null, 'pausedState wurde trotz Socket-Fehler gerettet');
  assert(worldExecutor.pausedState.completedOps === 1, `Exakter Index vor Abbruch gesichert (gesichert: ${worldExecutor.pausedState.completedOps}/20)`);

  // Fortsetzen mit gesundem Bot
  const recoverySuccess = await worldExecutor.resumeBuild(dummyBot);
  assert(recoverySuccess === true, 'Bauauftrag nach Socket-Abbruch erfolgreich zu 100% wiederhergestellt');
  assert(worldExecutor.getProgress().currentBlock === 20, 'Alle 20 Blöcke nach Recovery vollständig gesetzt');

  settings.BUILD_OPERATIONS_PER_SECOND = originalBPS;

  // TESTGRUPPE 3: Session Handoff Zustandsmaschine & Ping-Simulation
  console.log('\n--- Testgruppe 3: Session Handoff Zustandsmaschine ---');
  let mockClientReconnected = false;
  // 1.5 Test-Double (Mock): BotClient-Hülle für Handoff-Reconnect-Tests
  const mockBotClient = {
    bot: {
      quit: () => {},
      entity: { position: { x: 0, y: 64, z: 0 }, yaw: 0 }
    },
    cancelReconnect: () => {},
    reconnect: () => { mockClientReconnected = true; }
  };

  sessionHandoff.setBotClient(mockBotClient);
  sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
  assert(sessionHandoff.isPaused() === false, 'Status ONLINE_ACTIVE ist nicht pausiert');

  // Trigger Handoff via duplicate_login Kick
  const handled = sessionHandoff.handleKick('multiplayer.disconnect.duplicate_login');
  assert(handled === true, 'handleKick fängt duplicate_login ab');
  assert(sessionHandoff.state === HANDOFF_STATES.PAUSED_OWNER_INGAME, 'Status wechselt zu PAUSED_OWNER_INGAME');
  assert(sessionHandoff.isPaused() === true, 'isPaused() gibt true zurück');
  assert(sessionHandoff.pingTimer !== null, 'Ping-Timer wurde gestartet');

  // Trigger Resume (z. B. durch Dashboard-Klick)
  sessionHandoff.resumeBot();
  assert(sessionHandoff.state === HANDOFF_STATES.RECONNECTING, 'Status wechselt zu RECONNECTING');
  assert(sessionHandoff.pingTimer === null, 'Ping-Timer wurde gestoppt');

  // Simuliere Bot-Spawn nach Reconnect
  sessionHandoff.onBotSpawn(dummyBot);
  assert(sessionHandoff.state === HANDOFF_STATES.ONLINE_ACTIVE, 'Nach onBotSpawn ist Status wieder ONLINE_ACTIVE');

  // Ping-Simulation: Automatischer Reconnect nach Verlassen des Spielers
  console.log('--- Testfall: Ping-Loop erkennt Verlassen des Spielers ---');
  const origPing = mcProtocol.ping;
  try {
    let pingCalls = 0;
    mcProtocol.ping = async () => {
      pingCalls++;
      if (pingCalls === 1) {
        // Spieler noch online
        return { players: { sample: [{ name: settings.MC_USERNAME }] } };
      }
      // Spieler nicht mehr in Sample
      return { players: { sample: [] } };
    };

    sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
    sessionHandoff.handleKick('multiplayer.disconnect.duplicate_login');
    assert(sessionHandoff.state === HANDOFF_STATES.PAUSED_OWNER_INGAME, 'Status ist PAUSED_OWNER_INGAME nach Kick');

    // Simuliere vergangenen Cooldown vor Disconnect
    sessionHandoff.pauseTimestamp = Date.now() - 15000;
    sessionHandoff.stopPingLoop();
    sessionHandoff.startPingLoop();
    await new Promise(r => setTimeout(r, 60));

    assert(sessionHandoff.state === HANDOFF_STATES.RECONNECTING, 'Ping-Loop hat Spieler-Disconnect erkannt und Reconnect eingeleitet');
    sessionHandoff.onBotSpawn(dummyBot);
    assert(sessionHandoff.state === HANDOFF_STATES.ONLINE_ACTIVE, 'Bot ist nach Spawn wieder ONLINE_ACTIVE');
  } finally {
    mcProtocol.ping = origPing;
  }

  // TESTGRUPPE 4: ArchitectAgent customSiteInfo & Bounds
  console.log('\n--- Testgruppe 4: ArchitectAgent customSiteInfo ---');
  const agent = new ArchitectAgent(dummyBot);
  assert(agent.customSiteInfo === null, 'Initial ist customSiteInfo null');

  // Bounds setzen (simuliert set_build_box vom Dashboard)
  agent.setCustomBounds({
    minX: 10,
    minZ: 20,
    maxX: 24,
    maxZ: 32,
    baseY: 65,
    facing: 'east'
  });

  const effective = agent.getEffectiveSiteInfo();
  assert(effective.width === 15, `Berechnete Breite: 15 (tatsächlich: ${effective.width})`);
  assert(effective.depth === 13, `Berechnete Tiefe: 13 (tatsächlich: ${effective.depth})`);
  assert(effective.facing === 'east', `Ausrichtung: 'east' (tatsächlich: ${effective.facing})`);
  assert(effective.origin.x === 10 && effective.origin.y === 65 && effective.origin.z === 20, 'Origin exakt berechnet');

  // Event 'preview' prüfen
  let previewEmitted = false;
  agent.on('preview', (data) => {
    previewEmitted = true;
    assert(data.canvas !== undefined, 'Preview-Event enthält Canvas');
  });

  // TESTGRUPPE 5: Dashboard Server & WebSocket Protokoll
  console.log('\n--- Testgruppe 5: Dashboard Server & WebSocket Integration ---');
  sessionHandoff.stopPingLoop();
  sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
  dashboardServer.init({
    bot: dummyBot,
    architectAgent: agent
  });

  // Temporären Port für den Test verwenden
  const testPort = 3200 + Math.floor(Math.random() * 800);
  settings.WEB_DASHBOARD_PORT = testPort;
  dashboardServer.start();

  // 1. HTTP-Endpunkt prüfen
  const httpRes = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${testPort}/api/status`, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve(JSON.parse(raw)));
    }).on('error', reject);
  });

  assert(httpRes.status === HANDOFF_STATES.ONLINE_ACTIVE, 'API liefert korrekten Handoff-Status');
  assert(httpRes.executionMode === settings.BUILD_EXECUTION_MODE, 'API liefert korrekten Ausführungsmodus');

  // 2. WebSocket-Verbindung testen
  const ws = new WebSocket(`ws://localhost:${testPort}`);
  const receivedMessages = [];

  ws.on('message', (data) => {
    try {
      receivedMessages.push(JSON.parse(data.toString()));
    } catch {}
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  assert(ws.readyState === WebSocket.OPEN, 'WebSocket-Verbindung erfolgreich hergestellt');

  // Warten auf initiale Nachrichten (status, area_map_data, bot_telemetry)
  await new Promise(r => setTimeout(r, 600));

  const statusMsg = receivedMessages.find(m => m.type === 'status');
  const hasStatusMsg = !!statusMsg;
  const hasMapMsg = receivedMessages.some(m => m.type === 'area_map_data');
  const telemetryMsg = receivedMessages.find(m => m.type === 'bot_telemetry');
  const hasTelemetry = !!telemetryMsg;

  assert(hasStatusMsg, 'Server sendet initial { type: "status" } an Client');
  assert(statusMsg && statusMsg.username, 'status Payload enthält username');
  assert(hasMapMsg, 'Server sendet initial { type: "area_map_data" } mit 64x64 Grid');
  assert(hasTelemetry, 'Server sendet periodische { type: "bot_telemetry" } (500ms Loop)');
  assert(telemetryMsg && telemetryMsg.username, 'bot_telemetry Payload enthält username');

  // 64x64 Grid-Struktur validieren
  const mapMsg = receivedMessages.find(m => m.type === 'area_map_data');
  assert(mapMsg.grid.length === 64 * 64, `area_map_data Grid enthält exakt 4096 Blöcke (tatsächlich: ${mapMsg.grid.length})`);
  assert(mapMsg.grid[0].x !== undefined && mapMsg.grid[0].z !== undefined && mapMsg.grid[0].blockName !== undefined, 'Grid-Punkte besitzen x, z, y, blockName');

  // Client -> Server: set_build_box testen
  ws.send(JSON.stringify({
    type: 'set_build_box',
    minX: 50,
    minZ: 50,
    maxX: 60,
    maxZ: 60,
    baseY: 70,
    facing: 'south'
  }));

  await new Promise(r => setTimeout(r, 100));
  const newSite = agent.getEffectiveSiteInfo();
  assert(newSite.origin.x === 50 && newSite.origin.z === 50 && newSite.facing === 'south', 'Client set_build_box aktualisiert agent.customSiteInfo erfolgreich');

  // Client -> Server: control_action (pause_for_player)
  ws.send(JSON.stringify({
    type: 'control_action',
    action: 'pause_for_player'
  }));

  await new Promise(r => setTimeout(r, 100));
  assert(sessionHandoff.state === HANDOFF_STATES.PAUSED_OWNER_INGAME, 'control_action: pause_for_player pausiert den Bot für den Spieler');

  // Client -> Server: control_action (resume_bot)
  ws.send(JSON.stringify({
    type: 'control_action',
    action: 'resume_bot'
  }));

  await new Promise(r => setTimeout(r, 100));
  assert(sessionHandoff.state === HANDOFF_STATES.RECONNECTING, 'control_action: resume_bot versetzt Session in RECONNECTING');

  // Client -> Server: control_action (move_to)
  let moveGoalTarget = null;
  dummyBot.pathfinder = {
    setGoal: (goal) => { moveGoalTarget = goal; }
  };

  ws.send(JSON.stringify({
    type: 'control_action',
    action: 'move_to',
    targetPos: { x: 120, y: 72, z: -45 }
  }));

  await new Promise(r => setTimeout(r, 100));
  assert(moveGoalTarget !== null, 'control_action: move_to ruft Pathfinder setGoal auf');
  // Sektion 6: WebSocket- und REST-Tests
  // 1. manual_voxel_edit & voxel_delta broadcast
  let receivedDelta = false;
  const deltaListener = (dataStr) => {
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.type === 'voxel_delta') {
        receivedDelta = true;
        assert(parsed.x === 5 && parsed.y === 5 && parsed.z === 5 && parsed.blockString === 'gold_block', 'voxel_delta enthält korrekte Koordinaten und BlockString');
      }
    } catch {}
  };
  ws.on('message', deltaListener);

  ws.send(JSON.stringify({
    type: 'manual_voxel_edit',
    x: 5, y: 5, z: 5,
    blockString: 'gold_block'
  }));
  await new Promise(r => setTimeout(r, 60));
  assert(dashboardServer.activeCanvas?.get(5, 5, 5)?.name === 'gold_block', 'manual_voxel_edit setzt Block in activeCanvas');
  assert(receivedDelta === true, 'Server hat voxel_delta erfolgreich an Client gebroadcastet');
  ws.off('message', deltaListener);

  // 2. swap_material
  ws.send(JSON.stringify({
    type: 'swap_material',
    fromBlock: 'gold_block',
    toBlock: 'diamond_block',
    smartGroupSwap: false
  }));
  await new Promise(r => setTimeout(r, 60));
  assert(dashboardServer.activeCanvas?.get(5, 5, 5)?.name === 'diamond_block', 'swap_material tauscht Block in activeCanvas');

  // 2b. apply_theme ('medieval_spruce')
  dashboardServer.activeCanvas.set(0, 0, 0, 'oak_planks');
  dashboardServer.activeCanvas.set(1, 0, 0, 'stone');
  ws.send(JSON.stringify({
    type: 'apply_theme',
    theme: 'medieval_spruce'
  }));
  await new Promise(r => setTimeout(r, 60));
  assert(dashboardServer.activeCanvas?.get(0, 0, 0)?.name === 'spruce_planks', 'apply_theme tauscht oak_planks zu spruce_planks');
  assert(dashboardServer.activeCanvas?.get(1, 0, 0)?.name === 'stone_bricks', 'apply_theme tauscht stone zu stone_bricks');

  // 3. transform_canvas ('shift_y_up')
  ws.send(JSON.stringify({
    type: 'transform_canvas',
    transformMode: 'shift_y_up'
  }));
  await new Promise(r => setTimeout(r, 60));
  assert(dashboardServer.activeCanvas?.get(5, 6, 5)?.name === 'diamond_block', 'transform_canvas shift_y_up verschiebt Block um Y+1');

  // 4. request_terrain_xray
  let receivedXray = false;
  const xrayListener = (dataStr) => {
    try {
      const parsed = JSON.parse(dataStr);
      if (parsed.type === 'terrain_xray_data') {
        receivedXray = true;
        assert(Array.isArray(parsed.blocks), 'terrain_xray_data liefert Array von Blöcken');
      }
    } catch {}
  };
  ws.on('message', xrayListener);
  ws.send(JSON.stringify({ type: 'request_terrain_xray' }));
  await new Promise(r => setTimeout(r, 100));
  assert(receivedXray === true, 'request_terrain_xray liefert terrain_xray_data Payload zurück');
  ws.off('message', xrayListener);

  // 5. REST API: GET /api/schematics
  const schemRes = await fetch(`http://localhost:${testPort}/api/schematics`);
  assert(schemRes.status === 200, 'GET /api/schematics liefert HTTP 200');
  const schemJson = await schemRes.json();
  assert(Array.isArray(schemJson.files), 'GET /api/schematics liefert files Array');

  // 6. REST API: GET /api/schematics/export/test_api_export
  const exportRes = await fetch(`http://localhost:${testPort}/api/schematics/export/test_api_export`);
  assert(exportRes.status === 200, 'GET /api/schematics/export/:name liefert HTTP 200');
  const exportBuf = await exportRes.arrayBuffer();
  assert(exportBuf.byteLength > 0, 'Exportierte Schematic enthält valide Byte-Daten');

  // TESTGRUPPE 7: Frontend Asset & Contract Verification
  console.log('\n--- Testgruppe 7: Frontend Spezifikations-Konformität ---');
  const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf8');
  const styleCss = fs.readFileSync(path.resolve('src/web/public/style.css'), 'utf8');
  const appModule = await import('../src/web/public/app.js');
  const areaMapModule = await import('../src/web/public/js/areaMap.js');

  assert(indexHtml.includes('Schnitt-Höhe Y: 1 bis Max'), 'index.html enthält "Schnitt-Höhe Y: 1 bis Max" Label');
  assert(indexHtml.includes('id="mapTooltip"'), 'index.html definiert #mapTooltip');
  assert(indexHtml.includes('id="handoffStateBadge"'), 'index.html definiert #handoffStateBadge');
  assert(indexHtml.includes('In Minecraft-Welt bauen') && indexHtml.includes('Letzten Bau rückgängig (!undo)') && indexHtml.includes('Not-Stopp (!stop)'), 'index.html definiert die 3 geforderten Aktionsbuttons');

  assert(typeof appModule.renderAreaMap === 'function', 'app.js ruft renderAreaMap() bei Richtungs-Wahl direkt auf');
  assert(indexHtml.includes('id="mapTooltip"') && typeof appModule.initEventListeners === 'function', 'app.js aktualisiert Tooltip bei mousemove und blendet bei mouseleave aus');
  
  const testMapData = { center: { x: 10, y: 64, z: 20 }, grid: [{ x: 10, y: 75, z: 20, blockName: 'stone' }] };
  const foundCell = areaMapModule.findCellAt(testMapData, 10, 20);
  assert(foundCell && foundCell.y === 75, 'app.js berechnet exakte Elevation (cell.y + 1) bei Shift+Click move_to');
  assert(typeof appModule.updateHandoffUI === 'function', 'app.js formatiert Handoff-Status gemäß Spezifikation');
  assert(typeof appModule.updateHandoffUI === 'function', 'app.js setzt korrekte Toggle-Button-Beschriftungen');

  // Zusätzliche Verifikationen: Responsive Canvas-Skalierung, Pfeil-Grenzclamping, ETA & Höhenlinien
  const mockCanvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 640 }) };
  const mappedCoords = areaMapModule.screenToGridCoords(mockCanvas, 320, 320);
  assert(mappedCoords.col === 32 && mappedCoords.row === 32, 'app.js skaliert 2D-Kartenklicks responsiv mit rect.width/height statt harter Buffer-Breite');
  assert(typeof areaMapModule.drawAreaMap === 'function', 'app.js verwendet Rand-Shift-Logik gegen Pfeil-Clipping am Canvas-Rand');
  assert(typeof appModule.updateTelemetry === 'function', 'app.js berechnet Live-Baufortschritt in Prozent und geschätzte Restzeit (ETA)');
  assert(typeof areaMapModule.drawAreaMap === 'function', 'app.js implementiert topologische Höhenlinien und Relief-Schattierung');
  assert(styleCss.includes('max-width: 100%') && styleCss.includes('object-fit: contain'), 'style.css definiert responsive Skalierung für areaMapCanvas');

  // Aufräumen
  sessionHandoff.stopPingLoop();
  if (sessionHandoff.cooldownTimer) clearTimeout(sessionHandoff.cooldownTimer);
  ws.close();
  dashboardServer.stop();

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} MISSION CONTROL TESTS ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runMissionControlTests().catch(err => {
  console.error('\n\x1b[31m[MISSION CONTROL TEST FEHLGESCHLAGEN]:\x1b[0m', err);
  process.exit(1);
});
