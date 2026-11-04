import * as THREE from 'three';

const MAX_SPARKS = 400;

export class Sparks {
  readonly points: THREE.Points;
  private positions = new Float32Array(MAX_SPARKS * 3);
  private colors = new Float32Array(MAX_SPARKS * 3);
  private velocities = new Float32Array(MAX_SPARKS * 3);
  private life = new Float32Array(MAX_SPARKS);
  private next = 0;

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.points = new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        size: 0.12,
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
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX_SPARKS;
      this.positions.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random());
      this.velocities.set([Math.cos(a) * s, 1 + Math.random() * speed * 0.6, Math.sin(a) * s], i * 3);
      const c = color.clone().lerp(new THREE.Color(0xffffff), Math.random() * 0.5);
      this.colors.set([c.r, c.g, c.b], i * 3);
      this.life[i] = 0.3 + Math.random() * 0.4;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const o = i * 3;
      this.velocities[o + 1] -= 18 * dt;
      this.positions[o] += this.velocities[o] * dt;
      this.positions[o + 1] += this.velocities[o + 1] * dt;
      this.positions[o + 2] += this.velocities[o + 2] * dt;
      const fade = Math.max(0, Math.min(1, this.life[i] * 3));
      this.colors[o] *= 0.97 + 0.03 * fade;
      this.colors[o + 1] *= 0.94 + 0.06 * fade;
      this.colors[o + 2] *= 0.9 + 0.1 * fade;
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
