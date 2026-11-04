/**
 * 0.4.5-3d:
 * 1. Sparks: 擴充粒子池至 900，強化碰撞火花密度與亮度漸層。
 * 2. Debris: 保持原有爆裂碎片物理與接口。
 * 3. OrbitTrails: 新增公轉／自旋跟隨光帶（Ribbon Mesh），隨 spinFrac 與速度變化，停轉／lifted／out 自動淡出。
 * 4. Shockwaves: 新增碰撞／撞牆擴散衝擊波環與瞬間閃光球（純視覺，不影響物理）。
 */
import * as THREE from 'three';
import type { Body } from '../physics/world';

const MAX_SPARKS = 900;

export class Sparks {
  readonly points: THREE.Points;
  private positions = new Float32Array(MAX_SPARKS * 3);
  private colors = new Float32Array(MAX_SPARKS * 3);
  private velocities = new Float32Array(MAX_SPARKS * 3);
  private life = new Float32Array(MAX_SPARKS);
  private maxLife = new Float32Array(MAX_SPARKS);
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.15,
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
    this.positions.fill(-999);
  }

  emit(at: THREE.Vector3, count: number, color: THREE.Color, speed = 6): void {
    const white = new THREE.Color(0xffffff);
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_SPARKS;
      const jitter = 0.06;
      this.positions.set(
        [
          at.x + (Math.random() - 0.5) * jitter,
          at.y + (Math.random() - 0.5) * jitter,
          at.z + (Math.random() - 0.5) * jitter,
        ],
        i * 3,
      );
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 1.15);
      const up = 1.2 + Math.random() * speed * 0.75;
      this.velocities.set([Math.cos(a) * s, up, Math.sin(a) * s], i * 3);
      const c = color.clone().lerp(white, 0.25 + Math.random() * 0.55);
      this.colors.set([c.r, c.g, c.b], i * 3);
      const dur = 0.28 + Math.random() * 0.45;
      this.life[i] = dur;
      this.maxLife[i] = dur;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.velocities[o] *= 1 - 1.2 * dt;
      this.velocities[o + 1] -= 19 * dt;
      this.velocities[o + 2] *= 1 - 1.2 * dt;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      const ratio = Math.max(0, Math.min(1, this.life[i] / (this.maxLife[i] || 0.4)));
      const fade = Math.pow(ratio, 0.65);
      this.colors[o] *= 0.96 + 0.04 * fade;
      this.colors[o + 1] *= 0.93 + 0.07 * fade;
      this.colors[o + 2] *= 0.89 + 0.11 * fade;
      if (this.life[i] <= 0) this.positions[o + 1] = -999;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

interface Piece {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
}

export class Debris {
  private pieces: Piece[] = [];

  add(meshes: THREE.Mesh[], baseVel: THREE.Vector2): void {
    for (const mesh of meshes) {
      const a = Math.random() * Math.PI * 2;
      this.pieces.push({
        mesh,
        vel: new THREE.Vector3(
          baseVel.x * 0.5 + Math.cos(a) * (2 + Math.random() * 3),
          5 + Math.random() * 4,
          baseVel.y * 0.5 + Math.sin(a) * (2 + Math.random() * 3),
        ),
        spin: new THREE.Vector3(Math.random() * 20 - 10, Math.random() * 20 - 10, Math.random() * 20 - 10),
      });
    }
  }

  update(dt: number, groundAt: (x: number, z: number) => number): void {
    for (const p of this.pieces) {
      p.vel.y -= 22 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      const g = groundAt(p.mesh.position.x, p.mesh.position.z) + 0.05;
      if (p.mesh.position.y < g) {
        p.mesh.position.y = g;
        p.vel.y = Math.abs(p.vel.y) * 0.35;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
        p.spin.multiplyScalar(0.7);
      }
    }
  }

  clear(): void {
    for (const p of this.pieces) {
      p.mesh.removeFromParent();
      p.mesh.geometry.dispose();
    }
    this.pieces = [];
  }
}

/** 單一陀螺的運動軌跡光帶（Ribbon）資料 */
interface TrailStrip {
  mesh: THREE.Mesh;
  positions: Float32Array;
  colors: Float32Array;
  history: { x: number; y: number; z: number; alpha: number }[];
  baseColor: THREE.Color;
  accentColor: THREE.Color;
}

const TRAIL_SEGMENTS = 28;

/**
 * 陀螺公轉／自旋跟隨光影軌跡（OrbitTrails）：
 * 以雙頂點 Ribbon Mesh 繪製流暢的刀氣／陣營光尾，強度隨 spinFrac 與移動速度變化。
 */
export class OrbitTrails {
  readonly group = new THREE.Group();
  private strips: TrailStrip[] = [];

  constructor(sideColors: readonly [number, number]) {
    const accents = [0xffc861, 0x80e8ff];
    for (let s = 0; s < 2; s++) {
      const vertCount = TRAIL_SEGMENTS * 2;
      const positions = new Float32Array(vertCount * 3);
      const colors = new Float32Array(vertCount * 3);
      const indices: number[] = [];
      for (let i = 0; i < TRAIL_SEGMENTS - 1; i++) {
        const a = i * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        indices.push(a, b, c, b, d, c);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      geo.setIndex(indices);

      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      this.group.add(mesh);

      this.strips.push({
        mesh,
        positions,
        colors,
        history: [],
        baseColor: new THREE.Color(sideColors[s]),
        accentColor: new THREE.Color(accents[s]),
      });
    }
  }

  setAccent(index: number, accent: THREE.Color): void {
    if (this.strips[index]) {
      this.strips[index].accentColor.copy(accent);
    }
  }

  clear(): void {
    for (const st of this.strips) {
      st.history.length = 0;
      st.positions.fill(0);
      st.colors.fill(0);
      st.mesh.geometry.attributes.position.needsUpdate = true;
      st.mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  update(
    bodies: readonly Body[],
    dt: number,
    lifted: boolean,
    enabled: boolean,
    groundAt: (r: number) => number,
  ): void {
    this.group.visible = enabled;
    if (!enabled) return;

    for (let s = 0; s < 2; s++) {
      const st = this.strips[s];
      const b = bodies[s];
      if (!b || lifted) {
        if (st.history.length > 0) this.clearStrip(st);
        continue;
      }

      const spinFrac = b.params.spin0 > 0 ? Math.max(0, Math.min(1.2, b.spin / b.params.spin0)) : 0;
      const active = b.out === null && spinFrac > 0.04;
      const r = Math.hypot(b.pos.x, b.pos.z);
      const y = groundAt(r) + 0.14;

      if (active) {
        const speed = Math.hypot(b.vel.x, b.vel.z);
        const speedFactor = Math.min(1, 0.35 + speed / 6);
        const headAlpha = Math.min(1, spinFrac * speedFactor * 1.15);

        // 加入最新位置節點（同時加入微小自旋擾動令光帶更具動感）
        const swirl = performance.now() * 0.025 + s * Math.PI;
        const jx = Math.cos(swirl) * 0.03 * spinFrac;
        const jz = Math.sin(swirl) * 0.03 * spinFrac;
        st.history.unshift({ x: b.pos.x + jx, y, z: b.pos.z + jz, alpha: headAlpha });
        if (st.history.length > TRAIL_SEGMENTS) st.history.pop();
      } else {
        // 停轉或飛出時快速淡出歷史軌跡
        for (const pt of st.history) pt.alpha *= Math.exp(-dt * 10);
        if (st.history.length > 0 && st.history[0].alpha < 0.02) {
          this.clearStrip(st);
          continue;
        }
      }

      // 衰減尾端透明度
      for (let i = 1; i < st.history.length; i++) {
        st.history[i].alpha *= Math.exp(-dt * 2.5);
      }

      this.rebuildRibbon(st, spinFrac);
    }
  }

  private clearStrip(st: TrailStrip): void {
    st.history.length = 0;
    st.positions.fill(0);
    st.colors.fill(0);
    st.mesh.geometry.attributes.position.needsUpdate = true;
    st.mesh.geometry.attributes.color.needsUpdate = true;
  }

  private rebuildRibbon(st: TrailStrip, spinFrac: number): void {
    const len = st.history.length;
    if (len < 2) {
      st.positions.fill(0);
      st.colors.fill(0);
      st.mesh.geometry.attributes.position.needsUpdate = true;
      st.mesh.geometry.attributes.color.needsUpdate = true;
      return;
    }

    const maxHalfWidth = 0.24 * (0.65 + 0.45 * spinFrac);
    const tmpColor = new THREE.Color();

    for (let i = 0; i < TRAIL_SEGMENTS; i++) {
      const idx = Math.min(i, len - 1);
      const curr = st.history[idx];
      const prev = st.history[Math.max(0, idx - 1)];
      const next = st.history[Math.min(len - 1, idx + 1)];

      let tx = curr.x - next.x;
      let tz = curr.z - next.z;
      if (idx === len - 1) {
        tx = prev.x - curr.x;
        tz = prev.z - curr.z;
      }
      const tLen = Math.hypot(tx, tz) || 1;
      const nx = -tz / tLen;
      const nz = tx / tLen;

      const t = i / (TRAIL_SEGMENTS - 1);
      const taper = Math.sin((1 - t) * Math.PI * 0.5) * (1 - t * 0.65);
      const w = maxHalfWidth * taper;

      const v0 = i * 6;
      st.positions[v0] = curr.x + nx * w;
      st.positions[v0 + 1] = curr.y + 0.03 * (1 - t);
      st.positions[v0 + 2] = curr.z + nz * w;

      st.positions[v0 + 3] = curr.x - nx * w;
      st.positions[v0 + 4] = curr.y - 0.02 * (1 - t);
      st.positions[v0 + 5] = curr.z - nz * w;

      // 前端偏亮色 accent，中後段過渡至陣營主色並淡出為 0（Additive 下黑色即完全透明）
      const intensity = Math.pow(1 - t, 1.35) * curr.alpha;
      tmpColor.copy(st.accentColor).lerp(st.baseColor, Math.min(1, t * 1.4)).multiplyScalar(intensity);

      st.colors[v0] = tmpColor.r;
      st.colors[v0 + 1] = tmpColor.g;
      st.colors[v0 + 2] = tmpColor.b;
      st.colors[v0 + 3] = tmpColor.r;
      st.colors[v0 + 4] = tmpColor.g;
      st.colors[v0 + 5] = tmpColor.b;
    }

    st.mesh.geometry.attributes.position.needsUpdate = true;
    st.mesh.geometry.attributes.color.needsUpdate = true;
  }
}

interface ActiveWave {
  ring: THREE.Mesh;
  flash: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

/**
 * 碰撞與撞牆衝擊波特效（Shockwaves）：
 * 每次交鋒產生急速擴張的光環與中心白熱閃光球。
 */
export class Shockwaves {
  readonly group = new THREE.Group();
  private pool: ActiveWave[] = [];
  private ringGeo = new THREE.RingGeometry(0.18, 0.34, 36).rotateX(-Math.PI / 2);
  private flashGeo = new THREE.SphereGeometry(0.22, 16, 12);

  spawn(at: THREE.Vector3, color: THREE.Color, intensity = 1): void {
    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const ring = new THREE.Mesh(this.ringGeo, ringMat);
    ring.position.copy(at);
    // 隨機微傾角，令多次連擊時的衝擊波更有立體刀風感
    ring.rotation.x = (Math.random() - 0.5) * 0.35;
    ring.rotation.z = (Math.random() - 0.5) * 0.35;

    const flash = new THREE.Mesh(this.flashGeo, flashMat);
    flash.position.copy(at);

    this.group.add(ring, flash);
    const maxLife = 0.22 + 0.12 * Math.min(1.5, intensity);
    this.pool.push({
      ring,
      flash,
      life: maxLife,
      maxLife,
      maxScale: 2.2 + 2.4 * Math.min(1.5, intensity),
    });
  }

  update(dt: number): void {
    for (let i = this.pool.length - 1; i >= 0; i--) {
      const w = this.pool[i];
      w.life -= dt;
      if (w.life <= 0) {
        w.ring.removeFromParent();
        w.flash.removeFromParent();
        (w.ring.material as THREE.Material).dispose();
        (w.flash.material as THREE.Material).dispose();
        this.pool.splice(i, 1);
        continue;
      }
      const p = 1 - w.life / w.maxLife;
      const easeOut = 1 - Math.pow(1 - p, 2.4);
      w.ring.scale.setScalar(0.5 + easeOut * w.maxScale);
      (w.ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - p, 1.5) * 0.9;

      const flashFade = Math.max(0, 1 - p * 2.5);
      w.flash.scale.setScalar(0.6 + p * 1.8);
      (w.flash.material as THREE.MeshBasicMaterial).opacity = flashFade * 0.85;
    }
  }

  clear(): void {
    for (const w of this.pool) {
      w.ring.removeFromParent();
      w.flash.removeFromParent();
      (w.ring.material as THREE.Material).dispose();
      (w.flash.material as THREE.Material).dispose();
    }
    this.pool.length = 0;
  }
}
