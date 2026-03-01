export const NRPN = {
  SPLIT_LEFT_MIDI_MODE: 0,
  SPLIT_LEFT_MAIN_CHANNEL: 1,
  SPLIT_LEFT_PER_NOTE_CHANNEL_START: 2,
  SPLIT_LEFT_PER_NOTE_CHANNEL_END: 17,
  SPLIT_LEFT_BEND_RANGE: 19,
  SPLIT_RIGHT_MIDI_MODE: 100,
  SPLIT_RIGHT_MAIN_CHANNEL: 101,
  SPLIT_RIGHT_PER_NOTE_CHANNEL_START: 102,
  SPLIT_RIGHT_PER_NOTE_CHANNEL_END: 117,
  SPLIT_RIGHT_SEND_Z: 127,
  SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z: 128,
  SPLIT_LEFT_SEND_Z: 27,
  SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z: 28,
  SPLIT_RIGHT_BEND_RANGE: 119,
  SPLIT_LEFT_OCTAVE: 36,
  SPLIT_LEFT_TRANSPOSE_PITCH: 37,
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 38,
  SPLIT_LEFT_LOW_ROW_MODE: 34,
  SPLIT_RIGHT_OCTAVE: 136,
  SPLIT_RIGHT_TRANSPOSE_PITCH: 137,
  SPLIT_RIGHT_TRANSPOSE_LIGHTS: 138,
  SPLIT_RIGHT_LOW_ROW_MODE: 134,
  GLOBAL_SPLIT_ACTIVE: 200,
  GLOBAL_SELECTED_SPLIT: 201,
  GLOBAL_ROW_OFFSET: 227,
  DEVICE_USER_FIRMWARE_MODE: 245,
  GLOBAL_SETTINGS_PRESET_LOAD: 243,
};

export const CONTROL_MODE_LAYOUT = {
  DEVICE_START_NOTE: 0,
  SPLIT_LEFT_OCTAVE: 2, // -3 Octaves
  SPLIT_LEFT_TRANSPOSE_PITCH: 7, // 0 Pitch Transpose
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 1, // -6 Light Transpose
};

export const FACTORY_DEFAULT_LAYOUT = {
  SPLIT_LEFT_OCTAVE: 5, // 0 Octave offset
  SPLIT_LEFT_TRANSPOSE_PITCH: 7, // 0 Pitch Transpose
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 7, // 0 Light Transpose
  GLOBAL_ROW_OFFSET: 5, // Fourths
};

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const DEFAULT_NRPN_PARAM_DELAY_MS = 30;
const STANDARD_LAYOUT_STAGE_DELAY_MS = 20;
const STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS = 40;
const MIDI_LED_OFF = 7;

function clampDelayMs(value, fallback, min = 0, max = 2000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function resolveTimingOptions(options = {}) {
  return {
    paramDelayMs: clampDelayMs(options.paramDelayMs, DEFAULT_NRPN_PARAM_DELAY_MS),
    applyControlModeToRightSplit: Boolean(options.applyControlModeToRightSplit),
  };
}

export async function setLinnStrumentParamValue(output, paramNumber, value, options = {}) {
  if (!output?.channels?.[1]) return;
  const channel = output.channels[1];
  const { paramDelayMs } = resolveTimingOptions(options);

  // LinnStrument requires an exact sequence of 6 CC messages for NRPN:
  // 1. NRPN MSB (CC 99)
  // 2. NRPN LSB (CC 98)
  // 3. Data Entry MSB (CC 6)
  // 4. Data Entry LSB (CC 38)
  // 5. Null Parameter MSB (CC 101 = 127)
  // 6. Null Parameter LSB (CC 100 = 127)

  const paramMsb = (paramNumber >> 7) & 0x7F;
  const paramLsb = paramNumber & 0x7F;
  const valueMsb = (value >> 7) & 0x7F;
  const valueLsb = value & 0x7F;

  console.log(`[MIDI TX DEBUG] NRPN Param=${paramNumber} (MSB:${paramMsb} LSB:${paramLsb}), Value=${value} (MSB:${valueMsb} LSB:${valueLsb})`);

  channel.sendControlChange(99, paramMsb);
  channel.sendControlChange(98, paramLsb);
  channel.sendControlChange(6, valueMsb);
  channel.sendControlChange(38, valueLsb);
  channel.sendControlChange(101, 127);
  channel.sendControlChange(100, 127);

  await sleep(paramDelayMs); // Throttle for hardware stability
}

async function applyControlModeTransposeTriplet(output, split = "left", timing = {}) {
  if (split === "right") {
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE, timing);
    await setLinnStrumentParamValue(
      output,
      NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
      timing,
    );
    await setLinnStrumentParamValue(
      output,
      NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
      timing,
    );
    return;
  }
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE, timing);
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_LEFT_TRANSPOSE_PITCH,
    CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    timing,
  );
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    timing,
  );
}

export async function applyLinnStrumentStandardLayout(output, options = {}) {
  const timing = resolveTimingOptions(options);

  // First step on init: clear custom LED layers so startup always begins from a dark surface.
  await clearAllCustomLedCells(output, { rowDelayMs: 1 });

  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SPLIT_ACTIVE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  // With split inactive, LinnStrument uses Global.currentPerSplit for note generation.
  // Force LEFT so no-overlap/control-mode mapping uses the intended split.
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SELECTED_SPLIT, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_ROW_OFFSET, 0, timing);
  // Ensure bottom row is a normal playable row so control-mode row 0 is addressable.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_LOW_ROW_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_LOW_ROW_MODE, 0, timing);
  await sleep(STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS);
  await applyControlModeTransposeTriplet(output, "left", timing);
  if (timing.applyControlModeToRightSplit) {
    await applyControlModeTransposeTriplet(output, "right", timing);
  }
  // Re-apply the critical triplet so LinnStrument lands on a deterministic note map.
  await sleep(STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS);
  await applyControlModeTransposeTriplet(output, "left", timing);
  if (timing.applyControlModeToRightSplit) {
    await applyControlModeTransposeTriplet(output, "right", timing);
  }
}

export async function applyLinnStrumentMpeInputMode(output, enabled, options = {}) {
  const timing = resolveTimingOptions(options);
  if (enabled) {
    // Channel Per Note mode, main channel 1, member note channels 2..16.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1, timing);
    // In MPE mode, route Z to channel aftertouch.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 1, timing);
    for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param++) {
      const midiChannel = param - 1;
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0, timing);
    }
    // Keep right split Per Split page aligned with the same MPE input assumptions.
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_MODE, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_SEND_Z, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 1, timing);
    for (let param = NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_END; param++) {
      const midiChannel = param - (NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START - 1);
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0, timing);
    }
    return;
  }

  // One Channel mode on channel 1 for non-MPE operation.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1, timing);
  // In non-MPE mode, route Z to poly aftertouch for key-independent pressure.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_SEND_Z, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 0, timing);
}

async function clearAllCustomLedCells(output, options = {}) {
  if (!output?.channels?.[1]) {
    return;
  }
  const rowDelayMs = clampDelayMs(options.rowDelayMs, 2, 0, 100);

  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 25; x++) {
      output.channels[1].sendControlChange(20, x + 1);
      output.channels[1].sendControlChange(21, y);
      output.channels[1].sendControlChange(22, MIDI_LED_OFF);
    }
    await sleep(rowDelayMs); // Small breath between rows to avoid buffer overflow
  }
}

export async function exitLinnStrument(output, targetPreset = 1, options = {}) {
  const timing = resolveTimingOptions(options);

  // 1) Ensure normal firmware mode is active first.
  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);

  // 2) Restore init-touched parameters to LinnStrument defaults.
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_ROW_OFFSET, FACTORY_DEFAULT_LAYOUT.GLOBAL_ROW_OFFSET, timing);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SPLIT_ACTIVE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SELECTED_SPLIT, 0, timing);

  // Left split transposition defaults (0, 0, 0 in UI terms).
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_OCTAVE, FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE, timing);
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_LEFT_TRANSPOSE_PITCH,
    FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    timing,
  );
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    timing,
  );

  // Right split transposition defaults too (safety against selected-split drift).
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_OCTAVE, FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE, timing);
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH,
    FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    timing,
  );
  await setLinnStrumentParamValue(
    output,
    NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS,
    FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    timing,
  );

  // Reset bend range defaults on both splits.
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_BEND_RANGE, 48, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_BEND_RANGE, 48, timing);

  // Restore left split MIDI defaults (factory-like MPE baseline).
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 1, timing);
  for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param++) {
    const midiChannel = param - 1;
    await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0, timing);
  }

  // 3) Finally load user preset, which should overwrite remaining preset-scoped defaults.
  const presetValue = Math.max(0, Math.min(5, targetPreset - 1));
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SETTINGS_PRESET_LOAD, presetValue, timing);
}
