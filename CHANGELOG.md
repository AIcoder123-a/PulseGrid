# Changelog

All releases are zero-dependency, zero-build static sites. CI runs the unit
suite on Node 18/20/22; GitHub Pages deploys only after CI is green.

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
