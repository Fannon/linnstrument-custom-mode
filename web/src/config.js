import { MODES } from "./core-logic.js";

export const STORAGE_KEY = "linnstrumentCustomModeConfig";
const MODE_IDS = new Set(MODES.map((mode) => mode.id));

export const defaultConfig = {
  presetId: "scale-mode-basic-v1",
  instrumentInputPort: "",
  instrumentOutputPort: "",
  loopOutputPort: "",
  loopInputPort: "",
  portSelectionLocked: false,
  linnStrumentSize: 128,
  deviceStartNote: 0,
  deviceRowOffset: 5,
  deviceColOffset: 1,
  layoutRowOffsetScale: 4,
  layoutRowOffsetAllNotes: 5,
  pitchSlideSemitonesPerPadStandard: 1,
  pitchSlideSemitonesPerPadMech: 2,
  outputPitchBendRangeSemitones: 48,
  mpeEnabled: true,
  colorModWheel: 2,
  colorRootNote: 4,
  colorScaleNote: 8,
  colorNonScaleNote: 7,
  baseRootC: 36,
  selectedKey: 0,
  selectedModeId: "major",
  allNotesEnabled: false,
};

export function initConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...defaultConfig };
  }

  try {
    const parsed = JSON.parse(raw) || {};
    const next = {};
    Object.keys(defaultConfig).forEach((key) => {
      next[key] = Object.hasOwn(parsed, key) ? parsed[key] : defaultConfig[key];
    });
    next.selectedModeId = MODE_IDS.has(next.selectedModeId) ? next.selectedModeId : defaultConfig.selectedModeId;
    return next;
  } catch (err) {
    console.warn("Ignoring invalid stored config", err);
    return { ...defaultConfig };
  }
}

export function persistConfig(config) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearPersistedConfig() {
  localStorage.removeItem(STORAGE_KEY);
}
