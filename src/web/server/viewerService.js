import http from 'node:http';
import prismarineViewer from 'prismarine-viewer';
import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';
import { VersionResolver } from '../../config/versionResolver.js';
import { ViewerStateTranslator } from '../services/viewerStateTranslator.js';
import { sanitizeViewerEntity } from '../services/viewerEntitySanitizer.js';

/**
 * Stops active Prismarine-Viewer stream and cleans up sockets.
 *
 * @param {Object} server - DashboardServer instance
 * @param {boolean} [notifyClients=true]
 * @returns {boolean}
 */
export function stopViewer(server, notifyClients = true) {
  if (server.activeViewer && typeof server.activeViewer.close === 'function') {
    try {
      server.activeViewer.close();
    } catch (err) {
      logger.debug(`Hinweis beim activeViewer-Close: ${err.message}`);
    }
  }
  if (server.currentBot?.viewer && typeof server.currentBot.viewer.close === 'function' && server.currentBot.viewer !== server.activeViewer) {
    try {
      server.currentBot.viewer.close();
    } catch (err) {
      logger.debug(`Hinweis beim bot.viewer-Close: ${err.message}`);
    }
  }
  if (server.currentBot) {
    server.currentBot.viewer = null;
  }
  server.activeViewer = null;
  server.viewerRunning = false;
  if (notifyClients) {
    server.broadcast({
      type: 'viewer_state_changed',
      enabled: Boolean(settings.ENABLE_PRISMARINE_VIEWER),
      running: false,
      port: settings.PRISMARINE_VIEWER_PORT
    });
  }
  return true;
}

/**
 * Enables or disables the Prismarine-Viewer stream.
 *
 * @param {Object} server - DashboardServer instance
 * @param {boolean} enabled
 * @returns {boolean}
 */
export function setViewerEnabled(server, enabled) {
  const isEnabled = Boolean(enabled);
  settings.ENABLE_PRISMARINE_VIEWER = isEnabled;
  if (isEnabled) {
    if (server.currentBot) {
      return startViewer(server, server.currentBot);
    }
    server.broadcast({
      type: 'viewer_state_changed',
      enabled: true,
      running: false,
      port: settings.PRISMARINE_VIEWER_PORT
    });
    return true;
  } else {
    stopViewer(server);
    return true;
  }
}

/**
 * Starts Prismarine-Viewer with state-ID translation and graceful port conflict handling.
 *
 * @param {Object} server - DashboardServer instance
 * @param {Object} [bot]
 * @returns {boolean}
 */
export function startViewer(server, bot = server.currentBot) {
  if (!bot) return false;
  if (server.viewerRunning || server.activeViewer) {
    stopViewer(server, false);
  }

  try {
    const viewerFn = prismarineViewer.mineflayer || (prismarineViewer.default && prismarineViewer.default.mineflayer);
    if (viewerFn) {
      // 1. Version Compatibility & State-ID Translation for Web Client
      const targetViewerVersion = VersionResolver.resolveViewerVersion(bot.version);
      const translator = ViewerStateTranslator.create(bot.version, targetViewerVersion);
      const viewerBot = translator.createViewerBotProxy(bot, sanitizeViewerEntity);
      logger.info(`[Prismarine-Viewer] State-Translator aktiv: Bot-Version '${bot.version}' -> Viewer-Assets '${targetViewerVersion}'`);

      // 2. http.createServer abfangen, um unhandled EADDRINUSE Exceptions zu verhindern und State reaktiv zu bestätigen
      const origCreateServer = http.createServer;
      http.createServer = function(...args) {
        const srv = origCreateServer.apply(this, args);
        srv.on('error', (err) => {
          server.viewerRunning = false;
          server.broadcast({
            type: 'viewer_state_changed',
            enabled: Boolean(settings.ENABLE_PRISMARINE_VIEWER),
            running: false,
            port: settings.PRISMARINE_VIEWER_PORT,
            error: err.code === 'EADDRINUSE' ? `Port ${settings.PRISMARINE_VIEWER_PORT} belegt` : err.message
          });
          if (err.code === 'EADDRINUSE') {
            logger.warn(`[Prismarine-Viewer] Port ${settings.PRISMARINE_VIEWER_PORT} belegt (EADDRINUSE). Stream pausiert.`);
          } else {
            logger.warn(`[Prismarine-Viewer] Serverfehler: ${err.message}`);
          }
        });
        srv.on('listening', () => {
          server.viewerRunning = true;
          logger.info(`Prismarine-Viewer gestartet auf http://localhost:${settings.PRISMARINE_VIEWER_PORT}`);
          server.broadcast({
            type: 'viewer_state_changed',
            enabled: true,
            running: true,
            port: settings.PRISMARINE_VIEWER_PORT
          });
        });
        return srv;
      };

      try {
        viewerFn(viewerBot, {
          port: settings.PRISMARINE_VIEWER_PORT,
          firstPerson: true
        });
        server.activeViewer = viewerBot.viewer || bot.viewer || null;
        server.viewerRunning = true;
        server.broadcast({
          type: 'viewer_state_changed',
          enabled: true,
          running: true,
          port: settings.PRISMARINE_VIEWER_PORT
        });
        return true;
      } finally {
        http.createServer = origCreateServer;
      }
    }
  } catch (err) {
    logger.warn(`Konnte Prismarine-Viewer nicht initialisieren: ${err.message}`);
    return false;
  }
}
