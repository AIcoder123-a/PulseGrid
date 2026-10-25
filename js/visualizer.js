/* PulseGrid — visualizer.js
 *
 * Real-time spectrum + waveform on a single canvas. Before the AudioContext
 * exists (or while transport is stopped) it renders a slow idle sine so the
 * header never looks dead.
 */

'use strict';

class Visualizer {
  constructor(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.analyser = null;
    this.freqData = null;
    this.waveData = null;
    this.gradient = null;
    this.playing = false;
    this.clipUntil = 0;          // latch the clip lamp for 1.5 s
    this._resize();
    window.addEventListener('resize', () => this._resize());
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  attach(analyser) {
    this.analyser = analyser;
    this.freqData = new Uint8Array(analyser.frequencyBinCount);
    this.waveData = new Uint8Array(analyser.fftSize);
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 120;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = h;
    const lg = this.g.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0.0, '#22d3ee');
    lg.addColorStop(0.55, '#818cf8');
    lg.addColorStop(1.0, '#f43f5e');
    this.gradient = lg;
  }

  _loop(ts) {
    const { g, W, H } = this;
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0b0e14';
    g.fillRect(0, 0, W, H);

    if (this.analyser && this.playing) {
      this._drawSpectrum();
      this._drawWave();
      this._drawMeter(ts);
    } else {
      this._drawIdle(ts);
    }
    requestAnimationFrame(this._loop);
  }

  _drawSpectrum() {
    const { g, W, H } = this;
    this.analyser.getByteFrequencyData(this.freqData);
    const bins = this.freqData.length;
    const N = Math.max(48, Math.floor(W / 14));
    const bw = W / N;

    g.fillStyle = this.gradient;
    for (let i = 0; i < N; i++) {
      // log-ish frequency mapping: spend resolution where it matters
      const f = Math.pow(i / N, 1.7);
      const v = this.freqData[Math.min(bins - 1, Math.floor(f * bins * 0.72))] / 255;
      const bh = Math.max(2, v * (H - 8));
      g.globalAlpha = 0.25 + v * 0.75;
      g.fillRect(i * bw + 1, H - bh - 3, Math.max(2, bw - 2.5), bh);
    }
    g.globalAlpha = 1;
  }

  _drawWave() {
    const { g, W, H } = this;
    this.analyser.getByteTimeDomainData(this.waveData);
    const n = this.waveData.length;
    const step = Math.max(1, Math.floor(n / W));
    g.beginPath();
    for (let i = 0; i < n; i += step) {
      const v = (this.waveData[i] - 128) / 128;
      const y = H / 2 + v * (H / 2 - 6);
      const x = (i / n) * W;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(235, 244, 255, 0.4)';
    g.lineWidth = 1.4;
    g.stroke();
  }

  /** Compact output meter: RMS bar, peak tick, clip lamp (top-right). */
  _drawMeter(ts) {
    const { g, W, H } = this;
    this.analyser.getByteTimeDomainData(this.waveData);
    let peak = 0, sum = 0, n = 0;
    for (let i = 0; i < this.waveData.length; i += 4) {
      const v = (this.waveData[i] - 128) / 128;
      const a = v < 0 ? -v : v;
      if (a > peak) peak = a;
      sum += v * v; n++;
    }
    const rms = Math.sqrt(sum / n);
    if (peak >= 0.985) this.clipUntil = ts + 1500;
    const clipped = ts < this.clipUntil;

    const mw = 110, mh = 10, mx = W - mw - 10, my = 8;
    // rail
    g.fillStyle = 'rgba(10, 14, 20, 0.75)';
    g.fillRect(mx, my, mw, mh);
    // rms bar
    const rw = Math.max(1, Math.min(1, rms / 0.7) * mw);
    g.fillStyle = clipped ? '#f43f5e' : 'rgba(34, 211, 238, 0.85)';
    g.fillRect(mx, my, rw, mh);
    // peak tick
    const px = mx + Math.max(1, Math.min(1, peak / 0.9) * mw);
    g.fillStyle = clipped ? '#fecdd3' : 'rgba(235, 244, 255, 0.9)';
    g.fillRect(Math.min(mx + mw - 2, px), my, 2, mh);
    // clip lamp
    g.beginPath();
    g.arc(mx - 10, my + mh / 2, 4, 0, Math.PI * 2);
    g.fillStyle = clipped ? '#f43f5e' : '#1b2330';
    g.fill();
    if (clipped) {
      g.strokeStyle = 'rgba(244, 63, 94, 0.5)';
      g.lineWidth = 4;
      g.stroke();
      g.lineWidth = 1;
    }
  }

  _drawIdle(ts) {
    const { g, W, H } = this;
    const t = ts / 900;
    g.beginPath();
    for (let x = 0; x <= W; x += 4) {
      const env = Math.sin((x / W) * Math.PI);
      const y = H / 2 + Math.sin(x * 0.02 + t) * 8 * env
                        + Math.sin(x * 0.006 - t * 0.6) * 5 * env;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.strokeStyle = 'rgba(34, 211, 238, 0.35)';
    g.lineWidth = 1.6;
    g.stroke();
  }
}
