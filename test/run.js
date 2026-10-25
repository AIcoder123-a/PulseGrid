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
                 'render.js', 'midi.js', 'generator.js', 'ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}

// bridge context bindings (const/class live in the realm's lexical scope,
// not on the sandbox object) and give UI.* a PG.state to work with
vm.runInContext(`
  globalThis.PG = { state: defaultState() };
  globalThis.T = {
    STEPS, TRACKS, PRESETS, P, B, defaultState, emptyPattern, clonePattern,
    makeSoftClipCurve, encodeWav, RenderWav, Generator, euclid, MidiExport, UI,
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
    const windows = { house: [120, 130], hiphop: [84, 96], techno: [128, 140], breaks: [108, 120], trap: [130, 146], lofi: [72, 84] };
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
