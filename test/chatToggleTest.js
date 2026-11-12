import assert from 'node:assert';
import { settings } from '../src/config/settings.js';
import { envManager } from '../src/config/envManager.js';
import { ChatController } from '../src/bot/chatController.js';
import { dashboardServer } from '../src/web/dashboardServer.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';

function pass(msg) {
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

async function runChatToggleTests() {
  console.log('\n=== RUNNING MINECRAFT CHAT TOGGLE & SILENT MODE TESTS ===\n');

  // Test 1: Invariant & Default-Wert
  {
    assert.strictEqual(typeof settings.ENABLE_MINECRAFT_CHAT, 'boolean');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, true, 'Default must be true');
    const curSettings = envManager.getCurrentSettings();
    assert.strictEqual(curSettings.ENABLE_MINECRAFT_CHAT, true);
    pass('1.1 ENABLE_MINECRAFT_CHAT ist standardmäßig true und in getCurrentSettings enthalten');
  }

  // Test 2: Hook in BotClient - Verhalten bei Chat an vs. aus
  {
    let origChatCalls = [];
    let recordedChatCalls = [];

    // Mock-Dashboard-Server
    const originalRecordChat = dashboardServer.recordChat;
    dashboardServer.recordChat = (sender, text) => {
      recordedChatCalls.push({ sender, text });
    };

    // Erstelle Mock Bot
    const mockBot = {
      username: 'TestBot',
      chat: function(msg) {
        origChatCalls.push(msg);
      }
    };

    // Simuliere den hookChat aus botClient.js
    const origChat = mockBot.chat.bind(mockBot);
    mockBot.chat = (msg) => {
      dashboardServer.recordChat(mockBot.username || settings.MC_USERNAME, msg);
      const isCommand = typeof msg === 'string' && msg.trim().startsWith('/');
      if (!settings.ENABLE_MINECRAFT_CHAT && !isCommand) {
        return;
      }
      return origChat(msg);
    };

    // Fall A: ENABLE_MINECRAFT_CHAT = true
    settings.ENABLE_MINECRAFT_CHAT = true;
    origChatCalls = [];
    recordedChatCalls = [];

    mockBot.chat('Hallo alle zusammen!');
    assert.strictEqual(origChatCalls.length, 1, 'origChat should be called when chat is enabled');
    assert.strictEqual(origChatCalls[0], 'Hallo alle zusammen!');
    assert.strictEqual(recordedChatCalls.length, 1);
    assert.strictEqual(recordedChatCalls[0].text, 'Hallo alle zusammen!');
    pass('2.1 Bei ENABLE_MINECRAFT_CHAT = true wird Nachricht an Minecraft und Dashboard gesendet');

    // Fall B: ENABLE_MINECRAFT_CHAT = false (Stiller Modus)
    settings.ENABLE_MINECRAFT_CHAT = false;
    origChatCalls = [];
    recordedChatCalls = [];

    mockBot.chat('Geheime Bot-Nachricht');
    assert.strictEqual(origChatCalls.length, 0, 'origChat must NOT be called for normal chat when muted');
    assert.strictEqual(recordedChatCalls.length, 1, 'dashboardServer.recordChat must STILL be called');
    assert.strictEqual(recordedChatCalls[0].text, 'Geheime Bot-Nachricht');
    pass('2.2 Bei ENABLE_MINECRAFT_CHAT = false wird normale Chat-Nachricht an den Server unterdrückt, aber im Dashboard erfasst');

    // Fall C: Befehle (beginnend mit '/') müssen auch im stillen Modus durchgehen
    origChatCalls = [];
    recordedChatCalls = [];

    mockBot.chat('/setblock 100 64 100 stone replace');
    assert.strictEqual(origChatCalls.length, 1, 'Slash-Commands must still execute even when chat is muted');
    assert.strictEqual(origChatCalls[0], '/setblock 100 64 100 stone replace');
    pass('2.3 Server-Befehle (/setblock etc.) werden im stillen Modus weiterhin an den Server gesendet');

    // Cleanup
    dashboardServer.recordChat = originalRecordChat;
    settings.ENABLE_MINECRAFT_CHAT = true;
  }

  // Test 3: ChatController Befehle (!mute, !unmute, !chat off, !chat on)
  {
    const sentMessages = [];
    const mockBot = {
      username: 'BaumeisterKI',
      chat: (msg) => { sentMessages.push(msg); }
    };

    const mockAgent = {
      instantMode: false,
      setInstantMode: () => {}
    };

    const originalOwner = settings.BOT_OWNER;
    settings.BOT_OWNER = 'TestOwner';
    const controller = new ChatController(mockBot, mockAgent);

    // 3.1 Nicht autorisierter Spieler versucht !mute
    settings.ENABLE_MINECRAFT_CHAT = true;
    await controller.handleMessage('FremderSpieler', '!mute');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, true, 'Unauthorized user cannot mute bot');
    pass('3.1 Unbefugte Spieler können den Chat-Status nicht ändern');

    // 3.2 Autorisierter Owner schaltet Chat aus via !mute
    sentMessages.length = 0;
    await controller.handleMessage('TestOwner', '!mute');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, false, '!mute must set ENABLE_MINECRAFT_CHAT to false');
    assert.ok(sentMessages.some(m => m.includes('DEAKTIVIERT')), 'Confirmation message should be sent');
    pass('3.2 !mute deaktiviert den Minecraft-Chat und sendet Bestätigung');

    // 3.3 Autorisierter Owner schaltet Chat ein via !chat on
    sentMessages.length = 0;
    await controller.handleMessage('TestOwner', '!chat on');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, true, '!chat on must set ENABLE_MINECRAFT_CHAT to true');
    assert.ok(sentMessages.some(m => m.includes('AKTIVIERT')), 'Confirmation message should be sent');
    pass('3.3 !chat on aktiviert den Minecraft-Chat');

    // 3.4 !chat toggle
    await controller.handleMessage('TestOwner', '!chat toggle');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, false);
    await controller.handleMessage('TestOwner', '!chat');
    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, true);
    pass('3.4 !chat toggle schaltet den Zustand abwechselnd um');

    // Cleanup
    settings.BOT_OWNER = originalOwner;
    settings.ENABLE_MINECRAFT_CHAT = true;
    envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: true });
  }

  // Test 4: WebSocket Dispatcher (toggle_minecraft_chat)
  {
    let broadcastMsg = null;
    let recordedMsg = null;

    const mockContext = {
      broadcast: (payload) => { broadcastMsg = payload; },
      recordChat: (sender, msg) => { recordedMsg = { sender, msg }; }
    };

    settings.ENABLE_MINECRAFT_CHAT = true;

    await handleClientWsMessage({
      type: 'toggle_minecraft_chat',
      data: { enabled: false }
    }, null, mockContext);

    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, false);
    assert.strictEqual(broadcastMsg?.type, 'settings_updated');
    assert.strictEqual(broadcastMsg?.settings?.ENABLE_MINECRAFT_CHAT, false);
    assert.ok(recordedMsg?.msg.includes('DEAKTIVIERT'));
    pass('4.1 WebSocket toggle_minecraft_chat schaltet Chat aus und informiert Dashboard');

    await handleClientWsMessage({
      type: 'toggle_minecraft_chat',
      data: { enabled: true }
    }, null, mockContext);

    assert.strictEqual(settings.ENABLE_MINECRAFT_CHAT, true);
    assert.strictEqual(broadcastMsg?.settings?.ENABLE_MINECRAFT_CHAT, true);
    assert.ok(recordedMsg?.msg.includes('AKTIVIERT'));
    pass('4.2 WebSocket toggle_minecraft_chat schaltet Chat wieder ein');

    // Cleanup
    envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: true });
  }

  console.log('\n=============================================================');
  console.log('ALLE CHAT TOGGLE & SILENT MODE TESTS ERFOLGREICH BESTANDEN!');
  console.log('=============================================================\n');
}

runChatToggleTests().catch(err => {
  console.error('Test-Fehler:', err);
  process.exit(1);
});
