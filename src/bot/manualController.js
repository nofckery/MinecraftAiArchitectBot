import EventEmitter from 'node:events';
import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { threatManager, THREAT_STATES } from './threatManager.js';

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
    this.pitchLimit = Math.PI / 2 - 0.001; // ~89.94 degrees (~1.5698 rad)
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

  startDigging(targetBlock = null) {
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

    if (typeof this.bot.dig === 'function') {
      const digPromise = this.bot.dig(block, false);
      if (digPromise && typeof digPromise.then === 'function') {
        digPromise.then(() => {
          this.isDigging = false;
          this.currentDigBlock = null;
        }).catch(() => {
          this.isDigging = false;
          this.currentDigBlock = null;
        });
      }
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
    if (block && typeof this.bot.placeBlock === 'function') {
      const face = faceVector || this.resolveFaceVector(block.face);
      try {
        await this.bot.placeBlock(block, face);
        return { success: true, action: 'place_block', against: block.name };
      } catch (placeErr) {
        logger.debug(`[ManualController] placeBlock Fehler: ${placeErr.message}`);
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

  inspectTarget(maxDistance = 4.5) {
    if (!this.bot || !this.bot.entity) return null;

    if (typeof this.bot.entityAtCursor === 'function') {
      const ent = this.bot.entityAtCursor(3.5);
      if (ent) {
        const dist = this.bot.entity.position && ent.position
          ? Number(this.bot.entity.position.distanceTo(ent.position).toFixed(2))
          : null;
        return {
          kind: 'entity',
          name: ent.name || ent.username || 'Unbekannt',
          id: ent.id,
          distance: dist,
          health: ent.health ?? null
        };
      }
    }

    const block = this.inspectTargetBlock(maxDistance);
    if (block) {
      const dist = this.bot.entity.position && block.position
        ? Number(this.bot.entity.position.distanceTo(block.position).toFixed(2))
        : null;
      return {
        kind: 'block',
        name: block.name,
        displayName: block.displayName || block.name,
        position: block.position ? { x: block.position.x, y: block.position.y, z: block.position.z } : null,
        distance: dist,
        hardness: block.hardness ?? 1
      };
    }

    return null;
  }

  inspectTargetBlock(maxDistance = 4.5) {
    if (!this.bot || typeof this.bot.blockAtCursor !== 'function') return null;
    try {
      return this.bot.blockAtCursor(maxDistance);
    } catch {
      return null;
    }
  }

  getHotbarInfo() {
    if (!this.bot || !this.bot.inventory) return [];
    const selectedSlot = this.bot.quickBarSlot ?? 0;
    const hotbar = [];
    const slots = this.bot.inventory.slots || {};

    // Quickbar liegt in Mineflayer-Slots 36 bis 44
    for (let i = 0; i < 9; i++) {
      const item = slots[36 + i];
      hotbar.push({
        slot: i,
        selected: i === selectedSlot,
        item: item ? {
          name: item.name,
          displayName: item.displayName || item.name,
          count: item.count,
          type: item.type
        } : null
      });
    }
    return hotbar;
  }

  getFullInventory() {
    if (!this.bot || !this.bot.inventory) return null;
    const inv = this.bot.inventory;
    const slots = inv.slots || {};

    const formatItem = (item, slotIndex) => {
      if (!item) return null;
      return {
        slot: slotIndex,
        name: item.name,
        displayName: item.displayName || item.name,
        count: item.count,
        type: item.type,
        durabilityUsed: item.durabilityUsed || 0,
        maxDurability: item.maxDurability || 0
      };
    };

    // Armor-Slots: 5: Helm, 6: Brustpanzer, 7: Hose, 8: Stiefel
    const armor = {
      head: formatItem(slots[5], 5),
      torso: formatItem(slots[6], 6),
      legs: formatItem(slots[7], 7),
      feet: formatItem(slots[8], 8)
    };

    // Zweithand (Off-hand): Slot 45
    const offhand = formatItem(slots[45], 45);

    // Hauptinventar: Slots 9..35 (3 Zeilen à 9 Slots = 27 Slots)
    const main = [];
    for (let i = 9; i <= 35; i++) {
      main.push(formatItem(slots[i], i));
    }

    // Hotbar: Slots 36..44 (9 Slots)
    const hotbar = [];
    for (let i = 36; i <= 44; i++) {
      hotbar.push(formatItem(slots[i], i));
    }

    // Am Mauszeiger schwebendes Item (Selected / Held by cursor)
    const selectedItem = inv.selectedItem ? formatItem(inv.selectedItem, -1) : null;

    // Aktiver Behälter (Truhe, Werkbank, Ofen, etc.), falls geöffnet
    let container = null;
    const curWin = this.bot.currentWindow;
    if (curWin && curWin.id !== 0) {
      const containerSlots = [];
      const end = curWin.inventoryStart || 0;
      for (let i = 0; i < end; i++) {
        containerSlots.push(formatItem(curWin.slots[i], i));
      }
      container = {
        id: curWin.id,
        type: curWin.type,
        title: curWin.title || 'Container',
        slots: containerSlots
      };
    }

    return {
      armor,
      offhand,
      main,
      hotbar,
      selectedItem,
      container,
      quickBarSlot: this.bot.quickBarSlot ?? 0
    };
  }

  isInteractableBlock(name) {
    if (!name) return false;
    if (INTERACTABLE_BLOCKS.has(name)) return true;
    return INTERACTABLE_BLOCKS.has(name.toLowerCase());
  }

  resolveFaceVector(face) {
    if (face instanceof Vec3) return face;
    switch (face) {
      case 0: return new Vec3(0, -1, 0); // Bottom
      case 1: return new Vec3(0, 1, 0);  // Top
      case 2: return new Vec3(0, 0, -1); // North
      case 3: return new Vec3(0, 0, 1);  // South
      case 4: return new Vec3(-1, 0, 0); // West
      case 5: return new Vec3(1, 0, 0);  // East
      default: return new Vec3(0, 1, 0);
    }
  }
}

export const manualController = new ManualController();
