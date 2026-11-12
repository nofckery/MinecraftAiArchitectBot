import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { undoManager } from '../world/undoManager.js';
import { rotateLocalToWorld } from '../builder/stateTransform.js';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { StructuralLinter } from '../builder/structuralLinter.js';
import { sessionHandoff } from '../bot/sessionHandoff.js';
import { llmRouter } from '../ai/llmRouter.js';
import { envManager } from '../config/envManager.js';
import { serverRights } from '../bot/serverRights.js';
import { msaAuthManager } from '../security/msaAuthManager.js';

import { generateAreaMapData, generateTerrainXray } from './services/terrainMapService.js';
import { registerBaseRoutes } from './routes/baseRoutes.js';
import { registerSchematicRoutes } from './routes/schematicRoutes.js';
import { registerCadStudioRoutes } from './routes/cadStudioRoutes.js';
import { registerModelApiRoutes } from './routes/modelRoutes.js';
import { handleClientWsMessage } from './ws/dashboardWsDispatcher.js';
import { manualController } from '../bot/manualController.js';
import { sanitizeViewerEntity, SUPPORTED_VIEWER_ENTITIES } from './services/viewerEntitySanitizer.js';
import { buildBotTelemetry } from './services/dashboardTelemetryService.js';
import { lanDiscoveryService } from '../network/lanDiscoveryService.js';

import { startViewer, stopViewer, setViewerEnabled } from './server/viewerService.js';
import { ensureServices, wireServiceEvents } from './server/dashboardServiceWire.js';
import { setupExpressApp } from './server/dashboardAppSetup.js';

export { sanitizeViewerEntity, SUPPORTED_VIEWER_ENTITIES };

export class DashboardServer {
  constructor(options = {}) {
    this.app = null;
    this.httpServer = null;
    this.wss = null;
    this.currentBot = null;
    this.botClient = options.botClient || null;
    this.architectAgent = null;
    this.telemetryInterval = null;
    this.viewerRunning = false;
    this.chatHistory = [];
    this.lastVoxelPreview = null;
    this.activeCanvas = null;
    this.isRunning = false;
    this.operatorSocket = null;
    this.port = options.port !== undefined ? options.port : null;

    // Milestone M6: Dependency Injection
    this.endpointManager = options.endpointManager || null;
    this.safeProbeWorker = options.safeProbeWorker || null;
    this.deviceFlowManager = options.deviceFlowManager || null;
    this.pkceAuthManager = options.pkceAuthManager || null;
    this.localModelScanner = options.localModelScanner || null;
    this.llmRouter = options.llmRouter || null;
    this._eventsWired = false;
  }

  init(botClient, services = {}) {
    if (botClient) {
      this.botClient = botClient;
      this.currentBot = botClient.bot || botClient;
      this.architectAgent = botClient.architectAgent;

      if (this.architectAgent) {
        this.architectAgent.on('preview', (previewData) => {
          this.broadcastVoxelPreview(previewData);
        });
      }
    }

    serverRights.onChange((rightsStatus) => {
      this.broadcast({
        type: 'server_rights_updated',
        ...rightsStatus
      });
    });

    if (services.endpointManager) this.endpointManager = services.endpointManager;
    if (services.safeProbeWorker) this.safeProbeWorker = services.safeProbeWorker;
    if (services.deviceFlowManager) this.deviceFlowManager = services.deviceFlowManager;
    if (services.pkceAuthManager) this.pkceAuthManager = services.pkceAuthManager;
    if (services.localModelScanner) this.localModelScanner = services.localModelScanner;
    if (services.llmRouter) this.llmRouter = services.llmRouter;

    sessionHandoff.setDashboardServer(this);
  }

  async ensureServices() {
    return ensureServices(this);
  }

  wireServiceEvents() {
    return wireServiceEvents(this);
  }

  setupApp() {
    return setupExpressApp(this);
  }

  registerBaseRoutes() {
    registerBaseRoutes(this.app, this);
  }

  registerSchematicRoutes(upload) {
    registerSchematicRoutes(this.app, upload, this);
  }

  registerCadStudioRoutes() {
    registerCadStudioRoutes(this.app, this);
  }

  registerModelApiRoutes() {
    registerModelApiRoutes(this.app, this);
  }

  start(portOverride) {
    if (this.isRunning) return Promise.resolve(this.httpServer);
    this.isRunning = true;

    this.setupApp();

    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws, req) => {
      if (settings.DASHBOARD_PASSWORD && settings.DASHBOARD_PASSWORD.length > 0) {
        let isAuthorized = false;
        try {
          const urlObj = new URL(req?.url || '', 'http://localhost');
          const token = urlObj.searchParams.get('token') ||
            urlObj.searchParams.get('auth') ||
            req?.headers?.['x-dashboard-token'];
          isAuthorized = (token === settings.DASHBOARD_PASSWORD);
        } catch {
          isAuthorized = false;
        }

        if (!isAuthorized) {
          ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Dashboard-Passwort ungültig' }));
          ws.close(4001, 'Unauthorized');
          return;
        }
      }

      logger.debug('Neuer Mission-Control Dashboard Client verbunden.');

      // 1. Initialen Status und Historie senden
      const activeState = (this.botClient && this.botClient.state === 'FABRIC_MISMATCH')
        ? 'FABRIC_MISMATCH'
        : (this.botClient?.state || sessionHandoff.state);

      ws.send(JSON.stringify({
        type: 'status',
        state: activeState,
        botConnected: !!(this.currentBot && this.currentBot.entity),
        botRunning: this.botClient ? this.botClient.shouldRun : false,
        viewerPort: settings.PRISMARINE_VIEWER_PORT,
        mode: settings.BUILD_EXECUTION_MODE,
        effectiveMode: worldExecutor.resolveMode(settings.BUILD_EXECUTION_MODE, this.currentBot),
        serverRights: serverRights.getStatus(this.currentBot),
        hasEnvFile: envManager.hasEnvFile(),
        isFullyConfigured: envManager.isFullyConfigured(),
        username: this.currentBot?.username || settings.MC_USERNAME || ''
      }));

      if (this.botClient?.lastKickClassification) {
        ws.send(JSON.stringify({
          type: 'bot_kick_diagnostic',
          classification: this.botClient.lastKickClassification,
          reason: this.botClient.lastKickReason || ''
        }));
      }

      ws.send(JSON.stringify({
        type: 'manual_control_state',
        active: manualController.isActive(),
        selectedSlot: this.currentBot?.quickBarSlot ?? 0
      }));

      if (this.chatHistory.length > 0) {
        ws.send(JSON.stringify({
          type: 'chat_history',
          history: this.chatHistory
        }));
      }

      const activeMsa = msaAuthManager.getActiveSession();
      if (activeMsa && activeMsa.status === 'pending') {
        ws.send(JSON.stringify({
          type: 'msa_code',
          userCode: activeMsa.userCode,
          verificationUri: activeMsa.verificationUri,
          directUrl: activeMsa.directUrl,
          expiresIn: Math.max(0, Math.floor((activeMsa.expiresAt - Date.now()) / 1000)),
          message: activeMsa.message,
          username: activeMsa.username
        }));
      }

      if (this.lastVoxelPreview) {
        ws.send(JSON.stringify(this.lastVoxelPreview));
      }

      const mapData = this.generateAreaMapData();
      ws.send(JSON.stringify({
        type: 'area_map_data',
        grid: mapData.grid,
        center: mapData.center
      }));

      ws.send(JSON.stringify({
        type: 'viewer_state_changed',
        enabled: Boolean(settings.ENABLE_PRISMARINE_VIEWER),
        running: Boolean(this.viewerRunning),
        port: settings.PRISMARINE_VIEWER_PORT
      }));

      const lanWorlds = lanDiscoveryService.getDiscoveredWorlds();
      if (lanWorlds.length > 0) {
        ws.send(JSON.stringify({
          type: 'lan_worlds_updated',
          worlds: lanWorlds
        }));
      }

      const handleDisconnect = () => {
        if (this.operatorSocket === ws || (!this.operatorSocket && manualController.isActive())) {
          logger.warn('[ManualControl] Operator-Verbindung getrennt/geschlossen. Deaktiviere Gamemode & Standby Handoff...');
          this.operatorSocket = null;
          manualController.deactivate();
          this.broadcast({
            type: 'manual_control_state',
            active: false,
            selectedSlot: this.currentBot?.quickBarSlot ?? 0
          });
        }
      };

      ws.on('close', handleDisconnect);
      ws.on('error', (err) => {
        logger.debug(`[WebSocket] Client-Fehler: ${err?.message || err}`);
        handleDisconnect();
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(data, ws);
        } catch (err) {
          logger.warn(`Ungültige Nachricht vom Web-Client empfangen: ${err.message}`);
        }
      });
    });

    this.telemetryInterval = setInterval(() => {
      this.sendTelemetry();
    }, 500);

    lanDiscoveryService.start();
    if (!this._lanUpdateHandler) {
      this._lanUpdateHandler = (worlds) => {
        this.broadcast({
          type: 'lan_worlds_updated',
          worlds
        });
      };
      lanDiscoveryService.on('worlds_updated', this._lanUpdateHandler);
    }

    const port = portOverride !== undefined ? portOverride : (this.port !== null && this.port !== undefined ? this.port : (settings.WEB_DASHBOARD_PORT || 3080));
    return new Promise((resolve, reject) => {
      this.httpServer.listen(port, () => {
        const boundPort = this.httpServer.address()?.port || port;
        logger.info(`Architect Mission Control Web-UI aktiv auf: http://localhost:${boundPort}`);
        resolve(this.httpServer);
      });
      this.httpServer.on('error', (err) => {
        logger.warn(`[DashboardServer] Fehler beim Starten des HTTP-Servers: ${err.message}`);
        reject(err);
      });
    });
  }

  stop() {
    this.isRunning = false;
    this.operatorSocket = null;
    if (this._lanUpdateHandler) {
      lanDiscoveryService.removeListener('worlds_updated', this._lanUpdateHandler);
      this._lanUpdateHandler = null;
    }
    lanDiscoveryService.stop();
    if (this.telemetryInterval) {
      clearInterval(this.telemetryInterval);
      this.telemetryInterval = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
    this.stopViewer(false);
    if (this.deviceFlowManager && typeof this.deviceFlowManager.destroy === 'function') {
      this.deviceFlowManager.destroy();
    }
    this.app = null;
  }

  onBotSpawn(bot) {
    if (this.currentBot && this.currentBot !== bot) {
      this.stopViewer(false);
    }
    this.currentBot = bot;
    if (settings.ENABLE_PRISMARINE_VIEWER !== false) {
      this.startViewer(bot);
    } else {
      logger.info('[Prismarine-Viewer] Viewer ist in den Einstellungen deaktiviert (Ressourcenschonender Modus).');
      this.broadcast({
        type: 'viewer_state_changed',
        enabled: false,
        running: false,
        port: settings.PRISMARINE_VIEWER_PORT
      });
    }

    try {
      if (bot.inventory && typeof bot.inventory.on === 'function') {
        bot.inventory.on('updateSlot', () => this.sendTelemetry());
      }
      bot.on('windowOpen', () => this.sendTelemetry());
      bot.on('windowClose', () => this.sendTelemetry());
      bot.on('health', () => this.sendTelemetry());
      bot.on('death', () => this.sendTelemetry());
      bot.on('respawn', () => this.sendTelemetry());
      bot.on('playerJoined', () => this.sendTelemetry());
      bot.on('playerLeft', () => this.sendTelemetry());
      bot.on('playerUpdated', () => this.sendTelemetry());
      bot.on('end', () => {
        this.stopViewer();
        this.sendTelemetry();
      });
      bot.on('kicked', () => {
        this.stopViewer();
        this.sendTelemetry();
      });
      if (bot._client && typeof bot._client.on === 'function') {
        bot._client.on('playerlist_header', () => this.sendTelemetry());
      }
    } catch {}

    setTimeout(() => {
      const mapData = this.generateAreaMapData();
      this.broadcast({
        type: 'area_map_data',
        grid: mapData.grid,
        center: mapData.center
      });
    }, 1500);
  }

  stopViewer(notifyClients = true) {
    return stopViewer(this, notifyClients);
  }

  setViewerEnabled(enabled) {
    return setViewerEnabled(this, enabled);
  }

  startViewer(bot = this.currentBot) {
    return startViewer(this, bot);
  }

  broadcast(obj) {
    if (!this.wss) return;
    const msg = JSON.stringify(obj);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    }
  }

  recordChat(sender, message) {
    const entry = {
      type: 'chat_log',
      sender,
      message,
      timestamp: Date.now()
    };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > 80) {
      this.chatHistory.shift();
    }
    this.broadcast(entry);
  }

  sendTelemetry() {
    const telemetryMsg = buildBotTelemetry({
      bot: this.currentBot,
      controller: manualController,
      router: this.llmRouter || llmRouter,
      executor: worldExecutor
    });
    this.broadcast(telemetryMsg);
  }

  generateAreaMapData(bot = this.currentBot) {
    return generateAreaMapData(bot);
  }

  broadcastVoxelPreview(previewData) {
    const { canvas, lintReport, siteInfo, userRequest } = previewData;
    const blocks = [];
    const bom = {};

    for (const key of canvas.getAllBlockKeys()) {
      const b = canvas.getByKey(key);
      const { x, y, z } = canvas.parseKey(key);
      const name = b.name || b.blockState?.name || 'stone';
      const properties = b.properties || b.blockState?.properties || {};
      blocks.push({ x, y, z, name, properties });
      bom[name] = (bom[name] || 0) + 1;
    }

    const asciiReport = StructuralLinter.generateAsciiBlueprint(canvas);
    const bounds = canvas.getBounds();

    const payload = {
      type: 'voxel_preview',
      blocks,
      bounds,
      bom,
      asciiReport,
      lintReport,
      siteInfo,
      userRequest: userRequest || 'Bauplan'
    };

    this.activeCanvas = canvas;
    this.lastVoxelPreview = payload;
    this.broadcast(payload);
  }

  async handleClientMessage(data, ws) {
    return handleClientWsMessage(data, ws, this);
  }

  async executeVoxelCanvasBuild(canvas, siteInfo, title = 'Bauauftrag') {
    const bot = this.currentBot;
    if (!bot || !bot.entity) {
      this.recordChat('SYSTEM', 'Bot ist aktuell nicht auf dem Server eingeloggt. Bauausführung nicht möglich.');
      return;
    }

    if (worldExecutor.isBuilding) {
      this.recordChat('SYSTEM', 'Ein anderer Bauauftrag läuft bereits.');
      return;
    }

    const bounds = canvas.getBounds();
    const worldBlocks = [];

    for (const key of canvas.getAllBlockKeys()) {
      const localBlock = canvas.getByKey(key);
      const { x, y, z } = canvas.parseKey(key);
      const rotated = rotateLocalToWorld(x, y, z, localBlock, bounds.width, bounds.depth, siteInfo.facing);

      worldBlocks.push({
        x: siteInfo.origin.x + rotated.x,
        y: siteInfo.origin.y + rotated.y,
        z: siteInfo.origin.z + rotated.z,
        blockState: rotated.blockState,
        fullBlockString: VoxelCanvas.toBlockString(rotated.blockState)
      });
    }

    this.recordChat('BaumeisterKI', `Erstelle Undo-Snapshot & starte Bauausführung (${worldBlocks.length} Blöcke)...`);
    undoManager.captureSnapshot(bot, worldBlocks, title.slice(0, 30));

    try {
      const success = await worldExecutor.executeBatch(bot, worldBlocks, { title });
      if (success) {
        this.recordChat('BaumeisterKI', `Fertiggestellt! Das Bauwerk steht bei (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z}).`);
      } else if (worldExecutor.pausedState) {
        this.recordChat('BaumeisterKI', 'Bauauftrag wurde pausiert (Session-Handoff).');
      } else {
        this.recordChat('BaumeisterKI', 'Bauausführung wurde unterbrochen oder abgebrochen.');
      }
    } catch (err) {
      this.recordChat('BaumeisterKI', `Baufehler: ${err.message}`);
      logger.error(`Fehler bei Bauausführung: ${err.message}`);
    }
  }
}

export const dashboardServer = new DashboardServer();
export { generateAreaMapData, generateTerrainXray };
