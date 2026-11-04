import minecraftData from 'minecraft-data';
import { rotateProperties, mirrorProperties, autoStitchStairs, rotateFacing } from './stateTransform.js';

const DEFAULT_MC_DATA = minecraftData('1.20.4');

export const BLOCK_ALIASES = {
  'wood_planks': 'oak_planks',
  'plank': 'oak_planks',
  'planks': 'oak_planks',
  'stone_brick': 'stone_bricks',
  'cobble': 'cobblestone',
  'mossy_cobble': 'mossy_cobblestone',
  'stripped_oak': 'stripped_oak_log',
  'stripped_spruce': 'stripped_spruce_log',
  'stripped_birch': 'stripped_birch_log',
  'stripped_dark_oak': 'stripped_dark_oak_log',
  'window': 'glass_pane',
  'glass_window': 'glass_pane',
  'torch_wall': 'wall_torch',
  'wall_torch_block': 'wall_torch',
  'wooden_door': 'oak_door',
  'wood_door': 'oak_door',
  'iron_bars_pane': 'iron_bars',
  'bookshelves': 'bookshelf',
  'smooth_stone_slabs': 'smooth_stone_slab',
  'stone_slabs': 'stone_slab',
  'deepslate_brick': 'deepslate_bricks',
  'deepslate_tile': 'deepslate_tiles',
  'polished_deepslate_brick': 'polished_deepslate',
  'mossy_stone_brick': 'mossy_stone_bricks',
  'cracked_stone_brick': 'cracked_stone_bricks',
  'oak_log_wood': 'oak_log',
  'spruce_log_wood': 'spruce_log',
  'dark_oak_log_wood': 'dark_oak_log',
  'birch_log_wood': 'birch_log',
  'grass': 'short_grass',
  'tall_grass': 'tall_grass',
  'flower': 'dandelion',
  'red_flower': 'poppy',
  'yellow_flower': 'dandelion',
  'dirt_path': 'dirt_path',
  'grass_path': 'dirt_path',
  'brick': 'bricks',
  'log': 'oak_log',
  'wood': 'oak_wood',
  'glass_block': 'glass'
};

function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

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
        name = stateMatch[1].replace('minecraft:', '');
        const rawProps = stateMatch[2].split(',');
        for (const pair of rawProps) {
          const [k, v] = pair.split('=');
          if (k && v !== undefined) {
            properties[k.trim()] = v.trim();
          }
        }
      } else {
        name = trimmed.replace('minecraft:', '');
      }
    }

    // Alias-Prüfung
    if (BLOCK_ALIASES[name]) {
      name = BLOCK_ALIASES[name];
    }

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
    if (!blockStateObj || !blockStateObj.name || blockStateObj.name === 'air') {
      return 'air';
    }
    const props = blockStateObj.properties || {};
    const keys = Object.keys(props).sort();
    if (keys.length === 0) {
      return blockStateObj.name;
    }
    const propStr = keys.map(k => `${k}=${props[k]}`).join(',');
    return `${blockStateObj.name}[${propStr}]`;
  }

  static computeGreedyBoxes(phaseBlocks = null, canvasInstance = null) {
    let blockList = phaseBlocks;
    if (!blockList && canvasInstance) {
      blockList = Array.from(canvasInstance.blocks.entries()).map(([key, blockState]) => {
        const { x, y, z } = canvasInstance.parseKey(key);
        return { x, y, z, blockState, fullBlockString: VoxelCanvas.toBlockString(blockState) };
      });
    }

    if (!blockList || blockList.length === 0) return [];

    // Erstelle ein schnelles 3D-Lookup-Grid
    const grid = new Map();
    for (const b of blockList) {
      const k = `${b.x},${b.y},${b.z}`;
      grid.set(k, { ...b, visited: false });
    }

    const boxes = [];

    // Sortiere nach y, z, x
    blockList.sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);

    for (const start of blockList) {
      const startNode = grid.get(`${start.x},${start.y},${start.z}`);
      if (!startNode || startNode.visited) continue;

      const targetString = start.fullBlockString;
      const x1 = start.x;
      const y1 = start.y;
      const z1 = start.z;

      // 1. Expandiere maximal entlang +X
      let x2 = x1;
      while (true) {
        const nextNode = grid.get(`${x2 + 1},${y1},${z1}`);
        if (nextNode && !nextNode.visited && nextNode.fullBlockString === targetString) {
          x2++;
        } else {
          break;
        }
      }

      // 2. Expandiere entlang +Z für die gesamte Zeile [x1..x2]
      let z2 = z1;
      expandZ: while (true) {
        const testZ = z2 + 1;
        for (let tx = x1; tx <= x2; tx++) {
          const node = grid.get(`${tx},${y1},${testZ}`);
          if (!node || node.visited || node.fullBlockString !== targetString) {
            break expandZ;
          }
        }
        z2 = testZ;
      }

      // 3. Expandiere entlang +Y für die gesamte Ebene [x1..x2] x [z1..z2]
      let y2 = y1;
      expandY: while (true) {
        const testY = y2 + 1;
        for (let tx = x1; tx <= x2; tx++) {
          for (let tz = z1; tz <= z2; tz++) {
            const node = grid.get(`${tx},${testY},${tz}`);
            if (!node || node.visited || node.fullBlockString !== targetString) {
              break expandY;
            }
          }
        }
        y2 = testY;
      }

      // Markiere alle Blöcke im Quader als visited
      for (let tx = x1; tx <= x2; tx++) {
        for (let ty = y1; ty <= y2; ty++) {
          for (let tz = z1; tz <= z2; tz++) {
            const n = grid.get(`${tx},${ty},${tz}`);
            if (n) n.visited = true;
          }
        }
      }

      boxes.push({
        minX: x1,
        minY: y1,
        minZ: z1,
        maxX: x2,
        maxY: y2,
        maxZ: z2,
        blockState: start.blockState,
        fullBlockString: targetString,
        volume: (x2 - x1 + 1) * (y2 - y1 + 1) * (z2 - z1 + 1)
      });
    }

    return boxes;
  }

  computeGreedyBoxes(phaseBlocks = null) {
    return VoxelCanvas.computeGreedyBoxes(phaseBlocks, this);
  }

  static computeDiff(previousCanvas, newCanvas) {
    const diff = [];
    const prevKeys = new Set(previousCanvas ? previousCanvas.getAllBlockKeys() : []);
    const newKeys = new Set(newCanvas ? newCanvas.getAllBlockKeys() : []);

    // Blöcke, die im neuen Canvas existieren oder verändert wurden
    for (const key of newKeys) {
      const newBlock = newCanvas.getByKey(key);
      const prevBlock = previousCanvas ? previousCanvas.getByKey(key) : null;
      const newStr = VoxelCanvas.toBlockString(newBlock);
      const prevStr = VoxelCanvas.toBlockString(prevBlock);

      if (newStr !== prevStr) {
        const { x, y, z } = newCanvas.parseKey(key);
        diff.push({
          x, y, z,
          blockState: newBlock,
          fullBlockString: newStr,
          action: 'set'
        });
      }
    }

    // Blöcke, die entfernt werden müssen (in prev, aber nicht in new)
    for (const key of prevKeys) {
      if (!newKeys.has(key)) {
        const { x, y, z } = previousCanvas.parseKey(key);
        diff.push({
          x, y, z,
          blockState: { name: 'air', properties: {} },
          fullBlockString: 'air',
          action: 'remove'
        });
      }
    }

    return diff;
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
    let cleanFrom = (typeof fromBlock === 'string' ? fromBlock : fromBlock?.name || '')
      .replace(/\[.*\]$/, '')
      .replace('minecraft:', '')
      .trim()
      .toLowerCase();

    let cleanTo = (typeof toBlock === 'string' ? toBlock : toBlock?.name || '')
      .replace(/\[.*\]$/, '')
      .replace('minecraft:', '')
      .trim()
      .toLowerCase();

    if (BLOCK_ALIASES[cleanFrom]) cleanFrom = BLOCK_ALIASES[cleanFrom];
    if (BLOCK_ALIASES[cleanTo]) cleanTo = BLOCK_ALIASES[cleanTo];

    if (!cleanFrom || !cleanTo || cleanFrom === cleanTo) return 0;

    // Extrahiere ggf. explizit übergebene Ziel-Properties aus toBlock
    const toPropMatch = typeof toBlock === 'string' ? toBlock.match(/\[(.*)\]$/) : null;
    const overrideProps = {};
    if (toPropMatch) {
      for (const pair of toPropMatch[1].split(',')) {
        const [k, v] = pair.split('=');
        if (k && v !== undefined) overrideProps[k.trim()] = v.trim();
      }
    }

    let swapCount = 0;

    if (smartGroupSwap) {
      const WOOD_TYPES = ['dark_oak', 'oak', 'spruce', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];
      const fromWood = WOOD_TYPES.find(w => w === 'oak' ? (cleanFrom.includes('oak') && !cleanFrom.includes('dark_oak')) : cleanFrom.includes(w));
      const toWood = WOOD_TYPES.find(w => w === 'oak' ? (cleanTo.includes('oak') && !cleanTo.includes('dark_oak')) : cleanTo.includes(w));

      const STONE_FAMILIES = [
        { base: 'stone', stair: 'stone_stairs', slab: 'stone_slab', wall: 'stone_brick_wall' },
        { base: 'smooth_stone', stair: 'stone_stairs', slab: 'smooth_stone_slab', wall: 'stone_brick_wall' },
        { base: 'stone_bricks', stair: 'stone_brick_stairs', slab: 'stone_brick_slab', wall: 'stone_brick_wall' },
        { base: 'cobblestone', stair: 'cobblestone_stairs', slab: 'cobblestone_slab', wall: 'cobblestone_wall' },
        { base: 'mossy_stone_bricks', stair: 'mossy_stone_brick_stairs', slab: 'mossy_stone_brick_slab', wall: 'mossy_stone_brick_wall' },
        { base: 'mossy_cobblestone', stair: 'mossy_cobblestone_stairs', slab: 'mossy_cobblestone_slab', wall: 'mossy_cobblestone_wall' },
        { base: 'deepslate_bricks', stair: 'deepslate_brick_stairs', slab: 'deepslate_brick_slab', wall: 'deepslate_brick_wall' },
        { base: 'deepslate_tiles', stair: 'deepslate_tile_stairs', slab: 'deepslate_tile_slab', wall: 'deepslate_tile_wall' },
        { base: 'polished_deepslate', stair: 'polished_deepslate_stairs', slab: 'polished_deepslate_slab', wall: 'polished_deepslate_wall' },
        { base: 'cobbled_deepslate', stair: 'cobbled_deepslate_stairs', slab: 'cobbled_deepslate_slab', wall: 'cobbled_deepslate_wall' },
        { base: 'sandstone', stair: 'sandstone_stairs', slab: 'sandstone_slab', wall: 'sandstone_wall' },
        { base: 'smooth_sandstone', stair: 'smooth_sandstone_stairs', slab: 'smooth_sandstone_slab', wall: 'sandstone_wall' },
        { base: 'red_sandstone', stair: 'red_sandstone_stairs', slab: 'red_sandstone_slab', wall: 'red_sandstone_wall' },
        { base: 'smooth_red_sandstone', stair: 'smooth_red_sandstone_stairs', slab: 'smooth_red_sandstone_slab', wall: 'red_sandstone_wall' },
        { base: 'blackstone', stair: 'blackstone_stairs', slab: 'blackstone_slab', wall: 'blackstone_wall' },
        { base: 'polished_blackstone_bricks', stair: 'polished_blackstone_brick_stairs', slab: 'polished_blackstone_brick_slab', wall: 'polished_blackstone_brick_wall' },
        { base: 'polished_blackstone', stair: 'polished_blackstone_stairs', slab: 'polished_blackstone_slab', wall: 'polished_blackstone_wall' },
        { base: 'granite', stair: 'granite_stairs', slab: 'granite_slab', wall: 'granite_wall' },
        { base: 'polished_granite', stair: 'polished_granite_stairs', slab: 'polished_granite_slab', wall: 'granite_wall' },
        { base: 'diorite', stair: 'diorite_stairs', slab: 'diorite_slab', wall: 'diorite_wall' },
        { base: 'polished_diorite', stair: 'polished_diorite_stairs', slab: 'polished_diorite_slab', wall: 'diorite_wall' },
        { base: 'andesite', stair: 'andesite_stairs', slab: 'andesite_slab', wall: 'andesite_wall' },
        { base: 'polished_andesite', stair: 'polished_andesite_stairs', slab: 'polished_andesite_slab', wall: 'andesite_wall' },
        { base: 'mud_bricks', stair: 'mud_brick_stairs', slab: 'mud_brick_slab', wall: 'mud_brick_wall' },
        { base: 'prismarine', stair: 'prismarine_stairs', slab: 'prismarine_slab', wall: 'prismarine_wall' },
        { base: 'prismarine_bricks', stair: 'prismarine_brick_stairs', slab: 'prismarine_brick_slab', wall: 'prismarine_wall' },
        { base: 'dark_prismarine', stair: 'dark_prismarine_stairs', slab: 'dark_prismarine_slab', wall: 'prismarine_wall' },
        { base: 'nether_bricks', stair: 'nether_brick_stairs', slab: 'nether_brick_slab', wall: 'nether_brick_wall' },
        { base: 'red_nether_bricks', stair: 'red_nether_brick_stairs', slab: 'red_nether_brick_slab', wall: 'red_nether_brick_wall' },
        { base: 'end_stone_bricks', stair: 'end_stone_brick_stairs', slab: 'end_stone_brick_slab', wall: 'end_stone_brick_wall' },
        { base: 'quartz_block', stair: 'quartz_stairs', slab: 'quartz_slab', wall: 'stone_brick_wall' },
        { base: 'smooth_quartz', stair: 'smooth_quartz_stairs', slab: 'smooth_quartz_slab', wall: 'stone_brick_wall' },
        { base: 'bricks', stair: 'brick_stairs', slab: 'brick_slab', wall: 'brick_wall' }
      ];

      const fromStoneFam = STONE_FAMILIES.find(f => Object.values(f).includes(cleanFrom));
      const toStoneFam = STONE_FAMILIES.find(f => Object.values(f).includes(cleanTo));

      for (const [key, block] of this.blocks.entries()) {
        let changed = false;
        let newName = block.name;

        // 1. Wood group swap
        if (fromWood && toWood) {
          const isFromWood = fromWood === 'oak'
            ? (block.name.includes('oak') && !block.name.includes('dark_oak'))
            : block.name.includes(fromWood);

          if (isFromWood) {
            if (fromWood === 'oak') {
              newName = block.name.replace(/(^|_)oak(_|$)/, `$1${toWood}$2`);
            } else {
              newName = block.name.replace(fromWood, toWood);
            }
            changed = true;
          }
        }

        // 2. Stone group swap
        if (!changed && fromStoneFam && toStoneFam) {
          const matchRole = Object.keys(fromStoneFam).find(role => fromStoneFam[role] === block.name);
          if (matchRole && toStoneFam[matchRole]) {
            newName = toStoneFam[matchRole];
            changed = true;
          }
        }

        // 3. Fallback direct exact match
        if (!changed && block.name === cleanFrom) {
          newName = cleanTo;
          changed = true;
        }

        if (changed && newName !== block.name) {
          block.name = newName;
          if (Object.keys(overrideProps).length > 0) {
            block.properties = { ...(block.properties || {}), ...overrideProps };
          }
          swapCount++;
        }
      }
    } else {
      for (const [key, block] of this.blocks.entries()) {
        if (block.name === cleanFrom) {
          block.name = cleanTo;
          if (Object.keys(overrideProps).length > 0) {
            block.properties = { ...(block.properties || {}), ...overrideProps };
          }
          swapCount++;
        }
      }
    }

    return swapCount;
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
