import { Vec3 } from 'vec3';
import { logger } from '../../utils/logger.js';
import { inventoryManager } from '../../bot/inventoryManager.js';
import { scaffoldManager } from '../../survival/scaffoldManager.js';
import { getPathfinderGoals } from '../../utils/pathfinderHelper.js';
import { normalizeBlockName } from '../blockAliases.js';
import { parseBlockProperties, sortNeighborsForBlock } from '../blockTopology.js';

const YAW_MAP = {
  south: 0,
  west: Math.PI / 2,
  north: Math.PI,
  east: -Math.PI / 2
};

const BASE_NEIGHBORS = [
  { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
  { offset: new Vec3(0, 1, 0),  face: new Vec3(0, -1, 0) },
  { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) },
  { offset: new Vec3(0, 0, 1),  face: new Vec3(0, 0, -1) },
  { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
  { offset: new Vec3(1, 0, 0),  face: new Vec3(-1, 0, 0) }
];

/**
 * Places a block physically in the world with collision avoidance, staging, and property orientation.
 *
 * @param {Object} executor
 * @param {Object} bot
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {string} blockStateString
 * @param {string} [mode='pure_physical']
 */
export async function placeBlockPhysically(executor, bot, x, y, z, blockStateString, mode = 'pure_physical') {
  const targetPos = new Vec3(x, y, z);
  const blockName = normalizeBlockName(blockStateString);
  const props = parseBlockProperties(blockStateString);

  // 3.0 Im pure_physical Modus: Staging & Erreichbarkeit sicherstellen (Navigation oder Gerüstbau)
  if (mode === 'pure_physical' && bot) {
    try {
      await scaffoldManager.prepareStaging(bot, targetPos, {
        reservedBlocks: executor.currentBuildReservedBlocks
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

  // SOTA Blickwinkel-Ausrichtung vor Platzierung
  if (props.facing) {
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
  const neighbors = sortNeighborsForBlock(BASE_NEIGHBORS, blockName, props);

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
        // Logging bei fehlgeschlagenem Nachbar-Placement
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
