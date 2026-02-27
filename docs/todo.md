## TODO

1. [Low] Clean up now-legacy NRPN sync helper usage boundary.
   After firmware-only refactor, `web/src/linnstrument-sync.js` is no longer part of runtime flow.
   Suggestion: either remove it (and corresponding tests) or reuse it for the new startup handshake/query path (TODO #4) to keep the codebase coherent.
