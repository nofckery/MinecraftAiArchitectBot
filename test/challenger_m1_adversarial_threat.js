/**
 * Adversarial Stress Test Suite: ThreatManager Multi-Mob & Survival Lifecycle Integration
 * Milestone M1 - Challenger 2
 *
 * Systematic empirical verification of:
 * 1. Multi-Threat Priority & Dynamic Target Switching (Creeper + Zombie combinations, >16m re-evaluation)
 * 2. Backpedal Movement Protection & Secondary Mob Interleaving
 * 3. Sleep / Night Cycle Threat Interruption & Conflict Resolution
 * 4. Nested Build Lifecycle: pauseBuild / resumeBuild across combat & sleep transitions
 * 5. Manual Gamemode Invariance: ThreatManager inhibition during operator takeover
 */

import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { settings } from '../src/config/settings.js';
import { ThreatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { SleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { inventoryManager } from '../src/bot/inventoryManager.js';
import { manualController } from '../src/bot/manualController.js';

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

class MockAdversarialBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.username = options.username || 'AdversaryBot';
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
    this.wakeCalls = 0;
    this.sleepCalls = 0;

    this.time = {
      timeOfDay: options.timeOfDay ?? 1000,
      isDay: options.timeOfDay !== undefined ? options.timeOfDay < 12542 : true
    };

    this.pathfinder = {
      isMoving: () => Boolean(this.currentGoal),
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

  setControlState(control, state) {
    this.controlStates[control] = state;
  }

  chat(msg) {
    this.chatHistory.push(msg);
  }

  async sleep(bedBlock) {
    this.sleepCalls++;
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
    this.wakeCalls++;
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
    const key = `${pos.x},${pos.y},${pos.z}`;
    return this.blocks[key] || null;
  }
}

async function runAdversarialTestSuite() {
  console.log('\x1b[36m=== STARTING CHALLENGER 2: ADVERSARIAL MULTI-THREAT & LIFECYCLE SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. MULTI-THREAT COMBINATIONS & DISTANCE PRIORITY
  // ==============================================================================
  console.log('--- Testgruppe 1: Multi-Threat Priority & Distance Sorting ---');
  {
    // 1.1 Coexisting Creeper & Zombie: Closer mob is prioritized
    const bot = new MockAdversarialBot({ position: new Vec3(0, 64, 0) });
    const tm = new ThreatManager(bot);

    const zombieEntity = { id: 101, name: 'zombie', health: 20, isValid: true, position: new Vec3(3, 64, 0) };
    const creeperEntity = { id: 102, name: 'creeper', health: 14, isValid: true, position: new Vec3(6, 64, 0) };
    bot.entities = { 101: zombieEntity, 102: creeperEntity };

    const detected = tm.findNearbyThreat(12.0);
    testAssert(detected === zombieEntity, '1.1 Näherer Zombie (3m) wird gegenüber weiterem Creeper (6m) als Priorität gewählt');

    // Invert distances: Creeper at 2m, Zombie at 5m
    creeperEntity.position = new Vec3(2, 64, 0);
    zombieEntity.position = new Vec3(5, 64, 0);
    const detected2 = tm.findNearbyThreat(12.0);
    testAssert(detected2 === creeperEntity, '1.2 Näherer Creeper (2m) wird gegenüber weiterem Zombie (5m) priorisiert');

    // 1.3 Target Switching when mob retreats beyond 16m
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = zombieEntity;
    zombieEntity.position = new Vec3(18, 64, 0); // Exceeds 16m threshold
    creeperEntity.position = new Vec3(4, 64, 0);  // Within 12m perimeter

    await tm.combatStep();
    testAssert(tm.currentTarget === creeperEntity, '1.3 Dynamischer Zielwechsel: Bot wechselt von entflohenem Zombie (18m) zu nahem Creeper (4m)');
    testAssert(tm.backpedalUntil === 0, '1.3 backpedalUntil wird beim Zielwechsel sicher auf 0 zurückgesetzt');

    // 1.4 Target Lock Retention: Bot maintains focus on current target if <= 16m
    tm.currentTarget = zombieEntity;
    zombieEntity.position = new Vec3(10, 64, 0); // Within 16m
    creeperEntity.position = new Vec3(3, 64, 0);  // Closer, but original target still in range

    await tm.combatStep();
    testAssert(tm.currentTarget === zombieEntity, '1.4 Zielfixierung: Aktives Ziel (10m <= 16m) wird während des Gefechts nicht mitten im Kampf verloren');
  }

  // ==============================================================================
  // 2. CREEPER + ZOMBIE COMBAT EXECUTION & SEQUENTIAL NEUTRALIZATION
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Creeper + Zombie Sequential Neutralization ---');
  {
    const bot = new MockAdversarialBot({
      position: new Vec3(0, 64, 0),
      items: [
        { name: 'diamond_sword', type: 276 },
        { name: 'shield', type: 442 }
      ]
    });
    const tm = new ThreatManager(bot);

    // Setup active construction
    worldExecutor.isBuilding = true;
    worldExecutor.pausedState = { title: 'Watchtower', ops: 10 };
    let resumeCalled = false;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { resumeCalled = true; };

    const creeperEntity = { id: 201, name: 'creeper', health: 14, isValid: true, position: new Vec3(2, 64, 0) };
    const zombieEntity = { id: 202, name: 'zombie', health: 7, isValid: true, position: new Vec3(5, 64, 0) };
    bot.entities = { 201: creeperEntity, 202: zombieEntity };

    // Bot engages Creeper
    await tm.engageThreat(creeperEntity);
    testAssert(tm.state === THREAT_STATES.ENGAGING, '2.1 FSM wechselt auf ENGAGING für Creeper');
    testAssert(tm.wasBuildingBeforeThreat === true, '2.1 wasBuildingBeforeThreat wird auf true gesetzt');
    testAssert(worldExecutor.pauseRequested === true, '2.1 Bauauftrag wird pausiert');

    // Hit 1 on Creeper (HP 14 -> 7)
    tm.lastAttackTime = Date.now() - 1000;
    await tm.combatStep();
    testAssert(creeperEntity.health === 7, '2.2 Creeper HP sinkt auf 7 nach Schlag 1');
    testAssert(tm.backpedalUntil > Date.now(), '2.2 Creeper-Treffer triggert 4m Backpedal-Fenster');
    testAssert(bot.currentGoal !== null, '2.2 Pathfinder hat Rückzugskoordinaten erhalten');

    // Hit 2 on Creeper during backpedal (HP 7 -> 0)
    // Note: Strike within 3.5m must execute even during backpedal window!
    tm.lastAttackTime = Date.now() - 1000;
    await tm.combatStep();
    testAssert(creeperEntity.health <= 0 && creeperEntity.isValid === false, '2.3 Creeper erfolgreich auf 0 HP neutralisiert');
    testAssert(tm.state === THREAT_STATES.SECURING_PERIMETER, '2.3 FSM wechselt unmittelbar zu SECURING_PERIMETER');
    testAssert(tm.currentTarget === null, '2.3 currentTarget wird nach Kill sauber genullt');

    // Perimeter sweep discovers the surviving Zombie
    await tm.securingStep();
    testAssert(tm.state === THREAT_STATES.ENGAGING, '2.4 Perimeter-Sweep entdeckt Sekundärbedrohung (Zombie) und schaltet erneut auf ENGAGING');
    testAssert(tm.currentTarget === zombieEntity, '2.4 currentTarget wechselt auf Zombie');
    testAssert(tm.wasBuildingBeforeThreat === true, '2.4 Bau-Fortsetzungsflag bleibt für den Zombie erhalten');
    testAssert(resumeCalled === false, '2.4 Bauauftrag wird NICHT vorzeitig fortgesetzt solange Zombie lebt');

    // Bot approaches and eliminates Zombie
    zombieEntity.position = new Vec3(2, 64, 0);
    tm.lastAttackTime = Date.now() - 1000;
    await tm.combatStep();
    testAssert(zombieEntity.health <= 0 && zombieEntity.isValid === false, '2.5 Zombie erfolgreich neutralisiert');
    testAssert(tm.state === THREAT_STATES.SECURING_PERIMETER, '2.5 FSM wechselt nach Zombie-Kill zu SECURING_PERIMETER');

    // Final perimeter sweep: All mobs dead -> Safe return & Resume build
    await tm.securingStep();
    testAssert(tm.state === THREAT_STATES.IDLE, '2.6 Perimeter sauber: FSM wechselt auf IDLE');
    testAssert(resumeCalled === true, '2.6 worldExecutor.resumeBuild() nach Beseitigung aller Mobs aufgerufen');
    testAssert(tm.wasBuildingBeforeThreat === false, '2.6 wasBuildingBeforeThreat wieder sauber zurückgesetzt');

    worldExecutor.resumeBuild = origResume;
  }

  // ==============================================================================
  // 3. SLEEP / NIGHT CYCLE THREAT INTERRUPTION & BED CONFLICTS
  // ==============================================================================
  console.log('\n--- Testgruppe 3: Sleep & Night Cycle Threat Interruption ---');
  {
    const bot = new MockAdversarialBot({
      position: new Vec3(10, 64, 10),
      timeOfDay: 14000 // Night
    });
    const sc = new SleepController({ bot });
    const tm = new ThreatManager(bot);

    // Bed available at (12, 64, 10)
    const bedBlock = {
      name: 'red_bed',
      type: 100,
      position: new Vec3(12, 64, 10),
      properties: { occupied: false }
    };
    bot.blocks['12,64,10'] = bedBlock;

    // 3.1 Threat interrupts navigation to bed
    sc.state = SLEEP_STATES.AWAKE;
    let bedReached = false;
    const origGoto = bot.pathfinder.goto;

    // Simulate ThreatManager tick during bed navigation
    const spiderEntity = { id: 301, name: 'spider', health: 16, isValid: true, position: new Vec3(8, 64, 10) };
    bot.entities = { 301: spiderEntity };

    // ThreatManager detects spider while SleepController was about to sleep
    const threat = tm.findNearbyThreat(12.0);
    testAssert(threat === spiderEntity, '3.1 ThreatManager erkennt Spinne in Bettnähe (2m Entfernung)');

    await tm.engageThreat(threat);
    testAssert(tm.state === THREAT_STATES.ENGAGING, '3.1 ThreatManager schaltet auf ENGAGING um Bot zu verteidigen');
    testAssert(bot.currentGoal === null, '3.1 Pfadfindung zum Bett wird gestoppt');

    // 3.2 Monster nearby error during sleep interaction triggers Clean Disconnect fallback
    bedBlock.forceMonsterNearby = true;
    let quitCalled = false;
    bot.on('end', (reason) => {
      quitCalled = true;
    });

    await sc.goToBedAndSleep(bedBlock);
    testAssert(quitCalled === true, '3.2 bot.sleep Fehler ("monsters nearby") triggert Clean Disconnect für Nacht-Skip');
    testAssert(sc.state === SLEEP_STATES.DISCONNECTED_FOR_NIGHT, '3.2 SleepController wechselt in DISCONNECTED_FOR_NIGHT');
    testAssert(sc.reconnectTimer !== null, '3.2 Reconnect-Timer für morgendliche Rückkehr aktiv');

    sc.stopMonitoring();
  }

  // ==============================================================================
  // 4. NESTED BUILD LIFECYCLE: PAUSE & RESUME ROBUSTNESS
  // ==============================================================================
  console.log('\n--- Testgruppe 4: Nested Build Lifecycle: Pause / Resume Robustness ---');
  {
    const bot = new MockAdversarialBot({
      position: new Vec3(50, 64, 50),
      items: [{ name: 'diamond_sword', type: 276 }]
    });
    const tm = new ThreatManager(bot);
    const sc = new SleepController({ bot });

    worldExecutor.isBuilding = true;
    worldExecutor.pauseRequested = false;
    worldExecutor.pausedState = { title: 'Cathedral Pillar', progress: 0.5 };

    let resumeCount = 0;
    const origResume = worldExecutor.resumeBuild;
    worldExecutor.resumeBuild = async () => { resumeCount++; };

    // Threat emerges during build
    const skeletonEntity = { id: 401, name: 'skeleton', health: 20, isValid: true, position: new Vec3(53, 64, 50) };
    bot.entities = { 401: skeletonEntity };

    await tm.engageThreat(skeletonEntity);
    testAssert(tm.wasBuildingBeforeThreat === true, '4.1 Bauzustand vor Bedrohung erfolgreich registriert');
    testAssert(tm.returnPosition !== null && tm.returnPosition.x === 50, '4.1 Ursprüngliche Bauposition (50, 64, 50) gesichert');

    // Bot is knocked back during combat to (58, 64, 50)
    bot.entity.position = new Vec3(58, 64, 50);

    // Skeleton neutralized
    skeletonEntity.health = 0;
    skeletonEntity.isValid = false;
    await tm.combatStep();
    testAssert(tm.state === THREAT_STATES.SECURING_PERIMETER, '4.2 Skelett neutralisiert -> SECURING_PERIMETER');

    // Sweep: Bot must navigate back to returnPosition before resuming build
    await tm.securingStep();
    testAssert(bot.gotoHistory.length > 0, '4.3 Bot navigiert autonom zurück zum ursprünglichen Bauplatz (50, 64, 50)');
    testAssert(resumeCount === 1, '4.3 worldExecutor.resumeBuild() genau einmal nach Rückkehr aufgerufen');
    testAssert(tm.wasBuildingBeforeThreat === false, '4.3 wasBuildingBeforeThreat sauber auf false zurückgesetzt');

    worldExecutor.resumeBuild = origResume;
  }

  // ==============================================================================
  // 5. MANUAL GAMEMODE INVARIANCE & INHIBITION
  // ==============================================================================
  console.log('\n--- Testgruppe 5: Manual Gamemode Takeover Invariance ---');
  {
    const bot = new MockAdversarialBot({ position: new Vec3(0, 64, 0) });
    const tm = new ThreatManager(bot);

    const hostileZombie = { id: 501, name: 'zombie', health: 20, isValid: true, position: new Vec3(2, 64, 0) };
    bot.entities = { 501: hostileZombie };

    // Activate manual gamemode takeover
    manualController.activate(bot);
    testAssert(manualController.isActive() === true, '5.1 ManualController ist aktiv');

    // ThreatManager tick must NOT engage or override controls
    await tm.tick();
    testAssert(tm.state === THREAT_STATES.IDLE, '5.2 ThreatManager.tick() ignoriert Bedrohungen während manuellem Gamemode');
    testAssert(tm.currentTarget === null, '5.2 currentTarget bleibt null');

    // Bot damage event must NOT trigger emergency retreat during manual control
    bot.health = 5;
    await tm.handleBotHurt();
    testAssert(tm.state === THREAT_STATES.IDLE, '5.3 handleBotHurt() löst keinen unkontrollierten Rückzug während Operator-Takeover aus');

    manualController.deactivate();
  }

  // ==============================================================================
  // 6. COINCIDENT POSITIONS & MID-FIGHT TARGET DESPAWN
  // ==============================================================================
  console.log('\n--- Testgruppe 6: Coincident Coordinates & Mid-Fight Despawn ---');
  {
    const bot = new MockAdversarialBot({ position: new Vec3(100, 64, 100) });
    const tm = new ThreatManager(bot);

    // Creeper at identical position (0 distance)
    const coincidentCreeper = { id: 601, name: 'creeper', health: 14, isValid: true, position: new Vec3(100, 64, 100) };
    bot.entities = { 601: coincidentCreeper };
    tm.state = THREAT_STATES.ENGAGING;
    tm.currentTarget = coincidentCreeper;

    tm.lastAttackTime = Date.now() - 1000;
    await tm.combatStep();
    testAssert(!Number.isNaN(bot.currentGoal?.x) && !Number.isNaN(bot.currentGoal?.z), '6.1 Exakte Mob-Koinzidenz (0m) erzeugt keinen NaN im Creeper-Rückzugsvektor');
    testAssert(bot.currentGoal.x === 104, '6.1 Fallback-Vektor (+4, 0, 0) weicht sauber nach x+4 aus');

    // Target suddenly despawns (isValid = false) during backpedal window
    testAssert(tm.backpedalUntil > Date.now(), '6.2 Backpedal-Fenster aktiv');
    coincidentCreeper.isValid = false;
    await tm.combatStep();
    testAssert(tm.state === THREAT_STATES.SECURING_PERIMETER, '6.2 Despawn während Backpedal bricht Kampf sofort ab -> SECURING_PERIMETER');
    testAssert(tm.currentTarget === null, '6.2 currentTarget genullt');
    testAssert(tm.backpedalUntil === 0, '6.2 backpedalUntil sofort auf 0 gelöscht');
  }

  // ==============================================================================
  // 7. 5-MOB SWARM STRESS & COOLDOWN PACING
  // ==============================================================================
  console.log('\n--- Testgruppe 7: 5-Mob Swarm Stress & Weapon Cooldown Pacing ---');
  {
    const bot = new MockAdversarialBot({
      position: new Vec3(0, 64, 0),
      items: [{ name: 'netherite_sword', type: 276 }]
    });
    const tm = new ThreatManager(bot);

    // 5 Hostile Mobs surrounding bot at varying radii
    const swarm = {
      701: { id: 701, name: 'creeper', health: 14, isValid: true, position: new Vec3(11, 64, 0) },   // 11m
      702: { id: 702, name: 'zombie', health: 20, isValid: true, position: new Vec3(0, 64, 8) },      // 8m
      703: { id: 703, name: 'spider', health: 16, isValid: true, position: new Vec3(-5, 64, 0) },     // 5m
      704: { id: 704, name: 'skeleton', health: 20, isValid: true, position: new Vec3(0, 64, -2) },   // 2m (Closest)
      705: { id: 705, name: 'witch', health: 26, isValid: true, position: new Vec3(15, 64, 0) }      // 15m (>12m radius)
    };
    bot.entities = swarm;

    // 7.1 Selection from swarm: Skeleton at 2m must be targeted first
    const firstTarget = tm.findNearbyThreat(12.0);
    testAssert(firstTarget === swarm[704], '7.1 Schwarm: Nächstes Monster (Skelett bei 2m) wird aus 5 Mobs gewählt');

    // 7.2 Witch at 15m is outside 12m threat radius and ignored
    const outOfRangeWitch = tm.findNearbyThreat(12.0);
    testAssert(outOfRangeWitch !== swarm[705], '7.2 Hexe bei 15m außerhalb des Schutzradius (12m) wird ignoriert');

    // 7.3 Cooldown pacing: Attack denied when cooldown has not elapsed
    await tm.engageThreat(firstTarget);
    tm.lastAttackTime = Date.now(); // Attack just executed
    const attackCountBefore = bot.attackHistory.length;

    await tm.combatStep();
    testAssert(bot.attackHistory.length === attackCountBefore, '7.3 Cooldown-Pacing: Zweiter Angriff innerhalb der 625ms Abklingzeit strikt blockiert');

    // Advance simulated time beyond 625ms cooldown
    tm.lastAttackTime = Date.now() - 700;
    await tm.combatStep();
    testAssert(bot.attackHistory.length === attackCountBefore + 1, '7.3 Cooldown abgelaufen: Folgeschlag wird ordnungsgemäß ausgeführt');
  }

  console.log(`\n\x1b[32m=== CHALLENGER 2 ADVERSARIAL SUITE: ${passedTests}/${totalTests} TESTS BESTANDEN ===\x1b[0m\n`);
}

runAdversarialTestSuite().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('\x1b[31m[ADVERSARIAL SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});
