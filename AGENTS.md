# Agent Guide

## Project Overview

This repo is a browser-based LinnStrument custom-mode prototype (Web MIDI) with preset-driven layouts and expressive routing.

## Canonical Agent Guide

- `AGENTS.md` is the canonical guide for agent behavior in this repo.

## Runtime and Tooling

- Static app served from `web/`.
- Web MIDI via `webmidi`.
- Bun-first workflow: `bun install`, `bun run start`, `bun run test`, `bun run build`, `bun run verify`.
- Frontend vendor assets are copied into `web/lib/` by `bin/updateLibs.js`.
- Keep `bun.lock` authoritative unless explicitly told otherwise.
- Do not add or commit `package-lock.json` unless explicitly requested.

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

When routing or protocol behavior is ambiguous, verify against firmware sources before inferring from app code:

- `tmp/linnstrument-firmware/user_firmware_mode.md`
- `tmp/linnstrument-firmware/midi.md`
- `tmp/linnstrument-firmware/ls_handleTouches.ino`
- `tmp/linnstrument-firmware/ls_midi.ino`
- `tmp/linnstrument-firmware/ls_settings.ino`
- `tmp/linnstrument-firmware/ls_noteTouchMapping.ino`
- `tmp/MIDI MPE Spec.md`

## Current Project State (Reviewed Feb 28, 2026)

- `bun run verify`: passing.
- `bun run test:e2e`: one failing spec (`e2e/web-surface.spec.js`) related to reset flow and startup-equivalent NRPN resend expectations.
- CI currently runs `bun run verify` but does not gate on Playwright e2e.

## Agent Guidance

- Focus edits in active app files under `web/` and tests under `test/` and `e2e/`.
- For MIDI protocol changes, validate behavior against `tmp/linnstrument-firmware/*.ino`.
- Keep `web/index.html` and `bin/updateLibs.js` aligned when frontend dependencies change.
- Avoid broad refactors unless they reduce risk in `web/src/main.js` and include test coverage.

## Verify Loop (Before Handoff)

1. `bun run test`
2. `bun run build`
3. `bun run verify`
4. `bun run test:e2e` when behavior, UI, or routing changes (currently not CI-gated)

## Priority Work

- Fix reset flow to resend LinnStrument no-overlap and MPE NRPN setup.
- Sanitize log rendering (`web/src/log.js`) to avoid HTML injection.
- Add e2e coverage to CI (full gate or scheduled run).
