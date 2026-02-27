import { createDefaultUserFirmwareAxesByRow } from "./user-firmware-settings.js";

export const STORAGE_KEY = "linnstrumentCustomModeConfig";

export const defaultConfig = {
  presetId: "scale-mode-basic-v1",
  instrumentInputPort: "",
  instrumentOutputPort: "",
  loopOutputPort: "",
  linnStrumentSize: 128,
  linnStrumentInputProtocol: "user-firmware",
  deviceStartNote: 30,
  deviceRowOffset: 5,
  deviceColOffset: 1,
  assumeRowChannels: true,
  layoutRowOffsetScale: 4,
  layoutRowOffsetAllNotes: 5,
  pitchSlideSemitonesPerPad: 1,
  outputPitchBendRangeSemitones: 2,
  assumeDefaultUserFirmwareSwitchMapping: true,
  userFirmwareDecimationMs: 0,
  userFirmwareAxesByRow: createDefaultUserFirmwareAxesByRow(),
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
    const parsed = JSON.parse(raw);
    const legacyLayoutRowOffset = Number.parseInt(parsed?.layoutRowOffset, 10);
    return {
      ...defaultConfig,
      ...parsed,
      layoutRowOffsetScale: Number.isFinite(Number(parsed?.layoutRowOffsetScale))
        ? parsed.layoutRowOffsetScale
        : Number.isFinite(legacyLayoutRowOffset)
          ? legacyLayoutRowOffset
          : defaultConfig.layoutRowOffsetScale,
      layoutRowOffsetAllNotes: Number.isFinite(Number(parsed?.layoutRowOffsetAllNotes))
        ? parsed.layoutRowOffsetAllNotes
        : defaultConfig.layoutRowOffsetAllNotes,
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
