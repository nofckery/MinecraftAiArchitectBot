import mcData from 'minecraft-data';
import minecraftProtocol from 'minecraft-protocol';
import { createRequire } from 'module';
import { logger } from '../utils/logger.js';

const require = createRequire(import.meta.url);
const dataPc = require('minecraft-data/data.js');

/**
 * VersionResolver handles protocol version normalization and pre-connection server pinging.
 * Polyfills and version checks are resolved cleanly without mutating global packages or disk files.
 */
export class VersionResolver {
  static TARGET_VERSION = '26.3';
  static COMPATIBLE_BASE_VERSION = '26.1';
  static PROTOCOL_VERSION = 777;
  static DATA_VERSION = 4786;
  static DEFAULT_FALLBACK = '1.20.4';
  static _shimsApplied = false;

  static SUPPORTED_VIEWER_VERSIONS = [
    '1.21.4', '1.21.1', '1.20.1', '1.19', '1.18.1', '1.17.1',
    '1.16.4', '1.15.2', '1.14.4', '1.13.2', '1.12.2'
  ];

  static SUPPORTED_GAME_VERSIONS = [
    { version: 'auto', label: 'auto (Empfohlen)', description: 'Automatische Server-Versionserkennung' },
    { version: '26.3', label: '26.3 (SOTA)', description: 'Modernes Release / Protocol 777' },
    { version: '1.21.4', label: '1.21.4', description: 'Minecraft 1.21.4 (Bundles & Pale Garden)' },
    { version: '1.21.1', label: '1.21.1', description: 'Minecraft 1.21.1 (Tricky Trials)' },
    { version: '1.20.4', label: '1.20.4', description: 'Minecraft 1.20.4 (Trails & Tales)' },
    { version: '1.20.1', label: '1.20.1', description: 'Minecraft 1.20.1 (LTS Modding & Vanilla)' }
  ];

  /**
   * Applies runtime compatibility checks without mutating external packages or disk files.
   * Shims minecraft-data, mineflayer (testedVersions & latestSupportedVersion),
   * and minecraft-protocol (supportedVersions) cleanly in Node.js memory.
   * @returns {boolean} True indicating compatibility layer is active.
   */
  static applyCompatibilityShims() {
    try {
      // 1. In-Memory Shim für minecraft-data
      if (dataPc?.pc?.[this.COMPATIBLE_BASE_VERSION] && !dataPc.pc[this.TARGET_VERSION]) {
        const base = dataPc.pc[this.COMPATIBLE_BASE_VERSION];
        const target = Object.assign({}, base);
        target.version = {
          version: this.PROTOCOL_VERSION,
          minecraftVersion: this.TARGET_VERSION,
          majorVersion: this.COMPATIBLE_BASE_VERSION,
          releaseType: 'release',
          dataVersion: this.DATA_VERSION
        };

        try { target.protocol = require('./data/26.3/protocol.json'); } catch { target.protocol = base.protocol; }
        try { target.blockCollisionShapes = require('./data/26.3/blockCollisionShapes.json'); } catch {}
        try { target.blocks = require('./data/26.3/blocks.json'); } catch {}
        try { target.entities = require('./data/26.3/entities.json'); } catch {}
        try { target.foods = require('./data/26.3/foods.json'); } catch {}
        try { target.items = require('./data/26.3/items.json'); } catch {}
        try { target.recipes = require('./data/26.3/recipes.json'); } catch {}

        dataPc.pc[this.TARGET_VERSION] = target;
      }

      // 2. In-Memory Shim für Mineflayer Version-Modul
      try {
        const mfVersion = require('mineflayer/lib/version');
        if (mfVersion && Array.isArray(mfVersion.testedVersions)) {
          if (!mfVersion.testedVersions.includes(this.TARGET_VERSION)) {
            mfVersion.testedVersions.push(this.TARGET_VERSION);
          }
          mfVersion.latestSupportedVersion = this.TARGET_VERSION;
        }
      } catch (mfVerErr) {
        logger.debug(`[VersionResolver] Mineflayer version shim Hinweis: ${mfVerErr.message}`);
      }

      // 3. In-Memory Shim für Minecraft-Protocol Versions-Whitelist
      try {
        const protoVersion = require('minecraft-protocol/src/version');
        if (protoVersion && Array.isArray(protoVersion.supportedVersions)) {
          if (!protoVersion.supportedVersions.includes(this.TARGET_VERSION)) {
            protoVersion.supportedVersions.push(this.TARGET_VERSION);
          }
        }
        if (minecraftProtocol && Array.isArray(minecraftProtocol.supportedVersions)) {
          if (!minecraftProtocol.supportedVersions.includes(this.TARGET_VERSION)) {
            minecraftProtocol.supportedVersions.push(this.TARGET_VERSION);
          }
        }
      } catch (protoVerErr) {
        logger.debug(`[VersionResolver] Minecraft-Protocol version shim Hinweis: ${protoVerErr.message}`);
      }

      // 4. Mineflayer Loader & createBot Refresh
      // Falls mineflayer bereits vor diesem Aufruf importiert/geladen wurde, hat loader.js
      // latestSupportedVersion als lokale lexikalische Konstante gebunden.
      // Durch Bereinigen des require.cache für loader.js und Neuladen wird createBot
      // mit der neuen Version 26.3 (Protocol 777) re-evaluiert.
      try {
        const loaderPath = require.resolve('mineflayer/lib/loader');
        if (require.cache[loaderPath]) {
          delete require.cache[loaderPath];
          const freshLoader = require('mineflayer/lib/loader');
          const mfInstance = require('mineflayer');
          if (mfInstance && freshLoader?.createBot) {
            mfInstance.createBot = freshLoader.createBot;
            mfInstance.latestSupportedVersion = this.TARGET_VERSION;
            if (Array.isArray(mfInstance.testedVersions) && !mfInstance.testedVersions.includes(this.TARGET_VERSION)) {
              mfInstance.testedVersions.push(this.TARGET_VERSION);
            }
          }
        }
      } catch (loaderErr) {
        logger.debug(`[VersionResolver] Mineflayer loader refresh Hinweis: ${loaderErr.message}`);
      }

      if (!this._shimsApplied) {
        logger.info(`[VersionResolver] Kompatibilitätsmodus für ${this.TARGET_VERSION} aktiv (Protocol ${this.PROTOCOL_VERSION}, Basis ${this.COMPATIBLE_BASE_VERSION}).`);
      }
      this._shimsApplied = true;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Rüstet eine Mineflayer Bot-Instanz für die 26.3 (Protocol 777) Teleport-Koordination aus.
   * Stellt sicher, dass teleport_confirm vollständige Koordinaten erhält und Paper Anti-Cheat
   * die Verbindung nicht wegen ungültiger Bewegung trennt.
   * @param {Object} bot Mineflayer bot instance
   */
  static patchBotClient(bot) {
    if (!bot || !bot._client) return;

    let lastServerPosition = null;

    bot._client.on('packet', (data, meta) => {
      if (meta && meta.name === 'position') {
        lastServerPosition = data;
      }
    });

    const origWrite = bot._client.write.bind(bot._client);
    bot._client.write = function(name, params = {}) {
      if (name === 'teleport_confirm') {
        if (lastServerPosition) {
          params.x = lastServerPosition.x;
          params.y = lastServerPosition.y;
          params.z = lastServerPosition.z;
          params.yRot = lastServerPosition.yaw;
          params.xRot = lastServerPosition.pitch;
        } else {
          params.x = bot.entity?.position?.x ?? 0;
          params.y = bot.entity?.position?.y ?? 0;
          params.z = bot.entity?.position?.z ?? 0;
          params.yRot = bot.entity?.yaw ?? 0;
          params.xRot = bot.entity?.pitch ?? 0;
        }
      }
      return origWrite(name, params);
    };
  }

  /**
   * Normalizes MC_VERSION setting into a valid createBot option.
   * 'auto', 'false', false, 'none' map to boolean false (Mineflayer auto-detection).
   * '26.3' activates runtime polyfills and returns '26.3'.
   * Empty/undefined uses defaultVersion.
   *
   * @param {string|boolean|null|undefined} rawVersion
   * @param {string|boolean} defaultVersion Default to use if empty/undefined
   * @returns {string|boolean} Normalized version (false for auto-detect ping, or version string)
   */
  static normalizeVersion(rawVersion, defaultVersion = '1.20.4') {
    if (rawVersion === false) {
      return false;
    }
    if (rawVersion === undefined || rawVersion === null) {
      return this._normalizeDefault(defaultVersion);
    }

    const trimmed = String(rawVersion).trim();
    if (trimmed === '') {
      return this._normalizeDefault(defaultVersion);
    }

    const lower = trimmed.toLowerCase();
    if (lower === 'false' || lower === 'auto' || lower === 'none') {
      return false;
    }

    if (trimmed === this.TARGET_VERSION) {
      this.applyCompatibilityShims();
      return this.TARGET_VERSION;
    }
    return trimmed;
  }

  static _normalizeDefault(defaultVersion) {
    if (defaultVersion === false) return false;
    if (defaultVersion === undefined || defaultVersion === null) return false;
    const defTrimmed = String(defaultVersion).trim();
    const defLower = defTrimmed.toLowerCase();
    if (defLower === 'false' || defLower === 'auto' || defLower === 'none' || defTrimmed === '') {
      return false;
    }
    return defTrimmed;
  }

  /**
   * Resolves safe connection options with pre-connect ping discovery and fallback.
   *
   * @param {string} host Minecraft server host
   * @param {number} port Minecraft server port
   * @param {string|boolean} configuredVersion User-configured version
   * @returns {Promise<{ version: string|boolean, autoDetect: boolean, fallbackUsed?: boolean, pingResult?: Object }>}
   */
  static async resolveConnectionOptions(host = '127.0.0.1', port = 25565, configuredVersion = '1.20.4') {
    this.applyCompatibilityShims();
    const normalized = this.normalizeVersion(configuredVersion, this.DEFAULT_FALLBACK);

    if (normalized !== false) {
      return { version: normalized, autoDetect: false };
    }

    // Auto-detect mode: attempt ping to discover server version
    try {
      const pingResult = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Ping timeout (3000ms)')), 3000);
        minecraftProtocol.ping({ host, port }, (err, res) => {
          clearTimeout(timer);
          if (err) return reject(err);
          resolve(res);
        });
      });

      const serverVersionName = pingResult?.version?.name || '';
      const serverProtocol = pingResult?.version?.protocol;
      logger.info(`[VersionResolver] Server-Ping erfolgreich: Version '${serverVersionName}' (Protocol ${serverProtocol})`);

      if (serverVersionName.includes('26.3') || serverProtocol === 777) {
        return { version: this.TARGET_VERSION, autoDetect: true, pingResult };
      }

      return { version: false, autoDetect: true, pingResult };
    } catch (pingErr) {
      logger.warn(`[VersionResolver] Server-Ping fehlgeschlagen (${pingErr.message}). Nutze sicheren Fallback '${this.DEFAULT_FALLBACK}'.`);
      return { version: this.DEFAULT_FALLBACK, autoDetect: false, fallbackUsed: true };
    }
  }

  /**
   * Resolves the closest supported Prismarine-Viewer asset version.
   * Maps unbundled minor versions (e.g. 1.20.4 -> 1.20.1, 26.3 -> 1.21.4)
   * so the viewer WebGL workers can safely load blocksStates and texture atlases.
   *
   * @param {string|boolean|null|undefined} sourceVersion
   * @returns {string} Closest viewer-compatible asset version string (e.g. '1.21.4', '1.20.1')
   */
  static resolveViewerVersion(sourceVersion) {
    if (!sourceVersion || sourceVersion === 'auto' || sourceVersion === 'false') {
      return '1.21.4';
    }

    const str = String(sourceVersion).trim();
    if (this.SUPPORTED_VIEWER_VERSIONS.includes(str)) {
      return str;
    }

    // 26.x / Protocol 777 SOTA
    if (str.startsWith('26.') || str === '777') {
      return '1.21.4';
    }

    // 1.21.x releases
    if (str.startsWith('1.21')) {
      if (str === '1.21.1') return '1.21.1';
      return '1.21.4';
    }

    // 1.20.x releases (1.20.4 -> 1.20.1)
    if (str.startsWith('1.20')) {
      return '1.20.1';
    }

    // 1.19.x releases
    if (str.startsWith('1.19')) {
      return '1.19';
    }

    // 1.18.x releases
    if (str.startsWith('1.18')) {
      return '1.18.1';
    }

    // 1.17.x releases
    if (str.startsWith('1.17')) {
      return '1.17.1';
    }

    // 1.16.x releases
    if (str.startsWith('1.16')) {
      return '1.16.4';
    }

    // 1.15.x releases
    if (str.startsWith('1.15')) {
      return '1.15.2';
    }

    // 1.14.x releases
    if (str.startsWith('1.14')) {
      return '1.14.4';
    }

    // 1.13.x releases
    if (str.startsWith('1.13')) {
      return '1.13.2';
    }

    // 1.12.x releases
    if (str.startsWith('1.12')) {
      return '1.12.2';
    }

    // Default safest modern release
    return '1.21.4';
  }

  /**
   * Checks whether a version string is recognized as a valid Minecraft version or 'auto'.
   *
   * @param {string|boolean} version
   * @returns {boolean} True if valid
   */
  static isValidVersion(version) {
    if (version === false) return true;
    if (typeof version !== 'string') return false;
    const trimmed = version.trim();
    if (trimmed === '') return true;
    const lower = trimmed.toLowerCase();
    if (lower === 'auto' || lower === 'false' || lower === 'none') return true;
    if (trimmed === this.TARGET_VERSION) return true;
    if (this.SUPPORTED_VIEWER_VERSIONS.includes(trimmed)) return true;
    if (this.SUPPORTED_GAME_VERSIONS.some(v => (typeof v === 'string' ? v === trimmed : v.version === trimmed))) return true;

    if (!/^\d+(\.\d+)+$/.test(trimmed)) {
      return false;
    }

    try {
      const data = mcData(trimmed);
      return data !== null && data !== undefined;
    } catch {
      return false;
    }
  }

  /**
   * Returns viewer version metadata for use in dashboard API responses and frontend selectors.
   *
   * @returns {Object}
   */
  static getViewerVersionMetadata() {
    return {
      supportedViewerVersions: [...this.SUPPORTED_VIEWER_VERSIONS],
      supportedGameVersions: [...this.SUPPORTED_GAME_VERSIONS],
      defaultViewerVersion: '1.21.4',
      targetVersion: this.TARGET_VERSION,
      defaultFallback: this.DEFAULT_FALLBACK
    };
  }
}

// Kompatibilitäts-Shims für 26.3 / Protocol 777 sofort beim Laden des Moduls initialisieren
VersionResolver.applyCompatibilityShims();

export const versionResolver = VersionResolver;
