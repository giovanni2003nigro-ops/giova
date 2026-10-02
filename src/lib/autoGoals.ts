import type { Goals, ISODate, MealEntry, WeightEntry } from '../types';
import { weightTrend } from './body';
import { addDays } from './dates';
import { isAuto, weekNeeds, type NeedsInput } from './dailyNeeds';
import { estimateActualTdee, GOAL_CONFIG } from './goals';
import { limits } from './guardrails';
import { summarizeNutrition } from './nutrition';

/**
 * Gemessener Verbrauch aus den letzten 3 Wochen: Aufnahme − Gewichtsänderung.
 * Braucht mind. 10 Tage Essensprotokoll und einen Gewichtstrend (4 Messungen über 7+ Tage).
 */
export function measuredTdee(meals: MealEntry[], weights: WeightEntry[], today: ISODate): number | null {
  const trend = weightTrend(weights, today);
  if (trend?.ratePerWeek == null) return null;
  const n = summarizeNutrition(meals, { kcal: 0, protein: 0 }, addDays(today, -21), addDays(today, -1));
  if (n.daysLogged < 10) return null;
  return Math.round(estimateActualTdee(n.avg.kcal, trend.ratePerWeek));
}

/** Protein & Fett nach Zieltyp, nie unter den Rahmenbedingungen. */
export function autoMacros(goals: Goals, weight: number) {
  const cfg = GOAL_CONFIG[goals.type];
  const lim = limits(null, weight);
  return {
    protein: Math.max(lim.minProtein ?? 0, Math.round(weight * cfg.proteinPerKg)),
    fat: Math.max(lim.minFat ?? 0, Math.round(weight * cfg.fatPerKg)),
  };
}

/**
 * Wirksame Tagesziele: Im Automatik-Modus werden Kalorien und Makros aus Profil, Gewicht,
 * Alltag, Trainingsplan, gemessenem Verbrauch und Wochenrate berechnet (Wochenschnitt der
 * Tagesziele). Im manuellen Modus bleiben die eingetragenen Werte.
 */
export function resolveGoals(input: NeedsInput, today: ISODate): Goals {
  const g = input.goals;
  if (!isAuto(input)) return { ...g, auto: false };
  const { protein, fat } = autoMacros(g, input.weight!);
  const goals: Goals = { ...g, auto: true, protein, fat };
  const week = weekNeeds(today, { ...input, goals });
  const kcal = Math.round(week.reduce((s, d) => s + d.targets.kcal, 0) / 7 / 10) * 10;
  return { ...goals, kcal, carbs: Math.max(50, Math.round((kcal - protein * 4 - fat * 9) / 4)) };
}
