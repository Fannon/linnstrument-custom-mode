export const CONTROL_OVERLAY_TRIGGER_COORD = "0-0";
export const CONTROL_OVERLAY_TAP_MAX_MS = 500;

export function createControlOverlayState() {
  return {
    pinned: false,
    buttonHeld: false,
    pressStartedAtMs: 0,
    activeTouchId: null,
  };
}

export function isControlOverlayActive(state) {
  return Boolean(state?.pinned || state?.buttonHeld);
}

export function pressControlOverlay(state, options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const touchId = options.touchId ?? null;
  if (!state) {
    return { ignored: true, active: false, shouldRebuild: false };
  }

  if (state.buttonHeld) {
    return {
      ignored: true,
      active: isControlOverlayActive(state),
      shouldRebuild: false,
    };
  }

  const wasActive = isControlOverlayActive(state);
  state.buttonHeld = true;
  state.pressStartedAtMs = nowMs;
  state.activeTouchId = touchId;

  const active = isControlOverlayActive(state);
  return {
    ignored: false,
    active,
    shouldRebuild: !wasActive && active,
  };
}

export function releaseControlOverlay(state, options = {}) {
  const nowMs = normalizeNowMs(options.nowMs);
  const touchId = options.touchId ?? null;
  const tapMaxMs = Number.isFinite(options.tapMaxMs) ? Number(options.tapMaxMs) : CONTROL_OVERLAY_TAP_MAX_MS;

  if (!state) {
    return { ignored: true, active: false, shouldRebuild: false, toggled: false, pinned: false };
  }

  if (!state.buttonHeld) {
    return {
      ignored: true,
      active: isControlOverlayActive(state),
      shouldRebuild: false,
      toggled: false,
      pinned: Boolean(state.pinned),
    };
  }

  if (touchId && state.activeTouchId && touchId !== state.activeTouchId) {
    return {
      ignored: true,
      active: isControlOverlayActive(state),
      shouldRebuild: false,
      toggled: false,
      pinned: Boolean(state.pinned),
    };
  }

  const startedAtMs = Number.isFinite(state.pressStartedAtMs) && state.pressStartedAtMs > 0
    ? state.pressStartedAtMs
    : nowMs;
  const pressDurationMs = Math.max(0, nowMs - startedAtMs);
  const wasPinned = Boolean(state.pinned);
  const wasActive = isControlOverlayActive(state);

  state.buttonHeld = false;
  state.pressStartedAtMs = 0;
  state.activeTouchId = null;

  let toggled = false;
  if (pressDurationMs <= Math.max(0, tapMaxMs)) {
    state.pinned = !wasPinned;
    toggled = true;
  }

  const active = isControlOverlayActive(state);
  return {
    ignored: false,
    active,
    shouldRebuild: wasActive !== active,
    toggled,
    pinned: Boolean(state.pinned),
    pressDurationMs,
  };
}

function normalizeNowMs(nowMs) {
  return Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
}
