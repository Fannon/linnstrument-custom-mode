## TODO

### Fixes (Highest Priority)

- [x] Re-apply LinnStrument standard no-overlap layout on `Reset Defaults` (same NRPN sequence used at startup and restore).  
  Reason: `bun run test:e2e` currently has one failing spec for this reset behavior.
- [x] Harden log rendering in `web/src/log.js` by replacing `innerHTML` string interpolation with safe DOM text nodes.  
  Reason: external/device-provided strings (for example MIDI port names) should not be inserted as raw HTML.
- [x] Decide lockfile policy and enforce it (`bun.lock` only; `package-lock.json` removed from repo).

### Reliability & Dev-Ex Improvements

- [ ] Add lint/format checks (Biome or ESLint/Prettier) and run them in CI.
- [ ] Add Playwright e2e to CI (full run or nightly job) so regressions are caught before merge.
- [ ] Break up `web/src/main.js` into smaller modules (`midi-io`, `routing`, `ui-state`, `instrument-sync`) to reduce regression risk.
- [ ] Add runtime guardrails for missing MIDI ports and recover cleanly from hot-plug disconnect/reconnect.

### Midimech Comparison Follow-Ups

- [ ] Add startup/runtime profile drift detection and guided auto-repair for LinnStrument NRPN state (user firmware mode, split, row offset, MPE mode) before routing notes.
- [ ] Add an optional "restore previous device profile on exit/disconnect" flow to mirror Midimech's cleanup behavior when sessions end unexpectedly.
- [ ] Move scale/mode definitions to a data file (JSON/YAML) and support a larger catalog with duplicate-mode metadata (similar to `tmp/midimech/scales.yaml`).
- [ ] Add output articulation shaping controls (velocity curve + min/max velocity clamps) and tests for transformed note-on velocity behavior.
- [ ] Improve MIDI port resilience: persist stable device identifiers and add fuzzy-name fallback matching for known loop/visualizer ports.

### Next Features

- [ ] Add editable preset schema (instead of hardcoded presets only).
- [ ] Add preset import/export (JSON) with schema validation.
- [ ] Add explicit 200-pad LinnStrument support (layout templates + visual scaling).
- [ ] Add deeper Midimech-inspired options (geometry variants, interval sets, duplicate-note control).
- [ ] Expand chord display options (show intervals/degree spelling alongside chord name).
