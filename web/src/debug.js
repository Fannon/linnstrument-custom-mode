import { defaultConfig } from "./config.js";
import { clampInt } from "./core-logic.js";
import {
  CONTROL_MODE_LAYOUT,
  FACTORY_DEFAULT_LAYOUT,
  NRPN,
  createLinnStrumentHelper,
  sleep,
} from "./linnstrument-helper.js";
import { createLinnstrumentDebugApi, SAFE_EXIT_NRPN_DELAY_MS } from "./linnstrument-debug-utils.js";
import { isMpeModeEnabled as isMpeModeEnabledCore } from "./mpe-routing.js";

const DEFAULT_TIMING = {
  initSettleDelayMs: 30,
  stageDelayMs: 20,
  criticalRetryDelayMs: 40,
  ledSweepRowDelayMs: 8,
  safeExitNrpnDelayMs: SAFE_EXIT_NRPN_DELAY_MS,
};

const PRESET_LOAD_BOUNCE_DELAY_MS = 80;

const state = {
  busy: false,
  stopRequested: false,
  webMidiEnabled: false,
  webMidiListenersBound: false,
  leftOctaveCache: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE,
  rightOctaveCache: FACTORY_DEFAULT_LAYOUT.SPLIT_LEFT_OCTAVE,
  snapshots: {
    last: null,
    a: null,
    b: null,
  },
  ext: {
    config: {
      ...defaultConfig,
    },
    midi: {
      instrumentInput: null,
      instrumentOutput: null,
    },
    state: {
      suppressInstrumentNrpnCcForwarding: false,
      previous: null,
      startupSnapshot: null,
    },
  },
};

const ui = {
  instrumentInputPort: document.getElementById("instrumentInputPort"),
  instrumentOutputPort: document.getElementById("instrumentOutputPort"),
  nrpnDelayMs: document.getElementById("nrpnDelayMs"),
  safeExitNrpnDelayMs: document.getElementById("safeExitNrpnDelayMs"),
  initSettleDelayMs: document.getElementById("initSettleDelayMs"),
  stageDelayMs: document.getElementById("stageDelayMs"),
  criticalRetryDelayMs: document.getElementById("criticalRetryDelayMs"),
  ledSweepRowDelayMs: document.getElementById("ledSweepRowDelayMs"),
  bendRange: document.getElementById("bendRange"),
  mpeEnabled: document.getElementById("mpeEnabled"),
  applyRightSplit: document.getElementById("applyRightSplit"),
  enableWebMidi: document.getElementById("enableWebMidi"),
  disableWebMidi: document.getElementById("disableWebMidi"),
  refreshPorts: document.getElementById("refreshPorts"),
  connectPorts: document.getElementById("connectPorts"),
  disconnectPorts: document.getElementById("disconnectPorts"),
  rebuildActions: document.getElementById("rebuildActions"),
  stopSequence: document.getElementById("stopSequence"),
  applyConfig: document.getElementById("applyConfig"),
  connectionStatus: document.getElementById("connectionStatus"),
  runInitSequence: document.getElementById("runInitSequence"),
  runExitSequence: document.getElementById("runExitSequence"),
  initActions: document.getElementById("initActions"),
  exitActions: document.getElementById("exitActions"),
  generalActions: document.getElementById("generalActions"),
  readControlSnapshot: document.getElementById("readControlSnapshot"),
  readFullSnapshot: document.getElementById("readFullSnapshot"),
  restoreLastSnapshot: document.getElementById("restoreLastSnapshot"),
  markSnapshotA: document.getElementById("markSnapshotA"),
  markSnapshotB: document.getElementById("markSnapshotB"),
  diffSnapshots: document.getElementById("diffSnapshots"),
  verifyKnownDefaultsOnly: document.getElementById("verifyKnownDefaultsOnly"),
  firmwareBounce: document.getElementById("firmwareBounce"),
  panicAllNotesOff: document.getElementById("panicAllNotesOff"),
  queryParamNumber: document.getElementById("queryParamNumber"),
  queryTimeoutMs: document.getElementById("queryTimeoutMs"),
  querySingleParam: document.getElementById("querySingleParam"),
  exportLastSnapshot: document.getElementById("exportLastSnapshot"),
  importSnapshotJson: document.getElementById("importSnapshotJson"),
  snapshotJson: document.getElementById("snapshotJson"),
  debugLog: document.getElementById("debugLog"),
  clearLog: document.getElementById("clearLog"),
};

state.ext.ls = createLinnStrumentHelper({
  ext: state.ext,
  getSyncOptions: getLinnstrumentSyncOptions,
  logger: (message, payload = null) => {
    if (payload == null) {
      console.log(`[debug.ext.ls] ${message}`);
      return;
    }
    console.log(`[debug.ext.ls] ${message}`, payload);
  },
});

const debugApi = createLinnstrumentDebugApi({
  ext: state.ext,
  log: {
    info: (msg) => appendLog("info", msg),
    success: (msg) => appendLog("success", msg),
    warn: (msg) => appendLog("warn", msg),
    error: (msg) => appendLog("error", msg),
  },
  defaultConfig,
  isMpeModeEnabledCore,
  isMpeModeEnabled,
  getLinnstrumentSyncOptions,
  initLayoutSettleDelayMs: DEFAULT_TIMING.initSettleDelayMs,
  sweepLinnStrumentLightsOff: async (output, options = {}) => {
    await state.ext.ls.sweepDisplayBlack(options);
    return output;
  },
});

void bootstrap();

function bootstrap() {
  bindUi();
  fillSelect(ui.instrumentInputPort, []);
  fillSelect(ui.instrumentOutputPort, []);
  renderStageActions();
  updateConnectionStatus();
  appendLog("info", "Debug page ready. No automatic MIDI action is performed.");
  appendLog("info", "ext.ls loaded", {
    knownNrpnParams: Object.keys(state.ext.ls.nrpn).length,
    uniqueKnownNrpnParams: state.ext.ls.nrpnCoverage?.definedCount || null,
    nrpnCoverageComplete: state.ext.ls.nrpnCoverage?.complete || false,
    helperMethods: Object.keys(state.ext.ls).length,
  });
}

function bindUi() {
  ui.enableWebMidi?.addEventListener("click", () => {
    void runWithBusy("Enable WebMIDI", async () => {
      await enableWebMidi();
    });
  });

  ui.disableWebMidi?.addEventListener("click", () => {
    void runWithBusy("Disable WebMIDI", async () => {
      await disableWebMidi();
    });
  });

  ui.refreshPorts?.addEventListener("click", () => {
    void runWithBusy("Refresh MIDI ports", async () => {
      ensureWebMidiEnabled();
      populatePortSelects();
      appendLog("info", "Refreshed MIDI port selects");
    });
  });

  ui.connectPorts?.addEventListener("click", () => {
    void runWithBusy("Connect selected ports", async () => {
      connectSelectedPorts();
    });
  });

  ui.disconnectPorts?.addEventListener("click", () => {
    void runWithBusy("Disconnect debug ports", async () => {
      disconnectPorts();
    });
  });

  ui.rebuildActions?.addEventListener("click", () => {
    renderStageActions();
    appendLog("info", "Rebuilt stage action buttons from current option values");
  });

  ui.stopSequence?.addEventListener("click", () => {
    state.stopRequested = true;
    appendLog("warn", "Stop requested. Current action will stop at next cancellation checkpoint.");
  });

  ui.applyConfig?.addEventListener("click", () => {
    renderStageActions();
    appendLog("info", "Applied debug configuration and rebuilt action buttons", {
      sync: getLinnstrumentSyncOptions(),
      timing: getTimingConfig(),
      bendRange: getPitchBendRangeFromUi(),
      mpeEnabled: isMpeModeEnabled(),
    });
  });

  ui.mpeEnabled?.addEventListener("change", () => {
    appendLog("info", "MPE toggle changed", { mpeEnabled: isMpeModeEnabled() });
    renderStageActions();
  });

  ui.applyRightSplit?.addEventListener("change", () => {
    appendLog("info", "Right-split control-mode toggle changed", {
      applyControlModeToRightSplit: getLinnstrumentSyncOptions().applyControlModeToRightSplit,
    });
    renderStageActions();
  });

  ui.nrpnDelayMs?.addEventListener("change", () => {
    appendLog("info", "NRPN delay changed", { nrpnDelayMs: getLinnstrumentSyncOptions().paramDelayMs });
    renderStageActions();
  });

  ui.safeExitNrpnDelayMs?.addEventListener("change", () => {
    appendLog("info", "Exit restore NRPN delay changed", { safeExitNrpnDelayMs: getTimingConfig().safeExitNrpnDelayMs });
    renderStageActions();
  });

  ui.initSettleDelayMs?.addEventListener("change", () => {
    appendLog("info", "Init settle delay changed", { initSettleDelayMs: getTimingConfig().initSettleDelayMs });
    renderStageActions();
  });

  ui.stageDelayMs?.addEventListener("change", () => {
    appendLog("info", "Stage delay changed", { stageDelayMs: getTimingConfig().stageDelayMs });
    renderStageActions();
  });

  ui.criticalRetryDelayMs?.addEventListener("change", () => {
    appendLog("info", "Critical retry delay changed", { criticalRetryDelayMs: getTimingConfig().criticalRetryDelayMs });
    renderStageActions();
  });

  ui.ledSweepRowDelayMs?.addEventListener("change", () => {
    appendLog("info", "LED sweep row delay changed", { ledSweepRowDelayMs: getTimingConfig().ledSweepRowDelayMs });
    renderStageActions();
  });

  ui.bendRange?.addEventListener("change", () => {
    appendLog("info", "Pitch bend range changed", { semitones: getPitchBendRangeFromUi() });
    renderStageActions();
  });

  ui.runInitSequence?.addEventListener("click", () => {
    void runWithBusy("Run full init sequence", async () => {
      await runActionSequence("init", buildInitStageActions());
    });
  });

  ui.runExitSequence?.addEventListener("click", () => {
    void runWithBusy("Run full exit/restore sequence", async () => {
      await runActionSequence("exit", buildExitStageActions());
    });
  });

  ui.readControlSnapshot?.addEventListener("click", () => {
    void runWithBusy("Read control snapshot", async () => {
      const snapshot = await state.ext.ls.readControlModeState(getQueryOptions());
      storeLastSnapshot(snapshot, "control");
    });
  });

  ui.readFullSnapshot?.addEventListener("click", () => {
    void runWithBusy("Read full snapshot", async () => {
      const snapshot = await state.ext.ls.readFullState(getQueryOptions());
      storeLastSnapshot(snapshot, "full");
    });
  });

  ui.restoreLastSnapshot?.addEventListener("click", () => {
    void runWithBusy("Restore last snapshot", async () => {
      if (!state.snapshots.last?.params) {
        throw new Error("No snapshot in memory. Read/import one first.");
      }
      const restoredCount = await state.ext.ls.writeStateSnapshot(state.snapshots.last, {
        paramDelayMs: getLinnstrumentSyncOptions().paramDelayMs,
      });
      appendLog("success", "Restored last snapshot", {
        restoredCount,
        source: state.snapshots.last.source || "runtime",
      });
    });
  });

  ui.markSnapshotA?.addEventListener("click", () => {
    if (!state.snapshots.last?.params) {
      appendLog("warn", "No last snapshot available to mark as A.");
      return;
    }
    state.snapshots.a = JSON.parse(JSON.stringify(state.snapshots.last));
    appendLog("info", "Marked snapshot A", {
      capturedAt: state.snapshots.a.capturedAt,
      parameterCount: state.snapshots.a.parameterCount,
    });
  });

  ui.markSnapshotB?.addEventListener("click", () => {
    if (!state.snapshots.last?.params) {
      appendLog("warn", "No last snapshot available to mark as B.");
      return;
    }
    state.snapshots.b = JSON.parse(JSON.stringify(state.snapshots.last));
    appendLog("info", "Marked snapshot B", {
      capturedAt: state.snapshots.b.capturedAt,
      parameterCount: state.snapshots.b.parameterCount,
    });
  });

  ui.diffSnapshots?.addEventListener("click", () => {
    void runWithBusy("Diff snapshot A vs B", async () => {
      if (!state.snapshots.a?.params || !state.snapshots.b?.params) {
        throw new Error("Snapshot A and B must both be marked first.");
      }
      const changed = state.ext.ls.diffSnapshots(state.snapshots.a, state.snapshots.b);
      appendLog("info", "Diff A vs B", {
        changedCount: changed.length,
        changed,
      });
    });
  });

  ui.verifyKnownDefaultsOnly?.addEventListener("click", () => {
    void runWithBusy("Verify known defaults only", async () => {
      const verification = await debugApi.verifyKnownDefaultProfile({
        mpeEnabled: isMpeModeEnabled(),
      });
      appendLog("info", "Known-default verification", {
        ok: verification.ok,
        mismatchCount: verification.mismatchCount,
        mismatches: verification.mismatches,
      });
    });
  });

  ui.firmwareBounce?.addEventListener("click", () => {
    void runWithBusy("Firmware bounce (1->0)", async () => {
      await state.ext.ls.writeDeviceUserFirmwareMode(state.ext.ls.enums.USER_FIRMWARE_MODE.USER);
      await sleepWithStop(PRESET_LOAD_BOUNCE_DELAY_MS);
      await state.ext.ls.writeDeviceUserFirmwareMode(state.ext.ls.enums.USER_FIRMWARE_MODE.FIRMWARE);
    });
  });

  ui.panicAllNotesOff?.addEventListener("click", () => {
    void runWithBusy("Panic all notes off", async () => {
      const output = state.ext.ls.getInstrumentOutput();
      for (let channel = 1; channel <= 16; channel += 1) {
        const ch = (channel - 1) & 0x0f;
        output.send([0xb0 | ch, 123, 0]);
        output.send([0xb0 | ch, 120, 0]);
        output.send([0xe0 | ch, 0, 64]);
      }
      appendLog("warn", "Sent panic all-notes-off + pitchbend reset on channels 1-16.");
    });
  });

  ui.querySingleParam?.addEventListener("click", () => {
    void runWithBusy("Query single NRPN param", async () => {
      const param = clampInt(ui.queryParamNumber?.value, 0, 16383, NRPN.DEVICE_USER_FIRMWARE_MODE);
      const result = await state.ext.ls.readParam(param, getQueryOptions());
      const info = state.ext.ls.describeParam(param);
      appendLog("info", "Single param query result", {
        ...result,
        name: info?.name || null,
        meaning: info?.meaning || null,
      });
    });
  });

  ui.exportLastSnapshot?.addEventListener("click", () => {
    if (!state.snapshots.last?.params) {
      appendLog("warn", "No last snapshot available to export.");
      return;
    }
    if (ui.snapshotJson) {
      ui.snapshotJson.value = JSON.stringify(state.snapshots.last, null, 2);
    }
    appendLog("info", "Exported last snapshot to Snapshot JSON field", {
      parameterCount: state.snapshots.last.parameterCount,
    });
  });

  ui.importSnapshotJson?.addEventListener("click", () => {
    const raw = ui.snapshotJson?.value || "";
    if (!raw.trim()) {
      appendLog("warn", "Snapshot JSON is empty.");
      return;
    }
    try {
      const normalized = state.ext.ls.normalizeSnapshotInput(raw, null);
      if (!normalized?.params) {
        throw new Error("Could not parse snapshot JSON.");
      }
      state.snapshots.last = normalized;
      state.ext.state.previous = normalized;
      appendLog("success", "Imported snapshot JSON into last snapshot", {
        parameterCount: normalized.parameterCount || Object.keys(normalized.params || {}).length,
      });
    } catch (err) {
      appendLog("error", "Failed to import snapshot JSON", err?.message || String(err));
    }
  });

  ui.clearLog?.addEventListener("click", () => {
    if (ui.debugLog) {
      ui.debugLog.textContent = "";
    }
  });
}

function storeLastSnapshot(snapshot, source = "runtime") {
  state.snapshots.last = snapshot;
  state.ext.state.previous = snapshot;
  appendLog("success", "Captured snapshot", {
    source,
    capturedAt: snapshot.capturedAt,
    parameterCount: snapshot.parameterCount,
    errors: snapshot.errors?.length || 0,
  });
}

async function enableWebMidi() {
  if (!window.WebMidi) {
    throw new Error("WebMidi library not found. Check ./lib/webmidi.iife.min.js");
  }

  if (state.webMidiEnabled) {
    appendLog("info", "WebMIDI already enabled");
    return;
  }

  await window.WebMidi.enable();
  state.webMidiEnabled = true;
  bindWebMidiHotplugListeners();
  populatePortSelects();
  autoSelectDefaultPorts();
  updateConnectionStatus();
  appendLog("success", "WebMIDI enabled (manual trigger)");
}

async function disableWebMidi() {
  disconnectPorts();

  if (state.webMidiEnabled && typeof window.WebMidi?.disable === "function") {
    await window.WebMidi.disable();
  }

  state.webMidiEnabled = false;
  fillSelect(ui.instrumentInputPort, []);
  fillSelect(ui.instrumentOutputPort, []);
  updateConnectionStatus();
  appendLog("warn", "WebMIDI disabled (manual trigger)");
}

function bindWebMidiHotplugListeners() {
  if (state.webMidiListenersBound || typeof window.WebMidi?.addListener !== "function") {
    return;
  }

  window.WebMidi.addListener("connected", (event) => {
    appendLog("info", "MIDI connected event", {
      name: event?.port?.name || "(unknown)",
      type: event?.port?.type || "unknown",
    });
    if (state.webMidiEnabled) {
      populatePortSelects();
      updateConnectionStatus();
    }
  });

  window.WebMidi.addListener("disconnected", (event) => {
    appendLog("warn", "MIDI disconnected event", {
      name: event?.port?.name || "(unknown)",
      type: event?.port?.type || "unknown",
    });
    if (state.ext.midi.instrumentInput?.name === event?.port?.name) {
      state.ext.midi.instrumentInput = null;
    }
    if (state.ext.midi.instrumentOutput?.name === event?.port?.name) {
      state.ext.midi.instrumentOutput = null;
    }
    if (state.webMidiEnabled) {
      populatePortSelects();
      updateConnectionStatus();
    }
  });

  state.webMidiListenersBound = true;
}

function ensureWebMidiEnabled() {
  if (!state.webMidiEnabled) {
    throw new Error("WebMIDI is disabled. Click 'Enable WebMIDI' first.");
  }
}

function populatePortSelects() {
  if (!state.webMidiEnabled) {
    fillSelect(ui.instrumentInputPort, []);
    fillSelect(ui.instrumentOutputPort, []);
    return;
  }

  const inputs = window.WebMidi?.inputs || [];
  const outputs = window.WebMidi?.outputs || [];
  fillSelect(ui.instrumentInputPort, inputs.map((port) => port.name));
  fillSelect(ui.instrumentOutputPort, outputs.map((port) => port.name));
}

function autoSelectDefaultPorts() {
  if (ui.instrumentInputPort && !ui.instrumentInputPort.value) {
    ui.instrumentInputPort.value = defaultConfig.instrumentInputPort;
  }
  if (ui.instrumentOutputPort && !ui.instrumentOutputPort.value) {
    ui.instrumentOutputPort.value = defaultConfig.instrumentOutputPort;
  }
}

function fillSelect(select, names = []) {
  if (!select) {
    return;
  }

  const previous = select.value;
  select.textContent = "";

  const noneOption = document.createElement("option");
  noneOption.value = "";
  noneOption.textContent = "(none)";
  select.append(noneOption);

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.append(option);
  }

  if (previous && names.includes(previous)) {
    select.value = previous;
  }
}

function connectSelectedPorts() {
  ensureWebMidiEnabled();

  const inputName = ui.instrumentInputPort?.value || "";
  const outputName = ui.instrumentOutputPort?.value || "";

  state.ext.config.instrumentInputPort = inputName;
  state.ext.config.instrumentOutputPort = outputName;
  state.ext.config.mpeEnabled = isMpeModeEnabled();
  state.ext.config.applyControlModeToRightSplit = getLinnstrumentSyncOptions().applyControlModeToRightSplit;
  state.ext.config.outputPitchBendRangeSemitones = getPitchBendRangeFromUi();

  state.ext.midi.instrumentInput = inputName ? window.WebMidi.getInputByName(inputName) || null : null;
  state.ext.midi.instrumentOutput = outputName ? window.WebMidi.getOutputByName(outputName) || null : null;

  appendLog("info", "Connected selected ports", {
    instrumentInput: state.ext.midi.instrumentInput?.name || null,
    instrumentOutput: state.ext.midi.instrumentOutput?.name || null,
    options: {
      mpeEnabled: isMpeModeEnabled(),
      applyControlModeToRightSplit: getLinnstrumentSyncOptions().applyControlModeToRightSplit,
      nrpnDelayMs: getLinnstrumentSyncOptions().paramDelayMs,
    },
  });

  updateConnectionStatus();
}

function disconnectPorts() {
  state.ext.midi.instrumentInput = null;
  state.ext.midi.instrumentOutput = null;
  appendLog("warn", "Disconnected debug MIDI ports");
  updateConnectionStatus();
}

function updateConnectionStatus() {
  const midiStatus = state.webMidiEnabled ? "enabled" : "disabled";
  const inName = state.ext.midi.instrumentInput?.name || "(none)";
  const outName = state.ext.midi.instrumentOutput?.name || "(none)";
  const status = `WebMIDI=${midiStatus} | Input=${inName} | Output=${outName}`;
  if (ui.connectionStatus) {
    ui.connectionStatus.textContent = status;
  }
}

function getTimingConfig() {
  return {
    initSettleDelayMs: clampInt(ui.initSettleDelayMs?.value, 0, 2000, DEFAULT_TIMING.initSettleDelayMs),
    stageDelayMs: clampInt(ui.stageDelayMs?.value, 0, 2000, DEFAULT_TIMING.stageDelayMs),
    criticalRetryDelayMs: clampInt(ui.criticalRetryDelayMs?.value, 0, 2000, DEFAULT_TIMING.criticalRetryDelayMs),
    ledSweepRowDelayMs: clampInt(ui.ledSweepRowDelayMs?.value, 0, 2000, DEFAULT_TIMING.ledSweepRowDelayMs),
    safeExitNrpnDelayMs: clampInt(ui.safeExitNrpnDelayMs?.value, 0, 2000, DEFAULT_TIMING.safeExitNrpnDelayMs),
  };
}

function getLinnstrumentSyncOptions() {
  const paramDelayMs = clampInt(
    ui.nrpnDelayMs?.value,
    0,
    2000,
    defaultConfig.linnstrumentNrpnParamDelayMs,
  );
  return {
    paramDelayMs,
    applyControlModeToRightSplit: Boolean(ui.applyRightSplit?.checked),
  };
}

function getQueryOptions() {
  return {
    timeoutMs: clampInt(ui.queryTimeoutMs?.value, 200, 5000, 1200),
  };
}

function isMpeModeEnabled() {
  return Boolean(ui.mpeEnabled?.checked);
}

function getPitchBendRangeFromUi() {
  return clampInt(ui.bendRange?.value, 0, 96, defaultConfig.outputPitchBendRangeSemitones);
}

async function runWithBusy(label, runner) {
  if (state.busy) {
    appendLog("warn", `Skipped "${label}" because another action is currently running.`);
    return;
  }

  state.busy = true;
  state.stopRequested = false;
  setActionButtonsDisabled(true);
  const startedAtMs = performance.now();
  appendLog("info", `START ${label}`);
  try {
    await runner();
    if (state.stopRequested) {
      appendLog("warn", `STOP ${label}`, {
        durationMs: Math.round(performance.now() - startedAtMs),
      });
    } else {
      appendLog("success", `DONE ${label}`, {
        durationMs: Math.round(performance.now() - startedAtMs),
      });
    }
  } catch (err) {
    if (state.stopRequested) {
      appendLog("warn", `STOP ${label}`, {
        durationMs: Math.round(performance.now() - startedAtMs),
      });
    } else {
      appendLog("error", `FAIL ${label}`, err?.message || String(err));
    }
  } finally {
    state.busy = false;
    state.stopRequested = false;
    setActionButtonsDisabled(false);
  }
}

function setActionButtonsDisabled(disabled) {
  const buttons = document.querySelectorAll("[data-action-btn='true']");
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

function assertNotStopped() {
  if (state.stopRequested) {
    throw new Error("Stopped by user request.");
  }
}

async function sleepWithStop(ms) {
  let remaining = clampInt(ms, 0, 60_000, 0);
  while (remaining > 0) {
    assertNotStopped();
    const chunk = Math.min(remaining, 25);
    await sleep(chunk);
    remaining -= chunk;
  }
}

function renderStageActions() {
  renderActionColumn(ui.initActions, "init", buildInitStageActions());
  renderActionColumn(ui.exitActions, "exit", buildExitStageActions());
  renderActionColumn(ui.generalActions, "general", buildGeneralActions());
}

function renderActionColumn(container, stage, actions) {
  if (!container) {
    return;
  }

  container.textContent = "";
  actions.forEach((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-outline-secondary btn-sm";
    button.textContent = `${String(index + 1).padStart(2, "0")}. ${action.label}`;
    button.setAttribute("data-action-btn", "true");
    button.addEventListener("click", () => {
      void runWithBusy(`${stage.toUpperCase()} ${index + 1}: ${action.label}`, async () => {
        await action.run();
      });
    });
    container.append(button);
  });
}

async function runActionSequence(stage, actions) {
  appendLog("info", `[${stage}] sequence-start`, { stepCount: actions.length });
  for (let index = 0; index < actions.length; index += 1) {
    assertNotStopped();
    const action = actions[index];
    appendLog("info", `[${stage}] step ${index + 1}/${actions.length} ${action.label}`);
    await action.run();
  }
  appendLog("success", `[${stage}] sequence-complete`, { stepCount: actions.length });
}

function createSleepAction(label, ms) {
  return {
    label,
    run: async () => {
      appendLog("info", "sleep", { ms });
      await sleepWithStop(ms);
    },
  };
}

function createParamSetAction(label, param, value, options = {}) {
  return {
    label,
    run: async () => {
      assertNotStopped();
      const paramInfo = state.ext.ls.describeParam(param);
      const syncOptions = { ...getLinnstrumentSyncOptions() };
      if (Number.isFinite(options.paramDelayMs)) {
        syncOptions.paramDelayMs = options.paramDelayMs;
      }
      appendLog("info", "nrpn-set", {
        label,
        param,
        paramName: paramInfo?.name || null,
        paramMeaning: paramInfo?.meaning || null,
        value,
        syncOptions,
      });
      await state.ext.ls.writeParam(param, value, syncOptions);
      if (param === NRPN.SPLIT_LEFT_OCTAVE) {
        state.leftOctaveCache = value;
      }
      if (param === NRPN.SPLIT_RIGHT_OCTAVE) {
        state.rightOctaveCache = value;
      }
    },
  };
}

function buildInitStageActions() {
  const actions = [];
  const syncOptions = getLinnstrumentSyncOptions();
  const timing = getTimingConfig();
  const bendRange = getPitchBendRangeFromUi();

  actions.push({
    label: "Connect selected MIDI ports",
    run: async () => {
      connectSelectedPorts();
    },
  });

  actions.push(createSleepAction(`Init settle delay before layout (${timing.initSettleDelayMs}ms)`, timing.initSettleDelayMs));

  actions.push({
    label: "Sweep display to black",
    run: async () => {
      assertNotStopped();
      appendLog("info", "display-sweep", {
        rowDelayMs: timing.ledSweepRowDelayMs,
        color: "BLACK",
      });
      await state.ext.ls.sweepDisplayBlack({ rowDelayMs: timing.ledSweepRowDelayMs });
    },
  });

  actions.push(createParamSetAction("Set user firmware mode OFF", NRPN.DEVICE_USER_FIRMWARE_MODE, 0));
  actions.push(createSleepAction(`Layout stage delay (${timing.stageDelayMs}ms)`, timing.stageDelayMs));
  actions.push(createParamSetAction("Set split OFF", NRPN.GLOBAL_SPLIT_ACTIVE, 0));
  actions.push(createSleepAction(`Layout stage delay (${timing.stageDelayMs}ms)`, timing.stageDelayMs));
  actions.push(createParamSetAction("Select LEFT split", NRPN.GLOBAL_SELECTED_SPLIT, 0));
  actions.push(createSleepAction(`Layout stage delay (${timing.stageDelayMs}ms)`, timing.stageDelayMs));
  actions.push(createParamSetAction("Set global row offset = 0 (no overlap)", NRPN.GLOBAL_ROW_OFFSET, 0));
  actions.push(createParamSetAction("Set left low row mode OFF", NRPN.SPLIT_LEFT_LOW_ROW_MODE, 0));
  actions.push(createParamSetAction("Set right low row mode OFF", NRPN.SPLIT_RIGHT_LOW_ROW_MODE, 0));
  actions.push(createSleepAction(`Critical retry delay (${timing.criticalRetryDelayMs}ms)`, timing.criticalRetryDelayMs));

  actions.push(createParamSetAction("Pass 1: set left octave", NRPN.SPLIT_LEFT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE));
  actions.push(
    createParamSetAction(
      "Pass 1: set left transpose pitch",
      NRPN.SPLIT_LEFT_TRANSPOSE_PITCH,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    ),
  );
  actions.push(
    createParamSetAction(
      "Pass 1: set left transpose lights",
      NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    ),
  );

  if (syncOptions.applyControlModeToRightSplit) {
    actions.push(createParamSetAction("Pass 1: set right octave", NRPN.SPLIT_RIGHT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE));
    actions.push(
      createParamSetAction(
        "Pass 1: set right transpose pitch",
        NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH,
        CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
      ),
    );
    actions.push(
      createParamSetAction(
        "Pass 1: set right transpose lights",
        NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS,
        CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
      ),
    );
  }

  actions.push(createSleepAction(`Critical retry delay (${timing.criticalRetryDelayMs}ms)`, timing.criticalRetryDelayMs));

  actions.push(createParamSetAction("Pass 2: set left octave", NRPN.SPLIT_LEFT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE));
  actions.push(
    createParamSetAction(
      "Pass 2: set left transpose pitch",
      NRPN.SPLIT_LEFT_TRANSPOSE_PITCH,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
    ),
  );
  actions.push(
    createParamSetAction(
      "Pass 2: set left transpose lights",
      NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS,
      CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
    ),
  );

  if (syncOptions.applyControlModeToRightSplit) {
    actions.push(createParamSetAction("Pass 2: set right octave", NRPN.SPLIT_RIGHT_OCTAVE, CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE));
    actions.push(
      createParamSetAction(
        "Pass 2: set right transpose pitch",
        NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH,
        CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH,
      ),
    );
    actions.push(
      createParamSetAction(
        "Pass 2: set right transpose lights",
        NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS,
        CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS,
      ),
    );
  }

  actions.push(createSleepAction(`Init settle delay after layout (${timing.initSettleDelayMs}ms)`, timing.initSettleDelayMs));
  actions.push(createSleepAction(`Init settle delay before MPE config (${timing.initSettleDelayMs}ms)`, timing.initSettleDelayMs));

  buildMpeInputModeActions(isMpeModeEnabled()).forEach((action) => {
    actions.push(action);
  });

  actions.push(createParamSetAction(`Set left bend range = ${bendRange}`, NRPN.SPLIT_LEFT_BEND_RANGE, bendRange));
  actions.push(createParamSetAction(`Set right bend range = ${bendRange}`, NRPN.SPLIT_RIGHT_BEND_RANGE, bendRange));

  return actions;
}

function buildMpeInputModeActions(enabled) {
  const actions = [];
  if (!enabled) {
    actions.push(createParamSetAction("Set left MIDI mode = One Channel", NRPN.SPLIT_LEFT_MIDI_MODE, 0));
    actions.push(createParamSetAction("Set left main channel = 1", NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1));
    actions.push(createParamSetAction("Set left send Z = ON", NRPN.SPLIT_LEFT_SEND_Z, 1));
    actions.push(createParamSetAction("Set left Z expression = poly aftertouch", NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 0));
    actions.push(createParamSetAction("Set right MIDI mode = One Channel", NRPN.SPLIT_RIGHT_MIDI_MODE, 0));
    actions.push(createParamSetAction("Set right main channel = 1", NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1));
    actions.push(createParamSetAction("Set right send Z = ON", NRPN.SPLIT_RIGHT_SEND_Z, 1));
    actions.push(createParamSetAction("Set right Z expression = poly aftertouch", NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 0));
    return actions;
  }

  actions.push(createParamSetAction("Set left MIDI mode = Channel Per Note", NRPN.SPLIT_LEFT_MIDI_MODE, 1));
  actions.push(createParamSetAction("Set left main channel = 1", NRPN.SPLIT_LEFT_MAIN_CHANNEL, 1));
  actions.push(createParamSetAction("Set left send Z = ON", NRPN.SPLIT_LEFT_SEND_Z, 1));
  actions.push(createParamSetAction("Set left Z expression = channel pressure", NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, 1));
  for (let param = NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_LEFT_PER_NOTE_CHANNEL_END; param += 1) {
    const midiChannel = param - 1;
    actions.push(createParamSetAction(`Set left per-note ch ${midiChannel} membership`, param, midiChannel >= 2 ? 1 : 0));
  }

  actions.push(createParamSetAction("Set right MIDI mode = Channel Per Note", NRPN.SPLIT_RIGHT_MIDI_MODE, 1));
  actions.push(createParamSetAction("Set right main channel = 1", NRPN.SPLIT_RIGHT_MAIN_CHANNEL, 1));
  actions.push(createParamSetAction("Set right send Z = ON", NRPN.SPLIT_RIGHT_SEND_Z, 1));
  actions.push(createParamSetAction("Set right Z expression = channel pressure", NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, 1));
  for (let param = NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START; param <= NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_END; param += 1) {
    const midiChannel = param - (NRPN.SPLIT_RIGHT_PER_NOTE_CHANNEL_START - 1);
    actions.push(createParamSetAction(`Set right per-note ch ${midiChannel} membership`, param, midiChannel >= 2 ? 1 : 0));
  }

  return actions;
}

function buildExitStageActions() {
  const actions = [];
  const timing = getTimingConfig();
  const expectedMap = debugApi.buildKnownDefaultNrpnParamMap({ mpeEnabled: isMpeModeEnabled() });
  const entries = Object.entries(expectedMap)
    .map(([param, value]) => ({
      param: clampInt(param, 0, 16383, 0),
      value: clampInt(value, 0, 16383, 0),
    }))
    .sort((left, right) => left.param - right.param);

  actions.push({
    label: "Connect selected MIDI ports",
    run: async () => {
      connectSelectedPorts();
    },
  });

  actions.push({
    label: "Build known-default restore profile (from current MPE toggle)",
    run: async () => {
      appendLog("info", "exit-known-default-profile", {
        mpeEnabled: isMpeModeEnabled(),
        restoreParamCount: entries.length,
        restoreTimingMs: timing.safeExitNrpnDelayMs,
      });
    },
  });

  entries.forEach((entry) => {
    const paramInfo = state.ext.ls.describeParam(entry.param);
    const nameSuffix = paramInfo?.name ? ` (${paramInfo.name})` : "";
    const label = `Restore param ${entry.param}${nameSuffix} -> ${entry.value}`;
    actions.push(createParamSetAction(label, entry.param, entry.value, { paramDelayMs: timing.safeExitNrpnDelayMs }));
  });

  actions.push({
    label: "Verify known-default profile (requires input + output)",
    run: async () => {
      const verification = await debugApi.verifyKnownDefaultProfile({
        mpeEnabled: isMpeModeEnabled(),
      });
      appendLog("info", "known-default-verify", {
        ok: verification.ok,
        mismatchCount: verification.mismatchCount,
        mismatches: verification.mismatches,
      });
      if (!verification.ok) {
        throw new Error(`Known-default verification failed with ${verification.mismatchCount} mismatch(es).`);
      }
    },
  });

  return actions;
}

function buildGeneralActions() {
  const actions = [];
  const timing = getTimingConfig();

  actions.push(createParamSetAction("Enter user-firmware mode", NRPN.DEVICE_USER_FIRMWARE_MODE, 1));
  actions.push(createParamSetAction("Leave user-firmware mode", NRPN.DEVICE_USER_FIRMWARE_MODE, 0));

  actions.push({
    label: "Display sweep to black",
    run: async () => {
      assertNotStopped();
      await state.ext.ls.sweepDisplayBlack({ rowDelayMs: timing.ledSweepRowDelayMs });
    },
  });

  actions.push({
    label: "Display sweep to white",
    run: async () => {
      assertNotStopped();
      await state.ext.ls.sweepDisplayWhite({ rowDelayMs: timing.ledSweepRowDelayMs });
    },
  });

  for (let preset = 1; preset <= 6; preset += 1) {
    actions.push({
      label: `Load preset ${preset} (with firmware bounce)`,
      run: async () => {
        assertNotStopped();
        await state.ext.ls.loadPreset(preset, {
          ...getLinnstrumentSyncOptions(),
          bounceUserFirmware: true,
        });
      },
    });
  }

  actions.push({
    label: "Decrease octave (left + right split)",
    run: async () => {
      await shiftOctave(-1);
    },
  });

  actions.push({
    label: "Increase octave (left + right split)",
    run: async () => {
      await shiftOctave(1);
    },
  });

  actions.push({
    label: "Apply full MPE mode config in one call",
    run: async () => {
      await state.ext.ls.applyMpeInputMode(true, getLinnstrumentSyncOptions());
      appendLog("info", "apply-mpe-input-mode", { enabled: true });
    },
  });

  actions.push({
    label: "Apply full non-MPE mode config in one call",
    run: async () => {
      await state.ext.ls.applyMpeInputMode(false, getLinnstrumentSyncOptions());
      appendLog("info", "apply-mpe-input-mode", { enabled: false });
    },
  });

  return actions;
}

async function shiftOctave(delta) {
  const leftCurrent = await queryCurrentOctave(NRPN.SPLIT_LEFT_OCTAVE, state.leftOctaveCache);
  const rightCurrent = await queryCurrentOctave(NRPN.SPLIT_RIGHT_OCTAVE, state.rightOctaveCache);

  const leftNext = clampInt(leftCurrent + delta, 0, 10, leftCurrent);
  const rightNext = clampInt(rightCurrent + delta, 0, 10, rightCurrent);

  appendLog("info", "shift-octave", {
    delta,
    leftCurrent,
    leftNext,
    rightCurrent,
    rightNext,
  });

  await state.ext.ls.writeParam(NRPN.SPLIT_LEFT_OCTAVE, leftNext, getLinnstrumentSyncOptions());
  await state.ext.ls.writeParam(NRPN.SPLIT_RIGHT_OCTAVE, rightNext, getLinnstrumentSyncOptions());

  state.leftOctaveCache = leftNext;
  state.rightOctaveCache = rightNext;
}

async function queryCurrentOctave(param, fallback) {
  if (!state.ext.midi.instrumentInput) {
    appendLog("warn", "Octave query skipped (no instrument input), using cached fallback", {
      param,
      fallback,
    });
    return fallback;
  }

  try {
    const result = await state.ext.ls.readParam(param, getQueryOptions());
    const value = clampInt(result?.value, 0, 127, fallback);
    appendLog("info", "Octave query response", {
      param,
      value,
      channel: result?.channel || null,
    });
    return value;
  } catch (err) {
    appendLog("warn", "Octave query failed, using cached fallback", {
      param,
      fallback,
      error: err?.message || String(err),
    });
    return fallback;
  }
}

function appendLog(level, message, payload = null) {
  const timestamp = new Date().toISOString();
  const line = payload == null
    ? `[${timestamp}] [${level.toUpperCase()}] ${message}`
    : `[${timestamp}] [${level.toUpperCase()}] ${message} ${safeJson(payload)}`;

  const method = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  method(`[debug] ${line}`);

  if (!ui.debugLog) {
    return;
  }

  const lineEl = document.createElement("p");
  lineEl.className = "log-line";
  lineEl.textContent = line;
  ui.debugLog.append(lineEl);
  ui.debugLog.scrollTop = ui.debugLog.scrollHeight;
}

function safeJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_err) {
    return String(value);
  }
}
