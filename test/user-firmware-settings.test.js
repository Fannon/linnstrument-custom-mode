import { describe, expect, test } from "bun:test";
import {
  USER_FIRMWARE_ROW_COUNT,
  createDefaultUserFirmwareAxesByRow,
  normalizeUserFirmwareAxesByRow,
} from "../web/src/user-firmware-settings.js";

describe("user-firmware-settings", () => {
  test("creates default per-row axis settings for all rows", () => {
    const defaults = createDefaultUserFirmwareAxesByRow();
    expect(defaults).toHaveLength(USER_FIRMWARE_ROW_COUNT);
    defaults.forEach((row) => {
      expect(row).toEqual({ x: true, y: false, z: true });
    });
  });

  test("normalizes invalid input back to defaults", () => {
    const normalized = normalizeUserFirmwareAxesByRow(null);
    expect(normalized).toHaveLength(USER_FIRMWARE_ROW_COUNT);
    expect(normalized[0]).toEqual({ x: true, y: false, z: true });
    expect(normalized[7]).toEqual({ x: true, y: false, z: true });
  });

  test("normalizes sparse arrays and boolean-like values", () => {
    const normalized = normalizeUserFirmwareAxesByRow([
      { x: 1, y: 0, z: "yes" },
      null,
      { x: false, y: true, z: false },
    ]);

    expect(normalized[0]).toEqual({ x: true, y: false, z: true });
    expect(normalized[1]).toEqual({ x: true, y: false, z: true });
    expect(normalized[2]).toEqual({ x: false, y: true, z: false });
    expect(normalized[7]).toEqual({ x: true, y: false, z: true });
  });
});
