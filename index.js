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

// 2. Web-Dashboard & Bot-Client starten
dashboardServer.start();

if (envManager.hasEnvFile()) {
  logger.info(`[Startup] Starte Bot-Client direkt für ${settings.MC_HOST}:${settings.MC_PORT} (User: '${settings.MC_USERNAME}', Auth: ${settings.MC_AUTH})...`);
  botClient.start();
} else {
  logger.info('[Onboarding] Keine .env-Datei gefunden. Web-Dashboard bereit auf http://localhost:3080 für das Setup.');
  logger.info('[Onboarding] Bitte öffne http://localhost:3080 im Browser, um den Einrichtungs-Assistenten abzuschließen oder den Bot direkt zu starten.');
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
