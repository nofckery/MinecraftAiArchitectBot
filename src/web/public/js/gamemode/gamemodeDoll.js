/**
 * Steve Player Preview Doll rendering on 2D HTML Canvas.
 */

import { gamemodeCtx } from './gamemodeContext.js';

/**
 * Render Steve player preview doll with animated head tracking and equipped armor.
 * @param {object} inv
 * @param {number} normX
 * @param {number} normY
 */
export function renderPlayerDoll(inv, normX = 0.5, normY = 0.5) {
  const canvas = gamemodeCtx.elements.mcPlayerDollCanvas || (typeof document !== 'undefined' ? document.getElementById('mcPlayerDollCanvas') : null);
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const lookX = Math.max(-1, Math.min(1, (normX - 0.5) * 2));
  const lookY = Math.max(-1, Math.min(1, (normY - 0.5) * 2));

  const scale = 2.0;
  const cx = canvas.width / 2;
  const baseY = canvas.height - 4;

  ctx.save();
  ctx.translate(cx, baseY);

  const getArmorColor = (item) => {
    if (!item || !item.name) return null;
    const n = item.name.toLowerCase();
    if (n.includes('leather')) return '#7f5231';
    if (n.includes('chainmail')) return '#878787';
    if (n.includes('iron')) return '#d8d8d8';
    if (n.includes('golden') || n.includes('gold')) return '#fbe84e';
    if (n.includes('diamond')) return '#4dedf0';
    if (n.includes('netherite')) return '#443a3b';
    return '#aaaaaa';
  };

  const headArmor = getArmorColor(inv?.armor?.head);
  const bodyArmor = getArmorColor(inv?.armor?.torso);
  const legsArmor = getArmorColor(inv?.armor?.legs);
  const feetArmor = getArmorColor(inv?.armor?.feet);

  // 1. Legs
  const legW = 4 * scale;
  const legH = 12 * scale;
  const legY = -legH;

  // Left Leg
  ctx.fillStyle = legsArmor || '#2b367d';
  ctx.fillRect(-legW - 0.5, legY, legW, legH);
  ctx.fillStyle = feetArmor || '#4c4c4c';
  ctx.fillRect(-legW - 0.5, -3 * scale, legW, 3 * scale);

  // Right Leg
  ctx.fillStyle = legsArmor || '#2b367d';
  ctx.fillRect(0.5, legY, legW, legH);
  ctx.fillStyle = feetArmor || '#4c4c4c';
  ctx.fillRect(0.5, -3 * scale, legW, 3 * scale);

  // 2. Torso
  const torsoW = 8 * scale;
  const torsoH = 12 * scale;
  const torsoY = legY - torsoH;
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(-torsoW / 2, torsoY, torsoW, torsoH);

  // Neck skin
  if (!bodyArmor) {
    ctx.fillStyle = '#c68c59';
    ctx.fillRect(-scale, torsoY, 2 * scale, 1.5 * scale);
  }

  // 3. Arms
  const armW = 4 * scale;
  // Left Arm
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(-torsoW / 2 - armW, torsoY, armW, 4 * scale);
  ctx.fillStyle = bodyArmor || '#c68c59';
  ctx.fillRect(-torsoW / 2 - armW, torsoY + 4 * scale, armW, 8 * scale);

  // Right Arm
  ctx.fillStyle = bodyArmor || '#00a2a7';
  ctx.fillRect(torsoW / 2, torsoY, armW, 4 * scale);
  ctx.fillStyle = bodyArmor || '#c68c59';
  ctx.fillRect(torsoW / 2, torsoY + 4 * scale, armW, 8 * scale);

  // 4. Head
  const headSize = 8 * scale;
  const headY = torsoY - headSize;
  const headOffsetX = lookX * 2.2;
  const headOffsetY = lookY * 1.4;

  ctx.save();
  ctx.translate(headOffsetX, headOffsetY);

  // Skin
  ctx.fillStyle = '#c68c59';
  ctx.fillRect(-headSize / 2, headY, headSize, headSize);

  // Hair
  ctx.fillStyle = '#4a3219';
  ctx.fillRect(-headSize / 2, headY, headSize, 2.5 * scale);
  ctx.fillRect(-headSize / 2, headY + 2.5 * scale, 1 * scale, 3 * scale);
  ctx.fillRect(headSize / 2 - 1 * scale, headY + 2.5 * scale, 1 * scale, 3 * scale);

  // Eyes
  const eyeY = headY + 3.5 * scale;
  const eyeShift = lookX * 0.8;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-3 * scale + eyeShift, eyeY, 2 * scale, scale);
  ctx.fillStyle = '#29388c';
  ctx.fillRect(-2 * scale + eyeShift, eyeY, scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(1 * scale + eyeShift, eyeY, 2 * scale, scale);
  ctx.fillStyle = '#29388c';
  ctx.fillRect(1 * scale + eyeShift, eyeY, scale, scale);

  // Nose / mouth
  ctx.fillStyle = '#9c5936';
  ctx.fillRect(-scale + eyeShift * 0.5, eyeY + 1.5 * scale, 2 * scale, scale);

  // Helmet
  if (headArmor) {
    ctx.fillStyle = headArmor;
    ctx.fillRect(-headSize / 2 - 0.5 * scale, headY - 0.5 * scale, headSize + scale, headSize * 0.7);
    ctx.fillRect(-headSize / 2 - 0.5 * scale, headY, scale, headSize * 0.9);
    ctx.fillRect(headSize / 2 - 0.5 * scale, headY, scale, headSize * 0.9);
  }

  ctx.restore();
  ctx.restore();
}
