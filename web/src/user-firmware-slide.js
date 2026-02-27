const DEFAULT_MAX_AGE_MS = 1200;

export function createUserFirmwareSlideState() {
  return {
    pendingByChannel: new Map(),
    activeByChannel: new Map(),
  };
}

export function clearUserFirmwareSlideState(state) {
  if (!state) {
    return;
  }
  state.pendingByChannel?.clear?.();
  state.activeByChannel?.clear?.();
}

export function recordUserFirmwareSlideStart(state, channel, sourceColumn, options = {}) {
  if (!state || !Number.isFinite(channel) || !Number.isFinite(sourceColumn)) {
    return false;
  }

  const nowMs = normalizeNowMs(options.nowMs);
  expireOldTransitions(state, nowMs, options.maxAgeMs);
  state.pendingByChannel.set(channel, { sourceColumn, atMs: nowMs });
  return true;
}

export function consumeUserFirmwareSlideTarget(state, channel, targetColumn, options = {}) {
  if (!state || !Number.isFinite(channel) || !Number.isFinite(targetColumn)) {
    return null;
  }

  const nowMs = normalizeNowMs(options.nowMs);
  expireOldTransitions(state, nowMs, options.maxAgeMs);
  const pending = state.pendingByChannel.get(channel);
  if (!pending || !Number.isFinite(pending.sourceColumn)) {
    return null;
  }

  state.pendingByChannel.delete(channel);
  if (pending.sourceColumn === targetColumn) {
    return null;
  }

  const transition = {
    sourceColumn: pending.sourceColumn,
    targetColumn,
    atMs: nowMs,
  };
  state.activeByChannel.set(channel, transition);
  return transition;
}

export function shouldIgnoreUserFirmwareSlideSourceRelease(state, channel, sourceColumn, noteOffVelocity, options = {}) {
  if (!state || !Number.isFinite(channel) || !Number.isFinite(sourceColumn)) {
    return false;
  }

  const nowMs = normalizeNowMs(options.nowMs);
  expireOldTransitions(state, nowMs, options.maxAgeMs);
  const active = state.activeByChannel.get(channel);
  if (!active) {
    return false;
  }
  if (active.sourceColumn !== sourceColumn) {
    return false;
  }

  if (Number.isFinite(noteOffVelocity) && active.targetColumn !== noteOffVelocity) {
    return false;
  }

  state.activeByChannel.delete(channel);
  return true;
}

function expireOldTransitions(state, nowMs, maxAgeMs) {
  const maxAge = Number.isFinite(maxAgeMs) ? Number(maxAgeMs) : DEFAULT_MAX_AGE_MS;
  expireByTimestamp(state.pendingByChannel, nowMs, maxAge);
  expireByTimestamp(state.activeByChannel, nowMs, maxAge);
}

function expireByTimestamp(map, nowMs, maxAgeMs) {
  if (!map || maxAgeMs < 0) {
    return;
  }
  for (const [channel, entry] of map.entries()) {
    if (!entry || !Number.isFinite(entry.atMs)) {
      map.delete(channel);
      continue;
    }
    if (nowMs - entry.atMs > maxAgeMs) {
      map.delete(channel);
    }
  }
}

function normalizeNowMs(nowMs) {
  return Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
}
