import { log } from "./log.js";
import { initConfig, persistConfig, clearPersistedConfig, defaultConfig } from "./config.js";
import { resetGrid, getGridDict, generateGrid, drawGrid, coordKey } from "./grid.js";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const MODES = [
  { id: "major", name: "Major", short: "Maj", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor", short: "Min", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major-pent", name: "Major Pentatonic", short: "MajP", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pent", name: "Minor Pentatonic", short: "MinP", intervals: [0, 3, 5, 7, 10] },
  { id: "dorian", name: "Dorian", short: "Dor", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "Mixolydian", short: "Mix", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "lydian", name: "Lydian", short: "Lyd", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "phrygian", name: "Phrygian", short: "Phr", intervals: [0, 1, 3, 5, 7, 8, 10] },
];

const PRESETS = [
  {
    id: "scale-mode-basic-v1",
    name: "Scale Mode (Mod row + Key/Mode rows)",
    description: "Bottom row sends modwheel from pressure. Next rows select key and mode. Upper rows output scale-only notes.",
    playableRowsStart: 3,
  },
];

const PRESET_BY_ID = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]));
const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));

const INSTRUMENT_COLORS = {
  off: 0,
  mod: 5,
  key: 4,
  mode: 10,
  disabled: 0,
  play: 3,
  tonic: 9,
  selected: 8,
};

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
  populateUiFromConfig();
  refreshPortSelectors({ autoSelectInstrument: true });

  await connectMidiFromConfig();
  rebuildLayout();

  log.success("Prototype initialized.");
  log.info("Using LinnStrument row-channel mapping assumption by default (channels 1-8 = rows). Click Sync From LinnStrument to confirm.");
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
    rebuildLayout();
    log.warn("Configuration reset to defaults.");
  });

  document.getElementById("syncLinnState")?.addEventListener("click", async () => {
    await syncFromLinnStrument();
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

function populateUiFromConfig() {
  setValue("presetSelect", ext.config.presetId);
  setValue("layoutRowOffset", ext.config.layoutRowOffset);
  setValue("pitchSlideSemitonesPerPad", ext.config.pitchSlideSemitonesPerPad);
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
}

function readConfigFromUi() {
  const presetId = getValue("presetSelect") || defaultConfig.presetId;
  const layoutRowOffset = clampInt(getValue("layoutRowOffset"), 1, 12, defaultConfig.layoutRowOffset);
  const pitchSlideSemitonesPerPad = parsePitchSlideSetting(
    getValue("pitchSlideSemitonesPerPad"),
    defaultConfig.pitchSlideSemitonesPerPad,
  );
  const deviceStartNote = clampInt(getValue("deviceStartNote"), 0, 127, defaultConfig.deviceStartNote);
  const deviceRowOffset = clampInt(getValue("deviceRowOffset"), 0, 24, defaultConfig.deviceRowOffset);

  ext.config = {
    ...ext.config,
    presetId,
    layoutRowOffset,
    pitchSlideSemitonesPerPad,
    deviceStartNote,
    deviceRowOffset,
    instrumentInputPort: getValue("instrumentInputPort") || "",
    instrumentOutputPort: getValue("instrumentOutputPort") || "",
    loopOutputPort: getValue("loopOutputPort") || "",
  };

  setValue("layoutRowOffset", ext.config.layoutRowOffset);
  setValue("pitchSlideSemitonesPerPad", ext.config.pitchSlideSemitonesPerPad);
  setValue("deviceStartNote", ext.config.deviceStartNote);
  setValue("deviceRowOffset", ext.config.deviceRowOffset);
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
  input.addListener("keyaftertouch", (msg) => handlePolyPressure(msg));
  input.addListener("channelaftertouch", (msg) => handleChannelAftertouch(msg));
  input.addListener("pitchbend", (msg) => handlePitchBend(msg));
}

function rebuildLayout() {
  clearHeldState();
  ext.grid = generateGrid(ext.config.deviceStartNote, ext.config.deviceRowOffset, ext.config.deviceColOffset);
  ext.gridDict = getGridDict(ext.grid, ext.config.deviceStartNote);

  const layout = buildLayoutDefinition();
  ext.layout.cellMeta = layout.cellMeta;
  ext.layout.padMap = layout.padMap;

  drawGrid(ext.grid, ext.layout.cellMeta);
  paintInstrumentLayout();
  updateStatusUi();
}

function buildLayoutDefinition() {
  const cellMeta = {};
  const padMap = {};
  const columns = ext.config.linnStrumentSize / 8;
  const preset = PRESET_BY_ID[ext.config.presetId] || PRESETS[0];
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  const rootPc = ext.config.selectedKey % 12;
  const rootMidi = ext.config.baseRootC + rootPc;

  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < 8; y++) {
      const key = coordKey(x, y);
      const meta = { zone: "disabled", label: "", subLabel: "", disabled: true };
      let pad = { role: "disabled" };

      if (y === 0) {
        meta.zone = "mod";
        meta.label = x === 0 ? "MW" : "";
        meta.subLabel = x === 0 ? "CC1" : "";
        meta.disabled = false;
        pad = { role: "mod" };
      } else if (y === 1) {
        if (x < 12) {
          meta.zone = "key";
          meta.label = NOTE_NAMES[x];
          meta.subLabel = "key";
          meta.disabled = false;
          meta.selected = ext.config.selectedKey === x;
          pad = { role: "key-select", keyPc: x };
        } else {
          meta.zone = "disabled";
          meta.label = "";
          meta.subLabel = "";
        }
      } else if (y === 2) {
        if (x < MODES.length) {
          const rowMode = MODES[x];
          meta.zone = "mode";
          meta.label = rowMode.short;
          meta.subLabel = "mode";
          meta.disabled = false;
          meta.selected = ext.config.selectedModeId === rowMode.id;
          pad = { role: "mode-select", modeId: rowMode.id };
        } else {
          meta.zone = "disabled";
          meta.label = "";
          meta.subLabel = "";
        }
      } else if (y >= preset.playableRowsStart) {
        const degreeIndex = x + (y - preset.playableRowsStart) * ext.config.layoutRowOffset;
        const mappedNote = scaleNoteAt(rootMidi, mode, degreeIndex);
        const pc = mappedNote % 12;
        const octave = Math.floor(mappedNote / 12) - 1;

        meta.zone = "play";
        meta.label = NOTE_NAMES[pc];
        meta.subLabel = `o${octave}`;
        meta.disabled = false;
        meta.tonic = pc === rootPc;
        meta.noteNumber = mappedNote;
        pad = { role: "play-note", outNote: mappedNote };
      }

      cellMeta[key] = meta;
      padMap[key] = pad;
    }
  }

  return { cellMeta, padMap };
}

function handleNoteOn(msg) {
  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  setPadHeld(event.coord, true);

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  switch (pad.role) {
    case "mod": {
      setModPressure(event.coord, event.velocity, event.channel);
      break;
    }
    case "key-select": {
      ext.config.selectedKey = pad.keyPc;
      persistConfig(ext.config);
      rebuildLayout();
      flashSelection(event.coord);
      log.info(`Key changed to ${NOTE_NAMES[ext.config.selectedKey]}`);
      break;
    }
    case "mode-select": {
      ext.config.selectedModeId = pad.modeId;
      persistConfig(ext.config);
      rebuildLayout();
      flashSelection(event.coord);
      log.info(`Mode changed to ${MODE_BY_ID[ext.config.selectedModeId]?.name || pad.modeId}`);
      break;
    }
    case "play-note": {
      ext.state.routedNotesByPad.set(event.coord, { note: pad.outNote, channel: event.channel });
      sendLoopNoteOn(pad.outNote, event.velocity, event.channel);
      break;
    }
    default:
      break;
  }
}

function handleNoteOff(msg) {
  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  setPadHeld(event.coord, false);

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (pad.role === "mod") {
    clearModPressure(event.coord, event.channel);
    return;
  }

  const routed = ext.state.routedNotesByPad.get(event.coord);
  if (routed) {
    sendLoopNoteOff(routed.note, event.velocity, routed.channel);
    ext.state.routedNotesByPad.delete(event.coord);
  }
}

function handlePolyPressure(msg) {
  const event = normalizeTouchEvent(msg);
  if (!event) {
    return;
  }

  const pad = ext.layout.padMap[event.coord] || { role: "disabled" };
  if (pad.role === "mod") {
    setModPressure(event.coord, msg.rawValue ?? event.velocity, event.channel);
    return;
  }

  if (pad.role === "play-note") {
    sendLoopPolyAftertouch(pad.outNote, msg.rawValue ?? 0, event.channel);
  }
}

function handleChannelAftertouch(msg) {
  const channel = getChannel(msg);
  const value = msg.rawValue ?? 0;

  const hasHeldPlayableOnChannel = Array.from(ext.state.routedNotesByPad.values()).some(
    (entry) => entry.channel === channel,
  );

  if (hasHeldPlayableOnChannel) {
    sendLoopChannelAftertouch(value, channel);
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
  const noteNumber = msg?.note?.number ?? msg?.dataBytes?.[0];
  if (!Number.isFinite(noteNumber)) {
    return null;
  }

  const channel = getChannel(msg);
  const velocity = msg.rawVelocity ?? msg.rawValue ?? 0;
  const coord = resolvePadCoord(noteNumber, channel);
  if (!coord) {
    return null;
  }

  return {
    noteNumber,
    channel,
    velocity,
    coord,
  };
}

function resolvePadCoord(noteNumber, channel) {
  const columns = ext.config.linnStrumentSize / 8;

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
}

function flashSelection(coord) {
  const el = document.getElementById(`cell-${coord}`);
  if (!el) {
    return;
  }

  el.classList.add("cell-selected-live");
  setTimeout(() => el.classList.remove("cell-selected-live"), 220);
}

function refreshHeldCellClasses() {
  ext.state.heldPads.forEach((coord) => {
    const el = document.getElementById(`cell-${coord}`);
    if (el) {
      el.classList.add("cell-held");
    }
  });
}

function setModPressure(coord, value, channel = 1) {
  ext.state.modPressuresByPad.set(coord, clampInt(value, 0, 127, 0));
  const current = Math.max(0, ...ext.state.modPressuresByPad.values());
  sendLoopControlChange(1, current, channel || 1);
}

function clearModPressure(coord, channel = 1) {
  ext.state.modPressuresByPad.delete(coord);
  const current = ext.state.modPressuresByPad.size > 0 ? Math.max(...ext.state.modPressuresByPad.values()) : 0;
  sendLoopControlChange(1, current, channel || 1);
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
  resetGrid();
  ext.state.heldPads.clear();
  ext.state.modPressuresByPad.clear();
  ext.state.routedNotesByPad.clear();
  ext.state.activeLoopNotes.clear();
}

function updateStatusUi() {
  const mode = MODE_BY_ID[ext.config.selectedModeId] || MODES[0];
  setText("selectedKeyDisplay", NOTE_NAMES[ext.config.selectedKey % 12]);
  setText("selectedModeDisplay", mode.name);
  setText(
    "inputAssumptionDisplay",
    ext.config.assumeRowChannels
      ? ext.state.sync.rowChannelOrderReversed
        ? `Rows on MIDI ch ${((ext.state.sync.perRowLowestChannel ?? 1) + 7)}-${(ext.state.sync.perRowLowestChannel ?? 1)}`
        : `Rows on MIDI ch ${(ext.state.sync.perRowLowestChannel ?? 1)}-${((ext.state.sync.perRowLowestChannel ?? 1) + 7)}`
      : "Fallback note-only mapping",
  );
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
      let color = INSTRUMENT_COLORS.disabled;

      if (meta.zone === "mod") color = INSTRUMENT_COLORS.mod;
      if (meta.zone === "key") color = meta.selected ? INSTRUMENT_COLORS.selected : INSTRUMENT_COLORS.key;
      if (meta.zone === "mode") color = meta.selected ? INSTRUMENT_COLORS.selected : INSTRUMENT_COLORS.mode;
      if (meta.zone === "play") color = meta.tonic ? INSTRUMENT_COLORS.tonic : INSTRUMENT_COLORS.play;
      if (meta.zone === "disabled") color = INSTRUMENT_COLORS.off;

      highlightInstrumentXY(x, y, color);
    }
  }
}

export function highlightInstrumentXY(x, y, color) {
  const out = ext.midi.instrumentOutput;
  if (!out?.channels?.[1]) {
    return;
  }

  const channel = out.channels[1];
  channel.sendControlChange(20, x);
  channel.sendControlChange(21, y);
  channel.sendControlChange(22, color);
}

async function syncFromLinnStrument() {
  if (!ext.midi.instrumentInput || !ext.midi.instrumentOutput) {
    log.warn("Select LinnStrument input and output first.");
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
  const timeout = 350;
  return promiseTimeout(
    timeout,
    new Promise((resolve, reject) => {
      let settled = false;
      const input = ext.midi.instrumentInput;
      const output = ext.midi.instrumentOutput;
      if (!input || !output) {
        reject(new Error("Missing LinnStrument input/output"));
        return;
      }

      input.channels[1].addListener(
        "nrpn",
        (msg) => {
          if (settled) {
            return;
          }
          if (msg.message.dataBytes[0] === 38) {
            settled = true;
            resolve(msg.message.dataBytes[1]);
          }
        },
        { duration: timeout },
      );

      try {
        output.sendNrpnValue(nrpn(299), nrpn(paramNumber), { channels: 1 });
      } catch (err) {
        settled = true;
        reject(err);
      }
    }),
  );
}

function nrpn(value) {
  const msb = value >> 7;
  const lsb = value & 0x7f;
  return [msb, lsb];
}

function scaleNoteAt(rootMidi, mode, degreeIndex) {
  if (!mode || !mode.intervals?.length) {
    return rootMidi;
  }

  const degreeCount = mode.intervals.length;
  const octaveOffset = Math.floor(degreeIndex / degreeCount);
  const degreeInMode = mod(degreeIndex, degreeCount);
  const note = rootMidi + octaveOffset * 12 + mode.intervals[degreeInMode];
  return clampInt(note, 0, 127, rootMidi);
}

function noteKey(channel, noteNumber) {
  return `${channel}:${noteNumber}`;
}

function getChannel(msg) {
  return msg?.message?.channel ?? msg?.channel ?? 1;
}

function getPitchBend14(msg) {
  const dataBytes = msg?.dataBytes;
  if (dataBytes && dataBytes.length >= 2) {
    return ((dataBytes[1] & 0x7f) << 7) | (dataBytes[0] & 0x7f);
  }

  if (Number.isFinite(msg?.rawValue)) {
    const rawValue = Number(msg.rawValue);
    if (rawValue >= 0 && rawValue <= 16383) {
      return Math.round(rawValue);
    }
    if (rawValue >= -8192 && rawValue <= 8191) {
      return Math.round(rawValue + 8192);
    }
  }

  if (typeof msg?.value === "number") {
    return clampInt(Math.round(((msg.value + 1) / 2) * 16383), 0, 16383, 8192);
  }

  return 8192;
}

function scalePitchBendForConfig(value14) {
  const center = 8192;
  const factor = Number(ext.config.pitchSlideSemitonesPerPad) || 1;
  const delta = value14 - center;
  return clampInt(Math.round(center + delta * factor), 0, 16383, center);
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
  const lowestChannel = ext.state.sync.perRowLowestChannel ?? 1;
  const rowIndex = channel - lowestChannel;
  if (rowIndex < 0 || rowIndex > 7) {
    return null;
  }
  return ext.state.sync.rowChannelOrderReversed ? 7 - rowIndex : rowIndex;
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

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

function parsePitchSlideSetting(value, fallback = 1) {
  const n = Number.parseFloat(value);
  if (n === 0.5 || n === 1 || n === 2) {
    return n;
  }
  return fallback;
}

function mod(n, m) {
  return ((n % m) + m) % m;
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
