# Controller Script (JavaScript)

This folder contains a simplified/fixed Bitwig controller script:

- `LinnStrumentCustom.control.js`
- `SimpleMidiIn.control.js`

## What it does

- Keeps LinnStrument input passthrough simple (no note remapping or extra note generation).
- Sends selected-track playback notes back to MIDI Out for pad highlighting.
- Uses note-state transitions (on/off diffs), not repeated note-ons on every observer tick.
- Suppresses immediate echo of freshly played live notes to reduce duplicate triggers.
- Uses a unique controller name + UUID so it does not clash with the prior script identity.
- Auto-discovers MIDI ports named `LinnStrument MIDI`, `LinnStrument MIDI 1`, `LinnStrument Custom`, and `LinnStrument Custom MIDI 1`.

`SimpleMidiIn.control.js` opens the `FannonFoot` MIDI input (falling back to the usual LinnStrument names) and logs every MIDI packet it receives.

## Install

1. Copy `LinnStrumentCustom.control.js` to your Bitwig scripts folder, for example:
   `/mnt/g/My Drive/Musik/Bitwig Studio/Controller Scripts/`
2. In Bitwig: `Settings -> Controllers -> Add Controller Extension -> Generic -> LinnStrument Custom`.
3. Assign MIDI In/Out to your LinnStrument ports.

## Script identity

- Name: `LinnStrument Custom`
- Vendor: `Roger Linn Design`
- Author: `fannon`
- UUID: `adad919a-038e-4963-bf6c-f8b8ca714c41`
