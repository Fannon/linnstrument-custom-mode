# LinnStrument Custom Mode Prototype (Web MIDI)

Browser-based LinnStrument custom-mode surface and MIDI router.

## User Guide

### What It Does

- Uses LinnStrument as the input surface.
- Maps touched pads to a selected output layout.
- Sends notes/pressure/timbre/pitch bend to a loop/DAW MIDI output.
- Optionally reads a `Lightguide Input` to show playback highlights on the web grid.
- Paints LinnStrument LEDs with custom pad colors.

### Requirements

- Chrome or Edge (Web MIDI support).
- LinnStrument connected by USB MIDI.
- Optional virtual loop MIDI port (for DAW routing), e.g. `loopMIDI` on Windows.

### Start

```bash
bun install
bun run start
```

Open the local app URL shown by the dev server.

### Connection Setup

In `Connections`:

- `LinnStrument Input`: MIDI input from the device.
- `LinnStrument Output`: MIDI output to the device (LED painting + setup NRPN).
- `MIDI Loop Output`: where routed notes are sent (DAW or virtual loop).
- `Lightguide Input` (optional): MIDI input used only for visual note highlights.

Behavior notes:

- Port selections are saved in browser storage.
- After you choose ports manually, auto-detection is locked until `Reset Defaults`.
- `Refresh Ports` rescans Web MIDI devices.

### Playing Workflow

- Bottom-left pad (`Ctl`) toggles the control overlay.
- Bottom row:
  - pads `1..13`: Mod Wheel (`CC1`) by pressure
  - last two pads: output octave down/up
- Overlay controls include key, scale, all-notes mode, layout switch, and MPE toggle.
- Two layouts are available:
  - `Scale Mode`
  - `Midimech` (reference: https://github.com/flipcoder/midimech)

### Advanced Settings

- `Pitch Bend Range`: default `±48`, configurable (`±0`, `±1`, `±2`, `±12`, `±24`, `±48`).
  - Changes are sent to both loop output (RPN 0 on channels 1-16) and LinnStrument (NRPN 19 + 119).
- `Horizontal Slide Pitch Bend (Standard Layout)`: default `1 semitone per pad`.
- `Horizontal Slide Pitch Bend (Mech Layout)`: default `2 semitones per pad`.
- `Color Root Note`, `Color Scale Note`, `Color Non-Scale Note`:
  - each supports full LinnStrument color range plus `(none)`.
  - defaults match the previous fixed behavior:
    - root: orange (`9`)
    - scale: white (`8`)
    - non-scale: black (`7`)
- `Color Mod Wheel Bar`: default yellow (`2`), configurable with the same color set.

### Persistence and Reset

- All settings are saved in browser local storage.
- `Reset Defaults` clears saved settings and reapplies default routing/layout configuration.
- `Restore` reapplies the standard LinnStrument mapping/mode setup without clearing your preferences.

## MIDI Routing Model

- Inputs:
  - LinnStrument Input
  - Optional Lightguide Input
- Outputs:
  - Loop Output (DAW target)
  - LinnStrument Output (NRPN + LED control)

MPE enabled:
- Notes/bend/pressure/timbre follow per-note channels.

MPE disabled:
- Notes route to channel `1`.
- Multi-note non-MPE bend is forced to center.

## Development

```bash
bun run test
bun run build
bun run verify
bun run test:e2e
```

## References

- Backlog: `docs/todo.md`
- Design notes: `docs/custom-mode-web-app-design.md`
- Protocol references: `tmp/linnstrument-firmware/midi.md`, `tmp/linnstrument-firmware/user_firmware_mode.md`
