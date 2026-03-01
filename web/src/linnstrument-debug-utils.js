import { clampInt } from "./core-logic.js";
import { extractRawControlChangeEvent } from "./routing.js";
import { NRPN, setLinnStrumentParamValue, loadLinnStrumentPreset, sleep } from "./instrument-sync.js";

const NRPN_QUERY_PARAMETER = 299;
const NRPN_QUERY_RESPONSE_TIMEOUT_MS = 1200;
const NON_QUERYABLE_NRPN_PARAMS = new Set([62, 63, 64, 66, 162, 163, 164, 166]);
const STARTUP_STATE_CAPTURE_TIMEOUT_MS = 800;
const KNOWN_DEFAULT_BEND_RANGE = 48;
const KNOWN_DEFAULT_PROFILE_TIMEOUT_MS = 1500;

export const SAFE_EXIT_NRPN_DELAY_MS = 50;

export const CONTROL_MODE_CHANGED_NRPN_PARAMS = (() => {
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

  for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param += 1) {
    params.push(param);
  }
  for (let param = NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_END; param += 1) {
    params.push(param);
  }

  return [...new Set(params)].sort((a, b) => a - b);
})();

function parseIntInRange(value, fallback, min = 0, max = 2000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function normalizeStateSnapshotReadOptions(paramsOrOptions = null) {
  if (Array.isArray(paramsOrOptions)) {
    return { params: paramsOrOptions };
  }
  if (paramsOrOptions && typeof paramsOrOptions === "object") {
    return paramsOrOptions;
  }
  return {};
}

export function createLinnstrumentDebugApi({
  ext,
  log,
  defaultConfig,
  isMpeModeEnabledCore,
  isMpeModeEnabled,
  getLinnstrumentSyncOptions,
  initLayoutSettleDelayMs,
  sweepLinnStrumentLightsOff,
}) {
  function normalizeStateSnapshotInput(snapshot = null, fallback = null) {
    let source = snapshot;
    if (source == null) {
      source = fallback;
    }

    if (typeof source === "string") {
      try {
        source = JSON.parse(source);
      } catch (err) {
        throw new Error(`Invalid snapshot JSON string: ${err?.message || err}`);
      }
    }

    if (!source || typeof source !== "object") {
      return null;
    }

    if (source.params && typeof source.params === "object") {
      return source;
    }

    // Accept a raw params map like { "36": 5, "37": 7, ... }.
    return createSnapshotFromParamMap(source, "raw-params-map");
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

  function buildKnownDefaultNrpnParamMap(options = {}) {
    const mpeEnabled = Boolean(options?.mpeEnabled);
    const params = {
      [NRPN.DEVICE_USER_FIRMWARE_MODE]: 0,
      [NRPN.GLOBAL_SPLIT_ACTIVE]: 0,
      [NRPN.GLOBAL_SELECTED_SPLIT]: 0,
      [NRPN.GLOBAL_ROW_OFFSET]: 5,
      [NRPN.SPLIT_LEFT_LOW_ROW_MODE]: 0,
      [NRPN.SPLIT_RIGHT_LOW_ROW_MODE]: 0,
      [NRPN.SPLIT_LEFT_OCTAVE]: 5,
      [NRPN.SPLIT_LEFT_TRANSPOSE_PITCH]: 7,
      [NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS]: 7,
      [NRPN.SPLIT_RIGHT_OCTAVE]: 5,
      [NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH]: 7,
      [NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS]: 7,
      [NRPN.SPLIT_LEFT_BEND_RANGE]: KNOWN_DEFAULT_BEND_RANGE,
      [NRPN.SPLIT_RIGHT_BEND_RANGE]: KNOWN_DEFAULT_BEND_RANGE,
    };

    if (mpeEnabled) {
      params[NRPN.SPLIT_LEFT_MIDI_MODE] = 1;
      params[NRPN.SPLIT_LEFT_MAIN_CHANNEL] = 1;
      params[NRPN.SPLIT_LEFT_SEND_Z] = 1;
      params[NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z] = 1;
      params[NRPN.SPLIT_RIGHT_MIDI_MODE] = 1;
      params[NRPN.SPLIT_RIGHT_MAIN_CHANNEL] = 1;
      params[NRPN.SPLIT_RIGHT_SEND_Z] = 1;
      params[NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z] = 1;

      for (
        let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START;
        param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END;
        param += 1
      ) {
        const midiChannel = param - 1;
        params[param] = midiChannel >= 2 ? 1 : 0;
      }
      for (
        let param = NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START;
        param <= NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_END;
        param += 1
      ) {
        const midiChannel = param - (NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START - 1);
        params[param] = midiChannel >= 2 ? 1 : 0;
      }
    } else {
      params[NRPN.SPLIT_LEFT_MIDI_MODE] = 0;
      params[NRPN.SPLIT_LEFT_MAIN_CHANNEL] = 1;
      params[NRPN.SPLIT_LEFT_SEND_Z] = 1;
      params[NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z] = 0;
      params[NRPN.SPLIT_RIGHT_MIDI_MODE] = 0;
      params[NRPN.SPLIT_RIGHT_MAIN_CHANNEL] = 1;
      params[NRPN.SPLIT_RIGHT_SEND_Z] = 1;
      params[NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z] = 0;
    }

    return params;
  }

  function buildExitLinnstrumentParamSummary(config) {
    const restoreProfile = buildKnownDefaultNrpnParamMap({
      mpeEnabled: isMpeModeEnabledCore(config, defaultConfig),
    });
    return {
      targetPreset: null,
      lightsClearPasses: 0,
      restoreParamCount: Object.keys(restoreProfile).length,
      restoreTimingMs: SAFE_EXIT_NRPN_DELAY_MS,
      exitSequence: ["RestoreKnownDefaultProfileOnly"],
      nrpnRestoreProfile: restoreProfile,
    };
  }

  function getLinnStrumentStateQueryParamList() {
    const params = [];
    const pushRange = (start, endInclusive) => {
      for (let param = start; param <= endInclusive; param++) {
        params.push(param);
      }
    };
    // Ranges documented in midi.md and handled by firmware sendNrpnParameter().
    pushRange(0, 66);
    pushRange(100, 166);
    pushRange(200, 270);
    return params.filter((param) => !NON_QUERYABLE_NRPN_PARAMS.has(param));
  }

  function normalizeStateQueryParams(inputParams = null) {
    if (!Array.isArray(inputParams) || inputParams.length === 0) {
      return getLinnStrumentStateQueryParamList();
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
    return sanitized.length > 0 ? sanitized : getLinnStrumentStateQueryParamList();
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
      const state = byChannel.get(key) || { paramMsb: null, paramLsb: null, valueMsb: null };
      switch (event.controller) {
        case 99:
          state.paramMsb = event.value7;
          break;
        case 98:
          state.paramLsb = event.value7;
          break;
        case 6:
          state.valueMsb = event.value7;
          break;
        case 38: {
          if (
            Number.isFinite(state.paramMsb) &&
            Number.isFinite(state.paramLsb) &&
            Number.isFinite(state.valueMsb)
          ) {
            const param = (state.paramMsb << 7) + state.paramLsb;
            const value = (state.valueMsb << 7) + event.value7;
            onNrpnMessage({ param, value, channel: event.channel });
          }
          state.valueMsb = null;
          break;
        }
        default:
          break;
      }
      byChannel.set(key, state);
    };
  }

  async function queryLinnStrumentNrpnParam(param, options = {}) {
    const output = ext.midi.instrumentOutput;
    const input = ext.midi.instrumentInput;
    if (!output) {
      throw new Error("No instrument output connected.");
    }
    if (!input) {
      throw new Error("No instrument input connected.");
    }

    const timeoutMs = clampInt(options.timeoutMs, 200, 5000, NRPN_QUERY_RESPONSE_TIMEOUT_MS);
    const syncOptions = getLinnstrumentSyncOptions();
    const targetParam = clampInt(param, 0, 16383, 0);

    return new Promise((resolve, reject) => {
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

  async function readLinnStrumentStateSnapshot(options = {}) {
    const params = normalizeStateQueryParams(options.params);
    const results = {};
    const errors = [];

    ext.state.suppressInstrumentNrpnCcForwarding = true;
    try {
      for (const param of params) {
        try {
          const response = await queryLinnStrumentNrpnParam(param, options);
          results[String(response.param)] = response.value;
        } catch (err) {
          errors.push({ param, error: err?.message || String(err) });
        }
      }
    } finally {
      ext.state.suppressInstrumentNrpnCcForwarding = false;
    }

    return {
      capturedAt: new Date().toISOString(),
      parameterCount: Object.keys(results).length,
      params: results,
      errors,
    };
  }

  async function restoreLinnStrumentStateSnapshot(snapshot, options = {}) {
    const output = ext.midi.instrumentOutput;
    if (!output) {
      throw new Error("No instrument output connected.");
    }
    const params = snapshot?.params || {};
    const syncOptions = getLinnstrumentSyncOptions();
    if (options && typeof options === "object") {
      syncOptions.paramDelayMs = parseIntInRange(options.paramDelayMs, syncOptions.paramDelayMs);
      if (Object.hasOwn(options, "applyControlModeToRightSplit")) {
        syncOptions.applyControlModeToRightSplit = Boolean(options.applyControlModeToRightSplit);
      }
    }

    // Parameter 243 is a command (preset load), not a stable state value to replay blindly.
    const skipParams = new Set([243]);
    const entries = Object.entries(params)
      .map(([param, value]) => ({
        param: clampInt(param, 0, 16383, 0),
        value: clampInt(value, 0, 16383, 0),
      }))
      .filter((entry) => !skipParams.has(entry.param))
      .sort((a, b) => a.param - b.param);

    let restoredCount = 0;
    for (const entry of entries) {
      await setLinnStrumentParamValue(output, entry.param, entry.value, syncOptions);
      restoredCount += 1;
    }
    return restoredCount;
  }

  async function verifyKnownDefaultProfile(options = {}) {
    const expectedMap = buildKnownDefaultNrpnParamMap({ mpeEnabled: Boolean(options?.mpeEnabled) });
    const params = Object.keys(expectedMap)
      .map((value) => clampInt(value, 0, 16383, -1))
      .filter((value) => value >= 0);
    const snapshot = await readLinnStrumentStateSnapshot({
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

  async function capturePreviousLinnstrumentState(reason = "startup", options = {}) {
    if (!ext.midi.instrumentInput || !ext.midi.instrumentOutput) {
      return false;
    }
    const startedAtMs = performance.now();
    try {
      const readOptions = normalizeStateSnapshotReadOptions(options);
      const snapshot = await readLinnStrumentStateSnapshot({
        ...readOptions,
        timeoutMs: clampInt(readOptions.timeoutMs, 200, 5000, STARTUP_STATE_CAPTURE_TIMEOUT_MS),
      });
      ext.state.startupSnapshot = snapshot;
      ext.state.previous = snapshot;
      console.log("[STATE SNAPSHOT] Captured previous LinnStrument state", {
        reason,
        durationMs: Math.round(performance.now() - startedAtMs),
        parameterCount: snapshot.parameterCount,
        requestedParams: Array.isArray(readOptions.params) ? readOptions.params.length : "full",
        errors: snapshot.errors?.length || 0,
      });
      return true;
    } catch (err) {
      log.warn(`Could not capture previous LinnStrument state on ${reason}: ${err?.message || err}`);
      return false;
    }
  }

  function createExtUtilApi() {
    return {
      loadPreset: async (presetNumber = 1) => {
        if (!ext.midi.instrumentOutput) {
          console.error("No instrument output connected.");
          return;
        }
        const normalizedPreset = clampInt(presetNumber, 1, 6, 1);
        console.log(`[util.loadPreset] Loading preset ${normalizedPreset} (with firmware-mode bounce)`);
        await loadLinnStrumentPreset(ext.midi.instrumentOutput, normalizedPreset, {
          ...getLinnstrumentSyncOptions(),
          bounceUserFirmware: true,
        });
      },
      readState: async (paramsOrOptions = null) => {
        const readOptions = normalizeStateSnapshotReadOptions(paramsOrOptions);
        const snapshot = await readLinnStrumentStateSnapshot(readOptions);
        ext.state.previous = snapshot;
        console.log("[util.readState] Captured LinnStrument state snapshot", {
          capturedAt: snapshot.capturedAt,
          parameterCount: snapshot.parameterCount,
          requestedParams: Array.isArray(readOptions.params) ? readOptions.params.length : "full",
        });
        return snapshot;
      },
      readControlModeState: async () => {
        const snapshot = await readLinnStrumentStateSnapshot({ params: CONTROL_MODE_CHANGED_NRPN_PARAMS });
        ext.state.previous = snapshot;
        console.log("[util.readControlModeState] Captured control-mode relevant LinnStrument state snapshot", {
          capturedAt: snapshot.capturedAt,
          parameterCount: snapshot.parameterCount,
        });
        return snapshot;
      },
      restoreState: async (snapshot = null) => {
        const source = normalizeStateSnapshotInput(snapshot, ext.state.previous);
        if (!source?.params || typeof source.params !== "object") {
          throw new Error("No snapshot available. Run ext.util.readState() first.");
        }
        const restoredCount = await restoreLinnStrumentStateSnapshot(source);
        console.log("[util.restoreState] Restored LinnStrument state snapshot", {
          restoredCount,
          capturedAt: source.capturedAt || null,
        });
        return restoredCount;
      },
      resetToKnownDefaults: async (options = {}) => {
        if (!ext.midi.instrumentOutput) {
          throw new Error("No instrument output connected.");
        }
        const requestedMpeEnabled =
          typeof options?.mpeEnabled === "boolean" ? options.mpeEnabled : isMpeModeEnabled();
        const expectedMap = buildKnownDefaultNrpnParamMap({ mpeEnabled: requestedMpeEnabled });
        const expectedSnapshot = createSnapshotFromParamMap(expectedMap, "known-default-profile");

        if (options?.sweepLights === true) {
          await sweepLinnStrumentLightsOff(ext.midi.instrumentOutput, { rowDelayMs: 1 });
          await sleep(initLayoutSettleDelayMs);
        }

        const restoredCount = await restoreLinnStrumentStateSnapshot(expectedSnapshot, {
          paramDelayMs: parseIntInRange(options?.paramDelayMs, SAFE_EXIT_NRPN_DELAY_MS),
        });
        const verification = await verifyKnownDefaultProfile({
          mpeEnabled: requestedMpeEnabled,
          timeoutMs: options?.timeoutMs,
        });
        console.log("[util.resetToKnownDefaults] Applied and verified known default profile", {
          mpeEnabled: requestedMpeEnabled,
          restoredCount,
          verifyOk: verification.ok,
          mismatchCount: verification.mismatchCount,
        });
        return {
          restoredCount,
          verification,
          expected: expectedSnapshot,
        };
      },
      queryParam: async (param) => {
        const result = await queryLinnStrumentNrpnParam(param);
        console.log("[util.queryParam] NRPN value", result);
        return result;
      },
      diffState: (before = null, after = null) => {
        const left = before && typeof before === "object" ? before : ext.state.previous;
        const right = after && typeof after === "object" ? after : null;
        if (!left?.params || !right?.params) {
          throw new Error("Provide both snapshots: ext.util.diffState(snapshotA, snapshotB).");
        }

        const allParams = new Set([...Object.keys(left.params), ...Object.keys(right.params)]);
        const changed = [];
        for (const paramKey of allParams) {
          const prev = left.params[paramKey];
          const next = right.params[paramKey];
          if (prev !== next) {
            changed.push({ param: Number(paramKey), before: prev, after: next });
          }
        }
        changed.sort((a, b) => a.param - b.param);
        console.log("[util.diffState] Changed parameters", changed);
        return changed;
      },
    };
  }

  return {
    buildExitLinnstrumentParamSummary,
    buildKnownDefaultNrpnParamMap,
    createSnapshotFromParamMap,
    queryLinnStrumentNrpnParam,
    readLinnStrumentStateSnapshot,
    restoreLinnStrumentStateSnapshot,
    verifyKnownDefaultProfile,
    capturePreviousLinnstrumentState,
    createExtUtilApi,
  };
}
