export const HOSTILE_MOBS = new Set([
  'zombie',
  'skeleton',
  'creeper',
  'spider',
  'cave_spider',
  'witch',
  'phantom',
  'drowned',
  'husk',
  'stray',
  'pillager',
  'vindicator',
  'ravager',
  'evoker',
  'vex',
  'slime',
  'magma_cube',
  'silverfish',
  'endermite',
  'wither_skeleton',
  'blaze',
  'ghast',
  'hoglin',
  'piglin_brute',
  'warden',
  'wither',
  'ender_dragon'
]);

/**
 * Durchsucht sichtbare Entitäten nach der nächsten feindlichen Bedrohung im Radius.
 */
export function findNearbyThreat(bot, radius = 12.0) {
  if (!bot?.entities || !bot?.entity?.position) return null;

  let closestMob = null;
  let minDistance = radius;
  const botPos = bot.entity.position;

  for (const id in bot.entities) {
    const entity = bot.entities[id];
    if (!entity || entity === bot.entity) continue;
    if (entity.isValid === false) continue;
    if (typeof entity.health === 'number' && entity.health <= 0) continue;
    if (!entity.name || !HOSTILE_MOBS.has(entity.name.toLowerCase())) continue;
    if (!entity.position) continue;

    const dist = botPos.distanceTo(entity.position);
    if (dist <= minDistance) {
      minDistance = dist;
      closestMob = entity;
    }
  }

  return closestMob;
}
