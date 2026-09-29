export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function mean(values: number[]): number {
  return values.length ? sum(values) / values.length : 0;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1));
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
}

/** Einfache lineare Regression (kleinste Quadrate). */
export function linearRegression(points: { x: number; y: number }[]): Regression | null {
  if (points.length < 2) return null;
  const mx = mean(points.map((p) => p.x));
  const my = mean(points.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: my - slope * mx, r2 };
}

export function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

const nfCache = new Map<string, Intl.NumberFormat>();

/** Zahl im deutschen Format, z. B. 1.234,5 */
export function fmt(value: number, digits = 0): string {
  const key = String(digits);
  let nf = nfCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    nfCache.set(key, nf);
  }
  return nf.format(value);
}

/** Vorzeichenbehaftete Zahl, z. B. +2,5 oder −1 */
export function fmtSigned(value: number, digits = 0): string {
  const r = round(value, digits);
  if (r === 0) return fmt(0, digits);
  return (r > 0 ? '+' : '−') + fmt(Math.abs(r), digits);
}

export function pct(value: number, digits = 0): string {
  return `${fmt(value * 100, digits)} %`;
}

export function pctSigned(value: number, digits = 0): string {
  return `${fmtSigned(value * 100, digits)} %`;
}
