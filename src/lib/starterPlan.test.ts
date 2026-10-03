import { describe, expect, it } from 'vitest';
import { DEFAULT_GOALS } from '../types';
import { checkRules, limits } from './guardrails';
import { activityFactor, starterPlan } from './starterPlan';

describe('Startplan', () => {
  it('verteilt die Sportarten auf die gewählten Tage', () => {
    const p = starterPlan(['laufen', 'gym'], 4, 'morgens')!;
    expect(p.sessions).toHaveLength(4);
    expect(new Set(p.sessions.map((s) => s.weekday)).size).toBe(4);
    expect(p.sessions.map((s) => s.sport)).toEqual(['laufen', 'gym', 'laufen', 'gym']);
    expect(p.sessions[0].time).toBe('07:00');
    // Samstag: langer, lockerer Lauf
    const sat = starterPlan(['laufen'], 4)!.sessions.find((s) => s.weekday === 5)!;
    expect(sat).toMatchObject({ intensity: 'locker', title: 'Langer Lauf', time: '09:30' });
  });

  it('hält die Rahmenbedingungen ein – auch bei 6 Tagen nur Hyrox', () => {
    for (let days = 1; days <= 7; days++) {
      const p = starterPlan(['hyrox'], days)!;
      const rules = checkRules({ ...DEFAULT_GOALS, trainingDays: days }, p, limits(null, 80));
      expect(rules.find((r) => r.id === 'rest')!.ok).toBe(true);
      expect(rules.find((r) => r.id === 'hard')!.ok).toBe(true);
      expect(p.sessions.length).toBe(Math.min(6, days));
    }
  });

  it('braucht mindestens eine Sportart', () => {
    expect(starterPlan([], 3)).toBeNull();
  });

  it('schätzt den Aktivitätsfaktor', () => {
    expect(activityFactor(0)).toBe(1.3);
    expect(activityFactor(3)).toBe(1.6);
    expect(activityFactor(6)).toBe(1.75);
  });
});
