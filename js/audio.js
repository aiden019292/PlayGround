// Tiny procedural soundscape. No samples, no downloads.
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.music = null;
    this.muted = false;
    this.started = false;
    this.lastShot = 0;
    this.drone = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.music = this.ctx.createGain();
    this.music.gain.value = 0.18;
    this.music.connect(this.master);
    this.buildAmbience();
    this.started = true;
  }

  setMuted(value) {
    this.muted = value;
    if (this.master && this.ctx) {
      this.master.gain.cancelScheduledValues(this.ctx.currentTime);
      this.master.gain.linearRampToValueAtTime(value ? 0 : 0.5, this.ctx.currentTime + 0.12);
    }
  }

  buildAmbience() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;

    // Low, slowly breathing drone.
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.075;
    droneGain.connect(this.music);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 280;
    filter.Q.value = 3.5;
    filter.connect(droneGain);

    const frequencies = [43.65, 65.41, 87.31];
    const oscillators = frequencies.map((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 1 ? 'triangle' : 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 7;
      const gain = ctx.createGain();
      gain.gain.value = i === 1 ? 0.22 : 0.09;
      osc.connect(gain).connect(filter);
      osc.start(now);
      return osc;
    });

    // Filter breathing.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.055;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start(now);

    // Airy wind noise.
    const bufferSize = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      last = last * 0.985 + white * 0.015;
      data[i] = last * 2.8;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 480;
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.09;
    noise.connect(noiseFilter).connect(noiseGain).connect(this.music);
    noise.start(now);

    const windLfo = ctx.createOscillator();
    const windLfoGain = ctx.createGain();
    windLfo.frequency.value = 0.08;
    windLfoGain.gain.value = 0.04;
    windLfo.connect(windLfoGain).connect(noiseGain.gain);
    windLfo.start(now);

    this.drone = { oscillators, lfo, noise, windLfo, droneGain };
  }

  tone({ freq = 220, freqEnd = freq, type = 'sine', duration = 0.15, volume = 0.1, delay = 0, attack = 0.006, filterFreq = 0 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(volume, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    if (filterFreq) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, t0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.45), t0 + duration);
      osc.connect(filter).connect(gain);
    } else {
      osc.connect(gain);
    }
    gain.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  noiseBurst({ duration = 0.15, volume = 0.1, filterStart = 2500, filterEnd = 400, delay = 0 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const length = Math.ceil(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterStart, t0);
    filter.frequency.exponentialRampToValueAtTime(filterEnd, t0 + duration);
    filter.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = volume;
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t0);
  }

  shot() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    if (now - this.lastShot < 0.045) return;
    this.lastShot = now;
    this.tone({ freq: 1240, freqEnd: 230, type: 'sawtooth', duration: 0.12, volume: 0.075, filterFreq: 3000 });
    this.tone({ freq: 720, freqEnd: 120, type: 'square', duration: 0.075, volume: 0.026 });
    this.noiseBurst({ duration: 0.07, volume: 0.05, filterStart: 5000, filterEnd: 900 });
  }

  hit() {
    this.tone({ freq: 130, freqEnd: 70, type: 'square', duration: 0.06, volume: 0.035 });
  }

  crit() {
    this.tone({ freq: 980, freqEnd: 1440, type: 'sine', duration: 0.08, volume: 0.045 });
  }

  build() {
    this.tone({ freq: 320, freqEnd: 520, type: 'triangle', duration: 0.12, volume: 0.055 });
    this.noiseBurst({ duration: 0.12, volume: 0.04, filterStart: 1800, filterEnd: 300 });
  }

  placeFloor() {
    this.tone({ freq: 210, freqEnd: 160, type: 'triangle', duration: 0.14, volume: 0.045 });
  }

  harvest() {
    this.tone({ freq: 420, freqEnd: 820, type: 'triangle', duration: 0.12, volume: 0.05 });
    this.tone({ freq: 660, freqEnd: 990, type: 'sine', duration: 0.1, volume: 0.03, delay: 0.03 });
  }

  pickup() {
    this.tone({ freq: 840, freqEnd: 1200, type: 'sine', duration: 0.08, volume: 0.028 });
  }

  damage() {
    this.tone({ freq: 110, freqEnd: 42, type: 'sawtooth', duration: 0.25, volume: 0.1, filterFreq: 600 });
    this.noiseBurst({ duration: 0.18, volume: 0.08, filterStart: 900, filterEnd: 100 });
  }

  shieldHit() {
    this.tone({ freq: 176, freqEnd: 98, type: 'triangle', duration: 0.14, volume: 0.055 });
  }

  jump() {
    this.tone({ freq: 230, freqEnd: 430, type: 'sine', duration: 0.12, volume: 0.025 });
  }

  wave() {
    [110, 164.8, 220].forEach((freq, i) => {
      this.tone({ freq, freqEnd: freq * 0.99, type: 'sawtooth', duration: 1.6, volume: 0.045, attack: 0.2, delay: i * 0.06, filterFreq: 600 });
    });
    this.noiseBurst({ duration: 0.8, volume: 0.075, filterStart: 320, filterEnd: 80 });
  }

  waveClear() {
    [261.6, 329.6, 392, 523.2].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', duration: 0.5, volume: 0.045, delay: i * 0.08 });
    });
  }

  victory() {
    [261.6, 329.6, 392, 523.2, 659.2, 784].forEach((freq, i) => {
      this.tone({ freq, type: 'triangle', duration: 1.2, volume: 0.055, attack: 0.02, delay: i * 0.09 });
    });
  }

  defeat() {
    [220, 174.6, 146.8, 110].forEach((freq, i) => {
      this.tone({ freq, type: 'sawtooth', duration: 1.5, volume: 0.05, filterFreq: 450, delay: i * 0.18 });
    });
  }

  ui() {
    this.tone({ freq: 680, freqEnd: 880, type: 'sine', duration: 0.06, volume: 0.025 });
  }

  deny() {
    this.tone({ freq: 130, freqEnd: 90, type: 'square', duration: 0.12, volume: 0.04 });
  }
}
