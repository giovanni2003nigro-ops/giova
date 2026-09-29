import type { Goals, ISODate, Macros, MealEntry, NutrientsPer100 } from '../types';
import { dateRange } from './dates';
import { mean, round } from './stats';

export const ZERO_MACROS: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function scaleMacros(per100: Macros, amount: number): Macros {
  const f = amount / 100;
  return {
    kcal: round(per100.kcal * f),
    protein: round(per100.protein * f, 1),
    carbs: round(per100.carbs * f, 1),
    fat: round(per100.fat * f, 1),
  };
}

export function sumMacros(list: Macros[]): Macros {
  const s = list.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: acc.protein + m.protein,
      carbs: acc.carbs + m.carbs,
      fat: acc.fat + m.fat,
    }),
    { ...ZERO_MACROS },
  );
  return { kcal: round(s.kcal), protein: round(s.protein, 1), carbs: round(s.carbs, 1), fat: round(s.fat, 1) };
}

/** kcal aus Makros (Atwater: 4/4/9) – zur Plausibilitätsprüfung. */
export function kcalFromMacros(m: Omit<Macros, 'kcal'>): number {
  return m.protein * 4 + m.carbs * 4 + m.fat * 9;
}

/** Prüft, ob kcal und Makros grob zusammenpassen (±20 % bzw. 30 kcal). */
export function macrosPlausible(n: NutrientsPer100): boolean {
  const calc = kcalFromMacros(n);
  return Math.abs(calc - n.kcal) <= Math.max(30, n.kcal * 0.2);
}

export function dailyTotals(meals: MealEntry[]): Map<ISODate, Macros> {
  const byDate = new Map<ISODate, MealEntry[]>();
  for (const m of meals) {
    const list = byDate.get(m.date);
    if (list) list.push(m);
    else byDate.set(m.date, [m]);
  }
  const out = new Map<ISODate, Macros>();
  for (const [date, list] of byDate) out.set(date, sumMacros(list));
  return out;
}

export interface NutritionSummary {
  from: ISODate;
  to: ISODate;
  daysInRange: number;
  daysLogged: number;
  /** Durchschnitt über die Tage MIT Einträgen */
  avg: Macros;
  /** Anteil der erfassten Tage mit kcal im Bereich ±10 % des Ziels */
  kcalAdherence: number;
  /** Anteil der erfassten Tage mit ≥ 90 % des Proteinziels */
  proteinHitRate: number;
  days: { date: ISODate; totals: Macros | null }[];
}

export function summarizeNutrition(
  meals: MealEntry[],
  goals: Pick<Goals, 'kcal' | 'protein'>,
  from: ISODate,
  to: ISODate,
  { excludeDate }: { excludeDate?: ISODate } = {},
): NutritionSummary {
  const totals = dailyTotals(meals.filter((m) => m.date >= from && m.date <= to));
  const days = dateRange(from, to).map((date) => ({ date, totals: totals.get(date) ?? null }));
  // Ein unvollständiger Tag (z. B. heute) verzerrt Durchschnitte → optional ausschließen
  const logged = days.filter((d) => d.totals && d.date !== excludeDate).map((d) => d.totals!);
  const avg: Macros = logged.length
    ? {
        kcal: round(mean(logged.map((t) => t.kcal))),
        protein: round(mean(logged.map((t) => t.protein)), 1),
        carbs: round(mean(logged.map((t) => t.carbs)), 1),
        fat: round(mean(logged.map((t) => t.fat)), 1),
      }
    : { ...ZERO_MACROS };
  const kcalAdherence = logged.length
    ? logged.filter((t) => Math.abs(t.kcal - goals.kcal) <= goals.kcal * 0.1).length / logged.length
    : 0;
  const proteinHitRate = logged.length
    ? logged.filter((t) => t.protein >= goals.protein * 0.9).length / logged.length
    : 0;
  return {
    from,
    to,
    daysInRange: days.length,
    daysLogged: logged.length,
    avg,
    kcalAdherence,
    proteinHitRate,
    days,
  };
}

export interface CombinationItem {
  name: string;
  amount: number;
  per100: Macros;
}

export interface CombinationResult {
  items: (CombinationItem & { macros: Macros })[];
  total: Macros;
}

/** Berechnet die Summe mehrerer Lebensmittel in bestimmten Mengen. */
export function combine(items: CombinationItem[]): CombinationResult {
  const rows = items.map((it) => ({ ...it, macros: scaleMacros(it.per100, it.amount) }));
  return { items: rows, total: sumMacros(rows.map((r) => r.macros)) };
}

/** Proteinreiche Standard-Lebensmittel für Empfehlungen (Werte je Portion). */
export const PROTEIN_SUGGESTIONS = [
  { name: '250 g Magerquark', protein: 30, kcal: 170 },
  { name: '1 Scoop Whey (30 g)', protein: 24, kcal: 120 },
  { name: '150 g Hähnchenbrust', protein: 35, kcal: 165 },
  { name: '200 g Skyr', protein: 22, kcal: 125 },
  { name: '3 Eier', protein: 20, kcal: 230 },
  { name: '1 Dose Thunfisch (130 g)', protein: 30, kcal: 140 },
];
