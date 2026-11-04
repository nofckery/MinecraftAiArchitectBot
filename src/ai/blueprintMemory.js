import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger.js';

const DATA_DIR = path.resolve('data');
const MEMORY_FILE = path.join(DATA_DIR, 'style_memory.json');

const DEFAULT_STYLES = {
  medieval_oak: {
    name: 'medieval_oak',
    description: 'Klassisches europäisches Fachwerk mit Bruchstein/Steinziegel-Sockel und weißem Lehmputz',
    wallPalette: 'stone_bricks',
    pillarBlock: 'oak_log[axis=y]',
    upperWallPalette: 'white_terracotta',
    roofStair: 'spruce_stairs',
    roofTrim: 'stone_brick_stairs',
    floorPalette: 'oak_planks'
  },
  spruce_rustic: {
    name: 'spruce_rustic',
    description: 'Rustikales Gebirgs- und Taigahaus mit rauem Bruchstein und entrindetem Fichtenholz',
    wallPalette: 'cobblestone',
    pillarBlock: 'spruce_log[axis=y]',
    upperWallPalette: 'stripped_spruce_log[axis=y]',
    roofStair: 'dark_oak_stairs',
    roofTrim: 'cobblestone_stairs',
    floorPalette: 'spruce_planks'
  },
  nordic_timber: {
    name: 'nordic_timber',
    description: 'Dunkler nordischer Wikinger-Stil mit Schieferfliesen und massiven Fichtenbalken',
    wallPalette: 'deepslate_bricks',
    pillarBlock: 'spruce_log[axis=y]',
    upperWallPalette: 'spruce_planks',
    roofStair: 'deepslate_tile_stairs',
    roofTrim: 'spruce_stairs',
    floorPalette: 'dark_oak_planks'
  },
  desert_palace: {
    name: 'desert_palace',
    description: 'Orientalische Oasen-Architektur aus glattem Sandstein, Terrakotta und Kuppeldächern',
    wallPalette: 'smooth_sandstone',
    pillarBlock: 'cut_sandstone',
    upperWallPalette: 'sandstone',
    roofStair: 'sandstone_stairs',
    roofTrim: 'smooth_sandstone_stairs',
    floorPalette: 'terracotta'
  }
};

export class BlueprintMemory {
  constructor() {
    this.styles = new Map();
    this.recentList = [];
    this.load();
  }

  load() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(MEMORY_FILE)) {
        const raw = fs.readFileSync(MEMORY_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (data.styles) {
          for (const [k, v] of Object.entries(data.styles)) {
            this.styles.set(k, v);
          }
        }
        if (Array.isArray(data.recentList)) {
          this.recentList = data.recentList;
        }
      } else {
        // Initialisiere mit Defaults
        for (const [k, v] of Object.entries(DEFAULT_STYLES)) {
          this.styles.set(k, v);
          this.recentList.push(k);
        }
        this.save();
      }
    } catch (err) {
      logger.warn(`Konnte style_memory.json nicht laden, nutze Standardstile: ${err.message}`);
      for (const [k, v] of Object.entries(DEFAULT_STYLES)) {
        this.styles.set(k, v);
      }
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const payload = {
        styles: Object.fromEntries(this.styles),
        recentList: this.recentList.slice(-20)
      };
      fs.writeFileSync(MEMORY_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (err) {
      logger.error(`Fehler beim Speichern von style_memory.json: ${err.message}`);
    }
  }

  saveStyle(name, styleData) {
    this.styles.set(name, { ...styleData, name, lastUsed: Date.now() });
    this.recentList = this.recentList.filter(s => s !== name);
    this.recentList.unshift(name);
    this.save();
  }

  getStyle(name) {
    return this.styles.get(name) || null;
  }

  getRecentStyles() {
    const list = [];
    for (const name of this.recentList) {
      const st = this.styles.get(name);
      if (st) list.push(st);
    }
    return list;
  }
}

export const blueprintMemory = new BlueprintMemory();
