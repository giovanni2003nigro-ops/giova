import type { Goals, Profile, TrainingPlan } from '../types';
import { bmr } from './goals';
import { fmt, fmtSigned, round } from './stats';

/**
 * Rahmenbedingungen: Grenzen, die IMMER gelten – egal was der Plan oder Wunsch ist.
 * Alles andere (Kalorien pro Tag, Makro-Verteilung, Mahlzeiten) passt sich an Plan und Alltag an.
 * Der Coach darf diese Grenzen nicht unterschreiten, sondern erklärt die nächstbeste Variante.
 */

export interface Limits {
  /** Nie weniger Kalorien als der Grundumsatz bzw. 1.500 (m) / 1.200 (w) kcal */
  minKcal: number;
  /** Protein in g pro Tag (1,6 g/kg mit Training, sonst 1,2 g/kg) */
  minProtein: number | null;
  /** Fett in g pro Tag (0,6 g/kg) */
  minFat: number | null;
  /** Höchstens 1 % Körpergewicht pro Woche abnehmen (kg/Woche, positiv) */
  maxLossPerWeek: number;
  /** Höchstens 0,5 % Körpergewicht pro Woche zunehmen */
  maxGainPerWeek: number;
  /** Schlafziel mindestens 7 h */
  minSleepHours: number;
  /** Mindestens 1 Ruhetag pro Woche */
  maxTrainingDays: number;
  /** Höchstens 3 harte Einheiten pro Woche */
  maxHardSessions: number;
}

export function limits(profile: Profile | null, weight: number | null, trains = true): Limits {
  const sexMin = profile?.sex === 'w' ? 1200 : 1500;
  const base = profile && weight ? Math.round(bmr(profile, weight) / 10) * 10 : 0;
  return {
    minKcal: Math.max(sexMin, base),
    minProtein: weight ? Math.round(weight * (trains ? 1.6 : 1.2)) : null,
    minFat: weight ? Math.round(weight * 0.6) : null,
    maxLossPerWeek: weight ? round(weight * 0.01, 2) : 1,
    maxGainPerWeek: weight ? round(weight * 0.005, 2) : 0.5,
    minSleepHours: 7,
    maxTrainingDays: 6,
    maxHardSessions: 3,
  };
}

/** Setzt Ziele auf die Rahmenbedingungen (z. B. für den Coach) und nennt jede Änderung. */
export function enforceGoals(goals: Goals, lim: Limits): { goals: Goals; changes: string[] } {
  const g = { ...goals };
  const changes: string[] = [];
  if (g.weeklyRate < -lim.maxLossPerWeek) {
    changes.push(`Abnehmrate auf ${fmtSigned(-lim.maxLossPerWeek, 2)} kg/Woche begrenzt (max. 1 % Körpergewicht)`);
    g.weeklyRate = -lim.maxLossPerWeek;
  }
  if (g.weeklyRate > lim.maxGainPerWeek) {
    changes.push(`Zunahme auf ${fmtSigned(lim.maxGainPerWeek, 2)} kg/Woche begrenzt (max. 0,5 % Körpergewicht)`);
    g.weeklyRate = lim.maxGainPerWeek;
  }
  if (g.kcal < lim.minKcal) {
    changes.push(`Kalorien auf mindestens ${fmt(lim.minKcal)} kcal angehoben (Grundumsatz)`);
    g.kcal = lim.minKcal;
  }
  if (lim.minProtein != null && g.protein < lim.minProtein) {
    changes.push(`Protein auf mindestens ${fmt(lim.minProtein)} g angehoben`);
    g.protein = lim.minProtein;
  }
  if (lim.minFat != null && g.fat < lim.minFat) {
    changes.push(`Fett auf mindestens ${fmt(lim.minFat)} g angehoben (Hormone)`);
    g.fat = lim.minFat;
  }
  if (g.sleepHours < lim.minSleepHours) {
    changes.push(`Schlafziel auf ${fmt(lim.minSleepHours)} h angehoben`);
    g.sleepHours = lim.minSleepHours;
  }
  if (g.trainingDays > lim.maxTrainingDays) {
    changes.push('Trainingsziel auf 6 Tage begrenzt (1 Ruhetag ist Pflicht)');
    g.trainingDays = lim.maxTrainingDays;
  }
  return { goals: g, changes };
}

export interface Rule {
  id: string;
  label: string;
  /** Was gelten muss */
  requirement: string;
  /** Aktueller Wert */
  current: string;
  ok: boolean;
  /** Was zu tun ist, wenn verletzt */
  fix: string;
}

/** Prüft Ziele und Trainingsplan gegen die Rahmenbedingungen. */
export function checkRules(goals: Goals, plan: TrainingPlan | null, lim: Limits): Rule[] {
  const rules: Rule[] = [];
  rules.push({
    id: 'kcal',
    label: 'Energie',
    requirement: `mind. ${fmt(lim.minKcal)} kcal pro Tag`,
    current: `${fmt(goals.kcal)} kcal`,
    ok: goals.kcal >= lim.minKcal,
    fix: `Kalorienziel auf mindestens ${fmt(lim.minKcal)} kcal anheben – darunter leiden Leistung, Muskeln und Gesundheit.`,
  });
  rules.push({
    id: 'rate',
    label: 'Tempo der Gewichtsänderung',
    requirement: `zwischen ${fmtSigned(-lim.maxLossPerWeek, 2)} und ${fmtSigned(lim.maxGainPerWeek, 2)} kg/Woche`,
    current: `${fmtSigned(goals.weeklyRate, 2)} kg/Woche`,
    ok: goals.weeklyRate >= -lim.maxLossPerWeek && goals.weeklyRate <= lim.maxGainPerWeek,
    fix: 'Wochenrate in den Rahmen bringen – zu schnell kostet Muskeln bzw. bringt vor allem Fett.',
  });
  if (lim.minProtein != null)
    rules.push({
      id: 'protein',
      label: 'Protein',
      requirement: `mind. ${fmt(lim.minProtein)} g (1,6 g/kg)`,
      current: `${fmt(goals.protein)} g`,
      ok: goals.protein >= lim.minProtein,
      fix: `Proteinziel auf mindestens ${fmt(lim.minProtein)} g anheben.`,
    });
  if (lim.minFat != null)
    rules.push({
      id: 'fat',
      label: 'Fett',
      requirement: `mind. ${fmt(lim.minFat)} g (0,6 g/kg)`,
      current: `${fmt(goals.fat)} g`,
      ok: goals.fat >= lim.minFat,
      fix: `Fett auf mindestens ${fmt(lim.minFat)} g anheben – wichtig für Hormone.`,
    });
  rules.push({
    id: 'sleep',
    label: 'Schlaf',
    requirement: `mind. ${fmt(lim.minSleepHours)} h`,
    current: `${fmt(goals.sleepHours, 1)} h`,
    ok: goals.sleepHours >= lim.minSleepHours,
    fix: 'Schlafziel auf mindestens 7 Stunden setzen.',
  });
  const days = plan ? new Set(plan.sessions.map((s) => s.weekday)).size : goals.trainingDays;
  rules.push({
    id: 'rest',
    label: 'Ruhetag',
    requirement: 'mind. 1 Tag pro Woche ohne Training',
    current: `${days} Trainingstage`,
    ok: days <= lim.maxTrainingDays,
    fix: 'Einen Tag pro Woche komplett frei lassen (lockeres Spazieren ist okay).',
  });
  if (plan) {
    const hard = plan.sessions.filter((s) => s.intensity === 'hart').length;
    rules.push({
      id: 'hard',
      label: 'Harte Einheiten',
      requirement: `höchstens ${lim.maxHardSessions} pro Woche`,
      current: `${hard} hart`,
      ok: hard <= lim.maxHardSessions,
      fix: 'Eine harte Einheit in eine lockere umwandeln – Fortschritt entsteht in der Erholung.',
    });
  }
  return rules;
}
