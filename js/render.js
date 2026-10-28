/* PulseGrid — render.js
 *
 * Offline WAV export: renders the non-empty patterns through an
 * OfflineAudioContext using the very same AudioEngine code path that runs
 * live — identical synthesis, faster than real time, sample-exact.
 */

'use strict';

function hasContent(p) {
  return TRACKS.some((t) => p.tracks[t.id].some(Boolean)) || p.tracks.bass.some(Boolean);
}

/** Shared export sequencing: `only` (a pattern index) renders just that
 *  pattern ×2; otherwise the song chain when song mode is on (one loop per
 *  bar), else every non-empty pattern. Used by WAV and MIDI export. */
function exportSequence(state, patternLoops = 2, only) {
  if (only != null && state.patterns[only]) {
    return { pats: [state.patterns[only]], loops: 2 };
  }
  const song = state.song;
  if (song && song.enabled && song.chain.length) {
    const reps = song.reps || [];
    const pats = [];
    song.chain.forEach((i, slot) => {
      for (let r = 0; r < Math.max(1, reps[slot] || 1); r++) pats.push(state.patterns[i]);
    });
    return { pats, loops: 1 };
  }
  return { pats: state.patterns.filter(hasContent), loops: patternLoops };
}

/** 16-bit PCM stereo WAV encoder. */
function encodeWav(buffer) {
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const sr = buffer.sampleRate;
  const dataBytes = len * numCh * 2;
  const ab = new ArrayBuffer(44 + dataBytes);
  const dv = new DataView(ab);
  const wstr = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };

  wstr(0, 'RIFF'); dv.setUint32(4, 36 + dataBytes, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * numCh * 2, true); dv.setUint16(32, numCh * 2, true);
  dv.setUint16(34, 16, true);
  wstr(36, 'data'); dv.setUint32(40, dataBytes, true);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < numCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

const RenderWav = {
  /**
   * Render every non-empty pattern (in bank order), each looped `loops`
   * times, into a WAV blob. Throws if there is nothing to render.
   */
  async render(state, opts = {}) {
    if (!window.OfflineAudioContext) throw new Error('OfflineAudioContext unsupported');
    const loops = opts.loops ?? 2;
    const sr = opts.sampleRate ?? 44100;

    const { pats, loops: barsLoops } = exportSequence(state, loops, opts.only);
    if (!pats.length) throw new Error('nothing to render');

    const len = state.steps || 16;   // steps per pattern
    const stepDur = 60 / state.bpm / 4;
    const bars = pats.length * barsLoops;
    const tail = 2.5; // let delay/reverb ring out
    const total = pats.length * barsLoops * len * stepDur + tail;

    const off = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
    const eng = new AudioEngine();
    eng.attach(off);

    // exact parameter snapshot — direct writes, no ramps needed offline
    eng.masterGain.gain.value = state.masterVol;
    eng.masterFilter.frequency.value = state.fx.filter;
    eng.delayNode.delayTime.value = (60 / state.bpm) * 0.75;
    eng.delayBus.gain.value = state.fx.delay;
    eng.reverbBus.gain.value = state.fx.reverb;
    eng.pump = state.fx.pump || 0;
    eng.humanize = state.fx.humanize || 0;

    const anySolo = Object.values(state.trackState).some((t) => t.solo);
    for (const id of Object.keys(state.trackState)) {
      const ts = state.trackState[id];
      const strip = eng.tracks[id];
      if (!strip) continue;
      const eff = ts.mute ? 0 : (anySolo && !ts.solo) ? 0 : 1;
      strip.in.gain.value = strip.cfg.gain * ts.vol * eff;
      if (ts.tune != null || ts.decay != null) eng.setSound(id, ts);  // sound design travels with the render
    }

    // schedule with the same swing math as the live sequencer
    let t = 0.05;
    for (const p of pats) {
      for (let l = 0; l < barsLoops; l++) {
        for (let s = 0; s < len; s++) {
          const sw = s % 2 === 1 ? state.swing * stepDur * 0.5 : 0;
          eng.scheduleStep(p, s, t + sw, stepDur);
          if (state.click) eng.click(t + sw, s % 4 === 0);   // honor the metronome toggle, like live
          t += stepDur;
        }
      }
    }

    const buf = await off.startRendering();
    return { blob: encodeWav(buf), seconds: buf.duration, bars, bytes: 44 + buf.length * 4 };
  },
};
