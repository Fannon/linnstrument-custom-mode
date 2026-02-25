import { highlightInstrumentXY } from "./main.js";

export function generateGrid(startNoteNumber = 30, rowOffset = 5, colOffset = 1) {
  const grid = [];
  const columns = window.ext.config.linnStrumentSize / 8;

  for (let x = 0; x < columns; x++) {
    grid[x] = [];
    for (let y = 0; y <= 7; y++) {
      grid[x][y] = startNoteNumber + x * colOffset + y * rowOffset;
    }
  }

  return grid;
}

export function getGridDict(grid, startNoteNumber) {
  const gridDict = {};

  for (let note = startNoteNumber; note <= 127; note++) {
    gridDict[note] = [];
    grid.forEach((col, x) => {
      col.forEach((_row, y) => {
        if (grid[x][y] === note) {
          gridDict[note].push([x, y]);
        }
      });
    });
  }

  return gridDict;
}

export function resetGrid() {
  const columns = window.ext.config.linnStrumentSize / 8;

  for (let x = 0; x < columns; x++) {
    for (let y = 0; y <= 7; y++) {
      highlightInstrumentXY(x, y, 0);
    }
  }

  document.querySelectorAll(".cell-active, .cell-held, .cell-selected-live, .cell-same-note").forEach((el) => {
    el.classList.remove("cell-active", "cell-held", "cell-selected-live", "cell-same-note");
  });
}

export function drawGrid(grid, cellMeta = {}) {
  const surface = document.getElementById("visualization");
  if (!surface) {
    return;
  }

  surface.innerHTML = "";

  const cols = grid[0].length;
  const rows = grid.length;
  const padSize = Math.max(26, Math.floor(surface.offsetWidth / rows) - 6);

  for (let y = cols - 1; y >= 0; y--) {
    const rowEl = document.createElement("div");
    rowEl.className = "surface-row";
    rowEl.style.height = `${padSize + 6}px`;
    surface.appendChild(rowEl);

    for (let x = 0; x < rows; x++) {
      const noteNumber = grid[x][y];
      const meta = cellMeta[coordKey(x, y)] || {};
      const label = meta.label || midiNoteLabel(noteNumber);
      const subLabel = meta.subLabel || "";

      const cellEl = document.createElement("button");
      cellEl.type = "button";
      cellEl.id = `cell-${x}-${y}`;
      cellEl.className = [
        "cell",
        `note-number-${noteNumber}`,
        meta.zone ? `zone-${meta.zone}` : "",
        meta.accidental ? "cell-accidental" : "",
        meta.disabled ? "cell-disabled" : "",
        meta.tonic ? "cell-tonic" : "",
        meta.selected ? "cell-selected" : "",
      ].filter(Boolean).join(" ");
      cellEl.style.height = `${padSize}px`;
      cellEl.style.width = `${padSize}px`;
      cellEl.dataset.x = String(x);
      cellEl.dataset.y = String(y);
      cellEl.dataset.noteNumber = String(noteNumber);
      cellEl.tabIndex = -1;
      cellEl.setAttribute("aria-label", `${label}${subLabel ? ` ${subLabel}` : ""}`);

      const labelEl = document.createElement("span");
      labelEl.className = `cell-label${String(label).length > 4 ? " cell-label-small" : ""}`;
      labelEl.textContent = label;
      cellEl.appendChild(labelEl);

      if (subLabel) {
        const subLabelEl = document.createElement("span");
        subLabelEl.className = "cell-sub-label";
        subLabelEl.textContent = subLabel;
        cellEl.appendChild(subLabelEl);
      }

      rowEl.appendChild(cellEl);
    }
  }
}

export function coordKey(x, y) {
  return `${x}-${y}`;
}

function midiNoteLabel(noteNumber) {
  if (!Number.isFinite(noteNumber) || noteNumber < 0 || noteNumber > 127) {
    return "-";
  }

  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const name = names[noteNumber % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  return `${name}${octave}`;
}
