## TODO

1. [High] Align pressure routing with MPE expectations.
   In MPE mode, output currently uses Poly Aftertouch messages (`sendLoopPolyAftertouch` path) while MPE commonly expects Channel Pressure on per-note channels (`tmp/MIDI MPE Spec.md` “Continuous Per-Note Channel Pressure”).
   Suggestion: in MPE mode emit Channel Pressure (`0xD0`) on allocated note channels; keep Poly Aftertouch behavior only for non-MPE compatibility mode.

2. [High] Make slide-transition behavior selectable and spec-accurate by default.
   Firmware slide protocol (`tmp/linnstrument-firmware/user_firmware_mode.md`, “Slide Mode”, CC119 + NoteOn target + NoteOff source) is currently interpreted in a “sustain one note” style in `handleUserFirmwareSlideTransition` (`web/src/main.js`), which is intentionally different from firmware semantics.
   Suggestion: add two modes:
   `spec`: forward transition note-off/note-on sequence exactly
   `continuous`: current sustain+bend behavior
   Add regression tests for both modes.

3. [Medium] Add firmware-mode handshake/verification on connect.
   Runtime starts optimistic and only later reacts to NRPN245 notifications. If UF mode is off at startup and no notification arrives yet, app can decode incoming data under wrong assumptions.
   Suggestion: on connect, query current NRPN 245 value (via NRPN 299 request flow in `tmp/linnstrument-firmware/midi.md`) and set `userFirmwareRuntimeActive` from actual device state.

4. [Medium] Replace “assume default switch mapping” with actual switch-assignment query.
   Current app has a manual assumption toggle, but firmware exposes assignments via NRPN 228/229 (`tmp/linnstrument-firmware/midi.md`).
   Suggestion: query NRPN 228/229 and derive control-strip behavior from real settings, with manual override as fallback.

5. [Medium] Implement Y/timbre routing end-to-end.
   App can configure Y-axis streaming (CC11 enable per row), but incoming Y data (CC64-89) is not currently routed to musical output.
   Firmware docs define Y data explicitly (`tmp/linnstrument-firmware/user_firmware_mode.md`).
   Suggestion: map Y to CC74 in MPE mode per note channel, and provide output CC selection in advanced settings.

6. [Medium] Add integration/e2e coverage for event pipeline in `main.js`.
   Existing tests are strong for utility modules, but most routing behavior in `web/src/main.js` is untested by high-level scenarios.
   Suggestion: add:
   unit-level integration harness with fake WebMIDI input/output ports
   Playwright e2e for grid click routing, overlay controls, MPE toggle, and note-off correctness.

7. [Low] Validate decimation values against firmware constraints and document behavior.
   Firmware notes minimum decimation constraints in low-power mode (`tmp/linnstrument-firmware/user_firmware_mode.md`, CC13 section).
   Suggestion: clamp/warn for out-of-profile values and surface effective value in UI/log.

8. [Low] Clean up now-legacy NRPN sync helper usage boundary.
   After firmware-only refactor, `web/src/linnstrument-sync.js` is no longer part of runtime flow.
   Suggestion: either remove it (and corresponding tests) or reuse it for the new startup handshake/query path (TODO #4) to keep the codebase coherent.
