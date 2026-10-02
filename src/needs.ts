import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV } from './db';
import { measuredTdee, resolveGoals } from './lib/autoGoals';
import { DEFAULT_SCHEDULE, dayNeeds, weekNeeds, type DayNeeds, type NeedsInput } from './lib/dailyNeeds';
import { addDays, today as getToday } from './lib/dates';
import type { Goals, NutritionPreferences, Profile, TrainingPlan, WeekSchedule } from './types';
import { DEFAULT_GOALS } from './types';

export const DEFAULT_PREFS: NutritionPreferences = { diet: 'alles', mealsPerDay: 4, dislikes: '', cookingMinutes: 20 };

export type LoadedNeeds = NeedsInput & { prefs: NutritionPreferences; configured: boolean; storedGoals: Goals };

/**
 * Lädt alles, was den Bedarf bestimmt. `goals` sind die wirksamen Ziele
 * (im Automatik-Modus berechnet), `storedGoals` die gespeicherten Eingaben.
 */
export async function loadNeedsInput(ref = getToday()): Promise<LoadedNeeds> {
  const from = addDays(ref, -35);
  const [storedGoals, profile, schedule, plan, prefs, activities, weights, meals] = await Promise.all([
    getKV<Goals>('goals', DEFAULT_GOALS),
    getKV<Profile | null>('profile', null),
    getKV<WeekSchedule | null>('schedule', null),
    getKV<TrainingPlan | null>('trainingPlan', null),
    getKV<NutritionPreferences>('nutritionPrefs', DEFAULT_PREFS),
    db.activities.toArray(),
    db.weights.where('date').between(from, ref, true, true).toArray(),
    db.meals.where('date').between(addDays(ref, -21), ref, true, true).toArray(),
  ]);
  const last7 = [...weights].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7);
  const latest = last7.length ? last7 : await db.weights.orderBy('date').reverse().limit(7).toArray();
  const weight = latest.length ? latest.reduce((s, w) => s + w.weight, 0) / latest.length : null;
  const configured = !!schedule || !!plan;
  const input: NeedsInput = {
    goals: storedGoals,
    profile,
    weight,
    schedule: schedule ?? DEFAULT_SCHEDULE,
    plan,
    activities,
    mealsPerDay: prefs.mealsPerDay,
    measuredTdee: measuredTdee(meals, weights, ref),
    detailed: configured,
  };
  return { ...input, goals: resolveGoals(input, ref), storedGoals, prefs, configured };
}

/** Wirksame Tagesziele (automatisch berechnet oder manuell). */
export async function loadGoals(): Promise<Goals> {
  return (await loadNeedsInput()).goals;
}

/** Wirksame Tagesziele als Hook – aktualisiert sich bei Gewicht, Plan, Alltag, Essen. */
export function useGoals(): Goals | undefined {
  return useLiveQuery(loadGoals, []);
}

/** Bedarf eines Tages – aktualisiert sich bei jeder Änderung von Plan, Alltag, Zielen oder Aktivitäten. */
export function useDayNeeds(date: string): (DayNeeds & { configured: boolean }) | undefined {
  return useLiveQuery(async () => {
    const input = await loadNeedsInput();
    return { ...dayNeeds(date, input), configured: input.configured };
  }, [date]);
}

export function useWeekNeeds(date: string): DayNeeds[] | undefined {
  return useLiveQuery(async () => weekNeeds(date, await loadNeedsInput()), [date]);
}
