import { describe, expect, test } from "bun:test";
import {
  createUserFirmwareSlideState,
  clearUserFirmwareSlideState,
  recordUserFirmwareSlideStart,
  consumeUserFirmwareSlideTarget,
  shouldIgnoreUserFirmwareSlideSourceRelease,
} from "../web/src/user-firmware-slide.js";

describe("user-firmware slide tracker", () => {
  test("handles invalid/edge inputs defensively", () => {
    expect(recordUserFirmwareSlideStart(null, 1, 2)).toBe(false);
    const state = createUserFirmwareSlideState();
    expect(recordUserFirmwareSlideStart(state, 1, Number.NaN)).toBe(false);
    expect(consumeUserFirmwareSlideTarget(state, 1, 2)).toBeNull();
    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 1, 2, 0)).toBe(false);
    clearUserFirmwareSlideState(null);
  });

  test("does not create transition when source equals target column", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 4, 6, { nowMs: 100 });
    expect(consumeUserFirmwareSlideTarget(state, 4, 6, { nowMs: 101 })).toBeNull();
  });

  test("tracks CC119 start and consumes target note-on", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 3, 7, { nowMs: 100 });
    const transition = consumeUserFirmwareSlideTarget(state, 3, 8, { nowMs: 110 });

    expect(transition).toEqual({
      sourceColumn: 7,
      targetColumn: 8,
      atMs: 110,
    });
    expect(state.pendingByChannel.size).toBe(0);
    expect(state.activeByChannel.size).toBe(1);
  });

  test("ignores source note-off only for matching source/target pair", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 3, 7, { nowMs: 200 });
    consumeUserFirmwareSlideTarget(state, 3, 9, { nowMs: 210 });

    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 3, 7, 9, { nowMs: 220 })).toBe(true);
    expect(state.activeByChannel.size).toBe(0);
  });

  test("does not ignore note-off when target velocity is mismatched", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 2, 4, { nowMs: 300 });
    consumeUserFirmwareSlideTarget(state, 2, 5, { nowMs: 305 });

    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 2, 4, 99, { nowMs: 306 })).toBe(false);
    expect(state.activeByChannel.size).toBe(1);
  });

  test("expires stale transitions", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 4, 10, { nowMs: 400, maxAgeMs: 20 });
    expect(consumeUserFirmwareSlideTarget(state, 4, 11, { nowMs: 450, maxAgeMs: 20 })).toBeNull();

    recordUserFirmwareSlideStart(state, 4, 11, { nowMs: 460, maxAgeMs: 20 });
    consumeUserFirmwareSlideTarget(state, 4, 12, { nowMs: 470, maxAgeMs: 20 });
    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 4, 11, 12, { nowMs: 500, maxAgeMs: 20 })).toBe(false);
  });

  test("clear removes active and pending state", () => {
    const state = createUserFirmwareSlideState();
    recordUserFirmwareSlideStart(state, 5, 1, { nowMs: 10 });
    consumeUserFirmwareSlideTarget(state, 5, 2, { nowMs: 11 });
    clearUserFirmwareSlideState(state);

    expect(state.pendingByChannel.size).toBe(0);
    expect(state.activeByChannel.size).toBe(0);
  });

  test("supports consecutive transitions on the same channel", () => {
    const state = createUserFirmwareSlideState();

    recordUserFirmwareSlideStart(state, 3, 2, { nowMs: 1000 });
    const first = consumeUserFirmwareSlideTarget(state, 3, 3, { nowMs: 1001 });
    expect(first?.sourceColumn).toBe(2);
    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 3, 2, 3, { nowMs: 1002 })).toBe(true);

    recordUserFirmwareSlideStart(state, 3, 3, { nowMs: 1003 });
    const second = consumeUserFirmwareSlideTarget(state, 3, 4, { nowMs: 1004 });
    expect(second?.sourceColumn).toBe(3);
    expect(shouldIgnoreUserFirmwareSlideSourceRelease(state, 3, 3, 4, { nowMs: 1005 })).toBe(true);
  });
});
