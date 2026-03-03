import { clampInt } from "./core-logic.js";

const STARTUP_STATE_CAPTURE_TIMEOUT_MS = 800;
const KNOWN_DEFAULT_PROFILE_TIMEOUT_MS = 1500;

export const SAFE_EXIT_NRPN_DELAY_MS = 50;

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
  function getLs() {
    if (!ext?.ls) {
      throw new Error("ext.ls helper is not available.");
    }
    return ext.ls;
  }

  function buildKnownDefaultNrpnParamMap(options = {}) {
    return getLs().buildKnownDefaultNrpnParamMap(options);
  }

  function createSnapshotFromParamMap(paramMap = {}, source = "runtime") {
    return getLs().createSnapshotFromParamMap(paramMap, source);
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

  async function queryLinnStrumentNrpnParam(param, options = {}) {
    return await getLs().readParam(param, options);
  }

  async function readLinnStrumentStateSnapshot(options = {}) {
    return await getLs().readFullState(options);
  }

  async function restoreLinnStrumentStateSnapshot(snapshot, options = {}) {
    return await getLs().writeStateSnapshot(snapshot, options);
  }

  async function verifyKnownDefaultProfile(options = {}) {
    return await getLs().verifyKnownDefaultProfile(options);
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
        await getLs().loadPreset(normalizedPreset, {
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
        const snapshot = await getLs().readControlModeState();
        ext.state.previous = snapshot;
        console.log("[util.readControlModeState] Captured control-mode relevant LinnStrument state snapshot", {
          capturedAt: snapshot.capturedAt,
          parameterCount: snapshot.parameterCount,
        });
        return snapshot;
      },
      restoreState: async (snapshot = null) => {
        const source = getLs().normalizeSnapshotInput(snapshot, ext.state.previous);
        if (!source?.params || typeof source.params !== "object") {
          throw new Error("No snapshot available. Run ext.util.readState() first.");
        }
        const restoredCount = await restoreLinnStrumentStateSnapshot(source, getLinnstrumentSyncOptions());
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
          if (typeof sweepLinnStrumentLightsOff === "function") {
            await sweepLinnStrumentLightsOff(ext.midi.instrumentOutput, { rowDelayMs: 1 });
          } else {
            await getLs().sweepDisplayBlack({ rowDelayMs: 1 });
          }
          await getLs().sleep(initLayoutSettleDelayMs);
        }

        const restoredCount = await restoreLinnStrumentStateSnapshot(expectedSnapshot, {
          ...getLinnstrumentSyncOptions(),
          paramDelayMs: parseIntInRange(options?.paramDelayMs, SAFE_EXIT_NRPN_DELAY_MS),
        });
        const verification = await verifyKnownDefaultProfile({
          mpeEnabled: requestedMpeEnabled,
          timeoutMs: clampInt(options?.timeoutMs, 200, 5000, KNOWN_DEFAULT_PROFILE_TIMEOUT_MS),
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

        const changed = getLs().diffSnapshots(left, right);
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
