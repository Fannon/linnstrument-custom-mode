# AGENTS.md

Codex CLI reads `AGENTS.md` by default. This file mirrors the project guidance in `AGENT.md`.

## Primary Guidance

- Treat `AGENT.md` as the canonical project guide and keep both files aligned.
- Prefer Bun tooling (`bun install`, `bun run test`, `bun run build`, `bun run verify`) and keep `bun.lock` authoritative unless explicitly asked otherwise.
- Focus edits in active app files under `web/` (`main.js`, `grid.js`, `layout-logic.js`, `config.js`, `style.css`, `index.html`) plus tests in `test/`.

## Protocol References (Local)

- `tmp/linnstrument-firmware/user_firmware_mode.md`
- `tmp/linnstrument-firmware/midi.md`
- `tmp/linnstrument-firmware/ls_handleTouches.ino`
- `tmp/linnstrument-firmware/ls_midi.ino`
- `tmp/linnstrument-firmware/ls_settings.ino`
- `tmp/linnstrument-firmware/ls_noteTouchMapping.ino`
- `tmp/MIDI MPE Spec.md`

When protocol behavior is ambiguous, verify against the firmware source (`.ino`) instead of inferring from app code.
