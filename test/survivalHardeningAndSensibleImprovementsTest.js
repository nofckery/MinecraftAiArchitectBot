import assert from 'node:assert';
import { Vec3 } from 'vec3';
import { inventoryManager, ARMOR_TIERS, ARMOR_SLOT_MAP } from '../src/bot/inventoryManager.js';
import { threatManager, THREAT_STATES } from '../src/bot/threatManager.js';
import { scaffoldManager } from '../src/survival/scaffoldManager.js';
import { VoxelCanvas } from '../src/builder/voxelCanvas.js';
import { StructuralLinter } from '../src/builder/structuralLinter.js';
import { generateAreaMapData } from '../src/web/services/terrainMapService.js';
import { createRateLimiter } from '../src/utils/rateLimiter.js';
import { settings } from '../src/config/settings.js';

console.log('=== TEST SUITE: SURVIVAL HARDENING & SENSIBLE IMPROVEMENTS ===\n');

let totalTests = 0;
let passedTests = 0;

function check(desc, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`[PASS] ${desc}`);
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

async function checkAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`[PASS] ${desc}`);
  } catch (err) {
    console.error(`[FAIL] ${desc}: ${err.message}`);
    throw err;
  }
}

async function runAllTests() {
  // ---------------------------------------------------------------------------
  // 1. Auto-Eat & Hunger Management
  // ---------------------------------------------------------------------------
  console.log('--- Testgruppe 1: Auto-Eat & Hunger-Management ---');

  await checkAsync('1.1 autoEatCheck verzehrt Nahrung bei Hunger food <= 14', async () => {
    let consumed = false;
    let equippedItem = null;
    const mockBot = {
      food: 12,
      health: 20,
      inventory: {
        items: () => [
          { name: 'bread', count: 3 },
          { name: 'cooked_beef', count: 5 }
        ]
      },
      equip: async (item, dest) => {
        equippedItem = item;
      },
      consume: async () => {
        consumed = true;
      }
    };

    const res = await inventoryManager.autoEatCheck(mockBot, 14);
    assert.strictEqual(res, true, 'autoEatCheck muss true zurückgeben');
    assert.strictEqual(consumed, true, 'bot.consume() muss aufgerufen werden');
    assert.strictEqual(equippedItem?.name, 'cooked_beef', 'Beste Nahrung cooked_beef muss priorisiert werden');
  });

  await checkAsync('1.2 autoEatCheck verzehrt Nahrung bei health < 20 und food < 20', async () => {
    let consumed = false;
    const mockBot = {
      food: 17,
      health: 15,
      inventory: {
        items: () => [{ name: 'bread', count: 2 }]
      },
      equip: async () => {},
      consume: async () => { consumed = true; }
    };

    const res = await inventoryManager.autoEatCheck(mockBot, 14);
    assert.strictEqual(res, true);
    assert.strictEqual(consumed, true);
  });

  await checkAsync('1.3 autoEatCheck isst NICHT wenn food == 20 und health == 20', async () => {
    let consumed = false;
    const mockBot = {
      food: 20,
      health: 20,
      inventory: {
        items: () => [{ name: 'golden_carrot', count: 10 }]
      },
      equip: async () => {},
      consume: async () => { consumed = true; }
    };

    const res = await inventoryManager.autoEatCheck(mockBot, 14);
    assert.strictEqual(res, false);
    assert.strictEqual(consumed, false);
  });

  await checkAsync('1.4 autoEatCheck verzehrt niemals schädliche Nahrung (spider_eye, rotten_flesh)', async () => {
    let consumed = false;
    const mockBot = {
      food: 8,
      health: 20,
      inventory: {
        items: () => [
          { name: 'rotten_flesh', count: 10 },
          { name: 'spider_eye', count: 5 },
          { name: 'pufferfish', count: 1 }
        ]
      },
      equip: async () => {},
      consume: async () => { consumed = true; }
    };

    const res = await inventoryManager.autoEatCheck(mockBot, 14);
    assert.strictEqual(res, false, 'Darf keine giftige Nahrung essen');
    assert.strictEqual(consumed, false);
  });

  // ---------------------------------------------------------------------------
  // 2. Auto-Equip Best Armor
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 2: Auto-Equip Best Armor ---');

  check('2.1 ARMOR_TIERS definiert alle Kern-Materialien', () => {
    assert.ok(ARMOR_TIERS.netherite > ARMOR_TIERS.diamond);
    assert.ok(ARMOR_TIERS.diamond > ARMOR_TIERS.iron);
    assert.ok(ARMOR_TIERS.iron > ARMOR_TIERS.leather);
  });

  check('2.2 ARMOR_SLOT_MAP deckt alle 4 Rüstungsslots ab', () => {
    const dests = ARMOR_SLOT_MAP.map(s => s.dest);
    assert.deepStrictEqual(dests, ['head', 'torso', 'legs', 'feet']);
  });

  await checkAsync('2.3 equipBestArmor rüstet die stärkste Rüstung für jeden Slot aus', async () => {
    const equipped = {};
    const mockBot = {
      inventory: {
        items: () => [
          { name: 'leather_helmet' },
          { name: 'diamond_helmet' },
          { name: 'iron_chestplate' },
          { name: 'diamond_chestplate' },
          { name: 'iron_leggings' },
          { name: 'netherite_boots' },
          { name: 'golden_boots' }
        ]
      },
      equip: async (item, dest) => {
        equipped[dest] = item.name;
      }
    };

    const result = await inventoryManager.equipBestArmor(mockBot);
    assert.strictEqual(result.equippedCount, 4);
    assert.strictEqual(equipped.head, 'diamond_helmet');
    assert.strictEqual(equipped.torso, 'diamond_chestplate');
    assert.strictEqual(equipped.legs, 'iron_leggings');
    assert.strictEqual(equipped.feet, 'netherite_boots');
  });

  await checkAsync('2.4 ThreatManager engageThreat rüstet Rüstung, Waffe und Schild aus', async () => {
    const mockBot = {
      inventory: {
        items: () => [
          { name: 'diamond_sword' },
          { name: 'shield' },
          { name: 'iron_chestplate' }
        ]
      },
      equip: async (item, dest) => {
        mockBot[dest] = item.name;
      },
      pathfinder: { stop: () => {} },
      entity: { position: new Vec3(0, 64, 0) }
    };

    threatManager.setBot(mockBot);
    const mockThreat = { name: 'zombie', position: new Vec3(3, 64, 3) };
    await threatManager.engageThreat(mockThreat);

    assert.strictEqual(mockBot.torso, 'iron_chestplate', 'Brustpanzer muss ausgerüstet sein');
    assert.strictEqual(mockBot.hand, 'diamond_sword', 'Schwert muss in Haupthand sein');
    assert.strictEqual(mockBot['off-hand'], 'shield', 'Schild muss in Nebenhand sein');
  });

  // ---------------------------------------------------------------------------
  // 3. Scaffolding Safe Dismantling
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 3: Scaffolding Safe Dismantling ---');

  await checkAsync('3.1 dismantleAll erkennt Stehen auf Gerüst und initiiert Sicherheitsabstieg', async () => {
    let movedSafe = false;
    const scaffoldPos = new Vec3(5, 70, 5);
    const mockBot = {
      entity: { position: scaffoldPos.offset(0, 1, 0) },
      pathfinder: {
        goto: async () => {
          movedSafe = true;
        }
      },
      setControlState: () => {},
      blockAt: (pos) => {
        if (pos.equals(scaffoldPos)) return { name: 'dirt', position: scaffoldPos };
        if (pos.y < 70) return { name: 'stone', boundingBox: 'block' };
        return { name: 'air' };
      },
      dig: async () => {}
    };

    scaffoldManager.activeScaffolds.set(scaffoldManager.coordKey(5, 70, 5), {
      x: 5, y: 70, z: 5, name: 'dirt', isVanillaScaffolding: false
    });

    const res = await scaffoldManager.dismantleAll(mockBot);
    assert.strictEqual(res.success, true);
    assert.strictEqual(movedSafe, true, 'Bot muss vor Abbau auf festen Boden navigieren');
    assert.strictEqual(scaffoldManager.activeScaffolds.size, 0);
  });

  // ---------------------------------------------------------------------------
  // 4. Structural Linter Lighting Checks
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 4: Structural Linter Lighting Checks ---');

  check('4.1 Bauwerk ohne Lichtquellen erzeugt LightingWarning', () => {
    const canvas = new VoxelCanvas(6, 6, 6);
    // Erzeuge geschlossenen Raum aus Cobblestone
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        canvas.set(x, 0, z, 'stone');
        canvas.set(x, 4, z, 'stone');
      }
    }
    for (let y = 1; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        canvas.set(x, y, 0, 'stone');
        canvas.set(x, y, 4, 'stone');
      }
      for (let z = 0; z < 5; z++) {
        canvas.set(0, y, z, 'stone');
        canvas.set(4, y, z, 'stone');
      }
    }
    // Tür einsetzen für Durchgang
    canvas.set(2, 1, 0, 'oak_door[facing=north,half=lower]');
    canvas.set(2, 2, 0, 'oak_door[facing=north,half=upper]');

    const report = StructuralLinter.analyze(canvas);
    const hasLightingWarning = report.warnings.some(w => w.includes('LightingWarning'));
    assert.strictEqual(hasLightingWarning, true, 'Linter muss LightingWarning ausgeben');
  });

  check('4.2 Bauwerk mit Fackel erzeugt KEINE LightingWarning', () => {
    const canvas = new VoxelCanvas(6, 6, 6);
    for (let x = 0; x < 5; x++) {
      for (let z = 0; z < 5; z++) {
        canvas.set(x, 0, z, 'stone');
        canvas.set(x, 4, z, 'stone');
      }
    }
    for (let y = 1; y < 4; y++) {
      for (let x = 0; x < 5; x++) {
        canvas.set(x, y, 0, 'stone');
        canvas.set(x, y, 4, 'stone');
      }
      for (let z = 0; z < 5; z++) {
        canvas.set(0, y, z, 'stone');
        canvas.set(4, y, z, 'stone');
      }
    }
    canvas.set(2, 1, 0, 'oak_door[facing=north,half=lower]');
    canvas.set(2, 2, 0, 'oak_door[facing=north,half=upper]');
    // Fackel platzieren
    canvas.set(2, 2, 2, 'torch');

    const report = StructuralLinter.analyze(canvas);
    const hasLightingWarning = report.warnings.some(w => w.includes('LightingWarning'));
    assert.strictEqual(hasLightingWarning, false, 'Mit Fackel darf keine LightingWarning existieren');
  });

  // ---------------------------------------------------------------------------
  // 5. Multiplayer Player Radar
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 5: Multiplayer Player Radar ---');

  check('5.1 generateAreaMapData extrahiert andere Spieler mit Distanz', () => {
    const mockBot = {
      username: 'BuilderBot',
      entity: { position: new Vec3(100, 64, 100) },
      players: {
        BuilderBot: { entity: { position: new Vec3(100, 64, 100) } },
        Alice: { entity: { position: new Vec3(110, 64, 100) } },
        Bob: { entity: { position: new Vec3(100, 64, 120) } },
        OfflineDave: { entity: null }
      },
      blockAt: () => ({ name: 'grass_block' }),
      game: { minY: -64 }
    };

    const mapData = generateAreaMapData(mockBot);
    assert(Array.isArray(mapData.players), 'players muss ein Array sein');
    assert.strictEqual(mapData.players.length, 2, 'Nur Alice und Bob (mit aktiver Entity) dürfen gelistet sein');
    
    const alice = mapData.players.find(p => p.username === 'Alice');
    assert(alice, 'Alice muss vorhanden sein');
    assert.strictEqual(alice.distance, 10, 'Distanz zu Alice muss 10 Blöcke betragen');
    assert.strictEqual(alice.x, 110);

    const bob = mapData.players.find(p => p.username === 'Bob');
    assert(bob, 'Bob muss vorhanden sein');
    assert.strictEqual(bob.distance, 20, 'Distanz zu Bob muss 20 Blöcke betragen');

    const botSelf = mapData.players.find(p => p.username === 'BuilderBot');
    assert.strictEqual(botSelf, undefined, 'Bot selbst darf nicht in der Radar-Liste auftauchen');
  });

  // ---------------------------------------------------------------------------
  // 6. Sliding-Window Rate Limiter
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 6: Sliding-Window Rate Limiter ---');

  check('6.1 RateLimiter erlaubt Aufrufe bis zum Limit und blockiert danach mit 429', () => {
    const limiter = createRateLimiter({ windowMs: 1000, max: 3, enableInTest: true });
    const req = { ip: '10.0.0.1' };
    let status = 200;
    let responseBody = null;
    const res = {
      setHeader: () => {},
      status: (code) => {
        status = code;
        return {
          json: (body) => { responseBody = body; }
        };
      }
    };
    let nextCount = 0;
    const next = () => { nextCount++; };

    // Request 1, 2, 3 should pass
    limiter(req, res, next);
    limiter(req, res, next);
    limiter(req, res, next);
    assert.strictEqual(nextCount, 3, 'Erste 3 Requests müssen durchkommen');

    // Request 4 should be rejected with 429
    limiter(req, res, next);
    assert.strictEqual(nextCount, 3, 'Request 4 darf next() nicht aufrufen');
    assert.strictEqual(status, 429, 'Status muss HTTP 429 sein');
    assert.strictEqual(responseBody?.success, false);
  });

  // ---------------------------------------------------------------------------
  // 7. Security & Dashboard Password Invariant
  // ---------------------------------------------------------------------------
  console.log('\n--- Testgruppe 7: Security & Settings Invariants ---');

  check('7.1 DASHBOARD_PASSWORD ist als String in settings definiert', () => {
    assert(typeof settings.DASHBOARD_PASSWORD === 'string', 'DASHBOARD_PASSWORD muss ein String sein');
  });

  console.log(`\n================================================================`);
  console.log(`  ERGEBNIS: ${passedTests} / ${totalTests} TESTS BESTANDEN!`);
  console.log(`================================================================`);
}

runAllTests().catch(err => {
  console.error('\nTest Suite mit Fehler abgebrochen:', err);
  process.exit(1);
});
