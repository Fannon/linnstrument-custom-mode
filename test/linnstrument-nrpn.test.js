import { describe, expect, test } from "bun:test";
import {
  createNrpnDecoderState,
  clearNrpnDecoderState,
  consumeNrpnFromControlChange,
  consumeUserFirmwareModeNotification,
} from "../web/src/linnstrument-nrpn.js";

function cc(channel, controller, value7) {
  return { channel, controller, value7 };
}

describe("linnstrument-nrpn", () => {
  test("decodes NRPN parameter/value from CC 99/98/6", () => {
    const state = createNrpnDecoderState();
    expect(consumeNrpnFromControlChange(state, cc(9, 99, 1))).toBeNull();
    expect(consumeNrpnFromControlChange(state, cc(9, 98, 117))).toBeNull(); // 245 lsb

    const decoded = consumeNrpnFromControlChange(state, cc(9, 6, 1));
    expect(decoded).toEqual({
      channel: 9,
      paramNumber: 245,
      value7: 1,
    });
  });

  test("keeps NRPN decode state isolated per MIDI channel", () => {
    const state = createNrpnDecoderState();
    consumeNrpnFromControlChange(state, cc(1, 99, 1));
    consumeNrpnFromControlChange(state, cc(1, 98, 117));
    consumeNrpnFromControlChange(state, cc(2, 99, 0));
    consumeNrpnFromControlChange(state, cc(2, 98, 12));

    const channel2 = consumeNrpnFromControlChange(state, cc(2, 6, 5));
    expect(channel2).toEqual({
      channel: 2,
      paramNumber: 12,
      value7: 5,
    });

    const channel1 = consumeNrpnFromControlChange(state, cc(1, 6, 1));
    expect(channel1).toEqual({
      channel: 1,
      paramNumber: 245,
      value7: 1,
    });
  });

  test("extracts user firmware mode notifications from NRPN 245 on channel 9", () => {
    const state = createNrpnDecoderState();
    consumeUserFirmwareModeNotification(state, cc(9, 99, 1));
    consumeUserFirmwareModeNotification(state, cc(9, 98, 117));
    expect(consumeUserFirmwareModeNotification(state, cc(9, 6, 1))).toBe(true);

    consumeUserFirmwareModeNotification(state, cc(9, 99, 1));
    consumeUserFirmwareModeNotification(state, cc(9, 98, 117));
    expect(consumeUserFirmwareModeNotification(state, cc(9, 6, 0))).toBe(false);
  });

  test("ignores NRPNs on other channels or parameter numbers", () => {
    const state = createNrpnDecoderState();
    consumeUserFirmwareModeNotification(state, cc(8, 99, 1));
    consumeUserFirmwareModeNotification(state, cc(8, 98, 117));
    expect(consumeUserFirmwareModeNotification(state, cc(8, 6, 1))).toBeNull();

    consumeUserFirmwareModeNotification(state, cc(9, 99, 1));
    consumeUserFirmwareModeNotification(state, cc(9, 98, 116));
    expect(consumeUserFirmwareModeNotification(state, cc(9, 6, 1))).toBeNull();
  });

  test("clearNrpnDecoderState discards incomplete parameter state", () => {
    const state = createNrpnDecoderState();
    consumeNrpnFromControlChange(state, cc(9, 99, 1));
    consumeNrpnFromControlChange(state, cc(9, 98, 117));
    clearNrpnDecoderState(state);
    expect(consumeNrpnFromControlChange(state, cc(9, 6, 1))).toBeNull();
  });
});
