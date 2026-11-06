import minecraftData from 'minecraft-data';
import { rotateProperties, mirrorProperties, autoStitchStairs, rotateFacing } from './stateTransform.js';

const DEFAULT_MC_DATA = minecraftData('1.20.4');

import { levenshteinDistance } from '../utils/stringUtils.js';
import { normalizeBlockName } from './blockAliases.js';
import { computeGreedyBoxes, toBlockString } from './greedyMesher.js';
import { swapMaterial } from './paletteSwapper.js';
import { computeDiff } from './canvasDiff.js';

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
    this.incOps();
    let x = Math.floor(x1);
    let y = Math.floor(y1);
    let z = Math.floor(z1);
    const targetX = Math.floor(x2);
    const targetY = Math.floor(y2);
    const targetZ = Math.floor(z2);

    const dx = Math.abs(targetX - x);
    const dy = Math.abs(targetY - y);
    const dz = Math.abs(targetZ - z);
    const xs = targetX > x ? 1 : -1;
    const ys = targetY > y ? 1 : -1;
    const zs = targetZ > z ? 1 : -1;

    // 3D Bresenham Line
    if (dx >= dy && dx >= dz) {
      let p1 = 2 * dy - dx;
      let p2 = 2 * dz - dx;
      while (x !== targetX) {
        this.set(x, y, z, blockInput);
        x += xs;
        if (p1 >= 0) {
          y += ys;
          p1 -= 2 * dx;
        }
        if (p2 >= 0) {
          z += zs;
          p2 -= 2 * dx;
        }
        p1 += 2 * dy;
        p2 += 2 * dz;
      }
    } else if (dy >= dx && dy >= dz) {
      let p1 = 2 * dx - dy;
      let p2 = 2 * dz - dy;
      while (y !== targetY) {
        this.set(x, y, z, blockInput);
        y += ys;
        if (p1 >= 0) {
          x += xs;
          p1 -= 2 * dy;
        }
        if (p2 >= 0) {
          z += zs;
          p2 -= 2 * dy;
        }
        p1 += 2 * dx;
        p2 += 2 * dz;
      }
    } else {
      let p1 = 2 * dy - dz;
      let p2 = 2 * dx - dz;
      while (z !== targetZ) {
        this.set(x, y, z, blockInput);
        z += zs;
        if (p1 >= 0) {
          y += ys;
          p1 -= 2 * dz;
        }
        if (p2 >= 0) {
          x += xs;
          p2 -= 2 * dz;
        }
        p1 += 2 * dy;
        p2 += 2 * dx;
      }
    }
    this.set(targetX, targetY, targetZ, blockInput);
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
    const keys = this.getAllBlockKeys();

    for (const key of keys) {
      const block = this.blocks.get(key);
      if (!block) continue;
      const { x, y, z } = this.parseKey(key);

      // 1. Automatische Türenvervollständigung (Door upper half)
      if (block.name.endsWith('_door')) {
        const props = block.properties || {};
        const half = props.half || 'lower';
        if (half === 'lower') {
          const upperKey = this.makeKey(x, y + 1, z);
          const upperBlock = this.blocks.get(upperKey);
          if (!upperBlock || !upperBlock.name.endsWith('_door')) {
            this.blocks.set(upperKey, {
              name: block.name,
              properties: {
                facing: props.facing || 'north',
                half: 'upper',
                hinge: props.hinge || 'left',
                open: props.open || 'false',
                powered: props.powered || 'false'
              }
            });
          }
        }
      }

      // 2. Wandfackeln (Wandprüfung, wenn kein solider Block darunter ist)
      if (block.name === 'torch' || block.name === 'soul_torch') {
        const isSoul = block.name.startsWith('soul_');
        const belowBlock = this.get(x, y - 1, z);
        const hasSolidFloor = belowBlock && !belowBlock.name.includes('air') &&
                              !belowBlock.name.includes('pane') &&
                              !belowBlock.name.includes('fence') &&
                              !belowBlock.name.includes('wall');

        if (!hasSolidFloor) {
          // Prüfe horizontale Nachbarn nach einer Stützwand
          const neighbors = [
            { dir: 'north', checkX: x, checkZ: z - 1, faceAway: 'south' },
            { dir: 'south', checkX: x, checkZ: z + 1, faceAway: 'north' },
            { dir: 'west',  checkX: x - 1, checkZ: z, faceAway: 'east' },
            { dir: 'east',  checkX: x + 1, checkZ: z, faceAway: 'west' }
          ];

          let attached = false;
          for (const n of neighbors) {
            const wallBlock = this.get(n.checkX, y, n.checkZ);
            if (wallBlock && !wallBlock.name.includes('air') &&
                !wallBlock.name.includes('pane') &&
                !wallBlock.name.includes('slab')) {
              block.name = isSoul ? 'soul_wall_torch' : 'wall_torch';
              block.properties = { facing: n.faceAway };
              attached = true;
              break;
            }
          }

          if (!attached && !hasSolidFloor) {
            // Falls frei in der Luft, markieren
            this.validationErrors.push(`Schwebende Fackel bei (${x},${y},${z}) ohne Stützwand oder Boden.`);
          }
        }
      }
    }
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
    const bounds = this.getBounds();
    if (bounds.count === 0) return;

    const newBlocks = new Map();

    for (const [key, block] of this.blocks.entries()) {
      const { x, y, z } = this.parseKey(key);
      let newX = x;
      let newY = y;
      let newZ = z;
      let newProps = { ...(block.properties || {}) };

      if (mode === 'rotate_90_cw') {
        newX = bounds.minX + (bounds.maxZ - z);
        newZ = bounds.minZ + (x - bounds.minX);
        newProps = rotateProperties(newProps, 1);
      } else if (mode === 'mirror_x') {
        newX = bounds.minX + bounds.maxX - x;
        newProps = mirrorProperties(newProps, 'x');
      } else if (mode === 'mirror_z') {
        newZ = bounds.minZ + bounds.maxZ - z;
        newProps = mirrorProperties(newProps, 'z');
      } else if (mode === 'shift_y_up') {
        newY = y + 1;
      } else if (mode === 'shift_y_down') {
        newY = y - 1;
      }

      const newKey = this.makeKey(newX, newY, newZ);
      newBlocks.set(newKey, {
        name: block.name,
        properties: newProps
      });
    }

    this.blocks = newBlocks;

    if (mode === 'rotate_90_cw') {
      const tempW = this.width;
      this.width = this.depth;
      this.depth = tempW;
      if (typeof rotateFacing === 'function') {
        this.facing = rotateFacing(this.facing || 'north', 1);
      }
    }

    const newBounds = this.getBounds();
    if (newBounds.count > 0) {
      this.width = Math.max(this.width, newBounds.width);
      this.height = Math.max(this.height, newBounds.height);
      this.depth = Math.max(this.depth, newBounds.depth);
    }

    autoStitchStairs(this);
  }

  createSubRegionProxy(selectionBox) {
    const minX = Math.min(selectionBox.minX, selectionBox.maxX);
    const maxX = Math.max(selectionBox.minX, selectionBox.maxX);
    const minY = Math.min(selectionBox.minY, selectionBox.maxY);
    const maxY = Math.max(selectionBox.minY, selectionBox.maxY);
    const minZ = Math.min(selectionBox.minZ, selectionBox.maxZ);
    const maxZ = Math.max(selectionBox.minZ, selectionBox.maxZ);

    const isInside = (x, y, z) => {
      return x >= minX && x <= maxX &&
             y >= minY && y <= maxY &&
             z >= minZ && z <= maxZ;
    };

    const targetCanvas = this;

    const handler = {
      get(target, prop, receiver) {
        if (prop === 'isSubRegionProxy') return true;
        if (prop === 'selectionBox') return { minX, minY, minZ, maxX, maxY, maxZ };

        if (prop === 'set') {
          return (x, y, z, blockInput) => {
            const ix = Math.floor(x);
            const iy = Math.floor(y);
            const iz = Math.floor(z);
            if (isInside(ix, iy, iz)) {
              return target.set(ix, iy, iz, blockInput);
            }
            return false;
          };
        }

        if (prop === 'box') {
          return (x1, y1, z1, x2, y2, z2, blockInput, hollow = false) => {
            const bMinX = Math.min(Math.floor(x1), Math.floor(x2));
            const bMaxX = Math.max(Math.floor(x1), Math.floor(x2));
            const bMinY = Math.min(Math.floor(y1), Math.floor(y2));
            const bMaxY = Math.max(Math.floor(y1), Math.floor(y2));
            const bMinZ = Math.min(Math.floor(z1), Math.floor(z2));
            const bMaxZ = Math.max(Math.floor(z1), Math.floor(z2));

            const startX = Math.max(bMinX, minX);
            const endX = Math.min(bMaxX, maxX);
            const startY = Math.max(bMinY, minY);
            const endY = Math.min(bMaxY, maxY);
            const startZ = Math.max(bMinZ, minZ);
            const endZ = Math.min(bMaxZ, maxZ);

            if (startX > endX || startY > endY || startZ > endZ) return;

            target.incOps();
            for (let x = startX; x <= endX; x++) {
              for (let y = startY; y <= endY; y++) {
                for (let z = startZ; z <= endZ; z++) {
                  if (hollow) {
                    const isEdge = (x === bMinX || x === bMaxX ||
                                    y === bMinY || y === bMaxY ||
                                    z === bMinZ || z === bMaxZ);
                    if (!isEdge) {
                      target.set(x, y, z, 'air');
                      continue;
                    }
                  }
                  target.set(x, y, z, blockInput);
                }
              }
            }
          };
        }

        if (prop === 'clear') {
          return (x1, y1, z1, x2, y2, z2) => {
            const cX1 = Math.max(Math.min(Math.floor(x1), Math.floor(x2)), minX);
            const cX2 = Math.min(Math.max(Math.floor(x1), Math.floor(x2)), maxX);
            const cY1 = Math.max(Math.min(Math.floor(y1), Math.floor(y2)), minY);
            const cY2 = Math.min(Math.max(Math.floor(y1), Math.floor(y2)), maxY);
            const cZ1 = Math.max(Math.min(Math.floor(z1), Math.floor(z2)), minZ);
            const cZ2 = Math.min(Math.max(Math.floor(z1), Math.floor(z2)), maxZ);
            if (cX1 <= cX2 && cY1 <= cY2 && cZ1 <= cZ2) {
              return target.clear(cX1, cY1, cZ1, cX2, cY2, cZ2);
            }
          };
        }

        if (prop === 'swapMaterial') {
          return (fromB, toB, smartGroup = false) => {
            const insideKeys = [];
            for (const key of target.getAllBlockKeys()) {
              const { x, y, z } = target.parseKey(key);
              if (isInside(x, y, z)) {
                insideKeys.push(key);
              }
            }
            const subCanvas = new VoxelCanvas(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);
            for (const key of insideKeys) {
              const blk = target.getByKey(key);
              subCanvas.blocks.set(key, { name: blk.name, properties: { ...(blk.properties || {}) } });
            }
            const count = subCanvas.swapMaterial(fromB, toB, smartGroup);
            for (const key of insideKeys) {
              const updated = subCanvas.getByKey(key);
              if (updated) {
                target.blocks.set(key, updated);
              }
            }
            return count;
          };
        }

        const orig = Reflect.get(target, prop, receiver);
        if (typeof orig === 'function') {
          return (...args) => orig.apply(receiver, args);
        }
        return orig;
      }
    };

    return new Proxy(targetCanvas, handler);
  }
}
