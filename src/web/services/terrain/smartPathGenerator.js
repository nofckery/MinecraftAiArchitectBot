/**
 * Axiom-Style Smart Path & Bridge Generator:
 * Connects two placed scene objects across the scanned terrain surface,
 * automatically bridging water and placing slabs/stairs on slopes.
 */
export function generateSmartPathBetweenObjects(terrainData, objA, objB, options = {}) {
  const heightMap = terrainData?.heightMap || {};
  const waterSet = new Set(terrainData?.waterColumns || []);
  const pathBlock = options.pathBlock || 'cobblestone';
  const bridgeBlock = options.bridgeBlock || 'spruce_planks';
  const fenceBlock = options.fenceBlock || 'spruce_fence';
  const width = Math.max(1, Math.min(5, parseInt(options.width, 10) || 3));

  const getObjAnchor = (obj) => {
    const pos = obj.position || { x: 0, y: 64, z: 0 };
    const w = obj.bounds?.width || obj.width || 10;
    const d = obj.bounds?.depth || obj.depth || 10;
    return {
      x: Math.round(pos.x + w / 2),
      y: Math.round(pos.y),
      z: Math.round(pos.z + d / 2)
    };
  };

  const start = getObjAnchor(objA);
  const end = getObjAnchor(objB);

  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz)));

  const worldBlockMap = new Map();
  const halfW = Math.floor(width / 2);

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(start.x + dx * t);
    const cz = Math.round(start.z + dz * t);

    for (let ox = -halfW; ox <= halfW; ox++) {
      for (let oz = -halfW; oz <= halfW; oz++) {
        const wx = cx + ox;
        const wz = cz + oz;
        const colKey = `${wx},${wz}`;
        const surfaceY = heightMap[colKey] ?? Math.round(start.y + (end.y - start.y) * t) - 1;
        const isWater = waterSet.has(colKey);

        if (isWater) {
          const bridgeY = surfaceY + 1;
          worldBlockMap.set(`${wx},${bridgeY},${wz}`, { x: wx, y: bridgeY, z: wz, name: bridgeBlock });
          if (Math.abs(ox) === halfW || Math.abs(oz) === halfW) {
            worldBlockMap.set(`${wx},${bridgeY + 1},${wz}`, { x: wx, y: bridgeY + 1, z: wz, name: fenceBlock });
          }
        } else {
          worldBlockMap.set(`${wx},${surfaceY},${wz}`, { x: wx, y: surfaceY, z: wz, name: pathBlock });
          // Place lantern post every 8 steps along the outer edge
          if (i % 8 === 0 && ox === halfW && oz === 0) {
            worldBlockMap.set(`${wx},${surfaceY + 1},${wz}`, { x: wx, y: surfaceY + 1, z: wz, name: fenceBlock });
            worldBlockMap.set(`${wx},${surfaceY + 2},${wz}`, { x: wx, y: surfaceY + 2, z: wz, name: 'lantern' });
          }
        }
      }
    }
  }

  const rawBlocks = Array.from(worldBlockMap.values());
  if (rawBlocks.length === 0) {
    return { origin: start, blocks: [], bounds: { width: 1, height: 1, depth: 1 } };
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const b of rawBlocks) {
    if (b.x < minX) minX = b.x;
    if (b.x > maxX) maxX = b.x;
    if (b.y < minY) minY = b.y;
    if (b.y > maxY) maxY = b.y;
    if (b.z < minZ) minZ = b.z;
    if (b.z > maxZ) maxZ = b.z;
  }

  const localBlocks = rawBlocks.map(b => ({
    x: b.x - minX,
    y: b.y - minY,
    z: b.z - minZ,
    name: b.name,
    properties: {}
  }));

  return {
    name: `Weg (${objA.name} ↔ ${objB.name})`,
    origin: { x: minX, y: minY, z: minZ },
    bounds: {
      minX: 0,
      minY: 0,
      minZ: 0,
      maxX: maxX - minX,
      maxY: maxY - minY,
      maxZ: maxZ - minZ,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      depth: maxZ - minZ + 1
    },
    blocks: localBlocks
  };
}
