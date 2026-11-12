import { rotateProperties, mirrorProperties, autoStitchStairs, rotateFacing } from '../stateTransform.js';

/**
 * Rotiert, spiegelt oder transformiert Blöcke innerhalb einer Canvas.
 */
export function applySymmetryOrTransform(canvas, mode) {
  const bounds = canvas.getBounds();
  if (bounds.count === 0) return;

  const newBlocks = new Map();

  for (const [key, block] of canvas.blocks.entries()) {
    const { x, y, z } = canvas.parseKey(key);
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

    const newKey = canvas.makeKey(newX, newY, newZ);
    newBlocks.set(newKey, {
      name: block.name,
      properties: newProps
    });
  }

  canvas.blocks = newBlocks;

  if (mode === 'rotate_90_cw') {
    const tempW = canvas.width;
    canvas.width = canvas.depth;
    canvas.depth = tempW;
    if (typeof rotateFacing === 'function') {
      canvas.facing = rotateFacing(canvas.facing || 'north', 1);
    }
  }

  const newBounds = canvas.getBounds();
  if (newBounds.count > 0) {
    canvas.width = Math.max(canvas.width, newBounds.width);
    canvas.height = Math.max(canvas.height, newBounds.height);
    canvas.depth = Math.max(canvas.depth, newBounds.depth);
  }

  autoStitchStairs(canvas);
}
