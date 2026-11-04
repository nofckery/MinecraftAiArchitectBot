import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { ArchPrimitives } from '../src/builder/archPrimitives.js';
import { inventoryManager } from '../src/bot/inventoryManager.js';
import { schematicManager } from '../src/builder/schematicManager.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { settings } from '../src/config/settings.js';
import { llmRouter } from '../src/ai/llmRouter.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
    passed++;
  } else {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    failed++;
  }
}

async function runImprovementsTests() {
  console.log('\n=== RUNNING 31-POINTS IMPROVEMENTS VERIFICATION SUITE ===\n');

  // Test 1: Statischer Aufruf von VoxelCanvas.computeGreedyBoxes (Item 1.4)
  console.log('--- Test 1: Statische Greedy-Meshing-Engine ---');
  const testBlocks = [
    { x: 0, y: 0, z: 0, fullBlockString: 'stone', blockState: { name: 'stone' } },
    { x: 1, y: 0, z: 0, fullBlockString: 'stone', blockState: { name: 'stone' } },
    { x: 0, y: 0, z: 1, fullBlockString: 'stone', blockState: { name: 'stone' } },
    { x: 1, y: 0, z: 1, fullBlockString: 'stone', blockState: { name: 'stone' } }
  ];
  const boxes = VoxelCanvas.computeGreedyBoxes(testBlocks);
  assert(Array.isArray(boxes) && boxes.length === 1, 'computeGreedyBoxes funktioniert statisch ohne Dummy-Instanz');
  assert(boxes[0].volume === 4, 'Statischer Quader fasst 4 Blöcke zusammen');

  // Test 2: Inventory Material Check & Kisten-Scan (Items 1.1, 1.2)
  console.log('\n--- Test 2: Material- & Inventar-Management ---');
  const mockInvBot = {
    inventory: {
      items: () => [
        { name: 'oak_planks', count: 64 },
        { name: 'cobblestone', count: 10 }
      ]
    }
  };
  const matCheckPass = inventoryManager.checkMaterials(mockInvBot, { oak_planks: 30, cobblestone: 5 });
  assert(matCheckPass.hasAll === true, 'checkMaterials bestätigt vorhandene Ressourcen');

  const matCheckFail = inventoryManager.checkMaterials(mockInvBot, { oak_planks: 30, cobblestone: 20, glass: 5 });
  assert(matCheckFail.hasAll === false, 'checkMaterials erkennt fehlende Materialien');
  assert(matCheckFail.missing.cobblestone === 10, 'Fehlmenge für Cobblestone korrekt (10)');
  assert(matCheckFail.missing.glass === 5, 'Fehlmenge für Glas korrekt (5)');

  // Test 3: Erweiterte Raumtypen in ArchPrimitives (Item 3.4)
  console.log('\n--- Test 3: Erweiterte Raumtypen & Robuster Default-Fallback ---');
  const canvasKitchen = new VoxelCanvas(10, 10, 10);
  const archKitchen = new ArchPrimitives(canvasKitchen);
  archKitchen.furnishInterior(1, 1, 1, 8, 8, 'kitchen');
  const kitchenBlockNames = Array.from(canvasKitchen.blocks.values()).map(b => b.name);
  assert(kitchenBlockNames.includes('smoker'), 'Küche enthält Smoker/Räucherofen');
  assert(kitchenBlockNames.includes('cauldron'), 'Küche enthält Kessel');

  const canvasArmory = new VoxelCanvas(10, 10, 10);
  const archArmory = new ArchPrimitives(canvasArmory);
  archArmory.furnishInterior(1, 1, 1, 8, 8, 'armory');
  const armoryBlockNames = Array.from(canvasArmory.blocks.values()).map(b => b.name);
  assert(armoryBlockNames.includes('anvil'), 'Waffenkammer enthält Amboss');

  const canvasDefault = new VoxelCanvas(10, 10, 10);
  const archDefault = new ArchPrimitives(canvasDefault);
  archDefault.furnishInterior(1, 1, 1, 8, 8, 'unbekannter_fantasie_raum');
  const defaultBlockNames = Array.from(canvasDefault.blocks.values()).map(b => b.name);
  assert(defaultBlockNames.includes('chest'), 'Default-Fallback platziert Vorratskiste');
  assert(defaultBlockNames.includes('crafting_table'), 'Default-Fallback platziert Werkbank');

  // Test 4: Export als Vanilla Structure-NBT (Item 3.5)
  console.log('\n--- Test 4: Structure-Block NBT Export ---');
  const exportCanvas = new VoxelCanvas(4, 4, 4);
  exportCanvas.set(0, 0, 0, 'stone_bricks');
  exportCanvas.set(1, 0, 0, 'oak_planks');
  exportCanvas.set(2, 0, 0, 'oak_stairs[facing=north,half=bottom]');

  const nbtBuffer = await schematicManager.exportCanvasToNbt(exportCanvas, 'unit_test_structure');
  assert(Buffer.isBuffer(nbtBuffer) && nbtBuffer.length > 50, 'exportCanvasToNbt erzeugt gültigen gzip-komprimierten NBT-Buffer');

  // Test 5: Re-Import des exportierten NBT (Roundtrip Interoperabilität)
  const reimportedCanvas = await schematicManager.loadIntoCanvas(nbtBuffer, 'unit_test_structure.nbt');
  assert(reimportedCanvas.blocks.size === 3, 'Exportiertes NBT wird verlustfrei re-importiert (3 Blöcke)');
  assert(reimportedCanvas.get(0, 0, 0)?.name === 'stone_bricks', 'NBT-Block 0: stone_bricks');
  assert(reimportedCanvas.get(1, 0, 0)?.name === 'oak_planks', 'NBT-Block 1: oak_planks');

  // Test 6: Zero-Key Endpunkt-URLs aus Settings (Item 2.6)
  console.log('\n--- Test 6: Konfigurierbare Zero-Key Gateways ---');
  assert(settings.KILO_GATEWAY_URL.startsWith('http'), 'KILO_GATEWAY_URL ist als Setting konfiguriert');
  assert(settings.LLM7_GATEWAY_URL.startsWith('http'), 'LLM7_GATEWAY_URL ist als Setting konfiguriert');

  // Test 7: Survival Cheat-Bruch Schutz (Item 3.2)
  console.log('\n--- Test 7: pure_physical Cheat-Fallback Schutz ---');
  const chatMessages = [];
  const fakeSurvivalBot = {
    entity: { position: { x: 0, y: 64, z: 0, distanceTo: () => 5 } },
    blockAt: () => ({ name: 'air' }), // Keine Nachbarn vorhanden
    chat: (msg) => chatMessages.push(msg)
  };
  await worldExecutor.placeBlockPhysically(fakeSurvivalBot, 10, 64, 10, 'minecraft:stone', 'pure_physical');
  const executedCheat = chatMessages.some(m => m.startsWith('/setblock'));
  assert(executedCheat === false, 'Im Modus pure_physical wird KEIN /setblock Cheat-Befehl gesendet');

  console.log(`\n=== IMPROVEMENTS SUITE ERGEBNIS: ${passed} PASS, ${failed} FAIL ===\n`);
  if (failed > 0) process.exit(1);
}

runImprovementsTests();
