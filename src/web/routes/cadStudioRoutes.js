import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import { schematicManager } from '../../builder/schematicManager.js';
import { StructuralLinter } from '../../builder/structuralLinter.js';
import { VoxelCanvas } from '../../builder/voxelCanvas.js';
import { rotateLocalToWorld } from '../../builder/stateTransform.js';
import { discoverLocalWorldsAndSchematics } from '../../utils/minecraftInstanceDetector.js';
import {
  scan3DTerrainRelief,
  analyzeSceneVerifier,
  generateSmartPathBetweenObjects
} from '../services/terrainMapService.js';

/**
 * Registers CAD World Studio REST API routes:
 * - Discovery of local worlds, external schematics & projects
 * - Hybrid 3D terrain relief scans
 * - Scene-graph object loading
 * - Litematica verifier & smart road generator
 * - Multi-object CAD project management (save, load, list, delete)
 * - Composite multi-object scene export (.schem / .nbt)
 *
 * @param {import('express').Express} app - Express application
 * @param {Object} context - Server coordinator context
 */
export function registerCadStudioRoutes(app, context) {
  const schematicsDir = path.resolve('data/schematics');
  if (!fs.existsSync(schematicsDir)) {
    fs.mkdirSync(schematicsDir, { recursive: true });
  }

  const projectsDir = path.resolve('data/cad_projects');
  if (!fs.existsSync(projectsDir)) {
    fs.mkdirSync(projectsDir, { recursive: true });
  }

  // 1. Auto-Discovery lokaler Minecraft-Welten (.mca), externer Litematica-Schematics & gespeicherter Projekte
  app.get('/api/cad/discovery', (req, res) => {
    try {
      const discovered = discoverLocalWorldsAndSchematics();
      const localSchematics = [];
      if (fs.existsSync(schematicsDir)) {
        const allowedExts = ['.schem', '.schematic', '.litematic', '.nbt'];
        for (const file of fs.readdirSync(schematicsDir)) {
          const ext = path.extname(file).toLowerCase();
          if (!allowedExts.includes(ext)) continue;
          const fp = path.join(schematicsDir, file);
          const st = fs.statSync(fp);
          localSchematics.push({
            name: file,
            size: st.size,
            format: ext.replace('.', ''),
            modified: st.mtime
          });
        }
      }

      const projects = [];
      if (fs.existsSync(projectsDir)) {
        for (const file of fs.readdirSync(projectsDir)) {
          if (!file.endsWith('.json')) continue;
          try {
            const fp = path.join(projectsDir, file);
            const st = fs.statSync(fp);
            const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
            projects.push({
              filename: file,
              name: raw.name || file.replace(/\.json$/i, ''),
              objectCount: Array.isArray(raw.objects) ? raw.objects.length : 0,
              updatedAt: raw.updatedAt || st.mtimeMs
            });
          } catch {}
        }
      }

      res.json({
        success: true,
        botOnline: Boolean(context.currentBot && context.currentBot.entity),
        botPosition: context.currentBot?.entity?.position
          ? {
              x: Math.floor(context.currentBot.entity.position.x),
              y: Math.floor(context.currentBot.entity.position.y),
              z: Math.floor(context.currentBot.entity.position.z)
            }
          : null,
        worlds: discovered.worlds,
        externalSchematics: discovered.externalSchematics,
        localSchematics,
        projects
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Hybrider 3D Terrain- & Relief-Scanner (Bot Live-Chunks / Anvil .mca / Simulation)
  app.post('/api/cad/scan-terrain', (req, res) => {
    try {
      const { worldId, worldDir, centerX, centerY, centerZ, radius, includeFoliage } = req.body || {};
      let resolvedWorldDir = worldDir || null;

      if (!resolvedWorldDir && worldId) {
        try {
          const decoded = Buffer.from(String(worldId), 'base64url').toString('utf8');
          if (fs.existsSync(decoded)) {
            resolvedWorldDir = decoded;
          }
        } catch {}
      }

      const scanResult = scan3DTerrainRelief(context.currentBot, {
        worldDir: resolvedWorldDir,
        centerX,
        centerY,
        centerZ,
        radius: radius || 32,
        includeFoliage: includeFoliage !== false
      });

      context.lastScannedTerrain = scanResult;
      if (context.architectAgent && typeof context.architectAgent.setStudioTerrainContext === 'function') {
        context.architectAgent.setStudioTerrainContext(scanResult);
      }

      res.json({
        success: true,
        terrain: scanResult
      });
    } catch (err) {
      logger.error(`[CAD Studio] Terrain-Scan Fehler: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Einzelnes Schematic als eigenständiges Scene-Graph-Objekt laden
  app.post('/api/cad/load-object', async (req, res) => {
    try {
      const { filename, externalId, fullPath, customName } = req.body || {};
      let targetPath = null;
      let displayFilename = filename || 'model.schem';

      if (filename) {
        const safeName = path.basename(filename);
        targetPath = path.resolve(schematicsDir, safeName);
        displayFilename = safeName;
      } else if (externalId) {
        const decoded = Buffer.from(String(externalId), 'base64url').toString('utf8');
        if (fs.existsSync(decoded)) {
          targetPath = decoded;
          displayFilename = path.basename(decoded);
        }
      } else if (fullPath && fs.existsSync(fullPath)) {
        targetPath = path.resolve(fullPath);
        displayFilename = path.basename(targetPath);
      }

      if (!targetPath || !fs.existsSync(targetPath)) {
        return res.status(404).json({ success: false, error: 'Schematic-Datei nicht gefunden.' });
      }

      const buffer = fs.readFileSync(targetPath);
      const canvas = await schematicManager.loadIntoCanvas(buffer, displayFilename);
      const bounds = canvas.getBounds();
      const blocks = [];
      const bom = {};
      const doorways = [];

      for (const key of canvas.getAllBlockKeys()) {
        const b = canvas.getByKey(key);
        const { x, y, z } = canvas.parseKey(key);
        const name = b.name || 'stone';
        const properties = b.properties || {};
        blocks.push({ x, y, z, name, properties });
        bom[name] = (bom[name] || 0) + 1;
        if (name.includes('_door') && properties.half !== 'upper') {
          doorways.push({ x, y, z, facing: properties.facing || 'north' });
        }
      }

      const lintReport = StructuralLinter.analyze(canvas);

      res.json({
        success: true,
        objectData: {
          name: customName || displayFilename.replace(/\.[^/.]+$/, ''),
          sourceFilename: displayFilename,
          bounds,
          blocks,
          bom,
          doorways,
          lintPassed: lintReport.passed,
          detailRatio: lintReport.detailRatio
        }
      });
    } catch (err) {
      logger.error(`[CAD Studio] Fehler beim Laden des Scene-Objekts: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Litematica Verifier & Smart Path Berechnung via REST
  app.post('/api/cad/verify-scene', (req, res) => {
    try {
      const { objects, terrain } = req.body || {};
      const activeTerrain = terrain || context.lastScannedTerrain || scan3DTerrainRelief(context.currentBot, { radius: 32 });
      const report = analyzeSceneVerifier(activeTerrain, Array.isArray(objects) ? objects : []);
      res.json({ success: true, report });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/cad/generate-path', (req, res) => {
    try {
      const { objectA, objectB, options, terrain } = req.body || {};
      if (!objectA || !objectB) {
        return res.status(400).json({ success: false, error: 'Zwei Objekte (objectA, objectB) für Weg-Generierung erforderlich.' });
      }
      const activeTerrain = terrain || context.lastScannedTerrain || scan3DTerrainRelief(context.currentBot, { radius: 32 });
      const pathObject = generateSmartPathBetweenObjects(activeTerrain, objectA, objectB, options || {});
      res.json({ success: true, pathObject });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. CAD Studio Projekt-Speicherung (data/cad_projects/*.json)
  app.get('/api/cad/projects', (req, res) => {
    try {
      const projects = [];
      if (fs.existsSync(projectsDir)) {
        for (const file of fs.readdirSync(projectsDir)) {
          if (!file.endsWith('.json')) continue;
          try {
            const fp = path.join(projectsDir, file);
            const raw = JSON.parse(fs.readFileSync(fp, 'utf8'));
            projects.push({
              filename: file,
              name: raw.name || file.replace(/\.json$/i, ''),
              objectCount: Array.isArray(raw.objects) ? raw.objects.length : 0,
              updatedAt: raw.updatedAt || Date.now()
            });
          } catch {}
        }
      }
      res.json({ success: true, projects });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/cad/projects', (req, res) => {
    try {
      const { name, objects, terrainCenter, terrainRadius, cameraState, environment } = req.body || {};
      if (!name) {
        return res.status(400).json({ success: false, error: 'Projektname fehlt.' });
      }
      const safeName = path.basename(String(name)).replace(/[^a-zA-Z0-9._-]/g, '_') || 'cad_project';
      const filename = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
      const payload = {
        name: String(name).trim(),
        updatedAt: Date.now(),
        terrainCenter: terrainCenter || { x: 0, y: 64, z: 0 },
        terrainRadius: terrainRadius || 32,
        cameraState: cameraState || null,
        environment: environment || { timeOfDay: 12, ghostOpacity: 1.0 },
        objects: Array.isArray(objects) ? objects : []
      };
      fs.writeFileSync(path.join(projectsDir, filename), JSON.stringify(payload, null, 2), 'utf8');
      res.json({ success: true, filename, project: payload });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get('/api/cad/projects/:name', (req, res) => {
    try {
      const safeName = path.basename(req.params.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
      const fp = path.join(projectsDir, filename);
      if (!fs.existsSync(fp)) {
        return res.status(404).json({ success: false, error: 'Projekt nicht gefunden.' });
      }
      const project = JSON.parse(fs.readFileSync(fp, 'utf8'));
      res.json({ success: true, project });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.delete('/api/cad/projects/:name', (req, res) => {
    try {
      const safeName = path.basename(req.params.name).replace(/[^a-zA-Z0-9._-]/g, '_');
      const filename = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
      const fp = path.join(projectsDir, filename);
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. 1-Klick Gesamt-Export der gesamten Multi-Objekt-Szene als .schem oder .nbt
  app.post('/api/cad/export-composite', async (req, res) => {
    try {
      const { name, format = 'schem', objects = [], includeAutoFoundation = false } = req.body || {};
      const visibleObjects = (Array.isArray(objects) ? objects : []).filter(o => o && o.visible !== false && Array.isArray(o.blocks) && o.blocks.length > 0);
      if (visibleObjects.length === 0) {
        return res.status(400).json({ success: false, error: 'Keine sichtbaren Objekte in der Szene zum Exportieren.' });
      }

      const worldBlocks = [];
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      let minZ = Infinity, maxZ = -Infinity;

      for (const obj of visibleObjects) {
        const pos = obj.position || { x: 0, y: 64, z: 0 };
        const facing = obj.facing || 'north';
        const width = obj.bounds?.width || obj.width || 16;
        const depth = obj.bounds?.depth || obj.depth || 16;

        for (const b of obj.blocks) {
          if (!b || !b.name || b.name === 'air') continue;
          const rot = rotateLocalToWorld(b.x, b.y, b.z, { name: b.name, properties: b.properties || {} }, width, depth, facing);
          const wx = Math.floor(pos.x + rot.x);
          const wy = Math.floor(pos.y + rot.y);
          const wz = Math.floor(pos.z + rot.z);

          if (wx < minX) minX = wx;
          if (wx > maxX) maxX = wx;
          if (wy < minY) minY = wy;
          if (wy > maxY) maxY = wy;
          if (wz < minZ) minZ = wz;
          if (wz > maxZ) maxZ = wz;

          worldBlocks.push({
            wx,
            wy,
            wz,
            blockState: rot.blockState
          });
        }
      }

      if (includeAutoFoundation && context.lastScannedTerrain) {
        const verifier = analyzeSceneVerifier(context.lastScannedTerrain, visibleObjects);
        for (const rep of Object.values(verifier.objectReports)) {
          for (const pillar of rep.foundationPillars || []) {
            if (pillar.x < minX) minX = pillar.x;
            if (pillar.x > maxX) maxX = pillar.x;
            if (pillar.y < minY) minY = pillar.y;
            if (pillar.y > maxY) maxY = pillar.y;
            if (pillar.z < minZ) minZ = pillar.z;
            if (pillar.z > maxZ) maxZ = pillar.z;
            worldBlocks.push({
              wx: pillar.x,
              wy: pillar.y,
              wz: pillar.z,
              blockState: { name: pillar.name, properties: {} }
            });
          }
        }
      }

      const compW = Math.max(1, maxX - minX + 1);
      const compH = Math.max(1, maxY - minY + 1);
      const compD = Math.max(1, maxZ - minZ + 1);

      const compositeCanvas = new VoxelCanvas(compW, compH, compD, { x: minX, y: minY, z: minZ });
      compositeCanvas.maxOps = Math.max(500000, worldBlocks.length + 10000);

      for (const item of worldBlocks) {
        compositeCanvas.set(item.wx - minX, item.wy - minY, item.wz - minZ, item.blockState);
      }

      const safeName = path.basename(String(name || `composite_scene_${Date.now()}`)).replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const isNbt = String(format).toLowerCase() === 'nbt';
      const ext = isNbt ? 'nbt' : 'schem';
      const buffer = isNbt
        ? await schematicManager.exportCanvasToNbt(compositeCanvas, safeName)
        : await schematicManager.exportCanvasToSchem(compositeCanvas, safeName);

      const outFilename = `${safeName}.${ext}`;
      fs.writeFileSync(path.join(schematicsDir, outFilename), buffer);

      res.json({
        success: true,
        filename: outFilename,
        downloadUrl: `/api/schematics/download/${encodeURIComponent(outFilename)}`,
        blockCount: compositeCanvas.blocks.size,
        bounds: { width: compW, height: compH, depth: compD, origin: { x: minX, y: minY, z: minZ } }
      });
    } catch (err) {
      logger.error(`[CAD Studio] Composite-Export Fehler: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });
}
