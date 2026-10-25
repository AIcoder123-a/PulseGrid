/* PulseGrid — i18n.js
 *
 * Zero-dependency bilingual UI (English / 简体中文). Static text is marked
 * with data-i18n in index.html and applied by applyStatic(); dynamic strings
 * (toasts, button states) go through t(). Genre names stay untranslated —
 * they are proper nouns in both languages.
 */

'use strict';

const STRINGS = {
  en: {
    tagline: 'web audio drum machine',
    play: 'Play', stop: 'Stop',
    swing: 'Swing', master: 'Master', preset: 'Preset', load: '— load —',
    copy: 'Copy→', clear: 'Clear', share: 'Share', export: 'Export', import: 'Import',
    langBtn: '中文',

    genTitle: 'Beat Generator',
    genHint: '— one click, a fresh groove (A = main · B = variation)',
    density: 'Density', generate: '🎲 Generate', mutate: '🧬 Mutate', euc: '◎ Euc',

    songTitle: 'Arrangement',
    songHint: '— song mode chains patterns bar by bar · click a slot to cycle A→B→C→D→remove',
    songOn: 'Song: ON', songOff: 'Song: OFF', addBar: '+ Bar', songReset: 'Reset',
    songEmpty: 'empty — hit “+ Bar”',

    drumsTitle: 'Drums',
    drumsHint: '— drag to paint · double-click = accent · right-click = clear accent',

    soundTitle: 'Sound Design',
    soundHint: '— per-track tune & decay · applies to live playback, WAV and share links',
    tune: 'Tune', decay: 'Decay', hear: '► Hear', reset: 'Reset',

    bassTitle: 'Bass Synth',
    bassHint: '— click: note → accent → off · one note per step',

    leadTitle: 'Lead Synth',
    leadHint: '— detuned saws + vibrato · C4–C5 melody lane',

    fxTitle: 'Master FX',
    fxHint: '— delay is tempo-synced (dotted 8th)',
    delay: 'Delay', reverb: 'Reverb', filter: 'Filter', pump: 'Pump', humanize: 'Humanize',

    footSpace: 'play / stop', footPat: 'switch pattern', footPads: 'drum pads',
    footUndo: 'undo / redo',

    // dynamic
    tNewGroove: 'New {style} groove — A main / B variation',
    tMutated: 'Pattern {p} mutated',
    tEuc: 'Euclid E({k},16) r{r} → {track}',
    tCleared: 'Pattern cleared',
    tCopied: 'Copied to pattern {p}',
    tPreset: 'Loaded preset: {name} — hit Play ▶',
    tShared: 'Loaded shared pattern — hit Play ▶',
    tImported: 'Pattern imported',
    tImportMid: 'MIDI imported: {notes} notes · {bars} bar(s) → pattern A',
    tImportFail: 'Import failed: not a PulseGrid file',
    tNothingExport: 'Nothing to export — all patterns are empty',
    tShareCopied: 'Share link copied to clipboard',
    tShareBar: 'Share link is in the address bar — copy it there',
    tUndo: 'Undo', tRedo: 'Redo', tNothingUndo: 'Nothing to undo', tNothingRedo: 'Nothing to redo',
    tSure: 'Sure?',
    tDemo: 'Demo arrangement loaded — hit Play ▶',
    tCopyTo: 'Copied A into {p}',
    tRecOn: 'REC on — pad & lead hits are written into the pattern',
    footLead: 'lead keys (Shift = sharp)',
    tRep: 'Bar repeats: ×{n}',
    tReordered: 'Arrangement reordered',
    tBarPos: 'Bar {cur}/{total}',
    tDropHint: 'Drop a .mid or .json file anywhere to load it',
    tRotated: 'Rotated by {n} step(s)',
    songGen: '🎼 Song',
    tSongGen: 'Arranged a {style} song — 8 bars, Song ON',
    tLaneCleared: 'Cleared {name}',
    tLaneClearHint: 'Right-click: clear this lane',
    footRotate: 'rotate pattern',
    footTap: 'tap tempo',
    tRecOff: 'REC off',
    helpTitle: 'Keyboard shortcuts', helpToggle: 'this help', helpEsc: 'close',
    helpRecTip: 'With ● REC on, pad hits while playing are quantized into the pattern.',
    tLen32: 'Pattern length: 32 steps (2 bars)', tLen16: 'Pattern length: 16 steps',
    tSongOn: 'Song mode on — the chain plays in order', tSongOff: 'Song mode off',
    tChordOn: 'Chord mode ON — clicks place minor triads', tChordOff: 'Chord mode off',
    tWav: 'Exported {s}s WAV · {bars} bars · {mb} MB',
    tMidi: 'Exported MIDI · {bars} bars · {notes} notes (drums ch10 / bass ch1 / lead ch2)',
  },
  zh: {
    tagline: '纯 Web Audio 鼓机',
    play: '播放', stop: '停止',
    swing: '摇摆', master: '主音量', preset: '预设', load: '— 载入 —',
    copy: '复制→', clear: '清空', share: '分享', export: '导出', import: '导入',
    langBtn: 'EN',

    genTitle: '节拍生成器',
    genHint: '— 一键生成全新 groove(A = 主节奏 · B = 变奏)',
    density: '密度', generate: '🎲 生成', mutate: '🧬 变异', euc: '◎ 欧氏',

    songTitle: '编排',
    songHint: '— Song 模式逐小节串联 Pattern · 点击槽位循环 A→B→C→D→移除',
    songOn: 'Song: 开', songOff: 'Song: 关', addBar: '+ 小节', songReset: '重置',
    songEmpty: '空 — 点“+ 小节”',

    drumsTitle: '鼓组',
    drumsHint: '— 拖拽绘制 · 双击 = 重音 · 右键 = 取消重音',

    soundTitle: '音色设计',
    soundHint: '— 每条轨道的音高与衰减 · 实时播放、WAV 与分享链接全部生效',
    tune: '音高', decay: '延音', hear: '► 试听', reset: '重置',

    bassTitle: '贝斯合成器',
    bassHint: '— 点击:音符 → 重音 → 关闭 · 每步一个音',

    leadTitle: '主奏合成器',
    leadHint: '— 失谐锯齿 + 颤音 · C4–C5 旋律轨',

    fxTitle: '主效果',
    fxHint: '— 延迟与速度同步(附点八分)',
    delay: '延迟', reverb: '混响', filter: '滤波', pump: '泵动', humanize: '人性化',

    footSpace: '播放 / 停止', footPat: '切换 Pattern', footPads: '键盘打鼓',
    footUndo: '撤销 / 重做',

    // dynamic
    tNewGroove: '新 {style} groove — A 主节奏 / B 变奏',
    tMutated: 'Pattern {p} 已变异',
    tEuc: '欧几里得 E({k},16) r{r} → {track}',
    tCleared: 'Pattern 已清空',
    tCopied: '已复制到 Pattern {p}',
    tPreset: '已载入预设:{name} — 按 ▶ 播放',
    tShared: '已载入分享的节奏 — 按 ▶ 播放',
    tImported: 'Pattern 已导入',
    tImportMid: 'MIDI 已导入:{notes} 个音符 · {bars} 小节 → Pattern A',
    tImportFail: '导入失败:不是 PulseGrid 文件',
    tNothingExport: '没有可导出内容 — 所有 Pattern 都是空的',
    tShareCopied: '分享链接已复制到剪贴板',
    tShareBar: '分享链接在地址栏里 — 去那里复制',
    tUndo: '已撤销', tRedo: '已重做', tNothingUndo: '没有可撤销的内容', tNothingRedo: '没有可重做的内容',
    tSure: '确定?',
    tDemo: '演示编曲已载入 — 按 ▶ 播放',
    tCopyTo: '已把 A 复制到 {p}',
    tRecOn: '录制开启 — 鼓垫与主奏击打会写入 Pattern',
    footLead: '主奏琴键(Shift = 升半音)',
    tRep: '小节重复:×{n}',
    tReordered: '编排已重排',
    tBarPos: '第 {cur}/{total} 小节',
    tDropHint: '把 .mid 或 .json 文件拖到页面任意位置即可载入',
    tRotated: '已旋转 {n} 步',
    songGen: '🎼 整曲',
    tSongGen: '已编排 {style} 整曲 — 8 小节,Song 开启',
    tLaneCleared: '已清空 {name}',
    tLaneClearHint: '右键清空该轨',
    footRotate: '旋转 Pattern',
    footTap: '打拍定速',
    tRecOff: '录制关闭',
    helpTitle: '键盘快捷键', helpToggle: '本帮助', helpEsc: '关闭',
    helpRecTip: '开启 ● 录制后,播放中的鼓垫击打会量化写入 Pattern。',
    tLen32: 'Pattern 长度:32 步(两小节)', tLen16: 'Pattern 长度:16 步',
    tSongOn: 'Song 模式开启 — 按顺序播放编排', tSongOff: 'Song 模式关闭',
    tChordOn: '和弦模式开启 — 点击放置小三和弦', tChordOff: '和弦模式关闭',
    tWav: '已导出 {s} 秒 WAV · {bars} 小节 · {mb} MB',
    tMidi: '已导出 MIDI · {bars} 小节 · {notes} 个音符(鼓 10 通道 / 贝斯 1 / 主奏 2)',
  },
};

const TRACK_NAMES = {
  en: { kick: 'Kick', snare: 'Snare', clap: 'Clap', chat: 'Hi-Hat', ohat: 'Open Hat',
        tom: 'Tom', cowbell: 'Cowbell', shaker: 'Shaker', bass: 'Bass', lead: 'Lead' },
  zh: { kick: '底鼓', snare: '军鼓', clap: '拍手', chat: '踩镲', ohat: '开镲',
        tom: '通鼓', cowbell: '牛铃', shaker: '沙锤', bass: '贝斯', lead: '主奏' },
};

let LANG = 'en';

function t(key, params) {
  let s = (STRINGS[LANG] && STRINGS[LANG][key]) || STRINGS.en[key] || key;
  if (params) {
    for (const k of Object.keys(params)) s = s.split('{' + k + '}').join(params[k]);
  }
  return s;
}

function trackName(id) {
  return (TRACK_NAMES[LANG] && TRACK_NAMES[LANG][id]) || TRACK_NAMES.en[id] || id;
}

/** Apply the current language to every [data-i18n] element in the document. */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    const txt = t(key);
    if (txt !== key) el.textContent = txt;
  });
  document.querySelectorAll('[data-track]').forEach((el) => {
    el.textContent = trackName(el.getAttribute('data-track'));
  });
}

function setLang(lang, persist = true) {
  LANG = STRINGS[lang] ? lang : 'en';
  if (persist) { try { localStorage.setItem('pulsegrid-lang', LANG); } catch (e) {} }
  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  applyStaticI18n();
}
