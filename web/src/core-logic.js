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

const CHORD_PATTERNS = [
  { required: [0, 2, 4, 11], optional: [7], suffix: "maj9", rank: 132 },
  { required: [0, 2, 4, 10], optional: [7], suffix: "9", rank: 131 },
  { required: [0, 2, 3, 10], optional: [7], suffix: "m9", rank: 130 },
  { required: [0, 4, 11], optional: [7], suffix: "maj7", rank: 120 },
  { required: [0, 4, 10], optional: [7], suffix: "7", rank: 119 },
  { required: [0, 3, 10], optional: [7], suffix: "m7", rank: 118 },
  { required: [0, 3, 6, 10], optional: [], suffix: "m7b5", rank: 117 },
  { required: [0, 3, 6, 9], optional: [], suffix: "dim7", rank: 116 },
  { required: [0, 3, 11], optional: [7], suffix: "m(maj7)", rank: 115 },
  { required: [0, 4, 8, 11], optional: [], suffix: "maj7#5", rank: 114 },
  { required: [0, 4, 8, 10], optional: [], suffix: "7#5", rank: 113 },
  { required: [0, 5, 10], optional: [7], suffix: "7sus4", rank: 112 },
  { required: [0, 2, 10], optional: [7], suffix: "7sus2", rank: 111 },
  { required: [0, 2, 4, 9], optional: [7], suffix: "6/9", rank: 108 },
  { required: [0, 2, 3, 9], optional: [7], suffix: "m6/9", rank: 107 },
  { required: [0, 4, 9], optional: [7], suffix: "6", rank: 104 },
  { required: [0, 3, 9], optional: [7], suffix: "m6", rank: 103 },
  { required: [0, 2, 4, 7], optional: [], suffix: "add9", rank: 96 },
  { required: [0, 2, 3, 7], optional: [], suffix: "m(add9)", rank: 95 },
  { required: [0, 4, 7], optional: [], suffix: "", rank: 80 },
  { required: [0, 3, 7], optional: [], suffix: "m", rank: 79 },
  { required: [0, 3, 6], optional: [], suffix: "dim", rank: 78 },
  { required: [0, 4, 8], optional: [], suffix: "aug", rank: 77 },
  { required: [0, 2, 7], optional: [], suffix: "sus2", rank: 76 },
  { required: [0, 5, 7], optional: [], suffix: "sus4", rank: 75 },
  { required: [0, 7], optional: [], suffix: "5", rank: 40 },
];

function scoreChordPatternMatch(intervals, pattern, bassIsRoot, { allowExtras = false } = {}) {
  const intervalSet = new Set(intervals);

  for (const requiredInterval of pattern.required) {
    if (!intervalSet.has(requiredInterval)) {
      return null;
    }
  }

  const allowedIntervals = new Set([...pattern.required, ...(pattern.optional || [])]);
  const extraIntervals = intervals.filter((interval) => !allowedIntervals.has(interval));
  if (!allowExtras && extraIntervals.length > 0) {
    return null;
  }
  if (allowExtras && extraIntervals.length > 2) {
    return null;
  }

  const optionalPresentCount = (pattern.optional || []).filter((interval) => intervalSet.has(interval)).length;
  const exactBonus = extraIntervals.length === 0 ? 6 : 0;
  const bassBonus = bassIsRoot ? 15 : 0;
  const nonRootPenalty = bassIsRoot ? 0 : 11;
  const extraPenalty = extraIntervals.length * 14;

  return pattern.rank + bassBonus + optionalPresentCount + exactBonus - nonRootPenalty - extraPenalty;
}

function findBestChordMatch(uniquePcs, bassPc, { allowExtras = false } = {}) {
  let best = null;

  for (const rootPc of uniquePcs) {
    const intervals = uniquePcs.map((pc) => mod(pc - rootPc, 12)).sort((a, b) => a - b);

    for (const pattern of CHORD_PATTERNS) {
      const score = scoreChordPatternMatch(intervals, pattern, bassPc === rootPc, { allowExtras });
      if (score === null) {
        continue;
      }

      if (!best || score > best.score) {
        best = { rootPc, bassPc, pattern, score };
      }
    }
  }

  return best;
}

export function detectChordNameFromMidiNotes(noteNumbers) {
  const midiNotes = Array.from(noteNumbers || [])
    .map((note) => Number(note))
    .filter((note) => Number.isFinite(note) && note >= 0 && note <= 127)
    .sort((a, b) => a - b);

  if (midiNotes.length < 2) {
    return "";
  }

  const uniquePcs = Array.from(new Set(midiNotes.map((note) => mod(note, 12)))).sort((a, b) => a - b);
  const bassPc = mod(midiNotes[0], 12);

  const best =
    findBestChordMatch(uniquePcs, bassPc, { allowExtras: false }) ||
    findBestChordMatch(uniquePcs, bassPc, { allowExtras: true });

  if (!best) {
    return "";
  }

  const rootLabel = NOTE_NAMES[best.rootPc] || String(best.rootPc);
  const bassLabel = NOTE_NAMES[best.bassPc] || String(best.bassPc);
  const chordLabel = `${rootLabel}${best.pattern.suffix}`;

  if (best.bassPc !== best.rootPc && uniquePcs.length >= 3) {
    return `${chordLabel}/${bassLabel}`;
  }
  return chordLabel;
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
