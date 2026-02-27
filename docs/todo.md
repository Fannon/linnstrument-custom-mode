
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

  (empty)
