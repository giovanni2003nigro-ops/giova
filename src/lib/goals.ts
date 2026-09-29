import type { GoalType, Goals, Profile } from '../types';
import { round } from './stats';

/** Energiegehalt von 1 kg Körpergewichtsveränderung (Fett/Gewebe-Mix). */
export const KCAL_PER_KG = 7700;
/** kcal pro Tag, die 1 kg/Woche entsprechen */
export const KCAL_PER_KG_WEEK_PER_DAY = KCAL_PER_KG / 7;

export const ACTIVITY_LEVELS = [
  { value: 1.3, label: 'Wenig aktiv (Bürojob, kaum Bewegung)' },
  { value: 1.45, label: 'Leicht aktiv (1–2× Training/Woche)' },
  { value: 1.6, label: 'Aktiv (3–5× Training/Woche)' },
  { value: 1.75, label: 'Sehr aktiv (6–7× Training oder körperliche Arbeit)' },
  { value: 1.9, label: 'Extrem aktiv (harte Arbeit + Training)' },
];

/** Grundumsatz nach Mifflin-St Jeor. */
export function bmr(p: Profile, weightKg: number): number {
  return 10 * weightKg + 6.25 * p.height - 5 * p.age + (p.sex === 'm' ? 5 : -161);
}

export function tdee(p: Profile, weightKg: number): number {
  return bmr(p, weightKg) * p.activity;
}

interface GoalConfig {
  /** Wochenrate als Anteil des Körpergewichts */
  rateFraction: number;
  proteinPerKg: number;
  fatPerKg: number;
  description: string;
}

export const GOAL_CONFIG: Record<GoalType, GoalConfig> = {
  defizit: {
    rateFraction: -0.005,
    proteinPerKg: 2.0,
    fatPerKg: 0.8,
    description: 'ca. 0,5 % Körpergewicht pro Woche abnehmen, viel Protein zum Muskelerhalt',
  },
  erhalt: {
    rateFraction: 0,
    proteinPerKg: 1.8,
    fatPerKg: 0.9,
    description: 'Gewicht stabil halten',
  },
  aufbau: {
    rateFraction: 0.0025,
    proteinPerKg: 1.8,
    fatPerKg: 1.0,
    description: 'leichter Überschuss, ca. 0,25 % Körpergewicht pro Woche zunehmen',
  },
  kraft: {
    rateFraction: 0.001,
    proteinPerKg: 1.8,
    fatPerKg: 1.0,
    description: 'Kraftwerte steigern bei minimalem Überschuss',
  },
  recomp: {
    rateFraction: -0.0015,
    proteinPerKg: 2.2,
    fatPerKg: 0.8,
    description: 'leichtes Defizit mit sehr viel Protein und progressivem Training',
  },
};

export interface SuggestedTargets {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  weeklyRate: number;
  tdee: number;
}

/** Schlägt Kalorien- und Makroziele passend zum Zieltyp vor. */
export function suggestTargets(p: Profile, weightKg: number, type: GoalType, measuredTdee?: number | null): SuggestedTargets {
  const cfg = GOAL_CONFIG[type];
  const energy = measuredTdee ?? tdee(p, weightKg);
  const weeklyRate = round(weightKg * cfg.rateFraction * 20) / 20; // auf 0,05 kg
  const kcal = Math.round((energy + weeklyRate * KCAL_PER_KG_WEEK_PER_DAY) / 10) * 10;
  const protein = Math.round(weightKg * cfg.proteinPerKg);
  const fat = Math.round(weightKg * cfg.fatPerKg);
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4));
  return { kcal, protein, carbs, fat, weeklyRate, tdee: Math.round(energy) };
}

/**
 * Schätzt den tatsächlichen Tagesverbrauch aus Kalorienaufnahme und Gewichtsverlauf:
 * Verbrauch ≈ Aufnahme − (Gewichtsänderung/Woche × 7700 / 7).
 */
export function estimateActualTdee(avgIntake: number, ratePerWeek: number): number {
  return avgIntake - ratePerWeek * KCAL_PER_KG_WEEK_PER_DAY;
}

/** Kalorienmenge, die bei gegebenem Verbrauch zur Zielrate führt. */
export function kcalForRate(actualTdee: number, weeklyRate: number): number {
  return Math.round((actualTdee + weeklyRate * KCAL_PER_KG_WEEK_PER_DAY) / 10) * 10;
}

/** Makros ergeben kcal – hilft beim Prüfen der eingetragenen Ziele. */
export function kcalOfTargets(g: Pick<Goals, 'protein' | 'carbs' | 'fat'>): number {
  return g.protein * 4 + g.carbs * 4 + g.fat * 9;
}
