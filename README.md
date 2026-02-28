# LinnStrument Custom Mode

> A browser-based custom-mode surface and MIDI router for the [LinnStrument](https://www.rogerlinndesign.com/linnstrument).
> Try it live at **[fannon.github.io/linnstrument-custom-mode](https://fannon.github.io/linnstrument-custom-mode/)**.

## What It Does

This app turns your browser into a MIDI controller surface for the LinnStrument. It:

- **Remaps** pads to a scale-aware layout (only "right" notes, no wrong ones).
- **Routes** note, pitch bend, pressure, and CC messages to a DAW via a virtual MIDI port.
- **Paints** the LinnStrument LEDs to match the on-screen layout.
- **Highlights** playback notes from your DAW back on the web grid (lightguide).

Two layout presets are included:
- **Scale Mode** — sequential scale degrees (like the LinnStrument's built-in scale mode, but fully configurable).
- **Midimech** — whole-tone columns with configurable row offset (inspired by [midimech](https://github.com/flipcoder/midimech)).

## Quick Start

### Requirements

- **Browser:** Chrome or Edge (Web MIDI support required).
- **Hardware:** LinnStrument (128 or 200) connected via USB.
- **Optional:** A virtual MIDI loopback port for DAW routing (e.g. [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) on Windows, or IAC on macOS).

### Run Locally

```bash
bun install
bun run start
```

Then open the URL shown by the dev server (usually `http://localhost:3000`).

### Connect Your Devices

In the **Connections** panel:

| Port | What to pick |
|---|---|
| **LinnStrument Input** | Your LinnStrument's MIDI input (auto-detected) |
| **LinnStrument Output** | Your LinnStrument's MIDI output (auto-detected) |
| **MIDI Loop Output** | Virtual MIDI port going into your DAW |
| **Lightguide Input** *(optional)* | MIDI input from your DAW for playback highlighting |

> **Tip:** Port selections are saved in your browser. Once you manually select a port, auto-detection is disabled until you click **Reset Defaults**.

## How to Play

### Bottom Row (always visible)

| Pad | Function |
|---|---|
| **Ctl** (bottom-left) | Tap to toggle control overlay; hold for momentary |
| **Pads 1–13** | Mod Wheel (CC1) — pressure-sensitive |
| **Oct−** / **Oct+** (last two) | Shift the output octave down/up |

### Control Overlay (rows 1–2, when active)

- **Row 1:** Select root note (C through B), toggle layout preset, toggle MPE mode.
- **Row 2:** Select scale/mode, toggle "All Notes" display.

### Playable Grid (rows above)

Play notes! Each pad sends a note to the loop output. The grid shows the current scale and highlights:
- 🟧 **Orange** = root note
- ⬜ **White** = scale note
- Greyed out = non-scale note (in Scale mode, these are skipped)

## Settings

### Advanced Settings Panel

| Setting | Default | Description |
|---|---|---|
| **Pitch Bend Range** | ±48 | Sent to both loop output (RPN 0, ch 1–16) and LinnStrument (NRPN 19 + 119) |
| **Horizontal Slide (Standard)** | 1 semitone/pad | Pitch bend scaling for Scale Mode layout |
| **Horizontal Slide (Mech)** | 2 semitones/pad | Pitch bend scaling for Midimech layout |
| **Scale/All Notes Row Offset** | 4 / 5 | How many scale degrees (or semitones) between rows |
| **LED Colors** | Configurable | Root, scale, non-scale, and mod-wheel colors on the LinnStrument |

### Reset & Restore

- **Reset Defaults** — clears all saved settings and restores factory defaults.
- **Restore** — re-sends the LinnStrument setup NRPNs without clearing your preferences.
- **All Notes Off** — panic button; sends CC 123 on all channels.

## MIDI Routing

```
LinnStrument ──► [App] ──► Loop Output (DAW)
                  │
                  ├──► LinnStrument Output (LEDs + NRPN config)
                  │
Lightguide Input ──► [App] ──► Web grid highlights
```

**MPE enabled (default):** Notes, pitch bend, pressure, and timbre follow per-note channels.  
**MPE disabled:** Everything routes to channel 1. Multi-note pitch bend is suppressed.

## Development

```bash
bun run lint          # Biome linter
bun run format:check  # Biome formatter check
bun run test          # Unit tests (Bun)
bun run build         # Copy vendor libs to web/lib/
bun run verify        # lint + test + build (pre-commit check)
bun run test:e2e      # Playwright end-to-end tests
bun run deploy        # Deploy to GitHub Pages
```

### Project Structure

```
web/
  index.html            # Single-page app
  css/style.css         # All styles
  src/
    main.js             # App entry point, MIDI handlers, UI binding
    config.js           # Config defaults, localStorage persistence
    core-logic.js       # Scale/mode math, chord detection, pitch bend
    grid.js             # Grid generation and DOM rendering
    layout-logic.js     # Preset/layout definitions, cell metadata
    control-overlay.js  # Overlay toggle state machine
    mpe-routing.js      # MPE channel routing logic
    mpe-voice-allocator.js  # Per-note channel allocation
    instrument-sync.js  # LinnStrument NRPN commands
    midi-io.js          # Port filtering, auto-detection, listener wiring
    routing.js          # Note key helpers, loop note tracking
    ui-state.js         # DOM value get/set helpers
  lib/                  # Vendor assets (generated by bin/updateLibs.js)
test/                   # Unit tests (Bun test runner)
e2e/                    # Playwright end-to-end tests
controller/             # Bitwig controller script (optional)
docs/
  todo.md               # Backlog and codebase review
  custom-mode-web-app-design.md  # Design notes
```

## Controller Script (Optional)

The `controller/` folder contains a Bitwig Studio controller script that:
- Passes LinnStrument input through without remapping.
- Sends selected-track playback notes back on MIDI Out for lightguide highlighting.

See [`controller/README.md`](controller/README.md) for installation instructions.

## References

- [LinnStrument firmware docs](tmp/linnstrument-firmware/midi.md) (local)
- [MIDI MPE specification](tmp/MIDI%20MPE%20Spec.md) (local)
- [Midimech](https://github.com/flipcoder/midimech) — inspiration for the Mech layout

## License

MIT — see [LICENSE](LICENSE).
