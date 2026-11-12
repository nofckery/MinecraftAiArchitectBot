import { resolveBlockTextureInfo } from './blockResolver.js';

/**
 * Calculates instance matrix scaling and positioning deltas for non-cube blocks in InstancedMesh.
 * @param {object} block - Block with { x, y, z, name, properties }
 * @param {object} info - Texture & geometry metadata from resolveBlockTextureInfo
 * @returns {Array<{ px: number, py: number, pz: number, sx: number, sy: number, sz: number }>}
 */
export function getBlockInstanceTransforms(block, info) {
  const { x, y, z, name } = block;
  const props = block.properties || {};
  const transforms = [];

  // 1. Treppen (2 Instanz-Quader: Basis + Stufe)
  if (info.type === 'stairs') {
    const isTopHalf = props.half === 'top';
    const facing = props.facing || 'north';
    // Basisstufe
    transforms.push({
      px: x + 0.5,
      py: isTopHalf ? y + 0.75 : y + 0.25,
      pz: z + 0.5,
      sx: 1.0, sy: 0.5, sz: 1.0
    });
    // Trittstufe
    let sx = 1.0, sz = 1.0, ox = 0, oz = 0;
    if (facing === 'north' || facing === 'south') {
      sz = 0.5;
      oz = (facing === 'north') ? -0.25 : 0.25;
    } else {
      sx = 0.5;
      ox = (facing === 'west') ? -0.25 : 0.25;
    }
    transforms.push({
      px: x + 0.5 + ox,
      py: isTopHalf ? y + 0.25 : y + 0.75,
      pz: z + 0.5 + oz,
      sx, sy: 0.5, sz
    });
    return transforms;
  }

  // 2. Stufen (Slab)
  if (info.type === 'slab') {
    const isTop = props.type === 'top' || props.half === 'top';
    const isDouble = props.type === 'double';
    transforms.push({
      px: x + 0.5,
      py: isDouble ? y + 0.5 : (isTop ? y + 0.75 : y + 0.25),
      pz: z + 0.5,
      sx: 1.0, sy: isDouble ? 1.0 : 0.5, sz: 1.0
    });
    return transforms;
  }

  // 3. Mauern (Wall)
  if (info.type === 'wall') {
    transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 0.5, sy: 1.0, sz: 0.5 });
    return transforms;
  }

  // 4. Zäune (Fence)
  if (info.type === 'fence') {
    transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 0.25, sy: 1.0, sz: 0.25 });
    return transforms;
  }

  // 5. Zauntore (Fence Gate)
  if (info.type === 'fence_gate') {
    transforms.push({ px: x + 0.5, py: y + 0.4, pz: z + 0.5, sx: 0.25, sy: 0.8, sz: 1.0 });
    return transforms;
  }

  // 6. Kisten (Chest)
  if (info.type === 'chest') {
    transforms.push({ px: x + 0.5, py: y + 0.4375, pz: z + 0.5, sx: 0.875, sy: 0.875, sz: 0.875 });
    return transforms;
  }

  // 7. Knöpfe (Button)
  if (info.type === 'button') {
    const face = props.face || 'wall';
    const facing = props.facing || 'north';
    let sx = 0.35, sy = 0.25, sz = 0.125, ox = 0, oy = 0, oz = 0;
    if (face === 'floor') {
      sy = 0.125; sz = 0.25; oy = -0.4375;
    } else if (face === 'ceiling') {
      sy = 0.125; sz = 0.25; oy = 0.4375;
    } else {
      if (facing === 'north' || facing === 'south') {
        oz = (facing === 'north') ? 0.4375 : -0.4375;
      } else {
        sx = 0.125; sz = 0.35; ox = (facing === 'west') ? 0.4375 : -0.4375;
      }
    }
    transforms.push({ px: x + 0.5 + ox, py: y + 0.5 + oy, pz: z + 0.5 + oz, sx, sy, sz });
    return transforms;
  }

  // 8. Fackeln (Torch)
  if (info.type === 'torch') {
    const facing = props.facing || 'north';
    let ox = 0, oz = 0, oy = 0.3125;
    if ((name || '').includes('wall')) {
      if (facing === 'north') oz = 0.35;
      else if (facing === 'south') oz = -0.35;
      else if (facing === 'west') ox = 0.35;
      else if (facing === 'east') ox = -0.35;
      oy = 0.4;
    }
    transforms.push({ px: x + 0.5 + ox, py: y + oy, pz: z + 0.5 + oz, sx: 0.125, sy: 0.625, sz: 0.125 });
    return transforms;
  }

  // 9. Blumentöpfe (Pot)
  if (info.type === 'pot') {
    transforms.push({ px: x + 0.5, py: y + 0.1875, pz: z + 0.5, sx: 0.375, sy: 0.375, sz: 0.375 });
    return transforms;
  }

  // 10. Leitern (Ladder)
  if (info.type === 'ladder') {
    const facing = props.facing || 'north';
    let sx = 0.95, sz = 0.05, ox = 0, oz = 0;
    if (facing === 'north' || facing === 'south') {
      oz = (facing === 'north') ? 0.475 : -0.475;
    } else {
      sx = 0.05; sz = 0.95; ox = (facing === 'west') ? 0.475 : -0.475;
    }
    transforms.push({ px: x + 0.5 + ox, py: y + 0.5, pz: z + 0.5 + oz, sx, sy: 0.95, sz });
    return transforms;
  }

  // 11. Ketten (Chain)
  if (info.type === 'chain') {
    transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 0.1875, sy: 1.0, sz: 0.1875 });
    return transforms;
  }

  // 12. Teppiche (Carpet)
  if (info.type === 'carpet') {
    transforms.push({ px: x + 0.5, py: y + 0.03125, pz: z + 0.5, sx: 1.0, sy: 0.0625, sz: 1.0 });
    return transforms;
  }

  // 13. Betten (Bed)
  if (info.type === 'bed') {
    transforms.push({ px: x + 0.5, py: y + 0.28125, pz: z + 0.5, sx: 1.0, sy: 0.5625, sz: 1.0 });
    return transforms;
  }

  // 14. Falltüren (Trapdoor)
  if (info.type === 'trapdoor') {
    const isOpen = props.open === 'true' || props.open === true;
    const isTop = props.half === 'top';
    let sy = 0.1875, oy = isTop ? 0.40625 : -0.40625, sz = 1.0;
    if (isOpen) { sy = 1.0; oy = 0; sz = 0.1875; }
    transforms.push({ px: x + 0.5, py: y + 0.5 + oy, pz: z + 0.5, sx: 1.0, sy, sz });
    return transforms;
  }

  // 15. Türen (Door)
  if (info.type === 'door') {
    transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 1.0, sy: 1.0, sz: 0.1875 });
    return transforms;
  }

  // 16. Laternen (Lantern)
  if (info.type === 'lantern') {
    transforms.push({ px: x + 0.5, py: y + 0.28125, pz: z + 0.5, sx: 0.375, sy: 0.5625, sz: 0.375 });
    return transforms;
  }

  // 17. Schilder (Sign)
  if (info.type === 'sign') {
    transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 0.875, sy: 0.5, sz: 0.0625 });
    return transforms;
  }

  // 18. Lagerfeuer (Campfire)
  if (info.type === 'campfire') {
    transforms.push({ px: x + 0.5, py: y + 0.225, pz: z + 0.5, sx: 1.0, sy: 0.45, sz: 1.0 });
    return transforms;
  }

  // 19. Köpfe (Head)
  if (info.type === 'head') {
    transforms.push({ px: x + 0.5, py: y + 0.25, pz: z + 0.5, sx: 0.5, sy: 0.5, sz: 0.5 });
    return transforms;
  }

  // 20. Reben & Kletterpflanzen (Vine)
  if (info.type === 'vine') {
    const hasNorth = props.north === 'true' || props.north === true;
    const hasSouth = props.south === 'true' || props.south === true;
    const hasEast = props.east === 'true' || props.east === true;
    const hasWest = props.west === 'true' || props.west === true;
    const hasUp = props.up === 'true' || props.up === true;

    let attached = false;
    const thickness = 0.05;
    if (hasNorth) {
      transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + thickness / 2, sx: 1.0, sy: 1.0, sz: thickness });
      attached = true;
    }
    if (hasSouth) {
      transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 1.0 - thickness / 2, sx: 1.0, sy: 1.0, sz: thickness });
      attached = true;
    }
    if (hasWest) {
      transforms.push({ px: x + thickness / 2, py: y + 0.5, pz: z + 0.5, sx: thickness, sy: 1.0, sz: 1.0 });
      attached = true;
    }
    if (hasEast) {
      transforms.push({ px: x + 1.0 - thickness / 2, py: y + 0.5, pz: z + 0.5, sx: thickness, sy: 1.0, sz: 1.0 });
      attached = true;
    }
    if (hasUp) {
      transforms.push({ px: x + 0.5, py: y + 1.0 - thickness / 2, pz: z + 0.5, sx: 1.0, sy: thickness, sz: 1.0 });
      attached = true;
    }

    if (!attached) {
      transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 0.9, sy: 1.0, sz: thickness });
    }
    return transforms;
  }

  // 21. Seerosenblätter (Lily Pad)
  if (info.type === 'lily_pad') {
    transforms.push({ px: x + 0.5, py: y + 0.015625, pz: z + 0.5, sx: 0.875, sy: 0.03125, sz: 0.875 });
    return transforms;
  }

  // 22. Pflanzen & Büsche (Plant)
  if (info.type === 'plant') {
    transforms.push({ px: x + 0.5, py: y + 0.4, pz: z + 0.5, sx: 0.8, sy: 0.8, sz: 0.8 });
    return transforms;
  }

  // Standard voller Kubus
  transforms.push({ px: x + 0.5, py: y + 0.5, pz: z + 0.5, sx: 1.0, sy: 1.0, sz: 1.0 });
  return transforms;
}

/**
 * Creates authentic Minecraft block mesh geometry and positioning
 * @param {object} block - Block with { x, y, z, name, properties }
 * @param {any} material - Three.js material
 * @returns {any} Three.js Mesh or Group
 */
export function createMinecraftBlockMesh(block, material) {
  if (typeof THREE === 'undefined') return null;

  const { x, y, z, name } = block;
  const props = block.properties || {};
  const info = resolveBlockTextureInfo(name);

  // 1. Stufen (Slab): halbe Höhe 0.5
  if (info.type === 'slab') {
    const isDouble = props.type === 'double';
    const slabGeom = new THREE.BoxGeometry(1, isDouble ? 1.0 : 0.5, 1);
    const mesh = new THREE.Mesh(slabGeom, material);
    const isTop = props.type === 'top' || props.half === 'top';
    mesh.position.set(x + 0.5, isDouble ? (y + 0.5) : (y + (isTop ? 0.75 : 0.25)), z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 2. Treppen (Stairs): L-förmiges Stufenprofil
  if (info.type === 'stairs') {
    const group = new THREE.Group();
    const isTopHalf = props.half === 'top';
    const facing = props.facing || 'north';

    const baseGeom = new THREE.BoxGeometry(1, 0.5, 1);
    const baseMesh = new THREE.Mesh(baseGeom, material);
    baseMesh.position.set(0, isTopHalf ? 0.25 : -0.25, 0);
    group.add(baseMesh);

    let stepGeom, stepOffX = 0, stepOffZ = 0;
    if (facing === 'north' || facing === 'south') {
      stepGeom = new THREE.BoxGeometry(1, 0.5, 0.5);
      stepOffZ = (facing === 'north') ? -0.25 : 0.25;
    } else {
      stepGeom = new THREE.BoxGeometry(0.5, 0.5, 1);
      stepOffX = (facing === 'west') ? -0.25 : 0.25;
    }

    const stepMesh = new THREE.Mesh(stepGeom, material);
    stepMesh.position.set(stepOffX, isTopHalf ? -0.25 : 0.25, stepOffZ);
    group.add(stepMesh);

    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.userData = { x, y, z, name, properties: props };
    return group;
  }

  // 3. Mauern (Walls): Zentrierter Pfeiler 0.5 x 1.0 x 0.5
  if (info.type === 'wall') {
    const wallGeom = new THREE.BoxGeometry(0.5, 1.0, 0.5);
    const mesh = new THREE.Mesh(wallGeom, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 4. Zäune (Fences): Pfeiler 0.25 x 1.0 x 0.25
  if (info.type === 'fence') {
    const fenceGeom = new THREE.BoxGeometry(0.25, 1.0, 0.25);
    const mesh = new THREE.Mesh(fenceGeom, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 5. Zauntore (Fence Gates)
  if (info.type === 'fence_gate') {
    const gateGeom = new THREE.BoxGeometry(0.25, 0.8, 1.0);
    const mesh = new THREE.Mesh(gateGeom, material);
    mesh.position.set(x + 0.5, y + 0.4, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 6. Knöpfe (Buttons): Kleine Erhebung auf Fläche
  if (info.type === 'button') {
    const face = props.face || 'wall';
    const facing = props.facing || 'north';
    let btnGeom, ox = 0, oy = 0, oz = 0;

    if (face === 'floor') {
      btnGeom = new THREE.BoxGeometry(0.35, 0.125, 0.25);
      oy = -0.4375;
    } else if (face === 'ceiling') {
      btnGeom = new THREE.BoxGeometry(0.35, 0.125, 0.25);
      oy = 0.4375;
    } else {
      if (facing === 'north' || facing === 'south') {
        btnGeom = new THREE.BoxGeometry(0.35, 0.25, 0.125);
        oz = (facing === 'north') ? 0.4375 : -0.4375;
      } else {
        btnGeom = new THREE.BoxGeometry(0.125, 0.25, 0.35);
        ox = (facing === 'west') ? 0.4375 : -0.4375;
      }
    }

    const mesh = new THREE.Mesh(btnGeom, material);
    mesh.position.set(x + 0.5 + ox, y + 0.5 + oy, z + 0.5 + oz);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 7. Kisten (Chests): 0.875 x 0.875 x 0.875 Blockgröße
  if (info.type === 'chest') {
    const chestGeom = new THREE.BoxGeometry(0.875, 0.875, 0.875);
    const mesh = new THREE.Mesh(chestGeom, material);
    mesh.position.set(x + 0.5, y + 0.4375, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 8. Fackeln (Torches)
  if (info.type === 'torch') {
    const torchGeom = new THREE.BoxGeometry(0.125, 0.625, 0.125);
    const mesh = new THREE.Mesh(torchGeom, material);
    const facing = props.facing || 'north';
    let ox = 0, oz = 0, oy = 0.3125;
    if (name.includes('wall')) {
      if (facing === 'north') oz = 0.35;
      else if (facing === 'south') oz = -0.35;
      else if (facing === 'west') ox = 0.35;
      else if (facing === 'east') ox = -0.35;
      oy = 0.4;
    }
    mesh.position.set(x + 0.5 + ox, y + oy, z + 0.5 + oz);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 9. Blumentöpfe (Pots)
  if (info.type === 'pot') {
    const potGeom = new THREE.BoxGeometry(0.375, 0.375, 0.375);
    const mesh = new THREE.Mesh(potGeom, material);
    mesh.position.set(x + 0.5, y + 0.1875, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 10. Leitern (Ladders): Wandfläche 0.05
  if (info.type === 'ladder') {
    const facing = props.facing || 'north';
    let ladGeom, ox = 0, oz = 0;
    if (facing === 'north' || facing === 'south') {
      ladGeom = new THREE.BoxGeometry(0.95, 0.95, 0.05);
      oz = (facing === 'north') ? 0.475 : -0.475;
    } else {
      ladGeom = new THREE.BoxGeometry(0.05, 0.95, 0.95);
      ox = (facing === 'west') ? 0.475 : -0.475;
    }
    const mesh = new THREE.Mesh(ladGeom, material);
    mesh.position.set(x + 0.5 + ox, y + 0.5, z + 0.5 + oz);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 11. Ketten (Chains): 0.1875 x 1.0 x 0.1875
  if (info.type === 'chain') {
    const chainGeom = new THREE.BoxGeometry(0.1875, 1.0, 0.1875);
    const mesh = new THREE.Mesh(chainGeom, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 12. Teppiche (Carpets): 0.0625 Höhe
  if (info.type === 'carpet') {
    const carpetGeom = new THREE.BoxGeometry(1.0, 0.0625, 1.0);
    const mesh = new THREE.Mesh(carpetGeom, material);
    mesh.position.set(x + 0.5, y + 0.03125, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 13. Betten (Beds): 1.0 x 0.5625 x 1.0
  if (info.type === 'bed') {
    const bedGeom = new THREE.BoxGeometry(1.0, 0.5625, 1.0);
    const mesh = new THREE.Mesh(bedGeom, material);
    mesh.position.set(x + 0.5, y + 0.28125, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 14. Falltüren (Trapdoors): 0.1875
  if (info.type === 'trapdoor') {
    const isOpen = props.open === 'true' || props.open === true;
    const isTop = props.half === 'top';
    let geom, oy = isTop ? 0.40625 : -0.40625;
    if (isOpen) {
      geom = new THREE.BoxGeometry(1.0, 1.0, 0.1875);
      oy = 0;
    } else {
      geom = new THREE.BoxGeometry(1.0, 0.1875, 1.0);
    }
    const mesh = new THREE.Mesh(geom, material);
    mesh.position.set(x + 0.5, y + 0.5 + oy, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 15. Türen (Doors): 1.0 x 1.0 x 0.1875
  if (info.type === 'door') {
    const doorGeom = new THREE.BoxGeometry(1.0, 1.0, 0.1875);
    const mesh = new THREE.Mesh(doorGeom, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 16. Laterne (Lantern)
  if (info.type === 'lantern') {
    const lanternGeom = new THREE.BoxGeometry(0.375, 0.5625, 0.375);
    const mesh = new THREE.Mesh(lanternGeom, material);
    mesh.position.set(x + 0.5, y + 0.28125, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 17. Schilder (Signs): Dünne Platte
  if (info.type === 'sign') {
    const signGeom = new THREE.BoxGeometry(0.875, 0.5, 0.0625);
    const mesh = new THREE.Mesh(signGeom, material);
    mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 18. Lagerfeuer (Campfire)
  if (info.type === 'campfire') {
    const campGeom = new THREE.BoxGeometry(1.0, 0.45, 1.0);
    const mesh = new THREE.Mesh(campGeom, material);
    mesh.position.set(x + 0.5, y + 0.225, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 19. Köpfe / Schädel (Heads)
  if (info.type === 'head') {
    const headGeom = new THREE.BoxGeometry(0.5, 0.5, 0.5);
    const mesh = new THREE.Mesh(headGeom, material);
    mesh.position.set(x + 0.5, y + 0.25, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 20. Reben (Vines)
  if (info.type === 'vine') {
    const group = new THREE.Group();
    const hasNorth = props.north === 'true' || props.north === true;
    const hasSouth = props.south === 'true' || props.south === true;
    const hasEast = props.east === 'true' || props.east === true;
    const hasWest = props.west === 'true' || props.west === true;
    const hasUp = props.up === 'true' || props.up === true;

    let attached = false;
    const thickness = 0.05;
    if (hasNorth) {
      const g = new THREE.BoxGeometry(1.0, 1.0, thickness);
      const m = new THREE.Mesh(g, material);
      m.position.set(0, 0, -0.5 + thickness / 2);
      group.add(m);
      attached = true;
    }
    if (hasSouth) {
      const g = new THREE.BoxGeometry(1.0, 1.0, thickness);
      const m = new THREE.Mesh(g, material);
      m.position.set(0, 0, 0.5 - thickness / 2);
      group.add(m);
      attached = true;
    }
    if (hasWest) {
      const g = new THREE.BoxGeometry(thickness, 1.0, 1.0);
      const m = new THREE.Mesh(g, material);
      m.position.set(-0.5 + thickness / 2, 0, 0);
      group.add(m);
      attached = true;
    }
    if (hasEast) {
      const g = new THREE.BoxGeometry(thickness, 1.0, 1.0);
      const m = new THREE.Mesh(g, material);
      m.position.set(0.5 - thickness / 2, 0, 0);
      group.add(m);
      attached = true;
    }
    if (hasUp) {
      const g = new THREE.BoxGeometry(1.0, thickness, 1.0);
      const m = new THREE.Mesh(g, material);
      m.position.set(0, 0.5 - thickness / 2, 0);
      group.add(m);
      attached = true;
    }

    if (!attached) {
      const g = new THREE.BoxGeometry(0.9, 1.0, thickness);
      const m = new THREE.Mesh(g, material);
      group.add(m);
    }

    group.position.set(x + 0.5, y + 0.5, z + 0.5);
    group.userData = { x, y, z, name, properties: props };
    return group;
  }

  // 21. Seerosenblätter (Lily Pad)
  if (info.type === 'lily_pad') {
    const padGeom = new THREE.BoxGeometry(0.875, 0.03125, 0.875);
    const mesh = new THREE.Mesh(padGeom, material);
    mesh.position.set(x + 0.5, y + 0.015625, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // 22. Pflanzen & Büsche (Plant)
  if (info.type === 'plant') {
    const plantGeom = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mesh = new THREE.Mesh(plantGeom, material);
    mesh.position.set(x + 0.5, y + 0.4, z + 0.5);
    mesh.userData = { x, y, z, name, properties: props };
    return mesh;
  }

  // Standard 1x1x1 Kubus
  const geom = new THREE.BoxGeometry(1, 1, 1);
  const mesh = new THREE.Mesh(geom, material);
  mesh.position.set(x + 0.5, y + 0.5, z + 0.5);
  mesh.userData = { x, y, z, name, properties: props };
  return mesh;
}
