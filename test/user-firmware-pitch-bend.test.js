import { describe, expect, test } from "bun:test";
import {
  USER_FIRMWARE_PITCH_BEND_SMOOTHING_STEP_14_DEFAULT,
  applyUserFirmwarePitchBendSmoothing14,
  normalizeUserFirmwarePitchBendSmoothingEnabled,
  normalizeUserFirmwarePitchBendSmoothingStep14,
} from "../web/src/user-firmware-pitch-bend.js";

describe("user-firmware pitch bend helpers", () => {
  test("normalizes smoothing toggles and step values", () => {
    expect(normalizeUserFirmwarePitchBendSmoothingEnabled(true, false)).toBe(true);
    expect(normalizeUserFirmwarePitchBendSmoothingEnabled(1, false)).toBe(true);
    expect(normalizeUserFirmwarePitchBendSmoothingEnabled(0, true)).toBe(false);
    expect(normalizeUserFirmwarePitchBendSmoothingEnabled("bad", true)).toBe(true);

    expect(normalizeUserFirmwarePitchBendSmoothingStep14(512, 100)).toBe(512);
    expect(normalizeUserFirmwarePitchBendSmoothingStep14(0, 100)).toBe(1);
    expect(normalizeUserFirmwarePitchBendSmoothingStep14(20000, 100)).toBe(16383);
    expect(normalizeUserFirmwarePitchBendSmoothingStep14("bad", 100)).toBe(100);
    expect(normalizeUserFirmwarePitchBendSmoothingStep14(undefined)).toBe(
      USER_FIRMWARE_PITCH_BEND_SMOOTHING_STEP_14_DEFAULT,
    );
  });

  test("limits bend delta when smoothing is enabled", () => {
    expect(
      applyUserFirmwarePitchBendSmoothing14(12000, 8192, { enabled: true, maxStep14: 300 }),
    ).toBe(8492);
    expect(
      applyUserFirmwarePitchBendSmoothing14(7000, 8192, { enabled: true, maxStep14: 256 }),
    ).toBe(7936);
    expect(
      applyUserFirmwarePitchBendSmoothing14(8300, 8192, { enabled: true, maxStep14: 300 }),
    ).toBe(8300);
  });

  test("passes through target bend when smoothing disabled or previous value missing", () => {
    expect(
      applyUserFirmwarePitchBendSmoothing14(14000, 8192, { enabled: false, maxStep14: 128 }),
    ).toBe(14000);
    expect(
      applyUserFirmwarePitchBendSmoothing14(14000, null, { enabled: true, maxStep14: 128 }),
    ).toBe(14000);
  });
});
