import fs from 'node:fs';
import path from 'node:path';
import { Vec3 } from 'vec3';
import { logger } from '../utils/logger.js';
import { atomicWriteFileSyncWithRetry } from '../utils/fileUtils.js';

const DATA_DIR = path.resolve('data');
const JOURNAL_FILE = path.join(DATA_DIR, 'undo_journal.json');
const MAX_SNAPSHOTS = 10;

export class UndoManager {
  constructor() {
    this.snapshots = [];
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      if (fs.existsSync(JOURNAL_FILE)) {
        const raw = fs.readFileSync(JOURNAL_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          this.snapshots = data;
        }
      }
    } catch (err) {
      logger.warn(`Konnte undo_journal.json nicht laden: ${err.message}`);
      this.snapshots = [];
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      // Behalte maximal die letzten 10 Snapshots
      const trimmed = this.snapshots.slice(-MAX_SNAPSHOTS);
      atomicWriteFileSyncWithRetry(JOURNAL_FILE, JSON.stringify(trimmed, null, 2));
    } catch (err) {
      logger.error(`Fehler beim Speichern des Undo-Journals: ${err.message}`);
    }
  }

  captureSnapshot(bot, targetBlocks, buildTitle = 'Bauauftrag') {
    logger.info(`Erstelle Undo-Snapshot für '${buildTitle}' (${targetBlocks.length} Zielblöcke)...`);
    const originalBlocks = [];

    for (const b of targetBlocks) {
      const pos = new Vec3(b.x, b.y, b.z);
      const worldBlock = bot.blockAt(pos);

      if (worldBlock) {
        const props = worldBlock._properties || worldBlock.properties || {};
        originalBlocks.push({
          x: b.x,
          y: b.y,
          z: b.z,
          name: worldBlock.name,
          properties: { ...props }
        });
      } else {
        originalBlocks.push({
          x: b.x,
          y: b.y,
          z: b.z,
          name: 'air',
          properties: {}
        });
      }
    }

    const snapshot = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      buildTitle,
      blockCount: originalBlocks.length,
      blocks: originalBlocks
    };

    this.snapshots.push(snapshot);
    this.save();
    logger.info(`Undo-Snapshot #${snapshot.id} erfolgreich auf Disk persistiert.`);
    return snapshot;
  }

  getLatestSnapshot() {
    if (this.snapshots.length === 0) return null;
    return this.snapshots[this.snapshots.length - 1];
  }

  popSnapshot() {
    if (this.snapshots.length === 0) return null;
    const item = this.snapshots.pop();
    this.save();
    return item;
  }

  async executeUndo(bot, worldExecutor) {
    if (this.snapshots.length === 0) {
      logger.warn('Kein Undo-Snapshot im Journal vorhanden.');
      return null;
    }
    const snapshot = this.snapshots[this.snapshots.length - 1];

    logger.build(`Starte Rollback für '${snapshot.buildTitle}' (${snapshot.blockCount} Blöcke)...`);

    // Topologische Umkehrung: Von oben nach unten (y absteigend) zurücksetzen
    const sorted = [...snapshot.blocks].sort((a, b) => b.y - a.y);
    const success = await worldExecutor.executeBatch(bot, sorted, { isUndo: true });
    if (success) {
      this.popSnapshot();
      logger.build(`Rollback für '${snapshot.buildTitle}' erfolgreich abgeschlossen!`);
      return snapshot;
    } else {
      logger.warn(`Rollback für '${snapshot.buildTitle}' nicht vollständig abgeschlossen.`);
      return null;
    }
  }
}

export const undoManager = new UndoManager();
