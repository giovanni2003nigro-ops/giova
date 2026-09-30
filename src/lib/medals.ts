import type {
  Activity,
  EarnedMedal,
  Goals,
  ISODate,
  MealEntry,
  SleepEntry,
  Sport,
  TrainingPlan,
  WeightEntry,
  WorkoutSet,
} from '../types';
import { addDays, dateRange, parseISODate, toISODate, weekStart } from './dates';
import { seasonOf, seasonRange } from './leagues';
import { dailyTotals } from './nutrition';
import { fmt } from './stats';
import { estimate1RM } from './training';

/**
 * Medaillen belohnen erreichte Ziele und bringen Bonuspunkte für die Rangliste.
 * Medaillen einer Sportart zählen in deren Liga, allgemeine Medaillen in allen Ligen.
 *
 * WICHTIG: Schlüssel und Punkte stehen auch in der Server-Tabelle `medal_catalog`
 * (supabase/migrations). Der Server akzeptiert nur Medaillen aus diesem Katalog.
 */

export type MedalCategory = 'ausdauer' | 'kraft' | 'hyrox' | 'konstanz' | 'ziele';
export const CATEGORY_LABELS: Record<MedalCategory, string> = {
  ausdauer: 'Ausdauer',
  kraft: 'Kraft',
  hyrox: 'Hyrox',
  konstanz: 'Dranbleiben',
  ziele: 'Ziele erreicht',
};

export interface MedalContext {
  today: ISODate;
  activities: Activity[];
  sets: WorkoutSet[];
  meals: MealEntry[];
  sleep: SleepEntry[];
  weights: WeightEntry[];
  goals: Goals;
  plan: TrainingPlan | null;
}

export interface MedalCheck {
  /** Datum, an dem die Medaille verdient wurde – null, wenn (noch) nicht */
  date: ISODate | null;
  /** Fortschritt 0–1 */
  progress: number;
  /** z. B. "34 / 50 km" */
  text: string;
}

export interface MedalDef {
  key: string;
  label: string;
  description: string;
  emoji: string;
  points: number;
  category: MedalCategory;
  sport?: Sport;
  /** once = einmalig, season = jede Saison (Monat) neu erreichbar */
  repeat: 'once' | 'season';
  check: (ctx: MedalContext, range: { from: ISODate; to: ISODate }) => MedalCheck;
}

// ------------------------------------------------------------------ Hilfen

const NOT: MedalCheck = { date: null, progress: 0, text: '' };
const km = (a: Activity) => (a.distanceM ?? 0) / 1000;
const counted = (ctx: MedalContext, sport: Sport, range: { from: ISODate; to: ISODate }) =>
  ctx.activities
    .filter((a) => a.sport === sport && a.points > 0 && a.date >= range.from && a.date <= range.to)
    .sort((a, b) => a.startTime - b.startTime);

/** Erste Aktivität, die eine Bedingung erfüllt; Fortschritt = bester Wert / Ziel. */
function single(sport: Sport, target: number, value: (a: Activity) => number, unit: (v: number) => string, extra: (a: Activity) => boolean = () => true) {
  return (ctx: MedalContext, range: { from: ISODate; to: ISODate }): MedalCheck => {
    const list = counted(ctx, sport, range);
    const hit = list.find((a) => value(a) >= target && extra(a));
    const best = Math.max(0, ...list.filter(extra).map(value));
    return { date: hit?.date ?? null, progress: Math.min(1, best / target), text: `${unit(best)} / ${unit(target)}` };
  };
}

/** Summe in einem Zeitraum; Datum = Tag, an dem die Schwelle überschritten wurde. */
function cumulative(sport: Sport | Sport[], target: number, value: (a: Activity) => number, unit: (v: number) => string) {
  const sports = Array.isArray(sport) ? sport : [sport];
  return (ctx: MedalContext, range: { from: ISODate; to: ISODate }): MedalCheck => {
    let sum = 0;
    let date: ISODate | null = null;
    for (const s of sports)
      for (const a of counted(ctx, s, range)) {
        sum += value(a);
        if (!date && sum >= target) date = a.date;
      }
    return { date, progress: Math.min(1, sum / target), text: `${unit(sum)} / ${unit(target)}` };
  };
}

/** Erster Tag, an dem `n` aufeinanderfolgende Tage die Bedingung erfüllen. */
function streak(days: ISODate[], ok: (d: ISODate) => boolean, n: number): { date: ISODate | null; best: number } {
  let run = 0;
  let best = 0;
  for (const d of days) {
    run = ok(d) ? run + 1 : 0;
    best = Math.max(best, run);
    if (run >= n) return { date: d, best: n };
  }
  return { date: null, best };
}

function rangeDays(range: { from: ISODate; to: ISODate }, today: ISODate): ISODate[] {
  const to = range.to < today ? range.to : today;
  return range.from <= to ? dateRange(range.from, to) : [];
}

/** Tage mit Training: Aktivitäten oder eingetragene Kraftsätze. */
function activeDays(ctx: MedalContext): Set<ISODate> {
  return new Set([...ctx.activities.filter((a) => a.points > 0).map((a) => a.date), ...ctx.sets.map((s) => s.date)]);
}

export type Lift = 'squat' | 'bench' | 'deadlift';

/** Erkennt die drei Wettkampfübungen im Powerlifting am Namen. */
export function liftOf(exercise: string): Lift | null {
  const n = exercise.trim().toLowerCase();
  if (/split|front|goblet|hack|sissy|bulgar|pistol|box/.test(n)) return null;
  if (/^(kniebeuge|squat|back squat|low bar squat|high bar squat|kniebeugen)( \(.*\))?$/.test(n)) return 'squat';
  if (/^(bankdrücken|flachbankdrücken|bench|bench press)( \(.*\))?$/.test(n)) return 'bench';
  if (/^(kreuzheben|deadlift|sumo deadlift|sumo-kreuzheben|conventional deadlift)( \(.*\))?$/.test(n)) return 'deadlift';
  return null;
}

/** Bestes e1RM der Wettkampfübungen in einem Zeitraum. */
export function liftBests(sets: WorkoutSet[], from: ISODate, to: ISODate): Record<Lift, number> {
  const out: Record<Lift, number> = { squat: 0, bench: 0, deadlift: 0 };
  for (const s of sets) {
    if (s.date < from || s.date > to) continue;
    const lift = liftOf(s.exercise);
    if (lift) out[lift] = Math.max(out[lift], estimate1RM(s.weight, s.reps));
  }
  return out;
}

function weightOn(weights: WeightEntry[], date: ISODate): number | null {
  let w: number | null = null;
  for (const e of [...weights].sort((a, b) => a.date.localeCompare(b.date))) if (e.date <= date) w = e.weight;
  return w ?? weights[0]?.weight ?? null;
}

/** Erster Tag, an dem ein Lift ein Vielfaches des Körpergewichts erreicht. */
function liftRatio(lift: Lift, ratio: number) {
  return (ctx: MedalContext, range: { from: ISODate; to: ISODate }): MedalCheck => {
    if (!ctx.weights.length) return { ...NOT, text: 'Körpergewicht eintragen' };
    let best = 0;
    for (const s of [...ctx.sets].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
      if (s.date < range.from || s.date > range.to || liftOf(s.exercise) !== lift) continue;
      const bw = weightOn(ctx.weights, s.date);
      if (!bw) continue;
      const r = estimate1RM(s.weight, s.reps) / bw;
      best = Math.max(best, r);
      if (r >= ratio) return { date: s.date, progress: 1, text: `${fmt(r, 2)} × Körpergewicht` };
    }
    return { date: null, progress: Math.min(1, best / ratio), text: `${fmt(best, 2)} / ${fmt(ratio, 1)} × Körpergewicht` };
  };
}

const kmU = (v: number) => `${fmt(v, v < 10 ? 1 : 0)} km`;
const mU = (v: number) => `${fmt(v * 1000)} m`;
const countU = (v: number) => fmt(v);

// ------------------------------------------------------------------ Katalog

export const MEDALS: MedalDef[] = [
  // Ausdauer – einmalig
  { key: 'erste_aktivitaet', label: 'Los geht’s', description: 'Deine erste Aktivität aufgezeichnet', emoji: '🚀', points: 25, category: 'konstanz', repeat: 'once',
    check: (ctx) => {
      const first = [...ctx.activities].sort((a, b) => a.startTime - b.startTime)[0];
      return { date: first?.date ?? null, progress: first ? 1 : 0, text: first ? '1 / 1' : '0 / 1' };
    } },
  { key: 'lauf_5k', label: 'Erste 5 km', description: 'Einen Lauf über mindestens 5 km', emoji: '👟', points: 50, category: 'ausdauer', sport: 'laufen', repeat: 'once', check: single('laufen', 5, km, kmU) },
  { key: 'lauf_10k', label: '10-km-Läufer', description: 'Einen Lauf über mindestens 10 km', emoji: '🏃', points: 100, category: 'ausdauer', sport: 'laufen', repeat: 'once', check: single('laufen', 10, km, kmU) },
  { key: 'lauf_hm', label: 'Halbmarathon', description: '21,1 km am Stück gelaufen', emoji: '🎽', points: 250, category: 'ausdauer', sport: 'laufen', repeat: 'once', check: single('laufen', 21.0975, km, kmU) },
  { key: 'lauf_marathon', label: 'Marathon', description: '42,2 km am Stück gelaufen', emoji: '🏅', points: 500, category: 'ausdauer', sport: 'laufen', repeat: 'once', check: single('laufen', 42.195, km, kmU) },
  { key: 'lauf_sub25_5k', label: '5 km unter 25 min', description: 'Mindestens 5 km mit einer Ø Pace von 5:00 /km oder schneller', emoji: '⚡', points: 150, category: 'ausdauer', sport: 'laufen', repeat: 'once',
    check: single('laufen', 5, km, kmU, (a) => km(a) > 0 && a.durationSec / km(a) <= 300) },
  { key: 'lauf_sub50_10k', label: '10 km unter 50 min', description: 'Mindestens 10 km mit einer Ø Pace von 5:00 /km oder schneller', emoji: '🔥', points: 200, category: 'ausdauer', sport: 'laufen', repeat: 'once',
    check: single('laufen', 10, km, kmU, (a) => km(a) > 0 && a.durationSec / km(a) <= 300) },
  { key: 'rad_100k', label: 'Erste 100 km', description: '100 km am Stück geradelt', emoji: '🚴', points: 200, category: 'ausdauer', sport: 'radfahren', repeat: 'once', check: single('radfahren', 100, km, kmU) },
  { key: 'schwimm_1500', label: '1.500 m am Stück', description: 'Olympische Triathlon-Distanz geschwommen', emoji: '🏊', points: 100, category: 'ausdauer', sport: 'schwimmen', repeat: 'once', check: single('schwimmen', 1.5, km, mU) },
  { key: 'wandern_1000hm', label: '1.000 Höhenmeter', description: 'Eine Wanderung mit mindestens 1.000 Höhenmetern', emoji: '⛰️', points: 100, category: 'ausdauer', sport: 'wandern', repeat: 'once',
    check: single('wandern', 1000, (a) => a.elevationGainM ?? 0, (v) => `${fmt(v)} Hm`) },
  { key: 'rudern_10k', label: '10 km Rudern', description: '10 km am Stück gerudert', emoji: '🚣', points: 100, category: 'ausdauer', sport: 'rudern', repeat: 'once', check: single('rudern', 10, km, kmU) },

  // Ausdauer – jede Saison
  { key: 'lauf_50km_monat', label: '50 km im Monat', description: '50 km Laufen in einem Monat', emoji: '📆', points: 75, category: 'ausdauer', sport: 'laufen', repeat: 'season', check: cumulative('laufen', 50, km, kmU) },
  { key: 'lauf_100km_monat', label: '100 km im Monat', description: '100 km Laufen in einem Monat', emoji: '💯', points: 150, category: 'ausdauer', sport: 'laufen', repeat: 'season', check: cumulative('laufen', 100, km, kmU) },
  { key: 'rad_500km_monat', label: '500 km im Monat', description: '500 km Radfahren in einem Monat', emoji: '🛣️', points: 150, category: 'ausdauer', sport: 'radfahren', repeat: 'season', check: cumulative('radfahren', 500, km, kmU) },
  { key: 'schwimm_10km_monat', label: '10 km im Monat', description: '10 km Schwimmen in einem Monat', emoji: '🌊', points: 150, category: 'ausdauer', sport: 'schwimmen', repeat: 'season', check: cumulative('schwimmen', 10, km, kmU) },

  // Hyrox
  { key: 'hyrox_finisher', label: 'Hyrox-Finisher', description: 'Einen Hyrox-Wettkampf oder eine komplette Simulation beendet', emoji: '🔥', points: 300, category: 'hyrox', sport: 'hyrox', repeat: 'once',
    check: (ctx, range) => {
      const hit = counted(ctx, 'hyrox', range).find((a) => a.hyrox?.race);
      return { date: hit?.date ?? null, progress: hit ? 1 : 0, text: hit ? 'geschafft' : 'Wettkampf eintragen' };
    } },
  { key: 'hyrox_sub90', label: 'Hyrox unter 1:30 h', description: 'Hyrox-Wettkampf in weniger als 90 Minuten', emoji: '⏱️', points: 400, category: 'hyrox', sport: 'hyrox', repeat: 'once',
    check: (ctx, range) => {
      const races = counted(ctx, 'hyrox', range).filter((a) => a.hyrox?.race);
      const hit = races.find((a) => a.durationSec < 5400);
      const best = races.length ? Math.min(...races.map((a) => a.durationSec)) : null;
      return { date: hit?.date ?? null, progress: best ? Math.min(1, 5400 / best) : 0, text: best ? `Bestzeit ${Math.floor(best / 3600)}:${String(Math.floor((best % 3600) / 60)).padStart(2, '0')} h` : 'noch kein Wettkampf' };
    } },
  { key: 'hyrox_8_monat', label: '8 Hyrox-Einheiten', description: '8 Hyrox-Einheiten in einem Monat', emoji: '💥', points: 100, category: 'hyrox', sport: 'hyrox', repeat: 'season', check: cumulative('hyrox', 8, () => 1, countU) },

  // Kraft
  { key: 'kraft_12_monat', label: '12 Krafteinheiten', description: 'An 12 Tagen in einem Monat Krafttraining', emoji: '🏋️', points: 100, category: 'kraft', sport: 'gym', repeat: 'season',
    check: (ctx, range) => {
      const days = [...new Set([...ctx.sets.map((s) => s.date), ...ctx.activities.filter((a) => a.sport === 'gym' || a.sport === 'powerlifting').map((a) => a.date)])]
        .filter((d) => d >= range.from && d <= range.to)
        .sort();
      return { date: days[11] ?? null, progress: Math.min(1, days.length / 12), text: `${days.length} / 12 Tage` };
    } },
  { key: 'kraft_pr', label: 'Neuer Rekord', description: 'Ein neuer Bestwert (geschätztes 1RM) in einer Übung', emoji: '🏆', points: 50, category: 'kraft', sport: 'gym', repeat: 'season',
    check: (ctx, range) => {
      const best = new Map<string, number>();
      for (const s of [...ctx.sets].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
        if (s.weight <= 0) continue;
        const e = estimate1RM(s.weight, s.reps);
        const prev = best.get(s.exercise);
        if (prev != null && e > prev + 0.01 && s.date >= range.from && s.date <= range.to) return { date: s.date, progress: 1, text: s.exercise };
        best.set(s.exercise, Math.max(prev ?? 0, e));
      }
      return { ...NOT, text: 'noch kein Rekord diesen Monat' };
    } },
  { key: 'pl_bw_bench', label: 'Körpergewicht Bankdrücken', description: 'Bankdrücken (geschätztes 1RM) mit deinem Körpergewicht', emoji: '💪', points: 150, category: 'kraft', sport: 'powerlifting', repeat: 'once', check: liftRatio('bench', 1) },
  { key: 'pl_2x_deadlift', label: '2 × Körpergewicht Kreuzheben', description: 'Kreuzheben (geschätztes 1RM) mit dem doppelten Körpergewicht', emoji: '🦍', points: 250, category: 'kraft', sport: 'powerlifting', repeat: 'once', check: liftRatio('deadlift', 2) },
  { key: 'pl_total_500', label: '500 kg Total', description: 'Kniebeuge + Bankdrücken + Kreuzheben zusammen mindestens 500 kg (geschätztes 1RM)', emoji: '🥇', points: 300, category: 'kraft', sport: 'powerlifting', repeat: 'once',
    check: (ctx, range) => {
      const days = [...new Set(ctx.sets.filter((s) => liftOf(s.exercise) && s.date >= range.from && s.date <= range.to).map((s) => s.date))].sort();
      let total = 0;
      for (const d of days) {
        const b = liftBests(ctx.sets, range.from, d);
        total = b.squat + b.bench + b.deadlift;
        if (total >= 500) return { date: d, progress: 1, text: `${fmt(total)} kg` };
      }
      return { date: null, progress: Math.min(1, total / 500), text: `${fmt(total)} / 500 kg` };
    } },

  // Dranbleiben
  { key: 'streak_7', label: '7 Tage am Stück', description: 'An 7 Tagen in Folge trainiert', emoji: '🔗', points: 75, category: 'konstanz', repeat: 'season',
    check: (ctx, range) => {
      const active = activeDays(ctx);
      const s = streak(rangeDays(range, ctx.today), (d) => active.has(d), 7);
      return { date: s.date, progress: s.best / 7, text: `${s.best} / 7 Tage` };
    } },
  { key: 'aktiv_20_monat', label: '20 aktive Tage', description: 'An 20 Tagen in einem Monat trainiert', emoji: '📈', points: 150, category: 'konstanz', repeat: 'season',
    check: (ctx, range) => {
      const days = [...activeDays(ctx)].filter((d) => d >= range.from && d <= range.to).sort();
      return { date: days[19] ?? null, progress: Math.min(1, days.length / 20), text: `${days.length} / 20 Tage` };
    } },
  { key: 'trainingsziel_4_wochen', label: 'Wochenziel × 4', description: 'Vier Wochen in Folge so oft trainiert wie in deinen Zielen festgelegt', emoji: '🗓️', points: 100, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      const target = Math.max(1, ctx.goals.trainingDays);
      const active = activeDays(ctx);
      let run = 0;
      let best = 0;
      // Wochen, die in dieser Saison enden
      for (let w = weekStart(addDays(range.from, -21)); w <= range.to; w = addDays(w, 7)) {
        const days = dateRange(w, addDays(w, 6)).filter((d) => d <= ctx.today && active.has(d));
        const end = addDays(w, 6);
        if (days.length >= target) {
          run++;
          best = Math.max(best, run);
          const reached = days[target - 1];
          if (run >= 4 && reached >= range.from && reached <= range.to) return { date: reached, progress: 1, text: '4 / 4 Wochen' };
        } else if (end < ctx.today) run = 0;
      }
      return { date: null, progress: Math.min(1, best / 4), text: `${Math.min(best, 4)} / 4 Wochen` };
    } },
  { key: 'plan_woche', label: 'Plan erfüllt', description: 'Eine komplette Woche deines Trainingsplans umgesetzt', emoji: '✅', points: 100, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      const plan = ctx.plan;
      if (!plan || plan.sessions.length < 2) return { ...NOT, text: 'Trainingsplan hinterlegen' };
      const planned = new Map<string, number>();
      const bucket = (s: Sport) => (s === 'gym' || s === 'powerlifting' ? 'kraft' : s);
      for (const s of plan.sessions) planned.set(bucket(s.sport), (planned.get(bucket(s.sport)) ?? 0) + 1);
      const since = toISODate(new Date(plan.updatedAt));
      let best = 0;
      for (let w = weekStart(range.from); w <= range.to; w = addDays(w, 7)) {
        const end = addDays(w, 6);
        if (w < weekStart(since) || end > ctx.today || end < range.from || end > range.to) continue;
        const done = new Map<string, number>();
        for (const a of ctx.activities) if (a.date >= w && a.date <= end && a.points > 0) done.set(bucket(a.sport), (done.get(bucket(a.sport)) ?? 0) + 1);
        const gymDays = new Set(ctx.sets.filter((s) => s.date >= w && s.date <= end).map((s) => s.date));
        const actDays = new Set(ctx.activities.filter((a) => a.date >= w && a.date <= end && bucket(a.sport) === 'kraft').map((a) => a.date));
        done.set('kraft', Math.max(done.get('kraft') ?? 0, new Set([...gymDays, ...actDays]).size));
        let hit = 0;
        let total = 0;
        for (const [k, n] of planned) {
          total += n;
          hit += Math.min(n, done.get(k) ?? 0);
        }
        best = Math.max(best, hit / total);
        if (hit >= total) return { date: end, progress: 1, text: `${total} / ${total} Einheiten` };
      }
      return { date: null, progress: best, text: `${Math.round(best * 100)} % der Planwoche` };
    } },

  // Ernährung, Schlaf, Körper
  { key: 'protein_7', label: 'Protein-Profi', description: 'An 7 Tagen in Folge mindestens 95 % deines Proteinziels gegessen', emoji: '🥩', points: 75, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      const totals = dailyTotals(ctx.meals);
      const s = streak(rangeDays(range, ctx.today), (d) => (totals.get(d)?.protein ?? 0) >= ctx.goals.protein * 0.95, 7);
      return { date: s.date, progress: s.best / 7, text: `${s.best} / 7 Tage` };
    } },
  { key: 'kalorien_14', label: 'Punktlandung', description: 'An 14 Tagen in einem Monat dein Kalorienziel (±10 %) getroffen', emoji: '🎯', points: 100, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      const totals = dailyTotals(ctx.meals);
      const hits = rangeDays(range, ctx.today).filter((d) => {
        const t = totals.get(d);
        return t && Math.abs(t.kcal - ctx.goals.kcal) <= ctx.goals.kcal * 0.1;
      });
      return { date: hits[13] ?? null, progress: Math.min(1, hits.length / 14), text: `${hits.length} / 14 Tage` };
    } },
  { key: 'schlaf_7', label: 'Ausgeschlafen', description: '7 Nächte in Folge dein Schlafziel erreicht (max. 15 min darunter)', emoji: '😴', points: 75, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      const byDate = new Map(ctx.sleep.map((s) => [s.date, s.durationMin]));
      const s = streak(rangeDays(range, ctx.today), (d) => (byDate.get(d) ?? 0) >= ctx.goals.sleepHours * 60 - 15, 7);
      return { date: s.date, progress: s.best / 7, text: `${s.best} / 7 Nächte` };
    } },
  { key: 'kraftziel', label: 'Kraftziel erreicht', description: 'Eines deiner Kraftziele (1RM) erreicht', emoji: '🎖️', points: 200, category: 'ziele', repeat: 'season',
    check: (ctx, range) => {
      if (!ctx.goals.strengthGoals.length) return { ...NOT, text: 'Kraftziel festlegen' };
      let best = 0;
      for (const g of ctx.goals.strengthGoals) {
        const sets = ctx.sets
          .filter((s) => s.exercise.toLowerCase() === g.exercise.toLowerCase())
          .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
        const first = sets.find((s) => estimate1RM(s.weight, s.reps) >= g.target1RM);
        if (first && first.date >= range.from && first.date <= range.to) return { date: first.date, progress: 1, text: g.exercise };
        best = Math.max(best, ...sets.map((s) => estimate1RM(s.weight, s.reps) / g.target1RM));
      }
      return { date: null, progress: Math.min(1, best), text: `${Math.round(Math.min(1, best) * 100)} % des Ziels` };
    } },
  { key: 'zielgewicht', label: 'Zielgewicht', description: 'Dein Zielgewicht erreicht (Ø 7 Tage)', emoji: '⚖️', points: 300, category: 'ziele', repeat: 'once',
    check: (ctx) => {
      const target = ctx.goals.targetWeight;
      const sorted = [...ctx.weights].sort((a, b) => a.date.localeCompare(b.date));
      if (!target || sorted.length < 2) return { ...NOT, text: 'Zielgewicht festlegen' };
      const losing = sorted[0].weight > target;
      const start = sorted[0].weight;
      let closest = 0;
      for (const e of sorted) {
        const window = sorted.filter((x) => x.date > addDays(e.date, -7) && x.date <= e.date);
        const avg = window.reduce((s, x) => s + x.weight, 0) / window.length;
        if (losing ? avg <= target + 0.3 : avg >= target - 0.3) return { date: e.date, progress: 1, text: `${fmt(avg, 1)} kg` };
        const done = Math.abs(start - target) > 0 ? (losing ? start - avg : avg - start) / Math.abs(start - target) : 0;
        closest = Math.max(closest, done);
      }
      return { date: null, progress: Math.max(0, Math.min(1, closest)), text: `${Math.round(Math.max(0, closest) * 100)} % geschafft` };
    } },
];

export const MEDAL_BY_KEY = new Map(MEDALS.map((m) => [m.key, m]));

export const medalId = (key: string, period: string) => `${key}:${period}`;

/** Saisons (Monate), die bewertet werden: die letzten 12 Monate bis heute. */
export function seasonsToCheck(today: ISODate, n = 12): string[] {
  const out: string[] = [];
  const d = parseISODate(`${seasonOf(today)}-01`);
  for (let i = 0; i < n; i++) {
    out.push(toISODate(d).slice(0, 7));
    d.setMonth(d.getMonth() - 1);
  }
  return out;
}

/** Alle Medaillen, die nach den aktuellen Daten verdient sind (neue und bekannte). */
export function evaluateMedals(ctx: MedalContext): EarnedMedal[] {
  const out: EarnedMedal[] = [];
  const all = { from: '2000-01-01', to: ctx.today };
  for (const m of MEDALS) {
    if (m.repeat === 'once') {
      const r = m.check(ctx, all);
      if (r.date) out.push({ id: medalId(m.key, ''), key: m.key, period: '', date: r.date, earnedAt: Date.now(), points: m.points });
      continue;
    }
    for (const season of seasonsToCheck(ctx.today)) {
      const r = m.check(ctx, seasonRange(season));
      if (r.date) out.push({ id: medalId(m.key, season), key: m.key, period: season, date: r.date, earnedAt: Date.now(), points: m.points });
    }
  }
  return out;
}

/** Stand aller Medaillen für die Übersicht (aktuelle Saison für wiederholbare). */
export function medalProgress(ctx: MedalContext): { def: MedalDef; check: MedalCheck }[] {
  const season = seasonRange(seasonOf(ctx.today));
  return MEDALS.map((def) => ({ def, check: def.check(ctx, def.repeat === 'once' ? { from: '2000-01-01', to: ctx.today } : season) }));
}
