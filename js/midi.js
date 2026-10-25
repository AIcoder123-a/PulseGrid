/* PulseGrid — midi.js
 *
 * Standard MIDI File (format 0) writer. Drums map to the GM percussion map on
 * channel 10, the mono bass exports chromatically on channel 1, the lead on
 * channel 2 — drop the .mid into any DAW and the beat is there.
 */

'use strict';

const MIDI_DRUM = {
  kick: 36, snare: 38, clap: 39, chat: 42, ohat: 46,
  tom: 41, cowbell: 56, shaker: 70,
};
const MIDI_PPQ = 480;
const TICK_16 = MIDI_PPQ / 4;   // 120 ticks per sixteenth

/** Variable-length quantity (MIDI delta times). */
function vlq(n) {
  const bytes = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return bytes;
}

const MidiExport = {
  /** Exports the song chain (song mode) or every non-empty pattern ×2 —
   *  the same sequencing rule as WAV export. */
  export(state) {
    const { pats, loops } = exportSequence(state);
    if (!pats.length) throw new Error('nothing to export');

    const len = state.steps || 16;   // steps per pattern
    const events = [];   // { tick, order, bytes }
    const push = (tick, order, bytes) => events.push({ tick, order, bytes });

    // tempo meta event
    const usPerQN = Math.round(60000000 / state.bpm);
    push(0, 0, [0xff, 0x51, 0x03, (usPerQN >> 16) & 255, (usPerQN >> 8) & 255, usPerQN & 255]);

    let barStart = 0;
    let notes = 0;
    for (const p of pats) {
      for (let l = 0; l < loops; l++) {
        for (let s = 0; s < len; s++) {
          const tick = barStart + s * TICK_16;
          for (const t of TRACKS) {
            const v = p.tracks[t.id][s];
            if (!v) continue;
            const note = MIDI_DRUM[t.id];
            const vel = v === 2 ? 110 : 88;
            push(tick, 1, [0x99, note, vel]);                 // note-on, channel 10
            push(tick + TICK_16 - 6, 2, [0x89, note, 0]);     // note-off
            notes++;
          }
          const bn = p.tracks.bass[s];
          if (bn) {
            const vel = bn.accent ? 112 : 90;
            push(tick, 1, [0x90, bn.midi, vel]);              // note-on, channel 1
            push(tick + TICK_16 - 6, 2, [0x80, bn.midi, 0]);
            notes++;
          }
          const ln = p.tracks.lead[s];
          if (ln && Array.isArray(ln.notes)) {
            const vel = ln.accent ? 112 : 90;
            for (const m of ln.notes) {
              push(tick, 1, [0x91, m, vel]);                  // note-on, channel 2
              push(tick + TICK_16 - 6, 2, [0x81, m, 0]);
              notes++;
            }
          }
        }
        barStart += len * TICK_16;
      }
    }
    push(barStart, 3, [0xff, 0x2f, 0x00]);                    // end of track

    events.sort((a, b) => a.tick - b.tick || a.order - b.order);

    const body = [];
    let last = 0;
    for (const e of events) {
      body.push(...vlq(e.tick - last), ...e.bytes);
      last = e.tick;
    }

    const header = [
      0x4d, 0x54, 0x68, 0x64,             // "MThd"
      0, 0, 0, 6,                          // header length
      0, 0,                                // format 0
      0, 1,                                // 1 track
      (MIDI_PPQ >> 8) & 255, MIDI_PPQ & 255,
    ];
    const track = [
      0x4d, 0x54, 0x72, 0x6b,             // "MTrk"
      (body.length >>> 24) & 255, (body.length >>> 16) & 255,
      (body.length >>> 8) & 255, body.length & 255,
    ];
    const file = new Uint8Array([...header, ...track, ...body]);
    return {
      blob: new Blob([file], { type: 'audio/midi' }),
      bars: pats.length * loops,
      notes,
      name: `pulsegrid-${state.bpm}bpm.mid`,
    };
  },
};

/* ============================ MIDI import ============================ */

/** GM percussion → lane, with the common aliases DAWs actually write. */
const DRUM_REVERSE = {
  35: 'kick', 36: 'kick',
  37: 'snare', 38: 'snare', 40: 'snare',
  39: 'clap',
  42: 'chat', 44: 'chat', 81: 'chat',
  46: 'ohat', 82: 'ohat',
  41: 'tom', 43: 'tom', 45: 'tom', 47: 'tom', 48: 'tom',
  56: 'cowbell',
  70: 'shaker', 82: 'shaker',
};

/** Move a pitched note into [lo, hi] by octaves. */
function octaveInto(m, lo, hi) {
  while (m > hi) m -= 12;
  while (m < lo) m += 12;
  return m;
}

const MidiImport = {
  /** Parse a Standard MIDI File into a PulseGrid pattern + transport state.
   *  Drums: channel 10 through the GM map. Pitched: channel 1 → bass and
   *  channel 2 → lead (our export convention); if the file has none, the
   *  lowest-average pitched channel becomes bass and the next lead, so real
   *  DAW exports land somewhere sensible. Content is quantized to 16ths;
   *  a second bar promotes the pattern to 32 steps; anything past 32 is dropped. */
  parse(buffer) {
    const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    const str4 = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
    const rd16 = (o) => (b[o] << 8) | b[o + 1];
    const rd32 = (o) => (b[o] << 24) * 1 + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

    if (b.length < 14 || str4(0) !== 'MThd') throw new Error('not a MIDI file');
    const ppq = rd16(12);
    if (!ppq || (ppq & 0x8000)) throw new Error('unsupported time division');

    // ---- collect note events across all tracks ----
    const raw = [];          // { ch, note, tick, vel, on }
    let bpm = null;
    let o = 14, tracksLeft = rd16(10);
    while (o + 8 <= b.length && tracksLeft > 0) {
      const len = rd32(o + 4);
      const end = o + 8 + len;
      if (str4(o) !== 'MTrk') { o = end; continue; }   // skip unknown chunk types
      let p = o + 8, tick = 0, status = 0;
      while (p < end) {
        let d = 0, c;
        do { c = b[p++]; d = (d << 7) | (c & 0x7f); } while (c & 0x80);
        tick += d;
        let st = b[p];
        if (st & 0x80) { p++; if (st < 0xf0) status = st; } else { st = status; }  // running status
        if (st === 0xff) {
          const type = b[p++];
          let mlen = 0;
          do { c = b[p++]; mlen = (mlen << 7) | (c & 0x7f); } while (c & 0x80);
          if (type === 0x51 && mlen === 3 && bpm == null) {
            bpm = Math.round(60000000 / ((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]));
          }
          p += mlen;
        } else if (st === 0xf0 || st === 0xf7) {
          let sl = 0;
          do { c = b[p++]; sl = (sl << 7) | (c & 0x7f); } while (c & 0x80);
          p += sl;
        } else {
          const hi = st & 0xf0, ch = st & 0x0f;
          if (hi === 0x90 || hi === 0x80) {
            const note = b[p], vel = b[p + 1];
            p += 2;
            raw.push({ ch, note, tick, vel: hi === 0x90 ? vel : 0, on: hi === 0x90 && vel > 0 });
          } else if (hi === 0xc0 || hi === 0xd0) p += 1;
          else p += 2;
        }
      }
      tracksLeft--;
      o = end;
    }

    // ---- pair note-ons with the earliest matching note-off ----
    raw.sort((a, b2) => a.tick - b2.tick);
    const open = {};
    const paired = [];
    let maxEnd = 0;
    for (const e of raw) {
      const key = e.ch * 200 + e.note;
      if (e.on) {
        (open[key] || (open[key] = [])).push(e);
      } else {
        const q = open[key];
        if (q && q.length) {
          const on = q.shift();
          paired.push({ ch: e.ch, note: e.note, tick: on.tick, vel: on.vel });
          maxEnd = Math.max(maxEnd, e.tick);
        }
      }
    }

    // ---- shape into the grid ----
    const bars = Math.max(1, Math.ceil(maxEnd / (ppq * 4)));
    const steps = bars > 1 ? 32 : 16;
    const stepTicks = ppq / 4;
    const pattern = emptyPattern(steps);
    let drumCount = 0;
    const pitched = [];      // { ch, midi, step, vel }

    for (const n of paired) {
      const step = Math.round(n.tick / stepTicks);
      if (step < 0 || step >= steps) continue;
      if (n.ch === 9) {
        const lane = DRUM_REVERSE[n.note];
        if (lane && !pattern.tracks[lane][step]) {
          pattern.tracks[lane][step] = n.vel >= 100 ? 2 : 1;
          drumCount++;
        }
      } else {
        pitched.push(n);
      }
    }

    // ---- bass / lead assignment (strict channels, then pitch-based fallback) ----
    let bassNotes = pitched.filter((n) => n.ch === 0);
    let leadNotes = pitched.filter((n) => n.ch === 1);
    if (!bassNotes.length) {
      const byCh = {};
      for (const n of pitched) (byCh[n.ch] || (byCh[n.ch] = [])).push(n);
      const chans = Object.keys(byCh).map(Number).sort((a, b2) =>
        byCh[a].reduce((s, n) => s + n.note, 0) / byCh[a].length -
        byCh[b2].reduce((s, n) => s + n.note, 0) / byCh[b2].length);
      if (chans.length) { bassNotes = byCh[chans[0]]; leadNotes = byCh[chans[1]] || []; }
    }

    let leadCount = 0;
    for (const n of bassNotes) {
      const step = Math.round(n.tick / stepTicks);
      if (step < 0 || step >= steps || pattern.tracks.bass[step]) continue;
      pattern.tracks.bass[step] = { midi: octaveInto(n.note, 36, 48), accent: n.vel >= 100 };
    }
    // group lead into chords by step (up to 3 notes)
    const leadByStep = {};
    for (const n of leadNotes) {
      const step = Math.round(n.tick / stepTicks);
      if (step < 0 || step >= steps) continue;
      (leadByStep[step] || (leadByStep[step] = [])).push(n);
    }
    for (const step of Object.keys(leadByStep)) {
      const group = leadByStep[step].sort((a, b2) => a.note - b2.note);
      const notes = [...new Set(group.map((n) => octaveInto(n.note, 60, 72)))].slice(0, 3);
      const accent = group.some((n) => n.vel >= 100);
      pattern.tracks.lead[+step] = { notes, accent };
      leadCount += notes.length;
    }

    if (!drumCount && !pitched.length) throw new Error('no notes found');

    return {
      pattern,
      steps,
      bpm: bpm && bpm >= 60 && bpm <= 208 ? bpm : null,
      notes: drumCount + pitched.length,
      bars,
    };
  },
};
