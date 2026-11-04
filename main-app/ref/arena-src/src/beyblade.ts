import * as THREE from 'three';
import { ARENA_RADIUS, BEY_RADIUS, LIP_WIDTH, MAX_SPIN, type BeyType } from './config';
import { bowlHeight, bowlSlope } from './stadium';

const UP = new THREE.Vector3(0, 1, 0);
const TABLE_Y = -0.3;

function layerShape(type: BeyType): THREE.Shape {
  const shape = new THREE.Shape();
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    let r: number;
    if (type.kind === 'Attack') {
      const f = ((t * 3) / (Math.PI * 2)) % 1;
      r = 0.36 + 0.22 * Math.pow(f, 2.2);
    } else if (type.kind === 'Defense') {
      r = 0.5 + 0.045 * Math.cos(t * 8);
    } else {
      r = 0.44 + 0.08 * Math.pow(Math.abs(Math.cos(t * 2)), 3);
    }
    const x = Math.cos(t) * r;
    const y = Math.sin(t) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export class Bey {
  readonly type: BeyType;
  readonly root = new THREE.Group();
  readonly wobble = new THREE.Group();
  readonly spinner = new THREE.Group();
  readonly parts: THREE.Mesh[] = [];
  private glow: THREE.Mesh;

  pos = new THREE.Vector2();
  vel = new THREE.Vector2();
  spin = MAX_SPIN;
  radius = BEY_RADIUS;
  angle = 0;
  precession = Math.random() * Math.PI * 2;
  dashCooldown = 0;
  dropOffset = 0;
  launched = false;

  ringedOut = false;
  burst = false;
  stopped = false;
  private outY = 0;
  private outVy = 0;
  private topple = 0;

  constructor(type: BeyType) {
    this.type = type;
    const metal = new THREE.MeshStandardMaterial({ color: 0xb9c3d4, metalness: 0.95, roughness: 0.22 });
    const body = new THREE.MeshStandardMaterial({ color: type.color, metalness: 0.35, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x23262f, metalness: 0.4, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({
      color: type.accent,
      emissive: type.accent,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });

    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 16).rotateX(Math.PI), metal);
    tip.position.y = 0.11;
    const driver = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.12, 0.2, 24), dark);
    driver.position.y = 0.32;
    const disk = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.48, 0.08, 40), metal);
    disk.position.y = 0.46;
    const layerGeo = new THREE.ExtrudeGeometry(layerShape(type), {
      depth: 0.1,
      bevelEnabled: true,
      bevelSize: 0.02,
      bevelThickness: 0.02,
      bevelSegments: 2,
    }).rotateX(-Math.PI / 2);
    const layer = new THREE.Mesh(layerGeo, body);
    layer.position.y = 0.52;
    const chip = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.07, 32), accent);
    chip.position.y = 0.68;
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.02, 0.06),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    stripe.position.y = 0.72;

    for (const m of [tip, driver, disk, layer, chip, stripe]) {
      m.castShadow = true;
      this.spinner.add(m);
      this.parts.push(m);
    }

    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.45, 0.8, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({
        color: type.accent,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glow.position.y = 0.04;

    this.wobble.add(this.spinner);
    this.root.add(this.wobble, this.glow);
  }

  get spinFrac(): number {
    return Math.max(0, this.spin) / MAX_SPIN;
  }

  get active(): boolean {
    return !this.ringedOut && !this.burst && !this.stopped;
  }

  ringOut(): void {
    this.ringedOut = true;
    this.outVy = 3.5;
    this.outY = 0;
    const r = this.pos.length();
    const vr = (this.vel.x * this.pos.x + this.vel.y * this.pos.y) / r;
    if (vr < 4) this.vel.addScaledVector(this.pos, (4 - vr) / r);
  }

  stop(): void {
    this.stopped = true;
    this.spin = 0;
  }

  /** Detaches parts into the scene as debris and returns them. */
  doBurst(scene: THREE.Scene): THREE.Mesh[] {
    this.burst = true;
    this.glow.visible = false;
    const debris: THREE.Mesh[] = [];
    for (const p of this.parts) {
      scene.attach(p);
      debris.push(p);
    }
    return debris;
  }

  updateVisual(dt: number): void {
    const frac = this.spinFrac;
    const r = this.pos.length();

    if (this.ringedOut) {
      this.pos.addScaledVector(this.vel, dt);
      this.vel.multiplyScalar(0.995);
      this.outVy -= 25 * dt;
      this.outY += this.outVy * dt;
      const floorOffset = r < ARENA_RADIUS + LIP_WIDTH ? 0 : TABLE_Y - bowlHeight(ARENA_RADIUS);
      if (this.outY < floorOffset) {
        this.outY = floorOffset;
        this.outVy = 0;
        this.vel.multiplyScalar(0.9);
      }
      this.spin = Math.max(0, this.spin - 40 * dt);
    }

    if (!this.launched) {
      this.angle += dt * 0.8;
      this.spinner.rotation.y = this.angle;
      this.wobble.rotation.set(0, 0, 0);
      this.root.quaternion.identity();
      this.root.position.set(this.pos.x, bowlHeight(r) + this.dropOffset, this.pos.y);
      (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.15;
      return;
    }

    this.angle += (this.stopped ? 0 : 6 + this.spin * 0.55) * dt;
    this.spinner.rotation.y = this.angle;

    const slope = this.ringedOut ? 0 : bowlSlope(r);
    const normal = new THREE.Vector3(r > 1e-4 ? (-slope * this.pos.x) / r : 0, 1, r > 1e-4 ? (-slope * this.pos.y) / r : 0).normalize();
    this.root.quaternion.setFromUnitVectors(UP, normal);

    if (this.stopped) {
      this.topple = Math.min(1.15, this.topple + dt * 2.5);
    }
    const tilt = this.stopped ? this.topple : 0.03 + 0.55 * Math.pow(1 - frac, 3);
    if (!this.stopped) this.precession += (2 + 12 * (1 - frac)) * dt;
    this.wobble.rotation.set(Math.cos(this.precession) * tilt, 0, Math.sin(this.precession) * tilt);

    const y = this.ringedOut ? bowlHeight(ARENA_RADIUS) + this.outY : bowlHeight(r) + this.dropOffset;
    this.root.position.set(this.pos.x, y, this.pos.y);

    const glowMat = this.glow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = this.stopped ? 0 : 0.1 + 0.55 * frac;
    this.glow.scale.setScalar(0.8 + 0.4 * frac);
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.root);
    for (const p of this.parts) {
      p.removeFromParent();
      p.geometry.dispose();
    }
  }
}
