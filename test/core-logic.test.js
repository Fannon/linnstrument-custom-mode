import { describe, expect, test } from "bun:test";
import {
  MODES,
  NO_OVERLAP_COLUMN_PHASE,
  clampInt,
  detectChordNameFromMidiNotes,
  getActiveLayoutRowOffset,
  getPitchBend14,
  isPitchClassInMode,
  mod,
  parsePitchSlideSetting,
  resolveNoOverlapPadCoord,
  rowIndexFromChannel,
  scaleNoteAt,
  scalePitchBend14,
  shouldLightPlayablePad,
} from "../web/src/core-logic.js";

describe("core-logic", () => {
  test("mode row leaves room for All-notes toggle on 16 columns", () => {
    expect(MODES.length).toBeLessThanOrEqual(14);
  });

  test("mod handles negative numbers", () => {
    expect(mod(-1, 12)).toBe(11);
    expect(mod(13, 12)).toBe(1);
  });

  test("clampInt and parsePitchSlideSetting validate user input", () => {
    expect(clampInt("9", 1, 12, 4)).toBe(9);
    expect(clampInt("abc", 1, 12, 4)).toBe(4);
    expect(clampInt("99", 1, 12, 4)).toBe(12);

    expect(parsePitchSlideSetting("0.5", 1)).toBe(0.5);
    expect(parsePitchSlideSetting("2", 1)).toBe(2);
    expect(parsePitchSlideSetting("3", 1)).toBe(1);
  });

  test("active layout row offset switches between scale and all-notes settings", () => {
    const defaults = { layoutRowOffsetScale: 4, layoutRowOffsetAllNotes: 5 };
    expect(getActiveLayoutRowOffset({ allNotesEnabled: false, layoutRowOffsetScale: 6 }, defaults)).toBe(6);
    expect(getActiveLayoutRowOffset({ allNotesEnabled: true, layoutRowOffsetAllNotes: 7 }, defaults)).toBe(7);
    expect(getActiveLayoutRowOffset({ allNotesEnabled: true, layoutRowOffsetAllNotes: 99 }, defaults)).toBe(12);
    expect(getActiveLayoutRowOffset({ allNotesEnabled: false, layoutRowOffsetScale: "bad" }, defaults)).toBe(4);
  });

  test("rowIndexFromChannel supports normal and reversed row order", () => {
    expect(rowIndexFromChannel(1, { perRowLowestChannel: 1, rowChannelOrderReversed: false })).toBe(0);
    expect(rowIndexFromChannel(8, { perRowLowestChannel: 1, rowChannelOrderReversed: false })).toBe(7);
    expect(rowIndexFromChannel(1, { perRowLowestChannel: 1, rowChannelOrderReversed: true })).toBe(7);
    expect(rowIndexFromChannel(8, { perRowLowestChannel: 1, rowChannelOrderReversed: true })).toBe(0);
    expect(rowIndexFromChannel(0, { perRowLowestChannel: 1 })).toBeNull();
    expect(rowIndexFromChannel(9, { perRowLowestChannel: 1 })).toBeNull();
  });

  test("resolveNoOverlapPadCoord matches standardized no-overlap mapping on LinnStrument 128", () => {
    const options = {
      columns: 16,
      rows: 8,
      assumeRowChannels: true,
      perRowLowestChannel: 1,
      rowChannelOrderReversed: false,
      columnPhase: NO_OVERLAP_COLUMN_PHASE,
    };

    expect(resolveNoOverlapPadCoord(112, 8, options)).toBe("0-7");
    expect(resolveNoOverlapPadCoord(113, 8, options)).toBe("1-7");
    expect(resolveNoOverlapPadCoord(114, 8, options)).toBe("2-7");
    expect(resolveNoOverlapPadCoord(115, 8, options)).toBe("3-7");
    expect(resolveNoOverlapPadCoord(128, 8, options)).toBeNull();
  });

  test("resolveNoOverlapPadCoord can ignore channel and derive row from note only", () => {
    const options = {
      columns: 16,
      rows: 8,
      assumeRowChannels: false,
      columnPhase: NO_OVERLAP_COLUMN_PHASE,
    };

    expect(resolveNoOverlapPadCoord(51, 2, options)).toBe("3-3");
    expect(resolveNoOverlapPadCoord(51, 12, options)).toBe("3-3");
  });

  test("isPitchClassInMode checks membership against selected tonic", () => {
    const major = MODES.find((mode) => mode.id === "major");
    expect(isPitchClassInMode(0, 0, major)).toBe(true); // C in C major
    expect(isPitchClassInMode(1, 0, major)).toBe(false); // C# in C major
    expect(isPitchClassInMode(1, 11, major)).toBe(true); // C# in B major
  });

  test("scaleNoteAt maps scale degrees across octaves and negatives", () => {
    const major = MODES.find((mode) => mode.id === "major");
    expect(scaleNoteAt(60, major, 0)).toBe(60); // C
    expect(scaleNoteAt(60, major, 1)).toBe(62); // D
    expect(scaleNoteAt(60, major, 6)).toBe(71); // B
    expect(scaleNoteAt(60, major, 7)).toBe(72); // next C
    expect(scaleNoteAt(60, major, -1)).toBe(59); // previous B
  });

  test("pitch bend normalization accepts multiple WebMidi-like shapes", () => {
    expect(getPitchBend14({ dataBytes: [0x00, 0x40] })).toBe(8192);
    expect(getPitchBend14({ rawValue: -8192 })).toBe(0);
    expect(getPitchBend14({ rawValue: 8191 })).toBe(16383);
    expect(getPitchBend14({ value: 0 })).toBe(8192);
    expect(getPitchBend14({})).toBe(8192);
  });

  test("pitch bend scaling respects factor and clamps", () => {
    expect(scalePitchBend14(8192, 2)).toBe(8192);
    expect(scalePitchBend14(9192, 2)).toBe(10192);
    expect(scalePitchBend14(16383, 2)).toBe(16383);
    expect(scalePitchBend14(0, 2)).toBe(0);
  });

  test("all-notes lighting rule only hides out-of-scale playable pads", () => {
    expect(shouldLightPlayablePad({ zone: "key" }, true)).toBe(true);
    expect(shouldLightPlayablePad({ zone: "play", noteNumber: 60, inSelectedScale: true }, true)).toBe(true);
    expect(shouldLightPlayablePad({ zone: "play", noteNumber: 61, inSelectedScale: false }, true)).toBe(false);
    expect(shouldLightPlayablePad({ zone: "play", noteNumber: 61, inSelectedScale: false }, false)).toBe(true);
  });

  test("detectChordNameFromMidiNotes detects common triads and sevenths", () => {
    expect(detectChordNameFromMidiNotes([60, 64, 67])).toBe("C");
    expect(detectChordNameFromMidiNotes([60, 63, 67])).toBe("Cm");
    expect(detectChordNameFromMidiNotes([60, 64, 67, 71])).toBe("Cmaj7");
    expect(detectChordNameFromMidiNotes([60, 64, 67, 70])).toBe("C7");
    expect(detectChordNameFromMidiNotes([60, 63, 67, 70])).toBe("Cm7");
  });

  test("detectChordNameFromMidiNotes detects common extensions and omissions", () => {
    expect(detectChordNameFromMidiNotes([60, 62, 64, 67])).toBe("Cadd9");
    expect(detectChordNameFromMidiNotes([60, 64, 67, 69])).toBe("C6");
    expect(detectChordNameFromMidiNotes([60, 64, 70, 74])).toBe("C9");
    expect(detectChordNameFromMidiNotes([60, 64, 71])).toBe("Cmaj7");
  });

  test("detectChordNameFromMidiNotes keeps a base chord when an extra color tone is present", () => {
    expect(detectChordNameFromMidiNotes([60, 64, 67, 70, 73])).toBe("C7");
    expect(detectChordNameFromMidiNotes([64, 67, 70, 72, 74])).toBe("C9/E");
  });

  test("detectChordNameFromMidiNotes reports inversions with slash bass", () => {
    expect(detectChordNameFromMidiNotes([64, 67, 72])).toBe("C/E");
    expect(detectChordNameFromMidiNotes([67, 72])).toBe("C5");
    expect(detectChordNameFromMidiNotes([60])).toBe("");
  });
});
