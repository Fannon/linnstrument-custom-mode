# TODO & Codebase Review

> **Last reviewed:** 2026-02-28  
> Items are sorted by priority within each section. Checked items `[x]` are done; unchecked `[ ]` are open.

---

## 🐛 Bugs & Correctness Issues

### B3 – `resendPitchBendRangeFromConfig` calls the wrapper without output

**File:** `web/src/main.js:1754–1755`

```js
await setLinnStrumentParamValue(NRPN.SPLIT_LEFT_BEND_RANGE, semitones);
await setLinnStrumentParamValue(NRPN.SPLIT_RIGHT_BEND_RANGE, semitones);
```

The local `setLinnStrumentParamValue` wrapper (`main.js:1967`) passes `ext.midi.instrumentOutput` to the core function. However, the guard `if (ext.midi.instrumentOutput)` on line 1752 means this is fine at runtime. The concern is cosmetic: these two calls use the un-prefixed name which shadows the import. This is fragile and confusing — if someone renames the wrapper they might accidentally call the core directly without an output argument.

**Fix:**  
Rename local wrapper to `setLinnStrumentParam` (drop "Value") so it doesn't shadow the import, or rename the import to `_setLinnStrumentParamValueCore`.

---

## 🏗️ Refactoring & Architecture

### R1 – `main.js` is still ~2,100 lines and growing

Despite extracting modules (`grid.js`, `config.js`, `core-logic.js`, etc.), `main.js` contains **all** MIDI message handling, UI binding, instrument painting, connection logic, and runtime state. This makes it very difficult to test and review.

**Suggested split (in order of impact):**

| New module | What moves | ~Lines |
|---|---|---|
| `midi-sender.js` | `sendLoopNoteOn`, `sendLoopNoteOff`, `sendLoopControlChange`, `sendLoopModWheel`, `sendLoopPolyAftertouch`, `sendLoopChannelAftertouch`, `sendLoopPitchBend14`, `sendRawToLoop`, `setLoopPitchBendRangeSemitones` | ~100 |
| `instrument-painting.js` | `paintInstrumentLayout`, `paintInstrumentCoord`, `highlightInstrumentXY`, `highlightInstrumentHardwareXY`, `getInstrumentColorForMeta`, `INSTRUMENT_COLORS` | ~100 |
| `note-handlers.js` | `handleNoteOn`, `handleNoteOff`, `handlePolyPressure`, `handleChannelAftertouch`, `handleControlChange`, `handlePitchBend` and their helpers | ~300 |
| `backchannel.js` | `handleBackchannelNoteOn/Off/CC`, `clearAllBackchannelHighlights`, `rehydrateBackchannelHighlights`, ref-counting helpers | ~120 |
| `ui-binding.js` | `bindUi`, `bindAutoApplyConfigFields`, `populatePresetSelect`, `populateStateSelectors`, `populateUiFromConfig`, `readConfigFromUi`, `updateStatusUi`, `updateRoutingStatus`, `updateChordStatusUi` | ~200 |

**How to pick this up:**
1. Start with the lowest-risk module (`midi-sender.js`): it's purely output, no state reads beyond `ext.midi.loopOutput`.
2. Each new module should accept `ext` (or sub-parts of it) via an init/factory function so it stays testable.
3. Add a unit test file for each extracted module.

### R2 – Color option `<select>` lists are duplicated ~5 times in HTML

**File:** `web/index.html:174–242`

The same 12-option color list is repeated for `colorModWheel`, `colorRootNote`, `colorScaleNote`, and `colorNonScaleNote`. This is ~240 lines of repeated HTML.

**Fix:**  
Generate color selects dynamically in JavaScript (like `populatePresetSelect` and `populateStateSelectors` already do), possibly using a shared `LINNSTRUMENT_COLORS` constant:

```js
const LINNSTRUMENT_COLORS = [
  { value: 0, label: "(none / off)" },
  { value: 1, label: "Red" },
  // ...
];
```

### R3 – `ext` global state object on `window`

**File:** `web/src/main.js:143`

`window.ext = ext;` exposes the entire app state globally. This is useful for debugging but risky in production (any script on the page can mutate it).

**Fix:**  
Gate this behind a debug flag:
```js
if (location.search.includes("debug")) { window.ext = ext; }
```

### R5 – `createSurfaceTouchEventFromCoord` uses incorrect grid mapping

**File:** `web/src/main.js:734`

```js
const columns = ext.config.linnStrumentSize / 8;
```

This division converts the 128-pad instrument to 16 columns. But the `noteIndex` calculation (`y * columns + x`) ignores `deviceColOffset` and `deviceRowOffset`. It works only because the standard layout uses `colOffset=1`, but it would break for any non-trivial offset configuration.

**Fix:**  
Use the actual `ext.grid[x][y]` note number from the precomputed grid instead of recalculating.

### R6 – E2E test helper code duplicated between spec files

**Files:** `e2e/web-surface.spec.js` and `e2e/main-coverage.spec.js`

Both files contain near-identical copies of: `createInput`, `createOutput`, `decode7BitPair`, `isNrpnRequest`, pointer helpers, and the full `WebMidi` stub setup in `beforeEach` / `addInitScript`.

**Fix:**  
Extract a shared test helper module:
- `e2e/helpers/midi-stub.js` – the WebMidi mock factory
- `e2e/helpers/pointer.js` – `pointerDownPad`, `pointerUpPad`, `tapPad`

---

## 🧹 Code Quality & DX

### Q1 – No `format:check` in `verify` script

**File:** `package.json:15`

The `verify` script runs `lint && test && build` but does not include `format:check`. The format check is a separate step in CI, but local `bun run verify` won't catch formatting issues.

**Fix:**
```json
"verify": "bun run lint && bun run format:check && bun run test && bun run build"
```

### Q2 – `playwright.config.js` uses `require()` while app code uses ESM

**File:** `playwright.config.js:1`

Playwright config uses CommonJS (`require`) yet all app source uses ESM. Playwright supports ESM configs.

**Fix (low priority):**  
Rename to `playwright.config.mjs` and convert to `import { defineConfig } from "@playwright/test"`.

### Q4 – `.gitignore` is a generic Node template with many unused entries

**File:** `.gitignore`

The file contains sections for Gatsby, Nuxt, Next.js, VuePress, Serverless, FuseBox, DynamoDB — none of which are used.

**Fix:**  
Trim to only the entries this project actually needs:
```
node_modules/
web/lib/
tmp/
test-results/
dist/
*.log
.env
coverage/
```

### Q5 – No JSDoc or type annotations for major public functions

Functions like `handleNoteOn`, `normalizeTouchEvent`, `buildLayoutDefinition`, and the entire `ext` shape have no documentation. This makes onboarding (human or agent) slower.

**Fix:**  
Add JSDoc comments to at least the exported functions in each module and to the `ext` object definition. Consider adding a `jsconfig.json` with `"checkJs": true` for basic type checking.

### Q6 – Missing test coverage for `routing.js`, `instrument-sync.js`, `midi-io.js`, `ui-state.js`

These modules have no dedicated unit tests. They are exercised indirectly through e2e, but unit tests would be faster and more targeted.

**Prioritize:**
1. `routing.js` – small, pure functions, easy to test
2. `instrument-sync.js` – NRPN construction can be validated
3. `midi-io.js` – port filtering logic

---

## ✅ Completed Items

- [x] Add lint/format checks (Biome) and run them in CI.
- [x] Add Playwright e2e to CI (full run or nightly job) so regressions are caught before merge.
- [x] Break up `web/src/main.js` into smaller modules (`midi-io`, `routing`, `ui-state`, `instrument-sync`) to reduce regression risk.
- [x] Add runtime guardrails for missing MIDI ports and recover cleanly from hot-plug disconnect/reconnect.
- [x] **B1** – Deduplicate `coordKey` — extracted to `web/src/utils.js`, imported everywhere.
- [x] **B2** – Deduplicate `NOTE_NAMES` in `grid.js` — now imported from `core-logic.js`.
- [x] **B4** – `DEBUG_MIDI_FLOW` defaulted to `false`.
- [x] **B5** – Remove redundant `const raw = extractRawTouchEvent(msg)` in `handleNoteOff`.
- [x] **R4** – Convert `getInstrumentColorForMeta` from if-chain to `switch` statement.
- [x] **Q3** – Remove meaningless `"main": "index.js"` from `package.json`.
- [x] **Q7** – Extract magic accidental pitch classes into named `ACCIDENTAL_PITCH_CLASSES` constant.

---

## 🚀 Feature Ideas (Backlog)

### F1 – LinnStrument NRPN profile validation on startup
- [ ] Add startup/runtime profile drift detection and guided auto-repair for LinnStrument NRPN state (user firmware mode, split, row offset, MPE mode) before routing notes.

### F2 – Cleanup/restore on exit
- [ ] Add an optional "restore previous device profile on exit/disconnect" flow to mirror Midimech's cleanup behavior when sessions end unexpectedly.

### F3 – External scale definitions
- [ ] Move scale/mode definitions to a data file (JSON/YAML) and support a larger catalog with duplicate-mode metadata (similar to `tmp/midimech/scales.yaml`).

### F4 – Output articulation shaping
- [ ] Add output articulation shaping controls (velocity curve + min/max velocity clamps) and tests for transformed note-on velocity behavior.

### F5 – Fuzzy MIDI port matching
- [ ] Improve MIDI port resilience: persist stable device identifiers and add fuzzy-name fallback matching for known loop/visualizer ports.

### F6 – Editable presets with schema validation
- [ ] Add editable preset schema (instead of hardcoded presets only).
- [ ] Add preset import/export (JSON) with schema validation.

### F7 – 200-pad LinnStrument support
- [ ] Add explicit 200-pad LinnStrument support (layout templates + visual scaling).

### F8 – Deeper Midimech options
- [ ] Add deeper Midimech-inspired options (geometry variants, interval sets, duplicate-note control).

### F9 – Chord display enhancements
- [ ] Expand chord display options (show intervals/degree spelling alongside chord name).

---

## 📋 How to Pick Up a TODO

1. **Read the item** — each bug/refactoring/feature has a description, affected files, and a suggested fix.
2. **Create a branch** — `git checkout -b fix/B1-coordkey-dedup` (use the item ID).
3. **Make the change** — follow the fix instructions. When extracting new modules, keep the same function signatures so existing callers don't break.
4. **Run `bun run verify`** — ensures lint, tests, and build all pass.
5. **Run `bun run test:e2e`** — if you changed any UI, routing, or MIDI behavior.
6. **Commit and PR** — reference the item ID in the commit message, e.g. `fix: deduplicate coordKey helper (B1)`.
