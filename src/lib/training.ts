import type { Exercise, ISODate, WorkoutSet } from '../types';
import { addDays, diffDays, weekStart } from './dates';
import { fmt, linearRegression, mean, round } from './stats';

/**
 * Geschätztes 1RM nach Epley. Wiederholungen über 15 werden gedeckelt,
 * weil die Formel dort stark überschätzt.
 */
export function estimate1RM(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + Math.min(reps, 15) / 30);
}

export type MetricType = 'e1rm' | 'reps';

export interface SessionSummary {
  date: ISODate;
  exercise: string;
  sets: number;
  totalReps: number;
  /** Volumen = Σ Gewicht × Wiederholungen */
  volume: number;
  topWeight: number;
  topReps: number;
  bestE1RM: number;
  maxReps: number;
  /** Leistungskennzahl: e1RM (mit Gewicht) oder max. Wiederholungen (Körpergewicht) */
  metric: number;
  metricType: MetricType;
}

export function summarizeSession(date: ISODate, exercise: string, sets: WorkoutSet[]): SessionSummary {
  let topWeight = 0;
  let topReps = 0;
  let bestE1RM = 0;
  let maxReps = 0;
  let volume = 0;
  let totalReps = 0;
  for (const s of sets) {
    volume += s.weight * s.reps;
    totalReps += s.reps;
    maxReps = Math.max(maxReps, s.reps);
    bestE1RM = Math.max(bestE1RM, estimate1RM(s.weight, s.reps));
    if (s.weight > topWeight || (s.weight === topWeight && s.reps > topReps)) {
      topWeight = s.weight;
      topReps = s.reps;
    }
  }
  const metricType: MetricType = topWeight > 0 ? 'e1rm' : 'reps';
  return {
    date,
    exercise,
    sets: sets.length,
    totalReps,
    volume,
    topWeight,
    topReps,
    bestE1RM,
    maxReps,
    metric: metricType === 'e1rm' ? bestE1RM : maxReps,
    metricType,
  };
}

/** Gruppiert Sätze nach Übung → chronologische Liste von Einheiten. */
export function sessionsByExercise(sets: WorkoutSet[]): Map<string, SessionSummary[]> {
  const grouped = new Map<string, Map<ISODate, WorkoutSet[]>>();
  for (const s of sets) {
    let byDate = grouped.get(s.exercise);
    if (!byDate) grouped.set(s.exercise, (byDate = new Map()));
    const list = byDate.get(s.date);
    if (list) list.push(s);
    else byDate.set(s.date, [s]);
  }
  const out = new Map<string, SessionSummary[]>();
  for (const [exercise, byDate] of grouped) {
    const sessions = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => summarizeSession(date, exercise, list));
    out.set(exercise, sessions);
  }
  return out;
}

export type TrendStatus = 'zu-wenig-daten' | 'starker-fortschritt' | 'fortschritt' | 'stagnation' | 'rueckgang';

export const TREND_LABELS: Record<TrendStatus, string> = {
  'zu-wenig-daten': 'Zu wenig Daten',
  'starker-fortschritt': 'Starker Fortschritt',
  fortschritt: 'Fortschritt',
  stagnation: 'Stagnation',
  rueckgang: 'Rückgang',
};

export interface ExerciseTrend {
  exercise: string;
  metricType: MetricType;
  sessionsInWindow: number;
  totalSessions: number;
  current: number;
  best: number;
  bestDate: ISODate;
  lastDate: ISODate;
  /** Veränderung der Kennzahl pro Woche (kg e1RM bzw. Wdh.) */
  slopePerWeek: number;
  /** Relative Veränderung pro Woche (0.01 = 1 %) */
  pctPerWeek: number;
  weeksSinceBest: number;
  status: TrendStatus;
}

/**
 * Bewertet den Verlauf einer Übung über ein Zeitfenster (Standard 8 Wochen)
 * per linearer Regression der Leistungskennzahl.
 */
export function exerciseTrend(sessions: SessionSummary[], ref: ISODate, windowDays = 56): ExerciseTrend | null {
  if (sessions.length === 0) return null;
  const last = sessions[sessions.length - 1];
  const metricType = last.metricType;
  const comparable = sessions.filter((s) => s.metricType === metricType);
  const from = addDays(ref, -windowDays);
  const inWindow = comparable.filter((s) => s.date >= from && s.date <= ref);

  let best = comparable[0];
  for (const s of comparable) if (s.metric >= best.metric) best = s;

  const base: Omit<ExerciseTrend, 'status' | 'slopePerWeek' | 'pctPerWeek'> = {
    exercise: last.exercise,
    metricType,
    sessionsInWindow: inWindow.length,
    totalSessions: sessions.length,
    current: last.metric,
    best: best.metric,
    bestDate: best.date,
    lastDate: last.date,
    weeksSinceBest: diffDays(best.date, ref) / 7,
  };

  const span = inWindow.length ? diffDays(inWindow[0].date, inWindow[inWindow.length - 1].date) : 0;
  const reg = linearRegression(inWindow.map((s) => ({ x: diffDays(from, s.date), y: s.metric })));
  if (inWindow.length < 3 || span < 10 || !reg) {
    return { ...base, slopePerWeek: 0, pctPerWeek: 0, status: 'zu-wenig-daten' };
  }

  const slopePerWeek = reg.slope * 7;
  const avg = mean(inWindow.map((s) => s.metric));
  const pctPerWeek = avg > 0 ? slopePerWeek / avg : 0;

  let status: TrendStatus;
  if (pctPerWeek >= 0.01) status = 'starker-fortschritt';
  else if (pctPerWeek >= 0.0025) status = 'fortschritt';
  else if (pctPerWeek > -0.005) status = 'stagnation';
  else status = 'rueckgang';
  // Leichter positiver Trend, aber seit >4 Wochen kein neuer Bestwert → Stagnation
  if (status === 'fortschritt' && base.weeksSinceBest >= 4) status = 'stagnation';

  return { ...base, slopePerWeek, pctPerWeek, status };
}

export function formatMetric(value: number, type: MetricType): string {
  return type === 'e1rm' ? `${fmt(value, 1)} kg` : `${fmt(value)} Wdh.`;
}

/** Alle Trainingstage (sortiert) im Zeitraum. */
export function trainingDays(sets: WorkoutSet[], from: ISODate, to: ISODate): ISODate[] {
  return [...new Set(sets.filter((s) => s.date >= from && s.date <= to).map((s) => s.date))].sort();
}

export interface WeekVolume {
  week: ISODate;
  volume: number;
  sets: number;
  days: number;
}

export function weeklyVolume(sets: WorkoutSet[], weeks: number, ref: ISODate): WeekVolume[] {
  const firstWeek = addDays(weekStart(ref), -7 * (weeks - 1));
  const rows = new Map<ISODate, { volume: number; sets: number; days: Set<ISODate> }>();
  for (let i = 0; i < weeks; i++) rows.set(addDays(firstWeek, i * 7), { volume: 0, sets: 0, days: new Set() });
  for (const s of sets) {
    const row = rows.get(weekStart(s.date));
    if (!row) continue;
    row.volume += s.weight * s.reps;
    row.sets += 1;
    row.days.add(s.date);
  }
  return [...rows.entries()].map(([week, r]) => ({ week, volume: r.volume, sets: r.sets, days: r.days.size }));
}

export function setsPerMuscleGroup(
  sets: WorkoutSet[],
  exercises: Exercise[],
  from: ISODate,
  to: ISODate,
): Map<string, number> {
  const groupOf = new Map(exercises.map((e) => [e.name.toLowerCase(), e.muscleGroup as string]));
  const out = new Map<string, number>();
  for (const s of sets) {
    if (s.date < from || s.date > to) continue;
    const g = groupOf.get(s.exercise.toLowerCase()) ?? 'Sonstiges';
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/**
 * Doppelte Progression: Vorschlag für die nächste Einheit auf Basis der letzten.
 */
export function progressionSuggestion(last: SessionSummary | undefined): string | null {
  if (!last) return null;
  if (last.metricType === 'reps') {
    return `Ziel: ${last.maxReps + 1} Wiederholungen im besten Satz (oder mit Zusatzgewicht starten).`;
  }
  const w = last.topWeight;
  const step = w >= 60 ? 2.5 : w >= 20 ? 2 : 1;
  if (last.topReps >= 12) {
    return `Gewicht steigern: ${fmt(w + step, 1)} kg × ${Math.max(6, last.topReps - 4)} Wdh. anpeilen.`;
  }
  return `Ziel: ${fmt(w, 1)} kg × ${last.topReps + 1} Wdh. – oder ${fmt(w + step, 1)} kg × ${last.topReps}.`;
}

/** Prüft, ob ein Satz einen neuen Bestwert (e1RM bzw. Wdh.) darstellt. */
export function isPersonalRecord(set: Pick<WorkoutSet, 'weight' | 'reps'>, previous: WorkoutSet[]): boolean {
  if (previous.length === 0) return false;
  if (set.weight > 0) {
    const prevBest = Math.max(...previous.map((s) => estimate1RM(s.weight, s.reps)));
    return estimate1RM(set.weight, set.reps) > prevBest + 0.01;
  }
  if (previous.some((s) => s.weight > 0)) return false;
  return set.reps > Math.max(...previous.map((s) => s.reps));
}

export interface SessionPerformance {
  date: ISODate;
  /** Mittlere relative Veränderung ggü. der jeweils vorherigen Einheit derselben Übung */
  change: number;
  exercises: number;
}

/**
 * Leistung je Trainingstag: Für jede Übung wird die Kennzahl mit der vorherigen
 * Einheit derselben Übung verglichen; der Tageswert ist der Mittelwert.
 */
export function sessionPerformance(sets: WorkoutSet[]): SessionPerformance[] {
  const byDate = new Map<ISODate, number[]>();
  for (const sessions of sessionsByExercise(sets).values()) {
    for (let i = 1; i < sessions.length; i++) {
      const prev = sessions[i - 1];
      const cur = sessions[i];
      if (prev.metricType !== cur.metricType || prev.metric <= 0) continue;
      // Pausen über 6 Wochen verzerren den Vergleich
      if (diffDays(prev.date, cur.date) > 42) continue;
      const list = byDate.get(cur.date) ?? [];
      list.push(cur.metric / prev.metric - 1);
      byDate.set(cur.date, list);
    }
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, changes]) => ({ date, change: mean(changes), exercises: changes.length }));
}

export function roundKg(v: number): number {
  return round(v, 1);
}
