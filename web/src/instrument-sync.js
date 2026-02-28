export const NRPN = {
  SPLIT_LEFT_MIDI_MODE: 0,
  SPLIT_LEFT_MAIN_CHANNEL: 1,
  SPLIT_LEFT_PER_NOTE_CHANNEL_START: 2,
  SPLIT_LEFT_PER_NOTE_CHANNEL_END: 17,
  SPLIT_LEFT_BEND_RANGE: 19,
  SPLIT_RIGHT_BEND_RANGE: 119,
  SPLIT_LEFT_OCTAVE: 36,
  SPLIT_LEFT_TRANSPOSE_PITCH: 37,
  GLOBAL_SPLIT_ACTIVE: 200,
  GLOBAL_ROW_OFFSET: 227,
  DEVICE_USER_FIRMWARE_MODE: 245,
};

export const STANDARD_LAYOUT = {
  DEVICE_START_NOTE: 0,
  SPLIT_LEFT_OCTAVE: 3,
  SPLIT_LEFT_TRANSPOSE_PITCH: 1,
};

function nrpn(value) {
  return [value >> 7, value & 0x7f];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function setLinnStrumentParamValue(output, paramNumber, value, sleepMs = 24) {
  if (!output) {
    throw new Error("Missing LinnStrument output");
  }
  output.sendNrpnValue(nrpn(paramNumber), nrpn(value), { channels: 1 });
  await sleep(sleepMs);
}

export async function applyLinnStrumentStandardLayout(output) {
  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SPLIT_ACTIVE, 0);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_ROW_OFFSET, 0);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_OCTAVE, STANDARD_LAYOUT.SPLIT_LEFT_OCTAVE);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_TRANSPOSE_PITCH, STANDARD_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH);
}

export async function applyLinnStrumentMpeInputMode(output, enabled) {
  if (enabled) {
    // Channel Per Note mode, main channel 1, member note channels 2..16.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1);
    for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param++) {
      const midiChannel = param - 1;
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0);
    }
    return;
  }

  // One Channel mode on channel 1 for non-MPE operation.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 0);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1);
}
