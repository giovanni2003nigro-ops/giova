import { db, getKV } from '../db';
import { analyze, AREA_LABELS, SEVERITY_LABELS, type AnalysisResult } from '../lib/analysis';
import { weightTrend } from '../lib/body';
import { addDays, formatDateLong, formatDateShort, formatDuration, today } from '../lib/dates';
import { dailyTotals, sumMacros } from '../lib/nutrition';
import { fmt, fmtSigned, pctSigned } from '../lib/stats';
import { formatMetric, sessionsByExercise, TREND_LABELS } from '../lib/training';
import { measuredTdee, resolveGoals } from '../lib/autoGoals';
import { DEFAULT_SCHEDULE, dayNeeds, type NeedsInput } from '../lib/dailyNeeds';
import { checkRules, limits } from '../lib/guardrails';
import { nutrientCheck } from '../lib/nutrients';
import { formatClock, formatDistance, formatPace, SPORT_DEFS } from '../lib/sports';
import type {
  Activity,
  TrainingPlan,
  WeekSchedule,
  Exercise,
  Food,
  Goals,
  ISODate,
  Macros,
  MealEntry,
  Profile,
  SleepEntry,
  WeightEntry,
  WorkoutSet,
} from '../types';
import { DAY_KIND_LABELS, DEFAULT_GOALS, GOAL_LABELS, INTENSITY_LABELS, MEAL_LABELS, WEEKDAY_LABELS } from '../types';

export interface AppData {
  /** Wirksame Ziele (im Automatik-Modus berechnet) */
  goals: Goals;
  /** Gespeicherte Eingaben aus „Ziele“ */
  storedGoals?: Goals;
  profile: Profile | null;
  sets: WorkoutSet[];
  meals: MealEntry[];
  sleep: SleepEntry[];
  weights: WeightEntry[];
  exercises: Exercise[];
  foods: Food[];
  activities: Activity[];
  plan: TrainingPlan | null;
  schedule: WeekSchedule | null;
}

export async function loadAppData(): Promise<AppData> {
  const [goals, profile, sets, meals, sleep, weights, exercises, foods, activities, plan, schedule] = await Promise.all([
    getKV<Goals>('goals', DEFAULT_GOALS),
    getKV<Profile | null>('profile', null),
    db.sets.toArray(),
    db.meals.toArray(),
    db.sleep.toArray(),
    db.weights.toArray(),
    db.exercises.toArray(),
    db.foods.toArray(),
    db.activities.toArray(),
    getKV<TrainingPlan | null>('trainingPlan', null),
    getKV<WeekSchedule | null>('schedule', null),
  ]);
  const data: AppData = { goals, storedGoals: goals, profile, sets, meals, sleep, weights, exercises, foods, activities, plan, schedule };
  return { ...data, goals: resolveGoals(needsInputOf(data, today()), today()) };
}

/** Eingaben für den Tagesbedarf aus dem Datenstand (mit gespeicherten Zielen). */
export function needsInputOf(data: AppData, ref: ISODate): NeedsInput {
  const latest = [...data.weights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  return {
    goals: data.storedGoals ?? data.goals,
    profile: data.profile,
    weight: latest.length ? latest.reduce((s, w) => s + w.weight, 0) / latest.length : null,
    schedule: data.schedule ?? DEFAULT_SCHEDULE,
    plan: data.plan,
    activities: data.activities,
    measuredTdee: measuredTdee(data.meals, data.weights, ref),
    detailed: !!data.schedule || !!data.plan,
  };
}

/** Rahmenbedingungen (Pflicht) und ob sie eingehalten sind. */
export function describeRules(data: AppData): string {
  const weight = needsInputOf(data, today()).weight;
  const lim = limits(data.profile, weight);
  const rules = checkRules(data.goals, data.plan, lim);
  return rules.map((r) => `- ${r.ok ? '✓' : '✗ VERLETZT'} ${r.label}: ${r.requirement} (aktuell ${r.current})${r.ok ? '' : ` → ${r.fix}`}`).join('\n');
}

/** Was in den letzten 7 Tagen gefehlt hat (Protein, Kohlenhydrate an Trainingstagen, Fett, Ballaststoffe, Zucker, Salz). */
export function describeNutrients(data: AppData, today: ISODate): string {
  const input = { ...needsInputOf(data, today), goals: data.goals };
  const res = nutrientCheck({
    meals: data.meals,
    foods: data.foods,
    goals: data.goals,
    weight: input.weight,
    targetFor: (d) => dayNeeds(d, input).targets,
    trainingOn: (d) => {
      const n = dayNeeds(d, input);
      return n.sessions.length > 0 || n.done.length > 0;
    },
    from: addDays(today, -7),
    to: addDays(today, -1),
  });
  if (!res.days) return 'Keine Essenseinträge in den letzten 7 Tagen.';
  return [`${res.days} Tage erfasst:`, ...res.gaps.map((g) => `- ${g.label}: ${g.status} – ${g.detail}`)].join('\n');
}

export function runAnalysis(data: AppData, today: ISODate): AnalysisResult {
  return analyze({ today, ...data });
}

const m = (x: Macros) => `${fmt(x.kcal)} kcal · P ${fmt(x.protein)} g · KH ${fmt(x.carbs)} g · F ${fmt(x.fat)} g`;

export function describeGoals(data: AppData): string {
  const g = data.goals;
  const lines = [
    `Zieltyp: ${GOAL_LABELS[g.type]}`,
    `Tagesziel (Wochenschnitt): ${m(g)} – ${g.auto ? 'AUTOMATISCH berechnet aus Profil, Gewicht, Alltag, Trainingsplan, gemessenem Verbrauch und Wochenrate (ändert sich mit Rate, Plan, Alltag)' : 'manuell eingetragen'}`,
    `Geplante Gewichtsveränderung: ${fmtSigned(g.weeklyRate, 2)} kg/Woche${g.targetWeight ? `, Zielgewicht ${fmt(g.targetWeight, 1)} kg` : ''}`,
    `Schlafziel: ${fmt(g.sleepHours, 1)} h · Trainingsziel: ${g.trainingDays}× pro Woche`,
  ];
  if (g.strengthGoals.length)
    lines.push(
      `Kraftziele (1RM): ${g.strengthGoals
        .map((s) => `${s.exercise} ${fmt(s.target1RM, 1)} kg${s.deadline ? ` bis ${formatDateShort(s.deadline)}` : ''}`)
        .join('; ')}`,
    );
  const p = data.profile;
  if (p)
    lines.push(
      `Profil: ${p.sex === 'm' ? 'männlich' : 'weiblich'}, ${p.age} Jahre, ${p.height} cm, Aktivitätsfaktor ${fmt(p.activity, 2)}`,
    );
  return lines.join('\n');
}

export function describeToday(data: AppData, today: ISODate): string {
  const entries = data.meals.filter((x) => x.date === today);
  const total = sumMacros(entries);
  const g = data.goals;
  const rest: Macros = {
    kcal: g.kcal - total.kcal,
    protein: g.protein - total.protein,
    carbs: g.carbs - total.carbs,
    fat: g.fat - total.fat,
  };
  const lines = [`Heute gegessen (${entries.length} Einträge): ${m(total)}`, `Noch offen bis zum Ziel: ${m(rest)}`];
  for (const e of entries.sort((a, b) => a.meal.localeCompare(b.meal)))
    lines.push(`- ${MEAL_LABELS[e.meal]}: ${e.name} ${fmt(e.amount)} ${e.unit} → ${m(e)}`);
  const setsToday = data.sets.filter((s) => s.date === today);
  if (setsToday.length) {
    const byEx = new Map<string, string[]>();
    for (const s of setsToday) byEx.set(s.exercise, [...(byEx.get(s.exercise) ?? []), `${fmt(s.weight, 1)}×${s.reps}`]);
    lines.push(`Training heute: ${[...byEx].map(([ex, list]) => `${ex} ${list.join(', ')}`).join(' | ')}`);
  } else lines.push('Heute noch kein Training eingetragen.');
  const sleepToday = data.sleep.find((s) => s.date === today);
  if (sleepToday)
    lines.push(
      `Letzte Nacht: ${formatDuration(sleepToday.durationMin)} (${sleepToday.bedtime}–${sleepToday.wakeTime}), Qualität ${sleepToday.quality}/5`,
    );
  return lines.join('\n');
}

export function describeNutrition(data: AppData, today: ISODate, days = 14): string {
  const totals = dailyTotals(data.meals);
  const lines: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = addDays(today, -i);
    const t = totals.get(d);
    lines.push(`${formatDateShort(d)}: ${t ? m(t) : 'nicht erfasst'}`);
  }
  return lines.join('\n');
}

export function describeTraining(data: AppData, today: ISODate, exercise?: string): string {
  const byEx = sessionsByExercise(data.sets);
  const lines: string[] = [];
  if (exercise) {
    const key = [...byEx.keys()].find((k) => k.toLowerCase() === exercise.toLowerCase());
    if (!key) return `Keine Einträge für „${exercise}“. Vorhandene Übungen: ${[...byEx.keys()].join(', ') || 'keine'}.`;
    const sets = data.sets.filter((s) => s.exercise === key).sort((a, b) => a.date.localeCompare(b.date));
    const byDate = new Map<string, string[]>();
    for (const s of sets) byDate.set(s.date, [...(byDate.get(s.date) ?? []), `${fmt(s.weight, 1)} kg×${s.reps}`]);
    lines.push(`Verlauf ${key}:`);
    for (const [d, list] of [...byDate].slice(-20)) {
      const session = byEx.get(key)!.find((x) => x.date === d)!;
      lines.push(`${formatDateShort(d)}: ${list.join(', ')} (e1RM ${formatMetric(session.metric, session.metricType)})`);
    }
    return lines.join('\n');
  }
  const from = addDays(today, -21);
  const recent = data.sets.filter((s) => s.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map<string, Map<string, string[]>>();
  for (const s of recent) {
    const day = byDate.get(s.date) ?? new Map<string, string[]>();
    day.set(s.exercise, [...(day.get(s.exercise) ?? []), `${fmt(s.weight, 1)}×${s.reps}`]);
    byDate.set(s.date, day);
  }
  lines.push('Einheiten der letzten 3 Wochen (kg×Wdh.):');
  if (!byDate.size) lines.push('keine');
  for (const [d, day] of byDate)
    lines.push(`${formatDateShort(d)}: ${[...day].map(([ex, list]) => `${ex} ${list.join(', ')}`).join(' | ')}`);
  return lines.join('\n');
}

export function describeSleep(data: AppData, today: ISODate, days = 14): string {
  const list = data.sleep.filter((s) => s.date > addDays(today, -days)).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return 'Keine Schlafdaten.';
  return list
    .map(
      (s) =>
        `${formatDateShort(s.date)}: ${formatDuration(s.durationMin)} (${s.bedtime}–${s.wakeTime}), Qualität ${s.quality}/5${s.note ? `, Notiz: ${s.note}` : ''}`,
    )
    .join('\n');
}

export function describeWeight(data: AppData, today: ISODate): string {
  const t = weightTrend(data.weights, today);
  if (!t) return 'Keine Gewichtsdaten.';
  const recent = data.weights
    .filter((w) => w.date > addDays(today, -28))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => `${formatDateShort(w.date)} ${fmt(w.weight, 1)} kg`);
  return [
    `Aktuell ${fmt(t.latest, 1)} kg (${formatDateShort(t.latestDate)}), Ø 7 Tage ${fmt(t.avg7, 1)} kg`,
    t.ratePerWeek != null ? `Trend: ${fmtSigned(t.ratePerWeek, 2)} kg/Woche` : 'Trend: zu wenig Messungen',
    `Messungen (4 Wochen): ${recent.join(', ')}`,
  ].join('\n');
}

export function describeAnalysis(a: AnalysisResult): string {
  const lines: string[] = [];
  if (a.score.total != null)
    lines.push(
      `Ziel-Score (7 Tage): ${Math.round(a.score.total * 100)} % (${a.score.parts.map((p) => `${p.label} ${Math.round(p.value * 100)} %`).join(', ')})`,
    );
  if (a.actualTdee) lines.push(`Geschätzter echter Verbrauch: ${fmt(a.actualTdee)} kcal/Tag → empfohlen für Zielrate: ${fmt(a.recommendedKcal!)} kcal`);
  if (a.trends.length) {
    lines.push('Übungstrends (8 Wochen):');
    for (const t of a.trends.slice(0, 10))
      lines.push(
        `- ${t.exercise}: ${TREND_LABELS[t.status]}${t.status !== 'zu-wenig-daten' ? ` (${pctSigned(t.pctPerWeek, 1)}/Woche)` : ''}, aktuell ${formatMetric(t.current, t.metricType)}, Bestwert ${formatMetric(t.best, t.metricType)}`,
      );
  }
  lines.push('Automatischer Zielabgleich:');
  for (const r of a.recommendations)
    lines.push(`- [${SEVERITY_LABELS[r.severity]} · ${AREA_LABELS[r.area]}] ${r.title}: ${r.detail}${r.actions.length ? ` → ${r.actions.join(' ')}` : ''}`);
  if (a.insights.length) {
    lines.push('Zusammenhänge Training ↔ Schlaf/Ernährung:');
    for (const i of a.insights) lines.push(`- ${i.title}: ${i.detail} ${i.conclusion}`);
  }
  return lines.join('\n');
}

export function describeFoodLibrary(foods: Food[], limit = 80): string {
  if (!foods.length) return 'Die Lebensmittel-Bibliothek ist noch leer.';
  const sorted = [...foods].sort((a, b) => b.createdAt - a.createdAt);
  const lines = sorted
    .slice(0, limit)
    .map(
      (f) =>
        `- ${f.name}${f.brand ? ` (${f.brand})` : ''} pro 100 ${f.unit}: ${m(f.per100)}${f.servingSize ? ` · Portion ${fmt(f.servingSize)} ${f.unit}${f.servingLabel ? ` (${f.servingLabel})` : ''}` : ''}`,
    );
  if (foods.length > limit) lines.push(`… und ${foods.length - limit} weitere (über lebensmittel_suchen abrufbar)`);
  return lines.join('\n');
}

export function describeActivities(data: AppData, today: ISODate, days = 28): string {
  const list = data.activities.filter((a) => a.date > addDays(today, -days)).sort((a, b) => a.startTime - b.startTime);
  if (!list.length) return 'Keine aufgezeichneten Aktivitäten.';
  return list
    .map((a) => {
      const pace = formatPace(a.sport, a.distanceM, a.durationSec);
      return `${formatDateShort(a.date)}: ${SPORT_DEFS[a.sport].label} „${a.title}“ – ${a.distanceM ? `${formatDistance(a.distanceM)}, ` : ''}${formatClock(a.durationSec)}${pace ? `, ${pace}` : ''}${a.elevationGainM ? `, ${fmt(a.elevationGainM)} Hm` : ''}${a.avgHr ? `, Ø ${a.avgHr} bpm` : ''}${a.hyrox?.race ? ', Hyrox-Wettkampf' : ''}${a.strength?.length ? `, ${a.strength.map((s) => s.exercise).join(', ')}` : ''} (${a.points} Punkte)`;
    })
    .join('\n');
}

export function describePlanAndDay(data: AppData, today: ISODate): string {
  const lines: string[] = [];
  if (data.plan?.sessions.length) {
    lines.push(`Trainingsplan „${data.plan.name}“:`);
    for (const s of [...data.plan.sessions].sort((a, b) => a.weekday - b.weekday))
      lines.push(`- [ID ${s.id}] ${WEEKDAY_LABELS[s.weekday]}${s.time ? ` ${s.time}` : ''}: ${SPORT_DEFS[s.sport].label} „${s.title}“, ${s.durationMin} min, ${INTENSITY_LABELS[s.intensity]}${s.distanceKm ? `, ${fmt(s.distanceKm, 1)} km` : ''}`);
  } else lines.push('Kein Trainingsplan hinterlegt.');
  if (data.schedule)
    lines.push(
      `Alltag: ${data.schedule.map((d, i) => `${WEEKDAY_LABELS[i].slice(0, 2)} ${DAY_KIND_LABELS[d.kind].split(' (')[0]}${d.kind !== 'frei' && d.start ? ` ${d.start}–${d.end}` : ''}`).join('; ')}`,
    );
  const n = dayNeeds(today, { ...needsInputOf(data, today), goals: data.goals });
  lines.push(`Bedarf heute (angepasst an Training & Alltag): ${m(n.targets)}${n.delta ? ` (${fmtSigned(n.delta)} kcal ggü. Schnitt)` : ''}`);
  if (n.estimatedTdee)
    lines.push(
      `Verbrauch heute geschätzt ~${fmt(n.estimatedTdee)} kcal (Grundumsatz×1,2 ${fmt(n.breakdown.base)}, Arbeit/Uni ${fmt(n.breakdown.work)}, Wege ${fmt(n.breakdown.active)}, Training ${fmt(n.breakdown.exercise)}${n.breakdown.calibration ? `, Kalibrierung ${fmtSigned(n.breakdown.calibration)}` : ''}), Zielrate ${fmtSigned(n.breakdown.adjustment)} kcal`,
    );
  lines.push(`Mahlzeiten-Timing heute: ${n.slots.map((s) => `${s.time} ${s.slot}`).join(', ')}`);
  return lines.join('\n');
}

/** Kompletter Datenstand als Text für den Coach bzw. den Beginn eines Chats. */
export function buildSnapshot(data: AppData, today: ISODate, analysis = runAnalysis(data, today)): string {
  return [
    `Heute ist ${formatDateLong(today)} (${today}).`,
    `## Ziele & Profil\n${describeGoals(data)}`,
    `## Rahmenbedingungen (MUSS – nie unterschreiten)\n${describeRules(data)}`,
    `## Heute\n${describeToday(data, today)}`,
    `## Gewicht\n${describeWeight(data, today)}`,
    `## Ernährung (Tagessummen, letzte 14 Tage)\n${describeNutrition(data, today)}`,
    `## Training\n${describeTraining(data, today)}`,
    `## Aktivitäten (Laufen, Rad, Schwimmen, Hyrox …; letzte 4 Wochen)\n${describeActivities(data, today)}`,
    `## Trainingsplan, Alltag & Tagesbedarf\n${describePlanAndDay(data, today)}`,
    `## Nährstoff-Check (letzte 7 Tage)\n${describeNutrients(data, today)}`,
    `## Schlaf (letzte 14 Nächte)\n${describeSleep(data, today)}`,
    `## Auswertung der App\n${describeAnalysis(analysis)}`,
    `## Lebensmittel-Bibliothek des Nutzers\n${describeFoodLibrary(data.foods)}`,
  ].join('\n\n');
}
