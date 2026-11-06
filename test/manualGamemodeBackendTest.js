import assert from 'node:assert';
import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import {
  ManualController,
  manualController,
  CONTROL_NAMES,
  INTERACTABLE_BLOCKS
} from '../src/bot/manualController.js';
import { threatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { sleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { BotClient } from '../src/bot/botClient.js';
import { dashboardServer } from '../src/web/dashboardServer.js';

function createMockBot() {
  const bot = new EventEmitter();
  bot.entity = {
    position: new Vec3(100, 64, 200),
    yaw: 0,
    pitch: 0
  };
  bot.health = 20;
  bot.quickBarSlot = 0;
  bot.heldItem = { type: 276, name: 'diamond_sword', count: 1 };
  bot.entities = {};
  bot.inventory = {
    slots: {},
    items: () => []
  };

  // 9 Hotbar Slots (Mineflayer slots 36..44)
  for (let i = 0; i < 9; i++) {
    bot.inventory.slots[36 + i] = null;
  }
  bot.inventory.slots[36] = { type: 276, name: 'diamond_sword', displayName: 'Diamond Sword', count: 1 };
  bot.inventory.slots[37] = { type: 278, name: 'diamond_pickaxe', displayName: 'Diamond Pickaxe', count: 1 };
  bot.inventory.slots[38] = { type: 297, name: 'bread', displayName: 'Bread', count: 16 };

  // Control and physics mock calls
  bot.controlCalls = [];
  bot.clearControlCalls = 0;
  bot.lookCalls = [];
  bot.digCalls = [];
  bot.stopDiggingCalls = 0;
  bot.activateBlockCalls = [];
  bot.placeBlockCalls = [];
  bot.activateItemCalls = [];
  bot.deactivateItemCalls = 0;
  bot.swingArmCalls = [];
  bot.attackCalls = [];
  bot.tossCalls = [];
  bot.tossStackCalls = [];
  bot.setQuickBarSlotCalls = [];

  bot.setControlState = (ctrl, state) => {
    bot.controlCalls.push({ ctrl, state });
  };
  bot.clearControlStates = () => {
    bot.clearControlCalls++;
  };
  bot.look = (yaw, pitch, force) => {
    bot.lookCalls.push({ yaw, pitch, force });
    bot.entity.yaw = yaw;
    bot.entity.pitch = pitch;
  };
  bot.dig = (block, forceLook) => {
    bot.digCalls.push({ block, forceLook });
    return Promise.resolve();
  };
  bot.stopDigging = () => {
    bot.stopDiggingCalls++;
  };
  bot.activateBlock = async (block) => {
    bot.activateBlockCalls.push(block);
  };
  bot.placeBlock = async (block, faceVector) => {
    bot.placeBlockCalls.push({ block, faceVector });
  };
  bot.activateItem = (offHand = false) => {
    bot.activateItemCalls.push(offHand);
  };
  bot.deactivateItem = () => {
    bot.deactivateItemCalls++;
  };
  bot.swingArm = (hand) => {
    bot.swingArmCalls.push(hand);
  };
  bot.attack = (entity) => {
    bot.attackCalls.push(entity);
  };
  bot.setQuickBarSlot = (slot) => {
    bot.setQuickBarSlotCalls.push(slot);
    bot.quickBarSlot = slot;
  };
  bot.toss = async (type, metadata, count) => {
    bot.tossCalls.push({ type, metadata, count });
  };
  bot.tossStack = async (item) => {
    bot.tossStackCalls.push(item);
  };

  // Cursor & Raycast mock
  bot.cursorEntity = null;
  bot.cursorBlock = null;
  bot.entityAtCursor = (maxDistance) => bot.cursorEntity;
  bot.blockAtCursor = (maxDistance) => bot.cursorBlock;

  // Pathfinder mock
  bot.pathfinderCalls = { stop: 0, setGoal: [] };
  bot.pathfinder = {
    stop: () => { bot.pathfinderCalls.stop++; },
    setGoal: (goal) => { bot.pathfinderCalls.setGoal.push(goal); },
    setMovements: () => {}
  };

  return bot;
}

async function runTests() {
  console.log('\n=== STARTING MANUAL GAMEMODE BACKEND & AI COORDINATION TEST SUITE ===\n');

  // -------------------------------------------------------------
  // Testgruppe 1: Lifecycle & State Machine
  // -------------------------------------------------------------
  console.log('--- Testgruppe 1: Lifecycle & State Machine ---');
  {
    const controller = new ManualController();
    assert.strictEqual(controller.isActive(), false, '1.1 Neuer Controller ist inaktiv');

    // Aktivierung ohne Bot muss abgewiesen werden
    const actNoBot = controller.activate();
    assert.strictEqual(actNoBot, false, '1.2 Aktivierung ohne Bot schlägt fehl');
    assert.strictEqual(controller.isActive(), false, '1.2 isActive bleibt false');

    const bot = createMockBot();
    controller.setBot(bot);
    assert.strictEqual(controller.isActive(), false, '1.3 setBot allein aktiviert den Controller nicht');

    let activatedEventFired = false;
    controller.on('activated', () => { activatedEventFired = true; });

    const actResult = controller.activate();
    assert.strictEqual(actResult, true, '1.4 activate() mit gesetztem Bot liefert true');
    assert.strictEqual(controller.isActive(), true, '1.4 Controller ist aktiv');
    assert.strictEqual(activatedEventFired, true, '1.4 activated Event wurde gefeuert');

    // Idempotenz
    assert.strictEqual(controller.activate(), true, '1.5 Erneuter activate() Aufruf ist idempotent');

    // Bot-Wechsel deaktiviert automatisch
    let deactivatedEventFired = false;
    controller.on('deactivated', () => { deactivatedEventFired = true; });

    const bot2 = createMockBot();
    controller.setBot(bot2);
    assert.strictEqual(controller.isActive(), false, '1.6 setBot mit neuem Bot deaktiviert alten Zustand');
    assert.strictEqual(deactivatedEventFired, true, '1.6 deactivated Event beim Bot-Wechsel gefeuert');
  }
  console.log('[PASS] Testgruppe 1: Lifecycle & State Machine bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 2: AI Coordination & Locks
  // -------------------------------------------------------------
  console.log('--- Testgruppe 2: AI Coordination & Autonomous Locks ---');
  {
    const bot = createMockBot();
    manualController.setBot(bot);

    // 2.1 WorldExecutor Bauauftrag pausieren bei Gamemode-Aktivierung
    worldExecutor.isBuilding = true;
    let pauseCalled = false;
    const origPause = worldExecutor.pauseBuild;
    worldExecutor.pauseBuild = () => {
      pauseCalled = true;
      origPause.call(worldExecutor);
    };

    manualController.activate(bot);
    assert.strictEqual(pauseCalled, true, '2.1 Gamemode-Aktivierung ruft worldExecutor.pauseBuild() auf');
    assert.strictEqual(worldExecutor.pauseRequested, true, '2.1 pauseRequested wurde gesetzt');
    worldExecutor.pauseBuild = origPause;
    worldExecutor.isBuilding = false;
    worldExecutor.pauseRequested = false;

    // 2.2 Pathfinder anhalten & Goal nullen bei Aktivierung
    assert.strictEqual(bot.pathfinderCalls.stop >= 1, true, '2.2 bot.pathfinder.stop() wurde aufgerufen');
    assert.strictEqual(bot.pathfinderCalls.setGoal.includes(null), true, '2.2 bot.pathfinder.setGoal(null) wurde aufgerufen');

    // 2.3 ThreatManager Zustand auf IDLE zurücksetzen
    threatManager.state = THREAT_STATES.ENGAGING;
    threatManager.currentTarget = { id: 99 };
    threatManager.wasBuildingBeforeThreat = true;
    threatManager.backpedalUntil = 999999;

    manualController.deactivate();
    manualController.activate(bot);

    assert.strictEqual(threatManager.state, THREAT_STATES.IDLE, '2.3 ThreatManager Status wird auf IDLE zurückgesetzt');
    assert.strictEqual(threatManager.currentTarget, null, '2.3 ThreatManager currentTarget wird genullt');
    assert.strictEqual(threatManager.wasBuildingBeforeThreat, false, '2.3 wasBuildingBeforeThreat wird zurückgesetzt');
    assert.strictEqual(threatManager.backpedalUntil, 0, '2.3 backpedalUntil wird zurückgesetzt');

    // 2.4 WorldExecutor Lock: Neue Batches während manuellem Gamemode abweisen
    const batchResult = await worldExecutor.executeBatch(bot, [{ x: 10, y: 64, z: 10, name: 'stone' }]);
    assert.deepStrictEqual(batchResult, { success: false, status: 'manual_control_locked' }, '2.4 executeBatch wird mit manual_control_locked abgewiesen');
    assert.strictEqual(worldExecutor.isBuilding, false, '2.4 worldExecutor.isBuilding bleibt false');

    // 2.5 ThreatManager Inhibition: tick() und handleBotHurt() no-op während Gamemode
    threatManager.setBot(bot);
    bot.health = 5; // kritische HP
    await threatManager.handleBotHurt();
    assert.strictEqual(threatManager.state, THREAT_STATES.IDLE, '2.5 handleBotHurt führt keinen Rückzug aus bei aktiver manueller Steuerung');

    await threatManager.tick();
    assert.strictEqual(threatManager.state, THREAT_STATES.IDLE, '2.5 tick() verändert Status nicht bei aktiver manueller Steuerung');

    // 2.6 SleepController Inhibition: handleSleepOpportunity() no-op während Gamemode
    sleepController.state = SLEEP_STATES.AWAKE;
    let findBedCalled = false;
    const origFindBed = sleepController.findReachableBed;
    sleepController.findReachableBed = async () => { findBedCalled = true; return null; };

    await sleepController.handleSleepOpportunity();
    assert.strictEqual(findBedCalled, false, '2.6 handleSleepOpportunity wird inhibiert, sucht keine Betten');
    assert.strictEqual(sleepController.state, SLEEP_STATES.AWAKE, '2.6 SleepController bleibt im Status AWAKE');
    sleepController.findReachableBed = origFindBed;

    // Aufräumen
    manualController.deactivate();
  }
  console.log('[PASS] Testgruppe 2: AI Coordination & Autonomous Locks bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 3: Standby Handoff on Deactivation
  // -------------------------------------------------------------
  console.log('--- Testgruppe 3: Standby Handoff on Deactivation ---');
  {
    const bot = createMockBot();
    manualController.activate(bot);

    // Setze Bewegungen und Aktionen
    manualController.setControlState('forward', true);
    manualController.setControlState('jump', true);
    manualController.startDigging({ name: 'stone', position: new Vec3(101, 64, 200) });

    // Simuliere einen zuvor pausierten Bauauftrag
    worldExecutor.pausedState = { title: 'Pausiertes Haus', completedOps: 5, totalOps: 10 };
    let resumeCalled = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { resumeCalled = true; return true; };

    bot.clearControlCalls = 0;
    bot.stopDiggingCalls = 0;
    bot.deactivateItemCalls = 0;

    const deactResult = manualController.deactivate();
    assert.strictEqual(deactResult, true, '3.1 deactivate() liefert true');
    assert.strictEqual(manualController.isActive(), false, '3.1 Controller ist inaktiv');

    // Standby-Garantien:
    assert.strictEqual(bot.clearControlCalls >= 1, true, '3.2 bot.clearControlStates() wurde ausgeführt');
    const controls = manualController.getActiveControls();
    assert.strictEqual(Object.values(controls).every(v => v === false), true, '3.3 Alle activeControls sind false');
    assert.strictEqual(manualController.isDigging, false, '3.4 isDigging ist false');
    assert.strictEqual(bot.stopDiggingCalls >= 1, true, '3.5 bot.stopDigging() wurde aufgerufen');
    assert.strictEqual(bot.deactivateItemCalls >= 1, true, '3.6 bot.deactivateItem() wurde aufgerufen');

    // Pathfinder im Standby genullt
    assert.strictEqual(bot.pathfinderCalls.stop >= 1, true, '3.7 bot.pathfinder.stop() im Standby aufgerufen');
    assert.strictEqual(bot.pathfinderCalls.setGoal[bot.pathfinderCalls.setGoal.length - 1], null, '3.8 Pathfinder Goal im Standby genullt');

    // Standby-Garantie: KEIN automatisches Wiederaufnehmen des pausierten Bauauftrags
    assert.strictEqual(resumeCalled, false, '3.9 worldExecutor.resumeBuild() wurde NICHT automatisch aufgerufen');
    assert.strictEqual(worldExecutor.pausedState !== null, true, '3.9 worldExecutor.pausedState bleibt unverändert für spätere manuelle Wiederaufnahme gesichert');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
  }
  console.log('[PASS] Testgruppe 3: Standby Handoff on Deactivation bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 4: Movement Controls & Stuck-Key Immunity
  // -------------------------------------------------------------
  console.log('--- Testgruppe 4: Movement Controls & Stuck-Key Immunity ---');
  {
    const bot = createMockBot();
    manualController.activate(bot);

    // Alle 7 Standardsteuerungen testen
    const expectedControls = ['forward', 'back', 'left', 'right', 'jump', 'sprint', 'sneak'];
    for (const ctrl of expectedControls) {
      bot.controlCalls = [];
      const res = manualController.setControlState(ctrl, true);
      assert.strictEqual(res, true, `4.1 setControlState('${ctrl}', true) erfolgreich`);
      assert.strictEqual(manualController.getActiveControls()[ctrl], true, `4.1 getActiveControls()[${ctrl}] ist true`);
      assert.strictEqual(bot.controlCalls.some(c => c.ctrl === ctrl && c.state === true), true, `4.1 Bot erhielt ${ctrl}=true`);

      manualController.setControlState(ctrl, false);
      assert.strictEqual(manualController.getActiveControls()[ctrl], false, `4.1 getActiveControls()[${ctrl}] ist false`);
    }

    // Ungültige Control-Keys abweisen
    assert.strictEqual(manualController.setControlState('fly', true), false, '4.2 Ungültiger Steuerungsname "fly" wird abgewiesen');
    assert.strictEqual(manualController.setControlState('shoot', true), false, '4.2 Ungültiger Steuerungsname "shoot" wird abgewiesen');

    // setControls Batch-Setzung
    manualController.setControls({
      forward: true,
      sprint: true,
      jump: true,
      invalidControl: true
    });
    const active = manualController.getActiveControls();
    assert.strictEqual(active.forward, true, '4.3 setControls setzt forward');
    assert.strictEqual(active.sprint, true, '4.3 setControls setzt sprint');
    assert.strictEqual(active.jump, true, '4.3 setControls setzt jump');
    assert.strictEqual(active.sneak, false, '4.3 sneak blieb false');

    // Stuck-Key Defense: clearControls()
    bot.clearControlCalls = 0;
    manualController.clearControls();
    assert.strictEqual(bot.clearControlCalls, 1, '4.4 clearControls ruft bot.clearControlStates auf');
    const cleared = manualController.getActiveControls();
    for (const ctrl of expectedControls) {
      assert.strictEqual(cleared[ctrl], false, `4.4 ${ctrl} nach clearControls ist false`);
    }

    // Controls bei inaktivem Controller abweisen
    manualController.deactivate();
    assert.strictEqual(manualController.setControlState('forward', true), false, '4.5 setControlState wird bei inaktivem Controller ignoriert');
    assert.strictEqual(manualController.setControls({ forward: true }), false, '4.5 setControls wird bei inaktivem Controller ignoriert');
  }
  console.log('[PASS] Testgruppe 4: Movement Controls & Stuck-Key Immunity bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 5: Mouse Look Clamping & Normalization
  // -------------------------------------------------------------
  console.log('--- Testgruppe 5: Mouse Look Clamping & Normalization ---');
  {
    const bot = createMockBot();
    manualController.activate(bot);

    const pitchLimit = Math.PI / 2 - 0.001; // ~1.5698

    // 5.1 Pitch Clamping nach oben (Zenith)
    bot.lookCalls = [];
    manualController.look(0, 3.0); // Überschreitet +PI/2
    assert.strictEqual(bot.lookCalls.length, 1, '5.1 bot.look wurde aufgerufen');
    assert.strictEqual(Number(bot.lookCalls[0].pitch.toFixed(4)), Number(pitchLimit.toFixed(4)), '5.1 Pitch nach oben korrekt auf ~89.9° geklemmt');
    assert.strictEqual(bot.lookCalls[0].force, true, '5.1 force: true wurde für latenzfreie Synchronisation übergeben');

    // 5.2 Pitch Clamping nach unten (Nadir)
    bot.lookCalls = [];
    manualController.look(0, -3.0); // Unterschreitet -PI/2
    assert.strictEqual(Number(bot.lookCalls[0].pitch.toFixed(4)), Number((-pitchLimit).toFixed(4)), '5.2 Pitch nach unten korrekt auf ~ -89.9° geklemmt');
    assert.strictEqual(bot.lookCalls[0].force, true, '5.2 force: true gesetzt');

    // 5.3 Yaw Normalisierung auf [-PI, PI]
    bot.lookCalls = [];
    manualController.look(3.5 * Math.PI, 0); // 3.5 PI entspricht -0.5 PI
    const normYaw = bot.lookCalls[0].yaw;
    assert.strictEqual(normYaw >= -Math.PI && normYaw <= Math.PI, true, '5.3 Normalisiertes Yaw liegt strikt in [-PI, PI]');
    assert.strictEqual(Number(normYaw.toFixed(3)), Number((-0.5 * Math.PI).toFixed(3)), '5.3 3.5*PI wird modulo 2*PI korrekt normalisiert');

    // 5.4 Grad-zu-Radiant Konvertierung
    bot.lookCalls = [];
    manualController.look(180, 45, { isDegrees: true });
    assert.strictEqual(Number(bot.lookCalls[0].yaw.toFixed(2)), Number(Math.PI.toFixed(2)), '5.4 180° konvertiert zu PI rad');
    assert.strictEqual(Number(bot.lookCalls[0].pitch.toFixed(3)), Number((Math.PI / 4).toFixed(3)), '5.4 45° konvertiert zu PI/4 rad');

    // 5.5 Relative Mausbewegungen (Delta)
    bot.entity.yaw = 0.5;
    bot.entity.pitch = 0.2;
    bot.lookCalls = [];
    manualController.look(0.3, 0.1, { isDelta: true });
    assert.strictEqual(Number(bot.lookCalls[0].yaw.toFixed(2)), 0.8, '5.5 Delta Yaw addiert zu bestehendem Yaw');
    assert.strictEqual(Number(bot.lookCalls[0].pitch.toFixed(2)), 0.3, '5.5 Delta Pitch addiert zu bestehendem Pitch');

    // 5.6 Ungültige Eingaben (NaN)
    assert.strictEqual(manualController.look('invalid', NaN), false, '5.6 NaN-Eingaben werden abgewiesen');

    manualController.deactivate();
  }
  console.log('[PASS] Testgruppe 5: Mouse Look Clamping & Normalization bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 6: Discrete Actions (Attack, Dig, Place/Interact, Toss, Hotbar)
  // -------------------------------------------------------------
  console.log('--- Testgruppe 6: Discrete Actions ---');
  {
    const bot = createMockBot();
    manualController.activate(bot);

    // 6.1 Attack: Entity im Fokus
    const mobEntity = { id: 42, name: 'zombie', health: 20, isValid: true };
    bot.cursorEntity = mobEntity;
    bot.attackCalls = [];
    const attResult = manualController.attack();
    assert.strictEqual(attResult.success, true, '6.1 attack() erfolgreich');
    assert.strictEqual(attResult.action, 'attack_entity', '6.1 action ist attack_entity');
    assert.strictEqual(bot.attackCalls[0], mobEntity, '6.1 bot.attack wurde mit fokussiertem Entity aufgerufen');

    // 6.2 Attack Fallback: Block im Fokus -> Graben starten
    bot.cursorEntity = null;
    const targetBlock = { name: 'iron_ore', position: new Vec3(101, 64, 201), hardness: 3 };
    bot.cursorBlock = targetBlock;
    bot.digCalls = [];
    const digResult = manualController.attack();
    assert.strictEqual(digResult.success, true, '6.2 attack() fällt auf Blockabbau zurück');
    assert.strictEqual(digResult.action, 'dig_start', '6.2 action ist dig_start');
    assert.strictEqual(manualController.isDigging, true, '6.2 isDigging ist true');
    assert.strictEqual(bot.digCalls.length, 1, '6.2 bot.dig wurde aufgerufen');

    // 6.3 Attack Fallback: Weder Entity noch Block -> Arm schwingen
    manualController.stopDigging();
    bot.cursorBlock = null;
    bot.swingArmCalls = [];
    const swingResult = manualController.attack();
    assert.strictEqual(swingResult.success, true, '6.3 attack() fällt auf Armschwingen zurück');
    assert.strictEqual(swingResult.action, 'swing_arm', '6.3 action ist swing_arm');
    assert.strictEqual(bot.swingArmCalls.includes('right'), true, '6.3 Rechter Arm geschwungen');

    // 6.4 startDigging & stopDigging
    manualController.startDigging(targetBlock);
    assert.strictEqual(manualController.isDigging, true, '6.4 startDigging setzt isDigging');
    // Erneuter Aufruf am selben Block ist idempotent
    assert.strictEqual(manualController.startDigging(targetBlock), true, '6.4 Idempotentes startDigging am selben Block');
    manualController.stopDigging();
    assert.strictEqual(manualController.isDigging, false, '6.4 stopDigging beendet Graben');

    // 6.5 interactOrPlace: Interaktion mit Kiste (nicht schleichend)
    const chestBlock = { name: 'chest', position: new Vec3(100, 64, 202) };
    bot.cursorBlock = chestBlock;
    bot.activateBlockCalls = [];
    const actBlockResult = await manualController.interactOrPlace();
    assert.strictEqual(actBlockResult.success, true, '6.5 interactOrPlace auf Kiste erfolgreich');
    assert.strictEqual(actBlockResult.action, 'activate_block', '6.5 action ist activate_block');
    assert.strictEqual(bot.activateBlockCalls[0], chestBlock, '6.5 bot.activateBlock aufgerufen');

    // 6.6 interactOrPlace: Schleichen überstimmt Interaktion -> Platzieren gegen Kiste
    manualController.setControlState('sneak', true);
    bot.placeBlockCalls = [];
    const placeSneakResult = await manualController.interactOrPlace(chestBlock, new Vec3(0, 1, 0));
    assert.strictEqual(placeSneakResult.success, true, '6.6 Mit Sneak wird Block platziert statt geöffnet');
    assert.strictEqual(placeSneakResult.action, 'place_block', '6.6 action ist place_block');
    manualController.setControlState('sneak', false);

    // 6.7 interactOrPlace: Normaler Block (Stein) -> Platzieren
    const stoneBlock = { name: 'stone', position: new Vec3(100, 63, 200), face: 1 };
    bot.cursorBlock = stoneBlock;
    bot.placeBlockCalls = [];
    const placeResult = await manualController.interactOrPlace();
    assert.strictEqual(placeResult.success, true, '6.7 Platzierung gegen Stein erfolgreich');
    assert.strictEqual(placeResult.action, 'place_block', '6.7 action ist place_block');
    assert.strictEqual(bot.placeBlockCalls[0].faceVector.y, 1, '6.7 Face 1 zu Vec3(0, 1, 0) aufgelöst');

    // 6.8 interactOrPlace Fallback: Kein Block -> Item aktivieren (z. B. Essen/Schild)
    bot.cursorBlock = null;
    bot.activateItemCalls = [];
    const itemResult = await manualController.interactOrPlace();
    assert.strictEqual(itemResult.success, true, '6.8 Kein Block im Fokus -> activate_item');
    assert.strictEqual(itemResult.action, 'activate_item', '6.8 action ist activate_item');
    assert.strictEqual(bot.activateItemCalls.length, 1, '6.8 bot.activateItem aufgerufen');

    // 6.9 setQuickBarSlot
    bot.setQuickBarSlotCalls = [];
    assert.strictEqual(manualController.setQuickBarSlot(4), true, '6.9 Quickbar Slot 4 gesetzt');
    assert.strictEqual(bot.quickBarSlot, 4, '6.9 bot.quickBarSlot aktualisiert');
    assert.strictEqual(manualController.setQuickBarSlot(9), false, '6.9 Slot > 8 wird abgewiesen');
    assert.strictEqual(manualController.setQuickBarSlot(-1), false, '6.9 Slot < 0 wird abgewiesen');

    // 6.10 toss
    bot.tossCalls = [];
    bot.tossStackCalls = [];
    assert.strictEqual(await manualController.toss(false), true, '6.10 toss(false) für Einzel-Item erfolgreich');
    assert.strictEqual(bot.tossCalls.length, 1, '6.10 bot.toss aufgerufen');
    assert.strictEqual(await manualController.toss(true), true, '6.10 toss(true) für Stack erfolgreich');
    assert.strictEqual(bot.tossStackCalls.length, 1, '6.10 bot.tossStack aufgerufen');

    // 6.11 getHotbarInfo
    const hotbar = manualController.getHotbarInfo();
    assert.strictEqual(hotbar.length, 9, '6.11 getHotbarInfo liefert exakt 9 Slots');
    assert.strictEqual(hotbar[0].item.name, 'diamond_sword', '6.11 Slot 0 enthält diamond_sword');
    assert.strictEqual(hotbar[1].item.name, 'diamond_pickaxe', '6.11 Slot 1 enthält diamond_pickaxe');
    assert.strictEqual(hotbar[2].item.name, 'bread', '6.11 Slot 2 enthält bread mit count 16');
    assert.strictEqual(hotbar[2].item.count, 16, '6.11 Slot 2 count ist 16');
    assert.strictEqual(hotbar[4].selected, true, '6.11 Slot 4 ist als selected markiert');
    assert.strictEqual(hotbar[5].item, null, '6.11 Leerer Slot 5 ist null');

    // 6.12 inspectTarget (Entity & Block)
    bot.cursorEntity = mobEntity;
    const inspEntity = manualController.inspectTarget(4.5);
    assert.strictEqual(inspEntity.kind, 'entity', '6.12 inspectTarget erkennt entity');
    assert.strictEqual(inspEntity.name, 'zombie', '6.12 Entity Name ist zombie');
    assert.strictEqual(inspEntity.id, 42, '6.12 Entity ID ist 42');

    bot.cursorEntity = null;
    bot.cursorBlock = targetBlock;
    const inspBlock = manualController.inspectTarget(4.5);
    assert.strictEqual(inspBlock.kind, 'block', '6.12 inspectTarget erkennt block');
    assert.strictEqual(inspBlock.name, 'iron_ore', '6.12 Block Name ist iron_ore');

    manualController.deactivate();
  }
  console.log('[PASS] Testgruppe 6: Discrete Actions bestanden.');

  // -------------------------------------------------------------
  // Testgruppe 7: BotClient Integration Hooks
  // -------------------------------------------------------------
  console.log('--- Testgruppe 7: BotClient Integration Hooks ---');
  {
    const origOnBotSpawn = dashboardServer.onBotSpawn;
    dashboardServer.onBotSpawn = () => {}; // Prevent live prismarine viewer server startup in unit tests
    try {
      const botClient = new BotClient();
      assert.strictEqual(botClient.manualController !== undefined, true, '7.1 botClient besitzt manualController Instanz');

      const bot = createMockBot();
      botClient.bot = bot;

      // Simuliere spawn Event
      botClient.setupEventHandlers();
      bot.emit('spawn');
      assert.strictEqual(botClient.manualController.bot === bot, true, '7.2 Spawn Event registriert Bot am manualController');

      // Simuliere entityHurt während manuellem Gamemode
      botClient.manualController.activate(bot);
      bot.inventory.items = () => [{ name: 'shield' }];
      bot.equip = async () => {};
      let shieldActivated = false;
      bot.activateItem = () => { shieldActivated = true; };

      bot.emit('entityHurt', bot.entity);
      assert.strictEqual(shieldActivated, false, '7.3 entityHurt triggert KEIN Auto-Shield während manualController aktiv ist');

      // Simuliere Disconnect / kicked Event
      botClient.manualController.activate(bot);
      assert.strictEqual(botClient.manualController.isActive(), true, '7.4 Controller ist vor Kick aktiv');
      bot.emit('kicked', 'Server restart');
      assert.strictEqual(botClient.manualController.isActive(), false, '7.4 kicked Event deaktiviert manualController sauber');

      // Simuliere end Event
      botClient.manualController.activate(bot);
      bot.emit('end', 'Socket closed');
      assert.strictEqual(botClient.manualController.isActive(), false, '7.5 end Event deaktiviert manualController sauber');

      // Simuliere botClient.stop()
      botClient.manualController.activate(bot);
      botClient.stop();
      assert.strictEqual(botClient.manualController.isActive(), false, '7.6 botClient.stop() deaktiviert manualController');
    } finally {
      dashboardServer.onBotSpawn = origOnBotSpawn;
    }
  }
  console.log('[PASS] Testgruppe 7: BotClient Integration Hooks bestanden.');

  console.log('\n=== ALLE TESTS DER MANUAL GAMEMODE BACKEND TEST SUITE ERFOLGREICH BESTANDEN! ===\n');
}

runTests().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\n[FAIL] Testfehler:', err);
  process.exit(1);
});
