import { describe, expect, it } from 'vitest';
import type { Food, Goals, MealEntry } from '../types';
import { DEFAULT_GOALS } from '../types';
import { nutrientCheck, nutrientGuide } from './nutrients';

const goals: Goals = { ...DEFAULT_GOALS, type: 'defizit', kcal: 2200, protein: 160, carbs: 220, fat: 65 };
const prefs = { diet: 'alles' as const, mealsPerDay: 4, dislikes: '', cookingMinutes: 20 };
const foods: Food[] = [
  { id: 1, name: 'Magerquark', unit: 'g', per100: { kcal: 67, protein: 12, carbs: 4, fat: 0.3, fiber: 0, sugar: 4, salt: 0.1 }, source: 'foto', createdAt: 0 },
  { id: 2, name: 'Haferflocken', unit: 'g', per100: { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7, fiber: 10, sugar: 1, salt: 0 }, source: 'foto', createdAt: 0 },
  { id: 3, name: 'Gummibärchen', unit: 'g', per100: { kcal: 343, protein: 6.9, carbs: 77, fat: 0.5, fiber: 0, sugar: 46, salt: 0.07 }, source: 'foto', createdAt: 0 },
];
const meal = (date: string, foodId: number, amount: number, m: Partial<MealEntry>): MealEntry => ({ date, meal: 'mittag', name: 'x', amount, unit: 'g', foodId, kcal: 0, protein: 0, carbs: 0, fat: 0, createdAt: 0, ...m });

describe('Nährstoff-Tipps', () => {
  it('erklärt je Ziel, was wie viel und warum', () => {
    const tips = nutrientGuide({ goals, profile: { sex: 'w', age: 25, height: 168, activity: 1.6 }, weight: 64, trainingHours: 5, endurance: true, prefs, foods });
    const protein = tips.find((t) => t.key === 'protein')!;
    expect(protein.amount).toContain('160 g');
    expect(protein.why).toMatch(/defizit/i);
    expect(protein.sources[0]).toBe('Magerquark');
    // Ausdauer + Frau → Eisen, Ballaststoffe sättigen im Defizit
    expect(tips.some((t) => t.key === 'iron' && t.amount.startsWith('15'))).toBe(true);
    expect(tips.find((t) => t.key === 'fiber')!.why).toMatch(/satt/);
    expect(tips.find((t) => t.key === 'fiber')!.sources[0]).toBe('Haferflocken');
    expect(tips.some((t) => t.key === 'creatine')).toBe(false);
  });

  it('passt sich an Ziel und Ernährungsform an', () => {
    const tips = nutrientGuide({ goals: { ...goals, type: 'kraft' }, profile: null, weight: 85, trainingHours: 4, endurance: false, prefs: { ...prefs, diet: 'vegan' }, foods: [] });
    expect(tips.some((t) => t.key === 'b12')).toBe(true);
    expect(tips.some((t) => t.key === 'creatine')).toBe(true);
    expect(tips.find((t) => t.key === 'protein')!.sources).toContain('Tofu');
  });

  it('findet, was in den letzten Tagen gefehlt hat', () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'];
    const meals = days.flatMap((d) => [
      meal(d, 2, 100, { kcal: 372, protein: 13.5, carbs: 58.7, fat: 7 }),
      meal(d, 3, 200, { kcal: 686, protein: 13.8, carbs: 154, fat: 1 }),
      meal(d, 1, 500, { kcal: 335, protein: 60, carbs: 20, fat: 1.5 }),
      { ...meal(d, 0, 1, { kcal: 700, protein: 30, carbs: 60, fat: 30 }), foodId: undefined, unit: 'Portion' as const },
    ]);
    const res = nutrientCheck({
      meals,
      foods,
      goals,
      weight: 70,
      targetFor: () => ({ kcal: 2200, protein: 160, carbs: 220, fat: 65 }),
      trainingOn: (d) => d === '2026-10-02',
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(res.days).toBe(4);
    const by = Object.fromEntries(res.gaps.map((g) => [g.key, g]));
    expect(by.protein.status).toBe('zu-wenig');
    expect(by.protein.fix).toContain('Magerquark');
    expect(by.fat.status).toBe('zu-wenig');
    expect(by.sugar.status).toBe('zu-viel');
    expect(by.fiber.status).toBe('zu-wenig');
    expect(res.extrasCoverage).toBeGreaterThan(0.6);
  });

  it('meldet fehlende Daten statt falscher Ballaststoff-Werte', () => {
    const res = nutrientCheck({
      meals: [{ ...meal('2026-10-04', 0, 1, { kcal: 2100, protein: 170, carbs: 200, fat: 70 }), foodId: undefined, unit: 'Portion' }],
      foods,
      goals,
      weight: 70,
      targetFor: () => ({ kcal: 2200, protein: 160, carbs: 220, fat: 65 }),
      trainingOn: () => false,
      from: '2026-09-28',
      to: '2026-10-04',
    });
    expect(res.gaps.find((g) => g.key === 'protein')!.status).toBe('ok');
    expect(res.gaps.find((g) => g.key === 'fiber')!.status).toBe('unklar');
  });
});
