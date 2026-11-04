/**
 * 0.4.5-3d: 多層次程式幾何陀螺（運命軸 + 國本配重盤 + 鉚釘環 + 主副雙層戰鋒 + 陣營聖獸紋章 + 自旋刀光環 + 跟隨動光）。
 * 保留 kindFromFused、P1 朱／P2 青 sideColor、castShadow、doBurst 拆件及所有公開介面。
 */
import * as THREE from 'three';
import { BOWL_RADIUS, BOWL_VISUAL_K, LIP_WIDTH, RIM_RADIUS, TOP_RADIUS } from '../config/balance';
import type { Body } from '../physics/world';
import type { FusedStats } from '../rules/fuse';
import { RIM_Y, TABLE_Y, visualHeight } from './stadium';

export type TopKind = 'Attack' | 'Defense' | 'Stamina';

const KIND_COLORS: Record<TopKind, { body: number; sub: number; accent: number }> = {
  Attack: { body: 0x2468e8, sub: 0x153c8a, accent: 0x7fe3ff },
  Defense: { body: 0x25a862, sub: 0x145e36, accent: 0xd6ff6b },
  Stamina: { body: 0x9438f5, sub: 0x4e188a, accent: 0xff8be0 },
};

/** Visual style from fused stats: the axis furthest above its 1.0 baseline. */
export function kindFromFused(f: FusedStats): TopKind {
  const scores: [TopKind, number][] = [
    ['Attack', f.ATK - 1],
    ['Defense', (f.DEF + f.MAS) / 2 - 1],
    ['Stamina', 1 - f.STA_DECAY],
  ];
  return scores.reduce((best, s) => (s[1] > best[1] ? s : best))[0];
}

/** 主戰鋒輪廓：強化三種型態的刀刃、重盾、流線雙翼特徵 */
function layerShape(kind: TopKind, scale: number): THREE.Shape {
  const shape = new THREE.Shape();
  const steps = 192;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let r: number;
    if (kind === 'Attack') {
      // 三主鉤爪 + 六副鋸齒戰刃
      const f3 = ((t * 3) / (Math.PI * 2)) % 1;
      const f6 = ((t * 6) / (Math.PI * 2)) % 1;
      const hook = Math.pow(f3, 1.85) * 0.24 - (f3 > 0.88 ? (f3 - 0.88) * 1.45 : 0);
      const serration = Math.pow(f6, 2.5) * 0.045;
      r = 0.34 + hook + serration;
    } else if (kind === 'Defense') {
      // 八重厚盾弧甲 + 微凹卸力槽
      const shield = 0.052 * Math.cos(t * 8);
      const notch = -0.018 * Math.pow(Math.max(0, Math.sin(t * 8)), 4);
      r = 0.505 + shield + notch;
    } else {
      // 持久型：雙飛翼流線氣動環 + 四道導風波紋
      const wing = 0.095 * Math.pow(Math.abs(Math.cos(t * 2)), 2.2);
      const wave = 0.025 * Math.sin(t * 4 - 0.4);
      r = 0.43 + wing + wave;
    }
    const x = Math.cos(t) * r * scale;
    const y = Math.sin(t) * r * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/** 上層副戰鋒裝甲輪廓：疊加在主戰鋒之上，營造立體機械／武具層次 */
function subLayerShape(kind: TopKind, scale: number): THREE.Shape {
  const shape = new THREE.Shape();
  const steps = 144;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let r: number;
    if (kind === 'Attack') {
      const f6 = ((t * 6) / (Math.PI * 2)) % 1;
      r = 0.26 + 0.14 * Math.pow(f6, 1.6);
    } else if (kind === 'Defense') {
      r = 0.38 + 0.03 * Math.cos(t * 12);
    } else {
      r = 0.33 + 0.06 * Math.sin(t * 4 + Math.PI / 4);
    }
    const x = Math.cos(t) * r * scale;
    const y = Math.sin(t) * r * scale;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/** 產生旋轉刀光殘影貼圖（純 Canvas 程式繪製，無外部資源） */
function createSpinStreakTexture(sideHex: number, accentHex: number): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;

  const sideCol = new THREE.Color(sideHex);
  const accCol = new THREE.Color(accentHex);
  const sideRgb = `${Math.round(sideCol.r * 255)},${Math.round(sideCol.g * 255)},${Math.round(sideCol.b * 255)}`;
  const accRgb = `${Math.round(accCol.r * 255)},${Math.round(accCol.g * 255)},${Math.round(accCol.b * 255)}`;

  // 環狀底暈
  const rad = g.createRadialGradient(mid, mid, mid * 0.35, mid, mid, mid * 0.98);
  rad.addColorStop(0, 'rgba(0,0,0,0)');
  rad.addColorStop(0.55, `rgba(${sideRgb},0.22)`);
  rad.addColorStop(0.8, `rgba(${accRgb},0.55)`);
  rad.addColorStop(0.95, 'rgba(255,255,255,0.35)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);

  // 高速旋轉流光弧線
  for (let i = 0; i < 6; i++) {
    const start = (i / 6) * Math.PI * 2;
    const sweep = 0.55;
    g.strokeStyle = i % 2 === 0 ? `rgba(255,255,255,0.85)` : `rgba(${accRgb},0.9)`;
    g.lineWidth = i % 2 === 0 ? 5 : 8;
    g.beginPath();
    g.arc(mid, mid, mid * (0.68 + (i % 2) * 0.14), start, start + sweep);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const UP = new THREE.Vector3(0, 1, 0);
/** Ref beys were 0.55 radius; scale geometry to the Phase 1 collision radius. */
const S = TOP_RADIUS / 0.55;

export class TopModel {
  readonly root = new THREE.Group();
  readonly kind: TopKind;
  readonly accent: THREE.Color;
  private wobble = new THREE.Group();
  private spinner = new THREE.Group();
  private glow: THREE.Mesh;
  private spinStreak: THREE.Mesh;
  private topLight: THREE.PointLight;
  private parts: THREE.Mesh[] = [];
  private angle = 0;
  private precession = Math.random() * Math.PI * 2;
  private topple = 0;
  private fallY = 0;
  private fallVy = 0;
  private outPos: { x: number; z: number } | null = null;
  private outVel = { x: 0, z: 0 };
  burst = false;

  constructor(kind: TopKind, sideColor: number) {
    this.kind = kind;
    const palette = KIND_COLORS[kind];
    this.accent = new THREE.Color(palette.accent);

    const silverMetal = new THREE.MeshStandardMaterial({ color: 0xcfd8e6, metalness: 0.96, roughness: 0.18 });
    const heavySteel = new THREE.MeshStandardMaterial({ color: 0x7a8496, metalness: 0.9, roughness: 0.3 });
    const bronzeGold = new THREE.MeshStandardMaterial({ color: 0xd8a84e, metalness: 0.88, roughness: 0.24 });
    const bodyMat = new THREE.MeshStandardMaterial({ color: palette.body, metalness: 0.48, roughness: 0.28 });
    const subBodyMat = new THREE.MeshStandardMaterial({ color: palette.sub, metalness: 0.55, roughness: 0.32 });
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x1e2129, metalness: 0.45, roughness: 0.48 });
    const chipMat = new THREE.MeshStandardMaterial({
      color: sideColor,
      emissive: sideColor,
      emissiveIntensity: 0.75,
      metalness: 0.3,
      roughness: 0.25,
    });
    const accentGlowMat = new THREE.MeshStandardMaterial({
      color: palette.accent,
      emissive: palette.accent,
      emissiveIntensity: 0.55,
      metalness: 0.4,
      roughness: 0.2,
    });

    // 1. 運命軸（金屬尖端 + 穩定軸環 + 軸座）
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.11 * S, 0.22 * S, 20).rotateX(Math.PI), silverMetal);
    tip.position.y = 0.11 * S;

    const tipCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.17 * S, 0.11 * S, 0.08 * S, 20), bronzeGold);
    tipCollar.position.y = 0.23 * S;

    const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.3 * S, 0.15 * S, 0.18 * S, 24), darkMat);
    driver.position.y = 0.34 * S;

    // 2. 國本配重盤（下層齒環 + 主重金屬盤 + 8 顆立體鉚釘）
    const underDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.46 * S, 0.34 * S, 0.06 * S, 12), heavySteel);
    underDisk.position.y = 0.43 * S;

    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.51 * S, 0.48 * S, 0.08 * S, 40), silverMetal);
    disk.position.y = 0.49 * S;

    const rivetGeo = new THREE.CylinderGeometry(0.024 * S, 0.024 * S, 0.095 * S, 8);
    const rivetGeos: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const g = rivetGeo.clone();
      g.translate(Math.cos(a) * 0.45 * S, 0.49 * S, Math.sin(a) * 0.45 * S);
      rivetGeos.push(g);
    }
    const rivets = new THREE.Mesh(mergeBufferGeometriesSimple(rivetGeos), bronzeGold);
    rivetGeo.dispose();
    for (const g of rivetGeos) g.dispose();

    // 3. 主戰鋒層（Attack / Defense / Stamina 專屬造型）
    const layer = new THREE.Mesh(
      new THREE.ExtrudeGeometry(layerShape(kind, S), {
        depth: 0.1 * S,
        bevelEnabled: true,
        bevelSize: 0.024 * S,
        bevelThickness: 0.024 * S,
        bevelSegments: 2,
      }).rotateX(-Math.PI / 2),
      bodyMat,
    );
    layer.position.y = 0.53 * S;

    // 4. 上層副戰鋒裝甲（交錯角度疊加，增加金屬立體感）
    const subLayer = new THREE.Mesh(
      new THREE.ExtrudeGeometry(subLayerShape(kind, S), {
        depth: 0.055 * S,
        bevelEnabled: true,
        bevelSize: 0.015 * S,
        bevelThickness: 0.015 * S,
        bevelSegments: 2,
      }).rotateX(-Math.PI / 2),
      subBodyMat,
    );
    subLayer.position.y = 0.63 * S;
    subLayer.rotation.y = Math.PI / 6;

    // 5. 外圍金屬戰氣環（Torus）
    const bladeRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.39 * S, 0.022 * S, 10, 48).rotateX(Math.PI / 2),
      bronzeGold,
    );
    bladeRing.position.y = 0.63 * S;

    // 6. 陣營聖獸紋章（八角銅金底座 + P1朱/P2青發光核心 + 十字金屬戰紋）
    const chipBezel = new THREE.Mesh(new THREE.CylinderGeometry(0.22 * S, 0.25 * S, 0.05 * S, 8), bronzeGold);
    chipBezel.position.y = 0.69 * S;

    const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.165 * S, 0.18 * S, 0.065 * S, 24), chipMat);
    chip.position.y = 0.72 * S;

    const stripeMain = new THREE.Mesh(
      new THREE.BoxGeometry(0.36 * S, 0.022 * S, 0.055 * S),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    stripeMain.position.y = 0.755 * S;

    const stripeCross = new THREE.Mesh(
      new THREE.BoxGeometry(0.055 * S, 0.02 * S, 0.32 * S),
      accentGlowMat,
    );
    stripeCross.position.y = 0.752 * S;

    for (const m of [
      tip,
      tipCollar,
      driver,
      underDisk,
      disk,
      rivets,
      layer,
      subLayer,
      bladeRing,
      chipBezel,
      chip,
      stripeMain,
      stripeCross,
    ]) {
      m.castShadow = true;
      m.receiveShadow = true;
      this.spinner.add(m);
      this.parts.push(m);
    }

    // 7. 自旋高光刀風環（隨轉速顯現的動態旋轉光影）
    const streakTex = createSpinStreakTexture(sideColor, palette.accent);
    this.spinStreak = new THREE.Mesh(
      new THREE.RingGeometry(0.22 * S, 0.68 * S, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        map: streakTex,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.spinStreak.position.y = 0.61 * S;
    this.spinner.add(this.spinStreak);

    // 8. 腳底陣營氣場光環
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.42 * S, 0.86 * S, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: sideColor,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.position.y = 0.04;

    // 9. 跟隨陀螺的動態點光源（令擂台宣紙地面產生即時色彩光影跟隨）
    this.topLight = new THREE.PointLight(sideColor, 1.8, 3.2, 1.6);
    this.topLight.position.set(0, 0.55 * S, 0);

    this.wobble.add(this.spinner);
    this.root.add(this.wobble, this.glow, this.topLight);
    this.root.visible = false;
  }

  get position(): THREE.Vector3 {
    return this.root.position;
  }

  reset(): void {
    this.topple = 0;
    this.fallY = 0;
    this.fallVy = 0;
    this.outPos = null;
  }

  /** Detach parts into the scene as debris (visual only). */
  doBurst(scene: THREE.Scene): THREE.Mesh[] {
    this.burst = true;
    this.glow.visible = false;
    this.spinStreak.visible = false;
    this.topLight.intensity = 0;
    for (const p of this.parts) scene.attach(p);
    return this.parts;
  }

  update(body: Body, dt: number, lifted: boolean, showGlow: boolean): void {
    if (this.burst) return;
    this.root.visible = true;
    if (body.out === 'ring' && !this.outPos) {
      this.outPos = { ...body.pos };
      const r0 = Math.hypot(body.pos.x, body.pos.z) || 1;
      const ux = body.pos.x / r0;
      const uz = body.pos.z / r0;
      const vr = body.vel.x * ux + body.vel.z * uz;
      this.outVel = { x: body.vel.x + ux * Math.max(0, 3.5 - vr), z: body.vel.z + uz * Math.max(0, 3.5 - vr) };
      this.fallVy = 3;
    }
    if (this.outPos) {
      this.outPos.x += this.outVel.x * dt;
      this.outPos.z += this.outVel.z * dt;
      this.outVel.x *= 0.99;
      this.outVel.z *= 0.99;
    }
    const p = this.outPos ?? body.pos;
    const r = Math.hypot(p.x, p.z);
    const frac = body.params.spin0 > 0 ? Math.max(0, Math.min(1.25, body.spin / body.params.spin0)) : 0;
    const glowMat = this.glow.material as THREE.MeshBasicMaterial;
    const streakMat = this.spinStreak.material as THREE.MeshBasicMaterial;
    this.glow.visible = showGlow;
    this.spinStreak.visible = showGlow;
    this.topLight.visible = showGlow;

    if (lifted) {
      this.angle += dt * 1.2;
      this.spinner.rotation.y = this.angle;
      this.wobble.rotation.set(0, 0, 0);
      this.root.quaternion.identity();
      this.root.position.set(body.pos.x, visualHeight(r) + 1.2 + Math.sin(performance.now() / 300) * 0.06, body.pos.z);
      glowMat.opacity = 0.18;
      streakMat.opacity = 0.12;
      this.topLight.intensity = showGlow ? 0.6 : 0;
      return;
    }

    if (body.out === 'ring') {
      this.fallVy -= 22 * dt;
      this.fallY += this.fallVy * dt;
      const floor = r < RIM_RADIUS + LIP_WIDTH ? 0 : TABLE_Y - RIM_Y;
      if (this.fallY < floor) {
        this.fallY = floor;
        this.fallVy = 0;
      }
    }

    const stopped = body.out === 'spin';
    // 0.4.5-3d: 加快視覺自轉角速度，配合多層次刀刃與流光環呈現凌厲轉速感
    this.angle += (stopped ? 0 : 10 + 78 * frac) * dt;
    this.spinner.rotation.y = this.angle;

    const slope = r < BOWL_RADIUS && body.out !== 'ring' ? 2 * BOWL_VISUAL_K * r : 0;
    const normal = new THREE.Vector3(r > 1e-4 ? (-slope * p.x) / r : 0, 1, r > 1e-4 ? (-slope * p.z) / r : 0).normalize();
    this.root.quaternion.setFromUnitVectors(UP, normal);

    if (stopped) this.topple = Math.min(1.15, this.topple + dt * 2.5);
    const tilt = stopped ? this.topple : 0.03 + 0.55 * Math.pow(Math.max(0, 1 - frac), 3);
    if (!stopped) this.precession += (2 + 12 * Math.max(0, 1 - frac)) * dt;
    this.wobble.rotation.set(Math.cos(this.precession) * tilt, 0, Math.sin(this.precession) * tilt);

    const y = body.out === 'ring' ? RIM_Y + this.fallY : visualHeight(r);
    this.root.position.set(p.x, y, p.z);

    const activeAlpha = stopped || body.out === 'ring' ? 0 : frac;
    glowMat.opacity = stopped ? 0 : 0.14 + 0.6 * activeAlpha;
    this.glow.scale.setScalar(0.82 + 0.45 * activeAlpha);

    // 刀光殘影與跟隨動光強度隨 spinFrac 動態變化
    streakMat.opacity = stopped ? 0 : Math.min(0.92, Math.pow(activeAlpha, 0.75) * 0.85);
    this.spinStreak.scale.setScalar(0.92 + 0.2 * activeAlpha);
    this.topLight.intensity = showGlow && !stopped && body.out !== 'ring' ? 0.5 + 2.2 * activeAlpha : 0;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.geometry.dispose();
    (this.glow.material as THREE.Material).dispose();
    this.spinStreak.geometry.dispose();
    const sm = this.spinStreak.material as THREE.MeshBasicMaterial;
    sm.map?.dispose();
    sm.dispose();
    this.topLight.dispose();
    for (const p of this.parts) {
      p.removeFromParent();
      p.geometry.dispose();
    }
  }
}

/** 輕量合併同材質 BufferGeometry（用於國本盤 8 顆鉚釘，零外部依賴） */
function mergeBufferGeometriesSimple(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : 0;
  }
  const pos = new Float32Array(totalVerts * 3);
  const norm = new Float32Array(totalVerts * 3);
  const idx = new Uint32Array(totalIdx);
  let vOffset = 0;
  let iOffset = 0;
  for (const g of geos) {
    const pAttr = g.attributes.position as THREE.BufferAttribute;
    const nAttr = g.attributes.normal as THREE.BufferAttribute;
    pos.set(pAttr.array as Float32Array, vOffset * 3);
    norm.set(nAttr.array as Float32Array, vOffset * 3);
    if (g.index) {
      const iArr = g.index.array;
      for (let j = 0; j < iArr.length; j++) idx[iOffset + j] = iArr[j] + vOffset;
      iOffset += iArr.length;
    }
    vOffset += pAttr.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
