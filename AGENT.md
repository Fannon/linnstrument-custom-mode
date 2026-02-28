# AGENT.md

## Purpose

This repo is a browser-based LinnStrument custom-mode prototype (Web MIDI) with preset-driven layouts and expressive routing.

## Runtime and Tooling

- Static app from `web/`
- Web MIDI via `webmidi`
- Bun-first workflow (`bun install`, `bun run start`, `bun run verify`)
- Frontend vendor assets copied into `web/lib/` by `bin/updateLibs.js`

## Active Files

- `web/index.html`
- `web/css/style.css`
- `web/src/main.js`
- `web/src/grid.js`
- `web/src/layout-logic.js`
- `web/src/core-logic.js`
- `web/src/control-overlay.js`
- `web/src/mpe-routing.js`
- `web/src/mpe-voice-allocator.js`
- `web/src/config.js`
- `web/src/log.js`
- `test/*.test.js`
- `e2e/*.spec.js`
- `docs/todo.md`

## Protocol References (Use These First)

When routing/protocol behavior is unclear, verify against firmware sources before inferring from app code:

- `tmp/linnstrument-firmware/user_firmware_mode.md`
- `tmp/linnstrument-firmware/midi.md`
- `tmp/linnstrument-firmware/ls_handleTouches.ino`
- `tmp/linnstrument-firmware/ls_midi.ino`
- `tmp/linnstrument-firmware/ls_settings.ino`
- `tmp/linnstrument-firmware/ls_noteTouchMapping.ino`
- `tmp/MIDI MPE Spec.md`

## Current Project State (Reviewed Feb 28, 2026)

- `bun run verify`: passing
- `bun run test:e2e`: one failing spec
  - `e2e/web-surface.spec.js` reset flow expects startup-equivalent no-overlap/MPE NRPN resend
- CI currently runs only `bun run verify` (no Playwright e2e gate)

## Agent Guidance

- Treat this file as canonical and keep `AGENTS.md` aligned.
- Prefer Bun tooling and keep `bun.lock` authoritative unless explicitly told otherwise.
- Focus edits in active app files under `web/` and tests under `test/` / `e2e/`.
- For MIDI protocol changes, validate against `tmp/linnstrument-firmware/*.ino`.
- Keep `web/index.html` and `bin/updateLibs.js` aligned when frontend dependencies change.
- Avoid broad refactors unless they reduce risk in `web/src/main.js` and come with tests.

## Verify Loop (Required Before Handoff)

1. `bun run test`
2. `bun run build`
3. `bun run verify`
4. `bun run test:e2e` when behavior/UI/routing changes (currently not in CI gate)

## Priority Work

- Fix reset flow to resend LinnStrument no-overlap/MPE NRPN setup.
- Sanitize log rendering (`web/src/log.js`) to avoid HTML injection.
- Add e2e coverage to CI (full or scheduled).
