import { describe, expect, it } from 'vitest';
import type { Activity, Goals, Sport, WorkoutSet } from '../types';
import { DEFAULT_GOALS } from '../types';
import { addDays } from './dates';
import {
  closeGroup,
  dots,
  LEAGUE_RULES,
  performanceTier,
  seasonOf,
  seasonPoints,
  seasonRange,
  sportPerformance,
  zoneSize,
} from './leagues';
import { evaluateMedals, liftOf, medalProgress, MEDALS, type MedalContext } from './medals';
import { activityPoints } from './points';
import vectors from './points.vectors.json';

const TODAY = '2026-09-29';

function act(date: string, sport: Sport, durationSec: number, distanceM?: number, extra: Partial<Activity> = {}): Activity {
  const base = { sport, durationSec, distanceM, ...extra };
  return {
    uid: `${date}-${sport}-${Math.random()}`,
    title: '',
    date,
    startTime: Date.parse(`${date}T07:00:00`),
    source: 'manuell',
    visibility: 'public',
    createdAt: 0,
    ...base,
    points: activityPoints(base),
  };
}

function ctx(partial: Partial<MedalContext>): MedalContext {
  return { today: TODAY, activities: [], sets: [], meals: [], sleep: [], weights: [], goals: DEFAULT_GOALS, plan: null, ...partial };
}

describe('Punkte', () => {
  it.each(vectors as { sport: Sport; durationSec: number; distanceM?: number; elevationGainM?: number; race?: boolean; points: number }[])(
    '$sport $durationSec s / $distanceM m → $points',
    (v) => {
      expect(activityPoints({ ...v, hyrox: v.race ? { race: true } : undefined })).toBe(v.points);
    },
  );
});

describe('Ligen', () => {
  it('stuft nach Umfang ODER Tempo ein', () => {
    // 35 km im Monat → Silber (Umfang), langsames Tempo
    expect(performanceTier('laufen', 35, 420)).toBe(1);
    // Nur 25 km, aber Ø 4:50 /km → Platin über das Tempo
    expect(performanceTier('laufen', 25, 290)).toBe(3);
    // Schnell, aber zu wenig Umfang für die Tempo-Schwelle
    expect(performanceTier('laufen', 10, 240)).toBe(0);
    expect(performanceTier('laufen', 300, 400)).toBe(5);
    expect(performanceTier('gym', 11, null)).toBe(2);
    expect(LEAGUE_RULES.laufen.volume.thresholds).toHaveLength(5);
  });

  it('berechnet die Leistung aus den letzten 30 Tagen', () => {
    const acts = [
      act(addDays(TODAY, -2), 'laufen', 3000, 10_000),
      act(addDays(TODAY, -9), 'laufen', 3000, 10_000),
      act(addDays(TODAY, -40), 'laufen', 6000, 20_000), // außerhalb
      act(addDays(TODAY, -1), 'radfahren', 3600, 30_000),
    ];
    const p = sportPerformance('laufen', acts, TODAY, { sex: 'm', bodyweight: 75 });
    expect(p.activities).toBe(2);
    expect(p.volume).toBe(20);
    expect(p.intensity).toBe(300);
    expect(p.tier).toBe(3); // 5:00 /km bei ≥ 20 km
    expect(p.nextVolumeProgress).toBeCloseTo(20 / 160);
  });

  it('berechnet DOTS', () => {
    // Referenzwerte (IPF-Formel 2019): 80 kg Mann mit 500 kg Total ≈ 344,8 DOTS
    expect(dots(500, 80, 'm')).toBeCloseTo(344.8, 1);
    expect(dots(300, 60, 'w')).toBeCloseTo(332.6, 1);
    expect(dots(500, 250, 'm')).toBeCloseTo(dots(500, 210, 'm'), 5); // Gewicht wird begrenzt
  });

  it('bewertet Powerlifting über die Wettkampfübungen', () => {
    const pl = (date: string, squat: number, bench: number, deadlift: number) =>
      act(date, 'powerlifting', 5400, undefined, { powerlifting: { squat, bench, deadlift, bodyweight: 80 } });
    const p = sportPerformance('powerlifting', [pl(addDays(TODAY, -3), 180, 120, 200), pl(addDays(TODAY, -60), 170, 125, 210)], TODAY, { sex: 'm', bodyweight: 80 });
    // Beste Werte aus 90 Tagen: 180 + 125 + 210 = 515 kg
    expect(p.intensity).toBeCloseTo(dots(515, 80, 'm'), 5);
    expect(p.tier).toBe(3);
  });

  it('teilt Saisons in Monate', () => {
    expect(seasonOf('2026-09-29')).toBe('2026-09');
    expect(seasonRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(seasonRange('2028-02').to).toBe('2028-02-29');
  });

  it('entscheidet Auf- und Abstieg', () => {
    expect(zoneSize(4)).toBe(0);
    expect(zoneSize(10)).toBe(2);
    expect(zoneSize(30)).toBe(6);
    const members = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, points: 1000 - i * 100, tier: 2, performanceTier: 2 }));
    // u9 ohne Punkte, u8 hält die Liga über die Leistungsschwelle nicht
    members[9].points = 0;
    members[8].performanceTier = 1;
    // u5 erreicht die Schwelle von Diamant → springt direkt zwei Ligen hoch
    members[5].performanceTier = 4;
    const res = new Map(closeGroup(members).map((r) => [r.userId, r]));
    expect(res.get('u0')).toMatchObject({ rank: 1, outcome: 'auf', newTier: 3 });
    expect(res.get('u1')).toMatchObject({ outcome: 'auf', newTier: 3 });
    expect(res.get('u2')).toMatchObject({ outcome: 'bleibt', newTier: 2 });
    expect(res.get('u5')).toMatchObject({ outcome: 'auf', newTier: 4 });
    expect(res.get('u8')).toMatchObject({ outcome: 'ab', newTier: 1 });
    expect(res.get('u9')).toMatchObject({ rank: 10, outcome: 'ab', newTier: 1 });
  });

  it('schützt Leistungsträger in der Abstiegszone und lässt Bronze nicht absteigen', () => {
    const members = Array.from({ length: 5 }, (_, i) => ({ userId: `u${i}`, points: 500 - i * 100 + 1, tier: 1, performanceTier: 1 }));
    const last = closeGroup(members).find((r) => r.userId === 'u4')!;
    expect(last.outcome).toBe('bleibt');
    const bronze = closeGroup([{ userId: 'x', points: 0, tier: 0, performanceTier: 0 }]);
    expect(bronze[0].outcome).toBe('bleibt');
    // Kleine Gruppe: kein Aufstieg nur über die Platzierung
    expect(closeGroup([{ userId: 'y', points: 900, tier: 1, performanceTier: 1 }])[0].outcome).toBe('bleibt');
  });

  it('zählt Saisonpunkte aus Aktivitäten und Medaillen', () => {
    const acts = [act('2026-09-03', 'laufen', 3000, 10_000), act('2026-08-30', 'laufen', 3000, 10_000), act('2026-09-04', 'gym', 3600)];
    const medals = [
      { period: '2026-09', date: '2026-09-10', points: 75 }, // allgemein
      { period: '', date: '2026-09-03', points: 100, sport: 'laufen' as Sport },
      { period: '', date: '2026-09-04', points: 50, sport: 'gym' as Sport },
    ];
    expect(seasonPoints('laufen', '2026-09', acts, medals)).toBe(120 + 75 + 100);
    expect(seasonPoints('gym', '2026-09', acts, medals)).toBe(90 + 75 + 50);
  });
});

describe('Medaillen', () => {
  it('hat eindeutige Schlüssel', () => {
    expect(new Set(MEDALS.map((m) => m.key)).size).toBe(MEDALS.length);
  });

  it('vergibt Lauf-Medaillen mit Datum', () => {
    const acts = [act('2026-09-01', 'laufen', 1800, 5200), act('2026-09-10', 'laufen', 2950, 10_050)];
    const earned = new Map(evaluateMedals(ctx({ activities: acts })).map((m) => [m.id, m]));
    expect(earned.get('erste_aktivitaet:')?.date).toBe('2026-09-01');
    expect(earned.get('lauf_5k:')?.date).toBe('2026-09-01');
    expect(earned.get('lauf_10k:')?.date).toBe('2026-09-10');
    expect(earned.get('lauf_sub50_10k:')?.date).toBe('2026-09-10');
    expect(earned.has('lauf_hm:')).toBe(false);
  });

  it('vergibt Monats-Medaillen je Saison', () => {
    const acts = [
      ...Array.from({ length: 6 }, (_, i) => act(`2026-08-${String(i + 2).padStart(2, '0')}`, 'laufen', 3000, 10_000)),
      ...Array.from({ length: 3 }, (_, i) => act(`2026-09-${String(i + 2).padStart(2, '0')}`, 'laufen', 3000, 10_000)),
    ];
    const earned = evaluateMedals(ctx({ activities: acts })).map((m) => m.id);
    expect(earned).toContain('lauf_50km_monat:2026-08');
    expect(earned).not.toContain('lauf_50km_monat:2026-09');
    // 6 Tage am Stück reichen noch nicht für die Serie
    expect(earned).not.toContain('streak_7:2026-08');
    const progress = medalProgress(ctx({ activities: acts })).find((p) => p.def.key === 'lauf_50km_monat')!;
    expect(progress.check.progress).toBeCloseTo(0.6);
  });

  it('vergibt Ziel-Medaillen für Ernährung und Schlaf', () => {
    const goals: Goals = { ...DEFAULT_GOALS, protein: 150, kcal: 2500, sleepHours: 8 };
    const days = Array.from({ length: 7 }, (_, i) => addDays('2026-09-10', i));
    const meals = days.map((d) => ({ date: d, meal: 'mittag' as const, name: 'x', amount: 1, unit: 'g' as const, kcal: 2450, protein: 145, carbs: 300, fat: 70, createdAt: 0 }));
    const sleep = days.map((d) => ({ date: d, bedtime: '23:00', wakeTime: '06:50', durationMin: 470, quality: 4 as const }));
    const earned = new Map(evaluateMedals(ctx({ goals, meals, sleep })).map((m) => [m.id, m]));
    expect(earned.get('protein_7:2026-09')?.date).toBe('2026-09-16');
    expect(earned.get('schlaf_7:2026-09')?.date).toBe('2026-09-16');
    expect(earned.has('kalorien_14:2026-09')).toBe(false);
  });

  it('erkennt Powerlifting-Übungen und Kraft-Medaillen', () => {
    expect(liftOf('Kniebeuge')).toBe('squat');
    expect(liftOf('Bulgarian Split Squat')).toBeNull();
    expect(liftOf('Bankdrücken')).toBe('bench');
    expect(liftOf('Kurzhantel-Bankdrücken')).toBeNull();
    expect(liftOf('Kreuzheben')).toBe('deadlift');
    expect(liftOf('Rumänisches Kreuzheben')).toBeNull();
    const s = (date: string, exercise: string, weight: number, reps: number): WorkoutSet => ({ date, exercise, weight, reps, createdAt: 0 });
    const sets = [s('2026-09-01', 'Bankdrücken', 70, 5), s('2026-09-08', 'Bankdrücken', 80, 5), s('2026-09-08', 'Kreuzheben', 140, 5)];
    const weights = [{ date: '2026-09-01', weight: 85 }];
    const earned = new Map(evaluateMedals(ctx({ sets, weights })).map((m) => [m.id, m]));
    // 80 × (1 + 5/30) = 93,3 kg ≥ 85 kg Körpergewicht
    expect(earned.get('pl_bw_bench:')?.date).toBe('2026-09-08');
    expect(earned.get('kraft_pr:2026-09')?.date).toBe('2026-09-08');
    expect(earned.has('pl_2x_deadlift:')).toBe(false);
  });
});
