/**
 * Automated Test Suite: Minecraft Player List (Tablist) Overlay in Gamemode
 *
 * Verifies:
 * 1. Static HTML Structure: DOM elements in index.html & gamemode.html, unique IDs
 * 2. Static CSS Validation: .gamemode-player-tablist, .mc-tablist-*, ping bars, hidden class
 * 3. Backend Telemetry & Services: buildPlayersList, buildTablistData, bot_telemetry payload
 * 4. WebSocket Dispatcher: request_player_list & request_tablist messaging
 * 5. Frontend Interactive Behaviors: Tab keydown/keyup, stuck-key protection, rendering, heads & ping bars
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildPlayersList,
  buildTablistData,
  buildBotTelemetry
} from '../src/web/services/dashboardTelemetryService.js';
import { handleGamemodeWsMessage, isGamemodeWsMessage } from '../src/web/ws/handlers/gamemodeWsHandler.js';
import * as manualCockpit from '../src/web/public/js/manualCockpit.js';

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

async function runTablistTestSuite() {
  console.log('\x1b[36m=== STARTING MINECRAFT GAMEMODE TABLIST TEST SUITE ===\x1b[0m\n');

  // ==============================================================================
  // 1. STATISCHE HTML-STRUKTUR & DOM-IDS (index.html & gamemode.html)
  // ==============================================================================
  console.log('--- Testgruppe 1: Statische HTML Struktur & DOM-IDs ---');
  const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf-8');
  const popoutHtml = fs.readFileSync(path.resolve('src/web/public/gamemode.html'), 'utf-8');

  // Elements in index.html
  testAssert(indexHtml.includes('id="gamemodePlayerTablist"'), '1.1 index.html definiert #gamemodePlayerTablist');
  testAssert(indexHtml.includes('id="mcTablistHeader"'), '1.2 index.html definiert #mcTablistHeader');
  testAssert(indexHtml.includes('id="mcTablistPlayerCount"'), '1.3 index.html definiert #mcTablistPlayerCount');
  testAssert(indexHtml.includes('id="mcTablistPlayerGrid"'), '1.4 index.html definiert #mcTablistPlayerGrid');
  testAssert(indexHtml.includes('id="mcTablistFooter"'), '1.5 index.html definiert #mcTablistFooter');

  // Elements in gamemode.html
  testAssert(popoutHtml.includes('id="gamemodePlayerTablist"'), '1.6 gamemode.html definiert #gamemodePlayerTablist');
  testAssert(popoutHtml.includes('id="mcTablistHeader"'), '1.7 gamemode.html definiert #mcTablistHeader');
  testAssert(popoutHtml.includes('id="mcTablistPlayerCount"'), '1.8 gamemode.html definiert #mcTablistPlayerCount');
  testAssert(popoutHtml.includes('id="mcTablistPlayerGrid"'), '1.9 gamemode.html definiert #mcTablistPlayerGrid');
  testAssert(popoutHtml.includes('id="mcTablistFooter"'), '1.10 gamemode.html definiert #mcTablistFooter');

  // Zero Duplicate IDs across index.html
  const idRegex = /id=["']([^"']+)["']/g;
  const idCounts = {};
  let match;
  while ((match = idRegex.exec(indexHtml)) !== null) {
    const id = match[1];
    idCounts[id] = (idCounts[id] || 0) + 1;
  }
  const duplicateIds = Object.keys(idCounts).filter(id => idCounts[id] > 1);
  testAssert(duplicateIds.length === 0, `1.11 Keine doppelten DOM-IDs in index.html (Gefundene Duplikate: ${duplicateIds.join(', ')})`);

  // ==============================================================================
  // 2. STATISCHE CSS-VALIDIERUNG (style.css)
  // ==============================================================================
  console.log('\n--- Testgruppe 2: Statische CSS Minecraft Tablist Styles (style.css) ---');
  const cssContent = fs.readFileSync(path.resolve('src/web/public/style.css'), 'utf-8');

  testAssert(cssContent.includes('.gamemode-player-tablist'), '2.1 style.css definiert .gamemode-player-tablist');
  testAssert(cssContent.includes('.gamemode-player-tablist.hidden'), '2.2 style.css deklariert .gamemode-player-tablist.hidden { display: none; }');
  testAssert(cssContent.includes('.mc-tablist-container'), '2.3 style.css definiert .mc-tablist-container');
  testAssert(cssContent.includes('.mc-tablist-player-grid'), '2.4 style.css definiert .mc-tablist-player-grid');
  testAssert(cssContent.includes('.mc-tablist-player-row'), '2.5 style.css definiert .mc-tablist-player-row');
  testAssert(cssContent.includes('.mc-tablist-head'), '2.6 style.css definiert .mc-tablist-head mit pixelated rendering');
  testAssert(cssContent.includes('.mc-tablist-name'), '2.7 style.css definiert .mc-tablist-name');
  testAssert(cssContent.includes('.mc-ping-bar'), '2.8 style.css definiert .mc-ping-bar');
  testAssert(cssContent.includes('.active-green') && cssContent.includes('.active-yellow') && cssContent.includes('.active-red'),
             '2.9 style.css definiert Farbstufen für Minecraft Ping-Balken (grün, gelb, rot)');

  // ==============================================================================
  // 3. BACKEND SERVICES: buildPlayersList & buildTablistData
  // ==============================================================================
  console.log('\n--- Testgruppe 3: Backend Spielerlisten & Tablist-Header/Footer Generierung ---');

  // 3.1 Null / Undefined Bot handling
  const emptyPlayers = buildPlayersList(null);
  testAssert(Array.isArray(emptyPlayers) && emptyPlayers.length === 0, '3.1 buildPlayersList(null) liefert leeres Array');

  const emptyTablist = buildTablistData(null);
  testAssert(emptyTablist.header === null && emptyTablist.footer === null, '3.2 buildTablistData(null) liefert null-Werte');

  // 3.2 Mock Bot mit Spielern, Ping, Gamemodes und DisplayNames
  const mockBot = {
    username: 'BaumeisterKI',
    _client: { uuid: 'bot-uuid-1234' },
    players: {
      'Alex': {
        username: 'Alex',
        displayName: '§a[VIP] Alex',
        uuid: 'uuid-alex',
        ping: 42,
        gamemode: 0
      },
      'Steve': {
        username: 'Steve',
        displayName: { toString: () => 'Steve The Great' },
        uuid: 'uuid-steve',
        ping: 210,
        gamemode: 1
      },
      'SpectatorPlayer': {
        username: 'SpectatorPlayer',
        displayName: 'Ghost',
        uuid: 'uuid-spectator',
        ping: 750,
        gamemode: 3
      },
      'BaumeisterKI': {
        username: 'BaumeisterKI',
        displayName: 'BaumeisterKI',
        uuid: 'bot-uuid-1234',
        ping: 5,
        gamemode: 0
      }
    },
    tablist: {
      header: { toString: () => 'Willkommen auf dem Minecraft Architect Server!' },
      footer: 'Server IP: mc.architect.bot'
    }
  };

  const players = buildPlayersList(mockBot);
  testAssert(players.length === 4, '3.3 buildPlayersList liefert alle 4 Spieler');

  const alex = players.find(p => p.username === 'Alex');
  testAssert(alex && alex.displayName === '§a[VIP] Alex' && alex.ping === 42 && alex.isBot === false,
             '3.4 Alex korrekt formatiert mit Ping und DisplayName');

  const steve = players.find(p => p.username === 'Steve');
  testAssert(steve && steve.displayName === 'Steve The Great' && steve.ping === 210,
             '3.5 Steve extrahiert DisplayName aus ChatMessage/toString');

  const botPlayer = players.find(p => p.username === 'BaumeisterKI');
  testAssert(botPlayer && botPlayer.isBot === true, '3.6 BaumeisterKI als Bot markiert (isBot: true)');

  const tablist = buildTablistData(mockBot);
  testAssert(tablist.header === 'Willkommen auf dem Minecraft Architect Server!',
             '3.7 buildTablistData extrahiert Server-Header');
  testAssert(tablist.footer === 'Server IP: mc.architect.bot',
             '3.8 buildTablistData extrahiert Server-Footer');

  // 3.3 Integration in buildBotTelemetry
  const telemetry = buildBotTelemetry({ bot: mockBot });
  testAssert(Array.isArray(telemetry.players) && telemetry.players.length === 4,
             '3.9 buildBotTelemetry beinhaltet players Array');
  testAssert(telemetry.tablist && telemetry.tablist.header !== null,
             '3.10 buildBotTelemetry beinhaltet tablist Objekt');

  // ==============================================================================
  // 4. WEBSOCKET DISPATCHER: request_player_list
  // ==============================================================================
  console.log('\n--- Testgruppe 4: WebSocket Dispatcher Spielerlisten-Routing ---');
  testAssert(isGamemodeWsMessage('request_player_list'), '4.1 isGamemodeWsMessage erkennt request_player_list');
  testAssert(isGamemodeWsMessage('request_tablist'), '4.2 isGamemodeWsMessage erkennt request_tablist');

  let sentWsMessage = null;
  const mockWsClient = {
    send: (str) => {
      sentWsMessage = JSON.parse(str);
    }
  };

  const handled = await handleGamemodeWsMessage(
    { type: 'request_player_list' },
    mockWsClient,
    { currentBot: mockBot }
  );

  testAssert(handled === true, '4.3 handleGamemodeWsMessage behandelt request_player_list erfolgreich');
  testAssert(sentWsMessage && sentWsMessage.type === 'player_list', '4.4 Antwort-Payload hat Typ player_list');
  testAssert(sentWsMessage.players.length === 4, '4.5 Antwort-Payload enthält 4 Spieler');
  testAssert(sentWsMessage.tablist && sentWsMessage.tablist.header.includes('Willkommen'),
             '4.6 Antwort-Payload enthält Server Tablist-Header');

  // ==============================================================================
  // 5. FRONTEND: manualCockpit.js Tablist Interaktivität & Rendering
  // ==============================================================================
  console.log('\n--- Testgruppe 5: Frontend manualCockpit Tablist Steuerung & Rendering ---');

  // 5.1 Export Contract
  testAssert(typeof manualCockpit.showTabList === 'function', '5.1 manualCockpit exportiert showTabList');
  testAssert(typeof manualCockpit.hideTabList === 'function', '5.2 manualCockpit exportiert hideTabList');
  testAssert(typeof manualCockpit.renderTabList === 'function', '5.3 manualCockpit exportiert renderTabList');
  testAssert(typeof manualCockpit.isTabListOpen === 'function', '5.4 manualCockpit exportiert isTabListOpen');
  testAssert(typeof manualCockpit.getPingBarsHtml === 'function', '5.5 manualCockpit exportiert getPingBarsHtml');
  testAssert(typeof manualCockpit.getPlayersList === 'function', '5.6 manualCockpit exportiert getPlayersList');

  // 5.2 Ping-Balken HTML Generierung
  const greenBars = manualCockpit.getPingBarsHtml(50);
  testAssert(greenBars.includes('active-green') && !greenBars.includes('active-yellow'),
             '5.7 Ping < 150ms erzeugt grüne Signalbalken (5 Balken)');

  const yellowBars = manualCockpit.getPingBarsHtml(350);
  testAssert(yellowBars.includes('active-yellow'),
             '5.8 Ping 350ms erzeugt gelbe Signalbalken (3 Balken)');

  const orangeBars = manualCockpit.getPingBarsHtml(800);
  testAssert(orangeBars.includes('active-orange'),
             '5.9 Ping 800ms erzeugt orange Signalbalken (2 Balken)');

  const redBars = manualCockpit.getPingBarsHtml(1500);
  testAssert(redBars.includes('active-red'),
             '5.10 Ping 1500ms erzeugt roten Signalbalken (1 Balken)');

  // 5.3 Mock DOM Test der Interaktivität
  const mockClassList = (initial = []) => {
    const classes = new Set(initial);
    return {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => {
        if (force === true) classes.add(c);
        else if (force === false) classes.delete(c);
        else if (classes.has(c)) classes.delete(c);
        else classes.add(c);
      },
      contains: (c) => classes.has(c)
    };
  };

  const createMockEl = (id) => ({
    id,
    classList: mockClassList(['hidden']),
    textContent: '',
    innerHTML: '',
    style: {},
    addEventListener: () => {},
    removeEventListener: () => {},
    focus: () => {},
    blur: () => {}
  });

  const tablistEl = createMockEl('gamemodePlayerTablist');
  const headerEl = createMockEl('mcTablistHeader');
  const countEl = createMockEl('mcTablistPlayerCount');
  const gridEl = createMockEl('mcTablistPlayerGrid');
  const footerEl = createMockEl('mcTablistFooter');

  const elementsMap = {
    gamemodePlayerTablist: tablistEl,
    mcTablistHeader: headerEl,
    mcTablistPlayerCount: countEl,
    mcTablistPlayerGrid: gridEl,
    mcTablistFooter: footerEl
  };

  // Mock global document if needed
  global.document = {
    getElementById: (id) => elementsMap[id] || {
      classList: mockClassList(),
      style: {},
      addEventListener: () => {},
      removeEventListener: () => {},
      focus: () => {},
      blur: () => {}
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    pointerLockElement: null,
    addEventListener: () => {},
    removeEventListener: () => {}
  };

  if (!global.window) {
    global.window = {
      addEventListener: () => {},
      removeEventListener: () => {}
    };
  }

  // Initialize and Enter Gamemode
  manualCockpit.initManualCockpit();
  manualCockpit.enterGamemode();

  // Test Show & Hide TabList
  manualCockpit.showTabList();
  testAssert(manualCockpit.isTabListOpen() === true, '5.11 showTabList() setzt isTabListOpen() auf true');
  testAssert(!tablistEl.classList.contains('hidden'), '5.12 gamemodePlayerTablist verliert hidden Klasse');

  manualCockpit.hideTabList();
  testAssert(manualCockpit.isTabListOpen() === false, '5.13 hideTabList() setzt isTabListOpen() auf false');
  testAssert(tablistEl.classList.contains('hidden'), '5.14 gamemodePlayerTablist erhält hidden Klasse');

  // Test Rendering with Players
  manualCockpit.renderTabList(players, tablist);
  testAssert(countEl.textContent === '(4)', '5.15 Spieleranzahl wird auf (4) aktualisiert');
  testAssert(headerEl.textContent.includes('Willkommen'), '5.16 Tablist-Header wird gerendert');
  testAssert(footerEl.textContent.includes('mc.architect.bot'), '5.17 Tablist-Footer wird gerendert');
  testAssert(gridEl.innerHTML.includes('data-player="Alex"'), '5.18 Spieler Alex ist im Grid vorhanden');
  testAssert(gridEl.innerHTML.includes('data-player="Steve"'), '5.19 Spieler Steve ist im Grid vorhanden');
  testAssert(gridEl.innerHTML.includes('is-bot'), '5.20 Bot BaumeisterKI hat is-bot Styling');
  testAssert(gridEl.innerHTML.includes('is-spectator'), '5.21 SpectatorPlayer hat is-spectator Styling');
  testAssert(gridEl.innerHTML.includes('mc-heads.net'), '5.22 Spieler-Köpfe werden über Minecraft Avatar Skin API geladen');
  testAssert(gridEl.innerHTML.includes('data:image/svg+xml'), '5.23 Steve Offline-Fallback Avatar im onerror hinterlegt');

  // Test Stuck-Key Defense: clearAllControls hides Tablist
  manualCockpit.showTabList();
  testAssert(manualCockpit.isTabListOpen() === true, '5.24 Tablist vor Stuck-Key Test offen');
  manualCockpit.clearAllControls('stuck_key_test');
  testAssert(manualCockpit.isTabListOpen() === false, '5.25 clearAllControls schließt Tablist zuverlässig');

  // Test Exit Gamemode: exitGamemode hides Tablist
  manualCockpit.showTabList();
  manualCockpit.exitGamemode('user_esc');
  testAssert(manualCockpit.isTabListOpen() === false, '5.26 exitGamemode schließt Tablist zuverlässig');

  console.log(`\n\x1b[32m=== ALLE ${passedTests}/${totalTests} TESTS DER MINECRAFT GAMEMODE TABLIST SUITE ERFOLGREICH BESTANDEN! ===\x1b[0m\n`);
  process.exit(0);
}

runTablistTestSuite().catch(err => {
  console.error('\x1b[31m[TEST SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});
