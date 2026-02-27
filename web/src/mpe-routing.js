export function isMpeModeEnabled(config = {}, defaults = {}) {
  const fallback = defaults?.mpeEnabled;
  return Boolean(config?.mpeEnabled ?? (typeof fallback === "boolean" ? fallback : true));
}

export function resolveOutputChannel(inputChannel, mpeEnabled) {
  if (!mpeEnabled) {
    return 1;
  }
  if (!Number.isFinite(inputChannel)) {
    return 1;
  }
  const normalized = Math.trunc(inputChannel);
  if (normalized < 1 || normalized > 16) {
    return 1;
  }
  return normalized;
}

export function getRoutedInputChannel(entry) {
  if (Number.isFinite(entry?.sourceChannel)) {
    return entry.sourceChannel;
  }
  if (Number.isFinite(entry?.channel)) {
    return entry.channel;
  }
  return null;
}

export function shouldForwardPitchBendForInputChannel({
  inputChannel,
  assumeRowChannels = false,
  rowIndexFromChannel,
  rowHasPlayablePads,
  routedEntries = [],
} = {}) {
  if (!Number.isFinite(inputChannel)) {
    return false;
  }

  if (assumeRowChannels && typeof rowIndexFromChannel === "function") {
    const row = rowIndexFromChannel(inputChannel);
    if (row !== null && row !== undefined && Number.isFinite(row)) {
      if (typeof rowHasPlayablePads === "function" && rowHasPlayablePads(row)) {
        return true;
      }
    }
  }

  for (const entry of routedEntries) {
    if (getRoutedInputChannel(entry) === inputChannel) {
      return true;
    }
  }
  return false;
}

export function listOutputChannelsForInputChannel(routedEntries = [], inputChannel) {
  if (!Number.isFinite(inputChannel)) {
    return [];
  }
  const channels = new Set();
  for (const entry of routedEntries) {
    if (getRoutedInputChannel(entry) === inputChannel && Number.isFinite(entry?.channel)) {
      channels.add(entry.channel);
    }
  }
  return Array.from(channels.values());
}
