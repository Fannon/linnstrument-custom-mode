import { describe, expect, test } from "bun:test";
import {
  buildUserFirmwareSlideTransitionResult,
  normalizeUserFirmwareSlideMode,
  USER_FIRMWARE_SLIDE_MODE_CONTINUOUS,
  USER_FIRMWARE_SLIDE_MODE_SPEC,
} from "../web/src/user-firmware-slide-transition.js";

describe("user-firmware slide transition", () => {
  test("normalizes mode with spec default", () => {
    expect(normalizeUserFirmwareSlideMode(USER_FIRMWARE_SLIDE_MODE_SPEC)).toBe(USER_FIRMWARE_SLIDE_MODE_SPEC);
    expect(normalizeUserFirmwareSlideMode(USER_FIRMWARE_SLIDE_MODE_CONTINUOUS)).toBe(USER_FIRMWARE_SLIDE_MODE_CONTINUOUS);
    expect(normalizeUserFirmwareSlideMode("invalid")).toBe(USER_FIRMWARE_SLIDE_MODE_SPEC);
  });

  test("builds spec transition with note-off/note-on events", () => {
    const result = buildUserFirmwareSlideTransitionResult({
      mode: USER_FIRMWARE_SLIDE_MODE_SPEC,
      sourceRouted: { note: 60, channel: 5, sourceChannel: 3, inputColumn: 9 },
      eventChannel: 3,
      targetInputColumn: 10,
      targetOutNote: 61,
      velocity: 96,
    });

    expect(result?.sendSpecEvents).toBe(true);
    expect(result?.noteOff).toEqual({ noteNumber: 60, velocity: 0, channel: 5 });
    expect(result?.noteOn).toEqual({ noteNumber: 61, velocity: 96, channel: 5 });
    expect(result?.nextRouted).toEqual({
      note: 61,
      channel: 5,
      sourceChannel: 3,
      inputColumn: 10,
    });
  });

  test("builds continuous transition without note retrigger events", () => {
    const result = buildUserFirmwareSlideTransitionResult({
      mode: USER_FIRMWARE_SLIDE_MODE_CONTINUOUS,
      sourceRouted: { note: 60, channel: 7, sourceChannel: 2, inputColumn: 4 },
      eventChannel: 2,
      targetInputColumn: 5,
      targetOutNote: 63,
      velocity: 64,
    });

    expect(result?.sendSpecEvents).toBe(false);
    expect(result?.noteOff).toEqual({ noteNumber: 60, velocity: 0, channel: 7 });
    expect(result?.noteOn).toEqual({ noteNumber: 63, velocity: 64, channel: 7 });
    expect(result?.nextRouted?.note).toBe(63);
  });
});
