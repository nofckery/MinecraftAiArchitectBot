import { Vec3 } from 'vec3';
import { Rcon } from 'rcon-client';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { VoxelCanvas } from './voxelCanvas.js';
import { inventoryManager } from '../bot/inventoryManager.js';
import { materialProcurement } from '../survival/materialProcurement.js';
import { serverRights } from '../bot/serverRights.js';
import { getPathfinderGoals } from '../utils/pathfinderHelper.js';
import { normalizeBlockName } from './blockAliases.js';
import { scaffoldManager } from '../survival/scaffoldManager.js';
import { harvestManager } from '../survival/harvestManager.js';
import { manualController } from '../bot/manualController.js';

import {
  FRAGILE_BLOCK_PATTERNS,
  isFragileBlock,
  parseBlockProperties,
  sortNeighborsForBlock,
  topologicalSort
} from './blockTopology.js';

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
    if (this.rconConnected && this.rconClient) return this.rconClient;

    try {
      this.rconClient = await Rcon.connect({
        host: settings.RCON_HOST,
        port: settings.RCON_PORT,
        password: settings.RCON_PASSWORD
      });
      this.rconConnected = true;
      logger.info(`RCON-Verbindung erfolgreich aufgebaut zu ${settings.RCON_HOST}:${settings.RCON_PORT}`);
      return this.rconClient;
    } catch (err) {
      this.rconConnected = false;
      this.rconClient = null;
      logger.error(`RCON-Verbindungsfehler: ${err.message}. Fallback auf hybrid_visual.`);
      return null;
    }
  }

  async disconnectRcon() {
    if (this.rconClient) {
      try {
        await this.rconClient.end();
      } catch {
        // Ignorieren
      }
      this.rconClient = null;
      this.rconConnected = false;
    }
  }

  /**
   * Sortiert Blöcke in 2 Phasen (Träger & Fragil) und Boustrophedon-Pfad (Schlangenlinien)
   */
  topologicalSort(blockList) {
    return topologicalSort(blockList);
  }

  async executeBlockChange(bot, x, y, z, blockStateString, mode) {
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
      const rcon = await this.ensureRcon();
      if (rcon) {
        await rcon.send(`setblock ${x} ${y} ${z} ${blockStateString} replace`);
        return;
      }
      // Falls RCON fehlgeschlagen ist, Fallback auf Chat-Befehl
      bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
    } else if (mode === 'hybrid_visual') {
      bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
    } else if (mode === 'pure_physical') {
      await this.placeBlockPhysically(bot, x, y, z, blockStateString, mode);
    }
  }

  async executeFillBox(bot, box, mode) {
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
      const rcon = await this.ensureRcon();
      if (rcon) {
        await rcon.send(cmd);
        return;
      }
      bot.chat(`/${cmd}`);
    } else {
      bot.chat(`/${cmd}`);
    }
  }

  async placeBlockPhysically(bot, x, y, z, blockStateString, mode = 'pure_physical') {
    const targetPos = new Vec3(x, y, z);
    const blockName = normalizeBlockName(blockStateString);
    const props = parseBlockProperties(blockStateString);

    // 3.0 Im pure_physical Modus: Staging & Erreichbarkeit sicherstellen (Navigation oder Gerüstbau)
    if (mode === 'pure_physical' && bot) {
      try {
        await scaffoldManager.prepareStaging(bot, targetPos, {
          reservedBlocks: this.currentBuildReservedBlocks
        });
      } catch (err) {
        logger.debug(`[WorldExecutor] Staging-Fehler bei (${x}, ${y}, ${z}): ${err.message}`);
      }
    }

    // 3.1 & 4.5 Eigenkollisions-Schutz: Reales Ausweichen mit GoalNear statt bloßem Head-Turn
    if (bot && bot.entity && bot.entity.position.distanceTo(targetPos) < 1.3) {
      if (bot.pathfinder) {
        try {
          const goals = await getPathfinderGoals();
          if (goals) {
            const stepAway = targetPos.offset(1.5, 0, 1.5);
            bot.pathfinder.setGoal(new goals.GoalNear(stepAway.x, stepAway.y, stepAway.z, 0.6));
            // Warte kurz bis der Bot die Hitbox geräumt hat (max 600 ms)
            await new Promise(r => setTimeout(r, 600));
          }
        } catch (err) {
          logger.debug(`Pathfinder-Kollisionsausweichen fehlgeschlagen: ${err.message}`);
        }
      }
    }

    // Item im Creative-Inventar oder Survival-Inventar bereitstellen
    await inventoryManager.equipBlock(bot, blockName);

    // SOTA Blickwinkel-Ausrichtung vor Platzierung:
    // Treppen, Öfen, Truhen, Türen usw. richten sich in Minecraft nach dem Yaw des Spielers beim Platzieren
    if (props.facing) {
      const YAW_MAP = {
        south: 0,
        west: Math.PI / 2,
        north: Math.PI,
        east: -Math.PI / 2
      };
      const desiredYaw = YAW_MAP[props.facing];
      if (desiredYaw !== undefined && typeof bot.look === 'function') {
        try {
          await bot.look(desiredYaw, bot.entity?.pitch || 0, true);
        } catch (lookErr) {
          logger.debug(`[WorldExecutor] Look-Ausrichtung für facing=${props.facing} fehlgeschlagen: ${lookErr.message}`);
        }
      }
    }

    // Suche soliden Referenzblock unter den Nachbarn (sortiert nach Block-Eigenschaften)
    const baseNeighbors = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(0, 1, 0),  face: new Vec3(0, -1, 0) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      { offset: new Vec3(0, 0, 1),  face: new Vec3(0, 0, -1) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { offset: new Vec3(1, 0, 0),  face: new Vec3(-1, 0, 0) }
    ];
    const neighbors = sortNeighborsForBlock(baseNeighbors, blockName, props);

    const placeOptions = { swingArm: 'right' };
    if (props.half === 'top' || props.type === 'top') {
      placeOptions.half = 'top';
      placeOptions.forceLook = 'ignore';
    } else if (props.half === 'bottom' || props.type === 'bottom') {
      placeOptions.half = 'bottom';
      placeOptions.forceLook = 'ignore';
    }

    let placed = false;
    for (const n of neighbors) {
      const refPos = targetPos.plus(n.offset);
      const refBlock = bot.blockAt ? bot.blockAt(refPos) : null;
      if (refBlock && !refBlock.name.includes('air')) {
        try {
          if (typeof bot._placeBlockWithOptions === 'function') {
            await bot._placeBlockWithOptions(refBlock, n.face, placeOptions);
          } else {
            await bot.placeBlock(refBlock, n.face);
          }
          placed = true;
          break;
        } catch (placeErr) {
          // 4.6 Logging bei fehlgeschlagenem Nachbar-Placement
          logger.debug(`Platzierung an Nachbar (${n.face.x},${n.face.y},${n.face.z}) fehlgeschlagen: ${placeErr.message}`);
        }
      }
    }

    if (!placed) {
      // 3.2 Vertragsbruch-Schutz: Im Survival-Modus (pure_physical) keinen /setblock Cheat ausführen!
      if (mode === 'pure_physical') {
        logger.warn(`[Survival/pure_physical] Block bei (${x}, ${y}, ${z}) [${blockStateString}] konnte nicht physisch platziert werden (kein Nachbarblock). Überspringe.`);
      } else {
        // Fallback: Creative Setblock
        bot.chat(`/setblock ${x} ${y} ${z} ${blockStateString} replace`);
      }
    }
  }

  resolveMode(rawMode, bot = this.currentBot) {
    const candidateMode = rawMode || settings.BUILD_EXECUTION_MODE;
    if (bot && typeof bot.isOp === 'boolean' && serverRights.detectionSource === 'default') {
      serverRights.setOp(bot.isOp, 'bot_property');
    }
    return serverRights.getEffectiveMode(candidateMode, this.rconConnected || Boolean(settings.RCON_PASSWORD));
  }

  async _procureMaterials(bot, blocks, mode, options = {}) {
    if ((mode !== 'pure_physical' && !options.procureMaterials) || options.isUndo) {
      return true;
    }
    const requiredBOM = {};
    for (const b of blocks) {
      const name = normalizeBlockName(b.name || b.blockState?.name || 'stone');
      if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') {
        requiredBOM[name] = (requiredBOM[name] || 0) + 1;
      }
    }
    const materialCheck = inventoryManager.checkMaterials(bot, requiredBOM);
    if (!materialCheck.hasAll) {
      const isStrict = options.strictMaterials !== undefined ? options.strictMaterials : settings.SURVIVAL_STRICT_MATERIALS;
      if (settings.SURVIVAL_AUTO_PROCUREMENT || options.procureMaterials) {
        logger.info('[WorldExecutor] Fehlende Materialien erkannt. Starte automatische Kisten-Beschaffung...');
        const procurement = await materialProcurement.procureMaterials(bot, requiredBOM, {
          radius: options.searchRadius || settings.SURVIVAL_STORAGE_SCAN_RADIUS || 32,
          chatAlerts: true
        });
        if (!procurement.success && isStrict) {
          logger.error('Bau abgebrochen: Unvollständige Materialien nach Kistensuche im strictMaterials-Modus.');
          return false;
        }
      } else {
        const missingList = Object.entries(materialCheck.missing).map(([m, c]) => `${c}x ${m}`).join(', ');
        logger.warn(`[Survival] Fehlende Baumaterialien im Inventar: ${missingList}`);
        if (bot && typeof bot.chat === 'function') {
          bot.chat(`[Material-Prüfung] Achtung, mir fehlen Materialien: ${missingList.slice(0, 80)}`);
        }
        if (isStrict) {
          logger.error('Bau abgebrochen: Unvollständige Materialien im strictMaterials-Modus.');
          return false;
        }
      }
    }
    return true;
  }

  async _clearSiteObstacles(bot, blocks, mode, options = {}) {
    const shouldClear = options.clearSite !== undefined
      ? Boolean(options.clearSite)
      : (Boolean(settings.SURVIVAL_AUTO_CLEAR_SITE) || mode === 'pure_physical');

    if (!shouldClear || !bot || options.isUndo || options.resumeState) {
      return true;
    }

    this.buildProgress.phase = 'Phase 0: Bauplatz-Rodung';
    logger.info('[WorldExecutor] Starte Phase 0: Bauplatz-Vorbereitung (Hindernis-Rodung)...');

    try {
      if (typeof harvestManager?.clearObstacles === 'function') {
        const result = await harvestManager.clearObstacles(bot, blocks, {
          chatAlerts: true,
          maxBlocks: options.maxClearBlocks || 300
        });
        logger.info(`[WorldExecutor] Phase 0 abgeschlossen: ${result.clearedCount} Hindernisse beseitigt.`);
      }
    } catch (clearErr) {
      logger.warn(`[WorldExecutor] Warnung bei Bauplatz-Rodung: ${clearErr.message}`);
    }
    return true;
  }

  async _executePhase1(context) {
    const { bot, blocks, options, mode, phase1Ops, startIdx1, totalOps, title, delayBetweenOpsMs } = context;
    this.buildProgress.phase = 'Phase 1: Tragwerk';
    logger.info(`Phase 1: Setze Tragwerk & solide Strukturen (${phase1Ops.length - startIdx1} verbleibend)...`);

    for (let i = startIdx1; i < phase1Ops.length; i++) {
      if (this.abortRequested) {
        logger.warn('Bauausführung in Phase 1 abgebrochen.');
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Abgebrochen';
        this.pausedState = null;
        return { success: false, status: 'aborted' };
      }

      if (this.pauseRequested) {
        logger.warn(`Bauausführung in Phase 1 bei Operation ${context.completedOps}/${totalOps} pausiert.`);
        this.pausedState = {
          bot,
          blocks,
          options: { ...options, resumeState: null },
          phase: 1,
          phase1Index: i,
          phase2Index: 0,
          completedOps: context.completedOps,
          totalOps,
          title
        };
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Pausiert';
        return { success: false, status: 'paused' };
      }

      const op = phase1Ops[i];
      try {
        if (op.isBox) {
          if (op.volume > 1) {
            await this.executeFillBox(bot, op, mode);
          } else {
            await this.executeBlockChange(bot, op.minX, op.minY, op.minZ, op.fullBlockString, mode);
          }
        } else {
          await this.executeBlockChange(bot, op.x, op.y, op.z, op.fullBlockString, mode);
        }
        context.completedOps++;
        this.buildProgress.currentBlock = context.completedOps;
        if (mode === 'pure_physical' && i % 20 === 0 && bot) {
          inventoryManager.autoEatCheck(bot).catch(() => {});
        }
      } catch (opErr) {
        logger.warn(`Ausnahme bei Blockoperation ${context.completedOps + 1} (${opErr.message}).`);
        // Wenn währenddessen getrennt oder pausiert wurde, sichere aktuellen Bauzustand
        if (this.isDisconnectError(bot, opErr) || bot?._client?.ended || opErr?.code === 'ERR_DISCONNECTED' || opErr?.code === 'ECONNRESET' || opErr?.code === 'ERR_STREAM_DESTROYED' || opErr?.message?.includes('disconnect')) {
          this.pausedState = {
            bot,
            blocks,
            options: { ...options, resumeState: null },
            phase: 1,
            phase1Index: i,
            phase2Index: 0,
            completedOps: context.completedOps,
            totalOps,
            title
          };
          this.isBuilding = false;
          this.buildProgress.active = false;
          this.buildProgress.phase = 'Pausiert';
          return { success: false, status: 'paused' };
        }
        throw opErr;
      }
      await new Promise(r => setTimeout(r, delayBetweenOpsMs));
    }

    return { success: true, status: 'completed' };
  }

  async _executePhase2(context) {
    const { bot, blocks, options, mode, phase1Ops, phase2Ops, startIdx2, startPhase, totalOps, title, delayBetweenOpsMs } = context;
    this.buildProgress.phase = 'Phase 2: Details';
    const effectiveStartIdx = (startPhase === 2 ? startIdx2 : 0);
    logger.info(`Phase 2: Setze fragile Blöcke & Details (${phase2Ops.length - effectiveStartIdx} verbleibend)...`);

    for (let j = effectiveStartIdx; j < phase2Ops.length; j++) {
      if (this.abortRequested) {
        logger.warn('Bauausführung in Phase 2 abgebrochen.');
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Abgebrochen';
        this.pausedState = null;
        return { success: false, status: 'aborted' };
      }

      if (this.pauseRequested) {
        logger.warn(`Bauausführung in Phase 2 bei Operation ${context.completedOps}/${totalOps} pausiert.`);
        this.pausedState = {
          bot,
          blocks,
          options: { ...options, resumeState: null },
          phase: 2,
          phase1Index: phase1Ops.length,
          phase2Index: j,
          completedOps: context.completedOps,
          totalOps,
          title
        };
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Pausiert';
        return { success: false, status: 'paused' };
      }

      const b = phase2Ops[j];
      try {
        await this.executeBlockChange(bot, b.x, b.y, b.z, b.fullBlockString, mode);
        context.completedOps++;
        this.buildProgress.currentBlock = context.completedOps;
        if (mode === 'pure_physical' && i % 20 === 0 && bot) {
          inventoryManager.autoEatCheck(bot).catch(() => {});
        }
      } catch (opErr) {
        logger.warn(`Ausnahme bei Phase-2 Blockoperation ${context.completedOps + 1} (${opErr.message}).`);
        if (this.isDisconnectError(bot, opErr) || bot?._client?.ended || opErr?.code === 'ERR_DISCONNECTED' || opErr?.code === 'ECONNRESET' || opErr?.code === 'ERR_STREAM_DESTROYED' || opErr?.message?.includes('disconnect')) {
          this.pausedState = {
            bot,
            blocks,
            options: { ...options, resumeState: null },
            phase: 2,
            phase1Index: phase1Ops.length,
            phase2Index: j,
            completedOps: context.completedOps,
            totalOps,
            title
          };
          this.isBuilding = false;
          this.buildProgress.active = false;
          this.buildProgress.phase = 'Pausiert';
          return { success: false, status: 'paused' };
        }
        throw opErr;
      }
      await new Promise(r => setTimeout(r, delayBetweenOpsMs));
    }

    return { success: true, status: 'completed' };
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
