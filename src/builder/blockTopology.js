import { Vec3 } from 'vec3';

export const FRAGILE_BLOCK_PATTERNS = [
  'torch',
  'wall_torch',
  'lantern',
  'soul_lantern',
  '_door',
  '_bed',
  '_carpet',
  '_trapdoor',
  '_button',
  'lever',
  'ladder',
  'vine',
  'glow_lichen',
  'flower_pot',
  'bell',
  '_banner',
  '_sign',
  'redstone_wire',
  'repeater',
  'comparator',
  'campfire'
];

/**
 * Checks whether a block name represents a fragile block that requires solid support.
 * @param {string} blockName
 * @returns {boolean}
 */
export function isFragileBlock(blockName) {
  if (!blockName || blockName === 'air') return false;
  return FRAGILE_BLOCK_PATTERNS.some(pat => blockName.includes(pat) || blockName.endsWith(pat));
}

/**
 * Parses block state properties from bracket syntax (e.g. "oak_door[facing=north,half=bottom]").
 * @param {string} blockStr
 * @returns {Record<string, string>}
 */
export function parseBlockProperties(blockStr) {
  if (!blockStr || typeof blockStr !== 'string') return {};
  const match = blockStr.match(/\[(.*)\]$/);
  if (!match) return {};
  const props = {};
  for (const pair of match[1].split(',')) {
    const [k, v] = pair.split('=');
    if (k && v !== undefined) props[k.trim()] = v.trim();
  }
  return props;
}

/**
 * Sorts placement neighbor candidates based on block orientation & properties.
 * @param {Array<{offset: Vec3, face: Vec3}>} neighbors
 * @param {string} blockName
 * @param {Record<string, string>} props
 * @returns {Array<{offset: Vec3, face: Vec3}>}
 */
export function sortNeighborsForBlock(neighbors, blockName, props = {}) {
  const sorted = [...neighbors];
  const name = (blockName || '').toLowerCase();

  // 1. Wall torches & wall lanterns
  if (name.includes('wall_torch') || name.includes('wall_hanging')) {
    const facing = props.facing || 'south';
    const preferredFaceMap = {
      south: { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      north: { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
      east:  { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
      west:  { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) }
    };
    const pref = preferredFaceMap[facing];
    if (pref) {
      sorted.sort((a, b) => (a.face.equals(pref.face) ? -1 : (b.face.equals(pref.face) ? 1 : 0)));
      return sorted;
    }
  }

  // 2. Axis alignment (Logs, Basalt, Pillars)
  if (props.axis) {
    if (props.axis === 'y') {
      sorted.sort((a, b) => (Math.abs(a.face.y) > 0 ? -1 : (Math.abs(b.face.y) > 0 ? 1 : 0)));
    } else if (props.axis === 'x') {
      sorted.sort((a, b) => (Math.abs(a.face.x) > 0 ? -1 : (Math.abs(b.face.x) > 0 ? 1 : 0)));
    } else if (props.axis === 'z') {
      sorted.sort((a, b) => (Math.abs(a.face.z) > 0 ? -1 : (Math.abs(b.face.z) > 0 ? 1 : 0)));
    }
    return sorted;
  }

  // 3. Top vs Bottom slabs & stairs
  if (props.half === 'top' || props.type === 'top') {
    sorted.sort((a, b) => (a.face.y < 0 ? -1 : (b.face.y < 0 ? 1 : 0)));
    return sorted;
  }
  if (props.half === 'bottom' || props.type === 'bottom') {
    sorted.sort((a, b) => (a.face.y > 0 ? -1 : (b.face.y > 0 ? 1 : 0)));
    return sorted;
  }

  return sorted;
}

/**
 * Sorts blocks into two phases (support structure & fragile blocks) using boustrophedon pattern.
 * @param {Array<any>} blockList
 * @returns {{ phase1: Array<any>, phase2: Array<any> }}
 */
export function topologicalSort(blockList) {
  const phase1 = []; // Solid structure
  const phase2 = []; // Fragile & attached blocks

  for (const b of blockList) {
    const name = b.name || b.blockState?.name || 'air';
    if (isFragileBlock(name)) {
      phase2.push(b);
    } else {
      phase1.push(b);
    }
  }

  // Phase 1: Boustrophedon pattern (y ascending, z alternating x ascending/descending)
  phase1.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    if (a.z !== b.z) return a.z - b.z;
    const isReverseRow = Math.abs(a.z) % 2 === 1;
    return isReverseRow ? b.x - a.x : a.x - b.x;
  });

  // Phase 2: Fragile blocks sorted ascending by Y
  phase2.sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x || a.z - b.z;
  });

  return { phase1, phase2 };
}
