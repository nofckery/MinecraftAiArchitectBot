import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { LLMRouter, DynamicEndpoint, TASK_ROLES, ROUTING_PROFILES } from '../src/ai/llmRouter.js';
import { EndpointManager } from '../src/ai/endpointManager.js';
import { CredentialVault } from '../src/security/credentialVault.js';
import { inferModelCapabilities, computeRoleScore } from '../src/ai/modelKnowledgeBase.js';
import { registerModelApiRoutes } from '../src/web/routes/modelRoutes.js';

console.log('=== STARTING LLM ROUTING V3.0 FEINGRANULAR TEST SUITE ===\n');

async function runTestSuite() {
  const testDir = path.resolve('data', 'test_llm_v3_env');
  await fs.promises.mkdir(testDir, { recursive: true });
  const testConfigPath = path.join(testDir, 'endpoints_v3.json');
  const testVaultPath = path.join(testDir, 'credentials_v3.vault');

  if (fs.existsSync(testConfigPath)) fs.unlinkSync(testConfigPath);
  if (fs.existsSync(testVaultPath)) fs.unlinkSync(testVaultPath);

  const vault = new CredentialVault({ vaultPath: testVaultPath });
  await vault.init();

  const endpointManager = new EndpointManager({
    configPath: testConfigPath,
    vault,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }
  });
  await endpointManager.init();

  const router = new LLMRouter();

  try {
    // =========================================================================
    // Testgruppe 1: 5-Stufen Task-Taxonomie & Model Knowledge Base
    // =========================================================================
    console.log('--- Testgruppe 1: 5 Task-Rollen & Heuristik ---');

    assert.strictEqual(TASK_ROLES.NANO_CHAT, 'NANO_CHAT', '1.1 NANO_CHAT definiert');
    assert.strictEqual(TASK_ROLES.PLANNER_JSON, 'PLANNER_JSON', '1.1 PLANNER_JSON definiert');
    assert.strictEqual(TASK_ROLES.ARCHITECT_CODE, 'ARCHITECT_CODE', '1.1 ARCHITECT_CODE definiert');
    assert.strictEqual(TASK_ROLES.REGION_DIFF, 'REGION_DIFF', '1.1 REGION_DIFF definiert');
    assert.strictEqual(TASK_ROLES.SELF_HEAL_REASONING, 'SELF_HEAL_REASONING', '1.1 SELF_HEAL_REASONING definiert');

    const metaFlashLite = inferModelCapabilities('gemini-2.5-flash-lite', 'Gemini');
    assert.strictEqual(metaFlashLite.isFreeTier, true, '1.2 gemini-2.5-flash-lite ist Free-Tier');
    assert.strictEqual(metaFlashLite.tierRecommendation, TASK_ROLES.NANO_CHAT, '1.2 gemini-2.5-flash-lite empfohlen für NANO_CHAT');

    const metaCodestral = inferModelCapabilities('codestral-2501', 'Mistral');
    assert.strictEqual(metaCodestral.capabilities.code >= 95, true, '1.3 Codestral hat Spitzen-Code-Fähigkeit');
    assert.strictEqual(metaCodestral.tierRecommendation, TASK_ROLES.ARCHITECT_CODE, '1.3 Codestral empfohlen für ARCHITECT_CODE');

    const metaDeepSeek = inferModelCapabilities('deepseek/deepseek-r1:free', 'OpenRouter');
    assert.strictEqual(metaDeepSeek.isThinkingModel, true, '1.4 DeepSeek R1 als Thinking-Modell erkannt');
    assert.strictEqual(metaDeepSeek.tierRecommendation, TASK_ROLES.SELF_HEAL_REASONING, '1.4 DeepSeek R1 empfohlen für SELF_HEAL');

    console.log('[PASS] 1. Task-Rollen & Modell-Wissensbasis fehlerfrei validiert.');

    // =========================================================================
    // Testgruppe 2: Ein Anbieter stellt mehrere Modelle für verschiedene Zwecke bereit
    // =========================================================================
    console.log('\n--- Testgruppe 2: Multi-Modell Bereitstellung pro Anbieter ---');

    // Erstelle Basis-Endpunkt für Google AI Studio
    const googleBase = await endpointManager.createEndpoint({
      name: 'Google Gemini (AI Studio)',
      provider: 'Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      modelId: 'gemini-2.5-flash',
      authType: 'api_key',
      enabled: true
    }, 'AQ.Abc123FakeGoogleKeyForTests');

    // Führe Katalog-Synchronisation für Google durch
    const synced = await endpointManager.syncProviderModels(googleBase.id);
    assert.strictEqual(synced.length >= 3, true, '2.1 syncProviderModels findet mehrere Google-Modelle');

    const allEps = endpointManager.getAllEndpoints();
    const flashLiteEp = allEps.find(e => e.provider === 'Gemini' && e.modelId === 'gemini-2.5-flash-lite');
    const flashEp = allEps.find(e => e.provider === 'Gemini' && e.modelId === 'gemini-2.5-flash');
    const proEp = allEps.find(e => e.provider === 'Gemini' && e.modelId === 'gemini-2.5-pro');

    assert.ok(flashLiteEp, '2.2 gemini-2.5-flash-lite wurde registriert');
    assert.ok(flashEp, '2.2 gemini-2.5-flash wurde registriert');
    assert.ok(proEp, '2.2 gemini-2.5-pro wurde registriert');

    // Gleiche Credential-Referenz für alle Modelle desselben Anbieters
    assert.strictEqual(flashLiteEp.credentialRef, googleBase.credentialRef, '2.3 Alle Google-Modelle teilen sich denselben Vault-Schlüssel');
    assert.strictEqual(proEp.credentialRef, googleBase.credentialRef, '2.3 Pro teilt sich denselben Vault-Schlüssel');

    console.log('[PASS] 2. Google stellt erfolgreich mehrere Modelle mit einem einzigen Key bereit.');

    // =========================================================================
    // Testgruppe 3: Smart Auto-Scoring & Routing-Profile
    // =========================================================================
    console.log('\n--- Testgruppe 3: Smart Auto-Scoring & Profile ---');

    await router.reloadPools(endpointManager);

    // Profile: Eco (Standard) -> Flash-Lite sollte NANO_CHAT anführen
    await endpointManager.setRoutingProfile('eco');
    await router.reloadPools(endpointManager);

    const nanoCandidatesEco = router.getCandidatesForRole(TASK_ROLES.NANO_CHAT);
    assert.ok(nanoCandidatesEco.length > 0, '3.1 Kandidaten für NANO_CHAT vorhanden');
    assert.strictEqual(nanoCandidatesEco[0].model, 'gemini-2.5-flash-lite', '3.1 Im Eco-Profil gewinnt gemini-2.5-flash-lite für NANO_CHAT');

    // Self-Heal Reasoning
    const healCandidates = router.getCandidatesForRole(TASK_ROLES.SELF_HEAL_REASONING, 1);
    assert.ok(healCandidates.length > 0, '3.2 Kandidaten für SELF_HEAL_REASONING vorhanden');
    // gemini-2.5-pro oder Thinking-Modelle führen bei Reasoning
    const topHeal = healCandidates[0];
    assert.strictEqual(topHeal.model.includes('pro') || topHeal.isThinkingModel, true, '3.2 Stärkstes Reasoning-Modell führt SELF_HEAL');

    // Teste Profilwechsel: 'quality'
    await endpointManager.setRoutingProfile('quality');
    await router.reloadPools(endpointManager);
    assert.strictEqual(endpointManager.getRoutingProfile(), 'quality', '3.3 Profil auf quality gewechselt');

    console.log('[PASS] 3. Smart Auto-Scoring und Profilsteuerung erfolgreich.');

    // =========================================================================
    // Testgruppe 4: Manuelles Pinning von Modellen pro Rolle
    // =========================================================================
    console.log('\n--- Testgruppe 4: Manuelles Pinning pro Rolle ---');

    // Pinne gemini-2.5-pro fest auf ARCHITECT_CODE
    await endpointManager.pinRole(TASK_ROLES.ARCHITECT_CODE, proEp.id);
    await router.reloadPools(endpointManager);

    let candidates = router.getCandidatesForRole(TASK_ROLES.ARCHITECT_CODE);
    assert.strictEqual(candidates[0].id, proEp.id, '4.1 Gepinntes Modell steht an Platz 1 für ARCHITECT_CODE');

    // Unpin Rolle -> fällt auf Auto-Scoring zurück
    await endpointManager.unpinRole(TASK_ROLES.ARCHITECT_CODE);
    await router.reloadPools(endpointManager);

    candidates = router.getCandidatesForRole(TASK_ROLES.ARCHITECT_CODE);
    const assignments = endpointManager.getRoleAssignments();
    assert.strictEqual(assignments.ARCHITECT_CODE.pinnedEndpointId, null, '4.2 Unpin entfernt Pinning');

    console.log('[PASS] 4. Pinning und Unpinning funktionieren einwandfrei.');

    // =========================================================================
    // Testgruppe 5: Isolierter Modell-Cooldown bei HTTP 429
    // =========================================================================
    console.log('\n--- Testgruppe 5: Isolierter Modell-Cooldown bei 429 ---');

    await router.reloadPools(endpointManager);
    const flashInstance = router.allEndpoints.find(e => e.model === 'gemini-2.5-flash');
    const liteInstance = router.allEndpoints.find(e => e.model === 'gemini-2.5-flash-lite');

    assert.ok(flashInstance, '5.1 Flash-Instanz im Router vorhanden');
    assert.ok(liteInstance, '5.1 Flash-Lite-Instanz im Router vorhanden');

    // Simuliere HTTP 429 auf gemini-2.5-flash
    const err429 = new Error('Rate limit exceeded');
    err429.status = 429;
    router.handleError(flashInstance, err429);

    assert.strictEqual(flashInstance.isAvailable(), false, '5.2 Flash-Modell ist im Cooldown');
    assert.strictEqual(liteInstance.isAvailable(), true, '5.3 Flash-Lite auf DEMSELBEN Key bleibt VOLL VERFÜGBAR!');
    assert.strictEqual(liteInstance.disabled, false, '5.3 Key wurde nicht deaktiviert');

    console.log('[PASS] 5. Isolierter Modell-Cooldown schützt verbleibende Modelle desselben Keys.');

    // =========================================================================
    // Testgruppe 6: 3-Stufige Self-Healing Eskalation
    // =========================================================================
    console.log('\n--- Testgruppe 6: 3-Stufige Self-Healing Eskalation ---');

    // Versuch 1
    const attempt1Candidates = router.getCandidatesForRole(TASK_ROLES.ARCHITECT_CODE, 1);
    // Versuch 2 -> eskaliert automatisch zu SELF_HEAL_REASONING
    const attempt2Candidates = router.getCandidatesForRole(TASK_ROLES.ARCHITECT_CODE, 2);
    // Versuch 3 -> höchste Priorität für Thinking/CoT
    const attempt3Candidates = router.getCandidatesForRole(TASK_ROLES.ARCHITECT_CODE, 3);

    assert.ok(attempt1Candidates.length > 0, '6.1 Versuch 1 liefert Kandidaten');
    assert.ok(attempt2Candidates.length > 0, '6.2 Versuch 2 liefert eskalierte Kandidaten');
    assert.ok(attempt3Candidates.length > 0, '6.3 Versuch 3 liefert Deep-Reasoning Kandidaten');
    assert.strictEqual(attempt3Candidates[0].isThinkingModel || attempt3Candidates[0].model.includes('pro'), true, '6.3 Versuch 3 wählt Thinking/Pro-Modell');

    console.log('[PASS] 6. 3-Stufen-Eskalation leitet Retries zuverlässig zu stärkeren Modellen.');

    // =========================================================================
    // Testgruppe 7: Token- & Kosten-Tracking Telemetrie
    // =========================================================================
    console.log('\n--- Testgruppe 7: Token- & Kosten-Tracking Telemetrie ---');

    endpointManager.recordTelemetry({
      role: TASK_ROLES.ARCHITECT_CODE,
      modelId: 'gemini-2.5-flash',
      promptTokens: 1200,
      completionTokens: 800,
      costUSD: 0.00066
    });

    const tel = endpointManager.getTelemetry();
    assert.strictEqual(tel.totalRequests, 1, '7.1 1 Anfrage erfasst');
    assert.strictEqual(tel.totalPromptTokens, 1200, '7.1 1200 Prompt-Tokens erfasst');
    assert.strictEqual(tel.totalCompletionTokens, 800, '7.1 800 Completion-Tokens erfasst');
    assert.strictEqual(tel.byRole.ARCHITECT_CODE.requests, 1, '7.2 Aufschlüsselung nach ARCHITECT_CODE korrekt');
    assert.strictEqual(tel.byModel['gemini-2.5-flash'].promptTokens, 1200, '7.2 Aufschlüsselung nach Modell korrekt');

    console.log('[PASS] 7. Token- & Kosten-Tracking erfasst Verbräuche fehlerfrei.');

    // =========================================================================
    // Testgruppe 8: REST BFF API Endpunkte
    // =========================================================================
    console.log('\n--- Testgruppe 8: REST BFF API Endpunkte ---');

    const app = express();
    app.use(express.json());
    registerModelApiRoutes(app, {
      ensureServices: async () => {},
      endpointManager,
      llmRouter: router
    });

    const server = http.createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const origin = `http://127.0.0.1:${port}`;

    try {
      // 8.1 GET /api/models/roles
      const resRoles = await fetch(`${origin}/api/models/roles`);
      assert.strictEqual(resRoles.status, 200, '8.1 GET /api/models/roles liefert 200');
      const jsonRoles = await resRoles.json();
      assert.strictEqual(jsonRoles.success, true, '8.1 JSON success ist true');
      assert.ok(jsonRoles.roles.NANO_CHAT, '8.1 NANO_CHAT in Rollenübersicht');
      assert.ok(jsonRoles.roles.ARCHITECT_CODE, '8.1 ARCHITECT_CODE in Rollenübersicht');

      // 8.2 POST /api/models/profile
      const resProf = await fetch(`${origin}/api/models/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: 'balanced' })
      });
      assert.strictEqual(resProf.status, 200, '8.2 POST /api/models/profile liefert 200');
      const jsonProf = await resProf.json();
      assert.strictEqual(jsonProf.profile, 'balanced', '8.2 Profil auf balanced gesetzt');

      // 8.3 POST /api/models/roles/pin
      const resPin = await fetch(`${origin}/api/models/roles/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'NANO_CHAT', endpointId: flashLiteEp.id })
      });
      assert.strictEqual(resPin.status, 200, '8.3 POST /api/models/roles/pin liefert 200');
      const jsonPin = await resPin.json();
      assert.strictEqual(jsonPin.assignment.pinnedEndpointId, flashLiteEp.id, '8.3 Pin erfolgreich');

      // 8.4 GET /api/models/telemetry
      const resTel = await fetch(`${origin}/api/models/telemetry`);
      assert.strictEqual(resTel.status, 200, '8.4 GET /api/models/telemetry liefert 200');
      const jsonTel = await resTel.json();
      assert.strictEqual(jsonTel.telemetry.totalRequests, 1, '8.4 Telemetrie über API abrufbar');

      console.log('[PASS] 8. Alle neuen REST BFF Routen v3.0 erfolgreich getestet.');
    } finally {
      server.close();
    }

    console.log('\n=== ALLE TESTS DER LLM ROUTING V3.0 SUITE ERFOLGREICH BESTANDEN! ===');
  } finally {
    try {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch (_) {}
  }
}

runTestSuite().catch(err => {
  console.error('\n[FEHLER IN TESTSUITE]:', err);
  process.exit(1);
});
