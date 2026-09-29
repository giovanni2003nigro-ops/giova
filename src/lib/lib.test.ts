import { describe, expect, it } from 'vitest';
import type { Goals, MealEntry, SleepEntry, WeightEntry, WorkoutSet } from '../types';
import { DEFAULT_GOALS } from '../types';
import { analyze, combinedInsights } from './analysis';
import { weightTrend } from './body';
import { addDays, dateRange, diffDays, weekStart } from './dates';
import { estimateActualTdee, kcalForRate, suggestTargets } from './goals';
import { combine, macrosPlausible, scaleMacros, summarizeNutrition } from './nutrition';
import { sleepDurationMin, summarizeSleep } from './sleep';
import { fmt, fmtSigned, linearRegression } from './stats';
import {
  estimate1RM,
  exerciseTrend,
  isPersonalRecord,
  progressionSuggestion,
  sessionPerformance,
  sessionsByExercise,
} from './training';

const TODAY = '2026-09-29';

function set(date: string, exercise: string, weight: number, reps: number): WorkoutSet {
  return { date, exercise, weight, reps, createdAt: 0 };
}

function meal(date: string, kcal: number, protein: number, carbs = 250, fat = 70, name = 'Essen'): MealEntry {
  return { date, meal: 'mittag', name, amount: 100, unit: 'g', kcal, protein, carbs, fat, createdAt: 0 };
}

describe('dates', () => {
  it('rechnet Tage und Wochen korrekt (auch über Zeitumstellung)', () => {
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26');
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(dateRange('2026-09-27', '2026-09-29')).toEqual(['2026-09-27', '2026-09-28', '2026-09-29']);
    expect(weekStart('2026-09-29')).toBe('2026-09-28'); // Dienstag → Montag
    expect(weekStart('2026-10-04')).toBe('2026-09-28'); // Sonntag → Montag davor
  });
});

describe('stats', () => {
  it('berechnet eine lineare Regression', () => {
    const r = linearRegression([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
    ])!;
    expect(r.slope).toBeCloseTo(2);
    expect(r.intercept).toBeCloseTo(1);
    expect(r.r2).toBeCloseTo(1);
  });
  it('formatiert deutsch', () => {
    expect(fmt(1234.56, 1)).toBe('1.234,6');
    expect(fmtSigned(-0.25, 2)).toBe('−0,25');
    expect(fmtSigned(3)).toBe('+3');
  });
});

describe('training', () => {
  it('schätzt das 1RM nach Epley', () => {
    expect(estimate1RM(100, 1)).toBe(100);
    expect(estimate1RM(100, 10)).toBeCloseTo(133.33, 1);
    expect(estimate1RM(0, 10)).toBe(0);
  });

  it('fasst Einheiten zusammen und nutzt Wdh. bei Körpergewichtsübungen', () => {
    const map = sessionsByExercise([
      set('2026-09-01', 'Bankdrücken', 80, 8),
      set('2026-09-01', 'Bankdrücken', 80, 6),
      set('2026-09-01', 'Klimmzüge', 0, 10),
    ]);
    const bench = map.get('Bankdrücken')![0];
    expect(bench.sets).toBe(2);
    expect(bench.volume).toBe(80 * 14);
    expect(bench.topReps).toBe(8);
    expect(bench.metricType).toBe('e1rm');
    const pullups = map.get('Klimmzüge')![0];
    expect(pullups.metricType).toBe('reps');
    expect(pullups.metric).toBe(10);
  });

  it('erkennt Fortschritt, Stagnation und Rückgang', () => {
    const mk = (weights: number[]) =>
      sessionsByExercise(weights.map((w, i) => set(addDays(TODAY, -35 + i * 7), 'Kniebeuge', w, 5))).get('Kniebeuge')!;
    expect(exerciseTrend(mk([100, 102.5, 105, 107.5, 110, 112.5]), TODAY)!.status).toBe('starker-fortschritt');
    expect(exerciseTrend(mk([100, 100, 100, 100, 100, 100]), TODAY)!.status).toBe('stagnation');
    expect(exerciseTrend(mk([110, 107.5, 105, 102.5, 100, 97.5]), TODAY)!.status).toBe('rueckgang');
    expect(exerciseTrend(mk([100, 105]), TODAY)!.status).toBe('zu-wenig-daten');
  });

  it('erkennt neue Bestleistungen', () => {
    const prev = [set('2026-09-01', 'Bankdrücken', 80, 8)];
    expect(isPersonalRecord({ weight: 80, reps: 9 }, prev)).toBe(true);
    expect(isPersonalRecord({ weight: 80, reps: 8 }, prev)).toBe(false);
    expect(isPersonalRecord({ weight: 80, reps: 8 }, [])).toBe(false);
  });

  it('schlägt die nächste Steigerung vor', () => {
    const [s] = sessionsByExercise([set('2026-09-01', 'Bankdrücken', 80, 8)]).get('Bankdrücken')!;
    expect(progressionSuggestion(s)).toContain('80 kg × 9');
    const [h] = sessionsByExercise([set('2026-09-01', 'Bankdrücken', 80, 12)]).get('Bankdrücken')!;
    expect(progressionSuggestion(h)).toContain('82,5 kg');
  });

  it('vergleicht Leistung mit der Vor-Einheit', () => {
    const perf = sessionPerformance([
      set('2026-09-01', 'Bankdrücken', 100, 1),
      set('2026-09-04', 'Bankdrücken', 102, 1),
      set('2026-09-01', 'Kniebeuge', 100, 1),
      set('2026-09-04', 'Kniebeuge', 104, 1),
    ]);
    expect(perf).toHaveLength(1);
    expect(perf[0].change).toBeCloseTo(0.03);
  });
});

describe('ernährung', () => {
  it('skaliert und kombiniert Nährwerte', () => {
    expect(scaleMacros({ kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 }, 80)).toEqual({
      kcal: 296,
      protein: 10.8,
      carbs: 47,
      fat: 5.6,
    });
    const res = combine([
      { name: 'Haferflocken', amount: 100, per100: { kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 } },
      { name: 'Milch 1,5 %', amount: 300, per100: { kcal: 47, protein: 3.4, carbs: 4.9, fat: 1.5 } },
    ]);
    expect(res.total.kcal).toBe(511);
    expect(res.total.protein).toBeCloseTo(23.7);
  });

  it('prüft die Plausibilität von Nährwerten', () => {
    expect(macrosPlausible({ kcal: 370, protein: 13.5, carbs: 58.7, fat: 7 })).toBe(true);
    expect(macrosPlausible({ kcal: 100, protein: 13.5, carbs: 58.7, fat: 7 })).toBe(false);
  });

  it('mittelt nur über erfasste Tage', () => {
    const s = summarizeNutrition(
      [meal('2026-09-27', 2400, 150), meal('2026-09-28', 2600, 120)],
      { kcal: 2500, protein: 150 },
      '2026-09-22',
      '2026-09-28',
    );
    expect(s.daysLogged).toBe(2);
    expect(s.avg.kcal).toBe(2500);
    expect(s.kcalAdherence).toBe(1);
    expect(s.proteinHitRate).toBe(0.5);
  });
});

describe('schlaf', () => {
  it('berechnet Dauer über Mitternacht', () => {
    expect(sleepDurationMin('23:30', '07:00')).toBe(450);
    expect(sleepDurationMin('01:00', '08:30')).toBe(450);
    expect(sleepDurationMin('22:00', '22:00')).toBe(1440);
  });
  it('bewertet Regelmäßigkeit auch um Mitternacht herum', () => {
    const entries: SleepEntry[] = [
      { date: '2026-09-27', bedtime: '23:30', wakeTime: '07:00', durationMin: 450, quality: 4 },
      { date: '2026-09-28', bedtime: '00:30', wakeTime: '07:00', durationMin: 390, quality: 3 },
    ];
    const s = summarizeSleep(entries, '2026-09-22', '2026-09-28', 8);
    expect(s.avgBedtime).toBe('00:00');
    expect(s.bedtimeSdMin).toBeCloseTo(42.4, 0);
    expect(s.debtHours).toBeCloseTo(2);
  });
});

describe('ziele', () => {
  it('schlägt plausible Ziele vor', () => {
    const p = { sex: 'm' as const, age: 25, height: 180, activity: 1.6 };
    const cut = suggestTargets(p, 80, 'defizit');
    const bulk = suggestTargets(p, 80, 'aufbau');
    expect(cut.weeklyRate).toBe(-0.4);
    expect(cut.kcal).toBeLessThan(cut.tdee);
    expect(bulk.kcal).toBeGreaterThan(bulk.tdee);
    expect(cut.protein).toBe(160);
    expect(Math.abs(cut.protein * 4 + cut.carbs * 4 + cut.fat * 9 - cut.kcal)).toBeLessThan(10);
  });
  it('schätzt den echten Verbrauch aus Aufnahme und Gewichtstrend', () => {
    expect(estimateActualTdee(2500, -0.5)).toBe(3050);
    expect(kcalForRate(3050, -0.5)).toBe(2500);
  });
});

describe('gewicht', () => {
  it('berechnet die Wochenrate', () => {
    const entries: WeightEntry[] = [0, 7, 14, 21].map((i) => ({ date: addDays(TODAY, -21 + i), weight: 82 - i / 14 }));
    const t = weightTrend(entries, TODAY)!;
    expect(t.ratePerWeek).toBeCloseTo(-0.5, 2);
    expect(t.latest).toBeCloseTo(80.5);
  });
});

describe('analyse & empfehlungen', () => {
  const goals: Goals = { ...DEFAULT_GOALS, type: 'defizit', kcal: 2200, protein: 160, weeklyRate: -0.5, trainingDays: 3 };

  function baseInput() {
    return {
      today: TODAY,
      goals,
      profile: null,
      sets: [] as WorkoutSet[],
      meals: [] as MealEntry[],
      sleep: [] as SleepEntry[],
      weights: [] as WeightEntry[],
      exercises: [],
      foods: [],
    };
  }

  it('meldet fehlende Daten statt falscher Empfehlungen', () => {
    const r = analyze(baseInput());
    const ids = r.recommendations.map((x) => x.id);
    expect(ids).toContain('ernaehrung-daten');
    expect(ids).toContain('gewicht-daten');
    expect(ids).toContain('training-daten');
    expect(ids).toContain('schlaf-daten');
    expect(r.score.total).toBeNull();
  });

  it('erkennt zu viele Kalorien und zu wenig Protein im Defizit', () => {
    const input = baseInput();
    input.meals = dateRange(addDays(TODAY, -7), addDays(TODAY, -1)).map((d) => meal(d, 2700, 110, 300, 90, 'Pizza'));
    const r = analyze(input);
    const kcal = r.recommendations.find((x) => x.id === 'kcal')!;
    expect(kcal.severity).toBe('warn');
    expect(kcal.title).toBe('Du isst mehr als geplant');
    expect(kcal.actions[0]).toContain('500 kcal');
    expect(kcal.actions[1]).toContain('Pizza');
    const protein = r.recommendations.find((x) => x.id === 'protein')!;
    expect(protein.severity).toBe('warn');
    expect(protein.detail).toContain('50 g');
    // Abweichungen stehen vor den erfüllten Zielen
    expect(r.recommendations[0].severity === 'alert' || r.recommendations[0].severity === 'warn').toBe(true);
  });

  it('vergleicht den Gewichtstrend mit dem Ziel und schätzt ein neues Kalorienziel', () => {
    const input = baseInput();
    const days = dateRange(addDays(TODAY, -21), TODAY);
    input.weights = days.map((d, i) => ({ date: d, weight: 85 - i * 0.01 })); // ~−0,07 kg/Woche
    input.meals = days.filter((d) => d < TODAY).map((d) => meal(d, 2200, 160));
    const r = analyze(input);
    const w = r.recommendations.find((x) => x.id === 'gewicht')!;
    expect(w.title).toBe('Du nimmst langsamer ab als geplant');
    expect(w.actions[0]).toMatch(/Reduziere deine Kalorien um ca\. [\d.]+ kcal/);
    expect(r.actualTdee).toBeGreaterThan(2200);
    expect(r.recommendedKcal).toBeLessThan(2000);
  });

  it('bewertet Kraftziele mit Deadline', () => {
    const input = baseInput();
    input.goals = { ...goals, strengthGoals: [{ exercise: 'Bankdrücken', target1RM: 120, deadline: addDays(TODAY, 28) }] };
    input.sets = [0, 1, 2, 3, 4].map((i) => set(addDays(TODAY, -28 + i * 7), 'Bankdrücken', 80 + i, 5));
    const r = analyze(input);
    const s = r.strength[0];
    expect(s.current).toBeCloseTo(84 * (1 + 5 / 30), 1);
    expect(s.onTrack).toBe(false);
    expect(r.recommendations.find((x) => x.id === 'kraftziel-Bankdrücken')!.severity).toBe('warn');
  });

  it('verknüpft Schlaf mit Trainingsleistung', () => {
    const input = baseInput();
    // 7 Einheiten; nach guten Nächten jeweils Steigerung, nach schlechten Rückgang
    const weights = [100, 103, 101, 104, 102, 105, 103];
    input.sets = weights.map((w, i) => set(addDays(TODAY, -21 + i * 3), 'Bankdrücken', w, 1));
    input.sleep = weights.map((_, i) => {
      const good = i % 2 === 1;
      return {
        date: addDays(TODAY, -21 + i * 3),
        bedtime: good ? '22:30' : '01:00',
        wakeTime: '07:00',
        durationMin: good ? 510 : 360,
        quality: 3 as const,
      };
    });
    const insights = combinedInsights(input);
    const sleepInsight = insights.find((x) => x.id === 'schlaf-leistung')!;
    expect(sleepInsight).toBeDefined();
    expect(sleepInsight.conclusion).toContain('positiv');
  });
});
