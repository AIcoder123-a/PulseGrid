/* PulseGrid — presets.js
 *
 * Genres are authored in a tiny text DSL so patterns stay readable:
 *
 *   P('x...x...x...x...')   drum lane: 'x' = hit, '.' = rest
 *   B([[2,36,1], ...])      bass lane: [step, midi, accent]
 *
 * Bass midi range: 36 = C2 … 48 = C3.
 */

'use strict';

function emptyPattern(n = STEPS) {
  const tracks = {};
  for (const t of TRACKS) tracks[t.id] = new Array(n).fill(0);  // 0 = off, 1 = hit, 2 = accent
  tracks.bass = new Array(n).fill(null);   // null | { midi, accent }
  tracks.lead = new Array(n).fill(null);   // null | { notes: [midi...], accent }
  return { tracks };
}

/** Resize a pattern's lanes to `n` steps (pad with rests / truncate). */
function resizePattern(p, n) {
  const out = emptyPattern(n);
  for (const k of Object.keys(out.tracks)) {
    const lane = p.tracks[k] || [];
    out.tracks[k] = lane.slice(0, n);
    const pad = n - out.tracks[k].length;
    for (let i = 0; i < pad; i++) out.tracks[k].push(k === 'bass' || k === 'lead' ? null : 0);
  }
  return out;
}

/** 'x...X...' → [0,1,0,0,2,...] ('X' = accented hit) */
function P(str) {
  return str.split('').map((c) => (c === 'X' ? 2 : c === 'x' ? 1 : 0));
}

/** [[step, midi, accent], ...] → note array */
function B(entries) {
  const a = new Array(STEPS).fill(null);
  for (const [s, midi, accent] of entries) a[s] = { midi, accent: !!accent };
  return a;
}

/** [[step, midiOrNotes, accent], ...] → lead lane. A number becomes a single
 *  note, an array becomes a chord (1–3 notes). */
function L(entries) {
  const a = new Array(STEPS).fill(null);
  for (const [s, notes, accent] of entries) {
    a[s] = { notes: Array.isArray(notes) ? [...notes] : [notes], accent: !!accent };
  }
  return a;
}

/** Rolling 16th bass used by techno: accent every downbeat. */
function rollingBass(midi) {
  const a = new Array(STEPS).fill(null);
  for (let s = 0; s < STEPS; s++) a[s] = { midi, accent: s % 4 === 0 };
  return a;
}

/** Synthwave octave pump: root / octave alternating on 8ths. */
function octavePump(root, pairs) {
  const a = new Array(STEPS).fill(null);
  for (const [s, midi, acc] of pairs) a[s] = { midi, accent: !!acc };
  return a;
}

const PRESETS = [
  {
    name: 'House',
    bpm: 124, swing: 0.10,
    fx: { delay: 0.20, reverb: 0.16, filter: 16000, pump: 0.5, humanize: 0.1 },
    patterns: [
      { // A — main groove
        tracks: {
          kick:    P('x...x...x...x...'),
          snare:   P('................'),
          clap:    P('....x.......x...'),
          chat:    P('..X...x...X...x.'),
          ohat:    P('..............x.'),
          tom:     P('................'),
          cowbell: P('................'),
          shaker:  P('xxxxxxxxxxxxxxxx'),
          bass:    B([[2, 36, 1], [6, 36, 0], [10, 36, 1], [14, 36, 0]]),
        },
      },
      { // B — variation: busier hats, moving bassline (F–G)
        tracks: {
          kick:    P('x...x...x...x...'),
          snare:   P('................'),
          clap:    P('....x.......x...'),
          chat:    P('xxxxxxxxxxxxxxxx'),
          ohat:    P('......x.......x.'),
          tom:     P('................'),
          cowbell: P('................'),
          shaker:  P('..x...x...x...x.'),
          bass:    B([[2, 41, 0], [6, 41, 0], [10, 43, 1], [14, 41, 0]]),
          lead:    L([[6, 63, 0], [14, 65, 0]]),
        },
      },
    ],
  },
  {
    name: 'Hip-Hop',
    bpm: 88, swing: 0.30,
    fx: { delay: 0.12, reverb: 0.12, filter: 16000, pump: 0.25, humanize: 0.35 },
    patterns: [
      { // A — boom bap
        tracks: {
          kick:    P('x.....x...x.....'),
          snare:   P('....X.......X...'),
          clap:    P('....x.......x...'),
          chat:    P('x.x.x.x.x.x.x.x.'),
          ohat:    P('..............x.'),
          tom:     P('...............x'),
          cowbell: P('................'),
          shaker:  P('................'),
          bass:    B([[0, 36, 1], [6, 36, 0], [10, 39, 0], [15, 43, 0]]),
        },
      },
      { // B — variation
        tracks: {
          kick:    P('x.....x...x...x.'),
          snare:   P('....X.......X...'),
          clap:    P('................'),
          chat:    P('x.x.x.x.x.x.xxx.'),
          ohat:    P('................'),
          tom:     P('..............x.'),
          cowbell: P('................'),
          shaker:  P('................'),
          bass:    B([[0, 36, 1], [6, 41, 0], [10, 39, 0], [12, 36, 0]]),
          lead:    L([[0, 67, 0], [10, 65, 0]]),
        },
      },
    ],
  },
  {
    name: 'Techno',
    bpm: 132, swing: 0,
    fx: { delay: 0.24, reverb: 0.20, filter: 18000, pump: 0.6, humanize: 0.05 },
    patterns: [
      { // A — driving
        tracks: {
          kick:    P('x...x...x...x...'),
          snare:   P('................'),
          clap:    P('............x...'),
          chat:    P('..x...x...x...x.'),
          ohat:    P('......x.......x.'),
          tom:     P('...............x'),
          cowbell: P('................'),
          shaker:  P('.x.x.x.x.x.x.x.x'),
          bass:    rollingBass(36),
          lead:    L([[3, [63, 66, 70], 0], [7, [63, 66, 70], 0], [11, [63, 66, 70], 1], [15, [63, 66, 70], 0]]),
        },
      },
      { // B — rumble variation
        tracks: {
          kick:    P('x...x...x...x...'),
          snare:   P('................'),
          clap:    P('................'),
          chat:    P('..x...x...x...x.'),
          ohat:    P('................'),
          tom:     P('................'),
          cowbell: P('....x.......x...'),
          shaker:  P('xxxxxxxxxxxxxxxx'),
          bass:    rollingBass(36),
        },
      },
    ],
  },
  {
    name: 'Synthwave',
    bpm: 104, swing: 0.05,
    fx: { delay: 0.26, reverb: 0.24, filter: 14000, pump: 0.4, humanize: 0.15 },
    patterns: [
      { // A — pumping octaves
        tracks: {
          kick:    P('x.......x.......'),
          snare:   P('....x.......x...'),
          clap:    P('................'),
          chat:    P('x.x.x.x.x.x.x.x.'),
          ohat:    P('..............x.'),
          tom:     P('................'),
          cowbell: P('................'),
          shaker:  P('................'),
          bass:    octavePump(36, [
            [0, 36, 1], [2, 48, 0], [4, 36, 0], [6, 48, 0],
            [8, 36, 1], [10, 48, 0], [12, 36, 0], [14, 48, 0],
          ]),
          lead:    L([[0, 60, 0], [2, 63, 0], [4, 67, 0], [6, 70, 0],
                      [8, 60, 0], [10, 63, 0], [12, 67, 0], [14, 72, 1]]),
        },
      },
      { // B — sparser break
        tracks: {
          kick:    P('x.......x.......'),
          snare:   P('....x.......x..x'),
          clap:    P('................'),
          chat:    P('x.x.x.x.x.x.x.x.'),
          ohat:    P('................'),
          tom:     P('..........x.....'),
          cowbell: P('................'),
          shaker:  P('................'),
          bass:    octavePump(36, [
            [0, 36, 1], [2, 48, 0], [6, 48, 0],
            [8, 36, 0], [10, 48, 0], [14, 48, 0],
          ]),
        },
      },
    ],
  },
];

/* ---------- first-visit demo song ----------
 * A hand-authored arrangement that shows off the whole instrument:
 * A verse groove, B chord-stab chorus, C break, D snare-roll build —
 * chained by song mode with a repeat on the chorus. */
const DEMO_PATTERNS = [
  { // A — verse
    tracks: {
      kick:    P('x...x...x...x...'),
      snare:   P('................'),
      clap:    P('....x.......x...'),
      chat:    P('..x...x...x...x.'),
      ohat:    P('..............x.'),
      tom:     P('................'),
      cowbell: P('................'),
      shaker:  P('x.x.x.x.x.x.x.x.'),
      bass:    B([[0, 36, 1], [3, 36, 0], [6, 43, 0], [8, 36, 1], [11, 41, 0], [14, 43, 0]]),
      lead:    L([[6, 60, 0], [7, 63, 0], [14, 67, 0]]),
    },
  },
  { // B — chorus with chord stabs
    tracks: {
      kick:    P('x...x...x...x...'),
      snare:   P('....X.......X...'),
      clap:    P('................'),
      chat:    P('x.x.x.x.x.x.x.x.'),
      ohat:    P('......x.......x.'),
      tom:     P('................'),
      cowbell: P('................'),
      shaker:  P('................'),
      bass:    B([[0, 36, 1], [2, 36, 0], [4, 43, 0], [8, 41, 1], [10, 41, 0], [12, 43, 0]]),
      lead:    L([[4, [63, 66, 70], 0], [12, [63, 66, 70], 1]]),
    },
  },
  { // C — break: no kick, pads carry it
    tracks: {
      kick:    P('................'),
      snare:   P('...............x'),
      clap:    P('....x.......x...'),
      chat:    P('..x...x...x...x.'),
      ohat:    P('................'),
      tom:     P('..........x.....'),
      cowbell: P('................'),
      shaker:  P('................'),
      bass:    B([[8, 41, 0], [11, 43, 0]]),
      lead:    L([[2, 60, 0], [5, 63, 0], [9, 67, 0], [13, 70, 0]]),
    },
  },
  { // D — build: snare roll into the drop
    tracks: {
      kick:    P('x...x...x.x.x.x.'),
      snare:   P('....x...x.x.xxxx'),
      clap:    P('................'),
      chat:    P('x.x.x.x.x.x.x.x.'),
      ohat:    P('................'),
      tom:     P('................'),
      cowbell: P('................'),
      shaker:  P('xxxxxxxxxxxxxxxx'),
      bass:    B([[0, 36, 1], [4, 36, 0], [8, 41, 0], [12, 43, 1]]),
      lead:    L([[8, [63, 66, 70], 1]]),
    },
  },
];

/** The first-visit project: demo arrangement with song mode ON. */
function demoState() {
  const st = defaultState();
  st.bpm = 122;
  st.swing = 0.08;
  st.fx = { delay: 0.22, reverb: 0.18, filter: 16000, pump: 0.45, humanize: 0.12 };
  st.patterns = DEMO_PATTERNS.map((p) => clonePattern(p));
  st.song = { enabled: true, chain: [0, 0, 1, 1, 2, 3, 1, 1], reps: [1, 1, 1, 1, 1, 1, 2, 1] };
  st.active = 0;
  return st;
}

/** Deep copy of a pattern (patterns only contain plain data). */
function clonePattern(p) {
  const tracks = {};
  for (const k of Object.keys(p.tracks)) {
    tracks[k] = p.tracks[k].map((v) => (v && typeof v === 'object' ? { ...v } : v));
  }
  return { tracks };
}

// presets may omit lanes they don't use — backfill anything missing
for (const preset of PRESETS) {
  for (const p of preset.patterns) {
    const ep = emptyPattern();
    for (const k of Object.keys(ep.tracks)) {
      if (p.tracks[k] == null) p.tracks[k] = ep.tracks[k];
    }
  }
}

function defaultState() {
  const trackState = {};
  for (const t of [...TRACKS, { id: 'bass' }, { id: 'lead' }]) {
    trackState[t.id] = { vol: 0.8, mute: false, solo: false, tune: 1, decay: 1 };
  }
  const preset = PRESETS[0];
  const patterns = [clonePattern(preset.patterns[0]), clonePattern(preset.patterns[1]),
                    emptyPattern(), emptyPattern()];
  return {
    version: 1,
    steps: 16,
    bpm: preset.bpm,
    swing: preset.swing,
    masterVol: 0.85,
    fx: { ...preset.fx },
    active: 0,
    patterns,
    trackState,
    song: { enabled: false, chain: [0, 1] },
  };
}
