import { Vec3 } from 'vec3';
import { Rcon } from 'rcon-client';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { VoxelCanvas } from './voxelCanvas.js';
import { inventoryManager } from '../bot/inventoryManager.js';

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

export function isFragileBlock(blockName) {
  if (!blockName || blockName === 'air') return false;
  return FRAGILE_BLOCK_PATTERNS.some(pat => blockName.includes(pat) || blockName.endsWith(pat));
}

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

  abort() {
    this.abortRequested = true;
    this.pauseRequested = false;
    this.isBuilding = false;
    this.pausedState = null;
    this.buildProgress.active = false;
    this.buildProgress.phase = 'Abgebrochen';
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
    const phase1 = []; // Solide Struktur
    const phase2 = []; // Fragile & angehängte Blöcke

    for (const b of blockList) {
      const name = b.name || b.blockState?.name || 'air';
      if (isFragileBlock(name)) {
        phase2.push(b);
      } else {
        phase1.push(b);
      }
    }

    // Phase 1: Boustrophedon-Sortierung (y aufsteigend, z alternierend x auf-/absteigend)
    phase1.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      if (a.z !== b.z) return a.z - b.z;
      // Bei ungeradem Z Schlangenlinie umkehren
      const isReverseRow = Math.abs(a.z) % 2 === 1;
      return isReverseRow ? b.x - a.x : a.x - b.x;
    });

    // Phase 2: Fragile Blöcke ebenfalls nach y aufsteigend (z. B. Tür-Unterteil vor Oberteil)
    phase2.sort((a, b) => {
      if (a.y !== b.y) return a.y - b.y;
      return a.x - b.x || a.z - b.z;
    });

    return { phase1, phase2 };
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
    const blockName = blockStateString.split('[')[0].replace('minecraft:', '');

    // 3.1 & 4.5 Eigenkollisions-Schutz: Reales Ausweichen mit GoalNear statt bloßem Head-Turn
    if (bot && bot.entity && bot.entity.position.distanceTo(targetPos) < 1.3) {
      if (bot.pathfinder) {
        try {
          const { goals } = await import('mineflayer-pathfinder');
          const stepAway = targetPos.offset(1.5, 0, 1.5);
          bot.pathfinder.setGoal(new goals.GoalNear(stepAway.x, stepAway.y, stepAway.z, 0.6));
          // Warte kurz bis der Bot die Hitbox geräumt hat (max 600 ms)
          await new Promise(r => setTimeout(r, 600));
        } catch (err) {
          logger.debug(`Pathfinder-Kollisionsausweichen fehlgeschlagen: ${err.message}`);
        }
      }
    }

    // Item im Creative-Inventar bereitstellen (falls Creative aktiv)
    await inventoryManager.equipBlock(bot, blockName);

    // Suche soliden Referenzblock unter den 6 Nachbarn
    const neighbors = [
      { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
      { offset: new Vec3(0, 1, 0),  face: new Vec3(0, -1, 0) },
      { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
      { offset: new Vec3(0, 0, 1),  face: new Vec3(0, 0, -1) },
      { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
      { offset: new Vec3(1, 0, 0),  face: new Vec3(-1, 0, 0) }
    ];

    let placed = false;
    for (const n of neighbors) {
      const refPos = targetPos.plus(n.offset);
      const refBlock = bot.blockAt ? bot.blockAt(refPos) : null;
      if (refBlock && !refBlock.name.includes('air')) {
        try {
          await bot.placeBlock(refBlock, n.face);
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

  async executeBatch(bot, blocks, options = {}) {
    this.resetAbort();
    this.currentBot = bot;
    this.isBuilding = true;
    const mode = options.mode || settings.BUILD_EXECUTION_MODE;
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

    // 1.2 Materialprüfung vor Bauausführung im pure_physical Modus
    if (mode === 'pure_physical' && !options.isUndo) {
      const requiredBOM = {};
      for (const b of blocks) {
        const name = (b.name || b.blockState?.name || 'stone').replace('minecraft:', '');
        if (name !== 'air' && name !== 'cave_air' && name !== 'void_air') {
          requiredBOM[name] = (requiredBOM[name] || 0) + 1;
        }
      }
      const materialCheck = inventoryManager.checkMaterials(bot, requiredBOM);
      if (!materialCheck.hasAll) {
        const missingList = Object.entries(materialCheck.missing).map(([m, c]) => `${c}x ${m}`).join(', ');
        logger.warn(`[Survival] Fehlende Baumaterialien im Inventar: ${missingList}`);
        if (bot && typeof bot.chat === 'function') {
          bot.chat(`[Material-Prüfung] Achtung, mir fehlen Materialien: ${missingList.slice(0, 80)}`);
        }
        if (options.strictMaterials) {
          logger.error('Bau abgebrochen: Unvollständige Materialien im strictMaterials-Modus.');
          this.isBuilding = false;
          return false;
        }
      }
    }

    // Topologische Aufteilung in 2 Phasen
    const { phase1, phase2 } = this.topologicalSort(blocks);

    let phase1Ops = [];
    if (greedyEnabled && (mode === 'hybrid_visual' || mode === 'rcon_visual')) {
      // 1.4 Direkter Aufruf der statischen Methode ohne unnötige Dummy-Instanz
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

    // === PHASE 1: TRAGWERK & SOLIDE BLÖCKE ===
    if (startPhase === 1) {
      this.buildProgress.phase = 'Phase 1: Tragwerk';
      logger.info(`Phase 1: Setze Tragwerk & solide Strukturen (${phase1Ops.length - startIdx1} verbleibend)...`);

      for (let i = startIdx1; i < phase1Ops.length; i++) {
        if (this.abortRequested) {
          logger.warn('Bauausführung in Phase 1 abgebrochen.');
          this.isBuilding = false;
          this.buildProgress.active = false;
          this.buildProgress.phase = 'Abgebrochen';
          this.pausedState = null;
          return false;
        }

        if (this.pauseRequested) {
          logger.warn(`Bauausführung in Phase 1 bei Operation ${completedOps}/${totalOps} pausiert.`);
          this.pausedState = {
            bot,
            blocks,
            options: { ...options, resumeState: null },
            phase: 1,
            phase1Index: i,
            phase2Index: 0,
            completedOps,
            totalOps,
            title
          };
          this.isBuilding = false;
          this.buildProgress.active = false;
          this.buildProgress.phase = 'Pausiert';
          return false;
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
          completedOps++;
          this.buildProgress.currentBlock = completedOps;
        } catch (opErr) {
          logger.warn(`Ausnahme bei Blockoperation ${completedOps + 1} (${opErr.message}).`);
          // Wenn währenddessen getrennt oder pausiert wurde, sichere aktuellen Bauzustand
          if (this.pauseRequested || !bot?.entity || opErr.message?.includes('disconnect') || opErr.message?.includes('ended')) {
            this.pausedState = {
              bot,
              blocks,
              options: { ...options, resumeState: null },
              phase: 1,
              phase1Index: i,
              phase2Index: 0,
              completedOps,
              totalOps,
              title
            };
            this.isBuilding = false;
            this.buildProgress.active = false;
            this.buildProgress.phase = 'Pausiert';
            return false;
          }
          throw opErr;
        }
        await new Promise(r => setTimeout(r, delayBetweenOpsMs));
      }
    }

    // === PHASE 2: FRAGILE BLÖCKE & DEKO ===
    this.buildProgress.phase = 'Phase 2: Details';
    logger.info(`Phase 2: Setze fragile Blöcke & Details (${phase2Ops.length - (startPhase === 2 ? startIdx2 : 0)} verbleibend)...`);
    for (let j = (startPhase === 2 ? startIdx2 : 0); j < phase2Ops.length; j++) {
      if (this.abortRequested) {
        logger.warn('Bauausführung in Phase 2 abgebrochen.');
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Abgebrochen';
        this.pausedState = null;
        return false;
      }

      if (this.pauseRequested) {
        logger.warn(`Bauausführung in Phase 2 bei Operation ${completedOps}/${totalOps} pausiert.`);
        this.pausedState = {
          bot,
          blocks,
          options: { ...options, resumeState: null },
          phase: 2,
          phase1Index: phase1Ops.length,
          phase2Index: j,
          completedOps,
          totalOps,
          title
        };
        this.isBuilding = false;
        this.buildProgress.active = false;
        this.buildProgress.phase = 'Pausiert';
        return false;
      }

      const b = phase2Ops[j];
      try {
        await this.executeBlockChange(bot, b.x, b.y, b.z, b.fullBlockString, mode);
        completedOps++;
        this.buildProgress.currentBlock = completedOps;
      } catch (opErr) {
        logger.warn(`Ausnahme bei Phase-2 Blockoperation ${completedOps + 1} (${opErr.message}).`);
        if (this.pauseRequested || !bot?.entity || opErr.message?.includes('disconnect') || opErr.message?.includes('ended')) {
          this.pausedState = {
            bot,
            blocks,
            options: { ...options, resumeState: null },
            phase: 2,
            phase1Index: phase1Ops.length,
            phase2Index: j,
            completedOps,
            totalOps,
            title
          };
          this.isBuilding = false;
          this.buildProgress.active = false;
          this.buildProgress.phase = 'Pausiert';
          return false;
        }
        throw opErr;
      }
      await new Promise(r => setTimeout(r, delayBetweenOpsMs));
    }

    this.isBuilding = false;
    this.buildProgress.active = false;
    this.buildProgress.phase = 'Abgeschlossen';
    this.pausedState = null;
    logger.build(`Bauausführung erfolgreich abgeschlossen! Insgesamt ${completedOps} Befehle ausgeführt.`);
    return true;
  }
}

export const worldExecutor = new WorldExecutor();
