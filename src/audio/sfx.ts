// Every sound is synthesized with Web Audio, so the game ships with no audio files.

import { clamp } from '../util/math';
import { Music, type MusicLevel } from './music';

const MASTER_VOLUME = 0.55;

interface Loop {
  filter: BiquadFilterNode;
  gain: GainNode;
}

export interface SoundState {
  active: boolean;
  speed: number;
  boosting: boolean;
  hovering: boolean;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private engine!: { a: OscillatorNode; b: OscillatorNode; filter: BiquadFilterNode; gain: GainNode };
  private wind!: Loop;
  private hover!: Loop;
  private boost!: Loop;
  private soundtrack: Music | null = null;
  private musicLevel: MusicLevel = 0;

  constructor(private muted: boolean) {}

  get isMuted() {
    return this.muted;
  }

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.build(this.ctx);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, this.ctx.currentTime, 0.05);
  }

  update(s: SoundState) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const boostPitch = s.boosting ? 1.2 : 1;
    this.engine.a.frequency.setTargetAtTime((42 + s.speed * 1.4) * boostPitch, t, 0.12);
    this.engine.b.frequency.setTargetAtTime((21 + s.speed * 0.7) * boostPitch, t, 0.12);
    this.engine.filter.frequency.setTargetAtTime(220 + s.speed * 12 + (s.boosting ? 700 : 0), t, 0.12);
    this.engine.gain.gain.setTargetAtTime(s.active ? 0.055 : 0, t, 0.2);
    this.wind.filter.frequency.setTargetAtTime(350 + s.speed * 14, t, 0.2);
    this.wind.gain.gain.setTargetAtTime(s.active ? 0.015 + (s.speed / 100) * 0.07 : 0, t, 0.2);
    this.hover.gain.gain.setTargetAtTime(s.active && s.hovering ? 0.13 : 0, t, 0.06);
    this.boost.gain.gain.setTargetAtTime(s.active && s.boosting ? 0.16 : 0, t, 0.08);
  }

  // ---------- music ----------

  /** Soundtrack intensity (see MusicLevel); remembered until audio is unlocked. */
  music(level: MusicLevel) {
    this.musicLevel = level;
    this.soundtrack?.setLevel(level);
  }

  musicDucked(ducked: boolean) {
    this.soundtrack?.setDucked(ducked);
  }

  // ---------- stunts ----------

  /** A finished front flip (an airy swoosh rising) or barrel roll (a swirl), over the streak chime. */
  trick(kind: 'flip' | 'roll') {
    if (kind === 'flip') {
      this.burst(0.35, 'bandpass', 600, 3800, 2.5, 0.22);
      this.tone('triangle', 660, 1320, 0.2, 0.05);
    } else {
      this.burst(0.45, 'bandpass', 3200, 500, 3, 0.2);
      this.tone('sine', 900, 450, 0.3, 0.05);
      this.tone('sine', 1100, 550, 0.3, 0.04, 0.08);
    }
  }

  /** Jumped clean over a vehicle: a rushing pass overhead with a bright sting. */
  clear(big: boolean) {
    this.burst(0.5, 'bandpass', 300, 2600, 1.6, 0.3);
    const f = big ? 784 : 659;
    [f, f * 1.25, f * 1.5].forEach((n, i) => this.tone('triangle', n, n, 0.18, 0.07, 0.04 + i * 0.05));
  }

  /** Landing a stunt: a punchy hit and a crash cymbal, bigger for more tricks in one jump. */
  stunt(count: number) {
    const v = clamp(0.5 + count * 0.15, 0.5, 1);
    this.tone('sine', 110, 40, 0.35, 0.4 * v);
    this.tone('sawtooth', 220, 220, 0.3, 0.05 * v);
    this.tone('sawtooth', 277, 277, 0.3, 0.04 * v);
    this.tone('sawtooth', 330, 330, 0.3, 0.04 * v);
    this.burst(1.1, 'highpass', 9000, 4000, 0.5, 0.18 * v);
  }

  // ---------- one-shots ----------

  jump() {
    this.burst(0.28, 'bandpass', 500, 2600, 1.1, 0.16);
    this.tone('sine', 200, 420, 0.16, 0.05);
  }

  land(impact: number) {
    const v = clamp(impact / 22, 0.12, 0.6);
    this.tone('sine', 120, 38, 0.22, v);
    this.burst(0.18, 'lowpass', 900, 180, 0.7, v * 0.6);
  }

  /** Rising chime; pitch climbs with the streak multiplier. */
  skill(multiplier: number) {
    const base = 523 * Math.pow(2, Math.min(multiplier - 1, 14) / 12);
    this.tone('triangle', base, base, 0.14, 0.09);
    this.tone('triangle', base * 1.5, base * 1.5, 0.18, 0.08, 0.06);
  }

  nearMiss() {
    this.burst(0.4, 'bandpass', 250, 3200, 2.2, 0.28);
  }

  streakEnd(big: boolean) {
    const notes = big ? [784, 988, 1175, 1568] : [659, 523];
    notes.forEach((f, i) => this.tone('square', f, f, 0.12, 0.035, i * 0.07));
  }

  crash() {
    this.burst(0.9, 'lowpass', 2400, 90, 0.6, 0.75);
    this.tone('sawtooth', 95, 28, 0.55, 0.28);
    this.tone('square', 1900, 500, 0.14, 0.07, 0.03);
    this.tone('square', 1300, 420, 0.12, 0.05, 0.11);
  }

  go() {
    this.tone('square', 440, 440, 0.1, 0.04);
    this.tone('square', 880, 880, 0.22, 0.05, 0.12);
  }

  /** Air orb blip; consecutive orbs climb in pitch. */
  orb(chain: number) {
    const f = 880 * Math.pow(2, (chain % 12) / 12);
    this.tone('sine', f, f * 1.02, 0.08, 0.07);
  }

  item() {
    [784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.08, i * 0.05));
  }

  powerStart() {
    this.tone('sawtooth', 220, 880, 0.5, 0.08);
    this.tone('square', 440, 1760, 0.5, 0.04, 0.05);
    this.burst(0.6, 'bandpass', 400, 4000, 1, 0.2);
  }

  powerEnd() {
    this.tone('triangle', 880, 330, 0.35, 0.08);
  }

  smash() {
    this.burst(0.35, 'lowpass', 3000, 300, 0.8, 0.5);
    this.tone('square', 160, 60, 0.2, 0.15);
  }

  shockwave() {
    this.tone('sine', 140, 30, 0.9, 0.5);
    this.burst(0.9, 'lowpass', 1200, 60, 0.5, 0.55);
  }

  shield() {
    [1175, 1568, 2093].forEach((f, i) => this.tone('sine', f, f, 0.25, 0.05, i * 0.04));
  }

  shieldBreak() {
    this.burst(0.5, 'highpass', 6000, 1500, 0.7, 0.35);
    this.tone('triangle', 1400, 500, 0.3, 0.08);
  }

  zone() {
    [392, 494, 587].forEach((f) => this.tone('triangle', f, f, 1.2, 0.04));
  }

  click() {
    this.tone('triangle', 900, 600, 0.05, 0.05);
  }

  lowAir() {
    this.tone('square', 330, 330, 0.08, 0.035);
    this.tone('square', 330, 330, 0.08, 0.035, 0.14);
  }

  // ---------- internals ----------

  private build(ctx: AudioContext) {
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_VOLUME;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const a = ctx.createOscillator();
    a.type = 'sawtooth';
    const b = ctx.createOscillator();
    b.type = 'square';
    a.connect(filter);
    b.connect(filter);
    filter.connect(gain).connect(this.master);
    a.start();
    b.start();
    this.engine = { a, b, filter, gain };

    this.wind = this.noiseLoop(ctx, 'bandpass', 600, 0.8);
    this.hover = this.noiseLoop(ctx, 'highpass', 1400, 0.5);
    this.boost = this.noiseLoop(ctx, 'lowpass', 500, 1.5);

    this.soundtrack = new Music(ctx, this.master, this.noise);
    this.soundtrack.setLevel(this.musicLevel);
  }

  private noiseLoop(ctx: AudioContext, type: BiquadFilterType, freq: number, q: number): Loop {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return { filter, gain };
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.envelope(ctx, t, dur, vol);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private burst(dur: number, type: BiquadFilterType, f0: number, f1: number, q: number, vol: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(f0, t);
    filter.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.envelope(ctx, t, dur, vol);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private envelope(ctx: AudioContext, t: number, dur: number, vol: number) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }
}
