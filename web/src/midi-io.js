export const DEFAULT_HIDDEN_MIDI_PORT_NAMES = new Set(["midinous clock port", "touchosc bridge"]);

export function isHiddenMidiPortName(name, hiddenNames = DEFAULT_HIDDEN_MIDI_PORT_NAMES) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  return normalized ? hiddenNames.has(normalized) : false;
}

export function sanitizeSelectedPortName(name, hiddenNames = DEFAULT_HIDDEN_MIDI_PORT_NAMES) {
  return isHiddenMidiPortName(name, hiddenNames) ? "" : String(name || "").trim();
}

export function listVisiblePortNames(ports, hiddenNames = DEFAULT_HIDDEN_MIDI_PORT_NAMES) {
  return (Array.isArray(ports) ? ports : [])
    .map((port) => String(port?.name || "").trim())
    .filter((name) => name && !isHiddenMidiPortName(name, hiddenNames))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

export function autoSelectLinnStrumentPorts({
  inputSelect,
  outputSelect,
  loopSelect,
  inputs,
  outputs,
  log,
  hiddenNames = DEFAULT_HIDDEN_MIDI_PORT_NAMES,
}) {
  const visibleInputs = (inputs || []).filter((port) => !isHiddenMidiPortName(port?.name, hiddenNames));
  const visibleOutputs = (outputs || []).filter((port) => !isHiddenMidiPortName(port?.name, hiddenNames));
  const detectedInput = visibleInputs.find((port) => /linnstrument/i.test(port.name));
  const detectedOutput = visibleOutputs.find((port) => /linnstrument/i.test(port.name));

  if (inputSelect && !inputSelect.value && detectedInput) {
    inputSelect.value = detectedInput.name;
    log?.info?.(`Auto-detected LinnStrument input: ${detectedInput.name}`);
  }

  if (outputSelect && !outputSelect.value && detectedOutput) {
    outputSelect.value = detectedOutput.name;
    log?.info?.(`Auto-detected LinnStrument output: ${detectedOutput.name}`);
  }

  if (loopSelect && !loopSelect.value) {
    const preferredLoop =
      visibleOutputs.find((port) => /^LinnStrument Custom$/i.test(port.name)) ||
      visibleOutputs.find((port) => /^loopMIDI Port$/i.test(port.name)) ||
      visibleOutputs.find((port) => /loopmidi/i.test(port.name));
    const firstLoop = preferredLoop || visibleOutputs.find((port) => !/linnstrument/i.test(port.name));
    if (firstLoop) {
      loopSelect.value = firstLoop.name;
      log?.info?.(`Preselected loop output candidate: ${firstLoop.name}`);
    }
  }
}

export function isPotentialFeedbackInput(inputName, loopOutputName) {
  if (!inputName || !loopOutputName) {
    return false;
  }
  return String(inputName).trim().toLowerCase() === String(loopOutputName).trim().toLowerCase();
}

export function detachMidiInputListeners(input, warningLabel = "listeners") {
  if (!input) {
    return;
  }
  try {
    input.removeListener();
  } catch (err) {
    console.warn(`Failed to detach ${warningLabel}`, err);
  }
}

export function attachInstrumentInputListeners(input, handlers) {
  if (!input || !handlers) {
    return;
  }
  const {
    handleNoteOn,
    handleNoteOff,
    handleControlChange,
    handlePolyPressure,
    handleChannelAftertouch,
    handlePitchBend,
    withInputSource,
  } = handlers;
  input.addListener("noteon", (msg) => {
    console.debug("[midi-io] rx instrument noteon", msg);
    handleNoteOn(withInputSource(msg, "instrument"));
  });
  input.addListener("noteoff", (msg) => {
    console.debug("[midi-io] rx instrument noteoff", msg);
    handleNoteOff(withInputSource(msg, "instrument"));
  });
  input.addListener("controlchange", (msg) => {
    console.debug("[midi-io] rx instrument controlchange", msg);
    handleControlChange(withInputSource(msg, "instrument"));
  });
  input.addListener("keyaftertouch", (msg) => {
    console.debug("[midi-io] rx instrument keyaftertouch (poly pressure)", msg);
    handlePolyPressure(withInputSource(msg, "instrument"));
  });
  input.addListener("channelaftertouch", (msg) => {
    console.debug("[midi-io] rx instrument channelaftertouch", msg);
    handleChannelAftertouch(withInputSource(msg, "instrument"));
  });
  input.addListener("pitchbend", (msg) => {
    console.debug("[midi-io] rx instrument pitchbend", msg);
    handlePitchBend(withInputSource(msg, "instrument"));
  });
}

export function attachLoopInputListeners(input, handlers) {
  if (!input || !handlers) {
    return;
  }
  const { handleBackchannelNoteOn, handleBackchannelNoteOff, handleBackchannelControlChange } = handlers;
  input.addListener("noteon", (msg) => handleBackchannelNoteOn(msg));
  input.addListener("noteoff", (msg) => handleBackchannelNoteOff(msg));
  input.addListener("controlchange", (msg) => handleBackchannelControlChange(msg));
}
