# AGENT.md

## Purpose

This repository is now a **browser-based LinnStrument custom mode prototype** (Web MIDI), evolving from an older light-guide project.

The current app is preset-based and centered on a scale-constrained playing layout.

## Current Runtime

- Static web app served from `web/`
- Browser Web MIDI (`webmidi`)
- Bootstrap CSS/JS copied into `web/lib/` via `bin/updateLibs.sh`
- Bun-first dev workflow (`bun install`, `bun run start`)
- `bun run start` runs `prestart -> bun run build` first

## Core Files (Active)

- `web/index.html`: UI shell
- `web/css/style.css`: styles
- `web/src/main.js`: MIDI routing, UI wiring, pitch bend scaling, LinnStrument sync
- `web/src/grid.js`: visualization/grid rendering helpers
- `web/src/config.js`: persisted settings defaults
- `web/src/log.js`: UI log helper
- `docs/custom-mode-web-app-design.md`: design notes and roadmap
- `tmp/midi.md`: LinnStrument MIDI reference used for CC/NRPN behavior

## MIDI Assumptions

- Best behavior currently with LinnStrument **Channel Per Row** mode
- Uses LinnStrument custom cell colors via:
  - `CC20` column
  - `CC21` row
  - `CC22` color
- Sync reads selected NRPN values for row mode/order and layout mapping

## Current Status / Consistency

The project is mostly consistent with the new prototype direction:

- `README.md` documents the custom-mode prototype (not the old light-guide flow)
- `package.json` startup/build flow matches the static app setup
- Unused legacy recorder/statistics modules and `jzz-midi-smf` dependency were removed

## Guidance For Agents

- Default to editing the active files listed above.
- Prefer Bun tooling and `bun.lock`; do not reintroduce `package-lock.json` unless explicitly requested.
- Verify MIDI behavior changes against `tmp/midi.md` before changing routing/sync logic.
- Keep `web/index.html` and `bin/updateLibs.sh` aligned when changing frontend dependencies.
- Avoid reintroducing recorder/statistics/JZZ-SMF code unless explicitly requested.

## Verify Loop (Required)

Use this loop for code changes, especially MIDI mapping/layout changes:

1. `bun run test`
   - Runs Bun unit tests for extracted core mapping/theory logic
   - Runs syntax checks for browser source files (`web/src/*.js`)
2. `bun run build`
   - Rebuilds static browser dependencies into `web/lib/`
3. `bun run verify`
   - Convenience command for `test + build` (preferred before handoff)

Notes:
- CI (`.github/workflows/ci.yaml`) runs `bun install --frozen-lockfile` and `bun run verify`.
- Add tests in `test/*.test.js` when touching pure mapping/math logic; refactor from `web/src/main.js` into pure helpers first if needed.

## Good Next Refactors (If Requested)

- Expand pure layout/routing extraction from `web/src/main.js` for deeper unit testing
- Add Biome linting / formatting checks
- Expand tests for full layout generation (key row, mode row, octave pads, same-note highlighting rules)
- Add more presets / editable layout schema
