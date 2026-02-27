export const USER_FIRMWARE_SLIDE_MODE_SPEC = "spec";
export const USER_FIRMWARE_SLIDE_MODE_CONTINUOUS = "continuous";

export function normalizeUserFirmwareSlideMode(value, fallback = USER_FIRMWARE_SLIDE_MODE_CONTINUOUS) {
  if (value === USER_FIRMWARE_SLIDE_MODE_SPEC || value === USER_FIRMWARE_SLIDE_MODE_CONTINUOUS) {
    return value;
  }
  return fallback === USER_FIRMWARE_SLIDE_MODE_CONTINUOUS
    ? USER_FIRMWARE_SLIDE_MODE_CONTINUOUS
    : USER_FIRMWARE_SLIDE_MODE_SPEC;
}

export function buildUserFirmwareSlideTransitionResult({
  mode,
  sourceRouted,
  eventChannel,
  targetInputColumn,
  targetOutNote,
  velocity = 0,
} = {}) {
  if (!sourceRouted || !Number.isFinite(sourceRouted.channel) || !Number.isFinite(sourceRouted.note)) {
    return null;
  }
  if (!Number.isFinite(eventChannel) || !Number.isFinite(targetInputColumn) || !Number.isFinite(targetOutNote)) {
    return null;
  }

  const normalizedMode = normalizeUserFirmwareSlideMode(mode);
  const sendSpecEvents = normalizedMode === USER_FIRMWARE_SLIDE_MODE_SPEC;
  return {
    mode: normalizedMode,
    sendSpecEvents,
    noteOff: {
      noteNumber: sourceRouted.note,
      velocity: 0,
      channel: sourceRouted.channel,
    },
    noteOn: {
      noteNumber: targetOutNote,
      velocity,
      channel: sourceRouted.channel,
    },
    nextRouted: {
      ...sourceRouted,
      // In continuous mode we keep sounding the original note and only bend it.
      note: sendSpecEvents ? targetOutNote : sourceRouted.note,
      sourceChannel: eventChannel,
      inputColumn: targetInputColumn,
      pitchAnchorX14: sendSpecEvents ? null : sourceRouted.pitchAnchorX14,
      pitchAnchorInputColumn: sendSpecEvents ? null : sourceRouted.pitchAnchorInputColumn,
    },
  };
}
