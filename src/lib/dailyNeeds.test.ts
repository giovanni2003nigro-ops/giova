import { describe, expect, it } from 'vitest';
import type { Goals, TrainingPlan } from '../types';
import { DEFAULT_GOALS } from '../types';
import { DEFAULT_SCHEDULE, dayNeeds, mealSlots, mealTypeAt, sessionKcal, weekNeeds, weekdayOf, type NeedsInput } from './dailyNeeds';

const goals: Goals = { ...DEFAULT_GOALS, kcal: 2600, protein: 160, fat: 75, carbs: 0, weeklyRate: -0.25 };
const plan: TrainingPlan = {
  name: 'Test',
  updatedAt: 0,
  source: 'manuell',
  sessions: [
    { id: '1', weekday: 1, sport: 'laufen', title: 'Intervalle', time: '18:00', durationMin: 60, intensity: 'hart' },
    { id: '2', weekday: 3, sport: 'gym', title: 'Oberkörper', time: '07:00', durationMin: 60, intensity: 'mittel' },
    { id: '3', weekday: 5, sport: 'laufen', title: 'Langer Lauf', time: '09:00', durationMin: 120, intensity: 'locker', distanceKm: 20 },
  ],
};
const input: NeedsInput = {
  goals,
  profile: { sex: 'm', age: 25, height: 180, activity: 1.5 },
  weight: 80,
  schedule: DEFAULT_SCHEDULE,
  plan,
  activities: [],
};

describe('Tagesbedarf', () => {
  it('ordnet Wochentage zu (Mo = 0)', () => {
    expect(weekdayOf('2026-09-28')).toBe(0);
    expect(weekdayOf('2026-10-04')).toBe(6);
  });

  it('verteilt ein manuelles Kalorienziel genau nach Belastung – der Wochenschnitt bleibt gleich', () => {
    const manual = { ...input, goals: { ...goals, auto: false } };
    const week = weekNeeds('2026-09-30', manual);
    const avg = week.reduce((s, d) => s + d.targets.kcal, 0) / 7;
    expect(Math.abs(avg - goals.kcal)).toBeLessThan(10);
    const byDay = Object.fromEntries(week.map((d) => [d.weekday, d]));
    // Langer Lauf am Samstag ist der energiereichste Tag, Sonntag (frei, ohne Training) der ruhigste
    expect(byDay[5].targets.kcal).toBe(Math.max(...week.map((d) => d.targets.kcal)));
    expect(byDay[6].targets.kcal).toBe(Math.min(...week.map((d) => d.targets.kcal)));
    // Protein & Fett bleiben, Kohlenhydrate gleichen aus
    expect(byDay[1].targets.protein).toBe(160);
    expect(byDay[5].targets.carbs).toBeGreaterThan(byDay[6].targets.carbs);
    expect(byDay[1].targets.kcal).toBeGreaterThan(byDay[0].targets.kcal);
    // Kein Deckel: Der Unterschied zweier Tage entspricht genau dem Unterschied im Verbrauch
    const diff = byDay[5].targets.kcal - byDay[6].targets.kcal;
    const tdeeDiff = byDay[5].estimatedTdee! - byDay[6].estimatedTdee!;
    expect(Math.abs(diff - tdeeDiff)).toBeLessThanOrEqual(10);
    expect(week.every((d) => !d.auto)).toBe(true);
  });

  it('berechnet automatisch: Verbrauch des Tages + Wochenrate', () => {
    const week = weekNeeds('2026-09-30', input);
    for (const d of week) {
      expect(d.auto).toBe(true);
      expect(Math.abs(d.targets.kcal - (d.estimatedTdee! - 275))).toBeLessThanOrEqual(5);
    }
  });

  it('ändert den Bedarf sofort mit der Wochenrate', () => {
    const lose = dayNeeds('2026-09-29', { ...input, goals: { ...goals, weeklyRate: -0.5 } });
    const keep = dayNeeds('2026-09-29', { ...input, goals: { ...goals, weeklyRate: 0 } });
    const gain = dayNeeds('2026-09-29', { ...input, goals: { ...goals, weeklyRate: 0.25 } });
    expect(Math.abs(keep.targets.kcal - lose.targets.kcal - 550)).toBeLessThanOrEqual(10);
    expect(Math.abs(gain.targets.kcal - keep.targets.kcal - 275)).toBeLessThanOrEqual(10);
  });

  it('reagiert auf Alltag und Trainingsplan', () => {
    const office = dayNeeds('2026-09-28', input);
    const physical = dayNeeds('2026-09-28', { ...input, schedule: input.schedule.map((d, i) => (i === 0 ? { ...d, kind: 'koerperlich' as const } : d)) });
    expect(physical.targets.kcal - office.targets.kcal).toBeGreaterThan(500);
    const extra = dayNeeds('2026-09-28', { ...input, plan: { ...plan, sessions: [...plan.sessions, { id: '4', weekday: 0, sport: 'schwimmen', title: 'Technik', durationMin: 45, intensity: 'mittel' }] } });
    expect(extra.targets.kcal).toBeGreaterThan(office.targets.kcal + 200);
  });

  it('kalibriert mit dem gemessenen Verbrauch (höchstens ±400 kcal)', () => {
    const base = weekNeeds('2026-09-30', input);
    const avg = base.reduce((s, d) => s + d.estimatedTdee!, 0) / 7;
    const higher = dayNeeds('2026-09-29', { ...input, measuredTdee: avg + 200 });
    expect(higher.breakdown.calibration).toBeCloseTo(200, -1);
    expect(higher.targets.kcal - dayNeeds('2026-09-29', input).targets.kcal).toBeCloseTo(200, -1);
    expect(dayNeeds('2026-09-29', { ...input, measuredTdee: avg + 2000 }).breakdown.calibration).toBe(400);
  });

  it('ohne Alltag & Plan: pauschaler Aktivitätsfaktor', () => {
    const d = dayNeeds('2026-09-29', { ...input, plan: null, detailed: false });
    // BMR 1805 × 1,5 − 275
    expect(d.targets.kcal).toBe(Math.round((1805 * 1.5 - 275) / 10) * 10);
    expect(d.breakdown.work).toBe(0);
  });

  it('geht nie unter den Grundumsatz', () => {
    const d = dayNeeds('2026-10-04', { ...input, goals: { ...goals, weeklyRate: -3 } });
    expect(d.targets.kcal).toBe(1810);
    expect(d.notes.some((n) => n.includes('Rahmenbedingung'))).toBe(true);
  });

  it('schätzt den Verbrauch mit Profil', () => {
    const d = dayNeeds('2026-09-29', input); // Dienstag mit Intervallen
    expect(d.estimatedTdee).toBeGreaterThan(2600);
    expect(d.estimatedTdee).toBeLessThan(3400);
    expect(d.breakdown.exercise).toBeGreaterThan(500);
    expect(d.breakdown.adjustment).toBe(-275);
    expect(d.notes.some((n) => n.includes('Harte Einheit'))).toBe(true);
  });

  it('ersetzt geplante Einheiten durch absolvierte', () => {
    const done = {
      uid: 'x',
      sport: 'laufen' as const,
      title: 'x',
      date: '2026-09-29',
      startTime: 0,
      durationSec: 1800,
      distanceM: 5000,
      source: 'manuell' as const,
      visibility: 'public' as const,
      points: 50,
      createdAt: 0,
    };
    const d = dayNeeds('2026-09-29', { ...input, activities: [done] });
    expect(d.sessions).toHaveLength(0);
    expect(d.done).toHaveLength(1);
    expect(d.breakdown.exercise).toBeLessThan(dayNeeds('2026-09-29', input).breakdown.exercise);
  });

  it('rechnet Laufen über die Distanz', () => {
    expect(sessionKcal({ sport: 'laufen', durationMin: 60, intensity: 'mittel', distanceKm: 10 }, 70)).toBeCloseTo(700 - 1.3 * 70, 0);
    expect(sessionKcal({ sport: 'gym', durationMin: 60, intensity: 'mittel' }, 80)).toBeCloseTo((5 - 1.3) * 80, 0);
  });

  it('plant Mahlzeiten um Arbeit und Training herum', () => {
    const slots = mealSlots(DEFAULT_SCHEDULE[1], plan.sessions.filter((s) => s.weekday === 1));
    const names = slots.map((s) => s.slot);
    expect(names[0]).toBe('Frühstück');
    expect(names).toContain('Vor dem Training');
    const pre = slots.find((s) => s.slot === 'Vor dem Training')!;
    expect(pre.time).toBe('16:30');
    const dinner = slots.find((s) => s.slot === 'Abendessen')!;
    expect(dinner.time >= '19:00').toBe(true);
    // Mittag im Büro ohne Küche → Meal-Prep
    expect(slots.find((s) => s.slot === 'Mittagessen')!.portable).toBe(true);
    expect(slots.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  it('ordnet Uhrzeiten den Tagebuch-Mahlzeiten zu', () => {
    expect(mealTypeAt('07:30')).toBe('fruehstueck');
    expect(mealTypeAt('12:30')).toBe('mittag');
    expect(mealTypeAt('16:00')).toBe('snack');
    expect(mealTypeAt('19:30')).toBe('abend');
  });
});
