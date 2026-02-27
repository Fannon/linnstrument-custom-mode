export const USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS = Object.freeze({
  split: 2,
  switch1: 3,
  switch2: 4,
  exit: 7,
});

export const USER_FIRMWARE_SWITCH_ASSIGNMENT = Object.freeze({
  octaveDown: 0,
  octaveUp: 1,
});

export function resolveUserFirmwareControlStripCommand(noteNumber, channel, options = {}) {
  const {
    userFirmwareModeEnabled = false,
    assumeDefaultSwitchMapping = true,
    rows = USER_FIRMWARE_CONTROL_STRIP_DEFAULT_ROWS,
    switchAssignments = null,
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

  const switch1Command = resolveSwitchCommandForRow(
    "switch1",
    switchAssignments?.switch1,
    assumeDefaultSwitchMapping ? "octave-down" : null,
  );
  const switch2Command = resolveSwitchCommandForRow(
    "switch2",
    switchAssignments?.switch2,
    assumeDefaultSwitchMapping ? "octave-up" : null,
  );

  if (channel === rows.switch1) {
    return switch1Command;
  }
  if (channel === rows.switch2) {
    return switch2Command;
  }
  return null;
}

function resolveSwitchCommandForRow(_rowKey, assignment, fallbackCommand) {
  if (Number.isFinite(assignment)) {
    if (assignment === USER_FIRMWARE_SWITCH_ASSIGNMENT.octaveDown) {
      return "octave-down";
    }
    if (assignment === USER_FIRMWARE_SWITCH_ASSIGNMENT.octaveUp) {
      return "octave-up";
    }
    return null;
  }
  return fallbackCommand;
}
