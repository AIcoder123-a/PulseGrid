/* PulseGrid — app.js
 *
 * Bootstrap: wires engine ↔ sequencer ↔ UI, restores autosaved state,
 * exposes window.PG for tinkering from the console (try PG.engine.getLevel()).
 */

'use strict';

window.PG = {};

(function boot() {
  function start() {
    const engine = new AudioEngine();
    const seq = new Sequencer();
    seq.engine = engine;

    let state = null;
    const shared = location.hash.match(/p=([A-Za-z0-9_-]+)/);
    if (shared) {
      try { state = UI.decodeShare(shared[1]); } catch (e) { state = null; }
    }
    if (!state) {
      try {
        const raw = localStorage.getItem('pulsegrid-state');
        if (raw) state = UI.normalizeState(JSON.parse(raw));
      } catch (e) { /* corrupted save — fall back to defaults */ }
    }
    if (!state) state = defaultState();

    const viz = new Visualizer(document.getElementById('viz'));

    PG.engine = engine;
    PG.seq = seq;
    PG.viz = viz;
    PG.ui = UI;
    PG.state = state;

    // debounced autosave, flushed on tab hide / close so nothing is lost
    let saveTimer = null;
    const saveNow = () => {
      clearTimeout(saveTimer);
      try { localStorage.setItem('pulsegrid-state', JSON.stringify(PG.state)); } catch (e) {}
    };
    PG.markDirty = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNow, 500);
    };
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });

    UI.build();
    UI.refreshAll();
    PG.markDirty();
    // song mode auto-follow: keep the grid showing the pattern that is playing
    seq.onSongAdvance = () => {
      UI.refreshPatternButtons();
      UI.refreshGrid();
      UI.refreshSong();
    };
    if (shared && state) UI.toast('Loaded shared pattern — hit Play ▶');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
