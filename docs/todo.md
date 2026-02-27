## TODO

1. [Medium] Add integration/e2e coverage for event pipeline in `main.js`.
   Existing tests are strong for utility modules, but most routing behavior in `web/src/main.js` is untested by high-level scenarios.
   Suggestion: add:
   unit-level integration harness with fake WebMIDI input/output ports
   Playwright e2e for grid click routing, overlay controls, MPE toggle, and note-off correctness.

2. [Low] Validate decimation values against firmware constraints and document behavior.
   Firmware notes minimum decimation constraints in low-power mode (`tmp/linnstrument-firmware/user_firmware_mode.md`, CC13 section).
   Suggestion: clamp/warn for out-of-profile values and surface effective value in UI/log.

3. [Low] Clean up now-legacy NRPN sync helper usage boundary.
   After firmware-only refactor, `web/src/linnstrument-sync.js` is no longer part of runtime flow.
   Suggestion: either remove it (and corresponding tests) or reuse it for the new startup handshake/query path (TODO #4) to keep the codebase coherent.
