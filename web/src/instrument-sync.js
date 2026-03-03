import {
  CONTROL_MODE_LAYOUT,
  FACTORY_DEFAULT_LAYOUT,
  NRPN,
  sleep,
  setLinnStrumentParamValue,
  applyLinnStrumentStandardLayout,
  applyLinnStrumentMpeInputMode,
  loadLinnStrumentPreset,
  sweepLinnStrumentLightsOff,
} from "./linnstrument-helper.js";

export {
  CONTROL_MODE_LAYOUT,
  FACTORY_DEFAULT_LAYOUT,
  NRPN,
  sleep,
  setLinnStrumentParamValue,
  applyLinnStrumentStandardLayout,
  applyLinnStrumentMpeInputMode,
  loadLinnStrumentPreset,
  sweepLinnStrumentLightsOff,
};

const DEFAULT_NRPN_PARAM_DELAY_MS = 30;
const STANDARD_LAYOUT_STAGE_DELAY_MS = 20;

function clampDelayMs(value, fallback, min = 0, max = 2000) {
  const numeric = Number.parseInt(value, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

function resolveTimingOptions(options = {}) {
  return {
    paramDelayMs: clampDelayMs(options.paramDelayMs, DEFAULT_NRPN_PARAM_DELAY_MS),
    applyControlModeToRightSplit: Boolean(options.applyControlModeToRightSplit),
  };
}

export async function exitLinnStrument(output, targetPreset = 1, options = {}) {
  const timing = resolveTimingOptions(options);
  const shouldSweepLights = options?.sweepLights === true;

  // Optional LED clear for explicit restore debugging.
  if (shouldSweepLights) {
    await sweepLinnStrumentLightsOff(output);
    await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  }

  await setLinnStrumentParamValue(output, NRPN.DEVICE_USER_FIRMWARE_MODE, 0, timing);
  await sleep(STANDARD_LAYOUT_STAGE_DELAY_MS);
  await loadLinnStrumentPreset(output, targetPreset, { ...timing, bounceUserFirmware: false });
}
