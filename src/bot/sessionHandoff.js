import mcProtocol from 'minecraft-protocol';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';

export const HANDOFF_STATES = {
  ONLINE_ACTIVE: 'ONLINE_ACTIVE',
  PAUSED_OWNER_INGAME: 'PAUSED_OWNER_INGAME',
  RECONNECTING: 'RECONNECTING',
  PAUSED_SLEEP_NIGHT: 'PAUSED_SLEEP_NIGHT'
};

export class SessionHandoff {
  constructor() {
    this.state = HANDOFF_STATES.ONLINE_ACTIVE;
    this.autoResumeEnabled = true;
    this.pingTimer = null;
    this.cooldownTimer = null;
    this.wasOwnerDetected = false;
    this.botClient = null;
    this.dashboardServer = null;
    this.pendingResumeBuild = false;
  }

  setBotClient(botClient) {
    this.botClient = botClient;
  }

  setDashboardServer(dashboardServer) {
    this.dashboardServer = dashboardServer;
  }

  notifyDashboard(eventData) {
    if (this.dashboardServer && typeof this.dashboardServer.broadcast === 'function') {
      this.dashboardServer.broadcast(eventData);
    }
  }

  isPaused() {
    return (
      this.state === HANDOFF_STATES.PAUSED_OWNER_INGAME ||
      this.state === HANDOFF_STATES.RECONNECTING ||
      this.state === HANDOFF_STATES.PAUSED_SLEEP_NIGHT
    );
  }

  isDuplicateLoginReason(reason) {
    if (!reason) return false;
    const str = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
    const lower = str.toLowerCase();
    return (
      lower.includes('multiplayer.disconnect.duplicate_login') ||
      lower.includes('logged in from another location') ||
      lower.includes('anderem ort angemeldet') ||
      lower.includes('anderen ort angemeldet') ||
      lower.includes('ort angemeldet') ||
      lower.includes('duplicate_login') ||
      lower.includes('another location') ||
      lower.includes('already connected')
    );
  }

  handleKick(reason) {
    if (this.isDuplicateLoginReason(reason)) {
      logger.warn(`1-Account Handoff: Duplicate-Login erkannt ('${typeof reason === 'object' ? JSON.stringify(reason) : reason}')!`);
      this.pauseForOwner('Duplicate-Login vom Server gemeldet', true);
      return true;
    }
    return false;
  }

  pauseForOwner(reasonDesc = 'Owner hat übernommen', isDuplicateKick = false) {
    logger.warn(`1-Account Session-Handoff aktiviert: ${reasonDesc}`);

    this.pauseTimestamp = Date.now();
    // Wenn Duplicate-Kick gemeldet wurde, wissen wir sicher, dass der Owner online ist/war
    this.wasOwnerDetected = !!isDuplicateKick;

    // 1. Laufenden Bauvorgang sofort pausieren (Index wird in worldExecutor gesichert)
    const wasBuilding = worldExecutor.pauseBuild();
    if (wasBuilding) {
      this.pendingResumeBuild = true;
    }

    // 2. Status auf PAUSED_OWNER_INGAME setzen
    this.state = HANDOFF_STATES.PAUSED_OWNER_INGAME;
    this.notifyDashboard({
      type: 'status',
      state: this.state,
      reason: reasonDesc,
      username: this.botClient?.bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
    });

    // 3. Sofortigen Reconnect verhindern
    if (this.botClient) {
      this.botClient.cancelReconnect();
      if (this.botClient.bot) {
        try {
          this.botClient.bot.quit();
        } catch {
          // Ignorieren
        }
      }
    }

    // 4. Ping-Loop starten
    this.startPingLoop();
  }

  releaseAccount() {
    this.pauseForOwner('Web-Dashboard: Account freigegeben', false);
  }

  startPingLoop() {
    this.stopPingLoop();

    const intervalMs = settings.SERVER_PING_INTERVAL_MS || 10000;
    logger.info(`Starte Server-Ping-Loop alle ${intervalMs / 1000}s auf ${settings.MC_HOST}:${settings.MC_PORT}...`);

    this._pingSessionId = (this._pingSessionId || 0) + 1;
    const currentSessionId = this._pingSessionId;

    const runPing = async () => {
      if (this.state !== HANDOFF_STATES.PAUSED_OWNER_INGAME || !this.autoResumeEnabled || this._pingSessionId !== currentSessionId) {
        this.stopPingLoop();
        return;
      }

      try {
        const pingFn = mcProtocol.ping || (mcProtocol.default && mcProtocol.default.ping);
        if (!pingFn) {
          logger.warn('minecraft-protocol ping-Funktion nicht gefunden.');
          return;
        }

        const response = await pingFn({
          host: settings.MC_HOST,
          port: settings.MC_PORT
        });

        // Sicherstellen, dass der Loop während des asynchronen Pings nicht gestoppt oder invalidiert wurde
        if (this.state !== HANDOFF_STATES.PAUSED_OWNER_INGAME || !this.autoResumeEnabled || this._pingSessionId !== currentSessionId) {
          return;
        }

        const sample = response?.players?.sample;
        const targetUsername = (settings.MC_USERNAME || '').toLowerCase();
        const elapsedSincePause = Date.now() - (this.pauseTimestamp || 0);

        if (Array.isArray(sample)) {
          const ownerFound = sample.some(p => (p.name || '').toLowerCase() === targetUsername);
          if (ownerFound) {
            this.wasOwnerDetected = true;
            logger.debug(`Server-Ping: Account '${settings.MC_USERNAME}' ist aktiv im Spiel.`);
          } else {
            // Reconnect auslösen wenn:
            // a) Owner wurde vorher aktiv erkannt und ist jetzt weg
            // b) Es war ein Duplicate-Kick und nach mindestens 1 Intervall ist der Account nicht mehr in der Liste
            if (this.wasOwnerDetected && elapsedSincePause >= Math.min(intervalMs, 4000)) {
              logger.info(`Server-Ping: Account '${settings.MC_USERNAME}' ist nicht mehr online. Starte automatischen Reconnect!`);
              this.resumeBot();
              return;
            }
          }
        } else if (typeof response?.players?.online === 'number') {
          // Fallback für Server, die Spieler-Sample verstecken: Wenn Server komplett leer ist (0 Spieler online)
          if (response.players.online === 0 && elapsedSincePause >= Math.min(intervalMs, 4000)) {
            logger.info('Server-Ping: Server meldet 0 Online-Spieler. Starte automatischen Reconnect!');
            this.resumeBot();
            return;
          }
        }
      } catch (err) {
        logger.debug(`Server-Ping fehlgeschlagen (${err.message}). Warte auf nächsten Intervall.`);
      }
    };

    // Ersten Ping sofort ausführen
    runPing();
    this.pingTimer = setInterval(runPing, intervalMs);
  }

  stopPingLoop() {
    this._pingSessionId = (this._pingSessionId || 0) + 1;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  resumeBot() {
    if (this.state === HANDOFF_STATES.RECONNECTING) {
      logger.info('Bot-Reconnect läuft bereits.');
      return;
    }

    this.stopPingLoop();
    this.state = HANDOFF_STATES.RECONNECTING;
    this.notifyDashboard({
      type: 'status',
      state: this.state,
      username: this.botClient?.bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
    });

    logger.info('Warte 4.000 ms Cooldown vor Reconnect...');

    if (this.cooldownTimer) {
      clearTimeout(this.cooldownTimer);
    }

    this.cooldownTimer = setTimeout(() => {
      this.cooldownTimer = null;
      if (this.botClient) {
        logger.info('Cooldown abgelaufen. Verbinde Bot wieder mit dem Server...');
        this.botClient.reconnect();
      }
    }, 4000);
  }

  onBotSpawn(bot) {
    logger.info(`Bot gespawnt! Setze Session-Status auf ONLINE_ACTIVE.`);
    this.state = HANDOFF_STATES.ONLINE_ACTIVE;
    this.notifyDashboard({
      type: 'status',
      state: this.state,
      username: bot?.username || this.botClient?.bot?.username || settings.MC_USERNAME || 'BaumeisterKI'
    });

    // Wenn zuvor ein Bauvorgang pausiert war, exakt fortsetzen!
    if (worldExecutor.pausedState || this.pendingResumeBuild) {
      this.pendingResumeBuild = false;
      logger.info('Setze unterbrochenen Bauauftrag nach Reconnect automatisch fort...');
      setTimeout(() => {
        worldExecutor.resumeBuild(bot).catch(err => {
          logger.error(`Fehler bei automatischer Bau-Fortsetzung: ${err.message}`);
        });
      }, 1000);
    }
  }
}

export const sessionHandoff = new SessionHandoff();
