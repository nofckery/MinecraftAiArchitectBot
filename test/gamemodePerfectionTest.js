import assert from 'node:assert';
import { manualController } from '../src/bot/manualController.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';
import * as manualCockpit from '../src/web/public/js/manualCockpit.js';

console.log('=== STARTING GAMEMODE PERFECTION & FEATURE VERIFICATION TEST SUITE ===\n');

function createMockBot() {
  const listeners = {};
  return {
    version: '1.20.4',
    entity: {
      position: { x: 10, y: 64, z: 20 },
      yaw: 0.5,
      pitch: -0.2
    },
    quickBarSlot: 0,
    inventory: {
      slots: {
        5: { name: 'diamond_helmet', displayName: 'Diamond Helmet', count: 1, type: 310, maxDurability: 363, durabilityUsed: 12 },
        6: { name: 'iron_chestplate', displayName: 'Iron Chestplate', count: 1, type: 307, maxDurability: 240, durabilityUsed: 0 },
        7: null,
        8: { name: 'leather_boots', displayName: 'Leather Boots', count: 1, type: 301, maxDurability: 65, durabilityUsed: 20 },
        36: { name: 'diamond_sword', displayName: 'Diamond Sword', count: 1, type: 276, maxDurability: 1561, durabilityUsed: 5 },
        37: { name: 'cooked_beef', displayName: 'Cooked Beef', count: 16, type: 364 },
        45: { name: 'shield', displayName: 'Shield', count: 1, type: 442, maxDurability: 336, durabilityUsed: 10 }
      },
      selectedItem: null,
      on(evt, fn) {
        listeners[evt] = fn;
      }
    },
    currentWindow: null,
    lookCalls: [],
    chatCalls: [],
    windowClicks: [],
    deactivatedItemCount: 0,
    activatedItemCount: 0,
    respawnCount: 0,
    look(yaw, pitch, force) {
      this.lookCalls.push({ yaw, pitch, force });
      this.entity.yaw = yaw;
      this.entity.pitch = pitch;
    },
    chat(msg) {
      this.chatCalls.push(msg);
    },
    clickWindow(slot, button, mode) {
      this.windowClicks.push({ slot, button, mode });
      return Promise.resolve();
    },
    closeWindow(win) {
      this.currentWindow = null;
    },
    activateItem(offhand) {
      this.activatedItemCount++;
    },
    deactivateItem() {
      this.deactivatedItemCount++;
    },
    respawn() {
      this.respawnCount++;
    },
    controlStates: {},
    setControlState(name, state) {
      this.controlStates[name] = state;
    },
    clearControlStates() {
      this.controlStates = {};
    }
  };
}

async function runTests() {
  const bot = createMockBot();
  const mockWs = {
    sent: [],
    send(data) {
      this.sent.push(JSON.parse(data));
    }
  };

  const context = {
    currentBot: bot,
    operatorSocket: null,
    broadcast(msg) {
      mockWs.sent.push(msg);
    },
    recordChat(sender, msg) {
      this.lastChatRecord = { sender, msg };
    },
    sendTelemetry() {
      this.telemetrySent = true;
    }
  };

  // -------------------------------------------------------------
  // Testgruppe 1: Blickwinkelsteuerung & Vermeidung von Kreisdrehung
  // -------------------------------------------------------------
  console.log('--- Testgruppe 1: Blickwinkelsteuerung & Unwrapping ---');
  manualController.activate(bot);

  // 1.1 Absolutes manual_look addiert NICHT erneut auf curYaw
  bot.entity.yaw = 1.0;
  bot.entity.pitch = 0.2;
  await handleClientWsMessage({
    type: 'manual_look',
    yaw: 1.05,
    pitch: 0.25,
    delta: { dx: 10, dy: 5 } // Enthält delta-Objekt vom Client
  }, mockWs, context);

  assert.strictEqual(bot.lookCalls.length > 0, true, '1.1 bot.look wurde aufgerufen');
  const lastLook = bot.lookCalls[bot.lookCalls.length - 1];
  assert(Math.abs(lastLook.yaw - 1.05) < 0.001, `1.1 Yaw ist absolut 1.05 (keine Selbst-Addition zu 2.05), erhalten: ${lastLook.yaw}`);
  assert(Math.abs(lastLook.pitch - 0.25) < 0.001, `1.1 Pitch ist absolut 0.25, erhalten: ${lastLook.pitch}`);
  console.log('[PASS] 1.1 Absolutes manual_look addiert keine Deltas und verhindert Kreisdrehung');

  // 1.2 Pitch-Clamping nach oben und unten
  await handleClientWsMessage({ type: 'manual_look', yaw: 0, pitch: 50 }, mockWs, context);
  const pitchUp = bot.lookCalls[bot.lookCalls.length - 1];
  assert(pitchUp.pitch <= Math.PI / 2 && pitchUp.pitch >= 1.56, '1.2 Pitch nach oben geklampt');

  await handleClientWsMessage({ type: 'manual_look', yaw: 0, pitch: -50 }, mockWs, context);
  const pitchDown = bot.lookCalls[bot.lookCalls.length - 1];
  assert(pitchDown.pitch >= -Math.PI / 2 && pitchDown.pitch <= -1.56, '1.2 Pitch nach unten geklampt');
  console.log('[PASS] 1.2 Pitch sicher zwischen -89.9° und +89.9° geklampt');

  // -------------------------------------------------------------
  // Testgruppe 2: Ingame Server-Chat (send_chat / chat_message)
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 2: Ingame Server-Chat ---');
  await handleClientWsMessage({
    type: 'send_chat',
    message: 'Hallo Welt von Gamemode!'
  }, mockWs, context);

  assert.strictEqual(bot.chatCalls.length, 1, '2.1 bot.chat wurde genau 1x aufgerufen');
  assert.strictEqual(bot.chatCalls[0], 'Hallo Welt von Gamemode!', '2.1 Chat-Nachricht exakt weitergeleitet');

  // 2.2 Server-Befehl mit Slash
  await handleClientWsMessage({
    type: 'send_chat',
    text: '/time set day'
  }, mockWs, context);

  assert.strictEqual(bot.chatCalls.length, 2, '2.2 Zweiter Befehl abgesetzt');
  assert.strictEqual(bot.chatCalls[1], '/time set day', '2.2 /Befehl an Server weitergeleitet');
  console.log('[PASS] 2.1 & 2.2 Ingame Server-Chat & Slash-Befehle funktionieren fehlerfrei');

  // -------------------------------------------------------------
  // Testgruppe 3: Full Inventory State & Slot-Interaktion
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 3: Full Inventory State & Window Clicks ---');
  const fullInv = manualController.getFullInventory();
  assert(fullInv !== null, '3.1 getFullInventory() liefert gültiges Objekt');
  assert.strictEqual(fullInv.armor.head.name, 'diamond_helmet', '3.1 Helm erkannt');
  assert.strictEqual(fullInv.armor.torso.name, 'iron_chestplate', '3.1 Brustpanzer erkannt');
  assert.strictEqual(fullInv.offhand.name, 'shield', '3.1 Schild in Nebenhand erkannt');
  assert.strictEqual(fullInv.hotbar[0].name, 'diamond_sword', '3.1 Hotbar Slot 0 ist Diamond Sword');
  assert.strictEqual(fullInv.hotbar[1].count, 16, '3.1 Hotbar Slot 1 hat 16 Cooked Beef');

  // 3.2 Inventory Click via WebSocket
  await handleClientWsMessage({
    type: 'inventory_click',
    slot: 36,
    button: 0,
    mode: 0
  }, mockWs, context);

  assert.strictEqual(bot.windowClicks.length, 1, '3.2 clickWindow aufgerufen');
  assert.deepStrictEqual(bot.windowClicks[0], { slot: 36, button: 0, mode: 0 }, '3.2 clickWindow Parameter stimmen');
  assert.strictEqual(context.telemetrySent, true, '3.2 Sofortige Telemetrie gesendet');

  // 3.3 Shift-Click
  await handleClientWsMessage({
    type: 'inventory_click',
    slot: 37,
    button: 0,
    mode: 1
  }, mockWs, context);
  assert.deepStrictEqual(bot.windowClicks[1], { slot: 37, button: 0, mode: 1 }, '3.3 Shift-Click Parameter stimmen');

  // 3.4 Container-Schließen
  bot.currentWindow = { id: 1, type: 'minecraft:chest', title: 'Truhe' };
  await handleClientWsMessage({ type: 'close_window' }, mockWs, context);
  assert.strictEqual(bot.currentWindow, null, '3.4 Container-Fenster sauber geschlossen');
  console.log('[PASS] 3.1 - 3.4 Full Inventory & Window-Clicking 100% verifiziert');

  // -------------------------------------------------------------
  // Testgruppe 4: Item-Nutzung (Essen / Bogen / Schild) & Hand-Tausch
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 4: Item-Nutzung & Hand-Tausch ---');
  await handleClientWsMessage({
    type: 'manual_action',
    action: 'use_item_start'
  }, mockWs, context);
  assert.strictEqual(bot.activatedItemCount, 1, '4.1 use_item_start aktiviert Item');

  await handleClientWsMessage({
    type: 'manual_action',
    action: 'use_item_stop'
  }, mockWs, context);
  assert.strictEqual(bot.deactivatedItemCount, 1, '4.2 use_item_stop deaktiviert Item');

  // 4.3 Respawn
  await handleClientWsMessage({ type: 'respawn' }, mockWs, context);
  assert.strictEqual(bot.respawnCount, 1, '4.3 Respawn erfolgreich ausgelöst');
  console.log('[PASS] 4.1 - 4.3 Item-Nutzung & Respawn erfolgreich');

  // -------------------------------------------------------------
  // Testgruppe 5: Item-Icon Rendering Map
  // -------------------------------------------------------------
  console.log('\n--- Testgruppe 5: Item-Icon Rendering Map ---');
  assert.strictEqual(manualCockpit.getItemIcon('diamond_sword'), '⚔️', '5.1 Schwert Icon');
  assert.strictEqual(manualCockpit.getItemIcon('bow'), '🏹', '5.2 Bogen Icon');
  assert.strictEqual(manualCockpit.getItemIcon('shield'), '🛡️', '5.3 Schild Icon');
  assert.strictEqual(manualCockpit.getItemIcon('golden_apple'), '🍏', '5.4 Goldapfel Icon');
  assert.strictEqual(manualCockpit.getItemIcon('diamond'), '💎', '5.5 Diamant Icon');
  assert.strictEqual(manualCockpit.getItemIcon('cooked_beef'), '🍖', '5.6 Fleisch Icon');
  assert.strictEqual(manualCockpit.getItemIcon('chest'), '📦', '5.7 Kisten Icon');
  assert.strictEqual(manualCockpit.getItemIcon('oak_planks'), '🪵', '5.8 Holz Icon');
  console.log('[PASS] 5.1 - 5.8 Item-Icons vollständig und akkurat abgebildet');

  manualController.deactivate();
  console.log('\n================================================================');
  console.log('  ERGEBNIS: ALLE GAMEMODE PERFECTION TESTS ERFOLGREICH BESTANDEN!');
  console.log('================================================================');
}

runTests().catch(err => {
  console.error('\n[FEHLER]', err);
  process.exit(1);
});
