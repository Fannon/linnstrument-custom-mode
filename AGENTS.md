# Agent Guide

> This file is the canonical guide for AI agent behavior in this repository. Read this first before making changes.

## Project Overview

 A browser-based LinnStrument custom-mode app that:
- Intercepts LinnStrument pad touches via Web MIDI
- Remaps them through scale-aware preset layouts
- Routes expressive MIDI (MPE or single-channel) to a DAW via a loop output
- Paints LED colors on the physical LinnStrument surface

The app is a **static single-page app** served from `web/`. There is no build pipeline, bundler, or framework — just vanilla JavaScript modules loaded via `<script type="module">`.

## Toolchain

| Tool | Purpose |
|---|---|
| **Bun** | Package manager, test runner, script executor |
| **Biome** | Linter + formatter |
| **Playwright** | End-to-end browser tests |
| **Bootstrap 5** | UI framework (CSS + JS, vendored into `web/lib/`) |
| **WebMidi.js** | Web MIDI API wrapper (vendored into `web/lib/`) |

### Key Commands

```bash
bun install           # Install dependencies
bun run lint          # Lint check (Biome)
bun run format:check  # Format check (Biome)
bun run test          # Unit tests
bun run build         # Copy vendor libs → web/lib/
bun run verify        # lint + test + build (the pre-commit gate)
bun run test:e2e      # Playwright E2E tests
bun run start         # Dev server on localhost:3000
```

### Important Rules

- **Bun-first:** Use `bun` for everything. Keep `bun.lock` authoritative.
- **No `package-lock.json`:** Do not generate or commit it.
- **Vendor libs:** `web/lib/` is gitignored and rebuilt by `bin/updateLibs.js`. If you change frontend dependencies, update both `package.json` and `bin/updateLibs.js`.

## Source Files

### Core App (`web/src/`)

| File | Lines | Responsibility |
|---|---|---|
| `main.js` | ~2100 | Entry point, MIDI handlers, UI binding, instrument painting, connection management |
| `config.js` | ~60 | Default config, localStorage persistence |
| `core-logic.js` | ~270 | Scale/chord math, pitch bend, `coordKey`, `clampInt` |
| `grid.js` | ~210 | Grid generation, DOM rendering, surface patching |
| `layout-logic.js` | ~160 | Preset definitions, `buildLayoutDefinition` |
| `control-overlay.js` | ~100 | Overlay toggle state machine |
| `mpe-routing.js` | ~70 | MPE/single-channel routing decisions |
| `mpe-voice-allocator.js` | ~120 | Per-note channel allocation |
| `instrument-sync.js` | ~60 | NRPN commands to configure the LinnStrument |
| `midi-io.js` | ~110 | Port filtering, auto-detection, listener wiring |
| `routing.js` | ~70 | Note key helpers, loop note tracking |
| `ui-state.js` | ~60 | DOM `getValue`/`setValue`/`fillSelect` helpers |
| `colors.js` | ~70 | UI/Hardware color theme sync logic |
| `log.js` | ~50 | Logging utility for UI and console |
| `utils.js` | ~15 | Shared micro-helpers (debounce, `coordKey`) |

### Other Key Files

- `web/index.html` — single-page HTML (all UI structure)
- `web/css/style.css` — all styles
- `test/*.test.js` — Bun unit tests
- `e2e/*.spec.js` — Playwright E2E tests
- `docs/todo.md` — backlog and codebase review
- `controller/` — optional Bitwig controller script (not part of the web app)

## State Architecture

All runtime state lives in `ext` (exported from `main.js`, attached to `window.ext` for debugging):

```
ext.config       — persistent settings (selectedKey, presetId, mpeEnabled, port names, ...)
ext.grid         — 2D array of MIDI note numbers [x][y]
ext.gridDict     — reverse lookup: noteNumber → [[x,y], ...]
ext.layout       — { cellMeta, padMap, gridMappingSignature }
ext.midi         — { instrumentInput, instrumentOutput, loopOutput, loopInput }
ext.state        — { heldPads, routedNotesByPad, activeLoopNotes, controlOverlay, ... }
```

## Protocol References

When routing or MIDI protocol behavior is ambiguous, check these firmware docs before inferring from app code:

- [LinnStrument Firmware Documentation (GitHub)](https://github.com/rogerlinndesign/linnstrument-firmware)
- [MIDI MPE Specification (midi.org)](https://midi.org/mpe-midi-polyphonic-expression)

## Current Project State (Feb 2026)

- ✅ `bun run verify` — passing (lint + 49 unit tests + build)
- ✅ `bun run test:e2e` — passing (`e2e/web-basic.spec.js`, browser-only, no LinnStrument required)
- ✅ CI runs both `verify` and `e2e` jobs (separate, `e2e` depends on `verify`)
- ⚠️ `main.js` is still ~2,100 lines; see `docs/todo.md` for a concrete split plan

## Agent Guidelines

1. **Focus edits** in `web/src/` and `test/`/`e2e/`. Avoid touching `web/lib/` (it's generated).
2. **For MIDI protocol changes**, validate behavior against `tmp/linnstrument-firmware/*.ino` first.
3. **Avoid broad refactors** unless they follow the plan in `docs/todo.md` and come with test coverage.
4. **Keep `web/index.html` and `bin/updateLibs.js` in sync** when frontend dependencies change.
5. **Log changes** use `log.info/success/warn/error` from `web/src/log.js`. Do not use `innerHTML` for log messages (XSS risk — this was already fixed).

## E2E Test Scope (Required)

Playwright tests in `e2e/` must stay **browser-only** and must work with **no MIDI hardware connected**.

Write E2E tests for:
- App boot/render behavior (grid visible, controls present, status text).
- Basic UI workflows (selectors, mode toggles, overlay/pointer interactions).
- State persistence/reset behavior via localStorage and UI controls.
- Non-hardware UX regressions that a user can observe directly in the browser.

Do **not** write E2E tests for:
- LinnStrument hardware protocol validation (NRPN sequences, LED sync, device restore behavior).
- MIDI routing payload assertions (note/CC/aftertouch/pitch-bend bytes, channel allocation, MPE channel behavior).
- Tests that require specific physical/virtual MIDI ports to exist.
- Scenarios that depend on real-time instrument I/O, loopback ports, or WebMidi device enumeration quirks.

If behavior is MIDI/protocol-specific, cover it with unit tests in `test/*.test.js` using deterministic stubs/mocks.

## Verify Before Handoff

Always run this sequence before completing work:

```bash
bun run test        # Unit tests
bun run lint        # Lint
bun run build       # Vendor lib copy
bun run verify      # All of the above in one command
bun run test:e2e    # When you changed browser UI/user flows (no MIDI hardware required)
```

## Priority Work

See `docs/todo.md` for the full backlog. 
