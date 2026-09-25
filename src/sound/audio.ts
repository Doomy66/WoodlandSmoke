import type { NoiseKind } from "./noise";

/**
 * Every sound is synthesised here, from noise and oscillators; there are no
 * sound files to fetch. Loudness is worked out by the caller with the same
 * model the HUD and the animals use, so what you hear matches what pings.
 */
export class Sounds {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private drawNodes: { osc: OscillatorNode; gain: GainNode } | null = null;
  private birdTimer = 3;
  muted = false;

  /** Browsers only allow audio to start from a click or key press. */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // The wind in the trees: filtered noise that swells with the breeze.
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 500;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  /** Listener sits at the camera, facing where it looks. */
  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const t = ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t); l.positionY.setValueAtTime(y, t); l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t); l.forwardY.setValueAtTime(fy, t); l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  update(dt: number, windSpeed: number, listener: { x: number; y: number; z: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.windGain.gain.setTargetAtTime(Math.min(0.5, 0.04 + windSpeed * 0.035), t, 0.4);
    this.windFilter.frequency.setTargetAtTime(300 + windSpeed * 70, t, 0.4);

    // Birdsong somewhere in the canopy.
    this.birdTimer -= dt;
    if (this.birdTimer <= 0) {
      this.birdTimer = 2 + Math.random() * 7;
      const a = Math.random() * Math.PI * 2, d = 15 + Math.random() * 40;
      this.chirp(listener.x + Math.cos(a) * d, listener.y + 8, listener.z + Math.sin(a) * d);
    }
  }

  /** Play one of the wood's sounds at a place, at a loudness already worked out. */
  play(kind: NoiseKind | "whoosh" | "flesh" | "ground" | "tag" | "pickup", x: number, y: number, z: number, loudness: number): void {
    const ctx = this.ctx;
    if (!ctx || loudness <= 0.01) return;
    const out = this.spatial(x, y, z, loudness);
    const t = ctx.currentTime;
    switch (kind) {
      case "step": this.burst(out, t, 0.12, "bandpass", 1600 + Math.random() * 900, 0.8, 0.5); break;
      case "run": this.burst(out, t, 0.14, "bandpass", 1300 + Math.random() * 900, 0.7, 0.8); break;
      case "rustle": this.burst(out, t, 0.45, "bandpass", 3200, 0.5, 0.6, 0.12); break;
      case "twig":
        this.burst(out, t, 0.035, "highpass", 1800, 0.7, 1.2);
        this.burst(out, t + 0.03, 0.05, "bandpass", 2600, 2, 0.8);
        break;
      case "splash": this.burst(out, t, 0.35, "lowpass", 900, 0.7, 0.9, 0.05); break;
      case "snort": this.burst(out, t, 0.55, "bandpass", 650, 3, 1.2, 0.08); break;
      case "bark": this.tone(out, t, "sawtooth", 420, 300, 0.25, 0.5, 900); break;
      case "thump": this.tone(out, t, "sine", 90, 60, 0.09, 1, 0); this.tone(out, t + 0.16, "sine", 90, 60, 0.09, 0.8, 0); break;
      case "grunt": this.tone(out, t, "sawtooth", 95, 75, 0.35, 0.6, 450, 22); break;
      case "bleat": this.tone(out, t, "triangle", 620, 520, 0.45, 0.35, 0, 7); break;
      case "call": this.tone(out, t, "sawtooth", 130, 100, 0.65, 0.55, 600, 9); break;
      case "twang":
        this.tone(out, t, "triangle", 196, 180, 0.35, 0.6, 0);
        this.tone(out, t, "sine", 392, 380, 0.2, 0.25, 0);
        this.burst(out, t, 0.03, "highpass", 3000, 0.5, 0.4);
        break;
      case "whoosh": this.sweep(out, t, 0.35, 900, 3500, 0.5); break;
      case "thud":
        this.tone(out, t, "sine", 180, 90, 0.12, 0.9, 0);
        this.burst(out, t, 0.05, "bandpass", 1200, 1.5, 0.7);
        break;
      case "ground": this.burst(out, t, 0.08, "lowpass", 700, 0.8, 0.7); break;
      case "flesh": this.tone(out, t, "sine", 110, 70, 0.1, 0.8, 0); this.burst(out, t, 0.06, "lowpass", 500, 0.8, 0.6); break;
      case "crash": this.burst(out, t, 0.7, "bandpass", 1400, 0.4, 1, 0.1); break;
      case "tag": this.tone(out, t, "sine", 523, 523, 0.25, 0.25, 0); this.tone(out, t + 0.12, "sine", 784, 784, 0.4, 0.25, 0); break;
      case "pickup": this.tone(out, t, "sine", 660, 880, 0.12, 0.25, 0); break;
    }
  }

  /** The creak of the bow coming to full draw, while the button is held. */
  drawStart(): void {
    const ctx = this.ctx;
    if (!ctx || this.drawNodes) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900;
    filter.Q.value = 6;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 0.2);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    osc.frequency.linearRampToValueAtTime(80, ctx.currentTime + 0.8);
    osc.connect(filter).connect(gain).connect(this.master);
    osc.start();
    this.drawNodes = { osc, gain };
  }

  drawStop(): void {
    const ctx = this.ctx;
    if (!ctx || !this.drawNodes) return;
    const { osc, gain } = this.drawNodes;
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
    osc.stop(ctx.currentTime + 0.1);
    this.drawNodes = null;
  }

  private spatial(x: number, y: number, z: number, loudness: number): AudioNode {
    const ctx = this.ctx!;
    const panner = ctx.createPanner();
    panner.panningModel = "equalpower";
    panner.distanceModel = "linear";
    panner.refDistance = 1;
    panner.maxDistance = 100000;
    panner.rolloffFactor = 0;
    if (panner.positionX) {
      panner.positionX.value = x; panner.positionY.value = y; panner.positionZ.value = z;
    } else {
      panner.setPosition(x, y, z);
    }
    const gain = ctx.createGain();
    gain.gain.value = Math.min(1, loudness);
    gain.connect(panner).connect(this.master);
    setTimeout(() => { gain.disconnect(); panner.disconnect(); }, 3000);
    return gain;
  }

  private burst(out: AudioNode, t: number, dur: number, type: BiquadFilterType, freq: number, q: number, vol: number, attack = 0.004): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  private sweep(out: AudioNode, t: number, dur: number, f0: number, f1: number, vol: number): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(f1, t);
    filter.frequency.exponentialRampToValueAtTime(f0, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  private tone(out: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, vol: number, lowpass: number, vibrato = 0): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
    let node: AudioNode = osc;
    if (vibrato > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = vibrato;
      const depth = ctx.createGain();
      depth.gain.value = f0 * 0.06;
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(t);
      lfo.stop(t + dur + 0.05);
    }
    if (lowpass > 0) {
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = lowpass;
      node.connect(filter);
      node = filter;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  private chirp(x: number, y: number, z: number): void {
    const ctx = this.ctx!;
    const out = this.spatial(x, y, z, 0.12 + Math.random() * 0.12);
    const t = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < notes; i++) {
      const s = t + i * (0.09 + Math.random() * 0.08);
      this.tone(out, s, "sine", base * (1 + Math.random() * 0.3), base * (0.8 + Math.random() * 0.5), 0.07, 0.5, 0);
    }
  }
}
