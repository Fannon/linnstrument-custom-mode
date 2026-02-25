export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export const MODES = [
  { id: "major", name: "Major", short: "Maj", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "minor", name: "Minor", short: "Min", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major-pent", name: "Major Pentatonic", short: "MajP", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pent", name: "Minor Pentatonic", short: "MinP", intervals: [0, 3, 5, 7, 10] },
  { id: "dorian", name: "Dorian", short: "Dor", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", name: "Mixolydian", short: "Mix", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "lydian", name: "Lydian", short: "Lyd", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "phrygian", name: "Phrygian", short: "Phr", intervals: [0, 1, 3, 5, 7, 8, 10] },
  { id: "locrian", name: "Locrian", short: "Loc", intervals: [0, 1, 3, 5, 6, 8, 10] },
  { id: "harm-min", name: "Harmonic Minor", short: "Hm", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "mel-min", name: "Melodic Minor", short: "Mm", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "wholetone", name: "Whole Tone", short: "WT", intervals: [0, 2, 4, 6, 8, 10] },
  { id: "dim-wh", name: "Diminished (WH)", short: "Dim", intervals: [0, 2, 3, 5, 6, 8, 9, 11] },
  { id: "maj-blues", name: "Major Blues", short: "MBlu", intervals: [0, 2, 3, 4, 7, 9] },
  { id: "min-blues", name: "Minor Blues", short: "mBlu", intervals: [0, 3, 5, 6, 7, 10] },
];

export const NO_OVERLAP_COLUMN_PHASE = 0;

export function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
}

export function parsePitchSlideSetting(value, fallback = 1) {
  const n = Number.parseFloat(value);
  if (n === 0.5 || n === 1 || n === 2) {
    return n;
  }
  return fallback;
}

export function mod(n, m) {
  return ((n % m) + m) % m;
}

export function isAccidentalPc(pc) {
  return [1, 3, 6, 8, 10].includes(mod(pc, 12));
}

export function isPitchClassInMode(pc, rootPc, mode) {
  if (!mode?.intervals?.length) {
    return true;
  }
  const notePc = mod(pc, 12);
  const tonicPc = mod(rootPc, 12);
  return mode.intervals.some((interval) => mod(tonicPc + interval, 12) === notePc);
}

export function scaleNoteAt(rootMidi, mode, degreeIndex) {
  if (!mode || !mode.intervals?.length) {
    return rootMidi;
  }

  const degreeCount = mode.intervals.length;
  const octaveOffset = Math.floor(degreeIndex / degreeCount);
  const degreeInMode = mod(degreeIndex, degreeCount);
  const note = rootMidi + octaveOffset * 12 + mode.intervals[degreeInMode];
  return clampInt(note, 0, 127, rootMidi);
}

export function getPitchBend14(msg) {
  const dataBytes = msg?.dataBytes;
  if (dataBytes && dataBytes.length >= 2) {
    return ((dataBytes[1] & 0x7f) << 7) | (dataBytes[0] & 0x7f);
  }

  if (Number.isFinite(msg?.rawValue)) {
    const rawValue = Number(msg.rawValue);
    if (rawValue >= -8192 && rawValue <= 8191) {
      return Math.round(rawValue + 8192);
    }
    if (rawValue >= 0 && rawValue <= 16383) {
      return Math.round(rawValue);
    }
  }

  if (typeof msg?.value === "number") {
    return clampInt(Math.round(((msg.value + 1) / 2) * 16383), 0, 16383, 8192);
  }

  return 8192;
}

export function scalePitchBend14(value14, factor = 1) {
  const center = 8192;
  const numericFactor = Number(factor) || 1;
  const delta = value14 - center;
  return clampInt(Math.round(center + delta * numericFactor), 0, 16383, center);
}

export function rowIndexFromChannel(channel, sync = {}) {
  if (!Number.isFinite(channel)) {
    return null;
  }

  const lowestChannel = sync.perRowLowestChannel ?? 1;
  const rowIndex = channel - lowestChannel;
  if (rowIndex < 0 || rowIndex > 7) {
    return null;
  }
  return sync.rowChannelOrderReversed ? 7 - rowIndex : rowIndex;
}

export function resolveNoOverlapPadCoord(noteNumber, channel, options = {}) {
  const columns = options.columns ?? 16;
  const rows = options.rows ?? 8;
  if (!Number.isFinite(noteNumber)) {
    return null;
  }
  if (noteNumber < 0 || noteNumber >= columns * rows) {
    return null;
  }

  const columnPhase = options.columnPhase ?? NO_OVERLAP_COLUMN_PHASE;
  const x = mod(noteNumber - columnPhase, columns);
  const rowFromChannel = options.assumeRowChannels
    ? rowIndexFromChannel(channel, {
      perRowLowestChannel: options.perRowLowestChannel,
      rowChannelOrderReversed: options.rowChannelOrderReversed,
    })
    : null;
  const y = rowFromChannel ?? Math.floor(noteNumber / columns);

  if (y < 0 || y >= rows) {
    return null;
  }
  return coordKey(x, y);
}

export function resolveUserFirmwarePadCoord(noteNumber, channel, options = {}) {
  const columns = options.columns ?? 16;
  const rows = options.rows ?? 8;
  if (!Number.isFinite(noteNumber)) {
    return null;
  }

  // In LinnStrument User Firmware Mode, note 0 is the control-switch column.
  // Our logical grid excludes that column and starts at the first playable pad.
  const x = noteNumber - 1;
  if (x < 0 || x >= columns) {
    return null;
  }

  const y = rowIndexFromChannel(channel, {
    perRowLowestChannel: options.perRowLowestChannel ?? 1,
    rowChannelOrderReversed: options.rowChannelOrderReversed,
  });
  if (y === null || y < 0 || y >= rows) {
    return null;
  }

  return coordKey(x, y);
}

export function shouldLightPlayablePad(meta, allNotesEnabled) {
  if (meta?.zone !== "play" || !Number.isFinite(meta?.noteNumber)) {
    return true;
  }

  if (!allNotesEnabled) {
    return true;
  }

  return Boolean(meta.inSelectedScale);
}

export function getActiveLayoutRowOffset(config, defaults) {
  const scaleFallback = defaults?.layoutRowOffsetScale ?? 4;
  const allNotesFallback = defaults?.layoutRowOffsetAllNotes ?? 5;
  return config?.allNotesEnabled
    ? clampInt(config?.layoutRowOffsetAllNotes, 1, 12, allNotesFallback)
    : clampInt(config?.layoutRowOffsetScale, 1, 12, scaleFallback);
}

function coordKey(x, y) {
  return `${x}-${y}`;
}
