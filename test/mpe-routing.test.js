import { describe, expect, test } from "bun:test";
import {
  getRoutedInputChannel,
  isMpeModeEnabled,
  listOutputChannelsForInputChannel,
  resolveOutputChannel,
  shouldForwardPitchBendForInputChannel,
} from "../web/src/mpe-routing.js";

describe("mpe-routing", () => {
  test("resolves MPE mode with config/default fallback", () => {
    expect(isMpeModeEnabled({ mpeEnabled: true }, { mpeEnabled: false })).toBe(true);
    expect(isMpeModeEnabled({ mpeEnabled: false }, { mpeEnabled: true })).toBe(false);
    expect(isMpeModeEnabled({}, { mpeEnabled: false })).toBe(false);
    expect(isMpeModeEnabled({}, {})).toBe(true);
  });

  test("resolves output channel based on MPE mode", () => {
    expect(resolveOutputChannel(7, true)).toBe(7);
    expect(resolveOutputChannel(7, false)).toBe(1);
    expect(resolveOutputChannel(NaN, true)).toBe(1);
    expect(resolveOutputChannel(99, true)).toBe(1);
  });

  test("prefers sourceChannel for routed entry input matching", () => {
    expect(getRoutedInputChannel({ sourceChannel: 6, channel: 1 })).toBe(6);
    expect(getRoutedInputChannel({ channel: 4 })).toBe(4);
    expect(getRoutedInputChannel({})).toBeNull();
  });

  test("forwards pitch bend when row is playable", () => {
    const forwarded = shouldForwardPitchBendForInputChannel({
      inputChannel: 3,
      assumeRowChannels: true,
      rowIndexFromChannel: () => 2,
      rowHasPlayablePads: (row) => row === 2,
      routedEntries: [],
    });
    expect(forwarded).toBe(true);
  });

  test("falls back to held notes even if row mapping exists but is not playable", () => {
    const forwarded = shouldForwardPitchBendForInputChannel({
      inputChannel: 1,
      assumeRowChannels: true,
      rowIndexFromChannel: () => 0,
      rowHasPlayablePads: () => false,
      routedEntries: [{ channel: 1, sourceChannel: 1, note: 60 }],
    });
    expect(forwarded).toBe(true);
  });

  test("does not forward pitch bend for unrelated channels", () => {
    const forwarded = shouldForwardPitchBendForInputChannel({
      inputChannel: 4,
      assumeRowChannels: true,
      rowIndexFromChannel: () => null,
      rowHasPlayablePads: () => false,
      routedEntries: [{ channel: 1, sourceChannel: 1, note: 60 }],
    });
    expect(forwarded).toBe(false);
  });

  test("lists unique output channels for a specific input channel", () => {
    const channels = listOutputChannelsForInputChannel(
      [
        { sourceChannel: 1, channel: 2 },
        { sourceChannel: 1, channel: 3 },
        { sourceChannel: 1, channel: 3 },
        { sourceChannel: 2, channel: 4 },
      ],
      1,
    );
    expect(channels.sort((a, b) => a - b)).toEqual([2, 3]);
  });
});
