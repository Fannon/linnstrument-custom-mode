import { NOTE_NAMES } from "./core-logic.js";
import { coordKey } from "./utils.js";

export { coordKey };

export function getGridMappingSignature(config = {}) {
  return [config.linnStrumentSize, config.deviceStartNote, config.deviceRowOffset, config.deviceColOffset].join("|");
}

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

export function resetGrid(clearInstrumentXY = null) {
  const columns = window.ext.config.linnStrumentSize / 8;

  if (typeof clearInstrumentXY === "function") {
    for (let x = 0; x < columns; x++) {
      for (let y = 0; y <= 7; y++) {
        clearInstrumentXY(x, y, 0);
      }
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

  const visualRows = grid[0]?.length ?? 0;
  const visualColumns = grid.length;
  const padSize = Math.max(26, Math.floor(surface.offsetWidth / Math.max(visualColumns, 1)) - 6);

  if (canPatchSurfaceGrid(surface, visualColumns, visualRows)) {
    patchSurfaceGrid(surface, grid, cellMeta, padSize);
    return;
  }

  surface.innerHTML = "";
  for (let y = visualRows - 1; y >= 0; y--) {
    const rowEl = document.createElement("div");
    rowEl.className = "surface-row";
    rowEl.style.height = `${padSize + 6}px`;
    surface.appendChild(rowEl);

    for (let x = 0; x < visualColumns; x++) {
      const cellEl = document.createElement("button");
      cellEl.type = "button";
      cellEl.tabIndex = -1;
      applyCellPresentation(cellEl, {
        x,
        y,
        noteNumber: grid[x][y],
        meta: cellMeta[coordKey(x, y)] || {},
        padSize,
      });
      rowEl.appendChild(cellEl);
    }
  }
}

function midiNoteLabel(noteNumber) {
  if (!Number.isFinite(noteNumber) || noteNumber < 0 || noteNumber > 127) {
    return "-";
  }

  const name = NOTE_NAMES[noteNumber % 12];
  const octave = Math.floor(noteNumber / 12) - 1;
  return `${name}${octave}`;
}

function canPatchSurfaceGrid(surface, visualColumns, visualRows) {
  if (visualColumns <= 0 || visualRows <= 0) {
    return false;
  }
  const rowEls = surface.querySelectorAll(".surface-row");
  if (rowEls.length !== visualRows) {
    return false;
  }
  return surface.querySelectorAll(".cell").length === visualColumns * visualRows;
}

function patchSurfaceGrid(surface, grid, cellMeta, padSize) {
  const visualRows = grid[0]?.length ?? 0;
  const visualColumns = grid.length;
  const rowEls = surface.querySelectorAll(".surface-row");

  for (let y = visualRows - 1; y >= 0; y--) {
    const rowRenderIndex = visualRows - 1 - y;
    const rowEl = rowEls[rowRenderIndex];
    if (!rowEl) {
      continue;
    }
    rowEl.style.height = `${padSize + 6}px`;

    for (let x = 0; x < visualColumns; x++) {
      const cellEl = rowEl.children[x];
      if (!cellEl) {
        continue;
      }
      applyCellPresentation(cellEl, {
        x,
        y,
        noteNumber: grid[x][y],
        meta: cellMeta[coordKey(x, y)] || {},
        padSize,
      });
    }
  }
}

function applyCellPresentation(cellEl, options) {
  const { x, y, noteNumber, meta = {}, padSize } = options;

  const label = meta.label || midiNoteLabel(noteNumber);
  const subLabel = meta.subLabel || "";
  const renderedLabel = label;
  const renderedSubLabel = normalizePlayOctaveSubLabel(meta, subLabel);
  const nextNoteClass = `note-number-${noteNumber}`;
  const nextZoneClass = meta.zone ? `zone-${meta.zone}` : "";
  const prevNoteClass = cellEl.dataset.noteClass;
  const prevZoneClass = cellEl.dataset.zoneClass;

  cellEl.id = `cell-${x}-${y}`;
  cellEl.classList.add("cell");
  if (prevNoteClass && prevNoteClass !== nextNoteClass) {
    cellEl.classList.remove(prevNoteClass);
  }
  if (prevZoneClass && prevZoneClass !== nextZoneClass) {
    cellEl.classList.remove(prevZoneClass);
  }
  cellEl.classList.add(nextNoteClass);
  if (nextZoneClass) {
    cellEl.classList.add(nextZoneClass);
  }
  cellEl.classList.toggle("cell-accidental", Boolean(meta.accidental));
  cellEl.classList.toggle("cell-disabled", Boolean(meta.disabled));
  cellEl.classList.toggle("cell-root", Boolean(meta.root));
  cellEl.classList.toggle("cell-selected", Boolean(meta.selected));
  cellEl.classList.toggle("cell-in-scale", meta.zone === "play" && Boolean(meta.inSelectedScale));
  cellEl.classList.toggle("cell-out-of-scale", meta.zone === "play" && meta.inSelectedScale === false);
  cellEl.style.height = `${padSize}px`;
  cellEl.style.width = `${padSize}px`;
  cellEl.dataset.x = String(x);
  cellEl.dataset.y = String(y);
  cellEl.dataset.noteNumber = String(noteNumber);
  cellEl.dataset.noteClass = nextNoteClass;
  cellEl.dataset.zoneClass = nextZoneClass;
  cellEl.setAttribute("aria-label", `${renderedLabel}${renderedSubLabel ? ` ${renderedSubLabel}` : ""}`);

  let labelEl = cellEl.querySelector(".cell-label");
  if (!labelEl) {
    labelEl = document.createElement("span");
    labelEl.className = "cell-label";
    cellEl.prepend(labelEl);
  }
  labelEl.className = `cell-label${String(renderedLabel).length > 4 ? " cell-label-small" : ""}`;
  labelEl.textContent = label;

  let subLabelEl = cellEl.querySelector(".cell-sub-label");
  if (renderedSubLabel) {
    if (!subLabelEl) {
      subLabelEl = document.createElement("span");
      subLabelEl.className = "cell-sub-label";
      cellEl.appendChild(subLabelEl);
    }
    subLabelEl.textContent = renderedSubLabel;
  } else if (subLabelEl) {
    subLabelEl.remove();
  }
}

function normalizePlayOctaveSubLabel(meta, subLabel) {
  if (meta?.zone !== "play") {
    return subLabel || "";
  }
  const match = /^o(-?\d+)$/.exec(String(subLabel || "").trim());
  return match ? match[1] : "";
}
