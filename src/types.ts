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

// ---------------------------------------------------------------- Sport & Aktivitäten

export const SPORTS = ['laufen', 'radfahren', 'schwimmen', 'wandern', 'rudern', 'hyrox', 'gym', 'powerlifting'] as const;
export type Sport = (typeof SPORTS)[number];

/** Ein aufgezeichneter GPS-Punkt. `t` = Zeitstempel in ms. */
export interface TrackPoint {
  lat: number;
  lon: number;
  t: number;
  /** Höhe in m */
  ele?: number;
  /** Herzfrequenz in bpm */
  hr?: number;
}

/** Zusammenfassung einer Kraftübung innerhalb einer Einheit. */
export interface StrengthSummary {
  exercise: string;
  sets: number;
  reps: number;
  topWeight: number;
  topReps: number;
  bestE1RM: number;
  volume: number;
}

export interface HyroxStation {
  name: string;
  durationSec: number;
}

export interface HyroxData {
  /** Wettkampf oder vollständige Simulation (8 × 1 km + 8 Stationen) */
  race: boolean;
  division?: 'open' | 'pro' | 'doubles' | 'relay';
  stations?: HyroxStation[];
}

/** Beste geschätzte 1RM-Werte der Wettkampfübungen (für den DOTS-Wert). */
export interface PowerliftingData {
  squat?: number;
  bench?: number;
  deadlift?: number;
  bodyweight?: number;
}

export type ActivitySource = 'tracker' | 'manuell' | 'gpx' | 'tcx' | 'fit' | 'training';
export type Visibility = 'public' | 'followers' | 'private';
export const VISIBILITY_LABELS: Record<Visibility, string> = {
  public: 'Öffentlich',
  followers: 'Nur Follower',
  private: 'Nur ich',
};

export interface Activity {
  id?: number;
  /** Geräteübergreifende ID (für die Community-Synchronisation) */
  uid: string;
  sport: Sport;
  title: string;
  note?: string;
  date: ISODate;
  /** Startzeit in ms */
  startTime: number;
  /** Bewegungszeit in Sekunden (ohne Pausen) */
  durationSec: number;
  /** Gesamtzeit inkl. Pausen */
  elapsedSec?: number;
  distanceM?: number;
  elevationGainM?: number;
  avgHr?: number;
  maxHr?: number;
  kcal?: number;
  /** Subjektive Anstrengung 1–10 */
  rpe?: number;
  track?: TrackPoint[];
  strength?: StrengthSummary[];
  hyrox?: HyroxData;
  powerlifting?: PowerliftingData;
  source: ActivitySource;
  visibility: Visibility;
  /** Start und Ziel (je ca. 200 m) auf der Karte für andere ausblenden */
  hideEnds?: boolean;
  photo?: Blob;
  /** Punkte für Rangliste & Liga */
  points: number;
  /** ID auf dem Community-Server, sobald geteilt */
  remoteId?: string;
  syncedAt?: number;
  createdAt: number;
  updatedAt?: number;
}

// ---------------------------------------------------------------- Medaillen

export interface EarnedMedal {
  /** `${key}:${period}` – period leer bei einmaligen Medaillen */
  id: string;
  key: string;
  /** Zeitraum für wiederholbare Medaillen, z. B. Saison "2026-09" */
  period: string;
  date: ISODate;
  earnedAt: number;
  points: number;
  /** Schon an den Community-Server gemeldet */
  synced?: boolean;
}

// ---------------------------------------------------------------- Trainingsplan & Alltag

export type Intensity = 'locker' | 'mittel' | 'hart';
export const INTENSITY_LABELS: Record<Intensity, string> = { locker: 'Locker', mittel: 'Mittel', hart: 'Hart' };

/** Wochentag 0 = Montag … 6 = Sonntag */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_LABELS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
export const WEEKDAY_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

export interface PlannedSession {
  id: string;
  weekday: Weekday;
  sport: Sport;
  title: string;
  /** Uhrzeit "HH:MM" */
  time?: string;
  durationMin: number;
  intensity: Intensity;
  /** Geplante Distanz in km (Ausdauer) */
  distanceKm?: number;
  note?: string;
}

export interface TrainingPlan {
  name: string;
  sessions: PlannedSession[];
  updatedAt: number;
  source: 'manuell' | 'ki';
}

export type DayKind = 'buero' | 'uni' | 'stehend' | 'koerperlich' | 'frei';
export const DAY_KIND_LABELS: Record<DayKind, string> = {
  buero: 'Büro / Homeoffice (sitzend)',
  uni: 'Uni / Schule',
  stehend: 'Arbeit im Stehen (Handel, Pflege …)',
  koerperlich: 'Körperliche Arbeit (Bau, Handwerk …)',
  frei: 'Frei',
};

export interface ScheduleDay {
  kind: DayKind;
  /** Arbeits-/Unizeit "HH:MM" */
  start?: string;
  end?: string;
  wake: string;
  sleep: string;
  /** Schritte oder Wege zu Fuß/Rad in Minuten (Pendeln etc.) */
  activeMinutes: number;
  /** Möglichkeit, warm zu essen (Mensa/Kantine/Küche) */
  canCook: boolean;
}

export type WeekSchedule = ScheduleDay[];

export interface NutritionPreferences {
  diet: 'alles' | 'vegetarisch' | 'vegan' | 'pescetarisch';
  mealsPerDay: number;
  dislikes: string;
  /** Kochzeit pro Mahlzeit in Minuten */
  cookingMinutes: number;
}

export interface PlannedMealItem {
  name: string;
  amount: number;
  unit: 'g' | 'ml';
  /** Aus der Bibliothek des Nutzers */
  foodId?: number;
  macros: Macros;
}

export interface PlannedMeal {
  time: string;
  slot: string;
  title: string;
  recipe: string;
  prepMinutes: number;
  items: PlannedMealItem[];
  total: Macros;
}

export interface DayPlan {
  date: ISODate;
  createdAt: number;
  targets: Macros;
  meals: PlannedMeal[];
  notes: string;
}
