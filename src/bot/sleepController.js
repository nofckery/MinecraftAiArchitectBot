import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { sessionHandoff, HANDOFF_STATES } from './sessionHandoff.js';
import { manualController } from './manualController.js';

export const SLEEP_STATES = {
  AWAKE: 'AWAKE',
  NAVIGATING_TO_BED: 'NAVIGATING_TO_BED',
  SLEEPING: 'SLEEPING',
  DISCONNECTED_FOR_NIGHT: 'DISCONNECTED_FOR_NIGHT'
};
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';

export class SleepController {
  constructor(botClient = null) {
    this.botClient = botClient;
    this.state = SLEEP_STATES.AWAKE;
    this.reconnectTimer = null;
    this.checkInterval = null;
    this.wasBuildingBeforeSleep = false;
    this.chatListener = null;
    this.entityUpdateListener = null;
    this.wakeListener = null;
  }

  get bot() {
    return this.botClient?.bot || null;
  }

  setBotClient(botClient) {
    this.botClient = botClient;
  }

  startMonitoring(intervalMs = 5000) {
    this.stopMonitoring();
    this.bindEvents();

    this.checkInterval = setInterval(() => {
      if (this.state === SLEEP_STATES.AWAKE && this.isNight()) {
        this.handleSleepOpportunity().catch(err => {
          logger.debug(`[SleepController] Fehler bei Nacht-Prüfung: ${err.message}`);
        });
      }
    }, intervalMs);
  }

  stopMonitoring() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const bot = this.bot;
    if (bot) {
      if (this.chatListener) {
        try { bot.removeListener('chat', this.chatListener); } catch {}
        this.chatListener = null;
      }
      if (this.entityUpdateListener) {
        try { bot.removeListener('entityUpdate', this.entityUpdateListener); } catch {}
        this.entityUpdateListener = null;
      }
      if (this.wakeListener) {
        try { bot.removeListener('wake', this.wakeListener); } catch {}
        this.wakeListener = null;
      }
    }

    if (sessionHandoff.state === HANDOFF_STATES.PAUSED_SLEEP_NIGHT) {
      sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
    }
  }

  bindEvents() {
    const bot = this.bot;
    if (!bot || typeof bot.on !== 'function') return;

    // 1. Chat-Erkennung für schlafende Mitspieler
    this.chatListener = (username, message) => {
      if (typeof message !== 'string') return;
      if (
        /is sleeping/i.test(message) ||
        /schläft im Bett/i.test(message) ||
        /schläft/i.test(message) ||
        /went to bed/i.test(message) ||
        /ging zu Bett/i.test(message)
      ) {
        logger.info(`[SleepController] Schlaf-Nachricht erkannt: '${username}: ${message}'`);
        this.handleSleepOpportunity().catch(err => {
          logger.debug(`[SleepController] Fehler bei Schlaf-Aktion nach Chat: ${err.message}`);
        });
      }
    };
    bot.on('chat', this.chatListener);

    // 2. Entity-Update-Erkennung für Spieler in Schlafpose
    this.entityUpdateListener = (entity) => {
      if (!entity || entity.type !== 'player' || entity === bot.entity) return;
      const isSleepingPose =
        entity.isSleeping === true ||
        entity.pose === 'sleeping' ||
        (entity.metadata && entity.metadata[6] === 2);

      if (isSleepingPose && this.state === SLEEP_STATES.AWAKE) {
        logger.info(`[SleepController] Spieler-Entity ${entity.username || entity.id} im Schlaf-Zustand erkannt.`);
        this.handleSleepOpportunity().catch(err => {
          logger.debug(`[SleepController] Fehler bei Schlaf-Aktion nach Entity-Update: ${err.message}`);
        });
      }
    };
    bot.on('entityUpdate', this.entityUpdateListener);

    // 3. Aufwach-Ereignis
    this.wakeListener = () => {
      this.onWake().catch(err => {
        logger.error(`[SleepController] Fehler bei wake-Verarbeitung: ${err.message}`);
      });
    };
    bot.on('wake', this.wakeListener);
  }

  isNight() {
    const bot = this.bot;
    if (!bot || !bot.time) return false;
    const timeOfDay = bot.time.timeOfDay;
    const isNightTime = timeOfDay >= 12542 && timeOfDay <= 23459;
    const isThunder = !!bot.isRaining && (bot.thunderState || 0) > 0;
    return isNightTime || isThunder;
  }

  isOtherPlayerSleeping() {
    const bot = this.bot;
    if (!bot?.players) return false;

    for (const name in bot.players) {
      if (name === bot.username) continue;
      const player = bot.players[name];
      if (!player) continue;

      const entity = player.entity;
      if (entity) {
        if (
          entity.isSleeping === true ||
          entity.pose === 'sleeping' ||
          (entity.metadata && entity.metadata[6] === 2)
        ) {
          return true;
        }
      }
    }
    return false;
  }

  async findReachableBed(radius = settings.BED_SEARCH_RADIUS || 32) {
    const bot = this.bot;
    if (!bot || typeof bot.findBlocks !== 'function') return null;

    try {
      const minecraftData = (await import('minecraft-data')).default;
      const mcData = minecraftData(bot.version || '1.20.4');

      const bedIds = [];
      const bedNames = [];
      if (mcData?.blocksByName) {
        for (const [name, def] of Object.entries(mcData.blocksByName)) {
          if (name.endsWith('_bed')) {
            bedNames.push(name);
            if (def && typeof def.id === 'number') {
              bedIds.push(def.id);
            }
          }
        }
      }

      const matchingList = (b) => {
        if (!b) return false;
        if (typeof b.name === 'string' && b.name.endsWith('_bed')) return true;
        if (typeof b.type === 'number' && bedIds.includes(b.type)) return true;
        return false;
      };

      const bedPositions = bot.findBlocks({
        matching: matchingList,
        maxDistance: radius,
        count: 10
      });

      if (!bedPositions || bedPositions.length === 0) return null;

      // Sortiere nach Entfernung zum Bot
      const botPos = bot.entity?.position;
      if (botPos) {
        bedPositions.sort((a, b) => botPos.distanceTo(a) - botPos.distanceTo(b));
      }

      for (const pos of bedPositions) {
        const block = typeof bot.blockAt === 'function' ? bot.blockAt(pos) : null;
        if (!block) continue;

        // Prüfe ob Bett bereits belegt ist
        const props = typeof block.getProperties === 'function' ? block.getProperties() : block.properties;
        if (props?.occupied === 'true' || props?.occupied === true) {
          continue;
        }

        return block;
      }
    } catch (err) {
      logger.debug(`[SleepController] Fehler bei Bettsuche: ${err.message}`);
    }

    return null;
  }

  async handleSleepOpportunity() {
    if (manualController.isActive()) return;
    if (this.state !== SLEEP_STATES.AWAKE) return;

    logger.info('[SleepController] Prüfe Schlafgelegenheit...');
    const bedBlock = await this.findReachableBed(settings.BED_SEARCH_RADIUS || 32);

    if (bedBlock) {
      await this.goToBedAndSleep(bedBlock);
    } else {
      // Kein Bett in Reichweite gefunden
      const othersSleeping = this.isOtherPlayerSleeping();
      const disconnectAllowed = settings.SLEEP_DISCONNECT_ON_NO_BED;

      if (othersSleeping || (this.isNight() && disconnectAllowed)) {
        logger.warn('[SleepController] Kein freies Bett erreichbar, während Nacht herrscht oder andere schlafen.');
        await this.disconnectForNight();
      } else {
        logger.info('[SleepController] Kein Bett gefunden, aber noch keine Notwendigkeit für Disconnect.');
      }
    }
  }

  async goToBedAndSleep(bedBlock) {
    const pos = bedBlock.position;
    logger.info(`[SleepController] Freies Bett bei (${pos.x}, ${pos.y}, ${pos.z}) gefunden. Begebe mich dorthin...`);
    this.state = SLEEP_STATES.NAVIGATING_TO_BED;

    // Laufenden Bauauftrag sichern und pausieren
    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeSleep = true;
      worldExecutor.pauseBuild();
    }

    const bot = this.bot;
    if (!bot) return;

    try {
      if (bot.pathfinder) {
        try {
          const goals = await getPathfinderGoals();
          if (goals?.GoalNear) {
            await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 2.0));
          } else if (typeof bot.pathfinder.goto === 'function') {
            await bot.pathfinder.goto({ x: pos.x, y: pos.y, z: pos.z });
          }
        } catch (moveErr) {
          logger.debug(`[SleepController] Pfadfindung zum Bett fehlgeschlagen (${moveErr.message}), versuche direkte Interaktion.`);
        }
      }

      logger.info('[SleepController] Lege mich schlafen...');
      if (typeof bot.sleep === 'function') {
        await bot.sleep(bedBlock);
      }
      this.state = SLEEP_STATES.SLEEPING;
      logger.info('[SleepController] Bot liegt erfolgreich im Bett.');
    } catch (sleepErr) {
      logger.warn(`[SleepController] bot.sleep fehlgeschlagen: ${sleepErr.message}`);

      // Fallback: Wenn Monster in der Nähe sind ("monsters nearby") oder Bett belegt ist,
      // sofort sauberen Disconnect ausführen, damit Mitspieler nicht blockiert werden
      if (settings.SLEEP_DISCONNECT_ON_NO_BED) {
        await this.disconnectForNight();
      } else {
        this.state = SLEEP_STATES.AWAKE;
      }
    }
  }

  async onWake() {
    logger.info('[SleepController] Bot ist aufgewacht! Es ist Tag geworden.');
    this.state = SLEEP_STATES.AWAKE;
    if (sessionHandoff.state === HANDOFF_STATES.PAUSED_SLEEP_NIGHT) {
      sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
    }

    // Nach dem Aufwachen pausierten Bauauftrag wiederaufnehmen
    if (this.wasBuildingBeforeSleep && worldExecutor.pausedState) {
      this.wasBuildingBeforeSleep = false;
      logger.info('[SleepController] Setze pausierten Bauauftrag nach dem Schlafen fort...');
      await worldExecutor.resumeBuild(this.bot);
    }
  }

  async disconnectForNight() {
    if (this.state === SLEEP_STATES.DISCONNECTED_FOR_NIGHT) return;

    logger.warn('[SleepController] Führe sauberen Disconnect für die Nacht durch, um andere Spieler nicht zu blockieren.');
    this.state = SLEEP_STATES.DISCONNECTED_FOR_NIGHT;
    sessionHandoff.state = HANDOFF_STATES.PAUSED_SLEEP_NIGHT;
    sessionHandoff.notifyDashboard({
      type: 'status',
      state: sessionHandoff.state,
      reason: 'Night skip disconnect',
      username: this.bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
    });

    if (this.botClient && typeof this.botClient.cancelReconnect === 'function') {
      this.botClient.cancelReconnect();
    }

    // Bauauftrag pausieren
    if (worldExecutor.isBuilding) {
      this.wasBuildingBeforeSleep = true;
      worldExecutor.pauseBuild();
    }

    const bot = this.bot;
    if (bot) {
      if (typeof bot.chat === 'function') {
        try {
          bot.chat('Gute Nacht! Ich habe kein erreichbares Bett und trenne mich kurz, damit ihr die Nacht überspringen könnt.');
        } catch {}
      }

      try {
        bot.quit('Night skip disconnect');
      } catch (quitErr) {
        logger.debug(`[SleepController] bot.quit Hinweis: ${quitErr.message}`);
      }
    }

    // Timer für Reconnect starten
    const delaySec = settings.SLEEP_RECONNECT_DELAY_SEC || 25;
    logger.info(`[SleepController] Starte Reconnect-Timer (${delaySec}s) für morgendliche Rückkehr...`);

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      logger.info('[SleepController] Reconnect-Timer abgelaufen. Verbinde Bot wieder mit dem Server...');
      this.state = SLEEP_STATES.AWAKE;
      if (sessionHandoff.state === HANDOFF_STATES.PAUSED_SLEEP_NIGHT) {
        sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
      }

      if (this.botClient && typeof this.botClient.reconnect === 'function') {
        this.botClient.reconnect();
      }
    }, delaySec * 1000);
  }

  async onBotSpawn(bot) {
    logger.info('[SleepController] Bot gespawnt, überprüfe Tageszeit...');
    this.stopMonitoring();
    this.bindEvents();
    this.startMonitoring();

    // Prüfen, ob es immer noch Nacht ist
    if (this.isNight()) {
      logger.warn('[SleepController] Nach Reconnect ist immer noch Nacht.');
      const bed = await this.findReachableBed(settings.BED_SEARCH_RADIUS || 32);
      if (bed) {
        await this.goToBedAndSleep(bed);
      } else if (settings.SLEEP_DISCONNECT_ON_NO_BED) {
        await this.disconnectForNight();
      }
      return;
    }

    // Es ist Tag! Nacht erfolgreich übersprungen
    logger.info('[SleepController] Es ist Tag! Nacht erfolgreich überstanden.');
    this.state = SLEEP_STATES.AWAKE;
    if (sessionHandoff.state === HANDOFF_STATES.PAUSED_SLEEP_NIGHT) {
      sessionHandoff.state = HANDOFF_STATES.ONLINE_ACTIVE;
    }

    if (this.wasBuildingBeforeSleep && worldExecutor.pausedState) {
      this.wasBuildingBeforeSleep = false;
      logger.info('[SleepController] Setze pausierten Bauauftrag nach Reconnect am Morgen fort...');
      setTimeout(() => {
        worldExecutor.resumeBuild(bot).catch(err => {
          logger.error(`[SleepController] Fehler bei Bau-Fortsetzung: ${err.message}`);
        });
      }, 1000);
    }
  }
}

export const sleepController = new SleepController();
