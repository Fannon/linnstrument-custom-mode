export const NRPN = {
  SPLIT_LEFT_MIDI_MODE: 0,
  SPLIT_LEFT_MAIN_CHANNEL: 1,
  SPLIT_LEFT_PER_NOTE_CHANNEL_START: 2,
  SPLIT_LEFT_PER_NOTE_CHANNEL_END: 17,
  SPLIT_LEFT_BEND_RANGE: 19,
  SPLIT_LEFT_SEND_Z: 27,
  SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z: 28,
  SPLIT_RIGHT_BEND_RANGE: 119,
  SPLIT_LEFT_OCTAVE: 36,
  SPLIT_LEFT_TRANSPOSE_PITCH: 37,
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 38,
  GLOBAL_SPLIT_ACTIVE: 200,
  GLOBAL_ROW_OFFSET: 227,
  DEVICE_USER_FIRMWARE_MODE: 245,
  CURRENT_PRESET: 221,
};

export const CONTROL_MODE_LAYOUT = {
  DEVICE_START_NOTE: 0,
  SPLIT_LEFT_OCTAVE: 2, // -3 Octaves (required to map bottom-left pad to MIDI note 0)
  SPLIT_LEFT_TRANSPOSE_PITCH: 7, // 0 Pitch Transpose
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 0, // -6 Light Transpose
};

export const FACTORY_DEFAULT_LAYOUT = {
  SPLIT_LEFT_OCTAVE: 5, // 0 Octave offset
  SPLIT_LEFT_TRANSPOSE_PITCH: 7, // 0 Pitch Transpose
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 7, // 0 Light Transpose
  GLOBAL_ROW_OFFSET: 5, // Fourths
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
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_TRANSPOSE_PITCH, CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS, CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS);
}

export async function applyLinnStrumentMpeInputMode(output, enabled) {
  if (enabled) {
    // Channel Per Note mode, main channel 1, member note channels 2..16.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1);
    // In MPE mode, route Z to channel aftertouch.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 1);
    for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param++) {
      const midiChannel = param - 1;
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0);
    }
    return;
  }

  // One Channel mode on channel 1 for non-MPE operation.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 0);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1);
  // In non-MPE mode, route Z to poly aftertouch for key-independent pressure.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 0);
}

export async function exitLinnStrument(output, targetPreset = 1) {
  // 1. Ensure User Firmware is OFF first
  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0);
  
  // 2. Clear all User LEDs individually (CC 20, 21, 22)
  // This is slower but more reliable than a single CC 122 command.
  if (output?.channels?.[1]) {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 25; x++) {
        output.channels[1].sendControlChange(20, x + 1);
        output.channels[1].sendControlChange(21, y);
        output.channels[1].sendControlChange(22, 0);
      }
      await sleep(2); // Small breath between rows to avoid buffer overflow
    }
  }
  await sleep(64); // Final pause before NRPNs

  // 3. Set Row Offset to default Fourths (value 5)
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_ROW_OFFSET, FACTORY_DEFAULT_LAYOUT.GLOBAL_ROW_OFFSET);
  
  // 4. Ensure Split is OFF
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SPLIT_ACTIVE, 0);

  // 5. Reset Octave and Transposes to factory defaults (0 offset)
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_OCTAVE, FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_TRANSPOSE_PITCH, FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS, FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS);

  // 6. Reset Pitch Bend Range to 48 semitones (MPE Standard default used by midimech)
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_BEND_RANGE, 48);

  // 7. Reset MIDI Mode to Multi-channel (MPE style, default)
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1);

  // 8. Last, Restore to target Preset (default to 1, which is value 0)
  const presetValue = Math.max(0, Math.min(5, targetPreset - 1));
  await setLinnStrumentParamValue(output, NRPN.CURRENT_PRESET, presetValue);
}
