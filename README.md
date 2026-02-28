# 🎹 LinnStrument Custom Mode

> An alternative layout and "Scale Mode" for the [LinnStrument](https://www.rogerlinndesign.com/linnstrument), inspired by Launchpad and Midimech layouts.

🚀 **[Try it live here!](https://fannon.github.io/linnstrument-custom-mode/)**

---

## What is this?

The LinnStrument is a beautiful, expressive instrument. This software provides an alternative way to map the pads and LEDs for more flexible playing:

- **Simplified Scale Playing:** Lock your grid to a specific scale. In Scale Mode, the grid only contains "in-scale" notes, making it impossible to hit a wrong note—just like a Launchpad's scale mode.
- **Fast Performance Overlays:** Use a dedicated "Ctl" pad to quickly pull up an overlay where you can change the root note, scale, or layout preset mid-performance.
- **Improved Feedback:** Hardware LEDs are fully synced to match the on-screen scale, and your DAW can send notes back to the grid for lightguide highlighting.
- **Alternative Layouts:** Includes *Midimech* (whole-tone columns with configurable row offset) and a highly configurable standard Scale Mode.


This project uses the **Web MIDI API** to act as a bridge between your hardware and your DAW, giving you a flexible, software-powered layer of control that's as expressive as the hardware itself.

---

## Key Features

- **Scale-Aware Remapping:** Every pad is remapped to your chosen scale. In scale mode, only in-scale notes are present on the grid.
- **Hardware Sync:** Your LinnStrument's LEDs are automatically updated to match the on-screen colors.
- **Dynamic Themes:** The app's UI color theme mirrors your chosen LED colors for a unified look.
- **Performance Overlay:** Quickly switch root note, scale, or layout preset during play via a dedicated control pad.
- **Full Expression:** Complete support for MPE (pitch bend, pressure, timbre) per note.
- **DAW Lightguide:** Feed MIDI from your DAW back into the app to highlight notes on the grid—useful for learning or visual feedback.


---

## 🚀 Getting Started

### 1. Requirements
- **Hardware:** A LinnStrument (128 or 200) connected via USB.
- **Software:** A modern browser with Web MIDI support (Chrome or Edge).
- **DAW Routing:** A virtual MIDI port for connecting to your DAW (e.g., [loopMIDI](https://www.tobias-erichsen.de/software/loopmidi.html) on Windows or IAC on macOS).

### 2. Connect Your Ports
Once you open the app, head to the **Connections** panel:

| Port | Description |
|---|---|
| **LinnStrument Input** | Receives your pad touches. |
| **LinnStrument Output** | Sends LED colors and hardware setup commands back to your device. |
| **MIDI Loop Output** | Where the "remapped" notes are sent to your DAW/Instruments. |
| **Lightguide Input** | (Optional) MIDI from your DAW to highlight pads on the screen. |

### 3. Setup Your Instrument
Click the **Restore** button in the app. This will send a few "NRPN" commands to your LinnStrument to ensure it's in the correct "No Overlap" mode and ready for custom control.

---

## 🎹 How to Play

### The Main Surface
Play on either your screen or your device! Both are perfectly synced.
- 🟧 **Orange Pads** are your Root notes.
- ⬜ **White Pads** are notes in your chosen scale.
- ⬛ **Dark/Empty Pads** are outside your scale (and are skipped in Scale mode).

### The Control Overlay 🛠️
Tap the **"Ctl"** pad (bottom-left) to toggle the **Control Overlay**. This transforms part of your grid into a settings dashboard where you can:
- **Change the Root Note** (C, C#, D...)
- **Select a Scale** (Major, Minor, Dorian, etc.)
- **Switch Presets** (Basic Scale vs. Midimech)
- **Toggle MPE Mode**

### Performance Row (Bottom)
The bottom row is always available for expressive control:
- **Mod Wheel (CC1):** Pads 1–13 are mapped to your mod wheel. They are pressure-sensitive!
- **Octave Shift:** The final two pads on the right shift your output range up or down.

---

## ⚙️ Advanced Customization

Adjust your performance settings in the **Advanced Settings** panel:
- **Pitch Bend Range:** Sync your DAW and hardware bend ranges (default is ±48 semitones).
- **Slide Sensitivity:** Control how many semitones are covered when sliding horizontally.
- **Row Offset:** Change the interval between rows (e.g., 4 scale degrees or 5 semitones).

---

## 🛠️ Technical Details & Development

This project is built with vanilla JavaScript—no heavy frameworks, just clean modules and high performance.

### Project Structure
```text
web/src/
  main.js             # App entry point, MIDI handlers, UI binding
  colors.js           # Handles UI color palettes and hardware sync
  config.js           # Manages your saved preferences
  core-logic.js       # The math behind scales, chords, and pitch bend
  grid.js             # Handles visual rendering and coordinate mapping
  layout-logic.js     # Defines how pads are assigned their roles
  control-overlay.js  # Manages the "Dashboard" overlay state
  mpe-routing.js      # Smart MPE voice and channel routing
  midi-io.js          # Hardware discovery and port management
  utils.js            # Shared utility functions (debounce, coordinate keys)
  instrument-sync.js  # Hardware-specific NRPN communication
  log.js              # UI and console logging utility
```

### Dev Commands
```bash
bun install           # Install dev tools (Biome, Playwright)
bun run start         # Launch local development server
bun run verify        # Run all checks (Lint, Tests, Build)
```

---

## 📜 References & License

- [LinnStrument Firmware Documentation](tmp/linnstrument-firmware/midi.md)
- [MIDI MPE Specification](tmp/MIDI%20MPE%20Spec.md)
- Inspired by the [Midimech](https://github.com/flipcoder/midimech) layout.

MIT License — Share, build, and play! 🎵
