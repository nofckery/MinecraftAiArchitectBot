import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { WebSocketServer, WebSocket } from 'ws';
import prismarineViewer from 'prismarine-viewer';
import { Vec3 } from 'vec3';
import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;

import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { undoManager } from '../world/undoManager.js';
import { rotateLocalToWorld } from '../builder/stateTransform.js';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { StructuralLinter } from '../builder/structuralLinter.js';
import { sessionHandoff } from '../bot/sessionHandoff.js';
import { llmRouter } from '../ai/llmRouter.js';
import { schematicManager } from '../builder/schematicManager.js';
import { worldScanner } from '../world/worldScanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class DashboardServer {
  constructor() {
    this.app = null;
    this.httpServer = null;
    this.wss = null;
    this.currentBot = null;
    this.architectAgent = null;
    this.telemetryInterval = null;
    this.viewerRunning = false;
    this.chatHistory = [];
    this.lastVoxelPreview = null;
    this.activeCanvas = null;
    this.isRunning = false;
  }

  init(botClient) {
    if (botClient) {
      this.currentBot = botClient.bot;
      this.architectAgent = botClient.architectAgent;

      if (this.architectAgent) {
        this.architectAgent.on('preview', (previewData) => {
          this.broadcastVoxelPreview(previewData);
        });
      }
    }
    sessionHandoff.setDashboardServer(this);
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;

    this.app = express();
    this.app.use(express.json());
    const publicDir = path.join(__dirname, 'public');
    this.app.use(express.static(publicDir));
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

    this.app.get('/api/status', (req, res) => {
      res.json({
        status: sessionHandoff.state,
        botConnected: !!(this.currentBot && this.currentBot.entity),
        viewerPort: settings.PRISMARINE_VIEWER_PORT,
        executionMode: settings.BUILD_EXECUTION_MODE,
        llmProvider: llmRouter.getActiveProviderName()
      });
    });

    // Sektion 6: Schematic REST-Endpunkte
    this.app.get('/api/schematics', (req, res) => {
      const dir = path.resolve('data/schematics');
      if (!fs.existsSync(dir)) {
        return res.json({ files: [] });
      }
      try {
        const allowedExts = ['.schem', '.schematic', '.litematic', '.nbt'];
        const files = fs.readdirSync(dir)
          .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return allowedExts.includes(ext);
          })
          .map(file => {
            const filePath = path.join(dir, file);
            const stats = fs.statSync(filePath);
            return {
              name: file,
              size: stats.size,
              format: path.extname(file).replace('.', '').toLowerCase(),
              modified: stats.mtime
            };
          });
        res.json({ files });
      } catch (err) {
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/schematics/upload', upload.single('file'), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: 'Keine Datei hochgeladen.' });
        }
        const allowedExts = ['.schem', '.schematic', '.litematic', '.nbt'];
        const ext = path.extname(req.file.originalname).toLowerCase();
        if (!allowedExts.includes(ext)) {
          return res.status(400).json({ error: `Nicht unterstütztes Format: ${ext}. Erlaubt: .schem, .schematic, .litematic, .nbt` });
        }

        const safeFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
        // Erst validieren und entpacken, bevor die Datei gespeichert wird
        const canvas = await schematicManager.loadIntoCanvas(req.file.buffer, safeFilename);
        this.activeCanvas = canvas;

        const savePath = path.resolve('data/schematics', safeFilename);
        fs.writeFileSync(savePath, req.file.buffer);

        const bounds = canvas.getBounds();
        const siteInfo = this.architectAgent ? this.architectAgent.getEffectiveSiteInfo() : {
          origin: { x: 0, y: 64, z: 0 },
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height,
          facing: 'north'
        };

        if (this.architectAgent) {
          this.architectAgent.lastBuildState = {
            code: `// Imported schematic: ${safeFilename}`,
            origin: { ...siteInfo.origin },
            width: bounds.width,
            height: bounds.height,
            depth: bounds.depth,
            facing: siteInfo.facing || 'north',
            canvas
          };
        }

        const lintReport = StructuralLinter.analyze(canvas);
        this.broadcastVoxelPreview({
          canvas,
          lintReport,
          siteInfo,
          userRequest: `Import: ${safeFilename}`
        });

        this.recordChat('SYSTEM', `Schematic '${safeFilename}' erfolgreich importiert (${canvas.blocks.size} Blöcke).`);
        res.json({ success: true, filename: safeFilename, blockCount: canvas.blocks.size });
      } catch (err) {
        logger.error(`Fehler beim Schematic-Upload: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    this.app.post('/api/schematics/import-url', async (req, res) => {
      try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL fehlt.' });

        let parsedUrl;
        try {
          parsedUrl = new URL(url);
        } catch {
          return res.status(400).json({ error: 'Ungültiges URL-Format.' });
        }

        const allowedExts = ['.schem', '.schematic', '.litematic', '.nbt'];
        let filename = path.basename(parsedUrl.pathname);
        let ext = path.extname(filename).toLowerCase();

        if (!allowedExts.includes(ext)) {
          // Prüfe Query-Parameter auf Dateinamen
          for (const val of parsedUrl.searchParams.values()) {
            const paramExt = path.extname(val).toLowerCase();
            if (allowedExts.includes(paramExt)) {
              filename = path.basename(val);
              ext = paramExt;
              break;
            }
          }
        }

        if (!allowedExts.includes(ext)) {
          return res.status(400).json({ error: `Ungültige Dateiendung: ${ext || 'keine'}. Erlaubt: .schem, .schematic, .litematic, .nbt` });
        }

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Download fehlgeschlagen mit HTTP ${response.status}`);
        }
        const arrayBuf = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);

        const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const canvas = await schematicManager.loadIntoCanvas(buffer, safeFilename);
        this.activeCanvas = canvas;

        const savePath = path.resolve('data/schematics', safeFilename);
        fs.writeFileSync(savePath, buffer);

        const bounds = canvas.getBounds();
        const siteInfo = this.architectAgent ? this.architectAgent.getEffectiveSiteInfo() : {
          origin: { x: 0, y: 64, z: 0 },
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height,
          facing: 'north'
        };

        if (this.architectAgent) {
          this.architectAgent.lastBuildState = {
            code: `// Imported schematic from URL: ${safeFilename}`,
            origin: { ...siteInfo.origin },
            width: bounds.width,
            height: bounds.height,
            depth: bounds.depth,
            facing: siteInfo.facing || 'north',
            canvas
          };
        }

        const lintReport = StructuralLinter.analyze(canvas);
        this.broadcastVoxelPreview({
          canvas,
          lintReport,
          siteInfo,
          userRequest: `URL-Import: ${safeFilename}`
        });

        this.recordChat('SYSTEM', `Schematic von URL '${safeFilename}' geladen (${canvas.blocks.size} Blöcke).`);
        res.json({ success: true, filename: safeFilename, blockCount: canvas.blocks.size });
      } catch (err) {
        logger.error(`Fehler beim Schematic-URL-Import: ${err.message}`);
        res.status(500).json({ error: err.message });
      }
    });

    this.app.get('/api/schematics/export/:name', async (req, res) => {
      try {
        const canvas = this.activeCanvas || this.architectAgent?.lastBuildState?.canvas;
        if (!canvas) {
          return res.status(400).send('Kein aktiver Bauplan zum Exportieren vorhanden.');
        }
        const rawName = req.params.name || 'export';
        const format = (req.query.format || (rawName.endsWith('.nbt') ? 'nbt' : 'schem')).toLowerCase();
        const safeName = path.basename(rawName).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'export';

        if (format === 'nbt') {
          const buffer = await schematicManager.exportCanvasToNbt(canvas, safeName);
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.nbt"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.send(buffer);
        } else {
          const buffer = await schematicManager.exportCanvasToSchem(canvas, safeName);
          res.setHeader('Content-Disposition', `attachment; filename="${safeName}.schem"`);
          res.setHeader('Content-Type', 'application/octet-stream');
          res.send(buffer);
        }
      } catch (err) {
        logger.error(`Fehler beim Schematic-Export: ${err.message}`);
        res.status(500).send(`Exportfehler: ${err.message}`);
      }
    });

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
        username: this.currentBot?.username || settings.MC_USERNAME || 'BaumeisterKI'
      }));

      if (this.chatHistory.length > 0) {
        ws.send(JSON.stringify({
          type: 'chat_history',
          history: this.chatHistory
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

  startViewer(bot) {
    if (this.viewerRunning || this.activeViewer) {
      if (this.activeViewer?.close) {
        try {
          this.activeViewer.close();
        } catch {
          // Ignorieren
        }
      } else if (this.currentBot?.viewer?.close) {
        try {
          this.currentBot.viewer.close();
        } catch {
          // Ignorieren
        }
      }
      this.activeViewer = null;
      this.viewerRunning = false;
    }

    try {
      const viewerFn = prismarineViewer.mineflayer || (prismarineViewer.default && prismarineViewer.default.mineflayer);
      if (viewerFn) {
        viewerFn(bot, {
          port: settings.PRISMARINE_VIEWER_PORT,
          firstPerson: true
        });
        this.activeViewer = bot.viewer || null;
        this.viewerRunning = true;
        logger.info(`Prismarine-Viewer gestartet auf http://localhost:${settings.PRISMARINE_VIEWER_PORT}`);
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
    const buildProgress = worldExecutor.getProgress();
    const llmProvider = llmRouter.getActiveProviderName();

    const telemetryMsg = {
      type: 'bot_telemetry',
      pos,
      yaw,
      pitch,
      health,
      food,
      mode,
      buildProgress,
      llmProvider,
      status: sessionHandoff.state,
      username: bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
    };

    this.broadcast(telemetryMsg);
  }

  generateAreaMapData() {
    const bot = this.currentBot;
    const grid = [];
    const centerPos = bot?.entity?.position || new Vec3(0, 64, 0);
    const cx = Math.floor(centerPos.x);
    const cz = Math.floor(centerPos.z);
    const cy = Math.floor(centerPos.y);

    for (let dx = -32; dx < 32; dx++) {
      for (let dz = -32; dz < 32; dz++) {
        const x = cx + dx;
        const z = cz + dz;
        let foundY = cy;
        let blockName = 'grass_block';

        if (bot && typeof bot.blockAt === 'function') {
          for (let y = cy + 15; y >= Math.max(bot.game?.minY ?? -64, cy - 25); y--) {
            const b = bot.blockAt(new Vec3(x, y, z));
            if (b && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air') {
              foundY = y;
              blockName = b.name;
              break;
            }
          }
        } else {
          // Deterministisches Fallback-Muster für Offline-/Dev-Modus
          const isStone = Math.abs(x + z) % 9 === 0;
          const isWater = Math.abs(x - z) % 17 === 0;
          blockName = isWater ? 'water' : isStone ? 'stone' : 'grass_block';
        }

        grid.push({ x, z, y: foundY, blockName });
      }
    }

    const isSimulated = !bot || typeof bot.blockAt !== 'function';
    return { grid, center: { x: cx, y: cy, z: cz }, isSimulated };
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
    const type = data.type;

    if (type === 'set_build_box') {
      const { minX, minZ, maxX, maxZ, baseY, facing } = data;
      if (this.architectAgent) {
        this.architectAgent.setCustomBounds({ minX, minZ, maxX, maxZ, baseY, facing });
        const w = Math.abs(maxX - minX) + 1;
        const d = Math.abs(maxZ - minZ) + 1;
        this.recordChat('SYSTEM', `Bauplatz auf 2D-Karte markiert: ${w}x${d} Blöcke (Front: ${facing}). Ersetzt Wolle-Marker.`);
      }
      return;
    }

    if (type === 'request_area_map') {
      const mapData = this.generateAreaMapData();
      ws.send(JSON.stringify({
        type: 'area_map_data',
        grid: mapData.grid,
        center: mapData.center
      }));
      return;
    }

    if (type === 'prompt_architect') {
      const text = (data.text || '').trim();
      const autoExecute = !!data.autoExecute;
      if (!text) return;

      this.recordChat(settings.BOT_OWNER || 'Besitzer', text);

      if (!this.architectAgent) {
        this.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
        return;
      }

      this.recordChat('BaumeisterKI', `Plane Architektur für: "${text}"...`);

      try {
        const siteInfo = this.architectAgent.getEffectiveSiteInfo();
        let result;
        const isImported = !!(this.architectAgent.lastBuildState?.code?.includes('Imported schematic'));

        if (isImported) {
          result = await this.architectAgent.remixImportedSchematic(text);
          this.activeCanvas = result.canvas;
        } else {
          const isMod = !!(this.architectAgent.lastBuildState && /änder|ergänz|mach das|balkon|dach|stockwerk/i.test(text));
          result = await this.architectAgent.synthesizeBuild(text, siteInfo, isMod);
        }

        this.recordChat(
          'BaumeisterKI',
          `Entwurf fertiggestellt! (${result.canvas.blocks.size} Blöcke, Detailgrad: ${Math.round(result.lintReport.detailRatio * 100)}%). Siehe 3D-Vorschau.`
        );

        if (autoExecute) {
          await this.executeVoxelCanvasBuild(result.canvas, siteInfo, text);
        }
      } catch (err) {
        this.recordChat('BaumeisterKI', `Planungsfehler: ${err.message}`);
        logger.error(`Architektenfehler bei Web-Prompt: ${err.message}`);
      }
      return;
    }

    if (type === 'confirm_build') {
      if (!this.architectAgent?.lastBuildState?.canvas) {
        this.recordChat('SYSTEM', 'Kein Entwurf vorhanden. Bitte zuerst einen Bauplan über den Chat anfordern.');
        return;
      }

      const canvas = this.architectAgent.lastBuildState.canvas;
      const siteInfo = this.architectAgent.getEffectiveSiteInfo();
      await this.executeVoxelCanvasBuild(canvas, siteInfo, 'Dashboard-Freigabe');
      return;
    }

    if (type === 'control_action') {
      const action = data.action;

      if (action === 'stop') {
        worldExecutor.abort();
        this.recordChat('SYSTEM', 'Not-Stopp ausgeführt! Bauauftrag abgebrochen.');
        return;
      }

      if (action === 'undo') {
        if (worldExecutor.isBuilding) {
          this.recordChat('SYSTEM', 'Bitte stoppe zuerst den laufenden Bau, bevor du ein Rollback machst.');
          return;
        }
        this.recordChat('SYSTEM', 'Starte Rollback des letzten Bauwerks aus dem Snapshot-Journal...');
        try {
          const undone = await undoManager.executeUndo(this.currentBot, worldExecutor);
          if (undone) {
            this.recordChat('SYSTEM', `Rollback für '${undone.buildTitle}' abgeschlossen (${undone.blockCount} Blöcke).`);
          } else {
            this.recordChat('SYSTEM', 'Kein Snapshot im Undo-Journal vorhanden.');
          }
        } catch (err) {
          this.recordChat('SYSTEM', `Fehler beim Rollback: ${err.message}`);
        }
        return;
      }

      if (action === 'pause_for_player') {
        sessionHandoff.releaseAccount();
        this.recordChat('SYSTEM', 'Account für menschlichen Spieler freigegeben. Bot pausiert.');
        return;
      }

      if (action === 'resume_bot') {
        sessionHandoff.resumeBot();
        this.recordChat('SYSTEM', 'Bot-Wiederaufnahme angefordert. Cooldown läuft...');
        return;
      }

      if (action === 'move_to') {
        const target = data.targetPos;
        if (!this.currentBot) {
          this.recordChat('SYSTEM', 'Bot ist nicht online.');
          return;
        }
        if (this.currentBot.pathfinder && target) {
          const tx = Number(target.x);
          const ty = typeof target.y === 'number' && !Number.isNaN(target.y) ? target.y : (this.currentBot.entity?.position?.y || 64);
          const tz = Number(target.z);

          if (!Number.isNaN(tx) && !Number.isNaN(tz)) {
            this.recordChat('SYSTEM', `Schicke Bot zu Koordinate (${Math.round(tx)}, ${Math.round(ty)}, ${Math.round(tz)})...`);
            try {
              this.currentBot.pathfinder.setGoal(new goals.GoalNear(tx, ty, tz, 2));
            } catch (err) {
              this.recordChat('SYSTEM', `Pathfinder-Fehler: ${err.message}`);
            }
          } else {
            this.recordChat('SYSTEM', 'Ungültige Koordinaten für move_to empfangen.');
          }
        } else {
          this.recordChat('SYSTEM', 'Pathfinder nicht verfügbar oder ungültige Koordinate.');
        }
        return;
      }
    }

    // Sektion 6: Neue CAD- und Schematic-Aktionen
    if (type === 'swap_material') {
      const { fromBlock, toBlock, smartGroupSwap } = data;
      const canvas = this.activeCanvas || this.architectAgent?.lastBuildState?.canvas;
      if (!canvas) return;

      const count = canvas.swapMaterial(fromBlock, toBlock, !!smartGroupSwap);
      this.recordChat('SYSTEM', `Material getauscht: ${count} Blöcke von '${fromBlock}' nach '${toBlock}'.`);

      const lintReport = StructuralLinter.analyze(canvas);
      const siteInfo = this.architectAgent?.lastBuildState?.siteInfo || this.architectAgent?.getEffectiveSiteInfo() || {
        origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
      };

      this.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Palette Swap: ${fromBlock} -> ${toBlock}`
      });
      return;
    }

    if (type === 'apply_theme') {
      const { theme } = data;
      const canvas = this.activeCanvas || this.architectAgent?.lastBuildState?.canvas;
      if (!canvas) return;

      const THEME_MAP = {
        medieval_spruce: { wood: 'spruce_planks', stone: 'stone_bricks', label: 'Mittelalter-Fichte' },
        deepslate_gothic: { wood: 'dark_oak_planks', stone: 'deepslate_bricks', label: 'Deepslate-Gotik' },
        desert_sandstone: { wood: 'birch_planks', stone: 'sandstone', label: 'Wüsten-Sandstein' },
        cherry_asian: { wood: 'cherry_planks', stone: 'blackstone', label: 'Kirschblüten-Asiatisch' }
      };

      const preset = THEME_MAP[theme];
      if (!preset) return;

      // Ermittle dominante Holz- und Steinart im aktiven Bauwerk
      const woodCounts = {};
      const stoneCounts = {};
      const WOOD_KEYS = ['dark_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
      const KNOWN_STONES = ['stone_bricks', 'cobblestone', 'deepslate_bricks', 'deepslate_tiles', 'sandstone', 'blackstone', 'granite', 'diorite', 'andesite', 'stone'];

      for (const key of canvas.getAllBlockKeys()) {
        const blk = canvas.getByKey(key);
        if (!blk || !blk.name) continue;
        const name = blk.name;

        for (const w of WOOD_KEYS) {
          if (w === 'oak' ? (name.includes('oak') && !name.includes('dark_oak')) : name.includes(w)) {
            woodCounts[w] = (woodCounts[w] || 0) + 1;
            break;
          }
        }

        for (const s of KNOWN_STONES) {
          if (name.includes(s) || name === s) {
            stoneCounts[s] = (stoneCounts[s] || 0) + 1;
            break;
          }
        }
      }

      const dominantWood = Object.entries(woodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'oak';
      const dominantStone = Object.entries(stoneCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'stone_bricks';

      const woodSwapped = canvas.swapMaterial(`${dominantWood}_planks`, preset.wood, true);
      const stoneSwapped = canvas.swapMaterial(dominantStone, preset.stone, true);

      this.recordChat('SYSTEM', `Theme '${preset.label}' angewendet: ${woodSwapped + stoneSwapped} Blöcke aktualisiert.`);

      const lintReport = StructuralLinter.analyze(canvas);
      const siteInfo = this.architectAgent?.lastBuildState?.siteInfo || this.architectAgent?.getEffectiveSiteInfo() || {
        origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
      };

      this.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Theme: ${preset.label}`
      });
      return;
    }

    if (type === 'transform_canvas') {
      const { transformMode } = data;
      const canvas = this.activeCanvas || this.architectAgent?.lastBuildState?.canvas;
      if (!canvas) return;

      canvas.applySymmetryOrTransform(transformMode);
      this.recordChat('SYSTEM', `Transformation '${transformMode}' angewendet.`);

      const lintReport = StructuralLinter.analyze(canvas);
      const siteInfo = this.architectAgent?.lastBuildState?.siteInfo || this.architectAgent?.getEffectiveSiteInfo() || {
        origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
      };

      if (this.architectAgent?.lastBuildState) {
        this.architectAgent.lastBuildState.width = canvas.width;
        this.architectAgent.lastBuildState.depth = canvas.depth;
        this.architectAgent.lastBuildState.height = canvas.height;
        this.architectAgent.lastBuildState.facing = canvas.facing || siteInfo.facing;
      }

      this.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Transform: ${transformMode}`
      });
      return;
    }

    if (type === 'manual_voxel_edit') {
      const { x, y, z, blockString } = data;
      let canvas = this.activeCanvas || this.architectAgent?.lastBuildState?.canvas;
      if (!canvas) {
        canvas = new VoxelCanvas(32, 32, 32);
        this.activeCanvas = canvas;
      }

      canvas.set(x, y, z, blockString || 'air');
      const lintReport = StructuralLinter.analyze(canvas);
      const siteInfo = this.architectAgent?.lastBuildState?.siteInfo || this.architectAgent?.getEffectiveSiteInfo() || {
        origin: { x: 0, y: 64, z: 0 }, width: canvas.width, depth: canvas.depth, height: canvas.height, facing: 'north'
      };

      if (this.architectAgent) {
        if (!this.architectAgent.lastBuildState) {
          const bounds = canvas.getBounds();
          this.architectAgent.lastBuildState = {
            code: '// Manual edit',
            origin: { ...siteInfo.origin },
            width: bounds.width || canvas.width,
            height: bounds.height || canvas.height,
            depth: bounds.depth || canvas.depth,
            facing: siteInfo.facing || 'north',
            canvas
          };
        } else {
          this.architectAgent.lastBuildState.canvas = canvas;
        }
      }

      this.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Voxel Edit (${x},${y},${z})`
      });

      this.broadcast({
        type: 'voxel_delta',
        x, y, z,
        blockString: blockString || 'air'
      });
      return;
    }

    if (type === 'region_ai_edit') {
      const { instruction, selectionBox } = data;
      if (!this.architectAgent) {
        this.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
        return;
      }

      if (this.activeCanvas && (!this.architectAgent.lastBuildState || this.architectAgent.lastBuildState.canvas !== this.activeCanvas)) {
        const bounds = this.activeCanvas.getBounds();
        const siteInfo = this.architectAgent.getEffectiveSiteInfo();
        this.architectAgent.lastBuildState = {
          code: '// Active canvas',
          origin: { ...siteInfo.origin },
          width: bounds.width || this.activeCanvas.width,
          height: bounds.height || this.activeCanvas.height,
          depth: bounds.depth || this.activeCanvas.depth,
          facing: siteInfo.facing || 'north',
          canvas: this.activeCanvas
        };
      }

      this.recordChat(settings.BOT_OWNER || 'Besitzer', `[Bereichs-Edit] ${instruction}`);
      this.recordChat('BaumeisterKI', `Überarbeite markierten Bereich (${selectionBox.minX}..${selectionBox.maxX}, ${selectionBox.minY}..${selectionBox.maxY}, ${selectionBox.minZ}..${selectionBox.maxZ})...`);

      try {
        const result = await this.architectAgent.refineRegionWithAI(instruction, selectionBox);
        this.activeCanvas = result.canvas;
        this.broadcastVoxelPreview({
          canvas: result.canvas,
          lintReport: result.lintReport,
          siteInfo: this.architectAgent.lastBuildState || this.architectAgent.getEffectiveSiteInfo(),
          userRequest: `[Bereichs-Edit] ${instruction}`
        });
        this.recordChat('BaumeisterKI', 'Bereich erfolgreich überarbeitet! Siehe 3D-Vorschau.');
      } catch (err) {
        this.recordChat('BaumeisterKI', `Fehler beim Bereichs-Edit: ${err.message}`);
        logger.error(`Fehler bei region_ai_edit: ${err.message}`);
      }
      return;
    }

    if (type === 'clone_server_region') {
      const { minX, minY, minZ, maxX, maxY, maxZ } = data;
      if (!this.currentBot) {
        this.recordChat('SYSTEM', 'Bot ist nicht online. Server-Bereich kann nicht geklont werden.');
        return;
      }
      const normMinX = Math.min(Number(minX || 0), Number(maxX || 0));
      const normMaxX = Math.max(Number(minX || 0), Number(maxX || 0));
      const normMinY = Math.min(Number(minY || 0), Number(maxY || 0));
      const normMaxY = Math.max(Number(minY || 0), Number(maxY || 0));
      const normMinZ = Math.min(Number(minZ || 0), Number(maxZ || 0));
      const normMaxZ = Math.max(Number(minZ || 0), Number(maxZ || 0));

      try {
        const canvas = await schematicManager.cloneWorldRegionToCanvas(
          this.currentBot,
          { x: normMinX, y: normMinY, z: normMinZ },
          { x: normMaxX, y: normMaxY, z: normMaxZ }
        );
        this.activeCanvas = canvas;
        const siteInfo = {
          origin: { x: normMinX, y: normMinY, z: normMinZ },
          width: canvas.width,
          depth: canvas.depth,
          height: canvas.height,
          facing: 'north'
        };
        if (this.architectAgent) {
          this.architectAgent.lastBuildState = {
            code: '// Cloned region from server',
            origin: { ...siteInfo.origin },
            width: canvas.width,
            height: canvas.height,
            depth: canvas.depth,
            facing: 'north',
            canvas
          };
        }
        const lintReport = StructuralLinter.analyze(canvas);
        this.broadcastVoxelPreview({
          canvas,
          lintReport,
          siteInfo,
          userRequest: `Server-Klon (${normMinX},${normMinY},${normMinZ})`
        });
        this.recordChat('SYSTEM', `Server-Bereich erfolgreich geklont (${canvas.blocks.size} Blöcke).`);
      } catch (err) {
        this.recordChat('SYSTEM', `Fehler beim Klonen der Welt: ${err.message}`);
      }
      return;
    }

    if (type === 'load_saved_schematic') {
      const { filename } = data;
      try {
        const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const filePath = path.resolve('data/schematics', safeName);
        if (!fs.existsSync(filePath)) {
          this.recordChat('SYSTEM', `Datei '${safeName}' existiert nicht in data/schematics/.`);
          return;
        }
        const buffer = fs.readFileSync(filePath);
        const canvas = await schematicManager.loadIntoCanvas(buffer, safeName);
        this.activeCanvas = canvas;

        const bounds = canvas.getBounds();
        const siteInfo = this.architectAgent ? this.architectAgent.getEffectiveSiteInfo() : {
          origin: { x: 0, y: 64, z: 0 }, width: bounds.width, depth: bounds.depth, height: bounds.height, facing: 'north'
        };

        if (this.architectAgent) {
          this.architectAgent.lastBuildState = {
            code: `// Loaded schematic: ${safeName}`,
            origin: { ...siteInfo.origin },
            width: bounds.width,
            height: bounds.height,
            depth: bounds.depth,
            facing: siteInfo.facing || 'north',
            canvas
          };
        }

        const lintReport = StructuralLinter.analyze(canvas);
        this.broadcastVoxelPreview({
          canvas,
          lintReport,
          siteInfo,
          userRequest: `Schematic: ${safeName}`
        });
        this.recordChat('SYSTEM', `Schematic '${safeName}' geladen (${canvas.blocks.size} Blöcke).`);
      } catch (err) {
        this.recordChat('SYSTEM', `Fehler beim Laden: ${err.message}`);
      }
      return;
    }

    if (type === 'request_terrain_xray') {
      const siteInfo = this.architectAgent?.customSiteInfo || (this.currentBot ? worldScanner.scanBuildSite(this.currentBot) : null);
      const bounds = (this.activeCanvas || this.architectAgent?.lastBuildState?.canvas)?.getBounds() || { width: 16, height: 16, depth: 16 };
      const origin = siteInfo?.origin || { x: 0, y: 64, z: 0 };
      const groundY = siteInfo?.groundY ?? origin.y;
      const width = siteInfo?.width || bounds.width || 16;
      const depth = siteInfo?.depth || bounds.depth || 16;
      const height = bounds.height || 16;

      const xrayBlocks = [];

      if (this.currentBot && typeof this.currentBot.blockAt === 'function') {
        for (let x = origin.x; x < origin.x + width; x++) {
          for (let z = origin.z; z < origin.z + depth; z++) {
            for (let y = groundY - 4; y <= groundY + height; y++) {
              const b = this.currentBot.blockAt(new Vec3(x, y, z));
              if (b && b.name && b.name !== 'air' && b.name !== 'cave_air' && b.name !== 'void_air' && b.name !== 'structure_void') {
                const isCollision = y >= groundY;
                const isFoundationSupport = y < groundY;
                xrayBlocks.push({
                  x: x - origin.x,
                  y: y - groundY,
                  z: z - origin.z,
                  name: b.name,
                  isCollision,
                  isFoundationSupport
                });
              }
            }
          }
        }
      } else {
        // Deterministische X-Ray Simulation im Offline-Modus
        for (let x = 0; x < width; x++) {
          for (let z = 0; z < depth; z++) {
            xrayBlocks.push({
              x, y: -1, z, name: 'dirt', isCollision: false, isFoundationSupport: true
            });
            if ((x + z) % 7 === 0) {
              xrayBlocks.push({
                x, y: 0, z, name: 'oak_log', isCollision: true, isFoundationSupport: false
              });
            }
          }
        }
      }

      const isSimulated = !this.currentBot || typeof this.currentBot.blockAt !== 'function';
      ws.send(JSON.stringify({
        type: 'terrain_xray_data',
        blocks: xrayBlocks,
        isSimulated
      }));
      return;
    }
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
