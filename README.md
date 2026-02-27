# LinnStrument Custom Mode Prototype (Web MIDI)

Browser-based LinnStrument custom-mode prototype, inspired by the workflow of Novation Components.

The current prototype focuses on a single preset layout that turns the LinnStrument into a scale-constrained playing surface with on-device mode/key selection.

## Current Features

- Web app (static files, runs in a Web MIDI capable browser)
- Auto-detect LinnStrument MIDI input/output ports
- User-select one MIDI loop output port (prefers `loopMIDI Port` if available)
- Preconfigured `Scale Mode` layout:
  - Bottom row: modwheel (`CC1`) via pressure
  - Key selection row (`C`-`B`)
  - Mode selection row (major, minor, pentatonics, etc.)
  - Remaining rows play notes constrained to the selected scale
- Configurable note layout row offset (default `4`)
- Configurable horizontal slide pitch-bend scaling:
  - `1 pad = 0.5 semitones`
  - `1 pad = 1 semitone`
  - `1 pad = 2 semitones`
- Surface visualization in browser + optional pad coloring on the LinnStrument itself
- Firmware-mode-only routing (LinnStrument User Firmware mode)

## MIDI Routing Model (Prototype)

This prototype intentionally simplifies the setup compared to the old light-guide app:

- `1x` LinnStrument input
- `1x` LinnStrument output (for pad colors + sync)
- `1x` loop MIDI output (to DAW / synth / plugin host)

Best results currently come from LinnStrument **Channel Per Row** mode.

## Requirements

- A Web MIDI capable browser (Chrome / Edge)
- LinnStrument connected via USB MIDI
- Optional virtual MIDI loop device (for example `loopMIDI` on Windows)

## Dev Setup (Bun)

```bash
bun install
bun run start
```

Notes:
- Development is Bun-first. Use the Bun lockfile (`bun.lock`) and avoid reintroducing `package-lock.json`.
- `bun run start` runs `prestart`, which rebuilds `web/lib/*` from `node_modules`.
- The app is served from `./web` as static files.

Optional:
- `npm` can still run the scripts, but Bun is the expected dev tooling for this repo.

## Test & Verify (Bun)

```bash
bun run test
bun run build
# or both:
bun run verify
```

What this does:
- `bun run test`: Bun unit tests (`test/*.test.js`) + syntax checks for browser source files
- `bun run build`: refreshes `web/lib/*` from `node_modules`
- `bun run verify`: standard local pre-commit/pre-push loop (`test + build`)

CI and Pages builds use `bun install --frozen-lockfile`, so keep `bun.lock` committed when dependencies change.

## Project Docs

- Design / roadmap: `docs/custom-mode-web-app-design.md`
- LinnStrument MIDI reference used by this prototype: `tmp/midi.md`
- Agent-oriented project map / consistency notes: `AGENT.md`

## Current Limitations

- Prototype quality UI and preset system (not yet a full visual custom-mode editor)
- Expressive remapping is partial (pitch bend, poly aftertouch forwarding, modwheel row are implemented; Y-axis/timbre mapping is still pending)
- Most thoroughly tested with 128-pad LinnStrument assumptions

## Next Steps (Planned)

- Expand unit tests for full layout generation and routing edge cases
- Add Biome linting
- Add more presets and eventually a real layout editor
- Improve full expressive MPE-style remapping
