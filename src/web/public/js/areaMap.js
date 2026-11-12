/**
 * Architect Mission Control — 2D Area Map Submodule
 * Renders topographic 2D terrain mapping with relief shading, contour lines,
 * bot coordinates, selection bounding boxes, and clamped facade direction indicators.
 */

/**
 * Draws the 2D area map on the canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {CanvasRenderingContext2D} ctx
 * @param {Object} areaMapData
 * @param {Object|null} mapSelection - { x1, z1, x2, z2 }
 * @param {string} buildBoxFacing - 'north' | 'south' | 'west' | 'east'
 * @param {Object|null} activeWaypoint - { col, row, x, z }
 */
export function drawAreaMap(canvas, ctx, areaMapData, mapSelection = null, buildBoxFacing = 'north', activeWaypoint = null) {
  if (!ctx || !canvas || !areaMapData) return;

  const mapNotice = document.getElementById('mapSimulatedNotice');
  if (mapNotice) {
    if (areaMapData.isSimulated) {
      mapNotice.classList.remove('hidden');
    } else {
      mapNotice.classList.add('hidden');
    }
  }

  const grid = areaMapData.grid || [];
  const dim = 64;
  const tileSize = canvas.width / dim;
  const centerY = areaMapData.center?.y ?? 64;

  ctx.fillStyle = '#070b10';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < grid.length; i++) {
    const cell = grid[i];
    const col = (cell.x - areaMapData.center.x + 32);
    const row = (cell.z - areaMapData.center.z + 32);

    let color = '#388e3c'; // grass default
    const bName = (cell.blockName || '').toLowerCase();
    if (bName.includes('water')) {
      color = '#1976d2';
    } else if (bName.includes('wall') || bName.includes('fence')) {
      color = '#616161';
    } else if (bName.includes('brick')) {
      color = '#757575';
    } else if (bName.includes('stone') || bName.includes('deepslate') || bName.includes('cobble')) {
      color = '#78909c';
    } else if (bName.includes('wood') || bName.includes('log') || bName.includes('plank') || bName.includes('dirt')) {
      color = '#8d6e63';
    } else if (bName.includes('sand')) {
      color = '#d9c999';
    }

    ctx.fillStyle = color;
    ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);

    // Topographic Höhenlinien / Contour lines & Elevation shading
    const yDiff = (typeof cell.y === 'number') ? (cell.y - centerY) : 0;
    if (yDiff !== 0) {
      const tintAlpha = Math.min(0.25, Math.abs(yDiff) * 0.03);
      ctx.fillStyle = yDiff > 0 ? `rgba(255, 255, 255, ${tintAlpha})` : `rgba(0, 0, 0, ${tintAlpha})`;
      ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
    }

    // Höhenlinien (contour steps every 4 blocks)
    if (typeof cell.y === 'number' && Math.abs(cell.y) % 4 === 0) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.fillRect(col * tileSize, row * tileSize, tileSize, 1);
    }
  }

  // Draw Bot Position (center)
  const bCol = 32 * tileSize;
  const bRow = 32 * tileSize;
  ctx.fillStyle = '#f43f5e';
  ctx.beginPath();
  ctx.arc(bCol + tileSize / 2, bRow + tileSize / 2, tileSize * 1.2, 0, Math.PI * 2);
  ctx.fill();

  // Draw Active Target Waypoint if set
  if (activeWaypoint && typeof activeWaypoint.col === 'number') {
    const wx = activeWaypoint.col * tileSize + tileSize / 2;
    const wy = activeWaypoint.row * tileSize + tileSize / 2;

    // Dashed path from bot to target waypoint
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(bCol + tileSize / 2, bRow + tileSize / 2);
    ctx.lineTo(wx, wy);
    ctx.stroke();
    ctx.restore();

    // Glowing target marker
    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.fillStyle = 'rgba(0, 229, 255, 0.25)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(wx, wy, tileSize * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Center crosshairs
    ctx.beginPath();
    ctx.moveTo(wx - tileSize * 1.8, wy);
    ctx.lineTo(wx + tileSize * 1.8, wy);
    ctx.moveTo(wx, wy - tileSize * 1.8);
    ctx.lineTo(wx, wy + tileSize * 1.8);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  // Draw Selection Box on Map if present
  if (mapSelection) {
    const minCol = Math.min(mapSelection.x1, mapSelection.x2);
    const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
    const minRow = Math.min(mapSelection.z1, mapSelection.z2);
    const maxRow = Math.max(mapSelection.z1, mapSelection.z2);

    const x = minCol * tileSize;
    const y = minRow * tileSize;
    const w = (maxCol - minCol + 1) * tileSize;
    const h = (maxRow - minRow + 1) * tileSize;

    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(0, 229, 255, 0.2)';
    ctx.fillRect(x, y, w, h);

    // Facade Edge Highlight
    ctx.save();
    ctx.strokeStyle = '#ffea00';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (buildBoxFacing === 'north') {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y);
    } else if (buildBoxFacing === 'south') {
      ctx.moveTo(x, y + h);
      ctx.lineTo(x + w, y + h);
    } else if (buildBoxFacing === 'west') {
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + h);
    } else if (buildBoxFacing === 'east') {
      ctx.moveTo(x + w, y);
      ctx.lineTo(x + w, y + h);
    }
    ctx.stroke();
    ctx.restore();

    // Direction Arrow indicating Facade / Entrance Door with edge clamping
    ctx.save();
    ctx.fillStyle = '#ffea00';
    ctx.strokeStyle = '#0a0e14';
    ctx.lineWidth = 1.5;

    const arrowLen = Math.max(12, Math.min(22, tileSize * 2));
    const arrowHalf = arrowLen * 0.55;

    ctx.beginPath();
    if (buildBoxFacing === 'north') {
      const cx = Math.max(arrowHalf + 2, Math.min(canvas.width - arrowHalf - 2, x + w / 2));
      const cy = y;
      const shiftY = Math.max(0, 4 - (cy - arrowLen));
      const ay = cy + shiftY;
      ctx.moveTo(cx, ay - arrowLen);
      ctx.lineTo(cx + arrowHalf, ay + 1);
      ctx.lineTo(cx + arrowHalf * 0.35, ay + 1);
      ctx.lineTo(cx + arrowHalf * 0.35, ay + arrowLen * 0.6);
      ctx.lineTo(cx - arrowHalf * 0.35, ay + arrowLen * 0.6);
      ctx.lineTo(cx - arrowHalf * 0.35, ay + 1);
      ctx.lineTo(cx - arrowHalf, ay + 1);
    } else if (buildBoxFacing === 'south') {
      const cx = Math.max(arrowHalf + 2, Math.min(canvas.width - arrowHalf - 2, x + w / 2));
      const cy = y + h;
      const shiftY = Math.min(0, (canvas.height - 4) - (cy + arrowLen));
      const ay = cy + shiftY;
      ctx.moveTo(cx, ay + arrowLen);
      ctx.lineTo(cx + arrowHalf, ay - 1);
      ctx.lineTo(cx + arrowHalf * 0.35, ay - 1);
      ctx.lineTo(cx + arrowHalf * 0.35, ay - arrowLen * 0.6);
      ctx.lineTo(cx - arrowHalf * 0.35, ay - arrowLen * 0.6);
      ctx.lineTo(cx - arrowHalf * 0.35, ay - 1);
      ctx.lineTo(cx - arrowHalf, ay - 1);
    } else if (buildBoxFacing === 'west') {
      const cx = x;
      const cy = Math.max(arrowHalf + 2, Math.min(canvas.height - arrowHalf - 2, y + h / 2));
      const shiftX = Math.max(0, 4 - (cx - arrowLen));
      const ax = cx + shiftX;
      ctx.moveTo(ax - arrowLen, cy);
      ctx.lineTo(ax + 1, cy - arrowHalf);
      ctx.lineTo(ax + 1, cy - arrowHalf * 0.35);
      ctx.lineTo(ax + arrowLen * 0.6, cy - arrowHalf * 0.35);
      ctx.lineTo(ax + arrowLen * 0.6, cy + arrowHalf * 0.35);
      ctx.lineTo(ax + 1, cy + arrowHalf * 0.35);
      ctx.lineTo(ax + 1, cy + arrowHalf);
    } else if (buildBoxFacing === 'east') {
      const cx = x + w;
      const cy = Math.max(arrowHalf + 2, Math.min(canvas.height - arrowHalf - 2, y + h / 2));
      const shiftX = Math.min(0, (canvas.width - 4) - (cx + arrowLen));
      const ax = cx + shiftX;
      ctx.moveTo(ax + arrowLen, cy);
      ctx.lineTo(ax - 1, cy - arrowHalf);
      ctx.lineTo(ax - 1, cy - arrowHalf * 0.35);
      ctx.lineTo(ax - arrowLen * 0.6, cy - arrowHalf * 0.35);
      ctx.lineTo(ax - arrowLen * 0.6, cy + arrowHalf * 0.35);
      ctx.lineTo(ax - 1, cy + arrowHalf * 0.35);
      ctx.lineTo(ax - 1, cy + arrowHalf);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/**
 * Converts screen client coordinates to 64x64 grid coordinates.
 * @param {HTMLCanvasElement} canvas
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ col: number, row: number }}
 */
export function screenToGridCoords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const col = Math.max(0, Math.min(63, Math.floor(((clientX - rect.left) / Math.max(1, rect.width)) * 64)));
  const row = Math.max(0, Math.min(63, Math.floor(((clientY - rect.top) / Math.max(1, rect.height)) * 64)));
  return { col, row };
}

/**
 * Finds cell at world coordinates from areaMapData.
 * @param {Object} areaMapData
 * @param {number} worldX
 * @param {number} worldZ
 * @returns {Object|null}
 */
export function findCellAt(areaMapData, worldX, worldZ) {
  if (!areaMapData || !areaMapData.grid) return null;
  const col = worldX - areaMapData.center.x + 32;
  const row = worldZ - areaMapData.center.z + 32;
  const candidate = areaMapData.grid[col * 64 + row];
  if (candidate && candidate.x === worldX && candidate.z === worldZ) {
    return candidate;
  }
  return areaMapData.grid.find(c => c.x === worldX && c.z === worldZ) || null;
}
