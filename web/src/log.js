export const log = {
  info(msg) {
    appendLogEntry("info", msg);
  },
  success(msg) {
    appendLogEntry("success", msg);
  },
  warn(msg) {
    console.warn(msg);
    appendLogEntry("warn", msg);
  },
  error(msg) {
    console.error(msg);
    appendLogEntry("error", msg);
  },
  activeState({
    trigger = "state",
    tonic = "-",
    scale = "-",
    allNotesEnabled = false,
    mpeEnabled = false,
    octave = 0,
    activeLayoutRowOffset = 0,
    layoutRowOffsetScale = 0,
    layoutRowOffsetAllNotes = 0,
    deviceRowOffset = 0,
  } = {}) {
    appendLogEntry(
      "info",
      `State (${trigger}): tonic=${tonic}, scale=${scale}, allNotes=${allNotesEnabled ? "on" : "off"}, mpe=${mpeEnabled ? "on" : "off"}, octave=${octave}, layoutOffset=${activeLayoutRowOffset} (scale=${layoutRowOffsetScale}, all=${layoutRowOffsetAllNotes}), deviceOffset=${deviceRowOffset}`,
    );
  },
};

export function logActiveState(state = {}) {
  log.activeState(state);
}

function appendLogEntry(level, msg) {
  const container = document.getElementById("log");
  if (!container) {
    return;
  }

  const logEntry = document.createElement("div");
  logEntry.className = `log-entry log-${level}`;

  const timeEl = document.createElement("small");
  timeEl.className = "text-muted";
  timeEl.textContent = getTime();

  const spacer = document.createTextNode(" ");

  const messageEl = document.createElement("span");
  messageEl.className = "msg";
  messageEl.textContent = String(msg ?? "");

  logEntry.appendChild(timeEl);
  logEntry.appendChild(spacer);
  logEntry.appendChild(messageEl);
  container.prepend(logEntry);
}

function getTime() {
  return new Date().toISOString().split("T")[1].split(".")[0];
}
