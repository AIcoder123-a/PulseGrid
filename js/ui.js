/* PulseGrid — ui.js
 *
 * Builds and syncs the whole interface: transport, drum grid, bass piano
 * roll, FX rack, pattern bank, presets, persistence. Pure DOM, no framework.
 */

'use strict';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/** Rotate a lane right by `shift` steps (negative = left). Pure for tests. */
function rotated(lane, shift) {
  const n = lane.length;
  const k = ((shift % n) + n) % n;
  return k === 0 ? lane.slice() : lane.slice(n - k).concat(lane.slice(0, n - k));
}

/** Q–I row = C4..C5 white keys; Shift+Q/W/T/Y/U = the sharp to their left. */
const LEAD_KEYS = {
  KeyQ: 60, KeyW: 62, KeyE: 64, KeyR: 65, KeyT: 67, KeyY: 69, KeyU: 71, KeyI: 72,
};

/** '36+' → { midi: 36, accent: true }; '' / junk → null */
function parseNoteTok(tok) {
  if (!tok) return null;
  const m = tok.match(/^(\d+)(\+?)$/);
  return m ? { midi: +m[1], accent: m[2] === '+' } : null;
}

/** '60.63.67+' → { notes: [60,63,67], accent: true }; '' / junk → null */
function parseLeadTok(tok) {
  if (!tok) return null;
  const accent = tok.endsWith('+');
  const notes = [...new Set(tok.replace(/\+$/, '').split('.').map(Number)
    .filter((m) => Number.isInteger(m) && m >= LEAD_MIDI_LO && m <= LEAD_MIDI_HI))];
  return notes.length ? { notes: notes.slice(0, 3), accent } : null;
}

/** Lead-lane sanitizer for normalizeState: accepts legacy { midi } singles
 *  and { notes } chords, clamps/dedupes, returns null for junk. */
function sanitizeLead(v) {
  if (!v || typeof v !== 'object') return null;
  const raw = typeof v.midi === 'number' ? [v.midi] : (Array.isArray(v.notes) ? v.notes : null);
  if (!raw) return null;
  const notes = [...new Set(raw.map((m) => Math.round(m))
    .filter((m) => m >= LEAD_MIDI_LO && m <= LEAD_MIDI_HI))];
  return notes.length ? { notes: notes.slice(0, 3), accent: !!v.accent } : null;
}

const $ = (id) => document.getElementById(id);

const UI = {
  stepCells: {},    // trackId -> [cell × 16]
  rollCells: {},    // midi -> [cell × 16]
  columns: [],      // step -> [all cells in that column] (drums + roll)
  patternBtns: [],
  ph: null,         // current playhead step or null
  painting: false,
  paintVal: false,

  /* ================= build ================= */

  build() {
    document.addEventListener('pointerover', (e) => {
      const cell = e.target && e.target.closest ? e.target.closest('.step, .roll-cell') : null;
      const sel = cell ? '[data-s="' + cell.dataset.s + '"]' : null;
      if (sel === this._colHi) return;
      if (this._colHi) document.querySelectorAll(this._colHi).forEach((c) => c.classList.remove('col-hi'));
      this._colHi = sel;
      if (sel) document.querySelectorAll(sel).forEach((c) => c.classList.add('col-hi'));
    });

    this.undoStack = [];
    this.redoStack = [];
    this._lastPushAt = 0;
    this.buildGrids();
    this.buildPatternButtons();
    this._bindLaneClearing();
    this.buildPresets();
    this.buildSong();
    this.buildGenerator();
    this.buildVibe();
    this.buildSoundPanel();
    this.bindTransport();
    this.bindFX();
    this.bindImportExport();
    this.bindExportTools();
    this.bindKeys();
    this.buildVisualizer();
    requestAnimationFrame(() => this._tick());
  },

  buildLeadRoll() {
    const host = $('leadroll');

    const bar = document.createElement('div');
    bar.className = 'lane bass-bar lead-bar';
    bar.style.setProperty('--c', '#fbbf24');
    bar.innerHTML =
      `<div class="lane-ctl">` +
      `<button class="mini mute" title="Mute lead">M</button>` +
      `<button class="mini solo" title="Solo lead">S</button>` +
      `<button class="mini chord" title="Chord mode: clicks place minor triads">♪</button>` +
      `<span class="dot"></span><span class="lane-name" data-track="lead" title="${t('tLaneClearHint')}">${trackName('lead')}</span>` +
      `<input type="range" class="lane-vol" min="0" max="100" title="Lead volume">` +
      `</div><div class="lane-grid"></div>`;

    const bMute = bar.querySelector('.mute');
    const bSolo = bar.querySelector('.solo');
    const bVol = bar.querySelector('.lane-vol');
    bMute.addEventListener('click', () => {
      const s = PG.state.trackState.lead;
      s.mute = !s.mute;
      bMute.classList.toggle('active', s.mute);
      this.applyTrackGains();
      PG.markDirty();
    });
    bSolo.addEventListener('click', () => {
      const s = PG.state.trackState.lead;
      s.solo = !s.solo;
      bSolo.classList.toggle('active', s.solo);
      this.applyTrackGains();
      PG.markDirty();
    });
    bVol.addEventListener('input', () => {
      PG.state.trackState.lead.vol = bVol.value / 100;
      this.applyTrackGains();
      PG.markDirty();
    });
    this.leadCtl = { mute: bMute, solo: bSolo, vol: bVol };
    const chordBtn = bar.querySelector('.chord');
    chordBtn.addEventListener('click', () => {
      this.chordMode = !this.chordMode;
      chordBtn.classList.toggle('active', this.chordMode);
      this.toast(this.chordMode ? t('tChordOn') : t('tChordOff'));
    });
    host.appendChild(bar);

    this.leadCells = {};
    for (let midi = LEAD_MIDI_HI; midi >= LEAD_MIDI_LO; midi--) {
      const row = document.createElement('div');
      row.className = 'roll-row';
      if (midiName(midi).includes('#')) row.classList.add('sharp');

      const label = document.createElement('span');
      label.className = 'roll-label';
      label.textContent = midiName(midi);
      row.appendChild(label);

      this.leadCells[midi] = [];
      const N = PG.state.steps || 16;
      for (let s = 0; s < N; s++) {
        const cell = document.createElement('button');
        cell.className = 'roll-cell lead-cell beat-' + (Math.floor(s / 4) % 2);
        cell.dataset.s = s;
        cell.title = `${midiName(midi)} · step ${s + 1}  (click: note → accent → off)`;
        cell.addEventListener('click', () => this.cycleLeadCell(midi, s));
        row.appendChild(cell);
        this.leadCells[midi].push(cell);
        (this.columns[s] || (this.columns[s] = [])).push(cell);
      }
      host.appendChild(row);
    }
  },

  /** Lead step for `midi`: a minor triad in chord mode, a single note otherwise. */
  buildLeadNotes(midi) {
    if (!this.chordMode) return [midi];
    const triad = [midi, midi + 3, midi + 7].filter((m) => m >= LEAD_MIDI_LO && m <= LEAD_MIDI_HI);
    return triad.length >= 2 ? triad : [midi];
  },

  cycleLeadCell(midi, step) {
    this.pushUndo(true);
    const lane = PG.state.patterns[PG.state.active].tracks.lead;
    const cur = lane[step];
    const curHit = cur && cur.notes && cur.notes.includes(midi);
    if (cur && !curHit) lane[step] = null;   // replace whatever sat in this column
    if (!cur || !curHit) {
      lane[step] = { notes: this.buildLeadNotes(midi), accent: false };
      if (!PG.seq.isPlaying) PG.engine.previewLead(lane[step].notes, false);
    } else if (!cur.accent) {
      cur.accent = true;
      if (!PG.seq.isPlaying) PG.engine.previewLead(cur.notes, true);
    } else {
      lane[step] = null;
    }
    this.refreshLeadCol(step);
    PG.markDirty();
  },

  /** Light every cell of a lead column for its chord (or clear the column). */
  refreshLeadCol(step) {
    const note = PG.state.patterns[PG.state.active].tracks.lead[step];
    const lit = note ? note.notes : [];
    for (let midi = LEAD_MIDI_LO; midi <= LEAD_MIDI_HI; midi++) {
      const cell = this.leadCells[midi][step];
      const on = lit.includes(midi);
      cell.classList.toggle('on', on);
      cell.classList.toggle('acc', on && !!note && note.accent);
      cell.setAttribute('aria-pressed', String(on));
    }
  },

  /* ================= undo / redo ================= */

  /** Snapshot the whole project state (plain JSON data). */
  snapshot() { return JSON.stringify(PG.state); },

  /** Call BEFORE a mutation. `coalesce` merges bursts of fine edits
   *  (cell painting, slider drags) into one undo step. */
  pushUndo(coalesce = false) {
    const now = Date.now();
    if (coalesce && this._lastPushAt && now - this._lastPushAt < 900) {
      this._lastPushAt = now;
      return;
    }
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 60) this.undoStack.shift();
    this.redoStack.length = 0;
    this._lastPushAt = now;
  },

  undo() {
    if (!this.undoStack || !this.undoStack.length) { this.toast(t('tNothingUndo')); return; }
    this.redoStack.push(this.snapshot());
    PG.state = this.normalizeState(JSON.parse(this.undoStack.pop()));
    this._lastPushAt = 0;
    this._restoreUi();
    PG.markDirty();
    this.toast(t('tUndo'));
  },

  redo() {
    if (!this.redoStack || !this.redoStack.length) { this.toast(t('tNothingRedo')); return; }
    this.undoStack.push(this.snapshot());
    PG.state = this.normalizeState(JSON.parse(this.redoStack.pop()));
    this._lastPushAt = 0;
    this._restoreUi();
    PG.markDirty();
    this.toast(t('tRedo'));
  },

  /** Shared post-restore refresh: rebuild the grid when the step count differs. */
  _restoreUi() {
    const want32 = (PG.state.steps || 16) === 32;
    if (want32 !== document.body.classList.contains('app-32')) {
      this.buildGrids();
    }
    this.refreshAll();
    this.applyEngineParams();
  },

  buildGrids() {
    this.stepCells = {};
    this.rollCells = {};
    this.leadCells = {};
    this.columns = [];
    document.getElementById('tracks').innerHTML = '';
    document.getElementById('roll').innerHTML = '';
    document.getElementById('leadroll').innerHTML = '';
    this.buildTracks();
    this.buildRoll();
    this.buildLeadRoll();
    document.body.classList.toggle('app-32', (PG.state.steps || 16) === 32);
  },

  /* ================= pattern length (16 / 32) ================= */

  setSteps(n) {
    if ((PG.state.steps || 16) === n) return;
    this.pushUndo();
    PG.state.steps = n;
    PG.state.patterns = PG.state.patterns.map((p) => resizePattern(p, n));
    PG.state.song.chain = PG.state.song.chain.slice(0, 16);
    this.buildGrids();
    this.refreshAll();
    this.applyEngineParams();
    PG.markDirty();
    this.toast(n === 32 ? t('tLen32') : t('tLen16'));
  },

  _bindLaneClearing() {
    if (this._laneClearBound) return;
    this._laneClearBound = true;
    document.addEventListener('contextmenu', (e) => {
      const name = e.target && e.target.closest ? e.target.closest('.lane-name') : null;
      if (!name || !name.dataset.track) return;
      e.preventDefault();
      const id = name.dataset.track;
      this.pushUndo();
      const lane = PG.state.patterns[PG.state.active].tracks[id];
      PG.state.patterns[PG.state.active].tracks[id] = lane.map((v) => (typeof v === 'object' ? null : 0));
      this.refreshGrid();
      PG.markDirty();
      this.toast(t('tLaneCleared', { name: trackName(id) }));
    });
  },

  /** Quantize a live pad hit into the audible step (transport running). */
  recordHit(id) {
    const step = PG.seq.currentStep();
    const lane = PG.state.patterns[PG.state.active].tracks[id];
    if (lane[step]) return;                       // already written — keep accents intact
    this.pushUndo(true);
    this.setDrumCell(id, step, 1);
    const cell = this.stepCells[id][step];
    cell.classList.remove('rec-flash');
    void cell.offsetWidth;                        // restart the animation
    cell.classList.add('rec-flash');
  },

  /** Quantize a live lead-key hit into the audible step (transport running). */
  recordLead(midi) {
    const step = PG.seq.currentStep();
    const lane = PG.state.patterns[PG.state.active].tracks.lead;
    const cur = lane[step];
    if (cur && cur.notes.length === 1 && cur.notes[0] === midi) return;  // already there
    this.pushUndo(true);
    lane[step] = { notes: [midi], accent: false };
    this.refreshLeadCol(step);
    PG.markDirty();
  },

  _songDragMove(e) {
    const d = this._songDrag;
    if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.x0) < 8) return;
      d.active = true;
      d.chip.classList.add('dragging');
    }
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.song-chip');
    document.querySelectorAll('.song-chip.insert-before').forEach((c) => c.classList.remove('insert-before'));
    if (over && over !== d.chip) over.classList.add('insert-before');
  },

  _songDragUp(e) {
    const d = this._songDrag;
    if (!d) return;
    this._songDrag = null;
    if (!d.active) return;                        // plain click — let it through
    d.chip.classList.remove('dragging');
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('.song-chip');
    document.querySelectorAll('.song-chip.insert-before').forEach((c) => c.classList.remove('insert-before'));
    // a same-chip release fires a click right after pointerup — suppress that
    // one, then clear the flag so the user's next click is never swallowed
    this._suppressChipClick = true;
    setTimeout(() => { this._suppressChipClick = false; }, 0);
    if (!over || over === d.chip) { this.refreshSong(); return; }
    const from = d.slot;
    const to = +over.dataset.slot;
    const song = PG.state.song;
    const [pat] = song.chain.splice(from, 1);
    song.chain.splice(to, 0, pat);
    const [rep] = song.reps.splice(from, 1);
    song.reps.splice(to, 0, rep);
    if (PG.seq.isPlaying && song.enabled) {
      PG.seq.songIndex = song.chain.indexOf(PG.state.active);
      if (PG.seq.songIndex < 0) PG.seq.songIndex = 0;
    }
    this.pushUndo();
    this.refreshSong();
    PG.markDirty();
    this.toast(t('tReordered'));
  },

  /** Rotate every lane of the active pattern (whole-groove shift). */
  rotatePattern(dir) {
    this.pushUndo();
    const p = PG.state.patterns[PG.state.active];
    const n = PG.state.steps || 16;
    const k = ((dir % n) + n) % n;
    for (const key of Object.keys(p.tracks)) p.tracks[key] = rotated(p.tracks[key], k);
    this.refreshGrid();
    PG.markDirty();
    this.toast(t('tRotated', { n: dir > 0 ? k : k ? n - k : 0 }));
  },

  /** Toggle the metronome click (CNT). Shared by the button and the `M` key. */
  toggleClick() {
    PG.state.click = !PG.state.click;
    $('btnClick').classList.toggle('active', PG.state.click);
    PG.markDirty();
    this.toast(PG.state.click ? t('tClickOn') : t('tClickOff'));
  },

  toggleHelp(force) {
    const el = $('help');
    const show = force != null ? force : !el.classList.contains('open');
    el.classList.toggle('open', show);
  },

  /* ================= song mode ================= */

  buildSong() {
    if (!this._songDragBound) {
      this._songDragBound = true;
      document.addEventListener('pointermove', (e) => this._songDragMove(e));
      document.addEventListener('pointerup', (e) => this._songDragUp(e));
    }

    $('btnSongMode').addEventListener('click', () => {
      const song = PG.state.song;
      if (!song.chain.length) {
        song.chain = [0, 1];
        song.reps = [1, 1];
      }
      song.enabled = !song.enabled;
      if (song.enabled && PG.seq.isPlaying) {
        PG.seq.songIndex = song.chain.indexOf(PG.state.active);
        if (PG.seq.songIndex < 0) PG.seq.songIndex = 0;
      }
      this.refreshSong();
      PG.markDirty();
      this.toast(song.enabled ? t('tSongOn') : t('tSongOff'));
    });
    $('btnSongAdd').addEventListener('click', () => {
      const song = PG.state.song;
      if (song.chain.length >= 16) return;
      song.chain.push(PG.state.active);
      song.reps = song.reps || song.chain.map(() => 1);
      song.reps.push(1);
      this.refreshSong();
      PG.markDirty();
    });
    $('btnSongClear').addEventListener('click', () => {
      PG.state.song.chain = [0, 1];
      PG.state.song.reps = [1, 1];
      this.refreshSong();
      PG.markDirty();
    });
    this.refreshSong();
  },

  refreshSong() {
    const song = PG.state.song;
    const host = $('songChain');
    host.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];
    const reps = song.reps || (song.reps = song.chain.map(() => 1));
    song.chain.forEach((patIdx, slot) => {
      const chip = document.createElement('button');
      chip.className = 'song-chip';
      chip.textContent = letters[patIdx] + (reps[slot] > 1 ? '×' + reps[slot] : '');
      chip.title = `Bar ${slot + 1}: pattern ${letters[patIdx]} — click cycles, right-click cycles repeats (×1–×4), past D removes`;
      if (PG.seq.isPlaying && song.enabled && PG.seq.songIndex === slot) chip.classList.add('playing');
      chip.dataset.slot = slot;
      chip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        this._songDrag = { slot, x0: e.clientX, active: false, chip };
      });
      chip.addEventListener('click', () => {
        if (this._suppressChipClick) { this._suppressChipClick = false; return; }
        this.pushUndo(true);
        song.chain[slot] = (song.chain[slot] + 1) % 5;
        if (song.chain[slot] === 4) {
          song.chain.splice(slot, 1);
          song.reps.splice(slot, 1);
        }
        if (!song.chain.length) song.enabled = false;
        this.refreshSong();
        PG.markDirty();
      });
      chip.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.pushUndo(true);
        song.reps = song.reps || song.chain.map(() => 1);
        song.reps[slot] = (song.reps[slot] || 1) % 4 + 1;
        if (PG.seq.isPlaying && song.enabled) {
          PG.seq._barsLeft = Math.max(0, (song.reps[PG.seq.songIndex] || 1) - 1);
        }
        this.refreshSong();
        PG.markDirty();
        this.toast(t('tRep', { n: song.reps[slot] }));
      });
      host.appendChild(chip);
    });
    if (!song.chain.length) {
      const empty = document.createElement('span');
      empty.className = 'song-empty';
      empty.textContent = t('songEmpty');
      host.appendChild(empty);
    }
    const btn = $('btnSongMode');
    btn.textContent = song.enabled ? t('songOn') : t('songOff');
    btn.classList.toggle('active', song.enabled);
    $('songPos').textContent = PG.seq.isPlaying && song.enabled && song.chain.length
      ? t('tBarPos', { cur: PG.seq.songIndex + 1, total: song.chain.length })
      : '';
  },

  /* ================= beat generator ================= */

  buildGenerator() {
    const sel = $('genStyle');
    for (const s of Generator.styles) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    }
    $('btnGenerate').addEventListener('click', () => {
      this.pushUndo();
      const style = sel.value;
      const density = $('genDensity').value / 100;
      const { pattern, bpm, swing, fx: fxParams } = Generator.generate(style, density, undefined, PG.state.steps || 16);
      PG.state.patterns[0] = pattern;
      PG.state.patterns[1] = Generator.mutate(pattern);
      PG.state.active = 0;
      PG.state.bpm = bpm;
      PG.state.swing = swing;
      if (fxParams) {
        PG.state.fx.pump = fxParams.pump ?? PG.state.fx.pump;
        PG.state.fx.humanize = fxParams.humanize ?? PG.state.fx.humanize;
      }
      this.refreshAll();
      this.applyEngineParams();
      PG.markDirty();
      const opt = sel.options[sel.selectedIndex];
      this.toast(t('tNewGroove', { style: opt ? opt.text : '🎲' }));
    });
    $('btnMutate').addEventListener('click', () => {
      this.pushUndo();
      const i = PG.state.active;
      PG.state.patterns[i] = Generator.mutate(PG.state.patterns[i]);
      this.refreshGrid();
      PG.markDirty();
      this.toast(t('tMutated', { p: ['A', 'B', 'C', 'D'][i] }));
    });

    $('btnSongGen').addEventListener('click', () => {
      this.pushUndo();
      const sel = $('genStyle');
      const style = sel.value;
      const density = $('genDensity').value / 100;
      const { patterns, song, bpm, swing, fx: fxParams } = Generator.arrange(style, density);
      PG.state.patterns = patterns;
      PG.state.song = song;
      PG.state.bpm = bpm;
      PG.state.swing = swing;
      if (fxParams) {
        PG.state.fx.pump = fxParams.pump ?? PG.state.fx.pump;
        PG.state.fx.humanize = fxParams.humanize ?? PG.state.fx.humanize;
      }
      this.refreshAll();
      this.applyEngineParams();
      PG.markDirty();
      const opt = sel.options[sel.selectedIndex];
      this.toast(t('tSongGen', { style: opt ? opt.text : '🎼' }));
    });

    $('btnEuc').addEventListener('click', () => {
      this.pushUndo();
      const steps = PG.state.steps || 16;
      const { trackId, k, rotate, lane } = Generator.euclidFill(undefined, steps);
      PG.state.patterns[PG.state.active].tracks[trackId] = lane;
      this.refreshGrid();
      PG.markDirty();
      this.toast(t('tEuc', { k: k + ',' + steps, r: rotate, track: trackName(trackId) }));
      if (!PG.seq.isPlaying) PG.engine.preview(trackId);
    });
  },

  /* ================= vibe prompt generator ================= */

  buildVibe() {
    const input = $('vibePrompt');
    const status = $('vibeStatus');
    if (!input) return;
    const run = () => {
      this.pushUndo();
      const prompt = (input.value || '').trim() || 'surprise groove';
      const steps = PG.state.steps || 16;
      const res = Vibe.generate(prompt, { steps });
      PG.state.patterns[0] = res.pattern;
      PG.state.patterns[1] = Generator.mutate(res.pattern);
      PG.state.active = 0;
      PG.state.bpm = res.bpm;
      PG.state.swing = res.swing;
      PG.state.fx.filter = res.fx.filter;
      PG.state.fx.reverb = res.fx.reverb;
      PG.state.fx.pump = res.fx.pump;
      PG.state.fx.humanize = res.fx.humanize;
      if (res.cfg.sound && res.cfg.sound.kick) {
        PG.state.trackState.kick.tune = res.cfg.sound.kick.tune;
        PG.state.trackState.kick.decay = res.cfg.sound.kick.decay;
      }
      this.refreshAll();
      this.refreshFX();
      this.refreshSoundPanel();
      this.applyEngineParams();
      PG.markDirty();
      const genre = (Generator.styles.find((s) => s.id === res.cfg.style) || {}).name || res.cfg.style;
      const moodKey = 'vibeMood' + res.cfg.mood.charAt(0).toUpperCase() + res.cfg.mood.slice(1);
      const mood = t(moodKey);
      status.textContent = '✨ ' + res.bpm + ' BPM · ' + genre + ' · ' + mood +
        (res.cfg.tags.length ? ' · ' + res.cfg.tags.join('/') : '');
      status.classList.add('show');
      this.toast(t('tVibe', { bpm: res.bpm, style: genre, mood: mood }));
    };
    $('btnVibe').addEventListener('click', run);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); run(); }
    });
    document.querySelectorAll('.vibe-cap').forEach((cap) => {
      cap.addEventListener('click', () => {
        input.value = cap.getAttribute('data-prompt') || '';
        run();
      });
    });
  },

  /* ================= visualizer controls ================= */

  setVizMode(m) {
    if (!PG.viz) return;
    PG.viz.setMode(m);
    document.querySelectorAll('.viz-btn[data-mode]').forEach((b) => {
      b.classList.toggle('active', +b.dataset.mode === m);
    });
  },

  toggleVizPerf() {
    if (!PG.viz) return;
    const on = PG.viz.togglePerf();
    const btn = $('vizPerf');
    if (btn) btn.classList.toggle('active', on);
  },

  buildVisualizer() {
    if (!PG.viz) return;
    const viz = PG.viz;
    document.querySelectorAll('.viz-btn[data-mode]').forEach((b) => {
      b.addEventListener('click', () => this.setVizMode(+b.dataset.mode));
    });
    const perf = $('vizPerf');
    if (perf) perf.addEventListener('click', () => this.toggleVizPerf());
    const canvas = $('viz');
    if (canvas) canvas.addEventListener('click', () => this.setVizMode(viz.mode + 1));
  },

  buildTracks() {
    const host = $('tracks');
    for (const cfg of TRACKS) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      lane.style.setProperty('--c', cfg.color);

      const ctl = document.createElement('div');
      ctl.className = 'lane-ctl';
      ctl.innerHTML =
        `<button class="mini mute" title="Mute">M</button>` +
        `<button class="mini solo" title="Solo">S</button>` +
        `<span class="dot"></span><span class="lane-name" data-track="${cfg.id}" title="${t('tLaneClearHint')}">${trackName(cfg.id)}</span>` +
        `<input type="range" class="lane-vol" min="0" max="100" title="Volume">`;

      const mute = ctl.querySelector('.mute');
      const solo = ctl.querySelector('.solo');
      const vol = ctl.querySelector('.lane-vol');

      mute.addEventListener('click', () => {
        const s = PG.state.trackState[cfg.id];
        s.mute = !s.mute;
        mute.classList.toggle('active', s.mute);
        this.applyTrackGains();
        PG.markDirty();
      });
      solo.addEventListener('click', () => {
        const s = PG.state.trackState[cfg.id];
        s.solo = !s.solo;
        solo.classList.toggle('active', s.solo);
        this.applyTrackGains();
        PG.markDirty();
      });
      vol.addEventListener('input', () => {
        PG.state.trackState[cfg.id].vol = vol.value / 100;
        this.applyTrackGains();
        PG.markDirty();
      });

      const grid = document.createElement('div');
      grid.className = 'lane-grid';
      this.stepCells[cfg.id] = [];
      const N = PG.state.steps || 16;
      for (let s = 0; s < N; s++) {
        const cell = document.createElement('button');
        cell.className = 'step beat-' + (Math.floor(s / 4) % 2);
        cell.dataset.s = s;
        cell.title = `${cfg.name} · step ${s + 1}`;
        cell.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          this.painting = true;
          this.paintVal = !PG.state.patterns[PG.state.active].tracks[cfg.id][s];
          this.setDrumCell(cfg.id, s, this.paintVal);
          // audition the voice while editing with the transport stopped
          if (!PG.seq.isPlaying) PG.engine.preview(cfg.id);
        });
        cell.addEventListener('pointerenter', () => {
          if (this.painting) this.setDrumCell(cfg.id, s, this.paintVal);
        });
        // double-click = accent ON, right-click = accent OFF
        cell.addEventListener('dblclick', (e) => {
          e.preventDefault();
          this.setDrumCell(cfg.id, s, 2);
        });
        cell.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const cur = PG.state.patterns[PG.state.active].tracks[cfg.id][s];
          if (cur === 2) this.setDrumCell(cfg.id, s, 1);
        });
        grid.appendChild(cell);
        this.stepCells[cfg.id].push(cell);
        (this.columns[s] || (this.columns[s] = [])).push(cell);
      }

      lane.appendChild(ctl);
      lane.appendChild(grid);
      host.appendChild(lane);
    }
    document.addEventListener('pointerup', () => { this.painting = false; });
    document.addEventListener('pointercancel', () => { this.painting = false; });
  },

  buildRoll() {
    const host = $('roll');

    // bass strip: same control layout as drum lanes so columns align
    const bar = document.createElement('div');
    bar.className = 'lane bass-bar';
    bar.style.setProperty('--c', '#e879f9');
    bar.innerHTML =
      `<div class="lane-ctl">` +
      `<button class="mini mute" title="Mute bass">M</button>` +
      `<button class="mini solo" title="Solo bass">S</button>` +
      `<span class="dot"></span><span class="lane-name" data-track="bass" title="${t('tLaneClearHint')}">${trackName('bass')}</span>` +
      `<input type="range" class="lane-vol" min="0" max="100" title="Bass volume">` +
      `</div><div class="lane-grid"></div>`;

    const bMute = bar.querySelector('.mute');
    const bSolo = bar.querySelector('.solo');
    const bVol = bar.querySelector('.lane-vol');
    bMute.addEventListener('click', () => {
      const s = PG.state.trackState.bass;
      s.mute = !s.mute;
      bMute.classList.toggle('active', s.mute);
      this.applyTrackGains();
      PG.markDirty();
    });
    bSolo.addEventListener('click', () => {
      const s = PG.state.trackState.bass;
      s.solo = !s.solo;
      bSolo.classList.toggle('active', s.solo);
      this.applyTrackGains();
      PG.markDirty();
    });
    bVol.addEventListener('input', () => {
      PG.state.trackState.bass.vol = bVol.value / 100;
      this.applyTrackGains();
      PG.markDirty();
    });
    this.bassCtl = { mute: bMute, solo: bSolo, vol: bVol };
    host.appendChild(bar);

    for (let midi = BASS_MIDI_HI; midi >= BASS_MIDI_LO; midi--) {
      const row = document.createElement('div');
      row.className = 'roll-row';
      if (midiName(midi).includes('#')) row.classList.add('sharp');

      const label = document.createElement('span');
      label.className = 'roll-label';
      label.textContent = midiName(midi);
      row.appendChild(label);

      this.rollCells[midi] = [];
      const N = PG.state.steps || 16;
      for (let s = 0; s < N; s++) {
        const cell = document.createElement('button');
        cell.className = 'roll-cell beat-' + (Math.floor(s / 4) % 2);
        cell.dataset.s = s;
        cell.title = `${midiName(midi)} · step ${s + 1}  (click: note → accent → off)`;
        cell.addEventListener('click', () => this.cycleBassCell(midi, s));
        row.appendChild(cell);
        this.rollCells[midi].push(cell);
        (this.columns[s] || (this.columns[s] = [])).push(cell);
      }
      host.appendChild(row);
    }
  },

  buildPatternButtons() {
    const host = $('patternBtns');
    const names = ['A', 'B', 'C', 'D'];
    names.forEach((n, i) => {
      const b = document.createElement('button');
      b.className = 'mini pat';
      b.textContent = n;
      b.addEventListener('click', () => {
        PG.state.active = i;
        this.refreshPatternButtons();
        this.refreshGrid();
        PG.markDirty();
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (i === PG.state.active) return;
        this.pushUndo();
        PG.state.patterns[i] = clonePattern(PG.state.patterns[PG.state.active]);
        PG.state.active = i;
        this.refreshPatternButtons();
        this.refreshGrid();
        PG.markDirty();
        this.toast(t('tCopyTo', { p: names[i] }));
      });
      host.appendChild(b);
      this.patternBtns.push(b);
    });
  },

  buildPresets() {
    const sel = $('presetSel');
    for (const p of PRESETS) {
      const o = document.createElement('option');
      o.value = p.name;
      o.textContent = p.name;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      const p = PRESETS.find((x) => x.name === sel.value);
      if (!p) return;
      this.loadPreset(p);
      sel.value = '';
    });
  },

  loadPreset(p) {
    this.pushUndo();
    const st = PG.state;
    st.bpm = p.bpm;
    st.swing = p.swing;
    st.fx = { ...p.fx };
    const n = st.steps || 16;
    st.patterns = [resizePattern(clonePattern(p.patterns[0]), n), resizePattern(clonePattern(p.patterns[1]), n),
                   emptyPattern(n), emptyPattern(n)];
    st.active = 0;
    this.refreshTransport();
    this.refreshPatternButtons();
    this.refreshGrid();
    this.refreshFX();
    this.applyEngineParams();
    PG.markDirty();
    this.toast(t('tPreset', { name: p.name }));
  },

  /* ================= transport ================= */

  bindTransport() {
    $('btnPlay').addEventListener('click', () => this.togglePlay());
    $('btnStop').addEventListener('click', () => {
      PG.seq.stop();
      PG.viz.playing = false;
      this.refreshSong();
      $('btnPlay').classList.remove('playing');
      $('btnPlay').innerHTML = '▶<span>' + t('play') + '</span>';
      this.updateTitle();
    });

    $('bpm').addEventListener('input', () => {
      const v = parseInt($('bpm').value, 10);
      if (!Number.isFinite(v)) return;
      PG.state.bpm = Math.min(200, Math.max(60, v));
      PG.engine.setBpm(PG.state.bpm);
      this.updateTitle();
      PG.markDirty();
    });

    // tap tempo
    let taps = [];
    const tapNow = () => {
      const tapBtn = $('btnTap');
      tapBtn.classList.remove('tapped');
      void tapBtn.offsetWidth;
      tapBtn.classList.add('tapped');
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 6) taps.shift();
      if (taps.length >= 2) {
        let sum = 0;
        for (let i = 1; i < taps.length; i++) sum += taps[i] - taps[i - 1];
        const bpm = Math.round(60000 / (sum / (taps.length - 1)));
        PG.state.bpm = Math.min(200, Math.max(60, bpm));
        $('bpm').value = PG.state.bpm;
        PG.engine.setBpm(PG.state.bpm);
        PG.markDirty();
      }
    };
    this.tapNow = tapNow;
    $('btnTap').addEventListener('click', tapNow);

    $('swing').addEventListener('input', () => {
      PG.state.swing = ($('swing').value / 100) * 0.8;
      $('swingVal').textContent = $('swing').value + '%';
      PG.markDirty();
    });

    $('masterVol').addEventListener('input', () => {
      PG.state.masterVol = $('masterVol').value / 100;
      PG.engine.setMasterVolume(PG.state.masterVol);
      PG.markDirty();
    });

    $('btnCopy').addEventListener('click', () => {
      this.pushUndo();
      const next = (PG.state.active + 1) % 4;
      PG.state.patterns[next] = clonePattern(PG.state.patterns[PG.state.active]);
      PG.state.active = next;
      this.refreshPatternButtons();
      this.refreshGrid();
      PG.markDirty();
      this.toast(t('tCopied', { p: ['A', 'B', 'C', 'D'][next] }));
    });

    $('btnClear').addEventListener('click', () => {
      const btn = $('btnClear');
      if (!this._clearArmed) {
        this._clearArmed = true;
        btn.textContent = t('tSure');
        btn.classList.add('armed');
        this._clearTimer = setTimeout(() => {
          this._clearArmed = false;
          btn.textContent = t('clear');
          btn.classList.remove('armed');
        }, 2000);
        return;
      }
      clearTimeout(this._clearTimer);
      this._clearArmed = false;
      btn.textContent = t('clear');
      btn.classList.remove('armed');
      this.pushUndo();
      PG.state.patterns[PG.state.active] = emptyPattern();
      this.refreshGrid();
      PG.markDirty();
      this.toast(t('tCleared'));
    });
  },

  updateTitle() {
    document.title = (PG.seq.isPlaying ? '▶ ' : '') + PG.state.bpm + ' BPM — PulseGrid';
  },

  togglePlay() {
    const seq = PG.seq;
    const btn = $('btnPlay');
    if (seq.isPlaying) {
      seq.stop();
      PG.viz.playing = false;
      this.refreshSong();
      btn.classList.remove('playing');
      btn.innerHTML = '▶<span>' + t('play') + '</span>';
    } else {
      PG.engine.ensure();
      this.updateTitle();
      this.applyEngineParams();
      seq.start();
      PG.viz.playing = true;
      PG.viz.attach(PG.engine.analyser);
      btn.classList.add('playing');
      btn.innerHTML = '❚❚<span>' + t('stop') + '</span>';
    }
    this.updateTitle();
  },

  /* ================= FX ================= */

  bindFX() {
    $('fxDelay').addEventListener('input', () => {
      PG.state.fx.delay = $('fxDelay').value / 100;
      $('delayVal').textContent = Math.round(PG.state.fx.delay * 100) + '%';
      PG.engine.setDelayMix(PG.state.fx.delay);
      PG.markDirty();
    });
    $('fxReverb').addEventListener('input', () => {
      PG.state.fx.reverb = $('fxReverb').value / 100;
      $('reverbVal').textContent = Math.round(PG.state.fx.reverb * 100) + '%';
      PG.engine.setReverbMix(PG.state.fx.reverb);
      PG.markDirty();
    });
    $('fxFilter').addEventListener('input', () => {
      const hz = this.sliderToHz($('fxFilter').value);
      PG.state.fx.filter = hz;
      $('filterVal').textContent = this.formatHz(hz);
      PG.engine.setMasterFilterHz(hz);
      PG.markDirty();
    });
    $('fxPump').addEventListener('input', () => {
      PG.state.fx.pump = $('fxPump').value / 100;
      $('pumpVal').textContent = Math.round(PG.state.fx.pump * 100) + '%';
      PG.engine.pump = PG.state.fx.pump;
      PG.markDirty();
    });
    $('fxHumanize').addEventListener('input', () => {
      PG.state.fx.humanize = $('fxHumanize').value / 100;
      $('humanizeVal').textContent = Math.round(PG.state.fx.humanize * 100) + '%';
      PG.engine.humanize = PG.state.fx.humanize;
      PG.markDirty();
    });
  },

  sliderToHz(v) { return Math.round(20 * Math.pow(18000 / 20, v / 100)); },
  hzToSlider(hz) { return Math.round((Math.log(hz / 20) / Math.log(18000 / 20)) * 100); },
  formatHz(hz) { return hz >= 1000 ? (hz / 1000).toFixed(1) + ' kHz' : hz + ' Hz'; },

  /* ================= share links & WAV export ================= */

  /** Compact state encoding for URLs: drums as 'x...' strings, bass as '36,36+,'.
   *  Empty patterns are skipped to keep links short. */
  encodeShare() {
    const st = PG.state;
    const pats = [];
    st.patterns.forEach((p, i) => {
      if (!hasContent(p)) return;
      const d = {};
      for (const t of TRACKS) d[t.id] = p.tracks[t.id].map((v) => (v === 2 ? 'X' : v ? 'x' : '.')).join('');
      const b = p.tracks.bass.map((n) => (n == null ? '' : n.midi + (n.accent ? '+' : ''))).join(',');
      const l = p.tracks.lead
        ? p.tracks.lead.map((n) => (n == null ? '' : n.notes.join('.') + (n.accent ? '+' : ''))).join(',')
        : '';
      pats.push([i, { d, b, l }]);
    });
    const payload = {
      v: 1,
      bpm: st.bpm,
      sw: +st.swing.toFixed(2),
      mv: +st.masterVol.toFixed(2),
      fx: [+st.fx.delay.toFixed(2), +st.fx.reverb.toFixed(2), Math.round(st.fx.filter),
           +(st.fx.pump || 0).toFixed(2), +(st.fx.humanize || 0).toFixed(2)],
      n: st.steps === 32 ? 32 : undefined,
      sr: st.song && st.song.reps && st.song.reps.some((r) => r > 1)
        ? st.song.chain.map((_, i) => st.song.reps[i] || 1) : undefined,
      ap: st.active,
      sc: st.song ? st.song.chain.slice(0, 16) : [0, 1],
      ts: (function () {   // non-default mix & sound design per track (drums + bass)
        const o = {};
        for (const id of Object.keys(st.trackState)) {
          const ts = st.trackState[id];
          if (ts && (ts.tune !== 1 || ts.decay !== 1 || ts.vol !== 0.8)) {
            o[id] = [+ts.tune.toFixed(2), +ts.decay.toFixed(2), +ts.vol.toFixed(2)];
          }
        }
        return Object.keys(o).length ? o : undefined;
      })(),
      p: pats,
    };
    // base64url so the code survives URLs and transports untouched
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  },

  decodeShare(code) {
    let b64 = String(code).replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const d = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const st = defaultState();
    st.steps = d.n === 32 ? 32 : 16;
    st.bpm = d.bpm || st.bpm;
    st.patterns = [emptyPattern(st.steps), emptyPattern(st.steps),
                   emptyPattern(st.steps), emptyPattern(st.steps)];
    st.swing = typeof d.sw === 'number' ? d.sw : st.swing;
    st.masterVol = typeof d.mv === 'number' ? d.mv : st.masterVol;
    if (Array.isArray(d.fx)) {
      st.fx = {
        delay: d.fx[0] ?? st.fx.delay,
        reverb: d.fx[1] ?? st.fx.reverb,
        filter: d.fx[2] ?? st.fx.filter,
        pump: d.fx[3] ?? 0,        // legacy 3-tuple links predate pump/humanize
        humanize: d.fx[4] ?? 0,
      };
    }
    st.active = Math.min(3, Math.max(0, d.ap | 0));
    st.song = {
      enabled: false,
      chain: Array.isArray(d.sc) ? d.sc.filter((v) => v >= 0 && v <= 3).slice(0, 16) : [0, 1],
    };
    if (!st.song.chain.length) st.song.chain = [0, 1];
    st.song.reps = Array.isArray(d.sr)
      ? st.song.chain.map((_, i) => Math.min(8, Math.max(1, d.sr[i] | 0 || 1)))
      : st.song.chain.map(() => 1);
    if (d.ts && typeof d.ts === 'object') {
      const num = (x, dflt) => (typeof x === 'number' && Number.isFinite(x) ? x : dflt);
      for (const id of Object.keys(d.ts)) {
        const v = d.ts[id];
        if (st.trackState[id] && Array.isArray(v)) {
          st.trackState[id].tune = num(v[0], 1);
          st.trackState[id].decay = num(v[1], 1);
          st.trackState[id].vol = Math.min(1, Math.max(0, num(v[2], 0.8)));  // 2-element legacy links keep default vol
        }
      }
    }
    for (const [i, src] of d.p) {
      if (i < 0 || i > 3) continue;
      const p = emptyPattern(st.steps);
      for (const t of TRACKS) {
        if (typeof src.d[t.id] === 'string') {
          p.tracks[t.id] = [...src.d[t.id]].slice(0, st.steps).map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0));
          while (p.tracks[t.id].length < st.steps) p.tracks[t.id].push(0);
        }
      }
      if (typeof src.b === 'string') {
        p.tracks.bass = src.b.split(',').slice(0, st.steps).map(parseNoteTok);
        while (p.tracks.bass.length < st.steps) p.tracks.bass.push(null);
      }
      if (typeof src.l === 'string') {
        p.tracks.lead = src.l.split(',').slice(0, st.steps).map(parseLeadTok);
        while (p.tracks.lead.length < st.steps) p.tracks.lead.push(null);
      }
      st.patterns[i] = p;
    }
    return st;
  },

  bindExportTools() {
    $('btnShare').addEventListener('click', async () => {
      const url = location.href.split('#')[0] + '#p=' + this.encodeShare();
      try {
        await navigator.clipboard.writeText(url);
        this.toast(t('tShareCopied'));
      } catch (e) {
        location.hash = 'p=' + this.encodeShare();
        this.toast(t('tShareBar'));
      }
    });

    $('btnMidi').addEventListener('click', () => {
      try {
        const r = MidiExport.export(PG.state);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = r.name;
        a.click();
        URL.revokeObjectURL(a.href);
        this.toast(t('tMidi', { bars: r.bars, notes: r.notes }));
      } catch (e) {
        this.toast(t('tNothingExport'));
      }
    });

    $('btnWav').addEventListener('click', async () => {
      const btn = $('btnWav');
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const scope = $('wavScope').value;
        const r = await RenderWav.render(PG.state, {
          sampleRate: +$('wavRate').value || 44100,
          only: scope === 'all' ? undefined : +scope,
        });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = `pulsegrid-${PG.state.bpm}bpm.wav`;
        a.click();
        URL.revokeObjectURL(a.href);
        this.toast(t('tWav', { s: r.seconds.toFixed(1), bars: r.bars, mb: (r.bytes / 1048576).toFixed(1) }));
      } catch (e) {
        this.toast(t('tNothingExport'));
      }
      btn.disabled = false;
      btn.textContent = 'WAV';
    });
  },

  handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result;
        const head = String.fromCharCode(...new Uint8Array(buf, 0, 4));
        if (head === 'MThd') {
          this.applyMidiImport(MidiImport.parse(buf));
        } else {
          const data = JSON.parse(new TextDecoder().decode(buf));
          if (!data || !Array.isArray(data.patterns)) throw new Error('bad file');
          this.pushUndo();
          PG.state = this.normalizeState(data);
          this.refreshAll();
          this.applyEngineParams();
          PG.markDirty();
          this.toast(t('tImported'));
        }
      } catch (err) {
        this.toast(t('tImportFail'));
      }
    };
    reader.readAsArrayBuffer(file);
  },

  /** Route a parsed MIDI file into the project (lands in pattern A). */
  applyMidiImport(result) {
    this.pushUndo();
    PG.state.steps = result.steps;
    PG.state.bpm = result.bpm || PG.state.bpm;
    PG.state.patterns = [result.pattern,
      emptyPattern(result.steps), emptyPattern(result.steps), emptyPattern(result.steps)];
    PG.state.song = { enabled: false, chain: [0, 1], reps: [1, 1] };
    PG.state.active = 0;
    this.buildGrids();
    this.refreshAll();
    this.applyEngineParams();
    PG.markDirty();
    this.toast(t('tImportMid', { notes: result.notes, bars: result.bars }));
  },

  /* ================= sound design ================= */

  buildSoundPanel() {
    this.soundSel = 'kick';
    const host = $('soundChips');
    for (const cfg of [...TRACKS, { id: 'bass', color: '#e879f9' }, { id: 'lead', color: '#fbbf24' }]) {
      const chip = document.createElement('button');
      chip.className = 'sound-chip';
      chip.dataset.id = cfg.id;
      chip.style.setProperty('--c', cfg.color);
      chip.textContent = trackName(cfg.id);
      chip.setAttribute('data-track', cfg.id);
      chip.addEventListener('click', () => {
        this.soundSel = cfg.id;
        this.refreshSoundPanel();
        PG.engine.preview(cfg.id);
      });
      host.appendChild(chip);
    }

    const apply = () => {
      const ts = PG.state.trackState[this.soundSel];
      ts.tune = $('sndTune').value / 100;
      ts.decay = $('sndDecay').value / 100;
      $('sndTuneVal').textContent = '×' + ts.tune.toFixed(2);
      $('sndDecayVal').textContent = '×' + ts.decay.toFixed(2);
      PG.engine.setSound(this.soundSel, ts);
      PG.markDirty();
    };
    $('sndTune').addEventListener('input', apply);
    $('sndDecay').addEventListener('input', apply);
    // audible confirmation when the slider is released
    $('sndTune').addEventListener('change', () => PG.engine.preview(this.soundSel));
    $('sndDecay').addEventListener('change', () => PG.engine.preview(this.soundSel));

    $('sndPreview').addEventListener('click', () => PG.engine.preview(this.soundSel));
    $('sndReset').addEventListener('click', () => {
      const ts = PG.state.trackState[this.soundSel];
      ts.tune = 1; ts.decay = 1;
      PG.engine.setSound(this.soundSel, ts);
      this.refreshSoundPanel();
      PG.engine.preview(this.soundSel);
      PG.markDirty();
    });
    this.refreshSoundPanel();
  },

  refreshSoundPanel() {
    document.querySelectorAll('.sound-chip').forEach((c) =>
      c.classList.toggle('active', c.dataset.id === this.soundSel));
    const ts = PG.state.trackState[this.soundSel];
    $('sndTune').value = Math.round(ts.tune * 100);
    $('sndDecay').value = Math.round(ts.decay * 100);
    $('sndTuneVal').textContent = '×' + ts.tune.toFixed(2);
    $('sndDecayVal').textContent = '×' + ts.decay.toFixed(2);
  },

  /* ================= persistence ================= */

  bindImportExport() {
    $('btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(PG.state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'pulsegrid-pattern.json';
      a.click();
      URL.revokeObjectURL(a.href);
      this.toast('Exported pulsegrid-pattern.json');
    });

    $('btnImport').addEventListener('click', () => $('fileImport').click());
    $('fileImport').addEventListener('change', (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) this.handleImportFile(file);
    });

    // drop a .mid / .json anywhere on the page to load it
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => {
      if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      dragDepth++;
      $('dropzone').classList.add('open');
    });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('dragleave', (e) => {
      if (!e.dataTransfer) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) $('dropzone').classList.remove('open');
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      dragDepth = 0;
      $('dropzone').classList.remove('open');
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) this.handleImportFile(file);
    });
  },

  normalizeState(data) {
    const base = defaultState();
    const trackTemplate = base.trackState;   // keep the full template — data may be sparse
    const st = Object.assign(base, data);
    st.fx = Object.assign(base.fx, data.fx || {});
    // legacy saves predate pump/humanize — keep them off instead of
    // inheriting preset values that would change how old projects sound
    if (!data.fx || typeof data.fx.pump !== 'number') st.fx.pump = 0;
    if (!data.fx || typeof data.fx.humanize !== 'number') st.fx.humanize = 0;
    st.steps = st.steps === 32 ? 32 : 16;
    st.click = !!st.click;
    st.trackState = st.trackState || {};
    for (const id of Object.keys(trackTemplate)) {
      const ts = st.trackState[id] || (st.trackState[id] = { ...trackTemplate[id] });
      ts.vol = typeof ts.vol === 'number' ? Math.min(1, Math.max(0, ts.vol)) : 0.8;
      ts.tune = typeof ts.tune === 'number' ? Math.min(2, Math.max(0.5, ts.tune)) : 1;
      ts.decay = typeof ts.decay === 'number' ? Math.min(2.5, Math.max(0.4, ts.decay)) : 1;
      ts.mute = !!ts.mute;
      ts.solo = !!ts.solo;
    }
    if (!Array.isArray(st.patterns)) st.patterns = [];
    st.patterns = st.patterns.slice(0, 4);
    while (st.patterns.length < 4) st.patterns.push(emptyPattern(st.steps));
    st.patterns = st.patterns.map((p) => {
      const ep = emptyPattern(st.steps);
      const src = (p && typeof p === 'object' && p.tracks && typeof p.tracks === 'object') ? p.tracks : {};
      for (const k of Object.keys(ep.tracks)) {
        if (Array.isArray(src[k])) {
          // coerce legacy booleans, clamp values, enforce length
          ep.tracks[k] = src[k].slice(0, st.steps).map((v) => {
            if (k === 'lead') return sanitizeLead(v);
            return k === 'bass' ? v : (v === true ? 1 : v === false ? 0 : (v === 1 || v === 2 ? v : 0));
          });
          while (ep.tracks[k].length < st.steps) ep.tracks[k].push(k === 'bass' || k === 'lead' ? null : 0);
        }
      }
      return ep;
    });
    if (!st.song || !Array.isArray(st.song.chain)) {
      st.song = { enabled: false, chain: [0, 1] };
    } else {
      st.song.chain = st.song.chain.filter((v) => v >= 0 && v <= 3).slice(0, 16);
      if (!st.song.chain.length) st.song.chain = [0, 1];
      const reps = Array.isArray(st.song.reps) ? st.song.reps : [];
      st.song.reps = st.song.chain.map((_, i) => Math.min(8, Math.max(1, reps[i] | 0 || 1)));
    }
    st.active = Math.min(3, Math.max(0, st.active | 0));
    return st;
  },

  /* ================= editing ================= */

  setDrumCell(trackId, step, val) {
    this.pushUndo(true);
    PG.state.patterns[PG.state.active].tracks[trackId][step] = val;
    const cell = this.stepCells[trackId][step];
    cell.classList.toggle('on', !!val);
    cell.classList.toggle('acc', val === 2);
    cell.setAttribute('aria-pressed', String(!!val));
    PG.markDirty();
  },

  cycleBassCell(midi, step) {
    this.pushUndo(true);
    const lane = PG.state.patterns[PG.state.active].tracks.bass;
    const cur = lane[step];
    // clicking a lit cell in another row clears that step first (mono bass)
    if (cur && cur.midi !== midi) {
      this.refreshRollCell(cur.midi, step, null);
      lane[step] = null;
    }
    if (!cur || cur.midi !== midi) {
      lane[step] = { midi, accent: false };
      if (!PG.seq.isPlaying) PG.engine.previewBass(midi, false);
    } else if (!cur.accent) {
      cur.accent = true;
      if (!PG.seq.isPlaying) PG.engine.previewBass(midi, true);
    } else {
      lane[step] = null;
    }
    this.refreshRollCell(midi, step, lane[step]);
    PG.markDirty();
  },

  refreshRollCell(midi, step, note) {
    const cell = this.rollCells[midi][step];
    cell.classList.toggle('on', !!note);
    cell.classList.toggle('acc', !!note && note.accent);
    cell.setAttribute('aria-pressed', String(!!note));
  },

  /* ================= refresh / sync ================= */

  refreshGrid() {
    const p = PG.state.patterns[PG.state.active];
    const N = PG.state.steps || 16;
    for (const cfg of TRACKS) {
      for (let s = 0; s < N; s++) {
        const cell = this.stepCells[cfg.id][s];
        const v = p.tracks[cfg.id][s];
        cell.classList.toggle('on', !!v);
        cell.classList.toggle('acc', v === 2);
        cell.setAttribute('aria-pressed', String(!!v));
      }
    }
    for (let midi = BASS_MIDI_LO; midi <= BASS_MIDI_HI; midi++) {
      for (let s = 0; s < N; s++) {
        this.refreshRollCell(midi, s, p.tracks.bass[s] && p.tracks.bass[s].midi === midi ? p.tracks.bass[s] : null);
      }
    }
    for (let s = 0; s < N; s++) this.refreshLeadCol(s);
    // per-lane controls
    for (const cfg of TRACKS) {
      const lane = this.stepCells[cfg.id][0].closest('.lane');
      const ts = PG.state.trackState[cfg.id];
      lane.querySelector('.mute').classList.toggle('active', ts.mute);
      lane.querySelector('.solo').classList.toggle('active', ts.solo);
      lane.querySelector('.lane-vol').value = Math.round(ts.vol * 100);
    }
    const bts = PG.state.trackState.bass;
    this.bassCtl.mute.classList.toggle('active', bts.mute);
    this.bassCtl.solo.classList.toggle('active', bts.solo);
    this.bassCtl.vol.value = Math.round(bts.vol * 100);
    const lts = PG.state.trackState.lead;
    this.leadCtl.mute.classList.toggle('active', lts.mute);
    this.leadCtl.solo.classList.toggle('active', lts.solo);
    this.leadCtl.vol.value = Math.round(lts.vol * 100);
  },

  refreshPatternButtons() {
    this.patternBtns.forEach((b, i) => {
      b.classList.toggle('active', i === PG.state.active);
      const p = PG.state.patterns[i];
      const has = !!p && (TRACKS.some((t) => p.tracks[t.id].some(Boolean)) ||
        p.tracks.bass.some(Boolean) || (p.tracks.lead && p.tracks.lead.some(Boolean)));
      b.classList.toggle('has', has);
    });
  },

  refreshTransport() {
    $('bpm').value = PG.state.bpm;
    const sw = Math.round((PG.state.swing / 0.8) * 100);
    $('swing').value = sw;
    $('swingVal').textContent = sw + '%';
    $('masterVol').value = Math.round(PG.state.masterVol * 100);
  },

  refreshFX() {
    $('fxDelay').value = Math.round(PG.state.fx.delay * 100);
    $('delayVal').textContent = Math.round(PG.state.fx.delay * 100) + '%';
    $('fxReverb').value = Math.round(PG.state.fx.reverb * 100);
    $('reverbVal').textContent = Math.round(PG.state.fx.reverb * 100) + '%';
    $('fxFilter').value = this.hzToSlider(PG.state.fx.filter);
    $('filterVal').textContent = this.formatHz(PG.state.fx.filter);
    $('fxPump').value = Math.round((PG.state.fx.pump || 0) * 100);
    $('pumpVal').textContent = Math.round((PG.state.fx.pump || 0) * 100) + '%';
    $('fxHumanize').value = Math.round((PG.state.fx.humanize || 0) * 100);
    $('humanizeVal').textContent = Math.round((PG.state.fx.humanize || 0) * 100) + '%';
  },

  refreshAll() {
    this.refreshTransport();
    this.refreshPatternButtons();
    this.refreshGrid();
    this.refreshFX();
    this.refreshSong();
    this.refreshSoundPanel();
  },

  applyEngineParams() {
    if (!PG.engine.ctx) return;
    PG.engine.setBpm(PG.state.bpm);
    PG.engine.setMasterVolume(PG.state.masterVol);
    PG.engine.setMasterFilterHz(PG.state.fx.filter);
    PG.engine.setDelayMix(PG.state.fx.delay);
    PG.engine.setReverbMix(PG.state.fx.reverb);
    PG.engine.pump = PG.state.fx.pump || 0;
    PG.engine.humanize = PG.state.fx.humanize || 0;
    this.applyTrackGains();
  },

  applyTrackGains() {
    if (!PG.engine.ctx) return;
    const ts = PG.state.trackState;
    const anySolo = Object.values(ts).some((t) => t.solo);
    for (const id of Object.keys(ts)) {
      const t = ts[id];
      const cfg = PG.engine.tracks[id];
      if (!cfg) continue;
      const eff = t.mute ? 0 : (anySolo && !t.solo) ? 0 : 1;
      PG.engine.setTrackGain(id, cfg.cfg.gain * t.vol * eff);
    }
  },

  /* ================= playhead ================= */

  _tick() {
    const seq = PG.seq;
    if (seq.isPlaying && PG.engine.ctx) {
      const now = PG.engine.ctx.currentTime;
      let ev = null;
      while (seq.drawQueue.length && seq.drawQueue[0].time <= now + 0.004) {
        ev = seq.drawQueue.shift();
      }
      if (ev && ev.step !== this.ph) this.setPlayhead(ev.step);
    } else if (this.ph !== null) {
      this.setPlayhead(null);
    }
    requestAnimationFrame(() => this._tick());
  },

  setPlayhead(step) {
    if (this.ph !== null) {
      for (const c of this.columns[this.ph]) c.classList.remove('ph');
    }
    this.ph = step;
    if (step !== null) {
      for (const c of this.columns[step]) c.classList.add('ph');
    }
  },

  /* ================= misc ================= */

  bindKeys() {
    // A–K home row = live drum pads (works while the transport runs)
    const PADS = {
      KeyA: 'kick', KeyS: 'snare', KeyD: 'clap', KeyF: 'chat',
      KeyG: 'ohat', KeyH: 'tom', KeyJ: 'cowbell', KeyK: 'shaker',
    };
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toUpperCase();
      const typing = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable;
      const mod = e.ctrlKey || e.metaKey;

      if (mod && e.code === 'KeyZ') {
        if (typing) return;                     // keep native undo inside fields
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        if (typing) return;
        e.preventDefault();
        this.redo();
        return;
      }
      if (typing || mod || e.altKey) return;

      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (/^Digit[1-4]$/.test(e.code)) {
        PG.state.active = +e.code.slice(-1) - 1;
        this.refreshPatternButtons();
        this.refreshGrid();
        PG.markDirty();
      } else if (PADS[e.code] && !e.repeat) {
        const id = PADS[e.code];
        if (PG.seq.isPlaying && PG.state.rec) {
          this.recordHit(id);
        } else {
          PG.engine.preview(id);
        }
      } else if (e.code === 'KeyP' && !e.repeat) {
        this.tapNow();
      } else if (LEAD_KEYS[e.code] && !e.repeat) {
        let midi = LEAD_KEYS[e.code];
        if (e.shiftKey && { KeyQ: 1, KeyW: 1, KeyR: 1, KeyT: 1, KeyY: 1 }[e.code]) midi += 1;
        if (PG.seq.isPlaying && PG.state.rec) {
          this.recordLead(midi);
        } else {
          PG.engine.previewLead([midi], false);
        }
      } else if (e.code === 'Comma') {
        this.rotatePattern(-1);
      } else if (e.code === 'Period') {
        this.rotatePattern(1);
      } else if (e.code === 'KeyM') {
        this.toggleClick();
      } else if (e.code === 'KeyV') {
        this.toggleVizPerf();
      } else if (e.key === '?') {
        this.toggleHelp();
      } else if (e.key === 'Escape') {
        this.toggleHelp(false);
      }
    });

    $('btnClick').addEventListener('click', () => this.toggleClick());

    $('btnRec').addEventListener('click', () => {
      PG.state.rec = !PG.state.rec;
      const btn = $('btnRec');
      btn.classList.toggle('active', PG.state.rec);
      PG.markDirty();
      this.toast(PG.state.rec ? t('tRecOn') : t('tRecOff'));
    });

    $('btnHelp').addEventListener('click', () => this.toggleHelp());
    $('helpClose').addEventListener('click', () => this.toggleHelp(false));
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help') this.toggleHelp(false); });

    $('btnUndo').addEventListener('click', () => this.undo());
    $('btnRedo').addEventListener('click', () => this.redo());
    $('btnRotL').addEventListener('click', () => this.rotatePattern(-1));
    $('btnRotR').addEventListener('click', () => this.rotatePattern(1));

    $('btnLen').addEventListener('click', () => {
      const btn = $('btnLen');
      const growing = (PG.state.steps || 16) === 16;
      if (!growing && !this._lenArmed) {
        this._lenArmed = true;
        btn.textContent = t('tSure');
        btn.classList.add('armed');
        this._lenTimer = setTimeout(() => {
          this._lenArmed = false;
          btn.textContent = '32';
          btn.classList.remove('armed');
        }, 2000);
        return;
      }
      clearTimeout(this._lenTimer);
      this._lenArmed = false;
      btn.textContent = growing ? '32' : '16';
      btn.classList.remove('armed');
      this.setSteps(growing ? 32 : 16);
    });

    $('btnLang').addEventListener('click', () => {
      setLang(LANG === 'en' ? 'zh' : 'en');
      this.refreshSong();                     // dynamic Song ON/OFF label
      if (!this._clearArmed) $('btnClear').textContent = t('clear');
    });
  },

  toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  },
};
