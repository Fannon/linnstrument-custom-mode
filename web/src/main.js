import { log } from "./log.js";
import { initConfig, persistConfig, clearPersistedConfig, defaultConfig } from "./config.js";
import { resetGrid, getGridDict, generateGrid, drawGrid, coordKey } from "./grid.js";
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
  mod,
  getPitchBend14,
  scalePitchBend14,
  resolveNoOverlapPadCoord as resolveNoOverlapPadCoordCore,
  shouldLightPlayablePad as shouldLightPlayablePadCore,
  getActiveLayoutRowOffset as getActiveLayoutRowOffsetCore,
} from "./core-logic.js";
import {
  getRoutedInputChannel,
  isMpeModeEnabled as isMpeModeEnabledCore,
  listOutputChannelsForInputChannel,
  shouldForwardPitchBendForInputChannel,
} from "./mpe-routing.js";
import {
  allocateMpeVoice,
  clearMpeVoiceAllocator,
  createMpeVoiceAllocator,
  releaseMpeVoice,
} from "./mpe-voice-allocator.js";
const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));

const INSTRUMENT_COLORS = {
  off: 7,
  mod: 2,
  overlayTrigger: 6,
  keyNatural: 4,
  keyAccidental: 5,
  mode: 3,
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

const DEBUG_CONTROL_OVERLAY = true;

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
  },
  state: {
    heldPads: new Set(),
    routedNotesByPad: new Map(),
    activeLoopNotes: new Set(),
    modPressuresByPad: new Map(),
    modChannelsByPad: new Map(),
    controlOverlay: createControlOverlayState(),
    lastPitchBend14ByChannel: new Map(),
    mpeVoices: createMpeVoiceAllocator({ minChannel: 2, maxChannel: 15 }),
    detectedChordName: "",
    instrumentPaintingEnabled: true,
    webPointerTouchById: new Map(),
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
  log.info("Using LinnStrument standard input decoding.");
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
    clearPersistedConfig();
    ext.config = { ...defaultConfig };
    populateUiFromConfig();
    refreshPortSelectors({ autoSelectInstrument: true });
    await connectMidiFromConfig();
    rebuildLayout({ paintInstrument: true });
    log.warn("Configuration reset to defaults.");
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

  bindSurfacePointerInput();
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
  setChecked(
    "scaleModeHighlightNonRootWhite",
    Boolean(ext.config.scaleModeHighlightNonRootWhite ?? defaultConfig.scaleModeHighlightNonRootWhite),
  );
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
  const scaleModeHighlightNonRootWhiteRaw = getChecked("scaleModeHighlightNonRootWhite");
  const scaleModeHighlightNonRootWhite = scaleModeHighlightNonRootWhiteRaw === null
    ? Boolean(ext.config.scaleModeHighlightNonRootWhite ?? defaultConfig.scaleModeHighlightNonRootWhite)
    : scaleModeHighlightNonRootWhiteRaw;
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
    scaleModeHighlightNonRootWhite,
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
  setChecked("scaleModeHighlightNonRootWhite", Boolean(ext.config.scaleModeHighlightNonRootWhite));
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

async function connectMidiFromConfig() {
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
  input.addListener("controlchange", (msg) => handleControlChange(msg));
  input.addListener("keyaftertouch", (msg) => handlePolyPressure(msg));
  input.addListener("channelaftertouch", (msg) => handleChannelAftertouch(msg));
  input.addListener("pitchbend", (msg) => handlePitchBend(msg));
}

function rebuildLayout(options = {}) {
  const { paintInstrument = true, preserveHeldState = false } = options;
  if (!preserveHeldState) {
    clearHeldState();
  }
  const gridMappingSignature = getGridMappingSignature();
  if (ext.layout.gridMappingSignature !== gridMappingSignature || !ext.grid) {
    ext.grid = generateGrid(ext.config.deviceStartNote, ext.config.deviceRowOffset, ext.config.deviceColOffset);
    ext.gridDict = getGridDict(ext.grid, ext.config.deviceStartNote);
    ext.layout.gridMappingSignature = gridMappingSignature;
  }

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
    ext.state.webPointerTouchById.set(event.pointerId, coord);
    try {
      event.target?.setPointerCapture?.(event.pointerId);
    } catch {
      // Programmatic pointer events in tests may not have capturable pointer state.
    }
    handleNoteOn({
      note: { number: touchEvent.noteNumber },
      channel: touchEvent.channel,
      rawVelocity: touchEvent.velocity,
    });
    event.preventDefault();
  });

  const releasePointer = (event) => {
    const trackedCoord = ext.state.webPointerTouchById.get(event.pointerId);
    const coord = trackedCoord || extractCoordFromSurfaceEvent(event);
    if (!coord) {
      return;
    }
    const touchEvent = createSurfaceTouchEventFromCoord(coord, 0);
    ext.state.webPointerTouchById.delete(event.pointerId);
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

  return {
    noteNumber: x,
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

function setMpeModeEnabled(enabled, options = {}) {
  const {
    trigger = "mpe",
    flashCoord = null,
  } = options;
  const nextValue = Boolean(enabled);
  if (isMpeModeEnabled() === nextValue) {
    return nextValue;
  }

  clearHeldState();
  ext.config.mpeEnabled = nextValue;
  persistConfig(ext.config);
  rebuildLayout({ preserveHeldState: false, paintInstrument: true });
  if (flashCoord) {
    flashSelection(flashCoord);
  }
  log.info(`MPE routing ${nextValue ? "enabled" : "disabled"} (${nextValue ? "notes/pitch bend on source channels" : "notes/pitch bend forced to channel 1"}).`);
  logActiveState(trigger);
  return nextValue;
}

function handleNoteOn(msg) {
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
      const mpeEnabled = isMpeModeEnabled();
      const sourceKey = noteKey(event.channel, event.noteNumber);
      const { channel: outputChannel, stolenInputKey } = mpeEnabled
        ? allocateMpeVoice(ext.state.mpeVoices, sourceKey)
        : { channel: 1, stolenInputKey: null };

      if (stolenInputKey) {
        const stolenEntry = findRoutedEntryBySourceKey(stolenInputKey);
        if (stolenEntry) {
          finalizeRoutedNoteOff(stolenEntry.coord, 0);
          setPadHeld(stolenEntry.coord, false);
        }
      }

      ext.state.routedNotesByPad.set(event.coord, {
        note: pad.outNote,
        channel: outputChannel,
        sourceChannel: event.channel,
        sourceNoteNumber: event.noteNumber,
      });
      sendLoopPitchBend14(8192, outputChannel);
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
  const overlayEvent = normalizeOverlayTriggerEvent(msg, { debug: true, phase: "noteoff" });
  if (overlayEvent) {
    debugControlOverlay("noteoff:routed-to-overlay", overlayEvent);
    setPadHeld(overlayEvent.coord, false);
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

  const routed = ext.state.routedNotesByPad.get(event.coord);
  if (routed) {
    finalizeRoutedNoteOff(event.coord, event.velocity);
    return;
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
    setModPressure(event.coord, msg.rawValue ?? event.velocity, event.channel, event.noteNumber);
    return;
  }

  if (pad.role === "play-note") {
    const routed = ext.state.routedNotesByPad.get(event.coord);
    const outputChannel = routed?.channel ?? 1;
    const value = msg.rawValue ?? 0;
    if (isMpeModeEnabled()) {
      sendLoopChannelAftertouch(value, outputChannel);
    } else {
      sendLoopPolyAftertouch(pad.outNote, value, outputChannel);
    }
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

  const heldPlayableEntriesOnChannel = Array.from(ext.state.routedNotesByPad.values())
    .filter((entry) => getRoutedInputChannel(entry) === channel);

  if (heldPlayableEntriesOnChannel.length > 0) {
    if (isMpeModeEnabled()) {
      const outputChannels = listOutputChannelsForInputChannel(
        Array.from(ext.state.routedNotesByPad.values()),
        channel,
      );
      outputChannels.forEach((outputChannel) => {
        sendLoopChannelAftertouch(value, outputChannel);
      });
    } else {
      const uniqueNoteKeys = new Set();
      heldPlayableEntriesOnChannel.forEach((entry) => {
        const key = noteKey(entry.channel, entry.note);
        if (uniqueNoteKeys.has(key)) {
          return;
        }
        uniqueNoteKeys.add(key);
        sendLoopPolyAftertouch(entry.note, value, entry.channel);
      });
    }
  }
}

function handleControlChange(msg) {
  const event = extractRawControlChangeEvent(msg);
  if (!event) {
    return;
  }

  if (event.controller === 1) {
    sendLoopModWheel(event.value7);
    return;
  }

  if (event.controller !== 74) {
    return;
  }

  if (!isMpeModeEnabled()) {
    if (ext.state.routedNotesByPad.size > 0) {
      sendLoopControlChange(74, event.value7, 1);
    }
    return;
  }

  const outputChannels = listOutputChannelsForInputChannel(
    Array.from(ext.state.routedNotesByPad.values()),
    event.channel,
  );
  outputChannels.forEach((outputChannel) => {
    sendLoopControlChange(74, event.value7, outputChannel);
  });
}

function handlePitchBend(msg) {
  const channel = getChannel(msg);
  const value14 = getPitchBend14(msg);
  const scaled14 = scalePitchBendForConfig(value14);

  if (!shouldForwardPitchBendOnChannel(channel)) {
    return;
  }

  if (!isMpeModeEnabled()) {
    if (shouldSuppressNonMpePitchBend()) {
      sendLoopPitchBend14(8192, 1);
      return;
    }
    sendLoopPitchBend14(scaled14, 1);
    return;
  }

  const outputChannels = listOutputChannelsForInputChannel(
    Array.from(ext.state.routedNotesByPad.values()),
    channel,
  );
  outputChannels.forEach((outputChannel) => {
    sendLoopPitchBend14(scaled14, outputChannel);
  });
}

function findRoutedEntryBySourceKey(sourceKey) {
  if (!sourceKey) {
    return null;
  }
  for (const [coord, routed] of ext.state.routedNotesByPad.entries()) {
    const key = noteKey(getRoutedInputChannel(routed), routed.sourceNoteNumber);
    if (key === sourceKey) {
      return { coord, routed };
    }
  }
  return null;
}

function extractRawControlChangeEvent(msg) {
  const controller = msg?.controller?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(controller)) {
    return null;
  }

  const rawValue = msg?.rawValue ?? msg?.value ?? msg?.dataBytes?.[1];
  const value7 = typeof rawValue === "number" && rawValue >= 0 && rawValue <= 1
    ? clampInt(Math.round(rawValue * 127), 0, 127, 0)
    : clampInt(rawValue, 0, 127, 0);

  return {
    controller,
    channel: getChannel(msg),
    value7,
  };
}

function shouldSuppressNonMpePitchBend() {
  return !isMpeModeEnabled() && ext.state.routedNotesByPad.size > 1;
}

function finalizeRoutedNoteOff(coord, velocity) {
  const routed = ext.state.routedNotesByPad.get(coord);
  if (!routed) {
    return false;
  }

  const sourceChannel = getRoutedInputChannel(routed);
  const sourceKey = noteKey(sourceChannel, routed.sourceNoteNumber);

  sendLoopNoteOff(routed.note, velocity, routed.channel);
  ext.state.routedNotesByPad.delete(coord);
  if (isMpeModeEnabled()) {
    releaseMpeVoice(ext.state.mpeVoices, sourceKey);
  }
  refreshDetectedChord();
  const remainingOnOutputChannel = Array.from(ext.state.routedNotesByPad.values()).find(
    (entry) => entry.channel === routed.channel,
  );
  if (!remainingOnOutputChannel) {
    sendLoopPitchBend14(8192, routed.channel);
  }
  refreshSameOutputNoteHighlights(routed.note);
  refreshInstrumentSameOutputNoteHighlights(routed.note);
  return true;
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

function resolvePadCoord(noteNumber, channel) {
  return resolveNoOverlapPadCoordCore(noteNumber, channel, {
    columns: ext.config.linnStrumentSize / 8,
    rows: 8,
    assumeRowChannels: true,
    columnPhase: 0,
    perRowLowestChannel: 1,
    rowChannelOrderReversed: false,
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
  ext.state.lastPitchBend14ByChannel.set(channel, bend);
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
    sendLoopControlChange(1, 0, channel);
    sendLoopPitchBend14(8192, channel);
  }
  ext.state.activeLoopNotes.clear();
  ext.state.routedNotesByPad.clear();
  ext.state.lastPitchBend14ByChannel.clear();
  clearMpeVoiceAllocator(ext.state.mpeVoices);
  ext.state.detectedChordName = "";
  updateChordStatusUi();
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
  ext.state.routedNotesByPad.clear();
  ext.state.activeLoopNotes.clear();
  ext.state.lastPitchBend14ByChannel.clear();
  clearMpeVoiceAllocator(ext.state.mpeVoices);
  ext.state.detectedChordName = "";
  updateChordStatusUi();
}

function hasTransientPerformanceState() {
  return ext.state.heldPads.size > 0
    || ext.state.modPressuresByPad.size > 0
    || ext.state.modChannelsByPad.size > 0
    || ext.state.routedNotesByPad.size > 0
    || ext.state.activeLoopNotes.size > 0
    || ext.state.mpeVoices.byInputKey.size > 0
    || ext.state.lastPitchBend14ByChannel.size > 0;
}

function getGridMappingSignature() {
  return [
    ext.config.linnStrumentSize,
    ext.config.deviceStartNote,
    ext.config.deviceRowOffset,
    ext.config.deviceColOffset,
  ].join("|");
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
  updateChordStatusUi();
}

function updateRoutingStatus() {
  const inOk = Boolean(ext.midi.instrumentInput);
  const outOk = Boolean(ext.midi.loopOutput);
  const status = !inOk
    ? "No LinnStrument input"
    : outOk
      ? "Ready"
      : "No loop output";
  setText("routingStatus", status);
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
  if (coord && ext.state.heldPads.has(coord)) {
    return INSTRUMENT_COLORS.held;
  }

  const tonicPc = mod(ext.config.selectedKey ?? defaultConfig.selectedKey ?? 0, 12);
  const isTonicPlayablePad = meta.zone === "play"
    && Number.isFinite(meta.noteNumber)
    && mod(meta.noteNumber, 12) === tonicPc;

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
  if (meta.zone === "mpe") color = meta.selected ? INSTRUMENT_COLORS.mpeEnabled : INSTRUMENT_COLORS.mpeDisabled;
  if (meta.zone === "play") {
    if (!ext.config.allNotesEnabled) {
      const highlightScaleNonRootWhite = Boolean(
        ext.config.scaleModeHighlightNonRootWhite ?? defaultConfig.scaleModeHighlightNonRootWhite,
      );
      color = isTonicPlayablePad
        ? INSTRUMENT_COLORS.tonic
        : (highlightScaleNonRootWhite ? INSTRUMENT_COLORS.play : INSTRUMENT_COLORS.off);
    } else {
      color = shouldLightPlayablePad(meta)
        ? (isTonicPlayablePad ? INSTRUMENT_COLORS.tonic : INSTRUMENT_COLORS.play)
        : INSTRUMENT_COLORS.off;
    }
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
  if (!ext.state.instrumentPaintingEnabled || !out?.channels?.[1]) {
    return;
  }

  const channel = out.channels[1];
  channel.sendControlChange(20, x);
  channel.sendControlChange(21, y);
  channel.sendControlChange(22, color);
}

async function setLinnStrumentParamValue(paramNumber, value) {
  const output = ext.midi.instrumentOutput;
  if (!output) {
    throw new Error("Missing LinnStrument output");
  }
  output.sendNrpnValue(nrpn(paramNumber), nrpn(value), { channels: 1 });
  await sleep(24);
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
    `State (${trigger}): tonic=${tonic}, scale=${mode.name}, allNotes=${ext.config.allNotesEnabled ? "on" : "off"}, mpe=${isMpeModeEnabled() ? "on" : "off"}, octave=${octave}, layoutOffset=${getActiveLayoutRowOffset()} (scale=${ext.config.layoutRowOffsetScale}, all=${ext.config.layoutRowOffsetAllNotes}), deviceOffset=${ext.config.deviceRowOffset}`,
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

function shouldLightPlayablePad(meta) {
  return shouldLightPlayablePadCore(meta, ext.config.allNotesEnabled);
}

function isMpeModeEnabled() {
  return isMpeModeEnabledCore(ext.config, defaultConfig);
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
  return shouldForwardPitchBendForInputChannel({
    inputChannel: channel,
    routedEntries: Array.from(ext.state.routedNotesByPad.values()),
  });
}

function setValue(id, value) {
  const el = document.getElementById(id);
  if (el) {
    el.value = String(value ?? "");
  }
}

function setChecked(id, checked) {
  const el = document.getElementById(id);
  if (el && "checked" in el) {
    el.checked = Boolean(checked);
  }
}

function getValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

function getChecked(id) {
  const el = document.getElementById(id);
  if (!el || !("checked" in el)) {
    return null;
  }
  return Boolean(el.checked);
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

ext.fn = {
  rebuildLayout,
  connectMidiFromConfig,
  allNotesOff,
};
