import { VersionResolver } from '../../config/versionResolver.js';
import {
  loadMcData,
  loadBlockClass,
  resolveFallbackBlock,
  buildTranslationTable
} from './viewer/viewerStateTableBuilder.js';
import {
  translateChunkPalette,
  translateChunkJson,
  wrapChunkColumn,
  wrapWorld
} from './viewer/viewerChunkProxy.js';
import { createViewerBotProxy } from './viewer/viewerBotProxy.js';

/**
 * ViewerStateTranslator bridges block state IDs and chunk palettes between the bot's
 * connected Minecraft version (e.g. 26.3 / Protocol 777, 1.20.4) and the viewer's bundled
 * asset version (1.21.4, 1.20.1) on port 3081.
 */
export class ViewerStateTranslator {
  static _cache = new Map();

  /**
   * Factory method with instance caching.
   *
   * @param {string} sourceVersion Source bot version (e.g. '26.3', '1.20.4')
   * @param {string} [targetViewerVersion] Target viewer asset version (e.g. '1.21.4')
   * @returns {ViewerStateTranslator}
   */
  static create(sourceVersion = '26.3', targetViewerVersion = null) {
    VersionResolver.applyCompatibilityShims();
    const normSource = VersionResolver.normalizeVersion(sourceVersion, VersionResolver.TARGET_VERSION) || VersionResolver.TARGET_VERSION;
    const normTarget = targetViewerVersion
      ? VersionResolver.resolveViewerVersion(targetViewerVersion)
      : VersionResolver.resolveViewerVersion(normSource);

    const cacheKey = `${normSource}->${normTarget}`;
    if (this._cache.has(cacheKey)) {
      return this._cache.get(cacheKey);
    }

    const instance = new ViewerStateTranslator(normSource, normTarget);
    this._cache.set(cacheKey, instance);
    return instance;
  }

  /**
   * Clears the cached translator instances (useful in tests or hot reloads).
   */
  static clearCache() {
    this._cache.clear();
  }

  constructor(sourceVersion, targetViewerVersion) {
    this.sourceVersion = String(sourceVersion);
    this.targetViewerVersion = String(targetViewerVersion);

    VersionResolver.applyCompatibilityShims();

    this.srcMcData = loadMcData(this.sourceVersion);
    this.tgtMcData = loadMcData(this.targetViewerVersion);

    this.targetAirStateId = this.tgtMcData.blocksByName['air']?.defaultState ?? 0;
    this.targetMaxStateId = Object.values(this.tgtMcData.blocks).reduce((max, b) => Math.max(max, b.maxStateId || 0), 0);

    this.BlockSource = loadBlockClass(this.sourceVersion);
    this.BlockTarget = loadBlockClass(this.targetViewerVersion);

    this.baseMcData = (this.sourceVersion.startsWith('26.') || this.sourceVersion === '777')
      ? loadMcData(VersionResolver.COMPATIBLE_BASE_VERSION || '26.1')
      : null;
    this.BlockBase = this.baseMcData ? loadBlockClass(VersionResolver.COMPATIBLE_BASE_VERSION || '26.1') : null;

    this.table = buildTranslationTable({
      srcMcData: this.srcMcData,
      baseMcData: this.baseMcData,
      BlockSource: this.BlockSource,
      BlockBase: this.BlockBase,
      tgtMcData: this.tgtMcData,
      BlockTarget: this.BlockTarget,
      targetAirStateId: this.targetAirStateId,
      targetMaxStateId: this.targetMaxStateId
    });
  }

  resolveFallbackBlock(srcName) {
    return resolveFallbackBlock(srcName, this.tgtMcData);
  }

  /**
   * Translates a single source state ID to the corresponding target viewer state ID.
   *
   * @param {number} sourceStateId
   * @returns {number} Target state ID (always valid, 0 <= targetStateId <= targetMaxStateId)
   */
  translateStateId(sourceStateId) {
    if (typeof sourceStateId !== 'number' || !Number.isFinite(sourceStateId)) {
      return this.targetAirStateId;
    }
    const id = Math.floor(sourceStateId);
    if (id >= 0 && id < this.table.length) {
      const mapped = this.table[id];
      return mapped >= 0 ? mapped : this.targetAirStateId;
    }
    return this.targetAirStateId;
  }

  /**
   * Translates an array of state IDs in-place (such as in an IndirectPaletteContainer).
   *
   * @param {number[]} paletteArray
   * @returns {number[]} The modified palette array
   */
  translateChunkPalette(paletteArray) {
    return translateChunkPalette(paletteArray, (id) => this.translateStateId(id));
  }

  /**
   * Translates a block update from Mineflayer into a valid target state ID.
   * Accepts a state ID number, a Block instance, or a block descriptor object.
   *
   * @param {number|Object} sourceBlock
   * @returns {number} Target state ID
   */
  translateBlockUpdate(sourceBlock) {
    if (typeof sourceBlock === 'number') {
      return this.translateStateId(sourceBlock);
    }
    if (!sourceBlock || typeof sourceBlock !== 'object') {
      return this.targetAirStateId;
    }
    if (typeof sourceBlock.stateId === 'number') {
      return this.translateStateId(sourceBlock.stateId);
    }
    const rawName = sourceBlock.name;
    let cleanName = (typeof rawName === 'string') ? rawName.trim().toLowerCase() : '';
    if (cleanName.startsWith('minecraft:')) cleanName = cleanName.slice(10);
    const bIdx = cleanName.indexOf('[');
    if (bIdx !== -1) cleanName = cleanName.slice(0, bIdx).trim();

    if (cleanName && typeof sourceBlock.getProperties === 'function' && this.BlockTarget) {
      try {
        const rawProps = sourceBlock.getProperties() || {};
        const targetBlock = this.BlockTarget.fromProperties(cleanName, rawProps);
        if (targetBlock && targetBlock.name === cleanName && typeof targetBlock.stateId === 'number') {
          return targetBlock.stateId;
        }
      } catch {}

      const fallback = this.resolveFallbackBlock(cleanName);
      if (fallback) {
        try {
          const props = sourceBlock.getProperties() || {};
          const filteredProps = {};
          if (Array.isArray(fallback.states)) {
            for (const st of fallback.states) {
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
          if (fallback.name.endsWith('_slab')) {
            if (!filteredProps.type) {
              filteredProps.type = (props.half === 'top' || props.type === 'top') ? 'top' : 'bottom';
            }
            if (filteredProps.waterlogged === undefined) {
              filteredProps.waterlogged = Boolean(props.waterlogged);
            }
          }
          const tgtBlock = this.BlockTarget.fromProperties(fallback.name, filteredProps);
          if (tgtBlock && tgtBlock.name === fallback.name && typeof tgtBlock.stateId === 'number') {
            return tgtBlock.stateId;
          }
        } catch {}
        if (typeof fallback.defaultState === 'number') {
          return fallback.defaultState;
        }
      }
    }

    if (cleanName) {
      const targetDef = this.tgtMcData.blocksByName[cleanName] || this.resolveFallbackBlock(cleanName);
      if (targetDef && typeof targetDef.defaultState === 'number') {
        return targetDef.defaultState;
      }
    }
    if (typeof sourceBlock.type === 'number') {
      const rawState = (sourceBlock.type << 4) | (sourceBlock.metadata || 0);
      return this.translateStateId(rawState);
    }
    return this.targetAirStateId;
  }

  /**
   * Translates a serialized Chunk JSON string or object.
   *
   * @param {string|Object} chunkJson Chunk JSON string or parsed object
   * @returns {string|Object} Translated chunk JSON string or object
   */
  translateChunkJson(chunkJson) {
    return translateChunkJson(chunkJson, (id) => this.translateStateId(id));
  }

  /**
   * Proxies a ChunkColumn instance.
   *
   * @param {Object} column Prismarine ChunkColumn instance
   * @returns {Object} Proxied ChunkColumn
   */
  wrapChunkColumn(column) {
    return wrapChunkColumn(column, (json) => this.translateChunkJson(json));
  }

  /**
   * Wraps a Mineflayer bot.world instance with a transparent Proxy.
   *
   * @param {Object} botWorld Mineflayer world instance
   * @returns {Object} Proxied world instance
   */
  wrapWorld(botWorld) {
    return wrapWorld(botWorld, (col) => this.wrapChunkColumn(col));
  }

  /**
   * Creates a dedicated viewer bot proxy for Prismarine-Viewer mineflayer() attachment.
   *
   * @param {Object} bot Mineflayer bot instance
   * @param {Function} [sanitizeEntityFn] Optional entity sanitization callback
   * @returns {Object} Proxied bot instance for Prismarine-Viewer
   */
  createViewerBotProxy(bot, sanitizeEntityFn) {
    const wrappedWorld = this.wrapWorld(bot.world);
    return createViewerBotProxy({
      bot,
      targetViewerVersion: this.targetViewerVersion,
      wrappedWorld,
      translateBlockUpdateFn: (newBlock) => this.translateBlockUpdate(newBlock),
      sanitizeEntityFn
    });
  }
}

export const viewerStateTranslator = ViewerStateTranslator;
