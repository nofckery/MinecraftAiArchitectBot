import assert from 'assert';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { settings } from '../src/config/settings.js';
import { ScaffoldManager, scaffoldManager, DEFAULT_SCAFFOLD_MATERIALS } from '../src/survival/scaffoldManager.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';

class MockBuilderBot extends EventEmitter {
  constructor(options = {}) {
    super();
    this.username = options.username || 'BaumeisterKI';
    this.entity = {
      id: 1,
      name: 'player',
      position: options.position ? options.position.clone() : new Vec3(0, 64, 0),
      height: 1.62
    };
    this.inventoryItems = options.items || [];
    this.blocks = options.blocks || {};
    this.placedBlocks = [];
    this.dugBlocks = [];
    this.controlStates = {};
    this.equipped = { hand: null };

    this.pathfinder = {
      goto: async (goal) => {
        if (goal && typeof goal.x === 'number') {
          this.entity.position = new Vec3(goal.x, goal.y, goal.z);
        } else if (goal && goal.target) {
          this.entity.position = new Vec3(goal.target.x, goal.target.y, goal.target.z);
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

  blockAt(pos) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    if (this.blocks[key]) return this.blocks[key];
    return {
      name: 'air',
      position: pos.floored()
    };
  }

  setBlock(pos, name) {
    const key = `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
    this.blocks[key] = {
      name,
      position: pos.floored()
    };
  }

  async equip(item, destination) {
    this.equipped[destination] = item;
  }

  setControlState(control, state) {
    this.controlStates[control] = state;
  }

  async lookAt(pos) {
    this.lookedAtPos = pos;
  }

  swingArm(hand) {}

  async placeBlock(referenceBlock, faceVector) {
    const newPos = referenceBlock.position.plus(faceVector);
    const itemName = this.equipped.hand ? this.equipped.hand.name : 'stone';
    this.setBlock(newPos, itemName);
    this.placedBlocks.push({ pos: newPos, name: itemName, against: referenceBlock.position });
  }

  async dig(block) {
    const key = `${Math.floor(block.position.x)},${Math.floor(block.position.y)},${Math.floor(block.position.z)}`;
    delete this.blocks[key];
    this.dugBlocks.push({ pos: block.position, name: block.name });
  }
}

async function runScaffoldManagerTests() {
  console.log('=== STARTING SCAFFOLDING & SURVIVAL HEIGHT-BUILDING TEST SUITE ===\n');
  let passed = 0;

  function pass(msg) {
    passed++;
    console.log(`[PASS] ${msg}`);
  }

  const sm = new ScaffoldManager();

  // --- Testgruppe 1: Reichweiten- und Distanzgeometrie ---
  console.log('--- Testgruppe 1: Reichweiten- und Distanzgeometrie ---');

  // Bot steht bei (0, 64, 0), Augenhöhe ist 65.62
  const stand1 = new Vec3(0, 64, 0);
  const targetReachable = new Vec3(1, 65, 1);
  const targetTooFar = new Vec3(0, 72, 0); // 8 Blöcke höher

  assert.strictEqual(sm.isReachableFrom(stand1, targetReachable, 3.8), true, 'Ziel in 2.2m ist erreichbar');
  pass('isReachableFrom erkennt Block in Reichweite (<= 3.8m)');

  assert.strictEqual(sm.isReachableFrom(stand1, targetTooFar, 3.8), false, 'Ziel in 8m Höhe ist außer Reichweite');
  pass('isReachableFrom erkennt Block außerhalb der Reichweite (> 3.8m)');

  assert.strictEqual(sm.isReachableFrom(null, targetReachable), false, 'Null-Standort gibt false');
  assert.strictEqual(sm.isReachableFrom(stand1, null), false, 'Null-Ziel gibt false');
  pass('isReachableFrom ist robust gegen null/undefined');

  // --- Testgruppe 2: Materialpriorisierung im Inventar ---
  console.log('\n--- Testgruppe 2: Materialpriorisierung im Inventar ---');

  const botWithScaffoldingAndDirt = new MockBuilderBot({
    items: [
      { name: 'dirt', count: 64 },
      { name: 'scaffolding', count: 32 },
      { name: 'cobblestone', count: 64 }
    ]
  });

  const matPrio1 = sm.getAvailableScaffoldMaterial(botWithScaffoldingAndDirt);
  assert.strictEqual(matPrio1.name, 'scaffolding', 'Scaffolding hat höchste Priorität');
  assert.strictEqual(matPrio1.isVanillaScaffolding, true, 'isVanillaScaffolding ist true');
  pass('getAvailableScaffoldMaterial bevorzugt echtes Bamboo Scaffolding vor Erde/Stein');

  const botWithOnlyDirt = new MockBuilderBot({
    items: [
      { name: 'dirt', count: 48 },
      { name: 'cobblestone', count: 12 }
    ]
  });
  const matPrio2 = sm.getAvailableScaffoldMaterial(botWithOnlyDirt);
  assert.strictEqual(matPrio2.name, 'dirt', 'Erde hat Prio vor Stein als Fallback');
  assert.strictEqual(matPrio2.isVanillaScaffolding, false, 'isVanillaScaffolding ist false bei Erde');
  pass('getAvailableScaffoldMaterial fällt sauber auf Erde zurück');

  const botWithNoScaffold = new MockBuilderBot({
    items: [{ name: 'diamond', count: 5 }]
  });
  assert.strictEqual(sm.getAvailableScaffoldMaterial(botWithNoScaffold), null, 'Kein Gerüstmaterial liefert null');
  pass('getAvailableScaffoldMaterial liefert null bei fehlendem Material');

  // --- Testgruppe 3: Standplatzsuche auf existierendem Terrain ---
  console.log('\n--- Testgruppe 3: Standplatzsuche auf existierendem Terrain ---');

  const terrainBot = new MockBuilderBot({
    position: new Vec3(0, 64, 0)
  });
  // Erzeuge soliden Boden bei Y=63
  for (let x = -5; x <= 5; x++) {
    for (let z = -5; z <= 5; z++) {
      terrainBot.setBlock(new Vec3(x, 63, z), 'dirt');
    }
  }

  // Zielblock bei (2, 64, 2)
  const targetOnGround = new Vec3(2, 64, 2);
  const foundSpot = sm.findWalkableStandingSpot(terrainBot, targetOnGround, { maxReach: 3.8 });
  assert(foundSpot !== null, 'Standplatz auf existierendem Boden gefunden');
  assert(sm.isReachableFrom(foundSpot, targetOnGround, 3.8), 'Gefundener Standplatz kann Zielblock erreichen');
  assert(!foundSpot.equals(targetOnGround), 'Standplatz kollidiert nicht mit Zielblock');
  pass('findWalkableStandingSpot findet soliden, begehbaren Boden innerhalb von 3.8m');

  // Zielblock hoch in der Luft (Y=75)
  const aerialTarget = new Vec3(2, 75, 2);
  const noSpot = sm.findWalkableStandingSpot(terrainBot, aerialTarget, { maxReach: 3.8 });
  assert.strictEqual(noSpot, null, 'Kein Standplatz für freischwebendes Ziel in 11m Höhe');
  pass('findWalkableStandingSpot liefert null bei unerreichbarer Höhe (Gerüst erforderlich)');

  // --- Testgruppe 4: Gerüstplanung (Kollisionsvermeidung & Höhendimensionierung) ---
  console.log('\n--- Testgruppe 4: Gerüstplanung (Kollisionsvermeidung & Höhendimensionierung) ---');

  const highTarget = new Vec3(5, 72, 5);
  // Simuliere Gebäude-Blöcke an (6, 72, 5) -> dort darf KEIN Gerüst gebaut werden!
  const reservedBuildingBlocks = new Set(['6,72,5', '6,71,5', '6,70,5']);

  const plan = sm.planScaffold(terrainBot, highTarget, {
    reservedBlocks: reservedBuildingBlocks
  });

  assert(plan !== null, 'Gerüstplan erfolgreich berechnet');
  assert.strictEqual(plan.targetStandY, 71, 'Ziel-Standhöhe ist Y=71 (1 Block unter Zielblock 72)');
  assert.notStrictEqual(`${plan.columnX},72,${plan.columnZ}`, '6,72,5', 'Gerüstsäule meidet reservierte Gebäudekoordinaten');
  pass('planScaffold berechnet kollisionsfreie Spalte und passende Standhöhe');

  // --- Testgruppe 5: Gerüstbau (Erection) & Absturzsicherung ---
  console.log('\n--- Testgruppe 5: Gerüstbau (Erection) & Absturzsicherung ---');

  const erectBot = new MockBuilderBot({
    position: new Vec3(5, 64, 5),
    items: [{ name: 'dirt', count: 64 }]
  });
  // Boden bei Y=63
  for (let x = 3; x <= 7; x++) {
    for (let z = 3; z <= 7; z++) {
      erectBot.setBlock(new Vec3(x, 63, z), 'stone');
    }
  }

  const scaffoldPlan = {
    columnX: 6,
    columnZ: 5,
    groundY: 63,
    targetStandY: 68,
    standingPos: new Vec3(6, 68, 5)
  };

  const erectSuccess = await sm.erectScaffold(erectBot, scaffoldPlan);
  assert.strictEqual(erectSuccess, true, 'erectScaffold war erfolgreich');
  assert.strictEqual(sm.getActiveScaffoldsCount(), 4, 'Exakt 4 Gerüstblöcke errichtet (Y=64, 65, 66, 67)');
  assert.strictEqual(erectBot.controlStates.sneak, true, 'Bot schleicht (sneak: true) zur Absturzsicherung');
  assert.strictEqual(erectBot.entity.position.y, 68, 'Bot steht sicher auf Standposition Y=68');
  assert.strictEqual(sm.isScaffoldBlock(new Vec3(6, 65, 5)), true, 'isScaffoldBlock erkennt temporären Block');
  pass('erectScaffold errichtet Säule, aktiviert sneak und positioniert Bot oben');

  // --- Testgruppe 6: Staging-Orchestrierung (prepareStaging) ---
  console.log('\n--- Testgruppe 6: Staging-Orchestrierung (prepareStaging) ---');

  // Fall 1: Bereits in Reichweite
  const stagingBot = new MockBuilderBot({
    position: new Vec3(10, 64, 10),
    items: [{ name: 'dirt', count: 64 }]
  });
  const resAlready = await sm.prepareStaging(stagingBot, new Vec3(11, 65, 10));
  assert.strictEqual(resAlready.success, true, 'prepareStaging erfolgreich');
  assert.strictEqual(resAlready.scaffolded, false, 'Kein Gerüst nötig, da bereits in Reichweite');
  pass('prepareStaging erkennt sofortige Erreichbarkeit ohne Umwege');

  // Fall 2: Durch Laufen erreichbar
  for (let x = 8; x <= 16; x++) {
    for (let z = 8; z <= 16; z++) {
      stagingBot.setBlock(new Vec3(x, 63, z), 'stone');
    }
  }
  const resWalk = await sm.prepareStaging(stagingBot, new Vec3(15, 64, 15));
  assert.strictEqual(resWalk.success, true, 'prepareStaging durch Laufen erfolgreich');
  assert.strictEqual(resWalk.scaffolded, false, 'Kein Gerüst nötig, nur Bewegung');
  assert(stagingBot.entity.position.distanceTo(new Vec3(15, 64, 15)) <= 3.8, 'Bot ist in Reichweite gelaufen');
  pass('prepareStaging nutzt vorhandenen Boden und navigiert den Bot via Pathfinder');

  // Fall 3: Hoher Block (Y=70) erfordert Gerüstbau
  const resHigh = await sm.prepareStaging(stagingBot, new Vec3(12, 70, 12));
  assert.strictEqual(resHigh.success, true, 'prepareStaging für hohen Block erfolgreich');
  assert.strictEqual(resHigh.scaffolded, true, 'Gerüstbau wurde aktiviert');
  assert(sm.getActiveScaffoldsCount() > 0, 'Aktive Gerüstblöcke registriert');
  assert.strictEqual(stagingBot.controlStates.sneak, true, 'Absturzschutz aktiv');
  pass('prepareStaging baut autonom Gerüst bei Zielen über Reichweite');

  // --- Testgruppe 7: Vollständiger Rückbau (dismantleAll) ---
  console.log('\n--- Testgruppe 7: Vollständiger Rückbau (dismantleAll) ---');

  assert(sm.getActiveScaffoldsCount() > 0, 'Gerüste vorhanden vor Dismantle');
  const dismantleRes = await sm.dismantleAll(stagingBot);
  assert.strictEqual(dismantleRes.success, true, 'dismantleAll erfolgreich');
  assert(dismantleRes.count > 0, 'Mindestens 1 Block abgebaut');
  assert.strictEqual(sm.getActiveScaffoldsCount(), 0, 'Alle Gerüstblöcke restlos aus activeScaffolds entfernt');
  assert.strictEqual(stagingBot.controlStates.sneak, false, 'Sneak nach Rückbau wieder deaktiviert');
  pass('dismantleAll baut alle Gerüste rückstandslos ab und hebt Sneak auf');

  // --- Testgruppe 8: Integration in WorldExecutor (pure_physical Modus) ---
  console.log('\n--- Testgruppe 8: Integration in WorldExecutor (pure_physical Modus) ---');

  const execBot = new MockBuilderBot({
    position: new Vec3(20, 64, 20),
    items: [
      { name: 'oak_planks', count: 64 },
      { name: 'dirt', count: 64 },
      { name: 'iron_shovel', count: 1 }
    ]
  });
  // Boden
  for (let x = 18; x <= 25; x++) {
    for (let z = 18; z <= 25; z++) {
      execBot.setBlock(new Vec3(x, 63, z), 'stone');
    }
  }

  // 3 Blöcke in die Höhe bauen (Y=64, Y=65, Y=66)
  const towerBlocks = [
    { x: 20, y: 64, z: 20, name: 'oak_planks' },
    { x: 20, y: 65, z: 20, name: 'oak_planks' },
    { x: 20, y: 66, z: 20, name: 'oak_planks' }
  ];

  const execSuccess = await worldExecutor.executeBatch(execBot, towerBlocks, {
    mode: 'pure_physical',
    title: 'Survival-Turm'
  });

  assert.strictEqual(execSuccess, true, 'WorldExecutor executeBatch im pure_physical Modus erfolgreich');
  assert.strictEqual(scaffoldManager.getActiveScaffoldsCount(), 0, 'Alle temporären Gerüstblöcke nach Abschluss aufgeräumt');
  pass('WorldExecutor führt Survival-Höhenbau durch und hinterlässt eine saubere Welt');

  console.log(`\n=== ALLE ${passed}/${passed} TESTS DER GERÜSTBAU-SUITE ERFOLGREICH BESTANDEN! ===\n`);
}

runScaffoldManagerTests().catch(err => {
  console.error('[FAIL] Testfehler:', err);
  process.exit(1);
});
