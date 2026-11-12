import { logger } from '../../utils/logger.js';
import { isMaskedPlaceholder } from '../../ai/endpointManager.js';
import { llmRouter } from '../../ai/llmRouter.js';
import { createRateLimiter } from '../../utils/rateLimiter.js';

/**
 * Registers Model and LLM Endpoints BFF REST API routes.
 *
 * NOTE: GET /api/endpoints/discover-local MUST be registered BEFORE GET /api/endpoints/:id
 * so Express route matcher does not interpret 'discover-local' as a dynamic :id parameter.
 *
 * @param {import('express').Express} app - Express application
 * @param {Object} context - Server coordinator context (ensureServices, endpointManager, safeProbeWorker, localModelScanner, deviceFlowManager, llmRouter)
 */
export function registerModelApiRoutes(app, context) {
  const probeLimiter = createRateLimiter({ windowMs: 60000, max: 60 });
  // 1. GET /api/endpoints (List all masked)
  app.get('/api/endpoints', async (req, res) => {
    try {
      await context.ensureServices();
      const endpoints = context.endpointManager.getEndpointsMasked();
      res.json({
        success: true,
        endpoints,
        activeFastEndpointId: context.endpointManager.activeFastEndpointId,
        activeArchitectEndpointId: context.endpointManager.activeArchitectEndpointId,
        zeroKeyFallbackEnabled: context.endpointManager.zeroKeyFallbackEnabled,
        activeProfile: context.endpointManager.getRoutingProfile?.() || 'eco',
        roleAssignments: context.endpointManager.getRoleAssignments?.() || {},
        telemetry: context.endpointManager.getTelemetry?.() || {}
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/endpoints: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 1b. GET /api/endpoints/discover-local (Multi-Port Sweep for local inference engines - MUST be before :id)
  app.get('/api/endpoints/discover-local', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const timeoutMs = req.query.timeout ? parseInt(req.query.timeout, 10) : undefined;
      const ports = req.query.ports
        ? req.query.ports.split(',').map(p => parseInt(p.trim(), 10)).filter(p => !Number.isNaN(p))
        : undefined;

      const result = await context.localModelScanner.scan({ timeoutMs, ports });
      res.json(result);
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/endpoints/discover-local: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. GET /api/endpoints/:id (Single endpoint masked)
  app.get('/api/endpoints/:id', async (req, res) => {
    try {
      await context.ensureServices();
      const ep = context.endpointManager.getEndpoint(req.params.id);
      if (!ep) {
        return res.status(404).json({ success: false, error: `Endpunkt mit ID '${req.params.id}' nicht gefunden.` });
      }
      res.json({ success: true, endpoint: ep });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/endpoints/${req.params.id}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. POST /api/endpoints (Create endpoint)
  app.post('/api/endpoints', async (req, res) => {
    try {
      await context.ensureServices();
      const rawBody = req.body || {};
      const endpointData = rawBody.endpoint || rawBody;
      const candidateSecret = rawBody.secret !== undefined
        ? rawBody.secret
        : (endpointData.secret !== undefined ? endpointData.secret : (rawBody.rawSecret || endpointData.rawSecret || rawBody.apiKey || endpointData.apiKey));

      if (!endpointData.baseUrl || !endpointData.modelId) {
        return res.status(400).json({ success: false, error: 'baseUrl und modelId sind Pflichtfelder.' });
      }

      const created = await context.endpointManager.saveEndpoint(endpointData, candidateSecret);
      if (created.enabled) {
        await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);
      }
      res.status(201).json({ success: true, endpoint: created });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/endpoints: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 4. PUT /api/endpoints/:id (Update endpoint - Write-Only Secret preservation)
  app.put('/api/endpoints/:id', async (req, res) => {
    try {
      await context.ensureServices();
      const existing = context.endpointManager.getEndpoint(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, error: `Endpunkt mit ID '${req.params.id}' nicht gefunden.` });
      }

      const rawBody = req.body || {};
      const updates = rawBody.endpoint || rawBody;
      const candidateSecret = rawBody.secret !== undefined
        ? rawBody.secret
        : (updates.secret !== undefined ? updates.secret : (rawBody.rawSecret || updates.rawSecret || rawBody.apiKey || updates.apiKey));

      const updated = await context.endpointManager.updateEndpoint(req.params.id, updates, candidateSecret);
      if (updated.enabled) {
        await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);
      }
      res.json({ success: true, endpoint: updated });
    } catch (err) {
      logger.error(`[BFF] Fehler bei PUT /api/endpoints/${req.params.id}: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 5. DELETE /api/endpoints/:id (Delete endpoint and purge secret)
  app.delete('/api/endpoints/:id', async (req, res) => {
    try {
      await context.ensureServices();
      const deleted = await context.endpointManager.deleteEndpoint(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, error: `Endpunkt mit ID '${req.params.id}' nicht gefunden.` });
      }
      await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);
      res.json({ success: true, id: req.params.id });
    } catch (err) {
      logger.error(`[BFF] Fehler bei DELETE /api/endpoints/${req.params.id}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. POST /api/endpoints/:id/test (Run Two-Tier Safe Probe on saved endpoint)
  app.post('/api/endpoints/:id/test', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const ep = context.endpointManager.getEndpoint(req.params.id);
      if (!ep) {
        return res.status(404).json({ success: false, error: `Endpunkt mit ID '${req.params.id}' nicht gefunden.` });
      }

      const secret = await context.endpointManager.getSecretForEndpoint(req.params.id);
      const result = await context.safeProbeWorker.probeEndpoint(ep, secret);

      await context.endpointManager.updateEndpointStatus(req.params.id, {
        status: result.status,
        latencyMs: result.latencyMs,
        quotaRemaining: result.quotaRemaining,
        lastError: result.error ? result.error.message : null
      });

      res.json({ success: result.success, result });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/endpoints/${req.params.id}/test: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. POST /api/endpoints/test-adhoc (Run Two-Tier Safe Probe on unsaved configuration)
  app.post('/api/endpoints/test-adhoc', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const body = req.body || {};
      let { baseUrl, modelId, secret, authType, endpointId, customHeaders, isThinkingModel } = body;

      if (!baseUrl) {
        return res.status(400).json({ success: false, error: 'baseUrl ist erforderlich.' });
      }

      if (endpointId && (!secret || isMaskedPlaceholder(secret))) {
        secret = await context.endpointManager.getSecretForEndpoint(endpointId);
      }

      const probeConfig = {
        baseUrl,
        modelId: modelId || 'default',
        authType: authType || 'api_key',
        customHeaders: customHeaders || {},
        isThinkingModel: Boolean(isThinkingModel)
      };

      const result = await context.safeProbeWorker.probeEndpoint(probeConfig, secret);
      res.json({ success: result.success, result });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/endpoints/test-adhoc: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 9. POST /api/auth/device-flow/start (Start GitHub RFC 8628 Device Flow)
  app.post('/api/auth/device-flow/start', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const session = await context.deviceFlowManager.startDeviceFlow(req.body || {});
      res.json(session);
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/auth/device-flow/start: ${err.message}`);
      res.status(502).json({ success: false, error: err.message });
    }
  });

  // 10. GET /api/auth/device-flow/status/:sessionId (Check session status)
  app.get('/api/auth/device-flow/status/:sessionId', async (req, res) => {
    try {
      await context.ensureServices();
      const status = context.deviceFlowManager.getSessionStatus(req.params.sessionId);
      if (!status) {
        return res.status(404).json({ success: false, error: `Sitzung '${req.params.sessionId}' nicht gefunden.` });
      }
      res.json(status);
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/auth/device-flow/status/${req.params.sessionId}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11. POST /api/auth/device-flow/cancel/:sessionId (Cancel session)
  app.post('/api/auth/device-flow/cancel/:sessionId', async (req, res) => {
    try {
      await context.ensureServices();
      const cancelled = context.deviceFlowManager.cancelSession(req.params.sessionId);
      if (!cancelled) {
        return res.status(404).json({ success: false, error: `Sitzung '${req.params.sessionId}' nicht gefunden.` });
      }
      res.json({ success: true, sessionId: req.params.sessionId, status: 'cancelled' });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/auth/device-flow/cancel/${req.params.sessionId}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // OpenRouter OAuth 2.0 PKCE Flow Routes
  // =========================================================================

  // 11b. POST /api/auth/openrouter/pkce/start (Start PKCE authorization session)
  app.post('/api/auth/openrouter/pkce/start', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const origin = `${req.protocol}://${req.get('host')}`;
      const callbackUrl = req.body?.callbackUrl || `${origin}/api/auth/openrouter/callback`;
      const session = context.pkceAuthManager.startSession({ callbackUrl });
      res.json(session);
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/auth/openrouter/pkce/start: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 11c. GET /api/auth/openrouter/callback (OpenRouter browser callback from OAuth redirect)
  app.get('/api/auth/openrouter/callback', async (req, res) => {
    try {
      await context.ensureServices();
      const { code } = req.query;
      if (!code) {
        return res.status(400).send('<h3>Autorisierung fehlgeschlagen: Kein Code von OpenRouter erhalten.</h3>');
      }

      const origin = `${req.protocol}://${req.get('host')}`;
      const callbackUrl = `${origin}/api/auth/openrouter/callback`;

      await context.pkceAuthManager.exchangeCode({
        code: String(code),
        callbackUrl
      });

      res.send(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OpenRouter Autorisierung</title></head>
<body style="background:#0b0f19;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;">
  <div style="text-align:center;padding:28px 36px;background:#131b2e;border:1px solid #1e293b;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.6);max-width:400px;">
    <div style="font-size:36px;margin-bottom:8px;">🌐</div>
    <h2 style="color:#10b981;margin:0 0 8px 0;font-size:18px;">OpenRouter erfolgreich autorisiert!</h2>
    <p style="color:#94a3b8;font-size:13px;margin:0 0 12px 0;">Dein persönlicher OpenRouter API-Schlüssel wurde verschlüsselt im Tresor hinterlegt und der Modell-Pool aktualisiert.</p>
    <p style="font-size:11px;color:#64748b;margin:0;">Dieses Fenster schließt sich automatisch...</p>
  </div>
  <script>
    try {
      if (window.opener) {
        window.opener.postMessage({ type: 'openrouter_auth_success' }, '*');
        setTimeout(() => window.close(), 1200);
      } else {
        setTimeout(() => { window.location.href = '/'; }, 1500);
      }
    } catch (e) {
      setTimeout(() => window.close(), 1500);
    }
  </script>
</body>
</html>`);
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/auth/openrouter/callback: ${err.message}`);
      res.status(500).send(`<h3>Fehler beim Token-Tausch: ${err.message}</h3>`);
    }
  });

  // 11d. POST /api/auth/openrouter/pkce/exchange (Direct API code exchange)
  app.post('/api/auth/openrouter/pkce/exchange', async (req, res) => {
    try {
      await context.ensureServices();
      const { code, sessionId, callbackUrl } = req.body || {};
      const result = await context.pkceAuthManager.exchangeCode({ code, sessionId, callbackUrl });
      res.json(result);
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/auth/openrouter/pkce/exchange: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // 11e. GET /api/auth/openrouter/pkce/status/:sessionId (Check PKCE session status)
  app.get('/api/auth/openrouter/pkce/status/:sessionId', async (req, res) => {
    try {
      await context.ensureServices();
      const session = context.pkceAuthManager.getSession(req.params.sessionId);
      if (!session) {
        return res.status(404).json({ success: false, error: `Sitzung '${req.params.sessionId}' nicht gefunden.` });
      }
      res.json({
        sessionId: session.sessionId,
        status: session.status,
        provider: session.provider,
        endpointId: session.endpointId || null
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/auth/openrouter/pkce/status/${req.params.sessionId}: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 12. POST /api/endpoints/activate (Activate Tier primary & hot-reload router)
  app.post('/api/endpoints/activate', async (req, res) => {
    try {
      await context.ensureServices();
      const { tier, endpointId } = req.body || {};
      if (!tier || !endpointId) {
        return res.status(400).json({ success: false, error: 'tier und endpointId sind Pflichtfelder.' });
      }
      if (!['FAST_TIER', 'ARCHITECT_TIER', 'REASONING_TIER'].includes(tier)) {
        return res.status(400).json({ success: false, error: `Ungültiger Tier: ${tier}` });
      }

      const target = context.endpointManager.getEndpoint(endpointId);
      if (!target) {
        return res.status(404).json({ success: false, error: `Endpunkt mit ID '${endpointId}' nicht gefunden.` });
      }

      await context.endpointManager.activateTier(tier, endpointId);
      await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);

      res.json({
        success: true,
        tier,
        activeEndpointId: endpointId,
        activeProvider: target.provider || 'Custom'
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/endpoints/activate: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // =========================================================================
  // LLM Routing v3.0 REST API Routes
  // =========================================================================

  // 13. GET /api/models/roles (Get all 5 roles status, active profile, and candidate recommendations)
  app.get('/api/models/roles', async (req, res) => {
    try {
      await context.ensureServices();
      const profile = context.endpointManager.getRoutingProfile?.() || 'eco';
      const assignments = context.endpointManager.getRoleAssignments?.() || {};
      const router = context.llmRouter || llmRouter;

      const roles = ['NANO_CHAT', 'PLANNER_JSON', 'ARCHITECT_CODE', 'REGION_DIFF', 'SELF_HEAL_REASONING'];
      const candidatesByRole = {};

      for (const role of roles) {
        const candidates = router.getCandidatesForRole ? router.getCandidatesForRole(role, 1) : [];
        candidatesByRole[role] = {
          pinnedEndpointId: assignments[role]?.pinnedEndpointId || null,
          effectiveEndpoint: candidates[0] ? {
            id: candidates[0].id,
            name: candidates[0].name,
            provider: candidates[0].provider,
            model: candidates[0].model,
            isFreeTier: candidates[0].isFreeTier,
            costPer1MInput: candidates[0].costPer1MInput,
            costPer1MOutput: candidates[0].costPer1MOutput,
            capabilities: candidates[0].capabilities
          } : null,
          candidatesCount: candidates.length
        };
      }

      res.json({
        success: true,
        profile,
        roles: candidatesByRole
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/models/roles: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 14. POST /api/models/profile (Change routing profile: eco / balanced / quality)
  app.post('/api/models/profile', async (req, res) => {
    try {
      await context.ensureServices();
      const { profile } = req.body || {};
      if (!profile || !['eco', 'balanced', 'quality'].includes(profile)) {
        return res.status(400).json({ success: false, error: 'profile muss "eco", "balanced" oder "quality" sein.' });
      }

      await context.endpointManager.setRoutingProfile(profile);
      await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);

      res.json({ success: true, profile });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/models/profile: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 15. POST /api/models/roles/pin (Pin or unpin model for a specific role)
  app.post('/api/models/roles/pin', async (req, res) => {
    try {
      await context.ensureServices();
      const { role, endpointId } = req.body || {};
      const validRoles = ['NANO_CHAT', 'PLANNER_JSON', 'ARCHITECT_CODE', 'REGION_DIFF', 'SELF_HEAL_REASONING'];

      if (!role || !validRoles.includes(role)) {
        return res.status(400).json({ success: false, error: `Ungültige Rolle '${role}'. Erlaubt: ${validRoles.join(', ')}` });
      }

      let updatedAssignment;
      if (!endpointId || endpointId === 'auto') {
        updatedAssignment = await context.endpointManager.unpinRole(role);
      } else {
        updatedAssignment = await context.endpointManager.pinRole(role, endpointId);
      }

      await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);

      res.json({
        success: true,
        role,
        assignment: updatedAssignment
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/models/roles/pin: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 16. POST /api/providers/:id/sync (Trigger live model synchronization for provider)
  app.post('/api/providers/:id/sync', probeLimiter, async (req, res) => {
    try {
      await context.ensureServices();
      const targetId = req.params.id;
      const affected = await context.endpointManager.syncProviderModels(targetId);
      await (context.llmRouter || llmRouter).reloadPools(context.endpointManager);

      res.json({
        success: true,
        provider: targetId,
        syncedCount: affected.length,
        models: affected
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei POST /api/providers/${req.params.id}/sync: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 17. GET /api/models/telemetry (Live token and cost statistics)
  app.get('/api/models/telemetry', async (req, res) => {
    try {
      await context.ensureServices();
      const telemetry = context.endpointManager.getTelemetry?.() || {};
      res.json({
        success: true,
        telemetry
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/models/telemetry: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
