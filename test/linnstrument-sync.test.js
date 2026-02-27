import { describe, expect, test } from "bun:test";
import {
  addChannelListener,
  readLinnStrumentParamValue,
  readLinnStrumentUserFirmwareModeEnabled,
} from "../web/src/linnstrument-sync.js";

function createFakeInputChannel() {
  const listeners = new Map();

  return {
    listeners,
    addListener(eventName, handler) {
      const list = listeners.get(eventName) || [];
      list.push(handler);
      listeners.set(eventName, list);
      return {
        remove() {
          const current = listeners.get(eventName) || [];
          listeners.set(eventName, current.filter((fn) => fn !== handler));
        },
      };
    },
    removeListener(eventName, handler) {
      const current = listeners.get(eventName) || [];
      listeners.set(eventName, current.filter((fn) => fn !== handler));
    },
    emit(eventName, msg) {
      for (const handler of [...(listeners.get(eventName) || [])]) {
        handler(msg);
      }
    },
    count(eventName) {
      return (listeners.get(eventName) || []).length;
    },
  };
}

function identityTimeout(_ms, promise) {
  return promise;
}

describe("linnstrument-sync", () => {
  test("addChannelListener returns a working unsubscribe", () => {
    const channel = createFakeInputChannel();
    const handler = () => {};
    const unsubscribe = addChannelListener(channel, "nrpn", handler);

    expect(channel.count("nrpn")).toBe(1);
    unsubscribe();
    expect(channel.count("nrpn")).toBe(0);
    unsubscribe(); // idempotent
    expect(channel.count("nrpn")).toBe(0);
  });

  test("readLinnStrumentParamValue cleans listeners after resolve and supports repeated reads", async () => {
    const inputChannel = createFakeInputChannel();
    const output = {
      sent: [],
      sendNrpnValue(param, value, options) {
        this.sent.push({ param, value, options });
      },
    };
    const nrpnEncoder = (value) => [value >> 7, value & 0x7f];

    const first = readLinnStrumentParamValue({
      inputChannel,
      output,
      paramNumber: 18,
      timeoutMs: 50,
      withTimeout: identityTimeout,
      nrpnEncoder,
    });
    expect(inputChannel.count("nrpn")).toBe(1);
    inputChannel.emit("nrpn", { message: { dataBytes: [38, 7] } });
    await expect(first).resolves.toBe(7);
    expect(inputChannel.count("nrpn")).toBe(0);

    const second = readLinnStrumentParamValue({
      inputChannel,
      output,
      paramNumber: 60,
      timeoutMs: 50,
      withTimeout: identityTimeout,
      nrpnEncoder,
    });
    expect(inputChannel.count("nrpn")).toBe(1);
    inputChannel.emit("nrpn", { message: { dataBytes: [99, 1] } }); // ignored
    expect(inputChannel.count("nrpn")).toBe(1);
    inputChannel.emit("nrpn", { message: { dataBytes: [38, 1] } });
    await expect(second).resolves.toBe(1);
    expect(inputChannel.count("nrpn")).toBe(0);
    expect(output.sent.length).toBe(2);
  });

  test("readLinnStrumentParamValue cleans listeners after timeout rejection", async () => {
    const inputChannel = createFakeInputChannel();
    const output = { sendNrpnValue() {} };

    await expect(readLinnStrumentParamValue({
      inputChannel,
      output,
      paramNumber: 227,
      timeoutMs: 50,
      withTimeout: async () => {
        throw new Error("Timed out");
      },
      nrpnEncoder: (value) => [value >> 7, value & 0x7f],
    })).rejects.toThrow("Timed out");

    expect(inputChannel.count("nrpn")).toBe(0);
  });

  test("readLinnStrumentParamValue cleans listeners if sendNrpnValue throws", async () => {
    const inputChannel = createFakeInputChannel();
    const output = {
      sendNrpnValue() {
        throw new Error("send failed");
      },
    };

    await expect(readLinnStrumentParamValue({
      inputChannel,
      output,
      paramNumber: 0,
      timeoutMs: 50,
      withTimeout: identityTimeout,
      nrpnEncoder: (value) => [value >> 7, value & 0x7f],
    })).rejects.toThrow("send failed");

    expect(inputChannel.count("nrpn")).toBe(0);
  });

  test("readLinnStrumentUserFirmwareModeEnabled queries NRPN 245 on channel 9", async () => {
    const inputChannel = createFakeInputChannel();
    const input = { channels: { 9: inputChannel } };
    const output = {
      sent: [],
      sendNrpnValue(param, value, options) {
        this.sent.push({ param, value, options });
      },
    };

    const pending = readLinnStrumentUserFirmwareModeEnabled({
      input,
      output,
      timeoutMs: 50,
      withTimeout: identityTimeout,
      nrpnEncoder: (value) => [value >> 7, value & 0x7f],
    });
    inputChannel.emit("nrpn", { message: { dataBytes: [38, 1] } });

    await expect(pending).resolves.toBe(true);
    expect(output.sent.length).toBe(1);
    expect(output.sent[0].value).toEqual([1, 117]); // 245
    expect(output.sent[0].options).toEqual({ channels: 1 });
  });
});
