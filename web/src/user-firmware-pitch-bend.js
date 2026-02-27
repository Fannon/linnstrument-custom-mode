export const USER_FIRMWARE_PITCH_BEND_SMOOTHING_STEP_14_DEFAULT = 256;

export function normalizeUserFirmwarePitchBendSmoothingEnabled(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 0 || value === 1) {
    return Boolean(value);
  }
  return Boolean(fallback);
}

export function normalizeUserFirmwarePitchBendSmoothingStep14(
  value,
  fallback = USER_FIRMWARE_PITCH_BEND_SMOOTHING_STEP_14_DEFAULT,
) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed < 1) {
    return 1;
  }
  if (parsed > 16383) {
    return 16383;
  }
  return parsed;
}

export function applyUserFirmwarePitchBendSmoothing14(target14, previous14, options = {}) {
  const target = clampInt(target14, 0, 16383, 8192);
  const enabled = normalizeUserFirmwarePitchBendSmoothingEnabled(
    options.enabled,
    false,
  );
  if (!enabled || !Number.isFinite(previous14)) {
    return target;
  }

  const maxStep14 = normalizeUserFirmwarePitchBendSmoothingStep14(
    options.maxStep14,
    USER_FIRMWARE_PITCH_BEND_SMOOTHING_STEP_14_DEFAULT,
  );
  const delta = target - previous14;
  if (Math.abs(delta) <= maxStep14) {
    return target;
  }
  return clampInt(previous14 + Math.sign(delta) * maxStep14, 0, 16383, target);
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) {
    return fallback;
  }
  if (num < min) {
    return min;
  }
  if (num > max) {
    return max;
  }
  return num;
}
