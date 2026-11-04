/**
 * High-Level Prozedurales Architektur-SDK (ArchPrimitives)
 * Stellt dem LLM ein mächtiges, fehlertolerantes Methoden-Repertoire für
 * professionelle mittelalterliche und organische Minecraft-Architektur bereit.
 */

import { createSmartPalette } from '../utils/noise.js';
import { CARDINAL_DIRECTIONS, DIRECTION_VECTORS } from './stateTransform.js';

export class ArchPrimitives {
  constructor(canvas) {
    this.canvas = canvas;
  }

  /**
   * 1. Smart-Palette erstellen
   */
  palette(def, opts = {}) {
    return createSmartPalette(def, opts);
  }

  /**
   * 2. Fundament & Hangabstützung
   */
  foundation(x1, z1, x2, z2, height = 1, palette = 'stone_bricks', terrainMap = null) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    // Hauptsockel von y = 0 bis height - 1
    for (let y = 0; y < height; y++) {
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          this.canvas.set(x, y, z, palette);
        }
      }
    }

    // Hangabstützung nach unten (y < 0) bis auf das Terrain
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const isEdge = (x === minX || x === maxX || z === minZ || z === maxZ);
        let targetGroundY = 0;

        if (typeof terrainMap === 'function') {
          targetGroundY = terrainMap(x, z);
        } else if (terrainMap && typeof terrainMap === 'object') {
          targetGroundY = terrainMap[`${x},${z}`] ?? 0;
        }

        // Stütze bis zum Terrain herunterziehen
        if (targetGroundY < 0 && isEdge) {
          for (let y = -1; y >= targetGroundY; y--) {
            this.canvas.set(x, y, z, palette);
          }
        }
      }
    }
  }

  /**
   * 3. Fachwerk-Stockwerk mit Tiefenstaffelung (Pfeiler, Rahmenbalken, Wandeinzug)
   */
  framedRoom(x1, y1, z1, x2, y2, z2, opts = {}) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    const pillarBlock = opts.pillarBlock || 'spruce_log[axis=y]';
    const wallPalette = opts.wallPalette || 'white_terracotta';
    const floorPalette = opts.floorPalette || 'oak_planks';
    const ceilingPalette = opts.ceilingPalette || opts.floorPalette || 'spruce_planks';
    const beamBlockX = opts.beamBlockX || 'spruce_log[axis=x]';
    const beamBlockZ = opts.beamBlockZ || 'spruce_log[axis=z]';
    const bracketStair = opts.bracketStairs || 'spruce_stairs';
    const inset = opts.inset ?? 1;

    // 1. Boden & Decke
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        this.canvas.set(x, minY, z, floorPalette);
        this.canvas.set(x, maxY, z, ceilingPalette);
      }
    }

    // 2. Horizontale Rahmenbalken oben und unten
    for (let x = minX; x <= maxX; x++) {
      this.canvas.set(x, minY, minZ, beamBlockX);
      this.canvas.set(x, minY, maxZ, beamBlockX);
      this.canvas.set(x, maxY, minZ, beamBlockX);
      this.canvas.set(x, maxY, maxZ, beamBlockX);
    }
    for (let z = minZ; z <= maxZ; z++) {
      this.canvas.set(minX, minY, z, beamBlockZ);
      this.canvas.set(maxX, minY, z, beamBlockZ);
      this.canvas.set(minX, maxY, z, beamBlockZ);
      this.canvas.set(maxX, maxY, z, beamBlockZ);
    }

    // 3. Eckpfeiler und Zwischenpfeiler (alle 3-4 Blöcke)
    const pillarX = [minX, maxX];
    const dx = maxX - minX;
    if (dx >= 7) {
      const mid = Math.round((minX + maxX) / 2);
      pillarX.push(mid);
    }
    const pillarZ = [minZ, maxZ];
    const dz = maxZ - minZ;
    if (dz >= 7) {
      const mid = Math.round((minZ + maxZ) / 2);
      pillarZ.push(mid);
    }

    for (const px of pillarX) {
      for (const pz of [minZ, maxZ]) {
        for (let y = minY; y <= maxY; y++) {
          this.canvas.set(px, y, pz, pillarBlock);
        }
      }
    }
    for (const pz of pillarZ) {
      for (const px of [minX, maxX]) {
        for (let y = minY; y <= maxY; y++) {
          this.canvas.set(px, y, pz, pillarBlock);
        }
      }
    }

    // 4. Wandflächen (bei inset=1 um 1 Block nach innen versetzt für Plastizität)
    const wallMinX = inset === 1 ? minX + 1 : minX;
    const wallMaxX = inset === 1 ? maxX - 1 : maxX;
    const wallMinZ = inset === 1 ? minZ + 1 : minZ;
    const wallMaxZ = inset === 1 ? maxZ - 1 : maxZ;

    for (let y = minY + 1; y < maxY; y++) {
      // Nord- und Südwand
      for (let x = wallMinX; x <= wallMaxX; x++) {
        if (!this.canvas.has(x, y, wallMinZ)) {
          this.canvas.set(x, y, wallMinZ, wallPalette);
        }
        if (!this.canvas.has(x, y, wallMaxZ)) {
          this.canvas.set(x, y, wallMaxZ, wallPalette);
        }
      }
      // West- und Ostwand
      for (let z = wallMinZ; z <= wallMaxZ; z++) {
        if (!this.canvas.has(wallMinX, y, z)) {
          this.canvas.set(wallMinX, y, z, wallPalette);
        }
        if (!this.canvas.has(wallMaxX, y, z)) {
          this.canvas.set(wallMaxX, y, z, wallPalette);
        }
      }
    }

    // 5. Äußere Stützstreben an Pfeilerköpfen und -füßen
    if (bracketStair && inset === 1) {
      // An Pfeilerköpfen invertierte Treppen nach außen
      for (const px of pillarX) {
        if (px > minX && px < maxX) {
          this.canvas.set(px, maxY - 1, minZ, `${bracketStair}[facing=north,half=top]`);
          this.canvas.set(px, maxY - 1, maxZ, `${bracketStair}[facing=south,half=top]`);
        }
      }
    }
  }

  /**
   * 4. Vorkragender Fachwerk-Oberbau (Jetty Floor)
   */
  jettyFloor(x1, y1, z1, x2, y2, z2, opts = {}) {
    const overhang = opts.overhang ?? 1;
    const bracketStair = opts.bracketStairs || 'spruce_stairs';
    const fenceBlock = opts.fenceBlock || 'dark_oak_fence';

    const jx1 = Math.min(x1, x2) - overhang;
    const jx2 = Math.max(x1, x2) + overhang;
    const jz1 = Math.min(z1, z2) - overhang;
    const jz2 = Math.max(z1, z2) + overhang;
    const minY = Math.min(y1, y2);
    const maxY = Math.max(y1, y2);

    // 1. Unterseitige Kragträger & Stützkonsolen bei y = minY - 1
    const supportY = minY - 1;
    if (supportY >= 0) {
      // Nord-Kante
      for (let x = jx1; x <= jx2; x++) {
        this.canvas.set(x, supportY, jz1, `${bracketStair}[facing=north,half=top]`);
      }
      // Süd-Kante
      for (let x = jx1; x <= jx2; x++) {
        this.canvas.set(x, supportY, jz2, `${bracketStair}[facing=south,half=top]`);
      }
      // West-Kante
      for (let z = jz1; z <= jz2; z++) {
        this.canvas.set(jx1, supportY, z, `${bracketStair}[facing=west,half=top]`);
      }
      // Ost-Kante
      for (let z = jz1; z <= jz2; z++) {
        this.canvas.set(jx2, supportY, z, `${bracketStair}[facing=east,half=top]`);
      }

      // Eckstützen aus Zäunen
      if (supportY - 1 >= 0) {
        this.canvas.set(jx1, supportY - 1, jz1, fenceBlock);
        this.canvas.set(jx2, supportY - 1, jz1, fenceBlock);
        this.canvas.set(jx1, supportY - 1, jz2, fenceBlock);
        this.canvas.set(jx2, supportY - 1, jz2, fenceBlock);
      }
    }

    // 2. Erweiterten Raum auf dem vorkragenden Fußabdruck bauen
    this.framedRoom(jx1, minY, jz1, jx2, maxY, jz2, opts);
  }

  /**
   * 5. Satteldach / Giebeldach
   */
  gableRoof(x1, y, z1, x2, z2, opts = {}) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    const stairBlock = opts.stairBlock || 'spruce_stairs';
    const trimStairBlock = opts.trimStairBlock || 'stone_brick_stairs';
    const ridgeSlabBlock = opts.ridgeSlabBlock || 'stone_brick_slab';
    const gablePalette = opts.gablePalette || 'white_terracotta';
    const gableLogBlock = opts.gableLogBlock || 'spruce_log[axis=y]';

    // Bestimme Dachachse: First verläuft entlang der längeren Seite (Standard: X)
    const axis = opts.axis || ((maxX - minX) >= (maxZ - minZ) ? 'x' : 'z');

    if (axis === 'x') {
      // First verläuft entlang X, Steigung von Nord (-Z) und Süd (+Z) zur Mitte
      const overhangX = 1; // Ortgang
      const overhangZ = 1; // Traufe
      const rMinX = minX - overhangX;
      const rMaxX = maxX + overhangX;
      const rMinZ = minZ - overhangZ;
      const rMaxZ = maxZ + overhangZ;

      const span = rMaxZ - rMinZ;
      const halfSpan = Math.floor(span / 2);

      let curY = y;
      for (let step = 0; step <= halfSpan; step++) {
        const curZNorth = rMinZ + step;
        const curZSouth = rMaxZ - step;

        for (let x = rMinX; x <= rMaxX; x++) {
          const isTrim = (x === rMinX || x === rMaxX);
          const activeStair = isTrim ? trimStairBlock : stairBlock;

          if (curZNorth < curZSouth) {
            this.canvas.set(x, curY, curZNorth, `${activeStair}[facing=south,half=bottom]`);
            this.canvas.set(x, curY, curZSouth, `${activeStair}[facing=north,half=bottom]`);

            // Invertierte Treppen unter dem Trauf-Überhang (bei step === 0)
            if (step === 0) {
              this.canvas.set(x, curY - 1, curZNorth, `${activeStair}[facing=north,half=top]`);
              this.canvas.set(x, curY - 1, curZSouth, `${activeStair}[facing=south,half=top]`);
            }
          } else if (curZNorth === curZSouth) {
            // First-Krone bei ungerader Breite
            this.canvas.set(x, curY, curZNorth, ridgeSlabBlock);
          }
        }

        // Giebeldreieck an Front (minX) und Rückseite (maxX) ausfüllen
        for (let z = curZNorth + 1; z < curZSouth; z++) {
          this.canvas.set(minX, curY, z, gablePalette);
          this.canvas.set(maxX, curY, z, gablePalette);
        }

        curY++;
      }

      // Bei gerader Breite First-Abschluss zwischen den beiden obersten Stufen
      if (span % 2 === 1) {
        const midZ1 = rMinZ + halfSpan;
        const midZ2 = midZ1 + 1;
        for (let x = rMinX; x <= rMaxX; x++) {
          this.canvas.set(x, curY - 1, midZ1, ridgeSlabBlock);
          this.canvas.set(x, curY - 1, midZ2, ridgeSlabBlock);
        }
      }

      // Vertikale Fachwerk-Giebelbalken in der Giebelmitte
      const centerZ = Math.floor((minZ + maxZ) / 2);
      for (let gy = y; gy < curY; gy++) {
        this.canvas.set(minX, gy, centerZ, gableLogBlock);
        this.canvas.set(maxX, gy, centerZ, gableLogBlock);
      }

    } else {
      // First verläuft entlang Z, Steigung von West (-X) und Ost (+X) zur Mitte
      const overhangX = 1;
      const overhangZ = 1;
      const rMinX = minX - overhangX;
      const rMaxX = maxX + overhangX;
      const rMinZ = minZ - overhangZ;
      const rMaxZ = maxZ + overhangZ;

      const span = rMaxX - rMinX;
      const halfSpan = Math.floor(span / 2);

      let curY = y;
      for (let step = 0; step <= halfSpan; step++) {
        const curXWest = rMinX + step;
        const curXEast = rMaxX - step;

        for (let z = rMinZ; z <= rMaxZ; z++) {
          const isTrim = (z === rMinZ || z === rMaxZ);
          const activeStair = isTrim ? trimStairBlock : stairBlock;

          if (curXWest < curXEast) {
            this.canvas.set(curXWest, curY, z, `${activeStair}[facing=east,half=bottom]`);
            this.canvas.set(curXEast, curY, z, `${activeStair}[facing=west,half=bottom]`);

            if (step === 0) {
              this.canvas.set(curXWest, curY - 1, z, `${activeStair}[facing=west,half=top]`);
              this.canvas.set(curXEast, curY - 1, z, `${activeStair}[facing=east,half=top]`);
            }
          } else if (curXWest === curXEast) {
            this.canvas.set(curXWest, curY, z, ridgeSlabBlock);
          }
        }

        // Giebeldreieck an Stirnseiten ausfüllen
        for (let x = curXWest + 1; x < curXEast; x++) {
          this.canvas.set(x, curY, minZ, gablePalette);
          this.canvas.set(x, curY, maxZ, gablePalette);
        }

        curY++;
      }

      if (span % 2 === 1) {
        const midX1 = rMinX + halfSpan;
        const midX2 = midX1 + 1;
        for (let z = rMinZ; z <= rMaxZ; z++) {
          this.canvas.set(midX1, curY - 1, z, ridgeSlabBlock);
          this.canvas.set(midX2, curY - 1, z, ridgeSlabBlock);
        }
      }

      const centerX = Math.floor((minX + maxX) / 2);
      for (let gy = y; gy < curY; gy++) {
        this.canvas.set(centerX, gy, minZ, gableLogBlock);
        this.canvas.set(centerX, gy, maxZ, gableLogBlock);
      }
    }
  }

  /**
   * 6. Vierseitiges Walmdach (Hip Roof)
   */
  hipRoof(x1, y, z1, x2, z2, opts = {}) {
    const minX = Math.min(x1, x2);
    const maxX = Math.max(x1, x2);
    const minZ = Math.min(z1, z2);
    const maxZ = Math.max(z1, z2);

    const stairBlock = opts.stairBlock || 'spruce_stairs';
    const ridgeSlabBlock = opts.ridgeSlabBlock || 'spruce_slab';

    let rMinX = minX - 1;
    let rMaxX = maxX + 1;
    let rMinZ = minZ - 1;
    let rMaxZ = maxZ + 1;
    let curY = y;

    while (rMinX <= rMaxX && rMinZ <= rMaxZ) {
      if (rMinX === rMaxX || rMinZ === rMaxZ) {
        // First-Linie oder zentraler First-Block
        for (let x = rMinX; x <= rMaxX; x++) {
          for (let z = rMinZ; z <= rMaxZ; z++) {
            this.canvas.set(x, curY, z, ridgeSlabBlock);
          }
        }
        break;
      }

      // Kanten mit Treppen belegen
      for (let x = rMinX; x <= rMaxX; x++) {
        this.canvas.set(x, curY, rMinZ, `${stairBlock}[facing=south,half=bottom]`);
        this.canvas.set(x, curY, rMaxZ, `${stairBlock}[facing=north,half=bottom]`);
      }
      for (let z = rMinZ; z <= rMaxZ; z++) {
        this.canvas.set(rMinX, curY, z, `${stairBlock}[facing=east,half=bottom]`);
        this.canvas.set(rMaxX, curY, z, `${stairBlock}[facing=west,half=bottom]`);
      }

      // Traufüberhang-Stützen bei unterster Ebene
      if (curY === y) {
        for (let x = rMinX; x <= rMaxX; x++) {
          this.canvas.set(x, curY - 1, rMinZ, `${stairBlock}[facing=north,half=top]`);
          this.canvas.set(x, curY - 1, rMaxZ, `${stairBlock}[facing=south,half=top]`);
        }
        for (let z = rMinZ; z <= rMaxZ; z++) {
          this.canvas.set(rMinX, curY - 1, z, `${stairBlock}[facing=west,half=top]`);
          this.canvas.set(rMaxX, curY - 1, z, `${stairBlock}[facing=east,half=top]`);
        }
      }

      rMinX++;
      rMaxX--;
      rMinZ++;
      rMaxZ--;
      curY++;
    }
  }

  /**
   * 7. Konisches Turmdach (Kegel-/Hexendach)
   */
  conicalTowerRoof(cx, y, cz, radius, height, opts = {}) {
    const stairBlock = opts.stairBlock || 'dark_oak_stairs';
    const slabBlock = opts.slabBlock || 'dark_oak_slab';
    const solidBlock = opts.solidBlock || 'dark_oak_planks';
    const wallBlock = opts.wallBlock || 'stone_brick_wall';
    const fenceBlock = opts.fenceBlock || 'spruce_fence';
    const tipBlock = opts.tipBlock || 'lightning_rod';

    let currentY = y;
    const rStart = radius + 0.5;

    for (let h = 0; h < height; h++) {
      const progress = h / height;
      const curR = Math.max(0.5, rStart * (1 - progress));
      const rSq = curR * curR;

      for (let dx = -Math.ceil(curR); dx <= Math.ceil(curR); dx++) {
        for (let dz = -Math.ceil(curR); dz <= Math.ceil(curR); dz++) {
          const dSq = dx * dx + dz * dz;
          if (dSq <= rSq) {
            const isEdge = dSq > (curR - 0.9) * (curR - 0.9);
            if (isEdge && curR > 1.2) {
              // Richtung bestimmen für Treppenausrichtung
              let facing = 'north';
              if (Math.abs(dx) > Math.abs(dz)) {
                facing = dx > 0 ? 'west' : 'east';
              } else {
                facing = dz > 0 ? 'north' : 'south';
              }
              this.canvas.set(cx + dx, currentY, cz + dz, `${stairBlock}[facing=${facing},half=bottom]`);
            } else if (curR <= 1.2) {
              this.canvas.set(cx + dx, currentY, cz + dz, slabBlock);
            } else {
              this.canvas.set(cx + dx, currentY, cz + dz, solidBlock);
            }
          }
        }
      }
      currentY++;
    }

    // Dachspitze (Mauer + Zaun + Blitzableiter)
    this.canvas.set(cx, currentY, cz, wallBlock);
    this.canvas.set(cx, currentY + 1, cz, fenceBlock);
    this.canvas.set(cx, currentY + 2, cz, tipBlock);
  }

  /**
   * 8. Runder Turm mit Wendeltreppe, Buttresses & Zinnenkranz
   */
  cylindricalTower(cx, y1, cz, radius, height, opts = {}) {
    const wallPalette = opts.wallPalette || 'stone_bricks';
    const centerPillar = opts.centerPillar || 'spruce_log[axis=y]';
    const stairBlock = opts.stairBlock || 'stone_brick_stairs';
    const wallBlock = opts.wallBlock || 'stone_brick_wall';
    const slabBlock = opts.slabBlock || 'stone_brick_slab';
    const battlementFence = opts.battlementFence || 'spruce_fence';

    const minY = Math.min(y1, y1 + height - 1);
    const maxY = Math.max(y1, y1 + height - 1);

    // 1. Hohler Zylinder für die Turmmauer
    this.canvas.cylinder(cx, minY, cz, radius, height, wallPalette, true);

    // 2. Zentrale Wendeltreppen-Säule
    for (let y = minY; y <= maxY; y++) {
      this.canvas.set(cx, y, cz, centerPillar);
    }

    // 3. Spiralförmige Wendeltreppe
    const spiralRadius = Math.max(1, radius - 1);
    for (let y = minY; y <= maxY; y++) {
      const angle = (y - minY) * (Math.PI / 2.5);
      const stepX = Math.round(cx + Math.cos(angle) * spiralRadius);
      const stepZ = Math.round(cz + Math.sin(angle) * spiralRadius);
      this.canvas.set(stepX, y, stepZ, slabBlock);
    }

    // 4. Stützstreben (Buttresses) an den 4 Himmelsrichtungen
    const buttressDist = radius + 1;
    const cardinals = [
      { x: cx, z: cz - buttressDist, stairFacing: 'south' },
      { x: cx, z: cz + buttressDist, stairFacing: 'north' },
      { x: cx - buttressDist, z: cz, stairFacing: 'east' },
      { x: cx + buttressDist, z: cz, stairFacing: 'west' }
    ];

    const buttressHeight = Math.floor(height * 0.6);
    for (const b of cardinals) {
      for (let y = minY; y < minY + buttressHeight; y++) {
        this.canvas.set(b.x, y, b.z, wallPalette);
      }
      // Abschrägung oben
      this.canvas.set(b.x, minY + buttressHeight, b.z, `${stairBlock}[facing=${b.stairFacing},half=bottom]`);
    }

    // 5. Zinnenkranz (Battlements mit crenellations: true)
    const topY = maxY + 1;
    const rSq = (radius + 0.5) * (radius + 0.5);
    const innerRSq = (radius - 0.5) * (radius - 0.5);

    let battlementCounter = 0;
    for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx++) {
      for (let dz = -Math.ceil(radius); dz <= Math.ceil(radius); dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq >= innerRSq && distSq <= rSq) {
          battlementCounter++;
          if (battlementCounter % 2 === 0) {
            this.canvas.set(cx + dx, topY, cz + dz, wallPalette);
          } else {
            this.canvas.set(cx + dx, topY, cz + dz, battlementFence);
          }
        }
      }
    }
  }

  /**
   * 9. Detailliertes Fenster mit Läden, Sturz & Blumenbrett
   */
  windowWithDetail(x, y, z, w = 1, h = 2, facing = 'north', opts = {}) {
    const glassBlock = opts.glassBlock || 'glass_pane';
    const trapdoorBlock = opts.trapdoorBlock || 'spruce_trapdoor';
    const stairBlock = opts.stairBlock || 'spruce_stairs';
    const flower = opts.flower || 'poppy';

    const fVec = DIRECTION_VECTORS[facing] || { x: 0, z: -1 };
    // Tangente für die Breite des Fensters
    const isNorthSouth = facing === 'north' || facing === 'south';

    for (let dy = 0; dy < h; dy++) {
      for (let dw = 0; dw < w; dw++) {
        const wx = isNorthSouth ? x + dw : x;
        const wy = y + dy;
        const wz = isNorthSouth ? z : z + dw;

        // Glas einsetzen
        this.canvas.set(wx, wy, wz, glassBlock);
      }
    }

    // Äußerer Fenstersturz (Invertierte Treppe über dem Fenster)
    const lintelY = y + h;
    for (let dw = 0; dw < w; dw++) {
      const lx = isNorthSouth ? x + dw : x;
      const lz = isNorthSouth ? z : z + dw;
      this.canvas.set(lx, lintelY, lz, `${stairBlock}[facing=${facing},half=top]`);
    }

    // Blumenbrett unter dem Fenster (außen)
    const sillY = y - 1;
    for (let dw = 0; dw < w; dw++) {
      const sx = isNorthSouth ? x + dw : x + fVec.x;
      const sz = isNorthSouth ? z + fVec.z : z + dw;

      this.canvas.set(sx, sillY, sz, 'grass_block');
      this.canvas.set(sx, sillY + 1, sz, flower);
      // Umrahmende Falltür
      this.canvas.set(sx + fVec.x, sillY, sz + fVec.z, `${trapdoorBlock}[facing=${facing},open=true]`);
    }

    // Fensterläden links und rechts
    if (isNorthSouth) {
      for (let dy = 0; dy < h; dy++) {
        this.canvas.set(x - 1, y + dy, z, `${trapdoorBlock}[facing=west,open=true]`);
        this.canvas.set(x + w, y + dy, z, `${trapdoorBlock}[facing=east,open=true]`);
      }
    } else {
      for (let dy = 0; dy < h; dy++) {
        this.canvas.set(x, y + dy, z - 1, `${trapdoorBlock}[facing=north,open=true]`);
        this.canvas.set(x, y + dy, z + w, `${trapdoorBlock}[facing=south,open=true]`);
      }
    }
  }

  /**
   * 10. Portal & Eingangstür mit Stufe, Überbogen und Laterne
   */
  doorway(x, y, z, facing = 'north', opts = {}) {
    const doorBlock = opts.doorBlock || 'oak_door';
    const stairBlock = opts.stairBlock || 'stone_brick_stairs';
    const pillarBlock = opts.pillarBlock || 'stone_bricks';
    const stepBlock = opts.stepBlock || 'stone_brick_slab';
    const doubleDoor = opts.doubleDoor || false;

    const fVec = DIRECTION_VECTORS[facing] || { x: 0, z: -1 };
    const isNorthSouth = facing === 'north' || facing === 'south';

    // 1. Tür-Öffnung freischneiden und Tür setzen
    this.canvas.set(x, y, z, `${doorBlock}[facing=${facing},half=lower,hinge=left,open=false]`);
    this.canvas.set(x, y + 1, z, `${doorBlock}[facing=${facing},half=upper,hinge=left,open=false]`);

    // Durchgang dahinter freihalten (in Gegenrichtung des facing)
    this.canvas.set(x - fVec.x, y, z - fVec.z, 'air');
    this.canvas.set(x - fVec.x, y + 1, z - fVec.z, 'air');

    // Durchgang davor auf Kopfhöhe freihalten
    this.canvas.set(x + fVec.x, y + 1, z + fVec.z, 'air');

    if (doubleDoor) {
      const dx = isNorthSouth ? 1 : 0;
      const dz = isNorthSouth ? 0 : 1;
      this.canvas.set(x + dx, y, z + dz, `${doorBlock}[facing=${facing},half=lower,hinge=right,open=false]`);
      this.canvas.set(x + dx, y + 1, z + dz, `${doorBlock}[facing=${facing},half=upper,hinge=right,open=false]`);
      this.canvas.set(x + dx - fVec.x, y, z + dz - fVec.z, 'air');
      this.canvas.set(x + dx - fVec.x, y + 1, z + dz - fVec.z, 'air');
      this.canvas.set(x + dx + fVec.x, y + 1, z + dz + fVec.z, 'air');
    }

    // 2. Eingangs-Stufe davor
    const stepX = x + fVec.x;
    const stepZ = z + fVec.z;
    this.canvas.set(stepX, y, stepZ, stepBlock);
    if (doubleDoor) {
      const dx = isNorthSouth ? 1 : 0;
      const dz = isNorthSouth ? 0 : 1;
      this.canvas.set(stepX + dx, y, stepZ + dz, stepBlock);
    }

    // 3. Portalsäulen links und rechts
    const leftX = isNorthSouth ? x - 1 : x;
    const leftZ = isNorthSouth ? z : z - 1;
    const rightX = isNorthSouth ? (doubleDoor ? x + 2 : x + 1) : x;
    const rightZ = isNorthSouth ? z : (doubleDoor ? z + 2 : z + 1);

    for (let py = y; py <= y + 1; py++) {
      this.canvas.set(leftX, py, leftZ, pillarBlock);
      this.canvas.set(rightX, py, rightZ, pillarBlock);
    }

    // 4. Überbogen mit Treppen
    this.canvas.set(leftX, y + 2, leftZ, `${stairBlock}[facing=${facing},half=top]`);
    this.canvas.set(rightX, y + 2, rightZ, `${stairBlock}[facing=${facing},half=top]`);
    this.canvas.set(x, y + 2, z, pillarBlock);
    if (doubleDoor) {
      const dx = isNorthSouth ? 1 : 0;
      const dz = isNorthSouth ? 0 : 1;
      this.canvas.set(x + dx, y + 2, z + dz, pillarBlock);
    }

    // 5. Hängende Laterne über dem Sturz
    const lanternX = x + fVec.x;
    const lanternZ = z + fVec.z;
    this.canvas.set(lanternX, y + 2, lanternZ, 'lantern[hanging=true]');
  }

  /**
   * 11. Kamin & Schornstein mit echten Rauchpartikeln
   */
  chimney(x, yStart, z, yEnd, brickPalette = 'bricks') {
    const brick = typeof brickPalette === 'string' ? brickPalette : 'bricks';
    const stair = brick.includes('stone') ? 'stone_brick_stairs' : 'brick_stairs';
    const slab = brick.includes('stone') ? 'stone_brick_slab' : 'brick_slab';

    // 1. Unterer Kamin (Feuerstelle) bei yStart
    this.canvas.set(x, yStart, z, 'campfire[lit=true]');
    this.canvas.set(x, yStart, z - 1, brick);
    this.canvas.set(x - 1, yStart, z, brick);
    this.canvas.set(x + 1, yStart, z, brick);
    this.canvas.set(x, yStart, z + 1, 'iron_bars'); // Funkenfang vorne

    // Feuerraum-Überdachung
    this.canvas.set(x - 1, yStart + 1, z, `${stair}[facing=east,half=bottom]`);
    this.canvas.set(x + 1, yStart + 1, z, `${stair}[facing=west,half=bottom]`);
    this.canvas.set(x, yStart + 1, z - 1, brick);
    this.canvas.set(x, yStart + 1, z, 'air'); // Abzugsschacht

    // 2. Steigender Schornsteinschaft bis yEnd
    for (let y = yStart + 2; y <= yEnd; y++) {
      this.canvas.set(x + 1, y, z, brick);
      this.canvas.set(x - 1, y, z, brick);
      this.canvas.set(x, y, z + 1, brick);
      this.canvas.set(x, y, z - 1, brick);
      this.canvas.set(x, y, z, 'air');
    }

    // 3. Schornsteinkrone mit zweitem Campfire für sichtbaren Rauch
    this.canvas.set(x, yEnd, z, 'campfire[lit=true]');
    this.canvas.set(x, yEnd + 1, z, 'spruce_trapdoor[half=bottom]');
    this.canvas.set(x + 1, yEnd + 1, z, slab);
    this.canvas.set(x - 1, yEnd + 1, z, slab);
    this.canvas.set(x, yEnd + 1, z + 1, slab);
    this.canvas.set(x, yEnd + 1, z - 1, slab);
  }

  /**
   * 12. Prozedurale Inneneinrichtung ohne Blockieren von Türen & Laufwegen
   */
  furnishInterior(x1, y, z1, x2, z2, roomType = 'tavern') {
    const minX = Math.min(x1, x2) + 1;
    const maxX = Math.max(x1, x2) - 1;
    const minZ = Math.min(z1, z2) + 1;
    const maxZ = Math.max(z1, z2) - 1;

    if (minX > maxX || minZ > maxZ) return;

    // Prüft, ob ein Feld für Möbel frei ist (nicht neben einer Tür)
    const isFree = (fx, fz) => {
      const b = this.canvas.get(fx, y, fz);
      if (b && b.name !== 'air') return false;

      // 1 Block Umkreis auf Türen prüfen
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const adj = this.canvas.get(fx + dx, y, fz + dz);
          if (adj && adj.name.endsWith('_door')) return false;
        }
      }
      return true;
    };

    switch (roomType) {
      case 'tavern': {
        // Tresen an einer Wand (z. B. Nordwand)
        let counterPlaced = 0;
        for (let x = minX; x <= maxX - 2 && counterPlaced < 3; x++) {
          if (isFree(x, minZ)) {
            this.canvas.set(x, y, minZ, 'barrel');
            counterPlaced++;
          }
        }
        if (counterPlaced > 0 && isFree(minX + counterPlaced, minZ)) {
          this.canvas.set(minX + counterPlaced, y, minZ, 'cauldron');
        }

        // Sitzecke in der Mitte/Süden
        const tableX = Math.floor((minX + maxX) / 2);
        const tableZ = Math.floor((minZ + maxZ) / 2);
        if (isFree(tableX, tableZ)) {
          this.canvas.set(tableX, y, tableZ, 'spruce_fence');
          this.canvas.set(tableX, y + 1, tableZ, 'red_carpet');
          if (isFree(tableX - 1, tableZ)) {
            this.canvas.set(tableX - 1, y, tableZ, 'spruce_stairs[facing=east,half=bottom]');
          }
          if (isFree(tableX + 1, tableZ)) {
            this.canvas.set(tableX + 1, y, tableZ, 'spruce_stairs[facing=west,half=bottom]');
          }
        }
        break;
      }

      case 'bedroom': {
        // Bett in einer geschützten Ecke
        if (isFree(minX, minZ) && isFree(minX, minZ + 1)) {
          this.canvas.set(minX, y, minZ + 1, 'red_bed[facing=north,part=foot]');
          this.canvas.set(minX, y, minZ, 'red_bed[facing=north,part=head]');
        }
        // Nachttisch & Bücher
        if (isFree(minX + 1, minZ)) {
          this.canvas.set(minX + 1, y, minZ, 'crafting_table');
          this.canvas.set(minX + 1, y + 1, minZ, 'flower_pot');
        }
        if (isFree(maxX, minZ)) {
          this.canvas.set(maxX, y, minZ, 'bookshelf');
          this.canvas.set(maxX, y + 1, minZ, 'lantern[hanging=false]');
        }
        // Teppich vor dem Bett
        if (isFree(minX + 1, minZ + 1)) {
          this.canvas.set(minX + 1, y, minZ + 1, 'red_carpet');
        }
        break;
      }

      case 'smithy': {
        // Schmiede-Inventar
        if (isFree(minX, minZ)) this.canvas.set(minX, y, minZ, 'blast_furnace');
        if (isFree(minX + 1, minZ)) this.canvas.set(minX + 1, y, minZ, 'anvil');
        if (isFree(maxX, minZ)) this.canvas.set(maxX, y, minZ, 'grindstone');
        if (isFree(minX, maxZ)) this.canvas.set(minX, y, maxZ, 'cauldron');
        if (isFree(maxX, maxZ)) this.canvas.set(maxX, y, maxZ, 'smithing_table');
        break;
      }

      case 'library': {
        // Bücherregal-Reihen
        for (let x = minX; x <= maxX; x += 2) {
          if (isFree(x, minZ)) {
            this.canvas.set(x, y, minZ, 'bookshelf');
            this.canvas.set(x, y + 1, minZ, 'bookshelf');
          }
        }
        const midX = Math.floor((minX + maxX) / 2);
        const midZ = Math.floor((minZ + maxZ) / 2);
        if (isFree(midX, midZ)) {
          this.canvas.set(midX, y, midZ, 'lectern');
          this.canvas.set(midX, y + 1, midZ, 'lantern[hanging=false]');
        }
        break;
      }

      case 'storage': {
        // Kisten und Fässer stapeln
        for (let z = minZ; z <= maxZ; z++) {
          if (isFree(minX, z)) {
            this.canvas.set(minX, y, z, 'barrel');
            this.canvas.set(minX, y + 1, z, 'barrel');
          }
          if (isFree(maxX, z)) {
            this.canvas.set(maxX, y, z, 'chest');
          }
        }
        break;
      }

      case 'alchemy': {
        // Braustand, Kessel, Regale
        if (isFree(minX, minZ)) this.canvas.set(minX, y, minZ, 'brewing_stand');
        if (isFree(minX + 1, minZ)) this.canvas.set(minX + 1, y, minZ, 'cauldron');
        if (isFree(maxX, minZ)) {
          this.canvas.set(maxX, y, minZ, 'bookshelf');
          this.canvas.set(maxX, y + 1, minZ, 'bookshelf');
        }
        break;
      }

      case 'kitchen': {
        // Räucherofen, Kessel, Arbeitsfläche, Fässer
        if (isFree(minX, minZ)) this.canvas.set(minX, y, minZ, 'smoker');
        if (isFree(minX + 1, minZ)) this.canvas.set(minX + 1, y, minZ, 'cauldron');
        if (isFree(minX + 2, minZ)) {
          this.canvas.set(minX + 2, y, minZ, 'barrel');
          this.canvas.set(minX + 2, y + 1, minZ, 'lantern[hanging=false]');
        }
        if (isFree(maxX, minZ)) this.canvas.set(maxX, y, minZ, 'crafting_table');
        break;
      }

      case 'armory': {
        // Rüstungsständer, Schleifstein, Amboss, Waffenkisten
        if (isFree(minX, minZ)) this.canvas.set(minX, y, minZ, 'armor_stand');
        if (isFree(minX + 1, minZ)) this.canvas.set(minX + 1, y, minZ, 'anvil');
        if (isFree(maxX, minZ)) this.canvas.set(maxX, y, minZ, 'grindstone');
        if (isFree(maxX, maxZ)) this.canvas.set(maxX, y, maxZ, 'chest');
        break;
      }

      case 'workshop': {
        // Werkbank, Steinsäge, Schmelzofen, Webstuhl
        if (isFree(minX, minZ)) this.canvas.set(minX, y, minZ, 'crafting_table');
        if (isFree(minX + 1, minZ)) this.canvas.set(minX + 1, y, minZ, 'stonecutter');
        if (isFree(maxX, minZ)) this.canvas.set(maxX, y, minZ, 'blast_furnace');
        if (isFree(minX, maxZ)) this.canvas.set(minX, y, maxZ, 'loom');
        break;
      }

      case 'chapel': {
        // Altar in der Mitte, Lesepult, Bänke
        const midX = Math.floor((minX + maxX) / 2);
        if (isFree(midX, minZ)) {
          this.canvas.set(midX, y, minZ, 'chiseled_stone_bricks');
          this.canvas.set(midX, y + 1, minZ, 'candle[lit=true]');
        }
        if (isFree(midX - 1, minZ + 2)) this.canvas.set(midX - 1, y, minZ + 2, 'spruce_stairs[facing=south,half=bottom]');
        if (isFree(midX + 1, minZ + 2)) this.canvas.set(midX + 1, y, minZ + 2, 'spruce_stairs[facing=south,half=bottom]');
        break;
      }

      case 'throne': {
        // Thronsitz mit Stufen und Gold/Banner-Deko
        const midX = Math.floor((minX + maxX) / 2);
        if (isFree(midX, minZ)) {
          this.canvas.set(midX, y, minZ, 'smooth_quartz_stairs[facing=south,half=bottom]');
          this.canvas.set(midX - 1, y, minZ, 'smooth_quartz_slab');
          this.canvas.set(midX + 1, y, minZ, 'smooth_quartz_slab');
          this.canvas.set(midX, y + 1, minZ, 'gold_block');
        }
        break;
      }

      default: {
        // 3.4 Robuster Default-Fallback: Gemütlicher Basistisch mit Stühlen, Laterne & Kiste
        const midX = Math.floor((minX + maxX) / 2);
        const midZ = Math.floor((minZ + maxZ) / 2);
        if (isFree(midX, midZ)) {
          this.canvas.set(midX, y, midZ, 'spruce_fence');
          this.canvas.set(midX, y + 1, midZ, 'lantern[hanging=false]');
        }
        if (isFree(midX - 1, midZ)) {
          this.canvas.set(midX - 1, y, midZ, 'spruce_stairs[facing=east,half=bottom]');
        }
        if (isFree(midX + 1, midZ)) {
          this.canvas.set(midX + 1, y, midZ, 'spruce_stairs[facing=west,half=bottom]');
        }
        if (isFree(minX, minZ)) {
          this.canvas.set(minX, y, minZ, 'chest');
        }
        if (isFree(maxX, minZ)) {
          this.canvas.set(maxX, y, minZ, 'crafting_table');
        }
        break;
      }
    }
  }
}
