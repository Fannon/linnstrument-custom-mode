import { describe, expect, test } from "bun:test";
import {
  decodeUserFirmwareYControlChange,
  normalizeUserFirmwareTimbreCc,
  normalizeUserFirmwareTimbreEnabled,
} from "../web/src/user-firmware-y.js";

describe("user-firmware Y routing helpers", () => {
  test("decodes CC64-89 as Y column/value", () => {
    expect(decodeUserFirmwareYControlChange({ controller: 64, value7: 127 })).toEqual({ column: 0, value7: 127 });
    expect(decodeUserFirmwareYControlChange({ controller: 89, value7: 23 })).toEqual({ column: 25, value7: 23 });
    expect(decodeUserFirmwareYControlChange({ controller: 63, value7: 10 })).toBeNull();
    expect(decodeUserFirmwareYControlChange({ controller: 90, value7: 10 })).toBeNull();
  });

  test("normalizes timbre output CC into 0-127 range", () => {
    expect(normalizeUserFirmwareTimbreCc(74)).toBe(74);
    expect(normalizeUserFirmwareTimbreCc(200)).toBe(127);
    expect(normalizeUserFirmwareTimbreCc(-2)).toBe(0);
  });

  test("normalizes timbre enabled flag with fallback", () => {
    expect(normalizeUserFirmwareTimbreEnabled(true)).toBe(true);
    expect(normalizeUserFirmwareTimbreEnabled(false)).toBe(false);
    expect(normalizeUserFirmwareTimbreEnabled("1")).toBe(true);
    expect(normalizeUserFirmwareTimbreEnabled("0")).toBe(false);
    expect(normalizeUserFirmwareTimbreEnabled(undefined, false)).toBe(false);
  });
});
