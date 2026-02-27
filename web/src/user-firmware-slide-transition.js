export const USER_FIRMWARE_SLIDE_MODE_SPEC = "spec";
export const USER_FIRMWARE_SLIDE_MODE_CONTINUOUS = "continuous";

export function normalizeUserFirmwareSlideMode(value, fallback = USER_FIRMWARE_SLIDE_MODE_SPEC) {
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
  return {
    mode: normalizedMode,
    sendSpecEvents: normalizedMode === USER_FIRMWARE_SLIDE_MODE_SPEC,
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
      note: targetOutNote,
      sourceChannel: eventChannel,
      inputColumn: targetInputColumn,
    },
  };
}
