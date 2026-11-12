import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { VoxelCanvas } from './voxelCanvas.js';
import { serverRights } from '../bot/serverRights.js';
import { scaffoldManager } from '../survival/scaffoldManager.js';
import { manualController } from '../bot/manualController.js';

import {
  FRAGILE_BLOCK_PATTERNS,
  isFragileBlock,
  parseBlockProperties,
  sortNeighborsForBlock,
  topologicalSort
} from './blockTopology.js';

import {
  ensureRconConnection,
  disconnectRconConnection,
  executeBlockChange as rconExecuteBlockChange,
  executeFillBox as rconExecuteFillBox
} from './strategies/rconPlacementStrategy.js';

import { placeBlockPhysically as physicalPlaceBlock } from './strategies/physicalPlacementStrategy.js';

import {
  procureBuildMaterials,
  clearBuildSiteObstacles,
  executeBuildPhase1,
  executeBuildPhase2
} from './strategies/phaseExecutionEngine.js';

export {
  FRAGILE_BLOCK_PATTERNS,
  isFragileBlock,
  parseBlockProperties,
  sortNeighborsForBlock,
  topologicalSort
};

export class WorldExecutor {
  constructor() {
    this.abortRequested = false;
    this.pauseRequested = false;
    this.isBuilding = false;
    this.rconClient = null;
    this.rconConnected = false;
    this.pausedState = null;
    this.currentBot = null;
    this.buildProgress = {
      active: false,
      currentBlock: 0,
      totalBlocks: 0,
      phase: 'Bereit',
      title: 'Kein aktiver Bauauftrag'
    };
  }

  isDisconnectError(bot, opErr) {
    if (this.pauseRequested) return true;
    if (!bot?.entity) return true;
    if (bot?._client?.ended || bot?._client?.state === 'closed' || bot?.connected === false) return true;
    if (opErr) {
      if (bot?._client?.ended || opErr.code === 'ERR_DISCONNECTED' || opErr.code === 'ECONNRESET' || opErr.code === 'ERR_STREAM_DESTROYED' || opErr.message?.includes('disconnect')) {
        return true;
      }
    }
    return false;
  }

  abort() {
    this.abortRequested = true;
    this.pauseRequested = false;
    this.isBuilding = false;
    this.pausedState = null;
    this.buildProgress.active = false;
    this.buildProgress.phase = 'Abgebrochen';
    if (this.currentBot && settings.SURVIVAL_SCAFFOLDING_ENABLED) {
      scaffoldManager.dismantleAll(this.currentBot).catch(() => {});
    }
    logger.warn('Baustopp angefordert! Breche aktuellen Vorgang ab...');
  }

  resetAbort() {
    this.abortRequested = false;
    this.pauseRequested = false;
  }

  pauseBuild() {
    if (!this.isBuilding) {
      logger.info('pauseBuild aufgerufen, aber aktuell läuft kein Bauauftrag.');
      return false;
    }
    logger.warn('pauseBuild angefordert! Pausiere Baufortschritt für Session-Handoff...');
    this.pauseRequested = true;
    return true;
  }

  async resumeBuild(newBot = null) {
    if (!this.pausedState) {
      logger.info('resumeBuild: Kein pausierter Bauauftrag vorhanden.');
      return false;
    }
    const state = this.pausedState;
    this.pausedState = null;
    this.pauseRequested = false;
    this.abortRequested = false;
    const targetBot = newBot || this.currentBot || state.bot;
    logger.info(`Setze Bauauftrag '${state.title}' fort (ab Operation ${state.completedOps}/${state.totalOps})...`);
    return await this.executeBatch(targetBot, state.blocks, {
      ...state.options,
      resumeState: state
    });
  }

  getProgress() {
    return {
      active: this.isBuilding,
      currentBlock: this.buildProgress.currentBlock,
      totalBlocks: this.buildProgress.totalBlocks,
      phase: this.buildProgress.phase,
      title: this.buildProgress.title,
      isPaused: !!this.pausedState
    };
  }

  async ensureRcon() {
    return ensureRconConnection(this);
  }

  async disconnectRcon() {
    return disconnectRconConnection(this);
  }

  /**
   * Sortiert Blöcke in 2 Phasen (Träger & Fragil) und Boustrophedon-Pfad (Schlangenlinien)
   */
  topologicalSort(blockList) {
    return topologicalSort(blockList);
  }

  async executeBlockChange(bot, x, y, z, blockStateString, mode) {
    return rconExecuteBlockChange(this, bot, x, y, z, blockStateString, mode);
  }

  async executeFillBox(bot, box, mode) {
    return rconExecuteFillBox(this, bot, box, mode);
  }

  async placeBlockPhysically(bot, x, y, z, blockStateString, mode = 'pure_physical') {
    return physicalPlaceBlock(this, bot, x, y, z, blockStateString, mode);
  }

  resolveMode(rawMode, bot = this.currentBot) {
    const candidateMode = rawMode || settings.BUILD_EXECUTION_MODE;
    if (bot && typeof bot.isOp === 'boolean' && serverRights.detectionSource === 'default') {
      serverRights.setOp(bot.isOp, 'bot_property');
    }
    return serverRights.getEffectiveMode(candidateMode, this.rconConnected || Boolean(settings.RCON_PASSWORD));
  }

  async _procureMaterials(bot, blocks, mode, options = {}) {
    return procureBuildMaterials(this, bot, blocks, mode, options);
  }

  async _clearSiteObstacles(bot, blocks, mode, options = {}) {
    return clearBuildSiteObstacles(this, bot, blocks, mode, options);
  }

  async _executePhase1(context) {
    return executeBuildPhase1(this, context);
  }

  async _executePhase2(context) {
    return executeBuildPhase2(this, context);
  }

  async executeBatch(bot, blocks, options = {}) {
    if (manualController.isActive()) {
      logger.warn('[WorldExecutor] Bauausführung verweigert: Manuelle Gamemode-Steuerung ist aktiv.');
      return { success: false, status: 'manual_control_locked' };
    }
    this.resetAbort();
    this.currentBot = bot;
    this.isBuilding = true;
    const rawMode = options.mode || settings.BUILD_EXECUTION_MODE;
    const mode = this.resolveMode(rawMode, bot);
    const greedyEnabled = settings.ENABLE_GREEDY_FILL_OPTIMIZATION && !options.isUndo;
    const opsPerSec = settings.BUILD_OPERATIONS_PER_SECOND || 12;
    const delayBetweenOpsMs = Math.max(10, Math.floor(1000 / opsPerSec));

    const resumeState = options.resumeState || null;
    const title = options.title || resumeState?.title || 'Bauauftrag';

    logger.info(`Starte Bauausführung (${blocks.length} Blöcke, Modus: ${mode}, Ops/s: ${opsPerSec})...`);

    // Feedback-Spam im Chat unterdrücken
    if (mode === 'hybrid_visual' || mode === 'rcon_visual') {
      try {
        if (mode === 'rcon_visual') {
          const rcon = await this.ensureRcon();
          if (rcon) await rcon.send('gamerule sendCommandFeedback false');
        } else if (bot && typeof bot.chat === 'function') {
          bot.chat('/gamerule sendCommandFeedback false');
        }
      } catch {
        // Ignorieren
      }
    }

    // Materialprüfung & Beschaffung
    const materialsOk = await this._procureMaterials(bot, blocks, mode, options);
    if (!materialsOk) {
      this.isBuilding = false;
      return false;
    }

    // Phase 0: Bauplatz-Vorbereitung (Rodung von Hindernissen)
    await this._clearSiteObstacles(bot, blocks, mode, options);

    // Bauplan-Koordinaten für kollisionsfreien Gerüstbau sichern
    const reservedCoords = new Set();
    for (const b of blocks) {
      reservedCoords.add(`${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`);
    }
    this.currentBuildReservedBlocks = reservedCoords;

    // Topologische Aufteilung in 2 Phasen
    const { phase1, phase2 } = this.topologicalSort(blocks);

    let phase1Ops = [];
    if (greedyEnabled && (mode === 'hybrid_visual' || mode === 'rcon_visual')) {
      phase1Ops = VoxelCanvas.computeGreedyBoxes(phase1.map(b => ({
        x: b.x,
        y: b.y,
        z: b.z,
        blockState: b.blockState || { name: b.name, properties: b.properties },
        fullBlockString: b.fullBlockString || VoxelCanvas.toBlockString(b.blockState || { name: b.name, properties: b.properties })
      }))).map(box => ({ isBox: true, ...box }));
    } else {
      phase1Ops = phase1.map(b => ({
        isBox: false,
        x: b.x,
        y: b.y,
        z: b.z,
        fullBlockString: b.fullBlockString || VoxelCanvas.toBlockString(b.blockState || { name: b.name, properties: b.properties })
      }));
    }

    const phase2Ops = phase2.map(b => ({
      x: b.x,
      y: b.y,
      z: b.z,
      fullBlockString: b.fullBlockString || VoxelCanvas.toBlockString(b.blockState || { name: b.name, properties: b.properties })
    }));

    const totalOps = phase1Ops.length + phase2Ops.length;
    let completedOps = resumeState ? (resumeState.completedOps || 0) : 0;
    const startPhase = resumeState ? (resumeState.phase || 1) : 1;
    const startIdx1 = resumeState ? (resumeState.phase1Index || 0) : 0;
    const startIdx2 = resumeState ? (resumeState.phase2Index || 0) : 0;

    this.buildProgress = {
      active: true,
      currentBlock: completedOps,
      totalBlocks: totalOps,
      phase: startPhase === 1 ? 'Phase 1: Tragwerk' : 'Phase 2: Details',
      title
    };

    const context = {
      bot,
      blocks,
      options,
      mode,
      phase1Ops,
      phase2Ops,
      startPhase,
      startIdx1,
      startIdx2,
      totalOps,
      title,
      delayBetweenOpsMs,
      completedOps
    };

    // Phase 1: Tragwerk
    if (startPhase === 1) {
      const p1Res = await this._executePhase1(context);
      if (!p1Res.success) {
        return false;
      }
    }

    // Phase 2: Details
    const p2Res = await this._executePhase2(context);
    if (!p2Res.success) {
      return false;
    }

    this.isBuilding = false;
    this.buildProgress.active = false;
    this.buildProgress.phase = 'Abgeschlossen';
    this.pausedState = null;

    // Feedback-Einstellung auf dem Server wiederherstellen
    if (mode === 'hybrid_visual' || mode === 'rcon_visual') {
      try {
        if (mode === 'rcon_visual' && this.rconClient) {
          await this.rconClient.send('gamerule sendCommandFeedback true');
        } else if (bot && typeof bot.chat === 'function') {
          bot.chat('/gamerule sendCommandFeedback true');
        }
      } catch {}
    }

    // Im pure_physical Modus: Gerüstblöcke sauber abbauen
    if (mode === 'pure_physical' && settings.SURVIVAL_SCAFFOLDING_ENABLED && bot) {
      try {
        await scaffoldManager.dismantleAll(bot);
      } catch (dismantleErr) {
        logger.warn(`[WorldExecutor] Fehler beim Gerüstrückbau: ${dismantleErr.message}`);
      }
    }
    this.currentBuildReservedBlocks = null;

    logger.build(`Bauausführung erfolgreich abgeschlossen! Insgesamt ${context.completedOps} Befehle ausgeführt.`);
    return true;
  }
}

export const worldExecutor = new WorldExecutor();
