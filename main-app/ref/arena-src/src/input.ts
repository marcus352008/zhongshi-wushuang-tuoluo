import * as THREE from 'three';

export class Input {
  private keys = new Set<string>();
  private joy = new THREE.Vector2();
  private actionHeld = false;
  private actionPressed = false;
  private actionReleased = false;
  private dashPressed = false;

  constructor(joystick: HTMLElement, knob: HTMLElement, actionBtn: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') {
        e.preventDefault();
        this.setAction(true);
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ') this.dashPressed = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.setAction(false);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.setAction(false);
    });

    actionBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      actionBtn.setPointerCapture(e.pointerId);
      this.setAction(true);
    });
    const release = () => this.setAction(false);
    actionBtn.addEventListener('pointerup', release);
    actionBtn.addEventListener('pointercancel', release);

    let joyId: number | null = null;
    const updateJoy = (e: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      const max = rect.width / 2;
      let dx = e.clientX - (rect.left + max);
      let dy = e.clientY - (rect.top + max);
      const len = Math.hypot(dx, dy);
      if (len > max) {
        dx = (dx / len) * max;
        dy = (dy / len) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy.set(dx / max, dy / max);
    };
    joystick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyId = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      updateJoy(e);
    });
    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId === joyId) updateJoy(e);
    });
    const endJoy = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.joy.set(0, 0);
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', endJoy);
    joystick.addEventListener('pointercancel', endJoy);
  }

  private setAction(down: boolean): void {
    if (down && !this.actionHeld) this.actionPressed = true;
    if (!down && this.actionHeld) this.actionReleased = true;
    this.actionHeld = down;
  }

  /** Steering in world XZ (x = right, y = toward camera). */
  steer(): THREE.Vector2 {
    const v = new THREE.Vector2();
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) v.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) v.x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) v.y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) v.y += 1;
    v.add(this.joy);
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  get held(): boolean {
    return this.actionHeld;
  }

  /** Returns edge-triggered input since the last call. */
  consume(): { pressed: boolean; released: boolean; dash: boolean } {
    const r = { pressed: this.actionPressed, released: this.actionReleased, dash: this.dashPressed };
    this.actionPressed = this.actionReleased = this.dashPressed = false;
    return r;
  }
}
