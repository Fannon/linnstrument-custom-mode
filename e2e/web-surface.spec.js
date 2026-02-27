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

test("incoming user-firmware MIDI sequence routes note, pressure, bend and timbre", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-13-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);

  await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("keyaftertouch", { note: { number: 3 }, channel: 4, rawValue: 61 });
    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });
    input.emit("controlchange", { controller: { number: 67 }, channel: 4, rawValue: 80 });
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });
  });

  const loopEvents = await page.evaluate(() =>
    window.__midiEvents.filter((event) => event.output === "loopMIDI Port")
  );
  expect(loopEvents.some((event) => event.type === "playNote" && event.channel === 1)).toBe(true);
  expect(loopEvents.some((event) => event.type === "stopNote" && event.channel === 1)).toBe(true);
  expect(loopEvents.some((event) => event.type === "cc" && event.channel === 1 && event.controller === 74)).toBe(true);
  expect(loopEvents.some((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xa0)).toBe(true); // poly aftertouch
  expect(loopEvents.some((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)).toBe(true); // pitch bend
});

test("non-MPE suppresses pitch bend while multiple notes are held", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-13-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);

  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("noteon", { note: { number: 4 }, channel: 4, rawVelocity: 100 });
    const beforeBendCount = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .length;

    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });

    const bendEvents = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));
    const afterBendEvents = bendEvents.slice(beforeBendCount);
    return {
      afterBendEvents,
      hasNonCenteredAfterBend: afterBendEvents.some((value) => value !== 8192),
    };
  });

  expect(analysis.afterBendEvents.length).toBeGreaterThanOrEqual(1);
  expect(analysis.hasNonCenteredAfterBend).toBe(false);
});

test("continuous slide keeps one note and bends only after X moves from initial touch", async ({ page }) => {
  await page.evaluate(() => {
    window.__midiEvents.length = 0;
    window.ext.config.userFirmwareSlideMode = "continuous";
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 30 }); // anchor capture (MSB)
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // anchor capture (LSB)
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 30 }); // still centered (MSB)
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // still centered (LSB)
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 45 }); // moved -> bend (MSB)
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // moved -> bend (LSB)

    input.emit("controlchange", { controller: { number: 119 }, channel: 4, rawValue: 3 });
    input.emit("noteon", { note: { number: 4 }, channel: 4, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 4 });

    input.emit("controlchange", { controller: { number: 119 }, channel: 4, rawValue: 4 });
    input.emit("noteon", { note: { number: 5 }, channel: 4, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: 4 }, channel: 4, rawVelocity: 5 });

    input.emit("noteoff", { note: { number: 5 }, channel: 4, rawVelocity: 0 });
  });

  const analysis = await page.evaluate(() => {
    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    const playNotes = loopEvents.filter((event) => event.type === "playNote");
    const stopNotes = loopEvents.filter((event) => event.type === "stopNote");
    const pitchBends = loopEvents
      .filter((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));
    return {
      playNoteCount: playNotes.length,
      stopNoteCount: stopNotes.length,
      firstStopMatchesFirstPlay: playNotes[0] && stopNotes[0]
        ? playNotes[0].noteNumber === stopNotes[0].noteNumber && playNotes[0].channel === stopNotes[0].channel
        : false,
      pitchBends,
    };
  });

  expect(analysis.playNoteCount).toBe(1);
  expect(analysis.stopNoteCount).toBe(1);
  expect(analysis.firstStopMatchesFirstPlay).toBe(true);
  expect(analysis.pitchBends.some((value) => value !== 8192)).toBe(true);
});

test("user-firmware X bend waits for coherent MSB/LSB pairs", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const readBends = () => window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 }); // center
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 20 }); // msb only
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 40 }); // msb only
    const afterMsbOnly = readBends();

    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // first coherent sample: anchor
    const afterAnchorPair = readBends();

    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 50 }); // msb only: no new bend
    const afterMovedMsbOnly = readBends();

    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // coherent moved sample
    const afterMovedPair = readBends();

    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });

    return {
      afterMsbOnly,
      afterAnchorPair,
      afterMovedMsbOnly,
      afterMovedPair,
    };
  });

  expect(analysis.afterMsbOnly.length).toBe(1); // note-on center only
  expect(analysis.afterAnchorPair.length).toBe(2); // anchor capture sends centered bend
  expect(analysis.afterMovedMsbOnly.length).toBe(2); // no bend until lsb counterpart
  expect(analysis.afterMovedPair.length).toBe(3);
  expect(analysis.afterMovedPair.at(-1)).not.toBe(8192);
});

test("MPE mode routes pressure and pitch bend to the allocated note channel", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("channelaftertouch", { channel: 4, rawValue: 71 });
    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });

    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    const play = loopEvents.find((event) => event.type === "playNote");
    const channelAftertouch = loopEvents.find((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xd0);
    const pitchBend = loopEvents.find((event) => event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0 && (((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0)) !== 8192);
    return {
      playChannel: play?.channel ?? null,
      pressureChannel: channelAftertouch ? ((channelAftertouch.data[0] & 0x0f) + 1) : null,
      bendChannel: pitchBend ? ((pitchBend.data[0] & 0x0f) + 1) : null,
    };
  });

  expect(analysis.playChannel).toBeGreaterThan(1);
  expect(analysis.pressureChannel).toBe(analysis.playChannel);
  expect(analysis.bendChannel).toBe(analysis.playChannel);
});

test("anchor deadband keeps pitch centered for tiny coherent X movement", async ({ page }) => {
  const bends = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 30 });
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // anchor pair
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 30 });
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 10 }); // delta 10 (inside deadband)
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });

    return window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));
  });

  expect(bends.length).toBeGreaterThanOrEqual(3);
  expect(bends.at(-1)).toBe(8192);
});

test("optional pitch bend smoothing limits per-update bend step", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    window.ext.config.userFirmwarePitchBendSmoothingEnabled = true;
    window.ext.config.userFirmwarePitchBendSmoothingStep14 = 64;

    const input = window.__instrumentInput;
    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 30 });
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // anchor
    input.emit("controlchange", { controller: { number: 3 }, channel: 4, rawValue: 80 });
    input.emit("controlchange", { controller: { number: 35 }, channel: 4, rawValue: 0 }); // large jump
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });

    const bends = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));
    const lastTwo = bends.slice(-2);
    return {
      bends,
      lastDelta: lastTwo.length === 2 ? Math.abs(lastTwo[1] - lastTwo[0]) : null,
    };
  });

  expect(analysis.bends.length).toBeGreaterThanOrEqual(3);
  expect(analysis.lastDelta).not.toBeNull();
  expect(analysis.lastDelta).toBeLessThanOrEqual(64);
});

test("same-pad X travel stays within vibrato range and does not reach adjacent note", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    window.ext.config.userFirmwarePitchBendSmoothingEnabled = false;
    window.ext.config.pitchSlideSemitonesPerPad = 1;
    window.ext.config.outputPitchBendRangeSemitones = 2;
    const input = window.__instrumentInput;

    const emitX14 = (column, channel, x14) => {
      const clamped = Math.max(0, Math.min(16383, Math.round(x14)));
      input.emit("controlchange", { controller: { number: column }, channel, rawValue: (clamped >> 7) & 0x7f });
      input.emit("controlchange", { controller: { number: column + 32 }, channel, rawValue: clamped & 0x7f });
    };

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    emitX14(3, 4, 1000); // anchor
    emitX14(3, 4, 1000 + 4265); // full local sweep while still on same pad

    const bendsBeforeRelease = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 0 });
    return {
      bendsBeforeRelease,
      movedBend: bendsBeforeRelease.at(-1) ?? null,
      movedDeltaFromCenter: bendsBeforeRelease.at(-1) == null ? null : Math.abs(bendsBeforeRelease.at(-1) - 8192),
    };
  });

  expect(analysis.bendsBeforeRelease.length).toBeGreaterThanOrEqual(3);
  expect(analysis.movedBend).not.toBeNull();
  // Keep same-pad motion within about half a semitone (bend range is ±2 semitones).
  expect(analysis.movedDeltaFromCenter).toBeLessThanOrEqual(2100);
});

test("multi-pad slide bend evolves continuously without large transition jumps", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    window.ext.config.userFirmwarePitchBendSmoothingEnabled = false;
    window.ext.config.userFirmwareSlideMode = "continuous";
    const input = window.__instrumentInput;

    const emitX14 = (column, channel, x14) => {
      const clamped = Math.max(0, Math.min(16383, Math.round(x14)));
      input.emit("controlchange", { controller: { number: column }, channel, rawValue: (clamped >> 7) & 0x7f });
      input.emit("controlchange", { controller: { number: column + 32 }, channel, rawValue: clamped & 0x7f });
    };

    input.emit("noteon", { note: { number: 3 }, channel: 4, rawVelocity: 100 });
    emitX14(3, 4, 3800); // near right edge on source pad
    input.emit("controlchange", { controller: { number: 119 }, channel: 4, rawValue: 3 });
    input.emit("noteon", { note: { number: 4 }, channel: 4, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: 3 }, channel: 4, rawVelocity: 4 });
    emitX14(4, 4, 400); // near left edge on target pad
    input.emit("noteoff", { note: { number: 4 }, channel: 4, rawVelocity: 0 });

    const bends = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));

    const maxConsecutiveDelta = bends.reduce((maxDelta, value, index) => {
      if (index === 0) return 0;
      return Math.max(maxDelta, Math.abs(value - bends[index - 1]));
    }, 0);

    return { bends, maxConsecutiveDelta };
  });

  expect(analysis.bends.length).toBeGreaterThanOrEqual(4);
  // A full-semitone step at ±2 semitone bend range is 4096. Transition should not exceed that by much.
  expect(analysis.maxConsecutiveDelta).toBeLessThanOrEqual(4300);
});
