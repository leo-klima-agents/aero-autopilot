/**
 * Display formatting only — floats are fine here (plotting/analytics side of
 * the float boundary; exact accounting stays in core).
 */

/** Cumulative-return fraction → percent with precision that follows magnitude. */
export function fmtPct(x: number): string {
  const pct = x * 100;
  const abs = Math.abs(pct);
  const digits = abs >= 10 ? 1 : abs >= 0.1 ? 2 : 3;
  return `${pct.toFixed(digits)}%`;
}

export function fmtSignedPct(x: number): string {
  return `${x > 0 ? "+" : ""}${fmtPct(x)}`;
}

/** Turnover: total power-fractions moved, e.g. "2.4×". */
export function fmtTurns(x: number): string {
  return `${x >= 10 ? x.toFixed(0) : x.toFixed(2)}×`;
}

export function fmtDuration(sec: number): string {
  if (sec % 86_400 === 0 && sec >= 86_400) return `${sec / 86_400} d`;
  if (sec % 3600 === 0 && sec >= 3600) return `${sec / 3600} h`;
  if (sec % 60 === 0 && sec >= 60) return `${sec / 60} min`;
  return `${sec} s`;
}

/**
 * wad fraction string ↔ percent dial. WAD (1e18) = 100%, so 1% = 1e16 wad;
 * quantized at 1e13 wad (0.001%) so Number stays exact for slider values.
 */
export function wadToPct(wad: string): number {
  return Number(BigInt(wad) / 10n ** 13n) / 1000;
}

/** Percent number back to a wad decimal string (never a bigint in JSON). */
export function pctToWad(pct: number): string {
  return (BigInt(Math.round(pct * 1000)) * 10n ** 13n).toString();
}

/** Elapsed sim seconds → axis label in days or weeks. */
export function fmtElapsed(sec: number, unit: "d" | "wk"): string {
  return unit === "wk" ? `wk ${Math.round(sec / 604_800)}` : `d ${Math.round(sec / 86_400)}`;
}

export function shortPool(id: string): string {
  return id.replace(/^synthetic-pool-/, "pool-").replace(/^pool-/, "");
}
