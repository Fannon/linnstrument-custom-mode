const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

function mergeRanges(ranges = []) {
  if (ranges.length === 0) {
    return [];
  }
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      last.end = Math.max(last.end, current.end);
      continue;
    }
    merged.push({ ...current });
  }
  return merged;
}

function coveredRatio(entry) {
  const ranges = [];
  const textLength = Math.max(1, entry.text?.length || 0);
  for (const fn of entry.functions || []) {
    for (const r of fn.ranges || []) {
      if (r.count > 0) {
        const rawStart = Number.isFinite(r.startOffset) ? r.startOffset : r.start;
        const rawEnd = Number.isFinite(r.endOffset) ? r.endOffset : r.end;
        const start = Math.max(0, Math.min(textLength, Number(rawStart) || 0));
        const end = Math.max(0, Math.min(textLength, Number(rawEnd) || 0));
        ranges.push({ start, end });
      }
    }
  }
  const merged = mergeRanges(ranges);
  const coveredChars = merged.reduce((sum, range) => sum + Math.max(0, range.end - range.start), 0);
  return coveredChars / textLength;
}

test("captures executable coverage for main.js interactions", async ({ page }, testInfo) => {
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

  await page.coverage.startJSCoverage({ reportAnonymousScripts: false });
  await page.goto("/");
  await expect(page.locator("#visualization .cell").first()).toBeVisible();

  await page.locator("#cell-0-0").first().evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "mouse", button: 0, buttons: 0 }));
  });
  await page.locator("#cell-2-1").first().evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, pointerType: "mouse", button: 0, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2, pointerType: "mouse", button: 0, buttons: 0 }));
  });
  await page.locator("#cell-1-2").first().evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 3, pointerType: "mouse", button: 0, buttons: 1 }));
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 3, pointerType: "mouse", button: 0, buttons: 0 }));
  });
  await page.evaluate(() => {
    const input = window.__instrumentInput;
    input.emit("noteon", { note: { number: 4 }, channel: 3, rawVelocity: 99 });
    input.emit("keyaftertouch", { note: { number: 4 }, channel: 3, rawValue: 70 });
    input.emit("controlchange", { controller: { number: 68 }, channel: 3, rawValue: 90 });
    input.emit("pitchbend", { channel: 3, dataBytes: [32, 96] });
    input.emit("noteoff", { note: { number: 4 }, channel: 3, rawVelocity: 0 });
  });

  const coverageEntries = await page.coverage.stopJSCoverage();
  const mainEntry = coverageEntries.find((entry) => /\/src\/main\.js(?:\?|$)/.test(entry.url || ""));
  expect(mainEntry).toBeTruthy();

  const ratio = coveredRatio(mainEntry);
  const report = {
    url: mainEntry.url,
    percentCovered: Number((ratio * 100).toFixed(2)),
    totalScripts: coverageEntries.length,
  };

  const outputPath = testInfo.outputPath("main-coverage.json");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  fs.mkdirSync(path.resolve("test-results"), { recursive: true });
  fs.writeFileSync(path.resolve("test-results/main-coverage.json"), JSON.stringify(report, null, 2));
  console.log(`main.js executed coverage: ${report.percentCovered}%`);

  expect(ratio).toBeGreaterThan(0.2);
});
