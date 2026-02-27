import { describe, expect, test } from "bun:test";
import { defaultConfig } from "../web/src/config.js";
import { MODES } from "../web/src/core-logic.js";
import { buildLayoutDefinition, PRESETS } from "../web/src/layout-logic.js";

function baseConfig(overrides = {}) {
  return {
    ...defaultConfig,
    linnStrumentSize: 128,
    presetId: PRESETS[0].id,
    selectedModeId: "major",
    selectedKey: 0,
    baseRootC: 36,
    allNotesEnabled: false,
    ...overrides,
  };
}

function buildWithOverlay(configOverrides = {}, uiState = {}) {
  return buildLayoutDefinition(baseConfig(configOverrides), defaultConfig, uiState);
}

describe("layout-logic buildLayoutDefinition", () => {
  test("creates overlay trigger on bottom-left pad and mod row on remaining y=0 pads", () => {
    const { cellMeta, padMap } = buildWithOverlay({}, { controlOverlayActive: false });

    expect(cellMeta["0-0"].zone).toBe("overlay-trigger");
    expect(cellMeta["0-0"].label).toBe("Ctl");
    expect(cellMeta["0-0"].disabled).toBe(false);
    expect(padMap["0-0"].role).toBe("control-overlay-trigger");

    for (let x = 1; x < 16; x++) {
      expect(cellMeta[`${x}-0`].zone).toBe("mod");
      expect(cellMeta[`${x}-0`].label).toBe("MW");
      expect(cellMeta[`${x}-0`].disabled).toBe(false);
      expect(padMap[`${x}-0`].role).toBe("mod");
    }
    expect(cellMeta["1-0"].subLabel).toBe("CC1");
    expect(cellMeta["2-0"].subLabel).toBe("");
  });

  test("creates tonic row with MPE and octave controls when control overlay is active", () => {
    const { cellMeta, padMap } = buildWithOverlay({ selectedKey: 1 }, { controlOverlayActive: true });

    expect(cellMeta["0-1"].zone).toBe("key");
    expect(cellMeta["0-1"].label).toBe("C");
    expect(cellMeta["0-1"].selected).toBe(false);
    expect(padMap["0-1"]).toEqual({ role: "key-select", keyPc: 0 });

    expect(cellMeta["1-1"].zone).toBe("key");
    expect(cellMeta["1-1"].accidental).toBe(true);
    expect(cellMeta["1-1"].selected).toBe(true);

    expect(cellMeta["12-1"].disabled).toBe(true);
    expect(padMap["12-1"].role).toBe("disabled");
    expect(cellMeta["13-1"].disabled).toBe(false);
    expect(cellMeta["13-1"].zone).toBe("mpe");
    expect(cellMeta["13-1"].label).toBe("MPE");
    expect(padMap["13-1"].role).toBe("toggle-mpe");

    expect(cellMeta["14-1"].zone).toBe("octave");
    expect(cellMeta["14-1"].label).toBe("Oct-");
    expect(padMap["14-1"].role).toBe("octave-down");

    expect(cellMeta["15-1"].zone).toBe("octave");
    expect(cellMeta["15-1"].label).toBe("Oct+");
    expect(padMap["15-1"].role).toBe("octave-up");
  });

  test("creates mode row with gap and All-notes toggle on last pad when control overlay is active", () => {
    const { cellMeta, padMap } = buildWithOverlay(
      { selectedModeId: "dorian", allNotesEnabled: true, mpeEnabled: true },
      { controlOverlayActive: true },
    );

    const dorianIndex = MODES.findIndex((mode) => mode.id === "dorian");
    expect(dorianIndex).toBeGreaterThanOrEqual(0);
    expect(cellMeta[`${dorianIndex}-2`].zone).toBe("mode");
    expect(cellMeta[`${dorianIndex}-2`].selected).toBe(true);
    expect(padMap[`${dorianIndex}-2`]).toEqual({ role: "mode-select", modeId: "dorian" });

    expect(cellMeta["14-2"].disabled).toBe(true);
    expect(padMap["14-2"].role).toBe("disabled");

    expect(cellMeta["15-2"].zone).toBe("all-notes-toggle");
    expect(cellMeta["15-2"].label).toBe("All");
    expect(cellMeta["15-2"].selected).toBe(true);
    expect(padMap["15-2"].role).toBe("toggle-all-notes");
  });

  test("overlay-off layout uses rows above mod row as playable surface", () => {
    const { cellMeta, padMap } = buildWithOverlay({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: false,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
    }, { controlOverlayActive: false });

    expect(padMap["0-1"].role).toBe("play-note");
    expect(padMap["0-1"].outNote).toBe(36); // C2 now starts on y=1
    expect(cellMeta["0-1"].zone).toBe("play");
    expect(cellMeta["0-1"].tonic).toBe(true);

    expect(padMap["0-2"].role).toBe("play-note");
    expect(padMap["0-2"].outNote).toBe(43); // next row starts at degree offset 4 (C major -> G2)
  });

  test("overlay-on playable rows keep stable scale mapping and mark tonic/in-scale", () => {
    const overlayOff = buildWithOverlay({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: false,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
    }, { controlOverlayActive: false });
    const { cellMeta, padMap } = buildWithOverlay({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: false,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
    }, { controlOverlayActive: true });

    expect(padMap["0-3"].role).toBe("play-note");
    expect(padMap["0-3"].outNote).toBe(overlayOff.padMap["0-3"].outNote);
    expect(padMap["0-3"].outNote).toBe(50); // D3 (row mapping stays put while overlay is visible)
    expect(cellMeta["0-3"].label).toBe("D");
    expect(cellMeta["0-3"].tonic).toBe(false);
    expect(cellMeta["0-3"].inSelectedScale).toBe(true);

    expect(padMap["1-3"].outNote).toBe(overlayOff.padMap["1-3"].outNote);
    expect(padMap["1-3"].outNote).toBe(52); // E3
    expect(cellMeta["1-3"].label).toBe("E");
    expect(cellMeta["1-3"].tonic).toBe(false);
  });

  test("overlay-on all-notes mode keeps row mapping stable and still tracks inSelectedScale", () => {
    const overlayOff = buildWithOverlay({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: true,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
      layoutRowOffsetAllNotes: 5,
    }, { controlOverlayActive: false });
    const { cellMeta, padMap } = buildWithOverlay({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: true,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
      layoutRowOffsetAllNotes: 5,
    }, { controlOverlayActive: true });

    expect(padMap["0-3"].outNote).toBe(overlayOff.padMap["0-3"].outNote);
    expect(padMap["0-3"].outNote).toBe(46);
    expect(cellMeta["0-3"].inSelectedScale).toBe(false);
    expect(padMap["1-3"].outNote).toBe(overlayOff.padMap["1-3"].outNote);
    expect(padMap["1-3"].outNote).toBe(47); // chromatic step in all-notes mode

    expect(padMap["0-4"].outNote).toBe(overlayOff.padMap["0-4"].outNote);
    expect(padMap["0-4"].outNote).toBe(51); // row offset still uses all-notes offset (5)
    expect(cellMeta["0-4"].label).toBe("D#");
  });

  test("MPE toggle reflects disabled state in control overlay", () => {
    const { cellMeta, padMap } = buildWithOverlay(
      { mpeEnabled: false },
      { controlOverlayActive: true },
    );
    expect(cellMeta["13-1"].zone).toBe("mpe");
    expect(cellMeta["13-1"].label).toBe("MPE");
    expect(cellMeta["13-1"].selected).toBe(false);
    expect(padMap["13-1"].role).toBe("toggle-mpe");
  });
});
