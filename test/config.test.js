import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { STORAGE_KEY, clearPersistedConfig, defaultConfig, initConfig, persistConfig } from "../web/src/config.js";

function createLocalStorageStub(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  globalThis.localStorage = createLocalStorageStub();
});

afterEach(() => {
  if (originalLocalStorage) {
    globalThis.localStorage = originalLocalStorage;
    return;
  }
  delete globalThis.localStorage;
});

describe("config", () => {
  test("initConfig returns defaults when storage is empty", () => {
    expect(initConfig()).toEqual(defaultConfig);
  });

  test("initConfig drops legacy protocol fields and normalizes user-firmware rows", () => {
    const legacy = {
      linnStrumentInputProtocol: "standard",
      assumeRowChannels: false,
      layoutRowOffset: 7,
      userFirmwareSlideMode: "invalid-mode",
      userFirmwareTimbreEnabled: "0",
      userFirmwareTimbreCc: 999,
      userFirmwareAxesByRow: [{ x: false, y: true, z: false }],
    };
    globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const config = initConfig();
    expect(config.layoutRowOffsetScale).toBe(7);
    expect(config.userFirmwareSlideMode).toBe(defaultConfig.userFirmwareSlideMode);
    expect(config.userFirmwareTimbreEnabled).toBe(false);
    expect(config.userFirmwareTimbreCc).toBe(127);
    expect(config.userFirmwareAxesByRow[0]).toEqual({ x: false, y: true, z: false });
    expect(config.userFirmwareAxesByRow[1]).toEqual({ x: true, y: false, z: true });
    expect("linnStrumentInputProtocol" in config).toBe(false);
    expect("assumeRowChannels" in config).toBe(false);
  });

  test("persistConfig and clearPersistedConfig update storage", () => {
    const next = { ...defaultConfig, selectedKey: 7 };
    persistConfig(next);
    expect(JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY))).toEqual(next);
    clearPersistedConfig();
    expect(globalThis.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
