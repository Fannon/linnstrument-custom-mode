export const LINNSTRUMENT_USER_FIRMWARE_MODE_NOTIFY_CHANNEL = 9;
export const LINNSTRUMENT_USER_FIRMWARE_MODE_PARAM = 245;
export const LINNSTRUMENT_SWITCH1_ASSIGNMENT_PARAM = 228;
export const LINNSTRUMENT_SWITCH2_ASSIGNMENT_PARAM = 229;

export function createNrpnDecoderState() {
  return {
    byChannel: new Map(),
  };
}

export function clearNrpnDecoderState(state) {
  if (!state?.byChannel || typeof state.byChannel.clear !== "function") {
    return;
  }
  state.byChannel.clear();
}

export function consumeNrpnFromControlChange(state, event) {
  if (!state?.byChannel || !event) {
    return null;
  }
  const channel = event.channel;
  const controller = event.controller;
  const value7 = event.value7;
  if (!Number.isFinite(channel) || !Number.isFinite(controller) || !Number.isFinite(value7)) {
    return null;
  }

  const channelState = getOrCreateChannelState(state, channel);
  if (controller === 99) {
    channelState.paramMsb = value7;
    return null;
  }
  if (controller === 98) {
    channelState.paramLsb = value7;
    return null;
  }
  if (controller === 6) {
    channelState.valueMsb = value7;
    if (!hasCompleteParamNumber(channelState)) {
      return null;
    }
    return {
      channel,
      paramNumber: (channelState.paramMsb << 7) | channelState.paramLsb,
      value7,
    };
  }
  if (controller === 38) {
    channelState.valueLsb = value7;
    return null;
  }
  return null;
}

export function consumeUserFirmwareModeNotification(state, event) {
  const nrpn = consumeNrpnFromControlChange(state, event);
  if (!nrpn) {
    return null;
  }
  if (nrpn.channel !== LINNSTRUMENT_USER_FIRMWARE_MODE_NOTIFY_CHANNEL) {
    return null;
  }
  if (nrpn.paramNumber !== LINNSTRUMENT_USER_FIRMWARE_MODE_PARAM) {
    return null;
  }
  if (nrpn.value7 === 0) {
    return false;
  }
  if (nrpn.value7 === 1) {
    return true;
  }
  return null;
}

function getOrCreateChannelState(state, channel) {
  const existing = state.byChannel.get(channel);
  if (existing) {
    return existing;
  }
  const channelState = {
    paramMsb: null,
    paramLsb: null,
    valueMsb: null,
    valueLsb: null,
  };
  state.byChannel.set(channel, channelState);
  return channelState;
}

function hasCompleteParamNumber(channelState) {
  return Number.isFinite(channelState.paramMsb) && Number.isFinite(channelState.paramLsb);
}
