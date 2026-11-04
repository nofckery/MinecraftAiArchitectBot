/**
 * Vollständige Offline-Testsuite für Geometrie, Rotation, Linter und Meshing
 * Kann komplett ohne laufenden Minecraft-Server ausgeführt werden.
 */

import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { ArchPrimitives } from '../src/builder/archPrimitives.js';
import { StructuralLinter } from '../src/builder/structuralLinter.js';
import { rotateLocalToWorld, autoStitchStairs, CARDINAL_DIRECTIONS, mirrorProperties, rotateProperties } from '../src/builder/stateTransform.js';
import { hash3D, valueNoise3D } from '../src/utils/noise.js';
import { llmRouter } from '../src/ai/llmRouter.js';
import zlib from 'node:zlib';
import nbt from 'prismarine-nbt';
import { schematicManager } from '../src/builder/schematicManager.js';

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

function buildMedievalTavern(width = 16, height = 24, depth = 16) {
  const canvas = new VoxelCanvas(width, height, depth);
  const arch = new ArchPrimitives(canvas);

  // 1. Fundamentsockel (y = 0)
  arch.foundation(0, 0, 10, 10, 1, 'stone_bricks');

  // 2. Erdgeschoss: Gerahmter Steinraum (y = 0 bis 4)
  arch.framedRoom(0, 0, 0, 10, 4, 10, {
    pillarBlock: 'spruce_log[axis=y]',
    wallPalette: 'stone_bricks',
    floorPalette: 'cobblestone',
    ceilingPalette: 'spruce_planks',
    inset: 1
  });

  // 3. Eingangstür an der Nordwand (z = 0)
  arch.doorway(5, 1, 0, 'north', {
    doorBlock: 'oak_door',
    pillarBlock: 'stone_bricks',
    stepBlock: 'stone_brick_slab'
  });

  // 4. Fenster mit Fensterläden und Blumenbrett im EG
  arch.windowWithDetail(2, 2, 0, 1, 1, 'north', { glassBlock: 'glass_pane', flower: 'poppy' });
  arch.windowWithDetail(8, 2, 0, 1, 1, 'north', { glassBlock: 'glass_pane', flower: 'cornflower' });

  // 5. Obergeschoss mit Vorkragung (Jetty Floor) (y = 5 bis 9)
  arch.jettyFloor(0, 5, 0, 10, 9, 10, {
    overhang: 1,
    pillarBlock: 'spruce_log[axis=y]',
    wallPalette: 'white_terracotta',
    floorPalette: 'spruce_planks',
    ceilingPalette: 'spruce_planks',
    inset: 1
  });

  // 6. Fenster im Obergeschoss
  arch.windowWithDetail(3, 6, -1, 1, 1, 'north', { glassBlock: 'glass_pane', flower: 'dandelion' });
  arch.windowWithDetail(7, 6, -1, 1, 1, 'north', { glassBlock: 'glass_pane', flower: 'fern' });

  // 7. Satteldach mit Überhang und Giebeldreieck (y = 10)
  arch.gableRoof(-1, 10, -1, 11, 11, {
    axis: 'x',
    stairBlock: 'spruce_stairs',
    trimStairBlock: 'stone_brick_stairs',
    ridgeSlabBlock: 'stone_brick_slab',
    gablePalette: 'white_terracotta'
  });

  // 8. Runder Turm an der Ecke (cx = 12, cz = 12, Radius = 2, Höhe = 13)
  arch.cylindricalTower(12, 0, 12, 2, 13, {
    wallPalette: 'stone_bricks',
    centerPillar: 'spruce_log[axis=y]',
    crenellations: true
  });

  // 9. Konisches Turmdach auf dem Turm (y = 14)
  arch.conicalTowerRoof(12, 14, 12, 2, 4, {
    stairBlock: 'dark_oak_stairs',
    slabBlock: 'dark_oak_slab',
    tipBlock: 'lightning_rod'
  });

  // 10. Kamin & Schornstein mit Feuerstelle und Rauchabzug
  arch.chimney(9, 1, 3, 16, 'bricks');

  // 11. Prozedurale Inneneinrichtung
  arch.furnishInterior(0, 1, 0, 10, 10, 'tavern');
  arch.furnishInterior(-1, 6, -1, 11, 11, 'bedroom');

  // Multi-Blocks abschließen und Treppen automatisch verbinden
  canvas.finalizeMultiBlocks();
  autoStitchStairs(canvas);

  return canvas;
}

async function runTests() {
  console.log('\x1b[35m=== STARTING ARCHITECT BOT OFFLINE TEST SUITE ===\x1b[0m\n');

  // TEST 1: Deterministischer Noise
  console.log('--- Testgruppe 1: Deterministischer Noise ---');
  const h1 = hash3D(10, 20, 30, 42);
  const h2 = hash3D(10, 20, 30, 42);
  const h3 = hash3D(10, 20, 31, 42);
  assert(h1 === h2, 'hash3D liefert für gleiche Parameter identische Floats');
  assert(h1 !== h3, 'hash3D ändert sich bei veränderten Koordinaten');
  assert(h1 >= 0 && h1 < 1, 'hash3D liegt strikt im Intervall [0, 1)');

  const n1 = valueNoise3D(5.5, 10.2, 3.1);
  const n2 = valueNoise3D(5.5, 10.2, 3.1);
  assert(n1 === n2, 'valueNoise3D ist deterministisch');
  assert(n1 >= 0 && n1 <= 1, 'valueNoise3D liegt im Intervall [0, 1]');

  // TEST 2: Gebäude-Generierung (Taverne)
  console.log('\n--- Testgruppe 2: Tavernen-Generierung ---');
  const tavern = buildMedievalTavern();
  const bounds = tavern.getBounds();
  assert(bounds.count > 300, `Taverne wurde erfolgreich mit ${bounds.count} Blöcken gebaut`);
  assert(tavern.validationErrors.length === 0, `Keine Block-Validierungsfehler beim Bau (Fehler: ${tavern.validationErrors.join(', ')})`);

  // TEST 3: Structural Linter auf Basis-Bauwerk
  console.log('\n--- Testgruppe 3: Structural Linter (Statik & Durchgang) ---');
  const lintReport = StructuralLinter.analyze(tavern);
  console.log(`Linter-Ergebnis: detailRatio=${Math.round(lintReport.detailRatio * 100)}%, floating=${lintReport.floatingBlocksCount}, doors=${lintReport.doorCount}`);
  if (lintReport.criticalErrors.length > 0) {
    console.error('Kritische Linter-Fehler:', lintReport.criticalErrors);
  }
  assert(lintReport.floatingBlocksCount === 0, `0 schwebende Blöcke gefunden (tatsächlich: ${lintReport.floatingBlocksCount})`);
  assert(lintReport.criticalErrors.length === 0, `0 kritische Linter-Fehler gefunden (Fehler: ${lintReport.criticalErrors.join(', ')})`);
  assert(lintReport.passed === true, 'Linter-Gesamttest bestanden');
  assert(lintReport.detailRatio >= 0.15, `Ästhetik-Metrik erfüllt (Detailgrad: ${Math.round(lintReport.detailRatio * 100)}% >= 15%)`);

  // TEST 4: Rotation in alle 4 Himmelsrichtungen
  console.log('\n--- Testgruppe 4: Rotation in alle 4 Himmelsrichtungen ---');
  for (const dir of CARDINAL_DIRECTIONS) {
    const rotatedCanvas = new VoxelCanvas(24, 24, 24);
    for (const key of tavern.getAllBlockKeys()) {
      const block = tavern.getByKey(key);
      const { x, y, z } = tavern.parseKey(key);
      const rot = rotateLocalToWorld(x, y, z, block, 16, 16, dir);
      rotatedCanvas.set(rot.x, rot.y, rot.z, rot.blockState);
    }
    rotatedCanvas.finalizeMultiBlocks();
    autoStitchStairs(rotatedCanvas);

    assert(
      rotatedCanvas.validationErrors.length === 0,
      `Rotation nach '${dir}': Keine Block-Validierungsfehler (Fehler: ${rotatedCanvas.validationErrors.join(', ')})`
    );

    const rotLint = StructuralLinter.analyze(rotatedCanvas);
    assert(
      rotLint.floatingBlocksCount === 0,
      `Rotation nach '${dir}': 0 schwebende Blöcke nach Transformation`
    );
    assert(
      rotLint.criticalErrors.length === 0,
      `Rotation nach '${dir}': 0 kritische Fehler (Fehler: ${rotLint.criticalErrors.join(', ')})`
    );
  }

  // TEST 5: Greedy-Meshing für /fill-Optimierung
  console.log('\n--- Testgruppe 5: Greedy-Meshing (/fill-Kompression) ---');
  const greedyBoxes = tavern.computeGreedyBoxes();
  const totalVolumeFromBoxes = greedyBoxes.reduce((acc, b) => acc + b.volume, 0);
  assert(greedyBoxes.length > 0, `Greedy-Boxes erzeugt (${greedyBoxes.length} Boxen)`);
  assert(totalVolumeFromBoxes === bounds.count, `Volumenerhaltung: ${totalVolumeFromBoxes} Box-Voxel == ${bounds.count} Canvas-Blöcke`);

  const compressionPercent = Math.round((1 - (greedyBoxes.length / bounds.count)) * 100);
  console.log(`Befehlskomprimierung durch Greedy-Meshing: von ${bounds.count} auf ${greedyBoxes.length} Befehle (-${compressionPercent}%)`);
  assert(compressionPercent >= 50, `Mindestens 50% Reduktion der Befehle erreicht (erreicht: ${compressionPercent}%)`);

  // TEST 6: Inkrementelles Diff-Building
  console.log('\n--- Testgruppe 6: Inkrementelles Diff-Building ---');
  const modifiedTavern = new VoxelCanvas(16, 24, 16);
  // Kopiere Basisblöcke
  for (const k of tavern.getAllBlockKeys()) {
    const { x, y, z } = tavern.parseKey(k);
    modifiedTavern.set(x, y, z, tavern.getByKey(k));
  }
  // Füge einen Balkon hinzu
  modifiedTavern.set(5, 5, -2, 'spruce_slab');
  modifiedTavern.set(6, 5, -2, 'spruce_slab');
  // Entferne einen Block
  modifiedTavern.set(9, 1, 3, 'air');

  const diff = VoxelCanvas.computeDiff(tavern, modifiedTavern);
  assert(diff.length === 3, `Diff-Engine erkennt exakt 3 Block-Änderungen (erkannt: ${diff.length})`);
  assert(diff.some(d => d.action === 'remove' && d.x === 9 && d.y === 1 && d.z === 3), 'Diff erkennt Blockentfernung');
  assert(diff.filter(d => d.action === 'set').length === 2, 'Diff erkennt 2 neue Blöcke');

  // TEST 7: ASCII Blueprint Generator Ausgabe
  console.log('\n--- Testgruppe 7: ASCII Blueprint Generator ---');
  const ascii = StructuralLinter.generateAsciiBlueprint(tavern);
  assert(ascii.includes('=== BLUEPRINT:'), 'Blueprint enthält Header');
  assert(ascii.includes('[GRUNDRISS AUF Y='), 'Blueprint enthält Grundriss-Schnitt');
  assert(ascii.includes('[VERTIKALER QUERSCHNITT BEI X='), 'Blueprint enthält vertikalen Querschnitt');
  assert(ascii.includes('[STÜCKLISTE (BILL OF MATERIALS)]'), 'Blueprint enthält Stückliste');

  // TEST 8: LLM Router v2.0 Multi-Provider Kaskade & Rate-Limit Logik
  console.log('\n--- Testgruppe 8: LLM Router v2.0 Multi-Provider Kaskade ---');
  assert(llmRouter.fastEndpoints.length > 0, `Fast-Endpoints konfiguriert (${llmRouter.fastEndpoints.length} Endpoints)`);
  assert(llmRouter.architectEndpoints.length > 0, `Architect-Endpoints konfiguriert (${llmRouter.architectEndpoints.length} Endpoints)`);

  const zeroKeyEndpoint = llmRouter.fastEndpoints.find(e => e.isZeroKey);
  assert(zeroKeyEndpoint !== undefined, 'Zero-Key Notfall-Gateway (Kilo AI / LLM7) ist als Sicherheitsnetz aktiv');

  // Simuliere HTTP 429 mit Retry-After Header
  const testEndpoint = llmRouter.fastEndpoints[0];
  const initialCooldown = testEndpoint.cooldownUntil;
  llmRouter.handleError(testEndpoint, {
    status: 429,
    headers: { 'retry-after': '45' }
  });
  assert(testEndpoint.cooldownUntil > initialCooldown, 'HTTP 429 setzt Cooldown-Zeitstempel');
  assert(testEndpoint.isAvailable() === false, 'Endpoint im Cooldown wird als nicht verfügbar markiert');

  // Simuliere HTTP 401 (Invalid Key)
  llmRouter.handleError(testEndpoint, { status: 401 });
  assert(testEndpoint.disabled === true, 'HTTP 401 schaltet fehlerhaften Key dauerhaft ab');

  // TEST 9: Instant Palette Swapper & Smart-Group-Erkennung
  console.log('\n--- Testgruppe 9: Instant Palette Swapper & Smart-Group-Erkennung ---');
  const canvasSwap = new VoxelCanvas(16, 16, 16);
  canvasSwap.set(0, 0, 0, 'spruce_stairs[facing=north,half=bottom,shape=straight]');
  canvasSwap.set(1, 0, 0, 'spruce_planks');
  canvasSwap.set(2, 0, 0, 'spruce_log[axis=y]');
  canvasSwap.set(3, 0, 0, 'spruce_door[facing=east,half=lower]');
  canvasSwap.set(4, 0, 0, 'stone_bricks');

  const swappedCount = canvasSwap.swapMaterial('spruce_stairs', 'dark_oak_stairs', true);
  assert(swappedCount >= 4, `SmartGroupSwap hat mindestens 4 Blöcke der Holzfamilie getauscht (tatsächlich: ${swappedCount})`);

  const stairBlock = canvasSwap.get(0, 0, 0);
  assert(stairBlock.name === 'dark_oak_stairs', `spruce_stairs wurde zu dark_oak_stairs (tatsächlich: ${stairBlock.name})`);
  assert(stairBlock.properties.facing === 'north', `facing=north wurde zu 100% beibehalten (tatsächlich: ${stairBlock.properties.facing})`);
  assert(stairBlock.properties.half === 'bottom', `half=bottom wurde zu 100% beibehalten (tatsächlich: ${stairBlock.properties.half})`);
  assert(stairBlock.properties.shape === 'straight', `shape=straight wurde zu 100% beibehalten (tatsächlich: ${stairBlock.properties.shape})`);

  const planksBlock = canvasSwap.get(1, 0, 0);
  assert(planksBlock.name === 'dark_oak_planks', `spruce_planks wurde zu dark_oak_planks (tatsächlich: ${planksBlock.name})`);

  const logBlock = canvasSwap.get(2, 0, 0);
  assert(logBlock.name === 'dark_oak_log', `spruce_log wurde zu dark_oak_log (tatsächlich: ${logBlock.name})`);
  assert(logBlock.properties.axis === 'y', 'axis=y Property wurde beibehalten');

  const doorBlock = canvasSwap.get(3, 0, 0);
  assert(doorBlock.name === 'dark_oak_door', `spruce_door wurde zu dark_oak_door (tatsächlich: ${doorBlock.name})`);
  assert(doorBlock.properties.facing === 'east' && doorBlock.properties.half === 'lower', 'Türeigenschaften erhalten');

  const stoneBlock = canvasSwap.get(4, 0, 0);
  assert(stoneBlock.name === 'stone_bricks', 'Unbeteiligte Materialien (stone_bricks) blieben unangetastet');

  // TEST 10: CAD Transformationen (Symmetrie & Rotation)
  console.log('\n--- Testgruppe 10: CAD Transformationen (Symmetrie & Rotation) ---');
  const canvasTrans = new VoxelCanvas(10, 10, 10);
  canvasTrans.set(2, 1, 3, 'oak_stairs[facing=north,half=bottom,shape=outer_left]');
  canvasTrans.set(8, 1, 3, 'oak_door[facing=east,hinge=left]');

  canvasTrans.applySymmetryOrTransform('mirror_x');
  const mStair = canvasTrans.get(8, 1, 3);
  assert(mStair !== null, 'Treppe an gespiegelter Koordinate (8, 1, 3) vorhanden');
  assert(mStair.properties.facing === 'north', 'facing=north bleibt bei Mirror-X erhalten');
  assert(mStair.properties.shape === 'outer_right', `shape wurde zu outer_right gespiegelt (tatsächlich: ${mStair.properties.shape})`);

  const mDoor = canvasTrans.get(2, 1, 3);
  assert(mDoor !== null, 'Tür an gespiegelter Koordinate (2, 1, 3) vorhanden');
  assert(mDoor.properties.facing === 'west', `facing=east wurde zu facing=west gespiegelt (tatsächlich: ${mDoor.properties.facing})`);
  assert(mDoor.properties.hinge === 'right', `hinge=left wurde zu hinge=right gespiegelt (tatsächlich: ${mDoor.properties.hinge})`);

  const canvasRot = new VoxelCanvas(6, 6, 6);
  canvasRot.set(1, 1, 1, 'oak_stairs[facing=north]');
  canvasRot.set(4, 1, 1, 'oak_planks');
  canvasRot.applySymmetryOrTransform('rotate_90_cw');
  const rStair = canvasRot.get(1, 1, 1);
  assert(rStair !== null, 'Rotierte Treppe bei (1,1,1) vorhanden');
  assert(rStair.properties.facing === 'east', `Treppe um 90° CW rotiert: north -> east (tatsächlich: ${rStair.properties.facing})`);
  const rPlanks = canvasRot.get(1, 1, 4);
  assert(rPlanks !== null && rPlanks.name === 'oak_planks', 'Rotierte Planken bei (1,1,4) vorhanden');

  // TEST 11: SubRegionProxy Bereichsschutz
  console.log('\n--- Testgruppe 11: SubRegionProxy Bereichsschutz ---');
  const canvasBase = new VoxelCanvas(20, 20, 20);
  canvasBase.set(2, 2, 2, 'stone');
  canvasBase.set(10, 2, 10, 'stone');

  const selectionBox = { minX: 4, minY: 0, minZ: 4, maxX: 8, maxY: 10, maxZ: 8 };
  const proxy = canvasBase.createSubRegionProxy(selectionBox);

  // Schreibzugriff innerhalb
  proxy.set(5, 5, 5, 'diamond_block');
  assert(canvasBase.get(5, 5, 5)?.name === 'diamond_block', 'Schreibzugriff innerhalb selectionBox war erfolgreich');

  // Schreibzugriff außerhalb
  proxy.set(2, 2, 2, 'gold_block');
  assert(canvasBase.get(2, 2, 2)?.name === 'stone', 'Schreibzugriff außerhalb selectionBox blockiert (geschützt)');

  proxy.set(15, 5, 15, 'emerald_block');
  assert(canvasBase.get(15, 5, 15) === null, 'Schreibzugriff weit außerhalb selectionBox blockiert');

  proxy.box(3, 1, 3, 6, 1, 6, 'iron_block');
  assert(canvasBase.get(5, 1, 5)?.name === 'iron_block', 'box() setzt Blöcke innerhalb der Box');
  assert(canvasBase.get(3, 1, 3) === null, 'box() überschreitet selectionBox nicht nach außen (geschützt)');

  // TEST 12: Schematic Roundtrip, NBT & Litematica 64-Bit-Unpacker
  console.log('\n--- Testgruppe 12: Schematic Roundtrip, NBT & Litematica 64-Bit-Unpacker ---');
  // 1. Sponge .schem Export & Readback
  const canvasExport = new VoxelCanvas(4, 4, 4);
  canvasExport.set(1, 0, 1, 'stone_bricks');
  canvasExport.set(2, 1, 2, 'oak_stairs[facing=south,half=bottom,shape=straight,waterlogged=false]');
  const schemBuf = await schematicManager.exportCanvasToSchem(canvasExport, 'test_export_dryrun');
  assert(Buffer.isBuffer(schemBuf) && schemBuf.length > 0, `Schematic-Buffer erzeugt (${schemBuf.length} Bytes)`);

  const reloadedCanvas = await schematicManager.loadIntoCanvas(schemBuf, 'test_export_dryrun.schem');
  assert(reloadedCanvas.get(0, 0, 0)?.name === 'stone_bricks', 'Block (stone_bricks) erfolgreich aus .schem rekonstruiert');
  const reloadStair = reloadedCanvas.get(1, 1, 1);
  assert(reloadStair?.name === 'oak_stairs', 'Treppe (oak_stairs) aus .schem rekonstruiert');
  assert(reloadStair?.properties.facing === 'south', 'Treppen-Facing aus .schem rekonstruiert');

  // 2. NBT Structure Block
  const nbtTag = {
    type: 'compound',
    name: '',
    value: {
      size: { type: 'list', value: { type: 'int', value: [3, 3, 3] } },
      palette: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            { Name: { type: 'string', value: 'minecraft:air' } },
            { Name: { type: 'string', value: 'minecraft:stone_bricks' } },
            { Name: { type: 'string', value: 'minecraft:oak_stairs' }, Properties: { type: 'compound', value: { facing: { type: 'string', value: 'south' } } } }
          ]
        }
      },
      blocks: {
        type: 'list',
        value: {
          type: 'compound',
          value: [
            { pos: { type: 'list', value: { type: 'int', value: [1, 0, 1] } }, state: { type: 'int', value: 1 } },
            { pos: { type: 'list', value: { type: 'int', value: [2, 1, 2] } }, state: { type: 'int', value: 2 } }
          ]
        }
      }
    }
  };
  const gzippedNbt = zlib.gzipSync(nbt.writeUncompressed(nbtTag));
  const canvasNbt = await schematicManager.loadIntoCanvas(gzippedNbt, 'structure.nbt');
  assert(canvasNbt.get(1, 0, 1)?.name === 'stone_bricks', 'NBT Block bei (1,0,1) geladen');
  assert(canvasNbt.get(2, 1, 2)?.name === 'oak_stairs', 'NBT Treppe bei (2,1,2) geladen');
  assert(canvasNbt.get(2, 1, 2)?.properties.facing === 'south', 'NBT State Property erhalten');

  // 3. Litematica 64-Bit-LongArray Unpacker mit Spanning Bits
  const absX = 4, absY = 2, absZ = 4;
  const volume = absX * absY * absZ; // 32
  const bitsPerBlock = 3;
  const indices = new Array(volume).fill(0);
  indices[5] = 2; // gold_block
  indices[21] = 3; // diamond_block (starts at bit 63, spans across 64-bit boundary)

  const numLongs = Math.ceil((volume * bitsPerBlock) / 64);
  const uLongs = new Array(numLongs).fill(0n);
  for (let i = 0; i < volume; i++) {
    const val = BigInt(indices[i]);
    const startBit = BigInt(i * bitsPerBlock);
    const startLong = Number(startBit / 64n);
    const endLong = Number((startBit + BigInt(bitsPerBlock) - 1n) / 64n);
    const bitOffset = startBit % 64n;

    if (startLong === endLong) {
      uLongs[startLong] |= (val << bitOffset);
    } else {
      const bitsInFirst = 64n - bitOffset;
      const maskFirst = (1n << bitsInFirst) - 1n;
      uLongs[startLong] |= ((val & maskFirst) << bitOffset);
      uLongs[endLong] |= (val >> bitsInFirst);
    }
  }

  const litematicTag = {
    type: 'compound',
    name: '',
    value: {
      Version: { type: 'int', value: 5 },
      Regions: {
        type: 'compound',
        value: {
          Main: {
            type: 'compound',
            value: {
              Position: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
              Size: { type: 'compound', value: { x: { type: 'int', value: absX }, y: { type: 'int', value: absY }, z: { type: 'int', value: absZ } } },
              BlockStatePalette: {
                type: 'list',
                value: {
                  type: 'compound',
                  value: [
                    { Name: { type: 'string', value: 'minecraft:air' } },
                    { Name: { type: 'string', value: 'minecraft:stone' } },
                    { Name: { type: 'string', value: 'minecraft:gold_block' } },
                    { Name: { type: 'string', value: 'minecraft:diamond_block' } },
                    { Name: { type: 'string', value: 'minecraft:emerald_block' } }
                  ]
                }
              },
              BlockStates: {
                type: 'longArray',
                value: uLongs.map(ul => BigInt.asIntN(64, ul))
              }
            }
          }
        }
      }
    }
  };

  const gzippedLitematic = zlib.gzipSync(nbt.writeUncompressed(litematicTag));
  const canvasLitematic = await schematicManager.loadIntoCanvas(gzippedLitematic, 'structure.litematic');

  const x5 = 5 % absX, z5 = Math.floor(5 / absX) % absZ, y5 = Math.floor(5 / (absX * absZ));
  const x21 = 21 % absX, z21 = Math.floor(21 / absX) % absZ, y21 = Math.floor(21 / (absX * absZ));

  assert(canvasLitematic.get(x5, y5, z5)?.name === 'gold_block', `Litematica Index 5 korrekt entpackt als gold_block bei (${x5},${y5},${z5})`);
  assert(canvasLitematic.get(x21, y21, z21)?.name === 'diamond_block', `Litematica Index 21 (64-Bit-Spanning-Grenze!) korrekt entpackt als diamond_block bei (${x21},${y21},${z21})`);

  // TEST 13: Edge Cases & Robuste Transformationen
  console.log('\n--- Testgruppe 13: Edge Cases & Robuste Transformationen ---');
  // 1. Stone Family Smart Swap
  const stoneCanvas = new VoxelCanvas(4, 4, 4);
  stoneCanvas.set(0, 0, 0, 'stone');
  stoneCanvas.set(1, 0, 0, 'stone_stairs[facing=north,half=bottom]');
  stoneCanvas.set(2, 0, 0, 'stone_slab[type=bottom]');
  const stoneSwapCount = stoneCanvas.swapMaterial('stone', 'deepslate_bricks', true);
  assert(stoneSwapCount === 3, `stone swapMaterial count ist 3 (tatsächlich: ${stoneSwapCount})`);
  assert(stoneCanvas.get(0, 0, 0)?.name === 'deepslate_bricks', 'stone -> deepslate_bricks');
  assert(stoneCanvas.get(1, 0, 0)?.name === 'deepslate_brick_stairs', 'stone_stairs -> deepslate_brick_stairs');
  assert(stoneCanvas.get(1, 0, 0)?.properties?.facing === 'north', 'stone_stairs facing=north erhalten');
  assert(stoneCanvas.get(2, 0, 0)?.name === 'deepslate_brick_slab', 'stone_slab -> deepslate_brick_slab');

  // 2. Alias Swap ('cobble' -> 'deepslate_bricks')
  const cobbleCanvas = new VoxelCanvas(4, 4, 4);
  cobbleCanvas.set(0, 0, 0, 'cobblestone');
  cobbleCanvas.set(1, 0, 0, 'cobblestone_wall[north=low,south=low]');
  const cobbleSwapCount = cobbleCanvas.swapMaterial('cobble', 'deepslate_bricks', true);
  assert(cobbleSwapCount === 2, `cobble alias swapMaterial count ist 2 (tatsächlich: ${cobbleSwapCount})`);
  assert(cobbleCanvas.get(0, 0, 0)?.name === 'deepslate_bricks', 'cobblestone via alias cobble zu deepslate_bricks');
  assert(cobbleCanvas.get(1, 0, 0)?.name === 'deepslate_brick_wall', 'cobblestone_wall zu deepslate_brick_wall');

  // 3. stateTransform mirror & rotate cleans undefined keys
  const wallProps = { east: 'low' };
  const mirroredProps = mirrorProperties(wallProps, 'x');
  assert(mirroredProps.west === 'low', 'east nach west gespiegelt');
  assert(!Object.prototype.hasOwnProperty.call(mirroredProps, 'east'), 'east Key existiert nicht mehr (kein undefined)');
  assert(mirroredProps.east === undefined, 'mirroredProps.east ist undefined');

  const rotatedProps = rotateProperties({ east: 'low' }, 1);
  assert(rotatedProps.south === 'low', 'east um 90° CW zu south rotiert');
  assert(!Object.prototype.hasOwnProperty.call(rotatedProps, 'east'), 'alter cardinal Key gelöscht');

  const chestProps = mirrorProperties({ facing: 'north', type: 'left' }, 'x');
  assert(chestProps.type === 'right', 'Chest type von left zu right gespiegelt');

  // 4. Litematica mit leeren / 0-Volumen Regionen
  const litematicMultiTag = {
    type: 'compound',
    name: '',
    value: {
      Version: { type: 'int', value: 5 },
      Regions: {
        type: 'compound',
        value: {
          EmptyRegion: {
            type: 'compound',
            value: {
              Position: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
              Size: { type: 'compound', value: { x: { type: 'int', value: 0 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 0 } } },
              BlockStatePalette: { type: 'list', value: { type: 'compound', value: [{ Name: { type: 'string', value: 'minecraft:air' } }] } },
              BlockStates: { type: 'longArray', value: [] }
            }
          },
          ValidRegion: {
            type: 'compound',
            value: {
              Position: { type: 'compound', value: { x: { type: 'int', value: 2 }, y: { type: 'int', value: 0 }, z: { type: 'int', value: 2 } } },
              Size: { type: 'compound', value: { x: { type: 'int', value: 1 }, y: { type: 'int', value: 1 }, z: { type: 'int', value: 1 } } },
              BlockStatePalette: {
                type: 'list',
                value: {
                  type: 'compound',
                  value: [
                    { Name: { type: 'string', value: 'minecraft:air' } },
                    { Name: { type: 'string', value: 'minecraft:obsidian' } }
                  ]
                }
              },
              BlockStates: { type: 'longArray', value: [1n] }
            }
          }
        }
      }
    }
  };
  const gzippedMulti = zlib.gzipSync(nbt.writeUncompressed(litematicMultiTag));
  const multiCanvas = await schematicManager.loadIntoCanvas(gzippedMulti, 'multi.litematic');
  assert(multiCanvas.width >= 1 && multiCanvas.height >= 1, 'Litematica mit leerer Region wirft kein NaN für Dimensionen');
  assert(multiCanvas.get(0, 0, 0)?.name === 'obsidian', 'Block aus valider Region geladen');

  console.log('\n' + ascii);

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runTests().catch(err => {
  console.error('\n\x1b[31m[TEST SUITE FEHLGESCHLAGEN]:\x1b[0m', err);
  process.exit(1);
});
