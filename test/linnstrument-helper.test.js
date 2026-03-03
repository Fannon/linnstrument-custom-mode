import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONTROL_MODE_CHANGED_NRPN_PARAMS,
  LS_ENUMS,
  LS_KNOWN_NRPN_PARAMS,
  LS_PARAM_ENUMS,
  LS_NRPN_INFO_BY_NAME,
  LS_NRPN_INFO_BY_PARAM,
  NRPN,
  NRPN_COVERAGE,
  buildKnownDefaultNrpnParamMap,
  createLinnStrumentHelper,
  setLinnStrumentParamValue,
} from "../web/src/linnstrument-helper.js";

function normalizeRange(range) {
  return String(range || "")
    .trim()
    .replace(/\s+/g, "")
    .toLowerCase();
}

function parseDocumentedNrpnEntries() {
  const source = readFileSync(new URL("../tmp/linnstrument-firmware/midi.md", import.meta.url), "utf8");
  return Array.from(
    source.matchAll(/^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(Split|Global|Device|Send)\b.*$/gm),
  ).map((match) => ({
    param: Number.parseInt(match[1], 10),
    valueRange: normalizeRange(match[2]),
  }));
}

function createMockMidi(options = {}) {
  const sent = [];
  const listeners = new Set();
  const nrpnState = { paramMsb: null, paramLsb: null, valueMsb: null };
  const autoQueryResponseMap = options.autoQueryResponseMap || null;

  const input = {
    addListener(type, listener) {
      if (type === "controlchange") {
        listeners.add(listener);
      }
    },
    removeListener(type, listener) {
      if (type === "controlchange") {
        listeners.delete(listener);
      }
    },
    emitControlChange(controller, value7, channel = 0) {
      for (const listener of listeners) {
        listener({
          controller: { number: controller },
          rawValue: value7,
          channel,
        });
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };

  const output = {
    channels: {
      1: {
        sendControlChange(controller, value) {
          sent.push([controller, value]);
          if (!autoQueryResponseMap) {
            return;
          }
          if (controller === 99) {
            nrpnState.paramMsb = value;
            return;
          }
          if (controller === 98) {
            nrpnState.paramLsb = value;
            return;
          }
          if (controller === 6) {
            nrpnState.valueMsb = value;
            return;
          }
          if (controller !== 38) {
            return;
          }
          const param = ((nrpnState.paramMsb || 0) << 7) + (nrpnState.paramLsb || 0);
          const value14 = ((nrpnState.valueMsb || 0) << 7) + value;
          if (param !== NRPN.QUERY_PARAMETER_VALUE) {
            return;
          }
          const responseValue = autoQueryResponseMap[value14];
          if (!Number.isFinite(responseValue)) {
            return;
          }
          const responseParamMsb = (value14 >> 7) & 0x7f;
          const responseParamLsb = value14 & 0x7f;
          const responseValueMsb = (responseValue >> 7) & 0x7f;
          const responseValueLsb = responseValue & 0x7f;
          setTimeout(() => {
            for (const listener of listeners) {
              listener({ controller: { number: 99 }, rawValue: responseParamMsb, channel: 0 });
              listener({ controller: { number: 98 }, rawValue: responseParamLsb, channel: 0 });
              listener({ controller: { number: 6 }, rawValue: responseValueMsb, channel: 0 });
              listener({ controller: { number: 38 }, rawValue: responseValueLsb, channel: 0 });
            }
          }, 0);
        },
      },
    },
    send() {},
  };

  return {
    input,
    output,
    sent,
  };
}

function createHelperWithMockMidi(options = {}) {
  const midi = createMockMidi(options);
  const helper = createLinnStrumentHelper({
    ext: {
      midi: {
        instrumentInput: midi.input,
        instrumentOutput: midi.output,
      },
      state: {
        suppressInstrumentNrpnCcForwarding: false,
      },
    },
    getSyncOptions: () => ({
      paramDelayMs: 0,
      applyControlModeToRightSplit: false,
    }),
  });

  return {
    helper,
    ...midi,
  };
}

describe("linnstrument-helper NRPN definitions", () => {
  test("covers all documented NRPN parameters from midi.md ranges", () => {
    expect(NRPN_COVERAGE.complete).toBe(true);
    expect(NRPN_COVERAGE.expectedCount).toBe(206);
    expect(NRPN_COVERAGE.definedCount).toBe(206);
    expect(NRPN_COVERAGE.missingParams).toEqual([]);

    expect(LS_KNOWN_NRPN_PARAMS[0]).toBe(0);
    expect(LS_KNOWN_NRPN_PARAMS.at(-1)).toBe(299);
  });

  test("matches NRPN parameter/value-range entries documented in tmp/linnstrument-firmware/midi.md", () => {
    const documented = parseDocumentedNrpnEntries();
    const documentedParams = documented.map((entry) => entry.param).sort((a, b) => a - b);
    const helperParams = [...LS_KNOWN_NRPN_PARAMS].sort((a, b) => a - b);

    expect(documentedParams).toEqual(helperParams);

    for (const entry of documented) {
      const helperInfo = LS_NRPN_INFO_BY_PARAM[String(entry.param)];
      expect(helperInfo).toBeDefined();
      expect(normalizeRange(helperInfo?.valueRange)).toBe(entry.valueRange);
    }
  });

  test("exposes canonical and alias constants", () => {
    expect(NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START).toBe(NRPN.SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_1);
    expect(NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END).toBe(NRPN.SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_16);
    expect(NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START).toBe(NRPN.SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_1);
    expect(NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_END).toBe(NRPN.SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_16);
  });

  test("provides name and meaning metadata", () => {
    const firmwareMode = LS_NRPN_INFO_BY_NAME.DEVICE_USER_FIRMWARE_MODE;
    expect(firmwareMode.param).toBe(245);
    expect(firmwareMode.valueRange).toBe("0-1");
    expect(firmwareMode.meaning.length).toBeGreaterThan(10);

    const byParam = LS_NRPN_INFO_BY_PARAM[String(245)];
    expect(byParam.name).toBe("DEVICE_USER_FIRMWARE_MODE");
    expect(Array.isArray(byParam.aliases)).toBe(true);
  });

  test("maps fixed-value parameters to enum dictionaries", () => {
    expect(LS_PARAM_ENUMS.SPLIT_LEFT_LOW_ROW_MODE).toBe(LS_ENUMS.LOW_ROW_MODE);
    expect(LS_PARAM_ENUMS.SPLIT_RIGHT_MIDI_MODE).toBe(LS_ENUMS.MIDI_MODE);
    expect(LS_PARAM_ENUMS.GLOBAL_SWITCH_1_ASSIGNMENT).toBe(LS_ENUMS.SWITCH_ASSIGNMENT);
  });

  test("exports the control-mode changed NRPN parameter list", () => {
    expect(CONTROL_MODE_CHANGED_NRPN_PARAMS.length).toBe(54);
    expect(CONTROL_MODE_CHANGED_NRPN_PARAMS[0]).toBe(NRPN.SPLIT_LEFT_MIDI_MODE);
    expect(CONTROL_MODE_CHANGED_NRPN_PARAMS.includes(NRPN.SPLIT_RIGHT_BEND_RANGE)).toBe(true);
    expect(CONTROL_MODE_CHANGED_NRPN_PARAMS.includes(NRPN.DEVICE_USER_FIRMWARE_MODE)).toBe(true);
  });

  test("buildKnownDefaultNrpnParamMap returns deterministic defaults for MPE on/off", () => {
    const nonMpe = buildKnownDefaultNrpnParamMap({ mpeEnabled: false });
    expect(nonMpe[NRPN.GLOBAL_ROW_OFFSET]).toBe(5);
    expect(nonMpe[NRPN.SPLIT_LEFT_MIDI_MODE]).toBe(0);
    expect(nonMpe[NRPN.SPLIT_RIGHT_MIDI_MODE]).toBe(0);
    expect(nonMpe[NRPN.SPLIT_LEFT_BEND_RANGE]).toBe(48);

    const mpe = buildKnownDefaultNrpnParamMap({ mpeEnabled: true });
    expect(mpe[NRPN.SPLIT_LEFT_MIDI_MODE]).toBe(1);
    expect(mpe[NRPN.SPLIT_RIGHT_MIDI_MODE]).toBe(1);
    expect(mpe[NRPN.SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_1]).toBe(0);
    expect(mpe[NRPN.SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_2]).toBe(1);
    expect(mpe[NRPN.SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_1]).toBe(0);
    expect(mpe[NRPN.SPLIT_RIGHT_MIDI_PER_NOTE_CHANNEL_2]).toBe(1);
  });
});

describe("linnstrument-helper low-level NRPN writing", () => {
  test("setLinnStrumentParamValue sends the 6-CC NRPN sequence", async () => {
    const { output, sent } = createMockMidi();

    await setLinnStrumentParamValue(output, 245, 1, { paramDelayMs: 0 });

    expect(sent).toEqual([
      [99, 1],
      [98, 117],
      [6, 0],
      [38, 1],
      [101, 127],
      [100, 127],
    ]);
  });
});

describe("linnstrument-helper instance API", () => {
  test("generated write methods resolve to the correct NRPN", async () => {
    const { helper, sent } = createHelperWithMockMidi();

    await helper.writeGlobalSplitPointColumn(12);

    expect(sent.slice(0, 6)).toEqual([
      [99, 1],
      [98, 74],
      [6, 0],
      [38, 12],
      [101, 127],
      [100, 127],
    ]);
  });

  test("getParamEnum resolves enum maps by both name and parameter number", () => {
    const { helper } = createHelperWithMockMidi();

    expect(helper.getParamEnum("SPLIT_LEFT_MIDI_MODE")).toBe(helper.enums.MIDI_MODE);
    expect(helper.getParamEnum(NRPN.SPLIT_LEFT_MIDI_MODE)).toBe(helper.enums.MIDI_MODE);
    expect(helper.getParamEnum(NRPN.SPLIT_LEFT_MIDI_PER_NOTE_CHANNEL_4)).toBe(helper.enums.PER_NOTE_CHANNEL_MEMBERSHIP);
    expect(helper.getParamEnum("QUERY_PARAMETER_VALUE")).toBe(null);
  });

  test("instance exposes buildKnownDefault and verifyKnownDefaultProfile", async () => {
    const expected = buildKnownDefaultNrpnParamMap({ mpeEnabled: false });
    const { helper } = createHelperWithMockMidi({
      autoQueryResponseMap: expected,
    });

    const viaInstance = helper.buildKnownDefaultNrpnParamMap({ mpeEnabled: false });
    expect(viaInstance[NRPN.SPLIT_LEFT_MIDI_MODE]).toBe(expected[NRPN.SPLIT_LEFT_MIDI_MODE]);

    const verification = await helper.verifyKnownDefaultProfile({
      mpeEnabled: false,
      timeoutMs: 300,
    });
    expect(verification.ok).toBe(true);
    expect(verification.mismatchCount).toBe(0);
  });

  test("lightGridPad maps to hardware coordinates", () => {
    const { helper, sent } = createHelperWithMockMidi();

    helper.lightGridPad(0, 3, helper.enums.LED_COLOR.CYAN);

    expect(sent).toEqual([
      [20, 1],
      [21, 3],
      [22, 4],
    ]);
  });

  test("sweepDisplay respects range options", async () => {
    const { helper, sent } = createHelperWithMockMidi();

    await helper.sweepDisplayWhite({
      rowDelayMs: 0,
      preserveControlStrip: false,
      xEndInclusive: 1,
      yEndInclusive: 0,
    });

    expect(sent).toEqual([
      [20, 0],
      [21, 0],
      [22, 8],
      [20, 1],
      [21, 0],
      [22, 8],
    ]);
  });

  test("readParam performs query and resolves from NRPN control-change response", async () => {
    const { helper, input, sent } = createHelperWithMockMidi();

    const promise = helper.readParam(NRPN.DEVICE_USER_FIRMWARE_MODE, { timeoutMs: 300 });
    setTimeout(() => {
      input.emitControlChange(99, 1, 0);
      input.emitControlChange(98, 117, 0);
      input.emitControlChange(6, 0, 0);
      input.emitControlChange(38, 1, 0);
    }, 0);

    const result = await promise;

    expect(result.param).toBe(245);
    expect(result.value).toBe(1);
    expect(result.channel).toBe(1);
    expect(sent.slice(0, 6)).toEqual([
      [99, 2],
      [98, 43],
      [6, 1],
      [38, 117],
      [101, 127],
      [100, 127],
    ]);
  });

  test("readParam removes listener and times out when no response arrives", async () => {
    const { helper, input } = createHelperWithMockMidi();

    await expect(helper.readParam(NRPN.DEVICE_USER_FIRMWARE_MODE, { timeoutMs: 200 })).rejects.toThrow(
      "Timeout waiting for NRPN query response",
    );

    expect(input.listenerCount()).toBe(0);
  });

  test("snapshot helpers normalize, diff, and restore state", async () => {
    const { helper, sent } = createHelperWithMockMidi();

    const a = helper.createSnapshotFromParamMap({ 36: 5, 37: 7 }, "a");
    const b = helper.createSnapshotFromParamMap({ 36: 6, 37: 7 }, "b");
    const changed = helper.diffSnapshots(a, b);

    expect(changed).toEqual([{ param: 36, before: 5, after: 6 }]);

    const normalized = helper.normalizeSnapshotInput(JSON.stringify(a), null);
    expect(normalized?.params?.["36"]).toBe(5);

    const restoredCount = await helper.writeStateSnapshot({
      params: {
        [NRPN.GLOBAL_SETTINGS_PRESET_LOAD]: 2,
        [NRPN.DEVICE_USER_FIRMWARE_MODE]: 1,
      },
    });

    expect(restoredCount).toBe(1);
    expect(sent.length).toBeGreaterThan(0);
  });
});
