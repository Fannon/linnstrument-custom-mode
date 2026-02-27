
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

  1. [High] Slide handling is not protocol-accurate yet.
     Firmware/user-mode defines CC119 + ordered NoteOn(target) then NoteOff(source, velocity=targetColumn) for row slides (user_firmware_mode.md:87, user_firmware_mode.md:158).
     Current app ignores CC119 (web/src/main.js:1186) and infers slide mostly from same-row channel note-ons (web/src/main.js:1035).
     Suggestion: implement a per-row slide state machine driven by CC119 + note ordering, then add e2e tests for fast cross-cell slides and retriggers.
  2. [High] No inbound handling of firmware’s mode-change notification (NRPN 245 on channel 9).
     Firmware emits this when user toggles User Firmware mode from hardware (ls_settings.ino:2447, user_firmware_mode.md:25).
     App only listens to note/cc/aftertouch/pitchbend (web/src/main.js:617).
     Suggestion: add NRPN parser/listener so UI/protocol state auto-updates when hardware exits/enters user firmware.
  3. [Medium] Control-strip switch behavior is hardcoded in app, but firmware switch assignments are configurable.
     App assumes fixed rows for overlay/octave/exit (web/src/main.js:1433); firmware exposes switch assignment via NRPNs (midi.md:235, midi.md:236).
     Suggestion: either query/read assignments (NRPN 228/229) or add an explicit “assume default switch mapping” toggle in UI.
  4. [Medium] Decimation and some user-firmware controls are not fully surfaced as app options.
     Firmware supports decimation CC13 and per-row X/Y/Z toggles (midi.md:37, midi.md:41, ls_midi.ino:409).
     App configures these once in code (web/src/main.js:2124).
     Suggestion: expose them as advanced settings for debugging/performance tuning.
