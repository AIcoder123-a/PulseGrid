/* PulseGrid — vibe.js
 *
 * Heuristic "Prompt-to-Beat" engine. Pure, deterministic, zero-dependency,
 * zero-API. It reads a free-text vibe / scene description ("cyberpunk boss
 * fight", "rainy lofi study in tokyo", "90s underground acid warehouse") and
 * lexically scores it into a fully-specified, reproducible generator config.
 * No network, no ML runtime, no tokens — just keyword lexicons + a seeded RNG
 * fed into the existing rule-based Generator. Same prompt (+ optional seed)
 * always yields the same song, so it is trivially unit-testable.
 */

'use strict';

/* deterministic 32-bit string hash (FNV-1a) — the seed for the whole engine. */
function vibeHash(s) {
  let h = 0x811c9dc5;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* local seeded RNG (same algorithm as generator.js mulberry32, kept private so
 * vibe.js has no cross-file dependency). */
function vibeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* genre lexicon: every entry is a [style, regex, weight] triple. Each regex
 * that matches a vibe token casts its own weighted vote, so a prompt like
 * "energetic dnb chase" clearly outscores a single stray "neon". English +
 * Chinese tokens so bilingual prompts work. */
const VIBE_GENRE_TOKENS = [
  ['techno', /\bcyberpunk\b/i, 2],
  ['techno', /\bcyber\b/i, 1],
  ['techno', /\b(neon|synthwave|synth|outrun|vaporwave|retro[- ]?wave)\b/i, 2],
  ['techno', /\b(acid|warehouse|rave|techno|tb[- ]?303|303)\b/i, 2],
  ['house', /\b(house|garage|disco)\b/i, 1],
  ['hiphop', /\b(hip[-\s]?hop|boom[-\s]?bap|rnb|r&b)\b/i, 1],
  ['breaks', /\b(breaks|breakbeat|break)\b/i, 1],
  ['trap', /\b(trap|phonk)\b/i, 2],
  ['lofi', /\b(lo[-\s]?fi|chill|study|cozy|dusty|sleepy)\b/i, 2],
  ['dnb', /\bdnb\b/i, 2],
  ['dnb', /\bdrum ?and ?bass\b/i, 2],
  ['dnb', /\bjungle\b/i, 2],
  ['dnb', /\bchase\b/i, 2],
  ['dnb', /\benergetic\b/i, 2],
  ['dnb', /\brush\b/i, 2],
  ['reggaeton', /\b(reggaeton|reggaetón|dembow|latin|tropical)\b/i, 2],
  ['afro', /\b(afro|afrobeats?|african)\b/i, 2],
  // Chinese tokens
  ['techno', /(赛博朋克|赛博|霓虹|蒸汽波)/, 2],
  ['techno', /(酸性|锐舞|仓库)/, 2],
  ['hiphop', /(嘻哈|说唱)/, 2],
  ['trap', /(陷阱|蒸汽)/, 2],
  ['lofi', /(洛菲|低保真|下雨|慵懒|咖啡|睡前)/, 2],
  ['dnb', /(鼓打贝斯|追逐|高速|激烈)/, 2],
  ['reggaeton', /(雷鬼顿|拉丁|热带)/, 2],
  ['afro', /(非洲|阿非)/, 2],
];

/* per-style BPM windows (mirrors generator.js, lightly widened). */
const VIBE_BPM = {
  house: [118, 128], hiphop: [82, 98], techno: [126, 142], breaks: [106, 122],
  trap: [128, 152], lofi: [68, 90], dnb: [158, 178], reggaeton: [88, 104], afro: [102, 118],
  surprise: [72, 142],
};

/* mood lexicons — kept as readable regexes so they double as the "tags". */
const VIBE_DARK    = /\b(dark|underwater|rainy|raining|moody|evil|shadow|noir|late night|cold|deep|dungeon|boss|fight|war|sad|melancholy|depressed)\b|\b(mid)?night\b|(暗|雨|夜|阴|黑|战|悲|沉)/i;
const VIBE_BRIGHT  = /\b(bright|sunny|happy|cheerful|day|warm|gold|pop|uplifting|hope|summer|fun)\b|(明亮|阳光|快乐|开心|暖|夏日|欢)/i;
const VIBE_FAST    = /\b(fast|energetic|aggressive|intense|hype|rush|chase|run|workout|gym|hard|club)\b|(快|激烈|高速|冲刺|燃|夜店)/i;
const VIBE_SLOW    = /\b(slow|calm|relax|sleep|dreamy|soft|gentle|ambient|cozy)\b|(慢|平静|放松|梦|柔)/i;
const VIBE_DENSE   = /\b(dense|busy|complex|full|heavy|wall|maximal)\b|(密|繁|炸|满)/i;
const VIBE_SPARSE  = /\b(minimal|sparse|empty|bare|subtle|thin|spacey|pure)\b|(极简|素|空灵)/i;
const VIBE_PUMP    = /\b(pump|sidechain|edm|festival|drop|build|trance|club)\b|(泵|侧链|电音|_drop)/i;
const VIBE_GROOVE  = /\b(groove|funk|disco|dance|move|bounce|swung|swing)\b|(律动|放克|蹦|摇|摇摆)/i;
const VIBE_808     = /\b(808|sub|boomy|boombap)\b|(重低音|808)/i;

/* Frequencies of interest: low band drives the "kick-reactive" glow. */
function vibeLowEnergy(freq) {
  if (!freq) return 0;
  // first ~6% of bins ≈ sub/bass region
  let sum = 0, n = 0;
  const k = Math.max(1, Math.floor(freq.length * 0.06));
  for (let i = 0; i < k; i++) { sum += freq[i]; n++; }
  return n ? (sum / n) / 255 : 0;
}

/* ------------------------------------------------------------------ */

function vibeParse(prompt, opts) {
  opts = opts || {};
  const text = (prompt == null ? '' : String(prompt)).trim().toLowerCase();
  const seed = (opts.seed != null) ? (opts.seed >>> 0) : vibeHash(text);
  const rng = vibeRng(seed);

  // --- genre selection via per-token weighted voting ---
  const score = {};
  for (const [style, re, w] of VIBE_GENRE_TOKENS) {
    if (re.test(text)) score[style] = (score[style] || 0) + w;
  }
  let style = 'surprise', best = 0;
  for (const k in score) if (score[k] > best) { best = score[k]; style = k; }
  if (!best) {
    // no explicit genre: infer one from tempo/mood so the output is still musical
    if (VIBE_FAST.test(text)) style = 'dnb';
    else if (VIBE_SLOW.test(text) || VIBE_DARK.test(text)) style = 'lofi';
    else if (VIBE_GROOVE.test(text)) style = 'house';
    else style = ['house', 'techno', 'lofi', 'dnb', 'afro'][Math.floor(rng() * 5)];
  }

  // --- tempo ---
  const win = VIBE_BPM[style] || VIBE_BPM.surprise;
  let bpm = Math.round(win[0] + rng() * (win[1] - win[0]));
  const m = text.match(/(\d{2,3})\s*bpm/i);
  if (m) bpm = Math.max(60, Math.min(200, parseInt(m[1], 10)));
  if (VIBE_FAST.test(text)) bpm = Math.min(200, Math.round(bpm * 1.18));
  else if (VIBE_SLOW.test(text)) bpm = Math.max(60, Math.round(bpm * 0.82));

  // --- swing (kept within the generator's 0..0.4 range) ---
  let swing = 0.08 + rng() * 0.12;
  if (VIBE_SLOW.test(text) || VIBE_DARK.test(text)) swing = 0.22 + rng() * 0.14;
  else if (VIBE_FAST.test(text)) swing = rng() * 0.06;

  // --- density ---
  let density = 0.5 + rng() * 0.12;
  if (VIBE_DENSE.test(text)) density = 0.72 + rng() * 0.2;
  else if (VIBE_SPARSE.test(text)) density = 0.25 + rng() * 0.12;

  // --- brightness / filter cut-off + reverb ---
  // filterFrac is a position 0..1 on the 20Hz..18kHz slider curve.
  let filterFrac = 0.9 + rng() * 0.08;
  let reverb = 0.12 + rng() * 0.08;
  let mood = 'balanced';
  if (VIBE_DARK.test(text) && !VIBE_BRIGHT.test(text)) {
    filterFrac = 0.2 + rng() * 0.18; reverb = 0.42 + rng() * 0.2; mood = 'dark';
  } else if (VIBE_BRIGHT.test(text)) {
    filterFrac = 0.97; reverb = 0.06 + rng() * 0.08; mood = 'bright';
  } else if (VIBE_SPARSE.test(text)) {
    mood = 'minimal';
  } else if (VIBE_FAST.test(text)) {
    mood = 'energetic';
  } else if (VIBE_SLOW.test(text)) {
    mood = 'chill';
  }
  const filterHz = Math.round(20 * Math.pow(900, filterFrac)); // sliderToHz: 20*(18000/20)^(v/100)

  // --- pump (sidechain) & humanize ---
  let pump = 0.25 + rng() * 0.2;
  if (VIBE_PUMP.test(text)) pump = 0.6 + rng() * 0.25;
  let humanize = 0.1 + rng() * 0.15;
  if (VIBE_GROOVE.test(text)) humanize = 0.2 + rng() * 0.15;

  // --- sound design (drum tuning) ---
  const sound = {};
  if (VIBE_808.test(text)) { sound.kick = { tune: 0.85, decay: 1.35 }; }
  else if (VIBE_BRIGHT.test(text)) { sound.chat = { tune: 1.12, decay: 0.9 }; }

  // --- tags for the UI status line ---
  const tags = [];
  if (VIBE_DARK.test(text)) tags.push('dark');
  if (VIBE_BRIGHT.test(text)) tags.push('bright');
  if (VIBE_FAST.test(text)) tags.push('energetic');
  if (VIBE_SLOW.test(text)) tags.push('chill');
  if (VIBE_DENSE.test(text)) tags.push('dense');
  if (VIBE_SPARSE.test(text)) tags.push('minimal');
  if (VIBE_PUMP.test(text)) tags.push('sidechain');
  if (VIBE_GROOVE.test(text)) tags.push('groove');

  return {
    seed, style, bpm, swing, density,
    filterFrac, filterHz, reverb, pump, humanize,
    mood, tags, sound, prompt: text,
  };
}

function vibeGenerate(prompt, opts) {
  opts = opts || {};
  const cfg = vibeParse(prompt, opts);
  const steps = opts.steps || 16;
  const g = Generator.generate(cfg.style, cfg.density, cfg.seed, steps);
  const fx = Object.assign({}, g.fx || {});
  fx.filter = cfg.filterHz;
  fx.reverb = cfg.reverb;
  fx.pump = cfg.pump;
  fx.humanize = cfg.humanize;
  return { pattern: g.pattern, bpm: cfg.bpm, swing: cfg.swing, fx, cfg };
}

const Vibe = {
  parse: vibeParse,
  generate: vibeGenerate,
  hash: vibeHash,
  lowEnergy: vibeLowEnergy,
};
