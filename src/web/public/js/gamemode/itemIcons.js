/**
 * Universal Item Icon Map matching standard Minecraft items.
 * @param {string} name
 * @returns {string} Emoji representation
 */
export function getItemIcon(name) {
  if (!name) return '';
  const lower = name.toLowerCase();

  // Weapons & Tools
  if (lower.includes('sword')) return '⚔️';
  if (lower.includes('bow')) return '🏹';
  if (lower.includes('arrow')) return '🎯';
  if (lower.includes('shield')) return '🛡️';
  if (lower.includes('trident')) return '🔱';
  if (lower.includes('pickaxe')) return '⛏️';
  if (lower.includes('axe')) return '🪓';
  if (lower.includes('shovel')) return '🥄';
  if (lower.includes('hoe')) return '🧑‍🌾';
  if (lower.includes('shears')) return '✂️';
  if (lower.includes('fishing_rod')) return '🎣';
  if (lower.includes('flint_and_steel')) return '🔥';

  // Armor
  if (lower.includes('helmet') || lower.includes('cap')) return '🪖';
  if (lower.includes('chestplate') || lower.includes('tunic')) return '🥋';
  if (lower.includes('leggings') || lower.includes('pants')) return '👖';
  if (lower.includes('boots')) return '👢';
  if (lower.includes('elytra')) return '🪽';

  // Food & Potions
  if (lower.includes('golden_apple')) return '🍏';
  if (lower.includes('apple')) return '🍎';
  if (lower.includes('bread')) return '🍞';
  if (lower.includes('beef') || lower.includes('pork') || lower.includes('mutton') || lower.includes('chicken')) return '🍖';
  if (lower.includes('fish') || lower.includes('salmon') || lower.includes('cod')) return '🐟';
  if (lower.includes('carrot')) return '🥕';
  if (lower.includes('potato')) return '🥔';
  if (lower.includes('melon')) return '🍉';
  if (lower.includes('potion') || lower.includes('bottle')) return '🧪';

  // Ores & Minerals
  if (lower.includes('diamond')) return '💎';
  if (lower.includes('emerald')) return '🟢';
  if (lower.includes('iron_ingot')) return '🪙';
  if (lower.includes('gold_ingot')) return '🧈';
  if (lower.includes('netherite')) return '⬛';
  if (lower.includes('coal') || lower.includes('charcoal')) return '🪨';
  if (lower.includes('redstone')) return '🔴';
  if (lower.includes('lapis')) return '🔷';
  if (lower.includes('quartz')) return '⚪';
  if (lower.includes('copper')) return '🟫';

  // Utility & Misc
  if (lower.includes('torch')) return '🕯️';
  if (lower.includes('lantern')) return '🏮';
  if (lower.includes('bed')) return '🛏️';
  if (lower.includes('chest') || lower.includes('barrel') || lower.includes('shulker')) return '📦';
  if (lower.includes('crafting_table')) return '🪚';
  if (lower.includes('furnace')) return '♨️';
  if (lower.includes('anvil')) return '🔨';
  if (lower.includes('door') || lower.includes('trapdoor')) return '🚪';
  if (lower.includes('glass')) return '🪟';
  if (lower.includes('bucket')) return '🪣';
  if (lower.includes('water')) return '💧';
  if (lower.includes('lava')) return '🔥';
  if (lower.includes('tnt')) return '🧨';
  if (lower.includes('book')) return '📖';
  if (lower.includes('stick')) return '🥢';
  if (lower.includes('string')) return '🧵';
  if (lower.includes('feather')) return '🪶';
  if (lower.includes('bone')) return '🦴';

  // Blocks
  if (lower.includes('log') || lower.includes('plank') || lower.includes('wood')) return '🪵';
  if (lower.includes('cobble') || lower.includes('stone') || lower.includes('brick') || lower.includes('deepslate')) return '🧱';
  if (lower.includes('dirt') || lower.includes('grass')) return '🟫';
  if (lower.includes('sand')) return '🟨';

  return '📦';
}
