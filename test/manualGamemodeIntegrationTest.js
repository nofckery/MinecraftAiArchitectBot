/**
 * Milestone M4: Manual Gamemode End-to-End Integration & AI Coordination Test Suite
 *
 * Tying together:
 * - Backend ManualController & autonomous bot systems (WorldExecutor, ThreatManager, SleepController, Pathfinder, BotClient)
 * - WebSocket Server (DashboardServer, dashboardWsDispatcher, connection lifecycle, operator ownership, telemetry broadcast)
 * - Frontend manual cockpit contracts (WASD, look clamping, actions, stuck-key prevention, standby handoff on exit)
 *
 * Test Groups:
 * 1. Full Takeover Lifecycle & Autonomous AI Coordination
 * 2. Real-Time Controls Dispatch & Mouse Clamping
 * 3. Discrete Player Actions (Combat, Mining, Building, Quickbar, Toss)
 * 4. 3-Layer Stuck-Key Prevention & Recovery
 * 5. Telemetry Stream Broadcast (500ms Tick) & HUD Integration
 * 6. Operator Socket Disconnection & Error Safety
 * 7. Standby Handoff on Exit & Autonomous Invariance (No Auto-Resume)
 * 8. Comprehensive End-to-End Mission Scenario (Takeover -> Play -> Conflict -> Blur -> Exit)
 */

import assert from 'node:assert';
import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import {
  ManualController,
  manualController,
  CONTROL_NAMES,
  INTERACTABLE_BLOCKS
} from '../src/bot/manualController.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { threatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { sleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { BotClient } from '../src/bot/botClient.js';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';

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
 * Creates a realistic mock Mineflayer bot with full physics, inventory,
 * entity tracking, pathfinder, and action APIs.
 */
function createMockBot(initialPos = new Vec3(100, 64, 200)) {
  const bot = new EventEmitter();
  bot.username = 'BaumeisterKI';
  bot.version = '1.21.4';
  bot.entity = {
    position: initialPos.clone(),
    yaw: 0,
    pitch: 0,
    eyeHeight: 1.62
  };
  bot.health = 20;
  bot.food = 19;
  bot.quickBarSlot = 0;
  bot.entities = {};
  bot.controlStates = {};
  for (const c of CONTROL_NAMES) {
    bot.controlStates[c] = false;
  }

  // Inventory slots (slots 36..44 are quickbar / hotbar in Mineflayer)
  bot.inventory = {
    slots: {},
    items: () => {
      return Object.values(bot.inventory.slots).filter(Boolean);
    }
  };
  for (let i = 0; i < 9; i++) {
    bot.inventory.slots[36 + i] = null;
  }

  // Default hotbar setup
  bot.inventory.slots[36] = {
    type: 276,
    name: 'diamond_sword',
    displayName: 'Diamond Sword',
    count: 1,
    durabilityUsed: 10
  };
  bot.inventory.slots[37] = {
    type: 278,
    name: 'diamond_pickaxe',
    displayName: 'Diamond Pickaxe',
    count: 1,
    durabilityUsed: 42
  };
  bot.inventory.slots[38] = {
    type: 297,
    name: 'bread',
    displayName: 'Bread',
    count: 16,
    durabilityUsed: 0
  };
  bot.inventory.slots[39] = {
    type: 1,
    name: 'stone',
    displayName: 'Stone',
    count: 64,
    durabilityUsed: 0
  };
  bot.heldItem = bot.inventory.slots[36];

  // Call tracking
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

  // Pathfinder mock
  bot.pathfinderCalls = { stop: 0, setGoal: [] };
  bot.pathfinder = {
    goal: null,
    setGoal: (goal) => {
      bot.pathfinder.goal = goal;
      bot.pathfinderCalls.setGoal.push(goal);
    },
    stop: () => {
      bot.pathfinder.goal = null;
      bot.pathfinderCalls.stop++;
    },
    setMovements: () => {}
  };

  // Cursor raycast targets
  bot.cursorEntity = null;
  bot.cursorBlock = null;
  bot.entityAtCursor = (maxDist = 3.5) => bot.cursorEntity;
  bot.blockAtCursor = (maxDist = 4.5) => bot.cursorBlock;

  // Implementation methods
  bot.setControlState = (control, state) => {
    bot.controlStates[control] = !!state;
    bot.controlCalls.push({ control, state: !!state });
  };

  bot.clearControlStates = () => {
    for (const c of CONTROL_NAMES) {
      bot.controlStates[c] = false;
    }
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

  bot.swingArm = (arm = 'right') => {
    bot.swingArmCalls.push(arm);
  };

  bot.attack = (entity) => {
    bot.attackCalls.push(entity);
  };

  bot.dig = (block) => {
    bot.digCalls.push(block);
    return new Promise((resolve) => {
      bot.resolveDig = resolve;
    });
  };

  bot.stopDigging = () => {
    bot.stopDiggingCalls++;
    if (bot.resolveDig) {
      bot.resolveDig();
      bot.resolveDig = null;
    }
  };

  bot.placeBlock = async (refBlock, faceVector) => {
    bot.placeBlockCalls.push({ refBlock, faceVector });
  };

  bot.activateBlock = async (block) => {
    bot.activateBlockCalls.push(block);
  };

  bot.activateItem = (offHand = false) => {
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

  return bot;
}

/**
 * Creates a mock WebSocket client representing a browser cockpit connection.
 */
function createMockClientWs(name = 'cockpit_client') {
  const ws = new EventEmitter();
  ws.name = name;
  ws.readyState = 1; // WebSocket.OPEN
  ws.sentMessages = [];
  ws.send = (msg) => {
    const parsed = typeof msg === 'string' ? JSON.parse(msg) : msg;
    ws.sentMessages.push(parsed);
  };
  return ws;
}

/**
 * Helper to create a test harness integrating DashboardServer with mock bot.
 */
function createTestHarness(bot) {
  const server = new DashboardServer();
  server.currentBot = bot;
  server.operatorSocket = null;
  server.broadcastMessages = [];

  server.broadcast = (payload) => {
    server.broadcastMessages.push(payload);
  };

  // Wire registration logic as in DashboardServer.start()
  server.registerClient = (ws) => {
    ws.send(JSON.stringify({
      type: 'status',
      state: 'ONLINE_ACTIVE',
      username: bot.username
    }));

    ws.send(JSON.stringify({
      type: 'manual_control_state',
      active: manualController.isActive(),
      selectedSlot: bot.quickBarSlot ?? 0
    }));

    const handleDisconnect = () => {
      if (server.operatorSocket === ws || (!server.operatorSocket && manualController.isActive())) {
        server.operatorSocket = null;
        manualController.deactivate();
        server.broadcast({
          type: 'manual_control_state',
          active: false,
          selectedSlot: bot.quickBarSlot ?? 0
        });
      }
    };

    ws.on('close', handleDisconnect);
    ws.on('error', handleDisconnect);
  };

  return server;
}

async function runManualGamemodeIntegrationTestSuite() {
  console.log('\x1b[36m=== STARTING MANUAL GAMEMODE END-TO-END INTEGRATION TEST SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. FULL TAKEOVER LIFECYCLE & AUTONOMOUS AI COORDINATION
  // ==============================================================================
  console.log('--- Testgruppe 1: Full Takeover Lifecycle & AI Conflict Prevention ---');
  {
    // Ensure clean initial state
    manualController.deactivate();
    const bot = createMockBot();
    const server = createTestHarness(bot);
    manualController.setBot(bot);

    // 1.1 Simulate active autonomous processes prior to takeover
    worldExecutor.isBuilding = true;
    worldExecutor.pauseRequested = false;
    worldExecutor.pausedState = {
      title: 'Tavern Foundation',
      completedOps: 10,
      totalOps: 30,
      blocks: [{ x: 10, y: 64, z: 10, name: 'stone' }]
    };
    bot.pathfinder.setGoal(new Vec3(50, 64, 50));
    threatManager.state = THREAT_STATES.ENGAGING;
    threatManager.currentTarget = { id: 777, name: 'skeleton', position: new Vec3(105, 64, 200) };
    sleepController.state = SLEEP_STATES.AWAKE;

    // Connect client
    const wsClient = createMockClientWs('operator_1');
    server.registerClient(wsClient);

    // Verify initial state received by client
    const initialGamemodeState = wsClient.sentMessages.find(m => m.type === 'manual_control_state');
    testAssert(initialGamemodeState && initialGamemodeState.active === false, '1.1 Initialer manual_control_state ist inaktiv vor Takeover');

    // 1.2 Client triggers Gamemode takeover toggle via WebSocket
    await server.handleClientMessage({ type: 'toggle_manual_control', enabled: true }, wsClient);

    // State Machine & Operator Assignment
    testAssert(manualController.isActive() === true, '1.2 manualController ist aktiv nach WS toggle_manual_control');
    testAssert(server.operatorSocket === wsClient, '1.2 wsClient ist als operatorSocket im Server registriert');

    // Broadcast Verification
    const activeBroadcast = server.broadcastMessages.find(m => m.type === 'manual_control_state' && m.active === true);
    testAssert(activeBroadcast !== undefined, '1.2 Server hat manual_control_state mit active: true gebroadcastet');

    // AI Coordination: WorldExecutor build paused
    testAssert(worldExecutor.pauseRequested === true, '1.3 worldExecutor.pauseBuild() wurde bei Gamemode-Aktivierung aufgerufen');
    testAssert(worldExecutor.pausedState !== null && worldExecutor.pausedState.title === 'Tavern Foundation', '1.3 worldExecutor hat Bauzustand in pausedState gesichert');

    // AI Coordination: Rejection of new build execution while gamemode active
    const newBuildResult = await worldExecutor.executeBatch(bot, [{ x: 10, y: 64, z: 10, name: 'stone' }]);
    testAssert(newBuildResult.success === false && newBuildResult.status === 'manual_control_locked', '1.4 worldExecutor verweigert neuen Bauauftrag mit manual_control_locked');

    // AI Coordination: Pathfinder goal stopped & cleared
    testAssert(bot.pathfinderCalls.stop >= 1, '1.5 bot.pathfinder.stop() wurde bei Gamemode-Aktivierung aufgerufen');
    testAssert(bot.pathfinder.goal === null, '1.5 bot.pathfinder.goal wurde genullt');

    // AI Coordination: Web map Pathfinder move_to rejection
    await server.handleClientMessage({
      type: 'control_action',
      action: 'move_to',
      targetPos: { x: 70, y: 64, z: 80 }
    }, wsClient);
    testAssert(bot.pathfinder.goal === null, '1.6 move_to Pfadsuche wird bei aktivem Gamemode strikt blockiert');
    const moveBlockedChat = server.chatHistory.find(c => c.message && c.message.includes('Pathfinder-Bewegung verweigert'));
    testAssert(moveBlockedChat !== undefined, '1.6 Verweigerung von move_to wird im Chat protokolliert');

    // AI Coordination: ThreatManager combat inhibition
    testAssert(threatManager.state === THREAT_STATES.IDLE, '1.7 threatManager Status wurde auf IDLE zurückgesetzt');
    testAssert(threatManager.currentTarget === null, '1.7 threatManager currentTarget wurde genullt');

    const prevYaw = bot.entity.yaw;
    const prevPitch = bot.entity.pitch;
    await threatManager.tick();
    testAssert(bot.entity.yaw === prevYaw && bot.entity.pitch === prevPitch, '1.8 threatManager.tick() überschreibt Spieler-Blickwinkel nicht');

    bot.health = 4;
    await threatManager.handleBotHurt();
    testAssert(threatManager.state === THREAT_STATES.IDLE, '1.9 threatManager.handleBotHurt() löst keinen unkontrollierten Rückzug aus');

    // AI Coordination: SleepController inhibition
    let bedSearchTriggered = false;
    const origFindBed = sleepController.findReachableBed;
    sleepController.findReachableBed = async () => { bedSearchTriggered = true; return null; };
    await sleepController.handleSleepOpportunity();
    testAssert(bedSearchTriggered === false, '1.10 sleepController.handleSleepOpportunity() sucht keine Betten während Gamemode');
    sleepController.findReachableBed = origFindBed;

    // Cleanup
    manualController.deactivate();
  }

  // ==============================================================================
  // 2. REAL-TIME CONTROLS DISPATCH & MOUSE LOOK CLAMPING
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Real-Time Controls Dispatch & Mouse Clamping ---');
  {
    manualController.deactivate();
    const bot = createMockBot();
    const server = createTestHarness(bot);
    manualController.activate(bot);
    const ws = createMockClientWs('operator_2');
    server.operatorSocket = ws;

    // 2.1 WASD, Space, Shift, Ctrl dispatch
    await server.handleClientMessage({ type: 'manual_movement', control: 'forward', state: true }, ws);
    testAssert(bot.controlStates.forward === true, '2.1 forward: true an bot.controlStates weitergeleitet');
    testAssert(manualController.getActiveControls().forward === true, '2.1 forward: true in manualController aktiv');

    await server.handleClientMessage({ type: 'manual_movement', control: 'jump', state: true }, ws);
    testAssert(bot.controlStates.jump === true, '2.2 jump: true an bot weitergeleitet');

    await server.handleClientMessage({ type: 'manual_movement', control: 'sneak', state: true }, ws);
    testAssert(bot.controlStates.sneak === true, '2.3 sneak: true an bot weitergeleitet');

    await server.handleClientMessage({ type: 'manual_movement', control: 'sprint', state: true }, ws);
    testAssert(bot.controlStates.sprint === true, '2.4 sprint: true an bot weitergeleitet');

    // Key release
    await server.handleClientMessage({ type: 'manual_movement', control: 'forward', state: false }, ws);
    testAssert(bot.controlStates.forward === false, '2.5 forward: false setzt Kontrollzustand sofort zurück');

    // Batch movement update
    await server.handleClientMessage({
      type: 'manual_movement',
      controls: { left: true, back: true, jump: false, sprint: false, sneak: false }
    }, ws);
    const active = manualController.getActiveControls();
    testAssert(active.left === true && active.back === true && active.jump === false, '2.6 Batch-Steuerung setzt mehrere Achsen konsistent');

    // 2.2 Mouse look & pitch clamping
    await server.handleClientMessage({ type: 'manual_look', yaw: 1.5, pitch: 0.5 }, ws);
    testAssert(bot.lookCalls.length > 0, '2.7 manual_look ruft bot.look auf');
    const lastLook = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(Math.abs(lastLook.yaw - 1.5) < 0.001 && Math.abs(lastLook.pitch - 0.5) < 0.001, '2.7 yaw und pitch exakt übertragen');
    testAssert(lastLook.force === true, '2.7 force: true gewährleistet latenzfreie synchrone Blickübernahme');

    // Extreme pitch clamping upward (+100 rad)
    await server.handleClientMessage({ type: 'manual_look', yaw: 0, pitch: 100 }, ws);
    const clampedUp = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(clampedUp.pitch <= (Math.PI / 2) && clampedUp.pitch >= 1.56, '2.8 Überhöhter Pitch wird sicher auf ~89.9° (+1.569 rad) geklampt');

    // Extreme pitch clamping downward (-100 rad)
    await server.handleClientMessage({ type: 'manual_look', yaw: 0, pitch: -100 }, ws);
    const clampedDown = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(clampedDown.pitch >= (-Math.PI / 2) && clampedDown.pitch <= -1.56, '2.9 Negativer Pitch wird sicher auf ~-89.9° (-1.569 rad) geklampt');

    // Degree-based look
    await server.handleClientMessage({ type: 'manual_look', yaw: 90, pitch: 45, isDegrees: true }, ws);
    const degLook = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(Math.abs(degLook.yaw - (Math.PI / 2)) < 0.01 && Math.abs(degLook.pitch - (Math.PI / 4)) < 0.01, '2.10 Grad-Eingabe wird korrekt in Radians umgerechnet');

    // Relative mouse delta accumulation
    const startYaw = bot.entity.yaw;
    const startPitch = bot.entity.pitch;
    await server.handleClientMessage({ type: 'manual_look', delta: { dx: 0.12, dy: -0.08 } }, ws);
    const deltaLook = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(Math.abs(deltaLook.yaw - (startYaw + 0.12)) < 0.001, '2.11 Relative Maus-Deltas akkumulieren Yaw präzise');
    testAssert(Math.abs(deltaLook.pitch - (startPitch - 0.08)) < 0.001, '2.11 Relative Maus-Deltas akkumulieren Pitch präzise');

    // Yaw normalization: yaw = 3 * Math.PI should normalize to -Math.PI..+Math.PI
    await server.handleClientMessage({ type: 'manual_look', yaw: 3 * Math.PI, pitch: 0 }, ws);
    const normLook = bot.lookCalls[bot.lookCalls.length - 1];
    testAssert(normLook.yaw >= -Math.PI && normLook.yaw <= Math.PI, '2.12 Yaw wird sicher in den Wertebereich [-PI, +PI] normalisiert');

    manualController.deactivate();
  }

  // ==============================================================================
  // 3. DISCRETE PLAYER ACTIONS (COMBAT, MINING, BUILDING, QUICKBAR, TOSS)
  // ==============================================================================
  console.log('\n--- Testgruppe 3: Discrete Player Actions ---');
  {
    manualController.deactivate();
    const bot = createMockBot();
    const server = createTestHarness(bot);
    manualController.activate(bot);
    const ws = createMockClientWs('operator_3');
    server.operatorSocket = ws;

    // 3.1 Combat: attack with entity under cursor
    const enemyMob = { id: 88, name: 'zombie', position: new Vec3(101, 64, 201) };
    bot.cursorEntity = enemyMob;
    await server.handleClientMessage({ type: 'manual_action', action: 'attack' }, ws);
    testAssert(bot.attackCalls.includes(enemyMob), '3.1 attack mit anvisiertem Mob ruft bot.attack(entity) auf');

    // 3.2 Combat: attack without target -> swings arm
    bot.cursorEntity = null;
    bot.cursorBlock = null;
    await server.handleClientMessage({ type: 'manual_action', action: 'attack' }, ws);
    testAssert(bot.swingArmCalls.length > 0, '3.2 attack ins Leere führt Arm-Schwung (swingArm) aus');

    // 3.3 Mining lifecycle: dig_start & dig_stop
    const targetOre = { name: 'diamond_ore', position: new Vec3(100, 63, 200) };
    bot.cursorBlock = targetOre;
    await server.handleClientMessage({ type: 'manual_action', action: 'dig_start', block: targetOre }, ws);
    testAssert(manualController.isDigging === true, '3.3 dig_start versetzt manualController in Abbau-Status (isDigging: true)');
    testAssert(bot.digCalls.some(d => d.name === 'diamond_ore'), '3.3 bot.dig wurde mit Zielblock initiiert');

    await server.handleClientMessage({ type: 'manual_action', action: 'dig_stop' }, ws);
    testAssert(manualController.isDigging === false, '3.4 dig_stop setzt Abbau-Status zurück (isDigging: false)');
    testAssert(bot.stopDiggingCalls > 0, '3.4 bot.stopDigging() wurde aufgerufen');

    // 3.4 Interacting & Placing:
    // Case A: Interact with container/door (not sneaking)
    const chestBlock = { name: 'chest', position: new Vec3(101, 64, 200) };
    bot.cursorBlock = chestBlock;
    manualController.setControlState('sneak', false);
    await server.handleClientMessage({ type: 'manual_action', action: 'place' }, ws);
    testAssert(bot.activateBlockCalls.includes(chestBlock), '3.5 place auf Kiste/Tür ohne Sneak aktiviert den Block (activateBlock)');

    // Case B: Place block while sneaking
    const solidBlock = { name: 'cobblestone', position: new Vec3(102, 64, 200) };
    bot.cursorBlock = solidBlock;
    manualController.setControlState('sneak', true);
    await server.handleClientMessage({
      type: 'manual_action',
      action: 'place',
      referenceBlock: solidBlock,
      faceVector: { x: 0, y: 1, z: 0 }
    }, ws);
    testAssert(bot.placeBlockCalls.length > 0, '3.6 place mit gedrückter Sneak-Taste platziert gehaltenen Block gegen Nachbarblock');

    // Case C: Use item with no target block (food, bow, potion)
    bot.cursorBlock = null;
    await server.handleClientMessage({ type: 'manual_action', action: 'use_item' }, ws);
    testAssert(bot.activateItemCalls.length > 0, '3.7 use_item ohne Zielblock aktiviert das gehaltene Item (activateItem)');

    // 3.5 Quickbar slot selection (0..8)
    await server.handleClientMessage({ type: 'manual_action', action: 'select_slot', slot: 2 }, ws);
    testAssert(bot.quickBarSlot === 2, '3.8 select_slot: 2 wechselt aktiven Slot auf 2');

    // Boundary validation: slots > 8 or < 0 are rejected by backend, preserving active slot
    await server.handleClientMessage({ type: 'manual_action', action: 'select_slot', slot: 99 }, ws);
    testAssert(bot.quickBarSlot === 2, '3.9 Überhöhter Slot 99 wird abgewiesen und Slot bleibt unverändert bei 2');

    await server.handleClientMessage({ type: 'manual_action', action: 'select_slot', slot: -5 }, ws);
    testAssert(bot.quickBarSlot === 2, '3.10 Negativer Slot -5 wird abgewiesen und Slot bleibt unverändert bei 2');

    // 3.6 Item toss: single item vs full stack
    await server.handleClientMessage({ type: 'manual_action', action: 'drop_item', dropAll: false }, ws);
    testAssert(bot.tossCalls.length > 0, '3.11 drop_item (dropAll: false) wirft einzelnes Item ab (bot.toss)');

    await server.handleClientMessage({ type: 'manual_action', action: 'drop_item', dropAll: true }, ws);
    testAssert(bot.tossStackCalls.length > 0, '3.12 drop_item (dropAll: true, Ctrl+Q) wirft kompletten Stack ab (bot.tossStack)');

    // 3.7 Off-hand swap
    await server.handleClientMessage({ type: 'manual_action', action: 'swap_hands' }, ws);
    testAssert(bot.equipCalls.some(e => e.destination === 'off-hand'), '3.13 swap_hands rüstet Gegenstand in der Off-Hand aus');

    manualController.deactivate();
  }

  // ==============================================================================
  // 4. 3-LAYER STUCK-KEY PREVENTION & RECOVERY
  // ==============================================================================
  console.log('\n--- Testgruppe 4: 3-Layer Stuck-Key Prevention & Recovery ---');
  {
    manualController.deactivate();
    const bot = createMockBot();
    const server = createTestHarness(bot);
    manualController.activate(bot);
    const ws = createMockClientWs('operator_4');
    server.operatorSocket = ws;

    // Simulate aggressive multi-key input
    await server.handleClientMessage({ type: 'manual_movement', control: 'forward', state: true }, ws);
    await server.handleClientMessage({ type: 'manual_movement', control: 'jump', state: true }, ws);
    await server.handleClientMessage({ type: 'manual_movement', control: 'sprint', state: true }, ws);

    testAssert(manualController.getActiveControls().forward === true, '4.1 Vorwärtsbewegung aktiv vor Blur-Event');
    testAssert(manualController.getActiveControls().jump === true, '4.1 Sprung aktiv vor Blur-Event');
    testAssert(manualController.getActiveControls().sprint === true, '4.1 Sprint aktiv vor Blur-Event');

    // Simulate frontend focus loss (window.blur / visibilitychange / pointerlockchange)
    // Frontend triggers clear_movement message over WebSocket
    bot.clearControlCalls = 0;
    await server.handleClientMessage({ type: 'clear_movement' }, ws);

    const controlsAfterClear = manualController.getActiveControls();
    testAssert(Object.values(controlsAfterClear).every(v => v === false), '4.2 clear_movement setzt alle 7 Bewegungstasten auf false');
    testAssert(bot.clearControlCalls > 0, '4.2 bot.clearControlStates() wurde ausgeführt');
    testAssert(Object.values(bot.controlStates).every(v => v === false), '4.2 bot.controlStates enthält 0 aktive Tasten');

    // Verify recovery: subsequent intentional input works normally
    await server.handleClientMessage({ type: 'manual_movement', control: 'back', state: true }, ws);
    testAssert(manualController.getActiveControls().back === true, '4.3 Nach clear_movement können neue Tastenbefehle fehlerfrei gesendet werden');

    manualController.deactivate();
  }

  // ==============================================================================
  // 5. TELEMETRY STREAM BROADCAST (500MS TICK) & HUD INTEGRATION
  // ==============================================================================
  console.log('\n--- Testgruppe 5: Telemetry Stream Broadcast & Cursor Raycast ---');
  {
    manualController.deactivate();
    const bot = createMockBot(new Vec3(120, 65, 300));
    bot.health = 18;
    bot.food = 16;
    bot.quickBarSlot = 1; // Diamond Pickaxe

    const server = createTestHarness(bot);
    manualController.activate(bot);
    manualController.setControlState('forward', true);

    // 5.1 Telemetry with block at cursor
    bot.cursorBlock = {
      name: 'gold_ore',
      displayName: 'Gold Ore',
      position: new Vec3(122, 65, 300)
    };
    bot.cursorEntity = null;

    server.broadcastMessages = [];
    server.sendTelemetry();

    const telemetry = server.broadcastMessages.find(m => m.type === 'bot_telemetry');
    testAssert(telemetry !== undefined, '5.1 sendTelemetry() sendet bot_telemetry Broadcast');

    // Manual control payload
    testAssert(telemetry.manualControl && telemetry.manualControl.active === true, '5.2 Telemetrie enthält manualControl.active: true');
    testAssert(telemetry.manualControl.selectedSlot === 1, '5.2 Telemetrie spiegelt quickBarSlot 1 wider');
    testAssert(telemetry.manualControl.controls.forward === true, '5.2 Telemetrie enthält aktiven forward Kontrollzustand');

    // Hotbar array (9 elements)
    testAssert(Array.isArray(telemetry.hotbar) && telemetry.hotbar.length === 9, '5.3 hotbar Telemetrie-Array umfasst exakt 9 Slots');
    testAssert(telemetry.hotbar[1].selected === true, '5.3 Slot 1 als aktiver Hotbar-Slot markiert');
    testAssert(telemetry.hotbar[1].name === 'diamond_pickaxe', '5.3 Slot 1 enthält Diamond Pickaxe');
    testAssert(telemetry.hotbar[0].selected === false, '5.3 Slot 0 nicht als ausgewählt markiert');
    testAssert(telemetry.hotbar[8].name === null && telemetry.hotbar[8].count === 0, '5.4 Leerer Hotbar-Slot sauber formatiert');

    // Raycast block
    testAssert(telemetry.raycast.type === 'block', '5.5 raycast erkennt anvisierten Block als type: block');
    testAssert(telemetry.raycast.name === 'gold_ore', '5.5 raycast enthält Blockname gold_ore');
    testAssert(typeof telemetry.raycast.distance === 'number' && telemetry.raycast.distance > 0, '5.5 raycast berechnet realistische Distanz');

    // 5.2 Telemetry with entity at cursor
    bot.cursorBlock = null;
    bot.cursorEntity = {
      id: 99,
      name: 'creeper',
      displayName: 'Creeper',
      position: new Vec3(121, 65, 300)
    };

    server.broadcastMessages = [];
    server.sendTelemetry();
    const entityTelemetry = server.broadcastMessages.find(m => m.type === 'bot_telemetry');
    testAssert(entityTelemetry.raycast.type === 'entity', '5.6 raycast erkennt anvisiertes Entity als type: entity');
    testAssert(entityTelemetry.raycast.name === 'creeper', '5.6 raycast enthält Entity-Name creeper');

    // 5.3 Telemetry with no target at cursor
    bot.cursorEntity = null;
    bot.cursorBlock = null;

    server.broadcastMessages = [];
    server.sendTelemetry();
    const emptyTelemetry = server.broadcastMessages.find(m => m.type === 'bot_telemetry');
    testAssert(emptyTelemetry.raycast.type === 'none', '5.7 raycast ohne Ziel liefert type: none');
    testAssert(emptyTelemetry.raycast.name === null && emptyTelemetry.raycast.distance === null, '5.7 raycast ohne Ziel nullt Attribute');

    manualController.deactivate();
  }

  // ==============================================================================
  // 6. OPERATOR SOCKET DISCONNECTION & ERROR SAFETY
  // ==============================================================================
  console.log('\n--- Testgruppe 6: Socket Disconnection & Error Safety ---');
  {
    manualController.deactivate();
    const bot = createMockBot();
    const server = createTestHarness(bot);
    manualController.activate(bot);

    const wsOperator = createMockClientWs('operator_socket');
    const wsSpectator = createMockClientWs('spectator_socket');
    server.registerClient(wsOperator);
    server.registerClient(wsSpectator);

    server.operatorSocket = wsOperator;
    manualController.setControlState('forward', true);
    manualController.setControlState('sprint', true);

    testAssert(manualController.isActive() === true, '6.1 Gamemode aktiv vor Disconnection-Tests');

    // 6.1 Non-operator spectator disconnect does NOT affect operator
    wsSpectator.emit('close');
    testAssert(manualController.isActive() === true, '6.1 Schließen eines Nicht-Operator-Sockets unterbricht den Gamemode nicht');
    testAssert(server.operatorSocket === wsOperator, '6.1 operatorSocket bleibt der aktive Spieler');
    testAssert(manualController.getActiveControls().forward === true, '6.1 Steuerung des Operators bleibt unverändert');

    // 6.2 Operator socket emits 'close' -> immediate safety shutdown
    bot.clearControlCalls = 0;
    server.broadcastMessages = [];
    wsOperator.emit('close');

    testAssert(manualController.isActive() === false, '6.2 Operator-Disconnect deaktiviert manualController sofort');
    testAssert(server.operatorSocket === null, '6.2 server.operatorSocket wird genullt');
    testAssert(bot.clearControlCalls > 0, '6.2 bot.clearControlStates() wurde beim Disconnect aufgerufen');
    testAssert(manualController.getActiveControls().forward === false, '6.2 Vorwärtsbewegung wurde gestoppt');
    testAssert(server.broadcastMessages.some(m => m.type === 'manual_control_state' && m.active === false),
      '6.2 manual_control_state mit active: false an verbleibende Clients gebroadcastet');

    // 6.3 Operator socket emits 'error' -> immediate safety shutdown
    const wsOperator2 = createMockClientWs('operator_socket_2');
    server.registerClient(wsOperator2);
    manualController.activate(bot);
    server.operatorSocket = wsOperator2;
    manualController.setControlState('jump', true);

    bot.clearControlCalls = 0;
    wsOperator2.emit('error', new Error('ECONNRESET: Connection aborted by network'));

    testAssert(manualController.isActive() === false, '6.3 Socket-Fehler (ECONNRESET) deaktiviert Gamemode sofort');
    testAssert(server.operatorSocket === null, '6.3 operatorSocket wird nach Socket-Fehler genullt');
    testAssert(bot.clearControlCalls > 0, '6.3 bot.clearControlStates() wurde nach Socket-Fehler aufgerufen');
    testAssert(manualController.getActiveControls().jump === false, '6.3 Sprungsteuerung nach Socket-Fehler gestoppt');

    manualController.deactivate();
  }

  // ==============================================================================
  // 7. STANDBY HANDOFF ON EXIT & AUTONOMOUS INVARIANCE (NO AUTO-RESUME)
  // ==============================================================================
  console.log('\n--- Testgruppe 7: Standby Handoff on Exit & Autonomous Invariance ---');
  {
    manualController.deactivate();
    const bot = createMockBot(new Vec3(200, 70, 400));
    const server = createTestHarness(bot);

    // Simulate prior paused build execution
    worldExecutor.isBuilding = false;
    worldExecutor.pausedState = {
      title: 'Tavern Great Hall',
      completedOps: 18,
      totalOps: 50,
      blocks: [{ x: 205, y: 70, z: 405, name: 'oak_planks' }]
    };

    let resumeCalled = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => {
      resumeCalled = true;
      return true;
    };

    // Activate gamemode and send actions
    manualController.activate(bot);
    const ws = createMockClientWs('operator_7');
    server.operatorSocket = ws;

    manualController.setControlState('forward', true);
    manualController.setControlState('jump', true);
    manualController.startDigging({ name: 'dirt', position: new Vec3(200, 69, 400) });

    bot.clearControlCalls = 0;
    bot.stopDiggingCalls = 0;
    bot.deactivateItemCalls = 0;

    // Operator exits Gamemode (e.g. clicks Exit button or presses ESC in frontend)
    await server.handleClientMessage({
      type: 'toggle_manual_control',
      enabled: false,
      reason: 'esc_key'
    }, ws);

    // 7.1 Verify deactivation and control cleanup
    testAssert(manualController.isActive() === false, '7.1 manualController ist nach Deaktivierung inaktiv');
    testAssert(server.operatorSocket === null, '7.1 server.operatorSocket wurde freigegeben');
    testAssert(bot.clearControlCalls > 0, '7.2 bot.clearControlStates() wurde beim Beenden aufgerufen');
    testAssert(Object.values(manualController.getActiveControls()).every(v => v === false), '7.2 Alle Tasten in manualController sind false');
    testAssert(bot.stopDiggingCalls > 0, '7.3 bot.stopDigging() wurde beim Beenden aufgerufen');
    testAssert(manualController.isDigging === false, '7.3 isDigging ist false');
    testAssert(bot.deactivateItemCalls > 0, '7.4 bot.deactivateItem() wurde aufgerufen');

    // 7.2 Standby Guarantee: Pathfinder halted and null
    testAssert(bot.pathfinderCalls.stop > 0, '7.5 bot.pathfinder.stop() im Standby aufgerufen');
    testAssert(bot.pathfinder.goal === null, '7.5 Pathfinder Goal bleibt null');

    // 7.3 CRITICAL AUTONOMOUS INVARIANCE: No auto-resume of paused builds!
    testAssert(resumeCalled === false, '7.6 worldExecutor.resumeBuild() wurde NICHT automatisch aufgerufen');
    testAssert(worldExecutor.isBuilding === false, '7.6 worldExecutor.isBuilding bleibt false');
    testAssert(worldExecutor.pausedState !== null && worldExecutor.pausedState.title === 'Tavern Great Hall',
      '7.7 worldExecutor.pausedState bleibt unverändert für spätere manuelle Wiederaufnahme erhalten');

    // 7.4 Bot remains safe and stationary at current coordinates
    testAssert(bot.entity.position.x === 200 && bot.entity.position.y === 70 && bot.entity.position.z === 400,
      '7.8 Bot verbleibt sicher und stationär an den aktuellen Koordinaten');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    manualController.deactivate();
  }

  // ==============================================================================
  // 8. COMPREHENSIVE END-TO-END MULTI-PHASE SCENARIO
  // ==============================================================================
  console.log('\n--- Testgruppe 8: End-to-End Multi-Phase Simulation ---');
  {
    manualController.deactivate();
    const bot = createMockBot(new Vec3(50, 64, 50));
    const server = createTestHarness(bot);
    manualController.setBot(bot);

    const client = createMockClientWs('e2e_pilot');
    server.registerClient(client);

    console.log('  -> Phase 1: Autonomous Building running, Client requests manual takeover...');
    worldExecutor.isBuilding = true;
    worldExecutor.pauseRequested = false;
    worldExecutor.pausedState = { title: 'Tavern Arch', completedOps: 5, totalOps: 20 };
    await server.handleClientMessage({ type: 'toggle_manual_control', enabled: true }, client);
    testAssert(manualController.isActive() === true, '8.1 Phase 1: Takeover erfolgreich eingeleitet');
    testAssert(worldExecutor.pauseRequested === true, '8.1 Phase 1: Autonomer Bauauftrag erfolgreich pausiert');
    // Autonomous loop marks execution paused
    worldExecutor.isBuilding = false;

    console.log('  -> Phase 2: Pilot navigates forward, sprints, and looks around...');
    await server.handleClientMessage({ type: 'manual_movement', control: 'forward', state: true }, client);
    await server.handleClientMessage({ type: 'manual_movement', control: 'sprint', state: true }, client);
    await server.handleClientMessage({ type: 'manual_look', delta: { dx: 0.25, dy: -0.15 } }, client);
    testAssert(manualController.getActiveControls().forward === true, '8.2 Phase 2: Pilot bewegt sich vorwärts');
    testAssert(manualController.getActiveControls().sprint === true, '8.2 Phase 2: Pilot sprintet');

    console.log('  -> Phase 3: Pilot attacks approaching mob and mines block...');
    bot.cursorEntity = { id: 501, name: 'spider' };
    await server.handleClientMessage({ type: 'manual_action', action: 'attack' }, client);
    testAssert(bot.attackCalls.some(e => e.name === 'spider'), '8.3 Phase 3: Mob-Angriff ausgeführt');

    bot.cursorEntity = null;
    bot.cursorBlock = { name: 'iron_ore', position: new Vec3(52, 64, 50) };
    await server.handleClientMessage({ type: 'manual_action', action: 'dig_start' }, client);
    testAssert(manualController.isDigging === true, '8.3 Phase 3: Erz-Abbau gestartet');
    await server.handleClientMessage({ type: 'manual_action', action: 'dig_stop' }, client);
    testAssert(manualController.isDigging === false, '8.3 Phase 3: Abbau beendet');

    console.log('  -> Phase 4: Pilot switches quickbar slot and drops item...');
    await server.handleClientMessage({ type: 'manual_action', action: 'select_slot', slot: 3 }, client);
    testAssert(bot.quickBarSlot === 3, '8.4 Phase 4: Quickbar-Slot gewechselt');
    await server.handleClientMessage({ type: 'manual_action', action: 'drop_item', dropAll: false }, client);
    testAssert(bot.tossCalls.length > 0, '8.4 Phase 4: Gegenstand abgeworfen');

    console.log('  -> Phase 5: Browser window loses focus (window.blur)...');
    await server.handleClientMessage({ type: 'clear_movement' }, client);
    testAssert(Object.values(manualController.getActiveControls()).every(v => v === false),
      '8.5 Phase 5: Stuck-Key-Schutz hat alle Tasten auf 0 zurückgesetzt');

    console.log('  -> Phase 6: Pilot presses ESC to exit Gamemode to safe Standby...');
    await server.handleClientMessage({ type: 'toggle_manual_control', enabled: false, reason: 'esc_key' }, client);
    testAssert(manualController.isActive() === false, '8.6 Phase 6: Gamemode beendet');
    testAssert(server.operatorSocket === null, '8.6 Phase 6: Operator-Socket freigegeben');
    testAssert(worldExecutor.isBuilding === false, '8.6 Phase 6: Bauauftrag verbleibt im sicheren Pausenzustand');
    testAssert(worldExecutor.pausedState !== null && worldExecutor.pausedState.title === 'Tavern Arch', '8.6 Phase 6: pausedState bleibt unverändert gesichert');
    testAssert(bot.pathfinder.goal === null, '8.6 Phase 6: Pathfinder bleibt gestoppt');

    worldExecutor.pausedState = null;
    manualController.deactivate();
  }

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER MANUAL GAMEMODE INTEGRATION TEST SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
}

runManualGamemodeIntegrationTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\x1b[31m[TEST SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});
