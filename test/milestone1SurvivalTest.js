import assert from 'assert';
import { Vec3 } from 'vec3';
import { VersionResolver } from '../src/config/versionResolver.js';
import { settings } from '../src/config/settings.js';
import { ChestManager, chestManager, CONTAINER_NAMES } from '../src/survival/chestManager.js';
import { MaterialProcurement, materialProcurement } from '../src/survival/materialProcurement.js';
import { HarvestManager, harvestManager, TOOL_TIERS } from '../src/survival/harvestManager.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import minecraftData from 'minecraft-data';
import prismarineRegistry from 'prismarine-registry';

async function runMilestone1SurvivalTests() {
  console.log('=== STARTING MILESTONE 1: VERSION SUPPORT & KISTENLOGISTIK TEST SUITE ===\n');
  let passed = 0;

  function pass(msg) {
    passed++;
    console.log(`[PASS] ${msg}`);
  }

  // --- Testgruppe 1: VersionResolver & 26.3 Runtime Polyfill ---
  console.log('--- Testgruppe 1: VersionResolver & 26.3 Runtime Polyfill ---');

  // Normalization checks
  assert.strictEqual(VersionResolver.normalizeVersion('26.3'), '26.3', 'normalizeVersion("26.3") liefert "26.3"');
  pass('normalizeVersion("26.3") normalisiert korrekt');

  assert.strictEqual(VersionResolver.normalizeVersion('auto'), false, 'normalizeVersion("auto") liefert false');
  pass('normalizeVersion("auto") aktiviert Mineflayer Auto-Detection (false)');

  assert.strictEqual(VersionResolver.normalizeVersion(false), false, 'normalizeVersion(false) liefert false');
  pass('normalizeVersion(false) behält boolean false bei');

  assert.strictEqual(VersionResolver.normalizeVersion('false'), false, 'normalizeVersion("false") liefert false');
  pass('normalizeVersion("false") String liefert boolean false');

  assert.strictEqual(VersionResolver.normalizeVersion('none'), false, 'normalizeVersion("none") liefert false');
  pass('normalizeVersion("none") liefert boolean false');

  assert.strictEqual(VersionResolver.normalizeVersion(undefined), '1.20.4', 'normalizeVersion(undefined) fällt auf 1.20.4 zurück');
  pass('normalizeVersion(undefined) nutzt Default-Fallback');

  assert.strictEqual(VersionResolver.normalizeVersion('1.21.1'), '1.21.1', 'normalizeVersion("1.21.1") behält Version bei');
  pass('normalizeVersion mit benutzerdefinierter Version erhalten');

  // Runtime Polyfill verification
  const shimsResult = VersionResolver.applyCompatibilityShims();
  assert.strictEqual(shimsResult, true, 'applyCompatibilityShims gibt true zurück');
  pass('applyCompatibilityShims() erfolgreich ausgeführt');

  const mcData26_3 = minecraftData('26.3');
  assert(mcData26_3 !== null && mcData26_3.blocksArray.length > 1000, 'minecraft-data(26.3) liefert >1000 Blöcke');
  pass('minecraft-data("26.3") lädt erfolgreich alle Blöcke via Polyfill');

  const registry26_3 = prismarineRegistry('26.3');
  assert(registry26_3 !== null && registry26_3.blocksArray.length > 1000, 'prismarine-registry(26.3) liefert >1000 Blöcke');
  pass('prismarine-registry("26.3") initialisiert fehlerfrei');

  // Connection options resolution
  const resolvedDirect = await VersionResolver.resolveConnectionOptions('127.0.0.1', 25565, '26.3');
  assert.strictEqual(resolvedDirect.version, '26.3', 'resolveConnectionOptions mit 26.3 liefert Version 26.3');
  assert.strictEqual(resolvedDirect.autoDetect, false, 'autoDetect ist false bei expliziter Version');
  pass('resolveConnectionOptions("26.3") liefert verifizierte Optionen');

  const resolvedOffline = await VersionResolver.resolveConnectionOptions('127.0.0.1', 25599, 'auto');
  assert.strictEqual(resolvedOffline.version, '1.20.4', 'resolveConnectionOptions fällt bei Offline-Server auf 1.20.4 zurück');
  assert.strictEqual(resolvedOffline.fallbackUsed, true, 'fallbackUsed Kennzeichnung vorhanden');
  pass('resolveConnectionOptions("auto") behandelt Offline-Ping mit sicherem Fallback');

  // --- Testgruppe 2: Settings Survival-Konfiguration ---
  console.log('\n--- Testgruppe 2: Settings Survival-Konfiguration ---');

  assert(typeof settings.SURVIVAL_AUTO_PROCUREMENT === 'boolean', 'SURVIVAL_AUTO_PROCUREMENT ist boolean');
  assert.strictEqual(settings.SURVIVAL_AUTO_PROCUREMENT, true, 'SURVIVAL_AUTO_PROCUREMENT standardmäßig aktiv');
  pass('SURVIVAL_AUTO_PROCUREMENT Setting konfiguriert');

  assert.strictEqual(settings.SURVIVAL_STORAGE_SCAN_RADIUS, 32, 'SURVIVAL_STORAGE_SCAN_RADIUS ist 32');
  pass('SURVIVAL_STORAGE_SCAN_RADIUS Setting konfiguriert');

  assert.strictEqual(settings.SURVIVAL_CONTAINER_TIMEOUT_MS, 4000, 'SURVIVAL_CONTAINER_TIMEOUT_MS ist 4000');
  pass('SURVIVAL_CONTAINER_TIMEOUT_MS Setting konfiguriert');

  assert.strictEqual(settings.SURVIVAL_CONTAINER_BLACKLIST_MS, 60000, 'SURVIVAL_CONTAINER_BLACKLIST_MS ist 60000');
  pass('SURVIVAL_CONTAINER_BLACKLIST_MS Setting konfiguriert');

  assert(CONTAINER_NAMES.includes('chest') && CONTAINER_NAMES.includes('barrel') && CONTAINER_NAMES.includes('shulker_box'), 'CONTAINER_NAMES umfasst Chest, Barrel, Shulker');
  pass('CONTAINER_NAMES enthält alle geforderten Behältertypen');

  // --- Testgruppe 3: ChestManager Obstruction & Deduplication ---
  console.log('\n--- Testgruppe 3: ChestManager Obstruction & Deduplication ---');
  const cm = new ChestManager();

  // Blacklist
  const testPos = new Vec3(10, 64, 10);
  assert.strictEqual(cm.isBlacklisted(testPos), false, 'Container anfänglich nicht auf Blacklist');
  cm.addToBlacklist(testPos, 5000);
  assert.strictEqual(cm.isBlacklisted(testPos), true, 'Container nach addToBlacklist gesperrt');
  cm.clearBlacklist();
  assert.strictEqual(cm.isBlacklisted(testPos), false, 'Nach clearBlacklist wieder frei');
  pass('ChestManager Blacklist-Verwaltung (isBlacklisted, addToBlacklist, clearBlacklist) funktioniert');

  // Obstruction: Barrels can open even under solid block
  const mockBotForObstruction = {
    blockAt: (pos) => {
      if (pos.y === 65) return { name: 'stone', boundingBox: 'block', transparent: false };
      return { name: 'air', boundingBox: 'empty', transparent: true };
    }
  };
  const barrelBlock = { name: 'barrel', position: new Vec3(0, 64, 0), _properties: {} };
  assert.strictEqual(cm.canOpen(mockBotForObstruction, barrelBlock), true, 'Fass kann trotz solidem Block darüber geöffnet werden');
  pass('canOpen erlaubt Öffnen von Fässern mit solidem Deckblock');

  // Obstruction: Chest under solid block is blocked
  const singleChestBlock = { name: 'chest', position: new Vec3(0, 64, 0), _properties: { type: 'single' } };
  assert.strictEqual(cm.canOpen(mockBotForObstruction, singleChestBlock), false, 'Kiste unter solidem Block wird blockiert');
  pass('canOpen erkennt Blockierung bei solidem Block über Kiste');

  // Double chest partner calculation
  const doubleChestLeftNorth = {
    name: 'chest',
    position: new Vec3(10, 64, 10),
    _properties: { type: 'left', facing: 'north' }
  };
  const partnerPos = cm.getDoubleChestPartnerPos(null, doubleChestLeftNorth);
  assert.deepStrictEqual(partnerPos, new Vec3(11, 64, 10), 'Partner von left-north liegt bei X+1');
  pass('getDoubleChestPartnerPos berechnet exakte Partnerkoordinaten für Doppelkiste (left-north)');

  const doubleChestRightNorth = {
    name: 'chest',
    position: new Vec3(11, 64, 10),
    _properties: { type: 'right', facing: 'north' }
  };
  const partnerPosRight = cm.getDoubleChestPartnerPos(null, doubleChestRightNorth);
  assert.deepStrictEqual(partnerPosRight, new Vec3(10, 64, 10), 'Partner von right-north liegt bei X-1');
  pass('getDoubleChestPartnerPos berechnet exakte Partnerkoordinaten für Doppelkiste (right-north)');

  // Container discovery and deduplication
  const mockWorldBlocks = {
    '10,64,10': { name: 'chest', position: new Vec3(10, 64, 10), _properties: { type: 'left', facing: 'north' } },
    '11,64,10': { name: 'chest', position: new Vec3(11, 64, 10), _properties: { type: 'right', facing: 'north' } },
    '20,64,20': { name: 'barrel', position: new Vec3(20, 64, 20), _properties: {} }
  };
  const mockDiscoveryBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    findBlocks: () => [new Vec3(10, 64, 10), new Vec3(11, 64, 10), new Vec3(20, 64, 20)],
    blockAt: (p) => {
      const key = `${p.x},${p.y},${p.z}`;
      return mockWorldBlocks[key] || { name: 'air', boundingBox: 'empty', transparent: true };
    }
  };
  const discovered = cm.findContainers(mockDiscoveryBot, 32);
  assert.strictEqual(discovered.length, 2, 'Doppelkiste wird zu genau 1 Eintrag zusammengefasst (20 Blöcke -> 2 Behälter)');
  assert(discovered.some(c => c.isDouble === true), 'Doppelkiste korrekt als isDouble markiert');
  assert(discovered.some(c => c.block.name === 'barrel'), 'Fass erfolgreich erkannt');
  pass('findContainers dedupliziert Doppelkisten und ignoriert redundante Partnerblöcke');

  // --- Testgruppe 4: Sichere Kisteninteraktion & Entnahme ---
  console.log('\n--- Testgruppe 4: Sichere Kisteninteraktion & Entnahme ---');

  // Timeout guard on openContainerSafely
  const hangingBot = {
    entity: { position: new Vec3(0, 64, 0) },
    openContainer: () => new Promise(() => {}), // Hängt unendlich
    lookAt: async () => {}
  };
  let timeoutCaught = false;
  try {
    await cm.openContainerSafely(hangingBot, { position: new Vec3(1, 64, 1) }, 100);
  } catch (err) {
    timeoutCaught = true;
    assert(err.message.includes('timeout'), 'Timeout-Fehler geworfen');
  }
  assert(timeoutCaught, 'openContainerSafely bricht nach Timeout sicher ab');
  pass('openContainerSafely schützt vor unendlichem Blockieren via Timeout');

  // withdrawSafe calculation
  const mockWindowItems = [
    { name: 'oak_planks', type: 101, count: 64 },
    { name: 'cobblestone', type: 102, count: 20 }
  ];
  let withdrawnItem = null;
  let withdrawnCount = 0;
  const mockWindow = {
    containerItems: () => mockWindowItems,
    containerCount: (type) => (type === 101 ? 64 : 20),
    withdraw: async (type, meta, amount) => {
      withdrawnItem = type;
      withdrawnCount = amount;
    },
    close: () => {}
  };
  const mockWithdrawBot = {
    version: '1.20.4',
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 5,
      slots: new Array(45).fill(null),
      items: () => []
    }
  };

  const amountWithdrawn = await cm.withdrawSafe(mockWithdrawBot, mockWindow, 'oak_planks', 32);
  assert.strictEqual(amountWithdrawn, 32, '32 Planken entnommen');
  assert.strictEqual(withdrawnCount, 32, 'window.withdraw mit 32 aufgerufen');
  pass('withdrawSafe entnimmt gewünschte Anzahl bei ausreichendem Inventarplatz');

  // withdrawSafe when emptySlotCount is 0
  const fullInvBot = {
    version: '1.20.4',
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 0,
      slots: new Array(45).fill({ name: 'dirt', count: 64 }),
      items: () => new Array(36).fill({ name: 'dirt', count: 64 })
    }
  };
  const fullAmount = await cm.withdrawSafe(fullInvBot, mockWindow, 'oak_planks', 32);
  assert.strictEqual(fullAmount, 0, 'Entnahme bei 0 freien Slots sicher mit 0 abgewiesen');
  pass('withdrawSafe verhindert Crash bei leerem Inventarplatz (emptySlotCount === 0)');

  // --- Testgruppe 5: MaterialProcurement Multi-Pass Logistik ---
  console.log('\n--- Testgruppe 5: MaterialProcurement Multi-Pass Logistik ---');
  const mp = new MaterialProcurement();

  // Already satisfied
  const richBot = {
    inventory: {
      items: () => [
        { name: 'stone_bricks', count: 64 },
        { name: 'glass', count: 16 }
      ]
    }
  };
  const resultSatisfied = await mp.procureMaterials(richBot, { stone_bricks: 32, glass: 10 }, { chatAlerts: false });
  assert.strictEqual(resultSatisfied.success, true, 'Bereits vorhandene Materialien melden success: true');
  assert.deepStrictEqual(resultSatisfied.missing, {}, 'Keine fehlenden Materialien');
  pass('MaterialProcurement überspringt Kistensuche wenn Inventar bereits gefüllt ist');

  // Multi-pass procurement from chests
  const chestItems1 = [{ name: 'stone_bricks', type: 201, count: 20 }];
  const chestItems2 = [{ name: 'stone_bricks', type: 201, count: 30 }, { name: 'glass', type: 202, count: 10 }];

  const mockChest1 = {
    containerItems: () => chestItems1,
    containerCount: (type) => (type === 201 ? chestItems1[0].count : 0),
    withdraw: async (type, meta, amount) => {
      chestItems1[0].count -= amount;
    },
    close: () => {}
  };
  const mockChest2 = {
    containerItems: () => chestItems2,
    containerCount: (type) => {
      const it = chestItems2.find(i => i.type === type);
      return it ? it.count : 0;
    },
    withdraw: async (type, meta, amount) => {
      const it = chestItems2.find(i => i.type === type);
      if (it) it.count -= amount;
    },
    close: () => {}
  };

  const needyBot = {
    version: '1.20.4',
    chat: () => {},
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 10,
      slots: new Array(45).fill(null),
      items: () => []
    },
    findBlocks: () => [new Vec3(5, 64, 0), new Vec3(8, 64, 0)],
    blockAt: (p) => {
      if (p.x === 5) return { name: 'chest', position: p, _properties: { type: 'single' } };
      if (p.x === 8) return { name: 'barrel', position: p, _properties: {} };
      return { name: 'air', boundingBox: 'empty', transparent: true };
    },
    openContainer: async (block) => {
      if (block.position.x === 5) return mockChest1;
      return mockChest2;
    }
  };

  const procurementResult = await mp.procureMaterials(needyBot, { stone_bricks: 40, glass: 5 }, { chatAlerts: false });
  assert.strictEqual(procurementResult.success, true, 'Beschaffung über mehrere Kisten hinweg erfolgreich');
  assert.strictEqual(procurementResult.procured.stone_bricks, 40, '40 stone_bricks erfolgreich entnommen');
  assert.strictEqual(procurementResult.procured.glass, 5, '5 glass erfolgreich entnommen');
  assert.deepStrictEqual(procurementResult.missing, {}, 'Keine fehlenden Materialien verbleibend');
  pass('MaterialProcurement führt Multi-Pass-Entnahme über mehrere Behälter durch');

  // Shortage manifest reporting
  const shortBot = {
    version: '1.20.4',
    chat: () => {},
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      inventoryStart: 9,
      inventoryEnd: 44,
      emptySlotCount: () => 10,
      slots: new Array(45).fill(null),
      items: () => []
    },
    findBlocks: () => [], // Keine Kisten
    blockAt: () => null
  };
  const shortageResult = await mp.procureMaterials(shortBot, { diamond_block: 5 }, { chatAlerts: false });
  assert.strictEqual(shortageResult.success, false, 'Shortage manifest meldet success: false');
  assert.strictEqual(shortageResult.missing.diamond_block, 5, 'Fehlmenge für diamond_block ist 5');
  pass('MaterialProcurement erzeugt korrektes Shortfall-Manifest bei Kistenmangel');

  // --- Testgruppe 6: HarvestManager & Werkzeugauswahl ---
  console.log('\n--- Testgruppe 6: HarvestManager & Werkzeugauswahl ---');
  const hm = new HarvestManager();

  let equippedTool = null;
  const mockToolBot = {
    inventory: {
      items: () => [
        { name: 'wooden_pickaxe', count: 1 },
        { name: 'diamond_pickaxe', count: 1 },
        { name: 'iron_axe', count: 1 }
      ]
    },
    equip: async (item) => {
      equippedTool = item.name;
    }
  };

  // Best tool for stone -> diamond_pickaxe
  const pickaxePrep = await hm.prepareToolForBlock(mockToolBot, { name: 'stone' });
  assert.strictEqual(pickaxePrep.equipped, true, 'Werkzeug für Stein ausgerüstet');
  assert.strictEqual(pickaxePrep.toolName, 'diamond_pickaxe', 'Beste Spitzhacke (Diamant vor Holz) gewählt');
  assert.strictEqual(equippedTool, 'diamond_pickaxe', 'Bot hält diamond_pickaxe in Hand');
  pass('prepareToolForBlock wählt Spitzhacke mit höchster Tier-Priorität (diamond)');

  // Best tool for log -> iron_axe
  const axePrep = await hm.prepareToolForBlock(mockToolBot, { name: 'oak_log' });
  assert.strictEqual(axePrep.equipped, true, 'Werkzeug für Holz ausgerüstet');
  assert.strictEqual(axePrep.toolName, 'iron_axe', 'Axt für Holzstamm gewählt');
  assert.strictEqual(equippedTool, 'iron_axe', 'Bot hält iron_axe in Hand');
  pass('prepareToolForBlock wählt Axt für Baumstämme');

  // Wood harvesting simulation
  let dugBlocks = [];
  const mockFellingBot = {
    version: '1.20.4',
    entity: { position: new Vec3(0, 64, 0) },
    findBlocks: () => [new Vec3(2, 64, 0), new Vec3(2, 65, 0)],
    blockAt: (p) => ({ name: 'oak_log', position: p }),
    inventory: { items: () => [{ name: 'iron_axe', count: 1 }] },
    equip: async () => {},
    dig: async (b) => { dugBlocks.push(b.name); }
  };
  const harvestWoodResult = await hm.harvestWood(mockFellingBot, 'oak_log', 2);
  assert.strictEqual(harvestWoodResult.success, true, 'Holzfällen erfolgreich');
  assert.strictEqual(harvestWoodResult.harvested, 2, '2 Stämme abgebaut');
  assert.strictEqual(dugBlocks.length, 2, 'bot.dig wurde für 2 Stämme aufgerufen');
  pass('harvestWood baut Baumstämme ab und aktualisiert Zähler');

  // Stone quarrying safety check (does NOT dig block below feet)
  let dugStonePositions = [];
  const mockQuarryBot = {
    version: '1.20.4',
    entity: { position: new Vec3(5, 64, 5) },
    findBlocks: () => [
      new Vec3(5, 63, 5), // Direkt unter den Füßen! Sollte übersprungen werden!
      new Vec3(6, 64, 5)  // Sicherer Nachbarblock
    ],
    blockAt: (p) => ({ name: 'stone', position: p }),
    inventory: { items: () => [{ name: 'iron_pickaxe', count: 1 }] },
    equip: async () => {},
    dig: async (b) => { dugStonePositions.push(b.position); }
  };
  const harvestStoneResult = await hm.harvestStone(mockQuarryBot, 1);
  assert.strictEqual(harvestStoneResult.success, true, 'Steinabbau erfolgreich');
  assert.strictEqual(dugStonePositions.length, 1, 'Genau 1 Block abgebaut');
  assert.deepStrictEqual(dugStonePositions[0], new Vec3(6, 64, 5), 'Block unter Füßen (5, 63, 5) wurde sicherheitskonform übersprungen');
  pass('harvestStone respektiert Sicherheitsregel und baut niemals den Standblock unter den Füßen ab');

  // --- Testgruppe 7: WorldExecutor & pure_physical Survival Procurement ---
  console.log('\n--- Testgruppe 7: WorldExecutor & pure_physical Survival Procurement ---');

  const testPhysicalBlocks = [
    { x: 0, y: 64, z: 0, name: 'stone', fullBlockString: 'minecraft:stone' }
  ];

  // In pure_physical mode, missing materials trigger procurement
  let procurementCalled = false;
  const originalProcure = materialProcurement.procureMaterials;
  materialProcurement.procureMaterials = async (b, bom) => {
    procurementCalled = true;
    return { success: false, procured: {}, missing: bom };
  };

  const mockExecBot = {
    inventory: { items: () => [] }, // Keine Steine im Inventar
    chat: () => {}
  };

  // With strictMaterials: true -> should abort with false
  const execResultStrict = await worldExecutor.executeBatch(mockExecBot, testPhysicalBlocks, {
    mode: 'pure_physical',
    strictMaterials: true
  });
  assert.strictEqual(procurementCalled, true, 'materialProcurement wurde im pure_physical Modus vor Phase 1 aufgerufen');
  assert.strictEqual(execResultStrict, false, 'Bauausführung bricht im strictMaterials-Modus bei Kistenmangel ab');
  pass('worldExecutor bindet materialProcurement im pure_physical Modus ein und beachtet strictMaterials');

  // Restore original procurement
  materialProcurement.procureMaterials = originalProcure;

  console.log(`\n=== MILESTONE 1 TEST SUITE ERFOLGREICH: ${passed}/30 TESTS BESTANDEN ===\n`);
}

runMilestone1SurvivalTests().catch(err => {
  console.error('[FAIL] Testfehler:', err);
  process.exit(1);
});
