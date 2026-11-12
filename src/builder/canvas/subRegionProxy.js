/**
 * Erstellt einen Proxy für eine VoxelCanvas, der Schreiboperationen auf eine Bounding-Box begrenzt.
 */
export function createSubRegionProxy(targetCanvas, selectionBox) {
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
          const subCanvas = new target.constructor(maxX - minX + 1, maxY - minY + 1, maxZ - minZ + 1);
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
