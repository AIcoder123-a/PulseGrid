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
