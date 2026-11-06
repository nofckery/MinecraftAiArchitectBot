import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { Vec3 } from 'vec3';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { StructuralLinter } from '../src/builder/structuralLinter.js';
import {
  parseBlockProperties,
  sortNeighborsForBlock,
  worldExecutor
} from '../src/builder/worldExecutor.js';
import { harvestManager } from '../src/survival/harvestManager.js';
import { WorldScanner } from '../src/world/worldScanner.js';
import { ChatController } from '../src/bot/chatController.js';
import { ArchitectAgent } from '../src/ai/architectAgent.js';
import { schematicManager } from '../src/builder/schematicManager.js';
import { settings } from '../src/config/settings.js';

let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function testAsync(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  [PASS] ${name}`);
  } catch (err) {
    console.error(`  [FAIL] ${name}: ${err.message}`);
    throw err;
  }
}

async function runSchematicExtensionsSuite() {
  console.log('\n================================================================');
  console.log('  TEST SUITE: SOTA SCHEMATIC & SURVIVAL EXTENSIONS VERIFICATION');
  console.log('================================================================\n');

  // --- Gruppe 1: Semantische Analyse für LLM ---
  console.log('--- Testgruppe 1: Semantische Strukturanalyse für LLM-Verständnis ---');

  test('1.1 StructuralLinter.analyzeSemantics erkennt leere Canvas sauber', () => {
    const emptyCanvas = new VoxelCanvas(10, 10, 10);
    const sem = StructuralLinter.analyzeSemantics(emptyCanvas);
    assert(sem.formattedSummary.includes('leere Canvas'), 'Meldet leere Canvas');
  });

  test('1.2 StructuralLinter.analyzeSemantics extrahiert Materialien, Türen, Fenster & Dachzone', () => {
    const canvas = new VoxelCanvas(20, 20, 20);
    // Fundament & Wände
    canvas.box(0, 0, 0, 10, 4, 10, 'stone_bricks');
    canvas.box(1, 1, 1, 9, 3, 9, 'air'); // hohl
    // Tür
    canvas.set(5, 1, 0, 'oak_door[facing=south,half=lower]');
    canvas.set(5, 2, 0, 'oak_door[facing=south,half=upper]');
    // Fenster
    canvas.set(2, 2, 0, 'glass_pane');
    canvas.set(8, 2, 0, 'glass_pane');
    // Beleuchtung
    canvas.set(5, 3, 5, 'lantern');
    // Dach
    for (let x = 0; x <= 10; x++) {
      canvas.set(x, 5, 0, 'spruce_stairs[facing=south,half=bottom]');
      canvas.set(x, 5, 10, 'spruce_stairs[facing=north,half=bottom]');
    }

    const sem = StructuralLinter.analyzeSemantics(canvas);
    assert.strictEqual(sem.totalBlocks, canvas.blocks.size);
    assert.strictEqual(sem.doors.length, 1, 'Erkennt genau 1 Tür (ohne upper half doppelt zu zählen)');
    assert.strictEqual(sem.doors[0].facing, 'south');
    assert.strictEqual(sem.windowsCount, 2, 'Erkennt 2 Glasscheiben');
    assert.strictEqual(sem.lightsCount, 1, 'Erkennt 1 Laterne');
    assert(sem.formattedSummary.includes('oak_door bei (5, 1, 0, Blick: south)'), 'Tür in Zusammenfassung');
    assert(sem.formattedSummary.includes('Fenster & Glasflächen: 2'), 'Fenster in Zusammenfassung');
    assert(sem.formattedSummary.includes('spruce_stairs'), 'Dachmaterial erkannt');
  });

  // --- Gruppe 2: Blockstate-Parsing & Nachbar-Priorisierung im Survival ---
  console.log('\n--- Testgruppe 2: Survival Blockstate-Parsing & Nachbar-Priorisierung ---');

  test('2.1 parseBlockProperties parst complex blockstate strings korrekt', () => {
    assert.deepStrictEqual(parseBlockProperties('stone'), {});
    assert.deepStrictEqual(parseBlockProperties('oak_stairs[facing=north,half=top,shape=straight]'), {
      facing: 'north',
      half: 'top',
      shape: 'straight'
    });
    assert.deepStrictEqual(parseBlockProperties('spruce_log[axis=y]'), { axis: 'y' });
  });

  test('2.2 sortNeighborsForBlock priorisiert passende Flächen für axis=y (Boden/Decke)', () => {
    const baseNeighbors = [
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) }
    ];
    const sorted = sortNeighborsForBlock(baseNeighbors, 'oak_log', { axis: 'y' });
    assert.strictEqual(sorted[0].face.y, 1, 'Bodenfläche (face.y = 1) wird für axis=y zuerst gewählt');
  });

  test('2.3 sortNeighborsForBlock priorisiert Wandfläche für Wandfackeln', () => {
    const baseNeighbors = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }
    ];
    // Eine Wandfackel mit facing=south hängt an der Wand bei Z - 1 (face = 0, 0, 1)
    const sorted = sortNeighborsForBlock(baseNeighbors, 'wall_torch', { facing: 'south' });
    assert.strictEqual(sorted[0].face.z, 1, 'Wandfläche (face.z = 1) wird für wall_torch[facing=south] an erster Stelle sortiert');
  });

  test('2.4 sortNeighborsForBlock priorisiert Deckenfläche für half=top (kopfüber Treppen/Slabs)', () => {
    const baseNeighbors = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(0, 1, 0), face: new Vec3(0, -1, 0) },
      { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }
    ];
    const sorted = sortNeighborsForBlock(baseNeighbors, 'stone_brick_stairs', { half: 'top' });
    assert.strictEqual(sorted[0].face.y, -1, 'Deckenfläche (face.y = -1) wird für half=top priorisiert');
  });

  // --- Gruppe 3: Baufeld-Rodung (Phase 0) ---
  console.log('\n--- Testgruppe 3: Baufeld-Rodung (Phase 0 / Site Clearing) ---');

  await testAsync('3.1 harvestManager.clearObstacles erkennt und räumt störende Hindernisse von oben nach unten ab', async () => {
    const worldBlocks = new Map();
    worldBlocks.set('10,65,10', { name: 'oak_leaves', position: new Vec3(10, 65, 10) });
    worldBlocks.set('10,64,10', { name: 'oak_log', position: new Vec3(10, 64, 10) });
    worldBlocks.set('10,63,10', { name: 'dirt', position: new Vec3(10, 63, 10) });

    const dugBlocks = [];
    const mockBot = {
      entity: { position: new Vec3(10, 63, 7) },
      blockAt: (pos) => worldBlocks.get(`${pos.x},${pos.y},${pos.z}`) || { name: 'air', position: pos },
      dig: async (b) => {
        dugBlocks.push(b.name);
        worldBlocks.delete(`${b.position.x},${b.position.y},${b.position.z}`);
      },
      chat: () => {}
    };

    // Geplante Bauwerksblöcke: Auf Y=64 und Y=65 soll Stein gebaut werden (aktuelle Blöcke sind Hindernisse)
    const planned = [
      { x: 10, y: 64, z: 10, name: 'stone_bricks' },
      { x: 10, y: 65, z: 10, name: 'stone_bricks' }
    ];

    const result = await harvestManager.clearObstacles(mockBot, planned, { chatAlerts: false });
    assert.strictEqual(result.clearedCount, 2, 'Räumt genau die beiden Hindernisse ab');
    assert.strictEqual(dugBlocks[0], 'oak_leaves', 'Baut zuerst die höhere Ebene (Y=65) ab');
    assert.strictEqual(dugBlocks[1], 'oak_log', 'Baut danach die tiefere Ebene (Y=64) ab');
  });

  // --- Gruppe 4: Automatische Baufeld-Anpassung bei Schematics ---
  console.log('\n--- Testgruppe 4: Automatische Baufeld-Größenanpassung ---');

  test('4.1 WorldScanner.scanBuildSite nutzt customDimensions für dynamische Zentrierung', () => {
    const mockBot = {
      entity: { position: new Vec3(100, 64, 200), yaw: Math.PI } // Yaw = PI -> facing north
    };

    const site = WorldScanner.scanBuildSite(mockBot, null, { width: 38, depth: 50, height: 30 });
    assert.strictEqual(site.width, 38, 'Breite dynamisch auf 38 angepasst');
    assert.strictEqual(site.depth, 50, 'Tiefe dynamisch auf 50 angepasst');
    assert.strictEqual(site.facing, 'north');
    // Bei facing=north: oz = pos.z - depth - 2 = 200 - 50 - 2 = 148
    assert.strictEqual(site.origin.z, 148, 'Z-Ursprung exakt vor dem Bot ohne Überschneidung');
    // ox = pos.x - Math.floor(width / 2) = 100 - 19 = 81
    assert.strictEqual(site.origin.x, 81, 'X-Ursprung symmetrisch zentriert');
  });

  // --- Gruppe 5: In-Game Chat-Befehle für Schematics ---
  console.log('\n--- Testgruppe 5: Ingame Chat-Befehle (!schem list, load, build, clear) ---');

  await testAsync('5.1 !schem list listet verfügbare Schematic-Dateien auf', async () => {
    let chatMessage = '';
    const mockBot = {
      username: 'Bot',
      chat: (msg) => { chatMessage = msg; }
    };
    const agent = new ArchitectAgent(mockBot);
    const controller = new ChatController(mockBot, agent);
    const owner = settings.BOT_OWNER || 'kraksi';

    await controller.handleMessage(owner, '!schem list');
    assert(chatMessage.includes('Schematics'), 'Listet Schematics im Chat auf');
    assert(chatMessage.includes('.schem') || chatMessage.includes('.litematic') || chatMessage.includes('.nbt'), 'Nennt mindestens ein Format');
  });

  await testAsync('5.2 !schem load lädt Schematic und passt Baufeld automatisch an', async () => {
    const chatMessages = [];
    const mockBot = {
      username: 'Bot',
      entity: { position: new Vec3(0, 64, 0), yaw: 0 }, // facing south
      chat: (msg) => { chatMessages.push(msg); }
    };
    const agent = new ArchitectAgent(mockBot);
    const controller = new ChatController(mockBot, agent);
    const owner = settings.BOT_OWNER || 'kraksi';

    // Lade die echte Litematic aus dem Repo
    await controller.handleMessage(owner, '!schem load clandestine-man-25170sp8.litematic');

    assert(agent.lastBuildState?.canvas, 'Canvas in lastBuildState registriert');
    assert.strictEqual(agent.lastBuildState.width, 38, 'Breite 38 übernommen');
    assert.strictEqual(agent.lastBuildState.depth, 51, 'Tiefe 51 übernommen');
    assert(chatMessages.some(m => m.includes('geladen') && m.includes('7532 Blöcke')), 'Chat-Rückmeldung mit Blockanzahl erfolgt');
  });

  await testAsync('5.3 !schem clear entlädt geladenen Bauplan', async () => {
    let chatMessage = '';
    const mockBot = {
      username: 'Bot',
      chat: (msg) => { chatMessage = msg; }
    };
    const agent = new ArchitectAgent(mockBot);
    agent.lastBuildState = { canvas: new VoxelCanvas(10, 10, 10) };
    const controller = new ChatController(mockBot, agent);
    const owner = settings.BOT_OWNER || 'kraksi';

    await controller.handleMessage(owner, '!schem clear');
    assert.strictEqual(agent.lastBuildState, null, 'lastBuildState auf null gesetzt');
    assert(chatMessage.includes('entladen'), 'Chat-Rückmeldung zu entladen');
  });

  console.log('\n================================================================');
  console.log(`  ERGEBNIS: ${passed} / ${total} TESTS ERFOLGREICH BESTANDEN!`);
  console.log('  Alle Schematic- & Survival-Erweiterungen 100% verifiziert!');
  console.log('================================================================\n');
}

runSchematicExtensionsSuite();
