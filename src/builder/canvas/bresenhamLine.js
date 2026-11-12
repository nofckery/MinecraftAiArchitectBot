/**
 * Zeichnet eine 3D-Bresenham-Linie auf der Ziel-Canvas.
 */
export function drawBresenhamLine(canvas, x1, y1, z1, x2, y2, z2, blockInput) {
  canvas.incOps();
  let x = Math.floor(x1);
  let y = Math.floor(y1);
  let z = Math.floor(z1);
  const targetX = Math.floor(x2);
  const targetY = Math.floor(y2);
  const targetZ = Math.floor(z2);

  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  const dz = Math.abs(targetZ - z);
  const xs = targetX > x ? 1 : -1;
  const ys = targetY > y ? 1 : -1;
  const zs = targetZ > z ? 1 : -1;

  if (dx >= dy && dx >= dz) {
    let p1 = 2 * dy - dx;
    let p2 = 2 * dz - dx;
    while (x !== targetX) {
      canvas.set(x, y, z, blockInput);
      x += xs;
      if (p1 >= 0) {
        y += ys;
        p1 -= 2 * dx;
      }
      if (p2 >= 0) {
        z += zs;
        p2 -= 2 * dx;
      }
      p1 += 2 * dy;
      p2 += 2 * dz;
    }
  } else if (dy >= dx && dy >= dz) {
    let p1 = 2 * dx - dy;
    let p2 = 2 * dz - dy;
    while (y !== targetY) {
      canvas.set(x, y, z, blockInput);
      y += ys;
      if (p1 >= 0) {
        x += xs;
        p1 -= 2 * dy;
      }
      if (p2 >= 0) {
        z += zs;
        p2 -= 2 * dy;
      }
      p1 += 2 * dx;
      p2 += 2 * dz;
    }
  } else {
    let p1 = 2 * dy - dz;
    let p2 = 2 * dx - dz;
    while (z !== targetZ) {
      canvas.set(x, y, z, blockInput);
      z += zs;
      if (p1 >= 0) {
        y += ys;
        p1 -= 2 * dz;
      }
      if (p2 >= 0) {
        x += xs;
        p2 -= 2 * dz;
      }
      p1 += 2 * dy;
      p2 += 2 * dx;
    }
  }
  canvas.set(targetX, targetY, targetZ, blockInput);
}
