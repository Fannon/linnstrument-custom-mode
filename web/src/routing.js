export function noteKey(channel, noteNumber) {
  return `${channel}:${noteNumber}`;
}

export function getChannel(msg) {
  return msg?.message?.channel ?? msg?.channel ?? 1;
}

export function withInputSource(msg, source) {
  if (!msg || typeof msg !== "object") {
    return msg;
  }
  return { ...msg, __inputSource: source };
}

export function modTouchId(channel, noteNumber, fallbackCoord = "") {
  if (Number.isFinite(noteNumber)) {
    return `mod:${noteKey(channel || 1, noteNumber)}`;
  }
  return `mod:${channel || 1}:${fallbackCoord}`;
}

export function overlayTouchIdForEvent(event, isControlOverlayTriggerCoord) {
  if (!event) {
    return null;
  }
  if (event.coord && isControlOverlayTriggerCoord(event.coord)) {
    return `overlay:${event.coord}`;
  }
  if (Number.isFinite(event.noteNumber)) {
    return `overlay:${noteKey(event.channel || 1, event.noteNumber)}`;
  }
  if (event.coord) {
    return `overlay:${event.coord}`;
  }
  return "overlay";
}

export function markRecentLoopNoteOn(recentLoopNoteOns, channel, noteNumber, nowMs = performance.now()) {
  recentLoopNoteOns.set(noteKey(channel, noteNumber), nowMs);
}

export function wasRecentlyForwardedLoopNoteOn(
  recentLoopNoteOns,
  channel,
  noteNumber,
  maxAgeMs = 30,
  nowMs = performance.now(),
) {
  for (const [key, atMs] of recentLoopNoteOns.entries()) {
    if (nowMs - atMs > maxAgeMs) {
      recentLoopNoteOns.delete(key);
    }
  }
  const atMs = recentLoopNoteOns.get(noteKey(channel, noteNumber));
  if (!Number.isFinite(atMs)) {
    return false;
  }
  return nowMs - atMs <= maxAgeMs;
}

export function findCoordByRoutedNote(routedNotesByPad, channel, noteNumber) {
  for (const [coord, routed] of routedNotesByPad.entries()) {
    if (routed.channel === channel && routed.note === noteNumber) {
      return coord;
    }
  }
  return null;
}
