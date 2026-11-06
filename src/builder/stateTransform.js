/**
 * Exakte Block-State-Mathematik & Auto-Stair-Stitching
 * Rotiert Koordinaten und Block-Eigenschaften um 0°, 90°, 180°, 270° und passt Treppenecken an.
 */

export const CARDINAL_DIRECTIONS = ['north', 'east', 'south', 'west'];

export const DIRECTION_VECTORS = {
  north: { x: 0, z: -1 },
  east: { x: 1, z: 0 },
  south: { x: 0, z: 1 },
  west: { x: -1, z: 0 }
};

export function getFacingTheta(facing) {
  switch (facing) {
    case 'east': return 1;
    case 'south': return 2;
    case 'west': return 3;
    case 'north':
    default:
      return 0;
  }
}

export function rotateFacing(facing, theta) {
  if (!CARDINAL_DIRECTIONS.includes(facing)) {
    return facing; // 'up', 'down' etc. bleiben unverändert
  }
  const idx = CARDINAL_DIRECTIONS.indexOf(facing);
  const newIdx = (idx + (theta % 4) + 4) % 4;
  return CARDINAL_DIRECTIONS[newIdx];
}

export function rotateAxis(axis, theta) {
  if (axis === 'y') return 'y';
  const effectiveTheta = ((theta % 4) + 4) % 4;
  if (effectiveTheta % 2 !== 0) {
    return axis === 'x' ? 'z' : (axis === 'z' ? 'x' : axis);
  }
  return axis;
}

export function rotateProperties(properties = {}, theta) {
  const effectiveTheta = ((theta % 4) + 4) % 4;
  if (effectiveTheta === 0) return { ...properties };

  const rotated = { ...properties };

  // 1. Facing-Rotation
  if (rotated.facing) {
    rotated.facing = rotateFacing(rotated.facing, effectiveTheta);
  }

  // 2. Axis-Rotation
  if (rotated.axis) {
    rotated.axis = rotateAxis(rotated.axis, effectiveTheta);
  }

  // 3. Rotationsindex für Schilder/Banner/Köpfe (0..15)
  if (rotated.rotation !== undefined) {
    const rotInt = parseInt(rotated.rotation, 10);
    if (!Number.isNaN(rotInt)) {
      rotated.rotation = String((rotInt + effectiveTheta * 4) % 16);
    }
  }

  // 4. Verbindungseigenschaften für Zäune, Mauern, Scheiben, Ranken
  const hasFenceProps = ['north', 'east', 'south', 'west'].some(dir => dir in rotated);
  if (hasFenceProps) {
    const original = {
      north: rotated.north,
      east: rotated.east,
      south: rotated.south,
      west: rotated.west
    };
    delete rotated.north;
    delete rotated.east;
    delete rotated.south;
    delete rotated.west;
    for (let i = 0; i < 4; i++) {
      const origDir = CARDINAL_DIRECTIONS[i];
      const targetDir = CARDINAL_DIRECTIONS[(i + effectiveTheta) % 4];
      if (original[origDir] !== undefined) {
        rotated[targetDir] = original[origDir];
      }
    }
  }

  return rotated;
}

export function mirrorFacing(facing, axis) {
  if (axis === 'x') {
    if (facing === 'east') return 'west';
    if (facing === 'west') return 'east';
    return facing;
  } else if (axis === 'z') {
    if (facing === 'north') return 'south';
    if (facing === 'south') return 'north';
    return facing;
  }
  return facing;
}

export function mirrorProperties(properties = {}, axis = 'x') {
  const mirrored = { ...properties };
  if (mirrored.facing) {
    mirrored.facing = mirrorFacing(mirrored.facing, axis);
  }
  if (mirrored.hinge) {
    mirrored.hinge = mirrored.hinge === 'left' ? 'right' : 'left';
  }
  if (mirrored.type === 'left') {
    mirrored.type = 'right';
  } else if (mirrored.type === 'right') {
    mirrored.type = 'left';
  }
  if (mirrored.shape) {
    if (mirrored.shape === 'inner_left') mirrored.shape = 'inner_right';
    else if (mirrored.shape === 'inner_right') mirrored.shape = 'inner_left';
    else if (mirrored.shape === 'outer_left') mirrored.shape = 'outer_right';
    else if (mirrored.shape === 'outer_right') mirrored.shape = 'outer_left';
  }
  if (axis === 'x') {
    const tempEast = mirrored.east;
    const tempWest = mirrored.west;
    if (tempWest !== undefined) mirrored.east = tempWest; else delete mirrored.east;
    if (tempEast !== undefined) mirrored.west = tempEast; else delete mirrored.west;
  } else if (axis === 'z') {
    const tempNorth = mirrored.north;
    const tempSouth = mirrored.south;
    if (tempSouth !== undefined) mirrored.north = tempSouth; else delete mirrored.north;
    if (tempNorth !== undefined) mirrored.south = tempNorth; else delete mirrored.south;
  }
  if (mirrored.rotation !== undefined) {
    const rot = parseInt(mirrored.rotation, 10);
    if (!Number.isNaN(rot)) {
      if (axis === 'x') {
        mirrored.rotation = String((16 - rot) % 16);
      } else if (axis === 'z') {
        mirrored.rotation = String((24 - rot) % 16);
      }
    }
  }
  return mirrored;
}

/**
 * Rotiert lokale Koordinaten (x, y, z) und den BlockState in die Ziel-Ausrichtung.
 */
export function rotateLocalToWorld(x, y, z, blockStateObj, width, depth, buildFacing = 'north') {
  const theta = getFacingTheta(buildFacing);

  let wx = x;
  let wz = z;
  const wy = y;

  switch (theta) {
    case 0: // north (standard)
      wx = x;
      wz = z;
      break;
    case 1: // east (90° clockwise)
      wx = depth - 1 - z;
      wz = x;
      break;
    case 2: // south (180°)
      wx = width - 1 - x;
      wz = depth - 1 - z;
      break;
    case 3: // west (270° clockwise)
      wx = z;
      wz = width - 1 - x;
      break;
  }

  const newProps = rotateProperties(blockStateObj.properties || {}, theta);

  return {
    x: wx,
    y: wy,
    z: wz,
    blockState: {
      name: blockStateObj.name,
      properties: newProps
    }
  };
}

/**
 * Automatisches Treppen-Eck-Stitching (Hip Roofs, Gesimse, Innenkanten)
 */
export function autoStitchStairs(canvas) {
  const keys = canvas.getAllBlockKeys();

  for (const key of keys) {
    const block = canvas.getByKey(key);
    if (!block || !block.name || !block.name.endsWith('_stairs')) {
      continue;
    }

    const props = block.properties || {};
    // Nur anpassen, wenn shape noch 'straight' ist oder nicht explizit gesetzt wurde
    if (props.shape && props.shape !== 'straight') {
      continue;
    }

    const facing = props.facing || 'north';
    const half = props.half || 'bottom';
    const { x, y, z } = canvas.parseKey(key);

    const fVec = DIRECTION_VECTORS[facing] || { x: 0, z: -1 };
    const facingIdx = CARDINAL_DIRECTIONS.indexOf(facing);
    const leftFacing = CARDINAL_DIRECTIONS[(facingIdx + 3) % 4];
    const rightFacing = CARDINAL_DIRECTIONS[(facingIdx + 1) % 4];

    // Prüfe Block hinter der Treppe (entlang facing)
    const behindBlock = canvas.get(x + fVec.x, y, z + fVec.z);
    if (behindBlock && behindBlock.name && behindBlock.name.endsWith('_stairs')) {
      const bProps = behindBlock.properties || {};
      const bHalf = bProps.half || 'bottom';
      if (bHalf === half) {
        if (bProps.facing === leftFacing) {
          props.shape = 'outer_left';
          block.properties = props;
          continue;
        } else if (bProps.facing === rightFacing) {
          props.shape = 'outer_right';
          block.properties = props;
          continue;
        }
      }
    }

    // Prüfe Block vor der Treppe (entgegengesetzt facing)
    const frontBlock = canvas.get(x - fVec.x, y, z - fVec.z);
    if (frontBlock && frontBlock.name && frontBlock.name.endsWith('_stairs')) {
      const frProps = frontBlock.properties || {};
      const frHalf = frProps.half || 'bottom';
      if (frHalf === half) {
        if (frProps.facing === leftFacing) {
          props.shape = 'inner_left';
          block.properties = props;
        } else if (frProps.facing === rightFacing) {
          props.shape = 'inner_right';
          block.properties = props;
        }
      }
    }
  }
}
