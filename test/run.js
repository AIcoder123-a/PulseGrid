#!/usr/bin/env node
/* PulseGrid — test/run.js
 *
 * Zero-dependency test runner. The app modules are classic browser scripts,
 * so we load them into a `vm` context with minimal DOM/localStorage stubs and
 * exercise the pure data layer: pattern DSL, preset integrity, state
 * normalization, the share codec, beat-generator rules, the MIDI writer and
 * the WAV header encoder. (Audio-clock scheduling stays covered by manual
 * browser E2E — see README.)
 *
 * Run:  node test/run.js    (or: npm test)
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/* ---------- minimal browser stubs ---------- */

const sandbox = {
  console,
  window: {},
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelectorAll() { return []; },
    createElement() { throw new Error('DOM unavailable in unit tests'); },
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  location: { hash: '' },
  setTimeout, clearTimeout, setInterval, clearInterval,
  requestAnimationFrame() {},
  performance: { now: () => Date.now() },
  Blob: class {
    constructor(parts, opts) {
      this.parts = parts;
      this.size = parts.reduce((n, p) => n + (p.byteLength || p.length || 0), 0);
      this.type = (opts && opts.type) || '';
    }
    arrayBuffer() { return Promise.resolve(this.parts[0]); }
  },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  escape: (s) => encodeURIComponent(s),      // share codec only round-trips ASCII payloads
  unescape: (s) => decodeURIComponent(s),
};

const ctx = vm.createContext(sandbox);
const SRC = path.join(__dirname, '..', 'js');
for (const f of ['audio-engine.js', 'presets.js', 'sequencer.js', 'visualizer.js',
                 'render.js', 'midi.js', 'generator.js', 'i18n.js', 'ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}

// bridge context bindings (const/class live in the realm's lexical scope,
// not on the sandbox object) and give UI.* a PG.state to work with
vm.runInContext(`
  globalThis.PG = { state: defaultState() };
  globalThis.T = {
    STEPS, TRACKS, PRESETS, P, B, defaultState, emptyPattern, clonePattern,
    makeSoftClipCurve, encodeWav, RenderWav, Generator, euclid, MidiExport, UI,
    STRINGS, TRACK_NAMES, t, LEAD_KEYS, demoState, AudioEngine, MidiImport, rotated,
  };
`, ctx);
const T = ctx.T;
const TRACKS = T.TRACKS;

/* ---------- tiny framework ---------- */

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name} (${Date.now() - t0}ms)`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e });
    console.log(`FAIL  ${name}\n     ${e.message}`);
  }
}

const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'expected truthy'); };
const eq = (a, b, msg) => {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${msg || 'not equal'}\n     got:  ${ja}\n     want: ${jb}`);
};

/* ---------- helpers ---------- */

const validLane = (lane) =>
  Array.isArray(lane) && lane.length === 16 && lane.every((v) => v === 0 || v === 1 || v === 2);
const validBass = (lane) =>
  Array.isArray(lane) && lane.length === 16 &&
  lane.every((n) => n === null || (n && typeof n === 'object' &&
    n.midi >= 36 && n.midi <= 48 && typeof n.accent === 'boolean'));
const validLead = (lane) =>
  Array.isArray(lane) && lane.length === 16 &&
  lane.every((n) => n === null || (n && typeof n === 'object' && Array.isArray(n.notes) &&
    n.notes.length >= 1 && n.notes.length <= 3 &&
    n.notes.every((m) => Number.isInteger(m) && m >= 60 && m <= 72) &&
    typeof n.accent === 'boolean'));
const validPattern = (p) =>
  TRACKS.every((t) => validLane(p.tracks[t.id])) && validBass(p.tracks.bass) && validLead(p.tracks.lead);

const find3 = (b, x, y, z) => {
  for (let i = 0; i < b.length - 2; i++) {
    if (b[i] === x && b[i + 1] === y && b[i + 2] === z) return i;
  }
  return -1;
};
const str = (b, o, n) => String.fromCharCode(...b.slice(o, o + n));

/* ---------- tests ---------- */

const run = async () => {
  console.log('\nPulseGrid unit tests (pure data layer)\n');

  await test('pattern DSL: x / X / . parse to 0 / 2 / 0', () => {
    eq(T.P('x.X.'), [1, 0, 2, 0]);
    eq(T.P('................'.slice(0, 16)), new Array(16).fill(0));
    const ep = T.emptyPattern();
    ok(TRACKS.every((t) => validLane(ep.tracks[t.id])), 'empty lanes zeroed');
    ok(validBass(ep.tracks.bass), 'empty bass is nulls');
  });

  await test('defaultState: 4 patterns, 10 track strips, song chain, House loaded', () => {
    const st = T.defaultState();
    eq(st.patterns.length, 4);
    eq(st.song.chain, [0, 1]);
    eq(Object.keys(st.trackState).length, 10);
    ok(st.patterns.every(validPattern), 'all patterns structurally valid');
    eq(st.bpm, 124);
    eq(st.patterns[0].tracks.kick, [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
  });

  await test('presets: every genre pattern is structurally valid', () => {
    for (const preset of T.PRESETS) {
      ok(preset.bpm >= 60 && preset.bpm <= 200, `${preset.name} bpm in range`);
      for (const p of preset.patterns) ok(validPattern(p), `${preset.name} pattern valid`);
    }
    const house = T.PRESETS[0].patterns[0];
    eq(house.tracks.bass[2], { midi: 36, accent: true }, 'house bass accent on the "and"');
  });

  await test('generator: same seed reproduces the same beat', () => {
    const a = T.Generator.generate('house', 0.55, 4242);
    const b = T.Generator.generate('house', 0.55, 4242);
    eq(a, b, 'seeded generation must be deterministic');
  });

  await test('generator: musical invariants across 5 styles x 40 seeds', () => {
    for (const style of T.Generator.styles) {
      for (let seed = 1; seed <= 40; seed++) {
        const { pattern, bpm, swing } = T.Generator.generate(style.id, 0.55, seed);
        ok(validPattern(pattern), `${style.id}#${seed} structure`);
        ok(pattern.tracks.kick[0] !== 0, `${style.id}#${seed} downbeat kick`);
        ok(bpm >= 60 && bpm <= 200, `${style.id}#${seed} bpm`);
        ok(singlet(swing), `${style.id}#${seed} swing`);
        if (style.id === 'house' || style.id === 'techno') {
          ok([0, 4, 8, 12].every((s) => pattern.tracks.kick[s] !== 0), `${style.id}#${seed} four-on-floor`);
        }
        if (style.id === 'hiphop' || style.id === 'breaks') {
          ok(pattern.tracks.snare[4] === 2 && pattern.tracks.snare[12] === 2, `${style.id}#${seed} backbeat`);
        }
        if (style.id === 'trap') {
          ok(pattern.tracks.snare[8] === 2 && pattern.tracks.snare[4] === 0, `${style.id}#${seed} half-time snare`);
        }
      }
    }
    function singlet(v) { return typeof v === 'number' && v >= 0 && v <= 0.4; }
  });

  await test('euclid: classic patterns, pulse conservation, rotation', () => {
    eq(T.euclid(3, 8), [1, 0, 0, 1, 0, 0, 1, 0]);      // the classic tresillo
    eq(T.euclid(2, 4), [1, 0, 1, 0]);
    for (let k = 1; k <= 7; k++) {
      const lane = T.euclid(k, 16, 5);
      eq(lane.filter(Boolean).length, k, `E(${k},16) keeps exactly k pulses`);
      eq(lane.length, 16);
    }
    const unrot = T.euclid(5, 16, 0);
    const rot = T.euclid(5, 16, 3);
    eq([...rot.slice(13), ...rot.slice(0, 13)], unrot, 'rotation is a cyclic shift');
  });

  await test('euclidFill: valid percussion lane with k pulses', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { trackId, k, lane } = T.Generator.euclidFill(seed);
      ok(['chat', 'ohat', 'tom', 'cowbell', 'shaker'].includes(trackId), 'target is percussion');
      ok(k >= 3 && k <= 7, 'k in 3..7');
      eq(lane.filter((v) => v > 0).length, k, 'pulse count conserved');
      ok(lane.every((v) => v === 0 || v === 1 || v === 2), 'values are 0/1/2');
    }
  });

  await test('generator: style bpm windows', () => {
    const windows = { house: [120, 130], hiphop: [84, 96], techno: [128, 140], breaks: [108, 120], trap: [130, 146], lofi: [72, 84], dnb: [160, 174] };
    for (const [id, [lo, hi]] of Object.entries(windows)) {
      for (let seed = 1; seed <= 10; seed++) {
        const { bpm } = T.Generator.generate(id, 0.5, seed);
        ok(bpm >= lo && bpm <= hi, `${id}#${seed} bpm ${bpm} outside [${lo}, ${hi}]`);
      }
    }
  });

  await test('mutate: preserves the one, never mutates the source, output valid', () => {
    const src = T.Generator.generate('house', 0.6, 7).pattern;
    const snapshot = JSON.stringify(src);
    for (let seed = 1; seed <= 20; seed++) {
      const m = T.Generator.mutate(src, seed);
      eq(m.tracks.kick[0], src.tracks.kick[0], `seed ${seed}: downbeat kick must survive`);
      ok(validPattern(m), `seed ${seed}: structure`);
    }
    eq(JSON.stringify(src), snapshot, 'source pattern must be untouched');
    ok(T.Generator.mutate(src, 1) && JSON.stringify(T.Generator.mutate(src, 1)) !== snapshot,
      'mutation should change something');
  });

  await test('midi writer: byte-level structure of a deterministic pattern', async () => {
    const p = T.emptyPattern();
    p.tracks.kick[0] = 2;                                   // accented kick
    p.tracks.bass[0] = { midi: 36, accent: false };         // C2
    p.tracks.lead[0] = { notes: [67, 70, 74], accent: true };   // G4 minor triad, accented
    const st = T.defaultState();
    st.patterns = [p, T.emptyPattern(), T.emptyPattern(), T.emptyPattern()];
    st.song = { enabled: false, chain: [0, 1] };
    st.bpm = 120;
    const r = T.MidiExport.export(st);
    eq({ bars: r.bars, notes: r.notes }, { bars: 2, notes: 10 }, '1 pattern x 2 loops, 5 notes each');

    const b = new Uint8Array(await r.blob.arrayBuffer());
    eq(str(b, 0, 4), 'MThd');
    eq(str(b, 14, 4), 'MTrk');
    ok(((b[4] << 24) | (b[5] << 16) | (b[6] << 8) | b[7]) === 6, 'header length 6');
    ok(((b[8] << 8) | b[9]) === 0, 'format 0');
    ok(((b[10] << 8) | b[11]) === 1, 'one track');
    ok(((b[12] << 8) | b[13]) === 480, 'PPQ 480');

    const tAt = find3(b, 0xff, 0x51, 0x03);
    ok(tAt >= 0, 'tempo meta present');
    ok(((b[tAt + 3] << 16) | (b[tAt + 4] << 8) | b[tAt + 5]) === 500000, 'tempo = 500000 us/qn @120bpm');

    ok(find3(b, 0x99, 36, 110) >= 0, 'accented kick: note-on ch10, key 36, vel 110');
    ok(find3(b, 0x90, 36, 90) >= 0, 'bass note: note-on ch1, key 36, vel 90');
    ok(find3(b, 0x91, 67, 112) >= 0, 'lead chord root: note-on ch2, key 67, vel 112');
    ok(find3(b, 0x91, 70, 112) >= 0, 'lead chord 3rd: note-on ch2, key 70');
    ok(find3(b, 0x91, 74, 112) >= 0, 'lead chord 7th... key 74');
    ok(find3(b, 0xff, 0x2f, 0x00) >= 0, 'end-of-track present');
  });

  await test('midi writer: song mode renders the chain as arranged', async () => {
    const a = T.emptyPattern();
    a.tracks.kick[0] = 1;
    const st = T.defaultState();
    st.patterns = [a, T.emptyPattern(), T.emptyPattern(), T.emptyPattern()];
    st.song = { enabled: true, chain: [0, 0, 0] };          // 3 bars of A
    const r = T.MidiExport.export(st);
    eq(r.bars, 3, 'bars follow the chain');
    eq(r.notes, 3, 'one kick note per bar');
  });

  await test('share codec: roundtrip carries accents, chain and sound design', () => {
    const st = T.defaultState();
    st.bpm = 96;
    st.swing = 0.31;
    st.patterns[0].tracks.kick[0] = 2;
    st.patterns[0].tracks.bass[3] = { midi: 43, accent: true };
    st.patterns[0].tracks.lead[5] = { notes: [60, 63, 67], accent: true };
    st.song.chain = [0, 1, 3, 0];
    st.trackState.snare.tune = 1.5;
    st.trackState.snare.decay = 2;
    st.trackState.bass.vol = 0.4;
    st.fx.pump = 0.55;
    st.fx.humanize = 0.3;
    ctx.PG.state = st;

    const code = T.UI.encodeShare();
    ok(/^[A-Za-z0-9_-]+$/.test(code), 'code must be URL-safe base64url');
    const back = T.UI.decodeShare(code);

    eq(back.patterns, st.patterns, 'patterns survive');
    eq(back.song.chain, [0, 1, 3, 0], 'song chain survives');
    eq(back.trackState.snare, { vol: 0.8, mute: false, solo: false, tune: 1.5, decay: 2 }, 'sound design survives');
    eq(back.trackState.bass.vol, 0.4, 'track volume survives');
    eq([back.bpm, back.swing], [96, 0.31], 'transport survives');
    eq([back.fx.pump, back.fx.humanize], [0.55, 0.3], 'pump & humanize survive');

    // idempotency: re-encoding a decoded state reproduces the same link
    ctx.PG.state = back;
    eq(T.UI.encodeShare(), code, 'encode(decode(code)) === code');
  });

  await test('share codec: empty patterns are skipped, decode backfills them', () => {
    const st = T.defaultState();
    st.patterns = [st.patterns[0], T.emptyPattern(), T.emptyPattern(), T.emptyPattern()];
    ctx.PG.state = st;
    const code = T.UI.encodeShare();
    const back = T.UI.decodeShare(code);
    ok(validPattern(back.patterns[3]), 'missing patterns decode as empty');
    eq(back.patterns[3].tracks.kick, new Array(16).fill(0));
  });

  await test('normalizeState: legacy booleans coerce, sparse tracks backfill', () => {
    const old = {
      version: 1, bpm: 100, swing: 0.1, masterVol: 0.8, active: 0,
      fx: { delay: 0.1, reverb: 0.1, filter: 15000 },
      trackState: { kick: { vol: 0.5 } },                   // sparse on purpose
      patterns: [{ tracks: {
        kick: Array.from({ length: 16 }, (_, i) => i % 4 === 0),   // booleans
        snare: [true],                                       // too short
        clap: [], chat: [], ohat: [], tom: [], cowbell: [], shaker: [], bass: [],
      } }],
    };
    const st = T.UI.normalizeState(old);
    eq(st.patterns[0].tracks.kick[0], 1, 'true coerces to 1');
    eq(st.patterns[0].tracks.kick[1], 0, 'false coerces to 0');
    ok(st.patterns[0].tracks.snare.length === 16, 'short lanes padded');
    eq(Object.keys(st.trackState).length, 10, 'all ten strips backfilled');
    eq(st.trackState.kick.vol, 0.5, 'sparse volume kept');
    eq(st.trackState.snare.tune, 1, 'sound defaults backfilled');
    eq(st.song.chain, [0, 1], 'song backfilled');
  });

  await test('normalizeState: hostile data is sanitized, not crashed on', () => {
    const st = T.UI.normalizeState({
      patterns: 'nope', trackState: { kick: { vol: 99, tune: 99, decay: 0 } },
      song: { enabled: 1, chain: [0, 9, -1, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3] },
      active: 11, bpm: 9999,
    });
    eq(st.patterns.length, 4, 'patterns rebuilt');
    eq(st.trackState.kick.vol, 1, 'vol clamped');
    eq(st.trackState.kick.tune, 2, 'tune clamped');
    eq(st.trackState.kick.decay, 0.4, 'decay clamped');
    eq(st.song.chain.length, 16, 'chain capped at 16');
    ok(st.song.chain.every((v) => v >= 0 && v <= 3), 'chain values in range');
    eq(st.active, 3, 'active clamped');
  });

  await test('normalizeState: corrupted pattern entries are replaced, not fatal', () => {
    const st = T.UI.normalizeState({
      patterns: [null, { tracks: null }, 'junk', T.emptyPattern()],
    });
    eq(st.patterns.length, 4);
    ok(st.patterns.every(validPattern), 'every slot is a valid pattern after repair');
  });

  await test('normalizeState: legacy lead singles migrate, chords sanitize', () => {
    const legacy = T.emptyPattern();
    legacy.tracks.lead[0] = { midi: 67, accent: true };                          // v1.1 format
    legacy.tracks.lead[1] = { notes: [60, 63, 67], accent: false };              // chord
    legacy.tracks.lead[2] = { notes: [58, 90, 63, 63, 999], accent: 1 };         // junk values
    legacy.tracks.lead[3] = 'garbage';
    const st = ctx ? null : null; // noop guard for linters
    const out = T.UI.normalizeState({ patterns: [legacy, T.emptyPattern(), T.emptyPattern(), T.emptyPattern()] });
    const lead = out.patterns[0].tracks.lead;
    eq(lead[0], { notes: [67], accent: true }, 'legacy single migrates');
    eq(lead[1], { notes: [60, 63, 67], accent: false }, 'chord kept');
    eq(lead[2], { notes: [63], accent: true }, 'out-of-range dropped, junk filtered, accent coerced');
    eq(lead[3], null, 'garbage becomes rest');
  });

  await test('share codec: chord lead tokens roundtrip', () => {
    const st = T.defaultState();
    st.patterns[0].tracks.lead[2] = { notes: [60, 63, 67], accent: true };
    ctx.PG.state = st;
    const code = T.UI.encodeShare();
    const back = T.UI.decodeShare(code);
    eq(back.patterns[0].tracks.lead[2], { notes: [60, 63, 67], accent: true }, 'chord survives the link');
  });

  await test('normalizeState: legacy fx stays off for pump/humanize', () => {
    const noFx = T.UI.normalizeState({ bpm: 100 });
    eq([noFx.fx.pump, noFx.fx.humanize], [0, 0], 'missing fx -> pump/humanize off');
    const partial = T.UI.normalizeState({ fx: { delay: 0.3 } });
    eq([partial.fx.pump, partial.fx.humanize], [0, 0], 'partial fx -> pump/humanize off');
    eq(partial.fx.delay, 0.3, 'provided fx kept');
    const modern = T.UI.normalizeState({ fx: { delay: 0.1, reverb: 0.1, filter: 15000, pump: 0.7, humanize: 0.2 } });
    eq([modern.fx.pump, modern.fx.humanize], [0.7, 0.2], 'explicit values kept');
  });

  await test('soft-clip curve: odd-symmetric, bounded, monotonic', () => {
    const c = Array.from(T.makeSoftClipCurve(0.9));
    const n = c.length;
    ok(Math.abs(c[n - 1] - 1) < 1e-6 && Math.abs(c[0] + 1) < 1e-6, 'endpoints at ±1');
    for (let i = 0; i < n; i++) {
      ok(Math.abs(c[i] + c[n - 1 - i]) < 1e-6, `symmetry at ${i}`);
    }
    for (let i = 1; i < n; i++) ok(c[i] >= c[i - 1], `monotonic at ${i}`);
  });

  await test('WAV encoder: RIFF header fields and size math', () => {
    const N = 100;
    const fakeBuffer = {
      numberOfChannels: 2, length: N, sampleRate: 44100,
      getChannelData: () => new Float32Array(N).fill(0.5),
    };
    const blob = T.encodeWav(fakeBuffer);
    const dv = new DataView(blob.parts[0]);
    eq(str(new Uint8Array(blob.parts[0]), 0, 4), 'RIFF');
    eq(str(new Uint8Array(blob.parts[0]), 8, 4), 'WAVE');
    eq(dv.getUint32(4, true), 36 + N * 4, 'RIFF size');
    eq(dv.getUint16(20, true), 1, 'PCM format');
    eq(dv.getUint16(22, true), 2, 'stereo');
    eq(dv.getUint32(24, true), 44100, 'sample rate');
    eq(dv.getUint16(34, true), 16, 'bits per sample');
    eq(str(new Uint8Array(blob.parts[0]), 36, 4), 'data');
    eq(dv.getUint32(40, true), N * 4, 'data size');
    eq(dv.getInt16(44, true), Math.floor(0.5 * 0x7fff), 'first sample = +0.5 full scale');
  });

  await test('i18n: en/zh key parity and sane values', () => {
    const en = Object.keys(T.STRINGS.en).sort();
    const zh = Object.keys(T.STRINGS.zh).sort();
    eq(en, zh, 'every key exists in both languages');
    const enT = Object.keys(T.TRACK_NAMES.en).sort();
    const zhT = Object.keys(T.TRACK_NAMES.zh).sort();
    eq(enT, zhT, 'every track has a name in both languages');
    for (const k of en) {
      ok(typeof T.STRINGS.en[k] === 'string' && T.STRINGS.en[k].length > 0, `en.${k} non-empty`);
      ok(typeof T.STRINGS.zh[k] === 'string' && T.STRINGS.zh[k].length > 0, `zh.${k} non-empty`);
    }
    ok(T.t('tSure') === 'Sure?', 't() reads the default language');
    ok(T.STRINGS.zh.tSure.includes('确定'), 'zh clear-confirm present');
    // placeholder params match across languages
    for (const k of en) {
      const ph = (str) => (str.match(/\{[a-z]+\}/g) || []).sort().join(',');
      eq(ph(T.STRINGS.en[k]), ph(T.STRINGS.zh[k]), `placeholder parity for ${k}`);
    }
  });

  await test('32-step patterns: generate, codec, normalize, euclid', () => {
    // generator: 32 = two concatenated bars, invariants hold across both halves
    const g = T.Generator.generate('house', 0.6, 77, 32);
    eq(g.pattern.tracks.kick.length, 32, 'lanes are 32 long');
    for (const t of T.TRACKS) ok(g.pattern.tracks[t.id].length === 32, `${t.id} length`);
    ok(g.pattern.tracks.kick[0] !== 0 && g.pattern.tracks.kick[16] !== 0, 'both bar downbeats');
    ok(validPattern32(g.pattern), 'structure valid at 32');

    // codec roundtrip at 32
    const st = T.defaultState();
    st.steps = 32;
    st.patterns = st.patterns.map((p) => T.emptyPattern ? p : p);   // keep 16-len; normalize will pad
    ctx.PG.state = st;
    const code = T.UI.encodeShare();
    const back = T.UI.decodeShare(code);
    ok(back.steps === 32, 'steps survive the link');
    ok(back.patterns[0].tracks.kick.length === 32, 'decoded lanes are 32');
    eq(back.patterns[0].tracks.kick.slice(0, 16), st.patterns[0].tracks.kick, 'first 16 preserved');

    // legacy 16 link decodes at 16
    const legacy = T.Generator.generate('techno', 0.6, 5);
    const st2 = T.defaultState();
    st2.patterns[0] = legacy.pattern;
    ctx.PG.state = st2;
    const back2 = T.UI.decodeShare(T.UI.encodeShare());
    ok(back2.steps === 16 && back2.patterns[0].tracks.kick.length === 16, '16 stays 16');

    // normalize pads to 32 and truncates to 16
    const padded = T.UI.normalizeState({ steps: 32, patterns: [legacy.pattern, null, null, null] });
    ok(padded.steps === 32 && padded.patterns[0].tracks.kick.length === 32, '16 content padded to 32');
    ok(padded.patterns[0].tracks.kick[20] === 0, 'padded with rests');
    const cut = T.UI.normalizeState({ steps: 16, patterns: [g.pattern, null, null, null] });
    ok(cut.patterns[0].tracks.kick.length === 16, '32 content truncated to 16');

    // euclid at 32
    const e = T.Generator.euclidFill(9, 32);
    ok(e.lane.length === 32, 'euclid lane matches length');
    ok(e.lane.filter((v) => v > 0).length === e.k, 'pulses conserved at 32');

    function validPattern32(p) {
      return T.TRACKS.every((t) => p.tracks[t.id].length === 32) &&
        p.tracks.bass.length === 32 && p.tracks.lead.length === 32;
    }
  });

  await test('sequencer.currentStep: audible-step math', () => {
    vm.runInContext('globalThis.Seq = Sequencer;', ctx);
    const seq = new ctx.Seq();
    seq.engine = { ctx: { currentTime: 10 } };
    ctx.PG.state = Object.assign(ctx.PG.state, { bpm: 120, steps: 16 });
    // bpm 120 -> stepDur 0.125s
    seq.step = 4; seq.nextTime = 10 + 0.25;
    eq(seq.currentStep(10 + 0.24), 3, 'just before the next boundary -> step-1');
    eq(seq.currentStep(10 + 0.13), 3, 'inside the 3rd step window');
    eq(seq.currentStep(10 + 0.25), 4, 'exactly on the boundary -> next step');
    // wrap-around
    seq.step = 0; seq.nextTime = 10 + 0.1;
    eq(seq.currentStep(10 + 0.02), 15, 'wrap: one before step 0');
    // 32 steps
    ctx.PG.state.steps = 32;
    seq.step = 17; seq.nextTime = 10 + 0.2;
    eq(seq.currentStep(10 + 0.05), 15, '32-lane math (1.2 steps ahead -> step-2)');
    // deep lookahead (background tab) still lands on the audible step
    ctx.PG.state.steps = 16;
    seq.step = 6; seq.nextTime = 10 + 0.25;   // scheduler ran 2 steps ahead
    eq(seq.currentStep(10 + 0.05), 4, 'lookahead 2 steps -> audible is step-2');
  });

  await test('lead keys: cover C4..C5, sharps via +1, no drum overlap', () => {
    const whites = Object.values(T.LEAD_KEYS);
    ok(whites.includes(60) && whites.includes(72), 'range endpoints present');
    for (const m of whites) ok(m >= 60 && m <= 72, 'in lead range');
    // sharps = white + 1 for the five holders
    const sharps = ['KeyQ', 'KeyW', 'KeyR', 'KeyT', 'KeyY'].map((k) => T.LEAD_KEYS[k] + 1).sort();
    eq(sharps, [61, 63, 66, 68, 70], 'shift row covers the five black keys');
    ok(!Object.keys(T.LEAD_KEYS).some((k) => k.startsWith('KeyA') || k.startsWith('KeyS') ||
      k.startsWith('KeyD') || k.startsWith('KeyF') || k.startsWith('KeyG') ||
      k.startsWith('KeyH') || k.startsWith('KeyJ') || k.startsWith('KeyK')), 'no drum-pad overlap');
  });

  await test('midi export: song reps expand the chain', async () => {
    const p = T.emptyPattern();
    p.tracks.kick[0] = 1;                                  // 1 note per bar
    const st = T.defaultState();
    st.patterns = [p, T.emptyPattern(), T.emptyPattern(), T.emptyPattern()];
    st.song = { enabled: true, chain: [0, 0], reps: [2, 1] };   // A A A → 3 bars
    const r = T.MidiExport.export(st);
    eq(r.bars, 3, 'reps expand the chain');
    eq(r.notes, 3, 'one kick per expanded bar');
    // share codec carries reps
    ctx.PG.state = st;
    const back = T.UI.decodeShare(T.UI.encodeShare());
    eq(back.song.reps, [2, 1], 'reps survive the link');
    const legacy = T.UI.normalizeState({ song: { chain: [0, 1] } });
    eq(legacy.song.reps, [1, 1], 'normalize backfills reps');
  });

  await test('demo song: valid patterns, song chain, normalization-stable', () => {
    const st = T.demoState();
    ok(st.song.enabled && st.song.chain.length === 8, 'demo song chain of 8 bars');
    ok(st.song.chain.every((v) => v >= 0 && v <= 3), 'chain in range');
    ok(st.song.reps.every((r) => r >= 1 && r <= 8), 'reps sane');
    ok(st.patterns.length === 4 && st.patterns.every(validPattern), 'all 4 patterns valid');
    ok(st.bpm >= 60 && st.bpm <= 200, 'bpm sane');
    ok(st.fx.pump > 0 && st.fx.humanize > 0, 'demo uses the expressive FX');
    // normalization must not mangle it (roundtrip stability)
    const again = T.UI.normalizeState(JSON.parse(JSON.stringify(st)));
    eq(again.patterns, st.patterns, 'survives a save/load cycle unchanged');
    ok(again.song.enabled && again.song.chain.length === 8, 'song survives');
  });

  await test('engine sound table: all 10 voices, clamped, persists before ctx', () => {
    const eng = new T.AudioEngine();        // no ctx needed for the table
    const ids = Object.keys(eng.sound);
    eq(ids.length, 10, '10 voices in the sound table');
    for (const id of [...T.TRACKS.map((t) => t.id), 'bass', 'lead']) {
      ok(ids.includes(id), `${id} present`);
      eq(eng.sound[id], { tune: 1, decay: 1 }, `${id} defaults`);
    }
    eng.setSound('lead', { tune: 1.4, decay: 1.8 });
    eq(eng.sound.lead, { tune: 1.4, decay: 1.8 }, 'setSound stores');
    eng.setSound('lead', { tune: 99, decay: 0.01 });
    eq(eng.sound.lead, { tune: 2, decay: 0.4 }, 'clamped to ranges');
    eng.setSound('nope', { tune: 2 });      // unknown id — must not throw
  });

  await test('midi import: roundtrip of our own export', async () => {
    const st = T.defaultState();
    st.bpm = 120;
    const p = T.emptyPattern();
    p.tracks.kick[0] = 2;
    p.tracks.snare[8] = 1;
    p.tracks.bass[0] = { midi: 36, accent: true };
    p.tracks.bass[6] = { midi: 43, accent: false };
    p.tracks.lead[4] = { notes: [63, 66, 70], accent: false };
    st.patterns = [p, T.emptyPattern(), T.emptyPattern(), T.emptyPattern()];
    st.song = { enabled: true, chain: [0], reps: [1] };   // export exactly one bar
    const r = T.MidiExport.export(st);
    const buf = await r.blob.arrayBuffer();
    const m = T.MidiImport.parse(buf);
    eq(m.steps, 16, 'one bar stays 16');
    ok(m.bpm >= 119 && m.bpm <= 121, 'tempo recovered');
    eq(m.pattern.tracks.kick[0], 2, 'accented kick back as 2');
    eq(m.pattern.tracks.snare[8], 1, 'snare back as 1');
    eq(m.pattern.tracks.bass[0], { midi: 36, accent: true }, 'bass accent back');
    eq(m.pattern.tracks.bass[6], { midi: 43, accent: false }, 'bass note back');
    eq(m.pattern.tracks.lead[4], { notes: [63, 66, 70], accent: false }, 'chord back');
    // lanes we did not export are empty
    eq(m.pattern.tracks.ohat, new Array(16).fill(0), 'unexported lanes empty');

    // pattern-mode export repeats the bar: the import faithfully sees 2 bars
    st.song.enabled = false;
    const r2 = T.MidiExport.export(st);
    const m2 = T.MidiImport.parse(await r2.blob.arrayBuffer());
    eq(m2.steps, 32, 'pattern-mode export (2 loops) reads as 32');
    eq(m2.pattern.tracks.kick[16], 2, 'the repeat is preserved at step 16');
  });

  await test('midi import: two bars promote to 32 steps', async () => {
    const a = T.Generator.generate('house', 0.6, 3).pattern;
    const b = T.Generator.generate('techno', 0.6, 4).pattern;
    const st = T.defaultState();
    st.steps = 32;
    st.bpm = 128;
    st.patterns = [T.emptyPattern(32), T.emptyPattern(32), T.emptyPattern(32), T.emptyPattern(32)];
    st.patterns[0].tracks.kick = [...a.tracks.kick, ...b.tracks.kick];
    st.patterns[0].tracks.bass = [...a.tracks.bass, ...b.tracks.bass];
    st.song = { enabled: false, chain: [0, 1] };
    const r = T.MidiExport.export(st);       // pattern mode: 1 pattern x 2 loops = 4 bars!
    const buf = await r.blob.arrayBuffer();
    const m = T.MidiImport.parse(buf);
    ok(m.bars === 4 || m.bars === 2, 'bars detected from content');
    eq(m.steps, 32, 'multi-bar content promotes to 32');
    ok(m.pattern.tracks.kick[0] !== 0, 'first downbeat present');
  });

  await test('midi import: pitched-channel fallback for DAW files', async () => {
    // hand-built format-0: bass on ch3 (low), melody on ch5 (high), drums ch9
    const ev = [];
    const ppq = 480;
    const push = (tick, bytes) => ev.push({ tick, bytes });
    // tempo 500000 = 120bpm
    push(0, [0xff, 0x51, 0x03, 0x07, 0xa1, 0x20]);
    // ch3 bass C2 at step0; ch5 melody E4 at step2; drum 36 at step0 ch9
    push(0, [0x92, 36, 100]);
    push(0, [0x83, 36, 0]);                  // note-off ch3 (0x83) same tick pair below
    push(0, [0x93, 36, 100]);
    push(960, [0x83, 36, 0]);
    push(960, [0x95, 64, 90]);
    push(1440, [0x85, 64, 0]);
    push(0, [0x99, 36, 100]);
    push(120, [0x89, 36, 0]);
    // assemble format 0
    ev.sort((a, b) => a.tick - b.tick);
    const body = [];
    let last = 0;
    const vlq = (n) => { const out = [n & 0x7f]; n = Math.floor(n / 128); while (n > 0) { out.unshift((n & 0x7f) | 0x80); n = Math.floor(n / 128); } return out; };
    for (const e of ev) { body.push(...vlq(e.tick - last), ...e.bytes); last = e.tick; }
    body.push(0, 0xff, 0x2f, 0x00);
    const head = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 255, ppq & 255];
    const trk = [0x4d, 0x54, 0x72, 0x6b, (body.length >>> 24) & 255, (body.length >>> 16) & 255, (body.length >>> 8) & 255, body.length & 255];
    const blob = new ctx.Blob([new Uint8Array([...head, ...trk, ...body])]);
    const buf = await blob.arrayBuffer();
    const m = T.MidiImport.parse(buf);
    eq(m.bpm, 120, 'tempo read');
    ok(m.pattern.tracks.bass[0] && m.pattern.tracks.bass[0].midi === 36, 'low channel became bass');
    const lead = m.pattern.tracks.lead[8];   // E4 at tick 960 = step 8
    ok(lead && lead.notes[0] === 64, 'high channel became lead');
  });

  await test('midi import: garbage throws a clean error', async () => {
    let msg = null;
    try { T.MidiImport.parse(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])); }
    catch (e) { msg = e.message; }
    ok(/not a MIDI file/.test(msg || ''), 'throws not-a-MIDI');
  });

  await test('rotated: lane math right/left/wrap, objects move intact', () => {
    eq(T.rotated([1, 0, 0, 0], 1), [0, 1, 0, 0], 'right by 1');
    eq(T.rotated([1, 0, 0, 0], -1), [0, 0, 0, 1], 'left by 1 wraps');
    eq(T.rotated([1, 2, 3, 4], 4), [1, 2, 3, 4], 'full rotation identity');
    eq(T.rotated([1, 0, 0, 0], 5), [0, 1, 0, 0], 'shift mod length');
    eq(T.rotated([0, 0], 7), [0, 0], 'degenerate lane');
    const note = { notes: [60], accent: true };
    const out = T.rotated([note, null, null, null], 2);
    eq(out[2], note, 'the same object moves with its step');
  });

  await test('offline render guard: clean error without OfflineAudioContext', async () => {
    let threw = null;
    try { await T.RenderWav.render(T.defaultState()); } catch (e) { threw = e.message; }
    ok(/OfflineAudioContext/.test(threw || ''), `expected unsupported-context error, got: ${threw}`);
  });

  /* ---------- summary ---------- */

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  if (failed) {
    for (const f of failures) console.log(`FAILED: ${f.name} — ${f.error.message}`);
    process.exit(1);
  }
};

run();
