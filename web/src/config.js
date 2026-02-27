import { MODES } from "./core-logic.js";

export const STORAGE_KEY = "linnstrumentCustomModeConfig";
const MODE_IDS = new Set(MODES.map((mode) => mode.id));

export const defaultConfig = {
  presetId: "scale-mode-basic-v1",
  instrumentInputPort: "",
  instrumentOutputPort: "",
  loopOutputPort: "",
  linnStrumentSize: 128,
  deviceStartNote: 0,
  deviceRowOffset: 5,
  deviceColOffset: 1,
  layoutRowOffsetScale: 4,
  layoutRowOffsetAllNotes: 5,
  pitchSlideSemitonesPerPad: 1,
  outputPitchBendRangeSemitones: 2,
  mpeEnabled: true,
  scaleModeHighlightNonRootWhite: false,
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
    const {
      linnStrumentInputProtocol: _legacyProtocol,
      assumeRowChannels: _legacyAssumeRowChannels,
      userFirmwareSlideMode: _legacyUserFirmwareSlideMode,
      userFirmwareSlideModeExplicit: _legacyUserFirmwareSlideModeExplicit,
      userFirmwareTimbreEnabled: _legacyUserFirmwareTimbreEnabled,
      userFirmwareTimbreCc: _legacyUserFirmwareTimbreCc,
      userFirmwarePitchBendSmoothingEnabled: _legacyUserFirmwarePitchBendSmoothingEnabled,
      userFirmwarePitchBendSmoothingStep14: _legacyUserFirmwarePitchBendSmoothingStep14,
      assumeDefaultUserFirmwareSwitchMapping: _legacyAssumeDefaultUserFirmwareSwitchMapping,
      userFirmwareDecimationMs: _legacyUserFirmwareDecimationMs,
      userFirmwareAxesByRow: _legacyUserFirmwareAxesByRow,
      ...parsedRest
    } = parsed || {};
    const legacyLayoutRowOffset = Number.parseInt(parsed?.layoutRowOffset, 10);
    return {
      ...defaultConfig,
      ...parsedRest,
      selectedModeId: MODE_IDS.has(parsedRest?.selectedModeId)
        ? parsedRest.selectedModeId
        : defaultConfig.selectedModeId,
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
