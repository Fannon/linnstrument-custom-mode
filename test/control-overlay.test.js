import { describe, expect, test } from "bun:test";
import {
  CONTROL_OVERLAY_TAP_MAX_MS,
  createControlOverlayState,
  isControlOverlayActive,
  pressControlOverlay,
  releaseControlOverlay,
} from "../web/src/control-overlay.js";

describe("control-overlay state machine", () => {
  test("quick tap toggles overlay on", () => {
    const state = createControlOverlayState();

    const press = pressControlOverlay(state, { nowMs: 100, touchId: "t1" });
    expect(press.ignored).toBe(false);
    expect(press.shouldRebuild).toBe(true);
    expect(isControlOverlayActive(state)).toBe(true);

    const release = releaseControlOverlay(state, { nowMs: 100 + CONTROL_OVERLAY_TAP_MAX_MS - 1, touchId: "t1" });
    expect(release.ignored).toBe(false);
    expect(release.toggled).toBe(true);
    expect(release.pinned).toBe(true);
    expect(release.shouldRebuild).toBe(false); // already active while held, remains active pinned
    expect(isControlOverlayActive(state)).toBe(true);
  });

  test("quick tap toggles overlay off when already pinned", () => {
    const state = createControlOverlayState();
    state.pinned = true;

    const press = pressControlOverlay(state, { nowMs: 200, touchId: "t1" });
    expect(press.shouldRebuild).toBe(false); // already active because pinned

    const release = releaseControlOverlay(state, { nowMs: 200 + CONTROL_OVERLAY_TAP_MAX_MS - 1, touchId: "t1" });
    expect(release.toggled).toBe(true);
    expect(release.pinned).toBe(false);
    expect(release.shouldRebuild).toBe(true); // transitions active -> inactive
    expect(isControlOverlayActive(state)).toBe(false);
  });

  test("long press is momentary and closes on release", () => {
    const state = createControlOverlayState();

    const press = pressControlOverlay(state, { nowMs: 300, touchId: "t1" });
    expect(press.shouldRebuild).toBe(true);
    expect(isControlOverlayActive(state)).toBe(true);

    const release = releaseControlOverlay(state, { nowMs: 300 + CONTROL_OVERLAY_TAP_MAX_MS + 1, touchId: "t1" });
    expect(release.toggled).toBe(false);
    expect(release.pinned).toBe(false);
    expect(release.shouldRebuild).toBe(true);
    expect(isControlOverlayActive(state)).toBe(false);
  });

  test("duplicate press while held is ignored", () => {
    const state = createControlOverlayState();

    pressControlOverlay(state, { nowMs: 400, touchId: "t1" });
    const duplicatePress = pressControlOverlay(state, { nowMs: 450, touchId: "t1" });
    expect(duplicatePress.ignored).toBe(true);
    expect(duplicatePress.shouldRebuild).toBe(false);
  });

  test("release with mismatched touch id is ignored", () => {
    const state = createControlOverlayState();

    pressControlOverlay(state, { nowMs: 500, touchId: "t1" });
    const wrongRelease = releaseControlOverlay(state, { nowMs: 520, touchId: "t2" });
    expect(wrongRelease.ignored).toBe(true);
    expect(isControlOverlayActive(state)).toBe(true);

    const correctRelease = releaseControlOverlay(state, { nowMs: 530, touchId: "t1" });
    expect(correctRelease.ignored).toBe(false);
  });
});
