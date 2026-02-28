import { clampInt } from "./core-logic.js";

export function noteKey(channel, noteNumber) {
  return `${channel}:${noteNumber}`;
}

export function getChannel(msg) {
  // Prefer status-byte decoding for consistency across WebMidi event variants.
  const data = msg?.message?.data || msg?.data || msg?.dataBytes;
  const status = data?.[0];
  if (Number.isFinite(status) && status >= 0x80 && status <= 0xef) {
    return (status & 0x0f) + 1;
  }

  const explicitChannel = msg?.message?.channel ?? msg?.channel;
  if (Number.isFinite(explicitChannel)) {
    // Some wrappers expose 0..15, others 1..16.
    if (explicitChannel >= 0 && explicitChannel <= 15) {
      return explicitChannel + 1;
    }
    return explicitChannel;
  }

  return 1;
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
  // WebMidi v3/v2 both provide the raw bytes in some form (.data, .dataBytes, etc).
  // Standard MIDI for Note On/Off/PolyAT: [Status, Note, Velocity/Pressure]
  const data = msg?.message?.data || msg?.data || msg?.dataBytes;
  
  let noteNumber = msg?.note?.number; 
  if (!Number.isFinite(noteNumber) && data) {
    // If the data array starts with the Status byte (standard), Note is data[1].
    // We check if data[0] looks like a status byte (>= 0x80).
    const startOffset = (data[0] >= 0x80) ? 1 : 0;
    noteNumber = data[startOffset];
  }

  if (!Number.isFinite(noteNumber)) {
    return null;
  }

  const channel = getChannel(msg);

  // Prefer explicit parsed fields from WebMidi events when available.
  let velocity = null;
  if (Number.isFinite(msg?.rawVelocity)) {
    velocity = msg.rawVelocity;
  } else if (Number.isFinite(msg?.rawValue)) {
    velocity = msg.rawValue;
  } else if (data) {
    // Velocity/Pressure is at index 2 (if index 0 is Status) or 1 (if no Status).
    const startOffset = (data[0] >= 0x80) ? 1 : 0;
    if (data.length > startOffset + 1) {
      velocity = data[startOffset + 1];
    }
  } else if (typeof msg?.velocity === "number" || typeof msg?.value === "number") {
    velocity = Math.round((msg.velocity ?? msg.value ?? 0) * 127);
  }

  if (!Number.isFinite(velocity)) {
    velocity = 0;
  }

  const result = {
    noteNumber: noteNumber & 0x7f,
    channel,
    velocity: clampInt(velocity, 0, 127, 0),
    coord: typeof msg?.coord === "string" ? msg.coord : null,
  };

  return result;
}

export function extractRawControlChangeEvent(msg) {
  const controller = msg?.controller?.number ?? msg?.dataBytes?.[0] ?? msg?.message?.data?.[1] ?? msg?.data?.[1];
  if (!Number.isFinite(controller)) {
    return null;
  }

  const rawValue =
    msg?.rawValue ?? msg?.value ?? msg?.message?.data?.[2] ?? msg?.data?.[2] ?? msg?.dataBytes?.[1];

  const value7 =
    typeof rawValue === "number" && rawValue >= 0 && rawValue <= 1 && !msg?.rawValue
      ? clampInt(Math.round(rawValue * 127), 0, 127, 0)
      : clampInt(rawValue, 0, 127, 0);

  const result = {
    controller,
    channel: getChannel(msg),
    value7,
  };
  return result;
}
