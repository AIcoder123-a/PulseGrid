/* PulseGrid — midi.js
 *
 * Standard MIDI File (format 0) writer. Drums map to the GM percussion map on
 * channel 10, the mono bass exports chromatically on channel 1 — drop the
 * .mid into any DAW and the beat is there.
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
    const song = state.song;
    let pats, loops;
    if (song && song.enabled && song.chain.length) {
      pats = song.chain.map((i) => state.patterns[i]);
      loops = 1;
    } else {
      pats = state.patterns.filter(hasContent);
      loops = 2;
    }
    if (!pats.length) throw new Error('nothing to export');

    const events = [];   // { tick, order, bytes }
    const push = (tick, order, bytes) => events.push({ tick, order, bytes });

    // tempo meta event
    const usPerQN = Math.round(60000000 / state.bpm);
    push(0, 0, [0xff, 0x51, 0x03, (usPerQN >> 16) & 255, (usPerQN >> 8) & 255, usPerQN & 255]);

    let barStart = 0;
    let notes = 0;
    for (const p of pats) {
      for (let l = 0; l < loops; l++) {
        for (let s = 0; s < STEPS; s++) {
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
        }
        barStart += STEPS * TICK_16;
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
