
## Proper MPE Support

Currently the app only supports polyphonic mode. We should add support for MPE mode.
See tmp/MIDI MPE Spec.md for MPE spec

Modwheel should stay at Channel 1, the notes should use Channel 2-15 with velocity, pressure, pitch bend. 
Feel free to implement timbre (Y) as well, but make it an option to toggle on/off. 

## Check against original Source Code

› If it helps, I downloaded the original linnstrument firmware source code under tmp/linnstrument-firmware . You can use this to check how LinnStrument implemented and solved particular problems. Add this to the
  AGENT.md as hint. This repo also contains some technical documentation like tmp/linnstrument-firmware/user_firmware_mode.md and tmp/linnstrument-firmware/midi.md
Generally, check out what I put into tmp/ and note in AGENT.md what is useful. Check that codex CLI uses AGENT.md by default or configure it accordingly.
› After you analyzed the original source code, tell me where things are different, give me suggestions what to improve or what to add

## TODO

  1. [Medium] Decimation and some user-firmware controls are not fully surfaced as app options.
     Firmware supports decimation CC13 and per-row X/Y/Z toggles (midi.md:37, midi.md:41, ls_midi.ino:409).
     App configures these once in code (web/src/main.js:2124).
     Suggestion: expose them as advanced settings for debugging/performance tuning.
