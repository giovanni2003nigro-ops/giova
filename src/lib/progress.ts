import type { Activity, ISODate, Sport, WorkoutSet } from '../types';
import { addDays, weekStart } from './dates';
import { paceSeconds, SPORT_DEFS } from './sports';
import { round } from './stats';
import { sessionsByExercise, type MetricType } from './training';

/**
 * Entwicklung über die Zeit: Gewicht, Kraft (e1RM je Übung) und Ausdauer
 * (Wochenumfang und Tempo je Sportart) – Grundlage für die Seite „Entwicklung“.
 */

export interface WeekVolumePoint {
  /** Montag der Woche */
  week: ISODate;
  km: number;
  count: number;
  durationSec: number;
}

/** Umfang pro Woche (letzte `weeks` Wochen inkl. der aktuellen), auch Wochen ohne Einheit. */
export function weeklyEndurance(activities: Activity[], sport: Sport, weeks: number, ref: ISODate): WeekVolumePoint[] {
  const first = addDays(weekStart(ref), -7 * (weeks - 1));
  const out: WeekVolumePoint[] = Array.from({ length: weeks }, (_, i) => ({ week: addDays(first, 7 * i), km: 0, count: 0, durationSec: 0 }));
  for (const a of activities) {
    if (a.sport !== sport || a.date < first || a.date > ref) continue;
    const idx = Math.floor((Date.parse(weekStart(a.date)) - Date.parse(first)) / (7 * 86400000));
    const w = out[idx];
    if (!w) continue;
    w.km += (a.distanceM ?? 0) / 1000;
    w.count++;
    w.durationSec += a.durationSec;
  }
  return out.map((w) => ({ ...w, km: round(w.km, 1) }));
}

export interface TempoPoint {
  x: ISODate;
  /** Tempo in der Einheit der Sportart: Minuten pro km/100 m/500 m, bei Rad km/h */
  y: number;
}

/** Tempo jeder Einheit (ab einer Mindestdistanz), damit Ausreißer wie Wege nicht zählen. */
export function tempoSeries(activities: Activity[], sport: Sport, from: ISODate): TempoPoint[] {
  const kind = SPORT_DEFS[sport].pace;
  if (!kind) return [];
  const minM = sport === 'schwimmen' ? 400 : 1000;
  const byDate = new Map<ISODate, TempoPoint>();
  for (const a of [...activities].sort((x, y) => x.startTime - y.startTime)) {
    if (a.sport !== sport || a.date < from || !a.distanceM || a.distanceM < minM || a.points === 0) continue;
    const y =
      kind === 'km/h' ? round(a.distanceM / 1000 / (a.durationSec / 3600), 1) : round((paceSeconds(kind, a.distanceM, a.durationSec) ?? 0) / 60, 2);
    if (y > 0) byDate.set(a.date, { x: a.date, y }); // mehrere am Tag → die letzte zählt
  }
  return [...byDate.values()];
}

export interface StrengthLine {
  exercise: string;
  /** e1RM (kg) bzw. max. Wiederholungen bei Körpergewicht */
  metricType: MetricType;
  points: { x: ISODate; y: number }[];
  first: number;
  last: number;
  best: number;
}

/** Kraftverlauf je Übung, sortiert nach Anzahl der Einheiten (häufigste zuerst). */
export function strengthLines(sets: WorkoutSet[], from: ISODate): StrengthLine[] {
  const out: StrengthLine[] = [];
  for (const [exercise, sessions] of sessionsByExercise(sets)) {
    const pts = sessions.filter((s) => s.date >= from).map((s) => ({ x: s.date, y: round(s.metric, 1) }));
    if (pts.length < 2) continue;
    out.push({
      exercise,
      metricType: sessions[sessions.length - 1].metricType,
      points: pts,
      first: pts[0].y,
      last: pts[pts.length - 1].y,
      best: Math.max(...pts.map((p) => p.y)),
    });
  }
  return out.sort((a, b) => b.points.length - a.points.length);
}

/** Ausdauer-Sportarten, die tatsächlich betrieben werden (meiste Einheiten zuerst). */
export function enduranceSports(activities: Activity[]): Sport[] {
  const n = new Map<Sport, number>();
  for (const a of activities) if (SPORT_DEFS[a.sport].distance) n.set(a.sport, (n.get(a.sport) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
}
