/** Synthesized WebAudio SFX (clash, wall, launch, ring-out, win/lose, spin hum), ported from ref/arena-src/src/audio.ts. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private hum: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  muted = false;

  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    this.hum.connect(lp).connect(this.humGain).connect(this.master);
    this.hum.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05);
  }

  setHum(spinFrac: number): void {
    if (!this.ctx || !this.hum || !this.humGain) return;
    const now = this.ctx.currentTime;
    this.hum.frequency.setTargetAtTime(60 + spinFrac * 260, now, 0.1);
    this.humGain.gain.setTargetAtTime(spinFrac > 0 ? 0.03 + spinFrac * 0.05 : 0, now, 0.1);
  }

  private burstNoise(duration: number, freq: number, gain: number, q = 1): void {
    if (!this.ctx || !this.master || !this.noise) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(bp).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + duration);
  }

  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType = 'square'): void {
    if (!this.ctx || !this.master) return;
    const now = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, now);
    o.frequency.exponentialRampToValueAtTime(to, now + duration);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    o.connect(g).connect(this.master);
    o.start(now);
    o.stop(now + duration);
  }

  clash(intensity: number): void {
    const k = Math.min(1, intensity / 10);
    this.burstNoise(0.08 + k * 0.12, 2500 + Math.random() * 2000, 0.25 + k * 0.5, 2);
    this.tone(1800 + Math.random() * 600, 900, 0.08, 0.05 + k * 0.08, 'triangle');
  }

  wall(intensity: number): void {
    this.burstNoise(0.1, 900, Math.min(0.4, intensity * 0.05), 3);
  }

  launch(): void {
    this.tone(120, 900, 0.45, 0.12, 'sawtooth');
    this.burstNoise(0.4, 1500, 0.3, 0.7);
  }

  dash(): void {
    this.tone(300, 1200, 0.15, 0.08, 'sawtooth');
  }

  ringOut(): void {
    this.tone(700, 90, 0.7, 0.15, 'square');
  }

  burst(): void {
    this.burstNoise(0.6, 600, 0.9, 0.5);
    this.tone(400, 50, 0.6, 0.2, 'sawtooth');
  }

  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, f * 1.01, 0.18, 0.1, 'square'), i * 110));
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this.tone(f, f * 0.98, 0.25, 0.1, 'triangle'), i * 160));
  }
}
