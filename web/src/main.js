import { log } from "./log.js";
import { initConfig, persistConfig, clearPersistedConfig, defaultConfig } from "./config.js";
import { resetGrid, getGridDict, generateGrid, drawGrid, coordKey } from "./grid.js";
import { PRESETS, buildLayoutDefinition as buildLayoutDefinitionCore } from "./layout-logic.js";
import { readLinnStrumentParamValue } from "./linnstrument-sync.js";
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
  NO_OVERLAP_COLUMN_PHASE,
  clampInt,
  parsePitchSlideSetting,
  mod,
  getPitchBend14,
  scalePitchBend14,
  rowIndexFromChannel as rowIndexFromChannelCore,
  resolveNoOverlapPadCoord as resolveNoOverlapPadCoordCore,
  resolveUserFirmwarePadCoord as resolveUserFirmwarePadCoordCore,
  shouldLightPlayablePad as shouldLightPlayablePadCore,
  getActiveLayoutRowOffset as getActiveLayoutRowOffsetCore,
} from "./core-logic.js";
const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));

const INSTRUMENT_COLORS = {
  off: 7,
  mod: 2,
  overlayTrigger: 6,
  keyNatural: 4,
  keyAccidental: 5,
  mode: 3,
  octave: 11,
  disabled: 7,
  play: 8,
  tonic: 9,
  held: 1,
  selected: 1,
  sameNote: 1,
};

const DEBUG_CONTROL_OVERLAY = true;
const LINNSTRUMENT_INPUT_PROTOCOL_STANDARD = "standard";
const LINNSTRUMENT_INPUT_PROTOCOL_USER_FIRMWARE = "user-firmware";
const USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_1 = 3; // 3rd control-strip button from bottom (Oct-)
const USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_2 = 4; // 4th control-strip button from bottom (Oct+)
const USER_FIRMWARE_CONTROL_STRIP_ROW_SPLIT = 2;    // 2nd control-strip button from bottom (Split)

export const ext = {
  config: {},
  grid: null,
  gridDict: {},
  layout: {
    cellMeta: {},
    padMap: {},
  },
  midi: {
    instrumentInput: null,
    instrumentOutput: null,
    loopOutput: null,
  },
  state: {
    heldPads: new Set(),
    routedNotesByPad: new Map(),
    activeLoopNotes: new Set(),
    modPressuresByPad: new Map(),
    modChannelsByPad: new Map(),
    controlOverlay: createControlOverlayState(),
    sync: {
      splitMode: null,
      perRowLowestChannel: null,
      rowChannelOrderReversed: false,
    },
  },
  fn: {},
};
window.ext = ext;

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
  ext.config = initConfig();

  bindUi();
  populatePresetSelect();
  populateStateSelectors();
  populateUiFromConfig();
  refreshPortSelectors({ autoSelectInstrument: true });

  await connectMidiFromConfig();
  rebuildLayout();

  log.success("Prototype initialized.");
  if (isLinnStrumentUserFirmwareModeEnabled()) {
    log.info("Using LinnStrument User Firmware Mode input decoding (rows=channels 1-8, playable columns=notes 1-N).");
  } else {
    log.info("Using LinnStrument row-channel mapping assumption by default (channels 1-8 = rows). Click Sync From LinnStrument to confirm.");
  }
}

function bindUi() {
  document.getElementById("refreshPorts")?.addEventListener("click", () => {
    refreshPortSelectors({ autoSelectInstrument: true });
    updateRoutingStatus();
  });

  document.getElementById("saveConfig")?.addEventListener("click", async (event) => {
    event.preventDefault();
    readConfigFromUi();
    persistConfig(ext.config);
    await connectMidiFromConfig();
    rebuildLayout();
    log.success("Configuration applied.");
  });

  document.getElementById("resetConfig")?.addEventListener("click", async (event) => {
    event.preventDefault();
    await restoreLinnStrumentDefaultState();
    clearPersistedConfig();
    ext.config = { ...defaultConfig };
    ext.config.linnStrumentInputProtocol = LINNSTRUMENT_INPUT_PROTOCOL_STANDARD;
    populateUiFromConfig();
    refreshPortSelectors({ autoSelectInstrument: true });
    await connectMidiFromConfig({ autoConfigureInstrument: false });
    rebuildLayout({ paintInstrument: false });
    log.warn("Configuration reset to defaults. LinnStrument custom-mode startup mapping was disabled and defaults were restored.");
  });

  document.getElementById("syncLinnState")?.addEventListener("click", async () => {
    await syncFromLinnStrument();
  });

  document.getElementById("resendPbRange")?.addEventListener("click", async () => {
    readConfigFromUi();
    await resendPitchBendRangeFromConfig();
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

  window.addEventListener("resize", debounce(() => {
    drawGrid(ext.grid, ext.layout.cellMeta);
    paintInstrumentLayout();
    refreshHeldCellClasses();
  }, 120));
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
  setValue("pitchSlideSemitonesPerPad", ext.config.pitchSlideSemitonesPerPad);
  setValue("outputPitchBendRangeSemitones", ext.config.outputPitchBendRangeSemitones);
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
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
  const layoutRowOffsetScale = clampInt(
    getValue("layoutRowOffsetScale"),
    1,
    12,
    defaultConfig.layoutRowOffsetScale,
  );
  const layoutRowOffsetAllNotes = clampInt(
    getValue("layoutRowOffsetAllNotes"),
    1,
    12,
    defaultConfig.layoutRowOffsetAllNotes,
  );
  const pitchSlideSemitonesPerPad = parsePitchSlideSetting(
    getValue("pitchSlideSemitonesPerPad"),
    defaultConfig.pitchSlideSemitonesPerPad,
  );
  const outputPitchBendRangeSemitones = clampInt(
    getValue("outputPitchBendRangeSemitones"),
    1,
    96,
    defaultConfig.outputPitchBendRangeSemitones,
  );
  const deviceStartNote = clampInt(getValue("deviceStartNote"), 0, 127, defaultConfig.deviceStartNote);
  const deviceRowOffset = clampInt(getValue("deviceRowOffset"), 0, 24, defaultConfig.deviceRowOffset);

  ext.config = {
    ...ext.config,
    presetId,
    selectedKey,
    selectedModeId,
    layoutRowOffsetScale,
    layoutRowOffsetAllNotes,
    pitchSlideSemitonesPerPad,
    outputPitchBendRangeSemitones,
    deviceStartNote,
    deviceRowOffset,
    instrumentInputPort: getValue("instrumentInputPort") || "",
    instrumentOutputPort: getValue("instrumentOutputPort") || "",
    loopOutputPort: getValue("loopOutputPort") || "",
  };

  setValue("layoutRowOffsetScale", ext.config.layoutRowOffsetScale);
  setValue("layoutRowOffsetAllNotes", ext.config.layoutRowOffsetAllNotes);
  setValue("pitchSlideSemitonesPerPad", ext.config.pitchSlideSemitonesPerPad);
  setValue("outputPitchBendRangeSemitones", ext.config.outputPitchBendRangeSemitones);
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
  setValue("stateTonicSelect", mod(ext.config.selectedKey ?? defaultConfig.selectedKey, 12));
  setValue("stateScaleSelect", ext.config.selectedModeId ?? defaultConfig.selectedModeId);
}

function refreshPortSelectors({ autoSelectInstrument = false } = {}) {
  const current = {
    instrumentInputPort: getValue("instrumentInputPort") || ext.config.instrumentInputPort || "",
    instrumentOutputPort: getValue("instrumentOutputPort") || ext.config.instrumentOutputPort || "",
    loopOutputPort: getValue("loopOutputPort") || ext.config.loopOutputPort || "",
  };

  fillSelect(
    document.getElementById("instrumentInputPort"),
    WebMidi.inputs.map((port) => port.name),
    current.instrumentInputPort,
  );
  fillSelect(
    document.getElementById("instrumentOutputPort"),
    WebMidi.outputs.map((port) => port.name),
    current.instrumentOutputPort,
  );
  fillSelect(
    document.getElementById("loopOutputPort"),
    WebMidi.outputs.map((port) => port.name),
    current.loopOutputPort,
    { includeEmpty: true, emptyLabel: "Select MIDI loop output..." },
  );

  if (autoSelectInstrument) {
    autoSelectLinnStrumentPorts();
  }

  ext.config.instrumentInputPort = getValue("instrumentInputPort") || "";
  ext.config.instrumentOutputPort = getValue("instrumentOutputPort") || "";
  ext.config.loopOutputPort = getValue("loopOutputPort") || "";
}

function fillSelect(selectEl, names, selected, options = {}) {
  if (!selectEl) {
    return;
  }

  const { includeEmpty = true, emptyLabel = "(none)" } = options;
  selectEl.innerHTML = "";

  if (includeEmpty) {
    const empty = document.createElement("option");
    empty.value = "";
    empty.textContent = emptyLabel;
    selectEl.appendChild(empty);
  }

  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    if (selected === name) {
      option.selected = true;
    }
    selectEl.appendChild(option);
  });
}

function autoSelectLinnStrumentPorts() {
  const inputSelect = document.getElementById("instrumentInputPort");
  const outputSelect = document.getElementById("instrumentOutputPort");
  const loopSelect = document.getElementById("loopOutputPort");

  const detectedInput = WebMidi.inputs.find((port) => /linnstrument/i.test(port.name));
  const detectedOutput = WebMidi.outputs.find((port) => /linnstrument/i.test(port.name));

  if (inputSelect && !inputSelect.value && detectedInput) {
    inputSelect.value = detectedInput.name;
    log.info(`Auto-detected LinnStrument input: ${detectedInput.name}`);
  }

  if (outputSelect && !outputSelect.value && detectedOutput) {
    outputSelect.value = detectedOutput.name;
    log.info(`Auto-detected LinnStrument output: ${detectedOutput.name}`);
  }

  if (loopSelect && !loopSelect.value) {
    const preferredLoop =
      WebMidi.outputs.find((port) => /^loopMIDI Port$/i.test(port.name)) ||
      WebMidi.outputs.find((port) => /loopmidi/i.test(port.name));
    const firstLoop = preferredLoop || WebMidi.outputs.find((port) => !/linnstrument/i.test(port.name));
    if (firstLoop) {
      loopSelect.value = firstLoop.name;
      log.info(`Preselected loop output candidate: ${firstLoop.name}`);
    }
  }
}

async function connectMidiFromConfig(options = {}) {
  const { autoConfigureInstrument = true } = options;
  readConfigFromUi();
  detachInstrumentInputListeners();

  ext.midi.instrumentInput = null;
  ext.midi.instrumentOutput = null;
  ext.midi.loopOutput = null;

  if (ext.config.instrumentInputPort) {
    ext.midi.instrumentInput = WebMidi.getInputByName(ext.config.instrumentInputPort) || null;
    if (ext.midi.instrumentInput) {
      attachInstrumentInputListeners(ext.midi.instrumentInput);
      log.success(`Connected LinnStrument input: ${ext.config.instrumentInputPort}`);
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
      setLoopPitchBendRangeSemitones(ext.config.outputPitchBendRangeSemitones);
    } else {
      log.warn(`Loop output not found: ${ext.config.loopOutputPort}`);
    }
  } else {
    log.warn("No loop output selected. Notes will not be routed.");
  }

  if (autoConfigureInstrument) {
    await configureLinnStrumentInputMode();
  }
  updateRoutingStatus();
}

function detachInstrumentInputListeners() {
  if (ext.midi.instrumentInput) {
    try {
      ext.midi.instrumentInput.removeListener();
    } catch (err) {
      console.warn("Failed to detach previous listeners", err);
    }
  }
}

function attachInstrumentInputListeners(input) {
  input.addListener("noteon", (msg) => handleNoteOn(msg));
  input.addListener("noteoff", (msg) => handleNoteOff(msg));
  input.addListener("keyaftertouch", (msg) => handlePolyPressure(msg));
  input.addListener("channelaftertouch", (msg) => handleChannelAftertouch(msg));
  input.addListener("pitchbend", (msg) => handlePitchBend(msg));
}

function rebuildLayout(options = {}) {
  const { paintInstrument = true, preserveHeldState = false } = options;
  if (!preserveHeldState) {
    clearHeldState();
  }
  ext.grid = generateGrid(ext.config.deviceStartNote, ext.config.deviceRowOffset, ext.config.deviceColOffset);
  ext.gridDict = getGridDict(ext.grid, ext.config.deviceStartNote);

  const layout = buildLayoutDefinition();
  ext.layout.cellMeta = layout.cellMeta;
  ext.layout.padMap = layout.padMap;

  drawGrid(ext.grid, ext.layout.cellMeta);
  if (preserveHeldState) {
    refreshHeldCellClasses();
  }
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

function isControlOverlayActive() {
  return isControlOverlayActiveCore(ext.state.controlOverlay);
}

function isControlOverlayTriggerCoord(coord) {
  return coord === CONTROL_OVERLAY_TRIGGER_COORD;
}

function isLinnStrumentUserFirmwareModeEnabled() {
  return ext.config.linnStrumentInputProtocol === LINNSTRUMENT_INPUT_PROTOCOL_USER_FIRMWARE;
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
  const {
    trigger = "key",
    flashCoord = null,
    flashPitchClass = true,
  } = options;
  const nextKey = mod(keyPc, 12);

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
  logActiveState(trigger);
  return true;
}

function applySelectedMode(modeId, options = {}) {
  const {
    trigger = "scale",
    flashCoord = null,
  } = options;
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
  logActiveState(trigger);
  return true;
}

function setAllNotesMode(enabled, options = {}) {
  const {
    trigger = "all-notes",
    flashCoord = null,
  } = options;
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
  log.info(`All notes ${ext.config.allNotesEnabled ? "enabled" : "disabled"} (selected scale remains ${MODE_BY_ID[ext.config.selectedModeId]?.name || ext.config.selectedModeId}).`);
  logActiveState(trigger);
  return nextValue;
}

function toggleAllNotesMode(options = {}) {
  return setAllNotesMode(!ext.config.allNotesEnabled, options);
}

function handleNoteOn(msg) {
  const controlStripCommand = normalizeUserFirmwareControlStripCommandEvent(msg);
  if (controlStripCommand) {
    if (controlStripCommand.action === "octave-up") {
      shiftOutputOctave(1);
      return;
    }
    if (controlStripCommand.action === "octave-down") {
      shiftOutputOctave(-1);
      return;
    }
  }

  const overlayEvent = normalizeOverlayTriggerEvent(msg, { debug: true, phase: "noteon" });
  if (overlayEvent) {
    debugControlOverlay("noteon:routed-to-overlay", overlayEvent);
    if (!overlayEvent.syntheticControlStrip) {
      setPadHeld(overlayEvent.coord, true);
    }
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
      setModPressure(event.coord, event.velocity, event.channel, event.noteNumber);
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
      ext.state.routedNotesByPad.set(event.coord, { note: pad.outNote, channel: event.channel });
      sendLoopNoteOn(pad.outNote, event.velocity, event.channel);
      refreshSameOutputNoteHighlights(pad.outNote);
      refreshInstrumentSameOutputNoteHighlights(pad.outNote);
      break;
    }
    default:
      break;
  }
}

function handleNoteOff(msg) {
  const overlayEvent = normalizeOverlayTriggerEvent(msg, { debug: true, phase: "noteoff" });
  if (overlayEvent) {
    debugControlOverlay("noteoff:routed-to-overlay", overlayEvent);
    if (!overlayEvent.syntheticControlStrip) {
      setPadHeld(overlayEvent.coord, false);
    }
    handleControlOverlayTriggerRelease(overlayEvent);
    return;
  }

  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  setPadHeld(event.coord, false);

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (isControlOverlayTriggerCoord(event.coord) || pad.role === "control-overlay-trigger") {
    handleControlOverlayTriggerRelease(event);
    return;
  }
  if (pad.role === "mod") {
    clearModPressure(event.coord, event.channel, event.noteNumber);
    return;
  }

  const routed = ext.state.routedNotesByPad.get(event.coord);
  if (routed) {
    sendLoopNoteOff(routed.note, event.velocity, routed.channel);
    ext.state.routedNotesByPad.delete(event.coord);
    refreshSameOutputNoteHighlights(routed.note);
    refreshInstrumentSameOutputNoteHighlights(routed.note);
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
    setModPressure(event.coord, msg.rawValue ?? event.velocity, event.channel, event.noteNumber);
    return;
  }

  if (pad.role === "play-note") {
    sendLoopPolyAftertouch(pad.outNote, msg.rawValue ?? 0, event.channel);
  }
}

function handleChannelAftertouch(msg) {
  const channel = getChannel(msg);
  const value = msg.rawValue ?? 0;

  const heldModCoordsOnChannel = Array.from(ext.state.modChannelsByPad.entries())
    .filter(([_touchId, ch]) => ch === channel)
    .map(([touchId]) => touchId);

  if (heldModCoordsOnChannel.length > 0) {
    const pressure = clampInt(value, 0, 127, 0);
    heldModCoordsOnChannel.forEach((touchId) => {
      ext.state.modPressuresByPad.set(touchId, pressure);
    });
    sendLoopModWheel(pressure);
  }

  const heldPlayableNotesOnChannel = Array.from(ext.state.routedNotesByPad.values())
    .filter((entry) => entry.channel === channel)
    .map((entry) => entry.note);

  if (heldPlayableNotesOnChannel.length > 0) {
    const uniqueNotes = new Set(heldPlayableNotesOnChannel);
    uniqueNotes.forEach((noteNumber) => {
      sendLoopPolyAftertouch(noteNumber, value, channel);
    });
  }
}

function handlePitchBend(msg) {
  const channel = getChannel(msg);
  const value14 = getPitchBend14(msg);
  const scaled14 = scalePitchBendForConfig(value14);

  if (shouldForwardPitchBendOnChannel(channel)) {
    sendLoopPitchBend14(scaled14, channel);
  }
}

function normalizeTouchEvent(msg) {
  const raw = extractRawTouchEvent(msg);
  if (!raw) {
    return null;
  }

  const coord = resolvePadCoord(raw.noteNumber, raw.channel);
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
  const signatureMatch = matchesNoOverlapBottomLeftTriggerSignature(raw.noteNumber, raw.channel);
  const userFirmwareControlStripAction = resolveUserFirmwareControlStripCommand(raw.noteNumber, raw.channel);
  if (debug) {
    debugControlOverlay(`${phase}:probe`, {
      noteNumber: raw.noteNumber,
      channel: raw.channel,
      velocity: raw.velocity,
      resolvedCoord,
      isResolvedTriggerCoord: isControlOverlayTriggerCoord(resolvedCoord),
      signatureMatch,
      userFirmwareControlStripAction,
      triggerCoord: CONTROL_OVERLAY_TRIGGER_COORD,
      mapping: {
        inputProtocol: ext.config.linnStrumentInputProtocol || "standard",
        assumeRowChannels: ext.config.assumeRowChannels,
        deviceStartNote: ext.config.deviceStartNote,
        deviceRowOffset: ext.config.deviceRowOffset,
        deviceColOffset: ext.config.deviceColOffset,
        perRowLowestChannel: ext.state.sync.perRowLowestChannel ?? 1,
        rowChannelOrderReversed: Boolean(ext.state.sync.rowChannelOrderReversed),
      },
    });
  }
  if (isControlOverlayTriggerCoord(resolvedCoord)) {
    if (debug) {
      debugControlOverlay(`${phase}:match`, { via: "resolvedCoord" });
    }
    return { ...raw, coord: CONTROL_OVERLAY_TRIGGER_COORD };
  }

  if (userFirmwareControlStripAction === "overlay") {
    if (debug) {
      debugControlOverlay(`${phase}:match`, { via: "userFirmwareControlStripSplit" });
    }
    return {
      ...raw,
      coord: CONTROL_OVERLAY_TRIGGER_COORD,
      syntheticControlStrip: true,
    };
  }

  if (!isNoOverlapDetectionMode() || !signatureMatch) {
    return null;
  }

  if (debug) {
    debugControlOverlay(`${phase}:match`, { via: "noOverlapSignature" });
  }
  return { ...raw, coord: CONTROL_OVERLAY_TRIGGER_COORD };
}

function extractRawTouchEvent(msg) {
  const noteNumber = msg?.note?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(noteNumber)) {
    return null;
  }

  const channel = getChannel(msg);
  const velocity = msg.rawVelocity ?? msg.rawValue ?? 0;
  return {
    noteNumber,
    channel,
    velocity,
  };
}

function normalizeUserFirmwareControlStripCommandEvent(msg) {
  const raw = extractRawTouchEvent(msg);
  if (!raw) {
    return null;
  }
  const action = resolveUserFirmwareControlStripCommand(raw.noteNumber, raw.channel);
  if (!action || action === "overlay") {
    return null;
  }
  return {
    ...raw,
    action,
    syntheticControlStrip: true,
  };
}

function resolveUserFirmwareControlStripCommand(noteNumber, channel) {
  if (!isLinnStrumentUserFirmwareModeEnabled()) {
    return null;
  }
  if (!Number.isFinite(noteNumber) || !Number.isFinite(channel)) {
    return null;
  }
  if (noteNumber !== 0) {
    return null;
  }

  if (channel === USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_1) {
    return "octave-down";
  }
  if (channel === USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_2) {
    return "octave-up";
  }
  if (channel === USER_FIRMWARE_CONTROL_STRIP_ROW_SPLIT) {
    return "overlay";
  }
  return null;
}

function resolvePadCoord(noteNumber, channel) {
  const columns = ext.config.linnStrumentSize / 8;

  if (isLinnStrumentUserFirmwareModeEnabled()) {
    return resolveUserFirmwarePadCoord(noteNumber, channel);
  }

  if (isNoOverlapDetectionMode()) {
    return resolveNoOverlapPadCoord(noteNumber, channel);
  }

  if (ext.config.assumeRowChannels && Number.isFinite(channel) && channel >= 1 && channel <= 16) {
    const reversed = Boolean(ext.state.sync.rowChannelOrderReversed);
    const lowestChannel = ext.state.sync.perRowLowestChannel ?? 1;
    const rowIndex = channel - lowestChannel;
    const y = reversed ? 7 - rowIndex : rowIndex;
    const rawX = (noteNumber - ext.config.deviceStartNote - y * ext.config.deviceRowOffset) / ext.config.deviceColOffset;
    const x = Math.round(rawX);

    if (y >= 0 && y < 8 && x >= 0 && x < columns && Math.abs(rawX - x) < 0.0001) {
      return coordKey(x, y);
    }
  }

  const fallback = ext.gridDict[noteNumber]?.[0];
  if (!fallback) {
    return null;
  }
  return coordKey(fallback[0], fallback[1]);
}

function isNoOverlapDetectionMode() {
  if (isLinnStrumentUserFirmwareModeEnabled()) {
    return false;
  }
  const columns = ext.config.linnStrumentSize / 8;
  return (
    ext.config.deviceStartNote === 0 &&
    ext.config.deviceColOffset === 1 &&
    ext.config.deviceRowOffset === columns
  );
}

function resolveUserFirmwarePadCoord(noteNumber, channel) {
  return resolveUserFirmwarePadCoordCore(noteNumber, channel, {
    columns: ext.config.linnStrumentSize / 8,
    rows: 8,
    perRowLowestChannel: 1,
    rowChannelOrderReversed: false,
  });
}

function resolveNoOverlapPadCoord(noteNumber, channel) {
  return resolveNoOverlapPadCoordCore(noteNumber, channel, {
    columns: ext.config.linnStrumentSize / 8,
    rows: 8,
    assumeRowChannels: ext.config.assumeRowChannels,
    perRowLowestChannel: ext.state.sync.perRowLowestChannel ?? 1,
    rowChannelOrderReversed: Boolean(ext.state.sync.rowChannelOrderReversed),
  });
}

function setPadHeld(coord, held) {
  if (held) {
    ext.state.heldPads.add(coord);
  } else {
    ext.state.heldPads.delete(coord);
  }

  const el = document.getElementById(`cell-${coord}`);
  if (el) {
    el.classList.toggle("cell-held", held);
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

  const activeCoordsForNote = new Set(
    Array.from(ext.state.routedNotesByPad.entries())
      .filter(([_coord, routed]) => routed.note === noteNumber)
      .map(([coord]) => coord),
  );
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

    const color = hasActive && !activeCoordsForNote.has(coord)
      ? INSTRUMENT_COLORS.sameNote
      : getInstrumentColorForMeta(meta, coord);
    highlightInstrumentXY(x, y, color);
  }
}

function refreshHeldCellClasses() {
  ext.state.heldPads.forEach((coord) => {
    const el = document.getElementById(`cell-${coord}`);
    if (el) {
      el.classList.add("cell-held");
    }
  });
}

function setModPressure(coord, value, channel = 1, noteNumber = null) {
  const touchId = modTouchId(channel, noteNumber, coord);
  ext.state.modChannelsByPad.set(touchId, channel || 1);
  ext.state.modPressuresByPad.set(touchId, clampInt(value, 0, 127, 0));
  const current = Math.max(0, ...ext.state.modPressuresByPad.values());
  sendLoopModWheel(current);
}

function clearModPressure(coord, channel = 1, noteNumber = null) {
  const touchId = modTouchId(channel, noteNumber, coord);
  ext.state.modChannelsByPad.delete(touchId);
  ext.state.modPressuresByPad.delete(touchId);
  const current = ext.state.modPressuresByPad.size > 0 ? Math.max(...ext.state.modPressuresByPad.values()) : 0;
  sendLoopModWheel(current);
}

function sendLoopNoteOn(noteNumber, velocity = 100, channel = 1) {
  const out = ext.midi.loopOutput;
  if (!out || !out.channels?.[channel]) {
    return;
  }

  out.channels[channel].playNote(noteNumber, { rawAttack: clampInt(velocity, 0, 127, 100) });
  ext.state.activeLoopNotes.add(noteKey(channel, noteNumber));

  const coord = findCoordByRoutedNote(channel, noteNumber);
  if (coord) {
    const el = document.getElementById(`cell-${coord}`);
    el?.classList.add("cell-active");
  }
}

function sendLoopNoteOff(noteNumber, velocity = 0, channel = 1) {
  const out = ext.midi.loopOutput;
  if (!out || !out.channels?.[channel]) {
    return;
  }

  out.channels[channel].stopNote(noteNumber, { rawRelease: clampInt(velocity, 0, 127, 0) });
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
  // CC1 is shared in MPE; keep it on channel 1.
  sendLoopControlChange(1, value, 1);
}

function sendLoopPolyAftertouch(noteNumber, value, channel = 1) {
  sendRawToLoop([0xa0 | ((channel - 1) & 0x0f), noteNumber & 0x7f, clampInt(value, 0, 127, 0)]);
}

function sendLoopChannelAftertouch(value, channel = 1) {
  sendRawToLoop([0xd0 | ((channel - 1) & 0x0f), clampInt(value, 0, 127, 0)]);
}

function sendLoopPitchBend14(value14, channel = 1) {
  const bend = clampInt(value14, 0, 16383, 8192);
  sendRawToLoop([0xe0 | ((channel - 1) & 0x0f), bend & 0x7f, (bend >> 7) & 0x7f]);
}

function sendRawToLoop(data) {
  const out = ext.midi.loopOutput;
  if (!out) {
    return;
  }

  try {
    out.send(data);
  } catch (err) {
    console.warn("Failed raw MIDI send", data, err);
  }
}

function setLoopPitchBendRangeSemitones(semitones = 2) {
  const value = clampInt(semitones, 0, 127, 2);
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

async function resendPitchBendRangeFromConfig() {
  const semitones = clampInt(
    ext.config.outputPitchBendRangeSemitones,
    1,
    96,
    defaultConfig.outputPitchBendRangeSemitones,
  );
  const loopSent = setLoopPitchBendRangeSemitones(semitones);
  if (ext.midi.instrumentOutput) {
    try {
      await setLinnStrumentParamValue(19, semitones);
    } catch (err) {
      console.warn("Failed to resend LinnStrument bend range", err);
    }
  }
  log.info(`Resent pitch bend range: ±${semitones} semitones (loop=${loopSent ? "ok" : "skipped"}, linnstrument=${ext.midi.instrumentOutput ? "ok/attempted" : "skipped"}).`);
}

function findCoordByRoutedNote(channel, noteNumber) {
  for (const [coord, routed] of ext.state.routedNotesByPad.entries()) {
    if (routed.channel === channel && routed.note === noteNumber) {
      return coord;
    }
  }
  return null;
}

function allNotesOff() {
  for (let channel = 1; channel <= 16; channel++) {
    sendLoopControlChange(123, 0, channel);
    sendLoopControlChange(120, 0, channel);
    sendLoopChannelAftertouch(0, channel);
    sendLoopControlChange(1, 0, channel);
    sendLoopPitchBend14(8192, channel);
  }
  ext.state.activeLoopNotes.clear();
  ext.state.routedNotesByPad.clear();
}

function clearHeldState() {
  if (ext.state.routedNotesByPad.size > 0 || ext.state.activeLoopNotes.size > 0) {
    allNotesOff();
  }
  resetGrid(highlightInstrumentXY);
  ext.state.heldPads.clear();
  ext.state.modPressuresByPad.clear();
  ext.state.modChannelsByPad.clear();
  ext.state.routedNotesByPad.clear();
  ext.state.activeLoopNotes.clear();
}

function updateStatusUi() {
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  setValue("stateTonicSelect", mod(ext.config.selectedKey, 12));
  setValue("stateScaleSelect", mode.id);
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
}

function updateRoutingStatus() {
  const inOk = Boolean(ext.midi.instrumentInput);
  const outOk = Boolean(ext.midi.loopOutput);
  const status = inOk && outOk ? "Ready" : inOk ? "No loop output" : "No LinnStrument input";
  setText("routingStatus", status);
}

function paintInstrumentLayout() {
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

  paintInstrumentUserFirmwareControlStrip();
}

function getInstrumentColorForMeta(meta = {}, coord = null) {
  if (coord && ext.state.heldPads.has(coord)) {
    return INSTRUMENT_COLORS.held;
  }

  let color = INSTRUMENT_COLORS.disabled;

  if (meta.zone === "overlay-trigger") color = INSTRUMENT_COLORS.overlayTrigger;
  if (meta.zone === "mod") color = INSTRUMENT_COLORS.mod;
  if (meta.zone === "key") {
    color = meta.selected
      ? INSTRUMENT_COLORS.selected
      : meta.accidental
        ? INSTRUMENT_COLORS.keyAccidental
        : INSTRUMENT_COLORS.keyNatural;
  }
  if (meta.zone === "octave") color = INSTRUMENT_COLORS.octave;
  if (meta.zone === "mode") color = meta.selected ? INSTRUMENT_COLORS.selected : INSTRUMENT_COLORS.mode;
  if (meta.zone === "play") {
    color = shouldLightPlayablePad(meta)
      ? (meta.tonic ? INSTRUMENT_COLORS.tonic : INSTRUMENT_COLORS.play)
      : INSTRUMENT_COLORS.off;
  }
  if (meta.zone === "disabled") color = INSTRUMENT_COLORS.off;

  return color;
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
  if (!out?.channels?.[1]) {
    return;
  }

  const channel = out.channels[1];
  channel.sendControlChange(20, x);
  channel.sendControlChange(21, y);
  channel.sendControlChange(22, color);
}

function paintInstrumentUserFirmwareControlStrip() {
  if (!isLinnStrumentUserFirmwareModeEnabled() || !ext.midi.instrumentOutput) {
    return;
  }

  const activeOverlay = isControlOverlayActive();
  const controlStripColorsByRow = {
    [USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_1 - 1]: INSTRUMENT_COLORS.octave, // Switch 1 = Oct-
    [USER_FIRMWARE_CONTROL_STRIP_ROW_SWITCH_2 - 1]: INSTRUMENT_COLORS.octave, // Switch 2 = Oct+
    [USER_FIRMWARE_CONTROL_STRIP_ROW_SPLIT - 1]: activeOverlay
      ? INSTRUMENT_COLORS.selected
      : INSTRUMENT_COLORS.overlayTrigger, // Split = Overlay
  };

  for (let y = 0; y < 8; y++) {
    const color = controlStripColorsByRow[y] ?? INSTRUMENT_COLORS.off;
    highlightInstrumentHardwareXY(0, y, color);
  }
}

async function syncFromLinnStrument() {
  if (!ext.midi.instrumentInput || !ext.midi.instrumentOutput) {
    log.warn("Select LinnStrument input and output first.");
    return;
  }
  if (isLinnStrumentUserFirmwareModeEnabled()) {
    log.info("Sync From LinnStrument is skipped in User Firmware Mode (input coordinates are fixed: rows=channels 1-8, playable columns=notes 1-N).");
    return;
  }

  try {
    const splitMode = await getLinnStrumentParamValue(0);
    const perRowLowestChannel = await getLinnStrumentParamValue(18);
    const rowChannelOrder = await getLinnStrumentParamValue(60);
    const splitLeftOctave = await getLinnStrumentParamValue(36);
    const splitLeftTranspose = await getLinnStrumentParamValue(37);
    let rowOffset = await getLinnStrumentParamValue(227);

    if (rowOffset === 127) {
      rowOffset = 0;
    } else if (rowOffset === 0) {
      rowOffset = ext.config.linnStrumentSize / 8;
    }

    let startNoteNumber = 30 + (-7 + splitLeftTranspose);
    startNoteNumber += (-5 + splitLeftOctave) * 12;

    ext.state.sync = {
      splitMode,
      perRowLowestChannel,
      rowChannelOrderReversed: rowChannelOrder === 1,
    };
    ext.config.assumeRowChannels = splitMode === 2;

    ext.config.deviceStartNote = startNoteNumber;
    ext.config.deviceRowOffset = rowOffset;

    populateUiFromConfig();
    persistConfig(ext.config);
    rebuildLayout();

    const modeLabel = splitMode === 2 ? "Channel Per Row" : splitMode === 1 ? "Channel Per Note" : "One Channel";
    log.success(`Synced from LinnStrument: start=${startNoteNumber}, rowOffset=${rowOffset}, splitMode=${modeLabel}, rowLowCh=${perRowLowestChannel}`);
    if (splitMode !== 2) {
      log.warn("Prototype pad-coordinate decoding is best with Split Left MIDI Mode = Channel Per Row (NRPN 0 = 2).");
    }
    if (perRowLowestChannel !== 1) {
      log.warn(`Per-row lowest channel is ${perRowLowestChannel}; prototype currently assumes channel mapping starts at 1.`);
    }
  } catch (err) {
    console.error(err);
    log.error(`Sync failed: ${err?.message || err}`);
  }
}

async function getLinnStrumentParamValue(paramNumber) {
  return readLinnStrumentParamValue({
    inputChannel: ext.midi.instrumentInput?.channels?.[1],
    output: ext.midi.instrumentOutput,
    paramNumber,
    timeoutMs: 350,
    withTimeout: promiseTimeout,
    nrpnEncoder: nrpn,
  });
}

async function setLinnStrumentParamValue(paramNumber, value) {
  const output = ext.midi.instrumentOutput;
  if (!output) {
    throw new Error("Missing LinnStrument output");
  }
  output.sendNrpnValue(nrpn(paramNumber), nrpn(value), { channels: 1 });
  await sleep(24);
}

function sendLinnStrumentControlChange(cc, value, channel = 1) {
  const out = ext.midi.instrumentOutput;
  if (!out?.channels?.[channel]) {
    throw new Error(`Missing LinnStrument output channel ${channel}`);
  }
  out.channels[channel].sendControlChange(cc, clampInt(value, 0, 127, 0));
}

async function configureLinnStrumentInputMode() {
  if (isLinnStrumentUserFirmwareModeEnabled()) {
    await configureLinnStrumentUserFirmwareMode();
    return;
  }
  await configureLinnStrumentNoOverlapDetectionMode();
}

async function configureLinnStrumentUserFirmwareMode() {
  if (!ext.midi.instrumentOutput) {
    return;
  }

  try {
    // User Firmware Mode gives fixed coordinates:
    // - Rows are MIDI channels 1..8 (bottom row = 1)
    // - Playable columns are note numbers 1..N (note 0 is the control-switch column)
    await setLinnStrumentParamValue(245, 1); // User Firmware Mode = On

    for (let channel = 1; channel <= 8; channel++) {
      sendLinnStrumentControlChange(9, 0, channel);  // Slide mode off (X-slide translation not implemented yet)
      sendLinnStrumentControlChange(10, 0, channel); // X data off (avoid extra traffic for now)
      sendLinnStrumentControlChange(11, 0, channel); // Y data off
      sendLinnStrumentControlChange(12, 1, channel); // Z data on (poly pressure)
    }
    sendLinnStrumentControlChange(13, 0, 1); // Data decimation off

    ext.state.sync = {
      splitMode: 2,
      perRowLowestChannel: 1,
      rowChannelOrderReversed: false,
    };
    ext.config.assumeRowChannels = true;
    ext.config.linnStrumentInputProtocol = LINNSTRUMENT_INPUT_PROTOCOL_USER_FIRMWARE;

    populateUiFromConfig();
    persistConfig(ext.config);
    log.success("Configured LinnStrument User Firmware Mode (NRPN 245=1). Enabled Z data on rows 1-8; X/Y/slide disabled for now.");
    log.warn("User Firmware Mode input is active. Pitch-slide (X) forwarding is not implemented yet in this app.");
  } catch (err) {
    console.error(err);
    log.warn(`Could not enable LinnStrument User Firmware Mode automatically: ${err?.message || err}`);
  }
}

async function configureLinnStrumentNoOverlapDetectionMode() {
  if (!ext.midi.instrumentOutput) {
    return;
  }

  try {
    // Deterministic pad mapping for a 128-pad LinnStrument:
    // - Channel Per Row (rows 0-7 => channels 1-8)
    // - Global Row Offset = No Overlap (unique notes across 16x8 => row interval 16)
    // - No split and no low-row special mode (both split parameter banks forced off)
    // - Transposed so the bottom-left pad starts at MIDI note 0 in no-overlap mode
    await setLinnStrumentParamValue(200, 0); // Global Split Active = Off
    await setLinnStrumentParamValue(201, 0); // Global Selected Split = Left
    await setLinnStrumentParamValue(34, 0);  // Split Left LowRow Mode = Off (normal notes)
    await setLinnStrumentParamValue(35, 0);  // Split Left Special = Off
    await setLinnStrumentParamValue(134, 0); // Split Right LowRow Mode = Off (normal notes)
    await setLinnStrumentParamValue(135, 0); // Split Right Special = Off
    await setLinnStrumentParamValue(0, 2);   // Split Left MIDI Mode = Channel Per Row
    await setLinnStrumentParamValue(18, 1);  // Split Left Lowest Per-Row Channel = 1
    await setLinnStrumentParamValue(19, clampInt(ext.config.outputPitchBendRangeSemitones, 1, 96, 2));  // Split Left MIDI Bend Range
    await setLinnStrumentParamValue(60, 0);  // Split Left Row Channel Order = Normal
    await setLinnStrumentParamValue(227, 0); // Global Row Offset = No overlap
    await setLinnStrumentParamValue(36, 2);  // Split Left Octave = -3
    await setLinnStrumentParamValue(37, 13); // Split Left Transpose Pitch = +6
    await setLinnStrumentParamValue(38, 13); // Split Left Transpose Lights = +6

    ext.state.sync = {
      splitMode: 2,
      perRowLowestChannel: 1,
      rowChannelOrderReversed: false,
    };
    ext.config.assumeRowChannels = true;
    ext.config.deviceStartNote = 0;
    ext.config.deviceRowOffset = ext.config.linnStrumentSize / 8;
    ext.config.deviceColOffset = 1;

    populateUiFromConfig();
    persistConfig(ext.config);
    log.success("Configured LinnStrument startup mapping: No Overlap (NRPN 227=0), Channel Per Row, low-row note mode, bottom-left note = 0.");

  } catch (err) {
    console.error(err);
    log.warn(`Could not set LinnStrument startup mapping automatically: ${err?.message || err}`);
  }
}

async function restoreLinnStrumentDefaultState() {
  if (!ext.midi.instrumentOutput) {
    return;
  }

  try {
    await setLinnStrumentParamValue(245, 0); // User Firmware Mode = Off

    // Restore a conservative/default-like playable state and stop the app-specific mapping.
    await setLinnStrumentParamValue(200, 0); // Global Split Active = Off
    await setLinnStrumentParamValue(34, 0);  // Split Left LowRow Mode = Off
    await setLinnStrumentParamValue(35, 0);  // Split Left Special = Off
    await setLinnStrumentParamValue(134, 0); // Split Right LowRow Mode = Off
    await setLinnStrumentParamValue(135, 0); // Split Right Special = Off
    await setLinnStrumentParamValue(0, 0);   // Split Left MIDI Mode = One Channel
    await setLinnStrumentParamValue(18, 1);  // Lowest per-row channel = 1
    await setLinnStrumentParamValue(60, 0);  // Row order = Normal
    await setLinnStrumentParamValue(227, 5); // Global Row Offset = 5 (standard fourths)
    await setLinnStrumentParamValue(36, 5);  // Split Left Octave = 0
    await setLinnStrumentParamValue(37, 7);  // Split Left Transpose Pitch = 0
    await setLinnStrumentParamValue(38, 7);  // Split Left Transpose Lights = 0

    // Clear custom colors on the app's 16x8 grid area.
    resetGrid(highlightInstrumentXY);

    log.success("Restored LinnStrument defaults (One Channel, row offset 5, no transpose) and cleared app-applied pad colors.");
  } catch (err) {
    console.error(err);
    log.warn(`Could not fully restore LinnStrument defaults on reset: ${err?.message || err}`);
  }
}

function nrpn(value) {
  const msb = value >> 7;
  const lsb = value & 0x7f;
  return [msb, lsb];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shiftOutputOctave(deltaOctaves) {
  const nextBaseRootC = clampInt(
    ext.config.baseRootC + deltaOctaves * 12,
    0,
    108,
    ext.config.baseRootC,
  );

  if (nextBaseRootC === ext.config.baseRootC) {
    log.warn(`Output octave already at ${deltaOctaves > 0 ? "maximum" : "minimum"}.`);
    return false;
  }

  ext.config.baseRootC = nextBaseRootC;
  persistConfig(ext.config);
  rebuildLayout({ preserveHeldState: true, paintInstrument: false });
  log.info(`Output octave changed: base C = ${NOTE_NAMES[nextBaseRootC % 12]}${Math.floor(nextBaseRootC / 12) - 1}`);
  logActiveState("octave");
  return true;
}

function logActiveState(trigger = "state") {
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  const tonic = NOTE_NAMES[mod(ext.config.selectedKey, 12)];
  const octave = Math.floor(ext.config.baseRootC / 12) - 1;
  log.info(
    `State (${trigger}): tonic=${tonic}, scale=${mode.name}, allNotes=${ext.config.allNotesEnabled ? "on" : "off"}, octave=${octave}, layoutOffset=${getActiveLayoutRowOffset()} (scale=${ext.config.layoutRowOffsetScale}, all=${ext.config.layoutRowOffsetAllNotes}), deviceOffset=${ext.config.deviceRowOffset}`,
  );
}

function getActiveLayoutRowOffset() {
  return getActiveLayoutRowOffsetCore(ext.config, defaultConfig);
}

function modTouchId(channel, noteNumber, fallbackCoord = "") {
  if (Number.isFinite(noteNumber)) {
    return `mod:${noteKey(channel || 1, noteNumber)}`;
  }
  return `mod:${channel || 1}:${fallbackCoord}`;
}

function overlayTouchIdForEvent(event) {
  if (!event) {
    return null;
  }
  if (Number.isFinite(event.noteNumber)) {
    return `overlay:${noteKey(event.channel || 1, event.noteNumber)}`;
  }
  if (event.coord) {
    return `overlay:${event.coord}`;
  }
  return "overlay";
}

function matchesNoOverlapBottomLeftTriggerSignature(noteNumber, channel) {
  if (!isNoOverlapDetectionMode()) {
    return false;
  }
  if (!ext.config.assumeRowChannels) {
    return false;
  }
  if (!Number.isFinite(noteNumber) || !Number.isFinite(channel)) {
    return false;
  }

  const columns = ext.config.linnStrumentSize / 8;
  if (!Number.isFinite(columns) || columns <= 0) {
    return false;
  }

  const lowestChannel = ext.state.sync.perRowLowestChannel ?? 1;
  const expectedBottomRowChannel = ext.state.sync.rowChannelOrderReversed
    ? lowestChannel + 7
    : lowestChannel;
  if (channel !== expectedBottomRowChannel) {
    return false;
  }

  return mod(noteNumber - NO_OVERLAP_COLUMN_PHASE, columns) === 0;
}

function shouldLightPlayablePad(meta) {
  return shouldLightPlayablePadCore(meta, ext.config.allNotesEnabled);
}

function noteKey(channel, noteNumber) {
  return `${channel}:${noteNumber}`;
}

function getChannel(msg) {
  return msg?.message?.channel ?? msg?.channel ?? 1;
}

function scalePitchBendForConfig(value14) {
  return scalePitchBend14(value14, ext.config.pitchSlideSemitonesPerPad);
}

function shouldForwardPitchBendOnChannel(channel) {
  if (!Number.isFinite(channel)) {
    return false;
  }

  if (ext.config.assumeRowChannels) {
    const row = rowIndexFromChannel(channel);
    if (row !== null) {
      return rowHasPlayablePads(row);
    }
  }

  return Array.from(ext.state.routedNotesByPad.values()).some((entry) => entry.channel === channel);
}

function rowIndexFromChannel(channel) {
  return rowIndexFromChannelCore(channel, {
    perRowLowestChannel: ext.state.sync.perRowLowestChannel ?? 1,
    rowChannelOrderReversed: ext.state.sync.rowChannelOrderReversed,
  });
}

function rowHasPlayablePads(row) {
  const columns = ext.config.linnStrumentSize / 8;
  for (let x = 0; x < columns; x++) {
    if (ext.layout.padMap[coordKey(x, row)]?.role === "play-note") {
      return true;
    }
  }
  return false;
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = String(value ?? "");
  }
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = text;
  }
}

function debounce(fn, delay) {
  let t = null;
  return (...args) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function promiseTimeout(ms, promise) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timed out in ${ms}ms`)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

ext.fn = {
  rebuildLayout,
  connectMidiFromConfig,
  syncFromLinnStrument,
  allNotesOff,
};
