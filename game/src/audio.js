// audio.js — every sound in Neon Tides is synthesised with WebAudio; the game ships no audio
// files at all. One AudioContext, created lazily on the first user gesture (browsers refuse
// sound before one), feeds a small set of voices:
//   - an engine hum whose pitch follows the player's car speed,
//   - a two-tone police siren whose volume follows the nearest police car,
//   - one-shot noises: gunshots, hits, a cash chime, UI clicks,
//   - a slow neon-noir chord pad that loops quietly under the whole game.
// Every method is safe to call before the context exists: it simply stays silent.

/** Frequencies of the pad's chord loop (A minor add9, low and warm). */
const PAD_CHORDS = [
  [110.0, 164.81, 220.0, 261.63], // A2 E3 A3 C4
  [87.31, 130.81, 174.61, 220.0], // F2 C3 F3 A3
  [98.0, 146.83, 196.0, 246.94], // G2 D3 G3 B3
  [110.0, 164.81, 207.65, 246.94], // A2 E3 G#3 B3
];

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenTimer = 0;
    this.padTimer = null;
    this.padStep = 0;
  }

  /** Create the context and start the pad. Call from a click or key press. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.startEngineVoice();
    this.startSirenVoice();
    this.schedulePad();
  }

  /** A sawtooth through a low-pass filter, silent until setEngine is told a speed. */
  startEngineVoice() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  /** A square wave whose frequency a timer flips between two tones, siren-style. */
  startSirenVoice() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 660;
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
    let high = false;
    this.sirenTimer = window.setInterval(() => {
      if (!this.ctx) return;
      high = !high;
      this.sirenOsc.frequency.setTargetAtTime(high ? 880 : 620, this.ctx.currentTime, 0.03);
    }, 340);
  }

  /** The pad: every 4 seconds a soft chord fades in and out under everything else. */
  schedulePad() {
    const playChord = () => {
      if (!this.ctx) return;
      const ctx = this.ctx;
      const chord = PAD_CHORDS[this.padStep % PAD_CHORDS.length];
      this.padStep += 1;
      for (const freq of chord) {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        const gain = ctx.createGain();
        const now = ctx.currentTime;
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.028, now + 1.4);
        gain.gain.linearRampToValueAtTime(0, now + 4.4);
        osc.connect(gain).connect(this.master);
        osc.start(now);
        osc.stop(now + 4.6);
      }
    };
    playChord();
    this.padTimer = window.setInterval(playChord, 4000);
  }

  /**
   * Drive the engine voice: speedRatio 0..1 of the car's top speed, throttle 0..1.
   * Call every frame while the player drives; call with (0, 0) on foot.
   */
  setEngine(speedRatio, throttle) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const rpm = 50 + speedRatio * 165 + throttle * 22;
    this.engineOsc.frequency.setTargetAtTime(rpm, now, 0.06);
    this.engineFilter.frequency.setTargetAtTime(280 + speedRatio * 900, now, 0.08);
    this.engineGain.gain.setTargetAtTime(0.015 + throttle * 0.05 + speedRatio * 0.03, now, 0.09);
  }

  /** Set the siren's loudness from the nearest police car (0 = none in earshot). */
  setSirenLevel(level) {
    if (!this.ctx) return;
    this.sirenGain.gain.setTargetAtTime(Math.min(0.06, level * 0.06), this.ctx.currentTime, 0.15);
  }

  /** A short filtered noise burst: the gunshot. Pitch jitters so bursts don't sound stamped. */
  shot() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const length = 0.14;
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * length), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1500 + Math.random() * 900;
    const gain = ctx.createGain();
    gain.gain.value = 0.35;
    source.connect(filter).connect(gain).connect(this.master);
    source.start();
  }

  /** A dull thud for bullets striking metal or a car bumping a wall. */
  thud(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(38, ctx.currentTime + 0.16);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22 * strength, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  }

  /** Two bright notes: money earned, a package picked up, a mission done. */
  chime() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [880, 1318.5].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.09;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.4);
      osc.connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.45);
    });
  }

  /** A low two-note sting for bad news: busted, wasted, a mission failed. */
  sting() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    [196, 155.56].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.1, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
      osc.connect(filter).connect(gain).connect(this.master);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  }

  /** A tiny click for menu buttons. */
  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 660;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(gain).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }
}
