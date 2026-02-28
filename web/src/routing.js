import { clampInt } from "./core-logic.js";

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

export function extractRawTouchEvent(msg) {
  // WebMidi v3 'noteon', 'noteoff', 'keyaftertouch' messages provide structured data.
  // We prefer the raw integers to avoid precision loss from normalization.
  const noteNumber = msg?.note?.number ?? msg?.dataBytes?.[0] ?? (msg?.data?.[1] & 0x7f);
  if (!Number.isFinite(noteNumber)) {
    return null;
  }

  const channel = getChannel(msg);

  // Status byte is in msg.data[0]. msg.data is the full MIDI message [Status, Data1, Data2].
  // Data2 (velocity/pressure) is at msg.data[2] for 3-byte messages.
  let rawValue = 0;
  if (msg?.data && msg.data.length >= 3) {
    rawValue = msg.data[2];
  } else if (msg?.dataBytes && msg.dataBytes.length >= 2) {
    rawValue = msg.dataBytes[1];
  } else {
    // Fallback to WebMidi properties
    rawValue = msg?.rawVelocity ?? msg?.rawValue ?? msg?.velocity ?? msg?.value ?? 0;
  }

  // Handle normalization if the value came from normalized 'velocity' or 'value'
  const velocity =
    typeof rawValue === "number" && rawValue >= 0 && rawValue <= 1 && !msg?.rawVelocity && !msg?.rawValue
      ? clampInt(Math.round(rawValue * 127), 0, 127, 0)
      : clampInt(rawValue, 0, 127, 0);

  return {
    noteNumber,
    channel,
    velocity,
    coord: typeof msg?.coord === "string" ? msg.coord : null,
  };
}

export function extractRawControlChangeEvent(msg) {
  const controller = msg?.controller?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(controller)) {
    return null;
  }

  const rawValue = msg?.rawValue ?? msg?.value ?? msg?.dataBytes?.[1];
  const value7 =
    typeof rawValue === "number" && rawValue >= 0 && rawValue <= 1
      ? clampInt(Math.round(rawValue * 127), 0, 127, 0)
      : clampInt(rawValue, 0, 127, 0);

  return {
    controller,
    channel: getChannel(msg),
    value7,
  };
}
