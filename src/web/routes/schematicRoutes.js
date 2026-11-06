import path from 'node:path';
import fs from 'node:fs';
import { logger } from '../../utils/logger.js';
import { schematicManager } from '../../builder/schematicManager.js';
import { StructuralLinter } from '../../builder/structuralLinter.js';

/**
 * Registers schematic REST API routes: listing, upload, URL import, and export.
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

  // Sektion 6: Schematic REST-Endpunkte
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
      // Erst validieren und entpacken, bevor die Datei gespeichert wird
      const canvas = await schematicManager.loadIntoCanvas(req.file.buffer, safeFilename);
      context.activeCanvas = canvas;

      const savePath = path.resolve('data/schematics', safeFilename);
      fs.writeFileSync(savePath, req.file.buffer);

      const bounds = canvas.getBounds();
      const siteInfo = context.architectAgent ? context.architectAgent.getEffectiveSiteInfo() : {
        origin: { x: 0, y: 64, z: 0 },
        width: bounds.width,
        depth: bounds.depth,
        height: bounds.height,
        facing: 'north'
      };

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
      context.activeCanvas = canvas;

      const savePath = path.resolve('data/schematics', safeFilename);
      fs.writeFileSync(savePath, buffer);

      const bounds = canvas.getBounds();
      const siteInfo = context.architectAgent ? context.architectAgent.getEffectiveSiteInfo() : {
        origin: { x: 0, y: 64, z: 0 },
        width: bounds.width,
        depth: bounds.depth,
        height: bounds.height,
        facing: 'north'
      };

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
}
