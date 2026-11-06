/**
 * Asynchronously imports mineflayer-pathfinder and returns its goals object,
 * or null if unavailable / import fails.
 *
 * @returns {Promise<object|null>}
 */
export async function getPathfinderGoals() {
  try {
    const pf = await import('mineflayer-pathfinder');
    return pf.goals || pf.default?.goals || null;
  } catch {
    return null;
  }
}

/**
 * Asynchronously loads mineflayer-pathfinder and instantiates Movements for a bot.
 *
 * @param {object} bot - Mineflayer bot instance
 * @returns {Promise<object|null>}
 */
export async function createMovements(bot) {
  try {
    const pf = await import('mineflayer-pathfinder');
    const Movements = pf.Movements || pf.default?.Movements;
    if (Movements && bot) {
      return new Movements(bot);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Asynchronously loads and returns mineflayer-pathfinder module or its default export.
 *
 * @returns {Promise<object|null>}
 */
export async function loadPathfinder() {
  try {
    const pf = await import('mineflayer-pathfinder');
    return pf.default || pf;
  } catch {
    return null;
  }
}
