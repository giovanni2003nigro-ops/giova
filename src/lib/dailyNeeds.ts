import type {
  Activity,
  DayKind,
  Goals,
  Intensity,
  ISODate,
  Macros,
  PlannedSession,
  Profile,
  ScheduleDay,
  Sport,
  TrainingPlan,
  WeekSchedule,
  Weekday,
} from '../types';
import { addDays, minutesToTime, parseISODate, timeToMinutes, weekStart } from './dates';
import { bmr, KCAL_PER_KG_WEEK_PER_DAY } from './goals';
import { SPORT_DEFS } from './sports';

/**
 * Tagesbedarf: Wie viel Energie und welche Makros brauchst du an einem bestimmten Tag –
 * abhängig von Training (Plan oder schon absolviert), Alltag (Arbeit, Uni, Wege) und Ziel.
 *
 * Der Wochenschnitt bleibt dein Kalorienziel aus „Ziele“; Tage mit mehr Belastung bekommen mehr,
 * Ruhetage weniger. Protein und Fett bleiben konstant, die Kohlenhydrate gleichen aus.
 */

export const DEFAULT_DAY: ScheduleDay = { kind: 'buero', start: '09:00', end: '17:00', wake: '07:00', sleep: '23:00', activeMinutes: 20, canCook: false };
export const DEFAULT_WEEKEND: ScheduleDay = { kind: 'frei', wake: '08:30', sleep: '23:30', activeMinutes: 40, canCook: true };
export const DEFAULT_SCHEDULE: WeekSchedule = [DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_DAY, DEFAULT_WEEKEND, DEFAULT_WEEKEND];

/** MET im Job (Stoffwechsel-Vielfaches des Ruhewerts); 1,3 ist im Grundwert schon enthalten. */
const WORK_MET: Record<DayKind, number> = { buero: 1.5, uni: 1.8, stehend: 2.5, koerperlich: 3.5, frei: 1.3 };
const BASE_MET = 1.3;

const SESSION_MET: Record<Sport, Record<Intensity, number>> = {
  laufen: { locker: 8, mittel: 10, hart: 12 },
  radfahren: { locker: 6, mittel: 8, hart: 10.5 },
  schwimmen: { locker: 6, mittel: 8, hart: 10 },
  wandern: { locker: 5, mittel: 6, hart: 7.5 },
  rudern: { locker: 6, mittel: 8.5, hart: 11 },
  hyrox: { locker: 7, mittel: 9, hart: 11 },
  gym: { locker: 3.5, mittel: 5, hart: 6 },
  powerlifting: { locker: 3.5, mittel: 4.5, hart: 6 },
};

export function weekdayOf(date: ISODate): Weekday {
  return ((parseISODate(date).getDay() + 6) % 7) as Weekday;
}

const hours = (start?: string, end?: string) => {
  if (!start || !end) return 0;
  let d = timeToMinutes(end) - timeToMinutes(start);
  if (d < 0) d += 1440;
  return d / 60;
};

/** Zusätzlicher Verbrauch einer geplanten Einheit über dem Grundumsatz. */
export function sessionKcal(s: Pick<PlannedSession, 'sport' | 'durationMin' | 'intensity' | 'distanceKm'>, kg: number): number {
  const h = s.durationMin / 60;
  if (s.sport === 'laufen' && s.distanceKm) return Math.max(0, kg * s.distanceKm - BASE_MET * kg * h);
  return Math.max(0, (SESSION_MET[s.sport][s.intensity] - BASE_MET) * kg * h);
}

/** Zusätzlicher Verbrauch einer schon aufgezeichneten Aktivität (kcal der Uhr abzüglich Grundwert). */
export function activityExtraKcal(a: Pick<Activity, 'sport' | 'durationSec' | 'distanceM' | 'kcal'>, kg: number): number {
  const h = a.durationSec / 3600;
  const total = a.kcal ?? (a.sport === 'laufen' && a.distanceM ? kg * (a.distanceM / 1000) : SPORT_DEFS[a.sport].met * kg * h);
  return Math.max(0, total - BASE_MET * kg * h);
}

export interface MealSlot {
  time: string;
  slot: string;
  /** Anteil an den Tageskalorien */
  share: number;
  hint: string;
  /** Unterwegs / ohne Küche – etwas zum Mitnehmen */
  portable: boolean;
}

export interface DayNeeds {
  date: ISODate;
  weekday: Weekday;
  day: ScheduleDay;
  sessions: PlannedSession[];
  done: Activity[];
  /** Absolute Schätzung des Verbrauchs (ohne Zielanpassung) – nur mit Profil */
  estimatedTdee: number | null;
  breakdown: { base: number; work: number; active: number; exercise: number; adjustment: number };
  targets: Macros;
  /** Abweichung ggü. dem durchschnittlichen Tagesziel */
  delta: number;
  slots: MealSlot[];
  notes: string[];
}

export interface NeedsInput {
  goals: Goals;
  profile: Profile | null;
  weight: number | null;
  schedule: WeekSchedule;
  plan: TrainingPlan | null;
  activities: Activity[];
  mealsPerDay?: number;
}

interface Load {
  base: number;
  work: number;
  active: number;
  exercise: number;
}

function dayLoad(date: ISODate, input: NeedsInput, kg: number): Load & { sessions: PlannedSession[]; done: Activity[] } {
  const wd = weekdayOf(date);
  const day = input.schedule[wd] ?? DEFAULT_DAY;
  const base = input.profile && input.weight ? bmr(input.profile, input.weight) * 1.2 : 0;
  const work = day.kind === 'frei' ? 0 : (WORK_MET[day.kind] - BASE_MET) * kg * hours(day.start, day.end);
  const active = (day.activeMinutes / 60) * (3.5 - BASE_MET) * kg;
  const done = input.activities.filter((a) => a.date === date && a.points > 0);
  const planned = (input.plan?.sessions ?? []).filter((s) => s.weekday === wd);
  // Absolvierte Einheiten ersetzen geplante derselben Sportart
  const doneSports = new Set(done.map((a) => a.sport));
  const sessions = planned.filter((s) => !doneSports.has(s.sport));
  const exercise = done.reduce((s, a) => s + activityExtraKcal(a, kg), 0) + sessions.reduce((s, x) => s + sessionKcal(x, kg), 0);
  return { base, work, active, exercise, sessions, done };
}

const round10 = (v: number) => Math.round(v / 10) * 10;

/** Mahlzeiten-Zeitplan passend zu Aufstehen, Arbeit/Uni und Training. */
export function mealSlots(day: ScheduleDay, sessions: PlannedSession[], mealsPerDay = 4): MealSlot[] {
  const wake = timeToMinutes(day.wake);
  const sleep = timeToMinutes(day.sleep) + (timeToMinutes(day.sleep) < wake ? 1440 : 0);
  const workStart = day.start ? timeToMinutes(day.start) : null;
  const workEnd = day.end ? timeToMinutes(day.end) : null;
  const atWork = (m: number) => day.kind !== 'frei' && workStart != null && workEnd != null && m >= workStart && m < workEnd;
  const training = sessions
    .filter((s) => s.time)
    .map((s) => ({ start: timeToMinutes(s.time!), end: timeToMinutes(s.time!) + s.durationMin, s }))
    .sort((a, b) => a.start - b.start)[0];

  const slots: { m: number; slot: string; w: number; hint: string }[] = [];
  const breakfast = wake + 30;
  slots.push({ m: breakfast, slot: 'Frühstück', w: 25, hint: '' });
  const lunch = workStart != null && workEnd != null && atWork(12 * 60 + 30) ? Math.max(12 * 60, Math.min(13 * 60, workStart + (workEnd - workStart) / 2)) : 12 * 60 + 30;
  slots.push({ m: lunch, slot: 'Mittagessen', w: 30, hint: '' });
  let dinner = Math.min(sleep - 150, 19 * 60);
  if (training) {
    const pre = training.start - 90;
    const post = training.end + 45;
    // Training am Abend → Abendessen danach
    if (training.start >= 16 * 60) dinner = Math.min(Math.max(post, dinner), sleep - 60);
    const nearMeal = slots.some((x) => Math.abs(x.m - pre) < 75) || Math.abs(dinner - pre) < 75;
    if (!nearMeal && pre > wake) slots.push({ m: pre, slot: 'Vor dem Training', w: 10, hint: 'leicht verdaulich: Kohlenhydrate, wenig Fett und Ballaststoffe' });
    if (training.start < 16 * 60 && Math.abs(post - lunch) > 60 && post < dinner - 90) slots.push({ m: post, slot: 'Nach dem Training', w: 20, hint: 'Protein + Kohlenhydrate zur Regeneration' });
  }
  slots.push({ m: dinner, slot: 'Abendessen', w: 30, hint: training && dinner >= training.end ? 'Regeneration: Protein + Kohlenhydrate' : '' });
  while (slots.length < mealsPerDay) {
    // Snack in die größte Lücke
    const sorted = [...slots].sort((a, b) => a.m - b.m);
    let best = { gap: 0, at: 0 };
    for (let i = 1; i < sorted.length; i++) {
      const gap = sorted[i].m - sorted[i - 1].m;
      if (gap > best.gap) best = { gap, at: sorted[i - 1].m + gap / 2 };
    }
    if (best.gap < 150) break;
    slots.push({ m: best.at, slot: 'Snack', w: 12, hint: '' });
  }
  const total = slots.reduce((s, x) => s + x.w, 0);
  return slots
    .sort((a, b) => a.m - b.m)
    .map((x) => ({
      time: minutesToTime(Math.round(x.m / 15) * 15),
      slot: x.slot,
      share: x.w / total,
      hint: x.hint || (atWork(x.m) && !day.canCook ? 'zum Mitnehmen (Meal-Prep)' : ''),
      portable: atWork(x.m) && !day.canCook,
    }));
}

/** Bedarf eines Tages – der Wochenschnitt entspricht dem Kalorienziel. */
export function dayNeeds(date: ISODate, input: NeedsInput): DayNeeds {
  const kg = input.weight ?? 75;
  const week = Array.from({ length: 7 }, (_, i) => addDays(weekStart(date), i));
  const loads = week.map((d) => dayLoad(d, input, kg));
  const variable = (l: Load) => l.work + l.active + l.exercise;
  const avgVar = loads.reduce((s, l) => s + variable(l), 0) / 7;
  const today = loads[week.indexOf(date)] ?? dayLoad(date, input, kg);
  const g = input.goals;
  // Ausschläge begrenzen (Ruhetag ≥ −15 %, harter Tag ≤ +30 % des Ziels) – gleichmäßig skaliert,
  // damit der Wochenschnitt erhalten bleibt
  const deltas = loads.map((l) => variable(l) - avgVar);
  const lo = Math.min(...deltas);
  const hi = Math.max(...deltas);
  const scale = Math.min(1, lo < 0 ? (0.15 * g.kcal) / -lo : 1, hi > 0 ? (0.3 * g.kcal) / hi : 1);
  const delta = (variable(today) - avgVar) * scale;
  const kcal = round10(Math.max(1200, g.kcal + delta));
  const protein = g.protein;
  const fat = Math.max(g.fat, Math.round(kg * 0.6));
  const carbs = Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4));
  const adjustment = g.weeklyRate * KCAL_PER_KG_WEEK_PER_DAY;
  const estimatedTdee = today.base ? Math.round(today.base + variable(today)) : null;
  const wd = weekdayOf(date);
  const day = input.schedule[wd] ?? DEFAULT_DAY;
  const notes: string[] = [];
  if (Math.abs(delta) >= 100)
    notes.push(delta > 0 ? `+${Math.round(delta)} kcal ggü. deinem Schnitt – mehr Belastung als an anderen Tagen, vor allem als Kohlenhydrate.` : `${Math.round(delta)} kcal ggü. deinem Schnitt – ruhigerer Tag, weniger Kohlenhydrate.`);
  if (today.sessions.some((s) => s.intensity === 'hart')) notes.push('Harte Einheit geplant: Kohlenhydrate vorher auffüllen, danach 30–40 g Protein.');
  if (day.kind !== 'frei' && !day.canCook) notes.push('Keine Küche während der Arbeit/Uni: Mittagessen am Vorabend vorbereiten.');
  return {
    date,
    weekday: wd,
    day,
    sessions: today.sessions,
    done: today.done,
    estimatedTdee,
    breakdown: { base: Math.round(today.base), work: Math.round(today.work), active: Math.round(today.active), exercise: Math.round(today.exercise), adjustment: Math.round(adjustment) },
    targets: { kcal, protein, carbs, fat },
    delta: Math.round(delta),
    slots: mealSlots(day, today.sessions, input.mealsPerDay ?? 4),
    notes,
  };
}

/** Bedarf der ganzen Woche (Mo–So), in der `date` liegt. */
export function weekNeeds(date: ISODate, input: NeedsInput): DayNeeds[] {
  return Array.from({ length: 7 }, (_, i) => dayNeeds(addDays(weekStart(date), i), input));
}

/** Zeitpunkt → Mahlzeit im Tagebuch */
export function mealTypeAt(time: string): 'fruehstueck' | 'mittag' | 'abend' | 'snack' {
  const m = timeToMinutes(time);
  if (m < 10 * 60 + 30) return 'fruehstueck';
  if (m < 14 * 60 + 30) return 'mittag';
  if (m >= 17 * 60 + 30) return 'abend';
  return 'snack';
}
