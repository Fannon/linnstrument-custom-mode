const { test, expect } = require("@playwright/test");

async function tapPad(page, selector, pointerId = 1) {
  await page.locator(selector).first().evaluate((el, pid) => {
    el.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: pid,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: 1,
    }));
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

    function decode7BitPair(pair) {
      if (!Array.isArray(pair) || pair.length < 2) {
        return null;
      }
      return ((pair[0] & 0x7f) << 7) | (pair[1] & 0x7f);
    }

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

    function createOutput(name, instrumentInput) {
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
          const paramNumber = decode7BitPair(param);
          const valueNumber = decode7BitPair(value);
          if (paramNumber === 299 && valueNumber === 245) {
            setTimeout(() => {
              instrumentInput.emit("nrpn", { channel: 9, message: { dataBytes: [38, 1] } });
            }, 0);
          }
          if (paramNumber === 299 && valueNumber === 228) {
            setTimeout(() => {
              instrumentInput.emit("nrpn", { channel: 1, message: { dataBytes: [38, 0] } });
            }, 0);
          }
          if (paramNumber === 299 && valueNumber === 229) {
            setTimeout(() => {
              instrumentInput.emit("nrpn", { channel: 1, message: { dataBytes: [38, 1] } });
            }, 0);
          }
        },
      };
    }

    const instrumentInput = createInput("LinnStrument Input");
    const instrumentOutput = createOutput("LinnStrument Output", instrumentInput);
    const loopOutput = createOutput("loopMIDI Port", instrumentInput);

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
