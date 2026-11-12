import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import { schematicManager } from '../../builder/schematicManager.js';
import { StructuralLinter } from '../../builder/structuralLinter.js';
import { registerCadStudioRoutes } from './cadStudioRoutes.js';

/**
 * Registers schematic REST API routes: listing, upload, URL import, export, and download.
 * Also delegates to registerCadStudioRoutes for backwards compatibility.
 *
 * @param {import('express').Express} app - Express application
 * @param {import('multer').Multer} upload - Multer instance configured for memory storage
 * @param {Object} context - Server coordinator context (activeCanvas, architectAgent, broadcastVoxelPreview, recordChat)
 */
export function registerSchematicRoutes(app, upload, context) {
  const schematicsDir = path.resolve('data/schematics');
  if (!fs.existsSync(schematicsDir)) {
    fs.mkdirSync(schematicsDir, { recursive: true });
  }

  // 1. List schematics in data/schematics
  app.get('/api/schematics', (req, res) => {
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

  // 2. Upload schematic file
  app.post('/api/schematics/upload', upload.single('file'), async (req, res) => {
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
      const canvas = await schematicManager.loadIntoCanvas(req.file.buffer, safeFilename);
      context.activeCanvas = canvas;

      const savePath = path.resolve('data/schematics', safeFilename);
      fs.writeFileSync(savePath, req.file.buffer);

      const bounds = canvas.getBounds();
      let siteInfo;
      if (context.architectAgent) {
        const probed = context.architectAgent.getEffectiveSiteInfo(null, {
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height
        });
        context.architectAgent.setCustomBounds({
          minX: probed.origin.x,
          minZ: probed.origin.z,
          maxX: probed.origin.x + bounds.width - 1,
          maxZ: probed.origin.z + bounds.depth - 1,
          baseY: probed.origin.y,
          facing: probed.facing || 'north'
        });
        siteInfo = context.architectAgent.getEffectiveSiteInfo();
      } else {
        siteInfo = {
          origin: { x: 0, y: 64, z: 0 },
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height,
          facing: 'north'
        };
      }

      if (context.architectAgent) {
        context.architectAgent.lastBuildState = {
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
      context.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `Import: ${safeFilename}`
      });

      context.recordChat('SYSTEM', `Schematic '${safeFilename}' erfolgreich importiert (${canvas.blocks.size} Blöcke).`);
      res.json({ success: true, filename: safeFilename, blockCount: canvas.blocks.size });
    } catch (err) {
      logger.error(`Fehler beim Schematic-Upload: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Import schematic from URL
  app.post('/api/schematics/import-url', async (req, res) => {
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
      context.activeCanvas = canvas;

      const savePath = path.resolve('data/schematics', safeFilename);
      fs.writeFileSync(savePath, buffer);

      const bounds = canvas.getBounds();
      let siteInfo;
      if (context.architectAgent) {
        const probed = context.architectAgent.getEffectiveSiteInfo(null, {
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height
        });
        context.architectAgent.setCustomBounds({
          minX: probed.origin.x,
          minZ: probed.origin.z,
          maxX: probed.origin.x + bounds.width - 1,
          maxZ: probed.origin.z + bounds.depth - 1,
          baseY: probed.origin.y,
          facing: probed.facing || 'north'
        });
        siteInfo = context.architectAgent.getEffectiveSiteInfo();
      } else {
        siteInfo = {
          origin: { x: 0, y: 64, z: 0 },
          width: bounds.width,
          depth: bounds.depth,
          height: bounds.height,
          facing: 'north'
        };
      }

      if (context.architectAgent) {
        context.architectAgent.lastBuildState = {
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
      context.broadcastVoxelPreview({
        canvas,
        lintReport,
        siteInfo,
        userRequest: `URL-Import: ${safeFilename}`
      });

      context.recordChat('SYSTEM', `Schematic von URL '${safeFilename}' geladen (${canvas.blocks.size} Blöcke).`);
      res.json({ success: true, filename: safeFilename, blockCount: canvas.blocks.size });
    } catch (err) {
      logger.error(`Fehler beim Schematic-URL-Import: ${err.message}`);
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Export active canvas as .schem or .nbt
  app.get('/api/schematics/export/:name', async (req, res) => {
    try {
      const canvas = context.activeCanvas || context.architectAgent?.lastBuildState?.canvas;
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

  // 5. Download schematic from server disk
  app.get('/api/schematics/download/:filename', (req, res) => {
    const safeFilename = path.basename(req.params.filename);
    const fp = path.join(schematicsDir, safeFilename);
    if (!fs.existsSync(fp)) {
      return res.status(404).send('Datei nicht gefunden.');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.sendFile(fp);
  });

  // CAD Studio Routes registrieren
  registerCadStudioRoutes(app, context);
}
