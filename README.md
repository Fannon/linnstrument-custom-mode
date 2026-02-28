# 🎹 LinnStrument Custom Mode

> **Play only the right notes.** A powerful browser-based "brain" for your [LinnStrument](https://www.rogerlinndesign.com/linnstrument) that redefines how you play, perform, and practice.

🚀 **[Try it live here!](https://fannon.github.io/linnstrument-custom-mode/)**

---

## ✨ Why LinnStrument Custom Mode?

The LinnStrument is a beautiful, expressive instrument, but its built-in firmware has its limits. Sometimes you want to:
- **Lock your grid to a specific scale** so you can never play a "wrong" note.
- **Experiment with unique layouts** like the whole-tone based *Midimech*.
- **Sync your hardware LEDs** to match your visual layout in real-time.
- **See what you're playing** on a large, high-resolution screen.

This project uses the **Web MIDI API** to act as a bridge between your hardware and your DAW, giving you a flexible, software-powered layer of control that's as expressive as the hardware itself.

---

## 🌟 Key Features

- 🎯 **Scale-Aware Remapping:** Every pad is intelligently mapped to your chosen scale. Skip the wrong notes and focus on the melody.
- 🎨 **LED Painting:** Your LinnStrument's LEDs are automatically "painted" to match the on-screen scale colors.
- 🌈 **Dynamic Color Themes:** The UI color theme matches your chosen LED colors, providing a consistent visual experience across screen and device.
- 🎸 **MPE & Expression:** Full support for MPE (MIDI Polyphonic Expression), including pitch bend, pressure, and timbre per note.
- 💡 **Lightguide Input:** Feed MIDI back into the app from your DAW to highlight notes on the grid—perfect for learning tracks or live visual feedback.
- 🛠️ **Seamless Integration:** Works with your existing DAW via virtual MIDI ports (like loopMIDI or IAC).

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
  main.js             # The "Brain" - orchestrates everything
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
