export const SUPPORTED_VIEWER_ENTITIES = new Set([
  'armor_stand', 'arrow', 'bat', 'bee', 'blaze', 'boat', 'cat', 'cave_spider', 'chest_minecart',
  'chicken', 'cod', 'command_block_minecart', 'cow', 'creeper', 'dolphin', 'donkey', 'dragon_fireball',
  'drowned', 'egg', 'elder_guardian', 'ender_dragon', 'ender_pearl', 'enderman', 'endermite',
  'evoker', 'evoker_fangs', 'experience_bottle', 'experience_orb', 'eye_of_ender', 'fireball',
  'firework_rocket', 'fishing_bobber', 'fox', 'ghast', 'guardian', 'hoglin', 'hopper_minecart',
  'horse', 'husk', 'iron_golem', 'leash_knot', 'llama', 'llama_spit', 'magma_cube', 'minecart',
  'mooshroom', 'mule', 'ocelot', 'panda', 'parrot', 'phantom', 'pig', 'piglin', 'piglin_brute',
  'pillager', 'player', 'polar_bear', 'potion', 'pufferfish', 'rabbit', 'ravager', 'salmon',
  'sheep', 'shulker', 'shulker_bullet', 'silverfish', 'skeleton', 'skeleton_horse', 'slime',
  'small_fireball', 'snow_golem', 'snowball', 'spider', 'squid', 'stray', 'strider', 'tnt_minecart',
  'trident', 'tropical_fish', 'turtle', 'vex', 'villager', 'vindicator', 'wandering_trader',
  'witch', 'wither', 'wither_skeleton', 'wither_skull', 'wolf', 'zoglin', 'zombie', 'zombie_horse',
  'zombie_villager', 'zombified_piglin'
]);

/**
 * Normalizes entity models to prevent prismarine-viewer crashes for unsupported entity types.
 * @param {any} entity
 * @returns {any}
 */
export function sanitizeViewerEntity(entity) {
  if (!entity) return entity;
  const name = entity.name;
  if (!name || typeof name !== 'string') return entity;

  if (SUPPORTED_VIEWER_ENTITIES.has(name)) return entity;

  // Map variants to existing models where possible
  let mapped = null;
  if (name.includes('boat') || name.includes('raft')) mapped = 'boat';
  else if (name.includes('squid')) mapped = 'squid';
  else if (name.includes('ghast')) mapped = 'ghast';
  else if (name.includes('zombie')) mapped = 'zombie';
  else if (name.includes('skeleton')) mapped = 'skeleton';
  else if (name.includes('spider')) mapped = 'spider';
  else if (name.includes('minecart')) mapped = 'minecart';
  else if (name.includes('horse')) mapped = 'horse';

  const finalName = mapped && SUPPORTED_VIEWER_ENTITIES.has(mapped) ? mapped : undefined;

  return new Proxy(entity, {
    get(target, prop, receiver) {
      if (prop === 'name') return finalName;
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}
