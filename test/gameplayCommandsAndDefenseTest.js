import assert from 'node:assert';
import { Vec3 } from 'vec3';
import { taskIntentRouter, TASK_INTENTS, normalizeResourceName } from '../src/ai/router/taskIntentRouter.js';
import { HarvestManager, harvestManager, COMMON_ORE_MAP } from '../src/survival/harvestManager.js';
import { GuardManager, guardManager, GUARD_STATES } from '../src/bot/guardManager.js';
import { handleArchitectWsMessage } from '../src/web/ws/handlers/architectWsHandler.js';
import { ChatController } from '../src/bot/chatController.js';
import { worldExecutor } from '../src/builder/worldExecutor.js';
import { settings } from '../src/config/settings.js';

console.log('=== STARTING GAMEPLAY COMMANDS & DEFENSE TEST SUITE ===');

// =========================================================================
// TESTGRUPPE 1: TaskIntentRouter - Deterministische Klassifizierung
// =========================================================================
console.log('\n--- Testgruppe 1: TaskIntentRouter Klassifizierung ---');

// 1.1 Ressourcennamen normalisieren
assert(normalizeResourceName('eisenerz') === 'iron_ore', 'eisenerz -> iron_ore');
assert(normalizeResourceName('kohle') === 'coal_ore', 'kohle -> coal_ore');
assert(normalizeResourceName('diamanten') === 'diamond_ore', 'diamanten -> diamond_ore');
assert(normalizeResourceName('kupfererz') === 'copper_ore', 'kupfererz -> copper_ore');
assert(normalizeResourceName('bäume fällen') === 'any_log', 'bäume -> any_log');
assert(normalizeResourceName('stein') === 'stone', 'stein -> stone');
console.log('[PASS] normalizeResourceName ordnet deutsche Rohstoffnamen korrekt zu');

// 1.2 Mining-Befehle (speziell "baue [...] ab" vs "baue [Haus]")
const mine1 = taskIntentRouter.matchDeterministicIntent('baue alle eisenerz vorkommen in deiner nähe ab.');
assert(mine1 !== null, 'mine1 darf nicht null sein');
assert(mine1.intent === TASK_INTENTS.MINE, `mine1 Intent ist MINE (tatsächlich: ${mine1?.intent})`);
assert(mine1.resource === 'iron_ore', `mine1 Resource ist iron_ore (tatsächlich: ${mine1?.resource})`);
assert(mine1.amount === 64, 'mine1 amount für "alle" ist 64');
console.log('[PASS] "baue alle eisenerz vorkommen in deiner nähe ab." -> MINE (iron_ore)');

const mine2 = taskIntentRouter.matchDeterministicIntent('baue 16 kohle ab');
assert(mine2?.intent === TASK_INTENTS.MINE, 'mine2 Intent ist MINE');
assert(mine2?.resource === 'coal_ore', 'mine2 Resource ist coal_ore');
assert(mine2?.amount === 16, 'mine2 amount ist 16');
console.log('[PASS] "baue 16 kohle ab" -> MINE (coal_ore, 16)');

const mine3 = taskIntentRouter.matchDeterministicIntent('fäll holz im umkreis von 30m');
assert(mine3?.intent === TASK_INTENTS.MINE, 'mine3 Intent ist MINE');
assert(mine3?.resource === 'any_log', 'mine3 Resource ist any_log');
assert(mine3?.radius === 30, 'mine3 radius ist 30');
console.log('[PASS] "fäll holz im umkreis von 30m" -> MINE (any_log, 30m)');

// 1.3 Verteidigungsbefehle (DEFEND)
const def1 = taskIntentRouter.matchDeterministicIntent('verteidige diesen bereich und töte alle monster/feinde(npcs)');
assert(def1 !== null, 'def1 darf nicht null sein');
assert(def1.intent === TASK_INTENTS.DEFEND, `def1 Intent ist DEFEND (tatsächlich: ${def1?.intent})`);
assert(def1.target === 'hostiles', 'def1 target ist hostiles');
console.log('[PASS] "verteidige diesen bereich und töte alle monster/feinde(npcs)" -> DEFEND');

const def2 = taskIntentRouter.matchDeterministicIntent('beschütze diesen bereich im radius von 25 blöcken');
assert(def2?.intent === TASK_INTENTS.DEFEND, 'def2 Intent ist DEFEND');
assert(def2?.radius === 25, 'def2 radius ist 25');
console.log('[PASS] "beschütze diesen bereich im radius von 25 blöcken" -> DEFEND (25m)');

const def3 = taskIntentRouter.matchDeterministicIntent('töte alle feinde');
assert(def3?.intent === TASK_INTENTS.DEFEND, 'def3 Intent ist DEFEND');
console.log('[PASS] "töte alle feinde" -> DEFEND');

// 1.4 Reine Bauaufträge (BUILD) - dürfen NICHT als Mining fehlinterpretiert werden!
const build1 = taskIntentRouter.matchDeterministicIntent('baue ein gemütliches Gasthaus aus Eichenholz mit Schornstein');
assert(build1?.intent === TASK_INTENTS.BUILD, `build1 Intent muss BUILD sein (tatsächlich: ${build1?.intent})`);
console.log('[PASS] "baue ein gemütliches Gasthaus..." -> BUILD (keine Fehlklassifizierung als Mining)');

const build2 = taskIntentRouter.matchDeterministicIntent('errichte einen runden wehrturm');
assert(build2?.intent === TASK_INTENTS.BUILD, 'build2 Intent ist BUILD');
console.log('[PASS] "errichte einen runden wehrturm" -> BUILD');

// 1.5 Hilfsbefehle: STOP, FOLLOW, STATUS
const stop1 = taskIntentRouter.matchDeterministicIntent('stopp');
assert(stop1?.intent === TASK_INTENTS.STOP, 'stopp -> STOP');
const stop2 = taskIntentRouter.matchDeterministicIntent('!stop');
assert(stop2?.intent === TASK_INTENTS.STOP, '!stop -> STOP');
const follow1 = taskIntentRouter.matchDeterministicIntent('komm zu mir');
assert(follow1?.intent === TASK_INTENTS.FOLLOW, 'komm zu mir -> FOLLOW');
const status1 = taskIntentRouter.matchDeterministicIntent('zeige status und lebenspunkte');
assert(status1?.intent === TASK_INTENTS.STATUS, 'status -> STATUS');
console.log('[PASS] STOP, FOLLOW, STATUS Befehle erfolgreich klassifiziert');

// =========================================================================
// TESTGRUPPE 2: HarvestManager Ore-Mining & Drop-Collection
// =========================================================================
console.log('\n--- Testgruppe 2: HarvestManager Ore-Mining ---');

const harvestMgr = new HarvestManager();
assert(COMMON_ORE_MAP.iron_ore.includes('iron_ore'), 'COMMON_ORE_MAP enthält iron_ore');
assert(COMMON_ORE_MAP.iron_ore.includes('deepslate_iron_ore'), 'COMMON_ORE_MAP enthält deepslate_iron_ore');
assert(COMMON_ORE_MAP.diamond_ore.includes('diamond_ore'), 'COMMON_ORE_MAP enthält diamond_ore');
console.log('[PASS] COMMON_ORE_MAP umfasst Standard- und Deepslate-Erze');

// Mock Bot für HarvestManager
const dugBlocks = [];
const equippedItems = [];
const mockOreBot = {
  version: '1.20.4',
  entity: {
    position: new Vec3(10, 64, 10),
    floored: () => new Vec3(10, 64, 10)
  },
  inventory: {
    items: () => [
      { name: 'iron_pickaxe', type: 1 }
    ]
  },
  equip: async (item, slot) => {
    equippedItems.push(item.name);
  },
  findBlocks: ({ matching, maxDistance, count }) => {
    return [
      new Vec3(12, 64, 10),
      new Vec3(13, 64, 11),
      new Vec3(10, 64, 10) // Direkt unter Bot -> sollte übersprungen werden
    ];
  },
  blockAt: (pos) => {
    if (pos.x === 12 && pos.y === 64 && pos.z === 10) {
      return { name: 'iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    }
    if (pos.x === 13 && pos.y === 64 && pos.z === 11) {
      return { name: 'deepslate_iron_ore', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
    }
    return { name: 'stone', position: pos, offset: (dx, dy, dz) => pos.offset(dx, dy, dz) };
  },
  dig: async (block) => {
    dugBlocks.push(block.name);
  },
  entities: {
    101: { name: 'item', position: new Vec3(12.2, 64, 10.1) }
  },
  pathfinder: {
    goto: async () => true,
    setGoal: () => {}
  },
  chat: () => {}
};

// Teste harvestOres
const oreResult = await harvestMgr.harvestOres(mockOreBot, 'iron_ore', 5, 20, { chatAlerts: false });
assert(oreResult.success === true, 'harvestOres war erfolgreich');
assert(oreResult.harvested === 2, `Es wurden 2 Blöcke abgebaut (tatsächlich: ${oreResult.harvested})`);
assert(dugBlocks.includes('iron_ore'), 'iron_ore wurde abgebaut');
assert(dugBlocks.includes('deepslate_iron_ore'), 'deepslate_iron_ore wurde abgebaut');
assert(equippedItems.includes('iron_pickaxe'), 'Spitzhacke wurde vor Abbau ausgerüstet');
console.log('[PASS] harvestOres findet, nähert sich und baut Erze mit Fallschutz sicher ab');

// Teste Not-Stopp während Mining
harvestMgr.isHarvesting = true;
harvestMgr.abort();
assert(harvestMgr.isHarvesting === false, 'isHarvesting ist false nach abort()');
assert(harvestMgr.abortSignal === true, 'abortSignal ist true');
console.log('[PASS] harvestManager.abort() bricht Mining sofort ab');

// =========================================================================
// TESTGRUPPE 3: GuardManager Gebietsverteidigung
// =========================================================================
console.log('\n--- Testgruppe 3: GuardManager Gebietsverteidigung ---');

const guardMgr = guardManager;
let botChatMessages = [];

const mockGuardBot = {
  version: '1.20.4',
  health: 20,
  food: 20,
  entity: {
    position: new Vec3(100, 64, 100)
  },
  inventory: {
    items: () => [
      { name: 'diamond_sword' },
      { name: 'shield' },
      { name: 'diamond_chestplate' },
      { name: 'cooked_beef' }
    ]
  },
  equip: async () => true,
  activateItem: () => {},
  deactivateItem: () => {},
  attack: (target) => {
    target.health = 0;
    target.isValid = false;
  },
  lookAt: async () => {},
  entities: {},
  pathfinder: {
    goto: async () => true,
    setGoal: () => {},
    stop: () => {}
  },
  chat: (msg) => {
    botChatMessages.push(msg);
  }
};

// 3.1 Starten des Wachdienstes
await guardMgr.startGuarding(mockGuardBot, new Vec3(100, 64, 100), 20, { chatAlerts: true });
assert(guardMgr.isGuarding === true, 'isGuarding ist true');
assert(guardMgr.state === GUARD_STATES.PATROLLING, 'Initialer State ist PATROLLING');
assert(guardMgr.guardRadius === 20, 'Radius ist 20m');
assert(botChatMessages.some(m => m.includes('Starte Gebietsverteidigung')), 'Chat-Meldung zum Wachdienst wurde gesendet');
console.log('[PASS] guardManager.startGuarding initialisiert Posten und Kampfausrüstung');

// 3.2 Feind im Schutzbereich erkennen
// Monster 1: Zombie innerhalb des 20m Schutzbereichs
mockGuardBot.entities = {
  201: {
    name: 'zombie',
    health: 20,
    isValid: true,
    position: new Vec3(108, 64, 105) // Distanz ca. 9.4m -> IN ZONE
  },
  202: {
    name: 'sheep',
    health: 8,
    isValid: true,
    position: new Vec3(102, 64, 102) // Friedliches Tier -> Ignorieren!
  },
  203: {
    name: 'skeleton',
    health: 20,
    isValid: true,
    position: new Vec3(150, 64, 100) // 50m entfernt -> AUSSERHALB DER ZONE
  }
};

const detectedIntruder = guardMgr.findHostileInZone();
assert(detectedIntruder !== null, 'Intruder muss erkannt werden');
assert(detectedIntruder.name === 'zombie', `Erkannter Mob muss zombie sein (tatsächlich: ${detectedIntruder?.name})`);
console.log('[PASS] findHostileInZone filtert feindliche Mobs exakt im Schutzbereich');

// 3.3 Tick durchführen: Patrouille -> Feindbekämpfung
await guardMgr.tick();
assert(guardMgr.state === GUARD_STATES.ENGAGING, `State muss ENGAGING sein (tatsächlich: ${guardMgr.state})`);
assert(guardMgr.currentTarget === detectedIntruder, 'currentTarget ist der Zombie');
console.log('[PASS] Eindringling triggert Übergang in den Angriffsmodus');

// 3.4 Kampfschritt ausführen: Bot nähert sich auf Schlagdistanz und neutralisiert Ziel
mockGuardBot.entity.position = new Vec3(107, 64, 105); // 1m Distanz zum Zombie
await guardMgr.tick();
assert(guardMgr.defeatedCount === 1, `Besiegte Feinde muss 1 sein (tatsächlich: ${guardMgr.defeatedCount})`);
assert(guardMgr.state === GUARD_STATES.LOOTING || guardMgr.state === GUARD_STATES.RETURNING, 'Wechselt nach Neutralisierung zu LOOTING/RETURNING');
console.log('[PASS] Feind erfolgreich neutralisiert und Kills inkrementiert');

// 3.5 Wachdienst beenden
guardMgr.stopGuarding();
assert(guardMgr.isGuarding === false, 'isGuarding ist false nach stopGuarding()');
assert(guardMgr.state === GUARD_STATES.IDLE, 'State ist IDLE');
console.log('[PASS] guardManager.stopGuarding beendet Wachdienst sauber');

// =========================================================================
// TESTGRUPPE 4: Dashboard WebSocket Dispatcher Integration
// =========================================================================
console.log('\n--- Testgruppe 4: Dashboard WebSocket Dispatcher ---');

const recordedLogs = [];
const mockWsContext = {
  currentBot: mockGuardBot,
  architectAgent: {
    getEffectiveSiteInfo: () => ({ origin: { x: 0, y: 64, z: 0 }, width: 16, depth: 16, facing: 'north' }),
    synthesizeBuild: async () => ({ canvas: { blocks: new Map() }, lintReport: { detailRatio: 0.3 } })
  },
  recordChat: (sender, msg) => {
    recordedLogs.push({ sender, msg });
  }
};

// 4.1 Verteidigungs-Prompt über Dashboard-Chat absenden
await handleArchitectWsMessage({
  type: 'prompt_architect',
  text: 'verteidige diesen bereich und töte alle monster'
}, null, mockWsContext);

assert(recordedLogs.some(l => l.sender === 'Wachdienst' && l.msg.includes('Gebietsverteidigung aktiv')), 'Dashboard bestätigt Wachdienst-Aktivierung');
console.log('[PASS] Dashboard-Prompt "verteidige..." aktiviert autonomen Wachdienst');

// 4.2 Mining-Prompt über Dashboard-Chat absenden
await handleArchitectWsMessage({
  type: 'prompt_architect',
  text: 'baue alle eisenerz vorkommen in deiner nähe ab'
}, null, mockWsContext);

assert(recordedLogs.some(l => l.sender === 'Mining' && l.msg.includes('Starte Mining-Auftrag')), 'Dashboard bestätigt Mining-Start');
console.log('[PASS] Dashboard-Prompt "baue ... ab" startet Erzabbau');

// 4.3 Not-Stopp über Dashboard-Chat
await handleArchitectWsMessage({
  type: 'prompt_architect',
  text: '!stop'
}, null, mockWsContext);

assert(recordedLogs.some(l => l.sender === 'SYSTEM' && l.msg.includes('Not-Stopp ausgeführt')), 'Not-Stopp wird im Dashboard bestätigt');
console.log('[PASS] Dashboard "!stop" löst Universal-Not-Stopp aus');

// =========================================================================
// TESTGRUPPE 5: ChatController In-Game Integration
// =========================================================================
console.log('\n--- Testgruppe 5: ChatController In-Game Integration ---');

const inGameChats = [];
const testOwner = settings.BOT_OWNER || 'Steve';
const chatBot = {
  username: 'BaumeisterKI',
  entity: { position: new Vec3(50, 64, 50) },
  players: {
    [testOwner]: {
      entity: { position: new Vec3(52, 64, 50) }
    }
  },
  pathfinder: {
    setGoal: () => {},
    stop: () => {}
  },
  chat: (msg) => {
    inGameChats.push(msg);
  }
};

const dummyAgent = {
  instantMode: false,
  pendingProposal: null,
  getEffectiveSiteInfo: () => ({ origin: { x: 50, y: 64, z: 50 }, width: 10, depth: 10, facing: 'north' }),
  createPitch: async () => ({ pitchMessage: 'Ich plane eine Taverne!' }),
  synthesizeBuild: async () => ({ canvas: { blocks: new Map(), getBounds: () => ({ width: 10, height: 10, depth: 10 }) } })
};

const chatCtrl = new ChatController(chatBot, dummyAgent);

// 5.1 In-Game Gameplay-Befehl: Verteidigung
await chatCtrl.handleMessage(testOwner, 'verteidige diesen bereich und töte alle feinde');
assert(guardMgr.isGuarding === true, 'Wachdienst wurde über In-Game Chat gestartet');
console.log('[PASS] In-Game Chat-Befehl "verteidige..." aktiviert Wachdienst');

// 5.2 In-Game Gameplay-Befehl: Stop
await chatCtrl.handleMessage(testOwner, '!stop');
assert(guardMgr.isGuarding === false, 'Wachdienst wurde durch !stop beendet');
console.log('[PASS] In-Game "!stop" beendet Wachdienst und alle Operationen');

// 5.3 In-Game Bauauftrag (soll wie gewohnt Architektur-Pitch auslösen)
await chatCtrl.handleMessage(testOwner, 'baue ein kleines Holzhaus');
assert(inGameChats.some(m => m.includes('Plane Architektur') || m.includes('Ich plane eine Taverne')), 'Architektur-Planung wird für Bauauftrag aufgerufen');
console.log('[PASS] In-Game "baue ein kleines Holzhaus" wird als Architektur-Bauauftrag ausgeführt');

console.log('\n=== ALLE TESTS DER GAMEPLAY & DEFENSE SUITE ERFOLGREICH BESTANDEN! ===\n');
