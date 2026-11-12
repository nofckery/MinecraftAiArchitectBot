import path from 'node:path';
import fs from 'node:fs';
import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { worldExecutor } from '../../builder/worldExecutor.js';
import { sessionHandoff } from '../../bot/sessionHandoff.js';
import { sleepController } from '../../bot/sleepController.js';
import { llmRouter } from '../../ai/llmRouter.js';
import { envManager } from '../../config/envManager.js';
import { serverRights } from '../../bot/serverRights.js';
import { msaAuthManager } from '../../security/msaAuthManager.js';
import { VersionResolver } from '../../config/versionResolver.js';
import { lanDiscoveryService } from '../../network/lanDiscoveryService.js';
import {
  detectMinecraftInstances,
  findBestMatchingInstance,
  installBypassMod
} from '../../utils/minecraftInstanceDetector.js';

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
    const activeBotClient = context.botClient;
    const isBotRunning = activeBotClient ? activeBotClient.shouldRun : false;
    const isBotConnected = !!(context.currentBot && context.currentBot.entity);
    const resolvedStatus = (activeBotClient && activeBotClient.state === 'FABRIC_MISMATCH')
      ? 'FABRIC_MISMATCH'
      : (activeBotClient?.state || sessionHandoff.state);

    res.json({
      status: resolvedStatus,
      botState: activeBotClient?.state,
      lastKickClassification: activeBotClient?.lastKickClassification || null,
      botConnected: isBotConnected,
      botRunning: isBotRunning,
      botUsername: (context.currentBot && context.currentBot.username) || settings.MC_USERNAME || 'BaumeisterKI',
      viewerPort: settings.PRISMARINE_VIEWER_PORT,
      viewerEnabled: Boolean(settings.ENABLE_PRISMARINE_VIEWER),
      viewerRunning: Boolean(context.viewerRunning),
      executionMode: settings.BUILD_EXECUTION_MODE,
      effectiveMode: worldExecutor.resolveMode(settings.BUILD_EXECUTION_MODE, context.currentBot),
      serverRights: serverRights.getStatus(context.currentBot),
      hasEnvFile: envManager.hasEnvFile(),
      llmProvider: (context.llmRouter || llmRouter).getActiveProviderName()
    });
  });

  // --- FABRIC BYPASS & MINECRAFT INSTANCE ROUTES ---
  app.get('/api/fabric/instances', (req, res) => {
    try {
      const instances = detectMinecraftInstances();
      const best = findBestMatchingInstance(settings.MC_VERSION);
      res.json({ success: true, instances, bestMatch: best });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/fabric/install-bypass', async (req, res) => {
    try {
      const targetModsDir = req.body?.modsDir || null;
      const result = await installBypassMod(targetModsDir);
      if (result.success) {
        logger.info(`[FabricRoutes] Bypass Fabric Check Mod erfolgreich installiert: ${result.targetPath}`);
        res.json({ success: true, ...result });
      } else {
        res.status(500).json({ success: false, error: result.error });
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- PRISMARINE-VIEWER STREAM CONTROL ROUTES ---
  app.get('/api/viewer/status', (req, res) => {
    res.json({
      success: true,
      enabled: Boolean(settings.ENABLE_PRISMARINE_VIEWER),
      running: Boolean(context.viewerRunning),
      port: settings.PRISMARINE_VIEWER_PORT
    });
  });

  app.post('/api/viewer/toggle', (req, res) => {
    try {
      const currentEnabled = Boolean(settings.ENABLE_PRISMARINE_VIEWER);
      const targetEnabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !currentEnabled;
      const persist = req.body?.persist !== false;

      if (persist) {
        envManager.saveConfig({ ENABLE_PRISMARINE_VIEWER: targetEnabled });
      }

      if (typeof context.setViewerEnabled === 'function') {
        context.setViewerEnabled(targetEnabled);
      } else {
        settings.ENABLE_PRISMARINE_VIEWER = targetEnabled;
        context.broadcast({
          type: 'viewer_state_changed',
          enabled: targetEnabled,
          running: false,
          port: settings.PRISMARINE_VIEWER_PORT
        });
      }

      res.json({
        success: true,
        enabled: targetEnabled,
        running: Boolean(context.viewerRunning),
        port: settings.PRISMARINE_VIEWER_PORT,
        message: targetEnabled ? 'Prismarine-Viewer gestartet' : 'Prismarine-Viewer gestoppt'
      });
    } catch (err) {
      logger.error(`[Viewer] Fehler bei POST /api/viewer/toggle: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // --- MINECRAFT LAN AUTO-DISCOVERY & QUICK-CONNECT ROUTES ---
  app.get('/api/lan/worlds', (req, res) => {
    try {
      const worlds = lanDiscoveryService.getDiscoveredWorlds();
      res.json({
        success: true,
        count: worlds.length,
        worlds
      });
    } catch (err) {
      logger.error(`[LanDiscovery] Fehler bei GET /api/lan/worlds: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/lan/connect', async (req, res) => {
    try {
      let { host, port, botOwner, botUsername, saveToEnv = true } = req.body || {};

      if (!port) {
        const worlds = lanDiscoveryService.getDiscoveredWorlds();
        if (worlds.length > 0) {
          port = worlds[0].port;
          host = host || worlds[0].host;
        }
      }

      const resolvedPort = parseInt(port, 10);
      if (Number.isNaN(resolvedPort) || resolvedPort < 1 || resolvedPort > 65535) {
        return res.status(400).json({ success: false, error: 'Ungültiger oder fehlender Port für Minecraft LAN-Welt.' });
      }

      const resolvedHost = (host && typeof host === 'string' && host.trim()) ? host.trim() : '127.0.0.1';
      const resolvedOwner = (botOwner && typeof botOwner === 'string' && botOwner.trim()) ? botOwner.trim() : (settings.BOT_OWNER || 'Player');
      let resolvedUsername = (botUsername && typeof botUsername === 'string' && botUsername.trim()) ? botUsername.trim() : (settings.MC_USERNAME || 'BaumeisterKI');

      // Namenskollisions-Schutz: Wenn Bot denselben Namen wie der LAN-Host hat, wird der Bot sofort mit "Already connected" gekickt.
      if (resolvedUsername.toLowerCase() === resolvedOwner.toLowerCase()) {
        resolvedUsername = (resolvedOwner.toLowerCase() !== 'baumeisterki') ? 'BaumeisterKI' : `${resolvedOwner}_Bot`;
      }

      const lanConfig = {
        MC_HOST: resolvedHost,
        MC_PORT: resolvedPort,
        MC_AUTH: 'offline', // LAN-Welten laufen immer im Offline-Modus
        MC_USERNAME: resolvedUsername,
        BOT_OWNER: resolvedOwner,
        ONBOARDING_COMPLETED: true
      };

      if (saveToEnv) {
        envManager.saveConfig(lanConfig);
      } else {
        Object.assign(settings, lanConfig);
      }

      const activeBotClient = context.botClient || (await import('../../bot/botClient.js').catch(() => ({}))).botClient;
      if (activeBotClient) {
        if (typeof activeBotClient.reconnect === 'function') {
          activeBotClient.reconnect();
        } else if (typeof activeBotClient.start === 'function') {
          activeBotClient.start();
        }
      }

      context.broadcast({
        type: 'settings_updated',
        hasEnvFile: envManager.hasEnvFile(),
        isFullyConfigured: envManager.isFullyConfigured(),
        settings: envManager.getCurrentSettings(),
        reconnected: true
      });

      res.json({
        success: true,
        message: `Verbindung zur Minecraft LAN-Welt auf ${resolvedHost}:${resolvedPort} wird aufgebaut...`,
        config: lanConfig
      });
    } catch (err) {
      logger.error(`[LanConnect] Fehler bei POST /api/lan/connect: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
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

      // Live-Viewer State synchronisieren, falls in den Einstellungen geändert
      if (req.body && req.body.ENABLE_PRISMARINE_VIEWER !== undefined && typeof context.setViewerEnabled === 'function') {
        context.setViewerEnabled(req.body.ENABLE_PRISMARINE_VIEWER);
      }

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

  app.post('/api/settings/sleep-disconnect', (req, res) => {
    try {
      const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !settings.SLEEP_DISCONNECT_ON_NO_BED;
      sleepController.setNightDisconnectEnabled(enabled);
      envManager.saveConfig({ SLEEP_DISCONNECT_ON_NO_BED: enabled });
      context.broadcast({
        type: 'night_disconnect_toggled',
        enabled,
        settings: envManager.getCurrentSettings()
      });
      res.json({ success: true, enabled, settings: envManager.getCurrentSettings() });
    } catch (err) {
      logger.error(`[Settings] Fehler bei POST /api/settings/sleep-disconnect: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/settings/toggle-chat', (req, res) => {
    try {
      const enabled = req.body?.enabled !== undefined ? Boolean(req.body.enabled) : !settings.ENABLE_MINECRAFT_CHAT;
      settings.ENABLE_MINECRAFT_CHAT = enabled;
      envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: enabled });
      context.broadcast({
        type: 'settings_updated',
        settings: envManager.getCurrentSettings()
      });
      res.json({ success: true, enabled, settings: envManager.getCurrentSettings() });
    } catch (err) {
      logger.error(`[Settings] Fehler bei POST /api/settings/toggle-chat: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/setup', async (req, res) => {
    try {
      const setupConfig = Object.assign({}, req.body || {}, { ONBOARDING_COMPLETED: true });
      const result = envManager.saveConfig(setupConfig);

      if (setupConfig.ENABLE_PRISMARINE_VIEWER !== undefined && typeof context.setViewerEnabled === 'function') {
        context.setViewerEnabled(setupConfig.ENABLE_PRISMARINE_VIEWER);
      }

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

  // Cached 26.3 Block-Katalog
  let cachedBlocks = null;
  app.get('/api/blocks', (req, res) => {
    try {
      if (!cachedBlocks) {
        const blocksPath = path.resolve('src/config/data/26.3/blocks.json');
        if (fs.existsSync(blocksPath)) {
          const raw = JSON.parse(fs.readFileSync(blocksPath, 'utf8'));
          cachedBlocks = raw
            .filter(b => b.name && !['air', 'cave_air', 'void_air', 'structure_void'].includes(b.name))
            .map(b => ({
              id: b.id,
              name: b.name,
              displayName: b.displayName || b.name,
              material: b.material || 'default',
              transparent: Boolean(b.transparent)
            }));
        } else {
          cachedBlocks = [];
        }
      }
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.json({ success: true, count: cachedBlocks.length, blocks: cachedBlocks });
    } catch (err) {
      logger.error(`[BlocksAPI] Fehler bei GET /api/blocks: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
