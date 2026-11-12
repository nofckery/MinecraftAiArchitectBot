import { rotateLocalToWorld } from '../../../builder/stateTransform.js';

/**
 * Litematica-Style Verifier & Auto-Terraforming Analyzer:
 * Checks all placed scene objects against the scanned 3D terrain relief and against each other.
 *
 * Categories:
 * - collisions (Red): Building block overlaps an existing terrain/tree block
 * - foundationGaps (Yellow): Air gap under the bottom layer of a building down to terrain surface
 * - solidSupports (Green): Bottom layer rests directly on solid terrain (y - 1 === surfaceY)
 * - obstaclesToClear (Pink): Existing world blocks inside the building footprint that Auto-Terraforming removes
 */
export function analyzeSceneVerifier(terrainData, sceneObjects = []) {
  const heightMap = terrainData?.heightMap || {};
  const terrainSet = new Map();
  if (Array.isArray(terrainData?.terrainBlocks)) {
    for (const tb of terrainData.terrainBlocks) {
      terrainSet.set(`${tb.x},${tb.y},${tb.z}`, tb.name);
    }
  }

  const verifierBlocks = [];
  const objectReports = {};
  const occupiedByObjects = new Map(); // "wx,wy,wz" -> objectId

  let totalCollisions = 0;
  let totalFoundationGaps = 0;
  let totalSolidSupports = 0;
  let totalObstaclesToClear = 0;

  for (const obj of sceneObjects) {
    if (!obj || obj.visible === false) continue;
    const blocks = Array.isArray(obj.blocks) ? obj.blocks : [];
    const pos = obj.position || { x: 0, y: 64, z: 0 };
    const facing = obj.facing || 'north';
    const width = obj.bounds?.width || obj.width || 16;
    const depth = obj.bounds?.depth || obj.depth || 16;

    let objCollisions = 0;
    let objFoundationGaps = 0;
    let objSolidSupports = 0;
    let objObstacles = 0;
    const foundationPillars = [];
    const clearPositions = [];

    // Find lowest local Y per (worldX, worldZ) column in this object
    const columnMinY = new Map();
    const columnMaxY = new Map();
    const objWorldBlockMap = new Map();

    for (const b of blocks) {
      if (!b) continue;
      const bName = b.name || b.block;
      if (!bName || bName === 'air') continue;
      const rot = rotateLocalToWorld(b.x, b.y, b.z, { name: bName, properties: b.properties || {} }, width, depth, facing);
      const wx = Math.floor(pos.x + rot.x);
      const wy = Math.floor(pos.y + rot.y);
      const wz = Math.floor(pos.z + rot.z);
      const wKey = `${wx},${wy},${wz}`;
      const colKey = `${wx},${wz}`;

      objWorldBlockMap.set(wKey, { wx, wy, wz, name: bName });

      const curMin = columnMinY.get(colKey);
      if (curMin === undefined || wy < curMin) columnMinY.set(colKey, wy);
      const curMax = columnMaxY.get(colKey);
      if (curMax === undefined || wy > curMax) columnMaxY.set(colKey, wy);

      // Check collision with terrain or another building
      const existingTerrain = terrainSet.get(wKey);
      const surfaceY = heightMap[colKey];
      const collidesWithTerrain = Boolean(existingTerrain || (surfaceY !== undefined && wy <= surfaceY));
      const collidesWithOtherObj = occupiedByObjects.has(wKey) && occupiedByObjects.get(wKey) !== obj.id;

      if (collidesWithTerrain || collidesWithOtherObj) {
        objCollisions++;
        totalCollisions++;
        verifierBlocks.push({
          x: wx,
          y: wy,
          z: wz,
          status: 'collision', // RED
          objectId: obj.id,
          blockName: b.name,
          existingBlock: existingTerrain || 'terrain'
        });
      }

      occupiedByObjects.set(wKey, obj.id);
    }

    // Check foundation & interior obstacles per column
    for (const [colKey, minWy] of columnMinY.entries()) {
      const [wxStr, wzStr] = colKey.split(',');
      const wx = parseInt(wxStr, 10);
      const wz = parseInt(wzStr, 10);
      const maxWy = columnMaxY.get(colKey) ?? minWy;
      const surfaceY = heightMap[colKey];

      if (surfaceY !== undefined) {
        if (minWy - 1 === surfaceY) {
          objSolidSupports++;
          totalSolidSupports++;
          verifierBlocks.push({
            x: wx,
            y: surfaceY,
            z: wz,
            status: 'solid_support', // GREEN
            objectId: obj.id
          });
        } else if (minWy - 1 > surfaceY) {
          // Floating gap below building!
          for (let fy = surfaceY + 1; fy < minWy; fy++) {
            objFoundationGaps++;
            totalFoundationGaps++;
            const pillarBlock = obj.foundationMaterial || 'cobblestone';
            foundationPillars.push({ x: wx, y: fy, z: wz, name: pillarBlock });
            verifierBlocks.push({
              x: wx,
              y: fy,
              z: wz,
              status: 'foundation_gap', // YELLOW
              objectId: obj.id,
              suggestedBlock: pillarBlock
            });
          }
        }

        // Obstacles inside building footprint above minWy that need clearing
        if (surfaceY >= minWy) {
          for (let cy = minWy; cy <= Math.max(surfaceY, maxWy); cy++) {
            const wKey = `${wx},${cy},${wz}`;
            if (cy <= surfaceY || terrainSet.has(wKey)) {
              clearPositions.push({ x: wx, y: cy, z: wz });
              if (!objWorldBlockMap.has(wKey)) {
                objObstacles++;
                totalObstaclesToClear++;
                verifierBlocks.push({
                  x: wx,
                  y: cy,
                  z: wz,
                  status: 'obstacle_air', // PINK (Extra block where air should be)
                  objectId: obj.id
                });
              }
            }
          }
        }
      }
    }

    objectReports[obj.id] = {
      objectId: obj.id,
      name: obj.name,
      collisions: objCollisions,
      foundationGaps: objFoundationGaps,
      solidSupports: objSolidSupports,
      obstaclesToClear: objObstacles,
      foundationPillars,
      clearPositions
    };
  }

  const allFoundationPillars = Object.values(objectReports).flatMap(r => r.foundationPillars || []);

  return {
    verifierBlocks,
    foundationPillars: allFoundationPillars,
    objectReports,
    summary: {
      totalCollisions,
      totalFoundationGaps,
      totalSolidSupports,
      totalObstaclesToClear,
      collisionCount: totalCollisions,
      foundationGapCount: totalFoundationGaps,
      solidSupportCount: totalSolidSupports,
      obstacleCount: totalObstaclesToClear
    }
  };
}
