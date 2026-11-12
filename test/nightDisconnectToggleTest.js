import assert from 'node:assert';
import { settings } from '../src/config/settings.js';
import { SleepController, SLEEP_STATES } from '../src/bot/sleepController.js';
import { sessionHandoff, HANDOFF_STATES } from '../src/bot/sessionHandoff.js';
import { handleClientWsMessage } from '../src/web/ws/dashboardWsDispatcher.js';
import { envManager } from '../src/config/envManager.js';
import { Vec3 } from 'vec3';

function pass(msg) {
  console.log(`[PASS] ${msg}`);
}

async function runNightDisconnectToggleTests() {
  console.log('\n=== RUNNING NIGHT DISCONNECT TOGGLE & STARTUP BEHAVIOR TESTS ===\n');

  // 1. Initial State & Invariants
  {
    assert.strictEqual(typeof settings.SLEEP_DISCONNECT_ON_NO_BED, 'boolean');
    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, false, 'Default should be false (no auto disconnect on start)');
    pass('1.1 SLEEP_DISCONNECT_ON_NO_BED ist standardmäßig false');
  }

  // 2. Initial Start Behavior: Bot spawns during night with toggle OFF -> Stays AWAKE
  {
    const nightBot = {
      username: 'TestBot',
      time: { timeOfDay: 16000 },
      entity: { position: new Vec3(0, 64, 0) },
      findBlocks: () => [],
      on: () => {},
      removeListener: () => {}
    };

    let reconnectCalled = false;
    let quitCalled = false;
    nightBot.quit = () => { quitCalled = true; };

    const mockClient = {
      bot: nightBot,
      reconnect: () => { reconnectCalled = true; }
    };

    const sc = new SleepController(mockClient);
    settings.SLEEP_DISCONNECT_ON_NO_BED = false;

    await sc.onBotSpawn(nightBot);

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'Bot must stay AWAKE on startup at night');
    assert.strictEqual(quitCalled, false, 'Bot must NOT quit server on start');
    assert.strictEqual(reconnectCalled, false, 'No reconnect should be scheduled');
    sc.stopMonitoring();
    pass('2.1 Initialer Bot-Start bei Nacht ohne Bett: Bot bleibt online (kein automatischer Disconnect)');
  }

  // 3. Initial Start Behavior: Even if toggle is true, first initial spawn does NOT disconnect immediately
  {
    const nightBot = {
      username: 'TestBot',
      time: { timeOfDay: 18000 },
      entity: { position: new Vec3(0, 64, 0) },
      findBlocks: () => [],
      on: () => {},
      removeListener: () => {}
    };

    let quitCalled = false;
    nightBot.quit = () => { quitCalled = true; };

    const mockClient = {
      bot: nightBot,
      reconnect: () => {}
    };

    const sc = new SleepController(mockClient);
    sc.wasDisconnectedForNight = false; // Initial start
    sc.wasBuildingBeforeSleep = false;
    settings.SLEEP_DISCONNECT_ON_NO_BED = true;

    await sc.onBotSpawn(nightBot);

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'Bot must stay AWAKE on initial spawn even if toggle is ON');
    assert.strictEqual(quitCalled, false, 'Initial bot launch must not kick bot off server');
    sc.stopMonitoring();
    pass('3.1 Initialer Bot-Start mit Toggle AN: Bot verbleibt auf dem Server und disconnectet nicht vorzeitig');
  }

  // 4. Toggle Mechanics on SleepController: setNightDisconnectEnabled
  {
    const sc = new SleepController();
    assert.strictEqual(sc.setNightDisconnectEnabled(true), true);
    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, true);
    assert.strictEqual(sc.isNightDisconnectEnabled(), true);

    assert.strictEqual(sc.setNightDisconnectEnabled(false), false);
    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, false);
    assert.strictEqual(sc.isNightDisconnectEnabled(), false);
    pass('4.1 setNightDisconnectEnabled toggelt Zustand in SleepController und settings');
  }

  // 5. Deactivating toggle while bot is in DISCONNECTED_FOR_NIGHT triggers immediate reconnect
  {
    let reconnected = false;
    const mockClient = {
      bot: null,
      reconnect: () => { reconnected = true; }
    };
    const sc = new SleepController(mockClient);
    sc.state = SLEEP_STATES.DISCONNECTED_FOR_NIGHT;
    sc.reconnectTimer = setTimeout(() => {}, 60000);
    sessionHandoff.state = HANDOFF_STATES.PAUSED_SLEEP_NIGHT;

    sc.setNightDisconnectEnabled(false);

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'State transitions back to AWAKE');
    assert.strictEqual(sessionHandoff.state, HANDOFF_STATES.ONLINE_ACTIVE);
    assert.strictEqual(sc.reconnectTimer, null, 'Reconnect timer must be cleared');
    assert.strictEqual(reconnected, true, 'botClient.reconnect must be called immediately');
    pass('5.1 Deaktivieren des Toggles während Nacht-Disconnect bricht Timer ab und verbindet sofort');
  }

  // 6. WebSocket toggle_sleep_disconnect Dispatcher
  {
    const broadcastEvents = [];
    const chatEvents = [];

    const mockContext = {
      broadcast: (evt) => broadcastEvents.push(evt),
      recordChat: (sender, msg) => chatEvents.push({ sender, msg })
    };

    const mockWs = { send: () => {} };

    // Toggle to true via WS
    await handleClientWsMessage({
      type: 'toggle_sleep_disconnect',
      enabled: true
    }, mockWs, mockContext);

    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, true);
    assert.strictEqual(broadcastEvents.length, 1);
    assert.strictEqual(broadcastEvents[0].type, 'night_disconnect_toggled');
    assert.strictEqual(broadcastEvents[0].enabled, true);
    assert(chatEvents.some(c => c.msg.includes('AKTIVIERT')));

    // Toggle to false via WS
    await handleClientWsMessage({
      type: 'toggle_sleep_disconnect',
      enabled: false
    }, mockWs, mockContext);

    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, false);
    assert.strictEqual(broadcastEvents.length, 2);
    assert.strictEqual(broadcastEvents[1].enabled, false);
    assert(chatEvents.some(c => c.msg.includes('DEAKTIVIERT')));

    // Toggle via control_action
    await handleClientWsMessage({
      type: 'control_action',
      action: 'toggle_sleep_disconnect',
      enabled: true
    }, mockWs, mockContext);

    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, true);

    // Reset to false for clean state
    await handleClientWsMessage({
      type: 'toggle_sleep_disconnect',
      enabled: false
    }, mockWs, mockContext);
    assert.strictEqual(settings.SLEEP_DISCONNECT_ON_NO_BED, false);

    pass('6.1 WebSocket Dispatcher empfängt toggle_sleep_disconnect, persistiert und benachrichtigt Dashboard');
  }

  // 7. When others are sleeping but toggle is OFF: Bot must NOT disconnect
  {
    const sleepingBot = {
      username: 'BaumeisterKI',
      time: { timeOfDay: 14000 },
      players: {
        BaumeisterKI: { username: 'BaumeisterKI' },
        Alice: {
          username: 'Alice',
          entity: { isSleeping: true }
        }
      },
      findBlocks: () => [],
      on: () => {},
      removeListener: () => {}
    };

    let quitCalled = false;
    sleepingBot.quit = () => { quitCalled = true; };

    const sc = new SleepController({ bot: sleepingBot, reconnect: () => {} });
    settings.SLEEP_DISCONNECT_ON_NO_BED = false;

    await sc.handleSleepOpportunity();

    assert.strictEqual(sc.state, SLEEP_STATES.AWAKE, 'Bot must remain AWAKE even when others sleep if toggle is off');
    assert.strictEqual(quitCalled, false, 'Bot must not disconnect');
    pass('7.1 Mitspieler schläft: Bot trennt sich NICHT, wenn Dashboard-Toggle ausgeschaltet ist');
  }

  console.log('\n=============================================================');
  console.log('ALLE NIGHT DISCONNECT TOGGLE TESTS ERFOLGREICH BESTANDEN!');
  console.log('=============================================================\n');
}

runNightDisconnectToggleTests().catch(err => {
  console.error('FATAL in Night Disconnect Toggle Tests:', err);
  process.exit(1);
});
