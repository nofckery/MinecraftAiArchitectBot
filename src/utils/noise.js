/**
 * Deterministischer 3D-Noise & Smart-Palette-Generator
 * Garantiert reproduzierbare, organische Textur-Verteilungen ohne unruhiges Zufallsrauschen.
 */

export function hash3D(x, y, z, seed = 1337) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 2147483647) + Math.imul(seed, 1664525);
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise3D(x, y, z, scale = 0.25, seed = 1337) {
  const X = x * scale;
  const Y = y * scale;
  const Z = z * scale;

  const x0 = Math.floor(X);
  const y0 = Math.floor(Y);
  const z0 = Math.floor(Z);

  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const z1 = z0 + 1;

  let fx = X - x0;
  let fy = Y - y0;
  let fz = Z - z0;

  // Smoothstep (Hermite-Interpolation)
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);

  const c000 = hash3D(x0, y0, z0, seed);
  const c100 = hash3D(x1, y0, z0, seed);
  const c010 = hash3D(x0, y1, z0, seed);
  const c110 = hash3D(x1, y1, z0, seed);

  const c001 = hash3D(x0, y0, z1, seed);
  const c101 = hash3D(x1, y0, z1, seed);
  const c011 = hash3D(x0, y1, z1, seed);
  const c111 = hash3D(x1, y1, z1, seed);

  const c00 = c000 * (1 - fx) + c100 * fx;
  const c10 = c010 * (1 - fx) + c110 * fx;
  const c01 = c001 * (1 - fx) + c101 * fx;
  const c11 = c011 * (1 - fx) + c111 * fx;

  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;

  return c0 * (1 - fz) + c1 * fz;
}

function resolveSubList(listOrMap, noiseVal) {
  if (Array.isArray(listOrMap)) {
    if (listOrMap.length === 0) return 'air';
    const idx = Math.min(Math.floor(noiseVal * listOrMap.length), listOrMap.length - 1);
    return listOrMap[idx];
  }
  if (typeof listOrMap === 'object' && listOrMap !== null) {
    const entries = Object.entries(listOrMap);
    const sum = entries.reduce((acc, [, w]) => acc + (typeof w === 'number' ? w : 1), 0);
    if (sum <= 0) return entries[0]?.[0] || 'air';
    let target = noiseVal * sum;
    for (const [block, weight] of entries) {
      const w = typeof weight === 'number' ? weight : 1;
      target -= w;
      if (target <= 0) return block;
    }
    return entries[entries.length - 1][0];
  }
  return String(listOrMap || 'air');
}

export function createSmartPalette(definition, options = {}) {
  const scale = options.scale ?? 0.25;
  const seed = options.seed ?? 1337;

  if (typeof definition === 'function') {
    return definition;
  }

  if (typeof definition === 'string') {
    return () => definition;
  }

  // Modus 2: Höhen-Verwitterung (Vertical Gradient)
  if (definition && typeof definition === 'object' && !Array.isArray(definition) && (definition.bottom || definition.top || definition.middle)) {
    const maxHeight = definition.maxHeight || 10;
    const baseOffset = options.baseY || 0;
    return (x, y, z) => {
      const relativeY = Math.max(0, y - baseOffset);
      const noisePerturb = (valueNoise3D(x, y, z, scale, seed) - 0.5) * 0.3;
      const progress = Math.max(0, Math.min(1, (relativeY / Math.max(1, maxHeight)) + noisePerturb));
      const subNoise = valueNoise3D(x, y, z, scale * 1.8, seed + 313);

      if (definition.middle) {
        if (progress < 0.35) {
          return resolveSubList(definition.bottom || definition.middle, subNoise);
        } else if (progress < 0.70) {
          return resolveSubList(definition.middle, subNoise);
        } else {
          return resolveSubList(definition.top || definition.middle, subNoise);
        }
      } else {
        if (progress < 0.5) {
          return resolveSubList(definition.bottom || 'stone_bricks', subNoise);
        } else {
          return resolveSubList(definition.top || 'cobblestone', subNoise);
        }
      }
    };
  }

  // Modus 1: Gewichtete Map oder Array
  return (x, y, z) => {
    const n = valueNoise3D(x, y, z, scale, seed);
    return resolveSubList(definition, n);
  };
}
