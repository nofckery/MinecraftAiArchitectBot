import { settings } from '../../../config/settings.js';
import { logger } from '../../../utils/logger.js';
import { taskIntentRouter, TASK_INTENTS } from '../../../ai/router/taskIntentRouter.js';
import { guardManager } from '../../../bot/guardManager.js';
import { harvestManager } from '../../../survival/harvestManager.js';
import { worldExecutor } from '../../../builder/worldExecutor.js';
import { craftingPlanner } from '../../../survival/craftingPlanner.js';
import { smeltingManager } from '../../../survival/smeltingManager.js';
import { baseStorageManager } from '../../../survival/baseStorageManager.js';
import { expeditionManager } from '../../../survival/expeditionManager.js';

const ARCHITECT_WS_TYPES = new Set([
  'prompt_architect',
  'confirm_build',
  'region_ai_edit'
]);

/**
 * Checks if message type belongs to AI Architect planning domain.
 * @param {string} type
 * @returns {boolean}
 */
export function isArchitectWsMessage(type) {
  return ARCHITECT_WS_TYPES.has(type);
}

/**
 * Handles AI prompt, plan confirmation, and regional AI refinement.
 * @param {object} data
 * @param {any} ws
 * @param {object} context
 * @returns {Promise<boolean>}
 */
export async function handleArchitectWsMessage(data, ws, context) {
  const type = data.type;
  if (!isArchitectWsMessage(type)) return false;

  // 1. Prompt architect agent / Gameplay command dispatcher
  if (type === 'prompt_architect') {
    const text = (data.text || '').trim();
    const autoExecute = !!data.autoExecute;
    if (!text) return true;

    context.recordChat(settings.BOT_OWNER || 'Besitzer', text);

    // Universelle Intent-Klassifizierung
    const classified = await taskIntentRouter.classifyIntent(text);

    // A. STOP
    if (classified.intent === TASK_INTENTS.STOP) {
      worldExecutor.abort();
      guardManager.stopGuarding();
      harvestManager.abort();
      expeditionManager.abort();
      smeltingManager.abort();
      if (context.currentBot?.pathfinder) {
        try { context.currentBot.pathfinder.stop(); } catch {}
      }
      context.recordChat('SYSTEM', 'Not-Stopp ausgeführt! Alle aktiven Bau-, Mining- und Wach-Aufträge gestoppt.');
      return true;
    }

    // B. DEFEND (Gebietsverteidigung & Monsterjagd)
    if (classified.intent === TASK_INTENTS.DEFEND) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline. Verteidigung kann nicht gestartet werden.');
        return true;
      }
      const botPos = context.currentBot?.entity?.position;
      const radius = classified.radius || 20;
      await guardManager.startGuarding(context.currentBot, botPos, radius, {
        chatAlerts: true
      });
      context.recordChat('Wachdienst', `Gebietsverteidigung aktiv (Radius: ${radius}m). Feinde und Monster im Perimeter werden bekämpft.`);
      return true;
    }

    // C. MINE (Erz- & Ressourcenabbau)
    if (classified.intent === TASK_INTENTS.MINE) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline. Mining-Auftrag kann nicht gestartet werden.');
        return true;
      }
      const resource = classified.resource || 'iron_ore';
      const amount = classified.amount || 32;
      const radius = classified.radius || 24;

      context.recordChat('Mining', `Starte Mining-Auftrag für bis zu ${amount}x ${resource} (Radius: ${radius}m)...`);

      // Asynchron ausführen, um WS-Eventloop nicht zu blockieren
      (async () => {
        try {
          let res;
          if (resource.includes('log') || resource === 'wood') {
            res = await harvestManager.harvestWood(context.currentBot, resource === 'wood' ? 'any' : resource, amount, radius);
          } else if (resource === 'stone') {
            res = await harvestManager.harvestStone(context.currentBot, amount, radius);
          } else {
            res = await harvestManager.harvestOres(context.currentBot, resource, amount, radius, {
              chatAlerts: true,
              onProgress: (prog) => {
                context.recordChat('Mining', `Fortschritt: ${prog.harvested}/${prog.targetCount} (${prog.currentBlock})`);
              }
            });
          }
          context.recordChat('Mining', res.success ? `Mining erfolgreich: ${res.harvested} Blöcke abgebaut.` : `Mining beendet: ${res.harvested} Blöcke abgebaut.`);
        } catch (err) {
          context.recordChat('Mining', `Fehler beim Mining: ${err.message}`);
        }
      })();
      return true;
    }

    // D. STATUS
    if (classified.intent === TASK_INTENTS.STATUS) {
      const hp = context.currentBot?.health ?? '?';
      const food = context.currentBot?.food ?? '?';
      const guardStatus = guardManager.getStatus();
      const activeTask = guardStatus.isGuarding
        ? `Wachdienst (Radius: ${guardStatus.guardRadius}m, Kills: ${guardStatus.defeatedCount})`
        : (harvestManager.isHarvesting ? 'Mining / Rohstoffabbau' : (worldExecutor.isBuilding ? 'Bauauftrag' : 'Bereit (Standby)'));
      context.recordChat('Status', `HP: ${hp}/20 | Hunger: ${food}/20 | Aktive Aufgabe: ${activeTask}`);
      return true;
    }

    // E. FOLLOW
    if (classified.intent === TASK_INTENTS.FOLLOW) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline.');
        return true;
      }
      const ownerPlayer = settings.BOT_OWNER && context.currentBot.players ? context.currentBot.players[settings.BOT_OWNER]?.entity : null;
      if (ownerPlayer && context.currentBot.pathfinder) {
        const { default: pathfinderPkg } = await import('mineflayer-pathfinder');
        const { goals } = pathfinderPkg;
        context.currentBot.pathfinder.setGoal(new goals.GoalNear(ownerPlayer.position.x, ownerPlayer.position.y, ownerPlayer.position.z, 2));
        context.recordChat('SYSTEM', `Bot läuft zu Spieler '${settings.BOT_OWNER}'...`);
      } else {
        context.recordChat('SYSTEM', `Kann Spieler '${settings.BOT_OWNER}' in der Welt nicht orten.`);
      }
      return true;
    }

    // F. SETHOME (Basis-Wegpunkt)
    if (classified.intent === TASK_INTENTS.SETHOME) {
      const pos = context.currentBot?.entity?.position;
      if (pos) {
        const home = baseStorageManager.setHome(pos);
        context.recordChat('Basis', `Heimatbasis erfolgreich gespeichert bei (${home.x}, ${home.y}, ${home.z})!`);
      } else {
        context.recordChat('SYSTEM', 'Bot-Position unbekannt. Basis konnte nicht gesetzt werden.');
      }
      return true;
    }

    // G. HOME (Zurück zur Basis)
    if (classified.intent === TASK_INTENTS.HOME) {
      const home = baseStorageManager.getHome();
      if (!home) {
        context.recordChat('Basis', 'Noch keine Basis gespeichert! Setze sie mit !sethome oder "Merke dir diesen Ort als Basis".');
        return true;
      }
      context.recordChat('Basis', `Kehre zur Heimatbasis (${home.x}, ${home.y}, ${home.z}) zurück...`);
      if (context.currentBot?.pathfinder) {
        (async () => {
          try {
            const { default: pathfinderPkg } = await import('mineflayer-pathfinder');
            const { goals } = pathfinderPkg;
            await context.currentBot.pathfinder.goto(new goals.GoalNear(home.x, home.y, home.z, 2));
            context.recordChat('Basis', 'Zuhause an der Basis angekommen!');
          } catch (err) {
            context.recordChat('Basis', `Heimweg fehlgeschlagen: ${err.message}`);
          }
        })();
      }
      return true;
    }

    // H. EXPEDITION (Autonome Höhlen-Tour)
    if (classified.intent === TASK_INTENTS.EXPEDITION) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline. Expedition kann nicht gestartet werden.');
        return true;
      }
      const resource = classified.resource || 'iron_ore';
      const amount = classified.amount || 32;
      context.recordChat('Expedition', `Starte Höhlen-Expedition nach ${amount}x ${resource}...`);
      (async () => {
        try {
          const res = await expeditionManager.startExpedition(context.currentBot, {
            targetResource: resource,
            targetAmount: amount,
            onStateChange: (state) => {
              context.recordChat('Expedition', `Status: ${state}`);
            }
          });
          if (res.success) {
            context.recordChat('Expedition', `Expedition erfolgreich! ${res.stats?.oresMined || 0} Erze abgebaut, ${res.stats?.torchesPlaced || 0} Fackeln gesetzt, sicher zurückgekehrt.`);
          } else {
            context.recordChat('Expedition', `Expedition beendet: ${res.error || 'Abgebrochen'}`);
          }
        } catch (err) {
          context.recordChat('Expedition', `Fehler während Expedition: ${err.message}`);
        }
      })();
      return true;
    }

    // I. CRAFT (Auto-Crafting)
    if (classified.intent === TASK_INTENTS.CRAFT) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline. Crafting nicht möglich.');
        return true;
      }
      const item = classified.item || 'torch';
      const count = classified.count || 1;
      context.recordChat('Crafting', `Starte Auto-Crafting für ${count}x ${item}...`);
      (async () => {
        try {
          const res = await craftingPlanner.craftItem(context.currentBot, item, count);
          if (res.success) {
            context.recordChat('Crafting', `Erfolgreich hergestellt: ${res.crafted}x ${res.itemName}!`);
          } else {
            context.recordChat('Crafting', `Crafting fehlgeschlagen: ${res.error}`);
          }
        } catch (err) {
          context.recordChat('Crafting', `Fehler beim Crafting: ${err.message}`);
        }
      })();
      return true;
    }

    // J. SMELT (Roherze im Ofen schmelzen)
    if (classified.intent === TASK_INTENTS.SMELT) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline.');
        return true;
      }
      context.recordChat('Schmelzen', 'Starte Verhüttung von Roherzen im Ofen...');
      (async () => {
        try {
          const res = await smeltingManager.smeltMaterials(context.currentBot, {
            itemType: classified.resource || null
          });
          if (res.success) {
            context.recordChat('Schmelzen', `Verhüttung abgeschlossen: ${res.totalSmelted} Einheiten geschmolzen.`);
          } else {
            context.recordChat('Schmelzen', `Schmelzen beendet: ${res.error || res.message}`);
          }
        } catch (err) {
          context.recordChat('Schmelzen', `Fehler beim Schmelzen: ${err.message}`);
        }
      })();
      return true;
    }

    // K. DEPOSIT (Beute in Basiskisten einsortieren)
    if (classified.intent === TASK_INTENTS.DEPOSIT) {
      if (!context.currentBot) {
        context.recordChat('SYSTEM', 'Bot ist offline.');
        return true;
      }
      context.recordChat('Lager', 'Sortiere Beute und Schätze in Basiskisten ein...');
      (async () => {
        try {
          const res = await baseStorageManager.depositLoot(context.currentBot);
          if (res.success) {
            context.recordChat('Lager', `Eingelagert: ${res.depositedCount} Gegenstände in Basiskisten.`);
          } else {
            context.recordChat('Lager', `Lagerlogistik beendet: ${res.error || res.message}`);
          }
        } catch (err) {
          context.recordChat('Lager', `Fehler beim Einlagern: ${err.message}`);
        }
      })();
      return true;
    }

    // F. BUILD (Architektur-Synthese)
    if (!context.architectAgent) {
      context.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
      return true;
    }

    context.recordChat('BaumeisterKI', `Plane Architektur für: "${text}"...`);

    try {
      const siteInfo = context.architectAgent.getEffectiveSiteInfo();
      let result;
      const isImported = !!(context.architectAgent.lastBuildState?.code?.includes('Imported schematic'));

      if (isImported) {
        result = await context.architectAgent.remixImportedSchematic(text);
        context.activeCanvas = result.canvas;
      } else {
        const isMod = !!(context.architectAgent.lastBuildState && /änder|ergänz|mach das|balkon|dach|stockwerk/i.test(text));
        result = await context.architectAgent.synthesizeBuild(text, siteInfo, isMod);
      }

      context.recordChat(
        'BaumeisterKI',
        `Entwurf fertiggestellt! (${result.canvas.blocks.size} Blöcke, Detailgrad: ${Math.round(result.lintReport.detailRatio * 100)}%). Siehe 3D-Vorschau.`
      );

      if (autoExecute) {
        await context.executeVoxelCanvasBuild(result.canvas, siteInfo, text);
      }
    } catch (err) {
      context.recordChat('BaumeisterKI', `Planungsfehler: ${err.message}`);
      logger.error(`Architektenfehler bei Web-Prompt: ${err.message}`);
    }
    return true;
  }

  // 2. Confirm build execution
  if (type === 'confirm_build') {
    if (!context.architectAgent?.lastBuildState?.canvas) {
      context.recordChat('SYSTEM', 'Kein Entwurf vorhanden. Bitte zuerst einen Bauplan über den Chat anfordern.');
      return true;
    }

    const canvas = context.architectAgent.lastBuildState.canvas;
    const siteInfo = context.architectAgent.getEffectiveSiteInfo();
    await context.executeVoxelCanvasBuild(canvas, siteInfo, 'Dashboard-Freigabe');
    return true;
  }

  // 3. AI-assisted regional editing
  if (type === 'region_ai_edit') {
    const { instruction, selectionBox } = data;
    if (!context.architectAgent) {
      context.recordChat('SYSTEM', 'ArchitectAgent nicht initialisiert.');
      return true;
    }

    if (context.activeCanvas && (!context.architectAgent.lastBuildState || context.architectAgent.lastBuildState.canvas !== context.activeCanvas)) {
      const bounds = context.activeCanvas.getBounds();
      const siteInfo = context.architectAgent.getEffectiveSiteInfo();
      context.architectAgent.lastBuildState = {
        code: '// Active canvas',
        origin: { ...siteInfo.origin },
        width: bounds.width || context.activeCanvas.width,
        height: bounds.height || context.activeCanvas.height,
        depth: bounds.depth || context.activeCanvas.depth,
        facing: siteInfo.facing || 'north',
        canvas: context.activeCanvas
      };
    }

    context.recordChat(settings.BOT_OWNER || 'Besitzer', `[Bereichs-Edit] ${instruction}`);
    context.recordChat('BaumeisterKI', `Überarbeite markierten Bereich (${selectionBox.minX}..${selectionBox.maxX}, ${selectionBox.minY}..${selectionBox.maxY}, ${selectionBox.minZ}..${selectionBox.maxZ})...`);

    try {
      const result = await context.architectAgent.refineRegionWithAI(instruction, selectionBox);
      context.activeCanvas = result.canvas;
      context.broadcastVoxelPreview({
        canvas: result.canvas,
        lintReport: result.lintReport,
        siteInfo: context.architectAgent.lastBuildState || context.architectAgent.getEffectiveSiteInfo(),
        userRequest: `[Bereichs-Edit] ${instruction}`
      });
      context.recordChat('BaumeisterKI', 'Bereich erfolgreich überarbeitet! Siehe 3D-Vorschau.');
    } catch (err) {
      context.recordChat('BaumeisterKI', `Fehler beim Bereichs-Edit: ${err.message}`);
      logger.error(`Fehler bei region_ai_edit: ${err.message}`);
    }
    return true;
  }

  return false;
}
