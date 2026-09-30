import { useLiveQuery } from 'dexie-react-hooks';
import { db, getKV } from './db';
import { DEFAULT_SCHEDULE, dayNeeds, weekNeeds, type DayNeeds, type NeedsInput } from './lib/dailyNeeds';
import type { Goals, NutritionPreferences, Profile, TrainingPlan, WeekSchedule } from './types';
import { DEFAULT_GOALS } from './types';

export const DEFAULT_PREFS: NutritionPreferences = { diet: 'alles', mealsPerDay: 4, dislikes: '', cookingMinutes: 20 };

export async function loadNeedsInput(): Promise<NeedsInput & { prefs: NutritionPreferences; configured: boolean }> {
  const [goals, profile, schedule, plan, prefs, activities, weights] = await Promise.all([
    getKV<Goals>('goals', DEFAULT_GOALS),
    getKV<Profile | null>('profile', null),
    getKV<WeekSchedule | null>('schedule', null),
    getKV<TrainingPlan | null>('trainingPlan', null),
    getKV<NutritionPreferences>('nutritionPrefs', DEFAULT_PREFS),
    db.activities.toArray(),
    db.weights.orderBy('date').reverse().limit(7).toArray(),
  ]);
  const weight = weights.length ? weights.reduce((s, w) => s + w.weight, 0) / weights.length : null;
  return {
    goals,
    profile,
    weight,
    schedule: schedule ?? DEFAULT_SCHEDULE,
    plan,
    activities,
    mealsPerDay: prefs.mealsPerDay,
    prefs,
    configured: !!schedule || !!plan,
  };
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
