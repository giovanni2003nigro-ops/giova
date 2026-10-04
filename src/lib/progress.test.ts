import { describe, expect, it } from 'vitest';
import type { Activity, WorkoutSet } from '../types';
import { enduranceSports, strengthLines, tempoSeries, weeklyEndurance } from './progress';

const run = (date: string, km: number, min: number, extra: Partial<Activity> = {}): Activity => ({
  uid: `${date}-${km}`,
  sport: 'laufen',
  title: 'Lauf',
  date,
  startTime: Date.parse(`${date}T07:00:00`),
  durationSec: min * 60,
  distanceM: km * 1000,
  source: 'manuell',
  visibility: 'public',
  points: 50,
  createdAt: 0,
  ...extra,
});

describe('Entwicklung', () => {
  it('summiert den Wochenumfang, auch leere Wochen', () => {
    const acts = [run('2026-09-28', 10, 50), run('2026-09-30', 5, 26), run('2026-09-21', 8, 42), run('2026-10-01', 30, 90, { sport: 'radfahren' })];
    const w = weeklyEndurance(acts, 'laufen', 4, '2026-10-03');
    expect(w.map((x) => x.week)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(w[3]).toMatchObject({ km: 15, count: 2 });
    expect(w[2]).toMatchObject({ km: 8, count: 1 });
    expect(w[0]).toMatchObject({ km: 0, count: 0 });
  });

  it('berechnet das Tempo je Einheit und ignoriert kurze Wege', () => {
    const acts = [run('2026-09-28', 10, 50), run('2026-09-29', 0.5, 4), run('2026-09-30', 30, 60, { sport: 'radfahren' })];
    expect(tempoSeries(acts, 'laufen', '2026-09-01')).toEqual([{ x: '2026-09-28', y: 5 }]);
    expect(tempoSeries(acts, 'radfahren', '2026-09-01')).toEqual([{ x: '2026-09-30', y: 30 }]);
    expect(tempoSeries(acts, 'gym', '2026-09-01')).toEqual([]);
  });

  it('zeigt den Kraftverlauf je Übung', () => {
    const set = (date: string, exercise: string, weight: number, reps: number): WorkoutSet => ({ date, exercise, weight, reps, createdAt: Date.parse(date) });
    const sets = [set('2026-09-01', 'Kniebeuge', 100, 5), set('2026-09-08', 'Kniebeuge', 105, 5), set('2026-09-15', 'Kniebeuge', 110, 5), set('2026-09-08', 'Klimmzüge', 0, 8), set('2026-09-15', 'Klimmzüge', 0, 10), set('2026-09-15', 'Curls', 15, 10)];
    const lines = strengthLines(sets, '2026-08-01');
    expect(lines.map((l) => l.exercise)).toEqual(['Kniebeuge', 'Klimmzüge']);
    expect(lines[0].last).toBeGreaterThan(lines[0].first);
    expect(lines[1]).toMatchObject({ metricType: 'reps', first: 8, last: 10 });
  });

  it('findet die betriebenen Ausdauersportarten', () => {
    expect(enduranceSports([run('2026-09-28', 5, 25), run('2026-09-29', 5, 25), run('2026-09-30', 20, 40, { sport: 'radfahren' }), run('2026-09-30', 0, 60, { sport: 'gym', distanceM: undefined })])).toEqual(['laufen', 'radfahren']);
  });
});
