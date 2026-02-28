# Agent Guide

> This file is the canonical guide for AI agent behavior in this repository. Read this first before making changes.

## Project Overview

A browser-based LinnStrument custom-mode prototype that:
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

- `tmp/linnstrument-firmware/user_firmware_mode.md`
- `tmp/linnstrument-firmware/midi.md`
- `tmp/linnstrument-firmware/ls_handleTouches.ino`
- `tmp/linnstrument-firmware/ls_midi.ino`
- `tmp/linnstrument-firmware/ls_settings.ino`
- `tmp/linnstrument-firmware/ls_noteTouchMapping.ino`
- `tmp/MIDI MPE Spec.md`

## Current Project State (Feb 2026)

- ✅ `bun run verify` — passing (lint + 49 unit tests + build)
- ⚠️ `bun run test:e2e` — one failing spec (`e2e/web-surface.spec.js`, related to reset flow NRPN resend expectations)
- ✅ CI runs both `verify` and `e2e` jobs (separate, `e2e` depends on `verify`)
- ⚠️ `main.js` is still ~2,100 lines; see `docs/todo.md` for a concrete split plan

## Agent Guidelines

1. **Focus edits** in `web/src/` and `test/`/`e2e/`. Avoid touching `web/lib/` (it's generated).
2. **For MIDI protocol changes**, validate behavior against `tmp/linnstrument-firmware/*.ino` first.
3. **Avoid broad refactors** unless they follow the plan in `docs/todo.md` and come with test coverage.
4. **Keep `web/index.html` and `bin/updateLibs.js` in sync** when frontend dependencies change.
5. **Log changes** use `log.info/success/warn/error` from `web/src/log.js`. Do not use `innerHTML` for log messages (XSS risk — this was already fixed).

## Verify Before Handoff

Always run this sequence before completing work:

```bash
bun run test        # Unit tests
bun run lint        # Lint
bun run build       # Vendor lib copy
bun run verify      # All of the above in one command
bun run test:e2e    # When you changed UI, routing, or MIDI behavior
```

## Priority Work

See `docs/todo.md` for the full backlog. Top priorities:

1. **B4** — Disable `DEBUG_MIDI_FLOW` by default (floods the user-facing log)
2. **R1** — Extract modules from `main.js` (start with `midi-sender.js`)
3. **B1** — Deduplicate `coordKey` across three files
4. **Q6** — Add unit tests for `routing.js`, `instrument-sync.js`, `midi-io.js`
