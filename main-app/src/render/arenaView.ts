/**
 * 0.4.5-3d:
 * Three.js render layer only: reads physics state, never writes it.
 * 新增 OrbitTrails（公轉／自旋跟隨光影軌跡）與 Shockwaves（碰撞／撞牆衝擊波環 + 核心閃光），
 * 並強化對撞火花密度與鏡頭震動回饋。低畫質（hiQuality === false）自動關閉高耗能粒子與光帶。
 */
import * as THREE from 'three';
import {
  BURST_FX_ENABLED,
  GAP_SPIN_RAD_PER_SEC,
  HIGH_GFX_MAX_PIXEL_RATIO,
  LIP_WIDTH,
  LOW_GFX_MAX_PIXEL_RATIO,
  RIM_RADIUS,
  SHADOW_MAP_SIZE,
  TOP_RADIUS,
} from '../config/balance';
import type { Vec2 } from '../core/vec';
import type { Body, StepResult } from '../physics/world';
import type { FusedStats } from '../rules/fuse';
import { Debris, OrbitTrails, Shockwaves, Sparks } from './effects';
import { createStadium, RIM_Y, TABLE_Y, visualHeight } from './stadium';
import type { SkillType } from '../game/specials';
import { kindFromFused, TopModel } from './topModel';

export const SLOT_COLORS = { A: 0xd9443a, B: 0x3a7bd5, C: 0xe0b040 } as const;
/** P1 朱／P2 青 — 同 HUD --p1/--p2 對齊，敵我分明。 */
export const SIDE_COLORS = [0xe53935, 0x1e88e5] as const;

const SPARK_GOLD = new THREE.Color(0xffc861);
const SPARK_CRIMSON = new THREE.Color(0xff5242);
const SPARK_WHITE = new THREE.Color(0xffffff);
const SPARK_WALL = new THREE.Color(0xff9d5c);
const SPECIAL_COLORS: Record<SkillType, THREE.Color> = {
  attack: new THREE.Color(0xff3344),
  guard: new THREE.Color(0x33e0ff),
  heal: new THREE.Color(0x44ff88),
};

export class ArenaView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  private renderer!: THREE.WebGLRenderer;
  private container: HTMLElement;
  private sun: THREE.DirectionalLight;
  private tops: TopModel[] = [];
  private nameTags: [HTMLElement, HTMLElement];
  private nameTagLayer: HTMLElement;
  private sideNames: [string, string] = ['你', '對手'];
  private sparks = new Sparks();
  private debris = new Debris();
  private trails = new OrbitTrails(SIDE_COLORS);
  private shockwaves = new Shockwaves();
  private aim: THREE.Group;
  private aimArc: THREE.Line;
  private camBase = new THREE.Vector3();
  private camTarget = new THREE.Vector3(0, 0.3, 0.9);
  private shake = 0;
  private last = performance.now();
  /** Rotatable wall+gap group; rotation synced to physics gap spin. */
  private rimGaps: THREE.Group | null = null;
  hiQuality = true;

  constructor(container: HTMLElement, hiQuality = true) {
    this.container = container;
    this.nameTagLayer = document.createElement('div');
    this.nameTagLayer.className = 'top-name-layer';
    this.container.appendChild(this.nameTagLayer);
    const tags = ([0, 1] as const).map((s) => {
      const el = document.createElement('div');
      el.className = `top-name-tag ${s === 0 ? 'p1' : 'p2'}`;
      el.textContent = this.sideNames[s];
      this.nameTagLayer.appendChild(el);
      return el;
    });
    this.nameTags = [tags[0], tags[1]];
    this.scene.background = new THREE.Color(0x05070f);
    this.scene.fog = new THREE.Fog(0x05070f, 22, 45);

    this.scene.add(new THREE.HemisphereLight(0x9fb8ff, 0x1a1030, 0.9));
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.position.set(4, 14, 6);
    this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -9;
    sc.right = sc.top = 9;
    this.scene.add(this.sun);
    const rim = new THREE.PointLight(0x5fd4ff, 30, 30);
    rim.position.set(0, 6, -8);
    this.scene.add(rim);

    this.rimGaps = createStadium(this.scene);
    this.scene.add(this.trails.group);
    this.scene.add(this.shockwaves.group);
    this.scene.add(this.sparks.points);

    this.aim = new THREE.Group();
    const aimMat = new THREE.MeshBasicMaterial({ color: SIDE_COLORS[0] });
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 1.6), aimMat);
    shaft.position.z = -0.8 - TOP_RADIUS;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.5, 3).rotateX(-Math.PI / 2), aimMat);
    head.position.z = -1.6 - TOP_RADIUS - 0.2;
    this.aim.add(shaft, head);
    this.aim.visible = false;
    this.scene.add(this.aim);
    this.aimArc = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.15, gapSize: 0.1, transparent: true, opacity: 0.6 }),
    );
    this.aimArc.visible = false;
    this.scene.add(this.aimArc);

    this.setQuality(hiQuality);
    window.addEventListener('resize', () => this.resize());
  }

  setQuality(hi: boolean): void {
    this.hiQuality = hi;
    if (this.renderer) {
      this.renderer.domElement.remove();
      this.renderer.dispose();
    }
    this.renderer = new THREE.WebGLRenderer({ antialias: hi });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, hi ? HIGH_GFX_MAX_PIXEL_RATIO : LOW_GFX_MAX_PIXEL_RATIO));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = hi;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = hi;
    this.sparks.points.visible = hi;
    this.trails.group.visible = hi;
    this.shockwaves.group.visible = hi;
    if (!hi) {
      this.trails.clear();
      this.shockwaves.clear();
    }
    this.container.appendChild(this.renderer.domElement);
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const k = Math.max(1, 1.45 / this.camera.aspect);
    this.camBase.set(0, 12.6 * k, 10.4 * k);
  }

  /** Build the two top meshes for a match; style follows each side's fused stats. */
  setSides(fused: [FusedStats, FusedStats]): void {
    this.clearTops();
    this.tops = fused.map((f, i) => {
      const t = new TopModel(kindFromFused(f), SIDE_COLORS[i]);
      this.trails.setAccent(i, t.accent);
      this.scene.add(t.root);
      return t;
    });
  }

  /** 陀螺上方玩家名（發射前後／fight 都跟住）。 */
  setSideNames(names: [string, string]): void {
    this.sideNames = [names[0] || '你', names[1] || '對手'];
    this.nameTags[0].textContent = this.sideNames[0];
    this.nameTags[1].textContent = this.sideNames[1];
  }

  private clearTops(): void {
    for (const t of this.tops) t.dispose();
    this.tops = [];
    this.debris.clear();
    this.trails.clear();
    this.shockwaves.clear();
  }

  resetTops(): void {
    this.debris.clear();
    this.trails.clear();
    this.shockwaves.clear();
    // Burst detaches parts permanently, so rebuild burst tops; others just reset fall/topple state.
    this.tops.forEach((t, i) => {
      if (t.burst) {
        t.dispose();
        const fresh = new TopModel(t.kind, SIDE_COLORS[i]);
        this.trails.setAccent(i, fresh.accent);
        this.scene.add(fresh.root);
        this.tops[i] = fresh;
      } else {
        t.reset();
      }
    });
  }

  hideTops(): void {
    for (const t of this.tops) t.root.visible = false;
    this.trails.clear();
    this.shockwaves.clear();
    for (const el of this.nameTags) el.classList.add('hidden');
  }

  /**
   * Sync wall/gap visual rotation to physics time.
   * Three.js +Y rotation decreases atan2(z,x), so use negative spin offset.
   */
  setGapSpin(tSec: number): void {
    if (!this.rimGaps) return;
    this.rimGaps.rotation.y = -GAP_SPIN_RAD_PER_SEC * tSec;
  }

  /** Draw bodies. When `lifted` is set, tops hover above their launch spots. */
  update(bodies: readonly Body[], dt: number, lifted = false): void {
    bodies.forEach((b, i) => this.tops[i]?.update(b, dt, lifted, this.hiQuality));
    this.trails.update(bodies, dt, lifted, this.hiQuality, visualHeight);
  }

  /** Physics step feedback: 強化版金紅交鋒火花 + 擴散衝擊波環 + 更有力鏡頭震動（只讀 StepResult，絕不寫入物理）。 */
  onStep(step: StepResult): void {
    for (const c of step.collisions) {
      const impact = c.received[0] + c.received[1];
      const rel = c.relSpeed ?? impact;
      const k = Math.min(1.5, Math.max(impact / 8, rel / 10));
      const p = new THREE.Vector3(c.point.x, visualHeight(Math.hypot(c.point.x, c.point.z)) + 0.36, c.point.z);
      if (this.hiQuality) {
        // 主金火花 + 朱紅烈焰火花 + 白熱核心粒子
        this.sparks.emit(p, Math.round(28 + k * 75), SPARK_GOLD, 5.5 + k * 7.5);
        this.sparks.emit(p, Math.round(14 + k * 35), SPARK_CRIMSON, 4.5 + k * 6.5);
        this.sparks.emit(p, Math.round(10 + k * 20), SPARK_WHITE, 7 + k * 5);
        // 雙層衝擊波光環
        this.shockwaves.spawn(p, SPARK_GOLD, k);
        if (k > 0.45) {
          this.shockwaves.spawn(p, SPARK_CRIMSON, k * 0.75);
        }
      }
      this.shake = Math.max(this.shake, 0.16 + k * 0.52);
    }
    for (const w of step.walls) {
      const wk = Math.min(1.3, w.impact / 5);
      const wp = new THREE.Vector3(w.point.x, RIM_Y + 0.3, w.point.z);
      if (this.hiQuality) {
        this.sparks.emit(wp, Math.round(16 + w.impact * 9), SPARK_WALL, 4.2 + wk * 4);
        this.sparks.emit(wp, Math.round(6 + w.impact * 4), SPARK_GOLD, 3.5);
        this.shockwaves.spawn(wp, SPARK_WALL, Math.max(0.4, wk * 0.8));
      }
      this.shake = Math.max(this.shake, Math.min(0.38, 0.08 + w.impact * 0.065));
    }
    if (step.newlyOut.length) this.shake = Math.max(this.shake, 0.48);
  }

  /** Particle burst for special activation (P0-5). */
  emitSpecialBurst(skill: SkillType, body?: Body): void {
    this.shake = Math.max(this.shake, 0.55);
    if (!this.hiQuality) return;
    const color = SPECIAL_COLORS[skill];
    const at = body
      ? new THREE.Vector3(body.pos.x, visualHeight(Math.hypot(body.pos.x, body.pos.z)) + 0.4, body.pos.z)
      : new THREE.Vector3(0, 0.5, 0);
    this.sparks.emit(at, 95, color, 10.5);
    this.sparks.emit(at, 45, SPARK_WHITE, 6.5);
    this.shockwaves.spawn(at, color, 1.35);
  }

  launchFx(bodies: readonly Body[]): void {
    this.shake = Math.max(this.shake, 0.32);
    if (!this.hiQuality) return;
    bodies.forEach((b, i) => {
      const t = this.tops[i];
      if (t) {
        const at = new THREE.Vector3(b.pos.x, visualHeight(Math.hypot(b.pos.x, b.pos.z)) + 0.22, b.pos.z);
        this.sparks.emit(at, 42, t.accent, 6);
        this.shockwaves.spawn(at, t.accent, 0.75);
      }
    });
  }

  /** Visual-only burst (BURST_FX_ENABLED is false in Phase 1). */
  burst(index: number, body: Body): void {
    const t = this.tops[index];
    if (!BURST_FX_ENABLED || !t || t.burst) return;
    this.debris.add(t.doBurst(this.scene), new THREE.Vector2(body.vel.x, body.vel.z));
    if (this.hiQuality) {
      const at = t.position.clone();
      this.sparks.emit(at, 110, t.accent, 10);
      this.shockwaves.spawn(at, t.accent, 1.5);
    }
    this.shake = 0.75;
  }

  /** Show the player's aim arrow at `from` pointing along `angle`, plus the allowed arc. */
  showAim(from: Vec2 | null, angle = 0, center = 0, arc = 0): void {
    this.aim.visible = this.aimArc.visible = from !== null;
    if (!from) return;
    const y = visualHeight(Math.hypot(from.x, from.z)) + 0.1;
    this.aim.position.set(from.x, y, from.z);
    // Arrow geometry points along -Z; angle 0 = +X in physics space.
    this.aim.rotation.y = -angle - Math.PI / 2;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = center - arc + (2 * arc * i) / 24;
      pts.push(new THREE.Vector3(from.x + Math.cos(a) * 1.4, y, from.z + Math.sin(a) * 1.4));
    }
    this.aimArc.geometry.setFromPoints(pts);
    this.aimArc.computeLineDistances();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Screen point → XZ position on the bowl's base plane (for drag-to-aim). */
  pickGround(clientX: number, clientY: number): Vec2 | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  render(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.sparks.update(dt);
    this.shockwaves.update(dt);
    this.debris.update(dt, (x, z) => {
      const r = Math.hypot(x, z);
      return r < RIM_RADIUS + LIP_WIDTH ? visualHeight(r) : TABLE_Y;
    });
    // Fixed 3/4 top-down camera; 強化碰撞瞬間震動感並平滑衰減。
    this.shake *= Math.exp(-dt * 6.5);
    const s = this.shake;
    const t = now * 0.06;
    this.camera.position.set(
      this.camBase.x + (Math.sin(t * 1.7) * 0.6 + (Math.random() - 0.5) * 0.8) * s,
      this.camBase.y + (Math.cos(t * 2.3) * 0.5 + (Math.random() - 0.5) * 0.7) * s,
      this.camBase.z + (Math.sin(t * 1.3) * 0.6 + (Math.random() - 0.5) * 0.8) * s,
    );
    this.camera.lookAt(this.camTarget);
    this.syncNameTags();
    this.renderer.render(this.scene, this.camera);
  }

  /** World → screen：陀螺上方名牌。 */
  private syncNameTags(): void {
    const rect = this.canvas.getBoundingClientRect();
    const crect = this.container.getBoundingClientRect();
    const tmp = new THREE.Vector3();
    for (let i = 0; i < 2; i++) {
      const top = this.tops[i];
      const el = this.nameTags[i];
      if (!top || !top.root.visible) {
        el.classList.add('hidden');
        continue;
      }
      tmp.copy(top.position);
      tmp.y += 1.15;
      tmp.project(this.camera);
      if (tmp.z > 1) {
        el.classList.add('hidden');
        continue;
      }
      const x = ((tmp.x + 1) / 2) * rect.width + (rect.left - crect.left);
      const y = ((-tmp.y + 1) / 2) * rect.height + (rect.top - crect.top);
      el.classList.remove('hidden');
      el.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }
}
