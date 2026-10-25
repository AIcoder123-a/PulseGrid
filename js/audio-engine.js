/* PulseGrid — audio-engine.js
 *
 * Real-time drum & bass synthesis on the Web Audio API.
 * Every sound is generated from oscillators and shaped noise — no samples,
 * no external assets, no dependencies.
 *
 * Signal flow:
 *
 *   [drum voices] ──► track.in ──┬──► masterIn ─► masterFilter(LP) ─► compressor
 *   [bass voice ] ──► track.in ──┤                        │
 *                                ├─► delaySend ─► delayBus ─► delay ◄─┐ (feedback)
 *                                └─► reverbSend ─► reverbBus ─► convolver
 *                                                                        │
 *        compressor ─► softClip(waveshaper) ─► masterGain ─► analyser ─► out
 */

'use strict';

const STEPS = 16;

const TRACKS = [
  { id: 'kick',    name: 'Kick',     color: '#f43f5e', gain: 1.00, delay: 0.00, reverb: 0.02 },
  { id: 'snare',   name: 'Snare',    color: '#fb923c', gain: 0.90, delay: 0.06, reverb: 0.22 },
  { id: 'clap',    name: 'Clap',     color: '#fbbf24', gain: 0.80, delay: 0.10, reverb: 0.30 },
  { id: 'chat',    name: 'Hi-Hat',   color: '#a3e635', gain: 0.55, delay: 0.04, reverb: 0.06 },
  { id: 'ohat',    name: 'Open Hat', color: '#34d399', gain: 0.50, delay: 0.08, reverb: 0.12 },
  { id: 'tom',     name: 'Tom',      color: '#22d3ee', gain: 0.80, delay: 0.06, reverb: 0.18 },
  { id: 'cowbell', name: 'Cowbell',  color: '#818cf8', gain: 0.45, delay: 0.14, reverb: 0.22 },
  { id: 'shaker',  name: 'Shaker',   color: '#c084fc', gain: 0.50, delay: 0.05, reverb: 0.10 },
];

/* Bass piano-roll range: C2 (36) … C3 (48), chromatic. */
const BASS_MIDI_LO = 36;
const BASS_MIDI_HI = 48;

/* Lead piano-roll range: C4 (60) … C5 (72), chromatic. */
const LEAD_MIDI_LO = 60;
const LEAD_MIDI_HI = 72;

const midiToHz = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

/* ---------- helpers ---------- */

function makeSoftClipCurve(amount = 0.9) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = 1 + amount * 2;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return curve;
}

function makeNoiseBuffer(ctx, seconds = 2) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function makeImpulseResponse(ctx, seconds = 2.4, decay = 3.4) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buffer;
}

/* ---------- engine ---------- */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.tracks = {};   // id -> { in, delaySend, reverbSend, cfg }
    this.noiseBuffer = null;
    // per-voice sound design (multiplicative; 1 = default). Shared by the
    // live engine, offline WAV rendering, previews and share links.
    this.sound = {};
    for (const cfg of TRACKS) this.sound[cfg.id] = { tune: 1, decay: 1 };
    // sidechain pump: how hard bass/lead duck under the kick (0..1)
    this.pump = 0;
    // humanize: micro timing (±8 ms) and velocity (±15%) jitter (0..1)
    this.humanize = 0;
  }

  setSound(id, params) {
    const s = this.sound[id];
    if (!s) return;
    s.tune = Math.min(2, Math.max(0.5, params.tune ?? s.tune));
    s.decay = Math.min(2.5, Math.max(0.4, params.decay ?? s.decay));
  }

  /** One-shot audition of a voice (user gesture context). */
  preview(id) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.trigger(id, this.ctx.currentTime + 0.02);
  }

  /** One-shot audition of a bass note while editing the roll. */
  previewBass(midi, accent) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.bassNote(this.ctx.currentTime + 0.02, midi, accent, 0.22);
  }

  /** One-shot audition of a lead note while editing the roll. */
  previewLead(midi, accent) {
    this.ensure();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.leadNote(this.ctx.currentTime + 0.02, midi, accent, 0.24);
  }

  /** Create the live context and the whole graph. Must be called from a user gesture. */
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.attach(new AC());
  }

  /** Build the full graph on any BaseAudioContext (live or offline — same code path). */
  attach(ctx) {
    this.ctx = ctx;
    this.noiseBuffer = makeNoiseBuffer(ctx);

    // ---- master chain ----
    this.masterIn = ctx.createGain();

    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 16000;
    this.masterFilter.Q.value = 0.4;

    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 24;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.18;

    this.softClip = ctx.createWaveShaper();
    this.softClip.curve = makeSoftClipCurve(0.9);
    this.softClip.oversample = '2x';

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.85;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    this.masterIn.connect(this.masterFilter);
    this.masterFilter.connect(this.comp);
    this.comp.connect(this.softClip);
    this.softClip.connect(this.masterGain);
    this.masterGain.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    // ---- delay bus (tempo-synced dotted 8th) ----
    this.delayBus = ctx.createGain();
    this.delayBus.gain.value = 0;
    this.delayNode = ctx.createDelay(2);
    this.delayNode.delayTime.value = 0.36;
    this.delayFb = ctx.createGain();
    this.delayFb.gain.value = 0.38;
    this.delayTone = ctx.createBiquadFilter();
    this.delayTone.type = 'lowpass';
    this.delayTone.frequency.value = 3800;
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0.9;

    this.delayBus.connect(this.delayNode);
    this.delayNode.connect(this.delayTone);
    this.delayTone.connect(this.delayFb);
    this.delayFb.connect(this.delayNode);
    this.delayTone.connect(this.delayWet);
    this.delayWet.connect(this.masterIn);

    // ---- reverb bus (convolver with generated IR) ----
    this.reverbBus = ctx.createGain();
    this.reverbBus.gain.value = 0;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulseResponse(ctx);
    this.reverbWet = ctx.createGain();
    this.reverbWet.gain.value = 0.9;
    this.reverbBus.connect(this.convolver);
    this.convolver.connect(this.reverbWet);
    this.reverbWet.connect(this.masterIn);

    // ---- duck bus: bass + lead dip under the kick (sidechain pump) ----
    this.duckBus = ctx.createGain();
    this.duckBus.gain.value = 1;
    this.duckBus.connect(this.masterIn);

    // ---- per-track strips ----
    for (const cfg of TRACKS) this._makeTrack(cfg);
    this._makeTrack({ id: 'bass', name: 'Bass', color: '#e879f9', gain: 0.95, delay: 0.12, reverb: 0.08 }, true);
    this._makeTrack({ id: 'lead', name: 'Lead', color: '#fbbf24', gain: 0.55, delay: 0.35, reverb: 0.28 }, true);
  }

  _makeTrack(cfg, ducked = false) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    input.gain.value = cfg.gain;
    input.connect(ducked ? this.duckBus : this.masterIn);

    const delaySend = ctx.createGain();
    delaySend.gain.value = cfg.delay;
    input.connect(delaySend);
    delaySend.connect(this.delayBus);

    const reverbSend = ctx.createGain();
    reverbSend.gain.value = cfg.reverb;
    input.connect(reverbSend);
    reverbSend.connect(this.reverbBus);

    this.tracks[cfg.id] = { in: input, delaySend, reverbSend, cfg };
  }

  /* ---- live parameter control ---- */

  setTrackGain(id, gain) {
    const t = this.tracks[id];
    if (!t) return;
    const p = t.in.gain;
    // setTargetAtTime only progresses on a running clock; write directly
    // while suspended so mute/solo state is exact before the first Play
    if (this.ctx.state !== 'running') { p.value = gain; return; }
    p.setTargetAtTime(gain, this.ctx.currentTime, 0.015);
  }

  setMasterVolume(v) {
    this.masterGain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  setMasterFilterHz(hz) {
    this.masterFilter.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.02);
  }

  setDelayMix(v)    { this.delayBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setReverbMix(v)   { this.reverbBus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03); }
  setBpm(bpm) {
    // dotted-8th sync
    this.delayNode.delayTime.setTargetAtTime((60 / bpm) * 0.75, this.ctx.currentTime, 0.08);
  }

  /* ---- sequencer entry point ---- */

  scheduleStep(pattern, step, t, stepDur) {
    const h = this.humanize;
    const jit = h ? () => (Math.random() * 2 - 1) : () => 0;
    const tj = () => jit() * h * 0.008;             // ±8 ms timing
    const vj = () => 1 + jit() * h * 0.15;          // ±15% velocity

    for (const cfg of TRACKS) {
      const v = pattern.tracks[cfg.id][step];
      if (!v) continue;
      const vel = (v === 2 ? 1.3 : 1) * vj();
      this.trigger(cfg.id, t + tj(), Math.min(1.6, vel));
      if (cfg.id === 'kick' && this.pump > 0) {
        // sidechain dip on bass/lead — the classic pump
        const g = this.duckBus.gain;
        g.setTargetAtTime(1 - this.pump * 0.85, t, 0.006);
        g.setTargetAtTime(1, t + 0.11, 0.06);
      }
    }
    const note = pattern.tracks.bass[step];
    if (note) this.bassNote(t + tj(), note.midi, note.accent, stepDur);
    const lead = pattern.tracks.lead[step];
    if (lead) this.leadNote(t + tj(), lead.midi, lead.accent, stepDur);
  }

  trigger(id, t, vel = 1) {
    switch (id) {
      case 'kick':    this.kick(t, vel);      break;
      case 'snare':   this.snare(t, vel);     break;
      case 'clap':    this.clap(t, vel);      break;
      case 'chat':    this.hat(t, false, vel); break;
      case 'ohat':    this.hat(t, true, vel);  break;
      case 'tom':     this.tom(t, vel);       break;
      case 'cowbell': this.cowbell(t, vel);   break;
      case 'shaker':  this.shaker(t, vel);    break;
    }
  }

  /* =========================================================
   * Voices — each takes an AudioContext timestamp `t` and is
   * fully scheduled ahead of time (sample-accurate).
   * ========================================================= */

  kick(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.kick.in;
    const sp = this.sound.kick;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(165 * sp.tune, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(25, 43 * sp.tune), t + 0.12);

    const dur = Math.max(0.08, 0.45 * sp.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.05 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    osc.connect(g); g.connect(out);
    osc.start(t); osc.stop(t + dur + 0.05);

    // beater click
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 3500;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.4 * vel, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    n.connect(hp); hp.connect(ng); ng.connect(out);
    n.start(t, Math.random() * 1.5, 0.03);
  }

  snare(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.snare.in;
    const sp = this.sound.snare;

    // tonal body: two detuned triangles dropping in pitch
    [188, 331].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f * sp.tune, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.62 * sp.tune), t + 0.09);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime((i ? 0.32 : 0.5) * vel, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.04, 0.1 * sp.decay));
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + Math.max(0.06, 0.12 * sp.decay));
    });

    // noise crack
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 900;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(8000, 1900 * sp.tune); bp.Q.value = 0.8;
    const g = ctx.createGain();
    const nd = Math.max(0.06, 0.21 * sp.decay);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.85 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + nd);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(out);
    n.start(t, Math.random() * 1.5, nd + 0.04);
  }

  clap(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.clap.in;
    const sp = this.sound.clap;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, 1100 * sp.tune); bp.Q.value = 1.4;
    const g = ctx.createGain();
    const tail = Math.max(0.08, 0.22 * sp.decay);
    // three fast bursts, then the tail
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.8 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.010);
    g.gain.linearRampToValueAtTime(0.7 * vel, t + 0.013);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.021);
    g.gain.linearRampToValueAtTime(0.75 * vel, t + 0.024);
    g.gain.exponentialRampToValueAtTime(0.001, t + tail);
    n.connect(bp); bp.connect(g); g.connect(out);
    n.start(t, Math.random() * 1.5, tail + 0.04);
  }

  /** 808-style metallic hat: 6 detuned square oscillators through a 10 kHz band-pass.
   *  Any new hat chokes a still-ringing open hat, like real hi-hat hardware. */
  hat(t, open, vel = 1) {
    const ctx = this.ctx, out = this.tracks[open ? 'ohat' : 'chat'].in;
    const sp = this.sound[open ? 'ohat' : 'chat'];
    const dur = Math.max(0.03, (open ? 0.42 : 0.06) * sp.decay);

    // choke: cut the ringing open hat when any hat (or its own retrigger) fires
    if (this._ohatEnv && t < this._ohatEnd) {
      const g0 = this._ohatEnv.gain;
      if (g0.cancelAndHoldAtTime) g0.cancelAndHoldAtTime(t);
      else g0.cancelScheduledValues(t);
      g0.setTargetAtTime(0.0001, t, 0.012);
      this._ohatEnd = t;
    }

    const mix = ctx.createGain();
    mix.gain.value = 0.25;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 10000; bp.Q.value = 0.9;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 8500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime((open ? 0.5 : 0.65) * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    mix.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out);

    [2, 3, 4.16, 5.43, 6.79, 8.21].forEach((mult) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = mult * 40 * sp.tune * (1 + (Math.random() * 0.01 - 0.005));
      o.connect(mix);
      o.start(t); o.stop(t + dur + 0.03);
    });
    if (open) { this._ohatEnv = g; this._ohatEnd = t + dur; }
  }

  tom(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.tom.in;
    const sp = this.sound.tom;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120 * sp.tune, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, 55 * sp.tune), t + 0.22);
    const dur = Math.max(0.08, 0.33 * sp.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.03);
  }

  cowbell(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.cowbell.in;
    const sp = this.sound.cowbell;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = Math.min(6000, 880 * sp.tune); bp.Q.value = 1.2;
    const dur = Math.max(0.06, 0.3 * sp.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * vel, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    bp.connect(g); g.connect(out);
    [540, 800].forEach((f) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f * sp.tune;
      o.connect(bp);
      o.start(t); o.stop(t + dur + 0.02);
    });
  }

  shaker(t, vel = 1) {
    const ctx = this.ctx, out = this.tracks.shaker.in;
    const sp = this.sound.shaker;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = Math.min(12000, Math.max(2000, 6000 * sp.tune));
    const dur = Math.max(0.04, 0.12 * sp.decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * vel, t + 0.015);  // soft attack = "tss"
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(hp); hp.connect(g); g.connect(out);
    n.start(t, Math.random() * 1.5, dur + 0.03);
  }

  /** Mono synth bass: saw + sine sub through an enveloped low-pass (acid-ish). */
  bassNote(t, midi, accent, dur) {
    const ctx = this.ctx, out = this.tracks.bass.in;
    const f = midiToHz(midi);
    const vel = accent ? 1 : 0.62;
    const len = Math.max(dur * 0.92, 0.09);

    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.6;

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = accent ? 9 : 6;
    flt.frequency.setValueAtTime(300 + 2600 * vel * vel, t);
    flt.frequency.exponentialRampToValueAtTime(170, t + Math.min(0.16, len * 0.9));

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);

    saw.connect(flt);
    sub.connect(subGain); subGain.connect(flt);
    flt.connect(g); g.connect(out);
    saw.start(t); saw.stop(t + len + 0.05);
    sub.start(t); sub.stop(t + len + 0.05);
  }

  /** Mono lead: two detuned saws with vibrato through an enveloped low-pass. */
  leadNote(t, midi, accent, dur) {
    const ctx = this.ctx, out = this.tracks.lead.in;
    const f = midiToHz(midi);
    const vel = accent ? 1 : 0.7;
    const len = Math.max(0.1, dur * 0.9);

    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth'; o1.frequency.value = f; o1.detune.value = -7;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth'; o2.frequency.value = f; o2.detune.value = 7;

    // gentle vibrato
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.5;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 5;   // cents
    lfo.connect(lfoGain);
    lfoGain.connect(o1.detune);
    lfoGain.connect(o2.detune);

    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 2;
    flt.frequency.setValueAtTime(accent ? 5200 : 3200, t);
    flt.frequency.exponentialRampToValueAtTime(900, t + len * 0.8);

    const g = ctx.createGain();
    const peak = 0.32 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.setValueAtTime(peak, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);

    o1.connect(flt); o2.connect(flt);
    flt.connect(g); g.connect(out);
    const end = t + len + 0.05;
    o1.start(t); o1.stop(end);
    o2.start(t); o2.stop(end);
    lfo.start(t); lfo.stop(end);
  }

  /** Rough output level, used by the debug hook / tests. */
  getLevel() {
    if (!this.analyser) return 0;
    const buf = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = (buf[i] - 128) / 128;
      sum += v * v;
    }
    return Math.sqrt(sum / buf.length);
  }
}
