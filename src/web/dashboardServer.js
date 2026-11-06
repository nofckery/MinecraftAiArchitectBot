import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import prismarineViewer from 'prismarine-viewer';

import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { undoManager } from '../world/undoManager.js';
import { rotateLocalToWorld } from '../builder/stateTransform.js';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { StructuralLinter } from '../builder/structuralLinter.js';
import { sessionHandoff } from '../bot/sessionHandoff.js';
import { llmRouter } from '../ai/llmRouter.js';
import { EndpointManager } from '../ai/endpointManager.js';
import { SafeProbeWorker } from '../ai/safeProbeWorker.js';
import { DeviceFlowManager } from '../security/deviceFlowManager.js';
import { localModelScanner, LocalModelScanner } from '../ai/localModelScanner.js';
import { envManager } from '../config/envManager.js';
import { serverRights } from '../bot/serverRights.js';
import { msaAuthManager } from '../security/msaAuthManager.js';
import { VersionResolver } from '../config/versionResolver.js';
import { ViewerStateTranslator } from './services/viewerStateTranslator.js';

import { generateAreaMapData, generateTerrainXray } from './services/terrainMapService.js';
import { registerBaseRoutes } from './routes/baseRoutes.js';
import { registerSchematicRoutes } from './routes/schematicRoutes.js';
import { registerModelApiRoutes } from './routes/modelRoutes.js';
import { handleClientWsMessage } from './ws/dashboardWsDispatcher.js';
import { manualController } from '../bot/manualController.js';

const SUPPORTED_VIEWER_ENTITIES = new Set([
  'armor_stand', 'arrow', 'bat', 'bee', 'blaze', 'boat', 'cat', 'cave_spider', 'chest_minecart',
  'chicken', 'cod', 'command_block_minecart', 'cow', 'creeper', 'dolphin', 'donkey', 'dragon_fireball',
  'drowned', 'egg', 'elder_guardian', 'ender_dragon', 'ender_pearl', 'enderman', 'endermite',
  'evoker', 'evoker_fangs', 'experience_bottle', 'experience_orb', 'eye_of_ender', 'fireball',
  'firework_rocket', 'fishing_bobber', 'fox', 'ghast', 'guardian', 'hoglin', 'hopper_minecart',
  'horse', 'husk', 'iron_golem', 'leash_knot', 'llama', 'llama_spit', 'magma_cube', 'minecart',
  'mooshroom', 'mule', 'ocelot', 'panda', 'parrot', 'phantom', 'pig', 'piglin', 'piglin_brute',
  'pillager', 'player', 'polar_bear', 'potion', 'pufferfish', 'rabbit', 'ravager', 'salmon',
  'sheep', 'shulker', 'shulker_bullet', 'silverfish', 'skeleton', 'skeleton_horse', 'slime',
  'small_fireball', 'snow_golem', 'snowball', 'spider', 'squid', 'stray', 'strider', 'tnt_minecart',
  'trident', 'tropical_fish', 'turtle', 'vex', 'villager', 'vindicator', 'wandering_trader',
  'witch', 'wither', 'wither_skeleton', 'wither_skull', 'wolf', 'zoglin', 'zombie', 'zombie_horse',
  'zombie_villager', 'zombified_piglin'
]);

function sanitizeViewerEntity(entity) {
  if (!entity) return entity;
  const name = entity.name;
  if (!name || typeof name !== 'string') return entity;

  if (SUPPORTED_VIEWER_ENTITIES.has(name)) return entity;

  // Map variants to existing models where possible
  let mapped = null;
  if (name.includes('boat') || name.includes('raft')) mapped = 'boat';
  else if (name.includes('squid')) mapped = 'squid';
  else if (name.includes('ghast')) mapped = 'ghast';
  else if (name.includes('zombie')) mapped = 'zombie';
  else if (name.includes('skeleton')) mapped = 'skeleton';
  else if (name.includes('spider')) mapped = 'spider';
  else if (name.includes('minecart')) mapped = 'minecart';
  else if (name.includes('horse')) mapped = 'horse';

  const finalName = mapped && SUPPORTED_VIEWER_ENTITIES.has(mapped) ? mapped : undefined;

  return new Proxy(entity, {
    get(target, prop, receiver) {
      if (prop === 'name') return finalName;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    // Milestone M6: Dependency Injection
    this.endpointManager = options.endpointManager || null;
    this.safeProbeWorker = options.safeProbeWorker || null;
    this.deviceFlowManager = options.deviceFlowManager || null;
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
    if (services.localModelScanner) this.localModelScanner = services.localModelScanner;
    if (services.llmRouter) this.llmRouter = services.llmRouter;

    sessionHandoff.setDashboardServer(this);
  }

  async ensureServices() {
    if (!this.endpointManager) {
      this.endpointManager = new EndpointManager();
      await this.endpointManager.init();
    }
    if (!this.safeProbeWorker) {
      this.safeProbeWorker = new SafeProbeWorker();
    }
    if (!this.localModelScanner) {
      this.localModelScanner = localModelScanner || new LocalModelScanner();
    }
    if (!this.deviceFlowManager) {
      this.deviceFlowManager = new DeviceFlowManager({
        endpointManager: this.endpointManager,
        llmRouter: this.llmRouter || llmRouter
      });
    }

    this.wireServiceEvents();
  }

  wireServiceEvents() {
    if (this._eventsWired) return;
    this._eventsWired = true;

    if (this.endpointManager) {
      this.endpointManager.on('endpoint_status_change', (evt) => {
        this.broadcast({ type: 'endpoint_status_change', ...evt });
      });
      this.endpointManager.on('tier_activated', (evt) => {
        this.broadcast({ type: 'tier_activated', ...evt });
      });
      this.endpointManager.on('endpoint_created', (ep) => {
        this.broadcast({ type: 'endpoint_created', endpoint: ep });
      });
      this.endpointManager.on('endpoint_updated', (ep) => {
        this.broadcast({ type: 'endpoint_updated', endpoint: ep });
      });
      this.endpointManager.on('endpoint_deleted', (id) => {
        this.broadcast({ type: 'endpoint_deleted', id });
      });
    }

    if (this.safeProbeWorker) {
      this.safeProbeWorker.on('progress', (prog) => {
        this.broadcast({ type: 'probe_progress', ...prog });
      });
    }

    if (this.deviceFlowManager) {
      this.deviceFlowManager.on('authenticated', (evt) => {
        this.broadcast({ type: 'device_auth_success', ...evt });
      });
      this.deviceFlowManager.on('device_auth_success', (evt) => {
        this.broadcast({ type: 'device_auth_success', ...evt });
      });
    }

    // Microsoft Authentication Events
    msaAuthManager.on('code', (session) => {
      this.broadcast({
        type: 'msa_code',
        userCode: session.userCode,
        verificationUri: session.verificationUri,
        directUrl: session.directUrl,
        expiresIn: session.expiresIn,
        message: session.message,
        username: session.username
      });
    });

    msaAuthManager.on('success', (session) => {
      this.broadcast({
        type: 'msa_success',
        username: session.profile?.name || session.username,
        profile: session.profile
      });
    });

    msaAuthManager.on('error', (err) => {
      this.broadcast({
        type: 'msa_error',
        error: err.error || err.message,
        username: err.username
      });
    });
  }

  setupApp() {
    if (this.app) return this.app;
    this.app = express();

    // 1. Zero-CORS & Zero-PNA Middleware
    this.app.use('/api', (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
      next();
    });

    this.app.use(express.json());
    const publicDir = path.join(__dirname, 'public');
    this.app.use(express.static(publicDir));
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

    // Initialize backend services in background
    this.ensureServices().catch(err => {
      logger.warn(`[DashboardServer] Service-Initialisierung im Hintergrund: ${err.message}`);
    });

    this.registerBaseRoutes();
    this.registerSchematicRoutes(upload);
    this.registerModelApiRoutes();

    return this.app;
  }

  registerBaseRoutes() {
    registerBaseRoutes(this.app, this);
  }

  registerSchematicRoutes(upload) {
    registerSchematicRoutes(this.app, upload, this);
  }

  registerModelApiRoutes() {
    registerModelApiRoutes(this.app, this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.setupApp();

    this.httpServer = http.createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      logger.debug('Neuer Mission-Control Dashboard Client verbunden.');

      // 1. Initialen Status und Historie senden
      ws.send(JSON.stringify({
        type: 'status',
        state: sessionHandoff.state,
        viewerPort: settings.PRISMARINE_VIEWER_PORT,
        mode: settings.BUILD_EXECUTION_MODE,
        effectiveMode: worldExecutor.resolveMode(settings.BUILD_EXECUTION_MODE, this.currentBot),
        serverRights: serverRights.getStatus(this.currentBot),
        hasEnvFile: envManager.hasEnvFile(),
        username: this.currentBot?.username || settings.MC_USERNAME || 'BaumeisterKI'
      }));

      // Initialen Gamemode-Status an neu verbundenen Client senden
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

      // Aktive MSA-Sitzung falls vorhanden
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

      // 2. Letzte Voxel-Vorschau senden
      if (this.lastVoxelPreview) {
        ws.send(JSON.stringify(this.lastVoxelPreview));
      }

      // 3. Karten-Daten generieren und senden
      const mapData = this.generateAreaMapData();
      ws.send(JSON.stringify({
        type: 'area_map_data',
        grid: mapData.grid,
        center: mapData.center
      }));

      // Disconnection & Error Safety: Releasing manual controls on disconnect
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

      // Nachrichten vom Dashboard-Client verarbeiten
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(data, ws);
        } catch (err) {
          logger.warn(`Ungültige Nachricht vom Web-Client empfangen: ${err.message}`);
        }
      });
    });

    // 500ms Telemetrie-Loop
    this.telemetryInterval = setInterval(() => {
      this.sendTelemetry();
    }, 500);

    const port = settings.WEB_DASHBOARD_PORT || 3080;
    this.httpServer.listen(port, () => {
      logger.info(`Architect Mission Control Web-UI aktiv auf: http://localhost:${port}`);
    });
  }

  stop() {
    this.isRunning = false;
    this.operatorSocket = null;
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
    if (this.activeViewer && typeof this.activeViewer.close === 'function') {
      try {
        this.activeViewer.close();
      } catch {
        // Ignorieren
      }
      this.activeViewer = null;
      this.viewerRunning = false;
    }
    if (this.deviceFlowManager && typeof this.deviceFlowManager.destroy === 'function') {
      this.deviceFlowManager.destroy();
    }
    this.app = null;
  }

  onBotSpawn(bot) {
    if (this.currentBot && this.currentBot !== bot && this.currentBot.viewer?.close) {
      try {
        this.currentBot.viewer.close();
      } catch {
        // Ignorieren
      }
    }
    this.currentBot = bot;
    this.startViewer(bot);

    // Initiales Karten-Raster broadcasten
    setTimeout(() => {
      const mapData = this.generateAreaMapData();
      this.broadcast({
        type: 'area_map_data',
        grid: mapData.grid,
        center: mapData.center
      });
    }, 1500);
  }

  stopViewer() {
    if (this.activeViewer?.close) {
      try {
        this.activeViewer.close();
      } catch {}
    } else if (this.currentBot?.viewer?.close) {
      try {
        this.currentBot.viewer.close();
      } catch {}
    }
    this.activeViewer = null;
    this.viewerRunning = false;
  }

  startViewer(bot) {
    if (this.viewerRunning || this.activeViewer) {
      this.stopViewer();
    }

    try {
      const viewerFn = prismarineViewer.mineflayer || (prismarineViewer.default && prismarineViewer.default.mineflayer);
      if (viewerFn) {
        // 1. Version Compatibility & State-ID Translation for Web Client
        // Binds ViewerStateTranslator to translate chunk palettes and block updates
        // between bot version (e.g. 26.3 / 1.20.4) and target viewer assets (1.21.4 / 1.20.1).
        const targetViewerVersion = VersionResolver.resolveViewerVersion(bot.version);
        const translator = ViewerStateTranslator.create(bot.version, targetViewerVersion);
        const viewerBot = translator.createViewerBotProxy(bot, sanitizeViewerEntity);
        logger.info(`[Prismarine-Viewer] State-Translator aktiv: Bot-Version '${bot.version}' -> Viewer-Assets '${targetViewerVersion}'`);

        // 2. http.createServer abfangen, um unhandled EADDRINUSE Exceptions zu verhindern
        const origCreateServer = http.createServer;
        http.createServer = function(...args) {
          const srv = origCreateServer.apply(this, args);
          srv.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
              logger.warn(`[Prismarine-Viewer] Port ${settings.PRISMARINE_VIEWER_PORT} belegt (EADDRINUSE). Stream wird fortgesetzt sobald Port frei ist.`);
            } else {
              logger.warn(`[Prismarine-Viewer] Serverfehler: ${err.message}`);
            }
          });
          return srv;
        };

        try {
          viewerFn(viewerBot, {
            port: settings.PRISMARINE_VIEWER_PORT,
            firstPerson: true
          });
          this.activeViewer = viewerBot.viewer || bot.viewer || null;
          this.viewerRunning = true;
          logger.info(`Prismarine-Viewer gestartet auf http://localhost:${settings.PRISMARINE_VIEWER_PORT}`);
        } finally {
          http.createServer = origCreateServer;
        }
      }
    } catch (err) {
      logger.warn(`Konnte Prismarine-Viewer nicht initialisieren: ${err.message}`);
    }
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
    const bot = this.currentBot;
    if (bot && manualController.bot !== bot) {
      manualController.setBot(bot);
    }

    const pos = bot?.entity?.position ? {
      x: Math.round(bot.entity.position.x * 10) / 10,
      y: Math.round(bot.entity.position.y * 10) / 10,
      z: Math.round(bot.entity.position.z * 10) / 10
    } : { x: 0, y: 0, z: 0 };

    const yaw = bot?.entity?.yaw || 0;
    const pitch = bot?.entity?.pitch || 0;
    const health = bot?.health ?? 20;
    const food = bot?.food ?? 20;
    const mode = settings.BUILD_EXECUTION_MODE;
    const effectiveMode = worldExecutor.resolveMode(settings.BUILD_EXECUTION_MODE, bot);
    const rights = serverRights.getStatus(bot);
    const buildProgress = worldExecutor.getProgress();
    const llmProvider = (this.llmRouter || llmRouter).getActiveProviderName();

    // 1. Hotbar (9 slots: 0..8)
    const selectedSlot = bot?.quickBarSlot ?? 0;
    const hotbar = [];
    const slots = bot?.inventory?.slots;
    const rawHotbar = (typeof manualController.getHotbarInfo === 'function') ? manualController.getHotbarInfo() : [];

    for (let i = 0; i < 9; i++) {
      const slotItem = slots ? slots[36 + i] : null;
      const hotbarEntry = rawHotbar.find(h => h.slot === i);
      const item = slotItem || hotbarEntry?.item || (hotbarEntry?.name ? hotbarEntry : null);
      hotbar.push({
        slot: i,
        name: item ? (item.name ?? null) : null,
        displayName: item ? (item.displayName || item.name || 'Empty') : 'Empty',
        count: item ? (item.count ?? 0) : 0,
        selected: i === selectedSlot,
        durabilityUsed: item?.durabilityUsed ?? 0
      });
    }

    // 2. Cursor raycast inspection data (target block or entity)
    let raycast = {
      type: 'none',
      name: null,
      displayName: null,
      distance: null,
      position: null
    };

    try {
      const target = (typeof manualController.inspectTarget === 'function')
        ? manualController.inspectTarget(4.5)
        : null;

      if (target) {
        const targetType = (target.kind === 'entity' || target.type === 'entity') ? 'entity' : 'block';
        raycast = {
          type: targetType,
          name: target.name || null,
          displayName: target.displayName || target.name || (targetType === 'entity' ? 'Entity' : 'Block'),
          distance: typeof target.distance === 'number' ? target.distance : null,
          position: target.position || (target.id && bot?.entities?.[target.id]?.position ? {
            x: Math.round(bot.entities[target.id].position.x * 10) / 10,
            y: Math.round(bot.entities[target.id].position.y * 10) / 10,
            z: Math.round(bot.entities[target.id].position.z * 10) / 10
          } : null)
        };
      }
    } catch (err) {
      logger.debug(`[Telemetry] Raycast-Inspektionsfehler: ${err.message}`);
    }

    // 3. Manual control status
    const manualControl = {
      active: manualController.isActive(),
      selectedSlot,
      controls: manualController.getActiveControls()
    };

    const telemetryMsg = {
      type: 'bot_telemetry',
      pos,
      yaw,
      pitch,
      health,
      food,
      mode,
      effectiveMode,
      serverRights: rights,
      buildProgress,
      llmProvider,
      status: sessionHandoff.state,
      username: bot?.username || settings.MC_USERNAME || 'BaumeisterKI',
      manualControl,
      hotbar,
      raycast
    };

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
