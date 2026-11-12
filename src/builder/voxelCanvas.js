import minecraftData from 'minecraft-data';

const DEFAULT_MC_DATA = minecraftData('1.20.4');

import { levenshteinDistance } from '../utils/stringUtils.js';
import { normalizeBlockName } from './blockAliases.js';
import { computeGreedyBoxes, toBlockString } from './greedyMesher.js';
import { swapMaterial } from './paletteSwapper.js';
import { computeDiff } from './canvasDiff.js';
import { drawBresenhamLine } from './canvas/bresenhamLine.js';
import { finalizeMultiBlocks } from './canvas/multiBlockFinalizer.js';
import { applySymmetryOrTransform } from './canvas/canvasTransform.js';
import { createSubRegionProxy } from './canvas/subRegionProxy.js';

export class VoxelCanvas {
  constructor(width = 32, height = 32, depth = 32, origin = { x: 0, y: 0, z: 0 }, facing = 'north', mcData = null) {
    this.width = width;
    this.height = height;
    this.depth = depth;
    this.origin = { ...origin };
    this.facing = facing;
    this.mcData = mcData || DEFAULT_MC_DATA;

    this.blocks = new Map(); // key: "x,y,z" -> { name, properties: {} }
    this.ops = 0;
    this.maxOps = 250000;
    this.validationErrors = [];

    // Vorberechnete Block-Namen für Levenshtein-Fuzzy-Matching
    this._knownBlockNames = this.mcData ? Object.keys(this.mcData.blocksByName) : [];
  }

  incOps() {
    this.ops++;
    if (this.ops > this.maxOps) {
      throw new Error(`ExecutionLimitExceeded: Endlosschleife im Bauskript erkannt (Limit: ${this.maxOps} Ops)`);
    }
  }

  makeKey(x, y, z) {
    return `${x},${y},${z}`;
  }

  parseKey(key) {
    const parts = key.split(',');
    return {
      x: parseInt(parts[0], 10),
      y: parseInt(parts[1], 10),
      z: parseInt(parts[2], 10)
    };
  }

  getAllBlockKeys() {
    return Array.from(this.blocks.keys());
  }

  getByKey(key) {
    return this.blocks.get(key) || null;
  }

  findBestMatchBlock(name) {
    let bestMatch = null;
    let minDistance = Infinity;

    for (const validName of this._knownBlockNames) {
      const dist = levenshteinDistance(name, validName);
      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = validName;
      }
      if (minDistance === 1) break;
    }
    return { bestMatch, minDistance };
  }

  normalizeBlock(rawInput, x = 0, y = 0, z = 0) {
    let input = rawInput;
    if (typeof input === 'function') {
      input = input(x, y, z);
    }

    if (!input || input === 'air') {
      return { name: 'air', properties: {} };
    }

    let name = '';
    const properties = {};

    if (typeof input === 'object' && input !== null) {
      name = String(input.name || 'air').trim().toLowerCase();
      if (input.properties && typeof input.properties === 'object') {
        Object.assign(properties, input.properties);
      }
    } else if (typeof input === 'string') {
      const trimmed = input.trim().toLowerCase();
      const stateMatch = trimmed.match(/^([a-z0-9_:]+)\[(.*)\]$/);
      if (stateMatch) {
        name = stateMatch[1];
        const rawProps = stateMatch[2].split(',');
        for (const pair of rawProps) {
          const [k, v] = pair.split('=');
          if (k && v !== undefined) {
            properties[k.trim()] = v.trim();
          }
        }
      } else {
        name = trimmed;
      }
    }

    name = normalizeBlockName(name);

    if (name === 'air') {
      return { name: 'air', properties: {} };
    }

    // Validierung gegen mcData
    if (this.mcData && !this.mcData.blocksByName[name]) {
      const { bestMatch, minDistance } = this.findBestMatchBlock(name);
      this.validationErrors.push(
        `Unbekannter Block '${name}' bei (${x},${y},${z}). Meintest du '${bestMatch}'?`
      );
      if (minDistance <= 2 && bestMatch) {
        name = bestMatch;
      }
    }

    return { name, properties };
  }

  set(x, y, z, blockInput) {
    this.incOps();
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);

    const block = this.normalizeBlock(blockInput, ix, iy, iz);
    const key = this.makeKey(ix, iy, iz);

    if (block.name === 'air') {
      this.blocks.delete(key);
    } else {
      this.blocks.set(key, block);
    }
  }

  get(x, y, z) {
    const key = this.makeKey(Math.floor(x), Math.floor(y), Math.floor(z));
    return this.blocks.get(key) || null;
  }

  has(x, y, z) {
    const b = this.get(x, y, z);
    return b !== null && b.name !== 'air';
  }

  box(x1, y1, z1, x2, y2, z2, blockInput, hollow = false) {
    this.incOps();
    const minX = Math.min(Math.floor(x1), Math.floor(x2));
    const maxX = Math.max(Math.floor(x1), Math.floor(x2));
    const minY = Math.min(Math.floor(y1), Math.floor(y2));
    const maxY = Math.max(Math.floor(y1), Math.floor(y2));
    const minZ = Math.min(Math.floor(z1), Math.floor(z2));
    const maxZ = Math.max(Math.floor(z1), Math.floor(z2));

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (hollow) {
            const isEdge = (x === minX || x === maxX ||
                            y === minY || y === maxY ||
                            z === minZ || z === maxZ);
            if (!isEdge) {
              this.set(x, y, z, 'air');
              continue;
            }
          }
          this.set(x, y, z, blockInput);
        }
      }
    }
  }

  line(x1, y1, z1, x2, y2, z2, blockInput) {
    drawBresenhamLine(this, x1, y1, z1, x2, y2, z2, blockInput);
  }

  cylinder(cx, y1, cz, radius, height, blockInput, hollow = false) {
    this.incOps();
    const r = Math.max(0, radius);
    const rSquared = r * r;
    const innerRSquared = Math.max(0, (r - 1) * (r - 1));
    const minY = Math.floor(y1);
    const maxY = minY + Math.floor(height) - 1;

    for (let y = minY; y <= maxY; y++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
          const distSq = dx * dx + dz * dz;
          if (distSq <= rSquared + 0.25) {
            if (hollow && distSq < innerRSquared) {
              continue;
            }
            this.set(cx + dx, y, cz + dz, blockInput);
          }
        }
      }
    }
  }

  clear(x1, y1, z1, x2, y2, z2) {
    this.box(x1, y1, z1, x2, y2, z2, 'air');
  }

  finalizeMultiBlocks() {
    finalizeMultiBlocks(this);
  }

  static toBlockString(blockStateObj) {
    return toBlockString(blockStateObj);
  }

  static computeGreedyBoxes(phaseBlocks = null, canvasInstance = null) {
    return computeGreedyBoxes(phaseBlocks, canvasInstance);
  }

  computeGreedyBoxes(phaseBlocks = null) {
    return computeGreedyBoxes(phaseBlocks, this);
  }

  static computeDiff(previousCanvas, newCanvas) {
    return computeDiff(previousCanvas, newCanvas);
  }

  getBounds() {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const key of this.blocks.keys()) {
      const { x, y, z } = this.parseKey(key);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    if (minX === Infinity) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, width: 0, height: 0, depth: 0, count: 0 };
    }

    return {
      minX, maxX, minY, maxY, minZ, maxZ,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      depth: maxZ - minZ + 1,
      count: this.blocks.size
    };
  }

  swapMaterial(fromBlock, toBlock, smartGroupSwap = false) {
    return swapMaterial(this, fromBlock, toBlock, smartGroupSwap);
  }

  applySymmetryOrTransform(mode) {
    applySymmetryOrTransform(this, mode);
  }

  createSubRegionProxy(selectionBox) {
    return createSubRegionProxy(this, selectionBox);
  }
}
