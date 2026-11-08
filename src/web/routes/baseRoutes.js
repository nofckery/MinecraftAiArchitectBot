import path from 'node:path';
import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { worldExecutor } from '../../builder/worldExecutor.js';
import { sessionHandoff } from '../../bot/sessionHandoff.js';
import { llmRouter } from '../../ai/llmRouter.js';
import { envManager } from '../../config/envManager.js';
import { serverRights } from '../../bot/serverRights.js';
import { msaAuthManager } from '../../security/msaAuthManager.js';
import { VersionResolver } from '../../config/versionResolver.js';

/**
 * Registers base dashboard HTTP routes: status, settings, setup, bot reconnect, and MSA auth.
 *
 * @param {import('express').Express} app - Express application
 * @param {Object} context - Server coordinator context (currentBot, botClient, broadcast, llmRouter)
 */
export function registerBaseRoutes(app, context) {
  // Milestone 3: Dedicated Popout Viewer Routes
  const viewerHtmlPath = path.resolve('src/web/public/viewer.html');
  app.get(['/viewer', '/camera'], (req, res) => {
    res.sendFile(viewerHtmlPath);
  });

  app.get('/api/status', (req, res) => {
    const isBotRunning = context.botClient ? context.botClient.shouldRun : false;
    const isBotConnected = !!(context.currentBot && context.currentBot.entity);
    res.json({
      status: sessionHandoff.state,
      botConnected: isBotConnected,
      botRunning: isBotRunning,
      botUsername: (context.currentBot && context.currentBot.username) || settings.MC_USERNAME || 'BaumeisterKI',
      viewerPort: settings.PRISMARINE_VIEWER_PORT,
      executionMode: settings.BUILD_EXECUTION_MODE,
      effectiveMode: worldExecutor.resolveMode(settings.BUILD_EXECUTION_MODE, context.currentBot),
      serverRights: serverRights.getStatus(context.currentBot),
      hasEnvFile: envManager.hasEnvFile(),
      llmProvider: (context.llmRouter || llmRouter).getActiveProviderName()
    });
  });

  app.get('/api/settings', (req, res) => {
    try {
      const versionMetadata = VersionResolver.getViewerVersionMetadata();
      res.json({
        success: true,
        hasEnvFile: envManager.hasEnvFile(),
        isFullyConfigured: envManager.isFullyConfigured(),
        settings: envManager.getCurrentSettings(),
        serverRights: serverRights.getStatus(context.currentBot),
        versionMetadata,
        supportedVersions: versionMetadata
      });
    } catch (err) {
      logger.error(`[Settings] Fehler bei GET /api/settings: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/settings', async (req, res) => {
    try {
      const result = envManager.saveConfig(req.body || {});
      const shouldReconnect = req.body && (req.body.reconnectBot === true || req.body.reconnectBot === 'true');
      if (shouldReconnect) {
        const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
        if (activeBotClient && typeof activeBotClient.reconnect === 'function') {
          activeBotClient.reconnect();
        }
      }
      context.broadcast({
        type: 'settings_updated',
        hasEnvFile: envManager.hasEnvFile(),
        isFullyConfigured: envManager.isFullyConfigured(),
        settings: envManager.getCurrentSettings(),
        reconnected: shouldReconnect
      });
      res.json({
        success: true,
        message: 'Einstellungen erfolgreich in .env gespeichert.',
        result,
        reconnected: shouldReconnect
      });
    } catch (err) {
      logger.error(`[Settings] Fehler beim Speichern: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/setup', async (req, res) => {
    try {
      const setupConfig = Object.assign({}, req.body || {}, { ONBOARDING_COMPLETED: true });
      const result = envManager.saveConfig(setupConfig);
      if (req.body.reconnectBot !== false) {
        const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
        if (activeBotClient && typeof activeBotClient.reconnect === 'function') {
          activeBotClient.reconnect();
        }
      }
      context.broadcast({
        type: 'settings_updated',
        hasEnvFile: envManager.hasEnvFile(),
        isFullyConfigured: envManager.isFullyConfigured(),
        settings: envManager.getCurrentSettings()
      });
      res.json({
        success: true,
        message: 'Onboarding erfolgreich abgeschlossen und maßgeschneiderte .env erstellt!',
        result
      });
    } catch (err) {
      logger.error(`[Setup] Fehler beim Onboarding: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bot/reconnect', async (req, res) => {
    try {
      const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
      if (activeBotClient && typeof activeBotClient.reconnect === 'function') {
        activeBotClient.reconnect();
        res.json({ success: true, message: 'Bot-Verbindung wird neu aufgebaut...' });
      } else {
        res.status(503).json({ success: false, error: 'Kein Bot-Client verfügbar.' });
      }
    } catch (err) {
      logger.error(`[BotClient] Fehler beim Reconnect: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bot/start', async (req, res) => {
    try {
      const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
      if (activeBotClient && typeof activeBotClient.start === 'function') {
        activeBotClient.start();
        res.json({ success: true, message: 'Bot-Client wird gestartet...' });
      } else {
        res.status(503).json({ success: false, error: 'Kein Bot-Client verfügbar.' });
      }
    } catch (err) {
      logger.error(`[BotClient] Fehler beim Starten: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/bot/stop', async (req, res) => {
    try {
      const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
      if (activeBotClient && typeof activeBotClient.stop === 'function') {
        activeBotClient.stop();
        res.json({ success: true, message: 'Bot-Client gestoppt.' });
      } else {
        res.status(503).json({ success: false, error: 'Kein Bot-Client verfügbar.' });
      }
    } catch (err) {
      logger.error(`[BotClient] Fehler beim Stoppen: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- MICROSOFT AUTHENTICATION (MSA DEVICE CODE) ROUTES ---
  app.get('/api/auth/msa/status', async (req, res) => {
    try {
      const username = req.query.username || settings.MC_USERNAME || 'BaumeisterKI';
      const activeSession = msaAuthManager.getActiveSession(username);
      if (activeSession && activeSession.status === 'pending') {
        return res.json({
          success: true,
          status: 'pending',
          authenticated: false,
          session: {
            userCode: activeSession.userCode,
            verificationUri: activeSession.verificationUri,
            directUrl: activeSession.directUrl,
            expiresIn: Math.max(0, Math.floor((activeSession.expiresAt - Date.now()) / 1000)),
            message: activeSession.message
          }
        });
      }

      const check = await msaAuthManager.checkAuthStatus(username);
      return res.json({
        success: true,
        status: check.authenticated ? 'authenticated' : 'unauthenticated',
        authenticated: check.authenticated,
        profile: check.profile || null,
        username
      });
    } catch (err) {
      logger.error(`[MSA] Fehler bei GET /api/auth/msa/status: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/msa/start', async (req, res) => {
    try {
      const username = (req.body?.username || settings.MC_USERNAME || 'BaumeisterKI').trim();
      const forceRefresh = !!req.body?.forceRefresh;

      if (!forceRefresh) {
        const check = await msaAuthManager.checkAuthStatus(username);
        if (check.authenticated) {
          return res.json({
            success: true,
            status: 'authenticated',
            alreadyAuthenticated: true,
            profile: check.profile,
            username
          });
        }
      }

      logger.info(`[MSA] Starte Microsoft-Authentifizierung für '${username}'...`);
      const session = await msaAuthManager.startAuthFlow(username, { forceRefresh });

      res.json({
        success: true,
        status: 'pending',
        userCode: session.userCode,
        verificationUri: session.verificationUri,
        directUrl: session.directUrl,
        expiresIn: session.expiresIn,
        message: session.message
      });
    } catch (err) {
      logger.error(`[MSA] Fehler beim Starten des MSA-Flows: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/msa/cancel', (req, res) => {
    try {
      const username = req.body?.username || settings.MC_USERNAME || '';
      const cancelled = msaAuthManager.cancelAuthFlow(username);
      res.json({ success: true, cancelled });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
