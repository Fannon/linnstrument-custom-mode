# LinnStrument Custom Mode Web App (Prototype) Design

## Goal

Transform the existing LinnStrument light-guide tool into a browser-based custom-mode editor/router, closer in spirit to Novation Components, with a simpler MIDI routing model:

- `1x` LinnStrument MIDI input
- `1x` LinnStrument MIDI output (for cell colors + state sync)
- `1x` user-selected MIDI loop output (to DAW/synth)

This first prototype focuses on a single preconfigured layout instead of a full editor.

## Prototype Scope (Implemented)

### UI

- Auto-detect LinnStrument input and output ports by name (`/linnstrument/i`)
- User-select loop output port (with a preselected non-LinnStrument candidate if available)
- One preset selector (currently one preset)
- Adjustable note-layout row offset (default `4`)
- Configurable horizontal slide pitch-bend scaling:
  - `1 pad = 0.5 semitones`
  - `1 pad = 1 semitone`
  - `1 pad = 2 semitones`
- Device mapping controls:
  - `deviceStartNote`
  - `deviceRowOffset`
- `Sync From LinnStrument` button (reads official NRPN params)
- `All Notes Off` panic
- Surface visualization + log panel

### Preset: `Scale Mode (Mod row + Key/Mode rows)`

Behavior on a 128-pad LinnStrument (16x8):

- Bottom row (`y=0`): modwheel strip using pressure -> sends `CC1` to loop output
- Row above (`y=1`): key selection (`C`..`B`) on the left 12 pads
- Next row (`y=2`): mode selection on the left pads
  - Major
  - Minor
  - Major Pentatonic
  - Minor Pentatonic
  - Dorian
  - Mixolydian
  - Lydian
  - Phrygian
- Rows `y>=3`: playable pads that only output notes from the selected scale

### MIDI Routing Behavior

- Playable pad note presses are remapped to scale notes and sent to the loop output
- Playable pad note-offs stop the mapped notes
- Pitch bend on playable rows is forwarded to the loop output with configurable scaling
- Poly pressure on playable pads is forwarded as poly aftertouch to the mapped note
- Channel aftertouch is forwarded on channels that currently hold routed notes
- Bottom-row pressure sends `CC1` (modwheel)
- Key/mode selection pads do not forward note events

## Architecture

### Modules kept/reused

- `web/src/log.js`: lightweight UI log
- `web/src/grid.js`: grid generation + rendering, adapted for custom cell metadata
- `web/src/config.js`: replaced with a smaller persisted config model

### Main app flow (`web/src/main.js`)

1. Enable WebMIDI
2. Load persisted config
3. Populate UI controls
4. Auto-detect ports and connect selected ports
5. Build layout metadata for the chosen preset
6. Draw web surface + (optionally) paint LinnStrument cell colors
7. Route incoming LinnStrument messages according to pad role

### Layout model

The app builds a `padMap` keyed by physical coordinates (`x-y`) where each cell is assigned one role:

- `mod`
- `key-select`
- `mode-select`
- `play-note`
- `disabled`

This keeps routing logic independent from the UI rendering and is a good basis for future editable layouts.

## LinnStrument MIDI Assumptions and Official Docs Usage

This prototype uses the official MIDI notes in `tmp/midi.md` (provided in the repo) for two things:

### 1) Cell coloring (LinnStrument output)

Uses CC-based custom cell colors:

- `CC20` = column
- `CC21` = row
- `CC22` = color

### 2) Device state sync (NRPN)

`Sync From LinnStrument` reads:

- `NRPN 0`: Split Left MIDI Mode
- `NRPN 18`: Split Left MIDI Per Row Lowest Channel
- `NRPN 60`: Row channel order (normal/reversed)
- `NRPN 36`: Split Left Octave
- `NRPN 37`: Split Left Transpose Pitch
- `NRPN 227`: Global Row Offset

These are used to estimate the physical note-to-coordinate mapping (`deviceStartNote`, `deviceRowOffset`) and improve pad-coordinate decoding.

## Key Technical Tradeoffs (Current Prototype)

### Simplified, not full MPE routing

The prototype does not yet fully remap all expressive dimensions (especially Y-axis CC / timbre and advanced MPE nuances) for the new scale-mapped notes. It currently forwards:

- note on/off
- pitch bend (with configurable horizontal scaling)
- poly pressure
- channel aftertouch
- modwheel (`CC1`) from the dedicated mod row

This is enough to validate the custom-scale workflow before implementing complete expressive remapping.

### Best accuracy in Channel-Per-Row mode

Pad-coordinate decoding is most reliable when the LinnStrument split is configured for **Channel Per Row**. The sync action warns if this is not the case.

### Prototype targets 128-pad layout first

The UI and preset layout are designed around the 16x8 surface. `linnStrumentSize` remains in config for future expansion but the current UX assumes 128 pads.

## Follow-Up Tasks (Recommended)

1. Implement full expressive remapping for play pads
   - Forward/remap pitch bend and Y-axis CC (often CC74) per active routed note/channel.
2. Add a real layout editor model
   - Click/paint cells with roles (`play`, `mod`, `key`, `mode`, `disabled`) and save presets.
3. Add preset import/export
   - JSON schema for presets and local file import/export.
4. Support 200-pad LinnStrument explicitly
   - Surface dimensions, default zones, and layout templates for 25x8.
5. Handle non-default per-row lowest channel fully
   - Decode and route using `NRPN 18` without warnings (partially supported now for decoding).
6. Support split mode awareness
   - Left/right split custom layouts and separate loop outputs/channels.
7. Add Web MIDI hot-plug handling
   - React to device connect/disconnect events and preserve selections.
8. Improve visual feedback on the physical LinnStrument
   - Press/hold color overlays and optional tonic/degree coloring modes.
9. Add automated browser tests (where feasible)
   - Unit test scale mapping + preset layout generation; mock MIDI event routing.
10. Rewrite `README.md` for the new product direction
   - Keep legacy light-guide docs in a `docs/legacy-light-guide.md` archive.

## Suggested Near-Term Iteration Plan

1. Finish expressive routing for the scale-mapped notes (especially CC74 / Y-axis and any per-note remap edge cases).
2. Add 2-3 more hardcoded presets (drum grid, isomorphic chromatic, chord launcher).
3. Extract preset/layout schema and make it editable in UI.
4. Add save/load preset JSON and a minimal preset library.
