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
      // Repair autosaves written by the v1.8.2 dark-vibe bug: a mood prompt
      // could persist a 78-265Hz low-pass, which muted the whole mix on every
      // later visit. Anything under 400Hz is inaudible for this material, so
      // lift it back to a workable 600Hz. User-dragged values are unaffected
      // once they exceed the threshold, and share links stay byte-faithful.
      if (state && state.fx && state.fx.filter < 400) state.fx.filter = 600;
    }
    if (!state) {
      state = demoState();
      window.__firstVisitDemo = true;
    }

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

    let lang = 'en';
    try {
      lang = localStorage.getItem('pulsegrid-lang') ||
        ((navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en');
    } catch (e) {}
    setLang(lang, false);

    UI.build();
    UI.refreshAll();
    if (PG.state.rec) document.getElementById('btnRec').classList.add('active');
    if (PG.state.click) document.getElementById('btnClick').classList.add('active');
    PG.markDirty();
    // song mode auto-follow: keep the grid showing the pattern that is playing
    seq.onSongAdvance = () => {
      UI.refreshPatternButtons();
      UI.refreshGrid();
      UI.refreshSong();
    };
    if (shared && state) UI.toast(t('tShared'));
    else if (window.__firstVisitDemo) UI.toast(t('tDemo'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
