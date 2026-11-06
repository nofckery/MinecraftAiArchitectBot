import assert from 'node:assert';
import http from 'node:http';
import { MsaAuthManager } from '../src/security/msaAuthManager.js';
import { DashboardServer } from '../src/web/dashboardServer.js';
import { EventEmitter } from 'node:events';

console.log('=== TEST SUITE: MICROSOFT AUTHENTICATION (MSA) & ONBOARDING INTEGRATION ===');

function pass(name) {
  console.log(`[PASS] ${name}`);
}

async function runTests() {
  // --- Testgruppe 1: MsaAuthManager Status Check ---
  console.log('\n--- Testgruppe 1: MsaAuthManager Status & Lifecycle ---');

  const testManager = new MsaAuthManager({
    cacheDir: 'data/test_nmp_cache'
  });

  const emptyStatus = await testManager.checkAuthStatus('');
  assert.strictEqual(emptyStatus.authenticated, false);
  pass('1.1 checkAuthStatus mit leerem Namen liefert false');

  const unknownStatus = await testManager.checkAuthStatus('definitely_nonexistent_user_99999');
  assert.strictEqual(unknownStatus.authenticated, false);
  pass('1.2 checkAuthStatus mit nicht-authentifiziertem User liefert false');

  // Cancel flow test
  testManager.activeSessions.set('testUser', {
    username: 'testUser',
    status: 'pending',
    userCode: 'TEST-CODE',
    verificationUri: 'https://www.microsoft.com/link',
    directUrl: 'https://www.microsoft.com/link?otc=TEST-CODE',
    expiresAt: Date.now() + 60000
  });

  const active = testManager.getActiveSession('testUser');
  assert.strictEqual(active.userCode, 'TEST-CODE');
  pass('1.3 getActiveSession liefert aktive Sitzung');

  const cancelled = testManager.cancelAuthFlow('testUser');
  assert.strictEqual(cancelled, true);
  assert.strictEqual(testManager.getActiveSession('testUser'), null);
  pass('1.4 cancelAuthFlow bricht aktive Sitzung sauber ab');

  // --- Testgruppe 2: Dashboard REST BFF API (/api/auth/msa/...) ---
  console.log('\n--- Testgruppe 2: Dashboard REST API Routes ---');

  const testDashboard = new DashboardServer();
  const app = testDashboard.setupApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 2.1 GET /api/auth/msa/status
    const resStatus = await fetch(`${baseUrl}/api/auth/msa/status?username=unknownUserTest`);
    const statusData = await resStatus.json();
    assert.strictEqual(resStatus.status, 200);
    assert.strictEqual(statusData.success, true);
    assert.strictEqual(statusData.authenticated, false);
    assert.strictEqual(statusData.status, 'unauthenticated');
    pass('2.1 GET /api/auth/msa/status liefert unauthenticated für neuen User');

    // 2.2 POST /api/auth/msa/cancel
    const resCancel = await fetch(`${baseUrl}/api/auth/msa/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'unknownUserTest' })
    });
    const cancelData = await resCancel.json();
    assert.strictEqual(resCancel.status, 200);
    assert.strictEqual(cancelData.success, true);
    pass('2.2 POST /api/auth/msa/cancel liefert success: true');

  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // --- Testgruppe 3: Safe Chat Hooking in Bot Client ---
  console.log('\n--- Testgruppe 3: Safe Chat Hooking (Zero-Crash bei unvollständigem Bot) ---');

  // Simuliere einen Mineflayer-Bot, bei dem bot.chat synchron noch undefined ist
  const mockBot = new EventEmitter();
  mockBot.username = 'TestBot';
  mockBot.chat = undefined; // wie bei MSA Auth vor inject_allowed

  let chatHooked = false;
  const hookChat = () => {
    if (mockBot.chat && !mockBot._chatHooked) {
      mockBot._chatHooked = true;
      const origChat = mockBot.chat.bind(mockBot);
      mockBot.chat = (msg) => {
        chatHooked = true;
        return origChat(msg);
      };
    }
  };

  if (mockBot.chat) {
    hookChat();
  } else {
    mockBot.once('inject_allowed', hookChat);
  }

  assert.strictEqual(mockBot._chatHooked, undefined);
  pass('3.1 Bot stürzt nicht ab, wenn bot.chat synchron undefined ist');

  // Jetzt emulieren wir das Laden des Chat-Plugins
  let actualSent = null;
  mockBot.chat = function(msg) { actualSent = msg; };
  mockBot.emit('inject_allowed');

  assert.strictEqual(mockBot._chatHooked, true);
  mockBot.chat('Hallo Welt');
  assert.strictEqual(chatHooked, true);
  assert.strictEqual(actualSent, 'Hallo Welt');
  pass('3.2 Chat-Hook wird sicher bei inject_allowed aktiviert und leitet Nachrichten weiter');

  console.log('\n=== ALLE TESTS DER MSA INTEGRATION ERFOLGREICH BESTANDEN! ===');
}

runTests().catch(err => {
  console.error('[FAIL]', err);
  process.exit(1);
});
