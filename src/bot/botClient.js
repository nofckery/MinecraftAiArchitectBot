import { VersionResolver } from '../config/versionResolver.js';
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements } = pathfinderPkg;
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { ArchitectAgent } from '../ai/architectAgent.js';
import { ChatController } from './chatController.js';
import { sessionHandoff } from './sessionHandoff.js';
import { dashboardServer } from '../web/dashboardServer.js';
import { ThreatManager, threatManager } from './threatManager.js';
import { SleepController, sleepController, SLEEP_STATES } from './sleepController.js';
import { serverRights } from './serverRights.js';
import { manualController } from './manualController.js';

export class BotClient {
  constructor() {
    this.bot = null;
    this.architectAgent = new ArchitectAgent();
    this.chatController = null;
    this.isReconnecting = false;
    this.shouldRun = true;
    this.reconnectTimeout = null;
    this.threatManager = threatManager;
    this.sleepController = sleepController;
    this.sleepController.setBotClient(this);
    this.manualController = manualController;

    sessionHandoff.setBotClient(this);
    dashboardServer.init(this);
  }

  start() {
    this.shouldRun = true;
    this.cancelReconnect();
    if (this.bot) {
      try {
        this.bot.quit();
      } catch {}
      this.bot = null;
    }
    this.broadcastState('CONNECTING', false);
    this.initBot();
  }

  stop() {
    this.shouldRun = false;
    this.cancelReconnect();
    sessionHandoff.stopPingLoop();
    this.threatManager?.stopMonitoring();
    this.sleepController?.stopMonitoring();
    this.manualController?.deactivate();

    if (this.bot) {
      try {
        this.bot.quit();
      } catch (err) {
        // 4.1 Sauberes Debug-Logging statt stillem Schlucken
        logger.debug(`Hinweis beim Bot-Quit: ${err.message}`);
      }
      this.bot = null;
    }
    this.broadcastState('STOPPED', false);
    logger.info('Bot-Client sauber beendet.');
  }

  broadcastState(state, connected = false) {
    if (dashboardServer && typeof dashboardServer.broadcast === 'function') {
      dashboardServer.broadcast({
        type: 'bot_state_change',
        running: this.shouldRun,
        connected,
        state,
        username: this.bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
      });
    }
  }

  cancelReconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.isReconnecting = false;
  }

  reconnect() {
    this.cancelReconnect();
    if (this.bot) {
      try {
        this.bot.quit();
      } catch (err) {
        logger.debug(`Hinweis beim Bot-Reconnect Quit: ${err.message}`);
      }
      this.bot = null;
    }
    this.initBot();
  }

  async initBot() {
    if (!settings.MC_HOST || !settings.MC_USERNAME || !settings.BOT_OWNER) {
      logger.warn('[BotClient] Verbindungsaufbau übersprungen: Keine spezifischen Nutzer- und Serverdaten konfiguriert (MC_HOST, MC_USERNAME oder BOT_OWNER fehlt).');
      this.broadcastState('STANDBY', false);
      return;
    }

    logger.info(`Verbinde zu Minecraft-Server ${settings.MC_HOST}:${settings.MC_PORT} als '${settings.MC_USERNAME}'...`);

    // 26.3 Kompatibilitäts-Shims & Versionsauflösung anwenden
    VersionResolver.applyCompatibilityShims();
    const verConfig = await VersionResolver.resolveConnectionOptions(
      settings.MC_HOST,
      settings.MC_PORT,
      settings.MC_VERSION
    );

    const botOptions = {
      host: settings.MC_HOST,
      port: settings.MC_PORT,
      username: settings.MC_USERNAME,
      auth: settings.MC_AUTH,
      hideErrors: true
    };

    if (settings.MC_AUTH === 'microsoft') {
      botOptions.onMsaCode = (data) => {
        const directUrl = data.verification_uri
          ? `${data.verification_uri}?otc=${data.user_code}`
          : `https://www.microsoft.com/link?otc=${data.user_code}`;

        logger.info(`[MSA] Microsoft-Authentifizierung erforderlich!`);
        logger.info(`[MSA] Bitte im Browser öffnen: ${directUrl} (Code: ${data.user_code})`);

        dashboardServer.broadcast({
          type: 'msa_code',
          userCode: data.user_code,
          verificationUri: data.verification_uri || 'https://www.microsoft.com/link',
          directUrl,
          expiresIn: data.expires_in,
          message: data.message
        });
      };
    }

    if (verConfig.version !== false) {
      botOptions.version = verConfig.version;
      if (verConfig.version === '26.3') {
        botOptions.protocolVersion = 777;
      }
    }

    try {
      this.bot = mineflayer.createBot(botOptions);
      VersionResolver.patchBotClient(this.bot);
    } catch (err) {
      logger.error(`Initialer Verbindungsfehler: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    // Pathfinder-Plugin laden
    this.bot.loadPlugin(pathfinder);

    this.architectAgent.setBot(this.bot);
    this.chatController = new ChatController(this.bot, this.architectAgent);

    this.setupEventHandlers();
  }

  setupEventHandlers() {
    const bot = this.bot;

    // Server-Rechte dynamisch überwachen
    serverRights.attachToBot(bot);

    // Chat-Hook für Dashboard sicher anbinden (wartet, bis Mineflayer das Chat-Plugin injiziert hat)
    const hookChat = () => {
      if (bot.chat && !bot._chatHooked) {
        bot._chatHooked = true;
        const origChat = bot.chat.bind(bot);
        bot.chat = (msg) => {
          dashboardServer.recordChat(bot.username || settings.MC_USERNAME, msg);
          return origChat(msg);
        };
      }
    };

    if (bot.chat) {
      hookChat();
    } else {
      bot.once('inject_allowed', hookChat);
      bot.once('spawn', hookChat);
    }

    bot.on('login', () => {
      dashboardServer.broadcast({
        type: 'msa_success',
        username: bot.username || settings.MC_USERNAME
      });
    });

    bot.once('spawn', () => {
      logger.build(`Bot '${bot.username}' erfolgreich auf dem Server gespawnt! (Position: ${bot.entity.position.floored()})`);

      try {
        const defaultMove = new Movements(bot);
        bot.pathfinder.setMovements(defaultMove);
      } catch (err) {
        logger.warn(`Konnte Standard-Pathfinder-Bewegungen nicht initialisieren: ${err.message}`);
      }

      sessionHandoff.onBotSpawn(bot);
      dashboardServer.onBotSpawn(bot);
      this.broadcastState('ONLINE_ACTIVE', true);
      this.threatManager.setBot(bot);
      this.threatManager.startMonitoring();
      this.manualController.setBot(bot);
      this.sleepController.setBotClient(this);
      this.sleepController.onBotSpawn(bot);

      logger.build(`BaumeisterKI bereit! Mission Control Web-UI aktiv auf: http://localhost:${settings.WEB_DASHBOARD_PORT || 3080}`);
      dashboardServer.recordChat('System', 'BaumeisterKI bereit! Schreibe Bau-Wünsche im Web-Dashboard oder nutze !scan, !preview, !undo, !stop, !instant, !come, !style');
    });

    bot.on('chat', (username, message) => {
      dashboardServer.recordChat(username, message);
      if (this.chatController) {
        this.chatController.handleMessage(username, message).catch(err => {
          logger.error(`Fehler bei Chatverarbeitung: ${err.message}`);
        });
      }
    });

    // 5.1 Mob-Defense & Notfall-Schutz: Bot reagiert auf Angriffe
    bot.on('entityHurt', async (entity) => {
      if (this.manualController?.isActive()) return;
      if (entity === bot.entity) {
        logger.warn(`[DEFENSE] Bot wird angegriffen! Gesundheit: ${bot.health}/20.`);
        if (bot.inventory) {
          const shield = bot.inventory.items().find(i => i.name.includes('shield'));
          if (shield) {
            try {
              await bot.equip(shield, 'off-hand');
              bot.activateItem(true); // Schild heben
              setTimeout(() => {
                try { bot.deactivateItem(); } catch {}
              }, 2500);
            } catch (shieldErr) {
              logger.debug(`Konnte Schild nicht aktivieren: ${shieldErr.message}`);
            }
          }
        }
      }
    });

    bot.on('kicked', (reason) => {
      this.manualController?.deactivate();
      const reasonStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
      logger.warn(`Bot wurde vom Server gekickt: ${reasonStr}`);
      if (sessionHandoff.isPaused() || this.sleepController?.state === SLEEP_STATES.DISCONNECTED_FOR_NIGHT) {
        return;
      }
      if (settings.SINGLE_ACCOUNT_HANDOFF_MODE && sessionHandoff.handleKick(reason)) {
        return;
      }
      this.scheduleReconnect();
    });

    bot.on('error', (err) => {
      logger.error(`Mineflayer-Fehler: ${err.message}`);
    });

    bot.on('end', (reason) => {
      this.manualController?.deactivate();
      logger.warn(`Verbindung zum Server beendet: ${reason}`);
      this.broadcastState(this.shouldRun ? 'RECONNECTING' : 'STOPPED', false);
      if (sessionHandoff.isPaused() || this.sleepController?.state === SLEEP_STATES.DISCONNECTED_FOR_NIGHT) {
        return;
      }
      if (settings.SINGLE_ACCOUNT_HANDOFF_MODE && sessionHandoff.handleKick(reason)) {
        return;
      }
      if (this.shouldRun) {
        this.scheduleReconnect();
      }
    });
  }

  scheduleReconnect() {
    if (!this.shouldRun || this.isReconnecting) return;
    this.isReconnecting = true;

    const delayMs = 5000;
    logger.info(`Verbindung verloren. Starte automatischen Reconnect in ${delayMs / 1000}s...`);

    this.reconnectTimeout = setTimeout(() => {
      this.isReconnecting = false;
      if (this.shouldRun) {
        this.initBot();
      }
    }, delayMs);
  }
}

export const botClient = new BotClient();
