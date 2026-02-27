## TODO

- [x] Prevent stale cached X from being reapplied at slide transition in continuous mode.
- [x] Coalesce user-firmware X MSB/LSB updates so bend emits from coherent 14-bit samples only.
- [x] Add a small anchor deadband so tiny X jitter does not produce audible bend.
- [x] Add optional pitch-bend smoothing/rate limiting to reduce steppy output.
- [x] Add unit/e2e tests for interleaved MSB/LSB updates and multi-pad continuous slides.


Have a look at tmp/midimech for inspiration. Can you explain how it works vs. this project?
