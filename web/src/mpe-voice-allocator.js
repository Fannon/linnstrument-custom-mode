export function createMpeVoiceAllocator(options = {}) {
  const minChannel = clampChannel(options.minChannel ?? 2, 2);
  const maxChannel = clampChannel(options.maxChannel ?? 15, 15);
  const rangeMin = Math.min(minChannel, maxChannel);
  const rangeMax = Math.max(minChannel, maxChannel);

  return {
    minChannel: rangeMin,
    maxChannel: rangeMax,
    byInputKey: new Map(), // inputKey -> { channel, assignedAt }
    byChannel: new Map(), // channel -> inputKey
    assignedOrder: [], // oldest first, contains inputKey
    clock: 0,
  };
}

export function clearMpeVoiceAllocator(state) {
  if (!state) {
    return;
  }
  state.byInputKey.clear();
  state.byChannel.clear();
  state.assignedOrder = [];
  state.clock = 0;
}

export function allocateMpeVoice(state, inputKey) {
  if (!state || !inputKey) {
    return { channel: 1, stolenInputKey: null };
  }

  const existing = state.byInputKey.get(inputKey);
  if (existing) {
    return { channel: existing.channel, stolenInputKey: null };
  }

  const freeChannel = findFreeChannel(state);
  if (freeChannel !== null) {
    assign(state, inputKey, freeChannel);
    return { channel: freeChannel, stolenInputKey: null };
  }

  const stolenInputKey = state.assignedOrder[0] || null;
  if (!stolenInputKey) {
    assign(state, inputKey, state.minChannel);
    return { channel: state.minChannel, stolenInputKey: null };
  }

  const stolenVoice = state.byInputKey.get(stolenInputKey);
  const channel = stolenVoice?.channel ?? state.minChannel;
  releaseMpeVoice(state, stolenInputKey);
  assign(state, inputKey, channel);
  return { channel, stolenInputKey };
}

export function releaseMpeVoice(state, inputKey) {
  if (!state || !inputKey) {
    return null;
  }
  const existing = state.byInputKey.get(inputKey);
  if (!existing) {
    return null;
  }
  state.byInputKey.delete(inputKey);
  state.byChannel.delete(existing.channel);
  state.assignedOrder = state.assignedOrder.filter((key) => key !== inputKey);
  return existing.channel;
}

export function getMpeVoiceChannel(state, inputKey) {
  const existing = state?.byInputKey?.get(inputKey);
  return existing ? existing.channel : null;
}

export function moveMpeVoiceInputKey(state, fromInputKey, toInputKey) {
  if (!state || !fromInputKey || !toInputKey || fromInputKey === toInputKey) {
    return false;
  }
  const existing = state.byInputKey.get(fromInputKey);
  if (!existing) {
    return false;
  }
  if (state.byInputKey.has(toInputKey)) {
    return false;
  }

  state.byInputKey.delete(fromInputKey);
  state.byInputKey.set(toInputKey, existing);
  state.byChannel.set(existing.channel, toInputKey);
  state.assignedOrder = state.assignedOrder.map((inputKey) => (inputKey === fromInputKey ? toInputKey : inputKey));
  return true;
}

function assign(state, inputKey, channel) {
  state.clock += 1;
  state.byInputKey.set(inputKey, {
    channel,
    assignedAt: state.clock,
  });
  state.byChannel.set(channel, inputKey);
  state.assignedOrder.push(inputKey);
}

function findFreeChannel(state) {
  for (let channel = state.minChannel; channel <= state.maxChannel; channel += 1) {
    if (!state.byChannel.has(channel)) {
      return channel;
    }
  }
  return null;
}

function clampChannel(value, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const intValue = Math.trunc(value);
  if (intValue < 1 || intValue > 16) {
    return fallback;
  }
  return intValue;
}
