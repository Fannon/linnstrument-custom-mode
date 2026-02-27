import { describe, expect, test } from "bun:test";
import {
  normalizeUserFirmwareDecimationMs,
  resolveUserFirmwareDecimationMs,
  USER_FIRMWARE_DECIMATION_MIN_MS,
} from "../web/src/user-firmware-decimation.js";

describe("user-firmware decimation", () => {
  test("normalizes raw decimation values into 0-127", () => {
    expect(normalizeUserFirmwareDecimationMs(0)).toBe(0);
    expect(normalizeUserFirmwareDecimationMs(200)).toBe(127);
    expect(normalizeUserFirmwareDecimationMs(-4)).toBe(0);
  });

  test("keeps 0 and >= minimum values unchanged", () => {
    expect(resolveUserFirmwareDecimationMs(0)).toEqual({
      requestedMs: 0,
      effectiveMs: 0,
      clampedToMinimum: false,
      minimumMs: USER_FIRMWARE_DECIMATION_MIN_MS,
    });
    expect(resolveUserFirmwareDecimationMs(40).effectiveMs).toBe(40);
  });

  test("clamps 1..11ms to minimum", () => {
    const resolved = resolveUserFirmwareDecimationMs(7);
    expect(resolved.requestedMs).toBe(7);
    expect(resolved.effectiveMs).toBe(USER_FIRMWARE_DECIMATION_MIN_MS);
    expect(resolved.clampedToMinimum).toBe(true);
  });
});
