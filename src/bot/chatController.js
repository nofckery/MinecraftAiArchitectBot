import pathfinderPkg from 'mineflayer-pathfinder';
const { goals } = pathfinderPkg;
import { settings } from '../config/settings.js';
import { logger } from '../utils/logger.js';
import { worldScanner } from '../world/worldScanner.js';
import { undoManager } from '../world/undoManager.js';
import { worldExecutor } from '../builder/worldExecutor.js';
import { blueprintMemory } from '../ai/blueprintMemory.js';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { rotateLocalToWorld } from '../builder/stateTransform.js';

import { inventoryManager } from './inventoryManager.js';

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

    if (text === '!stop') {
      worldExecutor.abort();
      this.isBuilding = false;
      this.bot.chat('Bauprozess sofort abgebrochen.');
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

    // --- INTERAKTIVE BESTÄTIGUNG ODER FREIE SPRACHE ---

    // 1. Hat der Spieler einen ausstehenden Vorschlag bestätigt?
    const isConfirmation = /^(ja|baue|start|los|mach|ok|go|yes)\b/i.test(text);
    if (isConfirmation && this.agent.pendingProposal) {
      const proposal = this.agent.pendingProposal;
      this.agent.pendingProposal = null;
      await this.executeProposal(username, proposal.userRequest, proposal.siteInfo);
      return;
    }

    // 2. Neuer Bauauftrag oder Modifikation
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
