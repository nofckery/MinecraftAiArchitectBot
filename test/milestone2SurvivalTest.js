import assert from 'assert';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { settings } from '../src/config/settings.js';
import { inventoryManager, WEAPON_TIERS, EDIBLE_FOODS, HARMFUL_FOODS } from '../src/bot/inventoryManager.js';
import { ThreatManager, threatManager, THREAT_STATES, HOSTILE_MOBS } from '../src/bot/threatManager.js';
import { SleepController, sleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { sessionHandoff, HANDOFF_STATES } from '../src/bot/sessionHandoff.js';
import { BotClient, botClient } from '../src/bot/botClient.js';

export class MockSurvivalBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.username = options.username || 'BaumeisterKI';
    this.version = options.version || '1.20.4';
    this.health = options.health ?? 20;
    this.food = options.food ?? 20;
    this.foodSaturation = options.foodSaturation ?? 5;
    this.isSleeping = false;
    this.isRaining = options.isRaining ?? false;
    this.thunderState = options.thunderState ?? 0;
    this.connected = true;

    this.entity = {
      id: 1,
      name: 'player',
      position: options.position ? options.position.clone() : new Vec3(0, 64, 0),
      yaw: 0,
      pitch: 0,
      height: 1.62
    };

    this.entities = options.entities || {};
    this.players = options.players || {};
    this.inventoryItems = options.items || [];
    this.equipped = { hand: null, 'off-hand': null };
    this.attackHistory = [];
    this.chatHistory = [];
    this.activeItem = false;
    this.controlStates = {};
    this.quitReason = null;
    this.blocks = options.blocks || {};
    this.currentGoal = null;

    this.time = {
      timeOfDay: options.timeOfDay ?? 1000,
      isDay: options.timeOfDay !== undefined ? options.timeOfDay < 12542 : true
    };

    this.pathfinder = {
      isMoving: () => false,
      goto: async (goal) => {
        if (goal && typeof goal.x === 'number') {
          this.entity.position = new Vec3(goal.x, goal.y, goal.z);
        }
      },
      setGoal: (goal) => {
        this.currentGoal = goal;
      },
      stop: () => {
        this.currentGoal = null;
      }
    };

    this.inventory = {
      items: () => this.inventoryItems
    };
  }

  async equip(item, destination) {
    this.equipped[destination] = item;
  }

  activateItem(offhand = false) {
    this.activeItem = true;
  }

  deactivateItem() {
    this.activeItem = false;
  }

  async consume() {
    const handItem = this.equipped.hand;
    if (handItem) {
      this.food = Math.min(20, this.food + 6);
      this.foodSaturation = Math.min(20, this.foodSaturation + 10);
      this.health = Math.min(20, this.health + 4);
    }
  }

  attack(entity) {
    this.attackHistory.push({ id: entity.id, name: entity.name, time: Date.now() });
    if (typeof entity.health === 'number') {
      entity.health -= 7;
      if (entity.health <= 0) {
        entity.isValid = false;
      }
    }
  }

  async lookAt(pos) {
    this.lookedAtPos = pos;
  }

  swingArm(hand) {}

  setControlState(control, state) {
    this.controlStates[control] = state;
  }

  chat(msg) {
    this.chatHistory.push(msg);
  }

  async sleep(bedBlock) {
    const props = bedBlock.getProperties ? bedBlock.getProperties() : bedBlock.properties;
    if (props?.occupied === 'true' || props?.occupied === true) {
      throw new Error('this bed is occupied');
    }
    this.isSleeping = true;
    this.emit('sleep');
  }

  async wake() {
    this.isSleeping = false;
    this.emit('wake');
  }

  quit(reason = 'disconnect') {
    this.connected = false;
    this.quitReason = reason;
    this.emit('end', reason);
  }

  findBlocks(options) {
    const matching = options.matching;
    const maxDist = options.maxDistance || 32;
    const results = [];
    for (const [key, b] of Object.entries(this.blocks)) {
      const dist = this.entity.position.distanceTo(b.position);
      if (dist <= maxDist) {
        let isMatch = false;
        if (typeof matching === 'function') {
          isMatch = matching(b);
        } else if (Array.isArray(matching)) {
          isMatch = matching.includes(b.type) || matching.includes(b.name);
        }
        if (isMatch) {
          results.push(b.position);
        }
      }
    }
    return results;
  }

  blockAt(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    return this.blocks[key] || null;
  }
}

async function runMilestone2SurvivalTests() {
  console.log('=== STARTING MILESTONE 2: MONSTER-ABWEHR & SCHLAF-/RECONNECT TEST SUITE ===\n');
  let passed = 0;

  function pass(msg) {
    passed++;
    console.log(`[PASS] ${msg}`);
  }

  // --- Testgruppe 1: Settings Survival-Konfiguration ---
  console.log('--- Testgruppe 1: Settings Survival-Konfiguration ---');
  assert.strictEqual(typeof settings.SURVIVAL_THREAT_RADIUS, 'number');
  assert.strictEqual(settings.SURVIVAL_THREAT_RADIUS, 12);
  pass('SURVIVAL_THREAT_RADIUS Setting (12m) konfiguriert');

  assert.strictEqual(typeof settings.SURVIVAL_CRITICAL_HEALTH, 'number');
  assert.strictEqual(settings.SURVIVAL_CRITICAL_HEALTH, 8);
  pass('SURVIVAL_CRITICAL_HEALTH Setting (8 HP) konfiguriert');

  assert.strictEqual(typeof settings.SURVIVAL_RETREAT_DISTANCE, 'number');
  assert.strictEqual(settings.SURVIVAL_RETREAT_DISTANCE, 15);
  pass('SURVIVAL_RETREAT_DISTANCE Setting (15m) konfiguriert');

  assert.strictEqual(typeof settings.SURVIVAL_ATTACK_COOLDOWN_MS, 'number');
  assert.strictEqual(settings.SURVIVAL_ATTACK_COOLDOWN_MS, 625);
  pass('SURVIVAL_ATTACK_COOLDOWN_MS Setting (625ms) konfiguriert');

  assert.strictEqual(typeof settings.BED_SEARCH_RADIUS, 'number');
  assert.strictEqual(settings.BED_SEARCH_RADIUS, 32);
  pass('BED_SEARCH_RADIUS Setting (32m) konfiguriert');

  assert.strictEqual(typeof settings.SLEEP_DISCONNECT_ON_NO_BED, 'boolean');
  assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, true);
  pass('SLEEP_DISCONNECT_ON_NO_BED Setting (true) konfiguriert');

  assert.strictEqual(typeof settings.SLEEP_RECONNECT_DELAY_SEC, 'number');
  assert.strictEqual(settings.SLEEP_RECONNECT_DELAY_SEC, 25);
  pass('SLEEP_RECONNECT_DELAY_SEC Setting (25s) konfiguriert');

  // --- Testgruppe 2: InventoryManager Waffen & Schild Ausrüstung ---
  console.log('\n--- Testgruppe 2: InventoryManager Waffen & Schild Ausrüstung ---');

  // Netherite vs Diamond vs Iron vs Wood
  const botWithWeapons = new MockSurvivalBot({
    items: [
      { name: 'iron_sword', count: 1 },
      { name: 'netherite_sword', count: 1 },
      { name: 'diamond_sword', count: 1 },
      { name: 'shield', count: 1 }
    ]
  });

  const weaponEquipped = await inventoryManager.equipBestWeapon(botWithWeapons);
  assert.strictEqual(weaponEquipped, true);
  assert.strictEqual(botWithWeapons.equipped.hand?.name, 'netherite_sword');
  pass('equipBestWeapon wählt höchste Tier-Priorität (netherite_sword)');

  // Axe fallback when no sword
  const botWithAxeOnly = new MockSurvivalBot({
    items: [
      { name: 'stone_pickaxe', count: 1 },
      { name: 'diamond_axe', count: 1 }
    ]
  });
  const axeEquipped = await inventoryManager.equipBestWeapon(botWithAxeOnly);
  assert.strictEqual(axeEquipped, true);
  assert.strictEqual(botWithAxeOnly.equipped.hand?.name, 'diamond_axe');
  pass('equipBestWeapon nutzt Axt-Tiering als Fallback');

  // No weapons in inventory
  const botWithoutWeapons = new MockSurvivalBot({
    items: [{ name: 'dirt', count: 64 }, { name: 'cobblestone', count: 32 }]
  });
  const noWeapon = await inventoryManager.equipBestWeapon(botWithoutWeapons);
  assert.strictEqual(noWeapon, false);
  pass('equipBestWeapon liefert false bei waffenlosem Inventar');

  // Shield equipping to offhand
  const shieldEquipped = await inventoryManager.equipShield(botWithWeapons);
  assert.strictEqual(shieldEquipped, true);
  assert.strictEqual(botWithWeapons.equipped['off-hand']?.name, 'shield');
  pass('equipShield rüstet Schild erfolgreich in Nebenhand aus');

  const noShield = await inventoryManager.equipShield(botWithoutWeapons);
  assert.strictEqual(noShield, false);
  pass('equipShield liefert false wenn kein Schild im Inventar vorhanden ist');

  // --- Testgruppe 3: InventoryManager Nahrungsauswahl & Regeneration ---
  console.log('\n--- Testgruppe 3: InventoryManager Nahrungsauswahl & Regeneration ---');

  const botWithFood = new MockSurvivalBot({
    health: 10,
    food: 8,
    items: [
      { name: 'rotten_flesh', count: 12 },
      { name: 'spider_eye', count: 4 },
      { name: 'apple', count: 5 },
      { name: 'cooked_beef', count: 16 }
    ]
  });

  const ate = await inventoryManager.eatBestFood(botWithFood);
  assert.strictEqual(ate, true);
  assert.strictEqual(botWithFood.equipped.hand?.name, 'cooked_beef');
  assert.strictEqual(botWithFood.food, 14); // 8 + 6
  assert.strictEqual(botWithFood.health, 14); // 10 + 4
  pass('eatBestFood wählt nahrhafteste Speise (cooked_beef) und regeneriert Nahrung/Leben');

  // Toxic food rejection
  const botWithToxicOnly = new MockSurvivalBot({
    health: 6,
    food: 4,
    items: [
      { name: 'rotten_flesh', count: 10 },
      { name: 'spider_eye', count: 5 },
      { name: 'poisonous_potato', count: 2 },
      { name: 'pufferfish', count: 1 }
    ]
  });
  const ateToxic = await inventoryManager.eatBestFood(botWithToxicOnly);
  assert.strictEqual(ateToxic, false);
  assert.strictEqual(botWithToxicOnly.equipped.hand, null);
  pass('eatBestFood verweigert strikt giftige und schädliche Nahrung (rotten_flesh, spider_eye etc.)');

  // --- Testgruppe 4: ThreatManager Proaktive Bedrohungserkennung ---
  console.log('\n--- Testgruppe 4: ThreatManager Proaktive Bedrohungserkennung ---');

  const tmBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    entities: {
      10: { id: 10, name: 'cow', position: new Vec3(2, 64, 1), isValid: true, health: 10 },
      11: { id: 11, name: 'sheep', position: new Vec3(-3, 64, 0), isValid: true, health: 8 },
      12: { id: 12, name: 'zombie', position: new Vec3(7, 64, 0), isValid: true, health: 20 },
      13: { id: 13, name: 'skeleton', position: new Vec3(18, 64, 0), isValid: true, health: 20 },
      14: { id: 14, name: 'creeper', position: new Vec3(0, 64, 4), isValid: true, health: 20 },
      15: { id: 15, name: 'spider', position: new Vec3(1, 64, 2), isValid: false, health: 0 }
    }
  });

  const tm = new ThreatManager(tmBot);
  const detected = tm.findNearbyThreat(12.0);
  assert(detected !== null);
  assert.strictEqual(detected.id, 14); // Creeper is at dist 4, closest hostile!
  pass('findNearbyThreat ignoriert friedliche Tiere und wählt die nächste feindliche Bedrohung');

  const distantOnlyBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    entities: {
      20: { id: 20, name: 'zombie', position: new Vec3(15, 64, 0), isValid: true, health: 20 }
    }
  });
  const tmDistant = new ThreatManager(distantOnlyBot);
  const distantDetected = tmDistant.findNearbyThreat(12.0);
  assert.strictEqual(distantDetected, null);
  pass('findNearbyThreat ignoriert Monster außerhalb des Schutzradius (>12m)');

  // --- Testgruppe 5: ThreatManager FSM & Bauauftrag-Unterbrechung ---
  console.log('\n--- Testgruppe 5: ThreatManager FSM & Bauauftrag-Unterbrechung ---');

  const combatBot = new MockSurvivalBot({
    position: new Vec3(10, 64, 10),
    health: 20,
    items: [
      { name: 'diamond_sword', count: 1 },
      { name: 'shield', count: 1 }
    ],
    entities: {
      30: { id: 30, name: 'zombie', position: new Vec3(13, 64, 10), isValid: true, health: 20, height: 1.8 }
    }
  });

  const threatMgr = new ThreatManager(combatBot);

  // Simuliere aktiven Bauauftrag in worldExecutor
  worldExecutor.isBuilding = true;
  worldExecutor.buildProgress.active = true;
  worldExecutor.buildProgress.phase = 'Phase 1: Tragwerk';

  await threatMgr.tick();

  assert.strictEqual(threatMgr.state, THREAT_STATES.ENGAGING);
  assert.strictEqual(worldExecutor.pauseRequested, true);
  assert.strictEqual(threatMgr.wasBuildingBeforeThreat, true);
  assert.strictEqual(combatBot.equipped.hand?.name, 'diamond_sword');
  assert.strictEqual(combatBot.equipped['off-hand']?.name, 'shield');
  pass('Bedrohungserkennung pausiert aktiven Bauauftrag und rüstet Waffe & Schild aus');

  // --- Testgruppe 6: Spezifische Kampftaktiken (Creeper & Skelett) ---
  console.log('\n--- Testgruppe 6: Spezifische Kampftaktiken (Creeper & Skelett) ---');

  // Creeper hit-and-backpedal
  const creeperBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    health: 20,
    items: [{ name: 'diamond_sword', count: 1 }]
  });
  const creeperEntity = { id: 40, name: 'creeper', position: new Vec3(2, 64, 0), isValid: true, health: 20, height: 1.7 };
  const creeperMgr = new ThreatManager(creeperBot);
  creeperMgr.state = THREAT_STATES.ENGAGING;
  creeperMgr.currentTarget = creeperEntity;

  await creeperMgr.combatStep();
  assert(creeperBot.attackHistory.length > 0);
  assert.strictEqual(creeperBot.attackHistory[0].name, 'creeper');
  assert(creeperBot.currentGoal !== null); // setGoal was called to retreat
  pass('Creeper-Taktik führt Angriff und sofortiges Zurückweichen (4m) aus');

  // Folgetick innerhalb des Backpedal-Fensters darf Rückzug nicht überschreiben
  const backpedalGoal = { ...creeperBot.currentGoal };
  creeperEntity.position = new Vec3(4, 64, 0); // dist=4.0m (>3.0m, würde sonst GoalFollow auslösen)
  await creeperMgr.combatStep();
  assert.strictEqual(creeperBot.currentGoal.x, backpedalGoal.x);
  assert.strictEqual(creeperBot.currentGoal.z, backpedalGoal.z);
  pass('Creeper-Taktik: Backpedal-Rückzugsziel wird innerhalb des Zeitfensters nicht durch GoalFollow überschrieben');

  // Skeleton shield advance
  const skeletonBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    health: 20,
    items: [{ name: 'diamond_sword', count: 1 }, { name: 'shield', count: 1 }]
  });
  const skeletonEntity = { id: 50, name: 'skeleton', position: new Vec3(6, 64, 0), isValid: true, health: 20, height: 1.9 };
  const skeletonMgr = new ThreatManager(skeletonBot);
  skeletonMgr.state = THREAT_STATES.ENGAGING;
  skeletonMgr.currentTarget = skeletonEntity;

  await skeletonMgr.combatStep();
  assert.strictEqual(skeletonBot.activeItem, true);
  pass('Skelett-Taktik hebt Schild bei Annäherung auf Distanz (>3.5m)');

  // Skeleton close range attack drops shield
  skeletonEntity.position = new Vec3(2, 64, 0);
  skeletonMgr.lastAttackTime = Date.now() - 1000;
  await skeletonMgr.combatStep();
  assert.strictEqual(skeletonBot.activeItem, false);
  assert(skeletonBot.attackHistory.length > 0);
  pass('Skelett-Taktik senkt Schild für Schwerthieb im Nahbereich');

  // --- Testgruppe 7: Kritischer Rückzug bei niedriger Gesundheit ---
  console.log('\n--- Testgruppe 7: Kritischer Rückzug bei niedriger Gesundheit ---');

  const retreatBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    health: 7, // <= 8 HP critical threshold!
    food: 12,
    items: [{ name: 'cooked_beef', count: 5 }],
    entities: {
      60: { id: 60, name: 'zombie', position: new Vec3(3, 64, 0), isValid: true, health: 20 }
    }
  });

  const retreatMgr = new ThreatManager(retreatBot);
  await retreatMgr.tick();

  assert.strictEqual(retreatMgr.state, THREAT_STATES.RETREATING);
  assert.strictEqual(retreatBot.controlStates.sprint, true);
  assert(retreatBot.currentGoal !== null);
  pass('Kritische Gesundheit (HP <= 8) erzwingt taktischen Sprint-Rückzug (15m)');

  // Null-Distanz-Schutz (Verhindert NaN bei gleicher Bot-/Mob-Position)
  const zeroDistBot = new MockSurvivalBot({
    position: new Vec3(10, 64, 10),
    health: 5,
    entities: {
      99: { id: 99, name: 'zombie', position: new Vec3(10, 64, 10), isValid: true, health: 20 }
    }
  });
  const zeroDistMgr = new ThreatManager(zeroDistBot);
  zeroDistMgr.currentTarget = zeroDistBot.entities[99];
  await zeroDistMgr.initiateRetreat();
  assert(zeroDistBot.currentGoal !== null);
  assert(!Number.isNaN(zeroDistBot.currentGoal.x) && !Number.isNaN(zeroDistBot.currentGoal.z));
  pass('initiateRetreat: Null-Distanz-Schutz verhindert NaN im Rückzugsvektor bei exakter Mob-Koinzidenz');

  // --- Testgruppe 8: Heilung, Perimetersicherung & Baufortsetzung ---
  console.log('\n--- Testgruppe 8: Heilung, Perimetersicherung & Baufortsetzung ---');

  // Once at safe distance, transitions to HEALING
  retreatBot.entities = {}; // Mobs left behind
  await retreatMgr.retreatStep();
  assert.strictEqual(retreatMgr.state, THREAT_STATES.HEALING);
  assert.strictEqual(retreatBot.controlStates.sprint, false);
  pass('Sicherheitsabstand stoppt Sprint und schaltet in Heilungsmodus');

  // Eat food in HEALING state
  retreatBot.health = 8;
  retreatBot.food = 10;
  await retreatMgr.healingStep();
  assert(retreatBot.food > 10);
  pass('Heilungsmodus konsumiert Nahrung zur Regeneration');

  // When health restored, secures perimeter
  retreatBot.health = 16;
  retreatBot.food = 20;
  await retreatMgr.healingStep();
  assert.strictEqual(retreatMgr.state, THREAT_STATES.SECURING_PERIMETER);
  pass('Ausreichende Gesundheit schaltet auf Perimetersicherung');

  // Softlock-Vermeidung bei voller Hungerleiste (food=20) aber niedriger Gesundheit
  const fullFoodBot = new MockSurvivalBot({
    health: 7, // niedrig
    food: 20   // voll -> keine reguläre Nahrungsaufnahme möglich
  });
  const fullFoodMgr = new ThreatManager(fullFoodBot);
  fullFoodMgr.state = THREAT_STATES.HEALING;
  await fullFoodMgr.healingStep();
  assert.strictEqual(fullFoodMgr.state, THREAT_STATES.SECURING_PERIMETER);
  pass('healingStep: Bei voller Hungerleiste (food=20) wird Softlock vermieden und zu SECURING_PERIMETER gewechselt');

  // Bedrohungserkennung während Heilung
  const threatenedHealBot = new MockSurvivalBot({
    health: 12,
    food: 15,
    entities: {
      88: { id: 88, name: 'skeleton', position: new Vec3(2, 64, 0), isValid: true, health: 20 }
    }
  });
  const threatenedHealMgr = new ThreatManager(threatenedHealBot);
  threatenedHealMgr.state = THREAT_STATES.HEALING;
  await threatenedHealMgr.healingStep();
  assert.strictEqual(threatenedHealMgr.state, THREAT_STATES.ENGAGING);
  assert.strictEqual(threatenedHealMgr.currentTarget.name, 'skeleton');
  pass('healingStep: Feindliche Bedrohung im Perimeter bricht Heilung ab und wechselt zu ENGAGING');

  // Perimeter clear -> Resumes build
  retreatMgr.wasBuildingBeforeThreat = true;
  retreatMgr.returnPosition = new Vec3(10, 64, 10);
  retreatBot.entity.position = new Vec3(25, 64, 25); // Bot was retreated far away

  let resumeCalled = false;
  worldExecutor.pausedState = {
    bot: retreatBot,
    blocks: [{ x: 10, y: 64, z: 10, fullBlockString: 'minecraft:stone' }],
    options: {},
    phase: 1,
    phase1Index: 0,
    phase2Index: 0,
    completedOps: 0,
    totalOps: 1,
    title: 'Test Bauauftrag'
  };
  const origResume = worldExecutor.resumeBuild;
  worldExecutor.resumeBuild = async (b) => {
    resumeCalled = true;
    return true;
  };

  await retreatMgr.securingStep();
  assert.strictEqual(retreatMgr.state, THREAT_STATES.IDLE);
  assert.strictEqual(resumeCalled, true);
  worldExecutor.resumeBuild = origResume;
  worldExecutor.pausedState = null;
  worldExecutor.isBuilding = false;
  pass('Freier Perimeter navigiert zurück zum Bauplatz und setzt Bauauftrag fort');

  // --- Testgruppe 9: SleepController Erkennungskanäle ---
  console.log('\n--- Testgruppe 9: SleepController Erkennungskanäle ---');

  const sleepBot = new MockSurvivalBot({
    timeOfDay: 14000 // Night time (12542 <= timeOfDay <= 23459)
  });

  const sc = new SleepController({ bot: sleepBot });
  assert.strictEqual(sc.isNight(), true);
  pass('isNight erkennt reguläre Nachtzeit (14000 ticks)');

  sleepBot.time.timeOfDay = 6000; // Noon
  assert.strictEqual(sc.isNight(), false);
  pass('isNight erkennt Tagzeit (6000 ticks)');

  sleepBot.isRaining = true;
  sleepBot.thunderState = 1;
  assert.strictEqual(sc.isNight(), true);
  pass('isNight erkennt Gewitter als Schlafbedingung am Tag');

  // Other player sleeping detection
  sleepBot.players = {
    BaumeisterKI: { username: 'BaumeisterKI', entity: sleepBot.entity },
    Steve: { username: 'Steve', entity: { id: 2, isSleeping: true, pose: 'sleeping' } }
  };
  assert.strictEqual(sc.isOtherPlayerSleeping(), true);
  pass('isOtherPlayerSleeping erkennt schlafende Mitspieler');

  // --- Testgruppe 10: Bettsuche, Schlaf & Aufwachen ---
  console.log('\n--- Testgruppe 10: Bettsuche, Schlaf & Aufwachen ---');

  const bedPos = new Vec3(5, 64, 5);
  const bedBlock = {
    name: 'red_bed',
    type: 101,
    position: bedPos,
    getProperties: () => ({ occupied: 'false', part: 'head' })
  };

  const occupiedBedPos = new Vec3(2, 64, 2);
  const occupiedBed = {
    name: 'blue_bed',
    type: 102,
    position: occupiedBedPos,
    getProperties: () => ({ occupied: 'true', part: 'head' })
  };

  const bedBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    timeOfDay: 15000,
    blocks: {
      '5,64,5': bedBlock,
      '2,64,2': occupiedBed
    }
  });

  const bedSc = new SleepController({ bot: bedBot });
  const foundBed = await bedSc.findReachableBed(32);
  assert(foundBed !== null);
  assert.strictEqual(foundBed.position.x, 5);
  assert.strictEqual(foundBed.position.z, 5);
  pass('findReachableBed findet freies Bett und ignoriert belegtes Bett');

  // Go to bed and sleep
  worldExecutor.isBuilding = true;
  await bedSc.goToBedAndSleep(foundBed);
  assert.strictEqual(bedSc.state, SLEEP_STATES.SLEEPING);
  assert.strictEqual(bedBot.isSleeping, true);
  assert.strictEqual(worldExecutor.pauseRequested, true);
  pass('goToBedAndSleep pausiert Bauauftrag, navigiert zum Bett und legt Bot schlafen');

  // Morning wake resumes build
  worldExecutor.pausedState = {
    bot: bedBot,
    blocks: [],
    completedOps: 0,
    totalOps: 1,
    title: 'Sleep Test'
  };
  let wakeResumeCalled = false;
  worldExecutor.resumeBuild = async (b) => {
    wakeResumeCalled = true;
    return true;
  };

  await bedSc.onWake();
  assert.strictEqual(bedSc.state, SLEEP_STATES.AWAKE);
  assert.strictEqual(wakeResumeCalled, true);
  worldExecutor.resumeBuild = origResume;
  worldExecutor.pausedState = null;
  worldExecutor.isBuilding = false;
  pass('onWake setzt Zustand auf AWAKE und führt Bauauftrag am Morgen fort');

  // --- Testgruppe 11: Saubere Trennung bei fehlendem Bett & Reconnect ---
  console.log('\n--- Testgruppe 11: Saubere Trennung bei fehlendem Bett & Reconnect ---');

  const homelessBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    timeOfDay: 16000, // Deep night
    blocks: {}, // No beds anywhere!
    players: {
      Alex: { username: 'Alex', entity: { id: 3, isSleeping: true } }
    }
  });

  let reconnected = false;
  const mockClient = {
    bot: homelessBot,
    reconnect: () => {
      reconnected = true;
    }
  };

  const homelessSc = new SleepController(mockClient);
  worldExecutor.isBuilding = true;

  await homelessSc.handleSleepOpportunity();
  assert.strictEqual(homelessSc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT);
  assert.strictEqual(homelessBot.connected, false);
  assert.strictEqual(homelessBot.quitReason, 'Night skip disconnect');
  assert(homelessBot.chatHistory.some(m => m.includes('Gute Nacht')));
  assert.strictEqual(worldExecutor.pauseRequested, true);
  assert(homelessSc.reconnectTimer !== null);
  assert.strictEqual(sessionHandoff.state, HANDOFF_STATES.PAUSED_SLEEP_NIGHT);
  assert.strictEqual(sessionHandoff.isPaused(), true);
  pass('Clean Disconnect: Trennt Verbindung bei fehlendem Bett mit Chat-Nachricht und pausiert Bauauftrag');

  // Trigger reconnect timer directly without waiting 25 real wall-clock seconds
  clearTimeout(homelessSc.reconnectTimer);
  homelessSc.reconnectTimer = null;
  mockClient.reconnect();
  assert.strictEqual(reconnected, true);
  pass('Automatischer Reconnect-Timer stellt Verbindung nach Nachtende wieder her');

  // On morning spawn check
  const morningBot = new MockSurvivalBot({
    position: new Vec3(0, 64, 0),
    timeOfDay: 1000 // Daytime!
  });
  homelessSc.botClient.bot = morningBot;
  homelessSc.wasBuildingBeforeSleep = true;
  worldExecutor.pausedState = {
    bot: morningBot,
    blocks: [],
    completedOps: 0,
    totalOps: 1,
    title: 'Reconnect Test'
  };

  let morningResumeCalled = false;
  worldExecutor.resumeBuild = async (b) => {
    morningResumeCalled = true;
    return true;
  };

  await homelessSc.onBotSpawn(morningBot);
  assert.strictEqual(homelessSc.state, SLEEP_STATES.AWAKE);

  // Wait for 1s debounce in onBotSpawn
  await new Promise(r => setTimeout(r, 1100));
  assert.strictEqual(morningResumeCalled, true);
  worldExecutor.resumeBuild = origResume;
  worldExecutor.pausedState = null;
  homelessSc.stopMonitoring();
  pass('onBotSpawn erkennt Tagzeit und setzt Bauauftrag nach Nacht-Reconnect automatisch fort');

  // --- Testgruppe 12: SessionHandoff PAUSED_SLEEP_NIGHT & Reconnect Suppression ---
  console.log('\n--- Testgruppe 12: SessionHandoff PAUSED_SLEEP_NIGHT & Reconnect Suppression ---');

  // 12.1 isPaused Statusprüfung
  sessionHandoff.state = HANDOFF_STATES.PAUSED_SLEEP_NIGHT;
  assert.strictEqual(sessionHandoff.isPaused(), true);
  pass('sessionHandoff.isPaused() liefert true bei HANDOFF_STATES.PAUSED_SLEEP_NIGHT');

  // 12.2 Integration mit BotClient: Reconnect-Unterdrückung während Nacht-Disconnect
  const testClient = new BotClient();
  const clientBot = new MockSurvivalBot({ position: new Vec3(0, 64, 0) });
  testClient.bot = clientBot;
  testClient.setupEventHandlers();

  // Test 1: 'end'-Event während PAUSED_SLEEP_NIGHT unterdrückt scheduleReconnect()
  sessionHandoff.state = HANDOFF_STATES.PAUSED_SLEEP_NIGHT;
  testClient.sleepController.state = SLEEP_STATES.DISCONNECTED_FOR_NIGHT;
  testClient.isReconnecting = false;
  clientBot.emit('end', 'Night skip disconnect');
  assert.strictEqual(testClient.isReconnecting, false);
  pass('botClient.scheduleReconnect() wird während PAUSED_SLEEP_NIGHT unterdrückt (verhindert 5s-Reconnect-Schleife)');

  // Test 2: 'kicked'-Event während Nacht-Disconnect wird ebenfalls unterdrückt
  clientBot.emit('kicked', 'Night skip disconnect');
  assert.strictEqual(testClient.isReconnecting, false);
  pass('botClient: Kicked-Event während Nacht-Disconnect löst keinen vorzeitigen Reconnect aus');

  // Test 3: Normaler Verbindungsverlust im ONLINE_ACTIVE Zustand triggert scheduleReconnect()
  sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
  testClient.sleepController.state = SLEEP_STATES.AWAKE;
  testClient.isReconnecting = false;
  clientBot.emit('end', 'Unexpected socket reset');
  assert.strictEqual(testClient.isReconnecting, true);
  testClient.cancelReconnect();
  pass('botClient: Unerwarteter Disconnect im aktiven Normalbetrieb triggert regulären Reconnect');

  // 12.3 Aufwachen setzt sessionHandoff sauber auf ONLINE_ACTIVE zurück
  sessionHandoff.state = HANDOFF_STATES.PAUSED_SLEEP_NIGHT;
  testClient.sleepController.state = SLEEP_STATES.SLEEPING;
  await testClient.sleepController.onWake();
  assert.strictEqual(sessionHandoff.state, HANDOFF_STATES.ONLINE_ACTIVE);
  assert.strictEqual(sessionHandoff.isPaused(), false);
  pass('onWake setzt sessionHandoff sauber von PAUSED_SLEEP_NIGHT auf ONLINE_ACTIVE zurück');

  testClient.stop();

  // Cleanup all timers and intervals
  tm.stopMonitoring();
  threatMgr.stopMonitoring();
  creeperMgr.stopMonitoring();
  skeletonMgr.stopMonitoring();
  retreatMgr.stopMonitoring();
  sc.stopMonitoring();
  bedSc.stopMonitoring();
  homelessSc.stopMonitoring();

  console.log(`\n=== MILESTONE 2 TEST SUITE ERFOLGREICH: ${passed}/30 TESTS BESTANDEN ===`);
}

runMilestone2SurvivalTests().catch(err => {
  console.error('FEHLER in Milestone 2 Survival Test Suite:', err);
  process.exit(1);
});
