export const USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS = Object.freeze({
  split: 2,
  switch1: 3,
  switch2: 4,
  exit: 7,
});

export function resolveUserFirmwareControlStripCommand(noteNumber, channel, options = {}) {
  const {
    userFirmwareModeEnabled = false,
    assumeDefaultSwitchMapping = true,
    rows = USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS,
  } = options;

  if (!userFirmwareModeEnabled) {
    return null;
  }
  if (!Number.isFinite(noteNumber) || !Number.isFinite(channel) || noteNumber !== 0) {
    return null;
  }

  if (channel === rows.split) {
    return "overlay";
  }
  if (channel === rows.exit) {
    return "exit-user-firmware";
  }
  if (!assumeDefaultSwitchMapping) {
    return null;
  }
  if (channel === rows.switch1) {
    return "octave-down";
  }
  if (channel === rows.switch2) {
    return "octave-up";
  }
  return null;
}
