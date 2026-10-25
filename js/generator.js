/* PulseGrid — generator.js
 *
 * Rule-based beat generator: each style encodes the musical conventions of a
 * genre (where kicks may land, backbeats, hat grids, bass vocabulary), and the
 * RNG rolls inside those rules — so every "🎲" is random but still grooves.
 * Seeded via mulberry32, so a seed fully reproduces a beat.
 */

'use strict';

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ch = (rng, p) => rng() < p;
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const clamp01 = (p) => Math.max(0, Math.min(1, p));

// minor pentatonic degrees over one octave
const SCALE = [0, 3, 5, 7, 10];

function noteNear(rng, root, spread, lo = BASS_MIDI_LO, hi = BASS_MIDI_HI) {
  const deg = Math.floor(rng() * (spread + 1));
  const oct = ch(rng, 0.18) ? 12 : 0;
  return Math.max(lo, Math.min(hi, root + SCALE[deg] + oct));
}

/** Lead note or minor triad (root + 3 + 7, range-clipped) for generator vocabulary. */
function leadNotes(rng, root, chordProb) {
  const m = noteNear(rng, root, 3, LEAD_MIDI_LO, LEAD_MIDI_HI);
  if (ch(rng, chordProb)) {
    const triad = [m, m + 3, m + 7].filter((x) => x <= LEAD_MIDI_HI);
    if (triad.length >= 2) return triad;
  }
  return [m];
}

function emptyLanes() {
  const p = emptyPattern();
  return p;
}

/* ---------- style rules ---------- */

function genHouse(rng, dg) {
  const p = emptyLanes();
  [0, 4, 8, 12].forEach((s) => (p.tracks.kick[s] = 1));
  if (ch(rng, 0.95)) { p.tracks.clap[4] = 2; p.tracks.clap[12] = 2; }
  for (const s of [2, 6, 10, 14]) {
    if (ch(rng, clamp01(0.9 * dg))) p.tracks.chat[s] = ch(rng, 0.35) ? 2 : 1;
  }
  if (ch(rng, 0.7)) p.tracks.ohat[pick(rng, [6, 14])] = 1;
  for (let s = 0; s < 16; s++) if (ch(rng, clamp01(0.8 * dg))) p.tracks.shaker[s] = 1;
  for (const s of [2, 6, 10, 14]) {
    if (ch(rng, 0.85)) p.tracks.bass[s] = { midi: noteNear(rng, 36, 2), accent: s % 8 === 2 };
  }
  for (const s of [3, 7, 11, 15]) {
    if (ch(rng, clamp01(0.55 * dg))) p.tracks.lead[s] = { notes: leadNotes(rng, 60, 0.35), accent: false };
  }
  return { pattern: p, bpm: 120 + Math.round(rng() * 10), swing: +(0.05 + rng() * 0.06).toFixed(2), fx: { pump: 0.5, humanize: 0.12 } };
}

function genHiphop(rng, dg) {
  const p = emptyLanes();
  const kickSlots = pick(rng, [[0, 6, 10], [0, 7, 10], [0, 3, 6, 10], [0, 10]]);
  kickSlots.forEach((s) => (p.tracks.kick[s] = 1));
  const free = [...Array(16).keys()].filter((s) => !kickSlots.includes(s) && s !== 4 && s !== 12);
  if (ch(rng, clamp01(0.35 * dg))) p.tracks.kick[pick(rng, free)] = 1; // ghost kick
  p.tracks.snare[4] = 2; p.tracks.snare[12] = 2;
  if (ch(rng, clamp01(0.35 * dg))) {
    const g = pick(rng, [7, 9, 11, 15]);
    p.tracks.snare[g] = 1;
  }
  if (ch(rng, 0.4)) { p.tracks.clap[4] = 1; p.tracks.clap[12] = 1; }
  for (let s = 0; s < 16; s += 2) {
    if (ch(rng, clamp01(0.85 * dg))) p.tracks.chat[s] = 1;
  }
  for (const s of [1, 3, 5, 7, 9, 11, 13, 15]) {
    if (ch(rng, clamp01(0.2 * dg))) p.tracks.chat[s] = 1;
  }
  if (ch(rng, 0.35)) p.tracks.ohat[14] = 1;
  for (const s of kickSlots) {
    if (ch(rng, 0.85)) p.tracks.bass[s] = { midi: noteNear(rng, 36, 2), accent: s === 0 };
  }
  if (ch(rng, 0.6)) p.tracks.lead[pick(rng, [0, 4, 8, 12])] = { notes: leadNotes(rng, 60, 0.2), accent: false };
  if (ch(rng, 0.3)) p.tracks.lead[14] = { notes: leadNotes(rng, 60, 0.2), accent: true };
  return { pattern: p, bpm: 84 + Math.round(rng() * 12), swing: +(0.24 + rng() * 0.1).toFixed(2), fx: { pump: 0.25, humanize: 0.35 } };
}

function genTechno(rng, dg) {
  const p = emptyLanes();
  [0, 4, 8, 12].forEach((s) => (p.tracks.kick[s] = 1));
  if (ch(rng, clamp01(0.25 * dg))) p.tracks.kick[pick(rng, [3, 7, 11, 15])] = 1;
  if (ch(rng, 0.5)) p.tracks.clap[12] = 1;
  for (const s of [2, 6, 10, 14]) {
    if (ch(rng, clamp01(0.92 * dg))) p.tracks.chat[s] = ch(rng, 0.3) ? 2 : 1;
  }
  for (const s of [6, 14]) if (ch(rng, 0.7)) p.tracks.ohat[s] = 1;
  for (let s = 1; s < 16; s += 2) if (ch(rng, clamp01(0.75 * dg))) p.tracks.shaker[s] = 1;
  if (ch(rng, 0.4)) { p.tracks.cowbell[3] = 1; if (ch(rng, 0.5)) p.tracks.cowbell[11] = 1; }
  const root = 36;
  for (let s = 0; s < 16; s++) {
    p.tracks.bass[s] = { midi: s === 15 && ch(rng, 0.25) ? root + 12 : root, accent: s % 4 === 0 };
  }
  for (const s of [2, 6, 10, 14]) {
    if (ch(rng, clamp01(0.6 * dg))) {
      p.tracks.lead[s] = { notes: [63, 66, 70], accent: s === 2 };   // hypnotic minor stab
    }
  }
  return { pattern: p, bpm: 128 + Math.round(rng() * 12), swing: 0, fx: { pump: 0.6, humanize: 0.05 } };
}

function genBreaks(rng, dg) {
  const p = emptyLanes();
  const kickSlots = pick(rng, [[0, 10], [0, 6, 10], [0, 3, 10], [0, 10, 13]]);
  kickSlots.forEach((s) => (p.tracks.kick[s] = 1));
  p.tracks.snare[4] = 2; p.tracks.snare[12] = 2;
  if (ch(rng, 0.6)) p.tracks.snare[pick(rng, [7, 9])] = 1;
  for (let s = 0; s < 16; s += 2) {
    if (ch(rng, clamp01(0.8 * dg))) p.tracks.chat[s] = 1;
  }
  if (ch(rng, clamp01(0.3 * dg))) p.tracks.chat[pick(rng, [3, 7, 11, 15])] = 1;
  if (ch(rng, 0.45)) p.tracks.ohat[14] = 1;
  if (ch(rng, 0.35)) p.tracks.tom[15] = 1;
  for (let s = 0; s < 16; s += 2) {
    if (ch(rng, clamp01(0.55 * dg))) {
      p.tracks.bass[s] = { midi: noteNear(rng, 36, 3), accent: s === 0 };
    }
  }
  const riffSlots = [0, 6, 10].filter(() => ch(rng, 0.7));
  for (const s of riffSlots) {
    p.tracks.lead[s] = { notes: leadNotes(rng, 60, 0.3), accent: s === 0 };
  }
  return { pattern: p, bpm: 108 + Math.round(rng() * 12), swing: +(0.06 + rng() * 0.06).toFixed(2), fx: { pump: 0.3, humanize: 0.2 } };
}

function genTrap(rng, dg) {
  const p = emptyLanes();
  // half-time skeleton: sparse 808-ish kick, snare ONLY on the 3rd beat
  const kickSlots = pick(rng, [[0, 7, 10], [0, 6, 11], [0, 10], [0, 3, 10]]);
  kickSlots.forEach((s) => (p.tracks.kick[s] = 1));
  if (ch(rng, clamp01(0.3 * dg))) p.tracks.kick[pick(rng, [13, 14, 15])] = 1;
  p.tracks.snare[8] = 2;
  if (ch(rng, 0.3)) p.tracks.snare[15] = 1;
  // rolling hats: steady 16ths, downbeat accents, a few human gaps
  for (let s = 0; s < 16; s++) {
    if (ch(rng, clamp01(0.85 * dg))) p.tracks.chat[s] = (s % 4 === 0 || ch(rng, 0.15)) ? 2 : 1;
  }
  if (ch(rng, 0.5)) p.tracks.ohat[14] = 1;
  if (ch(rng, clamp01(0.4 * dg))) p.tracks.tom[13] = 1;
  // dark sub bass following the kick
  for (const s of kickSlots) {
    if (ch(rng, 0.8)) p.tracks.bass[s] = { midi: noteNear(rng, 36, 2), accent: s === 0 };
  }
  if (ch(rng, 0.4)) p.tracks.bass[12] = { midi: 41, accent: false };
  // sparse minor motif
  if (ch(rng, 0.7)) {
    for (const s of [2, 5, 9, 12].filter(() => ch(rng, 0.5))) {
      p.tracks.lead[s] = { notes: leadNotes(rng, 60, 0.2), accent: false };
    }
  }
  return { pattern: p, bpm: 130 + Math.round(rng() * 16), swing: +(rng() * 0.08).toFixed(2), fx: { pump: 0.6, humanize: 0.1 } };
}

function genLofi(rng, dg) {
  const p = emptyLanes();
  const kickSlots = pick(rng, [[0, 10], [0, 7, 10], [0, 11]]);
  kickSlots.forEach((s) => (p.tracks.kick[s] = 1));
  p.tracks.snare[4] = 2; p.tracks.snare[12] = 2;
  if (ch(rng, 0.5)) p.tracks.snare[pick(rng, [9, 11, 15])] = 1;   // ghost
  for (let s = 0; s < 16; s += 2) {
    if (ch(rng, clamp01(0.6 * dg))) p.tracks.chat[s] = 1;
  }
  if (ch(rng, 0.4)) p.tracks.ohat[6] = 1;
  for (const s of [2, 5, 8, 14]) {
    if (ch(rng, clamp01(0.4 * dg))) p.tracks.shaker[s] = 1;       // dusty ticks
  }
  for (let s = 0; s < 16; s += 2) {
    if (ch(rng, clamp01(0.5 * dg))) p.tracks.bass[s] = { midi: noteNear(rng, 36, 3), accent: s === 0 };
  }
  for (const s of [0, 3, 6, 10, 12].filter(() => ch(rng, 0.45))) {
    p.tracks.lead[s] = { notes: leadNotes(rng, 60, 0.5), accent: false };
  }
  return {
    pattern: p, bpm: 72 + Math.round(rng() * 12), swing: +(0.28 + rng() * 0.12).toFixed(2),
    fx: { pump: 0.2, humanize: 0.45 },
  };
}

function genSurprise(rng, dg) {
  const styles = [genHouse, genHiphop, genTechno, genBreaks, genTrap, genLofi];
  const base = pick(rng, styles)(rng, dg);
  const p = base.pattern;
  // cross-pollinate: sprinkle elements from the other styles
  if (ch(rng, 0.5)) p.tracks.tom[pick(rng, [10, 13, 15])] = 1;
  if (ch(rng, 0.4)) p.tracks.cowbell[pick(rng, [2, 6, 10, 14])] = 1;
  if (ch(rng, 0.3)) p.tracks.shaker = p.tracks.shaker.map((v) => (v ? v : (ch(rng, 0.2 * dg) ? 1 : 0)));
  return { pattern: p, bpm: 76 + Math.round(rng() * 68), swing: +(rng() * 0.34).toFixed(2) };
}

const GEN_STYLES = [
  { id: 'house',    name: 'House',    fn: genHouse },
  { id: 'hiphop',   name: 'Hip-Hop',  fn: genHiphop },
  { id: 'techno',   name: 'Techno',   fn: genTechno },
  { id: 'breaks',   name: 'Breaks',   fn: genBreaks },
  { id: 'trap',     name: 'Trap',     fn: genTrap },
  { id: 'lofi',     name: 'Lo-fi',    fn: genLofi },
  { id: 'surprise', name: 'Surprise', fn: genSurprise },
];

/* ---------- euclidean rhythms ---------- */

/** Even spacing of `pulses` hits over `steps` slots, rotated by `rotate`.
 *  Bresenham-style distribution: exactly `pulses` hits, maximally even,
 *  first hit on step 0 (Bjorklund convention). */
function euclid(pulses, steps, rotate = 0) {
  if (pulses <= 0) return new Array(steps).fill(0);
  const pat = [];
  for (let i = 0; i < steps; i++) {
    const cur = Math.floor((i * pulses) / steps);
    const prev = i === 0 ? -1 : Math.floor(((i - 1) * pulses) / steps);
    pat.push(cur > prev ? 1 : 0);
  }
  return pat.slice(rotate % steps).concat(pat.slice(0, rotate % steps));
}

/* ---------- mutation ---------- */

/** Evolve a pattern: small musical nudges — never destroys the downbeat kick. */
function mutatePattern(src, rng, amount = 1) {
  const p = clonePattern(src);

  for (const t of TRACKS) {
    const lane = p.tracks[t.id];
    for (let s = 0; s < lane.length; s++) {
      const strong = s % 4 === 0;
      if (t.id === 'kick' && s === 0) continue;                 // keep the one
      if (lane[s] && ch(rng, 0.12 * amount)) lane[s] = 0;       // drop
      else if (!lane[s] && ch(rng, (strong ? 0.1 : 0.04) * amount)) lane[s] = 1; // add
      else if (lane[s] === 2 && ch(rng, 0.15)) lane[s] = 1;     // soften accent
      else if (lane[s] === 1 && strong && ch(rng, 0.1)) lane[s] = 2; // harden
    }
  }

  for (const lane of ['bass', 'lead']) {
    const isLead = lane === 'lead';
    const lo = isLead ? LEAD_MIDI_LO : BASS_MIDI_LO;
    const hi = isLead ? LEAD_MIDI_HI : BASS_MIDI_HI;
    const root = isLead ? 60 : 36;
    const freshNote = () => isLead
      ? { notes: leadNotes(rng, 60, 0.3), accent: false }
      : { midi: noteNear(rng, root, 3, lo, hi), accent: false };
    for (let s = 0; s < p.tracks[lane].length; s++) {
      const n = p.tracks[lane][s];
      if (!n) {
        if (ch(rng, 0.05 * amount)) p.tracks[lane][s] = freshNote();
        continue;
      }
      if (isLead) {
        if (ch(rng, 0.25)) n.notes = leadNotes(rng, 60, 0.3);   // re-roll chord/singleton
      } else if (ch(rng, 0.25)) {
        n.midi = noteNear(rng, root, 3, lo, hi);
      }
      if (ch(rng, 0.15)) n.accent = !n.accent;
      if (ch(rng, 0.06 * amount)) p.tracks[lane][s] = null;
    }
  }
  return p;
}

/** Concatenate two same-length patterns into one double-length pattern. */
function concatPatterns(a, b) {
  const n = (a.tracks.kick || []).length + (b.tracks.kick || []).length;
  const out = emptyPattern(n);
  for (const k of Object.keys(out.tracks)) {
    out.tracks[k] = [...(a.tracks[k] || []), ...(b.tracks[k] || [])];
    while (out.tracks[k].length < n) out.tracks[k].push(k === 'bass' || k === 'lead' ? null : 0);
  }
  return out;
}

const Generator = {
  styles: GEN_STYLES,
  /** density: 0..1 (scales event probabilities). seed optional for reproducible
   *  beats. steps: 16 (default) or 32 — a 32 is two generated bars concatenated. */
  generate(styleId, density, seed, steps = 16) {
    const style = GEN_STYLES.find((s) => s.id === styleId) || GEN_STYLES[0];
    const rng = mulberry32(seed == null ? (Math.random() * 0x7fffffff) | 0 : seed);
    const dg = 0.4 + density * 1.2;
    const first = style.fn(rng, dg);
    if (steps !== 32) return first;
    const second = style.fn(rng, dg);
    return { pattern: concatPatterns(first.pattern, second.pattern), bpm: first.bpm, swing: first.swing, fx: first.fx };
  },
  mutate(pattern, seed, amount = 1) {
    const rng = mulberry32(seed == null ? (Math.random() * 0x7fffffff) | 0 : seed);
    return mutatePattern(pattern, rng, amount);
  },

  /** Random euclidean fill for a percussion lane: E(k, steps) with rotation. */
  euclidFill(seed, steps = 16) {
    const rng = mulberry32(seed == null ? (Math.random() * 0x7fffffff) | 0 : seed);
    const targets = ['chat', 'ohat', 'tom', 'cowbell', 'shaker'];
    const trackId = pick(rng, targets);
    const k = Math.max(3, Math.round(steps * (0.18 + rng() * 0.24)));
    const rotate = Math.floor(rng() * steps);
    const lane = euclid(k, steps, rotate).map((v, i) => (v ? (i % 4 === 0 ? 2 : 1) : 0));
    return { trackId, k, rotate, lane };
  },
};
