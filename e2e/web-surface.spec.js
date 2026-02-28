const { test, expect } = require("@playwright/test");

function decode7BitPair(value) {
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  return ((value[0] & 0x7f) << 7) | (value[1] & 0x7f);
}

function isNrpnRequest(event, paramNumber, valueNumber) {
  if (!event || event.output !== "LinnStrument Output" || event.type !== "nrpn-send") {
    return false;
  }
  return decode7BitPair(event.param) === paramNumber && decode7BitPair(event.value) === valueNumber;
}

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
    const loopInput = createInput("loopMIDI Port");
    const instrumentOutput = createOutput("LinnStrument Output");
    const loopOutput = createOutput("loopMIDI Port");
    window.__instrumentInput = instrumentInput;
    window.__loopInput = loopInput;

    window.WebMidi = {
      inputs: [instrumentInput, loopInput],
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
    window.__startupMidiEvents = [...window.__midiEvents];
    window.__midiEvents.length = 0;
  });
});

test("startup and reset request LinnStrument standard no-overlap layout", async ({ page }) => {
  const startupEvents = await page.evaluate(() => window.__startupMidiEvents || []);
  expect(startupEvents.some((event) => event.output === "LinnStrument Output" && event.type === "nrpn-send")).toBe(true);
  expect(startupEvents.some((event) => isNrpnRequest(event, 245, 0))).toBe(true); // UF off
  expect(startupEvents.some((event) => isNrpnRequest(event, 200, 0))).toBe(true); // split off
  expect(startupEvents.some((event) => isNrpnRequest(event, 227, 0))).toBe(true); // no overlap
  expect(startupEvents.some((event) => isNrpnRequest(event, 36, 3))).toBe(true); // octave for note 0 base
  expect(startupEvents.some((event) => isNrpnRequest(event, 37, 1))).toBe(true); // transpose for note 0 base
  expect(startupEvents.some((event) => isNrpnRequest(event, 0, 1))).toBe(true); // MIDI Mode = Channel Per Note (MPE on default)
  expect(startupEvents.some((event) => isNrpnRequest(event, 1, 1))).toBe(true); // Main channel = 1

  await page.evaluate(() => {
    window.__midiEvents.length = 0;
  });
  await page.click("#resetConfig");

  await expect.poll(async () => {
    const events = await page.evaluate(() => window.__midiEvents || []);
    return (
      events.some((event) => isNrpnRequest(event, 245, 0))
      && events.some((event) => isNrpnRequest(event, 200, 0))
      && events.some((event) => isNrpnRequest(event, 227, 0))
      && events.some((event) => isNrpnRequest(event, 36, 3))
      && events.some((event) => isNrpnRequest(event, 37, 1))
      && events.some((event) => isNrpnRequest(event, 0, 1))
      && events.some((event) => isNrpnRequest(event, 1, 1))
    );
  }).toBe(true);
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

test("noteon with zero velocity is handled as noteoff and does not leave a stuck note", async ({ page }) => {
  const lifecycle = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 0);
    const physicalPadNote = base + 16; // x=0,y=1 playable cell in no-overlap layout

    input.emit("noteon", { note: { number: physicalPadNote }, channel: 3, rawVelocity: 100 });
    input.emit("noteon", { note: { number: physicalPadNote }, channel: 3, rawVelocity: 0 });

    const routed = window.__midiEvents.filter((event) =>
      event.output === "loopMIDI Port" && (event.type === "playNote" || event.type === "stopNote"));

    return {
      routed,
      activeLoopNotes: window.ext?.state?.activeLoopNotes?.size ?? -1,
      routedNotesByPad: window.ext?.state?.routedNotesByPad?.size ?? -1,
    };
  });

  const noteOn = lifecycle.routed.find((event) => event.type === "playNote");
  const noteOff = lifecycle.routed.find((event) => event.type === "stopNote");
  expect(noteOn).toBeTruthy();
  expect(noteOff).toBeTruthy();
  expect(noteOn.noteNumber).toBe(noteOff.noteNumber);
  expect(noteOn.channel).toBe(noteOff.channel);
  expect(lifecycle.activeLoopNotes).toBe(0);
  expect(lifecycle.routedNotesByPad).toBe(0);
});

test("real mouse click on a play pad triggers note lifecycle", async ({ page }) => {
  await page.evaluate(() => {
    window.__midiEvents.length = 0;
  });

  await page.locator("#visualization .zone-play:not(.cell-disabled)").first().click();

  const events = await page.evaluate(() =>
    window.__midiEvents.filter((event) => event.output === "loopMIDI Port" && (event.type === "playNote" || event.type === "stopNote"))
  );
  expect(events.some((event) => event.type === "playNote")).toBe(true);
  expect(events.some((event) => event.type === "stopNote")).toBe(true);
});

test("play pads render note name with octave on second line", async ({ page }) => {
  const firstPlayPad = page.locator("#visualization .zone-play:not(.cell-disabled)").first();
  const labelText = await firstPlayPad.locator(".cell-label").innerText();
  expect(labelText.trim()).toMatch(/^[A-G]#?$/);
  const octaveText = await firstPlayPad.locator(".cell-sub-label").innerText();
  expect(octaveText.trim()).toMatch(/^-?\d+$/);
});

test("root play pads are visually distinct from non-root play pads", async ({ page }) => {
  const colors = await page.evaluate(() => {
    const rootPad = document.querySelector("#visualization .zone-play.cell-root");
    const nonRootPad = document.querySelector("#visualization .zone-play:not(.cell-root)");
    if (!rootPad || !nonRootPad) {
      return null;
    }
    const rootBg = window.getComputedStyle(rootPad).backgroundColor;
    const nonRootBg = window.getComputedStyle(nonRootPad).backgroundColor;
    return { rootBg, nonRootBg };
  });
  expect(colors).toBeTruthy();
  expect(colors.rootBg).not.toBe(colors.nonRootBg);
});

test("all-notes mode still marks root notes and greys out out-of-scale notes", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-15-2");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.allNotesEnabled))).toBe(true);

  const analysis = await page.evaluate(() => {
    const rootCount = document.querySelectorAll("#visualization .zone-play.cell-root").length;
    const outOfScaleCount = document.querySelectorAll("#visualization .zone-play.cell-out-of-scale").length;
    const inScaleCount = document.querySelectorAll("#visualization .zone-play.cell-in-scale").length;
    return { rootCount, outOfScaleCount, inScaleCount };
  });

  expect(analysis.rootCount).toBeGreaterThan(0);
  expect(analysis.outOfScaleCount).toBeGreaterThan(0);
  expect(analysis.inScaleCount).toBeGreaterThan(0);
});

test("overlay toggle exposes controls and allows root + scale selection", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await expect(page.locator("#cell-0-1")).toHaveClass(/zone-key/);

  await tapPad(page, "#cell-2-1");
  await expect(page.locator("#stateTonicSelect")).toHaveValue("2");

  await tapPad(page, "#cell-1-2");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("minor");
});

test("overlay trigger toggles reliably even if noteoff channel differs from noteon", async ({ page }) => {
  const toggles = await page.evaluate(() => {
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 0);
    const triggerNote = base; // coord 0-0

    input.emit("noteon", { note: { number: triggerNote }, channel: 2, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: triggerNote }, channel: 3, rawVelocity: 0 });
    const afterFirstTap = Boolean(window.ext?.state?.controlOverlay?.pinned);

    input.emit("noteon", { note: { number: triggerNote }, channel: 2, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: triggerNote }, channel: 3, rawVelocity: 0 });
    const afterSecondTap = Boolean(window.ext?.state?.controlOverlay?.pinned);

    return { afterFirstTap, afterSecondTap };
  });

  expect(toggles.afterFirstTap).toBe(true);
  expect(toggles.afterSecondTap).toBe(false);
});

test("selecting root note sends panic even when selecting current root", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 0);
    const heldPlayNote = base + 16; // x=0,y=1 playable cell

    input.emit("noteon", { note: { number: heldPlayNote }, channel: 4, rawVelocity: 100 });
    return {
      beforeRootSelectPlayCount: window.__midiEvents.filter((event) => event.output === "loopMIDI Port" && event.type === "playNote").length,
    };
  });
  expect(analysis.beforeRootSelectPlayCount).toBeGreaterThanOrEqual(1);

  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-0-1"); // C root, already selected by default

  const post = await page.evaluate(() => {
    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    return {
      hasAllNotesOffCc: loopEvents.some((event) => event.type === "cc" && event.controller === 123),
      hasAllSoundOffCc: loopEvents.some((event) => event.type === "cc" && event.controller === 120),
    };
  });

  expect(post.hasAllNotesOffCc).toBe(true);
  expect(post.hasAllSoundOffCc).toBe(true);
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
  await tapPad(page, "#cell-15-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);
  await tapPad(page, "#visualization .zone-play:not(.cell-disabled)");

  const nextPlay = await page.evaluate(() =>
    window.__midiEvents.find((event) => event.output === "loopMIDI Port" && event.type === "playNote")
  );
  expect(nextPlay).toBeTruthy();
  expect(nextPlay.channel).toBe(1);

  const nrpnEvents = await page.evaluate(() =>
    window.__midiEvents.filter((event) => event.output === "LinnStrument Output" && event.type === "nrpn-send")
  );
  expect(nrpnEvents.some((event) => isNrpnRequest(event, 0, 0))).toBe(true); // MIDI Mode = One Channel
  expect(nrpnEvents.some((event) => isNrpnRequest(event, 1, 1))).toBe(true); // Main channel = 1
});

test("incoming standard MIDI routes note, pressure, bend, and timbre in MPE", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 30);
    const note = base + 3 + (3 * 16);

    input.emit("noteon", { note: { number: note }, channel: 4, rawVelocity: 100 });
    input.emit("keyaftertouch", { note: { number: note }, channel: 4, rawValue: 61 });
    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });
    input.emit("controlchange", { controller: { number: 74 }, channel: 4, rawValue: 80 });
    input.emit("noteoff", { note: { number: note }, channel: 4, rawVelocity: 0 });

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

test("horizontal slide setting scales incoming hardware pitch bend", async ({ page }) => {
  const run = async (settingValue) => page.evaluate((value) => {
    window.__midiEvents.length = 0;
    window.ext.config.pitchSlideSemitonesPerPad = Number(value);
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 30);
    const note = base + 2 + (2 * 16);

    input.emit("noteon", { note: { number: note }, channel: 3, rawVelocity: 100 });
    input.emit("pitchbend", { channel: 3, dataBytes: [0, 72] });
    input.emit("noteoff", { note: { number: note }, channel: 3, rawVelocity: 0 });

    const bends = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0))
      .filter((value14) => value14 !== 8192);
    return bends.length > 0 ? bends[bends.length - 1] : null;
  }, settingValue);

  const bendAtHalf = await run(0.5);
  const bendAtTwo = await run(2);

  expect(bendAtHalf).toBeTruthy();
  expect(bendAtTwo).toBeTruthy();

  const deltaHalf = Math.abs(bendAtHalf - 8192);
  const deltaTwo = Math.abs(bendAtTwo - 8192);
  expect(deltaHalf).toBeGreaterThan(0);
  expect(deltaTwo / deltaHalf).toBeGreaterThan(3.7);
  expect(deltaTwo / deltaHalf).toBeLessThan(4.3);
});

test("same note number maps to same grid note even when input channel changes", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 30);
    const note = base + 3 + (3 * 16); // cell 3-3 in no-overlap mapping

    input.emit("noteon", { note: { number: note }, channel: 3, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: note }, channel: 3, rawVelocity: 0 });
    input.emit("noteon", { note: { number: note }, channel: 8, rawVelocity: 100 });
    input.emit("noteoff", { note: { number: note }, channel: 8, rawVelocity: 0 });

    const playEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port" && event.type === "playNote");
    return {
      count: playEvents.length,
      notes: playEvents.map((event) => event.noteNumber),
    };
  });

  expect(analysis.count).toBe(2);
  expect(analysis.notes[0]).toBe(analysis.notes[1]);
});

test("backchannel note input highlights and releases matching play pads", async ({ page }) => {
  await page.selectOption("#loopInputPort", "loopMIDI Port");
  await expect.poll(async () => page.evaluate(() => window.ext?.midi?.loopInput?.name || "")).toBe("loopMIDI Port");

  const target = await page.evaluate(() => {
    const first = Object.entries(window.ext?.layout?.padMap || {})
      .find(([_coord, pad]) => pad?.role === "play-note");
    if (!first) {
      return null;
    }
    const [coord, pad] = first;
    window.__loopInput.emit("noteon", { note: { number: pad.outNote }, channel: 1, rawVelocity: 100 });
    return coord;
  });
  expect(target).toBeTruthy();
  await expect(page.locator(`#cell-${target}`)).toHaveClass(/cell-held/);

  await page.evaluate((coord) => {
    const note = window.ext?.layout?.padMap?.[coord]?.outNote;
    window.__loopInput.emit("noteoff", { note: { number: note }, channel: 1, rawVelocity: 0 });
  }, target);
  await expect(page.locator(`#cell-${target}`)).not.toHaveClass(/cell-held/);
});

test("noteoff still releases routed note when pad mapping changes mid-note", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 0);
    const note = base + 3 + (3 * 16);

    input.emit("noteon", { note: { number: note }, channel: 4, rawVelocity: 100 });
    window.ext.config.deviceStartNote = (base + 1) % 128; // simulate transient mapping drift
    input.emit("noteoff", { note: { number: note }, channel: 4, rawVelocity: 0 });

    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    const play = loopEvents.find((event) => event.type === "playNote");
    const stop = loopEvents.find((event) => event.type === "stopNote");
    return {
      hasPlay: Boolean(play),
      hasStop: Boolean(stop),
      sameChannel: play && stop ? play.channel === stop.channel : false,
    };
  });

  expect(analysis.hasPlay).toBe(true);
  expect(analysis.hasStop).toBe(true);
  expect(analysis.sameChannel).toBe(true);
});

test("wrapped top-row notes still map and route correctly", async ({ page }) => {
  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 30);
    const wrappedTopRowNote = (base + (7 * 16) + 3) % 128;

    input.emit("noteon", { note: { number: wrappedTopRowNote }, channel: 6, rawVelocity: 96 });
    input.emit("noteoff", { note: { number: wrappedTopRowNote }, channel: 6, rawVelocity: 0 });

    const loopEvents = window.__midiEvents.filter((event) => event.output === "loopMIDI Port");
    return {
      playCount: loopEvents.filter((event) => event.type === "playNote").length,
      stopCount: loopEvents.filter((event) => event.type === "stopNote").length,
    };
  });

  expect(analysis.playCount).toBe(1);
  expect(analysis.stopCount).toBe(1);
});

test("non-MPE mode routes notes to channel 1, keeps poly-aftertouch, and suppresses multi-note bend", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await tapPad(page, "#cell-15-1");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.mpeEnabled))).toBe(false);

  const analysis = await page.evaluate(() => {
    window.__midiEvents.length = 0;
    const input = window.__instrumentInput;
    const base = Number(window.ext?.config?.deviceStartNote ?? 30);
    const noteA = base + 3 + (3 * 16);
    const noteB = noteA + 1;

    input.emit("noteon", { note: { number: noteA }, channel: 4, rawVelocity: 100 });
    input.emit("keyaftertouch", { note: { number: noteA }, channel: 4, rawValue: 71 });
    input.emit("noteon", { note: { number: noteB }, channel: 4, rawVelocity: 100 });

    const bendCountBefore = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .length;

    input.emit("pitchbend", { channel: 4, dataBytes: [0, 96] });

    const newBendValues = window.__midiEvents
      .filter((event) => event.output === "loopMIDI Port" && event.type === "raw" && (event.data?.[0] & 0xf0) === 0xe0)
      .slice(bendCountBefore)
      .map((event) => ((event.data?.[2] || 0) << 7) | (event.data?.[1] || 0));

    input.emit("noteoff", { note: { number: noteA }, channel: 4, rawVelocity: 0 });
    input.emit("noteoff", { note: { number: noteB }, channel: 4, rawVelocity: 0 });

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
