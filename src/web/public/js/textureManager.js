/**
 * Architect Mission Control — Minecraft Texture & Geometry Engine v2.0
 * Provides 100% authentic Vanilla Minecraft textures & geometries:
 * - Real 16x16 nearest-neighbor pixel art (no blur)
 * - Multi-face texturing (grass, logs, crafting table, furnace, smoker, loom, lectern, barrel, hay)
 * - Zero-Black-Block Guarantee: procedural pixelated 16x16 fallbacks for 404s/unknowns
 * - Real 3D Block Geometries: stairs, slabs, fences, walls, buttons, chests, torches, pots, ladders, chains, beds, doors, trapdoors
 */

import { getFoliageTintColor, getBlockFallbackColor } from './voxel/colorPalette.js';
import { createProceduralMinecraftTexture } from './voxel/proceduralTextures.js';
import { extractBlockBaseName, resolveBlockTextureInfo } from './voxel/blockResolver.js';
import { getBlockInstanceTransforms, createMinecraftBlockMesh } from './voxel/blockGeometry.js';

export {
  getFoliageTintColor,
  getBlockFallbackColor,
  createProceduralMinecraftTexture,
  extractBlockBaseName,
  resolveBlockTextureInfo,
  getBlockInstanceTransforms,
  createMinecraftBlockMesh
};

const textureCache = new Map();
const materialCache = new Map();

/**
 * Loads a texture with pixel-perfect nearest neighbor filtering, foliage tinting, and guaranteed non-black fallback
 * @param {string} textureName
 * @param {string} [cleanName='']
 * @param {number|null} [tint=null]
 * @returns {any} Three.js Texture
 */
export function loadBlockTexture(textureName, cleanName = '', tint = null) {
  if (typeof THREE === 'undefined') return null;

  const cacheKey = (tint !== null && tint !== undefined && tint !== 0xffffff)
    ? `${textureName}_tint_${tint.toString(16)}`
    : textureName;

  if (textureCache.has(cacheKey)) {
    return textureCache.get(cacheKey);
  }

  // 1. Sofortige Initialisierung mit authentischer 16x16 Pixel-Canvas
  const procedural = createProceduralMinecraftTexture(textureName, cleanName, tint);
  if (!procedural) return null;

  const { texture, canvas, ctx } = procedural;
  textureCache.set(cacheKey, texture);

  // 2. Im Hintergrund das echte PNG-Asset asynchron laden
  if (typeof Image !== 'undefined') {
    const applyTintToCanvas = (targetCtx, sourceImg, targetTint) => {
      targetCtx.clearRect(0, 0, 16, 16);
      targetCtx.drawImage(sourceImg, 0, 0, 16, 16);

      if (targetTint !== null && targetTint !== undefined && targetTint !== 0xffffff) {
        const tr = (targetTint >> 16) & 255;
        const tg = (targetTint >> 8) & 255;
        const tb = targetTint & 255;

        const imgData = targetCtx.getImageData(0, 0, 16, 16);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 0) {
            data[i] = Math.round((data[i] * tr) / 255);
            data[i + 1] = Math.round((data[i + 1] * tg) / 255);
            data[i + 2] = Math.round((data[i + 2] * tb) / 255);
          }
        }
        targetCtx.putImageData(imgData, 0, 0);
      }
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      applyTintToCanvas(ctx, img, tint);
      texture.needsUpdate = true;
    };
    img.onerror = () => {
      // 3. Fallback auf Prismarine-Viewer Block-Texture Atlas Route
      const altImg = new Image();
      altImg.crossOrigin = 'anonymous';
      altImg.onload = () => {
        applyTintToCanvas(ctx, altImg, tint);
        texture.needsUpdate = true;
      };
      altImg.onerror = () => {
        // Bleibt stabil bei der generierten 16x16 Canvas-Textur
      };
      altImg.src = `/textures/${textureName}.png`;
    };
    img.src = `/img/mc/${textureName}.png`;
  }

  return texture;
}

/**
 * Builds or retrieves cached Three.js materials for a given block
 * @param {string} blockName
 * @param {object} [options={}]
 * @returns {any} Three.js Material or Material[]
 */
export function getBlockMaterial(blockName, options = {}) {
  if (typeof THREE === 'undefined') return null;

  const info = resolveBlockTextureInfo(blockName);
  const cacheKey = `${blockName}_${info.type}_${options.wireframe ? 'wf' : 'solid'}`;

  if (materialCache.has(cacheKey)) {
    return materialCache.get(cacheKey);
  }

  const matOpts = {
    wireframe: !!options.wireframe,
    transparent: !!info.transparent,
    opacity: info.opacity !== undefined ? info.opacity : 1.0
  };
  if (info.alphaTest !== undefined) {
    matOpts.alphaTest = info.alphaTest;
  }

  let material;

  // Multi-Face texturierte Blöcke: Array von 6 Materialien [+X, -X, +Y, -Y, +Z, -Z]
  if (info.type === 'multiface') {
    const topTex = loadBlockTexture(info.top, blockName, info.topTint);
    const bottomTex = loadBlockTexture(info.bottom || info.top, blockName);
    const sideTex = loadBlockTexture(info.side || info.top, blockName);
    const frontTex = info.front ? loadBlockTexture(info.front, blockName) : sideTex;

    const sideMat = new THREE.MeshLambertMaterial({ ...matOpts, map: sideTex });
    const topMat = new THREE.MeshLambertMaterial({ ...matOpts, map: topTex });
    const bottomMat = new THREE.MeshLambertMaterial({ ...matOpts, map: bottomTex });
    const frontMat = new THREE.MeshLambertMaterial({ ...matOpts, map: frontTex });

    // Order: [right, left, top, bottom, front, back]
    material = [sideMat, sideMat, topMat, bottomMat, frontMat, sideMat];
  } else if (info.type === 'log') {
    const sideTex = loadBlockTexture(info.side, blockName);
    const topTex = loadBlockTexture(info.top, blockName);
    const sideMat = new THREE.MeshLambertMaterial({ ...matOpts, map: sideTex });
    const topMat = new THREE.MeshLambertMaterial({ ...matOpts, map: topTex });
    material = [sideMat, sideMat, topMat, topMat, sideMat, sideMat];
  } else {
    const tex = loadBlockTexture(info.texture, blockName, info.tint);
    material = new THREE.MeshLambertMaterial({
      ...matOpts,
      map: tex
    });
  }

  materialCache.set(cacheKey, material);
  return material;
}

/**
 * Clears texture and material caches (e.g. for palette swap or reload)
 */
export function clearTextureCache() {
  textureCache.clear();
  materialCache.clear();
}
