import { getBlockFallbackColor } from './colorPalette.js';

/**
 * Creates an authentic 16x16 pixel-art Canvas texture with Minecraft dither noise
 * @param {string} textureName
 * @param {string} [cleanName='']
 * @param {number|null} [tint=null]
 * @returns {{ texture: any, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D } | null}
 */
export function createProceduralMinecraftTexture(textureName, cleanName = '', tint = null) {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');

  const baseColor = (tint !== null && tint !== undefined && tint !== 0xffffff)
    ? tint
    : getBlockFallbackColor(textureName || cleanName);
  const r = (baseColor >> 16) & 255;
  const g = (baseColor >> 8) & 255;
  const b = baseColor & 255;

  // Spezial-Texturen für bekannte fehlende Block-Assets
  if (textureName === 'chest_front') {
    // Front mit goldenem Schloss-Verschluss
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 16, 16);
    // Dunkler Rahmen
    ctx.strokeStyle = '#2d1c0c';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 15, 15);
    // Schloss (gold/silber) in der Mitte
    ctx.fillStyle = '#f0c040';
    ctx.fillRect(7, 6, 2, 4);
    ctx.fillStyle = '#222222';
    ctx.fillRect(7, 7, 2, 2);
  } else if (textureName === 'chest_top' || textureName === 'chest_side') {
    // Kisten-Deckel & Seiten
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = '#2d1c0c';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, 15, 15);
  } else if (textureName === 'ender_chest_front') {
    // Enderkiste mit Auge
    ctx.fillStyle = '#1c2d2d';
    ctx.fillRect(0, 0, 16, 16);
    ctx.strokeStyle = '#0a1414';
    ctx.strokeRect(0.5, 0.5, 15, 15);
    ctx.fillStyle = '#2de0a5';
    ctx.fillRect(7, 6, 2, 4);
  } else if (textureName === 'firefly_bush') {
    // Authentischer dichter Busch mit leuchtenden Glühwürmchen
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if ((x + y * 5) % 9 === 0) continue; // Natürliche Blattausschnitte
        const noise = ((Math.sin(x * 12.9898 + y * 78.233 + 42) * 43758.5453) % 1) * 30 - 15;
        const pr = Math.max(0, Math.min(255, Math.round(r + noise)));
        const pg = Math.max(0, Math.min(255, Math.round(g + noise)));
        const pb = Math.max(0, Math.min(255, Math.round(b + noise)));
        ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    // Glühwürmchen-Punkte (Warmes Leuchten)
    ctx.fillStyle = '#ffee33';
    ctx.fillRect(4, 5, 2, 2);
    ctx.fillRect(11, 4, 1, 1);
    ctx.fillRect(7, 10, 2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(4, 5, 1, 1);
    ctx.fillRect(8, 10, 1, 1);
  } else {
    // Authentisches 16x16 Minecraft-Pixel-Rauschen
    const nameSeed = (textureName || 'mc').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    const isFoliage = (textureName || cleanName).includes('leaf') || (textureName || cleanName).includes('leaves') || (textureName || cleanName).includes('bush') || (textureName || cleanName).includes('vine');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (isFoliage && (x * 7 + y * 13 + nameSeed) % 11 === 0) continue; // Pixelart Perforation
        const noise = ((Math.sin(x * 12.9898 + y * 78.233 + nameSeed) * 43758.5453) % 1) * 32 - 16;
        const pr = Math.max(0, Math.min(255, Math.round(r + noise)));
        const pg = Math.max(0, Math.min(255, Math.round(g + noise)));
        const pb = Math.max(0, Math.min(255, Math.round(b + noise)));
        ctx.fillStyle = `rgb(${pr},${pg},${pb})`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
    if (!isFoliage) {
      // Subtile Kanten-Schattierung für Tiefenwirkung bei Vollblöcken
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.strokeRect(0.5, 0.5, 15, 15);
    }
  }

  if (typeof THREE === 'undefined') return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return { texture, canvas, ctx };
}
