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

describe("layout-logic buildLayoutDefinition", () => {
  test("creates mod row on y=0 across all 16 pads", () => {
    const { cellMeta, padMap } = buildLayoutDefinition(baseConfig(), defaultConfig);

    for (let x = 0; x < 16; x++) {
      expect(cellMeta[`${x}-0`].zone).toBe("mod");
      expect(cellMeta[`${x}-0`].label).toBe("MW");
      expect(cellMeta[`${x}-0`].disabled).toBe(false);
      expect(padMap[`${x}-0`].role).toBe("mod");
    }
    expect(cellMeta["0-0"].subLabel).toBe("CC1");
    expect(cellMeta["1-0"].subLabel).toBe("");
  });

  test("creates tonic row with octave controls and disabled gaps", () => {
    const { cellMeta, padMap } = buildLayoutDefinition(baseConfig({ selectedKey: 1 }), defaultConfig);

    expect(cellMeta["0-1"].zone).toBe("key");
    expect(cellMeta["0-1"].label).toBe("C");
    expect(cellMeta["0-1"].selected).toBe(false);
    expect(padMap["0-1"]).toEqual({ role: "key-select", keyPc: 0 });

    expect(cellMeta["1-1"].zone).toBe("key");
    expect(cellMeta["1-1"].accidental).toBe(true);
    expect(cellMeta["1-1"].selected).toBe(true);

    expect(cellMeta["12-1"].disabled).toBe(true);
    expect(cellMeta["12-1"].zone).toBe("disabled");
    expect(cellMeta["13-1"].disabled).toBe(true);
    expect(padMap["12-1"].role).toBe("disabled");
    expect(padMap["13-1"].role).toBe("disabled");

    expect(cellMeta["14-1"].zone).toBe("octave");
    expect(cellMeta["14-1"].label).toBe("Oct-");
    expect(padMap["14-1"].role).toBe("octave-down");

    expect(cellMeta["15-1"].zone).toBe("octave");
    expect(cellMeta["15-1"].label).toBe("Oct+");
    expect(padMap["15-1"].role).toBe("octave-up");
  });

  test("creates mode row plus All-notes toggle on last pad", () => {
    const { cellMeta, padMap } = buildLayoutDefinition(baseConfig({ selectedModeId: "dorian", allNotesEnabled: true }), defaultConfig);

    const dorianIndex = MODES.findIndex((mode) => mode.id === "dorian");
    expect(dorianIndex).toBeGreaterThanOrEqual(0);
    expect(cellMeta[`${dorianIndex}-2`].zone).toBe("mode");
    expect(cellMeta[`${dorianIndex}-2`].selected).toBe(true);
    expect(padMap[`${dorianIndex}-2`]).toEqual({ role: "mode-select", modeId: "dorian" });

    expect(cellMeta["15-2"].zone).toBe("mode");
    expect(cellMeta["15-2"].label).toBe("All");
    expect(cellMeta["15-2"].selected).toBe(true);
    expect(padMap["15-2"].role).toBe("toggle-all-notes");

    if (MODES.length < 15) {
      expect(cellMeta["14-2"].zone).toBe("disabled");
      expect(padMap["14-2"].role).toBe("disabled");
    }
  });

  test("playable rows use scale-only mapping and mark tonic/in-scale", () => {
    const { cellMeta, padMap } = buildLayoutDefinition(baseConfig({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: false,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
    }), defaultConfig);

    expect(padMap["0-3"].role).toBe("play-note");
    expect(padMap["0-3"].outNote).toBe(36); // C2
    expect(cellMeta["0-3"].label).toBe("C");
    expect(cellMeta["0-3"].tonic).toBe(true);
    expect(cellMeta["0-3"].inSelectedScale).toBe(true);

    expect(padMap["1-3"].outNote).toBe(38); // D2
    expect(cellMeta["1-3"].label).toBe("D");
    expect(cellMeta["1-3"].tonic).toBe(false);
  });

  test("all-notes mode uses all-notes row offset and still tracks inSelectedScale", () => {
    const { cellMeta, padMap } = buildLayoutDefinition(baseConfig({
      selectedKey: 0,
      selectedModeId: "major",
      allNotesEnabled: true,
      baseRootC: 36,
      layoutRowOffsetScale: 4,
      layoutRowOffsetAllNotes: 5,
    }), defaultConfig);

    expect(padMap["0-3"].outNote).toBe(36);
    expect(padMap["1-3"].outNote).toBe(37); // chromatic step in all-notes mode
    expect(cellMeta["1-3"].inSelectedScale).toBe(false);

    expect(padMap["0-4"].outNote).toBe(41); // row offset uses all-notes offset (5)
    expect(cellMeta["0-4"].label).toBe("F");
  });
});
