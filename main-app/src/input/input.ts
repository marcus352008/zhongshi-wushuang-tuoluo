/**
 * Keyboard + on-screen controls. Ported from ref/arena-src/src/input.ts (keyboard set, pointer-capture
 * joystick, hold-to-charge button with edge detection) and split into steer / charge / dash / menu.
 * 0.3.1-specials：新增 special 鍵（E）與 special 按鈕 edge。
 */
import { clampLen, type Vec2 } from '../core/vec';

export interface InputEdges {
  chargePressed: boolean;
  chargeReleased: boolean;
  dash: boolean;
  menu: boolean;
  special: boolean;
}

export class Input {
  private keys = new Set<string>();
  private joy: Vec2 = { x: 0, z: 0 };
  private chargeHeld = false;
  private aimButtons = 0;
  private edges: InputEdges = {
    chargePressed: false,
    chargeReleased: false,
    dash: false,
    menu: false,
    special: false,
  };

  constructor(els: {
    joystick: HTMLElement;
    knob: HTMLElement;
    charge: HTMLElement;
    dash: HTMLElement;
    aimLeft: HTMLElement;
    aimRight: HTMLElement;
    special?: HTMLElement | null;
  }) {
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.setCharge(true);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.edges.dash = true;
      if (e.code === 'Escape') this.edges.menu = true;
      if (e.code === 'KeyE') this.edges.special = true;
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Space') this.setCharge(false);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.setCharge(false);
    });

    holdButton(els.charge, (down) => this.setCharge(down));
    els.dash.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.edges.dash = true;
    });
    if (els.special) {
      els.special.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.edges.special = true;
      });
    }
    holdButton(els.aimLeft, (down) => (this.aimButtons += down ? -1 : 1));
    holdButton(els.aimRight, (down) => (this.aimButtons += down ? 1 : -1));

    const { joystick, knob } = els;
    let joyId: number | null = null;
    const update = (e: PointerEvent) => {
      const rect = joystick.getBoundingClientRect();
      const max = rect.width / 2;
      let dx = e.clientX - (rect.left + max);
      let dy = e.clientY - (rect.top + max);
      const l = Math.hypot(dx, dy);
      if (l > max) {
        dx = (dx / l) * max;
        dy = (dy / l) * max;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.joy = { x: dx / max, z: dy / max };
    };
    joystick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      joyId = e.pointerId;
      joystick.setPointerCapture(e.pointerId);
      update(e);
    });
    joystick.addEventListener('pointermove', (e) => {
      if (e.pointerId === joyId) update(e);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== joyId) return;
      joyId = null;
      this.joy = { x: 0, z: 0 };
      knob.style.transform = '';
    };
    joystick.addEventListener('pointerup', end);
    joystick.addEventListener('pointercancel', end);
  }

  private setCharge(down: boolean): void {
    if (down && !this.chargeHeld) this.edges.chargePressed = true;
    if (!down && this.chargeHeld) this.edges.chargeReleased = true;
    this.chargeHeld = down;
  }

  get charging(): boolean {
    return this.chargeHeld;
  }

  /** World XZ steering (x = right, z = toward camera), length ≤ 1. */
  steer(): Vec2 {
    const k = this.keys;
    const v = { x: this.joy.x, z: this.joy.z };
    if (k.has('KeyA') || k.has('ArrowLeft')) v.x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) v.x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) v.z -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) v.z += 1;
    return clampLen(v, 1);
  }

  /** Aim rotation input in [-1, 1]: ◄ ► buttons, A/D, arrows, or joystick X. */
  aimTurn(): number {
    const k = this.keys;
    let t = this.aimButtons + this.joy.x;
    if (k.has('KeyA') || k.has('ArrowLeft')) t -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) t += 1;
    return Math.max(-1, Math.min(1, t));
  }

  consume(): InputEdges {
    const e = this.edges;
    this.edges = { chargePressed: false, chargeReleased: false, dash: false, menu: false, special: false };
    return e;
  }

  reset(): void {
    this.setCharge(false);
    this.consume();
  }
}

function holdButton(el: HTMLElement, cb: (down: boolean) => void): void {
  let held = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    if (!held) cb((held = true));
  });
  const up = () => {
    if (held) cb((held = false));
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
}

