# LinnStrument Custom Mode Prototype (Web MIDI)

Browser-based LinnStrument custom-mode prototype.  
It turns LinnStrument into a preset-driven scale surface with live key/mode controls and MIDI routing to a loop/DAW output.

## Current State

- Active runtime is a static web app served from `web/` using Web MIDI (`webmidi`).
- Startup enforces a deterministic LinnStrument physical map (no-overlap notes `0..127`) and applies current MPE mode.
- Core unit/syntax/build checks are passing via `bun run verify`.
- One Playwright e2e test is currently failing around reset behavior (see `docs/todo.md`).

## Features

- Auto-detect LinnStrument input/output ports.
- Select loop output (and optional backchannel input for note-highlighting feedback).
- Two preset layouts:
  - `Scale Mode`
  - `Midimech` (whole-tone columns)
- Control overlay on bottom-left pad:
  - tap: latch overlay
  - hold: momentary overlay
- Bottom row behavior:
  - pads `1..13`: Modwheel (`CC1`) via pressure
  - last two pads: octave down/up
- On-device controls for key, scale mode, all-notes toggle, preset switch, and MPE toggle.
- Pitch-bend scaling options:
  - `1 pad = 0.5 semitones`
  - `1 pad = 1 semitone`
  - `1 pad = 2 semitones`
- Browser surface visualization plus optional LinnStrument LED painting (`CC20/21/22`).

## MIDI Routing Model

- `1x` LinnStrument MIDI input
- `1x` LinnStrument MIDI output (device config + LED painting)
- `1x` loop MIDI output (instrument/DAW target)
- Optional loop/backchannel MIDI input for pad highlight feedback

MPE enabled:
- note + bend + pressure/timbre follow per-note channels

MPE disabled:
- routed notes are forced to channel `1`
- non-MPE multi-note bend is suppressed to center

## Requirements

- Web MIDI capable browser (Chrome/Edge)
- LinnStrument over USB MIDI
- Optional virtual MIDI loop device (for example `loopMIDI` on Windows)

## Dev Setup

```bash
bun install
bun run start
```

Notes:
- Bun-first workflow; treat `bun.lock` as authoritative.
- `bun run start` triggers `prestart` and rebuilds `web/lib/*`.
- `bun run build` runs `bun ./bin/updateLibs.js` to refresh bundled frontend libs.

## Test & Verify

```bash
bun run test
bun run build
bun run verify
bun run test:e2e
bun run test:e2e:coverage
```

- `test`: unit tests + syntax checks
- `verify`: standard local gate (`test + build`)
- `test:e2e`: Playwright browser regression suite

## Known Issue

- `Reset Defaults` currently resets local config/UI but does not re-send the full LinnStrument no-overlap/MPE NRPN setup sequence that startup sends.
- Workaround: use `Restore LinnStrument` after reset.

## Project References

- Backlog / roadmap: `docs/todo.md`
- Design notes: `docs/custom-mode-web-app-design.md`
- LinnStrument protocol references:
  - `tmp/linnstrument-firmware/midi.md`
  - `tmp/linnstrument-firmware/user_firmware_mode.md`
  - `tmp/linnstrument-firmware/*.ino`
- Agent/project guidance: `AGENT.md` and `AGENTS.md`
