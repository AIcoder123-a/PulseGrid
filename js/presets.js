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

function emptyPattern() {
  const tracks = {};
  for (const t of TRACKS) tracks[t.id] = new Array(STEPS).fill(0);  // 0 = off, 1 = hit, 2 = accent
  tracks.bass = new Array(STEPS).fill(null);   // null | { midi, accent }
  return { tracks };
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
    fx: { delay: 0.20, reverb: 0.16, filter: 16000 },
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
        },
      },
    ],
  },
  {
    name: 'Hip-Hop',
    bpm: 88, swing: 0.30,
    fx: { delay: 0.12, reverb: 0.12, filter: 16000 },
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
        },
      },
    ],
  },
  {
    name: 'Techno',
    bpm: 132, swing: 0,
    fx: { delay: 0.24, reverb: 0.20, filter: 18000 },
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
    fx: { delay: 0.26, reverb: 0.24, filter: 14000 },
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

/** Deep copy of a pattern (patterns only contain plain data). */
function clonePattern(p) {
  const tracks = {};
  for (const k of Object.keys(p.tracks)) {
    tracks[k] = p.tracks[k].map((v) => (v && typeof v === 'object' ? { ...v } : v));
  }
  return { tracks };
}

function defaultState() {
  const trackState = {};
  for (const t of [...TRACKS, { id: 'bass' }]) {
    trackState[t.id] = { vol: 0.8, mute: false, solo: false, tune: 1, decay: 1 };
  }
  const preset = PRESETS[0];
  const patterns = [clonePattern(preset.patterns[0]), clonePattern(preset.patterns[1]),
                    emptyPattern(), emptyPattern()];
  return {
    version: 1,
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
