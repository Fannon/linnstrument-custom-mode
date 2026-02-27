import { describe, expect, test } from "bun:test";
import {
  USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS,
  resolveUserFirmwareControlStripCommand,
} from "../web/src/user-firmware-control-strip.js";

describe("user-firmware-control-strip", () => {
  test("maps default switch rows to octave actions when enabled", () => {
    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.switch1, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: true,
    })).toBe("octave-down");

    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.switch2, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: true,
    })).toBe("octave-up");
  });

  test("keeps split and exit actions even when switch mapping is disabled", () => {
    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.split, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: false,
    })).toBe("overlay");

    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.exit, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: false,
    })).toBe("exit-user-firmware");
  });

  test("ignores switch rows when switch mapping assumption is disabled", () => {
    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.switch1, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: false,
    })).toBeNull();

    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.switch2, {
      userFirmwareModeEnabled: true,
      assumeDefaultSwitchMapping: false,
    })).toBeNull();
  });

  test("ignores non-control-strip note events and disabled mode", () => {
    expect(resolveUserFirmwareControlStripCommand(1, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.split, {
      userFirmwareModeEnabled: true,
    })).toBeNull();

    expect(resolveUserFirmwareControlStripCommand(0, USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS.split, {
      userFirmwareModeEnabled: false,
    })).toBeNull();
  });
});
