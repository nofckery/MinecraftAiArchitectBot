import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldScanner } from '../world/worldScanner.js';
import { undoManager } from '../world/undoManager.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { blueprintMemory } from '../ai/blueprintMemory.js';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { rotateLocalToWorld } from '../builder/stateTransform.js';
import { schematicManager } from '../builder/schematicManager.js';
import { StructuralLinter } from '../builder/structuralLinter.js';

import { inventoryManager } from './inventoryManager.js';
import { envManager } from '../config/envManager.js';
import { dashboardServer } from '../web/dashboardServer.js';
import { taskIntentRouter, TASK_INTENTS } from '../ai/router/taskIntentRouter.js';
import { guardManager } from './guardManager.js';
import { harvestManager } from '../survival/harvestManager.js';
import { craftingPlanner } from '../survival/craftingPlanner.js';
import { smeltingManager } from '../survival/smeltingManager.js';
import { baseStorageManager } from '../survival/baseStorageManager.js';
import { expeditionManager } from '../survival/expeditionManager.js';

export class ChatController {
  constructor(bot, architectAgent) {
    this.bot = bot;
    this.agent = architectAgent;
    this.isBuilding = false;

    // 2.5 Sicherheits-Check für Standard-Owner
    if (!settings.BOT_OWNER || settings.BOT_OWNER === 'DeinSpielerName') {
      logger.warn('[SECURITY] BOT_OWNER steht auf "DeinSpielerName". Alle Spieler im Chat sind autorisiert! Auf öffentlichen Servern bitte BOT_OWNER in .env konfigurieren.');
    }
  }

  isAuthorized(username) {
    if (!settings.BOT_OWNER || settings.BOT_OWNER === 'DeinSpielerName') {
      return true; // Im Offline-/Dev-Modus allen Spielern erlauben
    }
    const isOwner = username.toLowerCase() === settings.BOT_OWNER.toLowerCase();
    if (!isOwner) {
      logger.warn(`Unbefugter Chat-Befehl von '${username}' abgewiesen. Konfigurierter Besitzer ist '${settings.BOT_OWNER}'.`);
    }
    return isOwner;
  }

  async handleMessage(username, message) {
    if (username === this.bot.username) return;
    const text = message.trim();

    if (!this.isAuthorized(username)) {
      logger.debug(`Ignoriere Nachricht von nicht-autorisiertem Spieler '${username}': ${text}`);
      return;
    }

    logger.info(`Chat [${username}]: ${text}`);

    // --- SCHNELLBEFEHLE ---

    if (text === '!mute' || text === '!silent' || text === '!chat off') {
      if (settings.ENABLE_MINECRAFT_CHAT) {
        try {
          this.bot.chat('Minecraft-Chat ist jetzt DEAKTIVIERT (Stiller Modus: Ausgaben nur noch im Web-Dashboard).');
        } catch {}
      }
      settings.ENABLE_MINECRAFT_CHAT = false;
      envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: false });
      dashboardServer.broadcast({
        type: 'settings_updated',
        settings: envManager.getCurrentSettings()
      });
      return;
    }

    if (text === '!unmute' || text === '!chat on') {
      settings.ENABLE_MINECRAFT_CHAT = true;
      envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: true });
      dashboardServer.broadcast({
        type: 'settings_updated',
        settings: envManager.getCurrentSettings()
      });
      this.bot.chat('Minecraft-Chat ist jetzt AKTIVIERT.');
      return;
    }

    if (text === '!chat' || text === '!chat toggle') {
      const nextState = !settings.ENABLE_MINECRAFT_CHAT;
      if (nextState) {
        settings.ENABLE_MINECRAFT_CHAT = true;
        envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: true });
        dashboardServer.broadcast({
          type: 'settings_updated',
          settings: envManager.getCurrentSettings()
        });
        this.bot.chat('Minecraft-Chat ist jetzt AKTIVIERT.');
      } else {
        try {
          this.bot.chat('Minecraft-Chat ist jetzt DEAKTIVIERT (Stiller Modus: Ausgaben nur noch im Web-Dashboard).');
        } catch {}
        settings.ENABLE_MINECRAFT_CHAT = false;
        envManager.saveConfig({ ENABLE_MINECRAFT_CHAT: false });
        dashboardServer.broadcast({
          type: 'settings_updated',
          settings: envManager.getCurrentSettings()
        });
      }
      return;
    }

    if (text === '!stop') {
      worldExecutor.abort();
      guardManager.stopGuarding();
      harvestManager.abort();
      expeditionManager.abort();
      smeltingManager.abort();
      if (this.bot.pathfinder) {
        try { this.bot.pathfinder.stop(); } catch {}
      }
      this.isBuilding = false;
      this.bot.chat('Alle aktiven Aufträge (Bau, Mining, Wachdienst) sofort abgebrochen.');
      return;
    }

    if (text === '!sethome') {
      const pos = this.bot.entity?.position;
      if (pos) {
        const home = baseStorageManager.setHome(pos);
        this.bot.chat(`Heimatbasis erfolgreich gespeichert bei (${home.x}, ${home.y}, ${home.z})!`);
      } else {
        this.bot.chat('Konnte Bot-Position nicht ermitteln.');
      }
      return;
    }

    if (text === '!home') {
      const home = baseStorageManager.getHome();
      if (!home) {
        this.bot.chat('Noch keine Heimatbasis festgelegt! Setze sie zuerst mit !sethome.');
        return;
      }
      this.bot.chat(`Kehre zur Basis zurück (${home.x}, ${home.y}, ${home.z})...`);
      if (this.bot.pathfinder) {
        try {
          const { goals } = await import('mineflayer-pathfinder');
          await this.bot.pathfinder.goto(new goals.GoalNear(home.x, home.y, home.z, 2));
          this.bot.chat('Zuhause an der Basis angekommen!');
        } catch (err) {
          this.bot.chat(`Fehler bei Heimreise: ${err.message}`);
        }
      }
      return;
    }

    if (text.startsWith('!expedition')) {
      const parts = text.split(/\s+/);
      const res = parts[1] || 'iron_ore';
      const amount = parts[2] ? parseInt(parts[2], 10) : 32;
      this.bot.chat(`Starte Höhlen-Expedition nach ${amount}x ${res}...`);
      (async () => {
        const result = await expeditionManager.startExpedition(this.bot, {
          targetResource: res,
          targetAmount: amount
        });
        if (result.success) {
          this.bot.chat(`Höhlen-Expedition beendet! ${result.stats?.oresMined || 0} Erze abgebaut, ${result.stats?.torchesPlaced || 0} Fackeln gesetzt, sicher zurückgekehrt.`);
        } else {
          this.bot.chat(`Expedition beendet: ${result.error || 'Abgebrochen'}`);
        }
      })();
      return;
    }

    if (text.startsWith('!craft')) {
      const parts = text.split(/\s+/);
      const item = parts[1] || 'torch';
      const count = parts[2] ? parseInt(parts[2], 10) : 1;
      this.bot.chat(`Starte Auto-Crafting für ${count}x ${item}...`);
      (async () => {
        const result = await craftingPlanner.craftItem(this.bot, item, count);
        if (result.success) {
          this.bot.chat(`Erfolgreich hergestellt: ${result.crafted}x ${result.itemName}!`);
        } else {
          this.bot.chat(`Crafting fehlgeschlagen: ${result.error}`);
        }
      })();
      return;
    }

    if (text === '!smelt') {
      this.bot.chat('Starte Verhüttung von Roherzen im Ofen...');
      (async () => {
        const result = await smeltingManager.smeltMaterials(this.bot);
        if (result.success) {
          this.bot.chat(`Verhüttung abgeschlossen: ${result.totalSmelted} Einheiten geschmolzen.`);
        } else {
          this.bot.chat(`Schmelzen beendet: ${result.error || result.message}`);
        }
      })();
      return;
    }

    if (text === '!deposit') {
      this.bot.chat('Sortiere Schätze und Beute in Basiskisten ein...');
      (async () => {
        const result = await baseStorageManager.depositLoot(this.bot);
        if (result.success) {
          this.bot.chat(`Erfolgreich eingelagert: ${result.depositedCount} Gegenstände in Basiskisten.`);
        } else {
          this.bot.chat(`Einlagern beendet: ${result.error || result.message}`);
        }
      })();
      return;
    }

    if (text === '!undo') {
      if (this.isBuilding) {
        this.bot.chat('Bitte warte, bis der aktuelle Bauvorgang gestoppt ist.');
        return;
      }
      this.isBuilding = true;
      this.bot.chat('Starte Rollback des letzten Bauwerks aus dem Disk-Journal...');
      try {
        const undone = await undoManager.executeUndo(this.bot, worldExecutor);
        if (undone) {
          this.bot.chat(`Rollback für '${undone.buildTitle}' erfolgreich! (${undone.blockCount} Blöcke wiederhergestellt)`);
        } else {
          this.bot.chat('Kein Snapshot im Undo-Journal gefunden.');
        }
      } catch (err) {
        this.bot.chat(`Fehler beim Rollback: ${err.message}`);
        logger.error(`Undo-Fehler: ${err.message}`);
      } finally {
        this.isBuilding = false;
      }
      return;
    }

    if (text === '!instant') {
      this.agent.setInstantMode(!this.agent.instantMode);
      this.bot.chat(`Sofortbau-Modus ist jetzt ${this.agent.instantMode ? 'AKTIVIERT (keine Rückfragen)' : 'DEAKTIVIERT (interaktive Vorschläge)'}.`);
      return;
    }

    if (text === '!style') {
      const styles = blueprintMemory.getRecentStyles();
      this.bot.chat(`Gespeicherte Stile (${styles.length}): ${styles.map(s => s.name).join(', ')}`);
      return;
    }

    if (text === '!preview') {
      if (this.agent.lastBuildState?.canvas) {
        const ascii = this.agent.lastBuildState.canvas.getBounds();
        this.bot.chat(`Letzter Entwurf: ${ascii.width}x${ascii.depth} (Höhe: ${ascii.height}, ${ascii.count} Blöcke). Details im Server-Terminal.`);
        logger.build('\n' + VoxelCanvas.toBlockString(this.agent.lastBuildState.canvas));
      } else {
        this.bot.chat('Noch kein Entwurf für eine Vorschau vorhanden.');
      }
      return;
    }

    if (text === '!scan') {
      const site = worldScanner.scanBuildSite(this.bot, username);
      this.bot.chat(`Grundstück erkannt: ${site.width}x${site.depth} bei (${site.origin.x}, ${site.origin.y}, ${site.origin.z}), Blickrichtung: ${site.facing}.`);
      if (site.neighborhoodPalette.length > 0) {
        this.bot.chat(`Nachbarschafts-Blöcke: ${site.neighborhoodPalette.join(', ')}`);
      }
      return;
    }

    if (text === '!chests') {
      const chests = await inventoryManager.scanNearbyChests(this.bot, 6.0, true);
      const itemsList = Object.entries(chests).map(([i, c]) => `${c}x ${i}`).join(', ');
      this.bot.chat(`Gefundene Behälter-Ressourcen: ${itemsList || 'Keine Items in Kisten in Reichweite'}`);
      return;
    }

    if (text === '!come') {
      const player = this.bot.players[username]?.entity;
      if (!player) {
        this.bot.chat('Ich kann dich nicht sehen!');
        return;
      }
      if (this.bot.pathfinder) {
        this.bot.chat(`Ich komme zu dir, ${username}!`);
        const { x, y, z } = player.position;
        this.bot.pathfinder.setGoal(new goals.GoalNear(x, y, z, 2));
      }
      return;
    }

    // --- SCHEMATIC BEFEHLE (!schem / !schematic) ---
    if (text.startsWith('!schem') || text.startsWith('!schematic')) {
      const parts = text.split(/\s+/);
      const subCmd = (parts[1] || 'help').toLowerCase();
      const schematicsDir = path.resolve('data/schematics');

      if (subCmd === 'list') {
        try {
          if (!fs.existsSync(schematicsDir)) {
            this.bot.chat('Kein data/schematics Ordner gefunden.');
            return;
          }
          const allowedExts = ['.schem', '.schematic', '.litematic', '.nbt'];
          const files = fs.readdirSync(schematicsDir).filter(f => allowedExts.includes(path.extname(f).toLowerCase()));
          if (files.length === 0) {
            this.bot.chat('Keine Schematics vorhanden. Lege .schem/.litematic/.nbt in data/schematics/ ab.');
          } else {
            const listStr = files.slice(0, 8).join(', ');
            this.bot.chat(`Schematics (${files.length}): ${listStr}${files.length > 8 ? ' ...' : ''}`);
          }
        } catch (err) {
          this.bot.chat(`Fehler beim Auflisten: ${err.message}`);
        }
        return;
      }

      if (subCmd === 'load') {
        const rawFilename = parts.slice(2).join(' ').trim();
        if (!rawFilename) {
          this.bot.chat('Bitte Dateinamen angeben: !schem load <name>');
          return;
        }

        try {
          const safeName = path.basename(rawFilename);
          let targetPath = path.join(schematicsDir, safeName);

          // Falls Endung weggelassen wurde, suche passende Datei
          if (!fs.existsSync(targetPath)) {
            const matches = fs.readdirSync(schematicsDir).filter(f => f.toLowerCase().startsWith(safeName.toLowerCase()));
            if (matches.length > 0) {
              targetPath = path.join(schematicsDir, matches[0]);
            }
          }

          if (!fs.existsSync(targetPath)) {
            this.bot.chat(`Schematic '${safeName}' nicht gefunden. Siehe !schem list`);
            return;
          }

          const resolvedName = path.basename(targetPath);
          const buffer = fs.readFileSync(targetPath);
          const canvas = await schematicManager.loadIntoCanvas(buffer, resolvedName);
          const bounds = canvas.getBounds();

          // Automatische Baufeld-Anpassung
          const siteInfo = this.agent.getEffectiveSiteInfo(username, {
            width: bounds.width,
            depth: bounds.depth,
            height: bounds.height
          });
          this.agent.setCustomBounds({
            minX: siteInfo.origin.x,
            minZ: siteInfo.origin.z,
            maxX: siteInfo.origin.x + bounds.width - 1,
            maxZ: siteInfo.origin.z + bounds.depth - 1,
            baseY: siteInfo.origin.y,
            facing: siteInfo.facing || 'north'
          });

          this.agent.lastBuildState = {
            code: `// Schematic loaded via chat: ${resolvedName}`,
            origin: { ...siteInfo.origin },
            width: bounds.width,
            height: bounds.height,
            depth: bounds.depth,
            facing: siteInfo.facing || 'north',
            canvas
          };

          const lintReport = StructuralLinter.analyze(canvas);
          this.agent.emit('preview', {
            canvas,
            lintReport,
            siteInfo,
            userRequest: `!schem load ${resolvedName}`
          });

          this.bot.chat(`Schematic '${resolvedName}' geladen: ${bounds.width}x${bounds.height}x${bounds.depth} (${bounds.count} Blöcke).`);
          this.bot.chat(`Baufeld gesetzt bei (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z}). Tippe "!schem build" zum Starten!`);
        } catch (err) {
          this.bot.chat(`Fehler beim Laden von '${rawFilename}': ${err.message}`);
          logger.error(`Fehler bei !schem load: ${err.message}`);
        }
        return;
      }

      if (subCmd === 'build') {
        const optionalName = parts.slice(2).join(' ').trim();
        if (optionalName) {
          await this.handleMessage(username, `!schem load ${optionalName}`);
        }

        if (!this.agent.lastBuildState?.canvas) {
          this.bot.chat('Kein Schematic geladen! Bitte zuerst: !schem load <name>');
          return;
        }

        if (this.isBuilding) {
          this.bot.chat('Ich baue gerade noch! Tippe !stop zum Abbrechen.');
          return;
        }

        const canvas = this.agent.lastBuildState.canvas;
        const siteInfo = this.agent.getEffectiveSiteInfo(username);
        const title = this.agent.lastBuildState.code?.replace('// Schematic loaded via chat: ', '') || 'Schematic-Bau';

        this.isBuilding = true;
        this.bot.chat(`Starte Bauausführung für '${title}' (${canvas.blocks.size} Blöcke)...`);

        try {
          const bounds = canvas.getBounds();
          const worldBlocks = [];
          for (const key of canvas.getAllBlockKeys()) {
            const localBlock = canvas.getByKey(key);
            const { x, y, z } = canvas.parseKey(key);
            const rotated = rotateLocalToWorld(x, y, z, localBlock, bounds.width, bounds.depth, siteInfo.facing);
            worldBlocks.push({
              x: siteInfo.origin.x + rotated.x,
              y: siteInfo.origin.y + rotated.y,
              z: siteInfo.origin.z + rotated.z,
              blockState: rotated.blockState,
              fullBlockString: VoxelCanvas.toBlockString(rotated.blockState)
            });
          }

          undoManager.captureSnapshot(this.bot, worldBlocks, title.slice(0, 30));
          const success = await worldExecutor.executeBatch(this.bot, worldBlocks, { title });
          if (success) {
            this.bot.chat(`Fertiggestellt! Das Bauwerk steht bei (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z}).`);
          } else {
            this.bot.chat('Bau wurde unterbrochen oder pausiert.');
          }
        } catch (err) {
          this.bot.chat(`Baufehler: ${err.message}`);
          logger.error(`Fehler bei !schem build: ${err.message}`);
        } finally {
          this.isBuilding = false;
        }
        return;
      }

      if (subCmd === 'clear') {
        this.agent.lastBuildState = null;
        this.bot.chat('Aktiver Bauplan/Schematic entladen.');
        return;
      }

      // Default: Hilfe
      this.bot.chat('Schematic-Befehle: !schem list | !schem load <name> | !schem build [name] | !schem clear');
      return;
    }

    // --- INTERAKTIVE BESTÄTIGUNG ODER FREIE SPRACHE ---

    // 1. Hat der Spieler einen ausstehenden Vorschlag bestätigt?
    const isConfirmation = /^(ja|baue|start|los|mach|ok|go|yes)\b/i.test(text);
    if (isConfirmation && this.agent.pendingProposal) {
      const proposal = this.agent.pendingProposal;
      this.agent.pendingProposal = null;
      await this.executeProposal(username, proposal.userRequest, proposal.siteInfo);
      return;
    }

    // 2. Universelle Intent-Klassifizierung (Gameplay vs. Architektur)
    const classified = await taskIntentRouter.classifyIntent(text);

    if (classified.intent === TASK_INTENTS.STOP) {
      worldExecutor.abort();
      guardManager.stopGuarding();
      harvestManager.abort();
      expeditionManager.abort();
      smeltingManager.abort();
      if (this.bot.pathfinder) {
        try { this.bot.pathfinder.stop(); } catch {}
      }
      this.isBuilding = false;
      this.bot.chat('Not-Stopp ausgeführt! Alle aktiven Aufgaben abgebrochen.');
      return;
    }

    if (classified.intent === TASK_INTENTS.SETHOME) {
      await this.handleMessage(username, '!sethome');
      return;
    }

    if (classified.intent === TASK_INTENTS.HOME) {
      await this.handleMessage(username, '!home');
      return;
    }

    if (classified.intent === TASK_INTENTS.EXPEDITION) {
      const resource = classified.resource || 'iron_ore';
      const amount = classified.amount || 32;
      await this.handleMessage(username, `!expedition ${resource} ${amount}`);
      return;
    }

    if (classified.intent === TASK_INTENTS.CRAFT) {
      const item = classified.item || 'torch';
      const count = classified.count || 1;
      await this.handleMessage(username, `!craft ${item} ${count}`);
      return;
    }

    if (classified.intent === TASK_INTENTS.SMELT) {
      await this.handleMessage(username, '!smelt');
      return;
    }

    if (classified.intent === TASK_INTENTS.DEPOSIT) {
      await this.handleMessage(username, '!deposit');
      return;
    }

    if (classified.intent === TASK_INTENTS.DEFEND) {
      const player = this.bot.players[username]?.entity;
      const center = player?.position ? player.position.clone() : this.bot.entity?.position;
      const radius = classified.radius || 20;
      await guardManager.startGuarding(this.bot, center, radius, { chatAlerts: true });
      return;
    }

    if (classified.intent === TASK_INTENTS.MINE) {
      const resource = classified.resource || 'iron_ore';
      const amount = classified.amount || 32;
      const radius = classified.radius || 24;

      if (resource.includes('log') || resource === 'wood') {
        await harvestManager.harvestWood(this.bot, resource === 'wood' ? 'any' : resource, amount, radius);
      } else if (resource === 'stone') {
        await harvestManager.harvestStone(this.bot, amount, radius);
      } else {
        await harvestManager.harvestOres(this.bot, resource, amount, radius, { chatAlerts: true });
      }
      return;
    }

    if (classified.intent === TASK_INTENTS.FOLLOW) {
      await this.handleMessage(username, '!come');
      return;
    }

    if (classified.intent === TASK_INTENTS.STATUS) {
      const hp = this.bot.health ?? '?';
      const food = this.bot.food ?? '?';
      const guardStatus = guardManager.getStatus();
      const activeTask = guardStatus.isGuarding
        ? `Wachdienst (Radius: ${guardStatus.guardRadius}m, Kills: ${guardStatus.defeatedCount})`
        : (harvestManager.isHarvesting ? 'Mining' : (this.isBuilding ? 'Bauauftrag' : 'Bereit (Standby)'));
      this.bot.chat(`[Status] HP: ${hp}/20 | Hunger: ${food}/20 | Aktiv: ${activeTask}`);
      return;
    }

    // 3. Neuer Bauauftrag oder Modifikation
    if (this.isBuilding) {
      this.bot.chat('Ich baue gerade noch! Tippe !stop, falls ich abbrechen soll.');
      return;
    }

    const siteInfo = this.agent.getEffectiveSiteInfo(username);
    const isImmediate = this.agent.instantMode || /sofort|direkt|instant/i.test(text);

    if (!isImmediate) {
      this.bot.chat('Plane Architektur... erstelle Konzept-Vorschlag...');
      const pitch = await this.agent.createPitch(text, siteInfo);
      if (pitch && pitch.pitchMessage) {
        this.bot.chat(pitch.pitchMessage);
        this.bot.chat('Bestätige mit "ja" oder "baue", um den Bau zu starten (oder nutze !instant).');
        return;
      }
    }

    // Direktbau
    await this.executeProposal(username, text, siteInfo);
  }

  async executeProposal(username, requestText, siteInfo) {
    this.isBuilding = true;
    this.bot.chat('Synthetisiere Architektur-Code in der VM-Sandbox...');

    try {
      const isModification = !!(this.agent.lastBuildState && /änder|ergänz|mach das|balkon|dach|stockwerk/i.test(requestText));
      const buildResult = await this.agent.synthesizeBuild(requestText, siteInfo, isModification);

      const canvas = buildResult.canvas;
      const bounds = canvas.getBounds();

      // Transformiere lokale Koordinaten in Welt-Koordinaten
      const worldBlocks = [];
      for (const key of canvas.getAllBlockKeys()) {
        const localBlock = canvas.getByKey(key);
        const { x, y, z } = canvas.parseKey(key);
        const rotated = rotateLocalToWorld(x, y, z, localBlock, bounds.width, bounds.depth, siteInfo.facing);

        worldBlocks.push({
          x: siteInfo.origin.x + rotated.x,
          y: siteInfo.origin.y + rotated.y,
          z: siteInfo.origin.z + rotated.z,
          blockState: rotated.blockState,
          fullBlockString: VoxelCanvas.toBlockString(rotated.blockState)
        });
      }

      this.bot.chat(`Bauplan validiert (${worldBlocks.length} Blöcke, 0 schwebend). Erstelle Undo-Snapshot...`);

      // Undo-Journal Snapshot erfassen vor dem ersten Block!
      undoManager.captureSnapshot(this.bot, worldBlocks, requestText.slice(0, 30));

      this.bot.chat(`Beginne Bau mit ${settings.BUILD_EXECUTION_MODE}...`);

      const buildTitle = (requestText && requestText.length > 35) ? requestText.slice(0, 32) + '...' : (requestText || 'Chat-Bauauftrag');
      const success = await worldExecutor.executeBatch(this.bot, worldBlocks, { title: buildTitle });
      if (success) {
        this.bot.chat(`Fertiggestellt! Dein Bauwerk steht bei (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z}).`);
      } else {
        this.bot.chat('Bau wurde unterbrochen.');
      }
    } catch (err) {
      this.bot.chat(`Baufehler: ${err.message}`);
      logger.error(`Fehler bei Bauausführung: ${err.message}\n${err.stack}`);
    } finally {
      this.isBuilding = false;
    }
  }
}
