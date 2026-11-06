/**
 * Empirical Challenger Adversarial Test Suite for Milestone 1
 * (3D Viewer State-ID Translation & Asset Alignment)
 *
 * Exhaustively stress-tests:
 * 1. High State-IDs (28748, 28774, 28324, 34598, 34682, 33772, 35718/35719 eyeblossom, pale oak)
 * 2. Out-of-bounds and invalid State-IDs (-1, 999999, NaN, Infinity, null, objects, symbols)
 * 3. Palette translation (single, indirect, empty, large, stringified, corrupted JSON)
 * 4. Bidirectional checks & air (state 0) preservation across version pairs
 * 5. Bot.world data isolation & proxy idempotence
 * 6. Throughput & latency stress harness (1,000,000 ops + 1,000 chunks)
 */

import { VersionResolver } from '../src/config/versionResolver.js';
import { ViewerStateTranslator } from '../src/web/services/viewerStateTranslator.js';
import { createRequire } from 'module';
import { performance } from 'perf_hooks';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const prismarineChunk = require('prismarine-chunk');

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[CHALLENGE FAIL]\x1b[0m ${message}`);
    throw new Error(`Adversarial test failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

async function runAdversarialViewerStateTranslatorTests() {
  VersionResolver.applyCompatibilityShims();
  console.log('=== STARTING ADVERSARIAL VIEWER STATE TRANSLATOR STRESS SUITE ===\n');

  const translator263 = ViewerStateTranslator.create('26.3', '1.21.4');
  const d214 = mcData('1.21.4');
  const max1214 = translator263.targetMaxStateId;
  const targetAir = translator263.targetAirStateId;

  // --------------------------------------------------------------------------
  // Testgruppe 1: High State-IDs & Protocol 777 SOTA Alignment
  // --------------------------------------------------------------------------
  console.log('--- Testgruppe 1: High State-IDs & Protocol 777 SOTA Alignment ---');

  // 1.1 deepslate_tiles: 28748 (26.1 / Protocol 777 server chunks)
  const mapped28748 = translator263.translateStateId(28748);
  const deepslateTilesDefault = d214.blocksByName['deepslate_tiles'].defaultState;
  assert(
    mapped28748 === deepslateTilesDefault,
    `1.1 State 28748 mappt auf 1.21.4 deepslate_tiles (${deepslateTilesDefault}), erhalten: ${mapped28748}`
  );

  // 1.2 deepslate_tiles: 34598 (26.3 custom blocks.json)
  const mapped34598 = translator263.translateStateId(34598);
  assert(
    mapped34598 === deepslateTilesDefault,
    `1.2 State 34598 mappt auf 1.21.4 deepslate_tiles (${deepslateTilesDefault}), erhalten: ${mapped34598}`
  );

  // 1.3 deepslate_tile_slab: 34682 in 26.3 -> 26826 in 1.21.4
  const mappedSlab263 = translator263.translateStateId(34682);
  const expectedSlab214 = d214.blocksByName['deepslate_tile_slab'].defaultState;
  assert(
    mappedSlab263 === expectedSlab214,
    `1.3 26.3 deepslate_tile_slab (34682) mappt exakt auf 1.21.4 deepslate_tile_slab (${expectedSlab214}), erhalten: ${mappedSlab263}`
  );

  // 1.4 mud: 33772 in 26.3 -> 25916 in 1.21.4
  const mappedMud263 = translator263.translateStateId(33772);
  const expectedMud214 = d214.blocksByName['mud'].defaultState;
  assert(
    mappedMud263 === expectedMud214,
    `1.4 26.3 mud (33772) mappt exakt auf 1.21.4 mud (${expectedMud214}), erhalten: ${mappedMud263}`
  );

  // 1.5 open_eyeblossom: 35718 in 26.3 -> 27862 in 1.21.4
  const mappedOpenEyeblossom = translator263.translateStateId(35718);
  const expectedOpenEyeblossom = d214.blocksByName['open_eyeblossom'].defaultState;
  assert(
    mappedOpenEyeblossom === expectedOpenEyeblossom,
    `1.5 26.3 open_eyeblossom (35718) mappt auf 1.21.4 open_eyeblossom (${expectedOpenEyeblossom}), erhalten: ${mappedOpenEyeblossom}`
  );

  // 1.6 closed_eyeblossom: 35719 in 26.3 -> 27863 in 1.21.4
  const mappedClosedEyeblossom = translator263.translateStateId(35719);
  const expectedClosedEyeblossom = d214.blocksByName['closed_eyeblossom'].defaultState;
  assert(
    mappedClosedEyeblossom === expectedClosedEyeblossom,
    `1.6 26.3 closed_eyeblossom (35719) mappt auf 1.21.4 closed_eyeblossom (${expectedClosedEyeblossom}), erhalten: ${mappedClosedEyeblossom}`
  );

  // 1.7 26.1 Mud & Slabs (wenn Quellversion 26.1 ist)
  const translator261 = ViewerStateTranslator.create('26.1', '1.21.4');
  const mappedMud261 = translator261.translateStateId(27922);
  assert(
    mappedMud261 === expectedMud214,
    `1.7 26.1 mud (27922) mappt in 26.1-Translator auf 1.21.4 mud (${expectedMud214}), erhalten: ${mappedMud261}`
  );
  const mappedSlab261 = translator261.translateStateId(28832);
  assert(
    mappedSlab261 === expectedSlab214,
    `1.8 26.1 deepslate_tile_slab (28832) mappt in 26.1-Translator auf 1.21.4 slab (${expectedSlab214}), erhalten: ${mappedSlab261}`
  );

  // 1.9 High State-IDs: 28774 & 28324
  const mapped28774 = translator263.translateStateId(28774);
  assert(
    typeof mapped28774 === 'number' && mapped28774 >= 0 && mapped28774 <= max1214,
    `1.9 State-ID 28774 übersetzt sicher innerhalb 1.21.4 Grenze [0, ${max1214}]: erhalten ${mapped28774}`
  );
  const mapped28324 = translator263.translateStateId(28324);
  assert(
    typeof mapped28324 === 'number' && mapped28324 >= 0 && mapped28324 <= max1214,
    `1.10 State-ID 28324 übersetzt sicher innerhalb 1.21.4 Grenze [0, ${max1214}]: erhalten ${mapped28324}`
  );

  // --------------------------------------------------------------------------
  // Testgruppe 2: Out-of-bounds, Non-numeric, Corrupted & Extreme Boundary Inputs
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 2: Out-of-bounds & Extreme Boundary Inputs ---');

  // Test valid high source state (27866 in 26.3 is tuff_brick_wall -> translates to 23151 in 1.21.4)
  const mapped27866 = translator263.translateStateId(27866);
  assert(
    mapped27866 === 23151,
    `2.0 Source State 27866 (tuff_brick_wall in 26.3) übersetzt valide zu 1.21.4 State 23151 (${d214.blocksByStateId[23151]?.name}), erhalten: ${mapped27866}`
  );

  const adversarialInputs = [
    { val: -1, desc: 'Negative -1' },
    { val: -999999, desc: 'Große negative Zahl -999999' },
    { val: 999999, desc: 'Sehr große positive Zahl 999999' },
    { val: 36000, desc: 'Grenzfall über 26.3 maxStateId (36000)' },
    { val: 42000, desc: 'Tabellengrenze 42000' },
    { val: 100000, desc: 'Weit über Tabellengrenze 100000' },
    { val: NaN, desc: 'NaN' },
    { val: Infinity, desc: 'Infinity' },
    { val: -Infinity, desc: '-Infinity' },
    { val: null, desc: 'null' },
    { val: undefined, desc: 'undefined' },
    { val: '28748', desc: 'String "28748"' },
    { val: 'garbage', desc: 'String "garbage"' },
    { val: {}, desc: 'Leeres Objekt {}' },
    { val: [], desc: 'Leeres Array []' },
    { val: Symbol('sym'), desc: 'Symbol' },
    { val: true, desc: 'Boolean true' },
    { val: false, desc: 'Boolean false' },
    { val: Number.MAX_SAFE_INTEGER, desc: 'Number.MAX_SAFE_INTEGER' },
    { val: Number.MIN_SAFE_INTEGER, desc: 'Number.MIN_SAFE_INTEGER' }
  ];

  for (const { val, desc } of adversarialInputs) {
    const res = translator263.translateStateId(val);
    assert(
      res === targetAir,
      `2.x ${desc} -> fällt robust auf targetAirStateId (${targetAir}) zurück (erhalten: ${res})`
    );
  }

  // Fractional floats
  const floatMapped = translator263.translateStateId(8.7);
  assert(
    floatMapped === translator263.translateStateId(8),
    `2.21 Float 8.7 wird per Math.floor robust auf State 8 abgebildet`
  );

  // --------------------------------------------------------------------------
  // Testgruppe 3: Palette Translation Variations & Chunk JSON Parsing
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 3: Palette Translation Variations & Chunk JSON ---');

  // 3.1 Single Palette Container
  const singleContainer = {
    sections: [
      { data: { type: 'single', value: 28748 } }
    ]
  };
  const resSingle = translator263.translateChunkJson(singleContainer);
  assert(
    resSingle.sections[0].data.value === deepslateTilesDefault,
    `3.1 Single Container value 28748 übersetzt zu ${deepslateTilesDefault}`
  );

  // 3.2 Single Palette mit Out-of-bounds Wert
  const singleOOB = {
    sections: [
      { data: { type: 'single', value: 999999 } }
    ]
  };
  const resSingleOOB = translator263.translateChunkJson(singleOOB);
  assert(
    resSingleOOB.sections[0].data.value === targetAir,
    `3.2 Single Container OOB 999999 fällt auf targetAirStateId (${targetAir})`
  );

  // 3.3 Indirect Palette Container (Standardfall)
  const indirectContainer = {
    sections: [
      { data: { type: 'indirect', palette: [0, 28748, 35718, 34682, 33772] } }
    ]
  };
  const resIndirect = translator263.translateChunkJson(indirectContainer);
  const pal = resIndirect.sections[0].data.palette;
  assert(pal[0] === 0, `3.3 Air (0) bleibt 0`);
  assert(pal[1] === deepslateTilesDefault, `3.3 deepslate_tiles übersetzt zu ${deepslateTilesDefault}`);
  assert(pal[2] === expectedOpenEyeblossom, `3.3 open_eyeblossom übersetzt zu ${expectedOpenEyeblossom}`);
  assert(pal[3] === expectedSlab214, `3.3 deepslate_tile_slab übersetzt zu ${expectedSlab214}`);
  assert(pal[4] === expectedMud214, `3.3 mud übersetzt zu ${expectedMud214}`);

  // 3.4 Empty Palette
  const emptyPal = [];
  translator263.translateChunkPalette(emptyPal);
  assert(emptyPal.length === 0, '3.4 Leere Palette wirft keinen Fehler und bleibt leer');

  // 3.5 Large Palette Stress (10.000 Einträge)
  const largePalette = Array.from({ length: 10000 }, (_, i) => (i * 7) % 36000);
  translator263.translateChunkPalette(largePalette);
  const allInRange = largePalette.every(id => typeof id === 'number' && id >= 0 && id <= max1214);
  assert(allInRange, `3.5 Große Palette (10.000 Einträge) vollständig und fehlerfrei im Bereich [0, ${max1214}]`);

  // 3.6 Stringified Nested Sections
  const nestedJsonStr = JSON.stringify({
    sections: [
      JSON.stringify({
        data: JSON.stringify({
          type: 'indirect',
          palette: [28748, 35718]
        })
      })
    ]
  });
  const resNested = JSON.parse(translator263.translateChunkJson(nestedJsonStr));
  const innerSection = JSON.parse(resNested.sections[0]);
  const innerData = JSON.parse(innerSection.data);
  assert(
    innerData.palette[0] === deepslateTilesDefault && innerData.palette[1] === expectedOpenEyeblossom,
    '3.6 Mehrfach-serialisiertes (stringified) Section-JSON wird fehlerfrei de-/re-serialisiert'
  );

  // 3.7 Corrupted / Malformed JSON Inputs
  assert(
    translator263.translateChunkJson('{ bad json') === '{ bad json',
    '3.7 Syntaxfehler im JSON-String wird ohne Crash unverändert zurückgegeben'
  );
  assert(
    translator263.translateChunkJson(null) === null,
    '3.8 null Chunk JSON liefert null ohne Crash'
  );
  assert(
    translator263.translateChunkJson(undefined) === undefined,
    '3.9 undefined Chunk JSON liefert undefined ohne Crash'
  );

  // --------------------------------------------------------------------------
  // Testgruppe 4: Bidirectional Checks & Air (State 0) Preservation
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 4: Bidirectional Checks & Air Preservation ---');

  const versionPairs = [
    ['26.3', '1.21.4'],
    ['1.20.4', '1.20.1'],
    ['1.21.1', '1.21.1'],
    ['1.21.4', '1.21.4'],
    ['26.1', '1.21.4'],
    ['1.19.4', '1.19'],
    ['1.16.5', '1.16.4'],
    ['1.12.2', '1.12.2']
  ];

  for (const [sVer, tVer] of versionPairs) {
    const t = ViewerStateTranslator.create(sVer, tVer);
    const mappedAir = t.translateStateId(0);
    assert(
      mappedAir === 0,
      `4.1 Air (State 0) bleibt strikt 0 bei Übersetzung ${sVer} -> ${tVer}`
    );
    assert(
      t.targetAirStateId === 0,
      `4.2 targetAirStateId ist 0 für Zielversion ${tVer}`
    );
  }

  // --------------------------------------------------------------------------
  // Testgruppe 5: Bot World Proxy & Data Isolation
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 5: Bot World Proxy & Data Isolation ---');

  const Chunk261 = prismarineChunk('26.1');
  const rawChunk = new Chunk261();
  rawChunk.setBlockStateId({ x: 0, y: 64, z: 0 }, 28748);
  rawChunk.setBlockStateId({ x: 1, y: 64, z: 0 }, 8);

  const mockBot = {
    version: '26.3',
    world: {
      async getColumnAt(pos) { return rawChunk; },
      getColumn(x, z) { return rawChunk; }
    },
    on: () => {}
  };

  const viewerBot = translator263.createViewerBotProxy(mockBot);

  // Test wrapping idempotence
  const wrappedCol1 = await viewerBot.world.getColumnAt({ x: 0, z: 0 });
  const wrappedCol2 = translator263.wrapChunkColumn(wrappedCol1);
  assert(wrappedCol1 === wrappedCol2, '5.1 wrapChunkColumn ist idempotent (kein Doppel-Proxy)');

  // Test that calling toJson() multiple times produces valid translated json
  const jsonA = wrappedCol1.toJson();
  const jsonB = wrappedCol1.toJson();
  assert(typeof jsonA === 'string' && jsonA === jsonB, '5.2 Mehrmaliger Aufruf von column.toJson() liefert identisches Ergebnis');

  // Verify rawChunk remains 100% untouched
  assert(
    rawChunk.getBlockStateId({ x: 0, y: 64, z: 0 }) === 28748,
    '5.3 Quell-Chunk im In-Memory Speicher behält unmodifizierten 26.3 State-ID (28748)'
  );

  // --------------------------------------------------------------------------
  // Testgruppe 6: Performance & Latency Stress Harness
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 6: Performance & Latency Stress Harness ---');

  // 6.1 Throughput: 1,000,000 translateStateId operations
  const startLookup = performance.now();
  let checksum = 0;
  for (let i = 0; i < 1000000; i++) {
    checksum += translator263.translateStateId(i % 36000);
  }
  const durLookup = performance.now() - startLookup;
  const opsPerSec = Math.round(1000000 / (durLookup / 1000));
  assert(
    durLookup < 500, // less than 500ms for 1M operations
    `6.1 1.000.000 Lookups in ${durLookup.toFixed(2)}ms abgeschlossen (${opsPerSec.toLocaleString()} ops/sec > 2.000.000 ops/sec Ziel)`
  );
  assert(checksum > 0, '6.2 Checksumme ist positiv');

  // 6.2 Chunk Translation Throughput: 1,000 Full Chunk Column JSONs
  const mockSections = Array.from({ length: 16 }, () => ({
    data: {
      type: 'indirect',
      palette: [0, 8, 28748, 35718, 34682, 33772, 142, 146]
    }
  }));

  const startChunks = performance.now();
  for (let i = 0; i < 1000; i++) {
    // Clone palette array to test translation on each iteration
    const chunkData = {
      sections: mockSections.map(s => ({
        data: { type: 'indirect', palette: [...s.data.palette] }
      }))
    };
    translator263.translateChunkJson(chunkData);
  }
  const durChunks = performance.now() - startChunks;
  const msPerChunk = durChunks / 1000;
  assert(
    msPerChunk < 0.5,
    `6.3 1.000 Chunk-Transformationen in ${durChunks.toFixed(2)}ms (${msPerChunk.toFixed(3)}ms pro Chunk-Column, Ziel < 0.5ms)`
  );

  // --------------------------------------------------------------------------
  // Testgruppe 7: VersionResolver Shims & Viewer Version Resolution
  // --------------------------------------------------------------------------
  console.log('\n--- Testgruppe 7: VersionResolver Resolution ---');

  assert(VersionResolver.resolveViewerVersion('26.3') === '1.21.4', '7.1 26.3 -> 1.21.4');
  assert(VersionResolver.resolveViewerVersion('26.1') === '1.21.4', '7.2 26.1 -> 1.21.4');
  assert(VersionResolver.resolveViewerVersion('777') === '1.21.4', '7.3 777 -> 1.21.4');
  assert(VersionResolver.resolveViewerVersion('1.20.4') === '1.20.1', '7.4 1.20.4 -> 1.20.1');
  assert(VersionResolver.resolveViewerVersion('1.21.1') === '1.21.1', '7.5 1.21.1 -> 1.21.1');
  assert(VersionResolver.resolveViewerVersion('1.18.2') === '1.18.1', '7.6 1.18.2 -> 1.18.1');
  assert(VersionResolver.resolveViewerVersion(null) === '1.21.4', '7.7 null -> 1.21.4');
  assert(VersionResolver.resolveViewerVersion(undefined) === '1.21.4', '7.8 undefined -> 1.21.4');
  assert(VersionResolver.resolveViewerVersion('unknown') === '1.21.4', '7.9 unknown -> 1.21.4');

  console.log(`\n=== ADVERSARIAL STRESS SUITE RESULT: ${passedTests}/${totalTests} TESTS BESTANDEN ===\n`);
  process.exit(0);
}

runAdversarialViewerStateTranslatorTests().catch(err => {
  console.error('\x1b[31m[ADVERSARIAL SUITE CRASHED]\x1b[0m', err);
  process.exit(1);
});
