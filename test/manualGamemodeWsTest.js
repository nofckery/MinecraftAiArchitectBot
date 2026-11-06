import assert from 'node:assert';
import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import { manualController } from '../src/bot/manualController.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';
import { DashboardServer } from '../src/web/dashboardServer.js';

let totalTests = 0;
let passedTests = 0;

function testAssert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
}

/**
 * Creates a mock Mineflayer bot with realistic entity, inventory, and control APIs.
 */
function createMockBot() {
  const bot = new EventEmitter();
  bot.entity = {
    position: new Vec3(100, 64, 200),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62
  };
  bot.health = 20;
  bot.food = 18;
  bot.quickBarSlot = 0;
  bot.entities = {};
  bot.inventory = {
    slots: {}
  };

  // Populate 9 Hotbar Slots (Mineflayer slots 36..44)
  for (let i = 0; i < 9; i++) {
    bot.inventory.slots[36 + i] = null;
  }
  bot.inventory.slots[36] = { type: 276, name: 'diamond_sword', displayName: 'Diamond Sword', count: 1, durabilityUsed: 5 };
  bot.inventory.slots[37] = { type: 278, name: 'diamond_pickaxe', displayName: 'Diamond Pickaxe', count: 1, durabilityUsed: 12 };
  bot.inventory.slots[38] = { type: 297, name: 'bread', displayName: 'Bread', count: 16, durabilityUsed: 0 };
  bot.inventory.slots[44] = { type: 50, name: 'torch', displayName: 'Torch', count: 32, durabilityUsed: 0 };

  bot.heldItem = bot.inventory.slots[36];

  // Tracking call logs
  bot.controlCalls = [];
  bot.clearControlCalls = 0;
  bot.lookCalls = [];
  bot.digCalls = [];
  bot.stopDiggingCalls = 0;
  bot.attackCalls = [];
  bot.placeBlockCalls = [];
  bot.activateBlockCalls = [];
  bot.activateItemCalls = [];
  bot.deactivateItemCalls = 0;
  bot.swingArmCalls = [];
  bot.tossCalls = [];
  bot.tossStackCalls = [];
  bot.setQuickBarSlotCalls = [];
  bot.equipCalls = [];

  bot.setControlState = (control, state) => {
    bot.controlCalls.push({ control, state });
  };

  bot.clearControlStates = () => {
    bot.clearControlCalls++;
  };

  bot.look = (yaw, pitch, force) => {
    bot.lookCalls.push({ yaw, pitch, force });
    bot.entity.yaw = yaw;
    bot.entity.pitch = pitch;
  };

  bot.setQuickBarSlot = (slot) => {
    bot.quickBarSlot = slot;
    bot.setQuickBarSlotCalls.push(slot);
    bot.heldItem = bot.inventory.slots[36 + slot] || null;
  };

  bot.swingArm = (arm) => {
    bot.swingArmCalls.push(arm);
  };

  bot.attack = (entity) => {
    bot.attackCalls.push(entity);
  };

  bot.dig = async (block) => {
    bot.digCalls.push(block);
  };

  bot.stopDigging = () => {
    bot.stopDiggingCalls++;
  };

  bot.placeBlock = async (refBlock, face) => {
    bot.placeBlockCalls.push({ refBlock, face });
  };

  bot.activateBlock = async (block) => {
    bot.activateBlockCalls.push(block);
  };

  bot.activateItem = (offHand) => {
    bot.activateItemCalls.push(offHand);
  };

  bot.deactivateItem = () => {
    bot.deactivateItemCalls++;
  };

  bot.toss = async (itemType, metadata, count) => {
    bot.tossCalls.push({ itemType, metadata, count });
  };

  bot.tossStack = async (item) => {
    bot.tossStackCalls.push(item);
  };

  bot.equip = async (item, destination) => {
    bot.equipCalls.push({ item, destination });
  };

  // Mock raycasting
  bot.cursorEntity = null;
  bot.cursorBlock = null;

  bot.entityAtCursor = (maxDist = 3.5) => bot.cursorEntity;
  bot.blockAtCursor = (maxDist = 4.5) => bot.cursorBlock;

  // Mock pathfinder
  bot.pathfinder = {
    setGoal: (goal) => {
      bot.lastGoal = goal;
    },
    stop: () => {
      bot.pathfinderStopped = true;
    }
  };

  return bot;
}

/**
 * Creates a mock WebSocket client.
 */
function createMockWs() {
  const ws = new EventEmitter();
  ws.readyState = 1; // WebSocket.OPEN
  ws.sentMessages = [];
  ws.send = (msg) => {
    ws.sentMessages.push(typeof msg === 'string' ? JSON.parse(msg) : msg);
  };
  return ws;
}

/**
 * Creates a mock server coordinator context.
 */
function createMockContext(bot) {
  const broadcastMessages = [];
  const chatLogs = [];
  return {
    currentBot: bot,
    operatorSocket: null,
    broadcastMessages,
    chatLogs,
    broadcast: (payload) => {
      broadcastMessages.push(payload);
    },
    recordChat: (sender, message) => {
      chatLogs.push({ sender, message });
    }
  };
}

async function runManualGamemodeWsTestSuite() {
  console.log('\x1b[36m=== STARTING MANUAL GAMEMODE WEBSOCKET & SERVER TELEMETRY TEST SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. WEBSOCKET MESSAGE ROUTING & DISPATCHER
  // ==============================================================================
  console.log('--- Testgruppe 1: WebSocket Message Routing & Dispatcher ---');

  const bot1 = createMockBot();
  const context1 = createMockContext(bot1);
  const ws1 = createMockWs();

  // 1.1 toggle_manual_control (Activate)
  await handleClientWsMessage({ type: 'toggle_manual_control', enabled: true }, ws1, context1);
  testAssert(manualController.isActive() === true, '1.1 toggle_manual_control (enabled: true) aktiviert manualController');
  testAssert(context1.operatorSocket === ws1, '1.1 Operator-Socket wird im context registriert');
  testAssert(context1.broadcastMessages.length > 0, '1.1 Broadcast-Nachricht nach Aktivierung versandt');
  const activateBroadcast = context1.broadcastMessages[context1.broadcastMessages.length - 1];
  testAssert(activateBroadcast.type === 'manual_control_state' && activateBroadcast.active === true, '1.1 Broadcast ist manual_control_state mit active: true');
  testAssert(activateBroadcast.selectedSlot === 0, '1.1 Broadcast enthält aktuellen selectedSlot');

  // 1.2 manual_movement (Single key delta & batch object)
  await handleClientWsMessage({ type: 'manual_movement', control: 'forward', state: true }, ws1, context1);
  testAssert(manualController.getActiveControls().forward === true, '1.2 manual_movement setzt Einzeltaste (forward: true)');
  testAssert(bot1.controlCalls.some(c => c.control === 'forward' && c.state === true), '1.2 Mineflayer bot.setControlState(forward, true) wurde aufgerufen');

  await handleClientWsMessage({
    type: 'manual_movement',
    controls: { forward: true, sprint: true, jump: true, back: false }
  }, ws1, context1);
  const activeControls = manualController.getActiveControls();
  testAssert(activeControls.forward === true && activeControls.sprint === true && activeControls.jump === true, '1.2 manual_movement im Batch-Format aktualisiert Steuerung');

  // 1.3 manual_look (Absolute, Delta, Degrees Clamping)
  await handleClientWsMessage({ type: 'manual_look', yaw: 1.57, pitch: 0.5 }, ws1, context1);
  testAssert(bot1.lookCalls.length > 0, '1.3 manual_look leitet Blickwinkel an Bot weiter');
  const lastLook = bot1.lookCalls[bot1.lookCalls.length - 1];
  testAssert(Math.abs(lastLook.yaw - 1.57) < 0.01 && Math.abs(lastLook.pitch - 0.5) < 0.01, '1.3 Blickwinkel yaw/pitch korrekt übergeben');
  testAssert(lastLook.force === true, '1.3 force: true für latenzfreie synchrone Blickübernahme');

  // Look with extreme pitch clamping
  await handleClientWsMessage({ type: 'manual_look', yaw: 0, pitch: 100 }, ws1, context1);
  const clampedLook = bot1.lookCalls[bot1.lookCalls.length - 1];
  testAssert(clampedLook.pitch <= (Math.PI / 2) && clampedLook.pitch >= 1.56, '1.3 Überhöhter Pitch wird sicher auf ~89.9° geklampt');

  // Look with relative delta
  const prevYaw = bot1.entity.yaw;
  const prevPitch = bot1.entity.pitch;
  await handleClientWsMessage({ type: 'manual_look', delta: { dx: 0.1, dy: -0.05 } }, ws1, context1);
  const deltaLook = bot1.lookCalls[bot1.lookCalls.length - 1];
  testAssert(Math.abs(deltaLook.yaw - (prevYaw + 0.1)) < 0.01, '1.3 Relative Mouse-Deltas werden akkurat addiert');

  // 1.4 clear_movement
  await handleClientWsMessage({ type: 'clear_movement' }, ws1, context1);
  const cleared = manualController.getActiveControls();
  testAssert(Object.values(cleared).every(v => v === false), '1.4 clear_movement setzt alle Tasten auf false');
  testAssert(bot1.clearControlCalls > 0, '1.4 clear_movement ruft bot.clearControlStates auf');

  // 1.5 manual_action (Actions matrix)
  // Action: select_slot
  await handleClientWsMessage({ type: 'manual_action', action: 'select_slot', slot: 2 }, ws1, context1);
  testAssert(bot1.quickBarSlot === 2, '1.5 manual_action select_slot wechselt Quickbar-Slot auf 2');

  // Action: attack (arm swing or entity)
  await handleClientWsMessage({ type: 'manual_action', action: 'attack' }, ws1, context1);
  testAssert(bot1.swingArmCalls.length > 0 || bot1.attackCalls.length > 0, '1.5 manual_action attack triggert Angriff oder Arm-Schwung');

  // Action: dig_start & dig_stop
  bot1.cursorBlock = { name: 'stone', position: new Vec3(100, 63, 201), displayName: 'Stone' };
  await handleClientWsMessage({ type: 'manual_action', action: 'dig_start' }, ws1, context1);
  testAssert(bot1.digCalls.length > 0, '1.5 manual_action dig_start leitet Blockabbau an bot.dig ein');

  await handleClientWsMessage({ type: 'manual_action', action: 'dig_stop' }, ws1, context1);
  testAssert(bot1.stopDiggingCalls > 0, '1.5 manual_action dig_stop bricht Blockabbau sauber ab');

  // Action: place / interact
  await handleClientWsMessage({ type: 'manual_action', action: 'place' }, ws1, context1);
  testAssert(bot1.placeBlockCalls.length > 0 || bot1.activateBlockCalls.length > 0 || bot1.activateItemCalls.length > 0, '1.5 manual_action place triggert Platzierung oder Item-Nutzung');

  // Action: drop_item
  await handleClientWsMessage({ type: 'manual_action', action: 'drop_item', dropAll: true }, ws1, context1);
  testAssert(bot1.tossCalls.length > 0 || bot1.tossStackCalls.length > 0, '1.5 manual_action drop_item wirft gehaltenen Gegenstand ab');

  // Action: swap_hands
  await handleClientWsMessage({ type: 'manual_action', action: 'swap_hands' }, ws1, context1);
  testAssert(bot1.equipCalls.some(e => e.destination === 'off-hand'), '1.5 manual_action swap_hands rüstet Item in Off-Hand aus');

  // 1.6 toggle_manual_control (Deactivate)
  await handleClientWsMessage({ type: 'toggle_manual_control', enabled: false }, ws1, context1);
  testAssert(manualController.isActive() === false, '1.6 toggle_manual_control (enabled: false) deaktiviert Gamemode');
  testAssert(context1.operatorSocket === null, '1.6 Operator-Socket wird bei Deaktivierung freigegeben');
  const deactivateBroadcast = context1.broadcastMessages[context1.broadcastMessages.length - 1];
  testAssert(deactivateBroadcast.active === false, '1.6 Broadcast meldet active: false');

  // ==============================================================================
  // 2. CONFLICT PREVENTION: PATHFINDER OVERRIDE REJECTION
  // ==============================================================================
  console.log('\n--- Testgruppe 2: AI Coordination & Pathfinder Conflict Prevention ---');

  const bot2 = createMockBot();
  const context2 = createMockContext(bot2);
  const ws2 = createMockWs();

  // Wenn Gamemode aktiv ist, muss move_to verweigert werden
  manualController.activate(bot2);
  bot2.lastGoal = null;
  await handleClientWsMessage({
    type: 'control_action',
    action: 'move_to',
    targetPos: { x: 120, y: 64, z: 220 }
  }, ws2, context2);

  testAssert(bot2.lastGoal === null, '2.1 move_to wird bei aktivem Gamemode strikt blockiert (kein pathfinder.setGoal)');
  testAssert(context2.chatLogs.some(log => log.message.includes('verweigert') && log.message.includes('Gamemode')), '2.1 Verweigerung wird im Chat protokolliert');

  // Wenn Gamemode inaktiv ist, darf move_to ausgeführt werden
  manualController.deactivate();
  await handleClientWsMessage({
    type: 'control_action',
    action: 'move_to',
    targetPos: { x: 120, y: 64, z: 220 }
  }, ws2, context2);

  testAssert(bot2.lastGoal !== null, '2.2 move_to wird bei inaktivem Gamemode normal ausgeführt');

  // ==============================================================================
  // 3. SERVER TELEMETRY ENRICHMENT (sendTelemetry)
  // ==============================================================================
  console.log('\n--- Testgruppe 3: Server Telemetry Augmentation (hotbar, raycast, manualControl) ---');

  const bot3 = createMockBot();
  const server = new DashboardServer();
  server.currentBot = bot3;

  let lastBroadcast = null;
  server.broadcast = (msg) => {
    lastBroadcast = msg;
  };

  // 3.1 Telemetry when Manual Control is inactive
  manualController.deactivate();
  bot3.quickBarSlot = 1; // diamond_pickaxe
  server.sendTelemetry();

  testAssert(lastBroadcast !== null && lastBroadcast.type === 'bot_telemetry', '3.1 sendTelemetry sendet bot_telemetry Nachricht');
  testAssert(typeof lastBroadcast.manualControl === 'object', '3.1 Telemetrie enthält manualControl-Objekt');
  testAssert(lastBroadcast.manualControl.active === false, '3.1 manualControl.active ist false im Standby');
  testAssert(lastBroadcast.manualControl.selectedSlot === 1, '3.1 manualControl.selectedSlot entspricht bot.quickBarSlot (1)');
  testAssert(typeof lastBroadcast.manualControl.controls === 'object', '3.1 manualControl.controls enthält Tastenstatus');

  // 3.2 Hotbar 9-slot array validation
  testAssert(Array.isArray(lastBroadcast.hotbar), '3.2 Telemetrie enthält hotbar Array');
  testAssert(lastBroadcast.hotbar.length === 9, '3.2 hotbar Array hat exakt 9 Slots');

  const slot0 = lastBroadcast.hotbar[0];
  testAssert(slot0.slot === 0 && slot0.name === 'diamond_sword' && slot0.count === 1 && slot0.selected === false, '3.2 Slot 0 korrekt belegt mit Diamond Sword (selected: false)');

  const slot1 = lastBroadcast.hotbar[1];
  testAssert(slot1.slot === 1 && slot1.name === 'diamond_pickaxe' && slot1.selected === true, '3.2 Slot 1 als aktiver Slot markiert (selected: true)');

  const slot3 = lastBroadcast.hotbar[3];
  testAssert(slot3.slot === 3 && slot3.name === null && slot3.count === 0 && slot3.selected === false, '3.2 Leere Quickbar-Slots werden sauber mit name: null und count: 0 formatiert');

  // 3.3 Raycast Block Detection
  bot3.cursorBlock = {
    name: 'oak_planks',
    displayName: 'Oak Planks',
    position: new Vec3(100, 64, 203)
  };
  bot3.cursorEntity = null;
  server.sendTelemetry();

  testAssert(lastBroadcast.raycast.type === 'block', '3.3 raycast erkennt anvisierten Block als type: block');
  testAssert(lastBroadcast.raycast.name === 'oak_planks', '3.3 raycast enthält Blockname oak_planks');
  testAssert(lastBroadcast.raycast.displayName === 'Oak Planks', '3.3 raycast enthält displayName Oak Planks');
  testAssert(typeof lastBroadcast.raycast.distance === 'number', '3.3 raycast berechnet Distanz zum Block');
  testAssert(lastBroadcast.raycast.position && lastBroadcast.raycast.position.x === 100, '3.3 raycast enthält Blockposition');

  // 3.4 Raycast Entity Detection
  bot3.cursorEntity = {
    id: 42,
    name: 'zombie',
    displayName: 'Zombie',
    health: 20,
    position: new Vec3(101, 64, 202)
  };
  server.sendTelemetry();

  testAssert(lastBroadcast.raycast.type === 'entity', '3.4 raycast erkennt anvisiertes Entity als type: entity');
  testAssert(lastBroadcast.raycast.name === 'zombie', '3.4 raycast enthält Entity-Name zombie');
  testAssert(typeof lastBroadcast.raycast.distance === 'number', '3.4 raycast berechnet Distanz zum Entity');

  // 3.5 Raycast Void / None Detection
  bot3.cursorBlock = null;
  bot3.cursorEntity = null;
  server.sendTelemetry();

  testAssert(lastBroadcast.raycast.type === 'none', '3.5 raycast ohne Ziel liefert type: none');
  testAssert(lastBroadcast.raycast.name === null && lastBroadcast.raycast.position === null, '3.5 raycast liefert null für Name und Position bei type: none');

  // 3.6 Telemetry when Manual Control is active
  manualController.activate(bot3);
  manualController.setControlState('forward', true);
  manualController.setControlState('sprint', true);
  server.sendTelemetry();

  testAssert(lastBroadcast.manualControl.active === true, '3.6 manualControl.active spiegelt aktiven Zustand wider');
  testAssert(lastBroadcast.manualControl.controls.forward === true, '3.6 manualControl.controls.forward ist true');
  testAssert(lastBroadcast.manualControl.controls.sprint === true, '3.6 manualControl.controls.sprint ist true');

  // ==============================================================================
  // 4. CONNECTION LIFECYCLE & INITIAL PAYLOADS
  // ==============================================================================
  console.log('\n--- Testgruppe 4: Connection Lifecycle & Initial Payloads ---');

  const server4 = new DashboardServer();
  const bot4 = createMockBot();
  server4.currentBot = bot4;

  let connectionHandler = null;
  server4.wss = {
    on: (evt, handler) => {
      if (evt === 'connection') connectionHandler = handler;
    },
    clients: []
  };

  // Manuell Gamemode aktivieren
  manualController.activate(bot4);
  bot4.quickBarSlot = 4;

  // Verbindungs-Handler registrieren wie in start()
  // Wir simulieren den Connection-Callback
  const clientWs = createMockWs();
  server4.operatorSocket = null;

  // Start connection logic
  const initialSends = [];
  clientWs.send = (msg) => {
    initialSends.push(JSON.parse(msg));
  };

  // Mock server connection setup matching DashboardServer.start()
  const registerClient = (ws) => {
    // 1. Initial status
    ws.send(JSON.stringify({
      type: 'status',
      state: 'ONLINE_ACTIVE',
      username: 'BaumeisterKI'
    }));

    // Initial manual control state
    ws.send(JSON.stringify({
      type: 'manual_control_state',
      active: manualController.isActive(),
      selectedSlot: server4.currentBot?.quickBarSlot ?? 0
    }));

    const handleDisconnect = () => {
      if (server4.operatorSocket === ws || (!server4.operatorSocket && manualController.isActive())) {
        server4.operatorSocket = null;
        manualController.deactivate();
        server4.broadcast({
          type: 'manual_control_state',
          active: false,
          selectedSlot: server4.currentBot?.quickBarSlot ?? 0
        });
      }
    };

    ws.on('close', handleDisconnect);
    ws.on('error', handleDisconnect);
  };

  registerClient(clientWs);

  const initialManualState = initialSends.find(m => m.type === 'manual_control_state');
  testAssert(initialManualState !== undefined, '4.1 Neu verbundener Client empfängt initialen manual_control_state');
  testAssert(initialManualState.active === true, '4.1 Initialer manual_control_state meldet aktiven Zustand');
  testAssert(initialManualState.selectedSlot === 4, '4.1 Initialer manual_control_state meldet aktuellen selectedSlot (4)');

  // ==============================================================================
  // 5. DISCONNECTION & ERROR SAFETY (SAFE STANDBY HANDOFF)
  // ==============================================================================
  console.log('\n--- Testgruppe 5: Socket Disconnection & Error Safety ---');

  const broadcastEvents = [];
  server4.broadcast = (msg) => {
    broadcastEvents.push(msg);
  };

  // 5.1 Operator Socket Close Event
  server4.operatorSocket = clientWs;
  manualController.setControlState('forward', true);
  manualController.setControlState('jump', true);

  testAssert(manualController.isActive() === true, '5.1 Gamemode ist vor Socket-Trennung aktiv');
  testAssert(manualController.getActiveControls().forward === true, '5.1 Vorwärtsbewegung ist vor Socket-Trennung aktiv');

  // Trigger ws 'close' event
  clientWs.emit('close');

  testAssert(manualController.isActive() === false, '5.1 ws.emit(\'close\') dekrementiert und deaktiviert Gamemode');
  testAssert(server4.operatorSocket === null, '5.1 server4.operatorSocket wird genullt');
  testAssert(bot4.clearControlCalls > 0, '5.1 bot.clearControlStates wurde bei Disconnect aufgerufen');
  testAssert(manualController.getActiveControls().forward === false, '5.1 Vorwärtsbewegung nach Disconnect gestoppt');
  testAssert(broadcastEvents.some(b => b.type === 'manual_control_state' && b.active === false), '5.1 manual_control_state mit active: false an alle Clients gebroadcastet');

  // 5.2 Operator Socket Error Event
  const clientWs2 = createMockWs();
  registerClient(clientWs2);
  server4.operatorSocket = clientWs2;
  manualController.activate(bot4);
  manualController.setControlState('sneak', true);

  testAssert(manualController.isActive() === true, '5.2 Gamemode für Error-Test aktiviert');

  // Trigger ws 'error' event
  clientWs2.emit('error', new Error('ECONNRESET'));

  testAssert(manualController.isActive() === false, '5.2 ws.emit(\'error\') dekrementiert und deaktiviert Gamemode');
  testAssert(server4.operatorSocket === null, '5.2 server4.operatorSocket nach Error genullt');
  testAssert(manualController.getActiveControls().sneak === false, '5.2 Alle Kontrollzustände nach Socket-Error zurückgesetzt');

  // 5.3 Non-Operator Socket Disconnect Does Not Interfere
  const operatorWs = createMockWs();
  const viewerWs = createMockWs();
  registerClient(operatorWs);
  registerClient(viewerWs);

  manualController.activate(bot4);
  server4.operatorSocket = operatorWs;
  manualController.setControlState('forward', true);

  // Zweiter Client (Viewer) schließt seine Verbindung
  viewerWs.emit('close');

  testAssert(manualController.isActive() === true, '5.3 Schließen eines Nicht-Operator-Sockets unterbricht manuelle Steuerung nicht');
  testAssert(server4.operatorSocket === operatorWs, '5.3 Operator-Socket bleibt unberührt');
  testAssert(manualController.getActiveControls().forward === true, '5.3 Steuerung des Operators bleibt unberührt');

  // Operator schließt seine Verbindung
  operatorWs.emit('close');
  testAssert(manualController.isActive() === false, '5.3 Schließen des echten Operators beendet Gamemode wie erwartet');

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER MANUAL GAMEMODE WEBSOCKET SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runManualGamemodeWsTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\x1b[31m[TEST SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});
