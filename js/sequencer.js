/* PulseGrid — sequencer.js
 *
 * Lookahead scheduler (the classic Chris Wilson pattern): a 25 ms interval
 * schedules audio events ~120 ms ahead on the AudioContext clock, so timing
 * is sample-accurate and immune to main-thread jank. UI playhead events are
 * queued with their exact audio timestamps and consumed by requestAnimationFrame.
 */

'use strict';

class Sequencer {
  constructor() {
    this.engine = null;      // injected by app.js
    this.isPlaying = false;
    this.step = 0;
    this.nextTime = 0;
    this.timer = null;
    this.drawQueue = [];
    // Background tabs throttle setInterval to ~1 Hz; schedule much further
    // ahead there so playback never starves. Chrome exempts audible pages
    // from intensive throttling, but this covers every browser.
    this.lookahead = 0.12;
    this.songIndex = 0;       // current slot in the song chain
    this._barsLeft = 0;       // repeats left in the current slot
    this._barsStarted = 0;
    this.onSongAdvance = null; // set by app.js
    document.addEventListener('visibilitychange', () => this._applyThrottle());
  }

  _applyThrottle() {
    this.lookahead = document.hidden ? 1.6 : 0.12;
    if (!this.isPlaying) return;
    if (this.timer) clearInterval(this.timer);
    const interval = document.hidden ? 200 : 25;
    this.timer = setInterval(() => this.scheduler(), interval);
  }

  get state() { return PG.state; }

  start() {
    if (this.isPlaying) return;
    this.engine.ensure();
    const ctx = this.engine.ctx;
    if (ctx.state === 'suspended') ctx.resume();
    this.isPlaying = true;
    this.nextTime = ctx.currentTime + 0.06;
    this._barsStarted = 0;
    this.songIndex = 0;
    const song = this.state.song;
    if (song && song.enabled && song.chain.length) {
      this.state.active = song.chain[0];
      this._barsLeft = Math.max(0, ((song.reps || [])[0] || 1) - 1);
      if (this.onSongAdvance) this.onSongAdvance(0);
    }
    this._applyThrottle();
    this.scheduler();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.isPlaying = false;
    this.step = 0;
    this.drawQueue = [];
  }

  toggle() { this.isPlaying ? this.stop() : this.start(); }

  scheduler() {
    const ctx = this.engine.ctx;
    while (this.nextTime < ctx.currentTime + this.lookahead) {
      const stepDur = 60 / this.state.bpm / 4;
      // swing: delay every odd 16th by a fraction of half a step
      const swing = this.step % 2 === 1 ? this.state.swing * stepDur * 0.5 : 0;
      const t = this.nextTime + swing;

      // song mode: advance the chain at every bar boundary
      if (this.step === 0 && this._barsStarted++ > 0) this._advanceSong();

      this.engine.scheduleStep(this.state.patterns[this.state.active], this.step, t, stepDur);
      if (this.state.click) this.engine.click(t, this.step % 4 === 0);
      // playhead events are only for display; keep the queue bounded so a
      // long-hidden tab (paused rAF) doesn't accumulate thousands of entries
      this.drawQueue.push({ step: this.step, time: t });
      if (this.drawQueue.length > 64) this.drawQueue.splice(0, this.drawQueue.length - 64);

      this.nextTime += stepDur;
      this.step = (this.step + 1) % (this.state.steps || 16);
    }
  }

  _advanceSong() {
    const song = this.state.song;
    if (!song || !song.enabled || !song.chain.length) return;
    if (this._barsLeft > 0) { this._barsLeft--; return; }   // repeat the current slot
    this.songIndex = (this.songIndex + 1) % song.chain.length;
    this.state.active = song.chain[this.songIndex];
    this._barsLeft = Math.max(0, ((song.reps || [])[this.songIndex] || 1) - 1);
    if (this.onSongAdvance) this.onSongAdvance(this.songIndex);
  }

  /** The step that is audible at audio-clock time `now` (defaults to now).
   *  Swing shifts actual onsets but quantizing to the straight grid is fine
   *  for step recording. Pure enough to unit-test with a fake engine. */
  currentStep(now) {
    if (now == null) now = this.engine.ctx.currentTime;
    const len = this.state.steps || 16;
    const stepDur = 60 / this.state.bpm / 4;
    const ahead = (this.nextTime - now) / stepDur;      // how far the schedule runs ahead
    const behind = Math.ceil(ahead);                     // boundaries between now and the next one
    return ((this.step - behind) % len + len) % len;
  }
}
