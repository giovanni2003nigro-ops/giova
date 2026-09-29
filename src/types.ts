import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';

/** Datumsangaben werden immer als lokales Datum "YYYY-MM-DD" gespeichert. */
export type ISODate = string;

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

// ---------------------------------------------------------------- Training

export const MUSCLE_GROUPS = [
  'Brust',
  'Rücken',
  'Beine',
  'Po',
  'Waden',
  'Schultern',
  'Bizeps',
  'Trizeps',
  'Bauch',
  'Ganzkörper',
  'Sonstiges',
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export interface Exercise {
  id?: number;
  name: string;
  muscleGroup: MuscleGroup;
  custom?: boolean;
}

export interface WorkoutSet {
  id?: number;
  date: ISODate;
  exercise: string;
  /** Zusatzgewicht in kg (0 = Körpergewicht) */
  weight: number;
  reps: number;
  /** Optionale Anstrengung (RPE 6–10) */
  rpe?: number;
  createdAt: number;
}

// ---------------------------------------------------------------- Ernährung

export type MealType = 'fruehstueck' | 'mittag' | 'abend' | 'snack';
export const MEAL_TYPES: MealType[] = ['fruehstueck', 'mittag', 'abend', 'snack'];
export const MEAL_LABELS: Record<MealType, string> = {
  fruehstueck: 'Frühstück',
  mittag: 'Mittagessen',
  abend: 'Abendessen',
  snack: 'Snacks',
};

export interface NutrientsPer100 extends Macros {
  sugar?: number;
  fiber?: number;
  salt?: number;
  satFat?: number;
}

export interface Food {
  id?: number;
  name: string;
  brand?: string;
  /** Nährwerte je 100 g bzw. 100 ml */
  per100: NutrientsPer100;
  unit: 'g' | 'ml';
  servingSize?: number;
  servingLabel?: string;
  /** Foto der Nährwerttabelle (komprimiertes JPEG) */
  photo?: Blob;
  source: 'manuell' | 'foto' | 'chat';
  createdAt: number;
}

export interface MealEntry extends Macros {
  id?: number;
  date: ISODate;
  meal: MealType;
  name: string;
  amount: number;
  unit: 'g' | 'ml' | 'Portion';
  foodId?: number;
  createdAt: number;
}

// ---------------------------------------------------------------- Schlaf & Körper

export interface SleepEntry {
  id?: number;
  /** Datum des Aufwachens – die Nacht "gehört" zu diesem Tag */
  date: ISODate;
  bedtime: string; // "HH:MM"
  wakeTime: string; // "HH:MM"
  durationMin: number;
  quality: 1 | 2 | 3 | 4 | 5;
  note?: string;
}

export interface WeightEntry {
  id?: number;
  date: ISODate;
  weight: number;
}

// ---------------------------------------------------------------- Ziele

export type GoalType = 'defizit' | 'erhalt' | 'aufbau' | 'kraft' | 'recomp';
export const GOAL_LABELS: Record<GoalType, string> = {
  defizit: 'Defizit (Fett verlieren)',
  erhalt: 'Erhalt (Gewicht halten)',
  aufbau: 'Aufbau (Muskelaufbau)',
  kraft: 'Kraftgewinn',
  recomp: 'Rekomposition (Fett runter, Muskeln rauf)',
};
export const GOAL_SHORT: Record<GoalType, string> = {
  defizit: 'Defizit',
  erhalt: 'Erhalt',
  aufbau: 'Aufbau',
  kraft: 'Kraft',
  recomp: 'Recomp',
};

export interface StrengthGoal {
  exercise: string;
  /** Ziel-1RM (geschätztes Maximalgewicht für 1 Wiederholung) in kg */
  target1RM: number;
  deadline?: ISODate;
}

export interface Goals {
  type: GoalType;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Geplante Gewichtsveränderung in kg pro Woche (negativ = abnehmen) */
  weeklyRate: number;
  targetWeight?: number;
  sleepHours: number;
  trainingDays: number;
  strengthGoals: StrengthGoal[];
}

export interface Profile {
  sex: 'm' | 'w';
  age: number;
  height: number;
  /** Aktivitätsfaktor (PAL) ohne Training, z. B. 1.4 */
  activity: number;
}

export const DEFAULT_GOALS: Goals = {
  type: 'erhalt',
  kcal: 2500,
  protein: 150,
  carbs: 290,
  fat: 80,
  weeklyRate: 0,
  sleepHours: 8,
  trainingDays: 4,
  strengthGoals: [],
};

// ---------------------------------------------------------------- Chat

export interface ChatRecord {
  id?: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Systemprompt inkl. Datenstand – bleibt für das ganze Gespräch unverändert */
  system: string;
  messages: BetaMessageParam[];
}

export interface CoachReport {
  createdAt: number;
  text: string;
}
