import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractMinecraftChatText, classifyKickReason } from '../src/utils/stringUtils.js';
import { SessionHandoff, HANDOFF_STATES } from '../src/bot/sessionHandoff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

console.log('=== STARTING FABRIC KICK DIAGNOSTIC & CHAT EXTRACTION TEST SUITE ===\n');

// --- Testgruppe 1: extractMinecraftChatText Parsing ---
console.log('--- Testgruppe 1: extractMinecraftChatText Parsing ---');

const userLanKickPayload = {
  type: 'compound',
  value: {
    extra: {
      type: 'list',
      value: {
        type: 'compound',
        value: [
          {
            color: { type: 'string', value: 'green' },
            text: { type: 'string', value: 'Fabric Loader and Fabric API' }
          },
          {
            '': { type: 'string', value: ' installed on your client!' }
          },
          {
            '': { type: 'string', value: '\n' }
          },
          {
            extra: {
              type: 'list',
              value: {
                type: 'compound',
                value: [
                  {
                    color: { type: 'string', value: 'yellow' },
                    text: { type: 'string', value: 'iteminteractions' }
                  },
                  {
                    '': { type: 'string', value: '\n' }
                  },
                  {
                    color: { type: 'string', value: 'yellow' },
                    text: { type: 'string', value: 'xaerominimap' }
                  },
                  {
                    '': { type: 'string', value: '\n' }
                  },
                  {
                    color: { type: 'string', value: 'yellow' },
                    text: { type: 'string', value: 'xaeroworldmap' }
                  },
                  {
                    '': { type: 'string', value: '\n' }
                  }
                ]
              }
            },
            text: {
              type: 'string',
              value: 'The following registry entry namespaces may be related:\n\n'
            }
          },
          {
            '': { type: 'string', value: '\n' }
          },
          {
            '': { type: 'string', value: '\n' }
          },
          {
            color: { type: 'string', value: 'gold' },
            text: {
              type: 'string',
              value: "Contact the server's administrator for more information!"
            }
          }
        ]
      }
    },
    text: { type: 'string', value: 'This server requires ' }
  }
};

const extractedUserKick = extractMinecraftChatText(userLanKickPayload);
assert(extractedUserKick.includes('This server requires Fabric Loader and Fabric API'), 'Intro parsed');
assert(extractedUserKick.includes('iteminteractions'), 'iteminteractions parsed');
assert(extractedUserKick.includes('xaerominimap'), 'xaerominimap parsed');
assert(extractedUserKick.includes('xaeroworldmap'), 'xaeroworldmap parsed');
pass('1.1 Exakte NBT-Compound Kick-Nachricht des Nutzers wird sauber in lesbaren Text extrahiert');

const plainStrKick = 'Kicked by operator';
assert.strictEqual(extractMinecraftChatText(plainStrKick), 'Kicked by operator');
pass('1.2 Plain-String Kicks werden unverändert durchgereicht');

const jsonChatComponent = JSON.stringify({
  text: 'Server restart: ',
  extra: [{ text: 'Please rejoin in 1 minute', color: 'red' }]
});
assert.strictEqual(extractMinecraftChatText(jsonChatComponent), 'Server restart: Please rejoin in 1 minute');
pass('1.3 JSON Chat-Komponenten mit extra-Array werden fehlerfrei rekursiv zusammengefügt');

const translateComponent = { translate: 'multiplayer.disconnect.duplicate_login' };
assert.strictEqual(extractMinecraftChatText(translateComponent), 'multiplayer.disconnect.duplicate_login');
pass('1.4 Translate-Komponenten werden aufgelöst');

assert.strictEqual(extractMinecraftChatText(null), '');
assert.strictEqual(extractMinecraftChatText(undefined), '');
assert.strictEqual(extractMinecraftChatText(123), '123');
pass('1.5 Null-, Undefined- und Primitiv-Edge-Cases werden defensiv behandelt');


// --- Testgruppe 2: classifyKickReason Klassifizierung ---
console.log('\n--- Testgruppe 2: classifyKickReason Klassifizierung ---');

const userClassification = classifyKickReason(userLanKickPayload);
assert.strictEqual(userClassification.isFabricMismatch, true, 'isFabricMismatch muss true sein');
assert.strictEqual(userClassification.category, 'FABRIC_MOD_MISMATCH', 'Kategorie muss FABRIC_MOD_MISMATCH sein');
assert(Array.isArray(userClassification.relatedNamespaces), 'relatedNamespaces ist Array');
assert.strictEqual(userClassification.relatedNamespaces.length, 3, 'Exakt 3 Mod-Namespaces erkannt');
assert(userClassification.relatedNamespaces.includes('iteminteractions'), 'iteminteractions erkannt');
assert(userClassification.relatedNamespaces.includes('xaerominimap'), 'xaerominimap erkannt');
assert(userClassification.relatedNamespaces.includes('xaeroworldmap'), 'xaeroworldmap erkannt');
assert(userClassification.recommendation.includes('Bypass Fabric Check'), 'Empfehlung für Bypass Fabric Check vorhanden');
assert(userClassification.modrinthUrl.includes('modrinth.com/mod/bypass-fabric-check'), 'Modrinth-URL hinterlegt');
pass('2.1 Nutzer-Fehlerfall wird als Fabric-Mod Mismatch mit den 3 betroffenen Mods identifiziert');

const fabricRegistrySyncKick = 'Connection closed: fabric-registry-sync-v0 encountered unknown mod namespaces: custommod';
const fabricSyncClassification = classifyKickReason(fabricRegistrySyncKick);
assert.strictEqual(fabricSyncClassification.isFabricMismatch, true);
pass('2.2 Generische fabric-registry-sync Kick-Meldungen werden ebenfalls zuverlässig erkannt');

const duplicateKick = { translate: 'multiplayer.disconnect.duplicate_login' };
const dupClassification = classifyKickReason(duplicateKick);
assert.strictEqual(dupClassification.isFabricMismatch, false);
assert.strictEqual(dupClassification.isDuplicateLogin, true);
assert.strictEqual(dupClassification.category, 'DUPLICATE_LOGIN');
pass('2.3 Duplicate Login Kicks werden korrekt von Fabric-Mismatches unterschieden');

const outdatedKick = 'Outdated server! I am still on 1.20.4';
const outClassification = classifyKickReason(outdatedKick);
assert.strictEqual(outClassification.isOutdated, true);
assert.strictEqual(outClassification.category, 'VERSION_MISMATCH');
pass('2.4 Versions-Konflikte werden als VERSION_MISMATCH klassifiziert');


// --- Testgruppe 3: SessionHandoff Integration ---
console.log('\n--- Testgruppe 3: SessionHandoff Integration ---');

const handoff = new SessionHandoff();
const isDupFromNbt = handoff.isDuplicateLoginReason({
  type: 'compound',
  value: {
    translate: { type: 'string', value: 'multiplayer.disconnect.duplicate_login' }
  }
});
assert.strictEqual(isDupFromNbt, true, 'Duplicate login in NBT-Struktur wird erkannt');
pass('3.1 SessionHandoff erkennt Duplicate Login auch in komplexen NBT-Compound-Objekten');

const isDupFromFabric = handoff.isDuplicateLoginReason(userLanKickPayload);
assert.strictEqual(isDupFromFabric, false, 'Fabric-Mismatch ist kein Duplicate Login');
pass('3.2 Fabric-Mismatch Kick wird von SessionHandoff NICHT fälschlicherweise als Duplicate-Login eingestuft');


// --- Testgruppe 4: DOM-Integrität in HTML & CSS ---
console.log('\n--- Testgruppe 4: DOM-Integrität in HTML & CSS ---');

const htmlContent = fs.readFileSync(path.join(__dirname, '../src/web/public/index.html'), 'utf8');
assert(htmlContent.includes('id="botKickDiagnosticBanner"'), 'index.html enthält #botKickDiagnosticBanner');
assert(htmlContent.includes('id="fabricDiagTitle"'), 'index.html enthält #fabricDiagTitle');
assert(htmlContent.includes('id="fabricDiagMessage"'), 'index.html enthält #fabricDiagMessage');
assert(htmlContent.includes('id="fabricDiagNamespaces"'), 'index.html enthält #fabricDiagNamespaces');
assert(htmlContent.includes('id="fabricDiagModrinthLink"'), 'index.html enthält #fabricDiagModrinthLink');
assert(htmlContent.includes('id="btnDismissFabricDiag"'), 'index.html enthält #btnDismissFabricDiag');
assert(htmlContent.includes('id="btnRetryFabricConnect"'), 'index.html enthält #btnRetryFabricConnect');
pass('4.1 index.html enthält alle erforderlichen Diagnose-Banner DOM-Elemente');

const cssContent = fs.readFileSync(path.join(__dirname, '../src/web/public/style.css'), 'utf8');
assert(cssContent.includes('.fabric-diagnostic-banner'), 'style.css enthält .fabric-diagnostic-banner');
assert(cssContent.includes('.fabric-diag-chip'), 'style.css enthält .fabric-diag-chip');
assert(cssContent.includes('.bot-power-badge.fabric-mismatch'), 'style.css enthält .bot-power-badge.fabric-mismatch');
assert(cssContent.includes('.handoff-badge.state-fabric-mismatch'), 'style.css enthält .handoff-badge.state-fabric-mismatch');
pass('4.2 style.css definiert High-Contrast Styling und Badges für Fabric Mod-Mismatch');


// --- Testgruppe 5: app.js WebSocket Handler & UI-Rendering ---
console.log('\n--- Testgruppe 5: app.js WebSocket Handler & UI-Rendering ---');

const appJsContent = fs.readFileSync(path.join(__dirname, '../src/web/public/app.js'), 'utf8');
assert(appJsContent.includes("case 'bot_kick_diagnostic':"), 'app.js verarbeitet bot_kick_diagnostic');
assert(appJsContent.includes('renderKickDiagnostic'), 'app.js exportiert/implementiert renderKickDiagnostic');
assert(appJsContent.includes('FABRIC_MISMATCH'), 'app.js behandelt State FABRIC_MISMATCH in updateHandoffUI und updateBotPowerUI');
assert(appJsContent.includes('btnDismissFabricDiag'), 'app.js bindet btnDismissFabricDiag ein');
assert(appJsContent.includes('btnRetryFabricConnect'), 'app.js bindet btnRetryFabricConnect ein');
pass('5.1 app.js unterstützt bot_kick_diagnostic WebSocket-Events und dynamisches Rendern der Lösung');


// --- Testgruppe 6: BotClient Kick Event Simulation & State Preservation ---
console.log('\n--- Testgruppe 6: BotClient Kick Event Simulation & State Preservation ---');

import { BotClient } from '../src/bot/botClient.js';
import { dashboardServer } from '../src/web/dashboardServer.js';
import { EventEmitter } from 'node:events';
import { detectMinecraftInstances, findBestMatchingInstance } from '../src/utils/minecraftInstanceDetector.js';

const testBotClient = new BotClient();
let broadcastedEvent = null;
let broadcastedState = null;

const origBroadcast = dashboardServer.broadcast;
dashboardServer.broadcast = (evt) => {
  if (evt.type === 'bot_kick_diagnostic') {
    broadcastedEvent = evt;
  } else if (evt.type === 'bot_state_change') {
    broadcastedState = evt;
  }
};

// Create mock bot emitting kicked
const mockBot = new EventEmitter();
mockBot.entity = { position: { floored: () => '(0,0,0)' } };
mockBot.username = 'BaumeisterKI';
mockBot.quit = () => {};
testBotClient.bot = mockBot;
testBotClient.shouldRun = true;

// Attach event handlers
testBotClient.setupEventHandlers();

// Simulate the kick from the user's log
mockBot.emit('kicked', userLanKickPayload);

assert(broadcastedEvent !== null, 'bot_kick_diagnostic muss gebroadcastet werden');
assert.strictEqual(broadcastedEvent.classification.isFabricMismatch, true, 'Klassifizierung muss Fabric Mismatch sein');
assert(broadcastedEvent.classification.relatedNamespaces.includes('iteminteractions'));
assert(broadcastedEvent.classification.relatedNamespaces.includes('xaerominimap'));
assert(broadcastedEvent.classification.relatedNamespaces.includes('xaeroworldmap'));
assert.strictEqual(testBotClient.isReconnecting, true, 'Reconnect muss gestartet sein');
assert.strictEqual(testBotClient.state, 'FABRIC_MISMATCH', 'BotClient State muss FABRIC_MISMATCH sein');
assert(testBotClient.lastKickClassification !== null, 'lastKickClassification muss gespeichert sein');
pass('6.1 BotClient verarbeitet den echten Nutzer-Kick fehlerfrei, broadcastet Diagnose & setzt State auf FABRIC_MISMATCH');

// WICHTIG: Socket-Ende (end-Event) nach Kick darf State nicht überschreiben!
mockBot.emit('end', 'socketClosed');
assert.strictEqual(testBotClient.state, 'FABRIC_MISMATCH', 'bot.on(end) darf FABRIC_MISMATCH nicht mit RECONNECTING überschreiben');
assert.notStrictEqual(broadcastedState?.state, 'RECONNECTING', 'broadcastState darf nach Fabric-Mismatch nicht RECONNECTING senden');
pass('6.2 bot.on(end) nach Kick belässt den State stabil auf FABRIC_MISMATCH');

// Reconnect/Start setzt den Fehlerzustand sauber zurück
testBotClient.initBot = () => {};
testBotClient.start();
assert.strictEqual(testBotClient.lastKickClassification, null, 'start() leert lastKickClassification');
pass('6.3 Neuer Start/Reconnect leert die Diagnose-Klassifizierung');

// Cleanup
testBotClient.cancelReconnect();
testBotClient.stop();
dashboardServer.broadcast = origBroadcast;


// --- Testgruppe 7: Minecraft Instance Detector & Auto-Fix ---
console.log('\n--- Testgruppe 7: Minecraft Instance Detector & Auto-Fix ---');

const detected = detectMinecraftInstances();
assert(Array.isArray(detected), 'detectMinecraftInstances liefert Array');
assert(detected.length >= 1, 'Mindestens eine lokale Minecraft-Installation erkannt');
pass('7.1 Lokale Minecraft-Instanzen (CurseForge, .minecraft, Prism) werden automatisch gefunden');

const bestInstance = findBestMatchingInstance('26.3');
assert(bestInstance !== null, 'findBestMatchingInstance findet passende Instanz');
assert(typeof bestInstance.modsDir === 'string', 'modsDir ist String-Pfad');
assert(typeof bestInstance.hasBypassMod === 'boolean', 'hasBypassMod ist Boolean');
pass(`7.2 Passende Instanz erkannt: ${bestInstance.name} (modsDir: ${bestInstance.modsDir})`);

console.log('\n=== ALLE TESTS DER FABRIC KICK DIAGNOSTIC SUITE ERFOLGREICH BESTANDEN! ===');
