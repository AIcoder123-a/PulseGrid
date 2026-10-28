/* PulseGrid — visualizer.js
 *
 * Real-time canvas visuals driven by a single AnalyserNode. Three switchable
 * modes (spectrum+wave, cyber-grid pulse, scope/lissajous) plus a full-screen
 * "performance" mode for recording demos. Reads the kick/bass band each frame
 * so the cyber grid breathes with the beat. Everything runs inside one
 * requestAnimationFrame loop and never touches the audio scheduling clock.
 *
 * Lightweight by design: no per-frame allocations in the hot path, no external
 * libraries, and it degrades to a slow idle sine when there is no audio.
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
    this.mode = 0;          // 0 = spectrum, 1 = cyber grid, 2 = scope
    this.perf = false;      // performance / fullscreen overlay
    this.clipUntil = 0;     // latch the clip lamp for 1.5 s
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

  setMode(m) { this.mode = ((m % 3) + 3) % 3; }
  cycleMode() { this.setMode(this.mode + 1); }
  togglePerf() {
    this.perf = !this.perf;
    if (typeof document !== 'undefined' && document.body) {
      document.body.classList.toggle('viz-perf', this.perf);
    }
    // CSS just resized the canvas — re-read its pixel box next frame
    requestAnimationFrame(() => this._resize());
    return this.perf;
  }

  /* ---- safe accessors into the global app state (guarded for headless) ---- */
  _state() {
    try { if (typeof PG !== 'undefined' && PG.state) return PG.state; } catch (e) {}
    return null;
  }
  _step() {
    try {
      if (typeof PG !== 'undefined' && PG.seq && PG.seq.isPlaying &&
          PG.engine && PG.engine.ctx) {
        return PG.seq.currentStep(PG.engine.ctx.currentTime);
      }
    } catch (e) {}
    return -1;
  }

  _resize() {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 120;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
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
      if (this.mode === 0) {
        this._drawSpectrum(); this._drawWave(); this._drawMeter(ts);
      } else if (this.mode === 1) {
        this._drawCyber(ts); this._drawMeter(ts);
      } else {
        this._drawScope(ts); this._drawMeter(ts);
      }
    } else {
      if (this.mode === 1) this._drawCyberIdle(ts);
      else if (this.mode === 2) this._drawScopeIdle(ts);
      else this._drawIdle(ts);
    }
    if (this.perf) this._drawPerfOverlay(ts);
    requestAnimationFrame(this._loop);
  }

  /* ================= mode 0: spectrum + waveform ================= */

  _drawSpectrum() {
    const { g, W, H } = this;
    this.analyser.getByteFrequencyData(this.freqData);
    const bins = this.freqData.length;
    const N = Math.max(48, Math.floor(W / 14));
    const bw = W / N;

    g.fillStyle = this.gradient;
    for (let i = 0; i < N; i++) {
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

  /* ================= mode 1: cyber grid (kick-reactive) ================= */

  _bass() {
    if (!this.freqData) return 0;
    let sum = 0, n = 0;
    const k = Math.max(1, Math.floor(this.freqData.length * 0.06));
    for (let i = 0; i < k; i++) { sum += this.freqData[i]; n++; }
    return n ? (sum / n) / 255 : 0;
  }

  _drawCyber(ts) {
    const { g, W, H } = this;
    this.analyser.getByteFrequencyData(this.freqData);
    const bass = this._bass();
    const glow = 0.25 + bass * 0.75;
    const hue = 190 + bass * 130;                       // cyan -> magenta on hits
    const cx = W / 2, cy = H * 0.62;

    // receding floor grid
    g.save();
    g.strokeStyle = `hsla(${hue}, 90%, ${30 + bass * 30}%, ${0.18 + bass * 0.4})`;
    g.lineWidth = 1;
    const rows = 10;
    for (let r = 0; r <= rows; r++) {
      const yy = cy + ((H - cy) * Math.pow(r / rows, 2)) + Math.sin(ts / 600 + r) * bass * 6;
      g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke();
    }
    const cols = 16;
    for (let c = 0; c <= cols; c++) {
      const fx = c / cols;
      const x1 = cx + (fx - 0.5) * (W * 0.12);
      const x2 = cx + (fx - 0.5) * W * 1.4;
      g.beginPath(); g.moveTo(x1, cy); g.lineTo(x2, H); g.stroke();
    }
    g.restore();

    // pulsing core ring — breathes with the kick
    const rad = (Math.min(W, H) * 0.12) * (1 + bass * 0.9);
    g.save();
    g.globalAlpha = 0.35 + bass * 0.5;
    g.strokeStyle = `hsl(${hue}, 95%, 65%)`;
    g.lineWidth = 2 + bass * 6;
    g.shadowColor = `hsl(${hue}, 95%, 60%)`;
    g.shadowBlur = 10 + bass * 40;
    g.beginPath(); g.arc(cx, cy - rad * 0.3, rad, 0, Math.PI * 2); g.stroke();
    g.restore();

    // floating bass-reactive particles
    g.save();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + ts / 1400;
      const rr = rad * (1.6 + 0.5 * Math.sin(ts / 500 + i));
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr * 0.6;
      g.globalAlpha = 0.3 + bass * 0.6;
      g.fillStyle = `hsl(${hue + i * 6}, 90%, 70%)`;
      g.beginPath(); g.arc(x, y, 1.5 + bass * 4, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    void glow;
  }

  _drawCyberIdle(ts) {
    const { g, W, H } = this;
    const t = ts / 1200;
    const cx = W / 2, cy = H * 0.62;
    g.save();
    g.strokeStyle = 'rgba(34, 211, 238, 0.16)';
    g.lineWidth = 1;
    for (let r = 0; r <= 8; r++) {
      const yy = cy + (H - cy) * Math.pow(r / 8, 2);
      g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke();
    }
    g.globalAlpha = 0.5 + 0.3 * Math.sin(t);
    g.strokeStyle = 'rgba(129, 140, 248, 0.5)';
    g.beginPath(); g.arc(cx, cy, 22 + 6 * Math.sin(t * 1.5), 0, Math.PI * 2); g.stroke();
    g.restore();
  }

  /* ================= mode 2: scope / lissajous ================= */

  _drawScope(ts) {
    const { g, W, H } = this;
    this.analyser.getByteTimeDomainData(this.waveData);
    const n = this.waveData.length;
    const off = Math.floor(n / 3);                      // phase shift -> lissajous
    g.save();
    g.translate(W / 2, H / 2);
    g.strokeStyle = 'rgba(34, 211, 238, 0.85)';
    g.shadowColor = 'rgba(34, 211, 238, 0.7)';
    g.shadowBlur = 8;
    g.lineWidth = 1.6;
    g.beginPath();
    const sX = (W / 2 - 6), sY = (H / 2 - 6);
    for (let i = 0; i < n - off; i += 2) {
      const x = ((this.waveData[i] - 128) / 128) * sX;
      const y = ((this.waveData[i + off] - 128) / 128) * sY;
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
    void ts;
  }

  _drawScopeIdle(ts) {
    const { g, W, H } = this;
    const t = ts / 1000;
    g.save();
    g.translate(W / 2, H / 2);
    g.strokeStyle = 'rgba(129, 140, 248, 0.6)';
    g.shadowColor = 'rgba(129, 140, 248, 0.5)';
    g.shadowBlur = 6;
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const x = Math.sin(a * 3 + t) * (W / 4) * Math.cos(a * 2);
      const y = Math.sin(a * 2 + t) * (H / 4);
      i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  /* ================= shared: meter + performance overlay ================= */

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
    g.fillStyle = 'rgba(10, 14, 20, 0.75)';
    g.fillRect(mx, my, mw, mh);
    const rw = Math.max(1, Math.min(1, rms / 0.7) * mw);
    g.fillStyle = clipped ? '#f43f5e' : 'rgba(34, 211, 238, 0.85)';
    g.fillRect(mx, my, rw, mh);
    const px = mx + Math.max(1, Math.min(1, peak / 0.9) * mw);
    g.fillStyle = clipped ? '#fecdd3' : 'rgba(235, 244, 255, 0.9)';
    g.fillRect(Math.min(mx + mw - 2, px), my, 2, mh);
    g.beginPath();
    g.arc(mx - 10, my + mh / 2, 4, 0, Math.PI * 2);
    g.fillStyle = clipped ? '#f43f5e' : '#1b2330';
    g.fill();
    if (clipped) {
      g.strokeStyle = 'rgba(244, 63, 94, 0.5)';
      g.lineWidth = 4; g.stroke(); g.lineWidth = 1;
    }
  }

  _drawPerfOverlay(ts) {
    const { g, W, H } = this;
    const st = this._state();
    if (!st) return;
    // top step rail
    const N = st.steps || 16;
    const step = this._step();
    const pad = 14, rw = W - pad * 2, cw = rw / N - 2;
    g.save();
    for (let i = 0; i < N; i++) {
      const x = pad + i * (rw / N);
      g.fillStyle = (i === step) ? '#22d3ee'
                  : (i % 4 === 0) ? 'rgba(129,140,248,0.55)' : 'rgba(120,130,150,0.28)';
      g.fillRect(x, 10, Math.max(2, cw), i === step ? 7 : 4);
    }
    // top-left readout: BPM + active pattern letter
    const letters = ['A', 'B', 'C', 'D'];
    g.font = '700 15px system-ui, sans-serif';
    g.fillStyle = '#e7ecf5';
    g.textBaseline = 'top';
    g.fillText(st.bpm + ' BPM', pad, 22);
    g.fillStyle = '#22d3ee';
    g.fillText('Pattern ' + (letters[st.active] || 'A'), pad, 42);
    // top-right: mode name
    const names = ['SPECTRUM', 'CYBER GRID', 'SCOPE'];
    g.textAlign = 'right';
    g.fillStyle = 'rgba(129,140,248,0.9)';
    g.fillText(names[this.mode] + (this.perf ? ' · PERF' : ''), W - pad, 22);
    g.restore();
    void ts;
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
