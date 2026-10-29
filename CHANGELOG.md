# Changelog

All releases are zero-dependency, zero-build static sites. CI runs the unit
suite on Node 18/20/22; GitHub Pages deploys only after CI is green.

## v1.9.0 — 2026-10-29

Minor release: a one-click way back to a known-good state.

### Added
- **`↺ Reset` button in the toolbar** — restores the first-visit demo project:
  BPM 122, the four-pattern demo arrangement, song mode on, default master FX
  and default per-track tune/decay. It is a genuine full reset, not a `Clear`:
  `Clear` only empties the active pattern, while `Reset` rebuilds everything,
  including the mixer lanes, the arrangement chain and the step count.
- **Two-step arming**, matching the existing `Clear` behaviour: click once and
  the label turns into `Sure?` for 2 seconds; click again to commit. A stray
  click cannot wipe a session.
- **Undoable** — the previous state is pushed onto the undo stack, so `Ctrl+Z`
  brings the old project back.

### Notes
- Reset also drops any `#p=...` share hash, otherwise a reload would silently
  restore the pre-reset song from the URL.
- If the project was 32 steps and the demo is 16, the grid is rebuilt rather
  than refreshed in place, so the cell count stays consistent.

### Tests
- New test `reset: demoState is a complete, audible starting point` asserts
  every persisted key exists, all four pattern slots are restored, song mode is
  on, the filter is audible (≥400 Hz) and `trackState` covers every voice.
  Suite now **43 passed**.

### Chores
- Service worker cache bumped to `pulsegrid-v33`.

## v1.8.4 — 2026-10-29

Patch release: repairs already-saved state, not just new prompts.

### Fixes
- **The app could boot up nearly silent.** v1.8.3 fixed the Vibe generator,
  but `localStorage` autosave had already persisted the broken `filter: 78`
  from an earlier dark-prompt session, so every later visit restored a
  78 Hz low-pass and the default groove appeared to have no sound. Restored
  saves with `fx.filter < 400` are now lifted to 600 Hz on boot. Values the
  user drags themselves are untouched, and share links stay byte-faithful.

### Tests
- No behaviour change for any preset (all ship 14 000–18 000 Hz). Suite
  still **42 passed**.

### Chores
- Service worker cache bumped to `pulsegrid-v32`.

## v1.8.3 — 2026-10-29

Patch release: fixes the Vibe generator muting the mix on dark prompts.

### Fixes
- **Dark / lo-fi prompts collapsed the master low-pass into near-silence.**
  The dark branch mapped its brightness to `0.20–0.38` on the slider curve,
  which is a **78–265 Hz** cut-off — high enough to mute almost the entire
  mix. A "midnight lo-fi / raining" capsule landed on 78 Hz, so the second
  preset sounded broken. The dark range is now `0.55–0.68` (≈840 Hz–2 kHz):
  audibly muffled, but every fundamental and the snare body still pass.
- **Added a hard floor** of 600 Hz to `filterHz`, so no future lexicon change
  can collapse the master filter into silence again.

### Tests
- New regression test `vibe: no prompt can collapse the master filter to
  silence` asserts every preset capsule stays above 600 Hz and that dark
  prompts stay below 4 kHz (muffled, not neutral). Suite now **42 passed**.

### Chores
- Service worker cache bumped to `pulsegrid-v31`.

## v1.8.2 — 2026-10-29

Patch release: bug fixes in the Sound Design panel.

### Fixes
- **Bass & Lead could not be auditioned** — the "Hear / 试听" button, the chip
  click and the tune/decay sliders were silent for the bass and lead voices
  because the preview path only routed drum triggers. Preview now plays a
  representative note (E2 bass / E4 lead).
- **Bass & Lead chips had no colour dot** — their chips were built without a
  colour, so the `--c` accent variable was undefined; they now use the same
  magenta / amber as their lanes.

### Chores
- Service worker cache bumped to `pulsegrid-v30`.

## v1.8.1 — 2026-10-29

Patch release: UI polish only, no functional changes.

### Fixes
- **Toolbar no longer jumps when switching EN ↔ 中文** — the language toggle,
  Copy and Clear buttons now keep a stable width, and mini buttons never wrap,
  so text-length differences between languages no longer nudge the layout.

### Chores
- Service worker cache bumped to `pulsegrid-v29` so installed / PWA users pick
  up the updated stylesheet.

## v1.8.0 — 2026-10-28 (Next Byte Hacks V5 hackathon build)

Feature release focused on hackathon-ready "wow" factor and a flagship
generative feature, while preserving the zero-dependency / zero-build / fully
offline contract and keeping the entire unit suite green.

### Features
- ✨ **Vibe Prompt-to-Beat generator** — type a free-text scene
  ("cyberpunk boss fight", "rainy lofi study in tokyo", "90s underground acid
  warehouse") and a heuristic engine deterministically maps it to a genre, BPM,
  swing, density, master-filter cut-off, reverb, sidechain pump and drum tuning,
  then renders a full pattern. Zero network, zero API, fully offline — same
  prompt (+ optional seed) always yields the same song. Bilingual EN/中文 UI, 4
  one-click preset capsules, and a live status read-out of the parsed BPM /
  style / mood.
- 🎛️ **Performance visualizer mode** — the canvas now has three switchable
  visuals (spectrum+waveform, beat-reactive **cyber grid** that breathes with
  the kick, and a scope / Lissajous), plus a full-screen **performance mode** (`V`
  key or the ⤢ button) that overlays the live step indicator, BPM and active
  pattern (A–D) for demo-screen recordings.

### Optimizations
- Vibe generator writes its inferred FX (filter / reverb / pump / humanize) and
  drum tuning straight onto the live engine and the on-screen sliders.

### Tests
- Added a dedicated Vibe test block (determinism, seed reproducibility, valid
  song invariants, genre/mood heuristics, explicit BPM parsing, bilingual
  prompts, graceful fallback on empty input).

## v1.7.0 — 2026-10-28

Builds on v1.6.0 with the features that have landed since, plus a PWA offline
bug fix and two usability optimizations. No breaking changes.

### Features (landed since v1.6.0)
- 🎼 **One-click full-song arrangement** — `🎼 Song` builds 4 patterns
  (verse / chorus / break / build) and an 8-bar chain, Song mode on.
- 🥁 **Three new generator styles** — DnB, Reggaeton, Afrobeat
  (now **ten** styles total).
- ⟲ / ⟳ **Pattern rotate** — whole-groove shift via the toolbar buttons or
  the `,` / `.` keys.
- **CNT metronome** — click track while playing; now also toggleable with `M`.
- **WAV export scope + rate** — render a single pattern or all, at 44.1k / 48k.
- **Column hover highlight** and **right-click lane clearing**; a
  **drag-insertion line** when reordering the song chain.

### Fixes
- **PWA / offline**: `js/i18n.js` was missing from the service worker's
  precache list, so after installing to the home screen the app broke offline
  (the language module failed to load). Added to the cache and bumped the
  cache version (`pulsegrid-v27`).

### Optimizations
- **WAV export now honors the metronome** — when the click is on, the rendered
  file carries the same count as live playback.
- **Metronome is keyboard-driven** (`M`), matching the rest of the transport
  controls.

## v1.6.0 — 2026-10-25

- Per-voice **sound design for bass & lead** (tune / decay knobs)
- **MIDI import** — SMF parser + grid mapping (DAW round-trip complete);
  drag-and-drop import for `.mid` / `.json`
- Song position counter; README demo link; overscroll fix

## v1.5.0 — 2026-10-25

- First-visit demo song, copy-to-slot, BPM-based WAV file names
- Lead keyboard recording and song-bar repeat counts
- Output meter with clip lamp; mobile tap fix; focus-ring polish
- Song-chip drag reorder and per-pattern content dots
- README asset refresh to match current UI + TAP pulse

## v1.4.0 — 2026-10-25

- **REC pad recording** — jam captures quantized straight into the pattern
- Keyboard shortcuts help overlay

## v1.3.0 — 2026-10-25

- **32-step patterns** (two-bar phrases) for longer grooves

## v1.2.0 — 2026-10-25

- Phone / mobile layout pass
- **Bilingual UI** (English / 简体中文)
- Chord mode: lead lane accepts minor triads
- Undo / redo and live drum pads
- Sidechain pump, humanize, Lo-fi style, euclidean fills
- Corrupted-save repair + legacy FX neutrality audit

## v1.1.0 — 2026-10-25

- **Lead synth** completes the drums + bass + lead trio
- **PWA**: installable app with full offline support
- Zero-dependency test suite + CI (Node 18/20/22)
- Trap generator style
