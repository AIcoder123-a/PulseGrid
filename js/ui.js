/* PulseGrid — ui.js
 *
 * Builds and syncs the whole interface: transport, drum grid, bass piano
 * roll, FX rack, pattern bank, presets, persistence. Pure DOM, no framework.
 */

'use strict';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const midiName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

/** '36+' → { midi: 36, accent: true }; '' / junk → null */
function parseNoteTok(tok) {
  if (!tok) return null;
  const m = tok.match(/^(\d+)(\+?)$/);
  return m ? { midi: +m[1], accent: m[2] === '+' } : null;
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
    this.buildTracks();
    this.buildRoll();
    this.buildLeadRoll();
    this.buildPatternButtons();
    this.buildPresets();
    this.buildSong();
    this.buildGenerator();
    this.buildSoundPanel();
    this.bindTransport();
    this.bindFX();
    this.bindImportExport();
    this.bindExportTools();
    this.bindKeys();
    requestAnimationFrame(() => this._tick());
  },

  buildLeadRoll() {
    const host = $('leadroll');

    const bar = document.createElement('div');
    bar.className = 'lane bass-bar';
    bar.style.setProperty('--c', '#fbbf24');
    bar.innerHTML =
      `<div class="lane-ctl">` +
      `<button class="mini mute" title="Mute lead">M</button>` +
      `<button class="mini solo" title="Solo lead">S</button>` +
      `<span class="dot"></span><span class="lane-name">Lead</span>` +
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
      for (let s = 0; s < STEPS; s++) {
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

  cycleLeadCell(midi, step) {
    const lane = PG.state.patterns[PG.state.active].tracks.lead;
    const cur = lane[step];
    if (cur && cur.midi !== midi) {
      this.refreshLeadCell(cur.midi, step, null);
      lane[step] = null;
    }
    if (!cur || cur.midi !== midi) {
      lane[step] = { midi, accent: false };
      if (!PG.seq.isPlaying) PG.engine.previewLead(midi, false);
    } else if (!cur.accent) {
      cur.accent = true;
      if (!PG.seq.isPlaying) PG.engine.previewLead(midi, true);
    } else {
      lane[step] = null;
    }
    this.refreshLeadCell(midi, step, lane[step]);
    PG.markDirty();
  },

  refreshLeadCell(midi, step, note) {
    const cell = this.leadCells[midi][step];
    cell.classList.toggle('on', !!note);
    cell.classList.toggle('acc', !!note && note.accent);
    cell.setAttribute('aria-pressed', String(!!note));
  },

  /* ================= song mode ================= */

  buildSong() {
    $('btnSongMode').addEventListener('click', () => {
      const song = PG.state.song;
      if (!song.chain.length) {
        song.chain = [0, 1];
      }
      song.enabled = !song.enabled;
      if (song.enabled && PG.seq.isPlaying) {
        PG.seq.songIndex = song.chain.indexOf(PG.state.active);
        if (PG.seq.songIndex < 0) PG.seq.songIndex = 0;
      }
      this.refreshSong();
      PG.markDirty();
      this.toast(song.enabled ? 'Song mode on — the chain plays in order' : 'Song mode off');
    });
    $('btnSongAdd').addEventListener('click', () => {
      const song = PG.state.song;
      if (song.chain.length >= 16) return;
      song.chain.push(PG.state.active);
      this.refreshSong();
      PG.markDirty();
    });
    $('btnSongClear').addEventListener('click', () => {
      PG.state.song.chain = [0, 1];
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
    song.chain.forEach((patIdx, slot) => {
      const chip = document.createElement('button');
      chip.className = 'song-chip';
      chip.textContent = letters[patIdx];
      chip.title = `Bar ${slot + 1}: pattern ${letters[patIdx]} — click cycles, past D removes`;
      if (PG.seq.isPlaying && song.enabled && PG.seq.songIndex === slot) chip.classList.add('playing');
      chip.addEventListener('click', () => {
        song.chain[slot] = (song.chain[slot] + 1) % 5;
        if (song.chain[slot] === 4) song.chain.splice(slot, 1);
        if (!song.chain.length) song.enabled = false;
        this.refreshSong();
        PG.markDirty();
      });
      host.appendChild(chip);
    });
    if (!song.chain.length) {
      const empty = document.createElement('span');
      empty.className = 'song-empty';
      empty.textContent = 'empty — hit “+ Bar”';
      host.appendChild(empty);
    }
    const btn = $('btnSongMode');
    btn.textContent = song.enabled ? 'Song: ON' : 'Song: OFF';
    btn.classList.toggle('active', song.enabled);
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
      const style = sel.value;
      const density = $('genDensity').value / 100;
      const { pattern, bpm, swing } = Generator.generate(style, density);
      PG.state.patterns[0] = pattern;
      PG.state.patterns[1] = Generator.mutate(pattern);
      PG.state.active = 0;
      PG.state.bpm = bpm;
      PG.state.swing = swing;
      this.refreshAll();
      PG.markDirty();
      const opt = sel.options[sel.selectedIndex];
      this.toast(`New ${opt ? opt.text : 'generated'} groove — A main / B variation`);
    });
    $('btnMutate').addEventListener('click', () => {
      const i = PG.state.active;
      PG.state.patterns[i] = Generator.mutate(PG.state.patterns[i]);
      this.refreshGrid();
      PG.markDirty();
      this.toast(`Pattern ${['A', 'B', 'C', 'D'][i]} mutated`);
    });
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
        `<span class="dot"></span><span class="lane-name">${cfg.name}</span>` +
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
      for (let s = 0; s < STEPS; s++) {
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
      `<span class="dot"></span><span class="lane-name">Bass</span>` +
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
      for (let s = 0; s < STEPS; s++) {
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
    const st = PG.state;
    st.bpm = p.bpm;
    st.swing = p.swing;
    st.fx = { ...p.fx };
    st.patterns = [clonePattern(p.patterns[0]), clonePattern(p.patterns[1]),
                   emptyPattern(), emptyPattern()];
    st.active = 0;
    this.refreshTransport();
    this.refreshPatternButtons();
    this.refreshGrid();
    this.refreshFX();
    this.applyEngineParams();
    PG.markDirty();
    this.toast(`Loaded preset: ${p.name} — hit Play ▶`);
  },

  /* ================= transport ================= */

  bindTransport() {
    $('btnPlay').addEventListener('click', () => this.togglePlay());
    $('btnStop').addEventListener('click', () => {
      PG.seq.stop();
      PG.viz.playing = false;
      $('btnPlay').classList.remove('playing');
      $('btnPlay').innerHTML = '▶<span>Play</span>';
    });

    $('bpm').addEventListener('input', () => {
      const v = parseInt($('bpm').value, 10);
      if (!Number.isFinite(v)) return;
      PG.state.bpm = Math.min(200, Math.max(60, v));
      PG.engine.setBpm(PG.state.bpm);
      PG.markDirty();
    });

    // tap tempo
    let taps = [];
    $('btnTap').addEventListener('click', () => {
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
    });

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
      const next = (PG.state.active + 1) % 4;
      PG.state.patterns[next] = clonePattern(PG.state.patterns[PG.state.active]);
      PG.state.active = next;
      this.refreshPatternButtons();
      this.refreshGrid();
      PG.markDirty();
      this.toast(`Copied to pattern ${['A', 'B', 'C', 'D'][next]}`);
    });

    $('btnClear').addEventListener('click', () => {
      const btn = $('btnClear');
      if (!this._clearArmed) {
        this._clearArmed = true;
        btn.textContent = 'Sure?';
        btn.classList.add('armed');
        this._clearTimer = setTimeout(() => {
          this._clearArmed = false;
          btn.textContent = 'Clear';
          btn.classList.remove('armed');
        }, 2000);
        return;
      }
      clearTimeout(this._clearTimer);
      this._clearArmed = false;
      btn.textContent = 'Clear';
      btn.classList.remove('armed');
      PG.state.patterns[PG.state.active] = emptyPattern();
      this.refreshGrid();
      PG.markDirty();
      this.toast('Pattern cleared');
    });
  },

  togglePlay() {
    const seq = PG.seq;
    const btn = $('btnPlay');
    if (seq.isPlaying) {
      seq.stop();
      PG.viz.playing = false;
      btn.classList.remove('playing');
      btn.innerHTML = '▶<span>Play</span>';
    } else {
      PG.engine.ensure();
      this.applyEngineParams();
      seq.start();
      PG.viz.playing = true;
      PG.viz.attach(PG.engine.analyser);
      btn.classList.add('playing');
      btn.innerHTML = '❚❚<span>Stop</span>';
    }
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
      const l = p.tracks.lead ? p.tracks.lead.map((n) => (n == null ? '' : n.midi + (n.accent ? '+' : ''))).join(',') : '';
      pats.push([i, { d, b, l }]);
    });
    const payload = {
      v: 1,
      bpm: st.bpm,
      sw: +st.swing.toFixed(2),
      mv: +st.masterVol.toFixed(2),
      fx: [+st.fx.delay.toFixed(2), +st.fx.reverb.toFixed(2), Math.round(st.fx.filter)],
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
    st.bpm = d.bpm || st.bpm;
    st.swing = typeof d.sw === 'number' ? d.sw : st.swing;
    st.masterVol = typeof d.mv === 'number' ? d.mv : st.masterVol;
    if (Array.isArray(d.fx)) {
      st.fx = { delay: d.fx[0] ?? st.fx.delay, reverb: d.fx[1] ?? st.fx.reverb, filter: d.fx[2] ?? st.fx.filter };
    }
    st.active = Math.min(3, Math.max(0, d.ap | 0));
    st.song = {
      enabled: false,
      chain: Array.isArray(d.sc) ? d.sc.filter((v) => v >= 0 && v <= 3).slice(0, 16) : [0, 1],
    };
    if (!st.song.chain.length) st.song.chain = [0, 1];
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
      const p = emptyPattern();
      for (const t of TRACKS) {
        if (typeof src.d[t.id] === 'string') {
          p.tracks[t.id] = [...src.d[t.id]].slice(0, STEPS).map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0));
          while (p.tracks[t.id].length < STEPS) p.tracks[t.id].push(0);
        }
      }
      if (typeof src.b === 'string') {
        p.tracks.bass = src.b.split(',').slice(0, STEPS).map(parseNoteTok);
        while (p.tracks.bass.length < STEPS) p.tracks.bass.push(null);
      }
      if (typeof src.l === 'string') {
        p.tracks.lead = src.l.split(',').slice(0, STEPS).map(parseNoteTok);
        while (p.tracks.lead.length < STEPS) p.tracks.lead.push(null);
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
        this.toast('Share link copied to clipboard');
      } catch (e) {
        location.hash = 'p=' + this.encodeShare();
        this.toast('Share link is in the address bar — copy it there');
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
        this.toast(`Exported MIDI · ${r.bars} bars · ${r.notes} notes (drums ch10 / bass ch1)`);
      } catch (e) {
        this.toast('Nothing to export — all patterns are empty');
      }
    });

    $('btnWav').addEventListener('click', async () => {
      const btn = $('btnWav');
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const r = await RenderWav.render(PG.state);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(r.blob);
        a.download = 'pulsegrid-loop.wav';
        a.click();
        URL.revokeObjectURL(a.href);
        this.toast(`Exported ${r.seconds.toFixed(1)}s WAV · ${r.bars} bars · ${(r.bytes / 1048576).toFixed(1)} MB`);
      } catch (e) {
        this.toast('Nothing to export — all patterns are empty');
      }
      btn.disabled = false;
      btn.textContent = 'WAV';
    });
  },

  /* ================= sound design ================= */

  buildSoundPanel() {
    this.soundSel = 'kick';
    const host = $('soundChips');
    for (const cfg of TRACKS) {
      const chip = document.createElement('button');
      chip.className = 'sound-chip';
      chip.dataset.id = cfg.id;
      chip.style.setProperty('--c', cfg.color);
      chip.textContent = cfg.name;
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
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || !Array.isArray(data.patterns)) throw new Error('bad file');
          PG.state = this.normalizeState(data);
          this.refreshAll();
          this.applyEngineParams();
          PG.markDirty();
          this.toast('Pattern imported');
        } catch (err) {
          this.toast('Import failed: not a PulseGrid file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  },

  normalizeState(data) {
    const base = defaultState();
    const trackTemplate = base.trackState;   // keep the full template — data may be sparse
    const st = Object.assign(base, data);
    st.fx = Object.assign(base.fx, data.fx || {});
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
    while (st.patterns.length < 4) st.patterns.push(emptyPattern());
    st.patterns = st.patterns.map((p) => {
      const ep = emptyPattern();
      for (const k of Object.keys(ep.tracks)) {
        if (Array.isArray(p.tracks[k])) {
          const isNoteLane = k === 'bass' || k === 'lead';
          // coerce legacy booleans, clamp values, enforce length
          ep.tracks[k] = p.tracks[k].slice(0, STEPS).map((v) =>
            isNoteLane ? v : (v === true ? 1 : v === false ? 0 : (v === 1 || v === 2 ? v : 0)));
          while (ep.tracks[k].length < STEPS) ep.tracks[k].push(isNoteLane ? null : 0);
        }
      }
      return ep;
    });
    if (!st.song || !Array.isArray(st.song.chain)) {
      st.song = { enabled: false, chain: [0, 1] };
    } else {
      st.song.chain = st.song.chain.filter((v) => v >= 0 && v <= 3).slice(0, 16);
      if (!st.song.chain.length) st.song.chain = [0, 1];
    }
    st.active = Math.min(3, Math.max(0, st.active | 0));
    return st;
  },

  /* ================= editing ================= */

  setDrumCell(trackId, step, val) {
    PG.state.patterns[PG.state.active].tracks[trackId][step] = val;
    const cell = this.stepCells[trackId][step];
    cell.classList.toggle('on', !!val);
    cell.classList.toggle('acc', val === 2);
    cell.setAttribute('aria-pressed', String(!!val));
    PG.markDirty();
  },

  cycleBassCell(midi, step) {
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
    for (const cfg of TRACKS) {
      for (let s = 0; s < STEPS; s++) {
        const cell = this.stepCells[cfg.id][s];
        const v = p.tracks[cfg.id][s];
        cell.classList.toggle('on', !!v);
        cell.classList.toggle('acc', v === 2);
        cell.setAttribute('aria-pressed', String(!!v));
      }
    }
    for (let midi = BASS_MIDI_LO; midi <= BASS_MIDI_HI; midi++) {
      for (let s = 0; s < STEPS; s++) {
        this.refreshRollCell(midi, s, p.tracks.bass[s] && p.tracks.bass[s].midi === midi ? p.tracks.bass[s] : null);
      }
    }
    for (let midi = LEAD_MIDI_LO; midi <= LEAD_MIDI_HI; midi++) {
      for (let s = 0; s < STEPS; s++) {
        this.refreshLeadCell(midi, s, p.tracks.lead[s] && p.tracks.lead[s].midi === midi ? p.tracks.lead[s] : null);
      }
    }
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
    this.patternBtns.forEach((b, i) => b.classList.toggle('active', i === PG.state.active));
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
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toUpperCase();
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.togglePlay();
      } else if (/^Digit[1-4]$/.test(e.code)) {
        PG.state.active = +e.code.slice(-1) - 1;
        this.refreshPatternButtons();
        this.refreshGrid();
        PG.markDirty();
      }
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
