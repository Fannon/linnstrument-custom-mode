import { log, logActiveState } from "./log.js";
import { initConfig, persistConfig, clearPersistedConfig, defaultConfig } from "./config.js";
import { resetGrid, getGridDict, generateGrid, drawGrid, getGridMappingSignature } from "./grid.js";
import { coordKey, debounce } from "./utils.js";
import { resolveUiLedColor, getUiTextTone, withAlpha } from "./colors.js";
import { PRESETS, buildLayoutDefinition as buildLayoutDefinitionCore } from "./layout-logic.js";
import {
  CONTROL_OVERLAY_TRIGGER_COORD,
  createControlOverlayState,
  isControlOverlayActive as isControlOverlayActiveCore,
  pressControlOverlay,
  releaseControlOverlay,
} from "./control-overlay.js";
import {
  NOTE_NAMES,
  MODES,
  clampInt,
  detectChordNameFromMidiNotes,
  parsePitchSlideSetting,
  parseLedColor,
  mod,
  getPitchBend14,
  resolveNoOverlapPadCoord as resolveNoOverlapPadCoordCore,
  getActiveLayoutRowOffset as getActiveLayoutRowOffsetCore,
} from "./core-logic.js";
import {
  getRoutedInputChannel,
  isMpeModeEnabled as isMpeModeEnabledCore,
  resolveOutputChannel,
  listOutputChannelsForInputChannel,
  shouldForwardPitchBendForInputChannel,
} from "./mpe-routing.js";
import { getValue, setText, setValue, fillSelect } from "./ui-state.js";
import {
  DEFAULT_HIDDEN_MIDI_PORT_NAMES,
  listVisiblePortNames,
  sanitizeSelectedPortName,
  autoSelectLinnStrumentPorts as autoSelectLinnStrumentPortsCore,
  isPotentialFeedbackInput,
  detachMidiInputListeners,
  attachInstrumentInputListeners as attachInstrumentInputListenersCore,
  attachLoopInputListeners as attachLoopInputListenersCore,
} from "./midi-io.js";
import {
  getChannel,
  noteKey,
  withInputSource,
  markRecentLoopNoteOn as markRecentLoopNoteOnCore,
  wasRecentlyForwardedLoopNoteOn as wasRecentlyForwardedLoopNoteOnCore,
  findCoordByRoutedNote as findCoordByRoutedNoteCore,
  modTouchId,
  overlayTouchIdForEvent as overlayTouchIdForEventCore,
  extractRawTouchEvent,
  extractRawControlChangeEvent,
} from "./routing.js";
import {
  NRPN,
  CONTROL_MODE_LAYOUT,
  setLinnStrumentParamValue,
  applyLinnStrumentStandardLayout,
  applyLinnStrumentMpeInputMode,
  sweepLinnStrumentLightsOff,
  sleep,
} from "./instrument-sync.js";
import {
  SAFE_EXIT_NRPN_DELAY_MS,
  CONTROL_MODE_CHANGED_NRPN_PARAMS,
  createLinnstrumentDebugApi,
} from "./linnstrument-debug-utils.js";
const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));

const INSTRUMENT_COLORS = {
  off: 7,
  mod: 2,
  overlayTrigger: 6,
  keyNatural: 4,
  keyAccidental: 5,
  presetSwitch: 3,
  mode: 3,
  allNotesOff: 9,
  allNotesOn: 10,
  mpeEnabled: 3,
  mpeDisabled: 1,
  octave: 11,
  disabled: 7,
  play: 8,
  tonic: 9,
  root: 9,
  held: 1,
  selected: 1,
  sameNote: 1,
};

const DEBUG_CONTROL_OVERLAY = false;
const DEBUG_MIDI_FLOW = false;
const DEBUG_PITCH_TRACE = false;
const MOD_WHEEL_SMOOTHING_ALPHA = 0.35;
const AUTO_APPLY_FIELD_IDS = [
  "instrumentInputPort",
  "instrumentOutputPort",
  "loopOutputPort",
  "loopInputPort",
  "presetSelect",
  "layoutRowOffsetScale",
  "layoutRowOffsetAllNotes",
  "pitchSlideSemitonesPerPadStandard",
  "pitchSlideSemitonesPerPadMech",
  "outputPitchBendRangeSemitones",
  "colorModWheel",
  "colorRootNote",
  "colorScaleNote",
  "colorNonScaleNote",
  "deviceStartNote",
  "deviceRowOffset",
  "exitTargetPreset",
  "stateTonicSelect",
  "stateScaleSelect",
];
const AUTO_APPLY_RECONNECT_FIELD_IDS = new Set([
  "instrumentInputPort",
  "instrumentOutputPort",
  "loopOutputPort",
  "loopInputPort",
]);

const CONTROL_MODE_TRANSPOSE_PASSES = 2;
const INIT_LAYOUT_SETTLE_DELAY_MS = 60;
const NRPN_CC_NUMBERS = new Set([6, 38, 98, 99, 100, 101]);

export const ext = {
  config: {},
  grid: null,
  gridDict: {},
  layout: {
    cellMeta: {},
    padMap: {},
    gridMappingSignature: "",
  },
  midi: {
    instrumentInput: null,
    instrumentOutput: null,
    loopOutput: null,
    loopInput: null,
  },
  state: {
    heldPads: new Set(),
    backchannelNotesByKey: new Map(),
    backchannelCoordsByKey: new Map(),
    backchannelPadRefCount: new Map(),
    routedNotesByPad: new Map(),
    activeLoopNotes: new Set(),
    recentLoopNoteOns: new Map(),
    modPressuresByPad: new Map(),
    modChannelsByPad: new Map(),
    modWheelSmoothed: null,
    controlOverlay: createControlOverlayState(),
    lastPitchBend14ByChannel: new Map(),
    detectedChordName: "",
    instrumentPaintingEnabled: true,
    suppressInstrumentNrpnCcForwarding: false,
    startupSnapshot: null,
    previous: null,
    exited: false,
  },
  fn: {},
};
window.ext = ext;
let midiHotplugReconcileTimer = null;
let midiHotplugReconcileInFlight = false;
let midiHotplugReconcileQueued = false;
let linnstrumentDebug = null;

WebMidi.enable()
  .then(init)
  .catch((err) => {
    console.error(err);
    const logEl = document.getElementById("log");
    if (logEl) {
      log.error(`Failed to enable WebMIDI: ${err?.message || err}`);
    }
  });

async function init() {
  const initStartedAtMs = performance.now();
  ext.config = initConfig();
  linnstrumentDebug = createLinnstrumentDebugApi({
    ext,
    log,
    defaultConfig,
    isMpeModeEnabledCore,
    isMpeModeEnabled,
    getLinnstrumentSyncOptions,
    initLayoutSettleDelayMs: INIT_LAYOUT_SETTLE_DELAY_MS,
    sweepLinnStrumentLightsOff,
  });

  console.log("[INIT SUMMARY] Startup requested", {
    startedAt: new Date().toISOString(),
    ports: {
      instrumentInput: ext.config.instrumentInputPort,
      instrumentOutput: ext.config.instrumentOutputPort,
      loopOutput: ext.config.loopOutputPort,
      loopInput: ext.config.loopInputPort,
    },
    linnstrument: buildStartupLinnstrumentParamSummary(ext.config),
  });

  bindUi();
  bindMidiHotplugListeners();
  populatePresetSelect();
  populateStateSelectors();
  populateUiFromConfig();
  refreshPortSelectors({ autoSelectInstrument: shouldAutoSelectPorts() });

  await connectMidiFromConfig();
  const startupStateCaptured = await linnstrumentDebug.capturePreviousLinnstrumentState("startup-before-init", {
    params: CONTROL_MODE_CHANGED_NRPN_PARAMS,
  });
  const standardLayoutApplied = await ensureLinnStrumentStandardLayout("startup");
  await sleep(INIT_LAYOUT_SETTLE_DELAY_MS);
  const mpeInputModeConfigured = await configureLinnStrumentMpeInputMode(isMpeModeEnabled(), "startup");
  await resendPitchBendRangeFromConfig({ includeLoop: false, source: "startup" });
  rebuildLayout();

  ext.util = linnstrumentDebug.createExtUtilApi();

  log.success("Prototype initialized.");
  log.info("Using LinnStrument standard input decoding.");
  console.log("[INIT SUMMARY] Startup completed", {
    durationMs: Math.round(performance.now() - initStartedAtMs),
    instrumentOutputConnected: Boolean(ext.midi.instrumentOutput),
    standardLayoutApplied,
    mpeInputModeConfigured,
    startupStateCaptured,
    linnstrument: buildStartupLinnstrumentParamSummary(ext.config),
  });
}

function bindMidiHotplugListeners() {
  if (typeof WebMidi?.addListener !== "function") {
    return;
  }

  WebMidi.addListener("connected", (event) => {
    queueMidiHotplugReconcile("connected", event);
  });

  WebMidi.addListener("disconnected", (event) => {
    queueMidiHotplugReconcile("disconnected", event);
  });
}

function queueMidiHotplugReconcile(trigger = "hotplug", event = null) {
  const portName = event?.port?.name ? ` (${event.port.name})` : "";
  if (midiHotplugReconcileTimer) {
    clearTimeout(midiHotplugReconcileTimer);
  }
  midiHotplugReconcileTimer = setTimeout(() => {
    midiHotplugReconcileTimer = null;
    void reconcileMidiAfterHotplug(`${trigger}${portName}`);
  }, 90);
}

async function reconcileMidiAfterHotplug(trigger) {
  if (midiHotplugReconcileInFlight) {
    midiHotplugReconcileQueued = true;
    return;
  }

  midiHotplugReconcileInFlight = true;
  try {
    refreshPortSelectors({ autoSelectInstrument: shouldAutoSelectPorts() });
    await connectMidiFromConfig();
    log.info(`Reconciled MIDI connections after ${trigger}.`);
  } catch (err) {
    log.warn(`Failed MIDI hot-plug reconcile after ${trigger}: ${err?.message || err}`);
  } finally {
    midiHotplugReconcileInFlight = false;
    if (midiHotplugReconcileQueued) {
      midiHotplugReconcileQueued = false;
      queueMidiHotplugReconcile("queued-hotplug");
    }
  }
}



function bindUi() {
  document.getElementById("exitApp")?.addEventListener("click", async () => {
    const exitStartedAtMs = performance.now();
    const exitSummary = buildExitLinnstrumentParamSummary(ext.config);
    console.log("[EXIT SUMMARY] Exit & Restore requested", {
      startedAt: new Date().toISOString(),
      instrumentOutputConnected: Boolean(ext.midi.instrumentOutput),
      linnstrument: exitSummary,
    });

    ext.state.exited = true;
    ext.state.instrumentPaintingEnabled = false;

    // Stop listening to hardware to avoid further calculations/repaints
    detachInstrumentInputListeners();
    detachLoopInputListeners();

    let restoreApplied = false;
    let restoreError = null;
    let restoreMethod = "none";
    if (ext.midi.instrumentOutput) {
      try {
        const requestedMpeEnabled = isMpeModeEnabled();
        const baselineParams = linnstrumentDebug.buildKnownDefaultNrpnParamMap({ mpeEnabled: requestedMpeEnabled });
        const baselineSnapshot = linnstrumentDebug.createSnapshotFromParamMap(
          baselineParams,
          "exit-known-default-profile",
        );
        const restoredCount = await linnstrumentDebug.restoreLinnStrumentStateSnapshot(baselineSnapshot, {
          paramDelayMs: SAFE_EXIT_NRPN_DELAY_MS,
        });
        restoreMethod = "known-default-profile";
        restoreApplied = true;
        log.info(
          `LinnStrument restored ${restoredCount} known-default parameters (${SAFE_EXIT_NRPN_DELAY_MS}ms NRPN delay). App disconnected.`,
        );
      } catch (err) {
        restoreError = err?.message || String(err);
        log.warn(`Known-default LinnStrument restore failed during exit: ${restoreError}`);
      }
    } else {
      log.warn("LinnStrument output not connected. Local state shut down.");
    }

    updateRoutingStatus();

    console.log("[EXIT SUMMARY] Exit & Restore completed", {
      durationMs: Math.round(performance.now() - exitStartedAtMs),
      instrumentOutputConnected: Boolean(ext.midi.instrumentOutput),
      restoreApplied,
      restoreMethod,
      restoreError,
      linnstrument: exitSummary,
    });

    // Update tooltip to summarize deterministic exit behavior.
    const exitBtn = document.getElementById("exitApp");
    if (exitBtn) {
      exitBtn.title = "Restores LinnStrument to a deterministic known-default baseline.";
    }
  });

  bindAutoApplyConfigFields();

  document.getElementById("resetConfig")?.addEventListener("click", async (event) => {
    event.preventDefault();
    if (!confirm("Are you sure you want to reset all settings to defaults?")) {
      return;
    }
    clearPersistedConfig();
    ext.config = { ...defaultConfig };
    populateUiFromConfig();
    refreshPortSelectors({ autoSelectInstrument: true });
    await connectMidiFromConfig();
    await ensureLinnStrumentStandardLayout("reset-defaults");
    await sleep(INIT_LAYOUT_SETTLE_DELAY_MS);
    await configureLinnStrumentMpeInputMode(isMpeModeEnabled(), "reset-defaults");
    await resendPitchBendRangeFromConfig({ includeLoop: false, source: "reset-defaults" });
    rebuildLayout({ paintInstrument: true });
    log.warn("Configuration reset to defaults.");
  });

  document.getElementById("resendPbRange")?.addEventListener("click", async () => {
    readConfigFromUi();
    await resendPitchBendRangeFromConfig({ includeLoop: true, source: "manual-resend" });
  });

  document.getElementById("panic")?.addEventListener("click", () => {
    clearHeldState();
    log.warn("Sent All Notes Off to loop output.");
  });

  document.getElementById("clearLog")?.addEventListener("click", () => {
    const logEl = document.getElementById("log");
    if (logEl) {
      logEl.innerHTML = "";
    }
  });

  document.getElementById("stateTonicSelect")?.addEventListener("change", (event) => {
    const nextKey = clampInt(event?.target?.value, 0, 11, ext.config.selectedKey ?? defaultConfig.selectedKey);
    applySelectedKey(nextKey, { trigger: "key-ui" });
  });

  document.getElementById("stateScaleSelect")?.addEventListener("change", (event) => {
    const modeId = String(event?.target?.value || "");
    applySelectedMode(modeId, { trigger: "scale-ui" });
  });

  document.getElementById("stateModeScaleBtn")?.addEventListener("click", () => {
    setAllNotesMode(false, { trigger: "all-notes-ui" });
  });

  document.getElementById("stateModeAllBtn")?.addEventListener("click", () => {
    setAllNotesMode(true, { trigger: "all-notes-ui" });
  });

  window.addEventListener(
    "resize",
    debounce(() => {
      drawGrid(ext.grid, ext.layout.cellMeta);
      paintInstrumentLayout();
      refreshHeldCellClasses();
    }, 120),
  );

  bindSurfacePointerInput();
}

let autoApplyChain = Promise.resolve();

function bindAutoApplyConfigFields() {
  AUTO_APPLY_FIELD_IDS.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    el.addEventListener("change", () => {
      queueAutoApplyConfigFromUi(id);
    });
  });
}

function queueAutoApplyConfigFromUi(triggerId = "ui-change") {
  autoApplyChain = autoApplyChain
    .then(() => applyConfigChangeFromUi(triggerId))
    .catch((err) => {
      console.warn("Auto-apply config update failed", err);
      log.error(`Could not auto-apply ${triggerId}: ${err?.message || err}`);
    });
}

async function applyConfigChangeFromUi(triggerId = "ui-change") {
  readConfigFromUi();

  if (AUTO_APPLY_RECONNECT_FIELD_IDS.has(triggerId)) {
    const wasLocked = Boolean(ext.config.portSelectionLocked);
    ext.config.portSelectionLocked = true;
    if (!wasLocked) {
      log.info("Locked MIDI port auto-detection until Reset Defaults.");
    }
  }

  persistConfig(ext.config);

  if (AUTO_APPLY_RECONNECT_FIELD_IDS.has(triggerId)) {
    await connectMidiFromConfig();
  }

  if (triggerId === "outputPitchBendRangeSemitones") {
    await resendPitchBendRangeFromConfig({ includeLoop: true, source: "ui-output-bend-range" });
  }

  rebuildLayout();
}

function populatePresetSelect() {
  const select = document.getElementById("presetSelect");
  if (!select) {
    return;
  }

  select.innerHTML = "";
  PRESETS.forEach((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    select.appendChild(option);
  });
}

function populateStateSelectors() {
  const tonicSelect = document.getElementById("stateTonicSelect");
  if (tonicSelect) {
    tonicSelect.innerHTML = "";
    NOTE_NAMES.forEach((name, pc) => {
      const option = document.createElement("option");
      option.value = String(pc);
      option.textContent = name;
      tonicSelect.appendChild(option);
    });
  }

  const modeSelect = document.getElementById("stateScaleSelect");
  if (modeSelect) {
    modeSelect.innerHTML = "";
    MODES.forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.name;
      modeSelect.appendChild(option);
    });
  }
}

function populateUiFromConfig() {
  setValue("presetSelect", ext.config.presetId);
  setValue("stateTonicSelect", mod(ext.config.selectedKey ?? defaultConfig.selectedKey, 12));
  setValue("stateScaleSelect", ext.config.selectedModeId ?? defaultConfig.selectedModeId);
  setValue("layoutRowOffsetScale", ext.config.layoutRowOffsetScale);
  setValue("layoutRowOffsetAllNotes", ext.config.layoutRowOffsetAllNotes);
  setValue("pitchSlideSemitonesPerPadStandard", ext.config.pitchSlideSemitonesPerPadStandard);
  setValue("pitchSlideSemitonesPerPadMech", ext.config.pitchSlideSemitonesPerPadMech);
  setValue("outputPitchBendRangeSemitones", ext.config.outputPitchBendRangeSemitones);
  setValue("colorModWheel", parseLedColor(ext.config.colorModWheel, defaultConfig.colorModWheel));
  setValue("colorRootNote", parseLedColor(ext.config.colorRootNote, defaultConfig.colorRootNote));
  setValue("colorScaleNote", parseLedColor(ext.config.colorScaleNote, defaultConfig.colorScaleNote));
  setValue("colorNonScaleNote", parseLedColor(ext.config.colorNonScaleNote, defaultConfig.colorNonScaleNote));
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
  setValue("loopInputPort", ext.config.loopInputPort);
  setValue("exitTargetPreset", ext.config.exitTargetPreset ?? defaultConfig.exitTargetPreset);
  applyUiColorThemeFromConfig();
}

function readConfigFromUi() {
  const presetId = getValue("presetSelect") || defaultConfig.presetId;
  const selectedKey = clampInt(
    getValue("stateTonicSelect"),
    0,
    11,
    ext.config.selectedKey ?? defaultConfig.selectedKey,
  );
  const selectedModeIdRaw = getValue("stateScaleSelect") || ext.config.selectedModeId || defaultConfig.selectedModeId;
  const selectedModeId = MODE_BY_ID[selectedModeIdRaw] ? selectedModeIdRaw : defaultConfig.selectedModeId;
  const layoutRowOffsetScale = clampInt(getValue("layoutRowOffsetScale"), 1, 12, defaultConfig.layoutRowOffsetScale);
  const layoutRowOffsetAllNotes = clampInt(
    getValue("layoutRowOffsetAllNotes"),
    1,
    12,
    defaultConfig.layoutRowOffsetAllNotes,
  );
  const pitchSlideSemitonesPerPadStandard = parsePitchSlideSetting(
    getValue("pitchSlideSemitonesPerPadStandard"),
    defaultConfig.pitchSlideSemitonesPerPadStandard,
  );
  const pitchSlideSemitonesPerPadMech = parsePitchSlideSetting(
    getValue("pitchSlideSemitonesPerPadMech"),
    defaultConfig.pitchSlideSemitonesPerPadMech,
  );
  const outputPitchBendRangeSemitones = clampInt(
    getValue("outputPitchBendRangeSemitones"),
    0,
    96,
    defaultConfig.outputPitchBendRangeSemitones,
  );
  const colorModWheel = parseLedColor(getValue("colorModWheel"), defaultConfig.colorModWheel);
  const colorRootNote = parseLedColor(getValue("colorRootNote"), defaultConfig.colorRootNote);
  const colorScaleNote = parseLedColor(getValue("colorScaleNote"), defaultConfig.colorScaleNote);
  const colorNonScaleNote = parseLedColor(getValue("colorNonScaleNote"), defaultConfig.colorNonScaleNote);
  const deviceStartNote = clampInt(getValue("deviceStartNote"), 0, 127, defaultConfig.deviceStartNote);
  const deviceRowOffset = clampInt(getValue("deviceRowOffset"), 0, 24, defaultConfig.deviceRowOffset);
  const exitTargetPreset = clampInt(getValue("exitTargetPreset"), 1, 6, defaultConfig.exitTargetPreset);

  ext.config = {
    ...ext.config,
    presetId,
    selectedKey,
    selectedModeId,
    layoutRowOffsetScale,
    layoutRowOffsetAllNotes,
    pitchSlideSemitonesPerPadStandard,
    pitchSlideSemitonesPerPadMech,
    outputPitchBendRangeSemitones,
    colorModWheel,
    colorRootNote,
    colorScaleNote,
    colorNonScaleNote,
    deviceStartNote,
    deviceRowOffset,
    exitTargetPreset,
    instrumentInputPort: getValue("instrumentInputPort") || "",
    instrumentOutputPort: getValue("instrumentOutputPort") || "",
    loopOutputPort: getValue("loopOutputPort") || "",
    loopInputPort: getValue("loopInputPort") || "",
  };

  setValue("layoutRowOffsetScale", ext.config.layoutRowOffsetScale);
  setValue("layoutRowOffsetAllNotes", ext.config.layoutRowOffsetAllNotes);
  setValue("pitchSlideSemitonesPerPadStandard", ext.config.pitchSlideSemitonesPerPadStandard);
  setValue("pitchSlideSemitonesPerPadMech", ext.config.pitchSlideSemitonesPerPadMech);
  setValue("outputPitchBendRangeSemitones", ext.config.outputPitchBendRangeSemitones);
  setValue("colorModWheel", parseLedColor(ext.config.colorModWheel, defaultConfig.colorModWheel));
  setValue("colorRootNote", parseLedColor(ext.config.colorRootNote, defaultConfig.colorRootNote));
  setValue("colorScaleNote", parseLedColor(ext.config.colorScaleNote, defaultConfig.colorScaleNote));
  setValue("colorNonScaleNote", parseLedColor(ext.config.colorNonScaleNote, defaultConfig.colorNonScaleNote));
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
  setValue("stateTonicSelect", mod(ext.config.selectedKey ?? defaultConfig.selectedKey, 12));
  setValue("stateScaleSelect", ext.config.selectedModeId ?? defaultConfig.selectedModeId);
  setValue("exitTargetPreset", ext.config.exitTargetPreset);
}

function refreshPortSelectors({ autoSelectInstrument = false } = {}) {
  const inputNames = listVisiblePortNames(WebMidi.inputs);
  const outputNames = listVisiblePortNames(WebMidi.outputs);
  const current = {
    instrumentInputPort: sanitizeSelectedPortName(
      getValue("instrumentInputPort") || ext.config.instrumentInputPort || "",
    ),
    instrumentOutputPort: sanitizeSelectedPortName(
      getValue("instrumentOutputPort") || ext.config.instrumentOutputPort || "",
    ),
    loopOutputPort: sanitizeSelectedPortName(getValue("loopOutputPort") || ext.config.loopOutputPort || ""),
    loopInputPort: sanitizeSelectedPortName(getValue("loopInputPort") || ext.config.loopInputPort || ""),
  };

  fillSelect(document.getElementById("instrumentInputPort"), inputNames, current.instrumentInputPort);
  fillSelect(document.getElementById("instrumentOutputPort"), outputNames, current.instrumentOutputPort);
  fillSelect(document.getElementById("loopOutputPort"), outputNames, current.loopOutputPort, {
    includeEmpty: true,
    emptyLabel: "(none)",
  });
  fillSelect(document.getElementById("loopInputPort"), inputNames, current.loopInputPort, {
    includeEmpty: true,
    emptyLabel: "(none)",
  });

  if (autoSelectInstrument) {
    autoSelectLinnStrumentPorts();
  }

  ext.config.instrumentInputPort = getValue("instrumentInputPort") || "";
  ext.config.instrumentOutputPort = getValue("instrumentOutputPort") || "";
  ext.config.loopOutputPort = getValue("loopOutputPort") || "";
  ext.config.loopInputPort = getValue("loopInputPort") || "";
}

function shouldAutoSelectPorts() {
  return !ext.config.portSelectionLocked;
}

function autoSelectLinnStrumentPorts() {
  autoSelectLinnStrumentPortsCore({
    inputSelect: document.getElementById("instrumentInputPort"),
    outputSelect: document.getElementById("instrumentOutputPort"),
    loopSelect: document.getElementById("loopOutputPort"),
    inputs: WebMidi.inputs,
    outputs: WebMidi.outputs,
    log,
    hiddenNames: DEFAULT_HIDDEN_MIDI_PORT_NAMES,
  });

  // Lightguide input has no default-name auto-selection.
  // Keep it at (none) unless user explicitly picks one (or has one saved).
}

async function connectMidiFromConfig() {
  if (ext.state.exited) {
    return;
  }
  readConfigFromUi();
  detachInstrumentInputListeners();
  detachLoopInputListeners();
  clearAllBackchannelHighlights();

  ext.midi.instrumentInput = null;
  ext.midi.instrumentOutput = null;
  ext.midi.loopOutput = null;
  ext.midi.loopInput = null;

  if (ext.config.instrumentInputPort) {
    const candidateInstrumentInput = WebMidi.getInputByName(ext.config.instrumentInputPort) || null;
    if (candidateInstrumentInput) {
      if (isPotentialFeedbackInput(candidateInstrumentInput.name, ext.config.loopOutputPort)) {
        ext.midi.instrumentInput = null;
        log.error(
          `Instrument input "${candidateInstrumentInput.name}" matches loop output. Disabled instrument input to prevent MIDI feedback.`,
        );
      } else {
        ext.midi.instrumentInput = candidateInstrumentInput;
        attachInstrumentInputListeners(ext.midi.instrumentInput);
        log.success(`Connected LinnStrument input: ${ext.config.instrumentInputPort}`);
      }
    } else {
      log.error(`LinnStrument input not found: ${ext.config.instrumentInputPort}`);
    }
  }

  if (ext.config.instrumentOutputPort) {
    ext.midi.instrumentOutput = WebMidi.getOutputByName(ext.config.instrumentOutputPort) || null;
    if (ext.midi.instrumentOutput) {
      log.success(`Connected LinnStrument output: ${ext.config.instrumentOutputPort}`);
    } else {
      log.warn(`LinnStrument output not found: ${ext.config.instrumentOutputPort}`);
    }
  }

  if (ext.config.loopOutputPort) {
    ext.midi.loopOutput = WebMidi.getOutputByName(ext.config.loopOutputPort) || null;
    if (ext.midi.loopOutput) {
      log.success(`Connected loop output: ${ext.config.loopOutputPort}`);
    } else {
      log.warn(`Loop output not found: ${ext.config.loopOutputPort}`);
    }
  } else {
    log.warn("No loop output selected. Notes will not be routed.");
  }

  if (ext.config.loopInputPort) {
    ext.midi.loopInput = WebMidi.getInputByName(ext.config.loopInputPort) || null;
    if (ext.midi.loopInput) {
      attachLoopInputListeners(ext.midi.loopInput);
      log.success(`Connected lightguide input: ${ext.config.loopInputPort}`);
    } else {
      log.warn(`Lightguide input not found: ${ext.config.loopInputPort}`);
    }
  }

  await resendPitchBendRangeFromConfig({ includeLoop: false, source: "connect-midi" });

  updateRoutingStatus();
}

function detachInstrumentInputListeners() {
  detachMidiInputListeners(ext.midi.instrumentInput, "previous listeners");
}

function detachLoopInputListeners() {
  detachMidiInputListeners(ext.midi.loopInput, "previous lightguide listeners");
}

function attachInstrumentInputListeners(input) {
  attachInstrumentInputListenersCore(input, {
    handleNoteOn,
    handleNoteOff,
    handleControlChange,
    handlePolyPressure,
    handleChannelAftertouch,
    handlePitchBend,
    withInputSource,
  });
}

function attachLoopInputListeners(input) {
  attachLoopInputListenersCore(input, {
    handleBackchannelNoteOn,
    handleBackchannelNoteOff,
    handleBackchannelControlChange,
  });
}

function rebuildLayout(options = {}) {
  if (ext.state.exited) {
    return;
  }
  const { paintInstrument = true, preserveHeldState = false } = options;
  if (!preserveHeldState) {
    clearHeldState();
  }
  const gridMappingSignature = getGridMappingSignature(ext.config);
  if (ext.layout.gridMappingSignature !== gridMappingSignature || !ext.grid) {
    ext.grid = generateGrid(ext.config.deviceStartNote, ext.config.deviceRowOffset, ext.config.deviceColOffset);
    ext.gridDict = getGridDict(ext.grid, ext.config.deviceStartNote);
    ext.layout.gridMappingSignature = gridMappingSignature;
  }

  const layout = buildLayoutDefinition();
  ext.layout.cellMeta = layout.cellMeta;
  ext.layout.padMap = layout.padMap;

  applyUiColorThemeFromConfig();
  drawGrid(ext.grid, ext.layout.cellMeta);
  rehydrateBackchannelHighlights();
  refreshHeldCellClasses();
  if (paintInstrument) {
    paintInstrumentLayout();
  }
  updateStatusUi();
}

function buildLayoutDefinition() {
  return buildLayoutDefinitionCore(ext.config, defaultConfig, {
    controlOverlayActive: isControlOverlayActive(),
  });
}

function bindSurfacePointerInput() {
  const surface = document.getElementById("visualization");
  if (!surface) {
    return;
  }

  surface.addEventListener("pointerdown", (event) => {
    const coord = extractCoordFromSurfaceEvent(event);
    if (!coord) {
      return;
    }
    const touchEvent = createSurfaceTouchEventFromCoord(coord, 100);
    if (!touchEvent) {
      return;
    }
    handleNoteOn({
      note: { number: touchEvent.noteNumber },
      channel: touchEvent.channel,
      rawVelocity: touchEvent.velocity,
    });
    event.preventDefault();
  });

  const releasePointer = (event) => {
    const coord = extractCoordFromSurfaceEvent(event);
    if (!coord) {
      return;
    }
    const touchEvent = createSurfaceTouchEventFromCoord(coord, 0);
    if (!touchEvent) {
      return;
    }
    handleNoteOff({
      note: { number: touchEvent.noteNumber },
      channel: touchEvent.channel,
      rawVelocity: 0,
    });
    event.preventDefault();
  };

  surface.addEventListener("pointerup", releasePointer);
  surface.addEventListener("pointercancel", releasePointer);
}

function extractCoordFromSurfaceEvent(event) {
  const cell = event?.target?.closest?.(".cell");
  if (!cell?.id) {
    return null;
  }
  return cell.id.replace(/^cell-/, "");
}

function createSurfaceTouchEventFromCoord(coord, velocity = 100) {
  const [xStr, yStr] = String(coord).split("-");
  const x = Number.parseInt(xStr, 10);
  const y = Number.parseInt(yStr, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    return null;
  }
  const columns = ext.config.linnStrumentSize / 8;
  const deviceStartNote = clampInt(ext.config.deviceStartNote, 0, 127, defaultConfig.deviceStartNote);
  const noteIndex = y * columns + x;

  return {
    noteNumber: mod(deviceStartNote + noteIndex, 128),
    channel: y + 1,
    velocity: clampInt(velocity, 0, 127, 100),
  };
}

function isControlOverlayActive() {
  return isControlOverlayActiveCore(ext.state.controlOverlay);
}

function isControlOverlayTriggerCoord(coord) {
  return coord === CONTROL_OVERLAY_TRIGGER_COORD;
}

function debugControlOverlay(message, data = null) {
  if (!DEBUG_CONTROL_OVERLAY) {
    return;
  }
  if (data === null) {
    console.debug(`[overlay] ${message}`);
    return;
  }
  console.debug(`[overlay] ${message}`, data);
}

function handleControlOverlayTriggerPress(event) {
  const touchId = overlayTouchIdForEvent(event);
  debugControlOverlay("press:start", {
    coord: event?.coord,
    noteNumber: event?.noteNumber,
    channel: event?.channel,
    touchId,
    stateBefore: { ...ext.state.controlOverlay },
  });
  const result = pressControlOverlay(ext.state.controlOverlay, { touchId });
  debugControlOverlay("press:result", {
    result,
    stateAfter: { ...ext.state.controlOverlay },
  });
  if (result.shouldRebuild) {
    rebuildLayout({ preserveHeldState: true });
    debugControlOverlay("press:rebuild", { active: isControlOverlayActive() });
  }
}

function handleControlOverlayTriggerRelease(event) {
  const touchId = overlayTouchIdForEvent(event);
  debugControlOverlay("release:start", {
    coord: event?.coord,
    noteNumber: event?.noteNumber,
    channel: event?.channel,
    touchId,
    stateBefore: { ...ext.state.controlOverlay },
  });
  const result = releaseControlOverlay(ext.state.controlOverlay, { touchId });
  debugControlOverlay("release:result", {
    result,
    stateAfter: { ...ext.state.controlOverlay },
  });
  if (result.toggled) {
    log.info(`Control overlay ${result.pinned ? "latched on" : "latched off"}.`);
  }
  if (result.shouldRebuild) {
    rebuildLayout({ preserveHeldState: true });
    debugControlOverlay("release:rebuild", { active: isControlOverlayActive() });
  }
}

function applySelectedKey(keyPc, options = {}) {
  const { trigger = "key", flashCoord = null, flashPitchClass = true } = options;
  const nextKey = mod(keyPc, 12);
  const hadTransientState = hasTransientPerformanceState();
  if (hadTransientState) {
    clearHeldState();
    log.warn("Sent All Notes Off before applying root-note selection.");
  }

  if (nextKey === mod(ext.config.selectedKey ?? defaultConfig.selectedKey, 12)) {
    setValue("stateTonicSelect", nextKey);
    return false;
  }

  ext.config.selectedKey = nextKey;
  persistConfig(ext.config);
  rebuildLayout();
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  if (flashPitchClass) {
    flashPlayablePitchClass(nextKey);
  }
  log.info(`Key changed to ${NOTE_NAMES[nextKey]}`);
  logActiveState(buildActiveStatePayload(trigger));
  return true;
}

function applySelectedMode(modeId, options = {}) {
  const { trigger = "scale", flashCoord = null } = options;
  if (!MODE_BY_ID[modeId]) {
    setValue("stateScaleSelect", ext.config.selectedModeId ?? defaultConfig.selectedModeId);
    return false;
  }

  if (ext.config.selectedModeId === modeId) {
    setValue("stateScaleSelect", modeId);
    return false;
  }

  ext.config.selectedModeId = modeId;
  persistConfig(ext.config);
  rebuildLayout();
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  log.info(`Mode changed to ${MODE_BY_ID[ext.config.selectedModeId]?.name || modeId}`);
  logActiveState(buildActiveStatePayload(trigger));
  return true;
}

function setAllNotesMode(enabled, options = {}) {
  const { trigger = "all-notes", flashCoord = null } = options;
  const nextValue = Boolean(enabled);

  if (Boolean(ext.config.allNotesEnabled) === nextValue) {
    return nextValue;
  }

  ext.config.allNotesEnabled = nextValue;
  persistConfig(ext.config);
  rebuildLayout();
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  log.info(
    `All notes ${ext.config.allNotesEnabled ? "enabled" : "disabled"} (selected scale remains ${MODE_BY_ID[ext.config.selectedModeId]?.name || ext.config.selectedModeId}).`,
  );
  logActiveState(buildActiveStatePayload(trigger));
  return nextValue;
}

function toggleAllNotesMode(options = {}) {
  return setAllNotesMode(!ext.config.allNotesEnabled, options);
}

function togglePresetLayout(options = {}) {
  const { trigger = "preset", flashCoord = null } = options;

  const currentIndex = PRESETS.findIndex((preset) => preset.id === ext.config.presetId);
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextPreset = PRESETS[(normalizedIndex + 1) % PRESETS.length] || PRESETS[0];
  if (!nextPreset || nextPreset.id === ext.config.presetId) {
    return false;
  }

  ext.config.presetId = nextPreset.id;
  persistConfig(ext.config);
  setValue("presetSelect", ext.config.presetId);
  rebuildLayout();
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  log.info(`Layout preset switched to ${nextPreset.name}.`);
  logActiveState(buildActiveStatePayload(trigger));
  return true;
}

function setMpeModeEnabled(enabled, options = {}) {
  const { trigger = "mpe", flashCoord = null } = options;
  const nextValue = Boolean(enabled);
  if (isMpeModeEnabled() === nextValue) {
    return nextValue;
  }

  clearHeldState();
  ext.config.mpeEnabled = nextValue;
  persistConfig(ext.config);
  void configureLinnStrumentMpeInputMode(nextValue, "toggle");
  rebuildLayout({ preserveHeldState: false, paintInstrument: true });
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  log.info(
    `MPE routing ${nextValue ? "enabled" : "disabled"} (${nextValue ? "notes/pitch bend on source channels" : "notes/pitch bend forced to channel 1"}).`,
  );
  logActiveState(buildActiveStatePayload(trigger));
  return nextValue;
}

function handleNoteOn(msg) {
  const raw = extractRawTouchEvent(msg);
  if (raw && raw.velocity <= 0) {
    handleNoteOff(msg);
    return;
  }
  
  // Debug log for every instrument note-on to identify the bottom-left pad note
  if (raw && msg?.__inputSource === "instrument") {
    console.log(`[MIDI DEBUG] Instrument NoteOn: Note=${raw.noteNumber}, Channel=${raw.channel}, Velocity=${raw.velocity}`);
  }

  if (DEBUG_MIDI_FLOW && raw) {
    const line = `[rx noteon] src=${msg?.__inputSource || "unknown"} ch=${raw.channel} note=${raw.noteNumber} vel=${raw.velocity}`;
    log.info(line);
    console.debug(line);
  }
  if (raw && msg?.__inputSource === "instrument" && wasRecentlyForwardedLoopNoteOn(raw.channel, raw.noteNumber)) {
    return;
  }

  const overlayEvent = normalizeOverlayTriggerEvent(msg, { debug: true, phase: "noteon" });
  if (overlayEvent) {
    debugControlOverlay("noteon:routed-to-overlay", overlayEvent);
    setPadHeld(overlayEvent.coord, true);
    handleControlOverlayTriggerPress(overlayEvent);
    return;
  }

  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  setPadHeld(event.coord, true);

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (isControlOverlayTriggerCoord(event.coord) || pad.role === "control-overlay-trigger") {
    handleControlOverlayTriggerPress(event);
    return;
  }

  switch (pad.role) {
    case "mod": {
      // Mod pads are now purely pressure-driven. 
      // We ignore the initial strike velocity and start at 0.
      setModPressure(event.coord, 0, event.channel, event.noteNumber);
      break;
    }
    case "key-select": {
      applySelectedKey(pad.keyPc, { trigger: "key", flashCoord: event.coord, flashPitchClass: true });
      break;
    }
    case "mode-select": {
      applySelectedMode(pad.modeId, { trigger: "scale", flashCoord: event.coord });
      break;
    }
    case "toggle-all-notes": {
      toggleAllNotesMode({ trigger: "all-notes", flashCoord: event.coord });
      break;
    }
    case "toggle-preset-layout": {
      togglePresetLayout({ trigger: "preset", flashCoord: event.coord });
      break;
    }
    case "toggle-mpe": {
      setMpeModeEnabled(!isMpeModeEnabled(), { trigger: "mpe", flashCoord: event.coord });
      break;
    }
    case "octave-down": {
      if (shiftOutputOctave(-1)) {
        flashSelection(event.coord);
      }
      break;
    }
    case "octave-up": {
      if (shiftOutputOctave(1)) {
        flashSelection(event.coord);
      }
      break;
    }
    case "play-note": {
      const existingRouted = ext.state.routedNotesByPad.get(event.coord);
      if (existingRouted) {
        finalizeRoutedNoteOff(event.coord, 0);
      }

      if (isMpeModeEnabled()) {
        releaseRoutedEntriesForInputChannel(event.channel, event.coord);
      }

      const sourceKey = noteKey(event.channel, event.noteNumber);
      const existingSourceEntry = findRoutedEntryBySourceKey(sourceKey);
      if (existingSourceEntry && existingSourceEntry.coord !== event.coord) {
        finalizeRoutedNoteOff(existingSourceEntry.coord, 0);
        setPadHeld(existingSourceEntry.coord, false);
      }

      const outputChannel = resolveOutputChannel(event.channel, isMpeModeEnabled());
      const hasActiveOnOutputChannel = Array.from(ext.state.routedNotesByPad.values()).some(
        (entry) => entry.channel === outputChannel,
      );
      const lastPitchBend14 = ext.state.lastPitchBend14ByChannel.get(outputChannel);
      if (!hasActiveOnOutputChannel && Number.isFinite(lastPitchBend14) && lastPitchBend14 !== 8192) {
        // Avoid end-of-note snap: recenter bend only when a channel is reused for a new note.
        sendLoopPitchBend14(8192, outputChannel);
      }

      ext.state.routedNotesByPad.set(event.coord, {
        note: pad.outNote,
        channel: outputChannel,
        sourceChannel: event.channel,
        sourceNoteNumber: event.noteNumber,
        sourceKey,
      });
      if (DEBUG_PITCH_TRACE) {
        console.debug(
          `[pitch-trace] noteon inCh=${event.channel} inNote=${event.noteNumber} coord=${event.coord} -> outCh=${outputChannel} outNote=${pad.outNote}`,
        );
      }
      sendLoopNoteOn(pad.outNote, event.velocity, outputChannel);
      refreshDetectedChord();
      refreshSameOutputNoteHighlights(pad.outNote);
      refreshInstrumentSameOutputNoteHighlights(pad.outNote);
      break;
    }
    default:
      break;
  }
}

function handleNoteOff(msg) {
  const raw = extractRawTouchEvent(msg);
  if (DEBUG_MIDI_FLOW && raw) {
    const line = `[rx noteoff] src=${msg?.__inputSource || "unknown"} ch=${raw.channel} note=${raw.noteNumber} vel=${raw.velocity}`;
    log.info(line);
    console.debug(line);
  }

  const overlayEvent = normalizeOverlayTriggerEvent(msg, { debug: true, phase: "noteoff" });
  if (overlayEvent) {
    debugControlOverlay("noteoff:routed-to-overlay", overlayEvent);
    setPadHeld(overlayEvent.coord, false);
    handleControlOverlayTriggerRelease(overlayEvent);
    return;
  }

  const event = normalizeTouchEvent(msg);
  if (!event) {
    if (!raw) {
      return;
    }

    // Best-effort cleanup when pad coord decoding fails:
    // - release potential mod touch by channel+note
    // - release any routed note by original source key
    clearModPressure("", raw.channel, raw.noteNumber);
    const sourceEntry = findRoutedEntryBySourceKey(noteKey(raw.channel, raw.noteNumber));
    if (sourceEntry) {
      setPadHeld(sourceEntry.coord, false);
      finalizeRoutedNoteOff(sourceEntry.coord, raw.velocity);
    }
    return;
  }

  setPadHeld(event.coord, false);

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (isControlOverlayTriggerCoord(event.coord) || pad.role === "control-overlay-trigger") {
    handleControlOverlayTriggerRelease(event);
    return;
  }

  const routed = ext.state.routedNotesByPad.get(event.coord);
  if (routed) {
    finalizeRoutedNoteOff(event.coord, event.velocity);
    return;
  }

  const sourceEntry = findRoutedEntryBySourceKey(noteKey(event.channel, event.noteNumber));
  if (sourceEntry) {
    if (sourceEntry.coord !== event.coord) {
      setPadHeld(sourceEntry.coord, false);
    }
    finalizeRoutedNoteOff(sourceEntry.coord, event.velocity);
    return;
  }

  if (isMpeModeEnabled()) {
    releaseRoutedEntriesForInputChannel(event.channel, null, event.velocity);
  }

  if (pad.role === "mod") {
    clearModPressure(event.coord, event.channel, event.noteNumber);
    return;
  }
}

function handlePolyPressure(msg) {
  if (normalizeOverlayTriggerEvent(msg)) {
    return;
  }

  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (isControlOverlayTriggerCoord(event.coord) || pad.role === "control-overlay-trigger") {
    return;
  }
  if (pad.role === "mod") {
    // Mod pads follow finger pressure (velocity property in aftertouch events).
    setModPressure(event.coord, event.velocity, event.channel, event.noteNumber);
    return;
  }

  if (pad.role === "play-note") {
    const routed = ext.state.routedNotesByPad.get(event.coord);
    const outputChannel = routed?.channel ?? resolveOutputChannel(event.channel, isMpeModeEnabled());
    const outputNote = routed?.note ?? pad.outNote;
    const value = event.velocity;

    if (isMpeModeEnabled()) {
      // In MPE, use per-channel pressure on the active output channel.
      sendLoopChannelAftertouch(value, outputChannel);
      return;
    }

    // In non-MPE, preserve key-specific pressure as poly-aftertouch on ch1.
    sendLoopPolyAftertouch(outputNote, value, outputChannel);
  }
}

function forwardPressureForInputChannel(
  inputChannel,
  pressureValue,
  { allowNonMpeBroadcast = false } = {},
) {
  const value = clampInt(pressureValue, 0, 127, 0);
  const mpeEnabled = isMpeModeEnabled();

  if (mpeEnabled) {
    const routedEntries = Array.from(ext.state.routedNotesByPad.values());
    const outputChannels = listOutputChannelsForInputChannel(routedEntries, inputChannel);
    if (outputChannels.length > 0) {
      outputChannels.forEach((outputChannel) => {
        sendLoopChannelAftertouch(value, outputChannel);
      });
    }
  } else {
    // Non-MPE: Forward all pressure events 1:1 to Channel Aftertouch on Channel 1.
    sendLoopChannelAftertouch(value, 1);
  }
}

function handleChannelAftertouch(msg) {
  const channel = getChannel(msg);

  // WebMidi v3/v2: Channel Aftertouch [Status, Pressure] or just [Pressure]
  const data = msg?.message?.data || msg?.data || msg?.dataBytes;
  let value = 0;
  if (data) {
    // If data[0] is status (0xD0), value is at index 1.
    const startOffset = (data[0] >= 0x80) ? 1 : 0;
    value = data[startOffset] ?? 0;
  } else if (msg?.rawValue !== undefined) {
    value = msg.rawValue;
  } else if (typeof msg?.value === "number") {
    value = Math.round(msg.value * 127);
  }

  const heldModCoordsOnChannel = Array.from(ext.state.modChannelsByPad.entries())
    .filter(([_touchId, ch]) => ch === channel)
    .map(([touchId]) => touchId);

  if (heldModCoordsOnChannel.length > 0) {
    const pressure = clampInt(value, 0, 127, 0);
    heldModCoordsOnChannel.forEach((touchId) => {
      ext.state.modPressuresByPad.set(touchId, pressure);
    });
    sendLoopModWheel(getCurrentModWheelValue());
  }

  forwardPressureForInputChannel(channel, value);
}

function handleControlChange(msg) {
  const event = extractRawControlChangeEvent(msg);
  if (!event) {
    return;
  }

  if (ext.state.suppressInstrumentNrpnCcForwarding && NRPN_CC_NUMBERS.has(event.controller)) {
    return;
  }

  // Ignore transport/housekeeping CCs coming from the instrument input.
  // Forwarding these can create startup spam in loop/DAW monitors.
  if (event.controller === 120 || event.controller === 121 || event.controller === 123) {
    return;
  }

  // CC11/CC1 coming from the instrument can represent pressure on active touches.
  // If a mod-row touch is held on this input channel, treat this as mod pressure.
  if (event.controller === 11 || event.controller === 1) {
    const heldModTouchIdsOnChannel = Array.from(ext.state.modChannelsByPad.entries())
      .filter(([_touchId, ch]) => ch === event.channel)
      .map(([touchId]) => touchId);
    if (heldModTouchIdsOnChannel.length > 0) {
      const pressure = clampInt(event.value7, 0, 127, 0);
      heldModTouchIdsOnChannel.forEach((touchId) => {
        ext.state.modPressuresByPad.set(touchId, pressure);
      });
      sendLoopModWheel(getCurrentModWheelValue());
      return;
    }
    // No mod touch active: treat CC11 as pressure fallback and map it to aftertouch.
    if (event.controller === 11) {
      forwardPressureForInputChannel(event.channel, event.value7);
      return;
    }
  }

  // Handle MPE vs Standard CC forwarding
  if (!isMpeModeEnabled()) {
    // Non-MPE: Forward all CCs 1:1 to Channel 1 (including Y-axis CC74).
    sendLoopControlChange(event.controller, event.value7, 1);
    return;
  }

  // MPE Mode: Resolve output channels for the CC
  const outputChannels = listOutputChannelsForInputChannel(
    Array.from(ext.state.routedNotesByPad.values()),
    event.channel,
  );

  if (outputChannels.length > 0) {
    outputChannels.forEach((outputChannel) => {
      sendLoopControlChange(event.controller, event.value7, outputChannel);
    });
  } else {
    // In MPE mode, avoid forwarding idle expressive controllers when no note is active.
    // LinnStrument emits these at rest, which causes startup/idle CC spam on loop output.
    if (event.controller === 74 || event.controller === 11 || event.controller === 1) {
      return;
    }
    // For non-expressive CCs, keep the existing fallback behavior.
    const outputChannel = resolveOutputChannel(event.channel, true);
    sendLoopControlChange(event.controller, event.value7, outputChannel);
  }
}

function handlePitchBend(msg) {
  const channel = getChannel(msg);
  const value14 = getPitchBend14(msg);
  const mpeEnabled = isMpeModeEnabled();

  if (DEBUG_PITCH_TRACE) {
    const data = msg?.message?.data || msg?.data || msg?.dataBytes;
    console.debug(
      `[pitch-trace] bend inCh=${channel} value14=${value14} mpeEnabled=${mpeEnabled} raw=${data ? Array.from(data).join(",") : "-"}`,
    );
  }

  if (mpeEnabled) {
    // Transparent 1:1 forwarding for MPE mode.
    const routedEntries = Array.from(ext.state.routedNotesByPad.values());
    const outputChannels = listOutputChannelsForInputChannel(routedEntries, channel);
    if (outputChannels.length > 0) {
      outputChannels.forEach((outputChannel) => {
        sendLoopPitchBend14(value14, outputChannel);
      });
    }
  } else {
    // Non-MPE: Forward all pitch bend events 1:1 to Channel 1.
    sendLoopPitchBend14(value14, 1);
  }
}

function findRoutedEntryBySourceKey(sourceKey) {
  if (!sourceKey) {
    return null;
  }
  for (const [coord, routed] of ext.state.routedNotesByPad.entries()) {
    const key = routed?.sourceKey || noteKey(getRoutedInputChannel(routed), routed.sourceNoteNumber);
    if (key === sourceKey) {
      return { coord, routed };
    }
  }
  return null;
}

function releaseRoutedEntriesForInputChannel(inputChannel, keepCoord = null, velocity = 0) {
  if (!Number.isFinite(inputChannel)) {
    return;
  }
  const staleCoords = Array.from(ext.state.routedNotesByPad.entries())
    .filter(([coord, routed]) => coord !== keepCoord && getRoutedInputChannel(routed) === inputChannel)
    .map(([coord]) => coord);
  staleCoords.forEach((coord) => {
    setPadHeld(coord, false);
    finalizeRoutedNoteOff(coord, velocity);
  });
}

function shouldSuppressNonMpePitchBend() {
  return !isMpeModeEnabled() && ext.state.routedNotesByPad.size > 1;
}

function finalizeRoutedNoteOff(coord, velocity) {
  const routed = ext.state.routedNotesByPad.get(coord);
  if (!routed) {
    return false;
  }

  sendLoopNoteOff(routed.note, velocity, routed.channel);
  ext.state.routedNotesByPad.delete(coord);
  refreshDetectedChord();
  refreshSameOutputNoteHighlights(routed.note);
  refreshInstrumentSameOutputNoteHighlights(routed.note);
  return true;
}

function normalizeTouchEvent(msg) {
  const raw = extractRawTouchEvent(msg);
  if (!raw) {
    return null;
  }

  const coord = raw.coord || resolvePadCoord(raw.noteNumber, raw.channel);
  if (!coord) {
    return null;
  }

  return {
    ...raw,
    coord,
  };
}

function normalizeOverlayTriggerEvent(msg, options = {}) {
  const { debug = false, phase = "event" } = options;
  const raw = extractRawTouchEvent(msg);
  if (!raw) {
    if (debug) {
      debugControlOverlay(`${phase}:raw-missing`);
    }
    return null;
  }

  const resolvedCoord = resolvePadCoord(raw.noteNumber, raw.channel);
  
  // Extra detailed log for overlay trigger debugging
  console.log(`[OVERLAY DEBUG] Probe: Note=${raw.noteNumber}, Channel=${raw.channel}, ResolvedCoord=${resolvedCoord}, TriggerTarget=${CONTROL_OVERLAY_TRIGGER_COORD}`);

  if (debug) {
    debugControlOverlay(`${phase}:probe`, {
      noteNumber: raw.noteNumber,
      channel: raw.channel,
      velocity: raw.velocity,
      resolvedCoord,
      isResolvedTriggerCoord: isControlOverlayTriggerCoord(resolvedCoord),
      triggerCoord: CONTROL_OVERLAY_TRIGGER_COORD,
    });
  }
  if (isControlOverlayTriggerCoord(resolvedCoord)) {
    if (debug) {
      debugControlOverlay(`${phase}:match`, { via: "resolvedCoord" });
    }
    return { ...raw, coord: CONTROL_OVERLAY_TRIGGER_COORD };
  }

  return null;
}

function resolvePadCoord(noteNumber, channel) {
  const deviceStartNote = clampInt(ext.config.deviceStartNote, 0, 127, defaultConfig.deviceStartNote);
  const wrappedIndex = mod(noteNumber - deviceStartNote, 128);
  return resolveNoOverlapPadCoordCore(wrappedIndex, channel, {
    columns: ext.config.linnStrumentSize / 8,
    rows: 8,
    assumeRowChannels: false,
    columnPhase: 0,
    perRowLowestChannel: 1,
    rowChannelOrderReversed: false,
  });
}

function handleBackchannelNoteOn(msg) {
  const noteNumber = msg?.note?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(noteNumber)) {
    return;
  }
  const rawVelocity = msg?.rawVelocity ?? msg?.rawValue ?? msg?.velocity ?? msg?.value ?? msg?.dataBytes?.[1] ?? 0;
  const velocity =
    typeof rawVelocity === "number" && rawVelocity >= 0 && rawVelocity <= 1 && !msg?.rawVelocity && !msg?.rawValue
      ? clampInt(Math.round(rawVelocity * 127), 0, 127, 0)
      : clampInt(rawVelocity, 0, 127, 0);
  if (velocity <= 0) {
    handleBackchannelNoteOff(msg);
    return;
  }

  const inputKey = noteKey(getChannel(msg), noteNumber);
  clearBackchannelHighlightForKey(inputKey);
  ext.state.backchannelNotesByKey.set(inputKey, noteNumber);

  const coords = findPlayableCoordsByOutputNote(noteNumber);
  ext.state.backchannelCoordsByKey.set(inputKey, coords);
  coords.forEach((coord) => {
    addBackchannelPadHighlight(coord);
  });
}

function handleBackchannelNoteOff(msg) {
  const noteNumber = msg?.note?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(noteNumber)) {
    return;
  }

  const inputKey = noteKey(getChannel(msg), noteNumber);
  if (clearBackchannelHighlightForKey(inputKey)) {
    return;
  }

  const matchingKeys = Array.from(ext.state.backchannelNotesByKey.entries())
    .filter(([_key, activeNoteNumber]) => activeNoteNumber === noteNumber)
    .map(([key]) => key);
  matchingKeys.forEach((key) => {
    clearBackchannelHighlightForKey(key);
  });
}

function handleBackchannelControlChange(msg) {
  const controller = msg?.controller?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(controller)) {
    return;
  }
  // Respond to common panic/all-notes-off signals from DAW/controller script.
  if (controller === 120 || controller === 123) {
    clearAllBackchannelHighlights();
  }
}

function clearAllBackchannelHighlights() {
  const keys = Array.from(ext.state.backchannelCoordsByKey.keys());
  keys.forEach((key) => {
    clearBackchannelHighlightForKey(key);
  });
  ext.state.backchannelNotesByKey.clear();
}

function rehydrateBackchannelHighlights() {
  const active = Array.from(ext.state.backchannelNotesByKey.entries());
  ext.state.backchannelPadRefCount.clear();
  ext.state.backchannelCoordsByKey.clear();
  active.forEach(([inputKey, noteNumber]) => {
    const coords = findPlayableCoordsByOutputNote(noteNumber);
    ext.state.backchannelCoordsByKey.set(inputKey, coords);
    coords.forEach((coord) => {
      addBackchannelPadHighlight(coord);
    });
  });
}

function clearBackchannelHighlightForKey(inputKey) {
  const hasKey = ext.state.backchannelCoordsByKey.has(inputKey) || ext.state.backchannelNotesByKey.has(inputKey);
  if (!hasKey) {
    return false;
  }

  const coords = ext.state.backchannelCoordsByKey.get(inputKey) || [];
  coords.forEach((coord) => {
    removeBackchannelPadHighlight(coord);
  });
  ext.state.backchannelCoordsByKey.delete(inputKey);
  ext.state.backchannelNotesByKey.delete(inputKey);
  return true;
}

function addBackchannelPadHighlight(coord) {
  const prev = ext.state.backchannelPadRefCount.get(coord) || 0;
  const next = prev + 1;
  ext.state.backchannelPadRefCount.set(coord, next);
  if (prev === 0) {
    updatePadHeldVisual(coord);
  }
}

function removeBackchannelPadHighlight(coord) {
  const prev = ext.state.backchannelPadRefCount.get(coord) || 0;
  if (prev <= 1) {
    ext.state.backchannelPadRefCount.delete(coord);
    if (prev > 0) {
      updatePadHeldVisual(coord);
    }
    return;
  }
  ext.state.backchannelPadRefCount.set(coord, prev - 1);
}

function findPlayableCoordsByOutputNote(noteNumber) {
  if (!Number.isFinite(noteNumber)) {
    return [];
  }

  const coords = [];
  for (const [coord, pad] of Object.entries(ext.layout.padMap || {})) {
    if (pad?.role === "play-note" && pad.outNote === noteNumber) {
      coords.push(coord);
    }
  }
  return coords;
}

function setPadHeld(coord, held) {
  if (held) {
    ext.state.heldPads.add(coord);
  } else {
    ext.state.heldPads.delete(coord);
  }

  updatePadHeldVisual(coord);
}

function isPadVisuallyHeld(coord) {
  return ext.state.heldPads.has(coord) || (ext.state.backchannelPadRefCount.get(coord) || 0) > 0;
}

function updatePadHeldVisual(coord) {
  const el = document.getElementById(`cell-${coord}`);
  if (el) {
    el.classList.toggle("cell-held", isPadVisuallyHeld(coord));
  }

  paintInstrumentCoord(coord);
}

function flashSelection(coord) {
  const el = document.getElementById(`cell-${coord}`);
  if (!el) {
    return;
  }

  el.classList.add("cell-selected-live");
  setTimeout(() => el.classList.remove("cell-selected-live"), 220);
}

function flashPlayablePitchClass(pc) {
  const targetPc = mod(pc, 12);
  const columns = ext.config.linnStrumentSize / 8;
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < 8; y++) {
      const meta = ext.layout.cellMeta[coordKey(x, y)];
      if (meta?.zone !== "play" || !Number.isFinite(meta.noteNumber)) {
        continue;
      }
      if (mod(meta.noteNumber, 12) !== targetPc) {
        continue;
      }
      const el = document.getElementById(`cell-${x}-${y}`);
      if (!el) {
        continue;
      }
      el.classList.add("cell-selected-live");
      setTimeout(() => el.classList.remove("cell-selected-live"), 220);
    }
  }
}

function refreshSameOutputNoteHighlights(noteNumber) {
  const hasActive = Array.from(ext.state.routedNotesByPad.values()).some((entry) => entry.note === noteNumber);

  for (const [coord, meta] of Object.entries(ext.layout.cellMeta || {})) {
    if (meta?.zone !== "play" || meta.noteNumber !== noteNumber) {
      continue;
    }
    const el = document.getElementById(`cell-${coord}`);
    if (!el) {
      continue;
    }

    const isActiveCoord = Array.from(ext.state.routedNotesByPad.entries()).some(
      ([routedCoord, routed]) => routedCoord === coord && routed.note === noteNumber,
    );

    el.classList.toggle("cell-same-note", hasActive && !isActiveCoord);
  }
}

function refreshInstrumentSameOutputNoteHighlights(noteNumber) {
  if (!ext.midi.instrumentOutput) {
    return;
  }

  const activeCoordsForNote = new Set();
  if (ext.state.routedNotesByPad && typeof ext.state.routedNotesByPad.entries === "function") {
    for (const [coord, routed] of ext.state.routedNotesByPad.entries()) {
      if (routed.note === noteNumber) {
        activeCoordsForNote.add(coord);
      }
    }
  }
  const hasActive = activeCoordsForNote.size > 0;

  for (const [coord, meta] of Object.entries(ext.layout.cellMeta || {})) {
    if (meta?.zone !== "play" || meta.noteNumber !== noteNumber) {
      continue;
    }

    const [xStr, yStr] = coord.split("-");
    const x = Number.parseInt(xStr, 10);
    const y = Number.parseInt(yStr, 10);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      continue;
    }

    const color =
      hasActive && !activeCoordsForNote.has(coord)
        ? INSTRUMENT_COLORS.sameNote
        : getInstrumentColorForMeta(meta, coord);
    highlightInstrumentXY(x, y, color);
  }
}

function refreshHeldCellClasses() {
  for (const coord of Object.keys(ext.layout.cellMeta || {})) {
    const el = document.getElementById(`cell-${coord}`);
    if (!el) {
      continue;
    }
    el.classList.toggle("cell-held", isPadVisuallyHeld(coord));
  }
}

function setModPressure(coord, value, channel = 1, noteNumber = null) {
  const touchId = modTouchId(channel, noteNumber, coord);
  ext.state.modChannelsByPad.set(touchId, channel || 1);
  ext.state.modPressuresByPad.set(touchId, clampInt(value, 0, 127, 0));
  sendLoopModWheel(getCurrentModWheelValue());
}

function clearModPressure(coord, channel = 1, noteNumber = null) {
  const touchId = modTouchId(channel, noteNumber, coord);
  ext.state.modChannelsByPad.delete(touchId);
  ext.state.modPressuresByPad.delete(touchId);
  sendLoopModWheel(getCurrentModWheelValue());
}

function getCurrentModWheelValue() {
  if (ext.state.modPressuresByPad.size === 0) {
    return 0;
  }
  return clampInt(Math.max(...ext.state.modPressuresByPad.values()), 0, 127, 0);
}

function sendLoopNoteOn(noteNumber, velocity = 100, channel = 1) {
  const out = ext.midi.loopOutput;
  if (!out) {
    return;
  }

  sendRawToLoop([0x90 | ((channel - 1) & 0x0f), noteNumber & 0x7f, clampInt(velocity, 0, 127, 100)]);
  if (DEBUG_MIDI_FLOW) {
    const line = `[tx noteon] ch=${channel} note=${noteNumber} vel=${clampInt(velocity, 0, 127, 100)}`;
    log.info(line);
    console.debug(line);
  }
  markRecentLoopNoteOn(channel, noteNumber);
  ext.state.activeLoopNotes.add(noteKey(channel, noteNumber));

  const coord = findCoordByRoutedNote(channel, noteNumber);
  if (coord) {
    const el = document.getElementById(`cell-${coord}`);
    el?.classList.add("cell-active");
  }
}

function sendLoopNoteOff(noteNumber, velocity = 0, channel = 1) {
  const out = ext.midi.loopOutput;
  if (!out) {
    return;
  }

  sendRawToLoop([0x80 | ((channel - 1) & 0x0f), noteNumber & 0x7f, clampInt(velocity, 0, 127, 0)]);
  if (DEBUG_MIDI_FLOW) {
    const line = `[tx noteoff] ch=${channel} note=${noteNumber} vel=${clampInt(velocity, 0, 127, 0)}`;
    log.info(line);
    console.debug(line);
  }
  ext.state.activeLoopNotes.delete(noteKey(channel, noteNumber));

  const coord = findCoordByRoutedNote(channel, noteNumber);
  if (coord) {
    const el = document.getElementById(`cell-${coord}`);
    el?.classList.remove("cell-active");
  }
}

function sendLoopControlChange(cc, value, channel = 1) {
  const out = ext.midi.loopOutput;
  if (!out || !out.channels?.[channel]) {
    return;
  }
  out.channels[channel].sendControlChange(cc, clampInt(value, 0, 127, 0));
}

function sendLoopModWheel(value) {
  // Slightly smooth MW changes, but snap to zero on release.
  const raw = clampInt(value, 0, 127, 0);
  const prev = Number.isFinite(ext.state.modWheelSmoothed) ? ext.state.modWheelSmoothed : raw;
  const next = raw === 0 ? 0 : clampInt(Math.round(prev + (raw - prev) * MOD_WHEEL_SMOOTHING_ALPHA), 0, 127, 0);
  ext.state.modWheelSmoothed = next;
  sendLoopControlChange(1, next, 1);
}

function sendLoopPolyAftertouch(noteNumber, value, channel = 1) {
  sendRawToLoop([0xa0 | ((channel - 1) & 0x0f), noteNumber & 0x7f, clampInt(value, 0, 127, 0)]);
}

function sendLoopChannelAftertouch(value, channel = 1) {
  sendRawToLoop([0xd0 | ((channel - 1) & 0x0f), clampInt(value, 0, 127, 0)]);
}

function sendLoopPitchBend14(value14, channel = 1) {
  const bend = clampInt(value14, 0, 16383, 8192);
  const out = ext.midi.loopOutput;
  if (!out) {
    return;
  }

  // Prefer WebMidi channel API for bend to maximize compatibility with virtual loop ports/DAWs.
  if (out.channels?.[channel]?.sendPitchBend) {
    try {
      const normalized = Math.max(-1, Math.min(1, (bend - 8192) / 8192));
      out.channels[channel].sendPitchBend(normalized);
    } catch (err) {
      console.warn("[pitch-trace] channel sendPitchBend failed, falling back to raw", {
        channel,
        bend,
        error: err?.message || err,
      });
      sendRawToLoop([0xe0 | ((channel - 1) & 0x0f), bend & 0x7f, (bend >> 7) & 0x7f]);
    }
  } else {
    sendRawToLoop([0xe0 | ((channel - 1) & 0x0f), bend & 0x7f, (bend >> 7) & 0x7f]);
  }
  ext.state.lastPitchBend14ByChannel.set(channel, bend);
}

function sendRawToLoop(data) {
  const out = ext.midi.loopOutput;
  if (!out) {
    return;
  }

  if (DEBUG_MIDI_FLOW) {
    console.debug("[main] tx loop raw", data);
  }
  try {
    out.send(data);
  } catch (err) {
    console.warn("Failed raw MIDI send", data, err);
  }
}

function setLoopPitchBendRangeSemitones(semitones = defaultConfig.outputPitchBendRangeSemitones) {
  const value = clampInt(semitones, 0, 96, defaultConfig.outputPitchBendRangeSemitones);
  if (!ext.midi.loopOutput) {
    log.warn(`Skipped loop pitch bend range resend (no loop MIDI output). Intended value: ±${value} semitones.`);
    return false;
  }

  for (let channel = 1; channel <= 16; channel++) {
    const ch = (channel - 1) & 0x0f;
    sendRawToLoop([0xb0 | ch, 101, 0]);
    sendRawToLoop([0xb0 | ch, 100, 0]);
    sendRawToLoop([0xb0 | ch, 6, value]);
    sendRawToLoop([0xb0 | ch, 38, 0]);
    sendRawToLoop([0xb0 | ch, 101, 127]);
    sendRawToLoop([0xb0 | ch, 100, 127]);
  }
  log.info(`Set loop pitch bend range to ±${value} semitones on channels 1-16.`);
  return true;
}

async function resendPitchBendRangeFromConfig({ includeLoop = false, source = "unspecified" } = {}) {
  if (ext.state.exited) {
    return;
  }
  const semitones = clampInt(
    ext.config.outputPitchBendRangeSemitones,
    0,
    96,
    defaultConfig.outputPitchBendRangeSemitones,
  );
  if (ext.config.outputPitchBendRangeSemitones !== semitones) {
    ext.config.outputPitchBendRangeSemitones = semitones;
    setValue("outputPitchBendRangeSemitones", semitones);
    persistConfig(ext.config);
  }
  const loopSent = includeLoop ? setLoopPitchBendRangeSemitones(semitones) : false;
  if (ext.midi.instrumentOutput) {
    try {
      await setLinnStrumentParamValue(
        ext.midi.instrumentOutput,
        NRPN.SPLIT_LEFT_BEND_RANGE,
        semitones,
        getLinnstrumentSyncOptions(),
      );
      await setLinnStrumentParamValue(
        ext.midi.instrumentOutput,
        NRPN.SPLIT_RIGHT_BEND_RANGE,
        semitones,
        getLinnstrumentSyncOptions(),
      );
    } catch (err) {
      console.warn("Failed to resend LinnStrument bend range", err);
    }
  }
  log.info(
    `Resent pitch bend range (${source}): ±${semitones} semitones (loop=${loopSent ? "ok" : "skipped"}, linnstrument=${ext.midi.instrumentOutput ? "ok/attempted" : "skipped"}).`,
  );
}

function findCoordByRoutedNote(channel, noteNumber) {
  return findCoordByRoutedNoteCore(ext.state.routedNotesByPad, channel, noteNumber);
}

function allNotesOff() {
  for (let channel = 1; channel <= 16; channel++) {
    sendLoopControlChange(123, 0, channel);
    sendLoopControlChange(120, 0, channel);
    sendLoopControlChange(1, 0, channel);
    sendLoopPitchBend14(8192, channel);
  }
  ext.state.activeLoopNotes.clear();
  ext.state.routedNotesByPad.clear();
  ext.state.recentLoopNoteOns.clear();
  ext.state.lastPitchBend14ByChannel.clear();
  ext.state.detectedChordName = "";
  updateChordStatusUi();
  refreshHeldCellClasses();
  paintInstrumentLayout();
}

function clearHeldState() {
  if (!hasTransientPerformanceState()) {
    return;
  }
  if (ext.state.routedNotesByPad.size > 0 || ext.state.activeLoopNotes.size > 0) {
    allNotesOff();
  }
  resetGrid(highlightInstrumentXY);
  ext.state.heldPads.clear();
  ext.state.modPressuresByPad.clear();
  ext.state.modChannelsByPad.clear();
  ext.state.modWheelSmoothed = null;
  ext.state.routedNotesByPad.clear();
  ext.state.activeLoopNotes.clear();
  ext.state.recentLoopNoteOns.clear();
  ext.state.lastPitchBend14ByChannel.clear();
  ext.state.detectedChordName = "";
  updateChordStatusUi();
}

function hasTransientPerformanceState() {
  return (
    ext.state.heldPads.size > 0 ||
    ext.state.modPressuresByPad.size > 0 ||
    ext.state.modChannelsByPad.size > 0 ||
    ext.state.routedNotesByPad.size > 0 ||
    ext.state.activeLoopNotes.size > 0 ||
    ext.state.recentLoopNoteOns.size > 0 ||
    ext.state.lastPitchBend14ByChannel.size > 0
  );
}

function updateStatusUi() {
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  const outputOctave = Math.floor(ext.config.baseRootC / 12) - 1;
  setValue("stateTonicSelect", mod(ext.config.selectedKey, 12));
  setValue("stateScaleSelect", mode.id);
  setText("octaveStatus", `C${outputOctave}`);
  const modeScaleBtn = document.getElementById("stateModeScaleBtn");
  const modeAllBtn = document.getElementById("stateModeAllBtn");
  if (modeScaleBtn) {
    const scaleActive = !ext.config.allNotesEnabled;
    modeScaleBtn.setAttribute("aria-pressed", scaleActive ? "true" : "false");
    modeScaleBtn.classList.toggle("btn-secondary", scaleActive);
    modeScaleBtn.classList.toggle("btn-outline-secondary", !scaleActive);
  }
  if (modeAllBtn) {
    const allActive = Boolean(ext.config.allNotesEnabled);
    modeAllBtn.setAttribute("aria-pressed", allActive ? "true" : "false");
    modeAllBtn.classList.toggle("btn-secondary", allActive);
    modeAllBtn.classList.toggle("btn-outline-secondary", !allActive);
  }
  updateRoutingStatus();
  updateChordStatusUi();
}

function updateRoutingStatus() {
  if (ext.state.exited) {
    const statusEl = document.getElementById("routingStatus");
    if (statusEl) {
      statusEl.textContent = "Exited / Restored";
      statusEl.classList.remove("routing-ready");
      statusEl.classList.add("routing-not-ready");
    }
    return;
  }

  const inOk = Boolean(ext.midi.instrumentInput);
  const outOk = Boolean(ext.midi.loopOutput);
  const ready = inOk && outOk;
  const status = !inOk ? "No LinnStrument input" : outOk ? "Ready" : "No loop output";
  const statusEl = document.getElementById("routingStatus");
  if (!statusEl) {
    return;
  }
  statusEl.textContent = status;
  statusEl.classList.toggle("routing-ready", ready);
  statusEl.classList.toggle("routing-not-ready", !ready);
}

function refreshDetectedChord() {
  ext.state.detectedChordName = detectChordNameFromMidiNotes(
    Array.from(ext.state.routedNotesByPad.values()).map((entry) => entry.note),
  );
  updateChordStatusUi();
}

function updateChordStatusUi() {
  setText("chordStatus", ext.state.detectedChordName || "-");
}

function paintInstrumentLayout() {
  if (ext.state.exited || !ext.state.instrumentPaintingEnabled) {
    return;
  }
  const out = ext.midi.instrumentOutput;
  if (!out) {
    return;
  }

  const columns = ext.config.linnStrumentSize / 8;
  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < 8; y++) {
      const key = coordKey(x, y);
      const meta = ext.layout.cellMeta[key] || {};
      highlightInstrumentXY(x, y, getInstrumentColorForMeta(meta, key));
    }
  }
}

function getInstrumentColorForMeta(meta = {}, coord = null) {
  if (coord && isPadVisuallyHeld(coord)) {
    return INSTRUMENT_COLORS.held;
  }

  const tonicPc = mod(ext.config.selectedKey ?? defaultConfig.selectedKey ?? 0, 12);

  switch (meta.zone) {
    case "overlay-trigger":
      return INSTRUMENT_COLORS.overlayTrigger;
    case "mod":
      return parseLedColor(ext.config.colorModWheel, defaultConfig.colorModWheel);
    case "key":
      return meta.selected
        ? INSTRUMENT_COLORS.selected
        : meta.accidental
          ? INSTRUMENT_COLORS.keyAccidental
          : INSTRUMENT_COLORS.keyNatural;
    case "preset-switch":
      return INSTRUMENT_COLORS.presetSwitch;
    case "octave":
      return INSTRUMENT_COLORS.octave;
    case "mode":
      return meta.selected ? INSTRUMENT_COLORS.selected : INSTRUMENT_COLORS.mode;
    case "all-notes-toggle":
      return meta.selected ? INSTRUMENT_COLORS.allNotesOn : INSTRUMENT_COLORS.allNotesOff;
    case "mpe":
      return meta.selected ? INSTRUMENT_COLORS.mpeEnabled : INSTRUMENT_COLORS.mpeDisabled;
    case "play": {
      const isTonicPlayablePad = Number.isFinite(meta.noteNumber) && mod(meta.noteNumber, 12) === tonicPc;
      const rootColor = parseLedColor(ext.config.colorRootNote, defaultConfig.colorRootNote);
      const scaleColor = parseLedColor(ext.config.colorScaleNote, defaultConfig.colorScaleNote);
      const nonScaleColor = parseLedColor(ext.config.colorNonScaleNote, defaultConfig.colorNonScaleNote);
      return isTonicPlayablePad ? rootColor : meta.inSelectedScale ? scaleColor : nonScaleColor;
    }
    case "disabled":
      return INSTRUMENT_COLORS.off;
    default:
      return INSTRUMENT_COLORS.disabled;
  }
}

function paintInstrumentCoord(coord) {
  if (!coord || !ext.midi.instrumentOutput) {
    return;
  }
  const [xStr, yStr] = String(coord).split("-");
  const x = Number.parseInt(xStr, 10);
  const y = Number.parseInt(yStr, 10);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return;
  }
  const meta = ext.layout.cellMeta?.[coord] || {};
  highlightInstrumentXY(x, y, getInstrumentColorForMeta(meta, coord));
}

export function highlightInstrumentXY(x, y, color) {
  // LinnStrument 128 has a fixed left control strip column; playable grid starts at hardware column 1.
  highlightInstrumentHardwareXY(x + 1, y, color);
}

function highlightInstrumentHardwareXY(x, y, color) {
  const out = ext.midi.instrumentOutput;
  if (!ext.state.instrumentPaintingEnabled || !out?.channels?.[1]) {
    return;
  }

  try {
    const channel = out.channels[1];
    channel.sendControlChange(20, x);
    channel.sendControlChange(21, y);
    channel.sendControlChange(22, color);
  } catch (err) {
    const name = out?.name || ext.config.instrumentOutputPort || "(unknown output)";
    ext.midi.instrumentOutput = null;
    updateRoutingStatus();
    log.warn(`LinnStrument output became unavailable during LED update: ${name}.`);
    console.warn("Instrument LED send failed", err);
  }
}

async function ensureLinnStrumentStandardLayout(reason = "startup") {
  if (!ext.midi.instrumentOutput) {
    return false;
  }
  try {
    const syncOptions = getLinnstrumentSyncOptions();
    log.info(
      `Applying control-mode layout on ${reason}: octave=${CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE}, pitch=${CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH}, lights=${CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS}.`,
    );
    await sleep(INIT_LAYOUT_SETTLE_DELAY_MS);
    await applyLinnStrumentStandardLayout(ext.midi.instrumentOutput, syncOptions);
    await sleep(INIT_LAYOUT_SETTLE_DELAY_MS);
    if (ext.config.deviceStartNote !== CONTROL_MODE_LAYOUT.DEVICE_START_NOTE) {
      ext.config.deviceStartNote = CONTROL_MODE_LAYOUT.DEVICE_START_NOTE;
      setValue("deviceStartNote", CONTROL_MODE_LAYOUT.DEVICE_START_NOTE);
      persistConfig(ext.config);
    }
    log.info(`Requested LinnStrument standard no-overlap layout (notes 0..127) on ${reason}.`);
    return true;
  } catch (err) {
    log.warn(`Could not request LinnStrument standard no-overlap layout on ${reason}: ${err?.message || err}`);
    return false;
  }
}

async function configureLinnStrumentMpeInputMode(enabled, reason = "toggle") {
  if (!ext.midi.instrumentOutput) {
    return false;
  }
  try {
    await applyLinnStrumentMpeInputMode(ext.midi.instrumentOutput, enabled, getLinnstrumentSyncOptions());
    if (enabled) {
      log.info(`Configured LinnStrument MPE-style input mode on ${reason} (Channel Per Note, member channels 2-16).`);
      return true;
    }
    log.info(`Configured LinnStrument non-MPE input mode on ${reason} (One Channel, ch1).`);
    return true;
  } catch (err) {
    log.warn(`Could not configure LinnStrument MPE input mode on ${reason}: ${err?.message || err}`);
    return false;
  }
}

function shiftOutputOctave(deltaOctaves) {
  const nextBaseRootC = clampInt(ext.config.baseRootC + deltaOctaves * 12, 0, 108, ext.config.baseRootC);

  if (nextBaseRootC === ext.config.baseRootC) {
    log.warn(`Output octave already at ${deltaOctaves > 0 ? "maximum" : "minimum"}.`);
    return false;
  }

  ext.config.baseRootC = nextBaseRootC;
  persistConfig(ext.config);
  rebuildLayout({ preserveHeldState: true, paintInstrument: false });
  log.info(`Output octave changed: base C = ${NOTE_NAMES[nextBaseRootC % 12]}${Math.floor(nextBaseRootC / 12) - 1}`);
  logActiveState(buildActiveStatePayload("octave"));
  return true;
}

function buildActiveStatePayload(trigger = "state") {
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  return {
    trigger,
    tonic: NOTE_NAMES[mod(ext.config.selectedKey, 12)],
    scale: mode.name,
    allNotesEnabled: Boolean(ext.config.allNotesEnabled),
    mpeEnabled: isMpeModeEnabled(),
    octave: Math.floor(ext.config.baseRootC / 12) - 1,
    activeLayoutRowOffset: getActiveLayoutRowOffset(),
    layoutRowOffsetScale: ext.config.layoutRowOffsetScale,
    layoutRowOffsetAllNotes: ext.config.layoutRowOffsetAllNotes,
    deviceRowOffset: ext.config.deviceRowOffset,
  };
}

function buildStartupLinnstrumentParamSummary(config) {
  const bendRange = clampInt(
    config?.outputPitchBendRangeSemitones,
    0,
    96,
    defaultConfig.outputPitchBendRangeSemitones,
  );
  const mpeEnabled = isMpeModeEnabledCore(config, defaultConfig);
  const octaveSetting = CONTROL_MODE_LAYOUT.SPLIT_LEFT_OCTAVE;
  const pitchSetting = CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_PITCH;
  const lightsSetting = CONTROL_MODE_LAYOUT.SPLIT_LEFT_TRANSPOSE_LIGHTS;

  const applyControlModeToRightSplit = Boolean(config?.applyControlModeToRightSplit);
  const nrpnStandardLayout = [
    { param: NRPN.DEVICE_USER_FIRMWARE_MODE, value: 0, name: "UserFirmwareModeOff" },
    { param: NRPN.GLOBAL_SPLIT_ACTIVE, value: 0, name: "SplitOff" },
    { param: NRPN.GLOBAL_SELECTED_SPLIT, value: 0, name: "SelectedSplitLeft" },
    { param: NRPN.GLOBAL_ROW_OFFSET, value: 0, name: "NoOverlapRowOffset" },
    { param: NRPN.SPLIT_LEFT_LOW_ROW_MODE, value: 0, name: "LeftLowRowOff" },
    { param: NRPN.SPLIT_RIGHT_LOW_ROW_MODE, value: 0, name: "RightLowRowOff" },
    { param: NRPN.SPLIT_LEFT_OCTAVE, value: octaveSetting, name: "LeftOctave" },
    { param: NRPN.SPLIT_LEFT_TRANSPOSE_PITCH, value: pitchSetting, name: "LeftTransposePitch" },
    { param: NRPN.SPLIT_LEFT_TRANSPOSE_LIGHTS, value: lightsSetting, name: "LeftTransposeLights" },
  ];
  if (applyControlModeToRightSplit) {
    nrpnStandardLayout.push(
      { param: NRPN.SPLIT_RIGHT_OCTAVE, value: octaveSetting, name: "RightOctave" },
      { param: NRPN.SPLIT_RIGHT_TRANSPOSE_PITCH, value: pitchSetting, name: "RightTransposePitch" },
      { param: NRPN.SPLIT_RIGHT_TRANSPOSE_LIGHTS, value: lightsSetting, name: "RightTransposeLights" },
    );
  }

  return {
    timingMs: {
      nrpnParamDelay: getNrpnParamDelayMs(config),
      initSettleDelay: INIT_LAYOUT_SETTLE_DELAY_MS,
    },
    targetControlMode: {
      bottomLeftMidiNote: CONTROL_MODE_LAYOUT.DEVICE_START_NOTE,
      octaveRaw: octaveSetting,
      octaveSemitones: (octaveSetting - 5) * 12,
      transposePitchRaw: pitchSetting,
      transposePitchSemitones: pitchSetting - 7,
      transposeLightsRaw: lightsSetting,
      transposeLightsSemitones: lightsSetting - 7,
      applyControlModeToRightSplit,
      transposeApplyPasses: CONTROL_MODE_TRANSPOSE_PASSES,
    },
    nrpnStandardLayout,
    nrpnMpeMode: mpeEnabled
      ? [
          { param: NRPN.SPLIT_LEFT_MIDI_MODE, value: 1, name: "LeftMidiModeChannelPerNote" },
          { param: NRPN.SPLIT_LEFT_MAIN_CHANNEL, value: 1, name: "LeftMainChannel1" },
          { param: NRPN.SPLIT_LEFT_SEND_Z, value: 1, name: "LeftSendZOn" },
          { param: NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, value: 1, name: "LeftZChannelPressure" },
          { param: NRPN.SPLIT_RIGHT_MIDI_MODE, value: 1, name: "RightMidiModeChannelPerNote" },
          { param: NRPN.SPLIT_RIGHT_MAIN_CHANNEL, value: 1, name: "RightMainChannel1" },
          { param: NRPN.SPLIT_RIGHT_SEND_Z, value: 1, name: "RightSendZOn" },
          { param: NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, value: 1, name: "RightZChannelPressure" },
        ]
      : [
          { param: NRPN.SPLIT_LEFT_MIDI_MODE, value: 0, name: "LeftMidiModeOneChannel" },
          { param: NRPN.SPLIT_LEFT_MAIN_CHANNEL, value: 1, name: "LeftMainChannel1" },
          { param: NRPN.SPLIT_LEFT_SEND_Z, value: 1, name: "LeftSendZOn" },
          { param: NRPN.SPLIT_LEFT_MIDI_EXPRESSION_FOR_Z, value: 0, name: "LeftZPolyAftertouch" },
          { param: NRPN.SPLIT_RIGHT_MIDI_MODE, value: 0, name: "RightMidiModeOneChannel" },
          { param: NRPN.SPLIT_RIGHT_MAIN_CHANNEL, value: 1, name: "RightMainChannel1" },
          { param: NRPN.SPLIT_RIGHT_SEND_Z, value: 1, name: "RightSendZOn" },
          { param: NRPN.SPLIT_RIGHT_MIDI_EXPRESSION_FOR_Z, value: 0, name: "RightZPolyAftertouch" },
        ],
    nrpnBendRange: [
      { param: NRPN.SPLIT_LEFT_BEND_RANGE, value: bendRange, name: "LeftBendRange" },
      { param: NRPN.SPLIT_RIGHT_BEND_RANGE, value: bendRange, name: "RightBendRange" },
    ],
  };
}

function buildExitLinnstrumentParamSummary(config) {
  if (linnstrumentDebug) {
    return linnstrumentDebug.buildExitLinnstrumentParamSummary(config);
  }
  return {
    targetPreset: null,
    lightsClearPasses: 0,
    restoreParamCount: 0,
    restoreTimingMs: SAFE_EXIT_NRPN_DELAY_MS,
    exitSequence: ["RestoreKnownDefaultProfileOnly"],
    nrpnRestoreProfile: {},
  };
}

function clampDelayMs(value, fallback, min = 0, max = 2000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function getNrpnParamDelayMs(config = ext.config) {
  const requested = clampDelayMs(config?.linnstrumentNrpnParamDelayMs, defaultConfig.linnstrumentNrpnParamDelayMs);
  // On slower MIDI links (notably DIN), sub-30ms NRPN pacing can cause state misparsing.
  return Math.max(30, requested);
}

function getLinnstrumentSyncOptions(config = ext.config) {
  return {
    paramDelayMs: getNrpnParamDelayMs(config),
    applyControlModeToRightSplit: Boolean(config?.applyControlModeToRightSplit),
  };
}

function getActiveLayoutRowOffset() {
  return getActiveLayoutRowOffsetCore(ext.config, defaultConfig);
}

function overlayTouchIdForEvent(event) {
  return overlayTouchIdForEventCore(event, isControlOverlayTriggerCoord);
}

function isMpeModeEnabled() {
  return isMpeModeEnabledCore(ext.config, defaultConfig);
}

function markRecentLoopNoteOn(channel, noteNumber) {
  markRecentLoopNoteOnCore(ext.state.recentLoopNoteOns, channel, noteNumber);
}

function wasRecentlyForwardedLoopNoteOn(channel, noteNumber, maxAgeMs = 30) {
  return wasRecentlyForwardedLoopNoteOnCore(ext.state.recentLoopNoteOns, channel, noteNumber, maxAgeMs);
}

function shouldForwardPitchBendOnChannel(channel) {
  return shouldForwardPitchBendForInputChannel({
    inputChannel: channel,
    routedEntries: Array.from(ext.state.routedNotesByPad.values()),
  });
}

function applyUiColorThemeFromConfig() {
  const root = document.documentElement;
  if (!root) {
    return;
  }

  const modLed = parseLedColor(ext.config.colorModWheel, defaultConfig.colorModWheel);
  const rootLed = parseLedColor(ext.config.colorRootNote, defaultConfig.colorRootNote);
  const scaleLed = parseLedColor(ext.config.colorScaleNote, defaultConfig.colorScaleNote);
  const nonScaleLed = parseLedColor(ext.config.colorNonScaleNote, defaultConfig.colorNonScaleNote);
  const modColor = resolveUiLedColor(modLed);
  const rootColor = resolveUiLedColor(rootLed);
  const scaleColor = resolveUiLedColor(scaleLed);
  const nonScaleColor = resolveUiLedColor(nonScaleLed);
  const modTone = getUiTextTone(modLed, modColor);
  const rootTone = getUiTextTone(rootLed, rootColor);
  const playTone = getUiTextTone(scaleLed, scaleColor);
  const playOutTone = getUiTextTone(nonScaleLed, nonScaleColor);

  root.style.setProperty("--zone-mod", modColor);
  root.style.setProperty("--zone-mod-text", modTone.text);
  root.style.setProperty("--zone-mod-subtext", modTone.subtext);
  root.style.setProperty("--zone-root", rootColor);
  root.style.setProperty("--zone-root-text", rootTone.text);
  root.style.setProperty("--zone-root-subtext", rootTone.subtext);
  root.style.setProperty("--zone-play", scaleColor);
  root.style.setProperty("--zone-play-out-of-scale", nonScaleColor);
  root.style.setProperty("--zone-play-text", playTone.text);
  root.style.setProperty("--zone-play-subtext", playTone.subtext);
  root.style.setProperty("--zone-play-out-of-scale-text", playOutTone.text);
  root.style.setProperty("--zone-play-out-of-scale-subtext", playOutTone.subtext);
  root.style.setProperty("--zone-root-border", withAlpha(rootColor, 0.55));
  root.style.setProperty("--zone-root-shadow", withAlpha(rootColor, 0.2));
}

ext.fn = {
  rebuildLayout,
  connectMidiFromConfig,
  allNotesOff,
};
