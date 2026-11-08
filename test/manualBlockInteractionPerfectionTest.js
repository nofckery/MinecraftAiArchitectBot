import assert from 'node:assert';
import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import {
  ManualController,
  manualController,
  INTERACTABLE_BLOCKS
} from '../src/bot/manualController.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';
import { dashboardServer } from '../src/web/dashboardServer.js';

console.log('=== STARTING MANUAL BLOCK INTERACTION & DIGGING PERFECTION TEST SUITE ===\n');

function createRealisticBot() {
  const bot = new EventEmitter();
  bot.version = '1.20.4';
  bot.entity = {
    position: new Vec3(100, 64, 200),
    yaw: 0, // South (was broken in Mineflayer due to !yaw)
    pitch: 0, // Horizontal (was broken in Mineflayer due to !pitch)
    height: 1.8,
    eyeHeight: 1.62
  };
  bot.health = 20;
  bot.quickBarSlot = 0;
  bot.heldItem = { type: 1, name: 'stone', count: 64 };
  bot.entities = {};
  bot.game = { gameMode: 'survival' };
  bot.registry = {
    blocksByName: {
      stone: { id: 1, name: 'stone', hardness: 1.5, diggable: true },
      dirt: { id: 2, name: 'dirt', hardness: 0.5, diggable: true },
      chest: { id: 54, name: 'chest', hardness: 2.5, diggable: true }
    },
    itemsByName: {
      stone: { id: 1, name: 'stone' },
      bread: { id: 297, name: 'bread' }
    },
    foodsByName: {
      bread: { id: 297, name: 'bread' }
    }
  };
  bot.inventory = {
    slots: {
      36: { type: 1, name: 'stone', count: 64 }
    },
    items: () => []
  };

  bot.digCalls = [];
  bot.stopDiggingCalls = 0;
  bot.placeBlockWithOptionsCalls = [];
  bot.placeBlockCalls = [];
  bot.activateBlockCalls = [];
  bot.activateItemCalls = [];
  bot.chatCalls = [];
  bot.swingArmCalls = [];

  bot.dig = (block, forceLook, digFace) => {
    bot.digCalls.push({ block, forceLook, digFace });
    return new Promise((resolve) => {
      bot.resolveDig = resolve;
    });
  };

  bot.stopDigging = () => {
    bot.stopDiggingCalls++;
  };

  bot.digTime = (block) => {
    if (block.name === 'dirt') return 750;
    if (block.name === 'stone') return 1500;
    return 1000;
  };

  bot._placeBlockWithOptions = async (block, face, options) => {
    bot.placeBlockWithOptionsCalls.push({ block, face, options });
  };

  bot.placeBlock = async (block, face) => {
    bot.placeBlockCalls.push({ block, face });
  };

  bot.activateBlock = async (block) => {
    bot.activateBlockCalls.push(block);
  };

  bot.activateItem = (offhand = false) => {
    bot.activateItemCalls.push(offhand);
  };

  bot.swingArm = (hand = 'right') => {
    bot.swingArmCalls.push(hand);
  };

  bot.chat = (msg) => {
    bot.chatCalls.push(msg);
  };

  // Mock prismarine world
  bot.world = {
    raycastCalls: [],
    raycast: (from, dir, maxDist) => {
      bot.world.raycastCalls.push({ from, dir, maxDist });
      // If looking at pitch=0, yaw=0 -> dir is (0, 0, -1)
      const targetPos = new Vec3(100, 64, 197);
      return {
        name: 'stone',
        position: targetPos,
        face: 3, // South face
        intersect: new Vec3(100.5, 64.5, 197.0),
        hardness: 1.5,
        diggable: true
      };
    }
  };

  bot.blockAt = (pos) => {
    return {
      name: 'stone',
      position: new Vec3(pos.x, pos.y, pos.z),
      hardness: 1.5,
      diggable: true
    };
  };

  return bot;
}

async function runSuite() {
  // -------------------------------------------------------------
  // Testgruppe 1: Raycasting bei pitch=0 und yaw=0
  // -------------------------------------------------------------
  console.log('--- Testgruppe 1: Raycasting bei pitch=0 und yaw=0 (Mineflayer-Bug Immunity) ---');
  {
    const bot = createRealisticBot();
    const controller = new ManualController();
    controller.activate(bot);

    // Bot looks straight forward (pitch=0, yaw=0)
    bot.entity.pitch = 0;
    bot.entity.yaw = 0;

    const inspected = controller.inspectTargetBlock(5.0);
    assert(inspected !== null, '1.1 inspectTargetBlock liefert Block bei pitch=0 und yaw=0 zurück');
    assert.strictEqual(inspected.name, 'stone', '1.1 Name ist stone');
    assert.strictEqual(bot.world.raycastCalls.length, 1, '1.1 world.raycast wurde genau 1x aufgerufen');

    const lastCall = bot.world.raycastCalls[0];
    assert.strictEqual(lastCall.from.y, 65.62, '1.2 Raycast startet auf exakter Augenhöhe 64 + 1.62 = 65.62');
    assert(Math.abs(lastCall.dir.z - (-1)) < 0.001, '1.3 Blickrichtung z ist -1');

    const targetInfo = controller.inspectTarget(5.0);
    assert(targetInfo !== null, '1.4 inspectTarget liefert Telemetriedaten');
    assert.strictEqual(targetInfo.kind, 'block', '1.4 kind ist block');
    assert.strictEqual(targetInfo.face, 3, '1.4 face ist 3 (South)');
    assert.strictEqual(targetInfo.digTime, 1500, '1.5 digTime für stone ist 1500ms');

    controller.deactivate();
    console.log('[PASS] Testgruppe 1: Raycasting bei pitch=0 und yaw=0 erfolgreich verifiziert.');
  }

  // -------------------------------------------------------------
  // Testgruppe 2: Blockabbau (Digging Lifecycle, ForceLook 'ignore', Progress)
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 2: Blockabbau & Digging Lifecycle ---');
  {
    const bot = createRealisticBot();
    const controller = new ManualController();
    controller.activate(bot);

    const stoneBlock = {
      name: 'stone',
      position: new Vec3(100, 64, 197),
      face: 3
    };

    assert.strictEqual(controller.isDigging, false, '2.1 isDigging initial false');
    assert.strictEqual(controller.getDigProgress(), 0, '2.1 digProgress initial 0');

    // Start digging
    const started = controller.startDigging(stoneBlock);
    assert.strictEqual(started, true, '2.2 startDigging liefert true');
    assert.strictEqual(controller.isDigging, true, '2.2 isDigging ist true');
    assert.strictEqual(bot.digCalls.length, 1, '2.2 bot.dig wurde aufgerufen');
    assert.strictEqual(bot.digCalls[0].forceLook, 'ignore', '2.3 forceLook ist "ignore" (kein Kamera-Zucken/Physics-Freeze)');

    // Idempotentes startDigging am selben Block
    const sameDig = controller.startDigging(stoneBlock);
    assert.strictEqual(sameDig, true, '2.4 Wiederholtes startDigging am selben Block ist idempotent');
    assert.strictEqual(bot.digCalls.length, 1, '2.4 Kein doppelter bot.dig Aufruf am selben Block');

    // Progress Simulation
    controller.digStartTime = Date.now() - 750; // 50% von 1500ms
    const progress = controller.getDigProgress();
    assert(progress >= 0.49 && progress <= 0.55, `2.5 Dig-Progress ist ca. 50%, tatsächlich: ${progress}`);

    // Wechsel auf anderen Block bricht alten Abbau ab und startet neuen
    const dirtBlock = { name: 'dirt', position: new Vec3(100, 64, 196), face: 1 };
    bot.stopDiggingCalls = 0;
    controller.startDigging(dirtBlock);
    assert.strictEqual(bot.stopDiggingCalls, 1, '2.6 Neuer Block ruft bot.stopDigging für vorherigen Block auf');
    assert.strictEqual(bot.digCalls.length, 2, '2.6 bot.dig für neuen Block aufgerufen');
    assert.strictEqual(controller.currentDigBlock.name, 'dirt', '2.6 currentDigBlock ist jetzt dirt');

    // Manuelles Loslassen (dig_stop)
    controller.stopDigging();
    assert.strictEqual(controller.isDigging, false, '2.7 isDigging ist false nach stopDigging');
    assert.strictEqual(controller.getDigProgress(), 0, '2.7 digProgress ist 0 nach stopDigging');

    controller.deactivate();
    console.log('[PASS] Testgruppe 2: Blockabbau & Digging Lifecycle erfolgreich verifiziert.');
  }

  // -------------------------------------------------------------
  // Testgruppe 3: Blockplatzierung (Place Block, ForceLook 'ignore', Usable Items)
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 3: Blockplatzierung & Interaktion ---');
  {
    const bot = createRealisticBot();
    const controller = new ManualController();
    controller.activate(bot);

    const refStone = {
      name: 'stone',
      position: new Vec3(100, 64, 197),
      face: 1 // Top face
    };

    // 3.1 Normales Platzieren eines Blocks (heldItem: stone)
    bot.heldItem = { type: 1, name: 'stone', count: 64 };
    bot.placeBlockWithOptionsCalls = [];
    const placeRes = await controller.interactOrPlace(refStone);
    assert.strictEqual(placeRes.success, true, '3.1 interactOrPlace erfolgreich');
    assert.strictEqual(placeRes.action, 'place_block', '3.1 action ist place_block');
    assert.strictEqual(bot.placeBlockWithOptionsCalls.length, 1, '3.1 bot._placeBlockWithOptions aufgerufen');
    assert.strictEqual(bot.placeBlockWithOptionsCalls[0].options.forceLook, 'ignore', '3.2 forceLook ist "ignore"');
    assert.strictEqual(bot.placeBlockWithOptionsCalls[0].options.swingArm, 'right', '3.2 swingArm ist right');
    assert.strictEqual(placeRes.dest.y, 65, '3.3 Zielkoordinate y ist 64 + 1 = 65');

    // 3.2 Interaktion mit Truhe ohne Sneak -> activateBlock
    const refChest = {
      name: 'chest',
      position: new Vec3(100, 64, 198),
      face: 1
    };
    bot.activateBlockCalls = [];
    const chestRes = await controller.interactOrPlace(refChest);
    assert.strictEqual(chestRes.success, true, '3.4 Kistenklick ohne Sneak liefert true');
    assert.strictEqual(chestRes.action, 'activate_block', '3.4 action ist activate_block');
    assert.strictEqual(bot.activateBlockCalls.length, 1, '3.4 bot.activateBlock aufgerufen');

    // 3.3 Truhe mit Sneak -> Block platzieren statt öffnen
    controller.setControlState('sneak', true);
    bot.placeBlockWithOptionsCalls = [];
    const sneakPlaceRes = await controller.interactOrPlace(refChest, new Vec3(0, 1, 0));
    assert.strictEqual(sneakPlaceRes.action, 'place_block', '3.5 Mit Sneak wird Block auf Kiste platziert');
    assert.strictEqual(bot.placeBlockWithOptionsCalls.length, 1, '3.5 bot._placeBlockWithOptions aufgerufen');
    controller.setControlState('sneak', false);

    // 3.4 Gehaltenes Item ist Verbrauchsgegenstand (z. B. Brot) -> activateItem
    bot.heldItem = { type: 297, name: 'bread', count: 16 };
    bot.activateItemCalls = [];
    const breadRes = await controller.interactOrPlace(refStone);
    assert.strictEqual(breadRes.success, true, '3.6 Essen in der Hand aktiviert Item');
    assert.strictEqual(breadRes.action, 'activate_item', '3.6 action ist activate_item');
    assert.strictEqual(bot.activateItemCalls.length, 1, '3.6 bot.activateItem aufgerufen');

    controller.deactivate();
    console.log('[PASS] Testgruppe 3: Blockplatzierung & Interaktion erfolgreich verifiziert.');
  }

  // -------------------------------------------------------------
  // Testgruppe 4: WebSocket Dispatcher Routing mit targetBlockPos & targetFace
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 4: WebSocket Dispatcher End-to-End Routing ---');
  {
    const bot = createRealisticBot();
    manualController.activate(bot);

    const mockWs = {
      sent: [],
      send(data) { this.sent.push(JSON.parse(data)); }
    };
    const context = {
      currentBot: bot,
      broadcast(msg) { mockWs.sent.push(msg); }
    };

    // Client sendet dig_start mit exakten Koordinaten
    bot.digCalls = [];
    await handleClientWsMessage({
      type: 'manual_action',
      action: 'dig_start',
      targetBlockPos: { x: 100, y: 64, z: 197 },
      targetFace: { x: 0, y: 1, z: 0 }
    }, mockWs, context);

    assert.strictEqual(manualController.isDigging, true, '4.1 dig_start über WS versetzt in Abbau');
    assert.strictEqual(bot.digCalls.length, 1, '4.1 bot.dig wurde aufgerufen');
    assert.strictEqual(bot.digCalls[0].block.name, 'stone', '4.1 Abzubauender Block ist stone');

    // Client sendet dig_stop
    bot.stopDiggingCalls = 0;
    await handleClientWsMessage({
      type: 'manual_action',
      action: 'dig_stop'
    }, mockWs, context);
    assert.strictEqual(manualController.isDigging, false, '4.2 dig_stop über WS beendet Abbau');
    assert.strictEqual(bot.stopDiggingCalls, 1, '4.2 bot.stopDigging aufgerufen');

    // Client sendet place mit targetBlockPos und targetFace
    bot.heldItem = { type: 1, name: 'stone', count: 64 };
    bot.placeBlockWithOptionsCalls = [];
    await handleClientWsMessage({
      type: 'manual_action',
      action: 'place',
      targetBlockPos: { x: 100, y: 64, z: 197 },
      targetFace: { x: 0, y: 1, z: 0 }
    }, mockWs, context);

    assert.strictEqual(bot.placeBlockWithOptionsCalls.length, 1, '4.3 place über WS platziert Block');
    assert.strictEqual(bot.placeBlockWithOptionsCalls[0].options.forceLook, 'ignore', '4.3 forceLook ist "ignore"');

    manualController.deactivate();
    console.log('[PASS] Testgruppe 4: WebSocket Dispatcher Routing erfolgreich verifiziert.');
  }

  // -------------------------------------------------------------
  // Testgruppe 5: Dashboard Server Telemetrie-Payloads
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 5: Dashboard Server Telemetrie-Payloads ---');
  {
    const bot = createRealisticBot();
    manualController.activate(bot);
    manualController.startDigging({ name: 'stone', position: new Vec3(100, 64, 197) });

    let capturedTelemetry = null;
    dashboardServer.currentBot = bot;
    const origBroadcast = dashboardServer.broadcast;
    dashboardServer.broadcast = (msg) => {
      if (msg.type === 'bot_telemetry') capturedTelemetry = msg;
    };

    dashboardServer.sendTelemetry();
    assert(capturedTelemetry !== null, '5.1 Telemetrie wurde generiert');
    assert(capturedTelemetry.raycast !== undefined, '5.2 raycast ist in Telemetrie enthalten');
    assert(capturedTelemetry.manualControl !== undefined, '5.3 manualControl ist in Telemetrie enthalten');
    assert.strictEqual(capturedTelemetry.manualControl.isDigging, true, '5.4 isDigging wird wahrheitsgemäß übertragen');
    assert(typeof capturedTelemetry.manualControl.digProgress === 'number', '5.5 digProgress ist eine Zahl');

    dashboardServer.broadcast = origBroadcast;
    manualController.deactivate();
    console.log('[PASS] Testgruppe 5: Dashboard Server Telemetrie-Payloads erfolgreich verifiziert.');
  }

  console.log('\n================================================================');
  console.log('  ERGEBNIS: ALLE TESTS DER BLOCK INTERACTION SUITE BESTANDEN!');
  console.log('================================================================');
}

runSuite().catch(err => {
  console.error('\n[FEHLER in Test Suite]:', err);
  process.exit(1);
});
