import * as THREE from 'three';
import { ARENA_RADIUS, BOWL_K, GAP_ANGLES, GAP_HALF_WIDTH, LIP_WIDTH } from './config';

const R = ARENA_RADIUS;

export function bowlHeight(r: number): number {
  const rr = Math.min(r, R);
  return BOWL_K * rr * rr;
}

export function bowlSlope(r: number): number {
  return r < R ? 2 * BOWL_K * r : 0;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function inGap(angle: number): boolean {
  return GAP_ANGLES.some((g) => Math.abs(angleDiff(angle, g)) < GAP_HALF_WIDTH);
}

function floorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;

  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, '#1d2a52');
  grad.addColorStop(0.55, '#121a36');
  grad.addColorStop(1, '#0a0f22');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  g.strokeStyle = 'rgba(120,170,255,0.22)';
  g.lineWidth = 3;
  for (let i = 1; i <= 6; i++) {
    g.beginPath();
    g.arc(mid, mid, (mid / 6) * i - 2, 0, Math.PI * 2);
    g.stroke();
  }
  g.strokeStyle = 'rgba(120,170,255,0.12)';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * mid * 0.18, mid + Math.sin(a) * mid * 0.18);
    g.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    g.stroke();
  }

  g.fillStyle = 'rgba(255,90,120,0.35)';
  g.beginPath();
  g.arc(mid, mid, mid * 0.12, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,140,170,0.8)';
  g.lineWidth = 6;
  g.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function createStadium(scene: THREE.Scene): void {
  const bowlGeo = new THREE.RingGeometry(0.0001, R, 96, 48);
  const pos = bowlGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, bowlHeight(Math.hypot(x, y)));
  }
  bowlGeo.rotateX(-Math.PI / 2);
  bowlGeo.computeVertexNormals();
  const bowl = new THREE.Mesh(
    bowlGeo,
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.55, metalness: 0.2 }),
  );
  bowl.receiveShadow = true;
  scene.add(bowl);

  const rimY = bowlHeight(R);

  const lip = new THREE.Mesh(
    new THREE.RingGeometry(R, R + LIP_WIDTH, 96, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x1a2140, roughness: 0.7, metalness: 0.3 }),
  );
  lip.position.y = rimY;
  lip.receiveShadow = true;
  scene.add(lip);

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(R + LIP_WIDTH, R + LIP_WIDTH - 0.4, rimY + 0.3, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x10152c, roughness: 0.8, side: THREE.DoubleSide }),
  );
  base.position.y = (rimY - 0.3) / 2;
  scene.add(base);

  const table = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x0b0d18, roughness: 0.95 }),
  );
  table.position.y = -0.3;
  table.receiveShadow = true;
  scene.add(table);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xc7d2e8,
    metalness: 0.85,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const stripMat = new THREE.MeshBasicMaterial({ color: 0x5fd4ff });
  const pocketMat = new THREE.MeshBasicMaterial({
    color: 0xff3b5c,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });

  const gaps = [...GAP_ANGLES].sort((a, b) => a - b);
  for (let i = 0; i < gaps.length; i++) {
    const start = gaps[i] + GAP_HALF_WIDTH;
    let end = gaps[(i + 1) % gaps.length] - GAP_HALF_WIDTH;
    if (end < start) end += Math.PI * 2;
    // CylinderGeometry measures theta from +Z toward +X, physics angles go from +X toward +Z.
    const thetaStart = Math.PI / 2 - end;
    const len = end - start;

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.12, R + 0.12, 0.55, 64, 1, true, thetaStart, len),
      wallMat,
    );
    wall.position.y = rimY + 0.2;
    wall.castShadow = true;
    scene.add(wall);

    const strip = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.14, R + 0.14, 0.06, 64, 1, true, thetaStart, len),
      stripMat,
    );
    strip.position.y = rimY + 0.47;
    scene.add(strip);
  }

  for (const g of GAP_ANGLES) {
    const pocket = new THREE.Mesh(
      new THREE.RingGeometry(R, R + LIP_WIDTH, 16, 1, g - GAP_HALF_WIDTH, GAP_HALF_WIDTH * 2),
      pocketMat,
    );
    // RingGeometry lies in XY; rotating +90° about X maps +Y to +Z so the angle matches atan2(z, x).
    pocket.rotation.x = Math.PI / 2;
    pocket.position.y = rimY + 0.01;
    scene.add(pocket);
  }
}
