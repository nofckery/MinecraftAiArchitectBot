import { Vec3 } from 'vec3';
import { Rcon } from 'rcon-client';
import { settings } from '../../config/settings.js';
import { logger } from '../../utils/logger.js';

/**
 * Ensures active RCON client connection.
 *
 * @param {Object} executor - WorldExecutor instance
 * @returns {Promise<Object|null>}
 */
export async function ensureRconConnection(executor) {
  if (executor.rconConnected && executor.rconClient) return executor.rconClient;

  try {
    executor.rconClient = await Rcon.connect({
      host: settings.RCON_HOST,
      port: settings.RCON_PORT,
      password: settings.RCON_PASSWORD
    });
    executor.rconConnected = true;
    logger.info(`RCON-Verbindung erfolgreich aufgebaut zu ${settings.RCON_HOST}:${settings.RCON_PORT}`);
    return executor.rconClient;
  } catch (err) {
    executor.rconConnected = false;
    executor.rconClient = null;
    logger.error(`RCON-Verbindungsfehler: ${err.message}. Fallback auf hybrid_visual.`);
    return null;
  }
}

/**
 * Disconnects active RCON connection if present.
 *
 * @param {Object} executor - WorldExecutor instance
 */
export async function disconnectRconConnection(executor) {
  if (executor.rconClient) {
    try {
      await executor.rconClient.end();
    } catch {
      // Ignorieren
    }
    executor.rconClient = null;
    executor.rconConnected = false;
  }
}

/**
 * Executes a single block placement change via RCON, chat command, or physical mode.
 *
 * @param {Object} executor
 * @param {Object} bot
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {string} blockStateString
 * @param {string} mode
 */
export async function executeBlockChange(executor, bot, x, y, z, blockStateString, mode) {
  const targetPos = new Vec3(x, y, z);

  // Visuelle Animation: Bot schaut zum Block und schwingt den Arm
  if (bot && bot.entity) {
    try {
      bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true).catch(err => {
        logger.debug(`Visueller Blick-Fehler: ${err?.message}`);
      });
      bot.swingArm('right');
    } catch (err) {
      logger.debug(`Visuelle Animation fehlgeschlagen: ${err?.message}`);
    }
  }

  if (mode === 'rcon_visual') {
    const rcon = await executor.ensureRcon();
    if (rcon) {
      await rcon.send(`setblock ${x} ${y} ${z} ${blockStateString} replace`);
      return;
    }
    // Falls RCON fehlgeschlagen ist, Fallback auf Chat-Befehl
    bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
  } else if (mode === 'hybrid_visual') {
    bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
  } else if (mode === 'pure_physical') {
    await executor.placeBlockPhysically(bot, x, y, z, blockStateString, mode);
  }
}

/**
 * Executes a /fill box command via RCON or chat.
 *
 * @param {Object} executor
 * @param {Object} bot
 * @param {Object} box
 * @param {string} mode
 */
export async function executeFillBox(executor, bot, box, mode) {
  const targetPos = new Vec3(box.minX, box.minY, box.minZ);
  if (bot && bot.entity) {
    try {
      bot.lookAt(targetPos.offset(0.5, 0.5, 0.5), true).catch(err => {
        logger.debug(`Visueller Blick-Fehler: ${err?.message}`);
      });
      bot.swingArm('right');
    } catch (err) {
      logger.debug(`Visuelle Animation fehlgeschlagen: ${err?.message}`);
    }
  }

  const cmd = `fill ${box.minX} ${box.minY} ${box.minZ} ${box.maxX} ${box.maxY} ${box.maxZ} ${box.fullBlockString} replace`;
  if (mode === 'rcon_visual') {
    const rcon = await executor.ensureRcon();
    if (rcon) {
      await rcon.send(cmd);
      return;
    }
    bot.chat(`/${cmd}`);
  } else {
    bot.chat(`/${cmd}`);
  }
}
