import { clampInt } from "./core-logic.js";

export const USER_FIRMWARE_DECIMATION_MIN_MS = 12;

export function normalizeUserFirmwareDecimationMs(value, fallback = 0) {
  return clampInt(value, 0, 127, clampInt(fallback, 0, 127, 0));
}

export function resolveUserFirmwareDecimationMs(value, options = {}) {
  const minMs = clampInt(
    options?.minimumMs,
    1,
    127,
    USER_FIRMWARE_DECIMATION_MIN_MS,
  );
  const requestedMs = normalizeUserFirmwareDecimationMs(value, 0);
  if (requestedMs === 0 || requestedMs >= minMs) {
    return {
      requestedMs,
      effectiveMs: requestedMs,
      clampedToMinimum: false,
      minimumMs: minMs,
    };
  }
  return {
    requestedMs,
    effectiveMs: minMs,
    clampedToMinimum: true,
    minimumMs: minMs,
  };
}
