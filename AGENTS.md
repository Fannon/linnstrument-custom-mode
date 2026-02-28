# AGENTS.md

Codex CLI reads `AGENTS.md` by default. This file mirrors the project guidance in `AGENT.md`.

## Primary Guidance

- Treat `AGENT.md` as the canonical project guide and keep both files aligned.
- Prefer Bun tooling (`bun install`, `bun run test`, `bun run build`, `bun run verify`) and keep `bun.lock` authoritative unless explicitly asked otherwise.
- Do not add or commit `package-lock.json` unless explicitly requested.
- Focus edits in active app files under `web/` (`main.js`, `grid.js`, `layout-logic.js`, `core-logic.js`, `control-overlay.js`, `mpe-routing.js`, `mpe-voice-allocator.js`, `config.js`, `style.css`, `index.html`) plus tests in `test/` and `e2e/`.

## Protocol References (Local)

- `tmp/linnstrument-firmware/user_firmware_mode.md`
- `tmp/linnstrument-firmware/midi.md`
- `tmp/linnstrument-firmware/ls_handleTouches.ino`
- `tmp/linnstrument-firmware/ls_midi.ino`
- `tmp/linnstrument-firmware/ls_settings.ino`
- `tmp/linnstrument-firmware/ls_noteTouchMapping.ino`
- `tmp/MIDI MPE Spec.md`

When protocol behavior is ambiguous, verify against the firmware source (`.ino`) instead of inferring from app code.

## Current State Snapshot (Reviewed Feb 28, 2026)

- `bun run verify` is passing.
- `bun run test:e2e` currently has one failing reset-related spec (`e2e/web-surface.spec.js`).
- CI runs `bun run verify` but does not yet gate on e2e.
