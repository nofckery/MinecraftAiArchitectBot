import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { getActiveBotActivity } from '../src/web/services/dashboardTelemetryService.js';

console.log('=== STARTING BOT CONTROL UX/UI OPTIMUM TEST SUITE ===\n');

let passedTests = 0;
function pass(msg) {
  passedTests++;
  console.log(`[PASS] ${msg}`);
}

// =========================================================================
// 1. STATISCHE HTML-STRUKTUR (index.html & gamemode.html)
// =========================================================================
console.log('--- Testgruppe 1: Statische HTML-Struktur & DOM-IDs ---');

const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf-8');
const gamemodeHtml = fs.readFileSync(path.resolve('src/web/public/gamemode.html'), 'utf-8');

// 1.1 Bot Command Deck
assert(indexHtml.includes('id="botCommandDeck"'), 'index.html enthält #botCommandDeck');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-guard"'), 'Enthält Wachdienst-Button');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-expedition"'), 'Enthält Expeditions-Button');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-home"'), 'Enthält Basis-Buttons');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-harvest"'), 'Enthält Farming-Buttons');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-logistics"'), 'Enthält Logistik-Buttons');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-follow"'), 'Enthält "Komm zu mir"-Button');
assert(indexHtml.includes('class="btn-bot-command btn-cmd-stop"'), 'Enthält Not-Stopp-Button');
pass('1.1 Bot Command Deck mit allen 1-Klick Missionen vollständig in index.html deklariert');

// 1.2 Live Bot-Aktivitätsanzeige in der Telemetrie-Karte
assert(indexHtml.includes('id="lblBotActivityBadge"'), 'index.html enthält #lblBotActivityBadge');
assert(indexHtml.includes('id="lblBotActivityDetails"'), 'index.html enthält #lblBotActivityDetails');
assert(indexHtml.includes('class="tel-item tel-item-activity"'), 'index.html enthält .tel-item-activity');
pass('1.2 Live Bot-Aktivitätsanzeige in der Telemetriekarte vorhanden');

// 1.3 Gamemode Help-Overlay & Steuerungs-Cheat-Sheet
assert(indexHtml.includes('id="btnGamemodeHelp"'), 'index.html enthält #btnGamemodeHelp');
assert(indexHtml.includes('id="gamemodeHelpOverlay"'), 'index.html enthält #gamemodeHelpOverlay');
assert(indexHtml.includes('id="btnOpenHelpFromPause"'), 'index.html Pause-Menü enthält #btnOpenHelpFromPause');
assert(gamemodeHtml.includes('id="btnGamemodeHelp"'), 'gamemode.html enthält #btnGamemodeHelp');
assert(gamemodeHtml.includes('id="gamemodeHelpOverlay"'), 'gamemode.html enthält #gamemodeHelpOverlay');
assert(gamemodeHtml.includes('id="btnOpenHelpFromPause"'), 'gamemode.html Pause-Menü enthält #btnOpenHelpFromPause');
pass('1.3 First-Person Steuerungshilfe (Overlay & Tasten) in index.html und gamemode.html synchron');

// 1.4 2D-Karten Ziel-Modus & Toast-Container
assert(indexHtml.includes('id="btnToggleMapMoveMode"'), 'index.html enthält #btnToggleMapMoveMode');
assert(indexHtml.includes('id="dashboardToastContainer"'), 'index.html enthält #dashboardToastContainer');
pass('1.4 2D-Karten Ziel-Klick Button und Toast-Container vorhanden');

// =========================================================================
// 2. STATISCHE CSS-VALIDIERUNG (style.css)
// =========================================================================
console.log('\n--- Testgruppe 2: Statische CSS-Validierung (style.css) ---');

const cssContent = fs.readFileSync(path.resolve('src/web/public/style.css'), 'utf-8');

assert(cssContent.includes('.bot-command-deck'), 'style.css definiert .bot-command-deck');
assert(cssContent.includes('.btn-bot-command'), 'style.css definiert .btn-bot-command');
assert(cssContent.includes('.activity-badge'), 'style.css definiert .activity-badge');
assert(cssContent.includes('.activity-badge.guard'), 'style.css definiert .activity-badge.guard');
assert(cssContent.includes('.activity-badge.harvest'), 'style.css definiert .activity-badge.harvest');
assert(cssContent.includes('.gamemode-help-overlay'), 'style.css definiert .gamemode-help-overlay');
assert(cssContent.includes('.btn-gamemode-help'), 'style.css definiert .btn-gamemode-help');
assert(cssContent.includes('.dashboard-toast-container'), 'style.css definiert .dashboard-toast-container');
assert(cssContent.includes('.dashboard-toast'), 'style.css definiert .dashboard-toast');
assert(cssContent.includes('.btn-map-nav-mode'), 'style.css definiert .btn-map-nav-mode');
pass('2.1 Alle neuen UI/UX-Klassen in style.css deklariert');

// =========================================================================
// 3. BACKEND-TELEMETRIE LOGIK & AKTIVITÄTS-KLASSIFIZIERUNG
// =========================================================================
console.log('\n--- Testgruppe 3: Backend-Aktivitäts-Klassifizierung ---');

// 3.1 IDLE Zustand
const idleAct = getActiveBotActivity({
  controller: { isActive: () => false },
  guardMgr: { getStatus: () => ({ active: false }) },
  harvestMgr: { isHarvesting: false },
  expeditionMgr: { state: 'IDLE' },
  executor: { isBuilding: false }
});
assert.strictEqual(idleAct.code, 'IDLE', 'Idle liefert Code IDLE');
assert(idleAct.badgeClass === 'idle', 'Idle BadgeClass ist idle');
pass('3.1 IDLE Zustand korrekt klassifiziert');

// 3.2 MANUAL Gamemode
const manualAct = getActiveBotActivity({
  controller: { isActive: () => true },
  guardMgr: { getStatus: () => ({ active: false }) },
  harvestMgr: { isHarvesting: false },
  expeditionMgr: { state: 'IDLE' },
  executor: { isBuilding: false }
});
assert.strictEqual(manualAct.code, 'MANUAL', 'Manueller Gamemode liefert Code MANUAL');
assert(manualAct.badgeClass === 'manual', 'Manual BadgeClass ist manual');
pass('3.2 Manueller Gamemode hat Vorrang und liefert Code MANUAL');

// 3.3 GUARDING Zustand
const guardAct = getActiveBotActivity({
  controller: { isActive: () => false },
  guardMgr: { getStatus: () => ({ active: true, kills: 3, radius: 25 }) },
  harvestMgr: { isHarvesting: false },
  expeditionMgr: { state: 'IDLE' },
  executor: { isBuilding: false }
});
assert.strictEqual(guardAct.code, 'GUARDING', 'Wachdienst liefert Code GUARDING');
assert(guardAct.badgeClass === 'guard', 'Guard BadgeClass ist guard');
assert(guardAct.details.includes('3 Feinde'), 'Guard Details nennen 3 Feinde');
pass('3.3 Wachdienst wird mit Schutzradius und Kills erfasst');

// 3.4 HARVESTING Zustand
const harvestAct = getActiveBotActivity({
  controller: { isActive: () => false },
  guardMgr: { getStatus: () => ({ active: false }) },
  harvestMgr: { isHarvesting: true },
  expeditionMgr: { state: 'IDLE' },
  executor: { isBuilding: false }
});
assert.strictEqual(harvestAct.code, 'HARVESTING', 'Harvesting liefert Code HARVESTING');
assert(harvestAct.badgeClass === 'harvest', 'Harvest BadgeClass ist harvest');
pass('3.4 Rohstoffabbau wird als HARVESTING erfasst');

// 3.5 EXPEDITION Zustand
const expedAct = getActiveBotActivity({
  controller: { isActive: () => false },
  guardMgr: { getStatus: () => ({ active: false }) },
  harvestMgr: { isHarvesting: false },
  expeditionMgr: { state: 'MINING_VEIN' },
  executor: { isBuilding: false }
});
assert.strictEqual(expedAct.code, 'EXPEDITION', 'Höhlenexpedition liefert Code EXPEDITION');
assert(expedAct.badgeClass === 'expedition', 'Expedition BadgeClass ist expedition');
pass('3.5 Höhlen-Expedition wird als EXPEDITION erfasst');

// 3.6 BUILDING Zustand
const buildAct = getActiveBotActivity({
  controller: { isActive: () => false },
  guardMgr: { getStatus: () => ({ active: false }) },
  harvestMgr: { isHarvesting: false },
  expeditionMgr: { state: 'IDLE' },
  executor: { isBuilding: true, getProgress: () => ({ phase: 'Phase 2: Dachstuhl', title: 'Taverne' }) }
});
assert.strictEqual(buildAct.code, 'BUILDING', 'Bauphase liefert Code BUILDING');
assert(buildAct.label.includes('Dachstuhl'), 'Label nennt Bauphase');
pass('3.6 Bauphase wird mit Titel und Phase erfasst');

console.log(`\n=== ALLE ${passedTests} TESTS DER BOT CONTROL UX/UI OPTIMUM SUITE ERFOLGREICH BESTANDEN! ===`);
