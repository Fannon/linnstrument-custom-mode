import {
  NOTE_NAMES,
  MODES,
  clampInt,
  getActiveLayoutRowOffset,
  isAccidentalPc,
  isPitchClassInMode,
  scaleNoteAt,
} from "./core-logic.js";

export const PRESETS = [
  {
    id: "scale-mode-basic-v1",
    name: "Scale Mode (Mod row + Overlay key/mode controls)",
    description: "Bottom row sends modwheel from pressure (except control-overlay trigger). Hold/tap the trigger to access key/mode controls; other rows output scale notes.",
    playableRowsStart: 3,
  },
];

const PRESET_BY_ID = Object.fromEntries(PRESETS.map((preset) => [preset.id, preset]));
const MODE_BY_ID = Object.fromEntries(MODES.map((mode) => [mode.id, mode]));

export function buildLayoutDefinition(config, defaults = {}, uiState = {}) {
  const cellMeta = {};
  const padMap = {};
  const columns = (config?.linnStrumentSize ?? 128) / 8;
  const preset = PRESET_BY_ID[config?.presetId] || PRESETS[0];
  const mode = MODE_BY_ID[config?.selectedModeId] || MODES[0];
  const rootPc = mod12(config?.selectedKey ?? 0);
  const baseRootC = clampInt(config?.baseRootC, 0, 127, 36);
  const rootMidi = baseRootC + rootPc;
  const activeRowOffset = getActiveLayoutRowOffset(config, defaults);
  const controlOverlayActive = Boolean(uiState?.controlOverlayActive);
  const playableRowsStart = controlOverlayActive ? preset.playableRowsStart : 1;
  const noteMappingOriginRow = 1;

  for (let x = 0; x < columns; x++) {
    for (let y = 0; y < 8; y++) {
      const key = coordKey(x, y);
      const meta = { zone: "disabled", label: "", subLabel: "", disabled: true };
      let pad = { role: "disabled" };

      if (x === 0 && y === 0) {
        meta.zone = "overlay-trigger";
        meta.label = "Ctl";
        meta.subLabel = controlOverlayActive ? "on" : "tap/hold";
        meta.disabled = false;
        meta.selected = controlOverlayActive;
        pad = { role: "control-overlay-trigger" };
      } else if (y === 0) {
        meta.zone = "mod";
        meta.label = "MW";
        meta.subLabel = x === 1 ? "CC1" : "";
        meta.disabled = false;
        pad = { role: "mod" };
      } else if (controlOverlayActive && y === 1) {
        if (x < 12) {
          meta.zone = "key";
          meta.label = NOTE_NAMES[x];
          meta.subLabel = "key";
          meta.disabled = false;
          meta.accidental = isAccidentalPc(x);
          meta.selected = mod12(config?.selectedKey ?? 0) === x;
          pad = { role: "key-select", keyPc: x };
        } else if (x === 13) {
          meta.zone = "mpe";
          meta.label = "MPE";
          meta.subLabel = "route";
          meta.disabled = false;
          meta.selected = Boolean(config?.mpeEnabled ?? defaults?.mpeEnabled ?? true);
          pad = { role: "toggle-mpe" };
        } else if (x === columns - 2) {
          meta.zone = "octave";
          meta.label = "Oct-";
          meta.subLabel = "out";
          meta.disabled = false;
          pad = { role: "octave-down" };
        } else if (x === columns - 1) {
          meta.zone = "octave";
          meta.label = "Oct+";
          meta.subLabel = "out";
          meta.disabled = false;
          pad = { role: "octave-up" };
        }
      } else if (controlOverlayActive && y === 2) {
        if (x < MODES.length) {
          const rowMode = MODES[x];
          meta.zone = "mode";
          meta.label = rowMode.short;
          meta.subLabel = "mode";
          meta.disabled = false;
          meta.selected = config?.selectedModeId === rowMode.id;
          pad = { role: "mode-select", modeId: rowMode.id };
        } else if (x === columns - 1) {
          meta.zone = "mode";
          meta.label = "All";
          meta.subLabel = "notes";
          meta.disabled = false;
          meta.selected = Boolean(config?.allNotesEnabled);
          pad = { role: "toggle-all-notes" };
        }
      } else if (y >= playableRowsStart) {
        // Keep note positions stable when the overlay is shown; controls visually
        // replace rows, but the remaining playable rows keep their normal mapping.
        const degreeIndex = x + (y - noteMappingOriginRow) * activeRowOffset;
        const mappedNote = config?.allNotesEnabled
          ? clampInt(rootMidi + degreeIndex, 0, 127, rootMidi)
          : scaleNoteAt(rootMidi, mode, degreeIndex);
        const pc = mappedNote % 12;
        const octave = Math.floor(mappedNote / 12) - 1;

        meta.zone = "play";
        meta.label = NOTE_NAMES[pc];
        meta.subLabel = `o${octave}`;
        meta.disabled = false;
        meta.root = !Boolean(config?.allNotesEnabled) && pc === rootPc;
        meta.tonic = meta.root;
        meta.inSelectedScale = isPitchClassInMode(pc, rootPc, mode);
        meta.noteNumber = mappedNote;
        pad = { role: "play-note", outNote: mappedNote };
      }

      cellMeta[key] = meta;
      padMap[key] = pad;
    }
  }

  return { cellMeta, padMap };
}

function coordKey(x, y) {
  return `${x}-${y}`;
}

function mod12(n) {
  return ((n % 12) + 12) % 12;
}
