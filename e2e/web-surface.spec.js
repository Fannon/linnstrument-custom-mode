const { test, expect } = require("@playwright/test");

async function pointerDownPad(page, selector, pointerId = 1) {
  await page.locator(selector).first().evaluate((el, pid) => {
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: pid,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
  }, pointerId);
}

async function pointerUpPad(page, selector, pointerId = 1) {
  await page.locator(selector).first().evaluate((el, pid) => {
    el.dispatchEvent(new PointerEvent("pointerup", {
      bubbles: true,
      pointerId: pid,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 0,
    }));
  }, pointerId);
}

async function tapPad(page, selector, pointerId = 1) {
  await pointerDownPad(page, selector, pointerId);
  await pointerUpPad(page, selector, pointerId);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/lib/webmidi.iife.min.js", (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "/* Playwright: WebMIDI library replaced by test stub */",
    });
  });

  await page.addInitScript(() => {
    const MIDI_EVENTS = [];
    window.__midiEvents = MIDI_EVENTS;

    function createInput(name) {
      const globalListeners = new Map();
      const channelListeners = new Map();

      function addToMap(map, eventName, handler) {
        const list = map.get(eventName) || [];
        list.push(handler);
        map.set(eventName, list);
        return {
          remove() {
            const current = map.get(eventName) || [];
            map.set(eventName, current.filter((fn) => fn !== handler));
          },
        };
      }

      const input = {
        name,
        addListener(eventName, handler) {
          return addToMap(globalListeners, eventName, handler);
        },
        removeListener(eventName, handler) {
          const current = globalListeners.get(eventName) || [];
          globalListeners.set(eventName, current.filter((fn) => fn !== handler));
        },
        emit(eventName, msg) {
          for (const handler of globalListeners.get(eventName) || []) {
            handler(msg);
          }
          const channel = msg?.channel;
          if (!Number.isFinite(channel)) {
            return;
          }
          const perChannel = channelListeners.get(channel);
          if (!perChannel) {
            return;
          }
          for (const handler of perChannel.get(eventName) || []) {
            handler(msg);
          }
        },
        channels: {},
      };

      for (let ch = 1; ch <= 16; ch++) {
        const listeners = new Map();
        channelListeners.set(ch, listeners);
        input.channels[ch] = {
          addListener(eventName, handler) {
            return addToMap(listeners, eventName, handler);
          },
          removeListener(eventName, handler) {
            const current = listeners.get(eventName) || [];
            listeners.set(eventName, current.filter((fn) => fn !== handler));
          },
        };
      }

      return input;
    }

    function createOutput(name) {
      const channels = {};
      const push = (entry) => MIDI_EVENTS.push({ output: name, ...entry });

      for (let channel = 1; channel <= 16; channel++) {
        channels[channel] = {
          playNote(noteNumber, options = {}) {
            push({ type: "playNote", channel, noteNumber, options });
          },
          stopNote(noteNumber, options = {}) {
            push({ type: "stopNote", channel, noteNumber, options });
          },
          sendControlChange(controller, value) {
            push({ type: "cc", channel, controller, value });
          },
        };
      }

      return {
        name,
        channels,
        send(data) {
          push({ type: "raw", data: Array.from(data || []) });
        },
        sendNrpnValue(param, value, options = {}) {
          push({ type: "nrpn-send", param, value, options });
        },
      };
    }

    const instrumentInput = createInput("LinnStrument Input");
    const instrumentOutput = createOutput("LinnStrument Output");
    const loopOutput = createOutput("loopMIDI Port");
    window.__instrumentInput = instrumentInput;

    window.WebMidi = {
      inputs: [instrumentInput],
      outputs: [instrumentOutput, loopOutput],
      enable() {
        return Promise.resolve();
      },
      getInputByName(name) {
        return this.inputs.find((input) => input.name === name) || null;
      },
      getOutputByName(name) {
        return this.outputs.find((output) => output.name === name) || null;
      },
    };
  });

  await page.goto("/");
  await expect(page.locator("#visualization .cell").first()).toBeVisible();
  await page.evaluate(() => {
    window.__midiEvents.length = 0;
  });
});

test("grid click sends note on and note off to loop output", async ({ page }) => {
  await tapPad(page, "#visualization .zone-play:not(.cell-disabled)");

  const events = await page.evaluate(() =>
    window.__midiEvents.filter((event) => event.output === "loopMIDI Port" && (event.type === "playNote" || event.type === "stopNote"))
  );
  expect(events.length).toBeGreaterThanOrEqual(2);

  const noteOn = events.find((event) => event.type === "playNote");
  const noteOff = events.find((event) => event.type === "stopNote");
  expect(noteOn).toBeTruthy();
  expect(noteOff).toBeTruthy();
  expect(noteOn.noteNumber).toBe(noteOff.noteNumber);
  expect(noteOn.channel).toBe(noteOff.channel);
});

test("overlay toggle exposes controls and allows root + scale selection", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await expect(page.locator("#cell-0-1")).toHaveClass(/zone-key/);

  await tapPad(page, "#cell-2-1");
  await expect(page.locator("#stateTonicSelect")).toHaveValue("2");

  await tapPad(page, "#cell-1-2");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("minor");
});

test("mpe toggle changes routing channel for clicked notes", async ({ page }) => {
  await tapPad(page, "#visualization .zone-play:not(.cell-disabled)");
  const firstPlay = await page.evaluate(() =>
    window.__midiEvents.find((event) => event.output === "loopMIDI Port" && event.type === "playNote")
  );
  expect(firstPlay).toBeTruthy();
  expect(firstPlay.channel).toBeGreaterThan(1);

  await page.evaluate(() => {
    window.__midiEvents.length = 0;
  });

  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-13-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);
  await tapPad(page, "#visualization .zone-play:not(.cell-disabled)");

  const nextPlay = await page.evaluate(() =>
    window.__midiEvents.find((event) => event.output === "loopMIDI Port" && event.type === "playNote")
  );
  expect(nextPlay).toBeTruthy();
  expect(nextPlay.channel).toBe(1);
});

test("incoming standard MIDI routes note, pressure, bend, and timbre in MPE", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("keyaftertouch", { note: { number: 3 }, channel: 4, rawValue: 61 });
    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });
    input.emit("controlchange", { controller: { number: 74 }, channel: 4, rawValue: 80 });
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });

    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    const play = loopEvents.find((event) => event.type === "playNote");
    const stop = loopEvents.find((event) => event.type === "stopNote");
    const channelAftertouch = loopEvents.find((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xd0);
    const pitchBend = loopEvents.find((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0 && (((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0)) !== 8192);
    const timbre = loopEvents.find((event) => event.type === "cc" && event.controller === 74);

    return {
      play,
      stop,
      pressureChannel: channelAftertouch ? ((channelAftertouch.data[0] & 0x0f) + 1) : null,
      bendChannel: pitchBend ? ((pitchBend.data[0] & 0x0f) + 1) : null,
      timbreChannel: timbre?.channel ?? null,
    };
  });

  expect(analysis.play).toBeTruthy();
  expect(analysis.stop).toBeTruthy();
  expect(analysis.play.channel).toBeGreaterThan(1);
  expect(analysis.stop.channel).toBe(analysis.play.channel);
  expect(analysis.pressureChannel).toBe(analysis.play.channel);
  expect(analysis.bendChannel).toBe(analysis.play.channel);
  expect(analysis.timbreChannel).toBe(analysis.play.channel);
});

test("non-MPE mode routes notes to channel 1, keeps poly-aftertouch, and suppresses multi-note bend", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-13-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);

  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("keyaftertouch", { note: { number: 3 }, channel: 4, rawValue: 71 });
    input.emit("noteon", { note: { number: 4 }, channel: 4, rawVelocity: 100 });

    const bendCountBefore = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .length;

    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });

    const newBendValues = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .slice(bendCountBefore)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));

    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });
    input.emit("noteoff", { note: { number: 4 }, channel: 4, rawVelocity: 0 });

    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    return {
      playChannels: loopEvents.filter((event) => event.type === "playNote").map((event) => event.channel),
      hasPolyAftertouch: loopEvents.some((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xa0),
      hasChannelAftertouch: loopEvents.some((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xd0),
      newBendValues,
    };
  });

  expect(analysis.playChannels.length).toBeGreaterThanOrEqual(2);
  expect(analysis.playChannels.every((channel) => channel === 1)).toBe(true);
  expect(analysis.hasPolyAftertouch).toBe(true);
  expect(analysis.hasChannelAftertouch).toBe(false);
  expect(analysis.newBendValues.length).toBeGreaterThanOrEqual(1);
  expect(analysis.newBendValues.every((value) => value === 8192)).toBe(true);
});

test("holding and releasing a web pad keeps a single routed note lifecycle", async ({ page }) => {
  await page.evaluate(() => {
    window.__midiEvents.length = 0;
  });

  const target = "#visualization .zone-play:not(.cell-disabled)";
  await pointerDownPad(page, target, 12);

  const playCountDuringHold = await page.evaluate(() =>
    window.__midiEvents.filter((event) => event.output === "loopMIDI Port" && event.type === "playNote").length
  );
  expect(playCountDuringHold).toBe(1);

  await pointerUpPad(page, target, 12);

  const lifecycle = await page.evaluate(() => {
    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    const play = loopEvents.filter((event) => event.type === "playNote");
    const stop = loopEvents.filter((event) => event.type === "stopNote");
    return {
      playCount: play.length,
      stopCount: stop.length,
      same: play[0] && stop[0]
        ? play[0].noteNumber === stop[0].noteNumber && play[0].channel === stop[0].channel
        : false,
    };
  });

  expect(lifecycle.playCount).toBe(1);
  expect(lifecycle.stopCount).toBe(1);
  expect(lifecycle.same).toBe(true);
});
