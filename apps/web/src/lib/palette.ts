/**
 * Chart colors — dark-mode values from the dataviz reference palette,
 * validated against surface #1a1a19 (categorical checks pass; see styles.css
 * for the role definitions the rest of the UI uses). SVG presentation
 * attributes can't resolve CSS vars, so charts take these hexes directly.
 */
export const CHART = {
  /** Categorical slot 1 — the strategy (emphasis form: one hue + gray). */
  series1: "#3987e5",
  /** De-emphasis gray — the passive benchmark is context, not a competitor. */
  deemph: "#898781",
  surface: "#1a1a19",
  grid: "#2c2c2a",
  baseline: "#383835",
  muted: "#898781",
} as const;

/**
 * Sequential blue ramp for the allocation heatmap, anchor flipped for the dark
 * surface: near-zero recedes toward the surface (darkest step), max weight is
 * the lightest step. One hue, light↔dark — never a rainbow.
 */
export const HEAT_RAMP = [
  "#0d366b",
  "#104281",
  "#184f95",
  "#1c5cab",
  "#256abf",
  "#2a78d6",
  "#3987e5",
  "#5598e7",
  "#6da7ec",
  "#86b6ef",
  "#9ec5f4",
  "#cde2fb",
] as const;

export function heatColor(frac: number): string {
  const idx = Math.min(HEAT_RAMP.length - 1, Math.floor(frac * HEAT_RAMP.length));
  return HEAT_RAMP[Math.max(0, idx)]!;
}
