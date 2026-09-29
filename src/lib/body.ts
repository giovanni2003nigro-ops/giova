import type { ISODate, WeightEntry } from '../types';
import { addDays, diffDays } from './dates';
import { linearRegression, mean } from './stats';

export interface WeightTrend {
  latest: number;
  latestDate: ISODate;
  /** Durchschnitt der letzten 7 Tage */
  avg7: number;
  /** Veränderung in kg pro Woche (Regression), null wenn zu wenig Daten */
  ratePerWeek: number | null;
  entriesInWindow: number;
}

export function weightTrend(entries: WeightEntry[], ref: ISODate, windowDays = 21): WeightTrend | null {
  const sorted = entries.filter((e) => e.date <= ref).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length === 0) return null;
  const latest = sorted[sorted.length - 1];
  const last7 = sorted.filter((e) => e.date > addDays(ref, -7));
  const from = addDays(ref, -windowDays);
  const inWindow = sorted.filter((e) => e.date >= from);
  const span = inWindow.length ? diffDays(inWindow[0].date, inWindow[inWindow.length - 1].date) : 0;
  const reg =
    inWindow.length >= 4 && span >= 7
      ? linearRegression(inWindow.map((e) => ({ x: diffDays(from, e.date), y: e.weight })))
      : null;
  return {
    latest: latest.weight,
    latestDate: latest.date,
    avg7: last7.length ? mean(last7.map((e) => e.weight)) : latest.weight,
    ratePerWeek: reg ? reg.slope * 7 : null,
    entriesInWindow: inWindow.length,
  };
}

/** Gleitender Mittelwert über die letzten `window` Tage je Eintrag. */
export function movingAverage(entries: WeightEntry[], window = 7): { date: ISODate; value: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e) => {
    const from = addDays(e.date, -(window - 1));
    const vals = sorted.filter((x) => x.date >= from && x.date <= e.date).map((x) => x.weight);
    return { date: e.date, value: mean(vals) };
  });
}
