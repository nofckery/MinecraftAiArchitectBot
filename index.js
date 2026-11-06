import { settings, validateSettings } from './src/config/settings.js';
import { envManager } from './src/config/envManager.js';
import { logger } from './src/utils/logger.js';
import { botClient } from './src/bot/botClient.js';
import { worldExecutor } from './src/builder/worldExecutor.js';
import { dashboardServer } from './src/web/dashboardServer.js';

console.log(`
\x1b[36m====================================================================\x1b[0m
\x1b[32m       AUTONOMOUS AI MINECRAFT ARCHITECT BOT (v2.0 SOTA)            \x1b[0m
\x1b[36m====================================================================\x1b[0m
`);

// 1. Konfiguration validieren
const configIssues = validateSettings();
if (configIssues.length > 0) {
  for (const issue of configIssues) {
    logger.warn(`Konfigurations-Warnung: ${issue}`);
  }
}

logger.info(`Ausführungs-Modus: ${settings.BUILD_EXECUTION_MODE}`);
logger.info(`Greedy-Fill Optimierung: ${settings.ENABLE_GREEDY_FILL_OPTIMIZATION}`);
logger.info(`Maximales Bauvolumen: ${settings.MAX_BUILD_VOLUME_DIMENSION} Blöcke`);

// 2. Web-Dashboard starten & Verbindungslogik prüfen
dashboardServer.start();

const isConfigured = envManager.isFullyConfigured();
if (isConfigured && settings.AUTO_CONNECT_ON_START) {
  logger.info(`[Startup] Vollständige Konfiguration gefunden. Verbinde direkt zu ${settings.MC_HOST}:${settings.MC_PORT} (User: '${settings.MC_USERNAME}', Auth: ${settings.MC_AUTH})...`);
  botClient.start();
} else if (!isConfigured) {
  logger.info('[Onboarding] System noch nicht vollständig eingerichtet (Keine spezifischen Nutzerdaten vorhanden).');
  logger.info('[Onboarding] Bot bleibt im Standby (keine automatische Verbindung).');
  logger.info('[Onboarding] Web-Dashboard bereit auf http://localhost:3080. Bitte öffne die URL im Browser für den Einrichtungs-Assistenten.');
} else {
  logger.info(`[Standby] Konfiguration für ${settings.MC_HOST}:${settings.MC_PORT} geladen (User: '${settings.MC_USERNAME}').`);
  logger.info('[Standby] Automatischer Direkt-Start ist deaktiviert (AUTO_CONNECT_ON_START=false).');
  logger.info('[Standby] Web-Dashboard aktiv auf http://localhost:3080. Klicke dort auf "Bot Starten", um die Verbindung herzustellen.');
}

// 3. Graceful Shutdown Handler
async function gracefulShutdown(signal) {
  logger.info(`Signal '${signal}' empfangen. Fahre System kontrolliert herunter...`);
  worldExecutor.abort();
  await worldExecutor.disconnectRcon();
  botClient.stop();
  dashboardServer.stop();
  logger.info('Beende Prozess sauber. Bis zum nächsten Mal!');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  logger.error(`Unbehandelte Ausnahme: ${err.message}\n${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(`Unbehandeltes Promise-Rejection: ${reason}`);
});
