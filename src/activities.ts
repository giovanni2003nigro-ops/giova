import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { cloudError, currentUserId, supabase, useSession } from './cloud/client';
import { publishActivity, syncMedals, unpublishActivity } from './cloud/api';
import { toast } from './components/ui';
import { db, getKV, useKV } from './db';
import { today as getToday, toISODate } from './lib/dates';
import { evaluateMedals, liftOf, MEDAL_BY_KEY } from './lib/medals';
import { activityPoints } from './lib/points';
import { estimateKcal, newUid, SPORT_DEFS } from './lib/sports';
import { estimate1RM, sessionsByExercise } from './lib/training';
import type { Activity, Goals, PowerliftingData, Sport, StrengthSummary, TrainingPlan, Visibility, WorkoutSet } from './types';
import { DEFAULT_GOALS } from './types';

export type NewActivity = Omit<Activity, 'id' | 'uid' | 'points' | 'createdAt' | 'visibility'> & {
  uid?: string;
  visibility?: Visibility;
};

async function latestWeight(): Promise<number | null> {
  const last = await db.weights.orderBy('date').last();
  return last?.weight ?? null;
}

/** Standard-Sichtbarkeit für neue Aktivitäten. */
export function useShareDefault(): Visibility {
  return useKV<Visibility>('shareDefault', 'public') ?? 'public';
}

/** Soll eine neue Aktivität automatisch in der Community geteilt werden? */
export async function autoShareEnabled(): Promise<boolean> {
  return getKV<boolean>('autoShare', true);
}

/** Speichert eine Aktivität (Punkte & Kalorien werden berechnet) und teilt sie ggf. automatisch. */
export async function saveActivity(input: NewActivity): Promise<number> {
  const weight = await latestWeight();
  const visibility = input.visibility ?? (await getKV<Visibility>('shareDefault', 'public'));
  const activity: Activity = {
    ...input,
    uid: input.uid ?? newUid(),
    visibility,
    kcal: input.kcal ?? (weight ? estimateKcal(input, weight) : undefined),
    points: activityPoints(input),
    createdAt: Date.now(),
  };
  const id = (await db.activities.add(activity)) as number;
  // Auch „Nur ich“ wird hochgeladen (für andere unsichtbar), damit die Punkte in der Liga zählen
  if (supabase && currentUserId() && (await autoShareEnabled())) {
    publishActivity({ ...activity, id }).catch((err) => toast(`Nicht geteilt: ${cloudError(err)}`));
  }
  return id;
}

/** Ändert eine Aktivität; eine bereits geteilte wird auf dem Server aktualisiert. */
export async function updateActivity(id: number, patch: Partial<Activity>): Promise<void> {
  const cur = await db.activities.get(id);
  if (!cur) return;
  const next: Activity = { ...cur, ...patch, updatedAt: Date.now() };
  next.points = activityPoints(next);
  await db.activities.put(next);
  if (next.remoteId && supabase && currentUserId()) {
    try {
      await publishActivity(next);
    } catch (err) {
      toast(`Server nicht aktualisiert: ${cloudError(err)}`);
    }
  }
}

export async function deleteActivity(a: Activity): Promise<void> {
  if (a.remoteId && supabase && currentUserId()) {
    try {
      await unpublishActivity(a);
    } catch (err) {
      toast(`Auf dem Server nicht gelöscht: ${cloudError(err)}`);
    }
  }
  if (a.id != null) await db.activities.delete(a.id);
}

/** Findet eine schon vorhandene Aktivität mit gleicher Startzeit (±2 min) – gegen doppelte Importe. */
export async function findDuplicate(startTime: number, sport?: Sport): Promise<Activity | undefined> {
  const list = await db.activities.where('startTime').between(startTime - 120_000, startTime + 120_000, true, true).toArray();
  return list.find((a) => !sport || a.sport === sport);
}

// ------------------------------------------------------------------ Krafttraining → Aktivität

/** Fasst die Sätze eines Tages zu einer teilbaren Aktivität zusammen. */
export function strengthFromSets(sets: WorkoutSet[]): { strength: StrengthSummary[]; powerlifting: PowerliftingData } {
  const strength: StrengthSummary[] = [];
  const pl: PowerliftingData = {};
  for (const [exercise, sessions] of sessionsByExercise(sets)) {
    const s = sessions[sessions.length - 1];
    strength.push({
      exercise,
      sets: s.sets,
      reps: s.totalReps,
      topWeight: s.topWeight,
      topReps: s.topReps,
      bestE1RM: Math.round(s.bestE1RM * 10) / 10,
      volume: Math.round(s.volume),
    });
    const lift = liftOf(exercise);
    if (lift) pl[lift] = Math.max(pl[lift] ?? 0, Math.round(Math.max(...sets.filter((x) => x.exercise === exercise).map((x) => estimate1RM(x.weight, x.reps))) * 10) / 10);
  }
  strength.sort((a, b) => b.volume - a.volume);
  return { strength, powerlifting: pl };
}

/** Schätzt die Dauer einer Krafteinheit aus den Zeitstempeln der Sätze (+ 3 min für den letzten Satz). */
export function estimateStrengthDuration(sets: WorkoutSet[]): number {
  if (!sets.length) return 3600;
  const times = sets.map((s) => s.createdAt).sort((a, b) => a - b);
  const span = (times[times.length - 1] - times[0]) / 1000 + 180;
  // Nachgetragene Sätze liegen oft Sekunden auseinander → realistische Untergrenze
  return Math.round(Math.max(span, sets.length * 150) / 60) * 60;
}

export async function activityFromTraining(date: string, sport: 'gym' | 'powerlifting', durationSec: number, extra: Partial<Activity> = {}) {
  const sets = await db.sets.where('date').equals(date).toArray();
  const { strength, powerlifting } = strengthFromSets(sets);
  const weight = await latestWeight();
  const first = Math.min(...sets.map((s) => s.createdAt));
  const startTime = Number.isFinite(first) && toISODate(new Date(first)) === date ? first : Date.parse(`${date}T18:00:00`);
  return {
    sport,
    title: sport === 'powerlifting' ? 'Powerlifting' : strength.slice(0, 2).map((s) => s.exercise).join(' & ') || 'Krafttraining',
    date,
    startTime,
    durationSec,
    strength,
    ...(sport === 'powerlifting' || Object.keys(powerlifting).length ? { powerlifting: { ...powerlifting, ...(weight ? { bodyweight: weight } : {}) } } : {}),
    source: 'training' as const,
    ...extra,
  } satisfies NewActivity;
}

// ------------------------------------------------------------------ Medaillen

/** Prüft nach jeder Datenänderung, ob neue Medaillen verdient wurden, und meldet sie. */
export function useMedalWatcher() {
  const session = useSession();
  const loggedIn = !!session?.user;
  const earned = useLiveQuery(async () => {
    const [activities, sets, meals, sleep, weights, goals, plan] = await Promise.all([
      db.activities.toArray(),
      db.sets.toArray(),
      db.meals.toArray(),
      db.sleep.toArray(),
      db.weights.toArray(),
      getKV<Goals>('goals', DEFAULT_GOALS),
      getKV<TrainingPlan | null>('trainingPlan', null),
    ]);
    return evaluateMedals({ today: getToday(), activities, sets, meals, sleep, weights, goals, plan });
  }, []);
  useEffect(() => {
    if (!earned) return;
    let alive = true;
    void (async () => {
      const known = new Set(await db.medals.toCollection().primaryKeys());
      const fresh = earned.filter((m) => !known.has(m.id));
      if (fresh.length) {
        await db.medals.bulkPut(fresh);
        if (!alive) return;
        // Beim allerersten Durchlauf mit Altdaten keine Flut an Meldungen
        if (fresh.length > 2) toast(`🏅 ${fresh.length} Medaillen freigeschaltet – +${fresh.reduce((s, m) => s + m.points, 0)} Punkte`);
        else for (const m of fresh) toast(`🏅 Medaille: ${MEDAL_BY_KEY.get(m.key)?.label} (+${m.points} Punkte)`);
      }
      if (loggedIn) await syncMedals().catch(() => undefined);
    })();
    return () => {
      alive = false;
    };
  }, [earned, loggedIn]);
}

/** Aktivitäten, die noch nicht geteilt sind, nachträglich hochladen. */
export async function shareAllPending(): Promise<number> {
  const list = (await db.activities.toArray()).filter((a) => !a.remoteId);
  let n = 0;
  for (const a of list) {
    await publishActivity(a);
    n++;
  }
  return n;
}

export const isEndurance = (s: Sport) => SPORT_DEFS[s].distance;
