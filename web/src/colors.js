const UI_LED_COLOR_BY_VALUE = {
  0: "#ffffff",
  1: "#e94a3c",
  2: "#f1c644",
  3: "#6cbf43",
  4: "#4fc3d9",
  5: "#4d78d8",
  6: "#c45ad9",
  7: "#ffffff",
  8: "#f0eae0",
  9: "#f39a42",
  10: "#9bd447",
  11: "#ee86b7",
};

export function resolveUiLedColor(led) {
  return UI_LED_COLOR_BY_VALUE[led] || UI_LED_COLOR_BY_VALUE[7];
}

export function getUiTextTone(led, hexColor) {
  if (led === 0 || led === 7) {
    return {
      text: "rgba(31, 36, 48, 0.32)",
      subtext: "rgba(31, 36, 48, 0.26)",
    };
  }

  const text = getReadableTextColor(hexColor);
  return {
    text,
    subtext: text === "#f7fff9" ? "rgba(247, 255, 249, 0.82)" : "rgba(31, 36, 48, 0.7)",
  };
}

export function withAlpha(hexColor, alpha = 1) {
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return `rgba(31, 36, 48, ${alpha})`;
  }
  const [r, g, b] = rgb;
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha))})`;
}

function getReadableTextColor(hexColor) {
  const rgb = parseHexColor(hexColor);
  if (!rgb) {
    return "#1f2430";
  }
  const [r, g, b] = rgb;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma < 0.56 ? "#f7fff9" : "#1f2430";
}

function parseHexColor(hexColor) {
  const value = String(hexColor || "").trim();
  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match) {
    return null;
  }
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  if (![r, g, b].every((n) => Number.isFinite(n))) {
    return null;
  }
  return [r, g, b];
}
