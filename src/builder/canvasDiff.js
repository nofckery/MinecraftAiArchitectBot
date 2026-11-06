/**
 * Inkrementelle Diff-Engine
 * Vergleicht zwei VoxelCanvas-Zustände und ermittelt die minimale
 * Menge an set/remove Operationen für inkrementelles Bauen.
 */

import { toBlockString } from './greedyMesher.js';

export function computeDiff(previousCanvas, newCanvas) {
  const diff = [];
  const prevKeys = new Set(previousCanvas ? previousCanvas.getAllBlockKeys() : []);
  const newKeys = new Set(newCanvas ? newCanvas.getAllBlockKeys() : []);

  // Blöcke, die im neuen Canvas existieren oder verändert wurden
  for (const key of newKeys) {
    const newBlock = newCanvas.getByKey(key);
    const prevBlock = previousCanvas ? previousCanvas.getByKey(key) : null;
    const newStr = toBlockString(newBlock);
    const prevStr = toBlockString(prevBlock);

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
