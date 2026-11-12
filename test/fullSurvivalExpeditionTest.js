import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { VersionResolver } from '../src/config/versionResolver.js';
import { CraftingPlanner, craftingPlanner, normalizeCraftItemName, ITEM_ALIASES } from '../src/survival/craftingPlanner.js';
import { SmeltingManager, smeltingManager, SMELTABLE_RECIPES, FUEL_VALUES } from '../src/survival/smeltingManager.js';
import { BaseStorageManager, baseStorageManager, ORES_AND_INGOTS, MOB_DROPS, BUILDING_BLOCKS } from '../src/survival/baseStorageManager.js';
import { ExpeditionManager, expeditionManager, EXPEDITION_STATES } from '../src/survival/expeditionManager.js';
import { taskIntentRouter, TASK_INTENTS } from '../src/ai/router/taskIntentRouter.js';
import { ChatController } from '../src/bot/chatController.js';
import { handleArchitectWsMessage } from '../src/web/ws/handlers/architectWsHandler.js';
import { settings } from '../src/config/settings.js';

VersionResolver.applyCompatibilityShims();

console.log('=== STARTING FULL SURVIVAL EXPEDITION SOTA TEST SUITE ===\n');

let passedTests = 0;
function pass(msg) {
  passedTests++;
  console.log(`[PASS] ${msg}`);
}

// =========================================================================
// TESTGRUPPE 1: CraftingPlanner & Rekursive Rezeptbäume (Phase 1)
// =========================================================================
console.log('--- Testgruppe 1: CraftingPlanner & Rekursive Rezeptbäume ---');

// 1.1 Item-Alias-Normalisierung (Deutsch & Englisch)
assert.strictEqual(normalizeCraftItemName('fackeln'), 'torch', 'fackeln -> torch');
assert.strictEqual(normalizeCraftItemName('fackel'), 'torch', 'fackel -> torch');
assert.strictEqual(normalizeCraftItemName('werkbank'), 'crafting_table', 'werkbank -> crafting_table');
assert.strictEqual(normalizeCraftItemName('crafting table'), 'crafting_table', 'crafting table -> crafting_table');
assert.strictEqual(normalizeCraftItemName('ofen'), 'furnace', 'ofen -> furnace');
assert.strictEqual(normalizeCraftItemName('kiste'), 'chest', 'kiste -> chest');
assert.strictEqual(normalizeCraftItemName('truhe'), 'chest', 'truhe -> chest');
assert.strictEqual(normalizeCraftItemName('eisen-spitzhacke'), 'iron_pickaxe', 'eisen-spitzhacke -> iron_pickaxe');
assert.strictEqual(normalizeCraftItemName('steinspitzhacke'), 'stone_pickaxe', 'steinspitzhacke -> stone_pickaxe');
assert.strictEqual(normalizeCraftItemName('stöcke'), 'stick', 'stöcke -> stick');
assert.strictEqual(normalizeCraftItemName('planken'), 'oak_planks', 'planken -> oak_planks');
pass('1.1 normalizeCraftItemName übersetzt deutsche und englische Item-Namen fehlerfrei');

// 1.2 Rekursive Rezeptauflösung für Fackeln (Kohle + Stock)
const mockTorchBot = {
  version: '1.20.4',
  inventory: {
    items: () => [
      { name: 'coal', count: 4, type: 799 },
      { name: 'oak_log', count: 2, type: 100 }
    ]
  }
};

const torchTree = craftingPlanner.resolveRecipeTree(mockTorchBot, 'torch', 4);
assert.strictEqual(torchTree.canCraft, true, 'Fackeln können aus Kohle und Holzstämmen rekursiv hergestellt werden');
assert(torchTree.steps.length >= 2, 'Rezeptbaum enthält mindestens 2 Zwischenstufen (Planken -> Stöcke -> Fackeln)');
const stepNames = torchTree.steps.map(s => s.itemName);
assert(stepNames.includes('oak_planks'), 'Rezeptbaum erzeugt Planken aus Stämmen');
assert(stepNames.includes('stick'), 'Rezeptbaum erzeugt Stöcke aus Planken');
assert(stepNames.includes('torch'), 'Rezeptbaum erzeugt Fackeln');
pass('1.2 resolveRecipeTree löst Holzstämme -> Planken -> Stöcke -> Fackeln rekursiv auf');

// 1.3 Rekursive Rezeptauflösung für Eisen-Spitzhacke (benötigt Werkbank)
const mockPickaxeBot = {
  version: '1.20.4',
  inventory: {
    items: () => [
      { name: 'iron_ingot', count: 3, type: 807 },
      { name: 'oak_planks', count: 4, type: 36 }
    ]
  }
};

const pickaxeTree = craftingPlanner.resolveRecipeTree(mockPickaxeBot, 'iron_pickaxe', 1);
assert.strictEqual(pickaxeTree.canCraft, true, 'Eisen-Spitzhacke kann gecraftet werden');
const pickaxeStep = pickaxeTree.steps.find(s => s.itemName === 'iron_pickaxe');
assert(pickaxeStep !== undefined, 'Eisen-Spitzhacke Schritt vorhanden');
assert.strictEqual(pickaxeStep.requiresTable, true, 'Eisen-Spitzhacke erfordert eine Werkbank (requiresTable: true)');
pass('1.3 resolveRecipeTree erkennt 3x3 Werkbank-Bedarf für Werkzeuge (iron_pickaxe)');

// 1.4 Fehlende Materialien erkennen
const mockEmptyBot = {
  version: '1.20.4',
  inventory: {
    items: () => []
  }
};
const missingTree = craftingPlanner.resolveRecipeTree(mockEmptyBot, 'diamond_pickaxe', 1);
assert.strictEqual(missingTree.canCraft, false, 'Leeres Inventar kann keine Diamant-Spitzhacke herstellen');
assert(missingTree.missing.length > 0, 'missing Array listet fehlende Rohstoffe');
pass('1.4 resolveRecipeTree meldet fehlende Rohstoffe präzise bei unvollständigem Inventar');

// 1.5 Mobiles Werkbank-Management (Feld-Platzierung, Crafting, Abbau & Einpacken)
const placedBlocks = [];
const dugBlocks = [];
const mockMobileCraftBot = {
  version: '1.20.4',
  entity: {
    position: new Vec3(20, 64, 20),
    floored: () => new Vec3(20, 64, 20)
  },
  inventory: {
    items: () => [
      { name: 'crafting_table', count: 1, type: 182 },
      { name: 'iron_ingot', count: 3, type: 807 },
      { name: 'stick', count: 2, type: 844 }
    ]
  },
  findBlock: () => null, // Keine existierende Werkbank im Umkreis
  blockAt: (pos) => {
    if (pos.y === 63) {
      return { name: 'stone', boundingBox: 'block', position: pos };
    }
    if (pos.x === 21 && pos.y === 64 && pos.z === 20 && placedBlocks.length > 0) {
      return { name: 'crafting_table', boundingBox: 'block', position: pos };
    }
    return { name: 'air', boundingBox: 'empty', position: pos };
  },
  equip: async () => true,
  placeBlock: async (refBlock, face) => {
    placedBlocks.push({ ref: refBlock.name, face });
  },
  craft: async (recipe, count, tableBlock) => {
    assert(tableBlock !== null, 'Werkbank-Block muss an bot.craft übergeben werden');
    assert.strictEqual(tableBlock.name, 'crafting_table', 'tableBlock ist eine crafting_table');
  },
  dig: async (block) => {
    dugBlocks.push(block.name);
  }
};

const craftResult = await craftingPlanner.craftItem(mockMobileCraftBot, 'iron_pickaxe', 1);
assert.strictEqual(craftResult.success, true, 'craftItem war erfolgreich');
assert.strictEqual(placedBlocks.length, 1, 'Mobiles Werkbank-Feld wurde temporär platziert');
assert.strictEqual(dugBlocks.length, 1, 'Mobiles Werkbank-Feld wurde nach dem Craften wieder abgebaut');
assert.strictEqual(dugBlocks[0], 'crafting_table', 'Abgebauter Block war die crafting_table');
pass('1.5 Mobiles Werkbank-Management: Werkbank im Feld platziert, gecraftet und wieder eingepackt');

// 1.6 Multi-Version Kompatibilität (1.20.4 & 26.3 Protocol 777)
const mc1_20 = craftingPlanner.getMcData({ version: '1.20.4' });
const mc26_3 = craftingPlanner.getMcData({ version: '26.3' });
assert(mc1_20.itemsByName['torch']?.id !== undefined, 'torch in 1.20.4 vorhanden');
assert(mc26_3.itemsByName['torch']?.id !== undefined, 'torch in 26.3 vorhanden');
assert(mc1_20.itemsByName['iron_pickaxe']?.id !== undefined, 'iron_pickaxe in 1.20.4 vorhanden');
assert(mc26_3.itemsByName['iron_pickaxe']?.id !== undefined, 'iron_pickaxe in 26.3 vorhanden');
pass('1.6 CraftingPlanner unterstützt moderne Versionen von 1.20.4 bis 26.3 (Protocol 777)');

// =========================================================================
// TESTGRUPPE 2: SmeltingManager & Ofen-Verhüttung (Phase 2)
// =========================================================================
console.log('\n--- Testgruppe 2: SmeltingManager & Ofen-Verhüttung ---');

// 2.1 Schmelzbare Materialien & Rezepte
assert.strictEqual(SMELTABLE_RECIPES['raw_iron']?.output, 'iron_ingot', 'raw_iron -> iron_ingot');
assert.strictEqual(SMELTABLE_RECIPES['raw_copper']?.output, 'copper_ingot', 'raw_copper -> copper_ingot');
assert.strictEqual(SMELTABLE_RECIPES['raw_gold']?.output, 'gold_ingot', 'raw_gold -> gold_ingot');
assert.strictEqual(SMELTABLE_RECIPES['cobblestone']?.output, 'stone', 'cobblestone -> stone');
assert.strictEqual(SMELTABLE_RECIPES['sand']?.output, 'glass', 'sand -> glass');
assert.strictEqual(SMELTABLE_RECIPES['ancient_debris']?.output, 'netherite_scrap', 'ancient_debris -> netherite_scrap');
pass('2.1 SmeltingManager kennt alle Roherz- und Material-Schmelzrezepte');

// 2.2 Brennstoff-Hierarchie
assert(FUEL_VALUES['coal_block'] > FUEL_VALUES['coal'], 'coal_block brennt länger als coal');
assert(FUEL_VALUES['coal'] > FUEL_VALUES['oak_planks'], 'coal brennt länger als oak_planks');
assert(FUEL_VALUES['oak_planks'] > FUEL_VALUES['stick'], 'planks brennen länger als sticks');
pass('2.2 Brennwert-Hierarchie priorisiert hochwertige Brennstoffe');

// 2.3 Automatisches Schmelzen mit Mock-Furnace
let fuelInserted = null;
let inputInserted = null;
let outputTaken = false;
let furnaceClosed = false;
const placedFurnaces = [];
const dugFurnaces = [];

const mockFurnaceBot = {
  version: '1.20.4',
  entity: {
    position: new Vec3(50, 64, 50),
    floored: () => new Vec3(50, 64, 50)
  },
  inventory: {
    items: () => [
      { name: 'raw_iron', count: 5, type: 801 },
      { name: 'coal', count: 2, type: 799 },
      { name: 'furnace', count: 1, type: 185 }
    ]
  },
  findBlock: () => null, // Kein Ofen in der Nähe -> mobiler Ofen
  blockAt: (pos) => {
    if (pos.y === 63) {
      return { name: 'stone', boundingBox: 'block', position: pos };
    }
    if (pos.x === 51 && pos.y === 64 && pos.z === 50 && placedFurnaces.length > 0) {
      return { name: 'furnace', boundingBox: 'block', position: pos };
    }
    return { name: 'air', boundingBox: 'empty', position: pos };
  },
  equip: async () => true,
  placeBlock: async (refBlock, face) => {
    placedFurnaces.push({ ref: refBlock.name, face });
  },
  openFurnace: async (block) => {
    return {
      putFuel: async (type, meta, count) => { fuelInserted = { type, count }; },
      putInput: async (type, meta, count) => { inputInserted = { type, count }; },
      outputItem: () => ({ name: 'iron_ingot', count: 5 }),
      takeOutput: async () => {
        outputTaken = true;
        return { name: 'iron_ingot', count: 5 };
      },
      close: () => { furnaceClosed = true; }
    };
  },
  dig: async (block) => {
    dugFurnaces.push(block.name);
  }
};

const smeltRes = await smeltingManager.smeltMaterials(mockFurnaceBot, { maxCount: 5, maxWaitMs: 1000 });
assert.strictEqual(smeltRes.success, true, 'smeltMaterials war erfolgreich');
assert.strictEqual(placedFurnaces.length, 1, 'Mobiler Ofen wurde im Feld platziert');
assert(fuelInserted !== null, 'Brennstoff wurde in den Ofen gegeben');
assert(inputInserted !== null, 'Roherz wurde in den Ofen gegeben');
assert.strictEqual(outputTaken, true, 'Fertige Eisenbarren wurden entnommen');
assert.strictEqual(furnaceClosed, true, 'Ofen-Fenster wurde ordnungsgemäß geschlossen');
assert.strictEqual(dugFurnaces.length, 1, 'Mobiler Ofen wurde nach dem Schmelzen wieder abgebaut');
assert.strictEqual(dugFurnaces[0], 'furnace', 'Abgebauter Block war der Ofen');
pass('2.3 SmeltingManager: Mobiler Ofen platziert, befeuert, Barren entnommen und Ofen eingepackt');

// 2.4 Fehlerbehandlung bei fehlendem Brennstoff
const mockNoFuelBot = {
  version: '1.20.4',
  inventory: {
    items: () => [{ name: 'raw_iron', count: 3 }]
  }
};
const noFuelRes = await smeltingManager.smeltMaterials(mockNoFuelBot);
assert.strictEqual(noFuelRes.success, false, 'Schmelzen ohne Brennstoff schlägt fehl');
assert(noFuelRes.error.includes('Kein Brennstoff'), 'Fehlermeldung weist auf fehlenden Brennstoff hin');
pass('2.4 SmeltingManager meldet fehlenden Brennstoff sicher');

// =========================================================================
// TESTGRUPPE 3: BaseStorageManager & Wegpunkt-Persistenz (Phase 3)
// =========================================================================
console.log('\n--- Testgruppe 3: BaseStorageManager & Wegpunkt-Persistenz ---');

const testWpPath = path.resolve(process.cwd(), 'data', 'test_waypoints.json');
if (fs.existsSync(testWpPath)) fs.unlinkSync(testWpPath);

const baseMgr = new BaseStorageManager(testWpPath);

// 3.1 Home-Wegpunkt setzen und abrufen
baseMgr.setHome(new Vec3(100, 64, 200));
const home = baseMgr.getHome();
assert.strictEqual(home.x, 100, 'Home X ist 100');
assert.strictEqual(home.y, 64, 'Home Y ist 64');
assert.strictEqual(home.z, 200, 'Home Z ist 200');
pass('3.1 setHome & getHome speichert und liefert exakte Koordinaten');

// 3.2 Benannte Wegpunkte (z.B. Minen-Eingänge)
baseMgr.setWaypoint('mine_alpha', new Vec3(150, 42, 230));
baseMgr.setWaypoint('quarry', new Vec3(80, 68, 190));
const mineWp = baseMgr.getWaypoint('mine_alpha');
assert.strictEqual(mineWp.x, 150, 'mine_alpha X ist 150');
assert.strictEqual(mineWp.y, 42, 'mine_alpha Y ist 42');
assert.strictEqual(baseMgr.listWaypoints().length, 2, '2 Wegpunkte gespeichert');

baseMgr.deleteWaypoint('quarry');
assert.strictEqual(baseMgr.getWaypoint('quarry'), null, 'Gelöschter Wegpunkt ist nicht mehr vorhanden');
assert.strictEqual(baseMgr.listWaypoints().length, 1, '1 Wegpunkt verbleibend');
pass('3.2 setWaypoint, getWaypoint, listWaypoints & deleteWaypoint funktionieren zuverlässig');

// 3.3 Persistenz auf der Festplatte & Auto-Recovery
assert(fs.existsSync(testWpPath), 'test_waypoints.json physisch auf Platte erzeugt');
const reloadedMgr = new BaseStorageManager(testWpPath);
assert.strictEqual(reloadedMgr.getHome()?.x, 100, 'Neu geladener Manager besitzt gespeichertes Home');
assert.strictEqual(reloadedMgr.getWaypoint('mine_alpha')?.y, 42, 'Neu geladener Manager besitzt gespeicherten Wegpunkt');
if (fs.existsSync(testWpPath)) fs.unlinkSync(testWpPath);
pass('3.3 JSON-Dateisystem-Persistenz und Auto-Recovery verifiziert');

// 3.4 Essenzielle Bot-Ausrüstung im Inventar behalten (isEssentialItem)
assert.strictEqual(baseMgr.isEssentialItem({ name: 'diamond_pickaxe' }), true, 'Spitzhacke wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'iron_sword' }), true, 'Schwert wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'shield' }), true, 'Schild wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'cooked_beef' }), true, 'Nahrung wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'bread' }), true, 'Brot wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'crafting_table' }), true, 'Werkbank wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'furnace' }), true, 'Ofen wird behalten');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'raw_iron' }), false, 'Roheisen wird NICHT behalten (wird eingelagert)');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'cobblestone' }), false, 'Cobblestone wird eingelagert');
assert.strictEqual(baseMgr.isEssentialItem({ name: 'rotten_flesh' }), false, 'Zombie-Fleisch wird eingelagert');
pass('3.4 isEssentialItem schützt Werkzeuge, Nahrung & Überlebensausrüstung vor unbedachtem Einlagern');

// 3.5 Beute in Basiskisten einsortieren (depositLoot)
const depositedToChest = [];
const mockDepositBot = {
  version: '1.20.4',
  entity: { position: new Vec3(100, 64, 200) },
  inventory: {
    items: () => [
      { name: 'diamond_pickaxe', count: 1, type: 10 },
      { name: 'bread', count: 16, type: 20 },
      { name: 'raw_iron', count: 24, type: 801 },
      { name: 'diamond', count: 5, type: 805 },
      { name: 'rotten_flesh', count: 12, type: 850 },
      { name: 'torch', count: 80, type: 290 } // 64 behalten, 16 einlagern
    ]
  },
  findBlocks: () => [new Vec3(102, 64, 200)],
  blockAt: (pos) => ({
    name: 'chest',
    position: pos,
    properties: { type: 'single' }
  })
};

let chestWindowClosed = false;
const mockChestWindow = {
  deposit: async (type, meta, count) => {
    depositedToChest.push({ type, count });
  },
  close: () => { chestWindowClosed = true; }
};

// Mock chestManager openContainerSafely
const origOpen = baseMgr.openContainerSafely;
mockDepositBot.openContainer = async () => mockChestWindow;

const depResult = await baseMgr.depositLoot(mockDepositBot, { radius: 10 });
assert.strictEqual(depResult.success, true, 'depositLoot war erfolgreich');
assert(depResult.depositedCount > 0, 'Gegenstände wurden eingelagert');
const depositedNames = depResult.items.map(i => i.name);
assert(depositedNames.includes('raw_iron'), 'raw_iron wurde eingelagert');
assert(depositedNames.includes('diamond'), 'diamond wurde eingelagert');
assert(depositedNames.includes('rotten_flesh'), 'rotten_flesh wurde eingelagert');
assert(depositedNames.includes('torch'), 'Überschüssige Fackeln wurden eingelagert');
assert(!depositedNames.includes('diamond_pickaxe'), 'diamond_pickaxe verblieb im Bot-Inventar');
assert(!depositedNames.includes('bread'), 'Brot verblieb im Bot-Inventar');
pass('3.5 depositLoot sortiert Erze, Edelsteine, Beute und Baustoffe sicher in Basiskisten ein');

// =========================================================================
// TESTGRUPPE 4: ExpeditionManager & Autonome Höhlen-FSM (Phase 4)
// =========================================================================
console.log('\n--- Testgruppe 4: ExpeditionManager & Autonome Höhlen-FSM ---');

const expeditionMgr = new ExpeditionManager();
assert.strictEqual(expeditionMgr.currentState, EXPEDITION_STATES.IDLE, 'Startzustand ist IDLE');

// 4.1 FSM Statusübergänge
const fsmHistory = [];
expeditionMgr.onStateChangeCallback = (newState, prev) => {
  fsmHistory.push({ from: prev, to: newState });
};

expeditionMgr.setState(EXPEDITION_STATES.PREPARING);
expeditionMgr.setState(EXPEDITION_STATES.EXPLORING_CAVE);
expeditionMgr.setState(EXPEDITION_STATES.LIGHTING);
expeditionMgr.setState(EXPEDITION_STATES.MINING_VEIN);
expeditionMgr.setState(EXPEDITION_STATES.DEFENDING);
expeditionMgr.setState(EXPEDITION_STATES.RETURNING_HOME);
expeditionMgr.setState(EXPEDITION_STATES.UNLOADING_AT_BASE);
expeditionMgr.setState(EXPEDITION_STATES.IDLE);

assert.strictEqual(fsmHistory.length, 8, '8 FSM-Übergänge registriert');
pass('4.1 ExpeditionManager FSM durchläuft alle Zustände nach Spezifikation');

// 4.2 Fackel-Automatik bei Dunkelheit (Lichtlevel 0)
let torchPlacedInWorld = false;
const mockDarkCaveBot = {
  version: '1.20.4',
  entity: {
    position: new Vec3(15, 20, 15),
    floored: () => new Vec3(15, 20, 15)
  },
  inventory: {
    items: () => [{ name: 'torch', count: 16, type: 290 }]
  },
  blockAt: (pos) => {
    if (pos.x === 15 && pos.y === 20 && pos.z === 15) {
      return { name: 'cave_air', light: 0, position: pos }; // Lichtlevel 0!
    }
    if (pos.y === 19) {
      return { name: 'deepslate', boundingBox: 'block', position: pos };
    }
    return { name: 'cave_air', light: 0, position: pos };
  },
  equip: async () => true,
  placeBlock: async () => {
    torchPlacedInWorld = true;
  }
};

assert.strictEqual(expeditionMgr.isCurrentLocationDark(mockDarkCaveBot), true, 'Lichtlevel 0 wird als dunkel erkannt');
const placedTorchSuccess = await expeditionMgr.placeTorch(mockDarkCaveBot);
assert.strictEqual(placedTorchSuccess, true, 'Fackel erfolgreich platziert');
assert.strictEqual(torchPlacedInWorld, true, 'bot.placeBlock für Fackel ausgeführt');
assert.strictEqual(expeditionMgr.stats.torchesPlaced, 1, 'torchesPlaced inkrementiert');
pass('4.2 Fackel-Automatik platziert Fackeln zuverlässig bei Block-Lichtlevel 0');

// 4.3 Ader-Mining mit Lavaschutz
const veinDug = [];
const mockVeinBot = {
  version: '1.20.4',
  entity: { position: new Vec3(30, 12, 30) },
  inventory: {
    items: () => [{ name: 'diamond_pickaxe', count: 1, type: 10 }]
  },
  blockAt: (pos) => {
    // 3 zusammenhängende Eisen-Erzblöcke
    if (pos.x === 31 && pos.y === 12 && pos.z === 30) return { name: 'deepslate_iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    if (pos.x === 32 && pos.y === 12 && pos.z === 30) return { name: 'deepslate_iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    if (pos.x === 33 && pos.y === 12 && pos.z === 30) {
      // Über Block 33 befindet sich Lava -> darf NICHT abgebaut werden!
      return { name: 'deepslate_iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    }
    if (pos.x === 33 && pos.y === 13 && pos.z === 30) {
      return { name: 'lava', position: pos };
    }
    return { name: 'deepslate', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
  },
  dig: async (block) => {
    veinDug.push(block.position.x);
  }
};

const initialVeinBlock = mockVeinBot.blockAt(new Vec3(31, 12, 30));
const minedInVein = await expeditionMgr.mineVein(mockVeinBot, initialVeinBlock, 8);
assert.strictEqual(minedInVein, 2, 'Exakt 2 sichere Erzblöcke der Ader abgebaut');
assert(!veinDug.includes(33), 'Block 33 unter Lava wurde durch Fall-/Lavaschutz übersprungen');
pass('4.3 mineVein baut zusammenhängende Erzadern ab und schützt vor Lava-Gefahren');

// 4.4 Smart-Return Bedingungen (Inventar voll >= 30, Ziel erreicht, Werkzeugmangel)
const mockFullInvBot = {
  inventory: {
    items: () => new Array(30).fill({ name: 'cobblestone', count: 64 })
  }
};
assert.strictEqual(expeditionMgr.isInventoryFull(mockFullInvBot, 30), true, 'Inventar mit >= 30 Slots löst Smart-Return aus');

const mockBrokenPickBot = {
  inventory: {
    items: () => [{ name: 'torch', count: 16 }] // Keine Spitzhacke
  }
};
assert.strictEqual(expeditionMgr.hasUsablePickaxe(mockBrokenPickBot), false, 'Fehlende Spitzhacke wird sofort erkannt');
pass('4.4 Smart-Return Trigger (Inventar voll & Werkzeugmangel) greifen präzise');

// 4.5 Vollständige Expeditions-Simulation
const fullExpeditionBot = {
  version: '1.20.4',
  entity: {
    position: new Vec3(100, 64, 200),
    floored: () => new Vec3(100, 64, 200)
  },
  inventory: {
    items: () => [
      { name: 'iron_pickaxe', count: 1, type: 831 },
      { name: 'torch', count: 32, type: 290 },
      { name: 'cooked_beef', count: 16, type: 200 }
    ]
  },
  findBlocks: () => [new Vec3(105, 30, 205)],
  blockAt: (pos) => {
    if (pos.x === 105 && pos.y === 30 && pos.z === 205) {
      return { name: 'iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    }
    return { name: 'stone', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
  },
  dig: async () => {},
  pathfinder: {
    goto: async () => true,
    setGoal: () => {},
    stop: () => {}
  }
};

baseStorageManager.setHome(new Vec3(100, 64, 200));

const expeditionOutcome = await expeditionMgr.startExpedition(fullExpeditionBot, {
  targetResource: 'iron_ore',
  targetAmount: 1,
  maxDurationMs: 3000
});

assert.strictEqual(expeditionOutcome.success, true, 'Expedition war erfolgreich');
assert.strictEqual(expeditionOutcome.stats.returnedSafely, true, 'Bot ist sicher zur Basis zurückgekehrt');
assert.strictEqual(expeditionMgr.currentState, EXPEDITION_STATES.IDLE, 'FSM befindet sich nach Abschluss wieder in IDLE');
pass('4.5 Vollständige Solo-Höhlen-Expedition autonom durchlaufen (Start -> Mining -> Home -> Depot -> IDLE)');

// =========================================================================
// TESTGRUPPE 5: Integration & Router-Kopplung (Phase 5)
// =========================================================================
console.log('\n--- Testgruppe 5: Integration & Router-Kopplung ---');

// 5.1 TaskIntentRouter: Neue Survival-Intents
const expIntent = taskIntentRouter.matchDeterministicIntent('gehe auf minen-expedition nach eisen und diamanten');
assert.strictEqual(expIntent?.intent, TASK_INTENTS.EXPEDITION, 'Expeditions-Befehl -> EXPEDITION');
assert.strictEqual(expIntent?.resource, 'diamond_ore', 'Priorisierte Ressource diamond_ore');

const expIntent2 = taskIntentRouter.matchDeterministicIntent('!expedition iron_ore 32');
assert.strictEqual(expIntent2?.intent, TASK_INTENTS.EXPEDITION, '!expedition -> EXPEDITION');
assert.strictEqual(expIntent2?.amount, 32, 'Menge ist 32');

const craftIntent = taskIntentRouter.matchDeterministicIntent('crafte 16 fackeln');
assert.strictEqual(craftIntent?.intent, TASK_INTENTS.CRAFT, 'crafte 16 fackeln -> CRAFT');
assert.strictEqual(craftIntent?.item, 'torch', 'Item ist torch');
assert.strictEqual(craftIntent?.count, 16, 'Anzahl ist 16');

const craftIntent2 = taskIntentRouter.matchDeterministicIntent('stelle eine werkbank her');
assert.strictEqual(craftIntent2?.intent, TASK_INTENTS.CRAFT, 'stelle werkbank her -> CRAFT');
assert.strictEqual(craftIntent2?.item, 'crafting_table', 'Item ist crafting_table');

const smeltIntent = taskIntentRouter.matchDeterministicIntent('schmilz alle roherze im ofen');
assert.strictEqual(smeltIntent?.intent, TASK_INTENTS.SMELT, 'schmilz alle roherze -> SMELT');

const homeIntent = taskIntentRouter.matchDeterministicIntent('komm nach hause');
assert.strictEqual(homeIntent?.intent, TASK_INTENTS.HOME, 'komm nach hause -> HOME');

const sethomeIntent = taskIntentRouter.matchDeterministicIntent('merke dir diesen ort als basis');
assert.strictEqual(sethomeIntent?.intent, TASK_INTENTS.SETHOME, 'merke dir diesen ort als basis -> SETHOME');

const sethomeIntent2 = taskIntentRouter.matchDeterministicIntent('!sethome');
assert.strictEqual(sethomeIntent2?.intent, TASK_INTENTS.SETHOME, '!sethome -> SETHOME');

const depositIntent = taskIntentRouter.matchDeterministicIntent('räume dein inventar in die kisten');
assert.strictEqual(depositIntent?.intent, TASK_INTENTS.DEPOSIT, 'räume inventar in kisten -> DEPOSIT');

pass('5.1 TaskIntentRouter erkennt alle neuen Survival-Intents mit 0ms Latenz');

// 5.2 In-Game ChatController Integration
const inGameChats = [];
const mockOwner = settings.BOT_OWNER || 'Steve';
const chatBot = {
  username: 'ArchitectBot',
  entity: { position: new Vec3(100, 64, 200) },
  players: {
    [mockOwner]: { entity: { position: new Vec3(102, 64, 200) } }
  },
  inventory: {
    items: () => [{ name: 'torch', count: 16 }]
  },
  chat: (msg) => { inGameChats.push(msg); },
  pathfinder: {
    goto: async () => true,
    setGoal: () => {},
    stop: () => {}
  }
};

const chatCtrl = new ChatController(chatBot, {
  instantMode: false,
  pendingProposal: null,
  getEffectiveSiteInfo: () => ({ origin: { x: 0, y: 64, z: 0 }, width: 10, depth: 10, facing: 'north' })
});

// Chat-Befehl: !sethome
await chatCtrl.handleMessage(mockOwner, '!sethome');
assert(inGameChats.some(c => c.includes('Heimatbasis erfolgreich gespeichert')), 'In-Game Chat bestätigt !sethome');

// Chat-Befehl: !home
await chatCtrl.handleMessage(mockOwner, '!home');
assert(inGameChats.some(c => c.includes('Kehre zur Basis zurück')), 'In-Game Chat bestätigt !home');

// Chat-Befehl: !deposit
await chatCtrl.handleMessage(mockOwner, '!deposit');
assert(inGameChats.some(c => c.includes('Sortiere Schätze')), 'In-Game Chat bestätigt !deposit');

pass('5.2 In-Game ChatController führt !sethome, !home und !deposit zuverlässig aus');

// 5.3 Dashboard WebSocket Handler Integration
const recordedWsChat = [];
const mockWsContext = {
  currentBot: fullExpeditionBot,
  architectAgent: {
    getEffectiveSiteInfo: () => ({ origin: { x: 0, y: 64, z: 0 }, width: 16, depth: 16, facing: 'north' }),
    synthesizeBuild: async () => ({ canvas: { blocks: new Map() }, lintReport: { detailRatio: 0.3 } })
  },
  recordChat: (sender, msg) => {
    recordedWsChat.push({ sender, msg });
  }
};

await handleArchitectWsMessage({
  type: 'prompt_architect',
  text: '!sethome'
}, null, mockWsContext);

assert(recordedWsChat.some(l => l.sender === 'Basis' && l.msg.includes('Heimatbasis erfolgreich gespeichert')), 'Dashboard WS bestätigt !sethome');

await handleArchitectWsMessage({
  type: 'prompt_architect',
  text: 'schmilz alle roherze im ofen'
}, null, mockWsContext);

assert(recordedWsChat.some(l => l.sender === 'Schmelzen' && l.msg.includes('Starte Verhüttung')), 'Dashboard WS bestätigt Schmelzen');

pass('5.3 WebSocket Dispatcher koppelt Dashboard nahtlos an alle Survival-Module');

// 5.4 Web-Dashboard Quick-Chips Markup
const htmlPath = path.resolve(process.cwd(), 'src', 'web', 'public', 'index.html');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');
assert(htmlContent.includes('🧭 Expedition'), 'Dashboard enthält Quick-Chip für Expedition');
assert(htmlContent.includes('🏠 Basis setzen'), 'Dashboard enthält Quick-Chip für Basis setzen');
assert(htmlContent.includes('🏡 Zur Basis'), 'Dashboard enthält Quick-Chip für Zur Basis');
assert(htmlContent.includes('🔥 Schmelzen'), 'Dashboard enthält Quick-Chip für Schmelzen');
assert(htmlContent.includes('📦 Beute einsortieren'), 'Dashboard enthält Quick-Chip für Beute einsortieren');
pass('5.4 Web-Dashboard Quick-Chips Markup in index.html vollständig integriert');

console.log(`\n=== ALLE ${passedTests}/${passedTests} TESTS DER SURVIVAL EXPEDITION SUITE BESTANDEN! ===`);
