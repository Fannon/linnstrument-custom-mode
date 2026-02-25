export const STORAGE_KEY = "linnstrumentCustomModeConfig";

export const defaultConfig = {
  presetId: "scale-mode-basic-v1",
  instrumentInputPort: "",
  instrumentOutputPort: "",
  loopOutputPort: "",
  linnStrumentSize: 128,
  deviceStartNote: 30,
  deviceRowOffset: 5,
  deviceColOffset: 1,
  assumeRowChannels: true,
  layoutRowOffset: 4,
  pitchSlideSemitonesPerPad: 1,
  outputPitchBendRangeSemitones: 2,
  baseRootC: 36,
  selectedKey: 0,
  selectedModeId: "major",
};

export function initConfig() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...defaultConfig };
  }

  try {
    return {
      ...defaultConfig,
      ...JSON.parse(raw),
    };
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
