import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import multer from 'multer';
import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { registerBaseRoutes } from '../routes/baseRoutes.js';
import { registerSchematicRoutes } from '../routes/schematicRoutes.js';
import { registerModelApiRoutes } from '../routes/modelRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Configures the Express app with middleware, authentication, static assets, and route dispatchers.
 *
 * @param {Object} server - DashboardServer instance
 * @returns {Object} Express application
 */
export function setupExpressApp(server) {
  if (server.app) return server.app;
  server.app = express();

  // 1. Zero-CORS & Zero-PNA Middleware
  server.app.use('/api', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-dashboard-token');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // 1b. Dashboard Password Protection (if configured in settings)
  if (settings.DASHBOARD_PASSWORD && settings.DASHBOARD_PASSWORD.length > 0) {
    server.app.use('/api', (req, res, next) => {
      if (req.path === '/auth/status' || req.path === '/auth/login') {
        return next();
      }
      const authHeader = req.headers.authorization || '';
      const token = req.headers['x-dashboard-token'] ||
        (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
        req.query?.token ||
        req.query?.auth;

      if (token === settings.DASHBOARD_PASSWORD) {
        return next();
      }
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Gültiges Dashboard-Passwort erforderlich.'
      });
    });
  }

  server.app.get('/api/auth/status', (req, res) => {
    res.json({
      passwordProtected: Boolean(settings.DASHBOARD_PASSWORD && settings.DASHBOARD_PASSWORD.length > 0)
    });
  });

  server.app.post('/api/auth/login', (req, res) => {
    const { password } = req.body || {};
    if (!settings.DASHBOARD_PASSWORD || password === settings.DASHBOARD_PASSWORD) {
      return res.json({ success: true, token: settings.DASHBOARD_PASSWORD || 'unprotected' });
    }
    return res.status(401).json({ success: false, error: 'Ungültiges Passwort' });
  });

  server.app.use(express.json());
  const publicDir = path.resolve(__dirname, '../public');
  server.app.use(express.static(publicDir));
  const texturesDir = path.resolve(__dirname, '../../../node_modules/prismarine-viewer/public/textures');
  server.app.use('/textures', express.static(texturesDir));

  server.app.get('/api/inventory/textures', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(path.resolve(__dirname, '../public/img/mc/item_textures.json'));
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  // Initialize backend services in background
  server.ensureServices().catch(err => {
    logger.warn(`[DashboardServer] Service-Initialisierung im Hintergrund: ${err.message}`);
  });

  registerBaseRoutes(server.app, server);
  registerSchematicRoutes(server.app, upload, server);
  registerModelApiRoutes(server.app, server);

  return server.app;
}
