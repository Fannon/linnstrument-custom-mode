import { clampInt } from "./core-logic.js";

export const USER_FIRMWARE_Y_CC_MIN = 64;
export const USER_FIRMWARE_Y_CC_MAX = 89;
export const USER_FIRMWARE_TIMBRE_CC_DEFAULT = 74;

export function decodeUserFirmwareYControlChange(event) {
  if (!event || !Number.isFinite(event.controller)) {
    return null;
  }
  if (event.controller < USER_FIRMWARE_Y_CC_MIN || event.controller > USER_FIRMWARE_Y_CC_MAX) {
    return null;
  }
  return {
    column: event.controller - USER_FIRMWARE_Y_CC_MIN,
    value7: clampInt(event.value7, 0, 127, 0),
  };
}

export function normalizeUserFirmwareTimbreCc(value, fallback = USER_FIRMWARE_TIMBRE_CC_DEFAULT) {
  return clampInt(value, 0, 127, clampInt(fallback, 0, 127, USER_FIRMWARE_TIMBRE_CC_DEFAULT));
}

export function normalizeUserFirmwareTimbreEnabled(value, fallback = true) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1" || value === 1) {
    return true;
  }
  if (value === "false" || value === "0" || value === 0) {
    return false;
  }
  return Boolean(fallback);
}
