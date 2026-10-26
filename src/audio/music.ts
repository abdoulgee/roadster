// The soundtrack: a synthwave loop played live with Web Audio, no audio files. It sequences a pad,
// a bass line, drums and an arpeggio on a 16-step grid, and layers in more parts as the run heats up.

const BPM = 116;
const STEP = 60 / BPM / 4; // a sixteenth note, seconds
const LOOKAHEAD = 0.12; // schedule this far ahead of the audio clock
const VOLUME = 0.42;

// A minor: Am – F – C – G, one chord per bar. MIDI note numbers (chord tones and the bass root).
const CHORDS = [
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [53, 57, 60] },
  { root: 48, tones: [55, 60, 64] },
  { root: 43, tones: [55, 59, 62] },
];

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/**
 * 0: menu (pad and soft bass), 1: driving (adds the drums), 2: on a streak or in a power mode (adds
 * the arpeggio and busier hats). `off` fades everything out (game over).
 */
export type MusicLevel = 0 | 1 | 2 | 'off';

export class Music {
  private readonly bus: GainNode;
  private level: MusicLevel = 'off';
  private step = 0;
  private nextAt = 0;
  private timer = 0;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly noise: AudioBuffer,
  ) {
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(destination);
    this.nextAt = ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.setLevel(0);
  }

  setLevel(level: MusicLevel) {
    if (level === this.level) return;
    this.level = level;
    const t = this.ctx.currentTime;
    this.bus.gain.cancelScheduledValues(t);
    this.bus.gain.setTargetAtTime(level === 'off' ? 0 : level === 0 ? VOLUME * 0.7 : VOLUME, t, level === 'off' ? 0.6 : 0.4);
  }

  /** Paused: much quieter, but still there. */
  setDucked(ducked: boolean) {
    const t = this.ctx.currentTime;
    this.bus.gain.setTargetAtTime(ducked ? VOLUME * 0.25 : this.level === 'off' ? 0 : VOLUME, t, 0.2);
  }

  dispose() {
    clearInterval(this.timer);
  }

  private schedule() {
    const ctx = this.ctx;
    // After the tab was hidden, don't try to catch up on every missed note.
    if (this.nextAt < ctx.currentTime - 0.2) this.nextAt = ctx.currentTime + 0.05;
    while (this.nextAt < ctx.currentTime + LOOKAHEAD) {
      if (this.level !== 'off') this.playStep(this.step, this.nextAt);
      this.step = (this.step + 1) % 64;
      this.nextAt += STEP;
    }
  }

  private playStep(step: number, t: number) {
    const level = this.level as 0 | 1 | 2;
    const beat = step % 16;
    const chord = CHORDS[Math.floor(step / 16)];

    // Pad: the chord, held for the whole bar.
    if (beat === 0) for (const n of chord.tones) this.pad(hz(n), t, STEP * 16);

    // Bass: driving eighths, the octave jump on the off-beats.
    if (beat % 2 === 0) this.bass(hz(chord.root + (beat % 4 === 2 ? 12 : 0)), t, level === 0 ? 0.08 : 0.13);

    if (level >= 1) {
      if (beat % 4 === 0) this.kick(t);
      if (beat === 4 || beat === 12) this.clap(t);
      if (beat % 4 === 2) this.hat(t, 0.09, 0.06);
      else if (level === 2 && beat % 2 === 1) this.hat(t, 0.04, 0.025);
    }

    // Arpeggio: chord tones an octave up, climbing in sixteenths.
    if (level === 2) this.arp(hz(chord.tones[beat % 3] + 12 + (beat % 6 >= 3 ? 12 : 0)), t);
  }

  // ---------- voices ----------

  private env(t: number, attack: number, hold: number, release: number, vol: number) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.setValueAtTime(vol, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
    g.connect(this.bus);
    return g;
  }

  private osc(type: OscillatorType, f: number, t: number, dur: number, out: AudioNode, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    o.detune.value = detune;
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private pad(f: number, t: number, dur: number) {
    const g = this.env(t, 0.4, dur - 0.9, 0.5, 0.035);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    lp.connect(g);
    this.osc('sawtooth', f, t, dur, lp, -9);
    this.osc('sawtooth', f, t, dur, lp, 9);
  }

  private bass(f: number, t: number, vol: number) {
    const g = this.env(t, 0.005, 0.08, 0.12, vol);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.18);
    lp.connect(g);
    this.osc('sawtooth', f, t, 0.22, lp);
  }

  private kick(t: number) {
    const g = this.env(t, 0.002, 0.02, 0.24, 0.5);
    const o = this.osc('sine', 150, t, 0.3, g);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
  }

  private noiseHit(t: number, type: BiquadFilterType, freq: number, q: number, dur: number, vol: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    src.connect(f).connect(this.env(t, 0.002, 0.005, dur, vol));
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private clap(t: number) {
    this.noiseHit(t, 'bandpass', 1700, 1.2, 0.18, 0.22);
    this.noiseHit(t + 0.012, 'bandpass', 2400, 1.5, 0.1, 0.12);
  }

  private hat(t: number, dur: number, vol: number) {
    this.noiseHit(t, 'highpass', 8000, 0.8, dur, vol);
  }

  private arp(f: number, t: number) {
    const g = this.env(t, 0.004, 0.03, 0.09, 0.03);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3200;
    lp.connect(g);
    this.osc('square', f, t, 0.14, lp);
  }
}
