import { createRequire } from 'module';
import { VersionResolver } from '../../../config/versionResolver.js';

const require = createRequire(import.meta.url);
const mcData = require('minecraft-data');
const prismarineBlock = require('prismarine-block');

export function loadMcData(version) {
  try {
    const data = mcData(version);
    if (data && data.blocks) return data;
  } catch {}
  if (version.startsWith('26.')) {
    try {
      return mcData('26.1') || mcData('1.21.4');
    } catch {}
  }
  return mcData('1.21.4');
}

export function loadBlockClass(version) {
  try {
    return prismarineBlock(version);
  } catch {
    return null;
  }
}

/**
 * Resolves a sensible substitute block definition in the target version when
 * a block does not exist in the target (e.g. newer 26.x blocks or protocol 777 additions).
 *
 * @param {string} srcName
 * @param {Object} tgtMcData
 * @returns {Object} Target block definition
 */
export function resolveFallbackBlock(srcName, tgtMcData) {
  if (!srcName || typeof srcName !== 'string') return null;
  let cleanName = srcName.trim().toLowerCase();
  if (cleanName.startsWith('minecraft:')) {
    cleanName = cleanName.slice(10);
  }
  const bracketIdx = cleanName.indexOf('[');
  if (bracketIdx !== -1) {
    cleanName = cleanName.slice(0, bracketIdx).trim();
  }
  const tgt = tgtMcData;
  if (tgt.blocksByName[cleanName]) return tgt.blocksByName[cleanName];

  // 1. Direct model substitutions for known modern/experimental blocks
  const directMap = {
    copper_torch: 'torch',
    copper_wall_torch: 'wall_torch',
    copper_lantern: 'lantern',
    copper_chain: 'chain',
    iron_chain: 'chain',
    copper_bars: 'iron_bars',
    exposed_copper_bars: 'iron_bars',
    weathered_copper_bars: 'iron_bars',
    oxidized_copper_bars: 'iron_bars',
    waxed_copper_bars: 'iron_bars',
    copper_chest: 'chest',
    short_dry_grass: 'short_grass',
    tall_dry_grass: 'tall_grass',
    bush: 'dead_bush',
    red_shrub: 'dead_bush',
    wildflowers: 'dandelion',
    cactus_flower: 'dandelion',
    golden_dandelion: 'dandelion',
    potted_golden_dandelion: 'potted_dandelion',
    firefly_bush: 'sweet_berry_bush',
    leaf_litter: 'pink_petals',
    dried_ghast: 'white_wool',
    copper_golem_statue: 'iron_block',
    straw_bed: 'white_bed',
    pale_oak_shelf: 'pale_oak_slab',
    pale_oak_shelves: 'pale_oak_slab',
    shelf_mushroom: 'brown_mushroom',
    deepslate_tiles: 'deepslate_tiles'
  };

  if (directMap[cleanName] && tgt.blocksByName[directMap[cleanName]]) {
    return tgt.blocksByName[directMap[cleanName]];
  }

  // 2. Heuristic pattern substitutions based on functional block family
  if (cleanName.endsWith('_bars')) return tgt.blocksByName['iron_bars'];
  if (cleanName.endsWith('_chain')) return tgt.blocksByName['chain'];
  if (cleanName.endsWith('_lantern')) return tgt.blocksByName['lantern'];
  if (cleanName.endsWith('_torch')) return tgt.blocksByName['torch'];
  if (cleanName.includes('shelf_mushroom')) return tgt.blocksByName['brown_mushroom'] || tgt.blocksByName['red_mushroom'];
  if (cleanName.endsWith('_shelf') || cleanName.endsWith('_shelves')) {
    const wood = cleanName.endsWith('_shelves') ? cleanName.slice(0, -8) : cleanName.slice(0, -6);
    if (wood === 'poplar') return tgt.blocksByName['oak_slab'] || tgt.blocksByName['oak_planks'];
    const slabName = `${wood}_slab`;
    if (tgt.blocksByName[slabName]) return tgt.blocksByName[slabName];
    const trapdoorName = `${wood}_trapdoor`;
    if (tgt.blocksByName[trapdoorName]) return tgt.blocksByName[trapdoorName];
    const planksName = `${wood}_planks`;
    if (tgt.blocksByName[planksName]) return tgt.blocksByName[planksName];
    return tgt.blocksByName['oak_slab'] || tgt.blocksByName['oak_planks'];
  }
  if (cleanName === 'shelf' || cleanName === 'shelves') {
    return tgt.blocksByName['oak_slab'] || tgt.blocksByName['oak_planks'];
  }
  if (cleanName.includes('poplar_log')) return tgt.blocksByName['oak_log'];
  if (cleanName.includes('poplar_wood')) return tgt.blocksByName['oak_wood'];
  if (cleanName.includes('poplar_planks')) return tgt.blocksByName['oak_planks'];
  if (cleanName.includes('poplar_leaves')) return tgt.blocksByName['oak_leaves'];
  if (cleanName.includes('poplar_sapling')) return tgt.blocksByName['oak_sapling'];
  if (cleanName.includes('wool_stairs')) return tgt.blocksByName['oak_stairs'];
  if (cleanName.endsWith('_wall')) return tgt.blocksByName['cobblestone_wall'];
  if (cleanName.endsWith('_slab')) return tgt.blocksByName['stone_slab'];
  if (cleanName.endsWith('_stairs')) return tgt.blocksByName['stone_stairs'];
  if (cleanName.endsWith('_door')) return tgt.blocksByName['oak_door'];
  if (cleanName.endsWith('_trapdoor')) return tgt.blocksByName['oak_trapdoor'];
  if (cleanName.endsWith('_fence')) return tgt.blocksByName['oak_fence'];
  if (cleanName.endsWith('_fence_gate')) return tgt.blocksByName['oak_fence_gate'];
  if (cleanName.endsWith('_leaves')) return tgt.blocksByName['oak_leaves'];
  if (cleanName.endsWith('_log')) return tgt.blocksByName['oak_log'];
  if (cleanName.endsWith('_planks')) return tgt.blocksByName['oak_planks'];
  if (cleanName.includes('grass')) return tgt.blocksByName['short_grass'] || tgt.blocksByName['grass_block'];
  if (cleanName.includes('bush') || cleanName.includes('shrub')) return tgt.blocksByName['dead_bush'];
  if (cleanName.includes('copper')) return tgt.blocksByName['copper_block'];
  if (cleanName.includes('sulfur')) return tgt.blocksByName['yellow_concrete'] || tgt.blocksByName['sandstone'];
  if (cleanName.includes('deepslate')) return tgt.blocksByName['deepslate_tiles'] || tgt.blocksByName['deepslate'];

  return tgt.blocksByName['stone'] || tgt.blocksByName['dirt'] || tgt.blocksByName['air'];
}

export function applyExplicitGuarantees(table, tgtMcData) {
  const tgtDeepslateTiles = tgtMcData.blocksByName['deepslate_tiles']?.defaultState;
  if (typeof tgtDeepslateTiles === 'number') {
    table[28748] = tgtDeepslateTiles;
    if (table.length > 34598) {
      table[34598] = tgtDeepslateTiles;
    }
  }
}

export function mapVersionStates(data, BlockClass, table, tgtMcData, BlockTarget, targetAirStateId) {
  for (const blockDef of Object.values(data.blocks)) {
    if (!blockDef) continue;
    const minId = blockDef.minStateId ?? blockDef.defaultState;
    const maxId = blockDef.maxStateId ?? blockDef.defaultState;
    if (typeof minId !== 'number' || typeof maxId !== 'number') continue;

    const targetBlockDef = tgtMcData.blocksByName[blockDef.name] || resolveFallbackBlock(blockDef.name, tgtMcData);
    const targetDefault = targetBlockDef?.defaultState ?? targetAirStateId;

    if (!blockDef.states || blockDef.states.length === 0) {
      if (minId >= 0 && minId < table.length) {
        table[minId] = targetDefault;
      }
      continue;
    }

    const srcCount = (maxId - minId + 1);
    const tgtMin = targetBlockDef?.minStateId ?? targetBlockDef?.defaultState;
    const tgtMax = targetBlockDef?.maxStateId ?? targetBlockDef?.defaultState;
    const tgtCount = (typeof tgtMin === 'number' && typeof tgtMax === 'number') ? (tgtMax - tgtMin + 1) : 0;

    if (targetBlockDef && targetBlockDef.name === blockDef.name && srcCount === tgtCount && typeof tgtMin === 'number') {
      for (let offset = 0; offset < srcCount; offset++) {
        const sId = minId + offset;
        if (sId >= 0 && sId < table.length) {
          table[sId] = tgtMin + offset;
        }
      }
      continue;
    }

    for (let stateId = minId; stateId <= maxId; stateId++) {
      if (stateId < 0 || stateId >= table.length) continue;

      try {
        const srcBlock = BlockClass.fromStateId(stateId);
        if (BlockTarget && targetBlockDef && targetBlockDef.name === srcBlock.name) {
          try {
            const rawProps = srcBlock.getProperties() || {};
            const filteredProps = {};
            if (Array.isArray(targetBlockDef.states)) {
              for (const st of targetBlockDef.states) {
                const val = rawProps[st.name];
                if (val !== undefined) {
                  if (st.type === 'enum' || Array.isArray(st.values)) {
                    if (st.values.includes(String(val))) {
                      filteredProps[st.name] = val;
                    }
                  } else if (st.type === 'bool') {
                    filteredProps[st.name] = Boolean(val);
                  } else if (st.type === 'int') {
                    if (Array.isArray(st.values) ? st.values.includes(Number(val)) : true) {
                      filteredProps[st.name] = val;
                    }
                  } else {
                    filteredProps[st.name] = val;
                  }
                }
              }
            }
            const tgtBlock = BlockTarget.fromProperties(targetBlockDef.name, filteredProps);
            if (tgtBlock && tgtBlock.name === targetBlockDef.name && typeof tgtBlock.stateId === 'number') {
              table[stateId] = tgtBlock.stateId;
              continue;
            }
            table[stateId] = targetDefault;
            continue;
          } catch {
            table[stateId] = targetDefault;
            continue;
          }
        }

        if (BlockTarget && targetBlockDef) {
          try {
            const props = srcBlock.getProperties() || {};
            const filteredProps = {};
            if (Array.isArray(targetBlockDef.states)) {
              for (const st of targetBlockDef.states) {
                const val = props[st.name];
                if (val !== undefined) {
                  if (st.type === 'enum' || Array.isArray(st.values)) {
                    if (st.values.includes(String(val))) {
                      filteredProps[st.name] = val;
                    }
                  } else if (st.type === 'bool') {
                    filteredProps[st.name] = Boolean(val);
                  } else if (st.type === 'int') {
                    if (Array.isArray(st.values) ? st.values.includes(Number(val)) : true) {
                      filteredProps[st.name] = val;
                    }
                  } else {
                    filteredProps[st.name] = val;
                  }
                }
              }
            }
            if (targetBlockDef.name.endsWith('_slab')) {
              if (!filteredProps.type) {
                filteredProps.type = (props.half === 'top' || props.type === 'top') ? 'top' : 'bottom';
              }
              if (filteredProps.waterlogged === undefined) {
                filteredProps.waterlogged = Boolean(props.waterlogged);
              }
            }
            const tgtBlock = BlockTarget.fromProperties(targetBlockDef.name, filteredProps);
            if (tgtBlock && tgtBlock.name === targetBlockDef.name && typeof tgtBlock.stateId === 'number') {
              table[stateId] = tgtBlock.stateId;
              continue;
            }
            table[stateId] = targetDefault;
            continue;
          } catch {
            table[stateId] = targetDefault;
            continue;
          }
        }

        table[stateId] = targetDefault;
      } catch {
        table[stateId] = targetDefault;
      }
    }
  }
}

export function buildTranslationTable(context) {
  const { srcMcData, baseMcData, BlockSource, BlockBase, tgtMcData, BlockTarget, targetAirStateId, targetMaxStateId } = context;

  let maxSrcState = Object.values(srcMcData.blocks).reduce((max, b) => Math.max(max, b.maxStateId || 0), 0);
  if (baseMcData) {
    const maxBase = Object.values(baseMcData.blocks).reduce((max, b) => Math.max(max, b.maxStateId || 0), 0);
    maxSrcState = Math.max(maxSrcState, maxBase);
  }

  const tableSize = Math.max(maxSrcState + 2000, 42000);
  const table = new Int32Array(tableSize);
  table.fill(-1);

  if (baseMcData && BlockBase) {
    mapVersionStates(baseMcData, BlockBase, table, tgtMcData, BlockTarget, targetAirStateId);
  }

  if (srcMcData && BlockSource) {
    mapVersionStates(srcMcData, BlockSource, table, tgtMcData, BlockTarget, targetAirStateId);
  }

  applyExplicitGuarantees(table, tgtMcData);

  for (let id = 0; id < table.length; id++) {
    if (table[id] < 0 || table[id] > targetMaxStateId) {
      table[id] = targetAirStateId;
    }
  }

  return table;
}
