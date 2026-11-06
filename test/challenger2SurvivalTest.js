import assert from 'assert';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { settings } from '../src/config/settings.js';
import { inventoryManager, WEAPON_TIERS, EDIBLE_FOODS, HARMFUL_FOODS } from '../src/bot/inventoryManager.js';
import { ThreatManager, THREAT_STATES, HOSTILE_MOBS } from '../src/bot/threatManager.js';
import { SleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';

class MockChallengerBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.username = options.username || 'ChallengerBot';
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
    this.gotoHistory = [];

    this.time = {
      timeOfDay: options.timeOfDay ?? 1000,
      isDay: options.timeOfDay !== undefined ? options.timeOfDay < 12542 : true
    };

    this.pathfinder = {
      isMoving: () => false,
      goto: async (goal) => {
        this.gotoHistory.push(goal);
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
    if (bedBlock.forceMonsterNearby) {
      throw new Error('You may not rest now; there are monsters nearby');
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

async function runAdversarialStressTests() {
  console.log('=== STARTING CHALLENGER 2: EMPIRICAL STRESS TEST SUITE ===\n');
  let passed = 0;
  let totalTests = 0;

  function pass(msg) {
    passed++;
    totalTests++;
    console.log(`[PASS] ${msg}`);
  }

  function fail(msg, err) {
    totalTests++;
    console.error(`[FAIL] ${msg}:`, err);
    throw err;
  }

  // =========================================================================
  // 1. CREEPER DEFENSE EMPIRICAL STRESS HARNESS
  // =========================================================================
  console.log('--- Suite 1: Creeper Defense (Hit & 4m Backpedal) ---');

  // Test 1a: Standard Creeper at 2.0m -> Attack + 4m backpedal goal
  {
    const bot = new MockChallengerBot({
      position: new Vec3(10, 64, 10),
      items: [{ name: 'diamond_sword', count: 1 }]
    });
    const creeper = {
      id: 101,
      name: 'creeper',
      position: new Vec3(10, 64, 12), // 2m distance in +Z direction
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;

    await tm.combatStep();

    assert.strictEqual(bot.attackHistory.length, 1, 'Bot must execute exactly 1 attack');
    assert.strictEqual(bot.attackHistory[0].name, 'creeper');
    assert(bot.currentGoal !== null, 'Bot must set a pathfinder goal');

    // Retreat goal should be roughly 4m further in -Z direction away from creeper
    // Vector (bot - creeper) = (0, 0, -2). Normalized: (0, 0, -1). Scaled 4.0: (0, 0, -4).
    // SafeGoal = (10, 64, 10) + (0, 0, -4) = (10, 64, 6)
    const goalPos = new Vec3(bot.currentGoal.x, bot.currentGoal.y, bot.currentGoal.z);
    const distToTarget = goalPos.distanceTo(creeper.position);
    const distToBot = goalPos.distanceTo(bot.entity.position);

    assert(Math.abs(distToBot - 4.0) < 0.1, `Bot retreat goal must be 4m from bot (actual: ${distToBot})`);
    assert(distToTarget > 5.5, `Goal must be away from creeper (actual: ${distToTarget}m > 5.5m)`);
    pass('Creeper at 2.0m: Bot greift an und weicht 4.0m entgegengesetzt zurück');
    tm.stopMonitoring();
  }

  // Test 1b: Boundary check: Creeper at exactly 3.4m (< 3.5m)
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'iron_sword', count: 1 }]
    });
    const creeper = {
      id: 102,
      name: 'creeper',
      position: new Vec3(3.4, 64, 0), // 3.4m away
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;

    await tm.combatStep();
    assert.strictEqual(bot.attackHistory.length, 1, 'Boundary < 3.5m must trigger attack');
    assert(bot.currentGoal !== null, 'Boundary < 3.5m must set retreat goal');
    const goalPos = new Vec3(bot.currentGoal.x, bot.currentGoal.y, bot.currentGoal.z);
    assert(goalPos.x < 0, 'Safe goal must be in -X direction away from creeper at +X');
    pass('Creeper bei 3.4m Grenzwert: Bot attackiert und triggert 4m Rückzug');
    tm.stopMonitoring();
  }

  // Test 1c: Boundary check: Creeper at 3.6m (> 3.5m) -> No attack, approaches instead
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'iron_sword', count: 1 }]
    });
    const creeper = {
      id: 103,
      name: 'creeper',
      position: new Vec3(3.6, 64, 0), // 3.6m away
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = creeper;

    await tm.combatStep();
    assert.strictEqual(bot.attackHistory.length, 0, 'Creeper at > 3.5m must NOT be attacked until close');
    assert(bot.currentGoal !== null, 'Pathfinder goal must approach creeper');
    pass('Creeper bei 3.6m (>3.5m): Bot attackiert nicht vorzeitig, sondern nähert sich');
    tm.stopMonitoring();
  }

  // =========================================================================
  // 2. SKELETON & STRAY DEFENSE (SHIELD LOGIC)
  // =========================================================================
  console.log('\n--- Suite 2: Skeleton & Stray Defense (Shield Control) ---');

  // Test 2a: Skeleton at 8m (> 3.5m) -> Shield raised (activateItem)
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'diamond_sword', count: 1 }, { name: 'shield', count: 1 }]
    });
    const skeleton = {
      id: 201,
      name: 'skeleton',
      position: new Vec3(8, 64, 0),
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = skeleton;

    await tm.combatStep();
    assert.strictEqual(bot.activeItem, true, 'Shield must be activated when skeleton > 3.5m');
    pass('Skelett bei 8m (>3.5m): Schild wird zum Pfeilschutz aktiv gehoben');
    tm.stopMonitoring();
  }

  // Test 2b: Stray at 5m (> 3.5m) -> Stray variant also raises shield
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'shield', count: 1 }]
    });
    const stray = {
      id: 202,
      name: 'stray',
      position: new Vec3(5, 64, 0),
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = stray;

    await tm.combatStep();
    assert.strictEqual(bot.activeItem, true, 'Shield must be activated against stray');
    pass('Stray-Variante bei 5m: Schild wird ebenfalls zuverlässig gehoben');
    tm.stopMonitoring();
  }

  // Test 2c: Skeleton moves to 2m (<= 3.5m) -> Shield lowered, sword attack executed
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'diamond_sword', count: 1 }, { name: 'shield', count: 1 }]
    });
    bot.activeItem = true; // Bot previously had shield raised
    const skeleton = {
      id: 203,
      name: 'skeleton',
      position: new Vec3(2, 64, 0),
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = skeleton;
    tm.lastAttackTime = Date.now() - 1000; // Cooldown expired

    await tm.combatStep();
    assert.strictEqual(bot.activeItem, false, 'Shield must be dropped when within melee range');
    assert.strictEqual(bot.attackHistory.length, 1, 'Melee strike must occur');
    pass('Skelett bei 2m (<=3.5m): Schild wird gesenkt und Nahkampf-Hieb ausgeführt');
    tm.stopMonitoring();
  }

  // Test 2d: Skeleton at 3.0m while attack on cooldown -> Shield still dropped
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'diamond_sword', count: 1 }, { name: 'shield', count: 1 }]
    });
    bot.activeItem = true;
    const skeleton = {
      id: 204,
      name: 'skeleton',
      position: new Vec3(3.0, 64, 0),
      isValid: true,
      health: 20
    };
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = skeleton;
    tm.lastAttackTime = Date.now(); // Attack on cooldown!

    await tm.combatStep();
    assert.strictEqual(bot.activeItem, false, 'Shield must be lowered in melee range even during attack cooldown');
    pass('Skelett im Nahbereich (3.0m): Schild bleibt auch im Cooldown gesenkt');
    tm.stopMonitoring();
  }

  // =========================================================================
  // 3. CRITICAL HEALTH & RETREAT LOGIC (HP <= 8, SPRINT, 15m GOAL)
  // =========================================================================
  console.log('\n--- Suite 3: Critical Health & Tactical Retreat ---');

  // Test 3a: HP = 7 (<= 8 critical threshold) -> Switches to RETREATING, sprint=true, 15m goal away
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      health: 7, // HP = 7
      items: [{ name: 'diamond_sword', count: 1 }],
      entities: {
        301: { id: 301, name: 'zombie', position: new Vec3(5, 64, 0), isValid: true, health: 20 }
      }
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = bot.entities[301];

    await tm.tick();

    assert.strictEqual(tm.state, THREAT_STATES.RETREATING, 'State must transition to RETREATING');
    assert.strictEqual(bot.controlStates.sprint, true, 'Sprint control state must be enabled');
    assert(bot.currentGoal !== null, 'Pathfinder goal must be set');

    // Mob is at (5, 64, 0), bot is at (0, 64, 0). Vector (bot - mob) = (-5, 0, 0).
    // Normalized = (-1, 0, 0). Scaled by 15 = (-15, 0, 0).
    // SafePos = (0, 64, 0) + (-15, 0, 0) = (-15, 64, 0).
    const goal = new Vec3(bot.currentGoal.x, bot.currentGoal.y, bot.currentGoal.z);
    const distToBot = goal.distanceTo(new Vec3(0, 64, 0));
    const distToMob = goal.distanceTo(new Vec3(5, 64, 0));

    assert(Math.abs(distToBot - 15.0) < 0.1, `Retreat goal must be 15m from bot position (actual: ${distToBot})`);
    assert(distToMob > 19.5, `Retreat goal must be away from mob (actual: ${distToMob}m)`);
    pass('HP=7 Injektion: FSM wechselt sofort zu RETREATING, Sprint=true und 15m Fluchtvektor weg vom Mob');
    tm.stopMonitoring();
  }

  // Test 3b: HP = 8 boundary condition (still <= 8) -> Triggers retreat
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      health: 8, // boundary HP = 8
      items: [{ name: 'diamond_sword', count: 1 }],
      entities: {
        302: { id: 302, name: 'zombie', position: new Vec3(3, 64, 0), isValid: true, health: 20 }
      }
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.IDLE;

    await tm.tick();
    assert.strictEqual(tm.state, THREAT_STATES.RETREATING, 'HP=8 must trigger retreat');
    assert.strictEqual(bot.controlStates.sprint, true);
    pass('HP=8 Grenzwert: Löst ebenfalls zuverlässig RETREATING mit Sprint aus');
    tm.stopMonitoring();
  }

  // Test 3c: HP = 9 (above critical threshold) -> Engages mob instead of retreating
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      health: 9, // HP = 9 > 8
      items: [{ name: 'diamond_sword', count: 1 }],
      entities: {
        303: { id: 303, name: 'zombie', position: new Vec3(4, 64, 0), isValid: true, health: 20 }
      }
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.IDLE;

    await tm.tick();
    assert.strictEqual(tm.state, THREAT_STATES.ENGAGING, 'HP=9 must engage, not retreat');
    assert(!bot.controlStates.sprint, 'Sprint must not be engaged when engaging');
    pass('HP=9 (>8 HP): Bot schaltet regulär in ENGAGING statt Rückzug');
    tm.stopMonitoring();
  }

  // Test 3d: handleBotHurt event triggers retreat on low health
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      health: 6,
      items: [{ name: 'iron_sword', count: 1 }]
    });
    const tm = new ThreatManager(bot);
    tm.bindEvents();

    bot.emit('entityHurt', bot.entity);
    // Allow async handleBotHurt to execute
    await new Promise(r => setTimeout(r, 50));

    assert.strictEqual(tm.state, THREAT_STATES.RETREATING);
    assert.strictEqual(bot.controlStates.sprint, true);
    pass('entityHurt Event: Triggert sofortigen Notfall-Rückzug bei Bot-Verletzung mit HP <= 8');
    tm.stopMonitoring();
  }

  // =========================================================================
  // 4. TOXIC FOOD REJECTION ADVERSARIAL HARNESS
  // =========================================================================
  console.log('\n--- Suite 4: Toxic Food Rejection & Safe Nutrition ---');

  // Test 4a: Bot inventory with ONLY rotten_flesh and spider_eye -> NEVER consumes
  {
    const bot = new MockChallengerBot({
      health: 5,
      food: 3,
      items: [
        { name: 'rotten_flesh', count: 64 },
        { name: 'spider_eye', count: 32 }
      ]
    });

    let consumedCalled = false;
    const origConsume = bot.consume.bind(bot);
    bot.consume = async () => {
      consumedCalled = true;
      return origConsume();
    };

    const ate = await inventoryManager.eatBestFood(bot);

    assert.strictEqual(ate, false, 'eatBestFood must return false when only toxic foods exist');
    assert.strictEqual(consumedCalled, false, 'bot.consume MUST NEVER be called on toxic food');
    assert.strictEqual(bot.equipped.hand, null, 'No toxic item should ever be equipped in hand');
    assert.strictEqual(bot.health, 5, 'Health must remain unchanged');
    assert.strictEqual(bot.food, 3, 'Food level must remain unchanged');
    pass('Toxische Nahrung (rotten_flesh, spider_eye): eatBestFood liefert false, 0 Konsumationen');
  }

  // Test 4b: Extended toxic items (poisonous_potato, pufferfish, chorus_fruit)
  {
    const bot = new MockChallengerBot({
      health: 4,
      food: 2,
      items: [
        { name: 'poisonous_potato', count: 10 },
        { name: 'pufferfish', count: 5 },
        { name: 'chorus_fruit', count: 16 }
      ]
    });

    const ate = await inventoryManager.eatBestFood(bot);
    assert.strictEqual(ate, false, 'eatBestFood must reject all poisonous/teleporting items');
    assert.strictEqual(bot.equipped.hand, null);
    pass('Erweiterte toxische Nahrung (poisonous_potato, pufferfish, chorus_fruit): Strikt abgewiesen');
  }

  // Test 4c: Toxic food mixed with wholesome food -> picks wholesome food, ignores toxic
  {
    const bot = new MockChallengerBot({
      health: 8,
      food: 6,
      items: [
        { name: 'rotten_flesh', count: 50 },
        { name: 'spider_eye', count: 20 },
        { name: 'golden_carrot', count: 8 }
      ]
    });

    const ate = await inventoryManager.eatBestFood(bot);
    assert.strictEqual(ate, true, 'Must successfully eat wholesome food');
    assert.strictEqual(bot.equipped.hand?.name, 'golden_carrot', 'Must equip golden_carrot, NOT toxic items');
    assert(bot.food > 6, 'Food level increased');
    pass('Mischinventar: Wählt gezielt golden_carrot und ignoriert toxische Beilagen');
  }

  // Test 4d: HEALING FSM state with ONLY toxic food transitions gracefully without hanging
  {
    const bot = new MockChallengerBot({
      health: 6,
      food: 5,
      items: [
        { name: 'rotten_flesh', count: 10 },
        { name: 'spider_eye', count: 10 }
      ]
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.HEALING;

    await tm.healingStep();
    assert.strictEqual(tm.state, THREAT_STATES.SECURING_PERIMETER, 'Without edible food, must transition to SECURING_PERIMETER');
    assert.strictEqual(bot.food, 5, 'Food level must not change');
    pass('Heilungs-FSM ohne essbare Nahrung: Geht geordnet zu SECURING_PERIMETER über, kein Endlosloop');
    tm.stopMonitoring();
  }

  // =========================================================================
  // 5. PERIMETER SWEEP & CONSTRUCTION RESUMPTION
  // =========================================================================
  console.log('\n--- Suite 5: Perimeter Sweep & Construction Resumption ---');

  // Test 5a: Secondary threat detected in perimeter -> Re-engages, does NOT resume build
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'diamond_sword', count: 1 }],
      entities: {
        501: { id: 501, name: 'skeleton', position: new Vec3(9, 64, 0), isValid: true, health: 20 }
      }
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.SECURING_PERIMETER;
    tm.wasBuildingBeforeThreat = true;
    tm.returnPosition = new Vec3(0, 64, 0);

    let resumeCalled = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { resumeCalled = true; };
    worldExecutor.pausedState = { dummy: true };

    await tm.securingStep();

    assert.strictEqual(tm.state, THREAT_STATES.ENGAGING, 'Must re-engage remaining threat');
    assert.strictEqual(tm.currentTarget?.id, 501);
    assert.strictEqual(resumeCalled, false, 'Build must NOT resume while threats remain');
    assert.strictEqual(tm.wasBuildingBeforeThreat, true, 'Building flag must be preserved');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    tm.stopMonitoring();
    pass('Perimeter-Prüfung mit Folgebedrohung: Re-engagiert Skelett, Bauauftrag bleibt pausiert');
  }

  // Test 5b: Perimeter clean -> Returns to build position and resumes construction
  {
    const returnPos = new Vec3(10, 64, 10);
    const bot = new MockChallengerBot({
      position: new Vec3(25, 64, 25), // 21.2m away from build site
      items: [{ name: 'diamond_sword', count: 1 }],
      entities: {} // No hostiles
    });
    const tm = new ThreatManager(bot);
    tm.state = THREAT_STATES.SECURING_PERIMETER;
    tm.wasBuildingBeforeThreat = true;
    tm.returnPosition = returnPos;

    let resumedBot = null;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async (b) => {
      resumedBot = b;
      return true;
    };
    worldExecutor.pausedState = {
      bot,
      blocks: [{ x: 10, y: 64, z: 10, fullBlockString: 'minecraft:stone' }],
      phase: 1
    };

    await tm.securingStep();

    assert.strictEqual(tm.state, THREAT_STATES.IDLE, 'State must return to IDLE');
    assert.strictEqual(tm.wasBuildingBeforeThreat, false, 'wasBuilding flag must be cleared');
    assert.strictEqual(resumedBot, bot, 'worldExecutor.resumeBuild must be called with bot instance');
    assert(bot.gotoHistory.length > 0, 'Bot must navigate back to returnPosition via goto');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    tm.stopMonitoring();
    pass('Perimeter sauber: Bot kehrt zum Bauplatz (10, 64, 10) zurück und nimmt Bauauftrag wieder auf');
  }

  // =========================================================================
  // 6. SLEEPCONTROLLER CLEAN DISCONNECT ON MISSING / OCCUPIED BEDS
  // =========================================================================
  console.log('\n--- Suite 6: SleepController Clean Disconnect ---');

  // Test 6a: Night time with NO beds in world -> bot.quit('Night skip disconnect') + chat announcement
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      timeOfDay: 15000, // Night (12542 <= time <= 23459)
      blocks: {} // Zero beds
    });

    let reconnectCalled = false;
    const mockBotClient = {
      bot,
      reconnect: () => { reconnectCalled = true; }
    };

    const sc = new SleepController(mockBotClient);
    worldExecutor.isBuilding = true;
    worldExecutor.buildProgress.active = true;

    await sc.handleSleepOpportunity();

    assert.strictEqual(sc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT, 'State must be DISCONNECTED_FOR_NIGHT');
    assert.strictEqual(bot.connected, false, 'Bot must be disconnected');
    assert.strictEqual(bot.quitReason, 'Night skip disconnect', 'Exact quit reason must match');
    assert(bot.chatHistory.some(m => m.includes('Gute Nacht!')), 'Chat announcement must be sent');
    assert.strictEqual(worldExecutor.pauseRequested, true, 'Building must be paused');
    assert(sc.reconnectTimer !== null, 'Reconnect timer must be scheduled');

    sc.stopMonitoring();
    worldExecutor.isBuilding = false;
    pass('Kein Bett in der Nacht: Sauberer Disconnect (bot.quit), Chat-Nachricht und Bau-Pausierung');
  }

  // Test 6b: Beds exist, but ALL are occupied -> Clean disconnect triggered
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      timeOfDay: 14500,
      blocks: {
        '2,64,2': {
          name: 'red_bed',
          type: 101,
          position: new Vec3(2, 64, 2),
          properties: { occupied: 'true' }
        },
        '4,64,4': {
          name: 'blue_bed',
          type: 102,
          position: new Vec3(4, 64, 4),
          getProperties: () => ({ occupied: true })
        }
      }
    });

    const sc = new SleepController({ bot, reconnect: () => {} });
    await sc.handleSleepOpportunity();

    assert.strictEqual(sc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT, 'Occupied beds must cause disconnect');
    assert.strictEqual(bot.quitReason, 'Night skip disconnect');
    sc.stopMonitoring();
    pass('Nur belegte Betten vorhanden: Saubere Trennung verhindert Blockieren anderer Spieler');
  }

  // Test 6c: Bed exists and is unoccupied, but bot.sleep throws 'monsters nearby' -> Fallback disconnect
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      timeOfDay: 15500,
      blocks: {
        '3,64,3': {
          name: 'white_bed',
          type: 103,
          position: new Vec3(3, 64, 3),
          properties: { occupied: 'false' },
          forceMonsterNearby: true // Will throw error in bot.sleep
        }
      }
    });

    const sc = new SleepController({ bot, reconnect: () => {} });
    await sc.handleSleepOpportunity();

    assert.strictEqual(sc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT, 'Monsters nearby during sleep must trigger disconnect fallback');
    assert.strictEqual(bot.quitReason, 'Night skip disconnect');
    sc.stopMonitoring();
    pass('Monster in Bettnähe (bot.sleep Fehler): Fallback-Disconnect rettet Nacht-Skip für Mitspieler');
  }

  // Test 6d: Daytime with no beds -> Does NOT disconnect
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      timeOfDay: 5000, // Daylight
      blocks: {}
    });

    const sc = new SleepController({ bot, reconnect: () => {} });
    await sc.handleSleepOpportunity();

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'Must remain AWAKE during daytime');
    assert.strictEqual(bot.connected, true, 'Must stay connected during daytime');
    assert.strictEqual(bot.quitReason, null);
    sc.stopMonitoring();
    pass('Tagzeit ohne Betten: Kein Disconnect');
  }

  // =========================================================================
  // 7. AUTO-RECONNECT TIMER
  // =========================================================================
  console.log('\n--- Suite 7: Auto-Reconnect Timer Logic ---');

  // Test 7a: Timer triggers botClient.reconnect()
  {
    const bot = new MockChallengerBot({ timeOfDay: 16000 });
    let reconnectCalled = false;
    const mockClient = {
      bot,
      reconnect: () => { reconnectCalled = true; }
    };

    const sc = new SleepController(mockClient);
    await sc.disconnectForNight();

    assert(sc.reconnectTimer !== null, 'Reconnect timer must be scheduled');

    // Simulate timer firing by clearing existing timer and invoking handler
    clearTimeout(sc.reconnectTimer);
    sc.reconnectTimer = null;
    sc.state = SLEEP_STATES.AWAKE;
    mockClient.reconnect();

    assert.strictEqual(reconnectCalled, true, 'botClient.reconnect() must be invoked');
    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'State resets to AWAKE upon reconnect');
    sc.stopMonitoring();
    pass('Reconnect-Timer: Löst botClient.reconnect() aus und setzt State auf AWAKE');
  }

  // Test 7b: stopMonitoring cancels pending reconnect timer
  {
    const bot = new MockChallengerBot({ timeOfDay: 16000 });
    const mockClient = { bot, reconnect: () => {} };
    const sc = new SleepController(mockClient);

    await sc.disconnectForNight();
    assert(sc.reconnectTimer !== null);

    sc.stopMonitoring();
    assert.strictEqual(sc.reconnectTimer, null, 'stopMonitoring must clear reconnectTimer to avoid memory leaks');
    pass('stopMonitoring bricht anstehenden Reconnect-Timer sauber ab');
  }

  // =========================================================================
  // 8. DAYLIGHT RESUMPTION ON BOT SPAWN
  // =========================================================================
  console.log('\n--- Suite 8: Daylight Resumption After Reconnect ---');

  // Test 8a: Spawn during daytime -> Resumes paused build
  {
    const morningBot = new MockChallengerBot({
      position: new Vec3(5, 64, 5),
      timeOfDay: 1000 // Daytime!
    });

    let resumedWithBot = null;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async (b) => {
      resumedWithBot = b;
      return true;
    };
    worldExecutor.pausedState = {
      bot: morningBot,
      blocks: [{ x: 5, y: 64, z: 5, fullBlockString: 'minecraft:stone' }],
      title: 'Daylight Test'
    };

    const sc = new SleepController({ bot: morningBot });
    sc.wasBuildingBeforeSleep = true;

    await sc.onBotSpawn(morningBot);

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'State must be AWAKE');

    // Wait for 1000ms debounce in SleepController.onBotSpawn
    await new Promise(r => setTimeout(r, 1150));

    assert.strictEqual(resumedWithBot, morningBot, 'worldExecutor.resumeBuild must be called with morningBot');
    assert.strictEqual(sc.wasBuildingBeforeSleep, false, 'wasBuilding flag must be reset');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    sc.stopMonitoring();
    pass('Spawn am Morgen (Tagzeit): onBotSpawn reaktiviert und setzt pausierten Bauauftrag fort');
  }

  // Test 8b: Spawn while STILL NIGHT -> Safely repeats disconnect cycle, does NOT resume build
  {
    const nightBot = new MockChallengerBot({
      position: new Vec3(5, 64, 5),
      timeOfDay: 18000, // Midnight!
      blocks: {}
    });

    let resumedCalled = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { resumedCalled = true; };
    worldExecutor.pausedState = { bot: nightBot, blocks: [] };

    const sc = new SleepController({ bot: nightBot });
    sc.wasBuildingBeforeSleep = true;

    await sc.onBotSpawn(nightBot);

    assert.strictEqual(sc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT, 'Must repeat disconnect if still night without bed');
    assert.strictEqual(nightBot.connected, false);
    assert.strictEqual(resumedCalled, false, 'Must NOT resume build during night');
    assert.strictEqual(sc.wasBuildingBeforeSleep, true, 'Building state preserved for morning');

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    sc.stopMonitoring();
    pass('Spawn während es noch Nacht ist: Wiederholt Disconnect und verhindert vorzeitige Bauaktivität');
  }

  // =========================================================================
  // 9. FULL END-TO-END ADVERSARIAL LIFECYCLES & MULTI-MOB STRESS
  // =========================================================================
  console.log('\n--- Suite 9: End-to-End Combat & Sleep Adversarial Lifecycles ---');

  // Test 9a: Full Creeper Combat Lifecycle during active Construction
  {
    worldExecutor.isBuilding = true;
    worldExecutor.buildProgress.active = true;
    worldExecutor.buildProgress.phase = 'Tragwerk Phase';

    const buildSite = new Vec3(100, 64, 100);
    const bot = new MockChallengerBot({
      position: buildSite.clone(),
      items: [{ name: 'netherite_sword', count: 1 }],
      entities: {}
    });

    const creeper = {
      id: 901,
      name: 'creeper',
      position: new Vec3(102, 64, 100), // 2m distance
      isValid: true,
      health: 14
    };
    bot.entities[901] = creeper;

    const tm = new ThreatManager(bot);

    // Step 1: Detect threat and pause build
    await tm.tick();
    assert.strictEqual(tm.state, THREAT_STATES.ENGAGING);
    assert.strictEqual(worldExecutor.pauseRequested, true);
    assert.strictEqual(tm.wasBuildingBeforeThreat, true);

    // Step 2: Combat step 1 - Strike and backpedal
    await tm.combatStep();
    assert(bot.attackHistory.length >= 1);
    assert(bot.currentGoal !== null);
    assert.strictEqual(creeper.health, 7);

    // Step 3: Combat step 2 - Strike again and neutralize
    tm.lastAttackTime = Date.now() - 1000;
    await tm.combatStep();
    assert.strictEqual(creeper.health, 0);
    assert.strictEqual(creeper.isValid, false);

    // Step 4: Next combat step recognizes target neutralization
    await tm.combatStep();
    assert.strictEqual(tm.state, THREAT_STATES.SECURING_PERIMETER);

    // Step 5: Securing perimeter with 0 threats -> Returns to build site and resumes build
    delete bot.entities[901];
    let buildResumed = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { buildResumed = true; return true; };
    worldExecutor.pausedState = { bot, blocks: [] };

    await tm.securingStep();
    assert.strictEqual(tm.state, THREAT_STATES.IDLE);
    assert.strictEqual(buildResumed, true);
    assert.strictEqual(tm.wasBuildingBeforeThreat, false);

    worldExecutor.resumeBuild = origResume;
    worldExecutor.pausedState = null;
    worldExecutor.isBuilding = false;
    tm.stopMonitoring();
    pass('End-to-End Creeper Lifecycle: Pause -> Hit & Backpedal -> Kill -> Sweep -> Resume Build');
  }

  // Test 9b: Multi-mob retreat persistence: Stays in RETREATING while any mob is within 8m
  {
    const bot = new MockChallengerBot({
      position: new Vec3(0, 64, 0),
      health: 7,
      entities: {
        902: { id: 902, name: 'zombie', position: new Vec3(3, 64, 0), isValid: true, health: 20 },
        903: { id: 903, name: 'skeleton', position: new Vec3(7, 64, 0), isValid: true, health: 20 }
      }
    });
    const tm = new ThreatManager(bot);
    await tm.tick(); // Enters RETREATING
    assert.strictEqual(tm.state, THREAT_STATES.RETREATING);
    assert.strictEqual(bot.controlStates.sprint, true);

    // Mob 902 was escaped, but Mob 903 is still at 7m (< 8m)
    delete bot.entities[902];
    await tm.retreatStep();
    assert.strictEqual(tm.state, THREAT_STATES.RETREATING, 'Must persist in RETREATING while secondary threat within 8m');
    assert.strictEqual(bot.controlStates.sprint, true);

    // Now bot reaches safe distance (> 8m) from all threats
    bot.entities[903].position = new Vec3(12, 64, 0);
    await tm.retreatStep();
    assert.strictEqual(tm.state, THREAT_STATES.HEALING, 'Must transition to HEALING once all mobs > 8m away');
    assert.strictEqual(bot.controlStates.sprint, false);

    tm.stopMonitoring();
    pass('Multi-Mob Rückzug: Bot sprintet weiter solange Sekundärmob < 8m, stoppt erst bei echtem Sicherheitsabstand');
  }

  // Test 9c: Chat trigger for sleep disconnect during building
  {
    const bot = new MockChallengerBot({
      position: new Vec3(50, 64, 50),
      timeOfDay: 14000,
      blocks: {}
    });

    const mockClient = { bot, reconnect: () => {} };
    const sc = new SleepController(mockClient);
    sc.bindEvents();

    worldExecutor.isBuilding = true;

    // Simulate other player chat event
    bot.emit('chat', 'Alice', 'Alice ging zu Bett');

    // Yield to let handleSleepOpportunity run
    await new Promise(r => setTimeout(r, 60));

    assert.strictEqual(sc.state, SLEEP_STATES.DISCONNECTED_FOR_NIGHT);
    assert.strictEqual(bot.connected, false);
    assert.strictEqual(bot.quitReason, 'Night skip disconnect');
    assert.strictEqual(worldExecutor.pauseRequested, true);

    sc.stopMonitoring();
    worldExecutor.isBuilding = false;
    pass('Chat-Trigger ("ging zu Bett"): Führt sauberen Disconnect aus und pausiert aktiven Bauauftrag');
  }

  console.log(`\n=============================================================`);
  console.log(`CHALLENGER 2 ERGEBNIS: ${passed}/${totalTests} TESTS ERFOLGREICH BESTANDEN`);
  console.log(`=============================================================`);
}

runAdversarialStressTests().catch(err => {
  console.error('FATAL in Challenger 2 Stress Test Suite:', err);
  process.exit(1);
});
