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

## v1.6.0 — 2026-10-24

- Lead synth (detuned saws + vibrato, C4–C5), per-voice sound design
  (tune / decay), MIDI import, PWA install, deploy gated on green CI, and the
  zero-dependency test suite + CI matrix.
