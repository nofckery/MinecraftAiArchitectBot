import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
const { pathfinder, Movements } = pathfinderPkg;
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { ArchitectAgent } from '../ai/architectAgent.js';
import { ChatController } from './chatController.js';
import { sessionHandoff } from './sessionHandoff.js';
import { dashboardServer } from '../web/dashboardServer.js';

export class BotClient {
  constructor() {
    this.bot = null;
    this.architectAgent = new ArchitectAgent();
    this.chatController = null;
    this.isReconnecting = false;
    this.shouldRun = true;
    this.reconnectTimeout = null;

    sessionHandoff.setBotClient(this);
    dashboardServer.init(this);
  }

  start() {
    this.shouldRun = true;
    this.initBot();
  }

  stop() {
    this.shouldRun = false;
    this.cancelReconnect();
    sessionHandoff.stopPingLoop();

    if (this.bot) {
      try {
        this.bot.quit();
      } catch (err) {
        // 4.1 Sauberes Debug-Logging statt stillem Schlucken
        logger.debug(`Hinweis beim Bot-Quit: ${err.message}`);
      }
      this.bot = null;
    }
    logger.info('Bot-Client sauber beendet.');
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

  initBot() {
    logger.info(`Verbinde zu Minecraft-Server ${settings.MC_HOST}:${settings.MC_PORT} als '${settings.MC_USERNAME}'...`);

    const botOptions = {
      host: settings.MC_HOST,
      port: settings.MC_PORT,
      username: settings.MC_USERNAME,
      auth: settings.MC_AUTH
    };

    if (settings.MC_VERSION) {
      botOptions.version = settings.MC_VERSION;
    }

    try {
      this.bot = mineflayer.createBot(botOptions);
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

    // Chat-Hook für Dashboard
    const origChat = bot.chat.bind(bot);
    bot.chat = (msg) => {
      dashboardServer.recordChat(bot.username || settings.MC_USERNAME, msg);
      return origChat(msg);
    };

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

      bot.chat(`BaumeisterKI bereit! Schreibe mir deinen Bau-Wunsch oder nutze: !scan, !preview, !undo, !stop, !instant, !come, !style`);
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
      logger.warn(`Bot wurde vom Server gekickt: ${reason}`);
      if (settings.SINGLE_ACCOUNT_HANDOFF_MODE && sessionHandoff.handleKick(reason)) {
        return;
      }
      this.scheduleReconnect();
    });

    bot.on('error', (err) => {
      logger.error(`Mineflayer-Fehler: ${err.message}`);
    });

    bot.on('end', (reason) => {
      logger.warn(`Verbindung zum Server beendet: ${reason}`);
      if (sessionHandoff.isPaused()) {
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
