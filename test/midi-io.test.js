import { describe, expect, test } from "bun:test";
import { autoSelectLinnStrumentPorts } from "../web/src/midi-io.js";

describe("midi-io autoSelectLinnStrumentPorts", () => {
  test("replaces unavailable saved selections with detected visible ports", () => {
    const inputSelect = { value: "LinnStrument MIDI" };
    const outputSelect = { value: "LinnStrument MIDI" };
    const loopSelect = { value: "Legacy Loop Port" };

    const inputs = [{ name: "LinnStrument Input" }, { name: "loopMIDI Port" }];
    const outputs = [{ name: "LinnStrument Output" }, { name: "loopMIDI Port" }];

    autoSelectLinnStrumentPorts({
      inputSelect,
      outputSelect,
      loopSelect,
      inputs,
      outputs,
      log: null,
    });

    expect(inputSelect.value).toBe("LinnStrument Input");
    expect(outputSelect.value).toBe("LinnStrument Output");
    expect(loopSelect.value).toBe("loopMIDI Port");
  });
});
