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
import { guardManager } from './guardManager.js';
import { harvestManager } from '../survival/harvestManager.js';
import { inventoryManager } from './inventoryManager.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { classifyKickReason, extractMinecraftChatText } from '../utils/stringUtils.js';

export class BotClient {
  constructor() {
    this.bot = null;
    this.architectAgent = new ArchitectAgent();
    this.chatController = null;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.shouldRun = true;
    this.reconnectTimeout = null;
    this.threatManager = threatManager;
    this.sleepController = sleepController;
    this.sleepController.setBotClient(this);
    this.manualController = manualController;
    this.state = 'STOPPED';
    this.lastKickClassification = null;
    this.lastKickReason = null;

    sessionHandoff.setBotClient(this);
    dashboardServer.init(this);
  }

  start() {
    this.shouldRun = true;
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    this.lastKickClassification = null;
    this.lastKickReason = null;
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
    guardManager.stopGuarding();
    harvestManager.abort();
    this.sleepController?.stopMonitoring();
    this.manualController?.deactivate();
    this.lastKickClassification = null;
    this.lastKickReason = null;

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
    this.state = state;
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
    this.shouldRun = true;
    this.cancelReconnect();
    this.reconnectAttempts = 0;
    this.lastKickClassification = null;
    this.lastKickReason = null;
    if (this.bot) {
      try {
        this.bot.quit();
      } catch (err) {
        logger.debug(`Hinweis beim Bot-Reconnect Quit: ${err.message}`);
      }
      this.bot = null;
    }
    this.broadcastState('CONNECTING', false);
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

    // Chat-Hook für Dashboard & In-Game-Chat-Toggle sicher anbinden
    const hookChat = () => {
      if (bot.chat && !bot._chatHooked) {
        bot._chatHooked = true;
        const origChat = bot.chat.bind(bot);
        bot._origChat = origChat;
        bot.chat = (msg) => {
          dashboardServer.recordChat(bot.username || settings.MC_USERNAME, msg);

          // Falls Minecraft In-Game Chat deaktiviert ist:
          // Normale Chat-Nachrichten (nicht beginnend mit '/') im Server-Chat unterdrücken.
          // Server-Befehle (beginnend mit '/') für z.B. /setblock in hybrid_visual oder /gamerule weiterhin ausführen!
          const isCommand = typeof msg === 'string' && msg.trim().startsWith('/');
          if (!settings.ENABLE_MINECRAFT_CHAT && !isCommand) {
            logger.debug(`[ChatController] Minecraft In-Game Chat ist stummgeschaltet. Nachricht unterdrückt: "${msg}"`);
            return;
          }

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
      this.reconnectAttempts = 0;
      logger.build(`Bot '${bot.username}' erfolgreich auf dem Server gespawnt! (Position: ${bot.entity.position.floored()})`);

      try {
        const defaultMove = new Movements(bot);
        // Bautenschutz: Verhindert, dass der Pathfinder Löcher in eigene/frisch gebaute Wände schlägt
        defaultMove.canDig = false;
        defaultMove.allowParkour = true;
        defaultMove.allowSprinting = true;
        bot.pathfinder.setMovements(defaultMove);
      } catch (err) {
        logger.warn(`Konnte Standard-Pathfinder-Bewegungen nicht initialisieren: ${err.message}`);
      }

      // Beste Rüstung & Nahrungsschutz sofort beim Spawnen aktivieren
      inventoryManager.equipBestArmor(bot).catch(err => {
        logger.debug(`[BotClient] Fehler beim initialen Rüstungs-Check: ${err.message}`);
      });
      inventoryManager.autoEatCheck(bot).catch(err => {
        logger.debug(`[BotClient] Fehler beim initialen Hunger-Check: ${err.message}`);
      });

      sessionHandoff.onBotSpawn(bot);
      dashboardServer.onBotSpawn(bot);
      this.lastKickClassification = null;
      this.lastKickReason = null;
      this.broadcastState('ONLINE_ACTIVE', true);
      this.threatManager.setBot(bot);
      this.threatManager.startMonitoring();
      guardManager.setBot(bot);
      this.manualController.setBot(bot);
      this.sleepController.setBotClient(this);
      this.sleepController.onBotSpawn(bot);

      logger.build(`BaumeisterKI bereit! Mission Control Web-UI aktiv auf: http://localhost:${settings.WEB_DASHBOARD_PORT || 3080}`);
      dashboardServer.recordChat('System', 'BaumeisterKI bereit! Schreibe Bau-Wünsche im Web-Dashboard oder nutze !scan, !preview, !undo, !stop, !instant, !come, !style, !chat on/off');
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

    // Kontinuierliche Hunger- & Nahrungsüberwachung (Auto-Eat)
    bot.on('health', async () => {
      if (this.manualController?.isActive()) return;
      if (bot.health > 0) {
        await inventoryManager.autoEatCheck(bot);
      }
    });

    // Umweltschutz: Anti-Ertrinken (Schwimm-Reflex) und Lava-Schutz
    let isEnvironmentalSwimming = false;
    bot.on('move', () => {
      if (this.manualController?.isActive() || !bot.entity) return;

      if (bot.entity.isInWater) {
        if ((bot.oxygenLevel !== undefined && bot.oxygenLevel < 20) || (bot.entity.velocity && bot.entity.velocity.y < 0)) {
          bot.setControlState('jump', true);
          isEnvironmentalSwimming = true;
        }
      } else if (bot.entity.isInLava) {
        logger.warn('[HAZARD] Bot befindet sich in Lava! Notfall-Sprung aktiv!');
        bot.setControlState('jump', true);
        bot.setControlState('sprint', true);
        isEnvironmentalSwimming = true;
      } else if (isEnvironmentalSwimming) {
        bot.setControlState('jump', false);
        bot.setControlState('sprint', false);
        isEnvironmentalSwimming = false;
      }
    });

    // Auto-Respawn & Notfall-Handling bei Tod
    bot.on('death', () => {
      const deathPos = bot.entity?.position ? bot.entity.position.floored() : 'unbekannt';
      logger.error(`[DEATH] Der Bot ist bei Position ${deathPos} gestorben!`);
      this.broadcastState('DEAD', true);
      if (dashboardServer && typeof dashboardServer.broadcast === 'function') {
        dashboardServer.broadcast({
          type: 'bot_death',
          position: deathPos,
          message: `Bot bei ${deathPos} gestorben. Automatischer Respawn wird eingeleitet...`
        });
      }

      // Aktiven Bauauftrag sichern und pausieren
      worldExecutor.pauseBuild();

      // Automatischer Respawn nach 1.500 ms
      setTimeout(() => {
        if (this.bot && typeof this.bot.respawn === 'function') {
          try {
            logger.info('[BotClient] Führe automatischen Respawn aus...');
            this.bot.respawn();
          } catch (respawnErr) {
            logger.warn(`[BotClient] Fehler beim automatischen Respawn: ${respawnErr.message}`);
          }
        }
      }, 1500);
    });

    bot.on('kicked', (reason) => {
      this.manualController?.deactivate();
      const classification = classifyKickReason(reason);
      const cleanReason = classification.cleanText || (typeof reason === 'object' ? JSON.stringify(reason) : String(reason));
      logger.warn(`Bot wurde vom Server gekickt: ${cleanReason}`);

      // Spezifische Diagnose & Behandlung für Fabric Loader & Fabric API / Mod-Mismatch
      if (classification.isFabricMismatch) {
        this.lastKickClassification = classification;
        this.lastKickReason = cleanReason;
        logger.warn(`[Fabric Mod-Check] ${classification.title}`);
        if (classification.relatedNamespaces && classification.relatedNamespaces.length > 0) {
          logger.warn(`[Fabric Mod-Check] Betroffene Mod-Namespaces auf Server/Host: ${classification.relatedNamespaces.join(', ')}`);
        }
        if (classification.detectedInstance) {
          logger.info(`[Fabric Mod-Check] Erkannte lokale Minecraft-Instanz: ${classification.detectedInstance.name} (${classification.detectedInstance.modsDir})`);
        }
        logger.info(`[Fabric Mod-Check] Ursache: BaumeisterKI ist ein Vanilla Node.js/Mineflayer-Bot und kann keine Java Fabric-Client-Mods ausführen.`);
        logger.info(`[Fabric Mod-Check] LÖSUNG: ${classification.recommendation}`);
        logger.info(`[Fabric Mod-Check] Download: ${classification.modrinthUrl}`);

        if (dashboardServer && typeof dashboardServer.broadcast === 'function') {
          dashboardServer.broadcast({
            type: 'bot_kick_diagnostic',
            classification,
            reason: cleanReason
          });
          const modsStr = classification.relatedNamespaces?.length ? ` (Mods: ${classification.relatedNamespaces.join(', ')})` : '';
          dashboardServer.recordChat(
            'System-Diagnose',
            `⚠️ Server verlangt Fabric Loader & Fabric API${modsStr}. ${classification.recommendation}`
          );
        }

        this.broadcastState('FABRIC_MISMATCH', false);
        // Statt im 5s/10s Takt endlos zu reconnecten: Cooldown verlangsamen (120s), um Server-Spam zu verhindern
        this.scheduleReconnect(120000);
        return;
      }

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

      if (err.message && err.message.includes('Failed to obtain profile data')) {
        logger.warn('[BotClient] Mögliche Ursachen: Mojang-Server vorübergehend überlastet (Rate-Limit nach wiederholten Reconnects), oder das Microsoft-Konto besitzt keine aktive Minecraft Java Edition Lizenz.');
      }

      // Falls der Fehler vor oder während des Logins auftritt, sendet Mineflayer oft kein 'end'-Event.
      // Automatischer Reconnect mit Backoff stellt sicher, dass der Bot nicht im Leerlauf hängenbleibt.
      if (this.shouldRun && !this.isReconnecting && (!this.bot || !this.bot.entity)) {
        this.broadcastState('RECONNECTING', false);
        this.scheduleReconnect();
      }
    });

    bot.on('end', (reason) => {
      this.manualController?.deactivate();
      const cleanReason = extractMinecraftChatText(reason) || (typeof reason === 'object' ? JSON.stringify(reason) : String(reason));
      logger.warn(`Verbindung zum Server beendet: ${cleanReason}`);

      // Falls die Verbindung durch einen Fabric-Mismatch beendet wurde, den Zustand 'FABRIC_MISMATCH'
      // keinesfalls mit 'RECONNECTING' überschreiben!
      if (this.state === 'FABRIC_MISMATCH') {
        this.broadcastState('FABRIC_MISMATCH', false);
        return;
      }

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

  scheduleReconnect(customDelayMs = null) {
    if (!this.shouldRun || this.isReconnecting) return;
    this.isReconnecting = true;

    // Exponentieller Backoff: 5s, 10s, 20s, 30s, max 60s
    // Schützt vor Microsoft/Mojang API Rate-Limits bei Server-Ausfall
    const backoffs = [5000, 10000, 20000, 30000, 60000];
    const delayMs = customDelayMs !== null ? customDelayMs : backoffs[Math.min(this.reconnectAttempts, backoffs.length - 1)];
    this.reconnectAttempts++;

    logger.info(`Verbindung verloren oder fehlgeschlagen (Versuch ${this.reconnectAttempts}). Starte automatischen Reconnect in ${delayMs / 1000}s...`);

    this.reconnectTimeout = setTimeout(() => {
      this.isReconnecting = false;
      if (this.shouldRun) {
        this.initBot();
      }
    }, delayMs);
  }
}

export const botClient = new BotClient();
