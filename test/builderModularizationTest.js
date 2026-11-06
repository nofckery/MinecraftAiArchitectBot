import assert from 'node:assert';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { ArchPrimitives } from '../src/builder/archPrimitives.js';
import { foundation, framedRoom, jettyFloor } from '../src/builder/primitives/roomGenerators.js';
import { gableRoof, hipRoof, conicalTowerRoof } from '../src/builder/primitives/roofGenerators.js';
import { cylindricalTower, windowWithDetail, doorway, chimney } from '../src/builder/primitives/structureGenerators.js';
import { furnishInterior } from '../src/builder/primitives/interiorDecorators.js';
import { computeGreedyBoxes, toBlockString } from '../src/builder/greedyMesher.js';
import { swapMaterial, WOOD_TYPES, STONE_FAMILIES } from '../src/builder/paletteSwapper.js';
import { computeDiff } from '../src/builder/canvasDiff.js';
import { schematicManager, SchematicManager } from '../src/builder/schematicManager.js';
import { parseSpongeSchematic, exportSpongeSchematic } from '../src/builder/formats/spongeFormat.js';
import { parseNbtStructure, exportNbtStructure } from '../src/builder/formats/nbtFormat.js';
import { parseLitematic } from '../src/builder/formats/litematicFormat.js';
import { worldExecutor, WorldExecutor } from '../src/builder/worldExecutor.js';

async function runBuilderModularizationTests() {
  console.log('\n=== STARTING BUILDER & GEOMETRY MODULARIZATION TEST SUITE ===\n');

  // Testgruppe 1: ArchPrimitives & Primitives Submodule
  console.log('--- Testgruppe 1: ArchPrimitives & Submodule ---');
  const canvas1 = new VoxelCanvas(16, 16, 16);
  foundation(canvas1, 0, 0, 5, 5, 2, 'stone_bricks');
  assert(canvas1.get(0, 0, 0).name === 'stone_bricks', 'foundation setzt Sockel');
  assert(canvas1.get(5, 1, 5).name === 'stone_bricks', 'foundation setzt Höhe 2');

  const canvas2 = new VoxelCanvas(16, 16, 16);
  framedRoom(canvas2, 0, 0, 0, 6, 4, 6);
  assert(canvas2.get(1, 0, 1).name === 'oak_planks', 'framedRoom setzt Boden');
  assert(canvas2.get(1, 4, 1).name === 'spruce_planks', 'framedRoom setzt Decke');
  assert(canvas2.get(0, 0, 0).name === 'spruce_log', 'framedRoom setzt Rahmenbalken am Rand');

  const canvas3 = new VoxelCanvas(16, 16, 16);
  jettyFloor(canvas3, 2, 2, 2, 6, 6, 6, { overhang: 1 });
  assert(canvas3.get(1, 1, 1).name.includes('spruce_stairs'), 'jettyFloor setzt Kragträger');

  const canvas4 = new VoxelCanvas(16, 16, 16);
  gableRoof(canvas4, 0, 0, 0, 6, 6);
  assert(canvas4.blocks.size > 0, 'gableRoof platziert Dachblöcke');

  const canvas5 = new VoxelCanvas(16, 16, 16);
  hipRoof(canvas5, 0, 0, 0, 6, 6);
  assert(canvas5.blocks.size > 0, 'hipRoof platziert Walmdachblöcke');

  const canvas6 = new VoxelCanvas(16, 16, 16);
  conicalTowerRoof(canvas6, 5, 2, 5, 3, 4);
  assert(canvas6.get(5, 8, 5).name === 'lightning_rod', 'conicalTowerRoof setzt Blitzableiter-Spitze');

  const canvas7 = new VoxelCanvas(16, 16, 16);
  cylindricalTower(canvas7, 5, 0, 5, 3, 6);
  assert(canvas7.get(5, 0, 5).name === 'spruce_log', 'cylindricalTower setzt zentrale Säule');

  const canvas8 = new VoxelCanvas(16, 16, 16);
  windowWithDetail(canvas8, 2, 2, 0, 2, 2, 'north');
  assert(canvas8.get(2, 2, 0).name === 'glass_pane', 'windowWithDetail platziert Glasscheibe');

  const canvas9 = new VoxelCanvas(16, 16, 16);
  doorway(canvas9, 3, 1, 0, 'north', { doubleDoor: true });
  assert(canvas9.get(3, 1, 0).name === 'oak_door', 'doorway platziert Tür');
  assert(canvas9.get(4, 1, 0).name === 'oak_door', 'doorway platziert Doppeltür');

  const canvas10 = new VoxelCanvas(16, 16, 16);
  chimney(canvas10, 4, 1, 4, 8);
  assert(canvas10.get(4, 1, 4).name === 'campfire', 'chimney platziert Kaminfeuer unten');
  assert(canvas10.get(4, 8, 4).name === 'campfire', 'chimney platziert Rauchfeuer oben');

  const canvas11 = new VoxelCanvas(16, 16, 16);
  furnishInterior(canvas11, 0, 1, 0, 6, 6, 'unbekannter_test_raum');
  assert(canvas11.blocks.size > 0, 'furnishInterior aktiviert Default-Fallback bei unbekanntem Raum');

  // Facade delegation check
  const facadeCanvas = new VoxelCanvas(16, 16, 16);
  const arch = new ArchPrimitives(facadeCanvas);
  arch.foundation(0, 0, 4, 4, 1);
  assert(facadeCanvas.get(0, 0, 0).name === 'stone_bricks', 'ArchPrimitives delegiert foundation');
  console.log('[PASS] ArchPrimitives und alle 4 Submodule in primitives/ funktionieren vollständig');

  // Testgruppe 2: Geometry Submodule (greedyMesher, paletteSwapper, canvasDiff)
  console.log('--- Testgruppe 2: Geometry Submodule ---');
  assert(typeof computeGreedyBoxes === 'function', 'computeGreedyBoxes ist Funktion');
  assert(typeof toBlockString === 'function', 'toBlockString ist Funktion');
  assert(typeof swapMaterial === 'function', 'swapMaterial ist Funktion');
  assert(typeof computeDiff === 'function', 'computeDiff ist Funktion');
  assert(Array.isArray(WOOD_TYPES) && WOOD_TYPES.length >= 10, 'WOOD_TYPES ist Array');
  assert(Array.isArray(STONE_FAMILIES) && STONE_FAMILIES.length >= 20, 'STONE_FAMILIES ist Array');

  const testBlocks = [
    { x: 0, y: 0, z: 0, blockState: { name: 'stone' }, fullBlockString: 'stone' },
    { x: 1, y: 0, z: 0, blockState: { name: 'stone' }, fullBlockString: 'stone' }
  ];
  const boxes = computeGreedyBoxes(testBlocks);
  assert(boxes.length === 1 && boxes[0].volume === 2, 'computeGreedyBoxes mesht statische Blöcke');

  const cDiff1 = new VoxelCanvas(5, 5, 5);
  cDiff1.set(1, 1, 1, 'stone');
  const cDiff2 = new VoxelCanvas(5, 5, 5);
  cDiff2.set(1, 1, 1, 'dirt');
  const diffs = computeDiff(cDiff1, cDiff2);
  assert(diffs.length === 1 && diffs[0].action === 'set' && diffs[0].fullBlockString === 'dirt', 'computeDiff ermittelt Delta');

  const cSwap = new VoxelCanvas(5, 5, 5);
  cSwap.set(1, 1, 1, 'spruce_log[axis=y]');
  cSwap.set(2, 1, 1, 'spruce_planks');
  const swapped = swapMaterial(cSwap, 'spruce', 'oak', true);
  assert(swapped === 2, 'swapMaterial tauscht beide Holzblöcke im Canvas');
  assert(cSwap.get(1, 1, 1).name === 'oak_log', 'spruce_log wurde zu oak_log');
  console.log('[PASS] greedyMesher, paletteSwapper und canvasDiff arbeiten präzise');

  // Testgruppe 3: Schematic Formats
  console.log('--- Testgruppe 3: Schematic Formate ---');
  assert(typeof parseSpongeSchematic === 'function', 'parseSpongeSchematic exportiert');
  assert(typeof exportSpongeSchematic === 'function', 'exportSpongeSchematic exportiert');
  assert(typeof parseNbtStructure === 'function', 'parseNbtStructure exportiert');
  assert(typeof exportNbtStructure === 'function', 'exportNbtStructure exportiert');
  assert(typeof parseLitematic === 'function', 'parseLitematic exportiert');

  const sMgr = new SchematicManager();
  assert(typeof sMgr.loadIntoCanvas === 'function', 'loadIntoCanvas vorhanden');
  assert(typeof sMgr.exportCanvasToSchem === 'function', 'exportCanvasToSchem vorhanden');
  assert(typeof sMgr.exportCanvasToNbt === 'function', 'exportCanvasToNbt vorhanden');
  assert(typeof sMgr.cloneWorldRegionToCanvas === 'function', 'cloneWorldRegionToCanvas vorhanden');
  console.log('[PASS] SchematicManager fungiert erfolgreich als sauberer Dispatcher');

  // Testgruppe 4: WorldExecutor Dekonstruktion
  console.log('--- Testgruppe 4: WorldExecutor Dekonstruktion ---');
  assert(typeof worldExecutor._procureMaterials === 'function', 'WorldExecutor._procureMaterials existiert');
  assert(typeof worldExecutor._executePhase1 === 'function', 'WorldExecutor._executePhase1 existiert');
  assert(typeof worldExecutor._executePhase2 === 'function', 'WorldExecutor._executePhase2 existiert');
  assert(typeof worldExecutor.executeBatch === 'function', 'WorldExecutor.executeBatch existiert');
  console.log('[PASS] WorldExecutor executeBatch wurde erfolgreich dekonstruiert');

  console.log('\n=== ALLE TESTS DER BUILDER MODULARISIERUNG BESTANDEN! ===\n');
}

runBuilderModularizationTests();
