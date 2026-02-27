import { LINNSTRUMENT_USER_FIRMWARE_MODE_PARAM } from "./linnstrument-nrpn.js";
import {
  LINNSTRUMENT_SWITCH1_ASSIGNMENT_PARAM,
  LINNSTRUMENT_SWITCH2_ASSIGNMENT_PARAM,
} from "./linnstrument-nrpn.js";

export async function readLinnStrumentParamValue({
  inputChannel,
  output,
  paramNumber,
  timeoutMs = 350,
  withTimeout,
  nrpnEncoder,
} = {}) {
  if (!inputChannel || !output) {
    throw new Error("Missing LinnStrument input/output");
  }
  if (typeof withTimeout !== "function") {
    throw new Error("Missing timeout wrapper");
  }
  if (typeof nrpnEncoder !== "function") {
    throw new Error("Missing NRPN encoder");
  }

  let settled = false;
  let unsubscribe = () => {};

  const responsePromise = new Promise((resolve, reject) => {
    const onNrpn = (msg) => {
      if (settled) {
        return;
      }
      const dataBytes = msg?.message?.dataBytes;
      if (!dataBytes || dataBytes.length < 2) {
        return;
      }
      if (dataBytes[0] !== 38) {
        return;
      }
      settled = true;
      resolve(dataBytes[1]);
    };

    unsubscribe = addChannelListener(inputChannel, "nrpn", onNrpn, { duration: timeoutMs });

    try {
      output.sendNrpnValue(nrpnEncoder(299), nrpnEncoder(paramNumber), { channels: 1 });
    } catch (err) {
      settled = true;
      reject(err);
    }
  });

  return withTimeout(timeoutMs, responsePromise).finally(() => {
    settled = true;
    unsubscribe();
  });
}

export async function readLinnStrumentUserFirmwareModeEnabled({
  input,
  output,
  timeoutMs = 350,
  withTimeout,
  nrpnEncoder,
} = {}) {
  const inputChannel = input?.channels?.[9];
  const value = await readLinnStrumentParamValue({
    inputChannel,
    output,
    paramNumber: LINNSTRUMENT_USER_FIRMWARE_MODE_PARAM,
    timeoutMs,
    withTimeout,
    nrpnEncoder,
  });
  return Number(value) > 0;
}

export async function readLinnStrumentSwitchAssignments({
  input,
  output,
  timeoutMs = 350,
  withTimeout,
  nrpnEncoder,
} = {}) {
  const inputChannel = input?.channels?.[1];
  const switch1 = await readLinnStrumentParamValue({
    inputChannel,
    output,
    paramNumber: LINNSTRUMENT_SWITCH1_ASSIGNMENT_PARAM,
    timeoutMs,
    withTimeout,
    nrpnEncoder,
  });
  const switch2 = await readLinnStrumentParamValue({
    inputChannel,
    output,
    paramNumber: LINNSTRUMENT_SWITCH2_ASSIGNMENT_PARAM,
    timeoutMs,
    withTimeout,
    nrpnEncoder,
  });
  return {
    switch1: Number.isFinite(Number(switch1)) ? Number(switch1) : null,
    switch2: Number.isFinite(Number(switch2)) ? Number(switch2) : null,
  };
}

export function addChannelListener(channel, eventName, handler, options = {}) {
  if (!channel || typeof channel.addListener !== "function") {
    return () => {};
  }

  const listenerHandle = channel.addListener(eventName, handler, options);
  let removed = false;

  return () => {
    if (removed) {
      return;
    }
    removed = true;

    if (listenerHandle && typeof listenerHandle.remove === "function") {
      listenerHandle.remove();
      return;
    }
    if (listenerHandle && typeof listenerHandle.destroy === "function") {
      listenerHandle.destroy();
      return;
    }

    if (typeof channel.removeListener === "function") {
      try {
        channel.removeListener(eventName, handler);
      } catch {
        // Ignore API-shape differences across WebMidi versions.
      }
    }
  };
}
