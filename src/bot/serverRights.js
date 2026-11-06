import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';

/**
 * ServerRightsManager überwacht dynamisch die Server-Rechte (OP-Status, Permission-Levels)
 * des Bots und bestimmt den optimalen Ausführungsmodus (pure_physical vs. hybrid_visual).
 */
export class ServerRightsManager {
  constructor() {
    this.isOp = false;
    this.permissionLevel = 0; // 0: Normal, 1: Moderator, 2: Gamemaster, 3: Admin, 4: Owner
    this.hasCommandAccess = false;
    this.detectionSource = 'default';
    this.lastChecked = null;
    this.listeners = [];
    this.attachedBot = null;
  }

  reset() {
    this.isOp = false;
    this.permissionLevel = 0;
    this.hasCommandAccess = false;
    this.detectionSource = 'default';
    this.lastChecked = Date.now();
  }

  attachToBot(bot) {
    if (!bot) return;
    this.attachedBot = bot;
    this.reset();

    // 1. entity_status Packet-Listener (Vanilla Minecraft OP-Level Paket 24..28)
    if (bot._client && typeof bot._client.on === 'function') {
      bot._client.on('entity_status', (packet) => {
        if (!packet) return;
        // Wenn entityId übereinstimmt oder nicht gesetzt ist
        const botId = bot.entity?.id ?? bot._client?.entityId;
        if (packet.entityId === undefined || packet.entityId === botId) {
          if (typeof packet.entityStatus === 'number' && packet.entityStatus >= 24 && packet.entityStatus <= 28) {
            const level = packet.entityStatus - 24;
            this.setPermissionLevel(level, 'packet_entity_status');
          }
        }
      });

      // 2. declare_commands Paket-Listener (Minecraft 1.13+)
      bot._client.on('declare_commands', (packet) => {
        if (packet && Array.isArray(packet.nodes)) {
          const hasSetblock = packet.nodes.some(n => {
            const name = n.name || n.extraNodeData?.name;
            return name === 'setblock' || name === 'fill';
          });
          if (hasSetblock) {
            this.setOp(true, 'declare_commands');
          } else {
            this.setOp(false, 'declare_commands');
          }
        }
      });
    }

    // 3. Creative-Gamemode Prüfung beim Spawnen und bei Spielzustandsänderungen
    if (typeof bot.on === 'function') {
      const checkGamemode = () => {
        this.lastChecked = Date.now();
        const isCreative = (bot.player && bot.player.gamemode === 1) || (bot.game && bot.game.gameMode === 'creative');
        if (isCreative) {
          this.setOp(true, 'creative_gamemode');
        } else if (this.detectionSource === 'creative_gamemode') {
          this.setOp(false, 'gamemode_changed');
        }
      };

      bot.on('spawn', checkGamemode);
      bot.on('game', checkGamemode);

      // 4. Chat-Feedback-Überwachung auf fehlende Berechtigungen
      bot.on('messagestr', (msg) => {
        if (!msg) return;
        const lower = msg.toLowerCase();
        if (
          lower.includes('do not have permission') ||
          lower.includes('keine berechtigung') ||
          lower.includes('unknown command') ||
          lower.includes('unknown or incomplete command') ||
          lower.includes('du bist kein operator') ||
          lower.includes('nur für operatoren') ||
          lower.includes('befehl unbekannt')
        ) {
          logger.warn(`[ServerRights] OP-Befehl vom Server abgewiesen: "${msg}". Schalte dynamisch auf Non-OP (pure_physical / Survival) um.`);
          this.setOp(false, 'command_rejected');
        }
      });
    }
  }

  setPermissionLevel(level, source = 'detected') {
    this.permissionLevel = Math.max(0, Math.min(4, level));
    this.isOp = this.permissionLevel >= 2;
    this.hasCommandAccess = this.isOp;
    if (this.attachedBot) this.attachedBot.isOp = this.isOp;
    this.detectionSource = source;
    this.lastChecked = Date.now();
    logger.info(`[ServerRights] OP-Berechtigung erkannt: Level ${this.permissionLevel} (OP: ${this.isOp}, Quelle: ${source})`);
    this.notify();
  }

  setOp(isOp, source = 'detected') {
    this.isOp = Boolean(isOp);
    this.permissionLevel = this.isOp ? Math.max(this.permissionLevel, 2) : 0;
    this.hasCommandAccess = this.isOp;
    if (this.attachedBot) this.attachedBot.isOp = this.isOp;
    this.detectionSource = source;
    this.lastChecked = Date.now();
    logger.info(`[ServerRights] OP-Status gesetzt: ${this.isOp} (Quelle: ${source})`);
    this.notify();
  }

  getEffectiveMode(requestedMode = settings.BUILD_EXECUTION_MODE, rconAvailable = false, isOpOverride = null) {
    const mode = requestedMode || 'auto';
    const effectiveIsOp = isOpOverride !== null ? Boolean(isOpOverride) : this.isOp;

    if (mode === 'pure_physical') {
      return 'pure_physical';
    }
    if (mode === 'rcon_visual') {
      return 'rcon_visual';
    }
    if (mode === 'hybrid_visual') {
      // Wenn der Server ausdrücklich keine OP-Rechte erteilt hat, schütze den Ablauf
      if (effectiveIsOp === false && this.detectionSource !== 'default') {
        logger.warn('[ServerRights] hybrid_visual angefordert, aber Bot besitzt keine OP-Rechte. Wechsle automatisch zu pure_physical.');
        return 'pure_physical';
      }
      return 'hybrid_visual';
    }

    // Auto-Modus: Vollständig nach den Server-Rechten des Bots richten
    if (mode === 'auto') {
      return effectiveIsOp ? 'hybrid_visual' : 'pure_physical';
    }

    return 'pure_physical';
  }

  getStatus(bot = null) {
    const targetBot = bot || this.attachedBot;
    // Falls bot explizite Eigenschaften hat (z. B. in Tests)
    if (targetBot && typeof targetBot.isOp === 'boolean' && this.detectionSource === 'default') {
      const botIsOp = targetBot.isOp;
      return {
        isOp: botIsOp,
        permissionLevel: botIsOp ? 4 : 0,
        hasCommandAccess: botIsOp,
        detectionSource: 'bot_property',
        lastChecked: this.lastChecked || Date.now(),
        effectiveMode: this.getEffectiveMode(settings.BUILD_EXECUTION_MODE, Boolean(settings.RCON_PASSWORD), botIsOp)
      };
    }

    return {
      isOp: this.isOp,
      permissionLevel: this.permissionLevel,
      hasCommandAccess: this.hasCommandAccess,
      detectionSource: this.detectionSource,
      lastChecked: this.lastChecked || Date.now(),
      effectiveMode: this.getEffectiveMode(settings.BUILD_EXECUTION_MODE, Boolean(settings.RCON_PASSWORD))
    };
  }

  onChange(fn) {
    if (typeof fn === 'function') {
      this.listeners.push(fn);
    }
  }

  notify() {
    const status = this.getStatus();
    for (const fn of this.listeners) {
      try {
        fn(status);
      } catch (err) {
        logger.debug(`Fehler in ServerRights Listener: ${err.message}`);
      }
    }
  }
}

export const serverRights = new ServerRightsManager();
