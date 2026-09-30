import Dexie, { type EntityTable } from 'dexie';
import { useLiveQuery } from 'dexie-react-hooks';
import type {
  Activity,
  ChatRecord,
  DayPlan,
  EarnedMedal,
  Exercise,
  Food,
  MealEntry,
  MuscleGroup,
  SleepEntry,
  WeightEntry,
  WorkoutSet,
} from './types';

export interface KV {
  key: string;
  value: unknown;
}

export const DEFAULT_EXERCISES: [string, MuscleGroup][] = [
  ['Bankdrücken', 'Brust'],
  ['Schrägbankdrücken', 'Brust'],
  ['Kurzhantel-Bankdrücken', 'Brust'],
  ['Butterfly', 'Brust'],
  ['Dips', 'Brust'],
  ['Liegestütze', 'Brust'],
  ['Kreuzheben', 'Rücken'],
  ['Klimmzüge', 'Rücken'],
  ['Latzug', 'Rücken'],
  ['Langhantelrudern', 'Rücken'],
  ['Kabelrudern', 'Rücken'],
  ['Kurzhantelrudern', 'Rücken'],
  ['Kniebeuge', 'Beine'],
  ['Beinpresse', 'Beine'],
  ['Rumänisches Kreuzheben', 'Beine'],
  ['Ausfallschritte', 'Beine'],
  ['Bulgarian Split Squat', 'Beine'],
  ['Beinstrecker', 'Beine'],
  ['Beinbeuger', 'Beine'],
  ['Hip Thrust', 'Po'],
  ['Wadenheben', 'Waden'],
  ['Schulterdrücken', 'Schultern'],
  ['Kurzhantel-Schulterdrücken', 'Schultern'],
  ['Seitheben', 'Schultern'],
  ['Face Pulls', 'Schultern'],
  ['Bizepscurls', 'Bizeps'],
  ['Hammercurls', 'Bizeps'],
  ['Trizepsdrücken am Kabel', 'Trizeps'],
  ['French Press', 'Trizeps'],
  ['Crunches', 'Bauch'],
  ['Beinheben', 'Bauch'],
];

class FitDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  sets!: EntityTable<WorkoutSet, 'id'>;
  foods!: EntityTable<Food, 'id'>;
  meals!: EntityTable<MealEntry, 'id'>;
  sleep!: EntityTable<SleepEntry, 'id'>;
  weights!: EntityTable<WeightEntry, 'id'>;
  chats!: EntityTable<ChatRecord, 'id'>;
  kv!: EntityTable<KV, 'key'>;
  activities!: EntityTable<Activity, 'id'>;
  medals!: EntityTable<EarnedMedal, 'id'>;
  dayPlans!: EntityTable<DayPlan, 'date'>;

  constructor() {
    super('giova-fit');
    this.version(1).stores({
      exercises: '++id, &name, muscleGroup',
      sets: '++id, date, exercise, [exercise+date]',
      foods: '++id, name, createdAt',
      meals: '++id, date, meal',
      sleep: '++id, &date',
      weights: '++id, &date',
      chats: '++id, updatedAt',
      kv: 'key',
    });
    // v2: Sportarten & Aktivitäten, Medaillen, KI-Tagespläne
    this.version(2).stores({
      activities: '++id, &uid, date, sport, startTime',
      medals: 'id, key, earnedAt',
      dayPlans: 'date',
    });
    this.on('populate', (tx) => {
      void tx
        .table('exercises')
        .bulkAdd(DEFAULT_EXERCISES.map(([name, muscleGroup]) => ({ name, muscleGroup })));
    });
  }
}

export const db = new FitDB();

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : fallback;
}

export async function setKV<T>(key: string, value: T): Promise<void> {
  await db.kv.put({ key, value });
}

/** Reaktiver Zugriff auf einen Einstellungswert. `undefined` solange geladen wird. */
export function useKV<T>(key: string, fallback: T): T | undefined {
  return useLiveQuery(async () => {
    const row = await db.kv.get(key);
    return row ? (row.value as T) : fallback;
  }, [key]);
}

/** Legt eine Übung an, falls sie noch nicht existiert. */
export async function ensureExercise(name: string, muscleGroup: MuscleGroup = 'Sonstiges') {
  const existing = await db.exercises.where('name').equalsIgnoreCase(name).first();
  if (existing) return existing.name;
  await db.exercises.add({ name, muscleGroup, custom: true });
  return name;
}
