export const USER_FIRMWARE_ROW_COUNT = 8;
export const USER_FIRMWARE_AXIS_DEFAULTS = Object.freeze({
  x: true,
  y: false,
  z: true,
});

export function createDefaultUserFirmwareAxesByRow() {
  return Array.from({ length: USER_FIRMWARE_ROW_COUNT }, () => ({
    x: USER_FIRMWARE_AXIS_DEFAULTS.x,
    y: USER_FIRMWARE_AXIS_DEFAULTS.y,
    z: USER_FIRMWARE_AXIS_DEFAULTS.z,
  }));
}

export function normalizeUserFirmwareAxesByRow(value) {
  const defaults = createDefaultUserFirmwareAxesByRow();
  if (!Array.isArray(value)) {
    return defaults;
  }

  return defaults.map((fallback, index) => {
    const row = value[index];
    if (!row || typeof row !== "object") {
      return fallback;
    }
    return {
      x: Boolean(row.x),
      y: Boolean(row.y),
      z: Boolean(row.z),
    };
  });
}
