import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { EnvManager, envManager, VALID_EXECUTION_MODES, VALID_AUTH_MODES } from '../src/config/envManager.js';
import { ServerRightsManager, serverRights } from '../src/bot/serverRights.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { settings, validateSettings } from '../src/config/settings.js';
import { DashboardServer } from '../src/web/dashboardServer.js';

let passed = 0;
let total = 0;

function pass(msg) {
  passed++;
  total++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

async function runTests() {
  console.log('\x1b[35m=== STARTING SETTINGS & ONBOARDING TEST SUITE ===\x1b[0m\n');

  // Backup existing .env if present
  const rootEnv = path.resolve('.env');
  const rootEnvBackup = path.resolve('.env.test_backup');
  let hadRootEnv = false;
  if (fs.existsSync(rootEnv)) {
    hadRootEnv = true;
    fs.copyFileSync(rootEnv, rootEnvBackup);
  }

  const testTempDir = path.resolve('test/fixtures/env_test');
  if (!fs.existsSync(testTempDir)) {
    fs.mkdirSync(testTempDir, { recursive: true });
  }

  const testEnvFile = path.join(testTempDir, '.env.test');
  const testExampleFile = path.join(testTempDir, '.env.example.test');
  if (fs.existsSync(testEnvFile)) {
    fs.unlinkSync(testEnvFile);
  }

  // Prepare a realistic template
  const mockExampleContent = `# Test Configuration
MC_HOST=127.0.0.1
MC_PORT=25565
MC_USERNAME=BaumeisterKI
MC_AUTH=offline
MC_VERSION=auto
BOT_OWNER=DeinSpielerName
BUILD_EXECUTION_MODE=auto
SURVIVAL_AUTO_PROCUREMENT=true
SURVIVAL_STORAGE_SCAN_RADIUS=32
CEREBRAS_API_KEYS=mock_key_1,mock_key_2
`;
  fs.writeFileSync(testExampleFile, mockExampleContent, 'utf-8');

  // ==============================================================================
  // 1. EnvManager Tests
  // ==============================================================================
  console.log('--- Testgruppe 1: EnvManager & .env-Generierung ---');
  const customEnvMgr = new EnvManager({
    rootDir: testTempDir,
    envPath: testEnvFile,
    exampleEnvPath: testExampleFile
  });

  // 1.1 hasEnvFile
  assert.strictEqual(customEnvMgr.hasEnvFile(testEnvFile), false, 'Vor dem Speichern existiert keine .env Datei');
  pass('1.1 hasEnvFile erkennt nicht-existierende Datei korrekt');

  // 1.2 Validation checks
  const valErrors1 = customEnvMgr.validateConfig({ MC_PORT: 999999 });
  assert(valErrors1.length > 0, 'Ungültiger Port wird abgewiesen');
  pass('1.2 validateConfig fängt ungültigen Port (>65535) ab');

  const valErrors2 = customEnvMgr.validateConfig({ MC_AUTH: 'invalid_auth' });
  assert(valErrors2.length > 0, 'Ungültiges MC_AUTH wird abgewiesen');
  pass('1.2 validateConfig fängt ungültiges MC_AUTH ab');

  const valErrors3 = customEnvMgr.validateConfig({ BUILD_EXECUTION_MODE: 'invalid_mode' });
  assert(valErrors3.length > 0, 'Ungültiger BUILD_EXECUTION_MODE wird abgewiesen');
  pass('1.2 validateConfig fängt ungültigen BUILD_EXECUTION_MODE ab');

  const valErrorsOwner = customEnvMgr.validateConfig({ BOT_OWNER: '   ' });
  assert(valErrorsOwner.length > 0, 'Leerer BOT_OWNER wird abgewiesen');
  pass('1.2 validateConfig fängt leeren BOT_OWNER ab');

  const valErrorsRcon = customEnvMgr.validateConfig({ RCON_PORT: 70000 });
  assert(valErrorsRcon.length > 0, 'Ungültiger RCON_PORT wird abgewiesen');
  pass('1.2 validateConfig fängt ungültigen RCON_PORT ab');

  // 1.2b MC_VERSION Validation
  const valErrorsVerInvalid = customEnvMgr.validateConfig({ MC_VERSION: 'invalid_version_xyz' });
  assert(valErrorsVerInvalid.length > 0, 'Ungültige MC_VERSION wird abgewiesen');
  pass('1.2 validateConfig fängt ungültige MC_VERSION ab');

  const valErrorsVer99 = customEnvMgr.validateConfig({ MC_VERSION: '99.99.99' });
  assert(valErrorsVer99.length > 0, 'Nicht-existente MC_VERSION 99.99.99 wird abgewiesen');
  pass('1.2 validateConfig fängt nicht-existente MC_VERSION "99.99.99" ab');

  const valErrorsVerBool = customEnvMgr.validateConfig({ MC_VERSION: true });
  assert(valErrorsVerBool.length > 0, 'MC_VERSION: true wird abgewiesen');
  pass('1.2 validateConfig fängt MC_VERSION: true ab');

  const valErrorsVerNum = customEnvMgr.validateConfig({ MC_VERSION: 12345 });
  assert(valErrorsVerNum.length > 0, 'Numerische MC_VERSION wird abgewiesen');
  pass('1.2 validateConfig fängt numerische MC_VERSION ab');

  const valErrorsVerAuto = customEnvMgr.validateConfig({ MC_VERSION: 'auto' });
  assert.strictEqual(valErrorsVerAuto.length, 0, 'MC_VERSION: "auto" ist gültig');
  pass('1.2 validateConfig akzeptiert MC_VERSION: "auto"');

  const valErrorsVer26 = customEnvMgr.validateConfig({ MC_VERSION: '26.3' });
  assert.strictEqual(valErrorsVer26.length, 0, 'MC_VERSION: "26.3" ist gültig');
  pass('1.2 validateConfig akzeptiert MC_VERSION: "26.3"');

  const valErrorsVer121 = customEnvMgr.validateConfig({ MC_VERSION: '1.21.4' });
  assert.strictEqual(valErrorsVer121.length, 0, 'MC_VERSION: "1.21.4" ist gültig');
  pass('1.2 validateConfig akzeptiert MC_VERSION: "1.21.4"');

  const valErrorsVerEmpty = customEnvMgr.validateConfig({ MC_VERSION: '' });
  assert.strictEqual(valErrorsVerEmpty.length, 0, 'Leere MC_VERSION ist gültig (Fallback)');
  pass('1.2 validateConfig akzeptiert leere MC_VERSION');

  const valErrorsVerFalse = customEnvMgr.validateConfig({ MC_VERSION: false });
  assert.strictEqual(valErrorsVerFalse.length, 0, 'MC_VERSION: false ist gültig');
  pass('1.2 validateConfig akzeptiert MC_VERSION: false');

  const valErrorsValid = customEnvMgr.validateConfig({
    BOT_OWNER: 'Steve',
    MC_HOST: 'mc.testserver.de',
    MC_PORT: 25565,
    MC_USERNAME: 'TestBot',
    MC_AUTH: 'offline',
    BUILD_EXECUTION_MODE: 'auto',
    RCON_PORT: 25575
  });
  assert.strictEqual(valErrorsValid.length, 0, 'Gültige Konfiguration liefert keine Fehler');
  pass('1.2 validateConfig akzeptiert valide Parameter');

  // 1.3 .env Erstellung aus .env.example Vorlage
  const saveResult = customEnvMgr.saveConfig({
    MC_HOST: 'play.minecraft.net',
    MC_PORT: 25577,
    MC_USERNAME: 'CustomArchitect',
    MC_AUTH: 'microsoft',
    BOT_OWNER: 'MasterBuilder',
    BUILD_EXECUTION_MODE: 'auto',
    SURVIVAL_AUTO_PROCUREMENT: false,
    RCON_PASSWORD: 'secret#with#hash',
    SURVIVAL_CONTAINER_BLACKLIST_MS: 45000,
    SURVIVAL_RETREAT_DISTANCE: 20,
    SURVIVAL_ATTACK_COOLDOWN_MS: 700
  }, testEnvFile, testExampleFile);

  assert.strictEqual(saveResult.success, true, 'saveConfig gibt success: true zurück');
  assert(fs.existsSync(testEnvFile), '.env.test Datei wurde physisch auf der Festplatte erstellt');
  pass('1.3 saveConfig erzeugt maßgeschneiderte .env-Datei aus Vorlage');

  const writtenContent = fs.readFileSync(testEnvFile, 'utf-8');
  assert(writtenContent.includes('MC_HOST=play.minecraft.net'), 'MC_HOST wurde überschrieben');
  assert(writtenContent.includes('MC_PORT=25577'), 'MC_PORT wurde überschrieben');
  assert(writtenContent.includes('MC_USERNAME=CustomArchitect'), 'MC_USERNAME wurde überschrieben');
  assert(writtenContent.includes('MC_AUTH=microsoft'), 'MC_AUTH wurde überschrieben');
  assert(writtenContent.includes('BOT_OWNER=MasterBuilder'), 'BOT_OWNER wurde überschrieben');
  assert(writtenContent.includes('SURVIVAL_AUTO_PROCUREMENT=false'), 'SURVIVAL_AUTO_PROCUREMENT wurde überschrieben');
  assert(writtenContent.includes('CEREBRAS_API_KEYS=mock_key_1,mock_key_2'), 'Unveränderte API-Keys aus Vorlage blieben erhalten');
  assert(writtenContent.includes('RCON_PASSWORD="secret#with#hash"'), 'Passwort mit Hash wurde sicher gequotet');
  pass('1.3 saveConfig erhält bestehende Schlüssel und Kommentare der Vorlage und quotet Hashes');

  // 1.3b Zweiter Speicheraufruf überschreibt gequoteten Hash sauber ohne Korruption
  customEnvMgr.saveConfig({
    RCON_PASSWORD: 'newpassword'
  }, testEnvFile, testExampleFile);
  const updatedWritten = fs.readFileSync(testEnvFile, 'utf-8');
  assert(updatedWritten.includes('RCON_PASSWORD=newpassword'), 'Neues Passwort sauber ersetzt');
  assert(!updatedWritten.includes('newpassword#with#hash'), 'Alter Hash wurde nicht fälschlich als Kommentar angehängt');
  pass('1.3b saveConfig verhindert Kommentar-Korruption bei Passwörtern mit Hashes');

  // 1.3c MC_VERSION Persistierung in .env
  customEnvMgr.saveConfig({
    MC_VERSION: '1.21.4'
  }, testEnvFile, testExampleFile);
  const versionWritten = fs.readFileSync(testEnvFile, 'utf-8');
  assert(versionWritten.includes('MC_VERSION=1.21.4'), 'MC_VERSION=1.21.4 sauber in .env geschrieben');
  assert.strictEqual(settings.MC_VERSION, '1.21.4', 'settings.MC_VERSION auf 1.21.4 synchronisiert');
  pass('1.3c saveConfig persistiert MC_VERSION in .env und synchronisiert Runtime-Settings');

  // 1.4 parseEnvFile
  const parsedEnv = customEnvMgr.parseEnvFile(`
MC_HOST=play.minecraft.net # Hauptserver
MC_PORT=25577
MC_USERNAME=CustomArchitect
BOT_OWNER=MasterBuilder
RCON_PASSWORD="secure#pass#with#quotes" # RCON Zugang
`);
  assert.strictEqual(parsedEnv.MC_HOST, 'play.minecraft.net', 'parseEnvFile liest MC_HOST korrekt');
  assert.strictEqual(parsedEnv.MC_PORT, '25577', 'parseEnvFile liest MC_PORT korrekt');
  assert.strictEqual(parsedEnv.MC_USERNAME, 'CustomArchitect', 'parseEnvFile liest MC_USERNAME korrekt');
  assert.strictEqual(parsedEnv.BOT_OWNER, 'MasterBuilder', 'parseEnvFile liest BOT_OWNER korrekt');
  assert.strictEqual(parsedEnv.RCON_PASSWORD, 'secure#pass#with#quotes', 'parseEnvFile erhält Hashes innerhalb von Quotes');
  pass('1.4 parseEnvFile parst Datei fehlerfrei in Schlüssel-Wert-Paare inklusive gequoteter Hashes');

  // 1.5 Synchronisation mit Runtime-Settings
  assert.strictEqual(settings.MC_HOST, 'play.minecraft.net', 'settings.MC_HOST wurde synchronisiert');
  assert.strictEqual(settings.MC_PORT, 25577, 'settings.MC_PORT wurde synchronisiert');
  assert.strictEqual(settings.MC_USERNAME, 'CustomArchitect', 'settings.MC_USERNAME wurde synchronisiert');
  assert.strictEqual(settings.BOT_OWNER, 'MasterBuilder', 'settings.BOT_OWNER wurde synchronisiert');
  assert.strictEqual(settings.SURVIVAL_CONTAINER_BLACKLIST_MS, 45000, 'SURVIVAL_CONTAINER_BLACKLIST_MS synchronisiert');
  assert.strictEqual(settings.SURVIVAL_RETREAT_DISTANCE, 20, 'SURVIVAL_RETREAT_DISTANCE synchronisiert');
  assert.strictEqual(settings.SURVIVAL_ATTACK_COOLDOWN_MS, 700, 'SURVIVAL_ATTACK_COOLDOWN_MS synchronisiert');
  pass('1.5 In-Memory settings und process.env spiegeln gespeicherte Konfiguration wider');

  // ==============================================================================
  // 2. ServerRightsManager Tests
  // ==============================================================================
  console.log('\n--- Testgruppe 2: ServerRightsManager & Dynamische Rechte-Erkennung ---');
  const rightsMgr = new ServerRightsManager();

  // 2.1 Initialer Zustand
  assert.strictEqual(rightsMgr.isOp, false, 'Initial ist Bot nicht als OP markiert');
  assert.strictEqual(rightsMgr.permissionLevel, 0, 'Initiales Permission-Level ist 0');
  assert.strictEqual(rightsMgr.getEffectiveMode('auto'), 'pure_physical', 'Im Auto-Modus ohne OP ist pure_physical aktiv');
  pass('2.1 Initialer Zustand defaultet auf sicheres Survival (pure_physical)');

  // 2.1b getStatus mit bot.isOp synchronisiert effectiveMode korrekt
  const opStatus = rightsMgr.getStatus({ isOp: true });
  assert.strictEqual(opStatus.isOp, true, 'isOp ist true');
  assert.strictEqual(opStatus.effectiveMode, 'hybrid_visual', 'getStatus mit OP-Bot wählt hybrid_visual');
  const nonOpStatus = rightsMgr.getStatus({ isOp: false });
  assert.strictEqual(nonOpStatus.isOp, false, 'isOp ist false');
  assert.strictEqual(nonOpStatus.effectiveMode, 'pure_physical', 'getStatus mit Non-OP-Bot wählt pure_physical');
  pass('2.1b getStatus ermittelt korrekten effectiveMode für externe bot.isOp Eigenschaft');

  // 2.2 OP-Berechtigung Level 2 (Gamemaster)
  rightsMgr.setPermissionLevel(2, 'test');
  assert.strictEqual(rightsMgr.isOp, true, 'Level 2 setzt isOp: true');
  assert.strictEqual(rightsMgr.getEffectiveMode('auto'), 'hybrid_visual', 'Mit OP Level 2 wählt auto -> hybrid_visual');
  pass('2.2 Level 2 (Gamemaster) schaltet Auto-Modus auf hybrid_visual um');

  // 2.3 OP-Berechtigung Level 4 (Server Owner/Admin)
  rightsMgr.setPermissionLevel(4, 'test');
  assert.strictEqual(rightsMgr.isOp, true, 'Level 4 setzt isOp: true');
  assert.strictEqual(rightsMgr.getEffectiveMode('auto'), 'hybrid_visual', 'Level 4 wählt hybrid_visual');
  pass('2.3 Level 4 (Admin) behält OP hybrid_visual bei');

  // 2.4 Explizite Modi-Respektierung
  assert.strictEqual(rightsMgr.getEffectiveMode('pure_physical'), 'pure_physical', 'pure_physical bleibt fix pure_physical');
  assert.strictEqual(rightsMgr.getEffectiveMode('rcon_visual'), 'rcon_visual', 'rcon_visual bleibt fix rcon_visual');
  pass('2.4 Feste Modi (pure_physical, rcon_visual) werden immer respektiert');

  // 2.5 Schutz vor Cheat-Versuchen im hybrid_visual Modus ohne OP
  rightsMgr.setPermissionLevel(0, 'server_packet');
  const forcedHybrid = rightsMgr.getEffectiveMode('hybrid_visual');
  assert.strictEqual(forcedHybrid, 'pure_physical', 'hybrid_visual schaltet bei bestätigtem Non-OP auf pure_physical um');
  pass('2.5 Schutzmechanismus: hybrid_visual weicht ohne OP automatisch auf pure_physical aus');

  // 2.6 Simulation von entity_status Minecraft-Paketen
  const mockClient = {
    handlers: {},
    on(event, fn) { this.handlers[event] = fn; },
    emit(event, data) { if (this.handlers[event]) this.handlers[event](data); }
  };
  const mockBot = {
    entity: { id: 42 },
    _client: mockClient,
    on(event, fn) { mockClient.on(event, fn); }
  };

  rightsMgr.attachToBot(mockBot);
  assert.strictEqual(rightsMgr.permissionLevel, 0, 'Nach neuem Bot-Attach zurückgesetzt');

  // Paket entityStatus 26 = Level 2 (26 - 24 = 2)
  mockClient.emit('entity_status', { entityId: 42, entityStatus: 26 });
  assert.strictEqual(rightsMgr.permissionLevel, 2, 'entityStatus 26 entspricht Permission-Level 2');
  assert.strictEqual(rightsMgr.isOp, true, 'isOp ist true');
  assert.strictEqual(mockBot.isOp, true, 'mockBot.isOp wurde synchronisiert');
  pass('2.6 Vanilla entity_status Paket 26 wird korrekt zu OP-Level 2 verarbeitet');

  // Paket entityStatus 24 = Level 0 (Non-OP)
  mockClient.emit('entity_status', { entityId: 42, entityStatus: 24 });
  assert.strictEqual(rightsMgr.permissionLevel, 0, 'entityStatus 24 entspricht Permission-Level 0');
  assert.strictEqual(rightsMgr.isOp, false, 'isOp ist false');
  pass('2.6 Vanilla entity_status Paket 24 setzt OP-Status sauber auf false zurück');

  // 2.7 Simulation von declare_commands (Minecraft 1.13+) mit realem extraNodeData
  mockClient.emit('declare_commands', {
    nodes: [
      { extraNodeData: { name: 'help' } },
      { extraNodeData: { name: 'setblock' } },
      { extraNodeData: { name: 'fill' } }
    ]
  });
  assert.strictEqual(rightsMgr.isOp, true, 'declare_commands mit setblock schaltet isOp: true');
  assert.strictEqual(rightsMgr.detectionSource, 'declare_commands', 'detectionSource ist declare_commands');
  pass('2.7 declare_commands Paket erkennt vorhandene setblock/fill-Rechte via extraNodeData');

  // 2.7b declare_commands ohne OP-Rechte (normale Spielerbefehle) setzt Non-OP
  mockClient.emit('declare_commands', {
    nodes: [
      { extraNodeData: { name: 'help' } },
      { extraNodeData: { name: 'msg' } },
      { extraNodeData: { name: 'me' } }
    ]
  });
  assert.strictEqual(rightsMgr.isOp, false, 'declare_commands ohne setblock/fill setzt isOp: false');
  assert.strictEqual(rightsMgr.detectionSource, 'declare_commands', 'detectionSource ist declare_commands');
  assert.strictEqual(rightsMgr.getEffectiveMode('auto'), 'pure_physical', 'auto schaltet auf pure_physical um');
  pass('2.7b declare_commands ohne OP-Befehle degradiert Status zuverlässig auf Non-OP');

  // 2.8 Chat-Fehlermeldungs-Erkennung (Server lehnt OP-Befehl ab, auch auf Deutsch)
  rightsMgr.setOp(true, 'test');
  mockClient.emit('messagestr', "Keine Berechtigung für diesen Befehl.");
  assert.strictEqual(rightsMgr.isOp, false, 'Deutsche Rechte-Verweigerung im Chat setzt isOp sofort auf false');
  assert.strictEqual(rightsMgr.detectionSource, 'command_rejected', 'Quelle ist command_rejected');
  pass('2.8 Chat-Verweigerung ("keine berechtigung") degradiert Status reaktiv auf Non-OP');

  // ==============================================================================
  // 3. WorldExecutor Mode Resolution Tests
  // ==============================================================================
  console.log('\n--- Testgruppe 3: WorldExecutor Dynamic Mode Resolution ---');

  // 3.1 Bot mit isOp = true
  const opBot = { isOp: true };
  serverRights.reset();
  const resolvedOp = worldExecutor.resolveMode('auto', opBot);
  assert.strictEqual(resolvedOp, 'hybrid_visual', 'WorldExecutor wählt hybrid_visual für OP-Bot');
  pass('3.1 WorldExecutor wählt im Auto-Modus hybrid_visual für OP-Bot');

  // 3.2 Bot mit isOp = false
  const survivalBot = { isOp: false };
  serverRights.reset();
  serverRights.setOp(false, 'test');
  const resolvedSurvival = worldExecutor.resolveMode('auto', survivalBot);
  assert.strictEqual(resolvedSurvival, 'pure_physical', 'WorldExecutor wählt pure_physical für Non-OP-Bot');
  pass('3.2 WorldExecutor wählt im Auto-Modus pure_physical für Non-OP Survival-Bot');

  // ==============================================================================
  // 4. Dashboard REST API Endpoints Tests
  // ==============================================================================
  console.log('\n--- Testgruppe 4: Dashboard BFF API Routes (/api/settings & /api/setup) ---');

  const testDashboard = new DashboardServer();
  const testPort = 3198;
  const app = testDashboard.setupApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(testPort, resolve));

  async function fetchJson(endpoint, options = {}) {
    const res = await fetch(`http://127.0.0.1:${testPort}${endpoint}`, options);
    const json = await res.json();
    return { status: res.status, data: json };
  }

  // 4.1 GET /api/settings
  const getSettingsRes = await fetchJson('/api/settings');
  assert.strictEqual(getSettingsRes.status, 200, 'GET /api/settings liefert HTTP 200');
  assert.strictEqual(getSettingsRes.data.success, true, 'success ist true');
  assert(getSettingsRes.data.settings !== undefined, 'settings Objekt vorhanden');
  assert(getSettingsRes.data.serverRights !== undefined, 'serverRights Objekt vorhanden');
  assert(getSettingsRes.data.versionMetadata !== undefined, 'versionMetadata Objekt vorhanden');
  assert(Array.isArray(getSettingsRes.data.versionMetadata.supportedViewerVersions), 'supportedViewerVersions ist Array');
  assert(getSettingsRes.data.versionMetadata.supportedViewerVersions.includes('1.21.4'), 'supportedViewerVersions enthält 1.21.4');
  assert(getSettingsRes.data.versionMetadata.supportedViewerVersions.includes('1.20.1'), 'supportedViewerVersions enthält 1.20.1');
  assert(Array.isArray(getSettingsRes.data.versionMetadata.supportedGameVersions), 'supportedGameVersions ist Array');
  const gameVers = getSettingsRes.data.versionMetadata.supportedGameVersions.map(v => v.version);
  assert(gameVers.includes('auto') && gameVers.includes('26.3') && gameVers.includes('1.21.4') && gameVers.includes('1.20.1'), 'supportedGameVersions enthält auto, 26.3, 1.21.4, 1.20.1');
  pass('4.1 GET /api/settings liefert Konfiguration, Rechte-Status und Version-Metadaten');

  // 4.2 POST /api/settings
  let settingsReconnectCalled = false;
  testDashboard.botClient = {
    reconnect: () => { settingsReconnectCalled = true; }
  };

  const postSettingsRes = await fetchJson('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BOT_OWNER: 'NewOwner',
      MC_USERNAME: 'BuilderV2',
      MC_HOST: '192.168.1.100',
      MC_PORT: 25565,
      MC_AUTH: 'offline',
      MC_VERSION: '1.21.4',
      BUILD_EXECUTION_MODE: 'pure_physical',
      SURVIVAL_CONTAINER_BLACKLIST_MS: 30000,
      SURVIVAL_RETREAT_DISTANCE: 18,
      SURVIVAL_ATTACK_COOLDOWN_MS: 500,
      reconnectBot: true
    })
  });
  assert.strictEqual(postSettingsRes.status, 200, 'POST /api/settings liefert HTTP 200');
  assert.strictEqual(postSettingsRes.data.success, true, 'POST /api/settings erfolgreich');
  assert.strictEqual(settings.BOT_OWNER, 'NewOwner', 'settings.BOT_OWNER wurde aktualisiert');
  assert.strictEqual(settings.MC_USERNAME, 'BuilderV2', 'settings.MC_USERNAME wurde aktualisiert');
  assert.strictEqual(settings.MC_VERSION, '1.21.4', 'settings.MC_VERSION wurde auf 1.21.4 aktualisiert');
  assert.strictEqual(settings.BUILD_EXECUTION_MODE, 'pure_physical', 'BUILD_EXECUTION_MODE wurde aktualisiert');
  assert.strictEqual(settings.SURVIVAL_CONTAINER_BLACKLIST_MS, 30000, 'SURVIVAL_CONTAINER_BLACKLIST_MS wurde aktualisiert');
  assert.strictEqual(settings.SURVIVAL_RETREAT_DISTANCE, 18, 'SURVIVAL_RETREAT_DISTANCE wurde aktualisiert');
  assert.strictEqual(settings.SURVIVAL_ATTACK_COOLDOWN_MS, 500, 'SURVIVAL_ATTACK_COOLDOWN_MS wurde aktualisiert');
  assert.strictEqual(settingsReconnectCalled, true, 'reconnectBot: true hat botClient.reconnect() ausgelöst');
  pass('4.2 POST /api/settings speichert neue Einstellungen, MC_VERSION und triggert Reconnect');

  // 4.2b POST /api/settings weist ungültige MC_VERSION mit HTTP 400 ab
  const postInvalidVerRes = await fetchJson('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      MC_VERSION: 'invalid-version-xyz'
    })
  });
  assert.strictEqual(postInvalidVerRes.status, 400, 'POST mit ungültiger MC_VERSION liefert HTTP 400');
  assert.strictEqual(postInvalidVerRes.data.success, false, 'success ist false');
  pass('4.2b POST /api/settings weist ungültige MC_VERSION mit Fehler ab');

  const postNonExistentVerRes = await fetchJson('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      MC_VERSION: '99.99.99'
    })
  });
  assert.strictEqual(postNonExistentVerRes.status, 400, 'POST mit nicht-existenter MC_VERSION 99.99.99 liefert HTTP 400');
  assert.strictEqual(postNonExistentVerRes.data.success, false, 'success ist false für 99.99.99');
  pass('4.2c POST /api/settings weist nicht-existente MC_VERSION 99.99.99 mit HTTP 400 ab');

  // 4.3 POST /api/setup (Onboarding-Endpoint)
  let reconnectCalled = false;
  testDashboard.botClient = {
    reconnect: () => { reconnectCalled = true; }
  };

  const setupRes = await fetchJson('/api/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      BOT_OWNER: 'ProGamer',
      MC_USERNAME: 'ArchitektBot',
      MC_HOST: 'mc.hypixel.net',
      MC_PORT: 25565,
      MC_AUTH: 'microsoft',
      BUILD_EXECUTION_MODE: 'auto',
      SURVIVAL_AUTO_PROCUREMENT: true,
      SURVIVAL_STRICT_MATERIALS: true,
      SURVIVAL_AUTO_HARVESTING: true,
      reconnectBot: true
    })
  });
  assert.strictEqual(setupRes.status, 200, 'POST /api/setup liefert HTTP 200');
  assert.strictEqual(setupRes.data.success, true, 'Onboarding Setup erfolgreich');
  assert.strictEqual(reconnectCalled, true, 'Bot-Reconnect wurde durch Onboarding ausgelöst');
  assert.strictEqual(settings.BOT_OWNER, 'ProGamer', 'Owner auf ProGamer gesetzt');
  assert.strictEqual(settings.BUILD_EXECUTION_MODE, 'auto', 'Modus auf auto gesetzt');
  assert.strictEqual(settings.SURVIVAL_STRICT_MATERIALS, true, 'SURVIVAL_STRICT_MATERIALS auf true gesetzt');
  assert.strictEqual(settings.SURVIVAL_AUTO_HARVESTING, true, 'SURVIVAL_AUTO_HARVESTING auf true gesetzt');
  pass('4.3 POST /api/setup schließt Onboarding ab und triggert automatischen Reconnect');

  // 4.4 POST /api/bot/reconnect
  reconnectCalled = false;
  const reconnectRes = await fetchJson('/api/bot/reconnect', { method: 'POST' });
  assert.strictEqual(reconnectRes.status, 200, 'POST /api/bot/reconnect liefert HTTP 200');
  assert.strictEqual(reconnectCalled, true, 'Bot-Reconnect ausgeführt');
  pass('4.4 POST /api/bot/reconnect triggert Bot-Neustart');

  // 4.5 GET /api/status liefert executionMode, effectiveMode und serverRights
  const statusRes = await fetchJson('/api/status');
  assert.strictEqual(statusRes.status, 200, 'GET /api/status liefert HTTP 200');
  assert(statusRes.data.executionMode !== undefined, 'executionMode vorhanden');
  assert(statusRes.data.effectiveMode !== undefined, 'effectiveMode vorhanden');
  assert(statusRes.data.serverRights !== undefined, 'serverRights vorhanden');
  pass('4.5 GET /api/status liefert executionMode, effectiveMode und serverRights');

  // ==============================================================================
  // 5. HTML Markup & Version Configuration UI Tests
  // ==============================================================================
  console.log('\n--- Testgruppe 5: HTML Markup & Version Configuration UI ---');
  const indexHtmlContent = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf-8');

  // 5.1 Onboarding Version Chips
  assert(indexHtmlContent.includes('id="obVersionChips"'), 'index.html enthält #obVersionChips');
  ['auto', '26.3', '1.21.4', '1.21.1', '1.20.4', '1.20.1'].forEach(ver => {
    assert(indexHtmlContent.includes(`data-ver="${ver}"`), `Version chip ${ver} in index.html vorhanden`);
  });
  pass('5.1 Onboarding Wizard besitzt vollständige Version-Chips (auto, 26.3, 1.21.4, 1.21.1, 1.20.4, 1.20.1)');

  // 5.2 Settings Modal Version Chips & Reconnect Checkbox
  assert(indexHtmlContent.includes('id="cfgMcVersionChips"'), 'index.html enthält #cfgMcVersionChips');
  assert(indexHtmlContent.includes('id="cfgReconnectBot"'), 'index.html enthält #cfgReconnectBot Checkbox');
  assert(/<input[^>]*id="cfgReconnectBot"[^>]*checked/.test(indexHtmlContent) || /<input[^>]*checked[^>]*id="cfgReconnectBot"/.test(indexHtmlContent), '#cfgReconnectBot ist standardmäßig checked');
  assert(indexHtmlContent.includes('Bot sofort mit neuer Version neu verbinden'), 'Label für Reconnect-Checkbox vorhanden');
  pass('5.2 Settings Modal besitzt #cfgMcVersionChips und vorausgewählte #cfgReconnectBot Checkbox');

  // 5.3 OnboardingWizard Script Integration
  const wizardModule = await import('../src/web/public/js/onboardingWizard.js');
  assert(typeof wizardModule.setupVersionChips === 'function', 'onboardingWizard.js definiert setupVersionChips');
  assert(indexHtmlContent.includes('id="cfgReconnectBot"') && typeof wizardModule.submitOnboarding === 'function', 'onboardingWizard.js liest cfgReconnectBot aus');
  assert(indexHtmlContent.includes('id="cfgMcVersionChips"'), 'onboardingWizard.js synchronisiert cfgMcVersionChips');
  pass('5.3 onboardingWizard.js synchronisiert Version-Chips und liest #cfgReconnectBot');

  // 5.4 App.js Viewer Auto-Reload Integration
  const appModule = await import('../src/web/public/app.js');
  assert(typeof appModule.refreshViewer === 'function', 'app.js exportiert refreshViewer');

  // Behavioral verification of viewer cache-buster
  const mockViewerFrame = { src: 'http://localhost:3081' };
  globalThis.document = {
    getElementById: (id) => (id === 'viewerFrame' ? mockViewerFrame : null)
  };
  globalThis.window = {
    location: { protocol: 'http:', hostname: 'localhost' }
  };
  appModule.refreshViewer(true);
  assert(mockViewerFrame.src.includes('?v='), 'app.js refresht Viewer-Iframe mit Cache-Buster (?v=)');
  pass('5.4 app.js aktualisiert den 3D-Kamera-Iframe mit Cache-Buster bei Reconnect / Versionswechsel');

  // Server schließen & aufräumen
  await new Promise((resolve) => server.close(resolve));
  try {
    fs.rmSync(testTempDir, { recursive: true, force: true });
    if (hadRootEnv && fs.existsSync(rootEnvBackup)) {
      fs.copyFileSync(rootEnvBackup, rootEnv);
      fs.unlinkSync(rootEnvBackup);
    } else if (fs.existsSync(rootEnv)) {
      fs.unlinkSync(rootEnv);
    }
    settings.SURVIVAL_CONTAINER_BLACKLIST_MS = 60000;
    delete process.env.SURVIVAL_CONTAINER_BLACKLIST_MS;
  } catch {}

  console.log(`\n\x1b[32m=== ALLE ${passed}/${total} TESTS DER SETTINGS & ONBOARDING SUITE BESTANDEN! ===\x1b[0m\n`);
}

runTests().catch(err => {
  console.error('\x1b[31m[FAIL] Testfehler:\x1b[0m', err);
  process.exit(1);
});
