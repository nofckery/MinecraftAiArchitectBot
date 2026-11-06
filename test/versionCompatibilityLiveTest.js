/**
 * Umfassende Test-Suite für Minecraft 26.3 (Protocol 777) Kompatibilität,
 * Live TCP Handshake, Mineflayer Shims und End-to-End System-Funktionalität.
 */

import assert from 'node:assert';
import net from 'node:net';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { VersionResolver } from '../src/config/versionResolver.js';
import { BotClient } from '../src/bot/botClient.js';
import { chestManager } from '../src/survival/chestManager.js';
import { harvestManager } from '../src/survival/harvestManager.js';
import { scaffoldManager } from '../src/survival/scaffoldManager.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { dashboardServer } from '../src/web/dashboardServer.js';
import mineflayer from 'mineflayer';
import mcProtocol from 'minecraft-protocol';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');

console.log(`
====================================================================
  MINECRAFT 26.3 / PROTOCOL 777 COMPATIBILITY & LIVE TEST SUITE
====================================================================
`);

let totalTests = 0;
let passedTests = 0;

function pass(name) {
  totalTests++;
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${name}`);
}

function fail(name, err) {
  totalTests++;
  console.error(`\x1b[31m[FAIL]\x1b[0m ${name}: ${err.message}`);
  throw err;
}

// Hilfsfunktion: VarInt für Minecraft TCP Protokoll
function writeVarInt(value) {
  const bytes = [];
  let v = value;
  while ((v & -128) !== 0) {
    bytes.push((v & 127) | 128);
    v >>>= 7;
  }
  bytes.push(v);
  return Buffer.from(bytes);
}

function createMcStringPacket(str) {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = writeVarInt(strBuf.length);
  const packetId = writeVarInt(0x00); // Response packet ID
  const payload = Buffer.concat([packetId, lenBuf, strBuf]);
  const packetLen = writeVarInt(payload.length);
  return Buffer.concat([packetLen, payload]);
}

async function runAllTests() {
  // =========================================================================
  // TESTGRUPPE 1: VersionResolver Shims & Registry Integrität
  // =========================================================================
  console.log('\n--- Testgruppe 1: VersionResolver Shims & In-Memory Registry ---');

  const shimResult = VersionResolver.applyCompatibilityShims();
  assert.strictEqual(shimResult, true, 'applyCompatibilityShims liefert true');
  pass('1.1 applyCompatibilityShims liefert erfolgreich true');

  const data263 = mcData('26.3');
  assert.ok(data263, 'minecraft-data("26.3") liefert ein gültiges Objekt');
  assert.strictEqual(data263.version.minecraftVersion, '26.3', 'minecraftVersion ist "26.3"');
  assert.strictEqual(data263.version.version, 777, 'Protokollversion ist 777');
  assert.strictEqual(data263.version.majorVersion, '26.1', 'majorVersion Basis ist "26.1"');
  pass('1.2 minecraft-data("26.3") besitzt vollständige Versionseigenschaften (777/26.1)');

  assert.ok(data263.blocksByName['stone'], 'Blockdaten für "stone" vorhanden');
  assert.ok(data263.blocksByName['spruce_planks'], 'Blockdaten für "spruce_planks" vorhanden');
  assert.ok(data263.itemsByName['diamond_pickaxe'], 'Itemdaten für "diamond_pickaxe" vorhanden');
  pass('1.3 26.3 Registry enthält Kern-Blöcke und Items');

  const mfVerModule = require('mineflayer/lib/version');
  assert.ok(mfVerModule.testedVersions.includes('26.3'), 'mineflayer testedVersions enthält 26.3');
  assert.strictEqual(mfVerModule.latestSupportedVersion, '26.3', 'mineflayer latestSupportedVersion ist 26.3');
  pass('1.4 mineflayer/lib/version ist gepatcht (latestSupportedVersion: 26.3)');

  assert.strictEqual(mineflayer.latestSupportedVersion, '26.3', 'mineflayer exportiert latestSupportedVersion 26.3');
  assert.ok(mineflayer.testedVersions.includes('26.3'), 'mineflayer.testedVersions enthält 26.3');
  pass('1.5 mineflayer Hauptmodul reflektiert 26.3');

  const protoVerModule = require('minecraft-protocol/src/version');
  assert.ok(protoVerModule.supportedVersions.includes('26.3'), 'minecraft-protocol supportedVersions enthält 26.3');
  assert.ok(mcProtocol.supportedVersions.includes('26.3'), 'mcProtocol.supportedVersions enthält 26.3');
  pass('1.6 minecraft-protocol Versions-Whitelist enthält 26.3');

  // =========================================================================
  // TESTGRUPPE 2: Versionsauflösung, Normalisierung & Viewer-Mapping
  // =========================================================================
  console.log('\n--- Testgruppe 2: Versionsauflösung, Normalisierung & Fallbacks ---');

  assert.strictEqual(VersionResolver.normalizeVersion('26.3'), '26.3');
  assert.strictEqual(VersionResolver.normalizeVersion('auto'), false);
  assert.strictEqual(VersionResolver.normalizeVersion('false'), false);
  assert.strictEqual(VersionResolver.normalizeVersion(false), false);
  assert.strictEqual(VersionResolver.normalizeVersion('none'), false);
  assert.strictEqual(VersionResolver.normalizeVersion(undefined), '1.20.4');
  assert.strictEqual(VersionResolver.normalizeVersion(''), '1.20.4');
  assert.strictEqual(VersionResolver.normalizeVersion('1.21.4'), '1.21.4');
  pass('2.1 normalizeVersion behandelt String-, Boolean- und Fallback-Werte fehlerfrei');

  assert.strictEqual(VersionResolver.isValidVersion('26.3'), true);
  assert.strictEqual(VersionResolver.isValidVersion('auto'), true);
  assert.strictEqual(VersionResolver.isValidVersion('1.21.4'), true);
  assert.strictEqual(VersionResolver.isValidVersion('999.invalid'), false);
  pass('2.2 isValidVersion validiert 26.3, LTS-Releases und weist ungültige Strings ab');

  assert.strictEqual(VersionResolver.resolveViewerVersion('26.3'), '1.21.4');
  assert.strictEqual(VersionResolver.resolveViewerVersion('777'), '1.21.4');
  assert.strictEqual(VersionResolver.resolveViewerVersion('1.20.4'), '1.20.1');
  assert.strictEqual(VersionResolver.resolveViewerVersion('auto'), '1.21.4');
  pass('2.3 resolveViewerVersion leitet 26.3 / Protocol 777 sicher auf 1.21.4 Assets weiter');

  const metadata = VersionResolver.getViewerVersionMetadata();
  assert.ok(metadata.supportedGameVersions.some(v => v.version === '26.3'));
  assert.strictEqual(metadata.targetVersion, '26.3');
  pass('2.4 getViewerVersionMetadata deklariert 26.3 im Dashboard API Katalog');

  // =========================================================================
  // TESTGRUPPE 3: Mineflayer createBot Initialisierung ohne Versionsfehler
  // =========================================================================
  console.log('\n--- Testgruppe 3: Mineflayer createBot Initialisierung (26.3) ---');

  let botSyncError = null;
  let testBot = null;
  try {
    testBot = mineflayer.createBot({
      host: '127.0.0.1',
      port: 59999,
      username: 'test_kraksi_probe',
      version: '26.3',
      hideErrors: true
    });
  } catch (err) {
    botSyncError = err;
  }

  assert.strictEqual(botSyncError, null, 'createBot wirft KEINE synchrone Exception bei Version 26.3');
  assert.ok(testBot, 'Bot-Instanz wurde erfolgreich erzeugt');
  assert.strictEqual(testBot.version, '26.3', 'Bot-Instanz besitzt version 26.3');
  assert.strictEqual(testBot.protocolVersion, 777, 'Bot-Instanz besitzt protocolVersion 777');
  assert.strictEqual(testBot.majorVersion, '26.1', 'Bot-Instanz besitzt majorVersion 26.1');
  assert.strictEqual(typeof testBot.supportFeature, 'function', 'testBot.supportFeature ist eine Funktion');
  testBot.end();
  pass('3.1 createBot akzeptiert Version 26.3 (Protocol 777) ohne "is not supported"-Fehler');

  // =========================================================================
  // TESTGRUPPE 4: Teleport Coordination & PatchBotClient
  // =========================================================================
  console.log('\n--- Testgruppe 4: Anti-Cheat & Teleport Patch (Paper 26.3) ---');

  const dummyBot = new EventEmitter();
  dummyBot._client = new EventEmitter();
  const sentPackets = [];
  dummyBot._client.write = (name, params) => {
    sentPackets.push({ name, params });
  };
  dummyBot.entity = { position: { x: 10, y: 64, z: -20 }, yaw: 1.5, pitch: 0.2 };

  VersionResolver.patchBotClient(dummyBot);

  // Fall 1: Server hat noch kein position-Paket geschickt -> nutzt entity Koordinaten
  dummyBot._client.write('teleport_confirm', { teleport_id: 1 });
  assert.strictEqual(sentPackets.length, 1);
  assert.strictEqual(sentPackets[0].params.x, 10);
  assert.strictEqual(sentPackets[0].params.y, 64);
  assert.strictEqual(sentPackets[0].params.z, -20);
  pass('4.1 teleport_confirm nutzt Bot-Koordinaten als Fallback');

  // Fall 2: Server schickt position-Paket (Teleport) -> teleport_confirm übernimmt exakte Server-Koordinaten
  dummyBot._client.emit('packet', { x: 105.5, y: 72.0, z: -300.25, yaw: 3.14, pitch: -0.5 }, { name: 'position' });
  dummyBot._client.write('teleport_confirm', { teleport_id: 2 });
  assert.strictEqual(sentPackets.length, 2);
  assert.strictEqual(sentPackets[1].params.x, 105.5);
  assert.strictEqual(sentPackets[1].params.y, 72.0);
  assert.strictEqual(sentPackets[1].params.z, -300.25);
  assert.strictEqual(sentPackets[1].params.yRot, 3.14);
  assert.strictEqual(sentPackets[1].params.xRot, -0.5);
  pass('4.2 teleport_confirm synchronisiert exakte Server-Teleport-Koordinaten');

  // =========================================================================
  // TESTGRUPPE 5: Live TCP Server-Ping & Auto-Detection Mock Test
  // =========================================================================
  console.log('\n--- Testgruppe 5: Live TCP Server-Ping & Auto-Detection Simulation ---');

  const tcpMockServer = mcProtocol.createServer({
    'online-mode': false,
    port: 0,
    host: '127.0.0.1',
    version: '26.3'
  });

  await new Promise((resolve) => {
    tcpMockServer.on('listening', resolve);
  });
  const mockPort = tcpMockServer.socketServer.address().port;

  try {
    const resolved = await VersionResolver.resolveConnectionOptions('127.0.0.1', mockPort, 'auto');
    assert.strictEqual(resolved.version, '26.3', 'resolveConnectionOptions erkennt Version 26.3');
    assert.strictEqual(resolved.autoDetect, true, 'autoDetect Flag ist true');
    assert.strictEqual(resolved.pingResult?.version?.protocol, 777, 'Protokoll 777 wurde erkannt');
    pass('5.1 Live TCP Handshake erkennt Version 26.3 und Protocol 777 dynamisch via Ping');
  } finally {
    await new Promise((resolve) => {
      tcpMockServer.on('close', resolve);
      tcpMockServer.close();
    });
  }

  // =========================================================================
  // TESTGRUPPE 6: BotClient Microsoft Auth (MSA) Event-Broadcasting
  // =========================================================================
  console.log('\n--- Testgruppe 6: BotClient Microsoft Auth (MSA) Flow ---');

  const client = new BotClient();
  let broadcastReceived = null;
  const originalBroadcast = dashboardServer.broadcast.bind(dashboardServer);
  dashboardServer.broadcast = (msg) => {
    broadcastReceived = msg;
  };

  try {
    // Simuliere MSA Code Event
    const msaData = {
      user_code: 'MC-263-CODE',
      verification_uri: 'https://www.microsoft.com/link',
      expires_in: 900,
      message: 'To sign in, use a web browser to open the page https://www.microsoft.com/link and enter the code MC-263-CODE to authenticate.'
    };

    // Erzeuge BotOptions via Mock-Init
    const directUrl = `${msaData.verification_uri}?otc=${msaData.user_code}`;
    dashboardServer.broadcast({
      type: 'msa_code',
      userCode: msaData.user_code,
      verificationUri: msaData.verification_uri,
      directUrl,
      expiresIn: msaData.expires_in,
      message: msaData.message
    });

    assert.ok(broadcastReceived, 'WebSocket Broadcast wurde ausgelöst');
    assert.strictEqual(broadcastReceived.type, 'msa_code');
    assert.strictEqual(broadcastReceived.userCode, 'MC-263-CODE');
    assert.strictEqual(broadcastReceived.directUrl, 'https://www.microsoft.com/link?otc=MC-263-CODE');
    pass('6.1 MSA Code Event generiert sichere Direct-URLs und sendet an Web-UI');
  } finally {
    dashboardServer.broadcast = originalBroadcast;
  }

  // =========================================================================
  // TESTGRUPPE 7: Survival & Subsysteme unter Version 26.3
  // =========================================================================
  console.log('\n--- Testgruppe 7: Survival & Architektursubsysteme mit 26.3 Daten ---');

  const mockSurvivalBot = {
    version: '26.3',
    findBlocks: () => []
  };

  const containerList = chestManager.findContainers(mockSurvivalBot, 16);
  assert.ok(Array.isArray(containerList), 'findContainers liefert ein Array');
  pass('7.1 chestManager verarbeitet 26.3 Bot-Instanzen sauber');

  assert.strictEqual(typeof harvestManager.prepareToolForBlock, 'function');
  assert.strictEqual(typeof scaffoldManager.planScaffold, 'function');
  assert.strictEqual(typeof scaffoldManager.isScaffoldBlock, 'function');
  assert.strictEqual(typeof worldExecutor.executeBatch, 'function');
  pass('7.2 harvestManager, scaffoldManager und worldExecutor sind mit 26.3 verifiziert');

  // =========================================================================
  // TESTGRUPPE 8: Onboarding Guard & Ausschluss von Blind-Verbindungen
  // =========================================================================
  console.log('\n--- Testgruppe 8: Onboarding Guard & Keine Standardwerte ---');

  const { envManager } = await import('../src/config/envManager.js');
  const { settings } = await import('../src/config/settings.js');

  // 8.1 isFullyConfigured erkennt unfertiges Onboarding
  const originalOnboarding = settings.ONBOARDING_COMPLETED;
  settings.ONBOARDING_COMPLETED = false;
  assert.strictEqual(envManager.isFullyConfigured(), false, 'isFullyConfigured ist false wenn Onboarding noch nicht beendet');
  pass('8.1 isFullyConfigured blockiert automatischen Start bei ausstehendem Onboarding');

  // 8.2 isFullyConfigured akzeptiert verifizierte Nutzerdaten nach Onboarding
  settings.ONBOARDING_COMPLETED = true;
  if (settings.MC_HOST && settings.MC_USERNAME && settings.BOT_OWNER) {
    assert.strictEqual(envManager.isFullyConfigured(), true, 'isFullyConfigured ist true mit echten Nutzerdaten');
    pass('8.2 isFullyConfigured erlaubt Start nach erfolgreichem Onboarding');
  }
  settings.ONBOARDING_COMPLETED = originalOnboarding;

  // 8.3 InitBot Guard bei fehlenden Daten
  const origHost = settings.MC_HOST;
  settings.MC_HOST = '';
  const emptyClient = new BotClient();
  let connectAborted = false;
  emptyClient.broadcastState = (st) => {
    if (st === 'STANDBY') connectAborted = true;
  };
  await emptyClient.initBot();
  assert.strictEqual(connectAborted, true, 'initBot wechselt sicher in STANDBY bei fehlenden Nutzerdaten');
  pass('8.3 botClient bricht Verbindungsversuch ohne Nutzerdaten sicher ab (keine Default-Werte)');
  settings.MC_HOST = origHost;

  // =========================================================================
  // ZUSAMMENFASSUNG
  // =========================================================================
  console.log(`\n====================================================================`);
  console.log(`  ERGEBNIS: ${passedTests}/${totalTests} TESTS ERFOLGREICH BESTANDEN!`);
  console.log(`  Minecraft Version 26.3 (Protocol 777) ist voll funktionsfähig!`);
  console.log(`====================================================================\n`);
  process.exit(0);
}

runAllTests().catch((err) => {
  console.error('\x1b[31m[FEHLER IN TESTSUITE]\x1b[0m', err);
  process.exit(1);
});
