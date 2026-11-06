import { logger } from '../../utils/logger.js';
import { isMaskedPlaceholder } from '../../ai/endpointManager.js';
import { llmRouter } from '../../ai/llmRouter.js';

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
        zeroKeyFallbackEnabled: context.endpointManager.zeroKeyFallbackEnabled
      });
    } catch (err) {
      logger.error(`[BFF] Fehler bei GET /api/endpoints: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 1b. GET /api/endpoints/discover-local (Multi-Port Sweep for local inference engines - MUST be before :id)
  app.get('/api/endpoints/discover-local', async (req, res) => {
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
  app.post('/api/endpoints/:id/test', async (req, res) => {
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
  app.post('/api/endpoints/test-adhoc', async (req, res) => {
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
  app.post('/api/auth/device-flow/start', async (req, res) => {
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
}
