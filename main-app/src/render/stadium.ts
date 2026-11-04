/**
 * 水墨武道大會擂台：宣紙米白地面、墨黑石環、朱印紅缺口。
 * 保留原幾何（bowl 5.0、wall / ring-out rim 5.6、三個缺口），只改色調與材質。
 * 0.5.9：牆／缺口放喺可旋轉 Group（跟物理 GAP_SPIN）；缺口半寬跟 GAP_HALF_WIDTH。
 * 禁止霓虹青光；以墨黑、宣紙米白、朱印紅為主。
 */
import * as THREE from 'three';
import { BOWL_RADIUS, BOWL_VISUAL_K, GAP_ANGLES, GAP_HALF_WIDTH, LIP_WIDTH, RIM_RADIUS } from '../config/balance';

export const visualHeight = (r: number) => BOWL_VISUAL_K * Math.min(r, BOWL_RADIUS) ** 2;
export const RIM_Y = visualHeight(BOWL_RADIUS);
export const TABLE_Y = -0.6;
const FLOOR_R = RIM_RADIUS;

function floorTexture(): THREE.CanvasTexture {
  const size = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;

  // 宣紙米白底，中心略深，邊緣暈染淡出。
  const grad = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  grad.addColorStop(0, '#efe6d2');
  grad.addColorStop(0.6, '#e6dbc2');
  grad.addColorStop(1, '#d9cdb2');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);

  // 墨筆同心圓（石環）。
  g.strokeStyle = 'rgba(27,26,23,0.28)';
  g.lineWidth = 3;
  for (let i = 1; i <= 6; i++) {
    g.beginPath();
    g.arc(mid, mid, (mid / 6) * i - 2, 0, Math.PI * 2);
    g.stroke();
  }

  // 放射墨線（筆觸）。
  g.strokeStyle = 'rgba(27,26,23,0.14)';
  g.lineWidth = 2;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    g.beginPath();
    g.moveTo(mid + Math.cos(a) * mid * 0.18, mid + Math.sin(a) * mid * 0.18);
    g.lineTo(mid + Math.cos(a) * mid, mid + Math.sin(a) * mid);
    g.stroke();
  }

  // 中心朱印紅圓（武道大會印記）。
  g.fillStyle = 'rgba(178,58,46,0.22)';
  g.beginPath();
  g.arc(mid, mid, mid * 0.12, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(143,42,32,0.7)';
  g.lineWidth = 6;
  g.stroke();

  // 中央「武」字墨痕（簡筆）。
  g.fillStyle = 'rgba(27,26,23,0.35)';
  g.font = `${Math.round(mid * 0.16)}px 'Noto Serif TC', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('武', mid, mid);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Builds the stadium. Returns the rotatable rim group (walls + gap pockets). */
export function createStadium(scene: THREE.Scene): THREE.Group {
  // Bowl to BOWL_RADIUS, then a flat ring out to the wall; one texture spans both (planar UVs).
  const geo = new THREE.RingGeometry(0.0001, FLOOR_R, 96, 56);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, visualHeight(Math.hypot(pos.getX(i), pos.getY(i))));
  geo.rotateX(-Math.PI / 2);
  geo.computeVertexNormals();
  const bowl = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, metalness: 0.02 }),
  );
  bowl.receiveShadow = true;
  scene.add(bowl);

  // 外環石唇：墨灰。
  const lip = new THREE.Mesh(
    new THREE.RingGeometry(RIM_RADIUS, RIM_RADIUS + LIP_WIDTH, 96, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3a352c, roughness: 0.9, metalness: 0.05 }),
  );
  lip.position.y = RIM_Y;
  lip.receiveShadow = true;
  scene.add(lip);

  // 擂台石座：墨黑。
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(RIM_RADIUS + LIP_WIDTH, RIM_RADIUS + LIP_WIDTH - 0.4, RIM_Y - TABLE_Y, 96, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1b1a17, roughness: 0.95, side: THREE.DoubleSide }),
  );
  base.position.y = (RIM_Y + TABLE_Y) / 2;
  scene.add(base);

  // 地面：宣紙米白。
  const table = new THREE.Mesh(
    new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xd9cdb2, roughness: 0.98 }),
  );
  table.position.y = TABLE_Y;
  table.receiveShadow = true;
  scene.add(table);

  // 石牆：墨灰石質。
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x4a4438,
    metalness: 0.05,
    roughness: 0.85,
    emissive: 0x000000,
    side: THREE.DoubleSide,
  });
  // 牆頂朱印紅飾帶（取代霓虹青）。
  const stripMat = new THREE.MeshBasicMaterial({ color: 0xb23a2e });
  // 缺口：朱印紅暈染。
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0xb23a2e, transparent: true, opacity: 0.42, side: THREE.DoubleSide });

  const rim = new THREE.Group();
  rim.name = 'rimGaps';

  const gaps = [...GAP_ANGLES].sort((a, b) => a - b);
  for (let i = 0; i < gaps.length; i++) {
    const start = gaps[i] + GAP_HALF_WIDTH;
    let end = gaps[(i + 1) % gaps.length] - GAP_HALF_WIDTH;
    if (end < start) end += Math.PI * 2;
    // CylinderGeometry measures theta from +Z toward +X; physics angles go from +X toward +Z.
    const thetaStart = Math.PI / 2 - end;
    const len = end - start;

    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(RIM_RADIUS + 0.06, RIM_RADIUS + 0.06, 0.55, 64, 1, true, thetaStart, len),
      wallMat,
    );
    wall.position.y = RIM_Y + 0.2;
    wall.castShadow = true;
    rim.add(wall);

    const strip = new THREE.Mesh(
      new THREE.CylinderGeometry(RIM_RADIUS + 0.08, RIM_RADIUS + 0.08, 0.06, 64, 1, true, thetaStart, len),
      stripMat,
    );
    strip.position.y = RIM_Y + 0.47;
    rim.add(strip);
  }

  for (const g of GAP_ANGLES) {
    const pocket = new THREE.Mesh(
      new THREE.RingGeometry(RIM_RADIUS, RIM_RADIUS + LIP_WIDTH, 16, 1, g - GAP_HALF_WIDTH, GAP_HALF_WIDTH * 2),
      pocketMat,
    );
    // RingGeometry lies in XY; +90° about X maps +Y to +Z so the angle matches atan2(z, x).
    pocket.rotation.x = Math.PI / 2;
    pocket.position.y = RIM_Y + 0.01;
    rim.add(pocket);
  }

  scene.add(rim);
  return rim;
}
