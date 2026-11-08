import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { threatManager, THREAT_STATES } from './threatManager.js';
import { serverRights } from './serverRights.js';
import { resolveFaceVector, raycastTargetBlock, inspectTarget } from './manual/manualRaycastHelper.js';
import { formatInventoryItem, getHotbarInfo, getFullInventory } from './manual/manualInventorySerializer.js';

export { resolveFaceVector, raycastTargetBlock, inspectTarget, formatInventoryItem, getHotbarInfo, getFullInventory };

export const CONTROL_NAMES = [
  'forward',
  'back',
  'left',
  'right',
  'jump',
  'sprint',
  'sneak'
];

export const INTERACTABLE_BLOCKS = new Set([
  'chest', 'trapped_chest', 'ender_chest', 'barrel',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker',
  'lever', 'stone_button', 'oak_button', 'spruce_button',
  'birch_button', 'jungle_button', 'acacia_button', 'dark_oak_button',
  'oak_door', 'iron_door', 'spruce_door', 'birch_door',
  'jungle_door', 'acacia_door', 'dark_oak_door', 'mangrove_door', 'cherry_door',
  'oak_trapdoor', 'iron_trapdoor', 'spruce_trapdoor', 'birch_trapdoor',
  'jungle_trapdoor', 'acacia_trapdoor', 'dark_oak_trapdoor',
  'oak_fence_gate', 'spruce_fence_gate', 'birch_fence_gate',
  'anvil', 'chipped_anvil', 'damaged_anvil', 'enchanting_table'
]);

export class ManualController extends EventEmitter {
  constructor() {
    super();
    this.bot = null;
    this.active = false;
    this.activeControls = {
      forward: false,
      back: false,
      left: false,
      right: false,
      jump: false,
      sprint: false,
      sneak: false
    };
    this.isDigging = false;
    this.currentDigBlock = null;
    this.digStartTime = null;
    this.digTotalTime = null;
    this.pitchLimit = Math.PI / 2 - 0.001; // ~89.94 degrees (~1.5698 rad)
  }

  getDigProgress() {
    if (!this.isDigging || !this.digStartTime || !this.digTotalTime || this.digTotalTime <= 0) return 0;
    const elapsed = Date.now() - this.digStartTime;
    return Math.min(1.0, Math.max(0, elapsed / this.digTotalTime));
  }

  canUseOpCommand() {
    if (!this.bot) return false;
    if (this.bot.game?.gameMode === 'creative') return true;
    try {
      const rights = serverRights.getStatus(this.bot);
      return Boolean(rights?.isOp);
    } catch {
      return false;
    }
  }

  isPlacableItem(item) {
    if (!item || !item.name) return false;
    const registry = this.bot?.registry;
    if (registry?.blocksByName && registry.blocksByName[item.name]) return true;
    const placablePatterns = [
      '_planks', '_log', '_wood', '_stone', '_bricks', '_slab', '_stairs',
      '_wall', '_fence', '_glass', '_wool', '_concrete', '_terracotta',
      '_door', '_trapdoor', 'torch', 'dirt', 'sand', 'gravel', 'cobblestone',
      'deepslate', 'obsidian', 'bedrock', 'scaffolding', 'chest', 'barrel',
      'crafting_table', 'furnace', 'anvil', 'ladder', 'lever', '_button'
    ];
    return placablePatterns.some(p => item.name.includes(p));
  }

  isUsableItem(item) {
    if (!item || !item.name) return false;
    const registry = this.bot?.registry;
    if (registry?.foodsByName && registry.foodsByName[item.name]) return true;
    const usablePatterns = ['potion', 'bottle', 'bow', 'crossbow', 'shield', 'spyglass', 'apple', 'bread', 'beef', 'pork', 'chicken', 'mutton', 'carrot', 'potato', 'cookie', 'melon_slice'];
    return usablePatterns.some(p => item.name.includes(p));
  }

  setBot(bot) {
    if (this.active && this.bot && this.bot !== bot) {
      this.deactivate();
    }
    this.bot = bot;
  }

  isActive() {
    return this.active && !!this.bot;
  }

  // --- AI Coordination & Standby Handoff ---

  activate(bot = null) {
    if (bot) this.bot = bot;
    if (!this.bot) {
      logger.warn('[ManualController] Kann Gamemode nicht aktivieren: Kein Bot verbunden.');
      return false;
    }
    if (this.active) return true;

    logger.info('[ManualController] Aktiviere manuellen Gamemode (Takeover)...');

    // 1. WorldExecutor: Bauauftrag sofort pausieren
    if (worldExecutor && worldExecutor.isBuilding) {
      worldExecutor.pauseBuild();
      logger.info('[ManualController] Aktiver Bauauftrag für manuelle Übernahme pausiert.');
    }

    // 2. Pathfinder: Laufende Bewegung sofort abbrechen
    if (this.bot.pathfinder) {
      try {
        if (typeof this.bot.pathfinder.stop === 'function') {
          this.bot.pathfinder.stop();
        }
        if (typeof this.bot.pathfinder.setGoal === 'function') {
          this.bot.pathfinder.setGoal(null);
        }
      } catch (pathErr) {
        logger.debug(`[ManualController] Fehler beim Stoppen des Pathfinders: ${pathErr.message}`);
      }
    }

    // 3. ThreatManager: AI-Zustand zurücksetzen
    if (threatManager) {
      threatManager.state = THREAT_STATES ? THREAT_STATES.IDLE : 'IDLE';
      threatManager.currentTarget = null;
      threatManager.wasBuildingBeforeThreat = false;
      threatManager.backpedalUntil = 0;
    }

    // 4. Steuerungsgrundzustand herstellen & aktivieren
    this.clearControls();
    this.active = true;
    this.emit('activated');
    return true;
  }

  deactivate() {
    if (!this.active) return false;

    logger.info('[ManualController] Deaktiviere manuellen Gamemode -> Standby Handoff...');
    this.active = false;

    // 1. Standby Handoff: Alle Tasten/Bewegungen loslassen
    this.clearControls();

    // 2. Graben/Interaktionen abbrechen
    this.stopDigging();
    if (this.bot && typeof this.bot.deactivateItem === 'function') {
      try {
        this.bot.deactivateItem();
      } catch (itemErr) {
        logger.debug(`[ManualController] Fehler beim Deaktivieren des Items: ${itemErr.message}`);
      }
    }

    // 3. Pathfinder stilllegen
    if (this.bot?.pathfinder) {
      try {
        if (typeof this.bot.pathfinder.stop === 'function') {
          this.bot.pathfinder.stop();
        }
        if (typeof this.bot.pathfinder.setGoal === 'function') {
          this.bot.pathfinder.setGoal(null);
        }
      } catch (pathErr) {
        logger.debug(`[ManualController] Fehler beim Pathfinder-Standby: ${pathErr.message}`);
      }
    }

    // 4. Standby-Garantie: Bauauftrag und ThreatManager bleiben im Standby (KEIN automatisches Wiederaufnehmen)
    this.emit('deactivated');
    logger.info('[ManualController] Bot befindet sich sicher im Leerlauf (Standby) an aktueller Position.');
    return true;
  }

  // --- Movement Controls ---

  setControlState(control, state) {
    if (!this.isActive()) return false;
    if (!CONTROL_NAMES.includes(control)) return false;

    const boolState = Boolean(state);
    this.activeControls[control] = boolState;

    if (this.bot && typeof this.bot.setControlState === 'function') {
      this.bot.setControlState(control, boolState);
    }
    this.emit('control_change', { control, state: boolState });
    return true;
  }

  setControls(controls) {
    if (!this.isActive() || typeof controls !== 'object' || controls === null) return false;
    for (const [ctrl, state] of Object.entries(controls)) {
      if (CONTROL_NAMES.includes(ctrl)) {
        this.setControlState(ctrl, state);
      }
    }
    return true;
  }

  clearControls() {
    for (const ctrl of CONTROL_NAMES) {
      this.activeControls[ctrl] = false;
    }
    if (this.bot && typeof this.bot.clearControlStates === 'function') {
      this.bot.clearControlStates();
    }
    this.emit('controls_cleared');
    return true;
  }

  getActiveControls() {
    return { ...this.activeControls };
  }

  // --- Orientation & Mouse Look ---

  look(yaw, pitch, options = {}) {
    if (!this.isActive() || !this.bot) return false;

    let targetYaw = Number(yaw);
    let targetPitch = Number(pitch);

    if (Number.isNaN(targetYaw) || Number.isNaN(targetPitch)) return false;

    if (options.isDegrees) {
      targetYaw = (targetYaw * Math.PI) / 180;
      targetPitch = (targetPitch * Math.PI) / 180;
    }

    if (options.isDelta) {
      const curYaw = this.bot.entity?.yaw || 0;
      const curPitch = this.bot.entity?.pitch || 0;
      targetYaw = curYaw + targetYaw;
      targetPitch = curPitch + targetPitch;
    }

    // Clamping Pitch: -PI/2 + 0.001 bis +PI/2 - 0.001 (~ -89.9° bis +89.9°)
    if (targetPitch > this.pitchLimit) targetPitch = this.pitchLimit;
    if (targetPitch < -this.pitchLimit) targetPitch = -this.pitchLimit;

    // Normalizing Yaw: Modulo 2*PI im Intervall [-PI, PI]
    targetYaw = ((targetYaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (targetYaw > Math.PI) targetYaw -= 2 * Math.PI;

    if (this.bot && typeof this.bot.look === 'function') {
      // force=true für latenzfreie, synchrone Blickrichtungsübernahme
      this.bot.look(targetYaw, targetPitch, true);
    }
    return true;
  }

  // --- Action & Combat APIs ---

  attack(targetEntityId = null) {
    if (!this.isActive()) return { success: false, reason: 'not_active' };

    let target = null;
    if (targetEntityId !== null && this.bot.entities && this.bot.entities[targetEntityId]) {
      target = this.bot.entities[targetEntityId];
    } else if (typeof this.bot.entityAtCursor === 'function') {
      target = this.bot.entityAtCursor(3.5);
    }

    if (target && target.isValid !== false && (typeof target.health !== 'number' || target.health > 0)) {
      if (typeof this.bot.attack === 'function') {
        this.bot.attack(target);
        return { success: true, action: 'attack_entity', target: target.name || target.username, id: target.id };
      }
    }

    // Wenn kein Entity im Fadenkreuz, versuche Blockabbau (Digging)
    const block = this.inspectTargetBlock(4.5);
    if (block) {
      this.startDigging(block);
      return { success: true, action: 'dig_start', block: block.name, position: block.position };
    }

    // Fallback: Arm schwingen
    if (typeof this.bot.swingArm === 'function') {
      this.bot.swingArm('right');
    }
    return { success: true, action: 'swing_arm' };
  }

  startDigging(targetBlock = null, targetFace = null) {
    if (!this.isActive()) return false;
    const block = targetBlock || this.inspectTargetBlock(4.5);
    if (!block) return false;

    if (this.isDigging && this.currentDigBlock && this.currentDigBlock.position && block.position) {
      const samePos = typeof this.currentDigBlock.position.equals === 'function'
        ? this.currentDigBlock.position.equals(block.position)
        : (this.currentDigBlock.position.x === block.position.x &&
           this.currentDigBlock.position.y === block.position.y &&
           this.currentDigBlock.position.z === block.position.z);
      if (samePos) {
        return true; // Bereits aktiv am selben Block
      }
    }

    this.stopDigging();
    this.isDigging = true;
    this.currentDigBlock = block;
    this.digStartTime = Date.now();
    this.digTotalTime = (this.bot && typeof this.bot.digTime === 'function') ? this.bot.digTime(block) : 500;

    const digFace = targetFace || (block.face !== undefined ? this.resolveFaceVector(block.face) : 'auto');
    const isCreative = Boolean(this.bot?.game?.gameMode === 'creative' || this.digTotalTime === 0);

    if (typeof this.bot.dig === 'function') {
      const digPromise = this.bot.dig(block, 'ignore', digFace);
      if (digPromise && typeof digPromise.then === 'function') {
        digPromise.then(() => {
          this.isDigging = false;
          this.currentDigBlock = null;
          this.digStartTime = null;
          this.digTotalTime = null;
          this.emit('dig_finished', { block });
        }).catch((err) => {
          logger.debug(`[ManualController] Digging beendet/abgebrochen: ${err?.message}`);
          this.isDigging = false;
          this.currentDigBlock = null;
          this.digStartTime = null;
          this.digTotalTime = null;
        });
      }
    }

    // Creative / OP mode instant break fallback
    if (isCreative && this.canUseOpCommand() && block.position) {
      try {
        this.bot.chat(`/setblock ${Math.floor(block.position.x)} ${Math.floor(block.position.y)} ${Math.floor(block.position.z)} air`);
      } catch {}
    }

    return true;
  }

  stopDigging() {
    if (this.bot && typeof this.bot.stopDigging === 'function') {
      try {
        this.bot.stopDigging();
      } catch (err) {
        logger.debug(`[ManualController] Fehler bei stopDigging: ${err.message}`);
      }
    }
    this.isDigging = false;
    this.currentDigBlock = null;
    this.digStartTime = null;
    this.digTotalTime = null;
    return true;
  }

  async interactOrPlace(referenceBlock = null, faceVector = null) {
    if (!this.isActive()) return { success: false, reason: 'not_active' };

    const block = referenceBlock || this.inspectTargetBlock(4.5);

    // 1. Interaktion mit Block (Tür, Kiste, Hebel, etc.) wenn nicht schleichend
    if (block && !this.activeControls.sneak && this.isInteractableBlock(block.name)) {
      if (typeof this.bot.activateBlock === 'function') {
        try {
          await this.bot.activateBlock(block);
          return { success: true, action: 'activate_block', block: block.name };
        } catch (err) {
          logger.debug(`[ManualController] activateBlock Fehler: ${err.message}`);
        }
      }
    }

    // 2. Blockplatzierung gegen Referenzblock
    if (block && (typeof this.bot.placeBlock === 'function' || typeof this.bot._placeBlockWithOptions === 'function')) {
      const face = faceVector
        ? (faceVector instanceof Vec3 ? faceVector : new Vec3(faceVector.x, faceVector.y, faceVector.z))
        : (block.face !== undefined ? this.resolveFaceVector(block.face) : new Vec3(0, 1, 0));

      const held = this.bot.heldItem;
      const isUsable = this.isUsableItem(held);

      // Nur versuchen, wenn gehaltenes Item kein reines Verbrauchs-Item (z.B. Brot/Bogen) ist
      if (!isUsable) {
        const dest = block.position
          ? (typeof block.position.plus === 'function'
              ? block.position.plus(face)
              : new Vec3(block.position.x + face.x, block.position.y + face.y, block.position.z + face.z))
          : null;

        try {
          if (typeof this.bot._placeBlockWithOptions === 'function') {
            const placePromise = this.bot._placeBlockWithOptions(block, face, {
              swingArm: 'right',
              forceLook: 'ignore'
            });
            await Promise.race([
              placePromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('Placement timeout')), 1500))
            ]);
          } else if (typeof this.bot.placeBlock === 'function') {
            await this.bot.placeBlock(block, face);
          }
          return { success: true, action: 'place_block', against: block.name, dest };
        } catch (placeErr) {
          logger.debug(`[ManualController] placeBlock Fehler: ${placeErr.message}`);

          // OP / Creative Fallback via /setblock
          if (dest && this.canUseOpCommand() && held?.name) {
            try {
              this.bot.chat(`/setblock ${Math.floor(dest.x)} ${Math.floor(dest.y)} ${Math.floor(dest.z)} ${held.name}`);
              return { success: true, action: 'place_block', against: block.name, dest, method: 'setblock_fallback' };
            } catch {}
          }
        }
      }
    }

    // 3. Item in Hand aktivieren (Essen, Bogen, Schild)
    if (typeof this.bot.activateItem === 'function') {
      try {
        this.bot.activateItem(false);
        return { success: true, action: 'activate_item' };
      } catch (actErr) {
        return { success: false, reason: actErr.message };
      }
    }

    return { success: false, reason: 'no_target' };
  }

  setQuickBarSlot(slot) {
    if (!this.isActive()) return false;
    const num = Number(slot);
    if (Number.isNaN(num) || num < 0 || num > 8) return false;
    const clampedSlot = Math.max(0, Math.min(8, Math.floor(num)));
    if (typeof this.bot.setQuickBarSlot === 'function') {
      this.bot.setQuickBarSlot(clampedSlot);
      return true;
    }
    return false;
  }

  async toss(dropStack = false) {
    if (!this.isActive() || !this.bot) return false;
    const item = this.bot.heldItem;
    if (!item) return false;
    try {
      if (dropStack && typeof this.bot.tossStack === 'function') {
        await this.bot.tossStack(item);
        return true;
      } else if (typeof this.bot.toss === 'function') {
        await this.bot.toss(item.type, null, 1);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`[ManualController] toss Fehler: ${err.message}`);
      return false;
    }
  }

  async swapHands() {
    if (!this.isActive() || !this.bot) return false;
    try {
      const held = this.bot.heldItem;
      const offhand = this.bot.inventory?.slots?.[45];
      if (held && typeof this.bot.equip === 'function') {
        await this.bot.equip(held, 'off-hand');
      } else if (offhand && typeof this.bot.equip === 'function') {
        await this.bot.equip(offhand, 'hand');
      }
      return true;
    } catch (err) {
      logger.debug(`[ManualController] swapHands Fehler: ${err.message}`);
      return false;
    }
  }

  startUsingItem() {
    if (!this.isActive() || !this.bot) return false;
    if (typeof this.bot.activateItem === 'function') {
      try {
        this.bot.activateItem(false);
        return true;
      } catch (err) {
        logger.debug(`[ManualController] startUsingItem Fehler: ${err.message}`);
      }
    }
    return false;
  }

  stopUsingItem() {
    if (!this.isActive() || !this.bot) return false;
    if (typeof this.bot.deactivateItem === 'function') {
      try {
        this.bot.deactivateItem();
        return true;
      } catch (err) {
        logger.debug(`[ManualController] stopUsingItem Fehler: ${err.message}`);
      }
    }
    return false;
  }

  // --- HUD & Telemetry Helpers ---

  raycastTargetBlock(maxDistance = 4.5) {
    return raycastTargetBlock(this.bot, maxDistance);
  }

  inspectTarget(maxDistance = 4.5) {
    return inspectTarget(this.bot, maxDistance);
  }

  inspectTargetBlock(maxDistance = 4.5) {
    return this.raycastTargetBlock(maxDistance);
  }

  getHotbarInfo() {
    return getHotbarInfo(this.bot);
  }

  getFullInventory() {
    return getFullInventory(this.bot);
  }

  isInteractableBlock(name) {
    if (!name) return false;
    if (INTERACTABLE_BLOCKS.has(name)) return true;
    return INTERACTABLE_BLOCKS.has(name.toLowerCase());
  }

  resolveFaceVector(face) {
    return resolveFaceVector(face);
  }
}

export const manualController = new ManualController();
