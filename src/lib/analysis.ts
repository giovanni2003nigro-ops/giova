import type {
  Exercise,
  Food,
  Goals,
  ISODate,
  MealEntry,
  Profile,
  SleepEntry,
  WeightEntry,
  WorkoutSet,
} from '../types';
import { GOAL_SHORT } from '../types';
import { weightTrend, type WeightTrend } from './body';
import { addDays, diffDays, formatDayMonth, minutesToTime, timeToMinutes } from './dates';
import { estimateActualTdee, kcalForRate, KCAL_PER_KG_WEEK_PER_DAY } from './goals';
import { dailyTotals, PROTEIN_SUGGESTIONS, summarizeNutrition, type NutritionSummary } from './nutrition';
import { summarizeSleep, type SleepSummary } from './sleep';
import { clamp, fmt, fmtSigned, mean, pctSigned } from './stats';
import {
  exerciseTrend,
  sessionPerformance,
  sessionsByExercise,
  setsPerMuscleGroup,
  trainingDays,
  type ExerciseTrend,
} from './training';

export type Severity = 'ok' | 'info' | 'warn' | 'alert';
export type Area = 'ernaehrung' | 'gewicht' | 'training' | 'schlaf';

export const AREA_LABELS: Record<Area, string> = {
  ernaehrung: 'Ernährung',
  gewicht: 'Gewicht',
  training: 'Training',
  schlaf: 'Schlaf',
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  ok: 'Im Ziel',
  info: 'Hinweis',
  warn: 'Abweichung',
  alert: 'Starke Abweichung',
};

export interface Recommendation {
  id: string;
  area: Area;
  severity: Severity;
  title: string;
  detail: string;
  actions: string[];
}

export interface Insight {
  id: string;
  title: string;
  detail: string;
  conclusion: string;
}

export interface StrengthGoalStatus {
  exercise: string;
  target: number;
  current: number | null;
  progress: number; // 0..1
  weeksToGoal: number | null;
  deadline?: ISODate;
  onTrack: boolean | null;
}

export interface ScorePart {
  key: Area | 'protein';
  label: string;
  value: number;
}

export interface AnalysisInput {
  today: ISODate;
  goals: Goals;
  profile?: Profile | null;
  sets: WorkoutSet[];
  meals: MealEntry[];
  sleep: SleepEntry[];
  weights: WeightEntry[];
  exercises: Exercise[];
  foods: Food[];
}

export interface AnalysisResult {
  nutrition7: NutritionSummary;
  nutrition21: NutritionSummary;
  sleep7: SleepSummary;
  weight: WeightTrend | null;
  trends: ExerciseTrend[];
  trainingDays7: number;
  trainingPerWeek: number;
  actualTdee: number | null;
  recommendedKcal: number | null;
  strength: StrengthGoalStatus[];
  recommendations: Recommendation[];
  insights: Insight[];
  score: { total: number | null; parts: ScorePart[] };
}

const SEVERITY_ORDER: Record<Severity, number> = { alert: 0, warn: 1, info: 2, ok: 3 };

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/** Die größten Kalorienquellen eines Zeitraums. */
export function topKcalSources(meals: MealEntry[], from: ISODate, to: ISODate, n = 3) {
  const byName = new Map<string, number>();
  for (const m of meals) {
    if (m.date < from || m.date > to) continue;
    const key = m.name.trim();
    byName.set(key, (byName.get(key) ?? 0) + m.kcal);
  }
  return [...byName.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, kcal]) => ({ name, kcal }));
}

/** Proteinreiche Lebensmittel aus der eigenen Bibliothek (≥ 35 % der kcal aus Protein). */
export function proteinRichFoods(foods: Food[], n = 3) {
  return foods
    .filter((f) => f.per100.kcal > 0 && (f.per100.protein * 4) / f.per100.kcal >= 0.35)
    .sort((a, b) => b.per100.protein / b.per100.kcal - a.per100.protein / a.per100.kcal)
    .slice(0, n);
}

export function analyze(input: AnalysisInput): AnalysisResult {
  const { today, goals, sets, meals, sleep, weights, exercises, foods } = input;
  const recs: Recommendation[] = [];
  const add = (r: Recommendation) => recs.push(r);
  const yesterday = addDays(today, -1);

  // ------------------------------------------------------------ Basisdaten
  // Heute ist meist unvollständig → Durchschnitte über die letzten 7 abgeschlossenen Tage
  const nutrition7 = summarizeNutrition(meals, goals, addDays(today, -7), yesterday);
  const nutrition21 = summarizeNutrition(meals, goals, addDays(today, -21), yesterday);
  const sleep7 = summarizeSleep(sleep, addDays(today, -6), today, goals.sleepHours);
  const weight = weightTrend(weights, today);
  const bodyWeight = weight?.avg7 ?? null;

  let actualTdee: number | null = null;
  let recommendedKcal: number | null = null;
  if (weight?.ratePerWeek != null && nutrition21.daysLogged >= 10) {
    actualTdee = Math.round(estimateActualTdee(nutrition21.avg.kcal, weight.ratePerWeek));
    recommendedKcal = kcalForRate(actualTdee, goals.weeklyRate);
  }

  // ------------------------------------------------------------ Ernährung
  const n7 = nutrition7;
  const proteinGap = goals.protein - n7.avg.protein;
  if (n7.daysLogged < 3) {
    add({
      id: 'ernaehrung-daten',
      area: 'ernaehrung',
      severity: 'info',
      title: 'Zu wenig Ernährungsdaten',
      detail: `In den letzten 7 Tagen sind ${n7.daysLogged} Tage erfasst. Für eine Bewertung brauche ich mindestens 3 vollständige Tage.`,
      actions: ['Trage alle Mahlzeiten ein – am schnellsten über die Bibliothek oder den Foto-Scan.'],
    });
  } else {
    const dev = n7.avg.kcal - goals.kcal;
    const rel = dev / goals.kcal;
    const adherence = `${Math.round(n7.kcalAdherence * n7.daysLogged)} von ${n7.daysLogged} Tagen im ±10 %-Bereich`;
    if (Math.abs(rel) <= 0.05) {
      add({
        id: 'kcal',
        area: 'ernaehrung',
        severity: 'ok',
        title: 'Kalorien im Ziel',
        detail: `Ø ${fmt(n7.avg.kcal)} kcal bei einem Ziel von ${fmt(goals.kcal)} kcal (${adherence}).`,
        actions: [],
      });
    } else if (rel > 0) {
      const sources = topKcalSources(meals, n7.from, n7.to);
      const actions = [`Reduziere im Schnitt um ca. ${fmt(roundTo(dev, 50))} kcal pro Tag.`];
      if (sources.length)
        actions.push(
          `Größte Kalorienquellen der Woche: ${sources.map((s) => `${s.name} (${fmt(s.kcal)} kcal)`).join(', ')} – hier lässt sich am leichtesten sparen.`,
        );
      if (goals.type === 'defizit' || goals.type === 'recomp')
        actions.push('Ersetze kalorienreiche Snacks durch Gemüse, Skyr oder Magerquark – sättigt bei wenig kcal.');
      add({
        id: 'kcal',
        area: 'ernaehrung',
        severity: rel > 0.1 ? 'warn' : 'info',
        title: 'Du isst mehr als geplant',
        detail: `Ø ${fmt(n7.avg.kcal)} kcal statt ${fmt(goals.kcal)} kcal (${pctSigned(rel)}; ${adherence}).${
          goals.type === 'defizit' ? ' Damit schrumpft dein Defizit.' : ''
        }`,
        actions,
      });
    } else {
      const bulking = goals.type === 'aufbau' || goals.type === 'kraft';
      const cutting = goals.type === 'defizit' || goals.type === 'recomp';
      const severity: Severity = bulking ? (rel < -0.1 ? 'warn' : 'info') : cutting && rel < -0.15 ? 'warn' : 'info';
      const actions = [`Erhöhe im Schnitt um ca. ${fmt(roundTo(-dev, 50))} kcal pro Tag.`];
      if (bulking)
        actions.push('Einfache Extras: 60 g Haferflocken (≈ 225 kcal), 30 g Nüsse (≈ 190 kcal), eine Banane (≈ 105 kcal) vor dem Training.');
      if (cutting && rel < -0.15)
        actions.push('Ein zu großes Defizit kostet Muskelmasse und Trainingsleistung – lieber langsamer abnehmen.');
      add({
        id: 'kcal',
        area: 'ernaehrung',
        severity,
        title: bulking ? 'Zu wenig Energie für dein Ziel' : 'Du isst weniger als geplant',
        detail: `Ø ${fmt(n7.avg.kcal)} kcal statt ${fmt(goals.kcal)} kcal (${pctSigned(rel)}; ${adherence}).`,
        actions,
      });
    }

    const pRatio = n7.avg.protein / goals.protein;
    if (pRatio >= 0.95) {
      add({
        id: 'protein',
        area: 'ernaehrung',
        severity: 'ok',
        title: 'Proteinziel erreicht',
        detail: `Ø ${fmt(n7.avg.protein)} g Protein (Ziel ${fmt(goals.protein)} g).`,
        actions: [],
      });
    } else {
      const own = proteinRichFoods(foods);
      const ideas = own.length
        ? own.map((f) => `${f.name} (${fmt(f.per100.protein, 1)} g Protein/100 ${f.unit})`)
        : PROTEIN_SUGGESTIONS.filter((s) => s.protein <= proteinGap + 15)
            .slice(0, 3)
            .map((s) => `${s.name} ≈ ${s.protein} g`);
      add({
        id: 'protein',
        area: 'ernaehrung',
        severity: pRatio < 0.85 ? 'warn' : 'info',
        title: 'Zu wenig Protein',
        detail: `Ø ${fmt(n7.avg.protein)} g statt ${fmt(goals.protein)} g – es fehlen täglich ca. ${fmt(proteinGap)} g.${
          bodyWeight ? ` Das sind ${fmt(n7.avg.protein / bodyWeight, 1)} g/kg Körpergewicht.` : ''
        }`,
        actions: [
          `Plane ca. ${fmt(roundTo(proteinGap, 5))} g Protein zusätzlich ein, verteilt auf 3–5 Mahlzeiten.`,
          ideas.length ? `Gute Quellen: ${ideas.join(', ')}.` : '',
        ].filter(Boolean),
      });
    }

    if (bodyWeight && n7.avg.fat < bodyWeight * 0.6) {
      add({
        id: 'fett',
        area: 'ernaehrung',
        severity: 'warn',
        title: 'Sehr wenig Fett',
        detail: `Ø ${fmt(n7.avg.fat)} g Fett = ${fmt(n7.avg.fat / bodyWeight, 1)} g/kg. Unter ca. 0,6 g/kg kann das die Hormonproduktion beeinträchtigen.`,
        actions: ['Ergänze gesunde Fette: Olivenöl, Nüsse, Avocado, Lachs, Eier.'],
      });
    }
    if ((goals.type === 'aufbau' || goals.type === 'kraft') && n7.avg.carbs < goals.carbs * 0.75) {
      add({
        id: 'carbs',
        area: 'ernaehrung',
        severity: 'info',
        title: 'Wenig Kohlenhydrate für Leistung',
        detail: `Ø ${fmt(n7.avg.carbs)} g statt ${fmt(goals.carbs)} g. Kohlenhydrate füllen die Glykogenspeicher für schwere Sätze.`,
        actions: ['Iss 1–3 Stunden vor dem Training eine kohlenhydratreiche Mahlzeit (Reis, Kartoffeln, Haferflocken, Brot).'],
      });
    }
    if (n7.daysLogged < 5) {
      add({
        id: 'ernaehrung-lueckenhaft',
        area: 'ernaehrung',
        severity: 'info',
        title: 'Lückenhafte Erfassung',
        detail: `Nur ${n7.daysLogged} von 7 Tagen erfasst – die Durchschnitte sind dadurch weniger aussagekräftig.`,
        actions: ['Auch an Wochenenden und bei Restaurantbesuchen grob schätzen und eintragen.'],
      });
    }
  }

  // ------------------------------------------------------------ Gewicht
  if (!weight || weight.ratePerWeek == null) {
    add({
      id: 'gewicht-daten',
      area: 'gewicht',
      severity: 'info',
      title: 'Gewichtsverlauf fehlt',
      detail: weight
        ? `Für einen Trend brauche ich mindestens 4 Messungen über 7+ Tage (aktuell ${weight.entriesInWindow}).`
        : 'Ohne Gewichtsdaten kann ich nicht prüfen, ob dein Kalorienziel zu deinem Ziel passt.',
      actions: ['Wiege dich 3–7× pro Woche morgens nach dem Toilettengang und trage es unter „Ziele“ ein.'],
    });
  } else {
    const actual = weight.ratePerWeek;
    const target = goals.weeklyRate;
    const diff = actual - target;
    const tol = Math.max(0.15, (bodyWeight ?? 80) * 0.002);
    const kcalShift = roundTo(Math.abs(diff) * KCAL_PER_KG_WEEK_PER_DAY, 50);
    const rateText = `${fmtSigned(actual, 2)} kg/Woche (Ziel ${fmtSigned(target, 2)} kg/Woche)`;
    const newTarget =
      recommendedKcal != null && Math.abs(recommendedKcal - goals.kcal) >= 100
        ? `Dein geschätzter echter Verbrauch liegt bei ~${fmt(actualTdee!)} kcal. Neues Kalorienziel für deine Wunschrate: ~${fmt(recommendedKcal)} kcal/Tag.`
        : '';
    let eta = '';
    if (goals.targetWeight && bodyWeight && Math.abs(actual) > 0.02) {
      const weeks = (goals.targetWeight - bodyWeight) / actual;
      if (weeks > 0 && weeks < 200) eta = ` Bei diesem Tempo erreichst du ${fmt(goals.targetWeight, 1)} kg in ca. ${fmt(Math.ceil(weeks))} Wochen.`;
    }
    if (Math.abs(diff) <= tol) {
      add({
        id: 'gewicht',
        area: 'gewicht',
        severity: 'ok',
        title: 'Gewichtsverlauf im Plan',
        detail: `Trend: ${rateText}.${eta}`,
        actions: [],
      });
    } else {
      const tooHigh = diff > 0; // nimmt mehr zu / weniger ab als geplant
      let title: string;
      let severity: Severity = 'warn';
      if (target < 0) {
        title = tooHigh ? (actual >= 0.05 ? 'Du nimmst zu statt ab' : 'Du nimmst langsamer ab als geplant') : 'Du nimmst zu schnell ab';
        if (!tooHigh && bodyWeight && actual < -bodyWeight * 0.01) severity = 'alert';
      } else if (target > 0) {
        title = tooHigh ? 'Du nimmst zu schnell zu' : actual < 0 ? 'Du nimmst ab statt zu' : 'Du nimmst langsamer zu als geplant';
      } else {
        title = tooHigh ? 'Dein Gewicht steigt' : 'Dein Gewicht sinkt';
      }
      const actions = [
        tooHigh
          ? `Reduziere deine Kalorien um ca. ${fmt(kcalShift)} kcal/Tag${target < 0 ? ' oder erhöhe deine Alltagsbewegung (z. B. +3.000 Schritte ≈ 120 kcal)' : ''}.`
          : `Erhöhe deine Kalorien um ca. ${fmt(kcalShift)} kcal/Tag.`,
      ];
      if (newTarget) actions.push(newTarget);
      if (!tooHigh && target < 0)
        actions.push('Zu schneller Gewichtsverlust geht oft auf Kosten der Muskulatur – halte das Protein hoch und trainiere schwer weiter.');
      if (tooHigh && target > 0) actions.push('Mehr als nötig zuzunehmen bedeutet vor allem zusätzliches Körperfett.');
      add({
        id: 'gewicht',
        area: 'gewicht',
        severity,
        title,
        detail: `Trend der letzten 3 Wochen: ${rateText}.${eta}`,
        actions,
      });
    }
  }

  // ------------------------------------------------------------ Training
  const days7 = trainingDays(sets, addDays(today, -6), today).length;
  const firstSet = sets.reduce<ISODate | null>((min, s) => (!min || s.date < min ? s.date : min), null);
  const spanDays = firstSet ? clamp(diffDays(firstSet, today) + 1, 7, 28) : 28;
  const daysInSpan = trainingDays(sets, addDays(today, -(spanDays - 1)), today).length;
  const trainingPerWeek = (daysInSpan / spanDays) * 7;

  const byExercise = sessionsByExercise(sets);
  const trends = [...byExercise.values()]
    .map((sessions) => exerciseTrend(sessions, today))
    .filter((t): t is ExerciseTrend => !!t && t.lastDate >= addDays(today, -56))
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate) || b.totalSessions - a.totalSessions);

  // Mögliche Ursachen für ausbleibenden Kraftfortschritt
  const causes: string[] = [];
  if (n7.daysLogged >= 3 && n7.avg.protein < goals.protein * 0.9)
    causes.push(`Protein erhöhen – aktuell Ø ${fmt(n7.avg.protein)} g statt ${fmt(goals.protein)} g.`);
  if (sleep7.nights >= 3 && sleep7.avgMin < goals.sleepHours * 60 - 30)
    causes.push(`Mehr schlafen – aktuell Ø ${fmt(sleep7.avgMin / 60, 1)} h statt ${fmt(goals.sleepHours, 1)} h.`);
  if ((goals.type === 'aufbau' || goals.type === 'kraft') && n7.daysLogged >= 3 && n7.avg.kcal < goals.kcal * 0.95)
    causes.push(`Mehr essen – für ${GOAL_SHORT[goals.type]} brauchst du einen Überschuss (Ø ${fmt(n7.avg.kcal)} statt ${fmt(goals.kcal)} kcal).`);

  if (!firstSet) {
    add({
      id: 'training-daten',
      area: 'training',
      severity: 'info',
      title: 'Noch keine Trainingsdaten',
      detail: 'Sobald du Sätze einträgst, bewerte ich deinen Fortschritt pro Übung.',
      actions: ['Trage im Gym jeden Satz ein: Übung, Gewicht, Wiederholungen.'],
    });
  } else {
    if (trainingPerWeek < goals.trainingDays - 0.5) {
      add({
        id: 'frequenz',
        area: 'training',
        severity: trainingPerWeek < goals.trainingDays - 1.5 ? 'warn' : 'info',
        title: 'Du trainierst seltener als geplant',
        detail: `Ø ${fmt(trainingPerWeek, 1)} Einheiten pro Woche statt ${goals.trainingDays} (diese Woche: ${days7}).`,
        actions: [
          'Lege feste Trainingstage im Kalender fest und behandle sie wie Termine.',
          goals.trainingDays >= 4
            ? 'Wenn die Zeit knapp ist: lieber 3 volle Ganzkörper-Einheiten als 4–5 halbe.'
            : 'Schon 45 Minuten mit 4–5 Grundübungen reichen für Fortschritt.',
        ],
      });
    } else {
      add({
        id: 'frequenz',
        area: 'training',
        severity: 'ok',
        title: 'Trainingsfrequenz im Plan',
        detail: `Ø ${fmt(trainingPerWeek, 1)} Einheiten pro Woche (Ziel ${goals.trainingDays}).`,
        actions: [],
      });
    }

    const progressing = trends.filter((t) => t.status === 'fortschritt' || t.status === 'starker-fortschritt');
    const stagnating = trends.filter((t) => t.status === 'stagnation');
    const declining = trends.filter((t) => t.status === 'rueckgang');
    const list = (ts: ExerciseTrend[]) =>
      ts
        .slice(0, 4)
        .map((t) => `${t.exercise} (${pctSigned(t.pctPerWeek, 1)}/Woche)`)
        .join(', ');

    if (progressing.length) {
      add({
        id: 'kraft-fortschritt',
        area: 'training',
        severity: 'ok',
        title: 'Fortschritt bei deinen Übungen',
        detail: list(progressing),
        actions: [],
      });
    }

    if (stagnating.length) {
      const inDeficit = goals.type === 'defizit';
      add({
        id: 'kraft-stagnation',
        area: 'training',
        severity: inDeficit ? 'info' : 'warn',
        title: 'Stagnation',
        detail: `${list(stagnating)}.${inDeficit ? ' Im Defizit ist Kraft halten bereits ein Erfolg.' : ''}`,
        actions: [
          ...causes,
          'Wechsle den Wiederholungsbereich für 3–4 Wochen (z. B. 5×5 schwer statt 3×10) oder wähle eine Variante der Übung.',
          'Wenn du seit >6 Wochen ohne Pause hart trainierst: eine Deload-Woche mit ~50 % Volumen einlegen.',
        ],
      });
    }
    if (declining.length) {
      add({
        id: 'kraft-rueckgang',
        area: 'training',
        severity: 'warn',
        title: 'Leistung geht zurück',
        detail: `${list(declining)}.`,
        actions: [
          ...causes,
          goals.type === 'defizit'
            ? 'Verkleinere das Defizit etwas (+150–250 kcal) und halte das Trainingsgewicht, reduziere lieber das Volumen.'
            : 'Prüfe deine Regeneration: Schlaf, Stress, Trainingsvolumen. Eine Deload-Woche hilft oft.',
        ],
      });
    }

    if ((goals.type === 'aufbau' || goals.type === 'recomp') && sets.length >= 30) {
      const groups = setsPerMuscleGroup(sets, exercises, addDays(today, -13), today);
      const missing = ['Brust', 'Rücken', 'Beine', 'Schultern'].filter((g) => !groups.get(g));
      if (missing.length && missing.length < 4) {
        add({
          id: 'muskelgruppen',
          area: 'training',
          severity: 'info',
          title: 'Vernachlässigte Muskelgruppen',
          detail: `In den letzten 14 Tagen keine Sätze für: ${missing.join(', ')}.`,
          actions: ['Für Muskelaufbau ca. 10–20 harte Sätze pro Muskelgruppe und Woche einplanen.'],
        });
      }
    }
  }

  // Kraftziele
  const strength: StrengthGoalStatus[] = goals.strengthGoals.map((g) => {
    const t = trends.find((x) => x.exercise.toLowerCase() === g.exercise.toLowerCase());
    const all = [...byExercise.entries()].find(([k]) => k.toLowerCase() === g.exercise.toLowerCase())?.[1] ?? [];
    const recent = all.filter((s) => s.metricType === 'e1rm' && s.date >= addDays(today, -28));
    const current = recent.length ? Math.max(...recent.map((s) => s.bestE1RM)) : all.length ? all[all.length - 1].bestE1RM : null;
    const slope = t && t.metricType === 'e1rm' && t.status !== 'zu-wenig-daten' ? t.slopePerWeek : null;
    const gap = current != null ? g.target1RM - current : null;
    const weeksToGoal = gap != null && gap > 0 && slope && slope > 0 ? gap / slope : gap != null && gap <= 0 ? 0 : null;
    let onTrack: boolean | null = null;
    if (gap != null && gap <= 0) onTrack = true;
    else if (g.deadline && weeksToGoal != null) onTrack = weeksToGoal <= diffDays(today, g.deadline) / 7;
    else if (g.deadline && current != null && slope != null && slope <= 0) onTrack = false;
    return {
      exercise: g.exercise,
      target: g.target1RM,
      current,
      progress: current ? clamp(current / g.target1RM, 0, 1) : 0,
      weeksToGoal,
      deadline: g.deadline,
      onTrack,
    };
  });
  for (const s of strength) {
    if (s.current == null) {
      add({
        id: `kraftziel-${s.exercise}`,
        area: 'training',
        severity: 'info',
        title: `Kraftziel ${s.exercise}: noch keine Daten`,
        detail: `Ziel: ${fmt(s.target, 1)} kg (1RM).`,
        actions: [`Trage deine ${s.exercise}-Sätze ein, damit ich den Weg zum Ziel berechnen kann.`],
      });
      continue;
    }
    if (s.current >= s.target) {
      add({
        id: `kraftziel-${s.exercise}`,
        area: 'training',
        severity: 'ok',
        title: `Kraftziel ${s.exercise} erreicht`,
        detail: `Geschätztes 1RM ${fmt(s.current, 1)} kg ≥ Ziel ${fmt(s.target, 1)} kg. Zeit für ein neues Ziel!`,
        actions: [],
      });
      continue;
    }
    const gapText = `Aktuell ${fmt(s.current, 1)} kg von ${fmt(s.target, 1)} kg (${Math.round(s.progress * 100)} %).`;
    if (s.onTrack === false && s.deadline) {
      const weeksLeft = Math.max(1, diffDays(today, s.deadline) / 7);
      const needed = (s.target - s.current) / weeksLeft;
      add({
        id: `kraftziel-${s.exercise}`,
        area: 'training',
        severity: 'warn',
        title: `Kraftziel ${s.exercise} nicht auf Kurs`,
        detail: `${gapText} Bis ${formatDayMonth(s.deadline)} bräuchtest du +${fmt(needed, 1)} kg/Woche${
          s.weeksToGoal ? `, bei aktuellem Tempo dauert es ca. ${fmt(Math.ceil(s.weeksToGoal))} Wochen` : ''
        }.`,
        actions: [
          ...causes,
          `Trainiere ${s.exercise} 2× pro Woche, eine Einheit schwer (3–5 Wdh.), eine mit mehr Volumen (6–10 Wdh.).`,
        ],
      });
    } else {
      add({
        id: `kraftziel-${s.exercise}`,
        area: 'training',
        severity: s.weeksToGoal != null ? 'ok' : 'info',
        title: `Kraftziel ${s.exercise}`,
        detail: `${gapText}${s.weeksToGoal != null ? ` Bei aktuellem Tempo in ca. ${fmt(Math.ceil(s.weeksToGoal))} Wochen erreicht.` : ' Noch kein klarer Aufwärtstrend.'}`,
        actions: [],
      });
    }
  }

  // ------------------------------------------------------------ Schlaf
  const targetMin = goals.sleepHours * 60;
  if (sleep7.nights < 3) {
    add({
      id: 'schlaf-daten',
      area: 'schlaf',
      severity: 'info',
      title: 'Zu wenig Schlafdaten',
      detail: `In den letzten 7 Tagen sind ${sleep7.nights} Nächte erfasst.`,
      actions: ['Trage morgens kurz ein, wann du ins Bett gegangen und aufgewacht bist.'],
    });
  } else {
    if (sleep7.avgMin < targetMin - 30) {
      const recent = sleep.filter((e) => e.date >= addDays(today, -6));
      const avgWake = mean(recent.map((e) => timeToMinutes(e.wakeTime)));
      const idealBed = minutesToTime(avgWake - targetMin - 15);
      add({
        id: 'schlaf',
        area: 'schlaf',
        severity: sleep7.avgMin < 360 ? 'alert' : 'warn',
        title: 'Zu wenig Schlaf',
        detail: `Ø ${fmt(sleep7.avgMin / 60, 1)} h statt ${fmt(goals.sleepHours, 1)} h. Schlafdefizit diese Woche: ${fmt(sleep7.debtHours, 1)} h. Schlaf ist entscheidend für Regeneration, Kraft und Appetitkontrolle.`,
        actions: [
          `Bei deiner üblichen Aufstehzeit solltest du gegen ${idealBed} Uhr im Bett sein.`,
          'Koffein nach 14 Uhr meiden, 60 Minuten vor dem Schlafen keine Bildschirme, Schlafzimmer kühl und dunkel halten.',
        ],
      });
    } else {
      add({
        id: 'schlaf',
        area: 'schlaf',
        severity: 'ok',
        title: 'Genug Schlaf',
        detail: `Ø ${fmt(sleep7.avgMin / 60, 1)} h pro Nacht (Ziel ${fmt(goals.sleepHours, 1)} h).`,
        actions: [],
      });
    }
    if (sleep7.bedtimeSdMin > 60) {
      add({
        id: 'schlaf-rhythmus',
        area: 'schlaf',
        severity: 'info',
        title: 'Unregelmäßiger Schlafrhythmus',
        detail: `Deine Zubettgehzeit schwankt um ±${fmt(sleep7.bedtimeSdMin)} Minuten.`,
        actions: ['Feste Schlafenszeiten (auch am Wochenende ±30 min) verbessern die Schlafqualität deutlich.'],
      });
    }
    if (sleep7.avgQuality > 0 && sleep7.avgQuality < 3) {
      add({
        id: 'schlaf-qualitaet',
        area: 'schlaf',
        severity: 'info',
        title: 'Schlafqualität niedrig',
        detail: `Ø Qualität ${fmt(sleep7.avgQuality, 1)} von 5.`,
        actions: ['Achte auf spätes, schweres Essen, Alkohol und Training kurz vor dem Schlafen – das sind häufige Ursachen.'],
      });
    }
  }

  recs.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  // ------------------------------------------------------------ Zusammenhänge
  const insights = combinedInsights(input);

  // ------------------------------------------------------------ Score
  const parts: ScorePart[] = [];
  if (n7.daysLogged >= 3) {
    parts.push({ key: 'ernaehrung', label: 'Kalorien', value: n7.kcalAdherence });
    parts.push({ key: 'protein', label: 'Protein', value: n7.proteinHitRate });
  }
  if (firstSet) parts.push({ key: 'training', label: 'Training', value: clamp(trainingPerWeek / goals.trainingDays, 0, 1) });
  if (sleep7.nights >= 3) parts.push({ key: 'schlaf', label: 'Schlaf', value: clamp(sleep7.avgMin / targetMin, 0, 1) ** 2 });
  if (weight?.ratePerWeek != null)
    parts.push({
      key: 'gewicht',
      label: 'Gewichtstrend',
      value: clamp(1 - Math.abs(weight.ratePerWeek - goals.weeklyRate) / 0.5, 0, 1),
    });
  const total = parts.length ? mean(parts.map((p) => p.value)) : null;

  return {
    nutrition7,
    nutrition21,
    sleep7,
    weight,
    trends,
    trainingDays7: days7,
    trainingPerWeek,
    actualTdee,
    recommendedKcal,
    strength,
    recommendations: recs,
    insights,
    score: { total, parts },
  };
}

function compareGroups(
  perf: { date: ISODate; change: number }[],
  classify: (date: ISODate) => boolean | null,
): { a: number[]; b: number[] } {
  const a: number[] = [];
  const b: number[] = [];
  for (const p of perf) {
    const c = classify(p.date);
    if (c === true) a.push(p.change);
    else if (c === false) b.push(p.change);
  }
  return { a, b };
}

function insightFrom(
  id: string,
  title: string,
  labelA: string,
  labelB: string,
  groups: { a: number[]; b: number[] },
  factor: string,
): Insight | null {
  if (groups.a.length < 2 || groups.b.length < 2) return null;
  const ma = mean(groups.a);
  const mb = mean(groups.b);
  const delta = ma - mb;
  const conclusion =
    delta > 0.01
      ? `${factor} wirkt sich bei dir messbar positiv auf die Kraft aus (+${fmt(delta * 100, 1)} Prozentpunkte).`
      : delta < -0.01
        ? `Kein Vorteil erkennbar – eher das Gegenteil (${fmt(delta * 100, 1)} Prozentpunkte). Mehr Daten abwarten.`
        : 'Bisher kein deutlicher Unterschied erkennbar.';
  return {
    id,
    title,
    detail: `${labelA}: Ø ${pctSigned(ma, 1)} ggü. der Vor-Einheit (n = ${groups.a.length}). ${labelB}: Ø ${pctSigned(mb, 1)} (n = ${groups.b.length}).`,
    conclusion,
  };
}

/** Verknüpft Trainingsleistung mit Schlaf und Ernährung. */
export function combinedInsights({ today, goals, sets, meals, sleep }: AnalysisInput): Insight[] {
  const perf = sessionPerformance(sets).filter((p) => p.date >= addDays(today, -120));
  if (perf.length < 4) return [];
  const out: Insight[] = [];

  const sleepByDate = new Map(sleep.map((s) => [s.date, s]));
  const targetMin = goals.sleepHours * 60 - 30;
  const sleepInsight = insightFrom(
    'schlaf-leistung',
    'Schlaf ↔ Trainingsleistung',
    `Nach Nächten mit ≥ ${fmt(targetMin / 60, 1)} h Schlaf`,
    'Nach kürzeren Nächten',
    compareGroups(perf, (d) => {
      const s = sleepByDate.get(d);
      return s ? s.durationMin >= targetMin : null;
    }),
    'Ausreichend Schlaf',
  );
  if (sleepInsight) out.push(sleepInsight);

  const totals = dailyTotals(meals);
  const kcalInsight = insightFrom(
    'kalorien-leistung',
    'Kalorien am Vortag ↔ Trainingsleistung',
    `Wenn du am Vortag ≥ 90 % deines Kalorienziels gegessen hast`,
    'Bei weniger',
    compareGroups(perf, (d) => {
      const t = totals.get(addDays(d, -1));
      return t ? t.kcal >= goals.kcal * 0.9 : null;
    }),
    'Genug Energie am Vortag',
  );
  if (kcalInsight) out.push(kcalInsight);

  const proteinInsight = insightFrom(
    'protein-leistung',
    'Protein (3 Tage) ↔ Trainingsleistung',
    'Bei Ø ≥ 90 % des Proteinziels in den 3 Tagen davor',
    'Bei weniger Protein',
    compareGroups(perf, (d) => {
      const vals = [1, 2, 3].map((i) => totals.get(addDays(d, -i))).filter(Boolean);
      if (vals.length < 2) return null;
      return mean(vals.map((v) => v!.protein)) >= goals.protein * 0.9;
    }),
    'Ausreichend Protein',
  );
  if (proteinInsight) out.push(proteinInsight);

  return out;
}

