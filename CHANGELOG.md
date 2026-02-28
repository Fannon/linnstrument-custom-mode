# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- **B4:** Disabled `DEBUG_MIDI_FLOW` by default — verbose MIDI note logging no longer floods the user-facing log panel.
- **B5:** Removed redundant `extractRawTouchEvent` call in `handleNoteOff` — the outer `raw` variable is now reused instead of being re-declared.
- **B1:** Deduplicated `coordKey` helper — was independently defined in `grid.js`, `core-logic.js`, and `layout-logic.js`. Now lives in a shared `web/src/utils.js` module, imported everywhere.
- **B2:** Removed duplicate `NOTE_NAMES` array in `grid.js` — now imported from `core-logic.js`.

### Improved

- **R4:** Converted `getInstrumentColorForMeta` from an `if/if/if` chain (that re-evaluated every condition) to a `switch` statement for clarity and performance.
- **Q7:** Extracted magic accidental pitch-class array `[1, 3, 6, 8, 10]` into a named `ACCIDENTAL_PITCH_CLASSES` constant with a descriptive comment.
- **Q3:** Removed orphaned `"main": "index.js"` field from `package.json` (this is a browser app, not an npm package).

### Added

- `web/src/utils.js` — shared micro-helpers module (currently contains `coordKey`).
- `CHANGELOG.md` — this file.
