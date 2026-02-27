import { createDefaultUserFirmwareAxesByRow, normalizeUserFirmwareAxesByRow } from "./user-firmware-settings.js";
import { normalizeUserFirmwareSlideMode, USER_FIRMWARE_SLIDE_MODE_SPEC } from "./user-firmware-slide-transition.js";
import {
  normalizeUserFirmwareTimbreCc,
  normalizeUserFirmwareTimbreEnabled,
  USER_FIRMWARE_TIMBRE_CC_DEFAULT,
} from "./user-firmware-y.js";

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
  layoutRowOffsetScale: 4,
  layoutRowOffsetAllNotes: 5,
  pitchSlideSemitonesPerPad: 1,
  userFirmwareSlideMode: USER_FIRMWARE_SLIDE_MODE_SPEC,
  userFirmwareTimbreEnabled: true,
  userFirmwareTimbreCc: USER_FIRMWARE_TIMBRE_CC_DEFAULT,
  outputPitchBendRangeSemitones: 2,
  mpeEnabled: true,
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
    const {
      linnStrumentInputProtocol: _legacyProtocol,
      assumeRowChannels: _legacyAssumeRowChannels,
      userFirmwareAxesByRow: parsedUserFirmwareAxesByRow,
      ...parsedRest
    } = parsed || {};
    const legacyLayoutRowOffset = Number.parseInt(parsed?.layoutRowOffset, 10);
    return {
      ...defaultConfig,
      ...parsedRest,
      layoutRowOffsetScale: Number.isFinite(Number(parsed?.layoutRowOffsetScale))
        ? parsed.layoutRowOffsetScale
        : Number.isFinite(legacyLayoutRowOffset)
          ? legacyLayoutRowOffset
          : defaultConfig.layoutRowOffsetScale,
      layoutRowOffsetAllNotes: Number.isFinite(Number(parsed?.layoutRowOffsetAllNotes))
        ? parsed.layoutRowOffsetAllNotes
        : defaultConfig.layoutRowOffsetAllNotes,
      userFirmwareSlideMode: normalizeUserFirmwareSlideMode(parsed?.userFirmwareSlideMode),
      userFirmwareTimbreEnabled: normalizeUserFirmwareTimbreEnabled(
        parsed?.userFirmwareTimbreEnabled,
        defaultConfig.userFirmwareTimbreEnabled,
      ),
      userFirmwareTimbreCc: normalizeUserFirmwareTimbreCc(
        parsed?.userFirmwareTimbreCc,
        defaultConfig.userFirmwareTimbreCc,
      ),
      userFirmwareAxesByRow: normalizeUserFirmwareAxesByRow(parsedUserFirmwareAxesByRow),
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
