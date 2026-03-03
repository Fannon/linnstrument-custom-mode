const NRPN_QUERY_PARAMETER = 299;
const NRPN_QUERY_RESPONSE_TIMEOUT_MS = 1200;
const NON_QUERYABLE_NRPN_PARAMS = new Set([62, 63, 64, 66, 162, 163, 164, 166, NRPN_QUERY_PARAMETER]);

const DEFAULT_NRPN_PARAM_DELAY_MS = 30;
const STANDARD_LAYOUT_STAGE_DELAY_MS = 20;
const STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS = 40;
const PRESET_LOAD_FIRMWARE_BOUNCE_DELAY_MS = 80;
const PRESET_LOAD_RETRY_COUNT = 2;
const MIDI_LED_BLACK = 7;
const KNOWN_DEFAULT_BEND_RANGE = 48;
const KNOWN_DEFAULT_PROFILE_TIMEOUT_MS = 1500;

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function getChannel(msg) {
  const data = msg?.message?.data || msg?.data || msg?.dataBytes;
  const status = data?.[0];
  if (Number.isFinite(status) && status >= 0x80 && status <= 0xef) {
    return (status & 0x0f) + 1;
  }

  const explicitChannel = msg?.message?.channel ?? msg?.channel;
  if (Number.isFinite(explicitChannel)) {
    if (explicitChannel >= 0 && explicitChannel <= 15) {
      return explicitChannel + 1;
    }
    return explicitChannel;
  }

  return 1;
}

function extractRawControlChangeEvent(msg) {
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

  return {
    controller,
    channel: getChannel(msg),
    value7,
  };
}

export const CONTROL_MODE_LAYOUT = Object.freeze({
  DEVICE_START_NOTE: 0,
  SPLIT_LEFT_OCTAVE: 2,
  SPLIT_LEFT_TRANSPOSE_PITCH: 7,
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 1,
});

export const FACTORY_DEFAULT_LAYOUT = Object.freeze({
  SPLIT_LEFT_OCTAVE: 5,
  SPLIT_LEFT_TRANSPOSE_PITCH: 7,
  SPLIT_LEFT_TRANSPOSE_LIGHTS: 7,
  GLOBAL_ROW_OFFSET: 5,
});

function freezeDefinition(definition) {
  return Object.freeze({
    ...definition,
    aliases: Object.freeze([...(definition.aliases || [])]),
  });
}

function buildNrpnDefinitions() {
  const byName = new Map();
  const add = (name, param, valueRange, meaning) => {
    if (byName.has(name)) {
      throw new Error(`Duplicate NRPN name: ${name}`);
    }
    byName.set(name, {
      name,
      param,
      valueRange,
      meaning,
      aliases: [],
    });
  };

  const addAlias = (aliasName, canonicalName) => {
    const canonical = byName.get(canonicalName);
    if (!canonical) {
      throw new Error(`Cannot add alias ${aliasName}, unknown canonical name ${canonicalName}`);
    }
    if (byName.has(aliasName)) {
      throw new Error(`Duplicate NRPN name: ${aliasName}`);
    }
    canonical.aliases.push(aliasName);
    byName.set(aliasName, {
      ...canonical,
      name: aliasName,
      aliases: [...canonical.aliases],
    });
  };

  const buildSplitDefinitions = (sideUpper, sideLabel, base) => {
    add(`${sideUpper}_MIDI_MODE`, base + 0, "0-2", `${sideLabel} split MIDI mode.`);
    add(`${sideUpper}_MAIN_CHANNEL`, base + 1, "1-16", `${sideLabel} split MIDI main channel.`);

    for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
      add(
        `${sideUpper}_MIDI_PER_NOTE_CHANNEL_${midiChannel}`,
        base + 1 + midiChannel,
        "0-1",
        `${sideLabel} split MIDI per-note membership for channel ${midiChannel}.`,
      );
    }

    add(`${sideUpper}_MIDI_PER_ROW_LOWEST_CHANNEL`, base + 18, "1-16", `${sideLabel} split MIDI per-row lowest channel.`);
    add(`${sideUpper}_BEND_RANGE`, base + 19, "1-96", `${sideLabel} split pitch bend range in semitones.`);
    add(`${sideUpper}_SEND_X`, base + 20, "0-1", `${sideLabel} split send X toggle.`);
    add(`${sideUpper}_PITCH_QUANTIZE`, base + 21, "0-1", `${sideLabel} split pitch quantize toggle.`);
    add(`${sideUpper}_PITCH_QUANTIZE_HOLD`, base + 22, "0-3", `${sideLabel} split pitch quantize hold mode.`);
    add(`${sideUpper}_PITCH_RESET_ON_RELEASE`, base + 23, "0-1", `${sideLabel} split pitch reset on release toggle.`);
    add(`${sideUpper}_SEND_Y`, base + 24, "0-1", `${sideLabel} split send Y toggle.`);
    add(`${sideUpper}_MIDI_CC_FOR_Y`, base + 25, "0-127", `${sideLabel} split MIDI CC for Y axis.`);
    add(`${sideUpper}_RELATIVE_Y`, base + 26, "0-1", `${sideLabel} split relative Y toggle.`);
    add(`${sideUpper}_SEND_Z`, base + 27, "0-1", `${sideLabel} split send Z toggle.`);
    add(`${sideUpper}_MIDI_EXPRESSION_FOR_Z`, base + 28, "0-2", `${sideLabel} split MIDI expression source for Z.`);
    add(`${sideUpper}_MIDI_CC_FOR_Z`, base + 29, "0-127", `${sideLabel} split MIDI CC for Z axis.`);
    add(`${sideUpper}_COLOR_MAIN`, base + 30, "1-6", `${sideLabel} split main color.`);
    add(`${sideUpper}_COLOR_ACCENT`, base + 31, "1-6", `${sideLabel} split accent color.`);
    add(`${sideUpper}_COLOR_PLAYED`, base + 32, "0-6", `${sideLabel} split played-note color.`);
    add(`${sideUpper}_COLOR_LOW_ROW`, base + 33, "1-6", `${sideLabel} split low-row color.`);
    add(`${sideUpper}_LOW_ROW_MODE`, base + 34, "0-7", `${sideLabel} split low-row mode.`);
    add(`${sideUpper}_SPECIAL`, base + 35, "0-4", `${sideLabel} split special mode.`);
    add(`${sideUpper}_OCTAVE`, base + 36, "0-10", `${sideLabel} split octave offset.`);
    add(`${sideUpper}_TRANSPOSE_PITCH`, base + 37, "0-14", `${sideLabel} split pitch transpose.`);
    add(`${sideUpper}_TRANSPOSE_LIGHTS`, base + 38, "0-14", `${sideLabel} split light transpose.`);
    add(`${sideUpper}_MIDI_EXPRESSION_FOR_Y`, base + 39, "0-2", `${sideLabel} split MIDI expression source for Y.`);

    for (let fader = 1; fader <= 8; fader += 1) {
      add(
        `${sideUpper}_MIDI_CC_FOR_FADER_${fader}`,
        base + 39 + fader,
        "0-128",
        `${sideLabel} split MIDI CC assignment for fader ${fader}.`,
      );
    }

    add(`${sideUpper}_LOW_ROW_X_BEHAVIOR`, base + 48, "0-1", `${sideLabel} split low-row X behavior.`);
    add(`${sideUpper}_MIDI_CC_FOR_LOW_ROW_X`, base + 49, "0-128", `${sideLabel} split MIDI CC for low-row X.`);
    add(`${sideUpper}_LOW_ROW_XYZ_BEHAVIOR`, base + 50, "0-1", `${sideLabel} split low-row XYZ behavior.`);
    add(`${sideUpper}_MIDI_CC_FOR_LOW_ROW_XYZ_X`, base + 51, "0-128", `${sideLabel} split MIDI CC for low-row XYZ X.`);
    add(`${sideUpper}_MIDI_CC_FOR_LOW_ROW_XYZ_Y`, base + 52, "0-128", `${sideLabel} split MIDI CC for low-row XYZ Y.`);
    add(`${sideUpper}_MIDI_CC_FOR_LOW_ROW_XYZ_Z`, base + 53, "0-128", `${sideLabel} split MIDI CC for low-row XYZ Z.`);
    add(`${sideUpper}_MIN_CC_VALUE_FOR_Y`, base + 54, "0-127", `${sideLabel} split minimum CC value for Y.`);
    add(`${sideUpper}_MAX_CC_VALUE_FOR_Y`, base + 55, "0-127", `${sideLabel} split maximum CC value for Y.`);
    add(`${sideUpper}_MIN_CC_VALUE_FOR_Z`, base + 56, "0-127", `${sideLabel} split minimum CC value for Z.`);
    add(`${sideUpper}_MAX_CC_VALUE_FOR_Z`, base + 57, "0-127", `${sideLabel} split maximum CC value for Z.`);
    add(`${sideUpper}_CC_VALUE_FOR_Z_14_BIT`, base + 58, "0-1", `${sideLabel} split 14-bit CC value for Z toggle.`);
    add(`${sideUpper}_INITIAL_VALUE_FOR_RELATIVE_Y`, base + 59, "0-127", `${sideLabel} split initial value for relative Y.`);
    add(`${sideUpper}_CHANNEL_PER_ROW_ORDER`, base + 60, "0-1", `${sideLabel} split channel-per-row order.`);
    add(`${sideUpper}_TOUCH_ANIMATION`, base + 61, "0-14", `${sideLabel} split touch animation.`);
    add(`${sideUpper}_SEQUENCER_TOGGLE_PLAY`, base + 62, "1", `${sideLabel} split sequencer toggle play trigger.`);
    add(`${sideUpper}_SEQUENCER_PREVIOUS_PATTERN`, base + 63, "1", `${sideLabel} split sequencer previous-pattern trigger.`);
    add(`${sideUpper}_SEQUENCER_NEXT_PATTERN`, base + 64, "1", `${sideLabel} split sequencer next-pattern trigger.`);
    add(`${sideUpper}_SEQUENCER_SELECT_PATTERN_NUMBER`, base + 65, "0-3", `${sideLabel} split sequencer pattern index.`);
    add(`${sideUpper}_SEQUENCER_TOGGLE_MUTE`, base + 66, "1", `${sideLabel} split sequencer mute trigger.`);
  };

  buildSplitDefinitions("SPLIT_LEFT", "Left", 0);
  buildSplitDefinitions("SPLIT_RIGHT", "Right", 100);

  add("GLOBAL_SPLIT_ACTIVE", 200, "0-1", "Global split active toggle.");
  add("GLOBAL_SELECTED_SPLIT", 201, "0-1", "Global selected split.");
  add("GLOBAL_SPLIT_POINT_COLUMN", 202, "2-25", "Global split point column.");

  const pitchClassNames = ["C", "CS", "D", "DS", "E", "F", "FS", "G", "GS", "A", "AS", "B"];
  for (let index = 0; index < pitchClassNames.length; index += 1) {
    const suffix = pitchClassNames[index];
    add(
      `GLOBAL_MAIN_NOTE_LIGHT_${suffix}`,
      203 + index,
      "0-1",
      `Global main-note light toggle for pitch class ${suffix}.`,
    );
  }
  for (let index = 0; index < pitchClassNames.length; index += 1) {
    const suffix = pitchClassNames[index];
    add(
      `GLOBAL_ACCENT_NOTE_LIGHT_${suffix}`,
      215 + index,
      "0-1",
      `Global accent-note light toggle for pitch class ${suffix}.`,
    );
  }

  add("GLOBAL_ROW_OFFSET", 227, "0-13", "Global row offset mode.");
  add("GLOBAL_SWITCH_1_ASSIGNMENT", 228, "0-17", "Global switch 1 assignment.");
  add("GLOBAL_SWITCH_2_ASSIGNMENT", 229, "0-17", "Global switch 2 assignment.");
  add("GLOBAL_FOOT_LEFT_ASSIGNMENT", 230, "0-17", "Global foot-left assignment.");
  add("GLOBAL_FOOT_RIGHT_ASSIGNMENT", 231, "0-17", "Global foot-right assignment.");
  add("GLOBAL_VELOCITY_SENSITIVITY", 232, "0-3", "Global velocity sensitivity.");
  add("GLOBAL_PRESSURE_SENSITIVITY", 233, "0-2", "Global pressure sensitivity.");
  add("DEVICE_MIDI_IO", 234, "0-1", "Device MIDI I/O source selection.");
  add("GLOBAL_ARP_DIRECTION", 235, "0-4", "Global arp direction.");
  add("GLOBAL_ARP_TEMPO_NOTE_VALUE", 236, "1-7", "Global arp tempo note value.");
  add("GLOBAL_ARP_OCTAVE_EXTENSION", 237, "0-2", "Global arp octave extension.");
  add("GLOBAL_CLOCK_BPM", 238, "1-360", "Global clock BPM without external clock.");
  add("GLOBAL_SWITCH_1_BOTH_SPLITS", 239, "0-1", "Global switch 1 applies to both splits.");
  add("GLOBAL_SWITCH_2_BOTH_SPLITS", 240, "0-1", "Global switch 2 applies to both splits.");
  add("GLOBAL_FOOT_LEFT_BOTH_SPLITS", 241, "0-1", "Global foot-left applies to both splits.");
  add("GLOBAL_FOOT_RIGHT_BOTH_SPLITS", 242, "0-1", "Global foot-right applies to both splits.");
  add("GLOBAL_SETTINGS_PRESET_LOAD", 243, "0-5", "Global settings preset load.");
  add("GLOBAL_PRESSURE_AFTERTOUCH", 244, "0-1", "Global pressure-aftertouch mode toggle.");
  add("DEVICE_USER_FIRMWARE_MODE", 245, "0-1", "Device user-firmware mode.");
  add("DEVICE_LEFT_HANDED_OPERATION", 246, "0-1", "Device left-handed operation toggle.");
  add("GLOBAL_ACTIVE_NOTE_LIGHTS_PRESET", 247, "0-11", "Global active-note-lights preset.");
  add("GLOBAL_MIDI_CC_FOR_SWITCH_CC65", 248, "0-127", "Legacy global MIDI CC for switch CC65.");
  add("GLOBAL_MIN_VALUE_FOR_VELOCITY", 249, "1-127", "Global minimum value for velocity.");
  add("GLOBAL_MAX_VALUE_FOR_VELOCITY", 250, "1-127", "Global maximum value for velocity.");
  add("GLOBAL_FIXED_VELOCITY_VALUE", 251, "1-127", "Global fixed velocity value.");
  add("DEVICE_MIN_INTERVAL_BETWEEN_MIDI_BYTES_USB", 252, "0-512", "Device minimum interval between MIDI bytes over USB.");
  add("GLOBAL_CUSTOM_ROW_OFFSET_INSTEAD_OF_OCTAVE", 253, "0-33", "Global custom row offset instead of octave.");
  add("DEVICE_MIDI_THROUGH", 254, "0-1", "Device MIDI through toggle.");
  add("GLOBAL_MIDI_CC_FOR_FOOT_LEFT_CC65", 255, "0-127", "Global MIDI CC for foot-left CC65.");
  add("GLOBAL_MIDI_CC_FOR_FOOT_RIGHT_CC65", 256, "0-127", "Global MIDI CC for foot-right CC65.");
  add("GLOBAL_MIDI_CC_FOR_SWITCH_1_CC65", 257, "0-127", "Global MIDI CC for switch 1 CC65.");
  add("GLOBAL_MIDI_CC_FOR_SWITCH_2_CC65", 258, "0-127", "Global MIDI CC for switch 2 CC65.");
  add("GLOBAL_MIDI_CC_FOR_FOOT_LEFT_SUSTAIN", 259, "0-127", "Global MIDI CC for foot-left sustain.");
  add("GLOBAL_MIDI_CC_FOR_FOOT_RIGHT_SUSTAIN", 260, "0-127", "Global MIDI CC for foot-right sustain.");
  add("GLOBAL_MIDI_CC_FOR_SWITCH_1_SUSTAIN", 261, "0-127", "Global MIDI CC for switch 1 sustain.");
  add("GLOBAL_MIDI_CC_FOR_SWITCH_2_SUSTAIN", 262, "0-127", "Global MIDI CC for switch 2 sustain.");

  for (let row = 1; row <= 8; row += 1) {
    add(
      `GLOBAL_GUITAR_TUNING_NOTE_ROW_${row}`,
      262 + row,
      "0-127",
      `Global guitar tuning note number for row ${row}.`,
    );
  }

  add("QUERY_PARAMETER_VALUE", NRPN_QUERY_PARAMETER, "any", "Query current value for an NRPN parameter when supported.");

  addAlias("SPLIT_LEFT_PER_NOTE_CHANNEL_START", "SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_1");
  addAlias("SPLIT_LEFT_PER_NOTE_CHANNEL_END", "SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_16");
  addAlias("SPLIT_RIGHT_PER_NOTE_CHANNEL_START", "SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_1");
  addAlias("SPLIT_RIGHT_PER_NOTE_CHANNEL_END", "SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_16");

  return byName;
}

const NRPN_DEFINITIONS_BY_NAME_MAP = buildNrpnDefinitions();

export const LS_NRPN_INFO_BY_NAME = Object.freeze(
  Object.fromEntries(
    Array.from(NRPN_DEFINITIONS_BY_NAME_MAP.values()).map((definition) => [definition.name, freezeDefinition(definition)]),
  ),
);

export const LS_NRPN_INFO_BY_PARAM = Object.freeze(
  Object.fromEntries(
    (() => {
      const byParam = new Map();
      for (const definition of Object.values(LS_NRPN_INFO_BY_NAME)) {
        const key = String(definition.param);
        if (!byParam.has(key)) {
          byParam.set(key, {
            param: definition.param,
            name: definition.name,
            valueRange: definition.valueRange,
            meaning: definition.meaning,
            aliases: [],
          });
          continue;
        }
        const current = byParam.get(key);
        if (definition.name !== current.name && !current.aliases.includes(definition.name)) {
          current.aliases.push(definition.name);
        }
      }
      return Array.from(byParam.entries()).map(([key, value]) => [key, freezeDefinition(value)]);
    })(),
  ),
);

export const NRPN = Object.freeze(
  Object.fromEntries(
    Object.values(LS_NRPN_INFO_BY_NAME).map((definition) => [definition.name, definition.param]),
  ),
);

function buildExpectedKnownNrpnParameters() {
  const params = [];
  const pushRange = (start, endInclusive) => {
    for (let param = start; param <= endInclusive; param += 1) {
      params.push(param);
    }
  };
  pushRange(0, 66);
  pushRange(100, 166);
  pushRange(200, 270);
  params.push(NRPN_QUERY_PARAMETER);
  return params;
}

export const LS_KNOWN_NRPN_PARAMS = Object.freeze(buildExpectedKnownNrpnParameters());

export const NRPN_COVERAGE = Object.freeze((() => {
  const definedParams = new Set(Object.values(LS_NRPN_INFO_BY_PARAM).map((definition) => definition.param));
  const missingParams = LS_KNOWN_NRPN_PARAMS.filter((param) => !definedParams.has(param));
  return {
    expectedCount: LS_KNOWN_NRPN_PARAMS.length,
    definedCount: definedParams.size,
    missingParams: Object.freeze([...missingParams]),
    complete: missingParams.length === 0,
  };
})());

if (!NRPN_COVERAGE.complete) {
  throw new Error(`[ls-helper] NRPN definition coverage is incomplete: ${JSON.stringify(NRPN_COVERAGE)}`);
}

/** @typedef {0|1} LsBinaryToggleValue */
/** @typedef {0|1|2} LsMidiModeValue */
/** @typedef {0|1|2} LsExpressionModeValue */
/** @typedef {0|1} LsSplitSelectValue */
/** @typedef {0|1} LsFirmwareModeValue */
/** @typedef {0|1} LsPerNoteMembershipValue */

/** @type {{ readonly OFF: 0, readonly ON: 1 }} */
const BINARY_TOGGLE = Object.freeze({ OFF: 0, ON: 1 });
/** @type {{ readonly ONE_CHANNEL: 0, readonly CHANNEL_PER_NOTE: 1, readonly CHANNEL_PER_ROW: 2 }} */
const MIDI_MODE = Object.freeze({ ONE_CHANNEL: 0, CHANNEL_PER_NOTE: 1, CHANNEL_PER_ROW: 2 });
/** @type {{ readonly POLY_AFTERTOUCH: 0, readonly CHANNEL_PRESSURE: 1, readonly CC: 2 }} */
const MIDI_EXPRESSION = Object.freeze({ POLY_AFTERTOUCH: 0, CHANNEL_PRESSURE: 1, CC: 2 });
/** @type {{ readonly LEFT: 0, readonly RIGHT: 1 }} */
const SELECTED_SPLIT = Object.freeze({ LEFT: 0, RIGHT: 1 });
/** @type {{ readonly FIRMWARE: 0, readonly USER: 1 }} */
const USER_FIRMWARE_MODE = Object.freeze({ FIRMWARE: 0, USER: 1 });
/** @type {{ readonly EXCLUDED: 0, readonly INCLUDED: 1 }} */
const PER_NOTE_CHANNEL_MEMBERSHIP = Object.freeze({ EXCLUDED: 0, INCLUDED: 1 });
/** @type {{ readonly OFF: 0, readonly MEDIUM: 1, readonly FAST: 2, readonly SLOW: 3 }} */
const PITCH_QUANTIZE_HOLD = Object.freeze({ OFF: 0, MEDIUM: 1, FAST: 2, SLOW: 3 });
/** @type {{ readonly OFF: 0, readonly SUSTAIN: 1, readonly RESTRIKE: 2, readonly STRUM: 3, readonly ARPEGGIATOR: 4, readonly BEND: 5, readonly CC1: 6, readonly CC16_18: 7 }} */
const LOW_ROW_MODE = Object.freeze({
  OFF: 0,
  SUSTAIN: 1,
  RESTRIKE: 2,
  STRUM: 3,
  ARPEGGIATOR: 4,
  BEND: 5,
  CC1: 6,
  CC16_18: 7,
});
/** @type {{ readonly OFF: 0, readonly ARPEGGIATOR: 1, readonly CC_FADERS: 2, readonly STRUM: 3, readonly SEQUENCER: 4 }} */
const SPECIAL_MODE = Object.freeze({ OFF: 0, ARPEGGIATOR: 1, CC_FADERS: 2, STRUM: 3, SEQUENCER: 4 });
/** @type {{ readonly NORMAL: 0, readonly REVERSED: 1 }} */
const CHANNEL_PER_ROW_ORDER = Object.freeze({ NORMAL: 0, REVERSED: 1 });
/** @type {{ readonly SAME: 0, readonly CROSSES: 1, readonly CIRCLES: 2, readonly SQUARES: 3, readonly DIAMONDS: 4, readonly STARS: 5, readonly SPARKLES: 6, readonly CURTAINS: 7, readonly BLINDS: 8, readonly TARGETS: 9, readonly UP: 10, readonly DOWN: 11, readonly LEFT: 12, readonly RIGHT: 13, readonly ORBITS: 14 }} */
const TOUCH_ANIMATION = Object.freeze({
  SAME: 0,
  CROSSES: 1,
  CIRCLES: 2,
  SQUARES: 3,
  DIAMONDS: 4,
  STARS: 5,
  SPARKLES: 6,
  CURTAINS: 7,
  BLINDS: 8,
  TARGETS: 9,
  UP: 10,
  DOWN: 11,
  LEFT: 12,
  RIGHT: 13,
  ORBITS: 14,
});
/** @type {{ readonly OCT_DOWN: 0, readonly OCT_UP: 1, readonly SUSTAIN: 2, readonly CC65: 3, readonly ARP: 4, readonly ALT_SPLIT: 5, readonly AUTO_OCTAVE: 6, readonly TAP_TEMPO: 7, readonly LEGATO: 8, readonly LATCH: 9, readonly PRESET_UP: 10, readonly PRESET_DOWN: 11, readonly REVERSE_PITCH_X: 12, readonly SEQUENCER_PLAY: 13, readonly SEQUENCER_PREVIOUS: 14, readonly SEQUENCER_NEXT: 15, readonly SEND_MIDI_CLOCK: 16, readonly SEQUENCER_MUTE: 17 }} */
const SWITCH_ASSIGNMENT = Object.freeze({
  OCT_DOWN: 0,
  OCT_UP: 1,
  SUSTAIN: 2,
  CC65: 3,
  ARP: 4,
  ALT_SPLIT: 5,
  AUTO_OCTAVE: 6,
  TAP_TEMPO: 7,
  LEGATO: 8,
  LATCH: 9,
  PRESET_UP: 10,
  PRESET_DOWN: 11,
  REVERSE_PITCH_X: 12,
  SEQUENCER_PLAY: 13,
  SEQUENCER_PREVIOUS: 14,
  SEQUENCER_NEXT: 15,
  SEND_MIDI_CLOCK: 16,
  SEQUENCER_MUTE: 17,
});
/** @type {{ readonly LOW: 0, readonly MEDIUM: 1, readonly HIGH: 2, readonly FIXED: 3 }} */
const VELOCITY_SENSITIVITY = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2, FIXED: 3 });
/** @type {{ readonly LOW: 0, readonly MEDIUM: 1, readonly HIGH: 2 }} */
const PRESSURE_SENSITIVITY = Object.freeze({ LOW: 0, MEDIUM: 1, HIGH: 2 });
/** @type {{ readonly MIDI_JACKS: 0, readonly USB: 1 }} */
const MIDI_IO_SOURCE = Object.freeze({ MIDI_JACKS: 0, USB: 1 });
/** @type {{ readonly UP: 0, readonly DOWN: 1, readonly UP_DOWN: 2, readonly RANDOM: 3, readonly REPLAY_ALL: 4 }} */
const ARP_DIRECTION = Object.freeze({ UP: 0, DOWN: 1, UP_DOWN: 2, RANDOM: 3, REPLAY_ALL: 4 });
/** @type {{ readonly EIGHTH: 1, readonly EIGHTH_TRIPLET: 2, readonly SIXTEENTH: 3, readonly SIXTEENTH_SWING: 4, readonly SIXTEENTH_TRIPLET: 5, readonly THIRTY_SECOND: 6, readonly THIRTY_SECOND_TRIPLET: 7 }} */
const ARP_TEMPO_NOTE_VALUE = Object.freeze({
  EIGHTH: 1,
  EIGHTH_TRIPLET: 2,
  SIXTEENTH: 3,
  SIXTEENTH_SWING: 4,
  SIXTEENTH_TRIPLET: 5,
  THIRTY_SECOND: 6,
  THIRTY_SECOND_TRIPLET: 7,
});
/** @type {{ readonly NONE: 0, readonly PLUS_1: 1, readonly PLUS_2: 2 }} */
const ARP_OCTAVE_EXTENSION = Object.freeze({ NONE: 0, PLUS_1: 1, PLUS_2: 2 });
/** @type {{ readonly PRESET_1: 0, readonly PRESET_2: 1, readonly PRESET_3: 2, readonly PRESET_4: 3, readonly PRESET_5: 4, readonly PRESET_6: 5 }} */
const SETTINGS_PRESET_LOAD = Object.freeze({
  PRESET_1: 0,
  PRESET_2: 1,
  PRESET_3: 2,
  PRESET_4: 3,
  PRESET_5: 4,
  PRESET_6: 5,
});
/** @type {{ readonly RED: 1, readonly YELLOW: 2, readonly GREEN: 3, readonly CYAN: 4, readonly BLUE: 5, readonly MAGENTA: 6, readonly BLACK: 7, readonly WHITE: 8, readonly ORANGE: 9, readonly LIME: 10, readonly PINK: 11 }} */
const LED_COLOR = Object.freeze({
  RED: 1,
  YELLOW: 2,
  GREEN: 3,
  CYAN: 4,
  BLUE: 5,
  MAGENTA: 6,
  BLACK: 7,
  WHITE: 8,
  ORANGE: 9,
  LIME: 10,
  PINK: 11,
});

export const LS_ENUMS = Object.freeze({
  BINARY_TOGGLE,
  MIDI_MODE,
  MIDI_EXPRESSION,
  SELECTED_SPLIT,
  USER_FIRMWARE_MODE,
  PER_NOTE_CHANNEL_MEMBERSHIP,
  PITCH_QUANTIZE_HOLD,
  LOW_ROW_MODE,
  SPECIAL_MODE,
  CHANNEL_PER_ROW_ORDER,
  TOUCH_ANIMATION,
  SWITCH_ASSIGNMENT,
  VELOCITY_SENSITIVITY,
  PRESSURE_SENSITIVITY,
  MIDI_IO_SOURCE,
  ARP_DIRECTION,
  ARP_TEMPO_NOTE_VALUE,
  ARP_OCTAVE_EXTENSION,
  SETTINGS_PRESET_LOAD,
  LED_COLOR,
});

export const LS_PARAM_ENUMS = Object.freeze((() => {
  const byName = {
    DEVICE_USER_FIRMWARE_MODE: USER_FIRMWARE_MODE,
    DEVICE_MIDI_IO: MIDI_IO_SOURCE,
    DEVICE_MIDI_THROUGH: BINARY_TOGGLE,
    DEVICE_LEFT_HANDED_OPERATION: BINARY_TOGGLE,
    GLOBAL_SPLIT_ACTIVE: BINARY_TOGGLE,
    GLOBAL_SELECTED_SPLIT: SELECTED_SPLIT,
    GLOBAL_SWITCH_1_ASSIGNMENT: SWITCH_ASSIGNMENT,
    GLOBAL_SWITCH_2_ASSIGNMENT: SWITCH_ASSIGNMENT,
    GLOBAL_FOOT_LEFT_ASSIGNMENT: SWITCH_ASSIGNMENT,
    GLOBAL_FOOT_RIGHT_ASSIGNMENT: SWITCH_ASSIGNMENT,
    GLOBAL_VELOCITY_SENSITIVITY: VELOCITY_SENSITIVITY,
    GLOBAL_PRESSURE_SENSITIVITY: PRESSURE_SENSITIVITY,
    GLOBAL_ARP_DIRECTION: ARP_DIRECTION,
    GLOBAL_ARP_TEMPO_NOTE_VALUE: ARP_TEMPO_NOTE_VALUE,
    GLOBAL_ARP_OCTAVE_EXTENSION: ARP_OCTAVE_EXTENSION,
    GLOBAL_SWITCH_1_BOTH_SPLITS: BINARY_TOGGLE,
    GLOBAL_SWITCH_2_BOTH_SPLITS: BINARY_TOGGLE,
    GLOBAL_FOOT_LEFT_BOTH_SPLITS: BINARY_TOGGLE,
    GLOBAL_FOOT_RIGHT_BOTH_SPLITS: BINARY_TOGGLE,
    GLOBAL_SETTINGS_PRESET_LOAD: SETTINGS_PRESET_LOAD,
    GLOBAL_PRESSURE_AFTERTOUCH: BINARY_TOGGLE,
  };

  const pitchClassNames = ["C", "CS", "D", "DS", "E", "F", "FS", "G", "GS", "A", "AS", "B"];
  for (const suffix of pitchClassNames) {
    byName[`GLOBAL_MAIN_NOTE_LIGHT_${suffix}`] = BINARY_TOGGLE;
    byName[`GLOBAL_ACCENT_NOTE_LIGHT_${suffix}`] = BINARY_TOGGLE;
  }

  for (const split of ["SPLIT_LEFT", "SPLIT_RIGHT"]) {
    byName[`${split}_MIDI_MODE`] = MIDI_MODE;
    byName[`${split}_SEND_X`] = BINARY_TOGGLE;
    byName[`${split}_PITCH_QUANTIZE`] = BINARY_TOGGLE;
    byName[`${split}_PITCH_QUANTIZE_HOLD`] = PITCH_QUANTIZE_HOLD;
    byName[`${split}_PITCH_RESET_ON_RELEASE`] = BINARY_TOGGLE;
    byName[`${split}_SEND_Y`] = BINARY_TOGGLE;
    byName[`${split}_RELATIVE_Y`] = BINARY_TOGGLE;
    byName[`${split}_SEND_Z`] = BINARY_TOGGLE;
    byName[`${split}_MIDI_EXPRESSION_FOR_Z`] = MIDI_EXPRESSION;
    byName[`${split}_LOW_ROW_MODE`] = LOW_ROW_MODE;
    byName[`${split}_SPECIAL`] = SPECIAL_MODE;
    byName[`${split}_MIDI_EXPRESSION_FOR_Y`] = MIDI_EXPRESSION;
    byName[`${split}_LOW_ROW_X_BEHAVIOR`] = BINARY_TOGGLE;
    byName[`${split}_LOW_ROW_XYZ_BEHAVIOR`] = BINARY_TOGGLE;
    byName[`${split}_CC_VALUE_FOR_Z_14_BIT`] = BINARY_TOGGLE;
    byName[`${split}_CHANNEL_PER_ROW_ORDER`] = CHANNEL_PER_ROW_ORDER;
    byName[`${split}_TOUCH_ANIMATION`] = TOUCH_ANIMATION;
    for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
      byName[`${split}_MIDI_PER_NOTE_CHANNEL_${midiChannel}`] = PER_NOTE_CHANNEL_MEMBERSHIP;
    }
  }

  return byName;
})());

const UNKNOWN_PARAM_ENUM_NAMES = Object.keys(LS_PARAM_ENUMS).filter((name) => !Object.hasOwn(LS_NRPN_INFO_BY_NAME, name));
if (UNKNOWN_PARAM_ENUM_NAMES.length > 0) {
  console.warn("[ls-helper] Param enum map has unknown NRPN names", UNKNOWN_PARAM_ENUM_NAMES);
}

function buildControlModeChangedParamList() {
  const params = [
    NRPN.DEVICE_USER_FIRMWARE_MODE,
    NRPN.GLOBAL_SPLIT_ACTIVE,
    NRPN.GLOBAL_SELECTED_SPLIT,
    NRPN.GLOBAL_ROW_OFFSET,
    NRPN.SPLIT_LEFT_LOW_ROW_MODE,
    NRPN.SPLIT_RIGHT_LOW_ROW_MODE,
    NRPN.SPLIT_LEFT_OCTAVE,
    NRPN.SPLIT_LEFT_TRANSPOSE_PITCH,
    NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    NRPN.SPLIT_RIGHT_OCTAVE,
    NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH,
    NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS,
    NRPN.SPLIT_LEFT_MIDI_MODE,
    NRPN.SPLIT_LEFT_MAIN_CHANNEL,
    NRPN.SPLIT_LEFT_SEND_Z,
    NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z,
    NRPN.SPLIT_RIGHT_MIDI_MODE,
    NRPN.SPLIT_RIGHT_MAIN_CHANNEL,
    NRPN.SPLIT_RIGHT_SEND_Z,
    NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z,
    NRPN.SPLIT_LEFT_BEND_RANGE,
    NRPN.SPLIT_RIGHT_BEND_RANGE,
  ];

  for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
    params.push(NRPN[`SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`]);
  }
  for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
    params.push(NRPN[`SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`]);
  }

  return [...new Set(params)].sort((a, b) => a - b);
}

export const CONTROL_MODE_CHANGED_NRPN_PARAMS = Object.freeze(buildControlModeChangedParamList());

export function buildKnownDefaultNrpnParamMap(options = {}) {
  const mpeEnabled = Boolean(options?.mpeEnabled);
  const bendRange = clampInt(options?.bendRange, 0, 96, KNOWN_DEFAULT_BEND_RANGE);
  const params = {
    [NRPN.DEVICE_USER_FIRMWARE_MODE]: 0,
    [NRPN.GLOBAL_SPLIT_ACTIVE]: 0,
    [NRPN.GLOBAL_SELECTED_SPLIT]: 0,
    [NRPN.GLOBAL_ROW_OFFSET]: FACTORY_DEFAULT_LAYOUT.GLOBAL_ROW_OFFSET,
    [NRPN.SPLIT_LEFT_LOW_ROW_MODE]: 0,
    [NRPN.SPLIT_RIGHT_LOW_ROW_MODE]: 0,
    [NRPN.SPLIT_LEFT_OCTAVE]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE,
    [NRPN.SPLIT_LEFT_TRANSPOSE_PITCH]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    [NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    [NRPN.SPLIT_RIGHT_OCTAVE]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE,
    [NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    [NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS]: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    [NRPN.SPLIT_LEFT_BEND_RANGE]: bendRange,
    [NRPN.SPLIT_RIGHT_BEND_RANGE]: bendRange,
  };

  if (mpeEnabled) {
    params[NRPN.SPLIT_LEFT_MIDI_MODE] = MIDI_MODE.CHANNEL_PER_NOTE;
    params[NRPN.SPLIT_LEFT_MAIN_CHANNEL] = 1;
    params[NRPN.SPLIT_LEFT_SEND_Z] = BINARY_TOGGLE.ON;
    params[NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z] = MIDI_EXPRESSION.CHANNEL_PRESSURE;
    params[NRPN.SPLIT_RIGHT_MIDI_MODE] = MIDI_MODE.CHANNEL_PER_NOTE;
    params[NRPN.SPLIT_RIGHT_MAIN_CHANNEL] = 1;
    params[NRPN.SPLIT_RIGHT_SEND_Z] = BINARY_TOGGLE.ON;
    params[NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z] = MIDI_EXPRESSION.CHANNEL_PRESSURE;

    for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
      const membershipValue = midiChannel >= 2 ? PER_NOTE_CHANNEL_MEMBERSHIP.INCLUDED : PER_NOTE_CHANNEL_MEMBERSHIP.EXCLUDED;
      params[NRPN[`SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`]] = membershipValue;
      params[NRPN[`SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`]] = membershipValue;
    }
  } else {
    params[NRPN.SPLIT_LEFT_MIDI_MODE] = MIDI_MODE.ONE_CHANNEL;
    params[NRPN.SPLIT_LEFT_MAIN_CHANNEL] = 1;
    params[NRPN.SPLIT_LEFT_SEND_Z] = BINARY_TOGGLE.ON;
    params[NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z] = MIDI_EXPRESSION.POLY_AFTERTOUCH;
    params[NRPN.SPLIT_RIGHT_MIDI_MODE] = MIDI_MODE.ONE_CHANNEL;
    params[NRPN.SPLIT_RIGHT_MAIN_CHANNEL] = 1;
    params[NRPN.SPLIT_RIGHT_SEND_Z] = BINARY_TOGGLE.ON;
    params[NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z] = MIDI_EXPRESSION.POLY_AFTERTOUCH;
  }

  return params;
}

export function sleep(ms) {
  const durationMs = clampInt(ms, 0, 60_000, 0);
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function clampDelayMs(value, fallback, min = 0, max = 2000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function clampMidi7(value, fallback = 0) {
  return clampInt(value, 0, 127, fallback);
}

function resolveTimingOptions(options = {}) {
  return {
    paramDelayMs: clampDelayMs(options.paramDelayMs, DEFAULT_NRPN_PARAM_DELAY_MS),
    applyControlModeToRightSplit: Boolean(options.applyControlModeToRightSplit),
  };
}

export async function setLinnStrumentParamValue(output, paramNumber, value, options = {}) {
  if (!output?.channels?.[1]) {
    return;
  }

  const channel = output.channels[1];
  const { paramDelayMs } = resolveTimingOptions(options);
  const param = clampInt(paramNumber, 0, 16383, 0);
  const normalizedValue = clampInt(value, 0, 16383, 0);

  const paramMsb = (param >> 7) & 0x7f;
  const paramLsb = param & 0x7f;
  const valueMsb = (normalizedValue >> 7) & 0x7f;
  const valueLsb = normalizedValue & 0x7f;

  channel.sendControlChange(99, paramMsb);
  channel.sendControlChange(98, paramLsb);
  channel.sendControlChange(6, valueMsb);
  channel.sendControlChange(38, valueLsb);
  channel.sendControlChange(101, 127);
  channel.sendControlChange(100, 127);

  await sleep(paramDelayMs);
}

async function clearLedCells(output, options = {}) {
  if (!output?.channels?.[1]) {
    return;
  }

  const rowDelayMs = clampDelayMs(options.rowDelayMs, 2, 0, 100);
  const ledColor = clampMidi7(options.ledColor, MIDI_LED_BLACK);
  const preserveControlStrip = options.preserveControlStrip !== false;
  const xStart = preserveControlStrip ? 1 : 0;

  for (let y = 0; y < 8; y += 1) {
    for (let x = xStart; x < 25; x += 1) {
      output.channels[1].sendControlChange(20, x);
      output.channels[1].sendControlChange(21, y);
      output.channels[1].sendControlChange(22, ledColor);
    }
    if (rowDelayMs > 0) {
      await sleep(rowDelayMs);
    }
  }
}

export async function sweepLinnStrumentLightsOff(output, options = {}) {
  await clearLedCells(output, options);
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

  await clearLedCells(output, { rowDelayMs: 8, ledColor: MIDI_LED_BLACK });

  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SPLIT_ACTIVE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_SELECTED_SPLIT, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await setLinnStrumentParamValue(output, NRPN.GLOBAL_ROW_OFFSET, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_LOW_ROW_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_LOW_ROW_MODE, 0, timing);

  await sleep(STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS);
  await applyControlModeTransposeTriplet(output, "left", timing);
  if (timing.applyControlModeToRightSplit) {
    await applyControlModeTransposeTriplet(output, "right", timing);
  }

  await sleep(STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS);
  await applyControlModeTransposeTriplet(output, "left", timing);
  if (timing.applyControlModeToRightSplit) {
    await applyControlModeTransposeTriplet(output, "right", timing);
  }
}

export async function applyLinnStrumentMpeInputMode(output, enabled, options = {}) {
  const timing = resolveTimingOptions(options);

  if (enabled) {
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 1, timing);
    for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
      const param = NRPN[`SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`];
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0, timing);
    }

    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_MODE, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_SEND_Z, 1, timing);
    await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 1, timing);
    for (let midiChannel = 1; midiChannel <= 16; midiChannel += 1) {
      const param = NRPN[`SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_${midiChannel}`];
      await setLinnStrumentParamValue(output, param, midiChannel >= 2 ? 1 : 0, timing);
    }
    return;
  }

  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_SEND_Z, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 0, timing);

  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_MODE, 0, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_SEND_Z, 1, timing);
  await setLinnStrumentParamValue(output, NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 0, timing);
}

export async function loadLinnStrumentPreset(output, presetNumber = 1, options = {}) {
  const timing = resolveTimingOptions(options);
  const bounceUserFirmware = options.bounceUserFirmware === true;
  const retryCount = clampDelayMs(options.retryCount, PRESET_LOAD_RETRY_COUNT, 1, 4);
  const normalizedPreset = clampDelayMs(presetNumber, 1, 1, 6);
  const presetValue = normalizedPreset - 1;

  if (bounceUserFirmware) {
    await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 1, timing);
    await sleep(PRESET_LOAD_FIRMWARE_BOUNCE_DELAY_MS);
    await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0, timing);
    await sleep(PRESET_LOAD_FIRMWARE_BOUNCE_DELAY_MS);
  }

  for (let attempt = 0; attempt < retryCount; attempt += 1) {
    await setLinnStrumentParamValue(output, NRPN.GLOBAL_SETTINGS_PRESET_LOAD, presetValue, timing);
    if (attempt + 1 < retryCount) {
      await sleep(STANDARD_LAYOUT_CRITICAL_RETRY_DELAY_MS);
    }
  }
}

function parseNrpnControlChangeMessage(msg) {
  const event = extractRawControlChangeEvent(msg);
  if (!event) {
    return null;
  }
  return {
    controller: event.controller,
    value7: event.value7,
    channel: clampInt(event.channel, 1, 16, 1),
  };
}

function createNrpnResponseReader(onNrpnMessage) {
  const byChannel = new Map();
  return (msg) => {
    const event = parseNrpnControlChangeMessage(msg);
    if (!event) {
      return;
    }
    const key = event.channel;
    const channelState = byChannel.get(key) || { paramMsb: null, paramLsb: null, valueMsb: null };
    switch (event.controller) {
      case 99:
        channelState.paramMsb = event.value7;
        break;
      case 98:
        channelState.paramLsb = event.value7;
        break;
      case 6:
        channelState.valueMsb = event.value7;
        break;
      case 38:
        if (
          Number.isFinite(channelState.paramMsb) &&
          Number.isFinite(channelState.paramLsb) &&
          Number.isFinite(channelState.valueMsb)
        ) {
          const param = (channelState.paramMsb << 7) + channelState.paramLsb;
          const value = (channelState.valueMsb << 7) + event.value7;
          onNrpnMessage({ param, value, channel: event.channel });
        }
        channelState.valueMsb = null;
        break;
      default:
        break;
    }
    byChannel.set(key, channelState);
  };
}

function buildQueryableParamList() {
  return LS_KNOWN_NRPN_PARAMS.filter(
    (param) => param !== NRPN_QUERY_PARAMETER && !NON_QUERYABLE_NRPN_PARAMS.has(param),
  );
}

function normalizeQueryParams(inputParams = null) {
  if (!Array.isArray(inputParams) || inputParams.length === 0) {
    return buildQueryableParamList();
  }

  const sanitized = [];
  const seen = new Set();
  for (const rawParam of inputParams) {
    const param = clampInt(rawParam, 0, 16383, -1);
    if (param < 0 || NON_QUERYABLE_NRPN_PARAMS.has(param) || seen.has(param)) {
      continue;
    }
    seen.add(param);
    sanitized.push(param);
  }
  return sanitized.length > 0 ? sanitized : buildQueryableParamList();
}

function createSnapshotFromParamMap(paramMap = {}, source = "runtime") {
  const params = {};
  for (const [rawParam, rawValue] of Object.entries(paramMap || {})) {
    const param = clampInt(rawParam, 0, 16383, -1);
    if (param < 0) {
      continue;
    }
    params[String(param)] = clampInt(rawValue, 0, 16383, 0);
  }
  return {
    capturedAt: new Date().toISOString(),
    parameterCount: Object.keys(params).length,
    params,
    errors: [],
    source,
  };
}

function normalizeSnapshotInput(snapshot = null, fallback = null) {
  let source = snapshot;
  if (source == null) {
    source = fallback;
  }

  if (typeof source === "string") {
    source = JSON.parse(source);
  }

  if (!source || typeof source !== "object") {
    return null;
  }

  if (source.params && typeof source.params === "object") {
    return source;
  }

  return createSnapshotFromParamMap(source, "raw-params-map");
}

function diffSnapshots(before = null, after = null) {
  if (!before?.params || !after?.params) {
    throw new Error("Both snapshots must include a params map.");
  }

  const allParams = new Set([...Object.keys(before.params), ...Object.keys(after.params)]);
  const changed = [];
  for (const paramKey of allParams) {
    const left = before.params[paramKey];
    const right = after.params[paramKey];
    if (left !== right) {
      changed.push({
        param: Number(paramKey),
        before: left,
        after: right,
      });
    }
  }
  changed.sort((a, b) => a.param - b.param);
  return changed;
}

function toCamelCaseFromNrpn(constantName) {
  const segments = String(constantName)
    .toLowerCase()
    .split("_")
    .filter(Boolean);
  if (segments.length === 0) {
    return "";
  }
  const [first, ...rest] = segments;
  return `${first}${rest.map((segment) => segment[0].toUpperCase() + segment.slice(1)).join("")}`;
}

function toMethodStem(constantName) {
  const camel = toCamelCaseFromNrpn(constantName);
  if (!camel) {
    return "";
  }
  return `${camel[0].toUpperCase()}${camel.slice(1)}`;
}

/**
 * @typedef LinnStrumentHelperOptions
 * @property {object} ext
 * @property {() => {paramDelayMs:number, applyControlModeToRightSplit:boolean}} getSyncOptions
 * @property {(message: string, payload?: unknown) => void} [logger]
 */

/**
 * @param {LinnStrumentHelperOptions} options
 */
export function createLinnStrumentHelper(options) {
  const ext = options?.ext;
  const getSyncOptions =
    typeof options?.getSyncOptions === "function"
      ? options.getSyncOptions
      : () => ({ paramDelayMs: DEFAULT_NRPN_PARAM_DELAY_MS, applyControlModeToRightSplit: false });
  const logger =
    typeof options?.logger === "function"
      ? options.logger
      : (message, payload = null) => {
          if (payload === null || payload === undefined) {
            console.log(`[ls-helper] ${message}`);
            return;
          }
          console.log(`[ls-helper] ${message}`, payload);
        };

  function getInstrumentOutput() {
    const output = ext?.midi?.instrumentOutput || null;
    if (!output) {
      throw new Error("No instrument output connected.");
    }
    return output;
  }

  function getInstrumentInput() {
    const input = ext?.midi?.instrumentInput || null;
    if (!input) {
      throw new Error("No instrument input connected.");
    }
    return input;
  }

  async function writeParam(param, value, writeOptions = {}) {
    const output = getInstrumentOutput();
    const syncOptions = { ...getSyncOptions(), ...writeOptions };
    const normalizedParam = clampInt(param, 0, 16383, 0);
    const normalizedValue = clampInt(value, 0, 16383, 0);
    await setLinnStrumentParamValue(output, normalizedParam, normalizedValue, syncOptions);
    return {
      param: normalizedParam,
      value: normalizedValue,
      syncOptions,
    };
  }

  async function readParam(param, readOptions = {}) {
    const output = getInstrumentOutput();
    const input = getInstrumentInput();
    const timeoutMs = clampInt(readOptions.timeoutMs, 200, 5000, NRPN_QUERY_RESPONSE_TIMEOUT_MS);
    const targetParam = clampInt(param, 0, 16383, 0);
    const syncOptions = { ...getSyncOptions() };

    return await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, payload) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          input.removeListener("controlchange", onControlChange);
        } catch (err) {
          console.warn("Failed to remove temporary NRPN query listener", err);
        }
        fn(payload);
      };

      const onControlChange = createNrpnResponseReader((message) => {
        if (message.param === targetParam) {
          finish(resolve, {
            param: message.param,
            value: message.value,
            channel: message.channel,
            respondedAt: new Date().toISOString(),
          });
        }
      });

      const timer = setTimeout(() => {
        finish(reject, new Error(`Timeout waiting for NRPN query response for parameter ${targetParam}`));
      }, timeoutMs);

      try {
        input.addListener("controlchange", onControlChange);
        void setLinnStrumentParamValue(output, NRPN_QUERY_PARAMETER, targetParam, syncOptions);
      } catch (err) {
        finish(reject, err);
      }
    });
  }

  async function readStateSnapshot(readOptions = {}) {
    const params = normalizeQueryParams(readOptions.params);
    const results = {};
    const errors = [];

    if (ext?.state) {
      ext.state.suppressInstrumentNrpnCcForwarding = true;
    }
    try {
      for (const param of params) {
        try {
          const response = await readParam(param, readOptions);
          results[String(response.param)] = response.value;
        } catch (err) {
          errors.push({ param, error: err?.message || String(err) });
        }
      }
    } finally {
      if (ext?.state) {
        ext.state.suppressInstrumentNrpnCcForwarding = false;
      }
    }

    return {
      capturedAt: new Date().toISOString(),
      parameterCount: Object.keys(results).length,
      params: results,
      errors,
    };
  }

  async function readControlModeState(readOptions = {}) {
    return await readStateSnapshot({
      ...readOptions,
      params: CONTROL_MODE_CHANGED_NRPN_PARAMS,
    });
  }

  async function writeStateSnapshot(snapshotOrMap, writeOptions = {}) {
    const source = normalizeSnapshotInput(snapshotOrMap, null);
    if (!source?.params || typeof source.params !== "object") {
      throw new Error("Snapshot must contain a params map.");
    }

    const skipParams = new Set(
      Array.isArray(writeOptions.skipParams)
        ? writeOptions.skipParams
        : [NRPN.GLOBAL_SETTINGS_PRESET_LOAD],
    );

    const entries = Object.entries(source.params)
      .map(([param, value]) => ({
        param: clampInt(param, 0, 16383, 0),
        value: clampInt(value, 0, 16383, 0),
      }))
      .filter((entry) => !skipParams.has(entry.param))
      .sort((a, b) => a.param - b.param);

    let restoredCount = 0;
    for (const entry of entries) {
      await writeParam(entry.param, entry.value, writeOptions);
      restoredCount += 1;
    }
    return restoredCount;
  }

  function describeParam(paramOrName) {
    if (typeof paramOrName === "string" && LS_NRPN_INFO_BY_NAME[paramOrName]) {
      return LS_NRPN_INFO_BY_NAME[paramOrName];
    }
    const normalizedParam = clampInt(paramOrName, 0, 16383, -1);
    if (normalizedParam < 0) {
      return null;
    }
    return LS_NRPN_INFO_BY_PARAM[String(normalizedParam)] || null;
  }

  /**
   * Returns a fixed-value enum map for a parameter, when one is known.
   * @param {number | keyof typeof NRPN} paramOrName
   * @returns {Readonly<Record<string, number>> | null}
   */
  function getParamEnum(paramOrName) {
    const info = describeParam(paramOrName);
    if (!info) {
      return null;
    }
    const canonicalName = LS_NRPN_INFO_BY_PARAM[String(info.param)]?.name || info.name;
    return LS_PARAM_ENUMS[canonicalName] || null;
  }

  function buildKnownDefaultParamMap(options = {}) {
    return buildKnownDefaultNrpnParamMap(options);
  }

  async function verifyKnownDefaultProfile(options = {}) {
    const expectedMap = buildKnownDefaultNrpnParamMap({ mpeEnabled: Boolean(options?.mpeEnabled) });
    const params = Object.keys(expectedMap)
      .map((value) => clampInt(value, 0, 16383, -1))
      .filter((value) => value >= 0);
    const snapshot = await readStateSnapshot({
      params,
      timeoutMs: clampInt(options?.timeoutMs, 200, 5000, KNOWN_DEFAULT_PROFILE_TIMEOUT_MS),
    });
    const mismatches = [];
    for (const [paramKey, expectedValue] of Object.entries(expectedMap)) {
      const actualValue = snapshot.params[String(paramKey)];
      if (actualValue !== expectedValue) {
        mismatches.push({
          param: Number(paramKey),
          expected: expectedValue,
          actual: actualValue,
        });
      }
    }
    mismatches.sort((a, b) => a.param - b.param);
    return {
      ok: mismatches.length === 0,
      mismatchCount: mismatches.length,
      mismatches,
      expected: expectedMap,
      snapshot,
    };
  }

  function lightHardwarePad(x, y, color = LED_COLOR.WHITE) {
    const output = getInstrumentOutput();
    if (!output?.channels?.[1]) {
      throw new Error("Instrument output channel 1 is unavailable.");
    }

    const hardwareX = clampInt(x, 0, 127, 0);
    const hardwareY = clampInt(y, 0, 127, 0);
    const ledColor = clampMidi7(color, LED_COLOR.WHITE);

    const channel = output.channels[1];
    channel.sendControlChange(20, hardwareX);
    channel.sendControlChange(21, hardwareY);
    channel.sendControlChange(22, ledColor);

    return {
      x: hardwareX,
      y: hardwareY,
      color: ledColor,
    };
  }

  function lightGridPad(x, y, color = LED_COLOR.WHITE) {
    const gridX = clampInt(x, 0, 127, 0);
    const gridY = clampInt(y, 0, 127, 0);
    return lightHardwarePad(gridX + 1, gridY, color);
  }

  async function sweepDisplay(color = LED_COLOR.BLACK, sweepOptions = {}) {
    const output = getInstrumentOutput();
    if (!output?.channels?.[1]) {
      throw new Error("Instrument output channel 1 is unavailable.");
    }

    const rowDelayMs = clampInt(sweepOptions.rowDelayMs, 0, 2000, 2);
    const ledColor = clampMidi7(color, LED_COLOR.BLACK);
    const preserveControlStrip = sweepOptions.preserveControlStrip !== false;
    const xStart = preserveControlStrip ? 1 : 0;
    const xEndInclusive = clampInt(sweepOptions.xEndInclusive, 1, 24, 24);
    const yEndInclusive = clampInt(sweepOptions.yEndInclusive, 0, 7, 7);

    for (let y = 0; y <= yEndInclusive; y += 1) {
      for (let x = xStart; x <= xEndInclusive; x += 1) {
        output.channels[1].sendControlChange(20, x);
        output.channels[1].sendControlChange(21, y);
        output.channels[1].sendControlChange(22, ledColor);
      }
      if (rowDelayMs > 0) {
        await sleep(rowDelayMs);
      }
    }

    return {
      color: ledColor,
      rowDelayMs,
      preserveControlStrip,
      xStart,
      xEndInclusive,
      yEndInclusive,
    };
  }

  async function sweepDisplayBlack(sweepOptions = {}) {
    return await sweepDisplay(LED_COLOR.BLACK, sweepOptions);
  }

  async function sweepDisplayWhite(sweepOptions = {}) {
    return await sweepDisplay(LED_COLOR.WHITE, sweepOptions);
  }

  async function loadPreset(presetNumber = 1, presetOptions = {}) {
    const output = getInstrumentOutput();
    const normalizedPreset = clampInt(presetNumber, 1, 6, 1);
    await loadLinnStrumentPreset(output, normalizedPreset, {
      ...getSyncOptions(),
      ...presetOptions,
    });
    return normalizedPreset;
  }

  async function applyStandardLayout(standardOptions = {}) {
    const output = getInstrumentOutput();
    await applyLinnStrumentStandardLayout(output, {
      ...getSyncOptions(),
      ...standardOptions,
    });
  }

  async function applyMpeInputMode(enabled, mpeOptions = {}) {
    const output = getInstrumentOutput();
    await applyLinnStrumentMpeInputMode(output, Boolean(enabled), {
      ...getSyncOptions(),
      ...mpeOptions,
    });
  }

  async function writeSplitLeftPerNoteChannelMembership(midiChannel, membershipValue, writeOptions = {}) {
    const channelNumber = clampInt(midiChannel, 1, 16, 1);
    const param = NRPN[`SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_${channelNumber}`];
    const value = clampInt(membershipValue, 0, 1, 0);
    return await writeParam(param, value, writeOptions);
  }

  async function readSplitLeftPerNoteChannelMembership(midiChannel, readOptions = {}) {
    const channelNumber = clampInt(midiChannel, 1, 16, 1);
    const param = NRPN[`SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_${channelNumber}`];
    return await readParam(param, readOptions);
  }

  async function writeSplitRightPerNoteChannelMembership(midiChannel, membershipValue, writeOptions = {}) {
    const channelNumber = clampInt(midiChannel, 1, 16, 1);
    const param = NRPN[`SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_${channelNumber}`];
    const value = clampInt(membershipValue, 0, 1, 0);
    return await writeParam(param, value, writeOptions);
  }

  async function readSplitRightPerNoteChannelMembership(midiChannel, readOptions = {}) {
    const channelNumber = clampInt(midiChannel, 1, 16, 1);
    const param = NRPN[`SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_${channelNumber}`];
    return await readParam(param, readOptions);
  }

  const helper = {
    enums: LS_ENUMS,
    nrpn: NRPN,
    nrpnInfoByName: LS_NRPN_INFO_BY_NAME,
    nrpnInfoByParam: LS_NRPN_INFO_BY_PARAM,
    nrpnCoverage: NRPN_COVERAGE,
    knownNrpnParameters: LS_KNOWN_NRPN_PARAMS,
    controlModeLayout: CONTROL_MODE_LAYOUT,
    factoryDefaultLayout: FACTORY_DEFAULT_LAYOUT,
    controlModeChangedParams: CONTROL_MODE_CHANGED_NRPN_PARAMS,
    paramEnums: LS_PARAM_ENUMS,
    queryableParams: buildQueryableParamList(),
    describeParam,
    getParamEnum,
    buildKnownDefaultNrpnParamMap: buildKnownDefaultParamMap,
    createSnapshotFromParamMap,
    normalizeSnapshotInput,
    diffSnapshots,
    getInstrumentOutput,
    getInstrumentInput,
    sleep,
    setLinnStrumentParamValue,
    loadLinnStrumentPreset,
    writeParam,
    readParam,
    readStateSnapshot,
    readFullState: readStateSnapshot,
    readControlModeState,
    verifyKnownDefaultProfile,
    writeStateSnapshot,
    restoreStateSnapshot: writeStateSnapshot,
    loadPreset,
    applyStandardLayout,
    applyMpeInputMode,
    lightHardwarePad,
    lightGridPad,
    sweepDisplay,
    sweepDisplayBlack,
    sweepDisplayWhite,
    sweepLinnStrumentLightsOff: async (options = {}) => {
      await sweepLinnStrumentLightsOff(getInstrumentOutput(), options);
    },
    writeSplitLeftPerNoteChannelMembership,
    readSplitLeftPerNoteChannelMembership,
    writeSplitRightPerNoteChannelMembership,
    readSplitRightPerNoteChannelMembership,
  };

  for (const [name, param] of Object.entries(NRPN)) {
    const stem = toMethodStem(name);
    if (!stem || !Number.isFinite(param)) {
      continue;
    }
    const readName = `read${stem}`;
    const writeName = `write${stem}`;
    helper[readName] = async (readOptions = {}) => await readParam(param, readOptions);
    helper[writeName] = async (value, writeOptions = {}) => await writeParam(param, value, writeOptions);
  }

  logger("Created LinnStrument helper", {
    knownParams: Object.keys(NRPN).length,
    uniqueKnownParams: Object.keys(LS_NRPN_INFO_BY_PARAM).length,
    queryableParams: helper.queryableParams.length,
    coverage: NRPN_COVERAGE,
  });

  return helper;
}
