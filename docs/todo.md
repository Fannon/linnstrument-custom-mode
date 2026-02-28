## TODO

### Fixes (Highest Priority)

- [ ] Re-apply LinnStrument standard no-overlap layout on `Reset Defaults` (same NRPN sequence used at startup and restore).  
  Reason: `bun run test:e2e` currently has one failing spec for this reset behavior.
- [ ] Harden log rendering in `web/src/log.js` by replacing `innerHTML` string interpolation with safe DOM text nodes.  
  Reason: external/device-provided strings (for example MIDI port names) should not be inserted as raw HTML.
- [ ] Decide lockfile policy and enforce it (`bun.lock` only vs intentionally keeping `package-lock.json` too).

### Reliability & Dev-Ex Improvements

- [ ] Add Playwright e2e to CI (full run or nightly job) so regressions are caught before merge.
- [ ] Add a focused test for reset/restore side effects on NRPN calls and local config state.
- [ ] Break up `web/src/main.js` into smaller modules (`midi-io`, `routing`, `ui-state`, `instrument-sync`) to reduce regression risk.
- [ ] Add lint/format checks (Biome or ESLint/Prettier) and run them in CI.
- [ ] Add runtime guardrails for missing MIDI ports and recover cleanly from hot-plug disconnect/reconnect.

### Next Features

- [ ] Add editable preset schema (instead of hardcoded presets only).
- [ ] Add preset import/export (JSON) with schema validation.
- [ ] Add explicit 200-pad LinnStrument support (layout templates + visual scaling).
- [ ] Add split-aware layouts and independent routing per side.
- [ ] Add deeper Midimech-inspired options (geometry variants, interval sets, duplicate-note control).
- [ ] Expand chord display options (show intervals/degree spelling alongside chord name).
