const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "linnstrumentCustomModeConfig";

async function pointerDownPad(page, selector, pointerId = 1) {
  await page
    .locator(selector)
    .first()
    .evaluate((el, pid) => {
      el.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerId: pid,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 1,
        }),
      );
    }, pointerId);
}

async function pointerUpPad(page, selector, pointerId = 1) {
  await page
    .locator(selector)
    .first()
    .evaluate((el, pid) => {
      el.dispatchEvent(
        new PointerEvent("pointerup", {
          bubbles: true,
          pointerId: pid,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: 0,
        }),
      );
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
      body: "/* Playwright: WebMIDI replaced by no-device stub */",
    });
  });

  await page.addInitScript(() => {
    window.WebMidi = {
      inputs: [],
      outputs: [],
      enable() {
        return Promise.resolve();
      },
      addListener() {
        return { remove() {} };
      },
      getInputByName() {
        return null;
      },
      getOutputByName() {
        return null;
      },
    };
  });

  await page.goto("/");
  await page.evaluate((storageKey) => {
    localStorage.removeItem(storageKey);
  }, STORAGE_KEY);
  await page.reload();
  await expect(page.locator("#visualization .cell").first()).toBeVisible();
});

test("app loads and renders surface without connected MIDI devices", async ({ page }) => {
  await expect(page.locator("#visualization .cell")).toHaveCount(128);
  await expect(page.locator("#routingStatus")).toHaveText("No LinnStrument input");
  await expect(page.locator("#routingStatus")).toHaveClass(/routing-not-ready/);
  await expect(page.locator("#instrumentInputPort")).toHaveValue("LinnStrument MIDI");
  await expect(page.locator("#instrumentOutputPort")).toHaveValue("LinnStrument MIDI");
  await expect(page.locator("#loopOutputPort")).toHaveValue("");
  await expect(page.locator("#loopInputPort")).toHaveValue("");
});

test("root and scale selectors update state and persist after reload", async ({ page }) => {
  await page.selectOption("#stateTonicSelect", "2");
  await page.selectOption("#stateScaleSelect", "minor");

  await expect(page.locator("#stateTonicSelect")).toHaveValue("2");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("minor");
  await expect.poll(async () => page.evaluate(() => window.ext?.config?.selectedKey)).toBe(2);
  await expect.poll(async () => page.evaluate(() => window.ext?.config?.selectedModeId)).toBe("minor");

  await page.reload();
  await expect(page.locator("#stateTonicSelect")).toHaveValue("2");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("minor");
});

test("mode buttons switch between scale mode and all-notes mode", async ({ page }) => {
  await expect(page.locator("#stateModeScaleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stateModeAllBtn")).toHaveAttribute("aria-pressed", "false");

  await page.click("#stateModeAllBtn");
  await expect(page.locator("#stateModeScaleBtn")).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#stateModeAllBtn")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.allNotesEnabled))).toBe(true);

  await page.click("#stateModeScaleBtn");
  await expect(page.locator("#stateModeScaleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stateModeAllBtn")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.allNotesEnabled))).toBe(false);
});

test("overlay can be toggled and used via web surface interaction", async ({ page }) => {
  await tapPad(page, "#cell-0-0");
  await expect(page.locator("#cell-0-1")).toHaveClass(/zone-key/);

  await tapPad(page, "#cell-2-1");
  await expect(page.locator("#stateTonicSelect")).toHaveValue("2");

  await tapPad(page, "#cell-1-2");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("minor");

  await tapPad(page, "#cell-0-0");
  await expect(page.locator("#cell-0-1")).not.toHaveClass(/zone-key/);
});

test("holding and releasing a play pad has a single routed note lifecycle", async ({ page }) => {
  const target = "#visualization .zone-play:not(.cell-disabled)";

  await pointerDownPad(page, target, 7);
  await expect
    .poll(async () => page.evaluate(() => window.ext?.state?.routedNotesByPad?.size ?? -1))
    .toBe(1);

  await pointerUpPad(page, target, 7);
  await expect
    .poll(async () => page.evaluate(() => window.ext?.state?.routedNotesByPad?.size ?? -1))
    .toBe(0);
});

test("reset defaults restores baseline state without MIDI hardware", async ({ page }) => {
  await page.selectOption("#stateTonicSelect", "7");
  await page.selectOption("#stateScaleSelect", "minor");
  await page.click("#stateModeAllBtn");

  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#resetConfig");

  await expect(page.locator("#stateTonicSelect")).toHaveValue("0");
  await expect(page.locator("#stateScaleSelect")).toHaveValue("major");
  await expect(page.locator("#stateModeScaleBtn")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#stateModeAllBtn")).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => page.evaluate(() => Boolean(window.ext?.config?.allNotesEnabled))).toBe(false);
});
