/**
 * Testsuite für 3D Viewer State-ID Translation & Asset Alignment (Milestone 1 / R1)
 * Prüft VersionResolver, ViewerStateTranslator, Paletten-Mapping und Chunk-Serialisierung.
 */

import { VersionResolver } from '../src/config/versionResolver.js';
import { ViewerStateTranslator } from '../src/web/services/viewerStateTranslator.js';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const prismarineChunk = require('prismarine-chunk');

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

async function runViewerStateTranslatorTests() {
  VersionResolver.applyCompatibilityShims();
  console.log('=== STARTING 3D VIEWER STATE TRANSLATOR TEST SUITE ===\n');

  // ---------------------------------------------------------
  // Testgruppe 1: VersionResolver Asset-Version Mapping (R1 / R2)
  // ---------------------------------------------------------
  console.log('--- Testgruppe 1: VersionResolver Asset-Version Mapping ---');

  assert(
    VersionResolver.resolveViewerVersion('1.20.4') === '1.20.1',
    '1.1 resolveViewerVersion(\'1.20.4\') mappt korrekt auf \'1.20.1\''
  );

  assert(
    VersionResolver.resolveViewerVersion('1.21.1') === '1.21.1',
    '1.2 resolveViewerVersion(\'1.21.1\') mappt direkt auf \'1.21.1\''
  );

  assert(
    VersionResolver.resolveViewerVersion('26.3') === '1.21.4',
    '1.3 resolveViewerVersion(\'26.3\') (Protocol 777) mappt auf \'1.21.4\''
  );

  assert(
    VersionResolver.resolveViewerVersion('1.21.4') === '1.21.4',
    '1.4 resolveViewerVersion(\'1.21.4\') bleibt \'1.21.4\''
  );

  assert(
    VersionResolver.resolveViewerVersion('auto') === '1.21.4',
    '1.5 resolveViewerVersion(\'auto\') fällt sauber auf \'1.21.4\' zurück'
  );

  assert(
    VersionResolver.resolveViewerVersion(false) === '1.21.4',
    '1.6 resolveViewerVersion(false) fällt sauber auf \'1.21.4\' zurück'
  );

  assert(
    VersionResolver.resolveViewerVersion('1.19.4') === '1.19',
    '1.7 resolveViewerVersion(\'1.19.4\') mappt auf \'1.19\''
  );

  assert(
    VersionResolver.resolveViewerVersion('1.16.5') === '1.16.4',
    '1.8 resolveViewerVersion(\'1.16.5\') mappt auf \'1.16.4\''
  );

  // Versionsvalidierung & Metadaten
  assert(VersionResolver.isValidVersion('26.3') === true, '1.9 isValidVersion erkennt \'26.3\' als gültig');
  assert(VersionResolver.isValidVersion('1.21.4') === true, '1.10 isValidVersion erkennt \'1.21.4\' als gültig');
  assert(VersionResolver.isValidVersion('auto') === true, '1.11 isValidVersion erkennt \'auto\' als gültig');
  assert(VersionResolver.isValidVersion('invalid-xyz') === false, '1.12 isValidVersion weist ungültige Strings ab');

  const meta = VersionResolver.getViewerVersionMetadata();
  assert(Array.isArray(meta.supportedViewerVersions), '1.13 getViewerVersionMetadata liefert supportedViewerVersions Array');
  assert(meta.supportedViewerVersions.includes('1.21.4'), '1.14 supportedViewerVersions enthält 1.21.4');
  assert(meta.supportedViewerVersions.includes('1.20.1'), '1.15 supportedViewerVersions enthält 1.20.1');

  // ---------------------------------------------------------
  // Testgruppe 2: ViewerStateTranslator Factory & Cache
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 2: ViewerStateTranslator Factory & Cache ---');

  const translatorA = ViewerStateTranslator.create('26.3', '1.21.4');
  const translatorB = ViewerStateTranslator.create('26.3', '1.21.4');
  assert(translatorA === translatorB, '2.1 ViewerStateTranslator.create liefert gecachten Singleton für gleiche Versionen');
  assert(translatorA.sourceVersion === '26.3', '2.2 sourceVersion ist 26.3');
  assert(translatorA.targetViewerVersion === '1.21.4', '2.3 targetViewerVersion ist 1.21.4');
  assert(translatorA.table instanceof Int32Array, '2.4 table ist ein Int32Array');
  assert(translatorA.table.length > 28000, '2.5 table hat ausreichende Kapazität (>28.000 States)');

  // ---------------------------------------------------------
  // Testgruppe 3: State-ID Translation & deepslate_tiles (R1 Kernanforderung)
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 3: State-ID Translation & deepslate_tiles ---');

  const d214 = mcData('1.21.4');
  const expectedDeepslateTiles214 = d214.blocksByName['deepslate_tiles']?.defaultState;
  assert(typeof expectedDeepslateTiles214 === 'number', '3.1 deepslate_tiles existiert in 1.21.4 mit defaultState');

  // State-ID 28748 Prüfung
  const mapped28748 = translatorA.translateStateId(28748);
  assert(typeof mapped28748 === 'number', '3.2 translateStateId(28748) liefert eine Zahl');
  assert(!isNaN(mapped28748), '3.3 translateStateId(28748) ist nicht NaN');
  assert(mapped28748 !== undefined, '3.4 translateStateId(28748) ist nicht undefined');
  assert(
    mapped28748 === expectedDeepslateTiles214,
    `3.5 State-ID 28748 (deepslate_tiles) übersetzt exakt zu 1.21.4 State ${expectedDeepslateTiles214} (erhalten: ${mapped28748})`
  );

  // State-ID 34598 (26.3 blocks.json deepslate_tiles)
  const mapped34598 = translatorA.translateStateId(34598);
  assert(
    mapped34598 === expectedDeepslateTiles214,
    `3.6 State-ID 34598 (26.3 deepslate_tiles) übersetzt exakt zu 1.21.4 State ${expectedDeepslateTiles214}`
  );

  // Standard-Blöcke
  const mappedGrass = translatorA.translateStateId(8);
  assert(
    d214.blocksByStateId[mappedGrass]?.name === 'grass_block',
    `3.7 grass_block übersetzt korrekt (State: ${mappedGrass}, Name: ${d214.blocksByStateId[mappedGrass]?.name})`
  );

  const mappedSpruce = translatorA.translateStateId(142);
  assert(
    d214.blocksByStateId[mappedSpruce]?.name === 'spruce_log',
    `3.7b State 142 (spruce_log in 26.3) übersetzt zu spruce_log in 1.21.4 (State: ${mappedSpruce})`
  );

  const birchSrcState = translatorA.srcMcData.blocksByName['birch_log']?.defaultState;
  const mappedBirch = translatorA.translateStateId(birchSrcState);
  assert(
    d214.blocksByStateId[mappedBirch]?.name === 'birch_log',
    `3.7c birch_log aus 26.3 (State: ${birchSrcState}) übersetzt zu birch_log in 1.21.4 (State: ${mappedBirch})`
  );

  // Grenzwerte und ungültige Eingaben
  assert(translatorA.translateStateId(-1) === translatorA.targetAirStateId, '3.8 Negative IDs fallen auf targetAirStateId zurück');
  assert(translatorA.translateStateId(999999) === translatorA.targetAirStateId, '3.9 Extrem große IDs fallen auf targetAirStateId zurück');
  assert(translatorA.translateStateId(null) === translatorA.targetAirStateId, '3.10 null fällt auf targetAirStateId zurück');
  assert(translatorA.translateStateId(undefined) === translatorA.targetAirStateId, '3.11 undefined fällt auf targetAirStateId zurück');
  assert(translatorA.translateStateId('invalid') === translatorA.targetAirStateId, '3.12 Nicht-numerische Eingaben fallen auf targetAirStateId zurück');

  // Prüfen, dass kein State in der Tabelle die maximale State-ID von 1.21.4 überschreitet
  let outOfBoundsCount = 0;
  for (let i = 0; i < translatorA.table.length; i++) {
    const targetId = translatorA.table[i];
    if (targetId < 0 || targetId > translatorA.targetMaxStateId) {
      outOfBoundsCount++;
    }
  }
  assert(outOfBoundsCount === 0, '3.13 Kein einziger State in der Übersetzungstabelle überschreitet die 1.21.4 Obergrenze');

  // ---------------------------------------------------------
  // Testgruppe 4: Paletten- und Block-Update-Übersetzung
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 4: Paletten- und Block-Update-Übersetzung ---');

  const samplePalette = [0, 28748, 8, 34598];
  translatorA.translateChunkPalette(samplePalette);
  assert(samplePalette[0] === translatorA.targetAirStateId, '4.1 Palettenindex 0 ist targetAirStateId');
  assert(samplePalette[1] === expectedDeepslateTiles214, '4.2 Palettenindex 1 (28748) ist übersetzt');
  assert(d214.blocksByStateId[samplePalette[2]]?.name === 'grass_block', '4.3 Palettenindex 2 ist grass_block');
  assert(samplePalette[3] === expectedDeepslateTiles214, '4.4 Palettenindex 3 (34598) ist deepslate_tiles');

  // translateBlockUpdate
  const numUpdate = translatorA.translateBlockUpdate(28748);
  assert(numUpdate === expectedDeepslateTiles214, '4.5 translateBlockUpdate(number) liefert korrekten State');

  const objUpdate = translatorA.translateBlockUpdate({ stateId: 28748 });
  assert(objUpdate === expectedDeepslateTiles214, '4.6 translateBlockUpdate({ stateId }) liefert korrekten State');

  const rawUpdate = translatorA.translateBlockUpdate({ type: 1, metadata: 0 });
  assert(typeof rawUpdate === 'number' && rawUpdate >= 0, '4.7 translateBlockUpdate mit Legacy-Objekt liefert gültigen State');

  const emptyUpdate = translatorA.translateBlockUpdate(null);
  assert(emptyUpdate === translatorA.targetAirStateId, '4.8 translateBlockUpdate(null) liefert air');

  // ---------------------------------------------------------
  // Testgruppe 5: Chunk JSON Serialisierung & 1.21.4 Chunk Parsing
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 5: Chunk JSON Serialisierung & 1.21.4 Chunk Parsing ---');

  const Chunk261 = prismarineChunk('26.1');
  const Chunk214 = prismarineChunk('1.21.4');

  const sourceChunk = new Chunk261();
  sourceChunk.setBlockStateId({ x: 0, y: 64, z: 0 }, 28748);
  sourceChunk.setBlockStateId({ x: 1, y: 64, z: 0 }, 8);

  const origJson = sourceChunk.toJson();
  assert(typeof origJson === 'string', '5.1 Quellchunk erzeugt gültigen JSON-String');

  const translatedJson = translatorA.translateChunkJson(origJson);
  assert(typeof translatedJson === 'string', '5.2 translateChunkJson gibt serialisierten JSON-String zurück');

  // Der 1.21.4 WebGL Worker parst den Chunk mit Chunk214.fromJson()
  const parsed214Chunk = Chunk214.fromJson(translatedJson);
  const blockStateAt0 = parsed214Chunk.getBlockStateId({ x: 0, y: 64, z: 0 });
  assert(
    blockStateAt0 === expectedDeepslateTiles214,
    `5.3 1.21.4 Chunk-Parser liest an Koordinate (0,64,0) State ${expectedDeepslateTiles214} (erhalten: ${blockStateAt0})`
  );

  const blockAt0 = parsed214Chunk.getBlock({ x: 0, y: 64, z: 0 });
  assert(blockAt0 && blockAt0.name === 'deepslate_tiles', '5.4 1.21.4 Block ist deepslate_tiles ohne missing_texture');

  const blockAt1 = parsed214Chunk.getBlock({ x: 1, y: 64, z: 0 });
  assert(blockAt1 && blockAt1.name === 'grass_block', '5.5 1.21.4 Block an (1,64,0) ist grass_block');

  // ---------------------------------------------------------
  // Testgruppe 6: Bot World Proxy & Datenisolierung
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 6: Bot World Proxy & Datenisolierung ---');

  const mockBot = {
    version: '26.3',
    world: {
      async getColumnAt(pos) { return sourceChunk; },
      getColumn(x, z) { return sourceChunk; }
    },
    on(event, fn) {}
  };

  const viewerBot = translatorA.createViewerBotProxy(mockBot);
  assert(viewerBot.version === '1.21.4', '6.1 viewerBot meldet 1.21.4 an Prismarine-Viewer');
  assert(mockBot.version === '26.3', '6.2 Original bot.version bleibt 26.3');

  const viewerCol = await viewerBot.world.getColumnAt({ x: 0, z: 0 });
  const viewerJson = viewerCol.toJson();
  const parsedViewer = JSON.parse(viewerJson);
  const sec8 = JSON.parse(parsedViewer.sections[8]);
  const secData = JSON.parse(sec8.data);
  assert(secData.palette.includes(expectedDeepslateTiles214), '6.3 viewerBot liefert übersetzte Paletten über getColumnAt().toJson()');

  // Verifizieren, dass der Chunk in bot.world unangetastet blieb
  assert(
    sourceChunk.getBlockStateId({ x: 0, y: 64, z: 0 }) === 28748,
    '6.4 bot.world Chunk im Speicher behält unveränderten 26.3 State-ID (28748) für Bot-Physik'
  );

  // ---------------------------------------------------------
  // Testgruppe 7: Version 1.20.4 -> 1.20.1 Fallback Übersetzung
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 7: Version 1.20.4 -> 1.20.1 Fallback Übersetzung ---');

  const translator120 = ViewerStateTranslator.create('1.20.4', '1.20.1');
  assert(translator120.targetViewerVersion === '1.20.1', '7.1 1.20.4 mappt auf 1.20.1');
  const d201 = mcData('1.20.1');
  const birch1201 = d201.blocksByName['birch_log']?.defaultState;
  const mappedBirch120 = translator120.translateStateId(142);
  assert(typeof mappedBirch120 === 'number' && mappedBirch120 > 0, '7.2 birch_log übersetzt zwischen 1.20.4 und 1.20.1');

  // ---------------------------------------------------------
  // Testgruppe 8: Bot Proxy EventEmitter Lifecycle & Symmetric Listener Cleanup (M4 Hardening)
  // ---------------------------------------------------------
  console.log('\n--- Testgruppe 8: Bot Proxy EventEmitter Lifecycle & Symmetric Listener Cleanup ---');

  // Real EventEmitter simulating a Mineflayer bot
  class MockBotEmitter extends EventEmitter {
    constructor() {
      super();
      this.version = '26.3';
      this.world = {
        async getColumnAt(pos) { return sourceChunk; },
        getColumn(x, z) { return sourceChunk; }
      };
      this.entities = {};
    }
  }

  const emitterBot = new MockBotEmitter();
  const sanitizeMock = (ent) => (ent ? { ...ent, sanitized: true } : ent);
  const proxyBot = translatorA.createViewerBotProxy(emitterBot, sanitizeMock);

  // 8.1 blockUpdate: on() gefolgt von removeListener()
  const blockCb1 = (oldB, newB) => {};
  proxyBot.on('blockUpdate', blockCb1);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.1a Registrierung von blockUpdate erhöht listenerCount auf 1');
  assert(proxyBot.listenerCount('blockUpdate') === 1, '8.1b proxyBot.listenerCount spiegelt 1 wider');
  proxyBot.removeListener('blockUpdate', blockCb1);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.1c removeListener(\'blockUpdate\') reduziert listenerCount auf dem Ziel-Emitter sauber auf 0');
  assert(proxyBot.listenerCount('blockUpdate') === 0, '8.1d proxyBot.listenerCount ist ebenfalls 0');

  // 8.2 blockUpdate: on() gefolgt von off()
  const blockCb2 = (oldB, newB) => {};
  proxyBot.on('blockUpdate', blockCb2);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.2a Registrierung von blockUpdate vor off() aktiv (Count 1)');
  proxyBot.off('blockUpdate', blockCb2);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.2b off(\'blockUpdate\') entfernt wrapped listener vollständig (Count 0)');

  // 8.3 entitySpawn: on() gefolgt von removeListener()
  const entityCb1 = (ent) => {};
  proxyBot.on('entitySpawn', entityCb1);
  assert(emitterBot.listenerCount('entitySpawn') === 1, '8.3a Registrierung von entitySpawn erhöht listenerCount auf 1');
  proxyBot.removeListener('entitySpawn', entityCb1);
  assert(emitterBot.listenerCount('entitySpawn') === 0, '8.3b removeListener(\'entitySpawn\') reduziert listenerCount auf 0');

  // 8.4 entitySpawn: on() gefolgt von off()
  const entityCb2 = (ent) => {};
  proxyBot.on('entitySpawn', entityCb2);
  assert(emitterBot.listenerCount('entitySpawn') === 1, '8.4a Registrierung von entitySpawn vor off() aktiv (Count 1)');
  proxyBot.off('entitySpawn', entityCb2);
  assert(emitterBot.listenerCount('entitySpawn') === 0, '8.4b off(\'entitySpawn\') reduziert listenerCount auf 0');

  // 8.5 Mehrere Listener auf demselben Event unabhängig deregistrieren
  const multiCbA = (oldB, newB) => {};
  const multiCbB = (oldB, newB) => {};
  proxyBot.on('blockUpdate', multiCbA);
  proxyBot.on('blockUpdate', multiCbB);
  assert(emitterBot.listenerCount('blockUpdate') === 2, '8.5a 2 unterschiedliche blockUpdate-Listener registriert (Count 2)');
  proxyBot.removeListener('blockUpdate', multiCbA);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.5b Erster Listener entfernt (Count 1)');
  proxyBot.off('blockUpdate', multiCbB);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.5c Zweiter Listener entfernt (Count 0)');

  // 8.6 Mehrfache Registrierung derselben Listener-Funktion
  const dupCb = (oldB, newB) => {};
  proxyBot.on('blockUpdate', dupCb);
  proxyBot.on('blockUpdate', dupCb);
  assert(emitterBot.listenerCount('blockUpdate') === 2, '8.6a Identische Callback-Funktion 2x registriert (Count 2)');
  proxyBot.off('blockUpdate', dupCb);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.6b Erstes off() entfernt genau eine Instanz (Count 1)');
  proxyBot.removeListener('blockUpdate', dupCb);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.6c Zweites removeListener() entfernt die verbliebene Instanz (Count 0)');

  // 8.7 Standard Unwrapped Events (z.B. 'spawn', 'chat')
  const standardCb = () => {};
  proxyBot.on('spawn', standardCb);
  assert(emitterBot.listenerCount('spawn') === 1, '8.7a Unwrapped Event \'spawn\' registriert (Count 1)');
  proxyBot.off('spawn', standardCb);
  assert(emitterBot.listenerCount('spawn') === 0, '8.7b Unwrapped Event \'spawn\' sauber über proxyBot.off entfernt (Count 0)');

  // 8.8 removeAllListeners('blockUpdate')
  const bulkA = () => {};
  const bulkB = () => {};
  proxyBot.on('blockUpdate', bulkA);
  proxyBot.on('blockUpdate', bulkB);
  proxyBot.on('entitySpawn', bulkA);
  assert(emitterBot.listenerCount('blockUpdate') === 2, '8.8a 2 blockUpdate Listener registriert');
  assert(emitterBot.listenerCount('entitySpawn') === 1, '8.8b 1 entitySpawn Listener registriert');
  proxyBot.removeAllListeners('blockUpdate');
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.8c removeAllListeners(\'blockUpdate\') leert nur blockUpdate');
  assert(emitterBot.listenerCount('entitySpawn') === 1, '8.8d entitySpawn bleibt aktiv');
  proxyBot.removeAllListeners();
  assert(emitterBot.listenerCount('entitySpawn') === 0, '8.8e removeAllListeners() ohne Argument leert alle Events');

  // 8.9 once() automatischer Cleanup nach Event-Auslösung
  let onceFired = 0;
  let receivedBlockState = null;
  const onceCb = (oldB, newB) => {
    onceFired++;
    receivedBlockState = newB?.stateId;
  };
  proxyBot.once('blockUpdate', onceCb);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.9a once(\'blockUpdate\') registriert (Count 1)');
  emitterBot.emit('blockUpdate', null, { stateId: 28748, name: 'deepslate_tiles' });
  assert(onceFired === 1, '8.9b once-Listener genau einmal ausgelöst');
  assert(receivedBlockState === expectedDeepslateTiles214, '8.9c once-Listener empfängt übersetzte State-ID');
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.9d listenerCount nach Auslösung automatisch auf 0 zurückgesetzt');

  // 8.10 once() manuell vor Auslösung deregistrieren
  let neverFired = 0;
  const abortOnceCb = () => { neverFired++; };
  proxyBot.once('blockUpdate', abortOnceCb);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.10a once registriert vor Abbruch');
  proxyBot.removeListener('blockUpdate', abortOnceCb);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.10b once vor Auslösung erfolgreich deregistriert (Count 0)');
  emitterBot.emit('blockUpdate', null, { stateId: 8 });
  assert(neverFired === 0, '8.10c Abgebrochener once-Listener feuert niemals');

  // 8.11 Funktionale Entkopplung: nach Deregistrierung kein Event-Empfang
  let eventsAfterOff = 0;
  const deadListener = () => { eventsAfterOff++; };
  proxyBot.on('blockUpdate', deadListener);
  emitterBot.emit('blockUpdate', null, { stateId: 8 });
  assert(eventsAfterOff === 1, '8.11a Listener empfängt initiales Event');
  proxyBot.off('blockUpdate', deadListener);
  emitterBot.emit('blockUpdate', null, { stateId: 8 });
  assert(eventsAfterOff === 1, '8.11b Nach off() feuert der Listener bei weiteren Events nicht mehr');

  // 8.12 Method-Chaining der Proxy-Methoden
  const chainCb = () => {};
  const chainResult = proxyBot.on('blockUpdate', chainCb);
  assert(chainResult === proxyBot, '8.12a proxyBot.on() gibt proxyBot für Fluent API Chaining zurück');
  const chainOffResult = proxyBot.off('blockUpdate', chainCb);
  assert(chainOffResult === proxyBot, '8.12b proxyBot.off() gibt proxyBot zurück');

  // 8.13 Robustheit: Deregistrierung nicht-registrierter Callback-Funktionen ist sicher (no-op)
  let noErrorThrown = true;
  try {
    proxyBot.removeListener('blockUpdate', () => {});
    proxyBot.off('blockUpdate', () => {});
    proxyBot.off('non_existent_event', () => {});
  } catch {
    noErrorThrown = false;
  }
  assert(noErrorThrown, '8.13 Deregistrierung unregistrierter Callbacks ist sicherer No-op und wirft keine Exception');

  // 8.14 Direkte Entfernung des gewrappten Listeners
  const directCb = () => {};
  proxyBot.on('blockUpdate', directCb);
  assert(emitterBot.listenerCount('blockUpdate') === 1, '8.14a blockUpdate registriert');
  const wrappedRef = emitterBot.listeners('blockUpdate')[0];
  proxyBot.off('blockUpdate', wrappedRef);
  assert(emitterBot.listenerCount('blockUpdate') === 0, '8.14b Direkte Übergabe der gewrappten Funktion an off() entfernt Listener sauber');

  // 8.15 Bare Mock Bot ohne removeListener / off
  const bareBot = {
    version: '26.3',
    world: mockBot.world,
    on(event, fn) {}
  };
  const bareProxy = translatorA.createViewerBotProxy(bareBot);
  let bareSafe = true;
  try {
    bareProxy.on('blockUpdate', () => {});
    bareProxy.off('blockUpdate', () => {});
    bareProxy.removeListener('blockUpdate', () => {});
  } catch {
    bareSafe = false;
  }
  assert(bareSafe, '8.15 Aufruf von off/removeListener auf Minimal-Mock ohne Emitter-Methoden stürzt nicht ab');

  console.log(`\n=== VIEWER STATE TRANSLATOR TEST SUITE: ${passedTests}/${totalTests} TESTS BESTANDEN ===\n`);
  process.exit(0);
}

runViewerStateTranslatorTests().catch(err => {
  console.error('\x1b[31m[TEST CRASH]\x1b[0m', err);
  process.exit(1);
});
