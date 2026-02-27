import { describe, expect, test } from "bun:test";
import {
  allocateMpeVoice,
  clearMpeVoiceAllocator,
  createMpeVoiceAllocator,
  getMpeVoiceChannel,
  moveMpeVoiceInputKey,
  releaseMpeVoice,
} from "../web/src/mpe-voice-allocator.js";

describe("mpe-voice-allocator", () => {
  test("allocates channels in ascending order within 2-15 by default", () => {
    const state = createMpeVoiceAllocator();
    expect(allocateMpeVoice(state, "1:1")).toEqual({ channel: 2, stolenInputKey: null });
    expect(allocateMpeVoice(state, "1:2")).toEqual({ channel: 3, stolenInputKey: null });
    expect(allocateMpeVoice(state, "1:3")).toEqual({ channel: 4, stolenInputKey: null });
  });

  test("reuses an existing assignment for the same input key", () => {
    const state = createMpeVoiceAllocator();
    const first = allocateMpeVoice(state, "2:10");
    const second = allocateMpeVoice(state, "2:10");
    expect(first.channel).toBe(2);
    expect(second).toEqual({ channel: 2, stolenInputKey: null });
  });

  test("releases and reuses freed channels", () => {
    const state = createMpeVoiceAllocator({ minChannel: 2, maxChannel: 4 });
    allocateMpeVoice(state, "1:1"); // ch2
    allocateMpeVoice(state, "1:2"); // ch3
    allocateMpeVoice(state, "1:3"); // ch4
    expect(releaseMpeVoice(state, "1:2")).toBe(3);
    expect(allocateMpeVoice(state, "1:4")).toEqual({ channel: 3, stolenInputKey: null });
  });

  test("steals the oldest voice when no free channels remain", () => {
    const state = createMpeVoiceAllocator({ minChannel: 2, maxChannel: 3 });
    allocateMpeVoice(state, "1:1"); // oldest, ch2
    allocateMpeVoice(state, "1:2"); // ch3

    const allocation = allocateMpeVoice(state, "1:3");
    expect(allocation).toEqual({ channel: 2, stolenInputKey: "1:1" });
    expect(getMpeVoiceChannel(state, "1:1")).toBeNull();
    expect(getMpeVoiceChannel(state, "1:3")).toBe(2);
  });

  test("moves an active voice mapping to a new input key for slide transitions", () => {
    const state = createMpeVoiceAllocator();
    allocateMpeVoice(state, "3:12");
    expect(moveMpeVoiceInputKey(state, "3:12", "3:13")).toBe(true);
    expect(getMpeVoiceChannel(state, "3:12")).toBeNull();
    expect(getMpeVoiceChannel(state, "3:13")).toBe(2);
  });

  test("clear removes all active assignments", () => {
    const state = createMpeVoiceAllocator();
    allocateMpeVoice(state, "1:1");
    allocateMpeVoice(state, "1:2");
    clearMpeVoiceAllocator(state);
    expect(getMpeVoiceChannel(state, "1:1")).toBeNull();
    expect(getMpeVoiceChannel(state, "1:2")).toBeNull();
    expect(state.byInputKey.size).toBe(0);
  });
});
